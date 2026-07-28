import { useState, useMemo } from 'react';
import { useSeirdResults } from '../hooks/useSeirdResults';
import { useResourceProjections } from '../hooks/useResourceProjections';
import { useCityStatus } from '../hooks/useCityStatus';

const SCENARIO_ID = 'bb0ff20e-b086-411b-8054-91560b1e88ec';

const INTERVENTIONS = [
  { key: 'none', label: 'Baseline (None)', color: 'var(--color-status-red)' },
  { key: 'rail_only', label: 'Transit Halt', color: 'var(--color-status-amber)' },
  { key: 'partial', label: 'Partial Lockdown', color: 'var(--color-primary)' },
  { key: 'full', label: 'Full Quarantine', color: 'var(--color-status-green)' }
];

export default function PlannerView() {
  const { data: seirdData, loading: seirdLoading, error: seirdError } = useSeirdResults(SCENARIO_ID);
  const { data: resourceData, loading: resLoading, error: resError } = useResourceProjections(SCENARIO_ID);
  const { data: cityData, error: cityError } = useCityStatus(SCENARIO_ID);

  const [activeLines, setActiveLines] = useState<Record<string, boolean>>({
    none: true,
    rail_only: true,
    partial: true,
    full: true
  });

  const toggleLine = (key: string) => {
    setActiveLines(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const isLoading = seirdLoading || resLoading || !cityData;
  const hasError = seirdError || resError || cityError;

  // 1. Compute National Snapshot Stats
  const nationalStats = useMemo(() => {
    if (!seirdData) return {};
    const stats: Record<string, { peakInfections: number, peakDay: number, day90Deaths: number, verdict: string }> = {};

    INTERVENTIONS.forEach(inv => {
      const invData = seirdData[inv.key] || [];
      let peakInfections = 0;
      let peakDay = 0;
      let day90Deaths = 0;
      
      invData.forEach(d => {
        if (d.infected_p50 > peakInfections) {
          peakInfections = d.infected_p50;
          peakDay = d.day;
        }
        if (d.day === 90) {
          day90Deaths = d.deaths_p50;
        }
      });
      
      // Fallback if exactly 90 doesn't exist
      if (day90Deaths === 0 && invData.length > 0) {
        day90Deaths = invData[invData.length - 1].deaths_p50;
      }
      
      let verdict = '';
      if (peakInfections > 150) {
        verdict = "High transmission — intervention critical";
      } else if (peakInfections >= 50 && peakInfections <= 150) {
        verdict = "Moderate spread — monitor closely";
      } else {
        verdict = "Contained — intervention effective";
      }

      stats[inv.key] = { peakInfections, peakDay, day90Deaths, verdict };
    });
    
    return stats;
  }, [seirdData]);

  // 2. Compute City Status Table
  const cityTableData = useMemo(() => {
    if (!cityData) return [];
    const cityNames = Object.keys(cityData);
    
    const rows = cityNames.map(city => {
      const cityRow: Record<string, any> = { city };
      INTERVENTIONS.forEach(inv => {
        const invArray = cityData[city]?.[inv.key] || [];
        const day90Obj = invArray.find((d: any) => d.day === 90) || invArray[invArray.length - 1];
        cityRow[inv.key] = day90Obj ? parseFloat(String(day90Obj.active_cases_p50 ?? '0')) : 0;
      });
      return cityRow;
    });

    // Sort by baseline (none) highest descending
    rows.sort((a, b) => b.none - a.none);
    return rows;
  }, [cityData]);

  // 3. Compute Resource Shortfall Summary
  const resourceStats = useMemo(() => {
    if (!resourceData) return { resources: {}, capacityCeiling: 0 };
    const resources: Record<string, { peakOxygen: number, peakICU: number, shortfall: number }> = {};
    let capacityCeiling = 0;

    INTERVENTIONS.forEach(inv => {
      const invWeeks = resourceData[inv.key] || [];
      let peakOxygen = 0;
      let peakICU = 0;
      
      invWeeks.forEach((w: any) => {
        if (w.projected_oxygen_mt_per_day > peakOxygen) {
          peakOxygen = w.projected_oxygen_mt_per_day;
        }
        if (w.projected_icu_beds_needed > peakICU) {
          peakICU = w.projected_icu_beds_needed;
        }
        if (w.capacity_ceiling_oxygen_mt_per_day > capacityCeiling) {
          capacityCeiling = w.capacity_ceiling_oxygen_mt_per_day;
        }
      });
      
      const shortfall = peakOxygen - capacityCeiling;
      resources[inv.key] = { peakOxygen, peakICU, shortfall };
    });

    return { resources, capacityCeiling };
  }, [resourceData]);

  const getCityCellColor = (val: number) => {
    if (val > 50) return 'text-[var(--color-status-red)]';
    if (val >= 20) return 'text-[var(--color-status-amber)]';
    return 'text-[var(--color-status-green)]';
  };

  if (isLoading) return <div className="p-8 text-on-background font-mono">Loading simulation results...</div>;
  if (hasError) return <div className="p-8 text-[var(--color-error)] font-mono">Failed to load data.</div>;

  return (
    <div className="flex flex-col h-full bg-background overflow-hidden">
      <main className="flex-1 p-6 space-y-8 max-w-[1440px] mx-auto w-full overflow-y-auto">
        
        {/* Section 1: Intervention Selector */}
        <section className="bg-surface-variant rounded-xl border border-outline p-6 shadow-sm flex flex-wrap gap-2">
          {INTERVENTIONS.map(inv => {
            const isActive = activeLines[inv.key];
            return (
              <button
                key={inv.key}
                onClick={() => toggleLine(inv.key)}
                className={`flex items-center gap-2 text-sm px-3 py-1.5 rounded-full transition-colors border ${
                  isActive 
                    ? 'bg-surface border-outline text-on-surface' 
                    : 'bg-transparent border-outline/50 text-on-surface-variant opacity-60'
                }`}
              >
                <span className="w-3 h-3 rounded-full" style={{ backgroundColor: inv.color }}></span>
                <span className="font-mono font-medium">{inv.label}</span>
              </button>
            );
          })}
        </section>

        {/* Section 2: National Snapshot Cards */}
        <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {INTERVENTIONS.map(inv => {
            if (!activeLines[inv.key]) return null;
            const stat = nationalStats[inv.key];
            if (!stat) return null;

            let verdictColor = 'text-[var(--color-status-green)]';
            if (stat.verdict.includes('critical')) verdictColor = 'text-[var(--color-status-red)]';
            else if (stat.verdict.includes('Moderate')) verdictColor = 'text-[var(--color-status-amber)]';

            return (
              <div 
                key={`national-${inv.key}`}
                className="bg-surface-variant rounded-xl border border-outline p-6 shadow-sm flex flex-col gap-4"
                style={{ borderTopWidth: '4px', borderTopColor: inv.color }}
              >
                <h3 className="font-sans font-semibold text-on-background">{inv.label} Snapshot</h3>
                <div className="flex flex-col gap-1">
                  <span className="text-xs text-on-surface-variant font-mono uppercase tracking-wider">Peak Active Infections</span>
                  <span className="font-mono text-xl text-on-surface">
                    {Math.round(stat.peakInfections).toLocaleString()} <span className="text-sm text-on-surface-variant">on Day {stat.peakDay}</span>
                  </span>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-xs text-on-surface-variant font-mono uppercase tracking-wider">Total Deaths (Day 90)</span>
                  <span className="font-mono text-xl text-on-surface">
                    {Math.round(stat.day90Deaths).toLocaleString()}
                  </span>
                </div>
                <div className={`mt-auto pt-4 border-t border-outline font-sans font-medium text-sm ${verdictColor}`}>
                  {stat.verdict}
                </div>
              </div>
            );
          })}
        </section>

        {/* Section 3: City Status Table */}
        <section className="bg-surface-variant rounded-xl border border-outline shadow-sm overflow-hidden flex flex-col">
          <div className="p-6 border-b border-outline">
            <h3 className="text-lg font-semibold text-on-background font-sans">Day 90 Active Cases per City</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left font-mono text-sm">
              <thead className="bg-surface border-b border-outline text-on-surface-variant text-xs uppercase">
                <tr>
                  <th className="px-6 py-3 font-medium">City</th>
                  {INTERVENTIONS.map(inv => activeLines[inv.key] && (
                    <th key={`th-${inv.key}`} className="px-6 py-3 font-medium">{inv.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-outline bg-surface/50 text-on-surface">
                {cityTableData.map(row => (
                  <tr key={row.city} className="hover:bg-surface-container-low transition-colors">
                    <td className="px-6 py-4 font-medium capitalize">{row.city.toLowerCase()}</td>
                    {INTERVENTIONS.map(inv => {
                      if (!activeLines[inv.key]) return null;
                      const val = Math.round(row[inv.key]);
                      return (
                        <td key={`td-${row.city}-${inv.key}`} className={`px-6 py-4 font-bold ${getCityCellColor(val)}`}>
                          {val.toLocaleString()}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Section 4: Resource Shortfall Summary */}
        <section className="bg-surface-variant rounded-xl border border-outline p-6 shadow-sm">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
            <h3 className="text-lg font-semibold text-on-background font-sans">Resource Shortfall Summary</h3>
            <div className="bg-surface rounded-full px-4 py-1.5 border border-outline text-sm font-mono text-on-surface">
              National Oxygen Capacity Ceiling: <span className="font-bold">{resourceStats.capacityCeiling.toLocaleString()} MT/day</span>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {INTERVENTIONS.map(inv => {
              if (!activeLines[inv.key]) return null;
              const res = resourceStats.resources[inv.key];
              if (!res) return null;

              const isShortfall = res.shortfall > 0;

              return (
                <div key={`res-${inv.key}`} className="bg-surface rounded-lg border border-outline p-4 flex flex-col gap-3">
                  <h4 className="font-sans font-medium text-on-surface border-b border-outline pb-2" style={{ color: inv.color }}>
                    {inv.label}
                  </h4>
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-on-surface-variant font-mono uppercase tracking-wider">Peak Oxygen Demand</span>
                    <span className="font-mono text-on-surface">{Math.round(res.peakOxygen).toLocaleString()} MT/day</span>
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-on-surface-variant font-mono uppercase tracking-wider">Peak ICU Beds Needed</span>
                    <span className="font-mono text-on-surface">{Math.round(res.peakICU).toLocaleString()}</span>
                  </div>
                  <div className={`mt-2 pt-3 border-t border-outline font-mono text-sm font-bold ${isShortfall ? 'text-[var(--color-status-red)]' : 'text-[var(--color-status-green)]'}`}>
                    {isShortfall ? `⚠ ${Math.round(res.shortfall).toLocaleString()} MT/day shortfall` : 'No shortfall'}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </main>
    </div>
  );
}
