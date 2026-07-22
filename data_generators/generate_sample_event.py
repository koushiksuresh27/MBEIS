import json
import os

def generate():
    event = {
        "event_id": "covid-2020-india-thrissur-001",
        "location_city": "Thrissur",
        "location_state": "Kerala",
        "origin_node_id": "THRISSUR",
        "symptoms_list": ["fever", "cough", "fatigue", "loss_of_taste", "loss_of_smell", "shortness_of_breath"],
        "report_count": 5,
        "status": "active",
        "initial_risk_score": 85.0,
        "confidence_score": 0.6,
        "source_credibility": 0.7,
        "signal_type": "outbreak_event",
        "first_detected_at": "2020-01-30T12:00:00Z",
        "zone": "metro"
    }
    
    current_dir = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.dirname(current_dir)
    output_dir = os.path.join(project_root, "data", "generated")
    os.makedirs(output_dir, exist_ok=True)
    
    out_file = os.path.join(output_dir, "sample_phase1_event.json")
    with open(out_file, 'w') as f:
        json.dump(event, f, indent=4)
        
    print(f"Generated sample Phase 1 event at {out_file}")

if __name__ == '__main__':
    generate()
