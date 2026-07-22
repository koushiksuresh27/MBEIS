"""
Simulator <-> Supabase read/write functions.

This is the ONLY place backend/simulator code should talk to Supabase directly —
keeps the integration surface in one file, matching the "one integration point"
principle from the plan (Section 5.2), and makes it easy for Abhinav to write an
equivalent profiler_io.py using the same pattern.

Contract reminder (Section 10): the ONLY thing this module needs to agree on
with Abhinav's profiler service is the shape of the pathogen_profiles table —
nothing else. This file only READS pathogen_profiles, never writes it.
"""

from backend.simulator.supabase_client import get_client


def get_latest_pathogen_profile(scenario_id: str) -> dict:
    """
    Reads the highest-version pathogen_profiles row for a scenario.
    Per Section 6's rule: always select by highest version, never assume
    "most recently inserted row" — a slower run could still be an older version.
    """
    supabase = get_client()
    response = (
        supabase.table("pathogen_profiles")
        .select("*")
        .eq("scenario_id", scenario_id)
        .order("version", desc=True)
        .limit(1)
        .execute()
    )

    if not response.data:
        raise ValueError(
            f"No pathogen_profiles row found for scenario_id={scenario_id}. "
            "The profiler service needs to run and write a profile before the "
            "simulator can run against this scenario."
        )

    return response.data[0]


def write_seird_results(rows: list[dict]) -> None:
    """
    Writes a batch of seird_results rows.
    Each row must include: scenario_id, pathogen_profile_version, intervention_type,
    day, infected_p10/p50/p90, deaths_p10/p50/p90, trajectory_sample (optional).
    Batch insert, not one-row-at-a-time, since a single simulation run produces
    one row per day (e.g. 90 rows for a 90-day window) per intervention_type.
    """
    supabase = get_client()
    supabase.table("seird_results").insert(rows).execute()


def write_city_status(rows: list[dict]) -> None:
    """
    Writes a batch of city_status rows.
    Each row must include: scenario_id, pathogen_profile_version, intervention_type,
    city, day, active_cases_p10/p50/p90.
    """
    supabase = get_client()
    supabase.table("city_status").insert(rows).execute()


def write_lockdown_recommendations(rows: list[dict]) -> None:
    """
    Writes a batch of lockdown_recommendations rows.
    Each row must include: scenario_id, pathogen_profile_version, intervention_type,
    city, priority_rank, betweenness_score, eigenvector_score.
    """
    supabase = get_client()
    supabase.table("lockdown_recommendations").insert(rows).execute()


def write_resource_projections(rows: list[dict]) -> None:
    """
    Writes a batch of resource_projections rows.
    Each row must include: scenario_id, pathogen_profile_version, intervention_type,
    city, week, projected_icu_beds_needed, projected_non_icu_beds_needed,
    projected_isolation_beds_needed, projected_oxygen_mt_per_day.
    capacity_ceiling_oxygen_mt_per_day defaults to 17000 in the schema (Phase 1's
    fixed G1 ceiling) — you can omit it unless you're overriding the default.
    """
    supabase = get_client()
    supabase.table("resource_projections").insert(rows).execute()


# ---------------------------------------------------------------------------
# Example usage — remove this block once you've wired real simulator output in.
# This shows the exact expected shape for a single seird_results row.
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    # NOTE: this will fail unless a real scenario + pathogen_profiles row exists.
    # Useful for testing the connection once Abhinav's profiler has written
    # at least one profile, or once you've manually inserted a fake profile row
    # via SQL Editor for testing purposes (see the "mock the upstream data"
    # pattern discussed earlier in the project).

    example_scenario_id = "bb0ff20e-b086-411b-8054-91560b1e88ec"

    profile = get_latest_pathogen_profile(example_scenario_id)
    print("Got profile:", profile)

    example_seird_row = {
        "scenario_id": example_scenario_id,
        "pathogen_profile_version": profile["version"],
        "intervention_type": "none",
        "day": 1,
        "infected_p10": 100,
        "infected_p50": 150,
        "infected_p90": 220,
        "deaths_p10": 1,
        "deaths_p50": 2,
        "deaths_p90": 4,
        "trajectory_sample": [{"trajectory_id": 1, "infected": 150, "deaths": 2}],
    }
    write_seird_results([example_seird_row])
    print("Wrote a test seird_results row.")
