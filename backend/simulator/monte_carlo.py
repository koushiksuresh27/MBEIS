import numpy as np
import json
import os
import multiprocessing as mp
import scipy.stats as stats
from backend.simulator.seird_model import run_seird_node
import sys

def get_data_dir():
    current_dir = os.path.dirname(os.path.abspath(__file__))
    return os.path.join(os.path.dirname(os.path.dirname(current_dir)), "data", "generated")

def run_single_simulation(args):
    if len(args) == 8:
        sampled_R0, sampled_inc, sampled_cfr, nodes, graph_dict, origin_node_id, days, initial_state = args
    else:
        sampled_R0, sampled_inc, sampled_cfr, nodes, graph_dict, origin_node_id, days = args
        initial_state = None
    
    # Defaults since flat profile doesn't include these
    duration = 10
    contagiousness = 1.0
    
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
        
        if initial_state is not None and nid in initial_state:
            node_initial_state = initial_state[nid]
            df = run_seird_node(pop, sampled_R0, sampled_inc, duration, sampled_cfr, contagiousness, seed_infections=0, days=days, initial_state=node_initial_state)
            results[nid] = df[['S', 'E', 'I', 'R', 'D']].values
        else:
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

def run_monte_carlo(profile, graph, origin_node_id, n_runs=100, days=90, initial_state=None):
    nodes_file = os.path.join(get_data_dir(), "nodes.json")
    with open(nodes_file, 'r') as f:
        nodes = json.load(f)
        
    import networkx as nx
    G = nx.node_link_graph(graph) if isinstance(graph, dict) else graph
    graph_dict = dict(G.adjacency())
    
    sampler = stats.qmc.Halton(d=3, scramble=False)
    n_base = (n_runs + 1) // 2
    base_samples = sampler.random(n=n_base)
    
    samples = []
    for u in base_samples:
        samples.append(u)
        if len(samples) < n_runs:
            samples.append(1.0 - u)
            
    samples = np.array(samples)
    
    def get_triang_params(low, most_likely, high):
        if high == low:
            return 0.5, low, 1e-9
        c = (most_likely - low) / (high - low)
        c = max(0.0, min(1.0, c))
        return c, low, high - low
        
    r0_c, r0_loc, r0_scale = get_triang_params(
        profile["r0_low"], profile["r0_most_likely"], profile["r0_high"]
    )
    inc_c, inc_loc, inc_scale = get_triang_params(
        profile["incubation_days_low"], profile["incubation_days_most_likely"], profile["incubation_days_high"]
    )
    cfr_c, cfr_loc, cfr_scale = get_triang_params(
        profile["cfr_low"], profile["cfr_most_likely"], profile["cfr_high"]
    )
    
    r0_samples = stats.triang.ppf(samples[:, 0], c=r0_c, loc=r0_loc, scale=r0_scale)
    inc_samples = stats.triang.ppf(samples[:, 1], c=inc_c, loc=inc_loc, scale=inc_scale)
    cfr_samples = stats.triang.ppf(samples[:, 2], c=cfr_c, loc=cfr_loc, scale=cfr_scale)
    
    args_list = [
        (r0_samples[i], inc_samples[i], cfr_samples[i], nodes, graph_dict, origin_node_id, days, initial_state)
        for i in range(n_runs)
    ]
    
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
