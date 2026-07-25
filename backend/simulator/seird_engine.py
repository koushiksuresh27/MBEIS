import math
import numpy as np
import random

# Locks the random number generator so the Monte Carlo picks the exact same "random" numbers every time
np.random.seed(42)
random.seed(42)

from backend.simulator.simulator_io import (
    get_latest_pathogen_profile,
    write_seird_results,
    write_city_status,
    write_resource_projections
)
from backend.simulator.resource_calculator import calculate_resource_projections


N_DAYS = 90

# 15-city node data (research7.txt, CAGR-interpolated 2020 populations).
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
    "THRISSUR":      {"pop": 3_188_000,  "lat": 10.5276, "lon": 76.2144}, 
    "THIRUVANANTHAPURAM": {"pop": 2_584_752, "lat": 8.5241, "lon": 76.9366},
}

LOCAL_TRANSMISSION_MULTIPLIER = {
    "none": 1.0,
    "rail_only": 0.85,
    "partial": 0.6,
    "full": 0.3,
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
            if d > 0:
                W[i, j] = (CITIES[names[i]]["pop"] * CITIES[names[j]]["pop"]) / (d ** 2)
    if W.max() > 0:
        W = W / W.max()
    return names, W

def apply_intervention(W, intervention):
    """Down-weight mobility edges per intervention type"""
    if intervention == "none":
        return W
    if intervention == "rail_only":
        threshold = np.quantile(W[W > 0], 0.9) if (W > 0).any() else 1.0
        W2 = W.copy()
        W2[W > threshold] *= 0.3
        return W2
    if intervention == "partial":
        W2 = W.copy()
        W2[W > 0.05] = 0.0
        return W2
    if intervention == "full":
        return W * 0.30
    return W

def run_mc_iteration(names, base_W, origin_city, intervention, r0, incubation_days, cfr, infectious_period):
    n = len(names)
    pops = np.array([CITIES[c]["pop"] for c in names], dtype=float)
    S = pops.copy()
    E = np.zeros(n)
    I = np.zeros(n)
    R = np.zeros(n)
    D = np.zeros(n)

    if origin_city in names:
        origin_idx = names.index(origin_city)
        I[origin_idx] = 1.0
    else:
        # Should never reach here after run_simulation's boundary normalization.
        # Raise instead of silently seeding the wrong city.
        raise ValueError(
            f"run_mc_iteration: origin_city '{origin_city}' not in names list. "
            f"Ensure run_simulation normalized it via strip().upper() before calling."
        )

    beta = r0 / infectious_period
    sigma = 1.0 / incubation_days
    gamma = 1.0 / infectious_period

    national_infected = np.zeros(N_DAYS)
    national_deaths = np.zeros(N_DAYS)
    national_new_infections = np.zeros(N_DAYS)
    city_active = np.zeros((N_DAYS, n))
    
    W = apply_intervention(base_W, intervention)
    local_mult = LOCAL_TRANSMISSION_MULTIPLIER.get(intervention, 1.0)
    effective_beta = beta * local_mult

    for day in range(N_DAYS):
        new_infections = effective_beta * S * I / np.maximum(pops, 1)
        new_exposed_to_infectious = sigma * E
        new_removed = gamma * I
        new_deaths = new_removed * cfr
        new_recovered = new_removed * (1 - cfr)

        # cross-city seeding proportional to mobility-weighted infectious pressure
        import_pressure = W @ (I / np.maximum(pops, 1))
        cross_city_infections = effective_beta * S * import_pressure * 0.1
        epsilon = (pops / pops.sum()) * 100.0
        total_new_infections = new_infections + cross_city_infections + epsilon

        # Capping flows to available compartment sizes to prevent mass-conservation bugs
        total_new_infections = np.minimum(total_new_infections, S)
        new_exposed_to_infectious = np.minimum(new_exposed_to_infectious, E)
        new_removed = np.minimum(new_removed, I)

        S = S - total_new_infections
        E = E + total_new_infections - new_exposed_to_infectious
        I = I + new_exposed_to_infectious - new_removed
        R = R + new_recovered
        D = D + new_deaths

        national_infected[day] = I.sum()
        national_deaths[day] = D.sum()
        national_new_infections[day] = total_new_infections.sum()
        city_active[day] = I

    return national_infected, national_deaths, national_new_infections, city_active

def triangular(low, mode, high, size):
    return np.random.triangular(float(low), float(mode), float(high), size)

def run_simulation(scenario_id: str, origin_city: str, intervention_types: list[str], n_iterations: int = 500) -> None:
    # Normalize origin_city at the boundary: strip whitespace and uppercase
    # so that DB values like "Thrissur" match CITIES keys like "THRISSUR".
    # This must be the single normalization point — do not add case-folding
    # anywhere else (e.g. in run_mc_iteration) so the fix stays auditable.
    origin_city = origin_city.strip().upper()
    if origin_city not in CITIES:
        raise ValueError(
            f"origin_city '{origin_city}' (normalized) not found in CITIES dict. "
            f"Valid keys: {list(CITIES.keys())}"
        )
    print(f"[engine] origin_city resolved to '{origin_city}'")

    profile = get_latest_pathogen_profile(scenario_id)
    
    names, base_W = build_mobility_matrix()
    
    seird_rows_all = []
    city_rows_all = []
    
    for intervention in intervention_types:
        print(f"Running {n_iterations} MC iterations for intervention={intervention}...")
        all_infected = np.zeros((n_iterations, N_DAYS))
        all_deaths = np.zeros((n_iterations, N_DAYS))
        all_new_infections = np.zeros((n_iterations, N_DAYS))
        all_city_active = np.zeros((n_iterations, N_DAYS, len(names)))

        r0_samples = triangular(profile["r0_low"], profile["r0_most_likely"], profile["r0_high"], n_iterations)
        inc_samples = triangular(profile["incubation_days_low"], profile["incubation_days_most_likely"], profile["incubation_days_high"], n_iterations)
        cfr_samples = triangular(profile["cfr_low"], profile["cfr_most_likely"], profile["cfr_high"], n_iterations)
        
        # Pull infectious period bounds directly from the DB profile
        # Use a fallback just in case the DB hasn't been migrated yet, but assume it will be
        if "infectious_period_most_likely" in profile:
            inf_samples = triangular(profile["infectious_period_low"], profile["infectious_period_most_likely"], profile["infectious_period_high"], n_iterations)
        else:
            inf_samples = np.full(n_iterations, 7.0)

        for it in range(n_iterations):
            inf, dth, new_inf, city_act = run_mc_iteration(
                names, base_W, origin_city, intervention,
                r0_samples[it], inc_samples[it], cfr_samples[it], inf_samples[it]
            )
            all_infected[it] = inf
            all_deaths[it] = dth
            all_new_infections[it] = new_inf
            all_city_active[it] = city_act

        for day in range(N_DAYS):
            seird_rows_all.append({
                "scenario_id": scenario_id,
                "pathogen_profile_version": profile["version"],
                "intervention_type": intervention,
                "day": day + 1,
                "infected_p10": float(np.percentile(all_infected[:, day], 10)),
                "infected_p50": float(np.percentile(all_infected[:, day], 50)),
                "infected_p90": float(np.percentile(all_infected[:, day], 90)),
                "deaths_p10": float(np.percentile(all_deaths[:, day], 10)),
                "deaths_p50": float(np.percentile(all_deaths[:, day], 50)),
                "deaths_p90": float(np.percentile(all_deaths[:, day], 90)),
                "trajectory_sample": all_infected[:, day].tolist(),
                "new_infections_trajectory_sample": all_new_infections[:, day].tolist(),
            })
            
            for ci, city in enumerate(names):
                city_rows_all.append({
                    "scenario_id": scenario_id,
                    "pathogen_profile_version": profile["version"],
                    "intervention_type": intervention,
                    "city": city,
                    "day": day + 1,
                    "active_cases_p10": float(np.percentile(all_city_active[:, day, ci], 10)),
                    "active_cases_p50": float(np.percentile(all_city_active[:, day, ci], 50)),
                    "active_cases_p90": float(np.percentile(all_city_active[:, day, ci], 90)),
                })
                
    # Group and write results via existing io functions
    from itertools import groupby
    from operator import itemgetter
    
    sorted_seird = sorted(seird_rows_all, key=itemgetter("intervention_type"))
    for inv_type, group in groupby(sorted_seird, key=itemgetter("intervention_type")):
        write_seird_results(list(group))
        print(f"  [done] seird_results written for intervention={inv_type}")        
    sorted_city = sorted(city_rows_all, key=itemgetter("intervention_type"))
    for inv_type, group in groupby(sorted_city, key=itemgetter("intervention_type")):
        # Convert group to a list so it can be used multiple times
        city_group = list(group)
        
        # 1. Write the city status 
        write_city_status(city_group)
        print(f"  [done] city_status written for intervention={inv_type}")
        
        # 2. Wire up the resource calculator
        # (Pass the profile so the calculator can scale severity based on CFR)
        resource_rows = calculate_resource_projections(city_group, scenario_id, profile)
        
        # 3. Write the resource projections to Supabase
        write_resource_projections(resource_rows)
        print(f"  [done] resource_projections written for intervention={inv_type}")

    return {
        "seird_results": seird_rows_all,
        "city_status": city_rows_all,
    }
