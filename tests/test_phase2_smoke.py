import os
import sys
import json

# Adjust path to import backend.profiler modules
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.profiler.template_matcher import match_template
from backend.profiler.seasonal_modifier import get_seasonal_multiplier
from backend.profiler.virus_profiler import profile_from_event, compute_data_confidence
from backend.profiler.pathogen_profiler import profile_pathogen

def test_dengue_template_match():
    symptoms = ["fever", "rash", "joint_pain", "myalgia", "headache"]
    matched_template, confidence = match_template(symptoms)
    assert matched_template["name"] == "dengue"
    assert confidence > 0.6

def test_monsoon_dengue_coastal():
    mult = get_seasonal_multiplier(zone="coastal", month=8, disease_type="dengue")
    assert mult >= 1.25

def test_low_confidence_data():
    event = {"report_count": 1, "source_credibility": 0.3}
    conf = compute_data_confidence(event, template_confidence=0.9)
    assert conf.upper() == "LOW"

def test_unknown_pathogen_fallback():
    symptoms = ["cough"]
    matched_template, confidence = match_template(symptoms)
    assert matched_template["name"] == "unknown"

def test_profile_has_all_fields():
    # Mock event directly instead of reading from obsolete data/generated/ JSON
    event = {
        "event_id": "bb0ff20e-b086-411b-8054-91560b1e88ec",
        "origin_node_id": "KA-01",
        "symptoms": ["fever", "cough", "loss_of_taste"],
        "report_count": 5,
        "source_credibility": 0.8
    }
        
    profile = profile_pathogen(event)
    expected_fields = ["disease_name", "R0_estimate", "mortality_rate", "data_confidence", "template_confidence", "seasonal_multiplier", "base_template"]
    for field in expected_fields:
        assert field in profile
