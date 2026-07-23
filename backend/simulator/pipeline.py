from backend.simulator.monte_carlo import run_monte_carlo, apply_intervention
from backend.simulator.lockdown_optimizer import rank_lockdown_targets
from backend.simulator.mobility_graph import build_graph
import networkx as nx

def run_simulation_pipeline(
    scenario_id: str,
    pathogen_profile: dict,
    origin_city: str,
    intervention_types: list[str],
    n_runs: int = 100,
    days: int = 90
):
    graph = build_graph()
    
    output = {
        "seird_results": [],
        "city_status": [],
        "lockdown_recommendations": [],
        "raw_bands": {}
    }
    
    for intervention_type in intervention_types:
        modified_graph = apply_intervention(graph, intervention_type)
        res = run_monte_carlo(pathogen_profile, modified_graph, origin_city, n_runs=n_runs, days=days)
        
        confidence_bands = res["confidence_bands"]
        peak_infection_day = res["peak_infection_day"]
        
        output["raw_bands"][intervention_type] = confidence_bands
        
        # National Aggregation for seird_results
        for day in range(days + 1):
            inf_p10 = sum(confidence_bands[city]["P10"][day] for city in confidence_bands)
            inf_p50 = sum(confidence_bands[city]["P50"][day] for city in confidence_bands)
            inf_p90 = sum(confidence_bands[city]["P90"][day] for city in confidence_bands)
            
            # Using D_P50 as approximation for p10 and p90 since monte_carlo only returns D_P50
            deaths = sum(confidence_bands[city]["D_P50"][day] for city in confidence_bands)
            
            output["seird_results"].append({
                "scenario_id": scenario_id,
                "pathogen_profile_version": pathogen_profile["version"],
                "intervention_type": intervention_type,
                "day": day,
                "infected_p10": float(inf_p10),
                "infected_p50": float(inf_p50),
                "infected_p90": float(inf_p90),
                "deaths_p10": float(deaths),
                "deaths_p50": float(deaths),
                "deaths_p90": float(deaths),
                "trajectory_sample": None
            })
            
            # city_status rows
            for city, bands in confidence_bands.items():
                output["city_status"].append({
                    "scenario_id": scenario_id,
                    "pathogen_profile_version": pathogen_profile["version"],
                    "intervention_type": intervention_type,
                    "city": city,
                    "day": day,
                    "active_cases_p50": float(bands["P50"][day]),
                    "active_cases_p10": float(bands["P10"][day]),
                    "active_cases_p90": float(bands["P90"][day]),
                })
                
        # Lockdown Recommendations
        num_edges = modified_graph.number_of_edges()
        edge_ranks = rank_lockdown_targets(modified_graph, confidence_bands, peak_infection_day, top_n=num_edges)
        
        city_max_betweenness = {node: 0.0 for node in modified_graph.nodes()}
        for edge in edge_ranks:
            u = edge["source"]
            v = edge["target"]
            betw = float(edge["betweenness"])
            city_max_betweenness[u] = max(city_max_betweenness[u], betw)
            city_max_betweenness[v] = max(city_max_betweenness[v], betw)
            
        try:
            eigenvector_centrality = nx.eigenvector_centrality_numpy(modified_graph, weight='weight')
        except Exception:
            # Fallback if numpy eigenvector centrality fails (e.g. empty graph or not connected)
            eigenvector_centrality = nx.degree_centrality(modified_graph)
            
        city_scores = []
        for city in modified_graph.nodes():
            b_score = city_max_betweenness.get(city, 0.0)
            e_score = float(eigenvector_centrality.get(city, 0.0))
            combined_score = 0.6 * b_score + 0.4 * e_score
            city_scores.append({
                "city": city,
                "betweenness_score": b_score,
                "eigenvector_score": e_score,
                "combined_score": combined_score
            })
            
        city_scores.sort(key=lambda x: x["combined_score"], reverse=True)
        
        for rank, score_data in enumerate(city_scores, start=1):
            output["lockdown_recommendations"].append({
                "scenario_id": scenario_id,
                "pathogen_profile_version": pathogen_profile["version"],
                "intervention_type": intervention_type,
                "city": score_data["city"],
                "priority_rank": rank,
                "betweenness_score": score_data["betweenness_score"],
                "eigenvector_score": score_data["eigenvector_score"]
            })
            
    return output
