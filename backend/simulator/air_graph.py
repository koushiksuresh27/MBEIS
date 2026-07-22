import json
import os
import networkx as nx

def get_data_dir():
    current_dir = os.path.dirname(os.path.abspath(__file__))
    return os.path.join(os.path.dirname(os.path.dirname(current_dir)), "data", "generated")

def build_air_graph():
    # 14 cities with airports (Thrissur has no airport)
    edges = [
        # Major Hubs (BENGALURU, MUMBAI, DELHI, CHENNAI, HYDERABAD, KOLKATA)
        {"source": "DELHI", "target": "MUMBAI", "weight": 5500},
        {"source": "DELHI", "target": "BENGALURU", "weight": 3800},
        {"source": "DELHI", "target": "CHENNAI", "weight": 2200},
        {"source": "DELHI", "target": "KOLKATA", "weight": 2500},
        {"source": "DELHI", "target": "HYDERABAD", "weight": 2300},
        
        {"source": "MUMBAI", "target": "BENGALURU", "weight": 4200},
        {"source": "MUMBAI", "target": "CHENNAI", "weight": 2100},
        {"source": "MUMBAI", "target": "HYDERABAD", "weight": 1900},
        {"source": "MUMBAI", "target": "KOLKATA", "weight": 1800},
        
        {"source": "BENGALURU", "target": "CHENNAI", "weight": 2100},
        {"source": "BENGALURU", "target": "HYDERABAD", "weight": 2400},
        {"source": "BENGALURU", "target": "KOLKATA", "weight": 1900},
        
        {"source": "CHENNAI", "target": "HYDERABAD", "weight": 1600},
        {"source": "CHENNAI", "target": "KOLKATA", "weight": 1500},
        
        {"source": "HYDERABAD", "target": "KOLKATA", "weight": 1400},

        # Connections to other cities
        {"source": "PUNE", "target": "DELHI", "weight": 1500},
        {"source": "PUNE", "target": "BENGALURU", "weight": 1200},
        {"source": "PUNE", "target": "CHENNAI", "weight": 800},
        
        {"source": "AHMEDABAD", "target": "MUMBAI", "weight": 1600},
        {"source": "AHMEDABAD", "target": "DELHI", "weight": 1700},
        {"source": "AHMEDABAD", "target": "BENGALURU", "weight": 900},
        
        {"source": "JAIPUR", "target": "DELHI", "weight": 1100},
        {"source": "JAIPUR", "target": "MUMBAI", "weight": 900},
        
        {"source": "LUCKNOW", "target": "DELHI", "weight": 1300},
        {"source": "LUCKNOW", "target": "MUMBAI", "weight": 800},
        
        {"source": "NAGPUR", "target": "MUMBAI", "weight": 700},
        {"source": "NAGPUR", "target": "DELHI", "weight": 800},
        
        {"source": "KOCHI", "target": "BENGALURU", "weight": 1200},
        {"source": "KOCHI", "target": "MUMBAI", "weight": 900},
        {"source": "KOCHI", "target": "CHENNAI", "weight": 600},
        
        {"source": "THIRUVANANTHAPURAM", "target": "BENGALURU", "weight": 1000},
        {"source": "THIRUVANANTHAPURAM", "target": "CHENNAI", "weight": 700},
        {"source": "THIRUVANANTHAPURAM", "target": "DELHI", "weight": 500},
        
        {"source": "COIMBATORE", "target": "CHENNAI", "weight": 800},
        {"source": "COIMBATORE", "target": "BENGALURU", "weight": 500}
    ]
    
    for e in edges:
        e["mode"] = "air"
        
    G = nx.Graph()
    for e in edges:
        G.add_edge(e["source"], e["target"], weight=e["weight"], mode="air")
        
    out_file = os.path.join(get_data_dir(), "air_edges.json")
    with open(out_file, 'w') as f:
        json.dump(edges, f, indent=4)
        
    return G

if __name__ == "__main__":
    build_air_graph()
