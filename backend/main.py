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
    origin_city: str = "THRISSUR"
    n_iterations: int = 128

@app.get("/health")
def health():
    return {"status": "ok", "version": "3.0.0", "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat()}

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
    Streaming entry point for the Spread Simulator.
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

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
