import json
import os
import numpy as np

def get_data_dir():
    current_dir = os.path.dirname(os.path.abspath(__file__))
    return os.path.join(os.path.dirname(os.path.dirname(current_dir)), "data", "generated")

def load_capacity():
    cap_file = os.path.join(get_data_dir(), "hospital_capacity.json")
    with open(cap_file, 'r') as f:
        data = json.load(f)
    return {item["node_id"]: item for item in data}

def check_overwhelmed(node_id, I_p50_series, capacity_dict):
    cap = capacity_dict.get(node_id, {})
    total_beds = cap.get("total_beds", 0)
    threshold_pct = cap.get("overwhelm_threshold_pct", 0.30)
    data_quality = cap.get("data_quality", "unknown")
    
    threshold = total_beds * threshold_pct
    
    overwhelmed_days_mask = np.array(I_p50_series) > threshold
    days_overwhelmed = int(np.sum(overwhelmed_days_mask))
    overwhelmed = days_overwhelmed > 0
    
    first_overwhelm_day = None
    if overwhelmed:
        first_overwhelm_day = int(np.argmax(overwhelmed_days_mask))
        
    return {
        "node_id": node_id,
        "total_beds": total_beds,
        "overwhelm_threshold": threshold,
        "overwhelmed": overwhelmed,
        "first_overwhelm_day": first_overwhelm_day,
        "days_overwhelmed": days_overwhelmed,
        "data_quality": data_quality
    }
