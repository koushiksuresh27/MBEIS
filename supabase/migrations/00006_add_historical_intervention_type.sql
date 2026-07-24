-- ============================================================================
-- Add 'historical' intervention_type for CRPS validation
-- ============================================================================

DO $$ 
DECLARE
    r RECORD;
BEGIN
    -- Dynamically find and drop the existing check constraints for intervention_type
    FOR r IN 
        SELECT n.nspname, t.relname, c.conname 
        FROM pg_constraint c
        JOIN pg_class t ON c.conrelid = t.oid
        JOIN pg_namespace n ON t.relnamespace = n.oid
        WHERE n.nspname = 'public' 
          AND t.relname IN ('seird_results', 'city_status', 'lockdown_recommendations')
          AND c.contype = 'c' 
          AND pg_get_constraintdef(c.oid) ILIKE '%intervention_type%'
    LOOP
        EXECUTE format('ALTER TABLE %I.%I DROP CONSTRAINT %I', r.nspname, r.relname, r.conname);
    END LOOP;
END $$;

-- Add updated constraints including 'historical'
ALTER TABLE public.seird_results 
    ADD CONSTRAINT seird_results_intervention_type_check 
    CHECK (intervention_type IN ('none', 'rail_only', 'partial', 'full', 'historical'));

ALTER TABLE public.city_status 
    ADD CONSTRAINT city_status_intervention_type_check 
    CHECK (intervention_type IN ('none', 'rail_only', 'partial', 'full', 'historical'));

ALTER TABLE public.lockdown_recommendations 
    ADD CONSTRAINT lockdown_recommendations_intervention_type_check 
    CHECK (intervention_type IN ('none', 'rail_only', 'partial', 'full', 'historical'));

-- Add table comment explaining the 'historical' type
COMMENT ON TABLE public.seird_results IS 'Section 8.2 simulator output, tagged by scenario_id + pathogen_profile_version + intervention_type so all intervention variants are independently queryable and comparable side by side. NOTE: The ''historical'' intervention_type is for CRPS validation-only, not a planner-selectable option in the UI.';
