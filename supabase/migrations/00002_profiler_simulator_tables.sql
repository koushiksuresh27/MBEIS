-- ============================================================================
-- Outbreak Response OS — Phase 1 core schema
-- Migration 2 of 3: pathogen_profiles, seird_results, city_status,
--                    lockdown_recommendations, resource_projections
-- Per plan v3, Section 6, 7.2, 8
-- ============================================================================

-- ----------------------------------------------------------------------------
-- pathogen_profiles: Abhinav's profiler output (Section 7.2)
-- Versioned, NEVER overwritten — each recalc/re-run writes a new row with an
-- incremented version, never an UPDATE to an existing row.
-- ----------------------------------------------------------------------------
create table if not exists public.pathogen_profiles (
    profile_id uuid primary key default gen_random_uuid(),
    scenario_id uuid not null references public.scenarios(scenario_id) on delete cascade,
    version integer not null default 1,

    profile_type text not null check (profile_type in ('matched', 'derived')),

    -- estimated parameters (always a range, never a bare point estimate — Section 7.2)
    r0_low numeric,
    r0_high numeric,
    incubation_days_low numeric,
    incubation_days_high numeric,
    cfr_low numeric,
    cfr_high numeric,

    data_confidence text check (data_confidence in ('low', 'medium', 'high')),

    -- populated only when profile_type = 'matched'
    matched_reference_disease_id uuid references public.reference_diseases(reference_disease_id),

    -- populated only when profile_type = 'derived' — Section 7.2's provenance requirement.
    -- Structure: [{ "reference_disease_id": "...", "name": "Nipah", "weight": 0.7,
    --               "driven_by": "close-contact transmission route, high severity" }, ...]
    derivation_basis jsonb,

    created_at timestamptz not null default now(),

    unique (scenario_id, version)
);

comment on table public.pathogen_profiles is
    'Section 7.2 profiler output. Never overwritten — Command layer always selects highest version per scenario_id (Section 6 rule, carried over from v2).';

create index if not exists idx_pathogen_profiles_scenario on public.pathogen_profiles(scenario_id, version desc);

-- ----------------------------------------------------------------------------
-- seird_results: Koushik's simulator output, per intervention variant (Section 8.2)
-- P10/P50/P90 aggregate bands stored per day; individual trajectory sample
-- stored separately (trajectory_sample) as a JSON array for the spaghetti chart.
-- ----------------------------------------------------------------------------
create table if not exists public.seird_results (
    result_id uuid primary key default gen_random_uuid(),
    scenario_id uuid not null references public.scenarios(scenario_id) on delete cascade,
    pathogen_profile_version integer not null,
    intervention_type text not null check (
        intervention_type in ('none', 'rail_only', 'partial', 'full')
    ),

    day integer not null,                                  -- day index within simulation_window_days

    -- aggregate bands, national or per-scenario level (city-level detail lives in city_status)
    infected_p10 numeric,
    infected_p50 numeric,
    infected_p90 numeric,
    deaths_p10 numeric,
    deaths_p50 numeric,
    deaths_p90 numeric,

    -- representative individual trajectories for the spaghetti/individual view (Section 9.3)
    -- structure: [{"trajectory_id": 1, "infected": 1234, "deaths": 12}, ...]
    trajectory_sample jsonb,

    created_at timestamptz not null default now()
);

comment on table public.seird_results is
    'Section 8.2 simulator output, tagged by scenario_id + pathogen_profile_version + intervention_type so all four intervention variants are independently queryable and comparable side by side.';

create index if not exists idx_seird_results_scenario on public.seird_results(scenario_id, intervention_type, day);

-- ----------------------------------------------------------------------------
-- city_status: per-city breakdown of the same simulation run (Section 6, 8.2)
-- ----------------------------------------------------------------------------
create table if not exists public.city_status (
    status_id uuid primary key default gen_random_uuid(),
    scenario_id uuid not null references public.scenarios(scenario_id) on delete cascade,
    pathogen_profile_version integer not null,
    intervention_type text not null check (
        intervention_type in ('none', 'rail_only', 'partial', 'full')
    ),
    city text not null,
    day integer not null,

    active_cases_p50 numeric,
    active_cases_p10 numeric,
    active_cases_p90 numeric,

    created_at timestamptz not null default now()
);

comment on table public.city_status is
    'Per-city projected caseload for a given scenario/intervention/day. Feeds resource_projections (Section 8.3) and the bubble-map choropleth (Section 9.3).';

create index if not exists idx_city_status_scenario_city on public.city_status(scenario_id, intervention_type, city, day);

-- ----------------------------------------------------------------------------
-- lockdown_recommendations: betweenness/eigenvector-ranked city priority list
-- (Section 8.1, tagged per intervention_type where relevant per Section 6)
-- ----------------------------------------------------------------------------
create table if not exists public.lockdown_recommendations (
    recommendation_id uuid primary key default gen_random_uuid(),
    scenario_id uuid not null references public.scenarios(scenario_id) on delete cascade,
    pathogen_profile_version integer not null,
    intervention_type text not null check (
        intervention_type in ('none', 'rail_only', 'partial', 'full')
    ),
    city text not null,
    priority_rank integer not null,
    betweenness_score numeric,
    eigenvector_score numeric,
    created_at timestamptz not null default now()
);

comment on table public.lockdown_recommendations is
    'City priority ranking for a given scenario/intervention, from Section 8.1''s betweenness + eigenvector centrality optimizer.';

create index if not exists idx_lockdown_recs_scenario on public.lockdown_recommendations(scenario_id, intervention_type, priority_rank);

-- ----------------------------------------------------------------------------
-- resource_projections: beds/oxygen/staff shortfall by city/week (Section 8.3)
-- Phase 1: compared against the fixed [G1] national capacity ceiling,
-- NOT a live hospital_status join (hospital reporting deferred this phase).
-- ----------------------------------------------------------------------------
create table if not exists public.resource_projections (
    projection_id uuid primary key default gen_random_uuid(),
    scenario_id uuid not null references public.scenarios(scenario_id) on delete cascade,
    pathogen_profile_version integer not null,
    intervention_type text not null check (
        intervention_type in ('none', 'rail_only', 'partial', 'full')
    ),
    city text not null,
    week integer not null,

    projected_icu_beds_needed numeric,
    projected_non_icu_beds_needed numeric,
    projected_isolation_beds_needed numeric,
    projected_oxygen_mt_per_day numeric,                   -- metric tonnes/day, per [G1]'s conversion

    -- Phase 1: fixed constant, not a live per-city figure (see plan Section 8.3 scope note)
    capacity_ceiling_oxygen_mt_per_day numeric default 17000,

    created_at timestamptz not null default now()
);

comment on table public.resource_projections is
    'Section 8.3 resource translation. Phase 1 uses [G1]-sourced fixed ratios (2.5% ICU, 20.5% non-ICU-oxygen per 100 active cases; 24/10 L-min flow rates) against a fixed national capacity ceiling — no hospital_status join this phase.';

create index if not exists idx_resource_projections_scenario on public.resource_projections(scenario_id, intervention_type, city, week);
