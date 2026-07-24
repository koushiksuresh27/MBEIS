ALTER TABLE public.seird_results
ADD COLUMN IF NOT EXISTS new_infections_trajectory_sample jsonb;
