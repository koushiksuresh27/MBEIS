import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

export interface PathogenProfile {
  profile_id: string;
  scenario_id: string;
  version: number;
  profile_type: string;
  r0_low: number;
  r0_most_likely: number;
  r0_high: number;
  incubation_days_low: number;
  incubation_days_most_likely: number;
  incubation_days_high: number;
  cfr_low: number;
  cfr_most_likely: number;
  cfr_high: number;
  data_confidence: string;
  derivation_basis: {
    contributing_diseases: Array<{
      name: string;
      weight: number;
      similarity_axes: string[];
    }>;
    reasoning: string;
  } | null;
  matched_reference_disease_id: string | null;
}

export function usePathogenProfile(scenarioId: string) {
  const [profile, setProfile] = useState<PathogenProfile | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    async function fetchProfile() {
      if (!scenarioId) {
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        // Note: Joining with reference_diseases as requested, fetching the specific fields from pathogen_profiles
        const { data, error: fetchError } = await supabase
          .from('pathogen_profiles')
          .select(`
            profile_id,
            scenario_id,
            version,
            profile_type,
            r0_low,
            r0_most_likely,
            r0_high,
            incubation_days_low,
            incubation_days_most_likely,
            incubation_days_high,
            cfr_low,
            cfr_most_likely,
            cfr_high,
            data_confidence,
            derivation_basis,
            matched_reference_disease_id,
            reference_diseases (*)
          `)
          .eq('scenario_id', scenarioId)
          .order('version', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (fetchError) {
          throw fetchError;
        }

        setProfile(data as PathogenProfile | null);
      } catch (err) {
        setError(err instanceof Error ? err : new Error(String(err)));
      } finally {
        setLoading(false);
      }
    }

    fetchProfile();
  }, [scenarioId]);

  return { profile, loading, error };
}
