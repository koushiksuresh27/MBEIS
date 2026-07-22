// supabase/functions/planner-copilot/index.ts
//
// Planner copilot — Supabase Edge Function (Deno/TypeScript).
// Per plan Section 5.2 and Section 10: this is NOT a Python backend service.
// It runs on Supabase's own infrastructure, holds the LLM API key as a secret,
// validates LLM tool-calls against a schema, queries Postgres with the service
// role key, and returns a formatted result. The frontend invokes it via
// supabase.functions.invoke('planner-copilot', {...}).
//
// Grounding rule (Section 10): every claim in a response must be traceable to
// pathogen_profiles / seird_results / resource_projections — never free-generate
// an epidemiological claim not backed by a Postgres query result.
//
// STATUS: scaffold only, not yet implemented.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

serve(async (req) => {
  // TODO: parse the planner's question from req.json()
  // TODO: call the LLM API with tool-calling enabled, constrained to a defined
  //       schema of allowed query types (e.g. "summarize scenario", "compare
  //       intervention X vs Y", "explain lockdown ranking")
  // TODO: validate the LLM's requested tool call against that schema
  // TODO: execute the corresponding Postgres query using the service role key
  //       (createClient with SUPABASE_SERVICE_ROLE_KEY, held as an Edge Function secret)
  // TODO: pass the query result back to the LLM to format as a plain-language answer
  // TODO: return the formatted answer as JSON

  return new Response(
    JSON.stringify({ status: "not_implemented" }),
    { headers: { "Content-Type": "application/json" } }
  );
});
