import sys
import os
from pathlib import Path

# Root of the project is one level up from backend/
ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional

app = FastAPI(title="OutbreakResponseOS API (v3)", version="3.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

class ProfileRequest(BaseModel):
    scenario_id: str
    # Abhinav can expand this with pathogen_name, pathogen_description, etc.

class SimulateRequest(BaseModel):
    scenario_id: str
    intervention_type: str  # e.g., "none", "rail_only", "partial", "full"

@app.get("/health")
def health():
    return {"status": "ok"}

@app.post("/api/v1/profile")
def profile(payload: ProfileRequest):
    """
    Entry point for the Pathogen Profiler (Abhinav's service).
    Invoked directly by Supabase Edge Function when a planner submits or edits a scenario.
    Reads scenario input, runs Stage 1 (and maybe Stage 2) LLM pipeline, 
    and writes results to pathogen_profiles table.
    """
    # TODO (Abhinav): Implement the profiler logic here.
    return {"status": "success", "message": "Profiler logic not yet implemented."}

@app.post("/api/v1/simulate")
def simulate(payload: SimulateRequest):
    """
    Entry point for the Spread Simulator + Intervention Comparison (Koushik's service).
    Invoked directly by Supabase Edge Function, once per intervention type requested.
    """
    from backend.simulator.seird_engine import run_simulation
    from backend.simulator.resource_calculator import calculate_resource_projections
    from backend.simulator.simulator_io import (
        get_latest_pathogen_profile,
        write_resource_projections
    )
    
    scenario_id = payload.scenario_id
    intervention_type = payload.intervention_type
    origin_city = "THRISSUR"  # Hardcoded origin for Phase 1 as requested
    
    # 1. Fetch pathogen profile from Supabase
    profile = get_latest_pathogen_profile(scenario_id)
    
    # 2. Run simulation pipeline
    output = run_simulation(
        scenario_id=scenario_id,
        origin_city=origin_city,
        intervention_types=[intervention_type],
        n_iterations=50
    )
    
    # 3 & 4. Calculate projections and write back to Supabase
    projections = calculate_resource_projections(
        output["city_status"], 
        scenario_id, 
        profile["version"]
    )
    write_resource_projections(projections)
    
    return {
        "status": "success", 
        "message": f"Simulation for scenario '{scenario_id}' with intervention '{intervention_type}' completed and written to DB."
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
