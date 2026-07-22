import json
import os

def generate():
    # Load nodes to get population and state
    current_dir = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.dirname(current_dir)
    nodes_file = os.path.join(project_root, "data", "generated", "nodes.json")
    
    with open(nodes_file, 'r', encoding='utf-8') as f:
        nodes = json.load(f)
        
    # Approx State Population and Beds (2023 NHP rough estimates)
    state_stats = {
        "Telangana": {"pop": 38000000, "beds": 40000},
        "Tamil Nadu": {"pop": 76000000, "beds": 80000},
        "Maharashtra": {"pop": 123000000, "beds": 120000},
        "Goa": {"pop": 1500000, "beds": 3000},
        "Kerala": {"pop": 35000000, "beds": 40000},
        "Delhi": {"pop": 32000000, "beds": 50000},
        "West Bengal": {"pop": 98000000, "beds": 85000},
        "Gujarat": {"pop": 64000000, "beds": 60000},
        "Rajasthan": {"pop": 80000000, "beds": 70000},
        "Uttar Pradesh": {"pop": 240000000, "beds": 120000},
        "Karnataka": {"pop": 67000000, "beds": 70000}
    }
    
    capacity = []
    for node in nodes:
        nid = node["node_id"]
        state = node["state"]
        
        # Estimate dynamic bed capacity
        stats = state_stats.get(state, {"pop": 1000000, "beds": 2000})
        beds = int((node["population"] / stats["pop"]) * stats["beds"])
        
        # Ensure a floor capacity for smaller cities like Thrissur
        beds = max(1000, beds)
        
        capacity.append({
            "node_id": nid,
            "total_beds": beds,
            "overwhelm_threshold_pct": 0.30,
            "data_quality": "estimated"
        })
        
    output_dir = os.path.join(project_root, "data", "generated")
    os.makedirs(output_dir, exist_ok=True)
    out_file = os.path.join(output_dir, "hospital_capacity.json")
    
    with open(out_file, 'w', encoding='utf-8') as f:
        json.dump(capacity, f, indent=4)
        
    print(f"Generated hospital capacity for {len(capacity)} nodes at {out_file}")
    
    # Print preview
    print("\n--- Estimated Beds ---")
    for item in capacity:
        node_name = next(n["name"] for n in nodes if n["node_id"] == item["node_id"])
        print(f"{item['node_id']} ({node_name}): {item['total_beds']} beds")

if __name__ == '__main__':
    generate()
