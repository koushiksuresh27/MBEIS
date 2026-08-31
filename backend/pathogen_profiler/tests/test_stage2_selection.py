from backend.pathogen_profiler.stage2_derive import (
    select_contributing_diseases,
)
from typing import Any

def test_select_top_contributing_diseases():
    results = [
        {"name": "Disease A", "similarity_score": 0.90},
        {"name": "Disease B", "similarity_score": 0.80},
        {"name": "Disease C", "similarity_score": 0.70},
        {"name": "Disease D", "similarity_score": 0.60},
    ]

    selected = select_contributing_diseases(
        results,
        top_k=3,
        min_similarity=0.3,
    )

    assert len(selected) == 3
    assert selected[0]["name"] == "Disease A"
    assert selected[1]["name"] == "Disease B"
    assert selected[2]["name"] == "Disease C"


def test_similarity_threshold():
    results = [
        {"name": "Disease A", "similarity_score": 0.90},
        {"name": "Disease B", "similarity_score": 0.20},
        {"name": "Disease C", "similarity_score": 0.10},
    ]

    selected = select_contributing_diseases(
        results,
        top_k=3,
        min_similarity=0.3,
    )

    assert len(selected) == 1
    assert selected[0]["name"] == "Disease A"


def test_empty_results():
    selected = select_contributing_diseases([])

    assert selected == []

def derive_weighted_value(
    contributing_diseases: list[dict[str, Any]],
    parameter: str,
) -> float:
    """
    Calculate a similarity-weighted average for one
    epidemiological parameter.
    """

    if not contributing_diseases:
        raise ValueError(
            "At least one contributing disease is required."
        )

    weighted_sum = 0.0
    total_weight = 0.0

    for disease in contributing_diseases:
        similarity = disease.get("similarity_score", 0)
        value = disease.get(parameter)

        if value is None:
            continue

        weighted_sum += value * similarity
        total_weight += similarity

    if total_weight == 0:
        raise ValueError(
            f"No valid values available for parameter: {parameter}"
        )

    return weighted_sum / total_weight

def derive_weighted_parameters(
    contributing_diseases: list[dict[str, Any]],
) -> dict[str, float]:
    """
    Derive all simulation-ready epidemiological parameters
    using similarity-weighted averages.
    """

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