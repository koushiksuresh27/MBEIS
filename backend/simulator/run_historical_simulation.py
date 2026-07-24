"""
Runs the historical COVID validation scenario: 90-day metapopulation SEIRD
Monte Carlo across the 15-city gravity-model mobility graph, under all 4
intervention variants, writing national totals to seird_results and
per-city breakdowns to city_status.

Requires: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY env vars (service role key
bypasses RLS, needed since this writes to backend-only tables).

Run: python run_historical_simulation.py
"""

import os
import math
import numpy as np
from supabase import create_client
from dotenv import load_dotenv
load_dotenv()

SCENARIO_ID = "bb0ff20e-b086-411b-8054-91560b1e88ec"
N_DAYS = 90
N_MC_ITERATIONS = 500  # Monte Carlo sample count per intervention

# KNOWN GAP: infectious period isn't in the schema yet (see chat). Hardcoded
# here as a literature-reasonable default for a COVID-shaped respiratory
# pathogen. Move this into reference_diseases/pathogen_profiles as a real
# low/most_likely/high triple before running non-COVID scenarios.
INFECTIOUS_PERIOD_DAYS = 7.0

# 15-city node data (research7.txt, CAGR-interpolated 2020 populations).
# TODO: migrate to a real `cities` table — hardcoded here to unblock now.
CITIES = {
    "Delhi":         {"pop": 24_268_206, "lat": 28.7041, "lon": 77.1025},
    "Mumbai":        {"pop": 19_537_745, "lat": 19.0760, "lon": 72.8777},
    "Kolkata":       {"pop": 19_074_357, "lat": 22.5726, "lon": 88.3639},
    "Bengaluru":     {"pop": 11_282_457, "lat": 12.9716, "lon": 77.5946},
    "Chennai":       {"pop": 10_204_689, "lat": 13.0827, "lon": 80.2707},
    "Hyderabad":     {"pop": 8_647_544,  "lat": 17.3850, "lon": 78.4867},
    "Ahmedabad":     {"pop": 7_151_558,  "lat": 23.0225, "lon": 72.5714},
    "Pune":          {"pop": 6_128_192,  "lat": 18.5204, "lon": 73.8567},
    "Lucknow":       {"pop": 4_145_235,  "lat": 26.8467, "lon": 80.9462},
    "Kochi":         {"pop": 3_716_804,  "lat": 9.9312,  "lon": 76.2673},
    "Jaipur":        {"pop": 3_682_557,  "lat": 26.9124, "lon": 75.7873},
    "Patna":         {"pop": 2_788_687,  "lat": 25.5941, "lon": 85.1376},
    "Visakhapatnam": {"pop": 2_379_357,  "lat": 17.6868, "lon": 83.2185},
    "Bhopal":        {"pop": 2_253_211,  "lat": 23.2599, "lon": 77.4126},
    "Guwahati":      {"pop": 1_178_385,  "lat": 26.1445, "lon": 91.7362},
}
ORIGIN_CITY = "Kochi"  # nearest node to Thrissur, scenario's actual origin_city

INTERVENTIONS = ["none", "rail_only", "partial", "full"]

# Local (within-city) transmission multipliers. Real lockdowns work mainly by
# reducing LOCAL contact (people staying home), not just inter-city travel —
# the mobility-matrix down-weighting alone (apply_intervention below) barely
# touches the dominant beta*S*I/pop term, so without this, all interventions
# look nearly identical. 'full' ~ 70-80% contact reduction, roughly matching
# observed stringency-index effects (e.g. Oxford OxCGRT) during India's actual
# lockdown, not just the research7-cited mobility figure.
LOCAL_TRANSMISSION_MULTIPLIER = {
    "none": 1.0,
    "rail_only": 0.90,   # targets long-haul travel, minimal local effect
    "partial": 0.55,     # meaningful local contact reduction
    "full": 0.25,         # matches the ~70-80% stringency of India's actual lockdown
}


def haversine_km(lat1, lon1, lat2, lon2):
    R = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlmb = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlmb / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


