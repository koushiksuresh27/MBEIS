import os
import sys
import numpy as np
from scipy.stats import qmc, triang

sys.path.insert(0, os.path.abspath("."))
from backend.simulator.seird_engine import (
    build_composite_matrix,
    run_mc_iteration,
    run_phased_mc_iteration,
    CITIES,
    N_DAYS
)

def run_all_scenarios():
    print("Running 128-iteration full evaluation across all 5 interventions...", flush=True)
    names, matrices = build_composite_matrix(
        meta_edges_path="backend/simulator/meta_mobility_edges.csv",
        dgca_path="backend/simulator/dgca_annual_weights.csv",
        irctc_path="backend/simulator/irctc_mobility_edges.csv"
    )

    origin_city = "Kochi"
    n_iterations = 128
    seed_infections = 500
    k_sensitivity = 35.0

    p = {
        "r0": (1.4, 2.25, 3.5),
        "inc": (2.0, 5.0, 14.0),
        "cfr": (0.005, 0.02, 0.05),
        "inf": (5.0, 7.0, 14.0)
    }

    def to_triang(u, low, mode, high):
        scale = high - low
        if scale == 0:
            return np.full_like(u, low)
        c = (mode - low) / scale
        return triang.ppf(u, c=c, loc=low, scale=scale)

    sampler = qmc.Sobol(d=4, scramble=True, seed=42)
    m = int(np.ceil(np.log2(n_iterations)))
    u_sobol = sampler.random_base2(m=m)[:n_iterations]

    r0_s = to_triang(u_sobol[:, 0], *p["r0"])
    inc_s = to_triang(u_sobol[:, 1], *p["inc"])
    cfr_s = to_triang(u_sobol[:, 2], *p["cfr"])
    inf_s = to_triang(u_sobol[:, 3], *p["inf"])

    total_pop = sum(CITIES[c]["pop"] for c in names)

    # Standard 4 + Custom Phased
    standard_interventions = ["none", "rail_only", "partial", "full"]
    phased_schedule = [
        {"from_day": 1, "to_day": 60, "intervention": "full"},
        {"from_day": 61, "to_day": 120, "intervention": "partial"},
        {"from_day": 121, "to_day": 180, "intervention": "none"}
    ]

    results = {}

    for inv in standard_interventions:
        print(f"  Simulating {inv}...", flush=True)
        ss = np.random.SeedSequence(42)
        seeds = ss.spawn(n_iterations)

        all_inf = np.zeros((n_iterations, N_DAYS))
        all_dth = np.zeros((n_iterations, N_DAYS))
        all_new = np.zeros((n_iterations, N_DAYS))
        all_city = np.zeros((n_iterations, N_DAYS, len(names)))

        for i in range(n_iterations):
            rng = np.random.default_rng(seeds[i])
            inf, dth, new_inf, city_act = run_mc_iteration(
                names, matrices, origin_city, inv,
                r0_s[i], inc_s[i], cfr_s[i], inf_s[i], rng,
                seed_infections=seed_infections,
                k_sensitivity=k_sensitivity
            )
            all_inf[i] = inf
            all_dth[i] = dth
            all_new[i] = new_inf
            all_city[i] = city_act

        results[inv] = {
            "inf": all_inf,
            "dth": all_dth,
            "new": all_new,
            "city": all_city
        }

    # Custom Phased
    print("  Simulating custom_phased...", flush=True)
    ss = np.random.SeedSequence(42)
    seeds = ss.spawn(n_iterations)

    all_inf = np.zeros((n_iterations, N_DAYS))
    all_dth = np.zeros((n_iterations, N_DAYS))
    all_new = np.zeros((n_iterations, N_DAYS))
    all_city = np.zeros((n_iterations, N_DAYS, len(names)))

    for i in range(n_iterations):
        rng = np.random.default_rng(seeds[i])
        inf, dth, new_inf, city_act = run_phased_mc_iteration(
            names, matrices, origin_city, phased_schedule,
            r0_s[i], inc_s[i], cfr_s[i], inf_s[i], rng,
            seed_infections=seed_infections,
            k_sensitivity=k_sensitivity
        )
        all_inf[i] = inf
        all_dth[i] = dth
        all_new[i] = new_inf
        all_city[i] = city_act

    results["custom_phased"] = {
        "inf": all_inf,
        "dth": all_dth,
        "new": all_new,
        "city": all_city
    }

    # Summary table
    print("\n" + "=" * 95)
    print("TABLE: NATIONAL EPIDEMIOLOGICAL METRICS (128-ITERATION SOBOL QMC)")
    print("Origin City: Kochi | Seed Infections: 500 | Days: 180")
    print("-" * 95)
    print(f"{'Intervention':<16} | {'Peak Day':<9} | {'Peak Active (P50)':<18} | {'Day 180 Active':<15} | {'Total Deaths':<14} | {'Attack Rate %'}")
    print("-" * 95)

    all_invs = ["none", "rail_only", "partial", "full", "custom_phased"]
    for inv in all_invs:
        inf_p50 = np.percentile(results[inv]["inf"], 50, axis=0)
        dth_p50 = np.percentile(results[inv]["dth"], 50, axis=0)
        new_cum = np.sum(results[inv]["new"], axis=1)  # cumulative per run
        new_cum_p50 = np.percentile(new_cum, 50)
        
        peak_day = int(np.argmax(inf_p50)) + 1
        peak_active = float(np.max(inf_p50))
        d180_active = float(inf_p50[-1])
        total_deaths = float(dth_p50[-1])
        attack_rate = (new_cum_p50 / total_pop) * 100

        print(f"{inv:<16} | Day {peak_day:<5} | {peak_active:>18,.0f} | {d180_active:>15,.1f} | {total_deaths:>14,.0f} | {attack_rate:>11.2f}%")
    print("=" * 95)

    # City-level Day 180 Active cases table
    print("\n" + "=" * 95)
    print("TABLE: CITY-LEVEL ACTIVE CASES AT DAY 180 (P50)")
    print("-" * 95)
    print(f"{'City':<15} | {'none':<13} | {'rail_only':<13} | {'partial':<13} | {'full':<13} | {'custom_phased':<13}")
    print("-" * 95)
    for c_idx, c_name in enumerate(names):
        vals = []
        for inv in all_invs:
            c_p50 = np.percentile(results[inv]["city"][:, 179, c_idx], 50)
            vals.append(c_p50)
        print(f"{c_name:<15} | {vals[0]:>13,.1f} | {vals[1]:>13,.1f} | {vals[2]:>13,.1f} | {vals[3]:>13,.1f} | {vals[4]:>13,.1f}")
    print("=" * 95)

if __name__ == "__main__":
    run_all_scenarios()
