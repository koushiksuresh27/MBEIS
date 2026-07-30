import sys
import os
from pathlib import Path
from fastapi.responses import StreamingResponse
import subprocess, json
import datetime

# Root of the project is one level up from backend/
ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List

app = FastAPI(title="OutbreakResponseOS API (v3)", version="3.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

class ProfileRequest(BaseModel):
    scenario_id: str

class SimulateRequest(BaseModel):
    scenario_id: str
    origin_city: str = "THRISSUR"
    n_iterations: int = 128

class PhaseItem(BaseModel):
    from_day: int
    to_day: int
    intervention: str  # "none" | "rail_only" | "partial" | "full"

class PhasedSimulateRequest(BaseModel):
    scenario_id: str
    origin_city: str = "THRISSUR"
    schedule: List[PhaseItem]
    label: str = "custom_phase_1"
    n_iterations: int = 128

@app.get("/health")
def health():
    return {
        "status": "ok",
        "version": "3.0.0",
        "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat()
    }

@app.post("/api/v1/profile")
def profile(payload: ProfileRequest):
    """
    Entry point for the Pathogen Profiler (Abhinav's service).
    """
    return {"status": "success", "message": "Profiler logic not yet implemented."}

@app.post("/api/v1/simulate")
def simulate(payload: SimulateRequest):
    """
    Streaming entry point for the standard 4-intervention Spread Simulator.
    """
    async def event_stream():
        cmd = [
            sys.executable, "-u", "-m", "backend.simulator.run_scenario",
            "--scenario_id", payload.scenario_id,
            "--origin_city", payload.origin_city,
            "--n_iterations", str(payload.n_iterations),
            "--meta_edges_path", "backend/simulator/meta_mobility_edges.csv"
        ]

        process = subprocess.Popen(
            cmd,
            cwd=str(ROOT),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True
        )

        for line in process.stdout:
            yield f'data: {{"type": "progress", "message": {json.dumps(line.strip())}}}\n\n'

        process.wait()
        if process.returncode == 0:
            yield 'data: {"type": "complete", "message": "Simulation complete"}\n\n'
        else:
            stderr_content = process.stderr.read().strip()
            yield f'data: {{"type": "error", "message": {json.dumps(stderr_content)}}}\n\n'

    return StreamingResponse(event_stream(), media_type="text/event-stream")

@app.post("/api/v1/simulate-phased")
def simulate_phased(payload: PhasedSimulateRequest):
    """
    Runs a phased intervention simulation and writes results to Supabase.
    Blocks until complete (~2-3 min for 128 iterations).
    Results written with intervention_type = label.

    Example:
    {
        "scenario_id": "bb0ff20e-b086-411b-8054-91560b1e88ec",
        "origin_city": "THRISSUR",
        "schedule": [
            {"from_day": 1,  "to_day": 30,  "intervention": "full"},
            {"from_day": 31, "to_day": 60,  "intervention": "partial"},
            {"from_day": 61, "to_day": 180, "intervention": "none"}
        ],
        "label": "custom_phase_1",
        "n_iterations": 128
    }
    """
    # Validate before running
    valid_interventions = {"none", "rail_only", "partial", "full"}
    for phase in payload.schedule:
        if phase.intervention not in valid_interventions:
            raise HTTPException(
                status_code=422,
                detail=f"Invalid intervention '{phase.intervention}'. Must be one of: {sorted(valid_interventions)}"
            )
        if phase.from_day < 1 or phase.to_day > 180:
            raise HTTPException(
                status_code=422,
                detail=f"Days must be between 1 and 180. Got from_day={phase.from_day}, to_day={phase.to_day}"
            )
        if phase.from_day > phase.to_day:
            raise HTTPException(
                status_code=422,
                detail=f"from_day ({phase.from_day}) must be <= to_day ({phase.to_day})"
            )

    from backend.simulator.seird_engine import run_phased_simulation

    schedule = [p.dict() for p in payload.schedule]

    run_phased_simulation(
        scenario_id=payload.scenario_id,
        origin_city=payload.origin_city,
        schedule=schedule,
        label=payload.label,
        n_iterations=payload.n_iterations,
        meta_edges_path="backend/simulator/meta_mobility_edges.csv",
    )

    return {"status": "ok", "label": payload.label}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)