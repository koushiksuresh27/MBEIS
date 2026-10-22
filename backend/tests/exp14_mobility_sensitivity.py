"""
exp14_mobility_sensitivity.py — Mobility Assumption Sensitivity Analysis (v2)

Reviewer-driven upgrades (batch Step-245 review):
  - Wider perturbation range: x0.5 and x2.0 (was +-20%)
  - Multiple seeds per perturbation: 3 independent seeds -> variance estimate
  - Per-city ranking table (all 15 cities) to support the "ranks are stable" claim
  - Connectivity centrality for the 15-city graph (degree, strength, betweenness)
"""

import os
import sys
import copy
import numpy as np
from scipy.stats import qmc, triang

sys.path.insert(0, os.path.abspath("."))
from backend.simulator.seird_engine import (
    build_composite_matrix,
    run_mc_iteration,
    CITIES,
    N_DAYS,
    apply_intervention,
)

# -- Configuration ------------------------------------------------------------
N_ITERATIONS    = 128       # Sobol draws per seed
N_SEEDS         = 3         # Independent seeds for variance estimation
BASE_SEEDS      = [42, 137, 2718]  # Reproducible but independent seeds
EVAL_DAY        = N_DAYS - 1      # index for last day (0-indexed)

PERTURB_FACTORS = [
    (0.50, "x0.5"),
    (0.80, "x0.8"),
    (1.20, "x1.2"),
    (2.00, "x2.0"),
]

FLOORED_PAIRS = [
    ("DELHI", "BENGALURU"), ("BENGALURU", "DELHI"),
    ("DELHI", "CHENNAI"),   ("CHENNAI", "DELHI"),
    ("DELHI", "HYDERABAD"), ("HYDERABAD", "DELHI"),
    ("MUMBAI", "BENGALURU"),("BENGALURU", "MUMBAI"),
    ("MUMBAI", "CHENNAI"),  ("CHENNAI", "MUMBAI"),
]


# -- Core simulation evaluation -----------------------------------------------
def run_simulation_eval(names, matrices, origin_city="Kochi",
                        intervention="none", seed=42, n_iterations=N_ITERATIONS):
    """
    Runs n_iterations Sobol QMC draws and returns:
      - national_p50   : float  -- national active cases at eval day (P50)
      - city_p50       : array  -- per-city active at eval day (P50)
      - ranking        : list   -- city names sorted descending by city_p50
    """
    p = {
        "r0":  (1.4,  2.25, 3.5),
        "inc": (2.0,  5.0,  14.0),
        "cfr": (0.005, 0.02, 0.05),
        "inf": (5.0,  7.0,  14.0),
    }

    def to_triang(u, low, mode, high):
        scale = high - low
        if scale == 0:
            return np.full_like(u, low)
        c = (mode - low) / scale
        return triang.ppf(u, c=c, loc=low, scale=scale)

    sampler = qmc.Sobol(d=4, scramble=True, seed=seed)
    m = int(np.ceil(np.log2(n_iterations)))
    u = sampler.random_base2(m=m)[:n_iterations]

    r0_s  = to_triang(u[:, 0], *p["r0"])
    inc_s = to_triang(u[:, 1], *p["inc"])
    cfr_s = to_triang(u[:, 2], *p["cfr"])
    inf_s = to_triang(u[:, 3], *p["inf"])

    ss = np.random.SeedSequence(seed)
    rng_seeds = ss.spawn(n_iterations)

    nat_vals  = np.zeros(n_iterations)
    city_vals = np.zeros((n_iterations, len(names)))

    for i in range(n_iterations):
        rng = np.random.default_rng(rng_seeds[i])
        inf, dth, new_inf, city_act = run_mc_iteration(
            names, matrices, origin_city, intervention,
            r0_s[i], inc_s[i], cfr_s[i], inf_s[i], rng,
            seed_infections=500
        )
        nat_vals[i]     = inf[EVAL_DAY]
        city_vals[i, :] = city_act[EVAL_DAY, :]

    nat_p50  = float(np.percentile(nat_vals, 50))
    city_p50 = np.percentile(city_vals, 50, axis=0)
    ranking  = [names[idx] for idx in np.argsort(-city_p50)]
    return nat_p50, city_p50, ranking


