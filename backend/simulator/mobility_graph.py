import json
import os
import networkx as nx
from backend.simulator.railway_graph import build_rail_graph
from backend.simulator.air_graph import build_air_graph

def get_data_dir():
    current_dir = os.path.dirname(os.path.abspath(__file__))
    return os.path.join(os.path.dirname(os.path.dirname(current_dir)), "data", "generated")

def load_nodes():
    nodes_file = os.path.join(get_data_dir(), "nodes.json")
    with open(nodes_file, 'r') as f:
        return json.load(f)

def build_graph():
    rail_g = build_rail_graph()
    air_g = build_air_graph()
    
    G = nx.Graph()
    
    # Load nodes
    nodes = load_nodes()
    for n in nodes:
        G.add_node(n["node_id"], **n)
        
    # Merge rail edges
    for u, v, data in rail_g.edges(data=True):
        if G.has_edge(u, v):
            G[u][v]["weight"] += data["weight"]
            if data["mode"] not in G[u][v]["modes"]:
                G[u][v]["modes"].append(data["mode"])
        else:
            G.add_edge(u, v, weight=data["weight"], modes=[data["mode"]])
            
    # Merge air edges
    for u, v, data in air_g.edges(data=True):
        if G.has_edge(u, v):
            G[u][v]["weight"] += data["weight"]
            if data["mode"] not in G[u][v]["modes"]:
                G[u][v]["modes"].append(data["mode"])
        else:
            G.add_edge(u, v, weight=data["weight"], modes=[data["mode"]])
            
    # Dump to JSON
    data = nx.node_link_data(G)
    out_file = os.path.join(get_data_dir(), "mobility_graph.json")
    with open(out_file, 'w') as f:
        json.dump(data, f, indent=4)
        
    return G

if __name__ == "__main__":
    G = build_graph()
    print("--- Mobility Graph Summary ---")
    print(f"Total Nodes: {G.number_of_nodes()}")
    print(f"Total Edges: {G.number_of_edges()}")
    
    # Top 5 edges by weight
    edges = list(G.edges(data=True))
    edges.sort(key=lambda x: x[2]["weight"], reverse=True)
    
    print("\nTop 5 Edges by Weight:")
    for u, v, d in edges[:5]:
        u_name = G.nodes[u].get("name", u) if G.has_node(u) else u
        v_name = G.nodes[v].get("name", v) if G.has_node(v) else v
        modes = ",".join(d["modes"])
        print(f"{u_name} <-> {v_name} | Weight: {d['weight']} | Modes: {modes}")
