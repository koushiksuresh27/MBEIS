import os
import sys
import json
import numpy as np
import networkx as nx

# Adjust path to import backend.simulator modules
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.simulator.seird_model import run_seird_node
from backend.simulator.monte_carlo import run_monte_carlo
from backend.simulator.healthcare_capacity import load_capacity, check_overwhelmed
from backend.simulator.lockdown_optimizer import rank_lockdown_targets
from backend.simulator.simulator_io import get_latest_pathogen_profile
from backend.simulator.mobility_graph import build_graph

def get_test_profile():
    # Read from Supabase directly instead of local files!
    scenario_id = "bb0ff20e-b086-411b-8054-91560b1e88ec"
    db_profile = get_latest_pathogen_profile(scenario_id)
    # Map the DB flat structure to the nested dict expected by run_monte_carlo
    return {
        "R0_estimate": (db_profile["r0_low"] + db_profile["r0_high"]) / 2.0,
        "seasonal_multiplier": 1.0,
        "data_confidence": db_profile["data_confidence"].upper(),
        "base_template": {
            "R0": {"lower_95": db_profile["r0_low"], "upper_95": db_profile["r0_high"]},
            "incubation_days": {"min": db_profile["incubation_days_low"], "max": db_profile["incubation_days_high"]},
            "mortality_rate": {
                "estimate": (db_profile["cfr_low"] + db_profile["cfr_high"]) / 2.0,
                "lower_95": db_profile["cfr_low"],
                "upper_95": db_profile["cfr_high"]
            },
            "clinical_duration_days": 10,
            "contagiousness_factor": 1.0
        }
    }

def test_seird_conservation():
    N = 100000
    df = run_seird_node(
        population=N, 
        R0=3.0, 
        incubation_mean=5, 
        clinical_duration=10, 
        mortality_rate=0.01, 
        contagiousness_factor=0.5, 
        seed_infections=10, 
        days=20
    )
    
    total = df['S'] + df['E'] + df['I'] + df['R'] + df['D']
    
    for t in total:
        assert abs(t - N) / N < 0.01

def test_confidence_band_monotonicity():
    profile = get_test_profile()
    G = build_graph()
    
    res = run_monte_carlo(profile, G, "BENGALURU", n_runs=5, days=10)
    
    for nid, bands in res["confidence_bands"].items():
        for i in range(len(bands["P50"])):
            assert bands["P10"][i] <= bands["P50"][i]
            assert bands["P50"][i] <= bands["P90"][i]

def test_bengaluru_overwhelmed():
    cap = load_capacity()
    
    df = run_seird_node(
        population=13193000, 
        R0=4.0, 
        incubation_mean=5, 
        clinical_duration=10, 
        mortality_rate=0.01, 
        contagiousness_factor=1.0, 
        seed_infections=10, 
        days=90
    )
    
    res = check_overwhelmed("BENGALURU", df['I'].values, cap)
    assert res["overwhelmed"] == True

def test_lockdown_top_edge_is_origin():
    profile = get_test_profile()
    G = build_graph()
    
    res = run_monte_carlo(profile, G, "THRISSUR", n_runs=5, days=30)
    
    ranked_targets = rank_lockdown_targets(
        G, 
        res["confidence_bands"], 
        res["peak_infection_day"],
        top_n=5
    )
    
    top_edge = ranked_targets[0]
    assert "source" in top_edge and "target" in top_edge
