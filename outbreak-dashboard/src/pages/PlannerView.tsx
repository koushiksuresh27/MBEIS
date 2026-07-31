import { useState, useMemo, useEffect, useRef } from 'react';
import type { ScenarioConfig } from '../types/scenario';
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

export default function PlannerView({ scenarioConfig }: { scenarioConfig: ScenarioConfig | null }) {
  const { data: seirdData, loading: seirdLoading, error: seirdError } = useSeirdResults(SCENARIO_ID);
  const { data: resourceData, cityData: resourceCityData, loading: resLoading, error: resError } = useResourceProjections(SCENARIO_ID);
  const { data: cityData, error: cityError } = useCityStatus(SCENARIO_ID);

  const [activeLines, setActiveLines] = useState<Record<string, boolean>>({
    none: true,
    rail_only: true,
    partial: true,
    full: true
  });

  useEffect(() => {
    if (!seirdData) return;
    const standardKeys = new Set(['none', 'rail_only', 'partial', 'full']);
    const customKeys = Object.keys(seirdData).filter(k => !standardKeys.has(k));
    customKeys.forEach(k => {
      setActiveLines(prev => prev[k] === undefined ? { ...prev, [k]: true } : prev);
    });
  }, [seirdData]);

  const dynamicInterventions = useMemo(() => {
    const standardKeys = new Set(['none', 'rail_only', 'partial', 'full']);
    const customKeys = Object.keys(seirdData || {}).filter(k => !standardKeys.has(k));
    const customEntries = customKeys.map(k => ({
      key: k,
      label: k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
      color: '#7C3AED'
    }));
    return [...INTERVENTIONS, ...customEntries];
  }, [seirdData]);

  const toggleLine = (key: string) => {
    setActiveLines(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const BACKEND_URL = import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:8000';
  const PHASE_INTERVENTIONS = [
    { value: 'full', label: 'Full Quarantine' },
    { value: 'partial', label: 'Partial Lockdown' },
    { value: 'rail_only', label: 'Transit Halt' },
    { value: 'none', label: 'No Intervention' },
  ];

  const [phases, setPhases] = useState([
    { from_day: 1, to_day: 60, intervention: 'full' },
    { from_day: 61, to_day: 120, intervention: 'partial' },
    { from_day: 121, to_day: 180, intervention: 'none' },
  ]);
  const [planLabel, setPlanLabel] = useState('Custom Plan 1');
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [runSuccess, setRunSuccess] = useState<string | null>(null);
  const [isCityTableOpen, setIsCityTableOpen] = useState(false);
  const [expandedResCards, setExpandedResCards] = useState<Record<string, boolean>>({});
  const [compareA, setCompareA] = useState<string | null>(null);
  const [compareB, setCompareB] = useState<string | null>(null);
  const [showCompare, setShowCompare] = useState(false);

  const runPhasedSim = async () => {
    setRunning(true);
    setRunError(null);
    setRunSuccess(null);
    const label = planLabel.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
    try {
      const res = await fetch(`${BACKEND_URL}/api/v1/simulate-phased`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scenario_id: scenarioConfig?.scenarioId ?? SCENARIO_ID,
          origin_city: scenarioConfig?.originCity ?? 'THRISSUR',
          schedule: phases,
          label,
          n_iterations: scenarioConfig?.nIterations ?? 128,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail ?? 'Simulation failed');
      }
      setRunSuccess(`Done — results written as "${label}". Refresh to see the curve.`);
    } catch (e: any) {
      setRunError(e.message ?? 'Unknown error');
    } finally {
      setRunning(false);
    }
  };

  const updatePhase = (idx: number, field: string, value: string | number) => {
    setPhases(prev => prev.map((p, i) => i === idx ? { ...p, [field]: value } : p));
  };

  const isLoading = seirdLoading || resLoading || !cityData;
  const hasError = seirdError || resError || cityError;

  // 1. Compute National Snapshot Stats
  const nationalStats = useMemo(() => {
    if (!seirdData) return {};
    const stats: Record<string, { peakInfections: number, peakDay: number, day90Deaths: number, verdict: string }> = {};

    dynamicInterventions.forEach(inv => {
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
      dynamicInterventions.forEach(inv => {
        const invArray = cityData[city]?.[inv.key] || [];
        const sorted = [...invArray].sort((a: any, b: any) => Number(b.day) - Number(a.day));
        const latest = sorted.find((d: any) => Number(d.day) === 180) ?? sorted[0];
        cityRow[inv.key] = latest ? parseFloat(String(latest.active_cases_p50 ?? '0')) : 0;
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
    const capacityCeiling = 17000;

    dynamicInterventions.forEach(inv => {
      const invWeeks = resourceData[inv.key] || [];
      let peakOxygen = 0;
      let peakICU = 0;

      invWeeks.forEach((w: any) => {
        if (w.oxygen_mt > peakOxygen) {
          peakOxygen = w.oxygen_mt;
        }
        if (w.icu_beds > peakICU) {
          peakICU = w.icu_beds;
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

        {/* Phase Builder + Saved Plans — two column layout */}
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-8">

          {/* LEFT: Phase Builder (compact) */}
          <div className="bg-surface-variant rounded-xl border border-outline p-4 shadow-sm flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-on-background font-sans">Custom Intervention Plan</h3>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={planLabel}
                  onChange={e => setPlanLabel(e.target.value)}
                  className="bg-surface border border-outline rounded-lg px-2 py-1 text-xs font-mono text-on-surface focus:outline-none focus:ring-1 focus:ring-primary w-36"
                  placeholder="Plan name"
                />
                <button
                  onClick={runPhasedSim}
                  disabled={running}
                  className="bg-primary text-on-primary px-3 py-1 rounded-lg text-xs font-medium font-sans hover:opacity-90 disabled:opacity-50 transition-opacity flex items-center gap-1.5"
                >
                  {running ? (
                    <>
                      <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                      </svg>
                      Running...
                    </>
                  ) : 'Run'}
                </button>
              </div>
            </div>

            <div className="rounded-lg border border-outline overflow-hidden">
              {phases.map((phase, idx) => (
                <div key={idx} className={`flex items-center gap-2 bg-surface py-2 px-3 ${idx !== phases.length - 1 ? 'border-b border-outline' : ''}`}>
                  <span className="text-xs font-mono text-on-surface-variant w-14 shrink-0">Phase {idx + 1}</span>
                  <span className="text-xs text-on-surface-variant font-mono shrink-0">Day</span>
                  <input
                    type="number"
                    min={1} max={180}
                    value={phase.from_day}
                    onChange={e => updatePhase(idx, 'from_day', parseInt(e.target.value))}
                    className="bg-surface-variant border border-outline rounded px-1.5 py-0.5 text-xs font-mono text-on-surface w-14 focus:outline-none"
                  />
                  <span className="text-xs text-on-surface-variant font-mono shrink-0">to</span>
                  <input
                    type="number"
                    min={1} max={180}
                    value={phase.to_day}
                    onChange={e => updatePhase(idx, 'to_day', parseInt(e.target.value))}
                    className="bg-surface-variant border border-outline rounded px-1.5 py-0.5 text-xs font-mono text-on-surface w-14 focus:outline-none"
                  />
                  <select
                    value={phase.intervention}
                    onChange={e => updatePhase(idx, 'intervention', e.target.value)}
                    className="bg-surface-variant border border-outline rounded px-2 py-0.5 text-xs font-mono text-on-surface focus:outline-none flex-1"
                  >
                    {PHASE_INTERVENTIONS.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>

            {runError && (
              <div className="text-xs font-mono text-[var(--color-status-red)] bg-surface rounded-lg border border-[var(--color-status-red)]/30 px-3 py-1.5">
                ⚠ {runError}
              </div>
            )}
            {runSuccess && (
              <div className="text-xs font-mono text-[var(--color-status-green)] bg-surface rounded-lg border border-[var(--color-status-green)]/30 px-3 py-1.5">
                ✓ {runSuccess}
              </div>
            )}
          </div>

          {/* RIGHT: Saved Custom Plans + Compare */}
          <div className="bg-surface-variant rounded-xl border border-outline p-4 shadow-sm flex flex-col gap-3">
            <h3 className="text-sm font-semibold text-on-background font-sans">Saved Custom Plans</h3>

            {(() => {
              const standardKeys = new Set(['none', 'rail_only', 'partial', 'full']);
              const customPlans = dynamicInterventions.filter(inv => !standardKeys.has(inv.key));

              if (customPlans.length === 0) {
                return (
                  <p className="text-xs font-mono text-on-surface-variant opacity-60 italic mt-2">
                    No custom plans yet. Run a simulation to save one.
                  </p>
                );
              }

              return (
                <div className="flex flex-col gap-2">
                  {customPlans.map(plan => {
                    const stat = nationalStats[plan.key];
                    const isSelectedA = compareA === plan.key;
                    const isSelectedB = compareB === plan.key;
                    return (
                      <div key={plan.key} className="flex items-center justify-between bg-surface rounded-lg border border-outline px-3 py-2">
                        <div className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: plan.color }}></span>
                          <span className="font-mono text-xs text-on-surface font-medium">{plan.label}</span>
                          {stat && (
                            <span className="font-mono text-xs text-on-surface-variant">
                              · peak {Math.round(stat.peakInfections).toLocaleString()}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => setCompareA(isSelectedA ? null : plan.key)}
                            className={`text-xs font-mono px-2 py-0.5 rounded border transition-colors ${isSelectedA ? 'bg-primary text-on-primary border-primary' : 'bg-surface-variant border-outline text-on-surface-variant hover:border-primary hover:text-primary'}`}
                          >
                            A
                          </button>
                          <button
                            onClick={() => setCompareB(isSelectedB ? null : plan.key)}
                            className={`text-xs font-mono px-2 py-0.5 rounded border transition-colors ${isSelectedB ? 'bg-primary text-on-primary border-primary' : 'bg-surface-variant border-outline text-on-surface-variant hover:border-primary hover:text-primary'}`}
                          >
                            B
                          </button>
                        </div>
                      </div>
                    );
                  })}

                  {compareA && compareB && (
                    <button
                      onClick={() => setShowCompare(true)}
                      className="mt-1 w-full bg-primary text-on-primary py-1.5 rounded-lg text-xs font-mono font-medium hover:opacity-90 transition-opacity"
                    >
                      Compare A vs B →
                    </button>
                  )}
                </div>
              );
            })()}
          </div>
        </section>

        {/* Compare Modal */}
        {showCompare && compareA && compareB && (() => {
          const planA = dynamicInterventions.find(i => i.key === compareA)!;
          const planB = dynamicInterventions.find(i => i.key === compareB)!;
          const statA = nationalStats[compareA];
          const statB = nationalStats[compareB];
          const resA = resourceStats.resources[compareA];
          const resB = resourceStats.resources[compareB];
          const baselineStat = nationalStats['none'];

          const deathsSavedA = baselineStat ? Math.round(baselineStat.day90Deaths - (statA?.day90Deaths ?? 0)) : 0;
          const deathsSavedB = baselineStat ? Math.round(baselineStat.day90Deaths - (statB?.day90Deaths ?? 0)) : 0;
          const peakDelayA = baselineStat ? (statA?.peakDay ?? 0) - baselineStat.peakDay : 0;
          const peakDelayB = baselineStat ? (statB?.peakDay ?? 0) - baselineStat.peakDay : 0;

          const rows = [
            {
              label: 'Peak Active Cases',
              a: Math.round(statA?.peakInfections ?? 0).toLocaleString(),
              b: Math.round(statB?.peakInfections ?? 0).toLocaleString(),
              better: (statA?.peakInfections ?? 0) < (statB?.peakInfections ?? 0) ? 'a' : 'b',
            },
            {
              label: 'Peak Day',
              a: `Day ${statA?.peakDay ?? 0}`,
              b: `Day ${statB?.peakDay ?? 0}`,
              better: (statA?.peakDay ?? 0) > (statB?.peakDay ?? 0) ? 'a' : 'b',
            },
            {
              label: 'Deaths by Day 90',
              a: Math.round(statA?.day90Deaths ?? 0).toLocaleString(),
              b: Math.round(statB?.day90Deaths ?? 0).toLocaleString(),
              better: (statA?.day90Deaths ?? 0) < (statB?.day90Deaths ?? 0) ? 'a' : 'b',
            },
            {
              label: 'Peak Oxygen (MT/day)',
              a: Math.round(resA?.peakOxygen ?? 0).toLocaleString(),
              b: Math.round(resB?.peakOxygen ?? 0).toLocaleString(),
              better: (resA?.peakOxygen ?? 0) < (resB?.peakOxygen ?? 0) ? 'a' : 'b',
            },
            {
              label: 'Deaths Saved vs Baseline',
              a: deathsSavedA.toLocaleString(),
              b: deathsSavedB.toLocaleString(),
              better: deathsSavedA > deathsSavedB ? 'a' : 'b',
            },
            {
              label: 'Peak Delay vs Baseline',
              a: `${peakDelayA > 0 ? '+' : ''}${peakDelayA} days`,
              b: `${peakDelayB > 0 ? '+' : ''}${peakDelayB} days`,
              better: peakDelayA > peakDelayB ? 'a' : 'b',
            },
          ];

          return (
            <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
              onClick={() => setShowCompare(false)}>
              <div className="bg-surface rounded-2xl border border-outline shadow-2xl p-6 w-full max-w-lg"
                onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-5">
                  <h3 className="font-sans font-semibold text-on-background">Plan Comparison</h3>
                  <button onClick={() => setShowCompare(false)}
                    className="text-on-surface-variant hover:text-on-background text-lg leading-none">×</button>
                </div>

                <div className="grid grid-cols-3 gap-2 mb-3">
                  <div className="text-xs font-mono text-on-surface-variant uppercase">Metric</div>
                  <div className="flex items-center gap-1.5 text-xs font-mono font-semibold">
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: planA.color }}></span>
                    {planA.label}
                  </div>
                  <div className="flex items-center gap-1.5 text-xs font-mono font-semibold">
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: planB.color }}></span>
                    {planB.label}
                  </div>
                </div>

                <div className="flex flex-col gap-1">
                  {rows.map((row, idx) => (
                    <div key={idx} className={`grid grid-cols-3 gap-2 py-2 px-2 rounded-lg ${idx % 2 === 0 ? 'bg-surface-variant' : ''}`}>
                      <span className="text-xs font-mono text-on-surface-variant">{row.label}</span>
                      <span className={`text-xs font-mono font-semibold ${row.better === 'a' ? 'text-[var(--color-status-green)]' : 'text-on-surface'}`}>
                        {row.a}
                      </span>
                      <span className={`text-xs font-mono font-semibold ${row.better === 'b' ? 'text-[var(--color-status-green)]' : 'text-on-surface'}`}>
                        {row.b}
                      </span>
                    </div>
                  ))}
                </div>

                <p className="text-xs font-mono text-on-surface-variant opacity-60 mt-4 text-center">
                  Green values indicate the better performing plan for each metric
                </p>
              </div>
            </div>
          );
        })()}

        {/* Section 1: Intervention Selector */}
        <section className="bg-surface-variant rounded-xl border border-outline p-6 shadow-sm flex flex-wrap gap-2">
          {dynamicInterventions.map(inv => {
            const isActive = activeLines[inv.key];
            return (
              <button
                key={inv.key}
                onClick={() => toggleLine(inv.key)}
                className={`flex items-center gap-2 text-sm px-3 py-1.5 rounded-full transition-colors border ${isActive
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
        <section className="grid gap-4" style={{ gridTemplateColumns: `repeat(${dynamicInterventions.length}, minmax(0, 1fr))` }}>
          {dynamicInterventions.map(inv => {
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
                style={{}}
              >
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: inv.color }}></span>
                  <h3 className="font-sans font-semibold text-on-background">{inv.label}</h3>
                </div>
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
                <div className="mt-auto pt-4 border-t border-outline" />
              </div>
            );
          })}
        </section>

        {/* Section 3: City Status Table */}
        <section className="bg-surface-variant rounded-xl border border-outline shadow-sm overflow-hidden flex flex-col">
          <div
            className="p-6 border-b border-outline flex justify-between items-center cursor-pointer"
            onClick={() => setIsCityTableOpen(!isCityTableOpen)}
          >
            <h3 className="text-lg font-semibold text-on-background font-sans">Day 180 Active Cases per City</h3>
            <span className="text-on-surface-variant">{isCityTableOpen ? '▼' : '▶'}</span>
          </div>
          {isCityTableOpen && (
            <div className="overflow-x-auto">
              <table className="w-full text-left font-mono text-sm">
                <thead className="bg-surface border-b border-outline text-on-surface-variant text-xs uppercase">
                  <tr>
                    <th className="px-6 py-3 font-medium">City</th>
                    {dynamicInterventions.map(inv => activeLines[inv.key] && (
                      <th key={`th-${inv.key}`} className="px-6 py-3 font-medium">{inv.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline bg-surface/50 text-on-surface">
                  {cityTableData.map(row => (
                    <tr key={row.city} className="hover:bg-surface-container-low transition-colors">
                      <td className="px-6 py-4 font-medium capitalize">{row.city.charAt(0).toUpperCase() + row.city.slice(1).toLowerCase()}</td>
                      {dynamicInterventions.map(inv => {
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
          )}
        </section>

        {/* Section 4: Resource Shortfall Summary */}
        <section className="bg-surface-variant rounded-xl border border-outline p-6 shadow-sm">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
            <h3 className="text-lg font-semibold text-on-background font-sans">Resource Shortfall Summary</h3>
            <div className="bg-surface rounded-full px-4 py-1.5 border border-outline text-sm font-mono text-on-surface">
              National Oxygen Capacity Ceiling: <span className="font-bold">{resourceStats.capacityCeiling.toLocaleString()} MT/day</span>
            </div>
          </div>
          <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${dynamicInterventions.length}, minmax(0, 1fr))` }}>
            {dynamicInterventions.map(inv => {
              if (!activeLines[inv.key]) return null;
              const res = resourceStats.resources[inv.key];
              if (!res) return null;

              const isShortfall = res.shortfall > 0;

              return (
                <div key={`res-${inv.key}`} className="bg-surface rounded-lg border border-outline p-4 flex flex-col gap-3">
                  <div className="flex items-center gap-2 border-b border-outline pb-2">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: inv.color }}></span>
                    <h4 className="font-sans font-medium text-on-surface">{inv.label}</h4>
                  </div>
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
                  <button
                    onClick={() => setExpandedResCards(prev => ({ ...prev, [inv.key]: !prev[inv.key] }))}
                    className="text-xs font-mono text-on-surface-variant hover:text-on-surface mt-2 flex items-center gap-1"
                  >
                    {expandedResCards[inv.key] ? '▲ Hide city breakdown' : '▼ Show city breakdown'}
                  </button>
                  {expandedResCards[inv.key] && (() => {
                    const cityBreakdown = resourceCityData[inv.key] ?? [];

                    return (
                      <div className="mt-2 flex flex-col gap-1 border-t border-outline pt-2">
                        {cityBreakdown.map((c: any) => (
                          <div key={c.city} className="flex justify-between text-xs font-mono text-on-surface-variant">
                            <span>{c.city}</span>
                            <span>{Math.round(c.peak_oxygen_mt)} MT · {Math.round(c.peak_icu_beds)} ICU</span>
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </div>
              );
            })}
          </div>
        </section>
      </main>
    </div>
  );
}
