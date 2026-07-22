-- ============================================================================
-- Outbreak Response OS — Phase 1 core schema
-- Migration 1 of 3: user_roles, reference_diseases, scenarios
-- Per plan v3, Section 6 & 7
-- ============================================================================

-- ----------------------------------------------------------------------------
-- user_roles: narrower role set for Phase 1 (Section 6, 11)
-- 'hospital' role is deferred along with hospital_status — not created this phase
-- ----------------------------------------------------------------------------
create table if not exists public.user_roles (
    user_id uuid primary key references auth.users(id) on delete cascade,
    role text not null check (role in ('planner', 'analyst')),
    created_at timestamptz not null default now()
);

comment on table public.user_roles is
    'Maps an auth user to their role. Phase 1: planner/analyst only — hospital role deferred (Section 6 scope note).';

-- ----------------------------------------------------------------------------
-- reference_diseases: the expanded profiler library (Section 7.1)
-- Created before scenarios, since scenarios references it.
-- Replaces v2's two hardcoded templates (COVID, Dengue) with a real, queryable table.
-- Ranges are stored as [low, high] rather than single point values, since real
-- figures vary by study (Section 7.1's own caveat).
-- ----------------------------------------------------------------------------
create table if not exists public.reference_diseases (
    reference_disease_id uuid primary key default gen_random_uuid(),
    name text not null unique,                          -- e.g. 'COVID-19 (India-calibrated)'
    r0_low numeric,
    r0_high numeric,
    incubation_days_low numeric,
    incubation_days_high numeric,
    cfr_low numeric,                                     -- case fatality rate, as a fraction (0.025 = 2.5%)
    cfr_high numeric,
    transmission_route text not null check (
        transmission_route in ('respiratory', 'close_contact', 'nosocomial', 'vector_borne', 'bodily_fluid')
    ),
    source_citation text,                                 -- e.g. '[1] Nature Sci Reports, Karnataka 2021'
    notes text,
    created_at timestamptz not null default now()
);

comment on table public.reference_diseases is
    'Section 7.1 reference library. Seed data: COVID-19, Nipah, H5N1/H7N9, MERS, Ebola, pandemic influenza. Dengue and TB deliberately excluded (Section 7 / audit note — not person-to-person or not epidemic-acute).';

-- ----------------------------------------------------------------------------
-- scenarios: replaces v2's case_reports as the identifier-minting table (Section 6)
-- A planner creates a scenario deliberately — nothing here is auto-triggered.
-- ----------------------------------------------------------------------------
create table if not exists public.scenarios (
    scenario_id uuid primary key default gen_random_uuid(),
    -- either references reference_diseases (known pathogen) OR is free-text (new/emerging) — not both
    reference_disease_id uuid references public.reference_diseases(reference_disease_id),
    pathogen_description text,                            -- free-text description if not a known reference disease
    origin_city text not null,
    origin_lat double precision,
    origin_lng double precision,
    start_date date not null,
    simulation_window_days integer not null default 90,
    created_by uuid references auth.users(id),
    created_at timestamptz not null default now(),

    constraint scenario_has_pathogen_input check (
        reference_disease_id is not null or pathogen_description is not null
    )
);

comment on table public.scenarios is
    'Planner-initiated scenario. Mints scenario_id, which every downstream table (pathogen_profiles, seird_results, etc.) attaches to (Section 6).';

create index if not exists idx_scenarios_created_by on public.scenarios(created_by);
