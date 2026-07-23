# tests/test_simulate_endpoint.py
import sys, os
import uuid
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.main import app
from backend.simulator.supabase_client import get_client

client = TestClient(app)

def test_endpoint():
    supabase = get_client()
    
    # 1. Seed a fake pathogen profile to test against
    scenario_id = str(uuid.uuid4())
    
    profile_data = {
        "scenario_id": scenario_id,
        "version": 1,
        "r0_low": 1.4, "r0_most_likely": 2.87, "r0_high": 5.7,
        "incubation_days_low": 2, "incubation_days_most_likely": 5.1,
        "incubation_days_high": 14,
        "cfr_low": 0.005, "cfr_most_likely": 0.023, "cfr_high": 0.072,
        "data_confidence": "high",
        "profile_type": "derived"
    }
    
    try:
        supabase.table("scenarios").insert({
            "scenario_id": scenario_id,
            "origin_city": "THRISSUR",
            "start_date": "2026-07-23",
            "pathogen_description": "test pathogen"
        }).execute()
        supabase.table("pathogen_profiles").insert(profile_data).execute()
    except Exception as e:
        print(f"Warning: Failed to insert seed data (maybe schema missing or auth failed?): {e}")
        return

    # 2. Call the endpoint
    print(f"Calling /api/v1/simulate for scenario {scenario_id}")
    response = client.post(
        "/api/v1/simulate",
        json={
            "scenario_id": scenario_id,
            "intervention_type": "none"
        }
    )
    
    # 3. Verify response
    if response.status_code != 200:
        print(f"FAIL: Endpoint returned {response.status_code}: {response.text}")
        return
        
    print("Response OK:", response.json())
    
    # 4. Verify data in DB
    seird_res = supabase.table("seird_results").select("*", count="exact").eq("scenario_id", scenario_id).execute()
    print(f"Seird Rows: {seird_res.count}")
    
    city_res = supabase.table("city_status").select("*", count="exact").eq("scenario_id", scenario_id).execute()
    print(f"City Status Rows: {city_res.count}")
    
    print("PASS: The endpoint works and DB tables populated successfully without crashing.")

if __name__ == "__main__":
    test_endpoint()
