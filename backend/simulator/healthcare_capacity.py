import json
import os
import numpy as np
 
def get_data_dir():
    return os.path.dirname(os.path.abspath(__file__))
 
def load_capacity():
    cap_file = os.path.join(get_data_dir(), "hospital_capacity.json")
    with open(cap_file, 'r') as f:
        data = json.load(f)
    return {item["node_id"]: item for item in data}

def check_overwhelmed(node_id, I_p50_series, capacity_dict, icu_admission_rate=0.025):
    cap = capacity_dict.get(node_id, {})
    total_beds = cap.get("total_beds", 0)
    icu_beds = cap.get("icu_beds", 0)
    data_quality = cap.get("data_quality", "unknown")

    # ICU overwhelm threshold: ICU beds are the binding constraint
    icu_threshold = icu_beds if icu_beds > 0 else total_beds * 0.05
    
    # Use the dynamic rate instead of a hardcoded number
    overwhelmed_days_mask = np.array(I_p50_series) * icu_admission_rate > icu_threshold

    days_overwhelmed = int(np.sum(overwhelmed_days_mask))
    overwhelmed = days_overwhelmed > 0

    first_overwhelm_day = None
    if overwhelmed:
        first_overwhelm_day = int(np.argmax(overwhelmed_days_mask))

    return {
        "node_id": node_id,
        "total_beds": total_beds,
        "icu_beds": icu_beds,
        "overwhelm_threshold": icu_threshold,
        "overwhelmed": overwhelmed,
        "first_overwhelm_day": first_overwhelm_day,
        "days_overwhelmed": days_overwhelmed,
        "data_quality": data_quality,
        "hospitals": cap.get("hospitals", 0),
        "beds_per_1000_pop": cap.get("beds_per_1000_pop", 0),
        "icu_per_1000_pop": cap.get("icu_per_1000_pop", 0),
    }