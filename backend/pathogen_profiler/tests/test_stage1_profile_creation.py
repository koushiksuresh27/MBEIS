from backend.pathogen_profiler.db import supabase
from backend.pathogen_profiler.stage1_match import create_matched_profile


def test_create_matched_profile():
    """
    Verify that Stage 1 creates a correctly linked
    matched profile in pathogen_profiles.
    """

    # Get an existing scenario.
    scenario_result = (
        supabase
        .table("scenarios")
        .select("scenario_id")
        .limit(1)
        .execute()
    )

    assert scenario_result.data, "No scenarios found for integration test."

    scenario_id = scenario_result.data[0]["scenario_id"]

    # Find the latest profile version for this scenario.
    profile_result = (
        supabase
        .table("pathogen_profiles")
        .select("version")
        .eq("scenario_id", scenario_id)
        .order("version", desc=True)
        .limit(1)
        .execute()
    )

    if profile_result.data:
        version = profile_result.data[0]["version"] + 1
    else:
        version = 1

    profile = create_matched_profile(
        scenario_id=scenario_id,
        version=version,
        disease_name="COVID-19 (India-calibrated)",
    )

    assert profile is not None
    assert profile["scenario_id"] == scenario_id
    assert profile["version"] == version
    assert profile["profile_type"] == "matched"

    assert profile["matched_reference_disease_id"] == (
        "ac8f26d0-9a57-44a4-ade0-7a1f22f8ca7f"
    )

    assert profile["data_confidence"] == "high"
    assert profile["derivation_basis"] is None

    assert "r0_low" in profile
    assert "r0_most_likely" in profile
    assert "r0_high" in profile

    assert "incubation_days_low" in profile
    assert "incubation_days_most_likely" in profile
    assert "incubation_days_high" in profile

    assert "cfr_low" in profile
    assert "cfr_most_likely" in profile
    assert "cfr_high" in profile

    assert "infectious_period_low" in profile
    assert "infectious_period_most_likely" in profile
    assert "infectious_period_high" in profile