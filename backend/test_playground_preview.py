import time
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))

from backend.simulator.seird_engine import run_deterministic_preview
from backend.simulator.playground_schema import PlaygroundPreviewRequest, PathogenParams, ModalShareOverrides

def test_preview():
    print("Testing deterministic preview engine...")
    
    # Run 1: Cold start (loads CSVs)
    t0 = time.perf_counter()
    res1 = run_deterministic_preview(
        origin_city="Delhi",
        r0=2.5,
        cfr=0.02,
        incubation_days=5.0,
        infectious_days=7.0
    )
    t1 = time.perf_counter()
    print(f"Run 1 (cold start with CSV loads): {(t1 - t0)*1000:.2f}ms")
    print(f"  Origin: {res1['origin_city']}")
    print(f"  Summary: {res1['summary']}")
    print(f"  Top 3 cities: {[c['city'] for c in res1['top_cities'][:3]]}")

    # Run 2: Warm cache (subsequent slider scrub)
    t2 = time.perf_counter()
    res2 = run_deterministic_preview(
        origin_city="Delhi",
        r0=3.5,
        cfr=0.035,
        modal_shares={"road": 0.5, "rail": 0.45, "air": 0.05}
    )
    t3 = time.perf_counter()
    warm_ms = (t3 - t2) * 1000
    print(f"Run 2 (warm cache, scrub simulation): {warm_ms:.2f}ms")
    print(f"  Summary: {res2['summary']}")

    assert warm_ms < 50.0, f"Expected < 50ms, got {warm_ms:.2f}ms"
    assert res2["summary"]["peak_day"] > 0
    assert len(res2["national_trajectory"]["active"]) == 180
    assert len(res2["top_cities"]) == 5
    print("\n[SUCCESS] Baseline preview backward compatibility preserved!")

    # Run 3: Vaccination Campaign Test
    print("\nTesting Vaccination Campaign in Preview...")
    vax_config = {
        "enabled": True,
        "start_day": 20,
        "daily_rate": 0.003,
        "efficacy": 0.85,
        "onset_days": 14,
        "severity_efficacy": 0.95
    }
    res_vax = run_deterministic_preview(
        origin_city="Delhi",
        r0=2.5,
        cfr=0.02,
        vaccination=vax_config
    )
    print(f"  Unvaccinated Peak: {res1['summary']['peak_active_cases']:,} | Deaths: {res1['summary']['total_deaths']:,}")
    print(f"  Vaccinated Peak:   {res_vax['summary']['peak_active_cases']:,} | Deaths: {res_vax['summary']['total_deaths']:,}")
    print(f"  Final Coverage:    {res_vax['summary']['final_coverage_pct']}% ({res_vax['summary']['final_vaccinated']:,} doses)")
    assert res_vax["summary"]["peak_active_cases"] < res1["summary"]["peak_active_cases"], "Vaccine should lower peak"
    assert res_vax["summary"]["total_deaths"] < res1["summary"]["total_deaths"], "Vaccine should lower total deaths"
    assert res_vax["summary"]["final_coverage_pct"] > 0.0
    print("[SUCCESS] Vaccination campaign cleanly flattens the curve and reduces mortality!")

    # Run 4: Festival / Mass Gathering Shock Test
    print("\nTesting Festival Shock in Preview...")
    festival_config = [
        {
            "id": "fest_delhi",
            "name": "Mega Gathering",
            "city": "Delhi",
            "start_day": 25,
            "end_day": 40,
            "crowd_mult": 3.0,
            "attendee_frac": 0.15
        }
    ]
    res_fest = run_deterministic_preview(
        origin_city="Delhi",
        r0=2.5,
        cfr=0.02,
        festivals=festival_config
    )
    # Compare cases at day 40 (end of festival) and total attack rate
    base_d40 = res1["national_trajectory"]["active"][40]
    fest_d40 = res_fest["national_trajectory"]["active"][40]
    print(f"  Day 40 (end of festival) Active Cases:")
    print(f"    Baseline: {base_d40:,}")
    print(f"    Festival: {fest_d40:,} (Surge factor: {fest_d40 / max(base_d40, 1):.2f}x)")
    print(f"  Attack rate:")
    print(f"    Baseline: {res1['summary']['attack_rate_pct']}%")
    print(f"    Festival: {res_fest['summary']['attack_rate_pct']}%")
    assert fest_d40 > base_d40, "Festival should accelerate early surge"
    assert res_fest["summary"]["attack_rate_pct"] >= res1["summary"]["attack_rate_pct"], "Festival should increase or equal attack rate"
    print("[SUCCESS] Festival amplifier correctly accelerates early transmission!")

    # Run 5: SEIRV Unit Limit Tests
    print("\nRunning standalone SEIRV limit tests...")
    from backend.simulator.seirv_engine import run_limit_tests
    run_limit_tests()
    print("[SUCCESS] All SEIRV mathematical guardrails validated!")

if __name__ == "__main__":
    test_preview()
