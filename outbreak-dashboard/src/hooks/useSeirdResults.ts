import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

export interface SeirdResult {
  day: number;
  infected_p10: number;
  infected_p50: number;
  infected_p90: number;
  deaths_p10: number;
  deaths_p50: number;
  deaths_p90: number;
  trajectory_sample?: number[];
}

export function useSeirdResults(scenarioId: string) {
  const [data, setData] = useState<Record<string, SeirdResult[]>>({});
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);
  const [refetchCount, setRefetchCount] = useState(0);

  useEffect(() => {
    const handler = () => setRefetchCount(c => c + 1);
    window.addEventListener('simulation-complete', handler);
    return () => window.removeEventListener('simulation-complete', handler);
  }, []);

  useEffect(() => {
    async function fetchData() {
      if (!scenarioId) return;
      
      try {
        setLoading(true);

        const { data: latest } = await supabase
          .from('seird_results')
          .select('created_at')
          .eq('scenario_id', scenarioId)
          .order('created_at', { ascending: false })
          .limit(1)
          .single();

        if (!latest) { 
          setData({}); 
          return; 
        }
        
        const latestCreatedAt = latest.created_at;

        const { data: results, error: supaError } = await supabase
          .from('seird_results')
          .select('day, infected_p10, infected_p50, infected_p90, deaths_p10, deaths_p50, deaths_p90, intervention_type, trajectory_sample')
          .eq('scenario_id', scenarioId)
          .eq('created_at', latestCreatedAt)
          .order('day', { ascending: true });

        if (supaError) throw supaError;

        const grouped: Record<string, SeirdResult[]> = {};
        
        results?.forEach(row => {
          if (!grouped[row.intervention_type]) {
            grouped[row.intervention_type] = [];
          }
          grouped[row.intervention_type].push({
            day: row.day,
            infected_p10: row.infected_p10,
            infected_p50: row.infected_p50,
            infected_p90: row.infected_p90,
            deaths_p10: row.deaths_p10,
            deaths_p50: row.deaths_p50,
            deaths_p90: row.deaths_p90,
            trajectory_sample: row.trajectory_sample,
          });
        });

        setData(grouped);
      } catch (err: any) {
        setError(err);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [scenarioId, refetchCount]);

  return { data, loading, error };
}
