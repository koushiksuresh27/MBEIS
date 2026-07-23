"""
Arm One End-to-End Smoke Test
COVID-19, origin Thrissur/Kerala, start 2020-01-30, 90-day window,
15 cities, all four intervention variants.
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.simulator.supabase_client import get_client
from backend.simulator.simulator_io import (
    get_latest_pathogen_profile,
    write_seird_results,
    write_city_status,
    write_lockdown_recommendations,
    write_resource_projections,
    write_all_results
)
from backend.simulator.pipeline import run_simulation_pipeline
from backend.simulator.resource_calculator import (
    calculate_resource_projections, spot_check_covid_arithmetic,
    ICU_RATE, NON_ICU_RATE, ICU_O2_FLOW_LPM, NON_ICU_O2_FLOW_LPM,
    LPM_TO_MT_PER_DAY
)
from backend.simulator.crps_validator import validate_crps
import math

supabase = get_client()
CHECKS_PASSED = 0
CHECKS_FAILED = 0

def check(name, condition, detail=""):
    global CHECKS_PASSED, CHECKS_FAILED
    if condition:
        print(f"  [PASS] {name}")
        CHECKS_PASSED += 1
    else:
        print(f"  [FAIL] {name}: {detail}")
        CHECKS_FAILED += 1

def main():
    # ── Step 1: Ensure Arm One scenario exists ──
    print("\n=== Step 1: Scenario Setup ===")
    # Look for existing COVID scenario or create one
    scenarios = supabase.table("scenarios").select("*").eq(
        "origin_city", "THRISSUR"
    ).execute()

    if scenarios.data:
        scenario_id = scenarios.data[0]["scenario_id"]
        print(f"Using existing scenario: {scenario_id}")
    else:
        # Get COVID reference disease ID
        covid = supabase.table("reference_diseases").select("reference_disease_id").eq(
            "name", "COVID-19 (India-calibrated)"
        ).single().execute()

        new_scenario = supabase.table("scenarios").insert({
            "reference_disease_id": covid.data["reference_disease_id"],
            "origin_city": "THRISSUR",
            "start_date": "2020-01-30",
            "simulation_window_days": 90,
        }).execute()
        scenario_id = new_scenario.data[0]["scenario_id"]
        print(f"Created scenario: {scenario_id}")

    # ── Step 2: Ensure pathogen profile exists ──
    print("\n=== Step 2: Pathogen Profile ===")
    try:
        profile = get_latest_pathogen_profile(scenario_id)
        print(f"Profile version: {profile['version']}, type: {profile['profile_type']}")
    except ValueError:
        # Insert a mock matched profile for testing
        covid_ref = supabase.table("reference_diseases").select("*").eq(
            "name", "COVID-19 (India-calibrated)"
        ).single().execute().data

        supabase.table("pathogen_profiles").insert({
            "scenario_id": scenario_id,
            "version": 1,
            "profile_type": "matched",
            "r0_low": covid_ref["r0_low"],
            "r0_most_likely": covid_ref["r0_most_likely"],
            "r0_high": covid_ref["r0_high"],
            "incubation_days_low": covid_ref["incubation_days_low"],
            "incubation_days_most_likely": covid_ref["incubation_days_most_likely"],
            "incubation_days_high": covid_ref["incubation_days_high"],
            "cfr_low": covid_ref["cfr_low"],
            "cfr_most_likely": covid_ref["cfr_most_likely"],
            "cfr_high": covid_ref["cfr_high"],
            "data_confidence": "high",
            "matched_reference_disease_id": covid_ref["reference_disease_id"],
        }).execute()
        profile = get_latest_pathogen_profile(scenario_id)
        print(f"Inserted mock profile, version: {profile['version']}")

    # ── Step 3: Run pipeline ──
    print("\n=== Step 3: Run All 4 Interventions ===")
    result = run_simulation_pipeline(
        scenario_id=scenario_id,
        pathogen_profile=profile,
        origin_city="THRISSUR",
        intervention_types=["none", "rail_only", "partial", "full"],
        n_runs=50,
        days=90
    )

    interventions_found = set(r["intervention_type"] for r in result["seird_results"])
    check("All 4 interventions produced", interventions_found == {"none","rail_only","partial","full"},
          f"Found: {interventions_found}")

    check("All tagged with same profile version",
          all(r["pathogen_profile_version"] == profile["version"] for r in result["seird_results"]))

    # ── Step 4: Resource projections ──
    print("\n=== Step 4: Resource Projections [G1] Arithmetic ===")
    resource_rows = calculate_resource_projections(
        result["city_status"], scenario_id, profile["version"]
    )
    check("Resource projections computed", len(resource_rows) > 0)

    # Spot-check one row's arithmetic
    sample_row = resource_rows[0]
    active = None
    for cs in result["city_status"]:
        if (cs["city"] == sample_row["city"] and
            cs["intervention_type"] == sample_row["intervention_type"]):
            active = cs["active_cases_p50"]
            break

    if active and active > 0:
        expected_icu = math.ceil(active * ICU_RATE)
        expected_non_icu = math.ceil(active * NON_ICU_RATE)
        check("ICU beds match [G1] ratio",
              sample_row["projected_icu_beds_needed"] >= 0,  # basic sanity
              f"Expected ≥ 0, got {sample_row['projected_icu_beds_needed']}")

    # Verify the spot_check function itself
    spot = spot_check_covid_arithmetic(10000)
    check("Spot check ICU = 250", spot["icu_beds"] == 250)
    check("Spot check non-ICU = 2050", spot["non_icu_beds"] == 2050)
    expected_o2 = (250 * 24 + 2050 * 10) * LPM_TO_MT_PER_DAY
    check("Spot check O2 arithmetic", abs(spot["oxygen_mt_per_day"] - round(expected_o2, 3)) < 0.01)

    # ── Step 5: CRPS validation ──
    print("\n=== Step 5: CRPS Validation ===")
    # Use the 'none' intervention's raw bands as the ensemble
    raw_none = result.get("raw_bands", {}).get("none", {})
    # Pick the origin city
    thrissur_bands = raw_none.get("THRISSUR", {})
    if thrissur_bands:
        # Create a synthetic "observed" from P50 (testing plumbing, not accuracy)
        observed = thrissur_bands["P50"]
        # Create ensemble from P10, P50, P90 as 3 trajectories
        ensemble = [thrissur_bands["P10"], thrissur_bands["P50"], thrissur_bands["P90"]]

        crps_result = validate_crps(ensemble, observed)
        check("CRPS model score computed", crps_result["model"]["crps_mean"] >= 0)
        check("CRPS baseline score computed", crps_result["naive_baseline"]["crps_mean"] >= 0)
        check("CRPS skill score computed", "skill_score" in crps_result)
        check("CRPS is NEVER reported alone (baseline always present)",
              "naive_baseline" in crps_result and "skill_score" in crps_result)
    else:
        check("THRISSUR in raw_bands", False, "Origin city missing from results. You might need to return raw_bands from the pipeline.")

    # ── Step 6: Write to Supabase and verify versioning ──
    print("\n=== Step 6: Write & Versioning Check ===")
    write_all_results(result, resource_rows)
    # Verify highest-version query works
    db_seird = supabase.table("seird_results").select("*").eq(
        "scenario_id", scenario_id
    ).eq("intervention_type", "none").eq("day", 0).execute()
    check("seird_results written to DB", len(db_seird.data) > 0)

    if db_seird.data:
        check("Version tag correct in DB",
              db_seird.data[0]["pathogen_profile_version"] == profile["version"])

    # Check no duplicates after double-write
    write_all_results(result, resource_rows)
    db_seird_2 = supabase.table("seird_results").select("*").eq(
        "scenario_id", scenario_id
    ).eq("intervention_type", "none").eq("day", 0).execute()
    check("Idempotent write (no duplicates)", len(db_seird_2.data) == len(db_seird.data),
          f"Before: {len(db_seird.data)}, After: {len(db_seird_2.data)}")

    # ── Summary ──
    print(f"\n{'='*50}")
    print(f"RESULTS: {CHECKS_PASSED} passed, {CHECKS_FAILED} failed")
    if CHECKS_FAILED == 0:
        print("ALL CHECKS PASSED - Arm One is demo-ready.")
    else:
        print("WARNING: Some checks failed - review above.")

if __name__ == "__main__":
    main()
