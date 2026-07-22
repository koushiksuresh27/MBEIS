import json
import os
import sys
import pandas as pd
import networkx as nx
import copy
import shutil
from datetime import datetime

# Ensure correct path resolution
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.simulator.monte_carlo import run_monte_carlo
from backend.simulator.lockdown_optimizer import rank_lockdown_targets
from backend.simulator.healthcare_capacity import load_capacity, check_overwhelmed

def get_data_dir():
    current_dir = os.path.dirname(os.path.abspath(__file__))
    return os.path.join(os.path.dirname(current_dir), "data", "generated")

def get_outputs_dir(event_id):
    current_dir = os.path.dirname(os.path.abspath(__file__))
    outputs_dir = os.path.join(os.path.dirname(current_dir), "outputs", event_id[:8])
    os.makedirs(outputs_dir, exist_ok=True)
    return outputs_dir

def run_phase3(event, profile, origin_node_id, n_runs=100, days=90):
    version = datetime.now().strftime("%Y%m%d%H%M%S")
    out_dir = get_outputs_dir(event.get("event_id", "UNKNOWN_"))
    
    # 1. Load mobility graph
    with open(os.path.join(get_data_dir(), "mobility_graph.json"), 'r') as f:
        graph_data = json.load(f)
    G = nx.node_link_graph(graph_data)
    
    # 2. Check signal_type
    low_fidelity = False
    if event.get("signal_type") == "watch_event":
        n_runs = 20
        low_fidelity = True
        
    # 3. Run Monte Carlo (No Lockdown)
    res_no_lockdown = run_monte_carlo(profile, G, origin_node_id, n_runs=n_runs, days=days)
    
    # 4. Check healthcare capacity
    capacity_dict = load_capacity()
    city_status = {}
    for nid, bands in res_no_lockdown["confidence_bands"].items():
        peak_day = res_no_lockdown["peak_infection_day"].get(nid, 0)
        hc_res = check_overwhelmed(nid, bands["P50"], capacity_dict)
        city_status[nid] = {
            "overwhelmed": hc_res["overwhelmed"],
            "days_overwhelmed": hc_res["days_overwhelmed"],
            "first_overwhelm_day": hc_res["first_overwhelm_day"],
            "peak_day": peak_day
        }
        
    # 5. Lockdown optimizer
    ranked_targets = []
    if not low_fidelity:
        ranked_targets = rank_lockdown_targets(
            G, 
            res_no_lockdown["confidence_bands"], 
            res_no_lockdown["peak_infection_day"], 
            top_n=15
        )
        
        # Scenario 2: Partial Lockdown (remove top 5 edges)
        G_partial = copy.deepcopy(G)
        for t in ranked_targets[:5]:
            if G_partial.has_edge(t["source"], t["target"]):
                G_partial.remove_edge(t["source"], t["target"])
        res_partial = run_monte_carlo(profile, G_partial, origin_node_id, n_runs=20, days=days)
        
        # Scenario 3: Full Lockdown (remove top 15 edges)
        G_full = copy.deepcopy(G)
        for t in ranked_targets[:15]:
            if G_full.has_edge(t["source"], t["target"]):
                G_full.remove_edge(t["source"], t["target"])
        res_full = run_monte_carlo(profile, G_full, origin_node_id, n_runs=20, days=days)
    else:
        res_partial = res_no_lockdown
        res_full = res_no_lockdown
        
    # 6. Write outputs
    output_files = {}
    
    cb_path = os.path.join(out_dir, f"confidence_bands_{version}.json")
    with open(cb_path, 'w') as f:
        # Save only the core bands for JSON dump simplicity if desired, but we'll save the whole structure
        json.dump(res_no_lockdown["confidence_bands"], f, indent=4)
    output_files["confidence_bands"] = cb_path
        
    records = []
    def process_res(scenario_name, res_dict):
        for nid, bands in res_dict["confidence_bands"].items():
            for day, val in enumerate(bands["P50"]):
                records.append({
                    "scenario": scenario_name,
                    "node_id": nid,
                    "day": day,
                    "S": bands["S_P50"][day],
                    "E": bands["E_P50"][day],
                    "I": val,
                    "R": bands["R_P50"][day],
                    "D": bands["D_P50"][day],
                    "I_P10": bands["P10"][day],
                    "I_P90": bands["P90"][day],
                })
                
    process_res("no_lockdown", res_no_lockdown)
    if not low_fidelity:
        process_res("partial_lockdown", res_partial)
        process_res("full_lockdown", res_full)
        
    df = pd.DataFrame(records)
    csv_path = os.path.join(out_dir, f"seird_results_{version}.csv")
    df.to_csv(csv_path, index=False)
    output_files["seird_results"] = csv_path
    
    cs_path = os.path.join(out_dir, f"city_status_{version}.json")
    with open(cs_path, 'w') as f:
        json.dump(city_status, f, indent=4)
    output_files["city_status"] = cs_path
    
    lr_path = os.path.join(out_dir, f"lockdown_recommendations_{version}.json")
    with open(lr_path, 'w') as f:
        json.dump(ranked_targets, f, indent=4)
    output_files["lockdown_recommendations"] = lr_path
    
    mc_src = os.path.join(get_data_dir(), "mc_seeds.json")
    mc_path = os.path.join(out_dir, f"mc_seeds_{version}.json")
    if os.path.exists(mc_src):
        shutil.copy(mc_src, mc_path)
    output_files["mc_seeds"] = mc_path
    
    return output_files, res_no_lockdown, city_status, ranked_targets

if __name__ == "__main__":
    from backend.profiler.pathogen_profiler import profile_pathogen
    
    # 1. Load the event
    current_dir = os.path.dirname(os.path.abspath(__file__))
    sample_file = os.path.join(os.path.dirname(current_dir), "data", "generated", "sample_phase1_event.json")
    with open(sample_file, 'r') as f:
        event = json.load(f)
        
    # 2. Run Phase 2 to get the profile
    profile = profile_pathogen(event)
    
    # 3. Run Phase 3
    print("Running end-to-end Phase 3 Orchestrator...")
    origin = event.get("origin_node_id", "THRISSUR")
    output_files, res_no_lockdown, city_status, ranked_targets = run_phase3(event, profile, origin, n_runs=50, days=90)
    
    # 4. Print summary table
    print("\n--- Summary Table ---")
    
    peak_infected = []
    for nid, bands in res_no_lockdown["confidence_bands"].items():
        peak_i = max(bands["P50"])
        peak_infected.append((nid, peak_i))
    peak_infected.sort(key=lambda x: x[1], reverse=True)
    
    print("\nTop 5 Cities by Peak Infected (P50):")
    for nid, val in peak_infected[:5]:
        print(f"  {nid}: {val:.2f} infections")
        
    print("\nOverwhelmed Cities:")
    found_overwhelmed = False
    for nid, status in city_status.items():
        if status["overwhelmed"]:
            found_overwhelmed = True
            print(f"  {nid}: overwhelmed starting on Day {status['first_overwhelm_day']} (for {status['days_overwhelmed']} days)")
    if not found_overwhelmed:
        print("  None")
            
    if ranked_targets:
        print("\nTop 5 Lockdown Recommendations:")
        for i, t in enumerate(ranked_targets[:5]):
            print(f"  {i+1}. {t['source_name']} <-> {t['target_name']} | Score: {t['combined_score']:.4f}")
            
    print("\n--- Output Files Generated ---")
    for k, v in output_files.items():
        print(f"  {k}: {os.path.basename(v)}")
