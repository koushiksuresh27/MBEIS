import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

export interface ResourceProjection {
  week: number;
  icu_beds: number;
  non_icu_beds: number;
  isolation_beds: number;
  oxygen_mt: number;
}

export function useResourceProjections(scenarioId: string) {
  const [data, setData] = useState<Record<string, ResourceProjection[]>>({});
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    async function fetchData() {
      if (!scenarioId) return;
      
      setLoading(true);
      setError(null);
      
      try {
        const { data: results, error: supaError } = await supabase
          .from('resource_projections')
          .select('week, intervention_type, city, projected_icu_beds_needed, projected_non_icu_beds_needed, projected_isolation_beds_needed, projected_oxygen_mt_per_day')
          .eq('scenario_id', scenarioId)
          .order('week', { ascending: true });

        if (supaError) throw supaError;

        // We need to aggregate across all cities to get national totals per week
        const aggregated: Record<string, Record<number, ResourceProjection>> = {};
        
        results?.forEach(row => {
          if (!aggregated[row.intervention_type]) {
            aggregated[row.intervention_type] = {};
          }
          
          if (!aggregated[row.intervention_type][row.week]) {
            aggregated[row.intervention_type][row.week] = {
              week: row.week,
              icu_beds: 0,
              non_icu_beds: 0,
              isolation_beds: 0,
              oxygen_mt: 0
            };
          }
          
          const weekData = aggregated[row.intervention_type][row.week];
          weekData.icu_beds += row.projected_icu_beds_needed;
          weekData.non_icu_beds += row.projected_non_icu_beds_needed;
          weekData.isolation_beds += row.projected_isolation_beds_needed;
          weekData.oxygen_mt += row.projected_oxygen_mt_per_day;
        });

        // Convert to array format grouped by intervention
        const grouped: Record<string, ResourceProjection[]> = {};
        for (const [intervention, weeks] of Object.entries(aggregated)) {
          grouped[intervention] = Object.values(weeks).sort((a, b) => a.week - b.week);
        }

        setData(grouped);
      } catch (err: any) {
        setError(err);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [scenarioId]);

  return { data, loading, error };
}
