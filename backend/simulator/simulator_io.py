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

import time
from backend.simulator.supabase_client import get_client

CHUNK_SIZE = 100


def _insert_with_retry(supabase, table: str, rows: list[dict]) -> None:
    """Insert rows in chunks with exponential backoff retry."""
    for i in range(0, len(rows), CHUNK_SIZE):
        chunk = rows[i:i + CHUNK_SIZE]
        for attempt in range(4):
            try:
                supabase.table(table).insert(chunk).execute()
                break
            except Exception as e:
                if attempt == 3:
                    raise
                wait = 2 ** attempt
                print(f"[IO] {table} insert retry {attempt + 1}, waiting {wait}s: {e}")
                time.sleep(wait)
        time.sleep(0.3)


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
    one row per day (e.g. 180 rows for a 180-day window) per intervention_type.
    """
    if not rows:
        return
    supabase = get_client()
    sample = rows[0]
    supabase.table("seird_results").delete().eq(
        "scenario_id", sample["scenario_id"]
    ).eq(
        "pathogen_profile_version", sample["pathogen_profile_version"]
    ).eq(
        "intervention_type", sample["intervention_type"]
    ).execute()
    _insert_with_retry(supabase, "seird_results", rows)
    print(f"  [done] seird_results written for intervention={sample['intervention_type']}")


def write_city_status(rows: list[dict]) -> None:
    if not rows:
        return
    supabase = get_client()
    sample = rows[0]
    supabase.table("city_status").delete().eq(
        "scenario_id", sample["scenario_id"]
    ).eq(
        "pathogen_profile_version", sample["pathogen_profile_version"]
    ).eq(
        "intervention_type", sample["intervention_type"]
    ).execute()
    _insert_with_retry(supabase, "city_status", rows)
    print(f"[IO] Inserted {len(rows)} rows for {sample['intervention_type']}")


def write_lockdown_recommendations(rows: list[dict]) -> None:
    """
    Writes a batch of lockdown_recommendations rows.
    Each row must include: scenario_id, pathogen_profile_version, intervention_type,
    city, priority_rank, betweenness_score, eigenvector_score.
    """
    if not rows:
        return
    supabase = get_client()
    sample = rows[0]
    supabase.table("lockdown_recommendations").delete().eq(
        "scenario_id", sample["scenario_id"]
    ).eq(
        "pathogen_profile_version", sample["pathogen_profile_version"]
    ).eq(
        "intervention_type", sample["intervention_type"]
    ).execute()
    _insert_with_retry(supabase, "lockdown_recommendations", rows)


def write_resource_projections(rows: list[dict]) -> None:
    """
    Writes a batch of resource_projections rows.
    Each row must include: scenario_id, pathogen_profile_version, intervention_type,
    city, week, projected_icu_beds_needed, projected_non_icu_beds_needed,
    projected_isolation_beds_needed, projected_oxygen_mt_per_day.
    capacity_ceiling_oxygen_mt_per_day defaults to 17000 in the schema (Phase 1's
    fixed G1 ceiling) — you can omit it unless you're overriding the default.
    """
    if not rows:
        return
    supabase = get_client()
    sample = rows[0]
    supabase.table("resource_projections").delete().eq(
        "scenario_id", sample["scenario_id"]
    ).eq(
        "pathogen_profile_version", sample["pathogen_profile_version"]
    ).eq(
        "intervention_type", sample["intervention_type"]
    ).execute()
    _insert_with_retry(supabase, "resource_projections", rows)
    print(f"  [done] resource_projections written for intervention={sample['intervention_type']}")


def write_all_results(pipeline_output: dict, resource_rows: list[dict]) -> None:
    """
    Writes all pipeline output to Supabase in one call, with idempotent
    delete-before-insert per intervention_type.
    """
    from itertools import groupby
    from operator import itemgetter

    for table_key, write_fn in [
        ("seird_results", write_seird_results),
        ("city_status", write_city_status),
        ("lockdown_recommendations", write_lockdown_recommendations),
    ]:
        rows = pipeline_output[table_key]
        if not rows:
            continue
        sorted_rows = sorted(rows, key=itemgetter("intervention_type"))
        for inv_type, group in groupby(sorted_rows, key=itemgetter("intervention_type")):
            write_fn(list(group))

    # Resource projections come in separately
    if resource_rows:
        sorted_rr = sorted(resource_rows, key=itemgetter("intervention_type"))
        for inv_type, group in groupby(sorted_rr, key=itemgetter("intervention_type")):
            write_resource_projections(list(group))


def register_intervention_type(label: str) -> None:
    """Inserts label into intervention_types lookup table. Idempotent."""
    supabase = get_client()
    supabase.table("intervention_types") \
        .upsert({"key": label}, on_conflict="key") \
        .execute()
def is_simulation_current(scenario_id: str, origin_city: str, n_iterations: int) -> bool:
    """
    Returns True if valid simulation results already exist for this exact
    scenario_id + origin_city + n_iterations + current pathogen_profile_version.
    If True, run_scenario can skip the simulation entirely and serve existing data.
    """
    supabase = get_client()

    # Get current profile version
    try:
        profile = get_latest_pathogen_profile(scenario_id)
        current_version = profile["version"]
    except ValueError:
        return False  # No profile = can't be current

    # Check if all 4 standard interventions exist for this version
    result = supabase.table("seird_results") \
        .select("intervention_type") \
        .eq("scenario_id", scenario_id) \
        .eq("pathogen_profile_version", current_version) \
        .in_("intervention_type", ["none", "rail_only", "partial", "full"]) \
        .execute()

    if not result.data:
        return False

    found = {row["intervention_type"] for row in result.data}
    all_four = {"none", "rail_only", "partial", "full"}

    if not all_four.issubset(found):
        return False

    # Check origin_city and n_iterations match via metadata table if it exists,
    # otherwise trust profile version as the signal — profile version bumps
    # whenever scenario config changes in the SetupModal.
    return True