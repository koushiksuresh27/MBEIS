-- ============================================================================
-- Outbreak Response OS — Phase 1 core schema
-- Migration 3 of 3: Row Level Security policies (Section 11)
-- Built Week 1, not retrofitted later (plan's explicit rule, carried from v2 §7)
-- ============================================================================

-- Enable RLS on every table. Nothing is readable/writable until a policy allows it.
alter table public.user_roles enable row level security;
alter table public.reference_diseases enable row level security;
alter table public.scenarios enable row level security;
alter table public.pathogen_profiles enable row level security;
alter table public.seird_results enable row level security;
alter table public.city_status enable row level security;
alter table public.lockdown_recommendations enable row level security;
alter table public.resource_projections enable row level security;

-- ----------------------------------------------------------------------------
-- Helper: is the current user a planner or analyst? (checked via user_roles)
-- ----------------------------------------------------------------------------
create or replace function public.current_user_role()
returns text
language sql
security definer
stable
as $$
    select role from public.user_roles where user_id = auth.uid();
$$;

-- ----------------------------------------------------------------------------
-- user_roles: a user can read their own row only. No one can self-assign a role
-- via the anon client — role assignment happens via the service role key
-- (e.g. an admin/setup script), never from the frontend.
-- ----------------------------------------------------------------------------
create policy "users can read own role"
    on public.user_roles for select
    using (auth.uid() = user_id);

-- ----------------------------------------------------------------------------
-- reference_diseases: readable by any authenticated planner/analyst.
-- Writes happen only via the service role key (seeded/maintained by the team,
-- not editable from the frontend) — Section 7.3, Abhinav owns sourcing this data.
-- ----------------------------------------------------------------------------
create policy "planners and analysts can read reference_diseases"
    on public.reference_diseases for select
    using (public.current_user_role() in ('planner', 'analyst'));

-- ----------------------------------------------------------------------------
-- scenarios: planners can create scenarios and read all of them (Section 11).
-- analysts have read-only access to everything (Section 11).
-- ----------------------------------------------------------------------------
create policy "planners can insert scenarios"
    on public.scenarios for insert
    with check (public.current_user_role() = 'planner');

create policy "planners and analysts can read scenarios"
    on public.scenarios for select
    using (public.current_user_role() in ('planner', 'analyst'));

-- ----------------------------------------------------------------------------
-- pathogen_profiles, seird_results, city_status, lockdown_recommendations,
-- resource_projections:
-- Read-only for planner/analyst via the anon key. ALL writes to these tables
-- happen exclusively via the service role key from the profiler/simulator
-- Python services (Section 5.2, 11) — never from the frontend, so there is
-- deliberately no insert/update policy for the anon role on any of these.
-- ----------------------------------------------------------------------------
create policy "planners and analysts can read pathogen_profiles"
    on public.pathogen_profiles for select
    using (public.current_user_role() in ('planner', 'analyst'));

create policy "planners and analysts can read seird_results"
    on public.seird_results for select
    using (public.current_user_role() in ('planner', 'analyst'));

create policy "planners and analysts can read city_status"
    on public.city_status for select
    using (public.current_user_role() in ('planner', 'analyst'));

create policy "planners and analysts can read lockdown_recommendations"
    on public.lockdown_recommendations for select
    using (public.current_user_role() in ('planner', 'analyst'));

create policy "planners and analysts can read resource_projections"
    on public.resource_projections for select
    using (public.current_user_role() in ('planner', 'analyst'));

-- ============================================================================
-- NOTE on the service role key (Section 11):
-- The profiler service (Abhinav) and simulator service (Koushik) connect using
-- supabase-py with the SERVICE ROLE key, which bypasses RLS entirely by design —
-- that's how they're able to write to pathogen_profiles/seird_results/etc.
-- despite no insert policy existing above. The service role key must never be
-- used in frontend code or committed to the repo (Section 11's explicit warning
-- about blast radius).
-- ============================================================================
