from backend.pathogen_profiler.stage2_derive import (
    calculate_similarity,
    score_all_reference_diseases,
)


def test_similarity_score_is_valid():

    disease = {
        "name": "COVID-19 (India-calibrated)",
        "transmission_route": "respiratory",
        "notes": "Respiratory viral disease",
    }

    score = calculate_similarity(
        "respiratory viral disease",
        disease,
    )

    assert 0.0 <= score <= 1.0


def test_all_diseases_are_scored():

    results = score_all_reference_diseases(
        "respiratory virus with moderate transmission"
    )

    assert len(results) >= 6

    for result in results:
        assert "disease" in result
        assert "similarity_score" in result

        assert 0.0 <= result["similarity_score"] <= 1.0


def test_results_are_sorted():

    results = score_all_reference_diseases(
        "respiratory virus with moderate transmission"
    )

    scores = [
        result["similarity_score"]
        for result in results
    ]

    assert scores == sorted(
        scores,
        reverse=True,
    )