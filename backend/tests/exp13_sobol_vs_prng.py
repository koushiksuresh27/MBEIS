import os
import sys
import numpy as np
from scipy.stats import qmc, triang

# Add backend to path
sys.path.insert(0, os.path.abspath("."))
from backend.simulator.seird_engine import (
    build_composite_matrix,
    run_mc_iteration,
    CITIES,
    N_DAYS
)

def run_exp13():
    names, matrices = build_composite_matrix(
        meta_edges_path="backend/simulator/meta_mobility_edges.csv",
        dgca_path="backend/simulator/dgca_annual_weights.csv",
        irctc_path="backend/simulator/irctc_mobility_edges.csv"
    )

    origin_city = "Kochi"
    intervention = "none"  # baseline unmitigated or standard
    n_iterations = 128
    n_repetitions = 30

    # Pathogen profile ranges (COVID-19 baseline)
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

    sobol_p50_list = []
    sobol_p90_list = []
    prng_p50_list = []
    prng_p90_list = []

    print(f"Running Experiment 13: {n_repetitions} repetitions of {n_iterations} iterations...")

    for rep in range(n_repetitions):
        # 1. Sobol QMC
        sampler = qmc.Sobol(d=4, scramble=True, seed=1000 + rep)
        m = int(np.ceil(np.log2(n_iterations)))
        u_sobol = sampler.random_base2(m=m)[:n_iterations]

        r0_s = to_triang(u_sobol[:, 0], *p["r0"])
        inc_s = to_triang(u_sobol[:, 1], *p["inc"])
        cfr_s = to_triang(u_sobol[:, 2], *p["cfr"])
        inf_s = to_triang(u_sobol[:, 3], *p["inf"])

        # SeedSequence for stochastic transitions within iterations
        ss_sobol = np.random.SeedSequence(2000 + rep)
        seeds_sobol = ss_sobol.spawn(n_iterations)

        d180_sobol = np.zeros(n_iterations)
        for i in range(n_iterations):
            rng = np.random.default_rng(seeds_sobol[i])
            inf, dth, new_inf, city_act = run_mc_iteration(
                names, matrices, origin_city, intervention,
                r0_s[i], inc_s[i], cfr_s[i], inf_s[i], rng,
                seed_infections=500
            )
            d180_sobol[i] = inf[179]

        sobol_p50_list.append(np.percentile(d180_sobol, 50))
        sobol_p90_list.append(np.percentile(d180_sobol, 90))

        # 2. Pseudo-Random (PRNG)
        rng_prng = np.random.default_rng(3000 + rep)
        u_prng = rng_prng.uniform(0.0, 1.0, size=(n_iterations, 4))

        r0_p = to_triang(u_prng[:, 0], *p["r0"])
        inc_p = to_triang(u_prng[:, 1], *p["inc"])
        cfr_p = to_triang(u_prng[:, 2], *p["cfr"])
        inf_p = to_triang(u_prng[:, 3], *p["inf"])

        ss_prng = np.random.SeedSequence(4000 + rep)
        seeds_prng = ss_prng.spawn(n_iterations)

        d180_prng = np.zeros(n_iterations)
        for i in range(n_iterations):
            rng = np.random.default_rng(seeds_prng[i])
            inf, dth, new_inf, city_act = run_mc_iteration(
                names, matrices, origin_city, intervention,
                r0_p[i], inc_p[i], cfr_p[i], inf_p[i], rng,
                seed_infections=500
            )
            d180_prng[i] = inf[179]

        prng_p50_list.append(np.percentile(d180_prng, 50))
        prng_p90_list.append(np.percentile(d180_prng, 90))

        if (rep + 1) % 5 == 0:
            print(f"  Repetition {rep+1}/{n_repetitions} completed.")

    # Calculate statistics
    sobol_p50_std = np.std(sobol_p50_list, ddof=1)
    sobol_p90_std = np.std(sobol_p90_list, ddof=1)
    prng_p50_std = np.std(prng_p50_list, ddof=1)
    prng_p90_std = np.std(prng_p90_list, ddof=1)

    sobol_p50_mean = np.mean(sobol_p50_list)
    sobol_p90_mean = np.mean(sobol_p90_list)
    prng_p50_mean = np.mean(prng_p50_list)
    prng_p90_mean = np.mean(prng_p90_list)

    print("\n" + "=" * 60)
    print("EXPERIMENT 13: SOBOL QMC VS. PSEUDO-RANDOM CONVERGENCE")
    print(f"Across {n_repetitions} repetitions of {n_iterations} samples each (Day 180 National Active Cases):")
    print("-" * 60)
    print(f"{'Method':<16} | {'P50 Mean':<12} | {'P50 Std Dev':<14} | {'P90 Mean':<12} | {'P90 Std Dev':<14}")
    print("-" * 60)
    print(f"{'Sobol QMC':<16} | {sobol_p50_mean:>12,.1f} | {sobol_p50_std:>14,.1f} | {sobol_p90_mean:>12,.1f} | {sobol_p90_std:>14,.1f}")
    print(f"{'Pseudo-random':<16} | {prng_p50_mean:>12,.1f} | {prng_p50_std:>14,.1f} | {prng_p90_mean:>12,.1f} | {prng_p90_std:>14,.1f}")
    print("-" * 60)
    var_red_p50 = (1.0 - (sobol_p50_std**2 / prng_p50_std**2)) * 100
    var_red_p90 = (1.0 - (sobol_p90_std**2 / prng_p90_std**2)) * 100
    print(f"Variance Reduction (P50): {var_red_p50:.1f}%")
    print(f"Variance Reduction (P90): {var_red_p90:.1f}%")
    print(f"Std Dev Ratio (PRNG / Sobol) for P50: {prng_p50_std / sobol_p50_std:.2f}x")
    print(f"Std Dev Ratio (PRNG / Sobol) for P90: {prng_p90_std / sobol_p90_std:.2f}x")
    print("=" * 60)

if __name__ == "__main__":
    run_exp13()
