import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

export interface CityStatus {
  day: number;
  city: string;
  active_cases_p10: number;
  active_cases_p50: number;
  active_cases_p90: number;
}

export function useCityStatus(scenarioId: string) {
  // grouped by city, then by intervention_type
  const [data, setData] = useState<Record<string, Record<string, CityStatus[]>>>({});
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    async function fetchData() {
      if (!scenarioId) return;

      setLoading(true);
      setError(null);

      try {
        const { data: results, error: supaError } = await supabase
          .from('city_status')
          .select('day, city, active_cases_p10, active_cases_p50, active_cases_p90, intervention_type')
          .eq('scenario_id', scenarioId)
          .order('city', { ascending: true })
          .order('day', { ascending: true });

        if (supaError) throw supaError;

        const grouped: Record<string, Record<string, CityStatus[]>> = {};

        results?.forEach(row => {
          if (!grouped[row.city]) {
            grouped[row.city] = {};
          }
          if (!grouped[row.city][row.intervention_type]) {
            grouped[row.city][row.intervention_type] = [];
          }

          grouped[row.city][row.intervention_type].push({
            day: row.day,
            city: row.city,
            active_cases_p10: row.active_cases_p10,
            active_cases_p50: row.active_cases_p50,
            active_cases_p90: row.active_cases_p90,
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
  }, [scenarioId]);

  return { data, loading, error };
}
