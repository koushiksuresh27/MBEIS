import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useSeirdResults } from '../hooks/useSeirdResults';
import { useResourceProjections } from '../hooks/useResourceProjections';
import { useCityStatus } from '../hooks/useCityStatus';
import DerivationBasisInspector from '../components/analyst-view/DerivationBasisInspector';
import BubbleMap from '../components/analyst-view/BubbleMap';
import {
  ComposedChart,
  Line,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine
} from 'recharts';

const SCENARIO_ID = 'bb0ff20e-b086-411b-8054-91560b1e88ec';

const INTERVENTIONS = [
  { key: 'none', label: 'Baseline (None)', color: 'var(--color-status-red)' },
  { key: 'rail_only', label: 'Transit Halt', color: 'var(--color-status-amber)' },
  { key: 'partial', label: 'Partial Lockdown', color: 'var(--color-primary)' },
  { key: 'full', label: 'Full Quarantine', color: 'var(--color-status-green)' }
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
  const xMax = 90;

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

  const xTicks = [1, 15, 30, 45, 60, 75, 90];
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
          const label = val >= 1000 ? `${(val / 1000).toFixed(logScale ? 1 : 0)}k` : Math.round(val);
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

        <line x1={getX(56)} y1={padTop} x2={getX(56)} y2={dim.height - padBottom} stroke="currentColor" strokeDasharray="4 4" />
        <text x={getX(56)} y={padTop - 5} textAnchor="middle" fontSize="11" fill="currentColor">
          Actual Lockdown
        </text>

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

export default function AnalystView() {
  const { data, loading, error } = useSeirdResults(SCENARIO_ID);
  const { data: resourceData, loading: resLoading, error: resError } = useResourceProjections(SCENARIO_ID);
  const { data: cityData, error: cityError } = useCityStatus(SCENARIO_ID);



  const [logScale, setLogScale] = useState(false);
  const [plotMode, setPlotMode] = useState<'fan' | 'spaghetti'>('fan');
  const [mapDay, setMapDay] = useState(90);
  const [mapIntervention, setMapIntervention] = useState('none');

  // Toggle state for chart lines
  const [activeLines, setActiveLines] = useState<Record<string, boolean>>({
    none: true,
    rail_only: true,
    partial: true,
    full: true
  });

  const toggleLine = (key: string) => {
    setActiveLines(prev => ({ ...prev, [key]: !prev[key] }));
  };

  // Transform data for Recharts: array of objects by day
  const chartData = useMemo(() => {
    if (!data || Object.keys(data).length === 0) return [];

    // Find the max day across all interventions
    const maxDays = 90;
    const combinedData = [];

    for (let day = 1; day <= maxDays; day++) {
      const dayData: any = { day };
      INTERVENTIONS.forEach(inv => {
        const invData = data[inv.key]?.find(d => d.day === day);
        if (invData) {
          // infected
          dayData[`${inv.key}_infected_p50`] = invData.infected_p50;
          dayData[`${inv.key}_infected_band`] = [invData.infected_p10, invData.infected_p90];
          dayData[`${inv.key}_deaths_p50`] = invData.deaths_p50;
          dayData[`${inv.key}_deaths_p90`] = invData.deaths_p90;
          dayData[`${inv.key}_deaths_band`] = [invData.deaths_p10, invData.deaths_p90];

          if (invData.trajectory_sample && Array.isArray(invData.trajectory_sample)) {
            const maxRuns = Math.min(invData.trajectory_sample.length, 100);
            for (let i = 0; i < maxRuns; i++) {
              dayData[`${inv.key}_run_${i}`] = invData.trajectory_sample[i];
            }
          }
        }
      });
      combinedData.push(dayData);
    }
    return combinedData;
  }, [data]);

  // Transform data for Recharts: array of objects by week
  const resourceChartData = useMemo(() => {
    if (!resourceData || Object.keys(resourceData).length === 0) return [];

    const maxWeeks = 13; // 90 days / 7 = ~13 weeks
    const combinedData = [];

    for (let week = 1; week <= maxWeeks; week++) {
      const weekData: any = { week };
      INTERVENTIONS.forEach(inv => {
        const invData = resourceData[inv.key]?.find(d => d.week === week);
        if (invData) {
          weekData[`${inv.key}_oxygen_mt`] = invData.oxygen_mt;
          weekData[`${inv.key}_icu_beds`] = invData.icu_beds;
        }
      });
      combinedData.push(weekData);
    }
    return combinedData;
  }, [resourceData]);

  // Compute summary stats
  const summaryStats = useMemo(() => {
    if (!data || Object.keys(data).length === 0) return null;

    const stats: Record<string, { peakVal: number, peakDay: number, day90Val: number }> = {};

    INTERVENTIONS.forEach(inv => {
      const invData = data[inv.key] || [];
      let peakVal = 0;
      let peakDay = 0;
      let day90Val = 0;

      invData.forEach(d => {
        if (d.infected_p50 > peakVal) {
          peakVal = d.infected_p50;
          peakDay = d.day;
        }
        if (d.day === 90) {
          day90Val = d.infected_p50;
        }
      });

      stats[inv.key] = { peakVal, peakDay, day90Val };
    });

    return stats;
  }, [data]);

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

            const invInfo = INTERVENTIONS.find(i => i.key === invKey);
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
        {INTERVENTIONS.map((inv) => {
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

  if (loading || resLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
          <p className="text-on-surface-variant font-mono text-sm">Loading simulation data...</p>
        </div>
      </div>
    );
  }

  if (error || resError) {
    return (
      <div className="min-h-screen p-8 bg-background">
        <div className="bg-error-container text-on-error-container p-4 rounded-lg border border-error/20">
          <h2 className="font-bold mb-2">Error Loading Data</h2>
          <p className="font-mono text-sm">{error?.message || resError?.message}</p>
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
            <h2 className="text-2xl font-bold text-on-background font-sans mb-1">Intervention Trajectory Analysis</h2>
            <p className="text-sm text-on-surface-variant font-sans max-w-2xl">
              Simulating the impact of mobility restrictions on total active cases and cumulative deaths over a three-month horizon.
            </p>
          </div>

          {/* Validation Badge */}
          <div className="bg-tertiary-fixed rounded-lg border border-tertiary/20 p-3 max-w-xs shadow-sm flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-tertiary"></span>
              <span className="text-sm font-bold text-tertiary font-sans">CRPS Skill Score: -3.50</span>
            </div>
            <p className="text-[10px] leading-tight text-on-tertiary-fixed font-mono opacity-80">
              Model measures true infections; ground truth is confirmed cases under restrictive early testing. Magnitude gap expected, timing/shape is the validation signal.
            </p>
          </div>
        </div>

        {/* Infections Chart Card */}
        <div className="bg-surface-variant rounded-xl border border-outline p-6 shadow-sm">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-semibold text-on-background font-sans">Active Infections (P50 with P10-P90 Confidence Bands)</h3>
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
          <div className="h-[400px] w-full">
            {plotMode === 'spaghetti' ? (
              <SpaghettiPlot 
                chartData={chartData} 
                activeLines={activeLines} 
                logScale={logScale} 
                interventions={INTERVENTIONS} 
              />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} margin={{ top: 10, right: 30, left: 20, bottom: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-outline)" vertical={false} opacity={0.5} />
                  <XAxis
                    dataKey="day"
                    stroke="var(--color-on-surface-variant)"
                    tick={{ fill: 'var(--color-on-surface-variant)', fontSize: 12, fontFamily: 'var(--font-mono)' }}
                    label={{ value: 'Day', position: 'insideBottom', offset: -10, fill: 'var(--color-on-surface-variant)' }}
                  />
                  <YAxis
                    stroke="var(--color-on-surface-variant)"
                    tick={{ fill: 'var(--color-on-surface-variant)', fontSize: 12, fontFamily: 'var(--font-mono)' }}
                    tickFormatter={(val) => val >= 1000 ? `${(val / 1000).toFixed(0)}k` : val}
                    scale={logScale ? 'log' : 'linear'}
                    domain={logScale ? ['auto', 'auto'] : [0, 'auto']}
                  />
                  <Tooltip content={<CustomTooltip />} />

                  {/* Reference Line for Lockdown */}
                  <ReferenceLine
                    x={56}
                    stroke="var(--color-on-surface-variant)"
                    strokeDasharray="4 4"
                    label={{ position: 'top', value: 'Actual Lockdown', fill: 'var(--color-on-surface-variant)', fontSize: 11, fontFamily: 'var(--font-mono)' }}
                  />

                  {INTERVENTIONS.map(inv => activeLines[inv.key] && (
                    <Area
                      key={`${inv.key}-area`}
                      type="monotone"
                      dataKey={`${inv.key}_infected_band`}
                      fill={inv.color}
                      stroke="none"
                      fillOpacity={0.15}
                    />
                  ))}

                  {INTERVENTIONS.map(inv => activeLines[inv.key] && (
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
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            {INTERVENTIONS.map(inv => {
              const stats = summaryStats[inv.key];
              if (!stats) return null;

              return (
                <div
                  key={inv.key}
                  className="bg-surface-variant rounded-lg border-t border-r border-b border-outline p-4 relative shadow-sm hover:bg-surface-container-low transition-colors"
                  style={{ borderLeftWidth: '4px', borderLeftColor: inv.color }}
                >
                  <div className="flex justify-between items-start mb-4">
                    <span className="font-mono text-xs uppercase tracking-wider text-on-surface-variant font-bold">{inv.label}</span>
                  </div>
                  <div className="space-y-3">
                    <div>
                      <div className="text-2xl font-bold text-on-background font-mono">
                        {Math.round(stats.peakVal).toLocaleString()}
                      </div>
                      <p className="text-xs text-on-surface-variant mt-1 font-sans">
                        Peak active (Day {stats.peakDay})
                      </p>
                    </div>
                    <div className="pt-3 border-t border-outline/50">
                      <div className="text-lg font-semibold text-on-background font-mono">
                        {Math.round(stats.day90Val).toLocaleString()}
                      </div>
                      <p className="text-xs text-on-surface-variant font-sans">
                        Active at Day 90
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Deaths Chart Card */}
        <div className="bg-surface-variant rounded-xl border border-outline p-6 shadow-sm">
          <h3 className="text-lg font-semibold text-on-background font-sans mb-4">Cumulative Deaths (P50 with P10-P90 Confidence Bands)</h3>
          <div className="h-[280px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 10, right: 30, left: 20, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-outline)" vertical={false} opacity={0.5} />
                <XAxis
                  dataKey="day"
                  stroke="var(--color-on-surface-variant)"
                  tick={{ fill: 'var(--color-on-surface-variant)', fontSize: 12, fontFamily: 'var(--font-mono)' }}
                  label={{ value: 'Day', position: 'insideBottom', offset: -10, fill: 'var(--color-on-surface-variant)' }}
                />
                <YAxis
                  stroke="var(--color-on-surface-variant)"
                  tick={{ fill: 'var(--color-on-surface-variant)', fontSize: 12, fontFamily: 'var(--font-mono)' }}
                  tickFormatter={(val) => val >= 1000 ? `${(val / 1000).toFixed(1)}k` : val}
                />
                <Tooltip content={<CustomTooltip />} />

                <ReferenceLine
                  x={56}
                  stroke="var(--color-on-surface-variant)"
                  strokeDasharray="4 4"
                />

                {INTERVENTIONS.map(inv => activeLines[inv.key] && (
                  <Area
                    key={`${inv.key}-death-area`}
                    type="monotone"
                    dataKey={`${inv.key}_deaths_band`}
                    fill={inv.color}
                    stroke="none"
                    fillOpacity={0.15}
                  />
                ))}

                {INTERVENTIONS.map(inv => activeLines[inv.key] && (
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

        <DerivationBasisInspector scenarioId={SCENARIO_ID} />

        {/* Resource Projections Chart Card */}
        <div className="bg-surface-variant rounded-xl border border-outline p-6 shadow-sm">
          <h3 className="text-lg font-semibold text-on-background font-sans mb-4">National Oxygen Demand (MT/day)</h3>
          <div className="h-[280px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={resourceChartData} margin={{ top: 10, right: 30, left: 20, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-outline)" vertical={false} opacity={0.5} />
                <XAxis
                  dataKey="week"
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

                            const invInfo = INTERVENTIONS.find(i => i.key === invKey);
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
                  y={17000}
                  stroke="var(--color-error)"
                  strokeDasharray="3 3"
                  label={{ position: 'top', value: 'National Capacity (17k MT)', fill: 'var(--color-error)', fontSize: 11, fontFamily: 'var(--font-mono)' }}
                />

                {INTERVENTIONS.map(inv => activeLines[inv.key] && (
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

        {/* Placeholders for Future Panels */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 pb-12">
          <div className="bg-surface-variant rounded-xl border border-outline shadow-sm overflow-hidden h-[620px] p-0 flex flex-col relative">
            <BubbleMap
              cityData={cityData || {}}
              activeIntervention={mapIntervention}
              simulationDay={mapDay}
              onDayChange={setMapDay}
              onInterventionChange={setMapIntervention}
            />
          </div>
          <div className="bg-surface-container rounded-xl border border-outline border-dashed h-64 flex items-center justify-center text-on-surface-variant opacity-60">
            <span className="font-mono text-sm">[ City Drilldown Placeholder ]</span>
          </div>
        </div>

      </main>
    </div>
  );
}
