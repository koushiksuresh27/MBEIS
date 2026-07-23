import subprocess
import time
import requests
import sys
import uuid
import os

# Helper to ensure clean exit
def run_gate():
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    from backend.simulator.supabase_client import get_client
    supabase = get_client()

    print("Seeding test scenario...")
    scenario_id = str(uuid.uuid4())
    supabase.table("scenarios").insert({
        "scenario_id": scenario_id,
        "origin_city": "THRISSUR",
        "start_date": "2026-07-23",
        "pathogen_description": "Edge function test pathogen"
    }).execute()
    
    supabase.table("pathogen_profiles").insert({
        "scenario_id": scenario_id,
        "version": 1,
        "r0_low": 1.4, "r0_most_likely": 2.87, "r0_high": 5.7,
        "incubation_days_low": 2, "incubation_days_most_likely": 5.1,
        "incubation_days_high": 14,
        "cfr_low": 0.005, "cfr_most_likely": 0.023, "cfr_high": 0.072,
        "data_confidence": "high",
        "profile_type": "derived"
    }).execute()

    print("Starting FastAPI backend...")
    backend = subprocess.Popen(["uvicorn", "backend.main:app", "--port", "8000"], shell=True)
    
    print("Starting Supabase Edge Function...")
    # Edge function needs SIMULATOR_SERVICE_URL mapped
    env = os.environ.copy()
    env["SIMULATOR_SERVICE_URL"] = "http://127.0.0.1:8000"
    edge = subprocess.Popen(["supabase", "functions", "serve", "run-simulation", "--no-verify-jwt"], env=env, shell=True)

    try:
        # Wait for servers to spin up
        time.sleep(15)

        print("Sending POST request to edge function...")
        response = requests.post(
            "http://127.0.0.1:54321/functions/v1/run-simulation",
            json={
                "scenario_id": scenario_id,
                "intervention_type": "all",
                "n_runs": 10
            },
            headers={"Content-Type": "application/json"}
        )

        print("Status Code:", response.status_code)
        print("Response Body:", response.text)

        if response.status_code == 200 and "success" in response.text:
            print("PASS: Edge function proxies the request successfully and returns the simulator's success response.")
        else:
            print("FAIL: Did not get success response.")
            sys.exit(1)

    finally:
        print("Terminating servers...")
        backend.kill()
        edge.kill()

if __name__ == "__main__":
    run_gate()
