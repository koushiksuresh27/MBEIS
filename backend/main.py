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
from typing import Optional, List, Dict, Any
import pandas as pd
from groq import Groq

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
    seed_infections: int = 500
    k_sensitivity: float = 35.0

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
    edge_cuts: Optional[List[Dict[str, Any]]] = None
    seed_infections: int = 500
    k_sensitivity: float = 35.0

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
            "--seed_infections", str(payload.seed_infections),
            "--k_sensitivity", str(payload.k_sensitivity),
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
        edge_cuts=payload.edge_cuts,
        n_iterations=payload.n_iterations,
        seed_infections=payload.seed_infections,
        k_sensitivity=payload.k_sensitivity,
        meta_edges_path="backend/simulator/meta_mobility_edges.csv",
    )

    return {"status": "ok", "label": payload.label}

class MessageItem(BaseModel):
    role: str
    content: str

class AssistantChatRequest(BaseModel):
    scenario_id: str
    message: str
    conversation_history: List[MessageItem]

class AssistantChatResponse(BaseModel):
    response: str
    conversation_history: List[dict]

def get_preloaded_context(scenario_id: str, supabase) -> str:
    # Pathogen profile
    pp_res = supabase.table("pathogen_profiles").select("*").eq("scenario_id", scenario_id).limit(1).execute()
    pp = pp_res.data[0] if pp_res.data else {}
    r0 = pp.get("r0_most_likely", "N/A")
    ifr = pp.get("cfr_most_likely", "N/A")
    x = pp.get("incubation_days_most_likely", "N/A")

    # SEIRD results
    sr_res = supabase.table("seird_results").select("*").eq("scenario_id", scenario_id).execute()
    df_sr = pd.DataFrame(sr_res.data) if sr_res.data else pd.DataFrame()
    
    peaks = {}
    for inv in ["none", "rail_only", "partial", "full"]:
        if not df_sr.empty and "intervention_type" in df_sr.columns:
            inv_data = df_sr[df_sr["intervention_type"] == inv]
            if not inv_data.empty:
                max_row = inv_data.loc[inv_data["infected_p50"].idxmax()]
                peaks[inv] = {"peak": int(max_row["infected_p50"]), "day": int(max_row["day"])}
            else:
                peaks[inv] = {"peak": 0, "day": 0}
        else:
            peaks[inv] = {"peak": 0, "day": 0}

    # City status
    cs_res = supabase.table("city_status").select("*").eq("scenario_id", scenario_id).eq("intervention_type", "none").execute()
    df_cs = pd.DataFrame(cs_res.data) if cs_res.data else pd.DataFrame()
    
    top_cities_text = ""
    if not df_cs.empty and "city" in df_cs.columns:
        city_max = df_cs.loc[df_cs.groupby("city")["active_cases_p50"].idxmax()]
        city_max = city_max.sort_values("active_cases_p50", ascending=False).head(5)
        
        for idx, row in enumerate(city_max.itertuples(), 1):
            city_name = row.city
            peak_val = int(row.active_cases_p50)
            peak_day = int(row.day)
            
            city_all = df_cs[df_cs["city"] == city_name].sort_values("day")
            ignition = city_all[city_all["active_cases_p50"] > 100]
            ignition_day = int(ignition.iloc[0]["day"]) if not ignition.empty else peak_day
            
            top_cities_text += f"  {idx}. {city_name} — {peak_val} peak, ignites Day {ignition_day}\n"
    else:
        top_cities_text = "  None\n"

    # Resource projections
    rp_res = supabase.table("resource_projections").select("*").eq("scenario_id", scenario_id).eq("intervention_type", "none").execute()
    df_rp = pd.DataFrame(rp_res.data) if rp_res.data else pd.DataFrame()
    
    icu_max, oxy_max = 0, 0
    if not df_rp.empty:
        icu_max = int(df_rp["projected_icu_beds_needed"].max()) if "projected_icu_beds_needed" in df_rp.columns else 0
        oxy_max = int(df_rp["projected_oxygen_mt_per_day"].max()) if "projected_oxygen_mt_per_day" in df_rp.columns else 0

    context_block = f"""LIVE SIMULATION STATE:
━━━━━━━━━━━━━━━━━━━━
Pathogen: R0={r0}, IFR={ifr}%, serial interval={x}d
Origin: THRISSUR → Kochi (engine alias)
Horizon: 180 days, 128 MC iterations

Intervention peaks (P50):
  Baseline:        {peaks['none']['peak']} infections, Day {peaks['none']['day']}
  Transit Halt:    {peaks['rail_only']['peak']} infections, Day {peaks['rail_only']['day']}
  Partial:         {peaks['partial']['peak']} infections, Day {peaks['partial']['day']}
  Full Quarantine: {peaks['full']['peak']} infections, Day {peaks['full']['day']}

Top burdened cities:
{top_cities_text}
Worst-case resource need (Baseline):
  ICU beds: {icu_max} | Oxygen: {oxy_max} MT/day"""
    return context_block

