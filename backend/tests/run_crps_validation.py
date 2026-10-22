"""
run_crps_validation.py — CRPS validation for the historical COVID scenario.

Compares the model's new_infections_trajectory_sample ensemble (500 MC runs ×
90 days) against historical_validation's daily_new_cases (real confirmed cases,
30 Jan – 28 Apr 2020).

Unit note:
    Model side:  new_infections_trajectory_sample = total_new_infections per day
                 (the S→E flow, summed nationally across all 15 cities per MC run)
    Observed:    daily_new_cases = daily confirmed new cases from covid19india.org

    These are the closest comparable quantities available. Known caveat: confirmed
    cases are an undercount of true infections due to testing ascertainment bias,
    especially days 1–55 (ICMR's restrictive early testing criteria). Expect the
    model to run higher than observed in early phases — this is correct behaviour,
    not a model defect. CRPS is scored as-is; the skill-score comparison against
    the naive baseline is more informative than the raw CRPS number.

Run:
    python run_crps_validation.py

Requires:
    SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env (same as the simulator).
"""

import os
import sys
import numpy as np
from supabase import create_client
from dotenv import load_dotenv

load_dotenv()

# Assumes crps_validator.py is in the same directory or on PYTHONPATH
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from crps_validator import (
    compute_crps, 
    compute_naive_baseline_crps,
    validate_crps_with_ascertainment,
    sweep_ascertainment_sensitivity,
    apply_ascertainment_correction,
    compare_all_baselines,
    compute_exp_growth_baseline_crps,
)

import argparse

DEFAULT_SCENARIO_ID  = "bb0ff20e-b086-411b-8054-91560b1e88ec"
DEFAULT_INTERVENTION = "none"   # the blended historical run (unmitigated pre-56, suppressed post-56)
DEFAULT_DATASET_NAME = "india_covid19_2020"
DEFAULT_N_DAYS       = 90


def fetch_model_ensemble(supabase, scenario_id: str, intervention: str, n_days: int) -> np.ndarray:
    """
    Fetches seird_results rows ordered by day.
    Returns shape (N_MC_ITERATIONS, n_days) — one column per day, one row per MC run.
    """
    rows = (
        supabase.table("seird_results")
        .select("day, new_infections_trajectory_sample")
        .eq("scenario_id", scenario_id)
        .eq("intervention_type", intervention)
        .lte("day", n_days)
        .order("day")
        .execute()
        .data
    )

    if not rows:
        raise RuntimeError(
            f"No seird_results rows found for scenario_id={scenario_id}, "
            f"intervention_type='{intervention}'. "
            "Please check scenario_id and intervention_type."
        )

    if len(rows) != n_days:
        raise RuntimeError(
            f"Expected {n_days} seird_results rows, got {len(rows)}. "
            "Possible partial write or simulation window mismatch."
        )

    # Verify new_infections_trajectory_sample column is populated
    sample = rows[0].get("new_infections_trajectory_sample")
    if sample is None:
        raise RuntimeError(
            "new_infections_trajectory_sample is NULL in seird_results. "
            "Run the migration (00007_add_new_infections_trajectory.sql) and "
            "re-run simulation to populate it."
        )

    # Build (N_MC, n_days) array
    n_mc = len(sample)
    ensemble = np.zeros((n_mc, n_days))
    for row in rows:
        day_idx = row["day"] - 1   # day column is 1-indexed
        col = row["new_infections_trajectory_sample"]
        if len(col) != n_mc:
            raise RuntimeError(
                f"Day {row['day']} has {len(col)} MC samples, expected {n_mc}. "
                "Ensemble is inconsistent."
            )
        ensemble[:, day_idx] = col

    return ensemble


