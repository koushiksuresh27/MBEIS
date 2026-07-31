import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

export interface ResourceProjection {
  week: number;
  icu_beds: number;
  non_icu_beds: number;
  isolation_beds: number;
  oxygen_mt: number;
}

export interface CityResourceProjection {
  city: string;
  peak_icu_beds: number;
  peak_non_icu_beds: number;
  peak_isolation_beds: number;
  peak_oxygen_mt: number;
}

export function useResourceProjections(scenarioId: string) {
  const [data, setData] = useState<Record<string, ResourceProjection[]>>({});
  const [cityData, setCityData] = useState<Record<string, CityResourceProjection[]>>({});
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

        // National totals per intervention per week (existing behaviour)
        const aggregated: Record<string, Record<number, ResourceProjection>> = {};

        // Per-city peak per intervention (new)
        const cityAgg: Record<string, Record<string, CityResourceProjection>> = {};

        results?.forEach(row => {
          // — national aggregation —
          if (!aggregated[row.intervention_type])
            aggregated[row.intervention_type] = {};
          if (!aggregated[row.intervention_type][row.week])
            aggregated[row.intervention_type][row.week] = {
              week: row.week, icu_beds: 0, non_icu_beds: 0,
              isolation_beds: 0, oxygen_mt: 0
            };
          const w = aggregated[row.intervention_type][row.week];
          w.icu_beds += row.projected_icu_beds_needed;
          w.non_icu_beds += row.projected_non_icu_beds_needed;
          w.isolation_beds += row.projected_isolation_beds_needed;
          w.oxygen_mt += row.projected_oxygen_mt_per_day;

          // — per-city peak aggregation —
          if (!cityAgg[row.intervention_type])
            cityAgg[row.intervention_type] = {};
          const cityKey = row.city;
          if (!cityAgg[row.intervention_type][cityKey])
            cityAgg[row.intervention_type][cityKey] = {
              city: cityKey, peak_icu_beds: 0, peak_non_icu_beds: 0,
              peak_isolation_beds: 0, peak_oxygen_mt: 0
            };
          const c = cityAgg[row.intervention_type][cityKey];
          if (row.projected_icu_beds_needed > c.peak_icu_beds) c.peak_icu_beds = row.projected_icu_beds_needed;
          if (row.projected_non_icu_beds_needed > c.peak_non_icu_beds) c.peak_non_icu_beds = row.projected_non_icu_beds_needed;
          if (row.projected_isolation_beds_needed > c.peak_isolation_beds) c.peak_isolation_beds = row.projected_isolation_beds_needed;
          if (row.projected_oxygen_mt_per_day > c.peak_oxygen_mt) c.peak_oxygen_mt = row.projected_oxygen_mt_per_day;
        });

        const grouped: Record<string, ResourceProjection[]> = {};
        for (const [inv, weeks] of Object.entries(aggregated))
          grouped[inv] = Object.values(weeks).sort((a, b) => a.week - b.week);

        const groupedCity: Record<string, CityResourceProjection[]> = {};
        for (const [inv, cities] of Object.entries(cityAgg))
          groupedCity[inv] = Object.values(cities).sort((a, b) => b.peak_oxygen_mt - a.peak_oxygen_mt);

        setData(grouped);
        setCityData(groupedCity);
      } catch (err: any) {
        setError(err);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [scenarioId]);

  return { data, cityData, loading, error };
}