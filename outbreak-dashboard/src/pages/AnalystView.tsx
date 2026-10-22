import React, { useState, useMemo, useEffect, useRef } from 'react';
import DerivationBasisInspector from '../components/analyst-view/DerivationBasisInspector';
import MobilityArchitectureDossier from '../components/analyst-view/MobilityArchitectureDossier';
import RippleLoader from '../components/common/RippleLoader';
import {
  ComposedChart,
  Line,
  Area,
  Bar,
  BarChart,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine
} from 'recharts';

const SCENARIO_ID = 'bb0ff20e-b086-411b-8054-91560b1e88ec';

const INTERVENTIONS = [
  { key: 'none', label: 'Baseline (None)', color: 'var(--color-status-red)' },
  { key: 'rail_only', label: 'Transit Halt', color: 'var(--color-status-amber)' },
  { key: 'partial', label: 'Partial Lockdown', color: 'var(--color-primary)' },
  { key: 'full', label: 'Full Quarantine', color: 'var(--color-status-green)' },
];

const SpaghettiPlot = ({
  chartData,
  activeLines,
  logScale,
  interventions
}: {
  chartData: any[];
  activeLines: Record<string, boolean>;
  logScale: boolean;
  interventions: typeof INTERVENTIONS;
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dim, setDim] = useState({ width: 0, height: 0 });
  const [hoverData, setHoverData] = useState<{ day: number, x: number } | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver(entries => {
      for (let entry of entries) {
        setDim({ width: entry.contentRect.width, height: entry.contentRect.height });
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  if (dim.width === 0 || dim.height === 0 || chartData.length === 0) {
    return <div ref={containerRef} className="w-full h-full" />;
  }

  const padLeft = 60;
  const padRight = 20;
  const padTop = 15;
  const padBottom = 30;

  const innerWidth = dim.width - padLeft - padRight;
  const innerHeight = dim.height - padTop - padBottom;

  let maxVal = 0;
  chartData.forEach(d => {
    interventions.forEach(inv => {
      if (!activeLines[inv.key]) return;
      if (d[`${inv.key}_infected_p50`] > maxVal) maxVal = d[`${inv.key}_infected_p50`];
      for (let i = 0; i < 100; i++) {
        if (d[`${inv.key}_run_${i}`] > maxVal) maxVal = d[`${inv.key}_run_${i}`];
      }
    });
  });

  const xMin = 1;
  const xMax = 180;

  const getX = (day: number) => padLeft + ((day - xMin) / (xMax - xMin)) * innerWidth;

  const getY = (val: number) => {
    if (val === undefined || isNaN(val)) return padTop + innerHeight;
    if (logScale) {
      const v = Math.log1p(val);
      const m = Math.log1p(maxVal);
      return padTop + innerHeight - (v / m) * innerHeight;
    }
    return padTop + innerHeight - (val / maxVal) * innerHeight;
  };

  const xTicks = [1, 30, 60, 90, 120, 150, 180];
  const yTickCount = 5;
  const yTicks = Array.from({ length: yTickCount }).map((_, i) => {
    if (logScale) {
      const m = Math.log1p(maxVal);
      return Math.expm1((i / (yTickCount - 1)) * m);
    }
    return (i / (yTickCount - 1)) * maxVal;
  });

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left;
    if (x < padLeft || x > dim.width - padRight) {
      setHoverData(null);
      return;
    }
    const ratio = (x - padLeft) / innerWidth;
    let day = Math.round(xMin + ratio * (xMax - xMin));
    day = Math.max(xMin, Math.min(xMax, day));
    setHoverData({ day, x: getX(day) });
  };

  return (
    <div ref={containerRef} className="w-full h-full relative font-mono text-[12px] text-on-surface-variant select-none">
      <svg
        width={dim.width}
        height={dim.height}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHoverData(null)}
        className="absolute inset-0 cursor-crosshair"
      >
        {yTicks.map((val, i) => {
          const y = getY(val);
          const label = val >= 1000000 ? `${(val / 1000000).toFixed(2)}M` : val >= 1000 ? `${(val / 1000).toFixed(logScale ? 1 : 0)}k` : Math.round(val);
          return (
            <g key={`y-${i}`}>
              <line x1={padLeft} y1={y} x2={dim.width - padRight} y2={y} stroke="var(--color-outline)" strokeDasharray="3 3" opacity={0.5} />
              <text x={padLeft - 10} y={y} textAnchor="end" dominantBaseline="middle" fill="currentColor">
                {label}
              </text>
            </g>
          );
        })}

        {xTicks.map(day => {
          const x = getX(day);
          return (
            <g key={`x-${day}`}>
              <text x={x} y={dim.height - 5} textAnchor="middle" fill="currentColor">
                {day}
              </text>
              <text x={x} y={dim.height - 18} textAnchor="middle" fill="currentColor">
                |
              </text>
            </g>
          );
        })}



        {interventions.map(inv => {
          if (!activeLines[inv.key]) return null;
          return Array.from({ length: 100 }).map((_, i) => {
            if (chartData[0]?.[`${inv.key}_run_${i}`] === undefined) return null;
            const points = chartData.map(d => `${getX(d.day)},${getY(d[`${inv.key}_run_${i}`])}`).join(' ');
            return (
              <polyline
                key={`${inv.key}-run-${i}`}
                points={points}
                fill="none"
                stroke={inv.color}
                strokeWidth={1}
                strokeOpacity={0.12}
              />
            );
          });
        })}

        {interventions.map(inv => {
          if (!activeLines[inv.key]) return null;
          const points = chartData.map(d => `${getX(d.day)},${getY(d[`${inv.key}_infected_p50`])}`).join(' ');
          return (
            <polyline
              key={`${inv.key}-p50`}
              points={points}
              fill="none"
              stroke={inv.color}
              strokeWidth={2.5}
            />
          );
        })}

        {hoverData && (
          <line
            x1={hoverData.x}
            y1={padTop}
            x2={hoverData.x}
            y2={dim.height - padBottom}
            stroke="var(--color-outline)"
            strokeDasharray="3 3"
          />
        )}
      </svg>

      {hoverData && (
        <div
          className="absolute pointer-events-none bg-surface p-3 border border-outline rounded-lg shadow-lg z-20 w-48"
          style={{
            left: hoverData.x > dim.width / 2 ? hoverData.x - 200 : hoverData.x + 15,
            top: padTop + 20
          }}
        >
          <p className="font-mono text-sm text-on-surface mb-2 font-bold border-b border-outline pb-1">Day {hoverData.day}</p>
          {interventions.map(inv => {
            if (!activeLines[inv.key]) return null;
            const dataPoint = chartData.find(d => d.day === hoverData.day);
            if (!dataPoint) return null;
            const val = Math.round(dataPoint[`${inv.key}_infected_p50`]);
            return (
              <div key={inv.key} className="flex items-center gap-2 text-sm font-mono text-on-surface">
                <span className="w-3 h-3 shrink-0 rounded-full" style={{ backgroundColor: inv.color }}></span>
                <span className="font-medium flex-1 truncate">{inv.label}:</span>
                <span>{val.toLocaleString()}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

import type { ScenarioConfig } from '../types/scenario';

interface Props {
  seirdData: Record<string, any[]>;
  cityData: Record<string, Record<string, any[]>>;
  resourceData: Record<string, any[]>;
  isLoading?: boolean;
  onRefresh?: () => void;
  chartData: any[];
  rtChartData: any[];
  resourceChartData: any[];
  scenarioId?: string;
  scenarioConfig?: ScenarioConfig | null;
  onOpenSetup?: (initialTab?: 'history' | 'configure') => void;
  onSelectScenario?: (config: ScenarioConfig) => void;
  onSignOut?: () => void;
}

interface OfficerProfile {
  name: string;
  role: string;
  agency: 'NCDC' | 'MOHFW';
}

const DEFAULT_PROFILE: OfficerProfile = {
  name: '',
  role: '',
  agency: 'NCDC',
};

export default function AnalystView({ 
  seirdData: data, 
  cityData: _cityData, 
  resourceData: _resourceData, 
  isLoading, 
  onRefresh,
  chartData,
  rtChartData,
  resourceChartData,
  scenarioId,
  scenarioConfig,
  onOpenSetup,
  onSelectScenario: _onSelectScenario,
  onSignOut
}: Props) {
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [profile, setProfile] = useState<OfficerProfile>(() => {
    try {
      const saved = localStorage.getItem('mbeis_officer_profile');
      return saved ? JSON.parse(saved) : DEFAULT_PROFILE;
    } catch {
      return DEFAULT_PROFILE;
    }
  });

  const profileRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isProfileOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) {
        setIsProfileOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isProfileOpen]);

  const updateProfile = (key: keyof OfficerProfile, val: any) => {
    const updated = { ...profile, [key]: val };
    setProfile(updated);
    try {
      localStorage.setItem('mbeis_officer_profile', JSON.stringify(updated));
    } catch {}
  };



  const [logScale, setLogScale] = useState(false);
  const [plotMode, setPlotMode] = useState<'fan' | 'spaghetti'>('fan');

  // Toggle state for chart lines
  const [activeLines, setActiveLines] = useState<Record<string, boolean>>({
    none: true,
    rail_only: true,
    partial: true,
    full: true,
  });

  useEffect(() => {
    if (!data) return;
    const standardKeys = new Set(['none', 'rail_only', 'partial', 'full']);
    const customKeys = Object.keys(data).filter(k => !standardKeys.has(k));
    customKeys.forEach(k => {
      setActiveLines(prev => prev[k] === undefined ? { ...prev, [k]: true } : prev);
    });
  }, [data]);

  const dynamicInterventions = useMemo(() => {
    const standardKeys = new Set(['none', 'rail_only', 'partial', 'full']);
    const customKeys = Object.keys(data || {}).filter(k => !standardKeys.has(k));
    const customEntries = customKeys.map(k => ({
      key: k,
      label: k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
      color: '#7C3AED'
    }));
    return [...INTERVENTIONS, ...customEntries];
  }, [data]);

  const toggleLine = (key: string) => {
    setActiveLines(prev => ({ ...prev, [key]: !prev[key] }));
  };



  // Compute summary stats
  const summaryStats = useMemo(() => {
    if (!data || Object.keys(data).length === 0) return null;

    const stats: Record<string, { peakVal: number, peakDay: number, peakDayP10: number, peakDayP90: number, day180Val: number }> = {};

    dynamicInterventions.forEach(inv => {
      const invData = data[inv.key] || [];
      let peakVal = 0;
      let peakDay = 0;
      let peakDayP10 = 0;
      let peakDayP90 = 0;
      let peakP10 = 0;
      let peakP90 = 0;
      let day180Val = 0;

      invData.forEach(d => {
        if (d.infected_p50 > peakVal) {
          peakVal = d.infected_p50;
          peakDay = d.day;
        }
        if (d.infected_p10 > peakP10) {
          peakP10 = d.infected_p10;
          peakDayP10 = d.day;
        }
        if (d.infected_p90 > peakP90) {
          peakP90 = d.infected_p90;
          peakDayP90 = d.day;
        }
        if (d.day === 180) {
          day180Val = d.infected_p50;
        }
      });

      // P10 trajectory peaks later (pessimistic), P90 peaks earlier (optimistic)
      // Show range as min(P90 peak day) to max(P10 peak day)
      const earlyPeak = Math.min(peakDayP90, peakDay, peakDayP10);
      const latePeak = Math.max(peakDayP90, peakDay, peakDayP10);

      stats[inv.key] = { peakVal, peakDay, peakDayP10: earlyPeak, peakDayP90: latePeak, day180Val };
    });

    return stats;
  }, [data]);

  // Compute Daily New Incidence (Epicurve: dI/dt + recoveries + deaths approximation)
  const incidenceChartData = useMemo(() => {
    if (!data || Object.keys(data).length === 0) return [];
    const points: any[] = [];
    const infPeriod = 7.0; // Mean infectious duration in days

    for (let day = 1; day <= 180; day++) {
      const row: any = { day };
      dynamicInterventions.forEach(inv => {
        const invList = data[inv.key] || [];
        const curr = invList.find((d: any) => d.day === day);
        const prev = invList.find((d: any) => d.day === day - 1);

        if (curr) {
          if (!prev) {
            row[`${inv.key}_new_cases`] = Math.max(0, Math.round(curr.infected_p50 / infPeriod));
          } else {
            // New daily cases = ΔI + new recoveries + new deaths
            const deltaI = curr.infected_p50 - prev.infected_p50;
            const deltaDeaths = Math.max(0, (curr.deaths_p50 || 0) - (prev.deaths_p50 || 0));
            const deltaRecoveries = Math.max(0, curr.infected_p50 / infPeriod);
            const dailyInc = Math.max(0, Math.round(deltaI + deltaDeaths + deltaRecoveries));
            row[`${inv.key}_new_cases`] = dailyInc;
          }
        }
      });
      points.push(row);
    }
    return points;
  }, [data, dynamicInterventions]);

  // Compute Comparative Policy Metrics (Total Cumulative Mortality, Averted Deaths, Peak Delay, Peak ICU)
  const policyComparisonData = useMemo(() => {
    if (!data || Object.keys(data).length === 0) return [];

    const baselineList = data['none'] || [];
    let baselinePeakDay = 0;
    let baselinePeakI = 0;
    let baselineFinalDeaths = 0;

    baselineList.forEach((d: any) => {
      if (d.infected_p50 > baselinePeakI) {
        baselinePeakI = d.infected_p50;
        baselinePeakDay = d.day;
      }
      if (d.day === 180) baselineFinalDeaths = d.deaths_p50;
    });
    if (baselineFinalDeaths === 0 && baselineList.length > 0) {
      baselineFinalDeaths = baselineList[baselineList.length - 1].deaths_p50;
    }

    return dynamicInterventions.map(inv => {
      const invList = data[inv.key] || [];
      let peakI = 0;
      let peakDay = 0;
      let finalDeaths = 0;

      invList.forEach((d: any) => {
        if (d.infected_p50 > peakI) {
          peakI = d.infected_p50;
          peakDay = d.day;
        }
        if (d.day === 180) finalDeaths = d.deaths_p50;
      });
      if (finalDeaths === 0 && invList.length > 0) {
        finalDeaths = invList[invList.length - 1].deaths_p50;
      }

      const avertedDeaths = Math.max(0, Math.round(baselineFinalDeaths - finalDeaths));
      const peakDelayDays = Math.max(0, peakDay - baselinePeakDay);
      const mortalityReductionPct = baselineFinalDeaths > 0
        ? Math.max(0, ((baselineFinalDeaths - finalDeaths) / baselineFinalDeaths) * 100)
        : 0;

      // Extract peak ICU beds for this intervention from resourceChartData
      let peakIcu = 0;
      resourceChartData.forEach((rw: any) => {
        const beds = rw[`${inv.key}_icu_beds`] || 0;
        if (beds > peakIcu) peakIcu = beds;
      });

      return {
        key: inv.key,
        label: inv.label,
        color: inv.color,
        finalDeaths: Math.round(finalDeaths),
        avertedDeaths,
        mortalityReductionPct: Number(mortalityReductionPct.toFixed(1)),
        peakDelayDays,
        peakActiveInfections: Math.round(peakI),
        peakIcuBeds: Math.round(peakIcu)
      };
    });
  }, [data, dynamicInterventions, resourceChartData]);

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-surface p-3 border border-outline rounded-lg shadow-lg">
          <p className="font-mono text-sm text-on-surface mb-2 font-bold border-b border-outline pb-1">Day {label}</p>
          {payload.map((entry: any, index: number) => {
            if (entry.dataKey.endsWith('_band')) return null; // Only show main lines in tooltip

            const invKey = entry.dataKey.replace('_infected_p50', '').replace('_deaths_p50', '');
            const isVisible = activeLines[invKey];

            if (!isVisible) return null;

            const invInfo = dynamicInterventions.find(i => i.key === invKey);
            const val = Math.round(entry.value);

            return (
              <div key={index} className="flex items-center gap-2 text-sm font-mono text-on-surface">
                <span className="w-3 h-3 inline-block rounded-full" style={{ backgroundColor: entry.stroke }}></span>
                <span className="font-medium flex-1">{invInfo?.label}:</span>
                <span>{val.toLocaleString()}</span>
              </div>
            );
          })}
        </div>
      );
    }
    return null;
  };

  const renderLegend = () => {
    return (
      <div className="flex flex-wrap gap-4 justify-center mt-4">
        {dynamicInterventions.map((inv) => {
          const isActive = activeLines[inv.key];
          return (
            <button
              key={inv.key}
              onClick={() => toggleLine(inv.key)}
              className={`flex items-center gap-2 text-sm px-3 py-1.5 rounded-full transition-colors border ${isActive
                ? 'bg-surface-variant border-outline text-on-surface'
                : 'bg-transparent border-outline/50 text-on-surface-variant opacity-60'
                }`}
            >
              <span className="w-3 h-3 rounded-full" style={{ backgroundColor: inv.color }}></span>
              <span className="font-mono font-medium">{inv.label}</span>
            </button>
          );
        })}
      </div>
    );
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <RippleLoader
          message="Loading simulation data..."
          subMessage="Fetching SEIRD curves, reproduction metrics, and healthcare resource demand"
        />
      </div>
    );
  }

  if (!data || Object.keys(data).length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6">
        <div className="bg-surface border border-outline rounded-2xl p-8 max-w-md w-full shadow-lg flex flex-col items-center text-center gap-4">
          <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center text-primary text-2xl">
            📭
          </div>
          <div>
            <h3 className="text-base font-semibold font-heading text-on-surface">No Simulation Data Loaded</h3>
            <p className="text-xs text-on-surface-variant font-mono mt-1">
              {scenarioId ? `Run ID (${scenarioId.slice(0, 8)}...) has no cached results.` : 'No scenario selected.'}
            </p>
          </div>
          <p className="text-xs text-on-surface-variant">
            You can load an existing run from the database or configure a new 128-iteration simulation.
          </p>
          <div className="flex flex-col sm:flex-row gap-2 w-full mt-2">
            {onOpenSetup && (
              <>
                <button
                  onClick={() => onOpenSetup('history')}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-surface-variant border border-outline text-on-surface text-xs font-mono font-medium hover:bg-surface-variant/80 transition-colors flex items-center justify-center gap-1.5"
                >
                  <span>📂 Stored Runs</span>
                </button>
                <button
                  onClick={() => onOpenSetup('configure')}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-primary text-on-primary text-xs font-mono font-medium hover:bg-primary/90 transition-colors flex items-center justify-center gap-1.5"
                >
                  <span>➕ New Run</span>
                </button>
              </>
            )}
            {onRefresh && !onOpenSetup && (
              <button
                onClick={onRefresh}
                className="w-full px-4 py-2.5 rounded-xl bg-primary text-on-primary text-xs font-mono font-medium hover:bg-primary/90 transition-colors"
              >
                Refresh
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-background overflow-hidden">
      {/* Main Content Canvas */}
      <main className="flex-1 p-6 space-y-6 max-w-[1440px] mx-auto w-full overflow-y-auto">

        {/* Top Area: Title & Validation Badge */}
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div>
            {/* Officer Profile Badge (Placed Above Heading) */}
            <div className="mb-2">
              <div className="relative inline-block" ref={profileRef}>
                <button
                  onClick={() => setIsProfileOpen(prev => !prev)}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-surface-variant/80 hover:bg-surface-variant border border-outline/70 shadow-2xs text-[11px] font-sans font-medium text-on-surface hover:text-primary transition-all active:scale-95 cursor-pointer"
                  title="Institutional Profile & Access"
                >
                  <span className="w-4 h-4 rounded-md bg-primary/15 text-primary flex items-center justify-center text-[10px] font-bold">
                    {profile.name ? profile.name.trim().charAt(0).toUpperCase() : '👤'}
                  </span>
                  <span className="max-w-[120px] truncate font-medium">
                    {profile.name.trim() || 'Officer Profile'}
                  </span>
                  <span className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-surface border border-outline/50 text-on-surface-variant font-semibold">
                    {profile.agency}
                  </span>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className={`transition-transform duration-150 text-on-surface-variant ${isProfileOpen ? 'rotate-180' : ''}`}>
                    <path d="m6 9 6 6 6-6" />
                  </svg>
                </button>

                {isProfileOpen && (
                  <div className="absolute left-0 mt-2 w-72 bg-surface border border-outline rounded-xl shadow-xl p-3.5 z-50 animate-in fade-in zoom-in-95 duration-100">
                    {/* Header */}
                    <div className="flex items-center justify-between pb-2 mb-3 border-b border-outline/40">
                      <div className="flex items-center gap-1.5">
                        <svg className="w-3.5 h-3.5 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                          <circle cx="12" cy="7" r="4" />
                        </svg>
                        <span className="text-xs font-semibold text-on-surface font-sans uppercase tracking-wider">
                          Officer Profile
                        </span>
                      </div>
                      <span className="text-[10px] font-mono text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">
                        Active
                      </span>
                    </div>

                    {/* Inputs */}
                    <div className="space-y-2.5 text-xs">
                      <div>
                        <label className="block text-[11px] font-medium text-on-surface-variant mb-1 font-sans">
                          Name
                        </label>
                        <input
                          type="text"
                          value={profile.name}
                          onChange={(e) => updateProfile('name', e.target.value)}
                          placeholder="Name"
                          className="w-full px-2.5 py-1.5 rounded-lg bg-surface-variant/50 border border-outline/60 text-xs text-on-surface focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary font-sans transition-all placeholder:text-on-surface-variant/40"
                        />
                      </div>

                      <div>
                        <label className="block text-[11px] font-medium text-on-surface-variant mb-1 font-sans">
                          Role / Designation
                        </label>
                        <input
                          type="text"
                          value={profile.role}
                          onChange={(e) => updateProfile('role', e.target.value)}
                          placeholder="e.g. Lead Epidemiological Analyst"
                          className="w-full px-2.5 py-1.5 rounded-lg bg-surface-variant/50 border border-outline/60 text-xs text-on-surface focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary font-sans transition-all placeholder:text-on-surface-variant/40"
                        />
                      </div>

                      <div>
                        <label className="block text-[11px] font-medium text-on-surface-variant mb-1 font-sans">
                          Agency
                        </label>
                        <div className="grid grid-cols-2 gap-1.5">
                          {(['NCDC', 'MOHFW'] as const).map((ag) => (
                            <button
                              key={ag}
                              type="button"
                              onClick={() => updateProfile('agency', ag)}
                              className={`py-1 px-2 rounded-lg text-xs font-mono font-semibold transition-all cursor-pointer text-center border ${
                                profile.agency === ag
                                  ? 'bg-primary text-white border-primary shadow-xs'
                                  : 'bg-surface-variant/40 border-outline/50 text-on-surface-variant hover:bg-surface-variant'
                              }`}
                            >
                              {ag}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Divider & Sign Out */}
                    <div className="pt-3 mt-3 border-t border-outline/40">
                      <button
                        onClick={() => {
                          setIsProfileOpen(false);
                          if (onSignOut) {
                            onSignOut();
                          }
                        }}
                        className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-600 dark:text-red-400 border border-red-500/20 text-xs font-medium font-sans transition-all cursor-pointer active:scale-95"
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                          <polyline points="16 17 21 12 16 7" />
                          <line x1="21" y1="12" x2="9" y2="12" />
                        </svg>
                        <span>Sign Out</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <h2 className="text-2xl font-semibold text-on-background font-heading">Intervention Trajectory Analysis</h2>
              {scenarioConfig && (
                <div className="inline-flex items-center gap-1.5 pl-2.5 pr-1 py-0.5 rounded-full bg-surface-variant/80 border border-outline/70 shadow-2xs backdrop-blur-sm text-[11px] font-mono text-on-surface">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0"></span>
                  <span className="font-semibold tracking-tight truncate max-w-[200px]" title={scenarioConfig.pathogenName}>{scenarioConfig.pathogenName}</span>
                  <span className="text-on-surface-variant/60 font-sans text-[10px]">•</span>
                  <span className="text-on-surface-variant font-medium">{scenarioConfig.originCity}</span>
                  {onOpenSetup && (
                    <button
                      onClick={() => onOpenSetup('history')}
                      className="ml-0.5 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-surface border border-outline/60 text-[10px] font-sans font-medium text-primary hover:bg-primary/10 hover:border-primary/40 active:scale-95 transition-all shadow-2xs cursor-pointer"
                      title="Switch to another stored simulation run"
                    >
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="text-primary">
                        <path d="M21 2v6h-6"></path>
                        <path d="M3 12a9 9 0 0 1 15-6.7L21 8"></path>
                        <path d="M3 22v-6h6"></path>
                        <path d="M21 12a9 9 0 0 1-15 6.7L3 16"></path>
                      </svg>
                      <span>Switch Run</span>
                    </button>
                  )}
                </div>
              )}
            </div>
            <p className="text-sm text-on-surface-variant font-sans max-w-2xl">
              Simulating the impact of mobility restrictions on total active cases and cumulative deaths over a three-month horizon.
            </p>
          </div>

          {/* Validation Badge */}
          <div className="bg-tertiary-fixed rounded-lg border border-tertiary/20 p-3 max-w-xs shadow-sm flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-tertiary"></span>
              <span className="text-sm font-bold text-tertiary font-heading">CRPS Skill Score: -0.43</span>
            </div>
            <p className="text-[10px] leading-tight text-on-tertiary-fixed font-mono opacity-80">
              Model measures true infections; ground truth is confirmed cases under restrictive early testing. Magnitude gap expected, timing/shape is the validation signal.
            </p>
          </div>
        </div>

        {/* Mobility Methodology & Beyond-SEIRD Architecture Dossier */}
        <MobilityArchitectureDossier />

        {/* Infections Chart Card */}
        <div className="bg-surface-variant rounded-xl border border-outline p-6 shadow-sm">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-semibold text-on-background font-heading">Active Infections (P50 with P10-P90 Confidence Bands)</h3>
            <div className="flex gap-4">
              {/* Fan / Spaghetti Toggle Group */}
              <div className="flex rounded-lg border border-outline overflow-hidden">
                <button
                  onClick={() => setPlotMode('fan')}
                  className={`px-3 py-1.5 text-xs font-mono transition-colors ${plotMode === 'fan' ? 'bg-primary text-on-primary' : 'bg-surface text-on-surface-variant hover:bg-surface-variant'}`}
                >
                  Fan
                </button>
                <button
                  onClick={() => setPlotMode('spaghetti')}
                  className={`px-3 py-1.5 text-xs font-mono transition-colors border-l border-outline ${plotMode === 'spaghetti' ? 'bg-primary text-on-primary' : 'bg-surface text-on-surface-variant hover:bg-surface-variant'}`}
                >
                  Spaghetti
                </button>
              </div>

              {/* Linear / Log Toggle Group */}
              <div className="flex rounded-lg border border-outline overflow-hidden">
                <button
                  onClick={() => setLogScale(false)}
                  className={`px-3 py-1.5 text-xs font-mono transition-colors ${!logScale ? 'bg-primary text-on-primary' : 'bg-surface text-on-surface-variant hover:bg-surface-variant'}`}
                >
                  Linear
                </button>
                <button
                  onClick={() => setLogScale(true)}
                  className={`px-3 py-1.5 text-xs font-mono transition-colors border-l border-outline ${logScale ? 'bg-primary text-on-primary' : 'bg-surface text-on-surface-variant hover:bg-surface-variant'}`}
                >
                  Log
                </button>
              </div>
            </div>
          </div>
          <div className="h-[320px] w-full">
            {plotMode === 'spaghetti' ? (
              <SpaghettiPlot
                chartData={chartData}
                activeLines={activeLines}
                logScale={logScale}
                interventions={dynamicInterventions}
              />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} margin={{ top: 10, right: 30, left: 20, bottom: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-outline)" vertical={false} opacity={0.5} />
                  <XAxis
                    dataKey="day"
                    ticks={[1, 30, 60, 90, 120, 150, 180]}
                    stroke="var(--color-on-surface-variant)"
                    tick={{ fill: 'var(--color-on-surface-variant)', fontSize: 12, fontFamily: 'var(--font-mono)' }}
                    label={{ value: 'Day', position: 'insideBottom', offset: -10, fill: 'var(--color-on-surface-variant)' }}
                  />
                  <YAxis
                    stroke="var(--color-on-surface-variant)"
                    tick={{ fill: 'var(--color-on-surface-variant)', fontSize: 12, fontFamily: 'var(--font-mono)' }}
                    tickFormatter={(val) => val >= 1000000 ? `${(val / 1000000).toFixed(2)}M` : val >= 1000 ? `${(val / 1000).toFixed(0)}k` : val}
                    scale={logScale ? 'log' : 'linear'}
                    domain={logScale ? ['auto', 'auto'] : [0, 'auto']}
                  />
                  <Tooltip content={<CustomTooltip />} />



                  {dynamicInterventions.map(inv => activeLines[inv.key] && (
                    <Area
                      key={`${inv.key}-area`}
                      type="monotone"
                      dataKey={`${inv.key}_infected_band`}
                      fill={inv.color}
                      stroke="none"
                      fillOpacity={0.15}
                    />
                  ))}

                  {dynamicInterventions.map(inv => activeLines[inv.key] && (
                    <Line
                      key={`${inv.key}-line`}
                      type="monotone"
                      dataKey={`${inv.key}_infected_p50`}
                      stroke={inv.color}
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 6 }}
                    />
                  ))}
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </div>
          {renderLegend()}
        </div>

        {/* Summary Stats Row */}
        {summaryStats && (
          <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${dynamicInterventions.length}, minmax(0, 1fr))` }}>
            {dynamicInterventions.map(inv => {
              const stats = summaryStats[inv.key];
              if (!stats) return null;

              return (
                <div
                  key={inv.key}
                  className="bg-surface-variant rounded-lg border-t border-r border-b border-outline p-4 relative shadow-sm hover:bg-surface-container-low transition-colors"
                  style={{}}
                >
                  <div className="flex justify-between items-start mb-4">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: inv.color }}></span>
                      <span className="font-mono text-xs uppercase tracking-wider text-on-surface-variant font-bold">{inv.label}</span>
                    </div>
                  </div>
                  <div className="space-y-3">
                    <div>
                      <div className="text-2xl font-bold text-on-background font-mono">
                        {Math.round(stats.peakVal).toLocaleString()}
                      </div>
                      <p className="text-xs text-on-surface-variant mt-1 font-sans">
                        Peak active · Day {stats.peakDay}
                      </p>
                      {stats.peakDayP10 !== stats.peakDayP90 && (
                        <p className="text-xs text-on-surface-variant opacity-60 font-mono mt-0.5">
                          Expected Day {stats.peakDayP10}–{stats.peakDayP90}
                        </p>
                      )}
                    </div>
                    <div className="pt-3 border-t border-outline/50">
                      <div className="text-lg font-semibold text-on-background font-mono">
                        {Math.round(stats.day180Val).toLocaleString()}
                      </div>
                      <p className="text-xs text-on-surface-variant font-sans">
                        Active at Day 180
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Daily New Infections (Incidence Curve) Chart Card */}
        <div className="bg-surface-variant rounded-xl border border-outline p-6 shadow-sm">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 mb-4">
            <div>
              <h3 className="text-lg font-semibold text-on-background font-heading">Daily New Infections (Incidence Epicurve)</h3>
              <p className="text-xs text-on-surface-variant font-mono mt-0.5">
                Velocity of transmission: Daily newly infected individuals entering infectious state (dI/dt + recoveries)
              </p>
            </div>
          </div>
          <div className="h-[280px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={incidenceChartData} margin={{ top: 10, right: 30, left: 20, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-outline)" vertical={false} opacity={0.5} />
                <XAxis
                  dataKey="day"
                  ticks={[1, 30, 60, 90, 120, 150, 180]}
                  stroke="var(--color-on-surface-variant)"
                  tick={{ fill: 'var(--color-on-surface-variant)', fontSize: 12, fontFamily: 'var(--font-mono)' }}
                  label={{ value: 'Day', position: 'insideBottom', offset: -10, fill: 'var(--color-on-surface-variant)' }}
                />
                <YAxis
                  stroke="var(--color-on-surface-variant)"
                  tick={{ fill: 'var(--color-on-surface-variant)', fontSize: 12, fontFamily: 'var(--font-mono)' }}
                  tickFormatter={(val) => val >= 1000000 ? `${(val / 1000000).toFixed(2)}M` : val >= 1000 ? `${(val / 1000).toFixed(0)}k` : val}
                />
                <Tooltip
                  content={({ active, payload, label }: any) => {
                    if (active && payload && payload.length) {
                      return (
                        <div className="bg-surface p-3 border border-outline rounded-lg shadow-lg">
                          <p className="font-mono text-sm text-on-surface mb-2 font-bold border-b border-outline pb-1">Day {label}</p>
                          {payload.map((entry: any, index: number) => {
                            const invKey = entry.dataKey.replace('_new_cases', '');
                            if (!activeLines[invKey]) return null;
                            const invInfo = dynamicInterventions.find(i => i.key === invKey);
                            const val = Math.round(entry.value);
                            return (
                              <div key={index} className="flex items-center gap-2 text-sm font-mono text-on-surface">
                                <span className="w-3 h-3 inline-block rounded-full" style={{ backgroundColor: entry.stroke }}></span>
                                <span className="font-medium flex-1">{invInfo?.label}:</span>
                                <span>+{val.toLocaleString()} new/day</span>
                              </div>
                            );
                          })}
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                {dynamicInterventions.map(inv => activeLines[inv.key] && (
                  <Line
                    key={`${inv.key}-incidence-line`}
                    type="monotone"
                    dataKey={`${inv.key}_new_cases`}
                    stroke={inv.color}
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4 }}
                  />
                ))}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Deaths Chart Card */}
        <div className="bg-surface-variant rounded-xl border border-outline p-6 shadow-sm">
          <h3 className="text-lg font-semibold text-on-background font-heading mb-4">Cumulative Deaths (P50 with P10-P90 Confidence Bands)</h3>
          <div className="h-[280px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 10, right: 30, left: 20, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-outline)" vertical={false} opacity={0.5} />
                <XAxis
                  dataKey="day"
                  ticks={[1, 30, 60, 90, 120, 150, 180]}
                  stroke="var(--color-on-surface-variant)"
                  tick={{ fill: 'var(--color-on-surface-variant)', fontSize: 12, fontFamily: 'var(--font-mono)' }}
                  label={{ value: 'Day', position: 'insideBottom', offset: -10, fill: 'var(--color-on-surface-variant)' }}
                />
                <YAxis
                  stroke="var(--color-on-surface-variant)"
                  tick={{ fill: 'var(--color-on-surface-variant)', fontSize: 12, fontFamily: 'var(--font-mono)' }}
                  tickFormatter={(val) => val >= 1000000 ? `${(val / 1000000).toFixed(2)}M` : val >= 1000 ? `${(val / 1000).toFixed(1)}k` : val}
                />
                <Tooltip content={<CustomTooltip />} />



                {dynamicInterventions.map(inv => activeLines[inv.key] && (
                  <Area
                    key={`${inv.key}-death-area`}
                    type="monotone"
                    dataKey={`${inv.key}_deaths_band`}
                    fill={inv.color}
                    stroke="none"
                    fillOpacity={0.15}
                  />
                ))}

                {dynamicInterventions.map(inv => activeLines[inv.key] && (
                  <Line
                    key={`${inv.key}-death-line`}
                    type="monotone"
                    dataKey={`${inv.key}_deaths_p50`}
                    stroke={inv.color}
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4 }}
                  />
                ))}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Rt Chart Card */}
        <div className="bg-surface-variant rounded-xl border border-outline p-6 shadow-sm">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h3 className="text-lg font-semibold text-on-background font-heading">Effective Reproduction Number (Rₜ)</h3>
              <p className="text-xs text-on-surface-variant font-mono mt-1">Rₜ &gt; 1 = epidemic growing · Rₜ &lt; 1 = epidemic shrinking · Rₜ = 1 = stable</p>
            </div>
          </div>
          <div className="h-[220px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={rtChartData} margin={{ top: 10, right: 30, left: 20, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-outline)" vertical={false} opacity={0.5} />
                <XAxis
                  dataKey="day"
                  ticks={[1, 30, 60, 90, 120, 150, 180]}
                  stroke="var(--color-on-surface-variant)"
                  tick={{ fill: 'var(--color-on-surface-variant)', fontSize: 12, fontFamily: 'var(--font-mono)' }}
                  label={{ value: 'Day', position: 'insideBottom', offset: -10, fill: 'var(--color-on-surface-variant)' }}
                />
                <YAxis
                  stroke="var(--color-on-surface-variant)"
                  tick={{ fill: 'var(--color-on-surface-variant)', fontSize: 12, fontFamily: 'var(--font-mono)' }}
                  domain={[0, 4]}
                  tickFormatter={(val) => val.toFixed(1)}
                />
                <Tooltip
                  content={({ active, payload, label }: any) => {
                    if (active && payload && payload.length) {
                      return (
                        <div className="bg-surface p-3 border border-outline rounded-lg shadow-lg">
                          <p className="font-mono text-sm text-on-surface mb-2 font-bold border-b border-outline pb-1">Day {label}</p>
                          {payload.map((entry: any, index: number) => {
                            if (!entry.value) return null;
                            const invKey = entry.dataKey.replace('_rt', '');
                            const invInfo = dynamicInterventions.find(i => i.key === invKey);
                            return (
                              <div key={index} className="flex items-center gap-2 text-sm font-mono text-on-surface">
                                <span className="w-3 h-3 inline-block rounded-full" style={{ backgroundColor: entry.stroke }}></span>
                                <span className="font-medium flex-1">{invInfo?.label}:</span>
                                <span>Rₜ = {Number(entry.value).toFixed(2)}</span>
                              </div>
                            );
                          })}
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <ReferenceLine
                  y={1}
                  stroke="var(--color-error)"
                  strokeDasharray="4 4"
                  strokeWidth={1.5}
                  label={{ position: 'right', value: 'Rₜ = 1', fill: 'var(--color-error)', fontSize: 11, fontFamily: 'var(--font-mono)' }}
                />
                {dynamicInterventions.map(inv => activeLines[inv.key] && (
                  <Line
                    key={`${inv.key}-rt`}
                    type="monotone"
                    dataKey={`${inv.key}_rt`}
                    stroke={inv.color}
                    strokeWidth={2}
                    dot={false}
                    connectNulls={false}
                    activeDot={{ r: 4 }}
                  />
                ))}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>

        <DerivationBasisInspector scenarioId={scenarioId || SCENARIO_ID} />

        {/* Resource Projections Chart Card */}
        <div className="bg-surface-variant rounded-xl border border-outline p-6 shadow-sm">
          <h3 className="text-lg font-semibold text-on-background font-heading mb-4">National Oxygen Demand (MT/day)</h3>
          <div className="h-[280px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={resourceChartData} margin={{ top: 10, right: 30, left: 20, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-outline)" vertical={false} opacity={0.5} />
                <XAxis
                  dataKey="week"
                  type="number"
                  domain={[1, 26]}
                  ticks={[1, 4, 8, 12, 16, 20, 24, 26]}
                  stroke="var(--color-on-surface-variant)"
                  tick={{ fill: 'var(--color-on-surface-variant)', fontSize: 12, fontFamily: 'var(--font-mono)' }}
                  label={{ value: 'Week', position: 'insideBottom', offset: -10, fill: 'var(--color-on-surface-variant)' }}
                />
                <YAxis
                  stroke="var(--color-on-surface-variant)"
                  tick={{ fill: 'var(--color-on-surface-variant)', fontSize: 12, fontFamily: 'var(--font-mono)' }}
                  tickFormatter={(val) => val >= 1000 ? `${(val / 1000).toFixed(1)}k` : val}
                />
                <Tooltip
                  content={({ active, payload, label }: any) => {
                    if (active && payload && payload.length) {
                      return (
                        <div className="bg-surface p-3 border border-outline rounded-lg shadow-lg">
                          <p className="font-mono text-sm text-on-surface mb-2 font-bold border-b border-outline pb-1">Week {label}</p>
                          {payload.map((entry: any, index: number) => {
                            const invKey = entry.dataKey.replace('_oxygen_mt', '');
                            const isVisible = activeLines[invKey];

                            if (!isVisible) return null;

                            const invInfo = dynamicInterventions.find(i => i.key === invKey);
                            const val = Math.round(entry.value);

                            return (
                              <div key={index} className="flex items-center gap-2 text-sm font-mono text-on-surface">
                                <span className="w-3 h-3 inline-block rounded-full" style={{ backgroundColor: entry.stroke }}></span>
                                <span className="font-medium flex-1">{invInfo?.label}:</span>
                                <span>{val.toLocaleString()} MT</span>
                              </div>
                            );
                          })}
                        </div>
                      );
                    }
                    return null;
                  }}
                />

                {/* Reference Line for National Capacity */}
                <ReferenceLine
                  y={9690}
                  stroke="var(--color-error)"
                  strokeDasharray="3 3"
                  label={{ position: 'top', value: 'National Capacity (9.69k MT)', fill: 'var(--color-error)', fontSize: 11, fontFamily: 'var(--font-mono)' }}
                />

                {dynamicInterventions.map(inv => activeLines[inv.key] && (
                  <Line
                    key={`${inv.key}-oxygen-line`}
                    type="monotone"
                    dataKey={`${inv.key}_oxygen_mt`}
                    stroke={inv.color}
                    strokeWidth={2}
                    dot={{ r: 3, fill: inv.color }}
                    activeDot={{ r: 6 }}
                  />
                ))}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* ICU & Critical Bed Demand Chart Card */}
        <div className="bg-surface-variant rounded-xl border border-outline p-6 shadow-sm">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 mb-4">
            <div>
              <h3 className="text-lg font-semibold text-on-background font-heading">National ICU Bed Saturation (Weekly)</h3>
              <p className="text-xs text-on-surface-variant font-mono mt-0.5">
                Critical care capacity threshold: 95,000 national ICU surge beds
              </p>
            </div>
          </div>
          <div className="h-[280px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={resourceChartData} margin={{ top: 10, right: 30, left: 20, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-outline)" vertical={false} opacity={0.5} />
                <XAxis
                  dataKey="week"
                  type="number"
                  domain={[1, 26]}
                  ticks={[1, 4, 8, 12, 16, 20, 24, 26]}
                  stroke="var(--color-on-surface-variant)"
                  tick={{ fill: 'var(--color-on-surface-variant)', fontSize: 12, fontFamily: 'var(--font-mono)' }}
                  label={{ value: 'Week', position: 'insideBottom', offset: -10, fill: 'var(--color-on-surface-variant)' }}
                />
                <YAxis
                  stroke="var(--color-on-surface-variant)"
                  tick={{ fill: 'var(--color-on-surface-variant)', fontSize: 12, fontFamily: 'var(--font-mono)' }}
                  tickFormatter={(val) => val >= 1000 ? `${(val / 1000).toFixed(0)}k` : val}
                />
                <Tooltip
                  content={({ active, payload, label }: any) => {
                    if (active && payload && payload.length) {
                      return (
                        <div className="bg-surface p-3 border border-outline rounded-lg shadow-lg">
                          <p className="font-mono text-sm text-on-surface mb-2 font-bold border-b border-outline pb-1">Week {label}</p>
                          {payload.map((entry: any, index: number) => {
                            const invKey = entry.dataKey.replace('_icu_beds', '');
                            if (!activeLines[invKey]) return null;
                            const invInfo = dynamicInterventions.find(i => i.key === invKey);
                            const val = Math.round(entry.value);
                            return (
                              <div key={index} className="flex items-center gap-2 text-sm font-mono text-on-surface">
                                <span className="w-3 h-3 inline-block rounded-full" style={{ backgroundColor: entry.stroke }}></span>
                                <span className="font-medium flex-1">{invInfo?.label}:</span>
                                <span>{val.toLocaleString()} ICU beds</span>
                              </div>
                            );
                          })}
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <ReferenceLine
                  y={95000}
                  stroke="var(--color-error)"
                  strokeDasharray="3 3"
                  label={{ position: 'top', value: 'Surge Capacity (95k ICU Beds)', fill: 'var(--color-error)', fontSize: 11, fontFamily: 'var(--font-mono)' }}
                />
                {dynamicInterventions.map(inv => activeLines[inv.key] && (
                  <Line
                    key={`${inv.key}-icu-line`}
                    type="monotone"
                    dataKey={`${inv.key}_icu_beds`}
                    stroke={inv.color}
                    strokeWidth={2}
                    dot={{ r: 3, fill: inv.color }}
                    activeDot={{ r: 6 }}
                  />
                ))}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Comparative Policy Impact & Mortality Averted Bar Card */}
        <div className="bg-surface-variant rounded-xl border border-outline p-6 shadow-sm">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 mb-4">
            <div>
              <h3 className="text-lg font-semibold text-on-background font-heading">Intervention Policy Trade-offs & Lives Saved</h3>
              <p className="text-xs text-on-surface-variant font-mono mt-0.5">
                Total cumulative deaths averted compared to baseline (None) at Day 180
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Left: Bar Chart of Deaths Averted */}
            <div className="h-[280px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={policyComparisonData} margin={{ top: 10, right: 30, left: 20, bottom: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-outline)" vertical={false} opacity={0.5} />
                  <XAxis
                    dataKey="label"
                    stroke="var(--color-on-surface-variant)"
                    tick={{ fill: 'var(--color-on-surface-variant)', fontSize: 11, fontFamily: 'var(--font-mono)' }}
                  />
                  <YAxis
                    stroke="var(--color-on-surface-variant)"
                    tick={{ fill: 'var(--color-on-surface-variant)', fontSize: 12, fontFamily: 'var(--font-mono)' }}
                    tickFormatter={(val) => val >= 1000 ? `${(val / 1000).toFixed(0)}k` : val}
                  />
                  <Tooltip
                    content={({ active, payload }: any) => {
                      if (active && payload && payload.length) {
                        const d = payload[0].payload;
                        return (
                          <div className="bg-surface p-3 border border-outline rounded-lg shadow-lg font-mono text-xs text-on-surface space-y-1">
                            <p className="font-bold border-b border-outline pb-1">{d.label}</p>
                            <p className="text-emerald-500 font-semibold">Averted Deaths: +{d.avertedDeaths.toLocaleString()}</p>
                            <p className="text-on-surface-variant">Mortality Reduction: {d.mortalityReductionPct}%</p>
                            <p className="text-on-surface-variant">Total 180-day Deaths: {d.finalDeaths.toLocaleString()}</p>
                            <p className="text-on-surface-variant">Peak Delay Gained: +{d.peakDelayDays} days</p>
                          </div>
                        );
                      }
                      return null;
                    }}
                  />
                  <Bar dataKey="avertedDeaths" radius={[6, 6, 0, 0]}>
                    {policyComparisonData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Right: Comparative Scorecard Table */}
            <div className="overflow-x-auto flex flex-col justify-center">
              <table className="w-full text-xs font-mono border-collapse">
                <thead>
                  <tr className="border-b border-outline text-on-surface-variant uppercase tracking-wider text-[11px]">
                    <th className="py-2.5 px-3 text-left">Strategy</th>
                    <th className="py-2.5 px-3 text-right">Lives Saved</th>
                    <th className="py-2.5 px-3 text-right">Mortality %</th>
                    <th className="py-2.5 px-3 text-right">Peak Delay</th>
                    <th className="py-2.5 px-3 text-right">Peak ICU</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline/40">
                  {policyComparisonData.map((item) => (
                    <tr key={item.key} className="hover:bg-surface/50 transition-colors">
                      <td className="py-2.5 px-3 font-medium flex items-center gap-2 text-on-surface">
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: item.color }}></span>
                        <span>{item.label}</span>
                      </td>
                      <td className="py-2.5 px-3 text-right font-bold text-emerald-500">
                        {item.avertedDeaths > 0 ? `+${item.avertedDeaths.toLocaleString()}` : '—'}
                      </td>
                      <td className="py-2.5 px-3 text-right text-on-surface">
                        {item.mortalityReductionPct > 0 ? `-${item.mortalityReductionPct}%` : 'Baseline'}
                      </td>
                      <td className="py-2.5 px-3 text-right text-on-surface-variant">
                        {item.peakDelayDays > 0 ? `+${item.peakDelayDays}d` : '0d'}
                      </td>
                      <td className="py-2.5 px-3 text-right text-on-surface font-semibold">
                        {item.peakIcuBeds.toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>



      </main>
    </div>
  );
}