def run_multi_seed(names, matrices, origin_city="Kochi", intervention="none"):
    """Runs across N_SEEDS and returns (mean_nat_p50, std_nat_p50, city_p50_arr, rankings)."""
    nat_vals   = []
    city_arrs  = []
    rankings   = []
    for seed in BASE_SEEDS:
        nat, city, rank = run_simulation_eval(names, matrices, origin_city, intervention, seed)
        nat_vals.append(nat)
        city_arrs.append(city)
        rankings.append(rank)
    nat_mean = float(np.mean(nat_vals))
    nat_std  = float(np.std(nat_vals))
    city_p50 = np.mean(city_arrs, axis=0)
    return nat_mean, nat_std, city_p50, rankings


# -- Connectivity centrality --------------------------------------------------
def compute_centrality(names, matrices):
    """
    Computes node-level centrality metrics from the baseline blended mobility matrix.
    Uses the none-intervention blended matrix (full mobility).
    """
    W = apply_intervention(matrices, "none")
    degree_in    = np.sum(W > 0, axis=0).astype(float)
    degree_out   = np.sum(W > 0, axis=1).astype(float)
    strength_in  = W.sum(axis=0)
    strength_out = W.sum(axis=1)
    total_flow   = W.sum()
    betweenness_proxy = (strength_in + strength_out) / (2 * total_flow + 1e-9)
    return {
        "degree_in":     degree_in,
        "degree_out":    degree_out,
        "strength_in":   strength_in,
        "strength_out":  strength_out,
        "betweenness":   betweenness_proxy,
    }


# -- Perturbation helpers -----------------------------------------------------
def _perturb_floored_rail(mat, names, factor):
    n2i = mat["name_to_idx"]
    for src, tgt in FLOORED_PAIRS:
        if src in n2i and tgt in n2i:
            mat["raw"]["rail"][n2i[src], n2i[tgt]] *= factor

def _perturb_all_rail(mat, factor):
    mat["raw"]["rail"] = mat["raw"]["rail"] * factor

def _perturb_mum_pune_road(mat, names, factor):
    n2i = mat["name_to_idx"]
    if "MUMBAI" in n2i and "PUNE" in n2i:
        mat["raw"]["road"][n2i["MUMBAI"], n2i["PUNE"]] *= factor
        mat["raw"]["road"][n2i["PUNE"], n2i["MUMBAI"]] *= factor

def _perturb_all_road(mat, factor):
    mat["raw"]["road"] = mat["raw"]["road"] * factor