def fetch_observed_series(supabase, dataset_name: str, n_days: int) -> tuple[np.ndarray, list[dict]]:
    """
    Fetches historical_validation rows ordered by sim_day.
    Returns:
        observed: np.ndarray of shape (n_days,), daily_new_cases values
        rows:     raw dicts, for printing context/milestones
    """
    rows = (
        supabase.table("historical_validation")
        .select("sim_day, calendar_date, daily_new_cases, phase, notes")
        .eq("dataset_name", dataset_name)
        .lte("sim_day", n_days)
        .order("sim_day")
        .execute()
        .data
    )

    if not rows:
        raise RuntimeError(
            f"No historical_validation rows found for dataset_name='{dataset_name}'. "
            "Check that the historical_validation table is seeded."
        )

    if len(rows) != n_days:
        raise RuntimeError(
            f"Expected {n_days} historical_validation rows, got {len(rows)}. "
            "Note: the dataset currently contains 90 days (Jan 30 - Apr 28, 2020)."
        )

    observed = np.array([r["daily_new_cases"] for r in rows], dtype=float)
    return observed, rows


def find_worst_days(
    crps_per_day: list[float],
    observed: np.ndarray,
    ensemble: np.ndarray,
    n: int = 3
) -> list[dict]:
    """Returns the N days with the largest per-day CRPS, with context."""
    indexed = sorted(enumerate(crps_per_day), key=lambda x: x[1], reverse=True)
    worst = []
    for day_idx, crps_val in indexed[:n]:
        mc_col = ensemble[:, day_idx]
        worst.append({
            "sim_day":        day_idx + 1,
            "crps":           round(crps_val, 2),
            "observed_cases": int(observed[day_idx]),
            "model_p10":      round(float(np.percentile(mc_col, 10)), 1),
            "model_p50":      round(float(np.percentile(mc_col, 50)), 1),
            "model_p90":      round(float(np.percentile(mc_col, 90)), 1),
        })
    return worst


