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
    apply_ascertainment_correction
)

SCENARIO_ID  = "bb0ff20e-b086-411b-8054-91560b1e88ec"
INTERVENTION = "none"   # the blended historical run (unmitigated pre-56, suppressed post-56)
DATASET_NAME = "india_covid19_2020"
N_DAYS       = 90


def fetch_model_ensemble(supabase) -> np.ndarray:
    """
    Fetches seird_results rows for intervention='full', ordered by day.
    Returns shape (N_MC_ITERATIONS, N_DAYS) — one column per day, one row per MC run.
    Each day's new_infections_trajectory_sample is a list of 500 floats.
    """
    rows = (
        supabase.table("seird_results")
        .select("day, new_infections_trajectory_sample")
        .eq("scenario_id", SCENARIO_ID)
        .eq("intervention_type", INTERVENTION)
        .lte("day", N_DAYS)
        .order("day")
        .execute()
        .data
    )

    if not rows:
        raise RuntimeError(
            f"No seird_results rows found for scenario_id={SCENARIO_ID}, "
            f"intervention_type='{INTERVENTION}'. "
            "Re-run run_historical_simulation.py first."
        )

    if len(rows) != N_DAYS:
        raise RuntimeError(
            f"Expected {N_DAYS} seird_results rows, got {len(rows)}. "
            "Possible partial write — re-run run_historical_simulation.py."
        )

    # Verify new_infections_trajectory_sample column is populated
    sample = rows[0].get("new_infections_trajectory_sample")
    if sample is None:
        raise RuntimeError(
            "new_infections_trajectory_sample is NULL in seird_results. "
            "Run the migration (00007_add_new_infections_trajectory.sql) and "
            "re-run run_historical_simulation.py to populate it."
        )

    # Build (N_MC, N_DAYS) array
    # Each row's trajectory_sample is a list of N_MC floats
    n_mc = len(sample)
    ensemble = np.zeros((n_mc, N_DAYS))
    for row in rows:
        day_idx = row["day"] - 1   # day column is 1-indexed
        col = row["new_infections_trajectory_sample"]
        if len(col) != n_mc:
            raise RuntimeError(
                f"Day {row['day']} has {len(col)} MC samples, expected {n_mc}. "
                "Ensemble is inconsistent — re-run run_historical_simulation.py."
            )
        ensemble[:, day_idx] = col

    return ensemble


def fetch_observed_series(supabase) -> tuple[np.ndarray, list[dict]]:
    """
    Fetches historical_validation rows ordered by sim_day.
    Returns:
        observed: np.ndarray of shape (N_DAYS,), daily_new_cases values
        rows:     raw dicts, for printing context/milestones
    """
    rows = (
        supabase.table("historical_validation")
        .select("sim_day, calendar_date, daily_new_cases, phase, notes")
        .eq("dataset_name", DATASET_NAME)
        .order("sim_day")
        .execute()
        .data
    )

    if not rows:
        raise RuntimeError(
            f"No historical_validation rows found for dataset_name='{DATASET_NAME}'. "
            "Run insert_historical_validation.sql first."
        )

    if len(rows) != N_DAYS:
        raise RuntimeError(
            f"Expected {N_DAYS} historical_validation rows, got {len(rows)}. "
            "Re-run the seed SQL."
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
    print("=" * 60)
    print("Outbreak Response OS — CRPS Validation")
    print(f"Scenario : {SCENARIO_ID}")
    print(f"Model    : intervention_type='{INTERVENTION}' (blended historical)")
    print(f"Observed : {DATASET_NAME} / daily_new_cases")
    print("=" * 60)

    supabase = create_client(
        os.environ["SUPABASE_URL"],
        os.environ["SUPABASE_SERVICE_ROLE_KEY"],
    )

    # --- Fetch data ---
    print("\nFetching model ensemble from seird_results...")
    ensemble = fetch_model_ensemble(supabase)
    n_mc, n_days = ensemble.shape
    print(f"  Loaded: {n_mc} MC runs × {n_days} days")

    print("Fetching observed series from historical_validation...")
    observed, obs_rows = fetch_observed_series(supabase)
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

    # --- Results ---
    print("\n" + "=" * 60)
    print("CRPS Results")
    print("=" * 60)
    print(f"  Model CRPS (mean over 90 days) : {model_mean:>10.2f}")
    print(f"  Naive baseline CRPS (mean)     : {baseline_mean:>10.2f}")
    print(f"  CRPS Skill Score               : {skill_score:>10.4f}")
    print()

    if skill_score > 0.2:
        verdict = "GOOD — model meaningfully outperforms naive persistence."
    elif skill_score > 0:
        verdict = "MARGINAL — model slightly better than persistence."
    elif skill_score == 0:
        verdict = "NEUTRAL — model matches naive persistence exactly."
    else:
        verdict = (
            "POOR — model underperforms naive persistence. "
            "Likely cause: ascertainment bias in days 1–55 (confirmed cases << true infections) "
            "inflating early-phase CRPS. See unit caveat in file header."
        )
    print(f"  Verdict: {verdict}")

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
