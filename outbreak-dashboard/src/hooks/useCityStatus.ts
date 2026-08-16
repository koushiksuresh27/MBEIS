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
  const [refetchCount, setRefetchCount] = useState(0);

  useEffect(() => {
    const handler = () => setRefetchCount(c => c + 1);
    window.addEventListener('simulation-complete', handler);
    return () => window.removeEventListener('simulation-complete', handler);
  }, []);

  useEffect(() => {
    async function fetchData() {
      if (!scenarioId) return;
      setLoading(true);
      setError(null);

      try {
        const CITIES = [
          'Ahmedabad','Bengaluru','Bhopal','Chennai','Delhi',
          'Guwahati','Hyderabad','Jaipur','Kochi','Kolkata',
          'Lucknow','Mumbai','Patna','Pune','Visakhapatnam'
        ];

        const grouped: Record<string, Record<string, CityStatus[]>> = {};

        for (const city of CITIES) {
          const { data: results, error: supaError } = await supabase
            .from('city_status')
            .select('day, city, active_cases_p10, active_cases_p50, active_cases_p90, intervention_type')
            .eq('scenario_id', scenarioId)
            .eq('city', city)
            .order('day', { ascending: true })
            .limit(2000);

          if (supaError) throw supaError;

          results?.forEach(row => {
            if (!grouped[row.city]) grouped[row.city] = {};
            if (!grouped[row.city][row.intervention_type]) grouped[row.city][row.intervention_type] = [];
            grouped[row.city][row.intervention_type].push({
              day: row.day,
              city: row.city,
              active_cases_p10: row.active_cases_p10,
              active_cases_p50: row.active_cases_p50,
              active_cases_p90: row.active_cases_p90,
            });
          });
        }

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
