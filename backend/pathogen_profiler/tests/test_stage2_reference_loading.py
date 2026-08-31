from backend.pathogen_profiler.stage2_derive import (
    get_all_reference_diseases,
)


def test_load_all_reference_diseases():
    """
    Stage 2 should be able to load all seeded
    reference diseases.
    """

    diseases = get_all_reference_diseases()

    assert len(diseases) >= 6

    names = {disease["name"] for disease in diseases}

    assert "COVID-19 (India-calibrated)" in names
    assert "Nipah virus" in names
    assert "MERS-CoV" in names
    assert "Ebola virus disease" in names
    assert "Pandemic influenza (1918/2009-style reference)" in names
    assert "H5N1 / H7N9 avian influenza" in names