# -- Main experiment ----------------------------------------------------------
def run_exp14():
    print("=" * 90)
    print("Experiment 14 v2: Mobility Graph Sensitivity - Wide Range, Multi-Seed, Centrality")
    print("=" * 90)

    names, base_matrices = build_composite_matrix(
        meta_edges_path="backend/simulator/meta_mobility_edges.csv",
        dgca_path="backend/simulator/dgca_annual_weights.csv",
        irctc_path="backend/simulator/irctc_mobility_edges.csv"
    )

    # Baseline (multi-seed)
    print(f"\n[1/4] Running baseline (Day-{N_DAYS} = index {EVAL_DAY}, {N_SEEDS} seeds x {N_ITERATIONS} iterations)...")
    base_nat_mean, base_nat_std, base_city_p50, base_rankings = run_multi_seed(names, base_matrices)
    base_rank = [names[idx] for idx in np.argsort(-base_city_p50)]
    print(f"  Baseline Day-{N_DAYS} National P50: {base_nat_mean:,.1f} +/- {base_nat_std:,.1f}")
    print(f"  Baseline Top-5: {', '.join(base_rank[:5])}")

    # Perturbation configurations
    perturb_configs = [
        {
            "label": "5 Floored Rail Corridors",
            "fn": lambda mat, fac: _perturb_floored_rail(mat, names, fac),
        },
        {
            "label": "All Rail Capacity",
            "fn": lambda mat, fac: _perturb_all_rail(mat, fac),
        },
        {
            "label": "Mumbai-Pune Road Anchor",
            "fn": lambda mat, fac: _perturb_mum_pune_road(mat, names, fac),
        },
        {
            "label": "All Road Layer",
            "fn": lambda mat, fac: _perturb_all_road(mat, fac),
        },
    ]

    print(f"\n[2/4] Running perturbations ({len(PERTURB_FACTORS)} factors x {len(perturb_configs)} configs x {N_SEEDS} seeds)...")
    results = []
    for cfg in perturb_configs:
        for factor, flabel in PERTURB_FACTORS:
            mat = copy.deepcopy(base_matrices)
            cfg["fn"](mat, factor)
            nat_mean, nat_std, city_p50, rankings = run_multi_seed(names, mat)
            shift = ((nat_mean - base_nat_mean) / (base_nat_mean + 1e-9)) * 100

            # Average rank displacements across seeds
            rank_shifts_per_seed = [
                sum(r != b for r, b in zip(rankings[s], base_rankings[s]))
                for s in range(N_SEEDS)
            ]
            avg_rank_shifts = float(np.mean(rank_shifts_per_seed))

            results.append({
                "param":           f"{cfg['label']} ({flabel})",
                "label":           cfg["label"],
                "factor_label":    flabel,
                "nat_mean":        nat_mean,
                "nat_std":         nat_std,
                "shift_pct":       shift,
                "avg_rank_shifts": avg_rank_shifts,
                "city_p50":        city_p50,
                "rankings":        rankings,
            })
            print(f"    {cfg['label']:30s} {flabel}: P50={nat_mean:,.0f} shift={shift:+.1f}% rank_shifts={avg_rank_shifts:.1f}/15")

    # National summary table
    print("\n" + "=" * 100)
    print(f"{'Perturbation':<43} | {'Day-'+str(N_DAYS)+' P50':<15} | {'Std':<12} | {'% Change':<10} | {'Avg Rank Shifts'}")
    print("-" * 100)
    print(f"{'Baseline':<43} | {base_nat_mean:>15,.1f} | {base_nat_std:>12,.1f} | {'0.0%':>10} | {'0.0 / 15'}")
    for r in results:
        print(f"{r['param']:<43} | {r['nat_mean']:>15,.1f} | {r['nat_std']:>12,.1f} | {r['shift_pct']:>+9.2f}% | {r['avg_rank_shifts']:.1f} / 15")
    print("=" * 100)

    # Per-city ranking table (baseline rank x perturbation)
    print("\n[3/4] Per-city ranking table (Baseline rank, then % change per perturbation):")
    # Show one row per city, columns are perturbations (just ×0.5 and ×2 for brevity)
    extreme_results = [r for r in results if r["factor_label"] in ("x0.5", "x2.0")]
    header_cols = " | ".join(f"{r['param'][:20]:<20}" for r in extreme_results)
    print(f"  {'Rank':<5} | {'City':<18} | {'Base P50':>10} | {header_cols}")
    print("  " + "-" * (60 + 25 * len(extreme_results)))
    for rank_pos, city in enumerate(base_rank, 1):
        city_idx = names.index(city)
        base_v   = base_city_p50[city_idx]
        col_vals = []
        for r in extreme_results:
            pct = ((r["city_p50"][city_idx] - base_v) / (base_v + 1e-9)) * 100
            col_vals.append(f"{pct:>+6.1f}% ({r['city_p50'][city_idx]:>8,.0f})")
        col_str = " | ".join(f"{v:<20}" for v in col_vals)
        print(f"  {rank_pos:>4} | {city:<18} | {base_v:>10,.0f} | {col_str}")

    # Rank stability summary
    print("\n  Rank stability (% of 15 cities keeping same position across seeds):")
    for r in results:
        stab = (15 - r["avg_rank_shifts"]) / 15 * 100
        print(f"    {r['param']:<43}: {stab:.1f}% stable")

    # Centrality analysis
    print("\n[4/4] Connectivity Centrality for 15-city mobility graph (baseline blended matrix):")
    centrality = compute_centrality(names, base_matrices)
    cent_rank  = np.argsort(-centrality["betweenness"])

    print(f"\n  {'City':<18} | {'Deg-In':>7} | {'Deg-Out':>8} | {'Str-In':>12} | {'Str-Out':>12} | {'Betw.Proxy':>12}")
    print("  " + "-" * 78)
    for idx in cent_rank:
        city = names[idx]
        print(
            f"  {city:<18} | {centrality['degree_in'][idx]:>7.0f} | "
            f"{centrality['degree_out'][idx]:>8.0f} | "
            f"{centrality['strength_in'][idx]:>12,.0f} | "
            f"{centrality['strength_out'][idx]:>12,.0f} | "
            f"{centrality['betweenness'][idx]:>12.4f}"
        )

    hub_threshold = np.percentile(centrality["betweenness"], 75)
    hubs = [names[i] for i in cent_rank if centrality["betweenness"][i] >= hub_threshold]
    print(f"\n  Hub nodes (top quartile by betweenness proxy, n={len(hubs)}): {', '.join(hubs)}")
    if len(hubs) == 4:
        print("  -> Supports 'four hub nodes' claim in paper.")
    else:
        print(f"  -> Paper claims 'four hub nodes' but centrality finds {len(hubs)} hub(s). Revise claim.")

    print("\n[DONE] Experiment 14 v2 complete.")


if __name__ == "__main__":
    run_exp14()
