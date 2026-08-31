from typing import Any
from uuid import uuid4
from .db import supabase


def get_all_reference_diseases() -> list[dict[str, Any]]:
    """
    Retrieve all reference diseases from Supabase.

    Stage 2 uses the complete reference disease set
    as the basis for similarity scoring.
    """

    result = (
        supabase
        .table("reference_diseases")
        .select("*")
        .execute()
    )

    return result.data or []


def calculate_similarity(
    pathogen_description: str,
    disease: dict[str, Any],
) -> float:
    """
    Calculate a deterministic similarity score between an
    unknown pathogen description and a reference disease.

    The score is between 0.0 and 1.0.

    Matching is currently based on keywords found in:
    - disease name
    - transmission route
    - notes
    """

    description = pathogen_description.lower()

    searchable_text = " ".join(
        str(disease.get(field, "") or "")
        for field in [
            "name",
            "transmission_route",
            "notes",
        ]
    ).lower()

    if not description.strip():
        return 0.0

    description_words = set(description.split())

    meaningful_words = [
        word
        for word in description_words
        if len(word) > 2
    ]

    if not meaningful_words:
        return 0.0

    matching_words = sum(
        1
        for word in meaningful_words
        if word in searchable_text
    )

    score = matching_words / len(meaningful_words)

    return min(score, 1.0)


def score_all_reference_diseases(
    pathogen_description: str,
) -> list[dict[str, Any]]:
    """
    Score the unknown pathogen description against
    every reference disease.

    Returns diseases sorted from highest similarity
    to lowest similarity.
    """

    diseases = get_all_reference_diseases()

    scored_diseases = []

    for disease in diseases:
        score = calculate_similarity(
            pathogen_description,
            disease,
        )

        scored_diseases.append(
            {
                "disease": disease,
                "similarity_score": score,
            }
        )

    scored_diseases.sort(
        key=lambda item: item["similarity_score"],
        reverse=True,
    )

    return scored_diseases


def select_contributing_diseases(
    similarity_results: list[dict[str, Any]],
    top_k: int = 3,
    min_similarity: float = 0.3,
) -> list[dict[str, Any]]:
    """
    Select the reference diseases that contribute
    to the derived pathogen profile.

    Only diseases meeting the minimum similarity
    threshold are selected.

    The results are assumed to already be sorted
    from highest to lowest similarity.
    """

    if top_k < 1:
        raise ValueError(
            "top_k must be at least 1"
        )

    if not 0 <= min_similarity <= 1:
        raise ValueError(
            "min_similarity must be between 0 and 1"
        )

    selected = [
        result
        for result in similarity_results
        if result.get("similarity_score", 0) >= min_similarity
    ]

    return selected[:top_k]


def derive_weighted_value(
    contributing_diseases: list[dict[str, Any]],
    parameter: str,
) -> float:
    """
    Calculate a similarity-weighted average for one
    epidemiological parameter.

    Supports:

    1. Flat test data:
       {
           "r0": 2.0,
           "similarity_score": 0.8
       }

    2. Nested reference-disease data:
       {
           "disease": {
               "r0_most_likely": 2.0
           },
           "similarity_score": 0.8
       }

    3. Supabase reference disease rows containing:
       r0_low
       r0_most_likely
       r0_high

    For derivation, the most_likely value is used.
    """

    if not contributing_diseases:
        raise ValueError(
            "At least one contributing disease is required."
        )

    weighted_sum = 0.0
    total_weight = 0.0

    for result in contributing_diseases:

        similarity = float(
            result.get("similarity_score", 0)
        )

        if similarity <= 0:
            continue

        disease = result.get("disease")

        # -----------------------------------------
        # Determine where the parameter is stored
        # -----------------------------------------

        if isinstance(disease, dict):

            # First support flat parameter:
            # disease["r0"]
            value = disease.get(parameter)

            # Then support database structure:
            # disease["r0_most_likely"]
            if value is None:
                value = disease.get(
                    f"{parameter}_most_likely"
                )

        else:
            # Flat test structure:
            # result["r0"]
            value = result.get(parameter)

            # Also support:
            # result["r0_most_likely"]
            if value is None:
                value = result.get(
                    f"{parameter}_most_likely"
                )

        # Parameter is missing from this disease.
        # Simply ignore it.
        if value is None:
            continue

        try:
            value = float(value)
        except (TypeError, ValueError):
            continue

        weighted_sum += value * similarity
        total_weight += similarity

    if total_weight == 0:
        raise ValueError(
            f"No valid values or weights available "
            f"for parameter: {parameter}"
        )

    return weighted_sum / total_weight