def build_mobility_matrix():
    """Gravity model: W_ij = pop_i * pop_j / distance_ij^2, normalized to [0,1]."""
    names = list(CITIES.keys())
    n = len(names)
    W = np.zeros((n, n))
    for i in range(n):
        for j in range(n):
            if i == j:
                continue
            d = haversine_km(CITIES[names[i]]["lat"], CITIES[names[i]]["lon"],
                              CITIES[names[j]]["lat"], CITIES[names[j]]["lon"])
            W[i, j] = (CITIES[names[i]]["pop"] * CITIES[names[j]]["pop"]) / (d ** 2)
    if W.max() > 0:
        W = W / W.max()
    return names, W


def apply_intervention(W, intervention, day):
    """Down-weight mobility edges per intervention type, matching research7's
    described logic: partial severs high-volume edges above a threshold,
    full applies a stringent fractional multiplier network-wide, active from
    day 56 (25 Mar 2020) onward to mirror the real lockdown timing."""
    if intervention == "none":
        return W
    if day < 56:
        return W  # interventions weren't active before the real lockdown date
    if intervention == "rail_only":
        # crude proxy: dampen the top 10% highest-weight (long-haul/aviation-like) edges more
        threshold = np.quantile(W[W > 0], 0.9) if (W > 0).any() else 1.0
        W2 = W.copy()
        W2[W > threshold] *= 0.3
        return W2
    if intervention == "partial":
        W2 = W.copy()
        W2[W > 0.05] = 0.0  # sever high-volume inter-city edges
        return W2
    if intervention == "full":
        return W * 0.30  # 70% reduction network-wide, per research7
    return W


def run_mc_iteration(names, base_W, intervention, r0, incubation_days, cfr):
    n = len(names)
    pops = np.array([CITIES[c]["pop"] for c in names], dtype=float)
    S = pops.copy()
    E = np.zeros(n)
    I = np.zeros(n)
    R = np.zeros(n)
    D = np.zeros(n)

    origin_idx = names.index(ORIGIN_CITY)
    I[origin_idx] = 1.0  # single index case, matching the real Day 1

    beta = r0 / INFECTIOUS_PERIOD_DAYS
    sigma = 1.0 / incubation_days
    gamma = 1.0 / INFECTIOUS_PERIOD_DAYS

    national_infected = np.zeros(N_DAYS)
    national_deaths = np.zeros(N_DAYS)
    national_new_infections = np.zeros(N_DAYS)
    city_active = np.zeros((N_DAYS, n))

    for day in range(N_DAYS):
        W = apply_intervention(base_W, intervention, day)
        local_mult = LOCAL_TRANSMISSION_MULTIPLIER[intervention] if day >= 56 else 1.0
        effective_beta = beta * local_mult

        new_infections = effective_beta * S * I / np.maximum(pops, 1)
        new_exposed_to_infectious = sigma * E
        new_removed = gamma * I
        new_deaths = new_removed * cfr
        new_recovered = new_removed * (1 - cfr)

        # cross-city seeding proportional to mobility-weighted infectious pressure
        import_pressure = W @ (I / np.maximum(pops, 1))
        cross_city_infections = effective_beta * S * import_pressure * 0.1  # damped coupling term

        total_new_infections = np.clip(new_infections + cross_city_infections, 0, S)

        S = np.clip(S - total_new_infections, 0, None)
        E = np.clip(E + total_new_infections - new_exposed_to_infectious, 0, None)
        I = np.clip(I + new_exposed_to_infectious - new_removed, 0, None)
        R = np.clip(R + new_recovered, 0, None)
        D = D + new_deaths

        national_infected[day] = I.sum()
        national_deaths[day] = D.sum()
        national_new_infections[day] = total_new_infections.sum()
        city_active[day] = I

    return national_infected, national_deaths, national_new_infections, city_active


def triangular(low, mode, high, size):
    return np.random.triangular(float(low), float(mode), float(high), size)


