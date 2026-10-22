"""
run_healthcare_overwhelm_report.py
-----------------------------------
Generates a per-city healthcare overwhelm table from saved seird_results.

For each intervention and city, reports:
  - P50 peak active cases
  - ICU beds needed (P50 peak)
  - ICU bed capacity from hospital_capacity.json
  - ICU overwhelm flag (True/False) and first overwhelm day
  - Oxygen demand (MT/day) vs national ceiling
  - Non-ICU oxygen beds needed

Run:
    python backend/simulator/run_healthcare_overwhelm_report.py

Requires:
    SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env
"""

import os
import sys
import math
import numpy as np
from supabase import create_client
from dotenv import load_dotenv

load_dotenv()

sys.path.insert(0, os.path.abspath("."))
from backend.simulator.healthcare_capacity import load_capacity
from backend.simulator.resource_calculator import (
    calculate_resource_projections,
    COVID_REF_CFR,
    ICU_O2_FLOW_LPM_RESPIRATORY,
    NON_ICU_O2_FLOW_LPM_RESPIRATORY,
    LPM_TO_MT_PER_DAY,
    NATIONAL_O2_CEILING_MT,
    clamp,
)

SCENARIO_ID   = "bb0ff20e-b086-411b-8054-91560b1e88ec"
INTERVENTIONS = ["none", "rail_only", "partial", "full"]
N_DAYS        = 180   # change to 365 if running 365-day scenario


def fetch_city_active_p50(supabase, scenario_id, intervention, n_days):
    """Returns {city: p50_series (length n_days)} for a given intervention."""
    rows = (
        supabase.table("city_status")
        .select("day, city, active_cases_p50")
        .eq("scenario_id", scenario_id)
        .eq("intervention_type", intervention)
        .lte("day", n_days)
        .order("day")
        .execute()
        .data
    )
    if not rows:
        return {}

    # Group by city
    city_series = {}
    for row in rows:
        city = row["city"]
        if city not in city_series:
            city_series[city] = []
        city_series[city].append(row.get("active_cases_p50", 0) or 0)

    return city_series


def compute_overwhelm_for_city(city, active_p50_series, capacity_dict, severity_ratio):
    """Computes overwhelm metrics for a single city."""
    cap = capacity_dict.get(city, {})
    total_beds = cap.get("total_beds", 0)
    icu_beds   = cap.get("icu_beds", 0)
    # Fallback: 5% of total beds are ICU if ICU count missing
    icu_thresh = icu_beds if icu_beds > 0 else math.ceil(total_beds * 0.05)

    icu_share    = clamp(0.025 * severity_ratio, 0.001, 0.50)
    nonicu_share = clamp(0.205 * severity_ratio, 0.001, 0.50)

    series = np.array(active_p50_series, dtype=float)
    peak_idx    = int(np.argmax(series))
    peak_active = float(series[peak_idx])

    icu_needed    = math.ceil(peak_active * icu_share)
    nonicu_needed = math.ceil(peak_active * nonicu_share)
    o2_demand     = (icu_needed * ICU_O2_FLOW_LPM_RESPIRATORY
                     + nonicu_needed * NON_ICU_O2_FLOW_LPM_RESPIRATORY) * LPM_TO_MT_PER_DAY

    icu_overwhelmed_mask = series * icu_share > icu_thresh
    overwhelm_days = int(np.sum(icu_overwhelmed_mask))
    first_overwhelm = int(np.argmax(icu_overwhelmed_mask)) if overwhelm_days > 0 else None

    return {
        "peak_active":      peak_active,
        "peak_day":         peak_idx + 1,
        "icu_needed":       icu_needed,
        "icu_capacity":     icu_thresh,
        "icu_overwhelmed":  overwhelm_days > 0,
        "first_overwhelm_day": first_overwhelm,
        "days_overwhelmed": overwhelm_days,
        "nonicu_needed":    nonicu_needed,
        "o2_demand_mt":     round(o2_demand, 2),
        "o2_ceiling_mt":    NATIONAL_O2_CEILING_MT,
    }


def main():
    supabase = create_client(
        os.environ["SUPABASE_URL"],
        os.environ["SUPABASE_SERVICE_ROLE_KEY"],
    )

    capacity_dict = load_capacity()

    # Fetch profile for CFR
    profile_rows = (
        supabase.table("pathogen_profiles")
        .select("cfr_most_likely, version")
        .eq("scenario_id", SCENARIO_ID)
        .order("created_at", desc=True)
        .limit(1)
        .execute()
        .data
    )
    cfr = profile_rows[0]["cfr_most_likely"] if profile_rows else COVID_REF_CFR
    severity_ratio = clamp(cfr / COVID_REF_CFR, 0.3, 15)

    print("=" * 120)
    print("Healthcare Overwhelm Report")
    print(f"Scenario: {SCENARIO_ID}  |  CFR={cfr:.3f}  |  severity_ratio={severity_ratio:.2f}")
    print("=" * 120)

    for intervention in INTERVENTIONS:
        print(f"\n--- Intervention: {intervention.upper()} ---")
        city_series = fetch_city_active_p50(supabase, SCENARIO_ID, intervention, N_DAYS)
        if not city_series:
            print("  No data found. Skipping.")
            continue

        # Sort cities by peak active descending
        city_peaks = {
            c: float(np.max(s)) for c, s in city_series.items()
        }
        sorted_cities = sorted(city_peaks, key=lambda c: city_peaks[c], reverse=True)

        print(f"  {'City':<18} | {'Peak Active':>12} | {'Peak Day':>8} | {'ICU Need':>9} | {'ICU Cap':>8} | {'Overwhelm':>10} | {'1st Day':>7} | {'Days OVR':>8} | {'O2 MT/d':>8}")
        print("  " + "-" * 105)
        overwhelmed_cities = []
        for city in sorted_cities:
            series = city_series[city]
            m = compute_overwhelm_for_city(city, series, capacity_dict, severity_ratio)
            flag = "YES ***" if m["icu_overwhelmed"] else "no"
            fday = str(m["first_overwhelm_day"]) if m["first_overwhelm_day"] else "-"
            print(
                f"  {city:<18} | {m['peak_active']:>12,.0f} | {m['peak_day']:>8} | "
                f"{m['icu_needed']:>9,} | {m['icu_capacity']:>8,} | {flag:>10} | "
                f"{fday:>7} | {m['days_overwhelmed']:>8} | {m['o2_demand_mt']:>8.1f}"
            )
            if m["icu_overwhelmed"]:
                overwhelmed_cities.append(city)

        # Summary
        print(f"\n  ICU Overwhelm Flag: {len(overwhelmed_cities)}/{len(sorted_cities)} cities overwhelmed")
        if overwhelmed_cities:
            print(f"  Overwhelmed cities: {', '.join(overwhelmed_cities)}")
        else:
            print("  No cities overwhelmed under this intervention.")

    print("\n" + "=" * 120)
    print("DONE. Add per-intervention overwhelm flags to Table X in the paper.")
    print(f"National O2 ceiling: {NATIONAL_O2_CEILING_MT:,} MT/day — compare city sums to this.")


if __name__ == "__main__":
    main()