def derive_weighted_parameters(
    contributing_diseases: list[dict[str, Any]],
) -> dict[str, float]:
    """
    Derive all epidemiological parameters using
    similarity-weighted averages.
    """

    if not contributing_diseases:
        raise ValueError(
            "At least one contributing disease is required."
        )

    return {
        "r0": derive_weighted_value(
            contributing_diseases,
            "r0",
        ),
        "incubation_days": derive_weighted_value(
            contributing_diseases,
            "incubation_days",
        ),
        "cfr": derive_weighted_value(
            contributing_diseases,
            "cfr",
        ),
        "infectious_period": derive_weighted_value(
            contributing_diseases,
            "infectious_period",
        ),
    }

def create_derived_profile(
    scenario_id: str,
    version: int,
    pathogen_description: str,
) -> dict[str, Any]:
    """
    Create a complete Stage 2 derived pathogen profile.

    Pipeline:

    1. Score pathogen against all reference diseases.
    2. Select contributing diseases.
    3. Derive epidemiological parameters using
       similarity-weighted averages.
    4. Build derivation provenance.
    5. Persist the derived profile in Supabase.
    6. Return the created profile.
    """

    if not scenario_id:
        raise ValueError("scenario_id is required.")

    if version < 1:
        raise ValueError("version must be at least 1.")

    if not pathogen_description or not pathogen_description.strip():
        raise ValueError(
            "pathogen_description must not be empty."
        )

    # --------------------------------------------------
    # Step 1: Score all reference diseases
    # --------------------------------------------------

    similarity_results = score_all_reference_diseases(
        pathogen_description
    )

    # --------------------------------------------------
    # Step 2: Select contributing diseases
    # --------------------------------------------------

    contributing_diseases = select_contributing_diseases(
        similarity_results,
        top_k=3,
        min_similarity=0.3,
    )

    if not contributing_diseases:
        raise ValueError(
            "No sufficiently similar reference diseases "
            "were found for the pathogen description."
        )

    # --------------------------------------------------
    # Step 3: Derive epidemiological parameters
    # --------------------------------------------------

    parameters = derive_weighted_parameters(
        contributing_diseases
    )

    # --------------------------------------------------
    # Step 4: Build provenance
    # --------------------------------------------------

    contributing_summary = []

    for result in contributing_diseases:

        disease = result.get("disease", {})

        contributing_summary.append(
            {
                "reference_disease_id": disease.get(
                    "reference_disease_id"
                ),
                "name": disease.get("name"),
                "similarity_score": result.get(
                    "similarity_score"
                ),
            }
        )

    derivation_basis = {
        "contributing_diseases": contributing_summary,
        "weighting_features": {
            "similarity_score": "Similarity-weighted average",
            "selection": "Top 3 diseases above similarity threshold",
            "minimum_similarity": 0.3,
        },
        "reasoning": (
            "Epidemiological parameters were derived using "
            "similarity-weighted averages from the most "
            "similar reference diseases."
        ),
    }

    # --------------------------------------------------
    # Step 5: Determine respiratory characteristic
    # --------------------------------------------------

    is_respiratory = any(
        "respiratory" in str(
            result.get("disease", {}).get(
                "transmission_route", ""
            )
        ).lower()
        for result in contributing_diseases
    )

    # --------------------------------------------------
    # Step 6: Generate profile ID
    # --------------------------------------------------

    profile_id = str(uuid4())

    # --------------------------------------------------
    # Step 7: Build database record
    # --------------------------------------------------

    profile_record = {
        "profile_id": profile_id,
        "scenario_id": scenario_id,
        "version": version,
        "profile_type": "derived",

        "r0_low": parameters["r0"],
        "r0_most_likely": parameters["r0"],
        "r0_high": parameters["r0"],

        "incubation_days_low": parameters[
            "incubation_days"
        ],
        "incubation_days_most_likely": parameters[
            "incubation_days"
        ],
        "incubation_days_high": parameters[
            "incubation_days"
        ],

        "cfr_low": parameters["cfr"],
        "cfr_most_likely": parameters["cfr"],
        "cfr_high": parameters["cfr"],

        "infectious_period_low": parameters[
            "infectious_period"
        ],
        "infectious_period_most_likely": parameters[
            "infectious_period"
        ],
        "infectious_period_high": parameters[
            "infectious_period"
        ],

        "is_respiratory": is_respiratory,
        "data_confidence": "medium",

        "matched_reference_disease_id": None,

        "derivation_basis": derivation_basis,
    }

    # --------------------------------------------------
    # Step 8: Persist in Supabase
    # --------------------------------------------------

    result = (
        supabase
        .table("pathogen_profiles")
        .insert(profile_record)
        .execute()
    )

    if not result.data:
        raise RuntimeError(
            "Failed to create derived pathogen profile."
        )

    # --------------------------------------------------
    # Step 9: Return created profile
    # --------------------------------------------------

    return result.data[0]