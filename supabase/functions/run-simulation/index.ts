import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SIMULATOR_URL = Deno.env.get("SIMULATOR_SERVICE_URL")
  ?? "http://127.0.0.1:8000";

serve(async (req) => {
  try {
    // 1. Parse request
    const { scenario_id, intervention_type, n_runs } = await req.json();

    if (!scenario_id) {
      return new Response(
        JSON.stringify({ error: "scenario_id is required" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const inv = intervention_type ?? "all";
    const runs = n_runs ?? 100;

    // 2. Call the Python simulator service
    const resp = await fetch(`${SIMULATOR_URL}/api/v1/simulate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scenario_id,
        intervention_type: inv,
        n_runs: runs,
      }),
    });

    const result = await resp.json();

    if (!resp.ok) {
      return new Response(
        JSON.stringify({ error: result.detail ?? "Simulator error" }),
        { status: resp.status, headers: { "Content-Type": "application/json" } }
      );
    }

    // 3. Return success
    return new Response(
      JSON.stringify(result),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ error: e.message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
