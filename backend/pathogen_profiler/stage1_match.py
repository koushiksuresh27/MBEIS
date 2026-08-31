from typing import Any

from postgrest.exceptions import APIError

from .db import supabase


class DiseaseNotFoundError(Exception):
    """Raised when a requested reference disease does not exist."""

    pass


def get_reference_disease(disease_name: str) -> dict[str, Any]:
    """
    Find an exact reference disease by name.

    Stage 1 performs no epidemiological calculations.
    It retrieves the authoritative reference row from Supabase.
    """

    try:
        result = (
            supabase
            .table("reference_diseases")
            .select("*")
            .eq("name", disease_name)
            .single()
            .execute()
        )

    except APIError as exc:
        if exc.code == "PGRST116":
            raise DiseaseNotFoundError(
                f"Reference disease not found: {disease_name}"
            ) from exc

        raise

    disease = result.data

    if not disease:
        raise DiseaseNotFoundError(
            f"Reference disease not found: {disease_name}"
        )

    return disease

def get_next_profile_version(scenario_id: str) -> int:
    """
    Return the next available profile version for a scenario.

    First profile -> version 1
    Existing version 1 -> version 2
    Existing version 2 -> version 3
    etc.
    """

    result = (
        supabase
        .table("pathogen_profiles")
        .select("version")
        .eq("scenario_id", scenario_id)
        .order("version", desc=True)
        .limit(1)
        .execute()
    )

    if not result.data:
        return 1

    return result.data[0]["version"] + 1

def create_matched_profile(
    scenario_id: str,
    version: int,
    disease_name: str,
) -> dict[str, Any]:
    """
    Create a matched pathogen profile from a reference disease.

    No epidemiological values are calculated or modified here.
    Values are copied from the authoritative reference_diseases row,
    while matched_reference_disease_id preserves provenance.
    """

    disease = get_reference_disease(disease_name)

    profile = {
        "scenario_id": scenario_id,
        "version": version,
        "profile_type": "matched",

        "r0_low": disease["r0_low"],
        "r0_most_likely": disease["r0_most_likely"],
        "r0_high": disease["r0_high"],

        "incubation_days_low": disease["incubation_days_low"],
        "incubation_days_most_likely": disease[
            "incubation_days_most_likely"
        ],
        "incubation_days_high": disease["incubation_days_high"],

        "cfr_low": disease["cfr_low"],
        "cfr_most_likely": disease["cfr_most_likely"],
        "cfr_high": disease["cfr_high"],

        "infectious_period_low": disease["infectious_period_low"],
        "infectious_period_most_likely": disease[
            "infectious_period_most_likely"
        ],
        "infectious_period_high": disease["infectious_period_high"],

        "is_respiratory": disease["transmission_route"] == "respiratory",

        "data_confidence": "high",

        "matched_reference_disease_id": disease[
            "reference_disease_id"
        ],

        "derivation_basis": None,
    }

    result = (
        supabase
        .table("pathogen_profiles")
        .insert(profile)
        .execute()
    )

    if not result.data:
        raise RuntimeError(
            "Failed to create matched pathogen profile."
        )

    return result.data[0]