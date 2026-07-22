import json
import os
import pandas as pd

def generate_nodes():
    current_dir = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.dirname(current_dir)
    
    # 15-city demo scenario nodes
    nodes_data = [
        {"node_id": "THRISSUR", "name": "Thrissur", "state": "Kerala", "is_karnataka": False, "population": 315596, "lat": 10.5276, "lon": 76.2144, "zone": "south", "has_airport": False, "airport_code": None},
        {"node_id": "KOCHI", "name": "Kochi", "state": "Kerala", "is_karnataka": False, "population": 3000000, "lat": 9.9312, "lon": 76.2673, "zone": "south", "has_airport": True, "airport_code": "COK"},
        {"node_id": "THIRUVANANTHAPURAM", "name": "Thiruvananthapuram", "state": "Kerala", "is_karnataka": False, "population": 2500000, "lat": 8.5241, "lon": 76.9366, "zone": "south", "has_airport": True, "airport_code": "TRV"},
        {"node_id": "CHENNAI", "name": "Chennai", "state": "Tamil Nadu", "is_karnataka": False, "population": 11200000, "lat": 13.0827, "lon": 80.2707, "zone": "south", "has_airport": True, "airport_code": "MAA"},
        {"node_id": "BENGALURU", "name": "Bengaluru", "state": "Karnataka", "is_karnataka": True, "population": 12500000, "lat": 12.9716, "lon": 77.5946, "zone": "south", "has_airport": True, "airport_code": "BLR"},
        {"node_id": "MUMBAI", "name": "Mumbai", "state": "Maharashtra", "is_karnataka": False, "population": 20700000, "lat": 19.0760, "lon": 72.8777, "zone": "west", "has_airport": True, "airport_code": "BOM"},
        {"node_id": "DELHI", "name": "Delhi", "state": "Delhi", "is_karnataka": False, "population": 32000000, "lat": 28.6139, "lon": 77.2090, "zone": "north", "has_airport": True, "airport_code": "DEL"},
        {"node_id": "HYDERABAD", "name": "Hyderabad", "state": "Telangana", "is_karnataka": False, "population": 10500000, "lat": 17.3850, "lon": 78.4867, "zone": "south", "has_airport": True, "airport_code": "HYD"},
        {"node_id": "PUNE", "name": "Pune", "state": "Maharashtra", "is_karnataka": False, "population": 7400000, "lat": 18.5204, "lon": 73.8567, "zone": "west", "has_airport": True, "airport_code": "PNQ"},
        {"node_id": "KOLKATA", "name": "Kolkata", "state": "West Bengal", "is_karnataka": False, "population": 14800000, "lat": 22.5726, "lon": 88.3639, "zone": "east", "has_airport": True, "airport_code": "CCU"},
        {"node_id": "AHMEDABAD", "name": "Ahmedabad", "state": "Gujarat", "is_karnataka": False, "population": 8650000, "lat": 23.0225, "lon": 72.5714, "zone": "west", "has_airport": True, "airport_code": "AMD"},
        {"node_id": "JAIPUR", "name": "Jaipur", "state": "Rajasthan", "is_karnataka": False, "population": 4000000, "lat": 26.9124, "lon": 75.7873, "zone": "north", "has_airport": True, "airport_code": "JAI"},
        {"node_id": "LUCKNOW", "name": "Lucknow", "state": "Uttar Pradesh", "is_karnataka": False, "population": 3800000, "lat": 26.8467, "lon": 80.9462, "zone": "north", "has_airport": True, "airport_code": "LKO"},
        {"node_id": "NAGPUR", "name": "Nagpur", "state": "Maharashtra", "is_karnataka": False, "population": 3000000, "lat": 21.1458, "lon": 79.0882, "zone": "central", "has_airport": True, "airport_code": "NAG"},
        {"node_id": "COIMBATORE", "name": "Coimbatore", "state": "Tamil Nadu", "is_karnataka": False, "population": 2100000, "lat": 11.0168, "lon": 76.9558, "zone": "south", "has_airport": True, "airport_code": "CJB"}
    ]
    
    # Add default age distribution to all nodes
    default_age_dist = { "0_14": 0.27, "15_29": 0.28, "30_59": 0.33, "60_plus": 0.12 }
    for node in nodes_data:
        node["age_distribution"] = default_age_dist
        
    output_dir = os.path.join(project_root, "data", "generated")
    os.makedirs(output_dir, exist_ok=True)
    output_file = os.path.join(output_dir, "nodes.json")
    
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(nodes_data, f, indent=4)
        
    print(f"Successfully generated {len(nodes_data)} nodes for demo scenario at {output_file}\n")
    
    df = pd.DataFrame(nodes_data)
    columns_to_show = ["node_id", "name", "state", "population", "zone", "has_airport"]
    summary_df = df[columns_to_show].copy()
    summary_df['population'] = summary_df['population'].apply(lambda x: f"{x:,}")
    
    print("--- Generated Nodes Summary ---")
    print(summary_df.to_string(index=False))

if __name__ == "__main__":
    generate_nodes()
