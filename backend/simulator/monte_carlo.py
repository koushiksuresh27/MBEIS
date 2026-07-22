import numpy as np
import json
import os
import multiprocessing as mp
from backend.simulator.seird_model import run_seird_node
import sys

def get_data_dir():
    current_dir = os.path.dirname(os.path.abspath(__file__))
    return os.path.join(os.path.dirname(os.path.dirname(current_dir)), "data", "generated")

def run_single_simulation(args):
    seed, profile, nodes, graph_dict, origin_node_id, days = args
    np.random.seed(seed)
    
    conf = profile.get("data_confidence", "MEDIUM")
    widen = 0.0
    if conf == "LOW": widen = 0.20
    elif conf == "MEDIUM": widen = 0.10
    
    base_t = profile["base_template"]
    
    r0_est = profile["R0_estimate"]
    r0_lower = base_t["R0"]["lower_95"] * profile["seasonal_multiplier"]
    r0_upper = base_t["R0"]["upper_95"] * profile["seasonal_multiplier"]
    r0_lower *= (1.0 - widen)
    r0_upper *= (1.0 + widen)
    r0_std = (r0_upper - r0_lower) / 4.0
    sampled_R0 = max(0.1, np.random.normal(r0_est, r0_std))
    
    inc_min = base_t["incubation_days"]["min"]
    inc_max = base_t["incubation_days"]["max"]
    sampled_inc = np.random.uniform(inc_min, inc_max)
    
    cfr_est = base_t["mortality_rate"]["estimate"]
    cfr_std = (base_t["mortality_rate"]["upper_95"] - base_t["mortality_rate"]["lower_95"]) / 4.0
    sampled_cfr = max(0.0, np.random.normal(cfr_est, cfr_std))
    
    duration = base_t["clinical_duration_days"]
    contagiousness = base_t["contagiousness_factor"]
    
    results = {}
    
    total_flux = 0
    neighbor_flux = {}
    if origin_node_id in graph_dict:
        for nbr, d in graph_dict[origin_node_id].items():
            neighbor_flux[nbr] = d.get("weight", 0)
            total_flux += d.get("weight", 0)
            
    for node in nodes:
        nid = node["node_id"]
        pop = node["population"]
        
        seeds = 0
        if nid == origin_node_id:
            seeds = 10
        elif nid in neighbor_flux and total_flux > 0:
            seeds = max(1, int(10 * (neighbor_flux[nid] / total_flux)))
            
        if seeds > 0:
            df = run_seird_node(pop, sampled_R0, sampled_inc, duration, sampled_cfr, contagiousness, seed_infections=seeds, days=days)
            results[nid] = df[['S', 'E', 'I', 'R', 'D']].values
        else:
            arr = np.zeros((days + 1, 5))
            arr[:, 0] = pop
            results[nid] = arr
            
    return results

def run_monte_carlo(profile, graph, origin_node_id, n_runs=100, days=90):
    nodes_file = os.path.join(get_data_dir(), "nodes.json")
    with open(nodes_file, 'r') as f:
        nodes = json.load(f)
        
    seeds = [42] + [np.random.randint(10000, 99999) for _ in range(n_runs - 1)]
    with open(os.path.join(get_data_dir(), "mc_seeds.json"), 'w') as f:
        json.dump(seeds, f)
        
    import networkx as nx
    G = nx.node_link_graph(graph) if isinstance(graph, dict) else graph
    graph_dict = dict(G.adjacency())
    
    args_list = [(s, profile, nodes, graph_dict, origin_node_id, days) for s in seeds]
    
    n_workers = min(mp.cpu_count(), 8)
    with mp.Pool(n_workers) as pool:
        all_results = pool.map(run_single_simulation, args_list)
        
    agg = {}
    for node in nodes:
        nid = node["node_id"]
        matrix = np.array([res[nid] for res in all_results]) # shape: (n_runs, days+1, 5)
        
        p10_I = np.percentile(matrix[:, :, 2], 10, axis=0)
        p50_I = np.percentile(matrix[:, :, 2], 50, axis=0)
        p90_I = np.percentile(matrix[:, :, 2], 90, axis=0)
        
        p50_S = np.percentile(matrix[:, :, 0], 50, axis=0)
        p50_E = np.percentile(matrix[:, :, 1], 50, axis=0)
        p50_R = np.percentile(matrix[:, :, 3], 50, axis=0)
        p50_D = np.percentile(matrix[:, :, 4], 50, axis=0)
        
        peak_day = int(np.argmax(p50_I))
        
        agg[nid] = {
            "P10": p10_I.tolist(),
            "P50": p50_I.tolist(),
            "P90": p90_I.tolist(),
            "S_P50": p50_S.tolist(),
            "E_P50": p50_E.tolist(),
            "R_P50": p50_R.tolist(),
            "D_P50": p50_D.tolist(),
            "peak_day": peak_day
        }
        
    output = {
        "confidence_bands": agg,
        "peak_infection_day": {nid: agg[nid]["peak_day"] for nid in agg}
    }
    
    return output

def apply_intervention(base_graph, intervention_type):
    import networkx as nx
    
    G = nx.node_link_graph(base_graph) if isinstance(base_graph, dict) else base_graph.copy()
    
    if intervention_type == "none":
        pass
    elif intervention_type == "rail_only":
        for u, v, d in G.edges(data=True):
            if "rail" in d.get("mode", "") or "rail" in d.get("modes", []):
                d["weight"] *= 0.1
    elif intervention_type == "partial":
        for u, v, d in G.edges(data=True):
            if d.get("weight", 0) > 40:
                d["weight"] *= 0.5
    elif intervention_type == "full":
        for u, v, d in G.edges(data=True):
            d["weight"] *= 0.2
            
    return G

def run_all_interventions(profile, base_graph, origin_node_id, n_runs=100, days=90):
    interventions = ["none", "rail_only", "partial", "full"]
    results = {}
    for inv in interventions:
        modified_graph = apply_intervention(base_graph, inv)
        results[inv] = run_monte_carlo(profile, modified_graph, origin_node_id, n_runs=n_runs, days=days)
    return results
