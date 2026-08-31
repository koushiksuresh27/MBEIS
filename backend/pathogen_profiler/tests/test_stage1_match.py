import pytest

from backend.pathogen_profiler.stage1_match import (
    DiseaseNotFoundError,
    get_reference_disease,
)


KNOWN_DISEASES = [
    "COVID-19 (India-calibrated)",
    "Nipah virus",
    "MERS-CoV",
    "Ebola virus disease",
    "Pandemic influenza (1918/2009-style reference)",
    "H5N1 / H7N9 avian influenza",
]


@pytest.mark.parametrize("disease_name", KNOWN_DISEASES)
def test_known_disease_lookup(disease_name):
    """Every seeded reference disease should be found."""
    
    disease = get_reference_disease(disease_name)

    assert disease is not None
    assert disease["name"] == disease_name
    assert disease["reference_disease_id"] is not None


def test_unknown_disease_lookup():
    """An unknown disease should raise DiseaseNotFoundError."""

    with pytest.raises(DiseaseNotFoundError):
        get_reference_disease("Completely Unknown Disease")