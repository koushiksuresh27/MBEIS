import networkx as nx

def rank_lockdown_targets(graph, confidence_bands, peak_infection_day, alpha=0.6, beta_weight=0.4, top_n=15):
    ebc = nx.edge_betweenness_centrality(graph, weight='weight')
    
    max_flux = 1
    if graph.number_of_edges() > 0:
        max_flux = max([d.get('weight', 1) for u, v, d in graph.edges(data=True)])
        
    results = []
    for u, v, d in graph.edges(data=True):
        weight = d.get('weight', 1)
        
        u_peak = max(confidence_bands[u]["P50"]) if u in confidence_bands else 0
        v_peak = max(confidence_bands[v]["P50"]) if v in confidence_bands else 0
        
        I_p50_peak = max(u_peak, v_peak)
        
        infection_pressure = I_p50_peak * weight / max_flux if max_flux > 0 else 0
        betweenness = ebc.get((u, v), ebc.get((v, u), 0))
        
        combined_score = alpha * betweenness + beta_weight * infection_pressure
        
        u_name = graph.nodes[u].get('name', u) if graph.has_node(u) else u
        v_name = graph.nodes[v].get('name', v) if graph.has_node(v) else v
        modes = ",".join(d.get('modes', []))
        
        results.append({
            "source": u,
            "target": v,
            "source_name": u_name,
            "target_name": v_name,
            "modes": modes,
            "edge_weight": weight,
            "betweenness": betweenness,
            "infection_pressure": infection_pressure,
            "combined_score": combined_score
        })
        
    results.sort(key=lambda x: x["combined_score"], reverse=True)
    return results[:top_n]
