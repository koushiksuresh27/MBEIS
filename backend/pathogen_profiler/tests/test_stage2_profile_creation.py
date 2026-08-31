from backend.pathogen_profiler.db import supabase
from backend.pathogen_profiler.stage2_derive import create_derived_profile


def test_create_derived_profile():
    """
    Verify that Stage 2 creates a derived pathogen profile
    and correctly links it to an existing scenario.
    """

    # Get an existing scenario
    scenario_result = (
        supabase
        .table("scenarios")
        .select("scenario_id")
        .limit(1)
        .execute()
    )

    assert scenario_result.data, "No scenarios found for integration test."

    scenario_id = scenario_result.data[0]["scenario_id"]

    # Find the latest profile version for this scenario
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
        next_version = profile_result.data[0]["version"] + 1
    else:
        next_version = 1

    # Create derived profile
    profile = create_derived_profile(
        scenario_id=scenario_id,
        version=next_version,
        pathogen_description=(
            "A respiratory virus with airborne transmission, "
            "moderate incubation period and moderate severity."
        ),
    )

    # Basic assertions
    assert profile is not None
    assert profile["scenario_id"] == scenario_id
    assert profile["version"] == next_version
    assert profile["profile_type"] == "derived"

    # Verify the profile was actually stored in Supabase
    stored_result = (
        supabase
        .table("pathogen_profiles")
        .select("*")
        .eq("profile_id", profile["profile_id"])
        .single()
        .execute()
    )

    stored_profile = stored_result.data

    assert stored_profile is not None
    assert stored_profile["scenario_id"] == scenario_id
    assert stored_profile["version"] == next_version
    assert stored_profile["profile_type"] == "derived"