def main():
    supabase = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])

    profile = supabase.table("pathogen_profiles").select("*").eq(
        "scenario_id", SCENARIO_ID
    ).order("version", desc=True).limit(1).execute().data
    if not profile:
        raise RuntimeError("No pathogen_profiles row found — run fix_historical_scenario_profile.sql first")
    profile = profile[0]

    names, base_W = build_mobility_matrix()

    # Idempotency: clear any prior results for this scenario so a rerun after
    # a partial failure (like the city_status column mismatch) doesn't
    # duplicate rows for interventions that already succeeded.
    supabase.table("seird_results").delete().eq("scenario_id", SCENARIO_ID).execute()
    supabase.table("city_status").delete().eq("scenario_id", SCENARIO_ID).execute()
    print("Cleared prior seird_results/city_status rows for this scenario.")

    rng = np.random.default_rng(42)
    np.random.seed(42)

    for intervention in INTERVENTIONS:
        print(f"Running {N_MC_ITERATIONS} MC iterations for intervention={intervention}...")
        all_infected = np.zeros((N_MC_ITERATIONS, N_DAYS))
        all_deaths = np.zeros((N_MC_ITERATIONS, N_DAYS))
        all_new_infections = np.zeros((N_MC_ITERATIONS, N_DAYS))
        all_city_active = np.zeros((N_MC_ITERATIONS, N_DAYS, len(names)))

        r0_samples = triangular(profile["r0_low"], profile["r0_most_likely"], profile["r0_high"], N_MC_ITERATIONS)
        inc_samples = triangular(profile["incubation_days_low"], profile["incubation_days_most_likely"],
                                  profile["incubation_days_high"], N_MC_ITERATIONS)
        cfr_samples = triangular(profile["cfr_low"], profile["cfr_most_likely"], profile["cfr_high"], N_MC_ITERATIONS)

        for it in range(N_MC_ITERATIONS):
            inf, dth, new_inf, city_act = run_mc_iteration(
                names, base_W, intervention,
                r0_samples[it], inc_samples[it], cfr_samples[it]
            )
            all_infected[it] = inf
            all_deaths[it] = dth
            all_new_infections[it] = new_inf
            all_city_active[it] = city_act

        # National seird_results: p10/p50/p90 across MC iterations, per day
        seird_rows = []
        for day in range(N_DAYS):
            seird_rows.append({
                "scenario_id": SCENARIO_ID,
                "pathogen_profile_version": profile["version"],
                "intervention_type": intervention,
                "day": day + 1,
                "infected_p10": float(np.percentile(all_infected[:, day], 10)),
                "infected_p50": float(np.percentile(all_infected[:, day], 50)),
                "infected_p90": float(np.percentile(all_infected[:, day], 90)),
                "deaths_p10": float(np.percentile(all_deaths[:, day], 10)),
                "deaths_p50": float(np.percentile(all_deaths[:, day], 50)),
                "deaths_p90": float(np.percentile(all_deaths[:, day], 90)),
                "trajectory_sample": all_infected[:, day].tolist(),  # full MC samples for real CRPS later
                "new_infections_trajectory_sample": all_new_infections[:, day].tolist(),
            })
        supabase.table("seird_results").insert(seird_rows).execute()

        # Per-city city_status: p10/p50/p90 active cases per city per day
        city_rows = []
        for day in range(N_DAYS):
            for ci, city in enumerate(names):
                city_rows.append({
                    "scenario_id": SCENARIO_ID,
                    "pathogen_profile_version": profile["version"],
                    "intervention_type": intervention,
                    "city": city,
                    "day": day + 1,
                    "active_cases_p10": float(np.percentile(all_city_active[:, day, ci], 10)),
                    "active_cases_p50": float(np.percentile(all_city_active[:, day, ci], 50)),
                    "active_cases_p90": float(np.percentile(all_city_active[:, day, ci], 90)),
                })
        supabase.table("city_status").insert(city_rows).execute()

        print(f"  wrote {len(seird_rows)} seird_results rows, {len(city_rows)} city_status rows")

    print("Done.")


if __name__ == "__main__":
    main()