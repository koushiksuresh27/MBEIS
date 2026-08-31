import pytest

from backend.pathogen_profiler.stage2_derive import (
    derive_weighted_value,
    derive_weighted_parameters,
)


def test_weighted_value():
    diseases = [
        {
            "name": "Disease A",
            "similarity_score": 0.8,
            "r0": 2.0,
        },
        {
            "name": "Disease B",
            "similarity_score": 0.2,
            "r0": 4.0,
        },
    ]

    result = derive_weighted_value(
        diseases,
        "r0",
    )

    expected = ((2.0 * 0.8) + (4.0 * 0.2)) / (0.8 + 0.2)

    assert result == pytest.approx(expected)


def test_derive_all_parameters():
    diseases = [
        {
            "name": "Disease A",
            "similarity_score": 0.5,
            "r0": 2.0,
            "incubation_days": 5.0,
            "cfr": 0.01,
            "infectious_period": 6.0,
        },
        {
            "name": "Disease B",
            "similarity_score": 0.5,
            "r0": 4.0,
            "incubation_days": 9.0,
            "cfr": 0.03,
            "infectious_period": 10.0,
        },
    ]

    result = derive_weighted_parameters(diseases)

    assert result["r0"] == pytest.approx(3.0)
    assert result["incubation_days"] == pytest.approx(7.0)
    assert result["cfr"] == pytest.approx(0.02)
    assert result["infectious_period"] == pytest.approx(8.0)


def test_missing_parameter_is_ignored():
    diseases = [
        {
            "name": "Disease A",
            "similarity_score": 0.8,
            "r0": 2.0,
        },
        {
            "name": "Disease B",
            "similarity_score": 0.2,
        },
    ]

    result = derive_weighted_value(
        diseases,
        "r0",
    )

    assert result == pytest.approx(2.0)


def test_empty_diseases_rejected():
    with pytest.raises(ValueError):
        derive_weighted_value([], "r0")


def test_zero_similarity_rejected():
    diseases = [
        {
            "name": "Disease A",
            "similarity_score": 0.0,
            "r0": 2.0,
        }
    ]

    with pytest.raises(ValueError):
        derive_weighted_value(diseases, "r0")