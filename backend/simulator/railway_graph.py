import json
import os
import networkx as nx

def get_data_dir():
    current_dir = os.path.dirname(os.path.abspath(__file__))
    return os.path.join(os.path.dirname(os.path.dirname(current_dir)), "data", "generated")

def build_rail_graph():
    edges = [
        # Kerala / Deep South corridor
        {"source": "THRISSUR", "target": "KOCHI", "weight": 40},
        {"source": "THRISSUR", "target": "THIRUVANANTHAPURAM", "weight": 25},
        {"source": "THRISSUR", "target": "COIMBATORE", "weight": 20},
        {"source": "KOCHI", "target": "THIRUVANANTHAPURAM", "weight": 35},
        {"source": "KOCHI", "target": "COIMBATORE", "weight": 15},
        {"source": "COIMBATORE", "target": "CHENNAI", "weight": 45},
        {"source": "COIMBATORE", "target": "BENGALURU", "weight": 30},
        
        # South Hubs
        {"source": "CHENNAI", "target": "BENGALURU", "weight": 60},
        {"source": "CHENNAI", "target": "HYDERABAD", "weight": 40},
        {"source": "BENGALURU", "target": "HYDERABAD", "weight": 35},
        {"source": "BENGALURU", "target": "PUNE", "weight": 25},
        
        # West & Central
        {"source": "PUNE", "target": "MUMBAI", "weight": 80},
        {"source": "MUMBAI", "target": "AHMEDABAD", "weight": 55},
        {"source": "MUMBAI", "target": "NAGPUR", "weight": 30},
        {"source": "MUMBAI", "target": "HYDERABAD", "weight": 25},
        {"source": "AHMEDABAD", "target": "JAIPUR", "weight": 35},
        {"source": "NAGPUR", "target": "HYDERABAD", "weight": 20},
        {"source": "NAGPUR", "target": "DELHI", "weight": 45},
        
        # North & East
        {"source": "JAIPUR", "target": "DELHI", "weight": 65},
        {"source": "DELHI", "target": "LUCKNOW", "weight": 50},
        {"source": "DELHI", "target": "KOLKATA", "weight": 40},
        {"source": "DELHI", "target": "MUMBAI", "weight": 50},
        {"source": "LUCKNOW", "target": "KOLKATA", "weight": 25},
        {"source": "KOLKATA", "target": "NAGPUR", "weight": 20},
        {"source": "KOLKATA", "target": "CHENNAI", "weight": 15}
    ]
    
    for e in edges:
        e["mode"] = "rail"
        
    G = nx.Graph()
    for e in edges:
        G.add_edge(e["source"], e["target"], weight=e["weight"], mode="rail")
        
    out_file = os.path.join(get_data_dir(), "railway_edges.json")
    with open(out_file, 'w') as f:
        json.dump(edges, f, indent=4)
        
    return G

if __name__ == "__main__":
    build_rail_graph()