def main():
    parser = argparse.ArgumentParser(description="CRPS Validator for Outbreak Simulation")
    parser.add_argument("--scenario-id", default=DEFAULT_SCENARIO_ID, help="Scenario UUID to validate")
    parser.add_argument("--intervention", default=DEFAULT_INTERVENTION, help="Intervention arm (none, rail_only, partial, full)")
    parser.add_argument("--dataset", default=DEFAULT_DATASET_NAME, help="Dataset name in historical_validation")
    parser.add_argument("--days", type=int, default=DEFAULT_N_DAYS, help="Number of days to evaluate (default 90)")
    args = parser.parse_args()

    scenario_id = args.scenario_id
    intervention = args.intervention
    dataset_name = args.dataset
    n_days = args.days

    print("=" * 60)
    print("Outbreak Response OS — CRPS Validation")
    print(f"Scenario : {scenario_id}")
    print(f"Model    : intervention_type='{intervention}'")
    print(f"Observed : {dataset_name} / daily_new_cases ({n_days} days)")
    print("=" * 60)

    supabase = create_client(
        os.environ["SUPABASE_URL"],
        os.environ["SUPABASE_SERVICE_ROLE_KEY"],
    )

    # --- Fetch data ---
    print("\nFetching model ensemble from seird_results...")
    ensemble = fetch_model_ensemble(supabase, scenario_id, intervention, n_days)
    n_mc, days_loaded = ensemble.shape
    print(f"  Loaded: {n_mc} MC runs × {days_loaded} days")

    print("Fetching observed series from historical_validation...")
    observed, obs_rows = fetch_observed_series(supabase, dataset_name, n_days)
    print(f"  Loaded: {len(observed)} days, total confirmed cases = {int(observed.sum()):,}")

    # --- Sanity check: print a few day-by-day comparisons ---
    print("\n--- Quick sanity check (days 33, 55, 56, 70, 90) ---")
    check_days = [33, 55, 56, 70, 90]
    print(f"{'Day':<6} {'Observed':>10} {'Model P50':>12} {'Model P10':>12} {'Model P90':>12}")
    for d in check_days:
        if d > n_days:
            continue
        idx = d - 1
        mc_col = ensemble[:, idx]
        print(
            f"{d:<6} {int(observed[idx]):>10,} "
            f"{np.percentile(mc_col, 50):>12.1f} "
            f"{np.percentile(mc_col, 10):>12.1f} "
            f"{np.percentile(mc_col, 90):>12.1f}"
        )

    # --- CRPS scoring ---
    print("\nComputing model CRPS...")
    # crps_validator.compute_crps expects (list of trajectories, observed)
    # ensemble rows are MC runs, columns are days → pass as list of N_MC lists
    model_result = compute_crps(ensemble.tolist(), observed.tolist())

    print("Computing naive-persistence baseline CRPS...")
    baseline_result = compute_naive_baseline_crps(observed.tolist())

    model_mean    = model_result["crps_mean"]
    baseline_mean = baseline_result["crps_mean"]
    skill_score   = 1.0 - (model_mean / baseline_mean) if baseline_mean > 0 else 0.0

    # --- Results: Three-Baseline Comparison (reviewer item 2) ---
    print("\n" + "=" * 70)
    print("CRPS Results — Three-Baseline Comparison")
    print("=" * 70)
    all_baselines = compare_all_baselines(ensemble.tolist(), observed.tolist())
    lam   = all_baselines["exp_growth_rate_lambda"]
    t_dbl = all_baselines["exp_doubling_time"]
    print(f"  Exponential-growth fit: lambda={lam:.4f}/day, doubling time={t_dbl:.1f} days")
    print()
    print(f"  {'Baseline':<35} | {'Mean CRPS':>10} | {'Skill Score':>12}")
    print(f"  {'-'*63}")
    print(f"  {'Model (SEIRD-b QMC)':<35} | {all_baselines['model_crps_mean']:>10.2f} | {'[reference]':>12}")
    print(f"  {'Naive persistence':<35} | {all_baselines['naive_baseline_mean']:>10.2f} | {all_baselines['skill_vs_naive']:>12.4f}")
    print(f"  {'Exponential growth (14-day fit)':<35} | {all_baselines['exp_growth_baseline_mean']:>10.2f} | {all_baselines['skill_vs_exp_growth']:>12.4f}")
    print()
    print("  Interpretation:")
    print("    skill_vs_naive > 0  -> model outperforms day-to-day persistence")
    print("    skill_vs_exp > 0    -> model outperforms exponential-growth projection")
    print("    skill_vs_exp < 0    -> model WORSE than a simple exponential fit (flag for revision)")
    print()

    # Legacy single-baseline output for backward compatibility
    model_mean    = all_baselines["model_crps_mean"]
    baseline_mean = all_baselines["naive_baseline_mean"]
    skill_score   = all_baselines["skill_vs_naive"]

    if skill_score > 0.2:
        verdict = "GOOD — model meaningfully outperforms naive persistence."
    elif skill_score > 0:
        verdict = "MARGINAL — model slightly better than persistence."
    elif skill_score == 0:
        verdict = "NEUTRAL — model matches naive persistence exactly."
    else:
        verdict = (
            "POOR — model underperforms naive persistence. "
            "Likely cause: ascertainment bias in days 1-55 (confirmed cases << true infections) "
            "inflating early-phase CRPS. See unit caveat in file header."
        )
    print(f"  Verdict vs persistence: {verdict}")

    # --- Worst days ---
    print("\n--- 3 Days with Largest CRPS (highest divergence) ---")
    worst = find_worst_days(model_result["crps_per_day"], observed, ensemble, n=3)
    print(f"{'Day':<6} {'CRPS':>8} {'Observed':>10} {'Model P10':>12} {'Model P50':>12} {'Model P90':>12}")
    for w in worst:
        print(
            f"{w['sim_day']:<6} {w['crps']:>8.1f} {w['observed_cases']:>10,} "
            f"{w['model_p10']:>12.1f} {w['model_p50']:>12.1f} {w['model_p90']:>12.1f}"
        )

    # --- Per-phase breakdown ---
    print("\n--- CRPS by Phase ---")
    phase_ranges = {
        "importation / silent (days 1–32)":      (0,  32),
        "exponential liftoff (days 33–55)":      (32, 55),
        "lockdown lag (days 56–90)":             (55, 90),
    }
    crps_per_day = model_result["crps_per_day"]
    for label, (start, end) in phase_ranges.items():
        phase_crps = np.mean(crps_per_day[start:end])
        print(f"  {label:<42} : {phase_crps:.2f}")

    print("\nNote: model new_infections >> observed daily_new_cases in early phases")
    print("due to ICMR testing ascertainment bias. This inflates CRPS in days 1–55.")
    print("Directional validation (intervention divergence) is more meaningful than")
    print("absolute CRPS here — see handoff notes, Section 'known accepted limitation'.")
    print()

    # --- ASCERTAINMENT-CORRECTED RESULTS ---
    print("\n" + "=" * 60)
    print("ASCERTAINMENT-CORRECTED CRPS RESULTS")
    print("=" * 60)
    print("Correction applied: true infections scaled down to expected confirmed cases.")
    print("Based on published literature (Bhaduri et al., Srinivas & James), this accounts")
    print("for severe testing ascertainment bias in early 2020.")
    print()

    corrected_res = validate_crps_with_ascertainment(ensemble.tolist(), observed.tolist())
    c_model_mean = corrected_res["model"]["crps_mean"]
    c_baseline_mean = corrected_res["naive_baseline"]["crps_mean"]
    c_skill_score = corrected_res["skill_score"]

    print(f"  Corrected Model CRPS (mean)    : {c_model_mean:>10.2f}")
    print(f"  Naive baseline CRPS (mean)     : {c_baseline_mean:>10.2f}")
    print(f"  Corrected Skill Score          : {c_skill_score:>10.4f}")
    print()

    print("--- Sensitivity Sweep (9 Parameter Combinations) ---")
    print(f"{'Early %':<10} {'Start %':<10} {'End %':<10} {'Mod CRPS':<10} {'Bas CRPS':<10} {'Skill Score':<10}")
    sweep = sweep_ascertainment_sensitivity(ensemble.tolist(), observed.tolist())
    all_positive = all(s['skill_score'] > 0 for s in sweep)
    any_positive = any(s['skill_score'] > 0 for s in sweep)
    
    for s in sweep:
        print(
            f"{s['early_rate']*100:<9.1f}% "
            f"{s['ramp_start_rate']*100:<9.1f}% "
            f"{s['ramp_end_rate']*100:<9.1f}% "
            f"{s['model_crps']:<10.2f} "
            f"{s['baseline_crps']:<10.2f} "
            f"{s['skill_score']:<10.4f}"
        )

    print("\n--- Corrected CRPS by Phase ---")
    c_crps_per_day = corrected_res["model"]["crps_per_day"]
    for label, (start, end) in phase_ranges.items():
        phase_crps = np.mean(c_crps_per_day[start:end])
        print(f"  {label:<42} : {phase_crps:.2f}")

    print("\n--- 3 Days with Largest Corrected CRPS (highest divergence) ---")
    
    corr_ens, _ = apply_ascertainment_correction(ensemble.tolist())
    corr_ens_arr = np.array(corr_ens)
    c_worst = find_worst_days(c_crps_per_day, observed, corr_ens_arr, n=3)
    print(f"{'Day':<6} {'CRPS':>8} {'Observed':>10} {'Model P10':>12} {'Model P50':>12} {'Model P90':>12}")
    for w in c_worst:
        print(
            f"{w['sim_day']:<6} {w['crps']:>8.1f} {w['observed_cases']:>10,} "
            f"{w['model_p10']:>12.1f} {w['model_p50']:>12.1f} {w['model_p90']:>12.1f}"
        )
        
    print("\n  Verdict: ", end="")
    if all_positive:
        print("Skill score > 0 across the full sensitivity range. Model strongly outperforms baseline.")
    elif any_positive:
        print("Skill score > 0 only at generous ascertainment assumptions. Model marginally outperforms baseline.")
    else:
        print("Skill score never crosses 0. Model continues to underperform naive persistence.")
    print()


if __name__ == "__main__":
    main()