SYSTEM_PROMPT_TEMPLATE = """---
CRITICAL FORMATTING RULES:
1. NEVER write <function=anything> in your response.
2. NEVER describe what tool you are calling.
3. Tool calls are invisible. Only write the final answer.
4. NEVER say "Let me check..." or "I will now fetch..."

You are ERIS — Epidemic Response Intelligence System,
the analytical layer of the Outbreak Response OS.

You think like a senior epidemiologist who also 
understands policy constraints, mobility networks,
Monte Carlo uncertainty, and Indian public health 
infrastructure (ICMR, MoHFW, IRCTC rail dependency).

You are talking to a planner under time pressure.
Give precise, decisive answers with real numbers.
Never educate — just answer.

{context_block}

Use the preloaded context above to answer directly.
Only call tools for data NOT already shown above.
Never call the same tool twice in one turn.
Max 3 tool calls per response.

RESPONSE FORMAT:
🔴 critical findings
🟡 watch items  
🟢 positive findings
📊 data citations
⚠️ uncertainty flags (wide P10-P90 bands)

End EVERY response with:
"→ Recommended action: [one specific concrete step]"

Under 200 words unless user asks for detail.
Never alarmist, never dismissive. Calibrated only.
---"""

tools = [
    {
        "type": "function",
        "function": {
            "name": "get_simulation_summary",
            "description": "Get full SEIRD curve data for all interventions. Use for trajectory, growth rate, inflection points, day-by-day progression.",
            "parameters": {
                "type": "object",
                "properties": {
                    "intervention_type": {"type": "string", "description": "Optional intervention type to filter by"}
                }
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_city_status",
            "description": "Get per-city breakdown of peak infections, peak day, ignition day. Use for city-level risk questions.",
            "parameters": {
                "type": "object",
                "properties": {
                    "city_name": {"type": "string", "description": "Optional city name to filter by"}
                }
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_resource_projections",
            "description": "Get ICU beds, oxygen, PPE projections per intervention. Use for healthcare capacity and resource shortfall questions.",
            "parameters": {
                "type": "object",
                "properties": {
                    "intervention_type": {"type": "string", "description": "Optional intervention type to filter by"}
                }
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_intervention_comparison",
            "description": "Compare all interventions side by side: peak cases, peak day, deaths Day 90, deaths saved vs baseline, peak delay vs baseline. Use for policy recommendation questions.",
            "parameters": {
                "type": "object",
                "properties": {}
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_pathogen_profile",
            "description": "Get pathogen parameters: R0, IFR, serial interval, incubation period, hospitalization rate. Use when asked about pathogen behavior or why the model produces a certain output.",
            "parameters": {
                "type": "object",
                "properties": {}
            }
        }
    }
]

def execute_tool(name: str, args: dict, scenario_id: str, supabase) -> str:
    try:
        if name == "get_simulation_summary":
            query = supabase.table("seird_results").select("day, infected_p10, infected_p50, infected_p90, deaths_p50, intervention_type").eq("scenario_id", scenario_id)
            if "intervention_type" in args and args["intervention_type"]:
                query = query.eq("intervention_type", args["intervention_type"])
            res = query.execute()
            return json.dumps(res.data)
            
        elif name == "get_city_status":
            query = supabase.table("city_status").select("city, intervention_type, active_cases_p50, day").eq("scenario_id", scenario_id)
            if "city_name" in args and args["city_name"]:
                query = query.eq("city", args["city_name"])
            res = query.execute()
            return json.dumps(res.data)
            
        elif name == "get_resource_projections":
            query = supabase.table("resource_projections").select("week, intervention_type, projected_icu_beds_needed, projected_oxygen_mt_per_day").eq("scenario_id", scenario_id)
            if "intervention_type" in args and args["intervention_type"]:
                query = query.eq("intervention_type", args["intervention_type"])
            res = query.execute()
            return json.dumps(res.data)
            
        elif name == "get_intervention_comparison":
            sr_res = supabase.table("seird_results").select("*").eq("scenario_id", scenario_id).execute()
            df = pd.DataFrame(sr_res.data) if sr_res.data else pd.DataFrame()
            if df.empty: return "[]"
            comp = []
            for inv in df['intervention_type'].unique():
                inv_data = df[df['intervention_type'] == inv]
                peak_row = inv_data.loc[inv_data['infected_p50'].idxmax()]
                d90 = inv_data[inv_data['day'] == 90]
                comp.append({
                    "intervention": inv,
                    "peak_cases": int(peak_row['infected_p50']),
                    "peak_day": int(peak_row['day']),
                    "deaths_day_90": int(d90['deaths_p50'].values[0]) if not d90.empty else 0
                })
            return json.dumps(comp)
            
        elif name == "get_pathogen_profile":
            res = supabase.table("pathogen_profiles").select("*").eq("scenario_id", scenario_id).limit(1).execute()
            return json.dumps(res.data)
            
        return f"Unknown tool: {name}"
    except Exception as e:
        return f"Error executing tool {name}: {str(e)}"

@app.post("/api/v1/assistant/chat", response_model=AssistantChatResponse)
def assistant_chat(payload: AssistantChatRequest):
    from backend.simulator.supabase_client import get_client
    supabase = get_client()
    scenario_id = payload.scenario_id
    
    context_block = get_preloaded_context(scenario_id, supabase)
    sys_prompt = SYSTEM_PROMPT_TEMPLATE.replace("{context_block}", context_block)
    
    recent_history = payload.conversation_history[-6:]
    messages = [{"role": "system", "content": sys_prompt}]
    messages.extend([{"role": m.role, "content": m.content} for m in recent_history])
    messages.append({"role": "user", "content": payload.message})
    
    api_key = os.environ.get("GROQ_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="GROQ_API_KEY not set in environment")
    
    client = Groq(api_key=api_key)
    
    iterations = 0
    final_response = ""
    
    while iterations < 3:
        response = client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=messages,
            tools=tools,
            tool_choice="auto",
            temperature=0.1,
            parallel_tool_calls=False
        )
        
        choice = response.choices[0]
        msg = choice.message
        messages.append(msg.model_dump(exclude_unset=True))
        
        if choice.finish_reason == "tool_calls":
            for tool_call in msg.tool_calls:
                func_name = tool_call.function.name
                func_args = json.loads(tool_call.function.arguments)
                tool_result = execute_tool(func_name, func_args, scenario_id, supabase)
                messages.append({
                    "role": "tool",
                    "tool_call_id": tool_call.id,
                    "content": tool_result
                })
            iterations += 1
        else:
            final_response = msg.content
            break
            
    updated_history = [{"role": m.role, "content": m.content} for m in recent_history]
    updated_history.append({"role": "user", "content": payload.message})
    updated_history.append({"role": "assistant", "content": final_response})
    
    return AssistantChatResponse(
        response=final_response,
        conversation_history=updated_history[-6:]
    )

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)