-- ============================================================================
-- Outbreak Response OS — Phase 1 core schema update
-- Migration 4: Add _most_likely columns to pathogen_profiles and reference_diseases
-- Required to support triangular distribution sampling in the Monte Carlo simulator.
-- ============================================================================

-- Add _most_likely columns to pathogen_profiles
ALTER TABLE public.pathogen_profiles ADD COLUMN IF NOT EXISTS r0_most_likely numeric;
ALTER TABLE public.pathogen_profiles ADD COLUMN IF NOT EXISTS incubation_days_most_likely numeric;
ALTER TABLE public.pathogen_profiles ADD COLUMN IF NOT EXISTS cfr_most_likely numeric;

-- Update comment for pathogen_profiles to reflect the new triple structure
COMMENT ON TABLE public.pathogen_profiles IS
    'Section 7.2 profiler output. Stores parameters as (low, most_likely, high) triples. Never overwritten — Command layer always selects highest version per scenario_id (Section 6 rule, carried over from v2).';

-- Add _most_likely columns to reference_diseases
ALTER TABLE public.reference_diseases ADD COLUMN IF NOT EXISTS r0_most_likely numeric;
ALTER TABLE public.reference_diseases ADD COLUMN IF NOT EXISTS incubation_days_most_likely numeric;
ALTER TABLE public.reference_diseases ADD COLUMN IF NOT EXISTS cfr_most_likely numeric;

-- Update comment for reference_diseases to reflect the new triple structure
COMMENT ON TABLE public.reference_diseases IS
    'Section 7.1 reference library. Stores parameter ranges as (low, most_likely, high) triples. Seed data: COVID-19, Nipah, H5N1/H7N9, MERS, Ebola, pandemic influenza. Dengue and TB deliberately excluded (Section 7 / audit note — not person-to-person or not epidemic-acute).';
