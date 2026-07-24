from backend.simulator.monte_carlo import run_monte_carlo, apply_intervention

def run_blended_historical(profile, base_graph, origin_node_id, n_runs=500, phase1_days=55, phase2_days=35):
    """
    Phase 1: run_monte_carlo with 'none'-intervention graph, days=phase1_days,
      starting from fresh origin seeding.
    Phase 2: take the ENDING per-node compartment state from phase 1
      (mean/median across MC runs, not a single trajectory) as the
      initial_state for phase 2, run with 'full'-intervention graph,
      days=phase2_days.
    Returns combined day-indexed results (day 0 to phase1_days+phase2_days)
    tagged with intervention_type='historical', in the same row format
    as run_simulation_pipeline's seird_results/city_status output.
    """
    
    # Phase 1: Unmitigated
    graph_phase1 = apply_intervention(base_graph, 'none')
    res_phase1 = run_monte_carlo(profile, graph_phase1, origin_node_id, n_runs=n_runs, days=phase1_days)
    bands_phase1 = res_phase1["confidence_bands"]

    # Extract ending state for Phase 2
    # Note explicitly: Using the median (P50) trajectory's ending compartment values per city as
    # the single starting point for all phase-2 MC runs. This is a simplification
    # (collapsing phase-1 uncertainty into a point estimate before phase 2) and is a known limitation.
    initial_state_phase2 = {}
    for city, bands in bands_phase1.items():
        # Compartments at the end of Phase 1 (day index `phase1_days`)
        S_end = bands["S_P50"][phase1_days]
        E_end = bands["E_P50"][phase1_days]
        I_end = bands["P50"][phase1_days]
        R_end = bands["R_P50"][phase1_days]
        D_end = bands["D_P50"][phase1_days]
        
        initial_state_phase2[city] = [S_end, E_end, I_end, R_end, D_end]

    # Phase 2: Full Lockdown equivalent
    graph_phase2 = apply_intervention(base_graph, 'full')
    res_phase2 = run_monte_carlo(profile, graph_phase2, origin_node_id, n_runs=n_runs, days=phase2_days, initial_state=initial_state_phase2)
    bands_phase2 = res_phase2["confidence_bands"]

    total_days = phase1_days + phase2_days
    
    # Combine the bands from Phase 1 and Phase 2
    combined_bands = {}
    for city in bands_phase1.keys():
        combined_bands[city] = {}
        for key in ["P10", "P50", "P90", "S_P50", "E_P50", "R_P50", "D_P50"]:
            # Combine phase 1 (all days up to phase1_days) and phase 2 (skip day 0 since it matches phase 1 end)
            list1 = bands_phase1[city][key][:phase1_days + 1]
            list2 = bands_phase2[city][key][1:phase2_days + 1]
            combined_bands[city][key] = list1 + list2

    output = {
        "seird_results": [],
        "city_status": []
    }
    
    scenario_id = profile.get("scenario_id", "")
    version = profile.get("version", 1)
    
    for day in range(total_days + 1):
        inf_p10 = sum(combined_bands[city]["P10"][day] for city in combined_bands)
        inf_p50 = sum(combined_bands[city]["P50"][day] for city in combined_bands)
        inf_p90 = sum(combined_bands[city]["P90"][day] for city in combined_bands)
        
        deaths = sum(combined_bands[city]["D_P50"][day] for city in combined_bands)
        
        output["seird_results"].append({
            "scenario_id": scenario_id,
            "pathogen_profile_version": version,
            "intervention_type": "historical",
            "day": day,
            "infected_p10": float(inf_p10),
            "infected_p50": float(inf_p50),
            "infected_p90": float(inf_p90),
            "deaths_p10": float(deaths),
            "deaths_p50": float(deaths),
            "deaths_p90": float(deaths),
            "trajectory_sample": None
        })
        
        for city, bands in combined_bands.items():
            output["city_status"].append({
                "scenario_id": scenario_id,
                "pathogen_profile_version": version,
                "intervention_type": "historical",
                "city": city,
                "day": day,
                "active_cases_p50": float(bands["P50"][day]),
                "active_cases_p10": float(bands["P10"][day]),
                "active_cases_p90": float(bands["P90"][day]),
            })
            
    return output

from backend.simulator.simulator_io import get_latest_pathogen_profile, write_seird_results, write_city_status
from backend.simulator.mobility_graph import build_graph

if __name__ == "__main__":
    from backend.simulator.supabase_client import get_client

    supabase = get_client()
    scenarios = supabase.table("scenarios").select("*").eq("origin_city", "THRISSUR").execute()
    if not scenarios.data:
        raise RuntimeError("No historical scenario found — run run_historical_simulation.py's setup first.")
    scenario_id = scenarios.data[0]["scenario_id"]

    profile = get_latest_pathogen_profile(scenario_id)
    profile["scenario_id"] = scenario_id

    base_graph = build_graph()

    print(f"Running blended historical simulation for scenario {scenario_id}...")
    result = run_blended_historical(profile, base_graph, "THRISSUR", n_runs=500, phase1_days=55, phase2_days=35)

    print(f"Writing {len(result['seird_results'])} seird_results rows, {len(result['city_status'])} city_status rows...")
    write_seird_results(result["seird_results"])
    write_city_status(result["city_status"])
    print("Done.")
