# tests/test_pipeline_v3.py
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.simulator.pipeline import run_simulation_pipeline

if __name__ == '__main__':
    profile = {
        "r0_low": 1.4, "r0_most_likely": 2.87, "r0_high": 5.7,
        "incubation_days_low": 2, "incubation_days_most_likely": 5.1,
        "incubation_days_high": 14,
        "cfr_low": 0.005, "cfr_most_likely": 0.023, "cfr_high": 0.072,
        "data_confidence": "high", "version": 1
    }

    result = run_simulation_pipeline(
        scenario_id="test-scenario-001",
        pathogen_profile=profile,
        origin_city="THRISSUR",
        intervention_types=["none", "rail_only", "partial", "full"],
        n_runs=10, days=30
    )

    # Check all 4 intervention types produced results
    interventions_in_seird = set(r["intervention_type"] for r in result["seird_results"])
    assert interventions_in_seird == {"none", "rail_only", "partial", "full"}, \
        f"Missing interventions: {interventions_in_seird}"

    # Check versioning tag
    for r in result["seird_results"]:
        assert r["pathogen_profile_version"] == 1

    # Check city_status has entries
    assert len(result["city_status"]) > 0

    # Check lockdown_recommendations exist for all 4
    lr_interventions = set(r["intervention_type"] for r in result["lockdown_recommendations"])
    assert lr_interventions == {"none", "rail_only", "partial", "full"}

    # Check lockdown_recommendations have the right fields
    for r in result["lockdown_recommendations"]:
        assert "city" in r
        assert "priority_rank" in r
        assert "betweenness_score" in r
        assert "eigenvector_score" in r

    print(f"PASS: {len(result['seird_results'])} seird rows, "
          f"{len(result['city_status'])} city_status rows, "
          f"{len(result['lockdown_recommendations'])} lockdown rows.")
