import { useMemo, useState, useEffect, useRef } from 'react';
import type { CityStatus } from '../../hooks/useCityStatus';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

interface BubbleMapProps {
  cityData: Record<string, Record<string, CityStatus[]>>;
  resourceData: Record<string, any[]>;
  activeIntervention: string;
  simulationDay: number;
  onDayChange: (day: number | ((prev: number) => number)) => void;
  onInterventionChange: (intervention: string) => void;
}

const INTERVENTIONS = [
  { key: 'none', label: 'Baseline', color: '#C62828' },
  { key: 'rail_only', label: 'Transit Halt', color: '#F57F17' },
  { key: 'partial', label: 'Partial Lockdown', color: '#2E4A8C' },
  { key: 'full', label: 'Full Quarantine', color: '#2E7D32' },
];

const INTERVENTION_LABELS: Record<string, string> = {
  none: 'Baseline',
  rail_only: 'Transit Halt',
  partial: 'Partial Lockdown',
  full: 'Full Quarantine',
};

const EDGE_COLORS: Record<string, string> = {
  none: '#C62828',
  rail_only: '#F57F17',
  partial: '#2E4A8C',
  full: '#2E7D32',
};

const CITIES: Record<string, { lat: number; lng: number; displayName: string; population: number }> = {
  "DELHI": { lat: 28.7041, lng: 77.1025, displayName: "Delhi", population: 33_127_402 },
  "MUMBAI": { lat: 19.0760, lng: 72.8777, displayName: "Mumbai", population: 23_582_050 },
  "KOLKATA": { lat: 22.5726, lng: 88.3639, displayName: "Kolkata", population: 24_384_528 },
  "BENGALURU": { lat: 12.9716, lng: 77.5946, displayName: "Bengaluru", population: 13_678_383 },
  "CHENNAI": { lat: 13.0827, lng: 80.2707, displayName: "Chennai", population: 11_362_949 },
  "HYDERABAD": { lat: 17.3850, lng: 78.4867, displayName: "Hyderabad", population: 9_790_908 },
  "AHMEDABAD": { lat: 23.0225, lng: 72.5714, displayName: "Ahmedabad", population: 7_649_898 },
  "PUNE": { lat: 18.5204, lng: 73.8567, displayName: "Pune", population: 7_926_450 },
  "LUCKNOW": { lat: 26.8467, lng: 80.9462, displayName: "Lucknow", population: 5_228_335 },
  "KOCHI": { lat: 9.9312, lng: 76.2673, displayName: "Kochi", population: 3_870_022 },
  "JAIPUR": { lat: 26.9124, lng: 75.7873, displayName: "Jaipur", population: 4_039_465 },
  "PATNA": { lat: 25.5941, lng: 85.1376, displayName: "Patna", population: 5_175_312 },
  "VISAKHAPATNAM": { lat: 17.6868, lng: 83.2185, displayName: "Visakhapatnam", population: 1_695_716 },
  "BHOPAL": { lat: 23.2599, lng: 77.4126, displayName: "Bhopal", population: 2_451_628 },
  "GUWAHATI": { lat: 26.1445, lng: 91.7362, displayName: "Guwahati", population: 1_349_253 },
};

const MOBILITY_EDGES = [
  ["MUMBAI", "PUNE", 1.000, "rail"],
  ["DELHI", "JAIPUR", 0.191, "rail"],
  ["BENGALURU", "CHENNAI", 0.165, "rail"],
  ["MUMBAI", "AHMEDABAD", 0.087, "rail"],
  ["DELHI", "LUCKNOW", 0.065, "rail"],
  ["MUMBAI", "HYDERABAD", 0.053, "rail"],
  ["BENGALURU", "HYDERABAD", 0.047, "rail"],
  ["MUMBAI", "DELHI", 0.043, "rail"],
  ["CHENNAI", "HYDERABAD", 0.040, "rail"],
  ["BENGALURU", "KOCHI", 0.037, "rail"],
  ["KOLKATA", "PATNA", 0.029, "rail"],
  ["DELHI", "BENGALURU", 0.025, "air"],
  ["MUMBAI", "KOLKATA", 0.022, "air"],
  ["DELHI", "KOLKATA", 0.032, "air"],
] as const;

export default function BubbleMap({
  cityData,
  resourceData,
  activeIntervention,
  simulationDay,
  onDayChange,
  onInterventionChange
}: BubbleMapProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [selectedCity, setSelectedCity] = useState<string | null>(null);

  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [, forceRerender] = useState(0);

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: `https://api.maptiler.com/maps/basic-v2/style.json?key=${import.meta.env.VITE_MAPTILER_KEY}`,
      center: [82.5, 22.5], // rough India centroid
      zoom: 3.8,
      minZoom: 3,
      maxZoom: 8,
    });

    map.on('load', () => {
      map.addSource('india-states', {
        type: 'geojson',
        data: 'https://raw.githubusercontent.com/geohacker/india/master/state/india_state.geojson',
      });
      map.addLayer({
        id: 'state-fills',
        type: 'fill',
        source: 'india-states',
        paint: { 'fill-color': '#D0CCC0', 'fill-opacity': 0.3 },
      });
      map.addLayer({
        id: 'state-borders',
        type: 'line',
        source: 'india-states',
        paint: { 'line-color': '#B0AB9E', 'line-width': 1 },
      });
      setMapReady(true);
    });

    map.on('move', () => forceRerender(n => n + 1));

    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  useEffect(() => {
    if (!isPlaying) return;
    const interval = setInterval(() => {
      onDayChange((prev: number) => {
        if (prev >= 180) { setIsPlaying(false); return 180; }
        return prev + 1;
      });
    }, 80);
    return () => clearInterval(interval);
  }, [isPlaying, onDayChange]);

  const { maxCases, topThreeCities, cityStats } = useMemo(() => {
    const casesByCity: Record<string, number> = {};
    const statsByCity: Record<string, any> = {};

    Object.keys(CITIES).forEach((cityKey) => {
      const normalizedKey = Object.keys(cityData).find(
        k => k.toLowerCase() === cityKey.toLowerCase()
      ) ?? cityKey;
      const cityRows = cityData[normalizedKey]?.[activeIntervention] ?? [];
      const row = cityRows.find(r => Number(r.day) === Number(simulationDay));
      const cases = parseFloat(String(row?.active_cases_p50 ?? '0'));
      casesByCity[cityKey] = cases;
      statsByCity[cityKey] = {
        cases,
        p10: parseFloat(String(row?.active_cases_p10 ?? '0')),
        p90: parseFloat(String(row?.active_cases_p90 ?? '0')),
      };
    });

    const allCases = Object.values(casesByCity);
    const max = allCases.length > 0 ? Math.max(...allCases) : 0;

    const sortedCities = Object.entries(casesByCity)
      .sort((a, b) => b[1] - a[1])
      .map(entry => entry[0]);
    const topThree = new Set(sortedCities.slice(0, 3));

    return { cityCases: casesByCity, maxCases: max, topThreeCities: topThree, cityStats: statsByCity };
  }, [cityData, activeIntervention, simulationDay]);

  const interventionEdgeColor = EDGE_COLORS[activeIntervention] || '#C62828';

  function project(cityKey: string): { x: number; y: number } | null {
    if (!mapRef.current) return null;
    const city = CITIES[cityKey];
    if (!city) return null;
    const point = mapRef.current.project([city.lng, city.lat]);
    return { x: point.x, y: point.y };
  }

  const selectedCityData = selectedCity ? CITIES[selectedCity] : null;
  const selectedCityProjected = selectedCity ? project(selectedCity) : null;
  const panelLeft = selectedCityProjected && selectedCityProjected.x < 250 ? '12px' : 'auto';
  const panelRight = selectedCityProjected && selectedCityProjected.x >= 250 ? '12px' : 'auto';

  return (
    <div className="relative w-full h-full bg-[#E8E4DA] overflow-hidden">
      {/* Top overlay */}
      <div className="absolute top-0 left-0 right-0 flex items-start justify-between p-3 pointer-events-none z-10">
        <div className="bg-surface/90 backdrop-blur-sm px-3 py-2 rounded-lg border border-outline pointer-events-auto shadow-sm">
          <p className="font-sans font-semibold text-on-background text-xs">City-Level Spread</p>
          <p className="font-mono text-[10px] text-on-surface-variant">Thrissur origin · 180-day run</p>
        </div>

        <div className="flex gap-1.5 flex-wrap justify-end pointer-events-auto">
          {INTERVENTIONS.map(inv => (
            <button
              key={inv.key}
              onClick={() => onInterventionChange(inv.key)}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-mono border transition-all ${activeIntervention === inv.key
                ? 'bg-surface border-outline text-on-background shadow-sm'
                : 'bg-surface/70 border-outline/50 text-on-surface-variant opacity-60 hover:opacity-80'
                }`}
            >
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: inv.color }} />
              {inv.label}
            </button>
          ))}
        </div>
      </div>

      <div ref={mapContainerRef} style={{ width: '100%', height: '100%', minHeight: '420px' }} />

      {mapReady && (
        <svg
          style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
        >
          <defs>
            <style>{`
              @keyframes pulse-out {
                0%   { opacity: 0.6; transform: scale(1); }
                100% { opacity: 0; transform: scale(2); }
              }
            `}</style>
          </defs>

          {/* Mobility Edges */}
          {MOBILITY_EDGES.map((edge, idx) => {
            const [cityAKey, cityBKey, weight, type] = edge;
            const posA = project(cityAKey as string);
            const posB = project(cityBKey as string);
            if (!posA || !posB) return null;

            const aTop = topThreeCities.has(cityAKey as string);
            const bTop = topThreeCities.has(cityBKey as string);
            const bothTop = aTop && bTop;

            return type === 'rail' ? (
              <line
                key={`edge-${idx}`}
                x1={posA.x} y1={posA.y}
                x2={posB.x} y2={posB.y}
                stroke={interventionEdgeColor}
                strokeWidth={(weight as number) > 0.1 ? 2 : (weight as number) > 0.04 ? 1.5 : 1}
                strokeOpacity={bothTop ? 0.5 + (weight as number) * 0.4 : 0.15 + (weight as number) * 0.3}
                style={{ transition: 'stroke-opacity 0.3s ease' }}
              />
            ) : (
              <line
                key={`edge-${idx}`}
                x1={posA.x} y1={posA.y}
                x2={posB.x} y2={posB.y}
                stroke={interventionEdgeColor}
                strokeDasharray="4 4"
                strokeOpacity={bothTop ? 0.5 + (weight as number) * 0.4 : 0.12}
                strokeWidth={1}
                style={{ transition: 'stroke-opacity 0.3s ease' }}
              />
            );
          })}

          {/* Cities */}
          {Object.entries(CITIES).map(([cityKey, city]) => {
            const pos = project(cityKey);
            if (!pos) return null;

            const stats = cityStats[cityKey];
            const cases = stats?.cases || 0;

            const ratio = maxCases > 0 ? cases / maxCases : 0;
            const radius = Math.sqrt(ratio) * 28 + 4;

            const bubbleColor = ratio > 0.55
              ? '#C62828'
              : ratio > 0.2
                ? '#F57F17'
                : '#2E7D32';

            const isTopThree = cases > 0 && topThreeCities.has(cityKey);

            return (
              <g
                key={cityKey}
                style={{ cursor: 'pointer', pointerEvents: 'auto' }}
                onClick={() => setSelectedCity(cityKey)}
              >
                {isTopThree && (
                  <circle
                    cx={pos.x} cy={pos.y}
                    r={radius + 10}
                    fill="none"
                    stroke={bubbleColor}
                    strokeWidth="1"
                    opacity="0"
                    style={{
                      animation: 'pulse-out 2s ease-out infinite',
                      transformOrigin: `${pos.x}px ${pos.y}px`,
                    }}
                  />
                )}

                <circle
                  cx={pos.x} cy={pos.y} r={radius}
                  fill={bubbleColor}
                  fillOpacity={0.22}
                  stroke={bubbleColor}
                  strokeWidth={selectedCity === cityKey ? 2.5 : 1.5}
                  style={{ transition: 'r 0.12s ease-out, fill-opacity 0.12s ease-out' }}
                />

                {selectedCity === cityKey && (
                  <circle
                    cx={pos.x} cy={pos.y} r={radius + 5}
                    fill="none"
                    stroke={bubbleColor}
                    strokeWidth="1.5"
                    strokeDasharray="3 3"
                    opacity="0.6"
                  />
                )}

                <text
                  x={pos.x}
                  y={pos.y - radius - 5}
                  textAnchor="middle"
                  fontSize={radius > 12 ? 9 : 7.5}
                  fill="#191815"
                  fontFamily="var(--font-mono)"
                  opacity={ratio > 0.05 ? 1 : 0.45}
                  style={{ pointerEvents: 'none', userSelect: 'none' }}
                >
                  {city.displayName}
                </text>

                {radius > 16 && (
                  <text
                    x={pos.x} y={pos.y + 3}
                    textAnchor="middle"
                    fontSize="8"
                    fill={bubbleColor}
                    fontFamily="var(--font-mono)"
                    fontWeight="600"
                    style={{ pointerEvents: 'none', userSelect: 'none' }}
                  >
                    {Math.round(cases).toLocaleString()}
                  </text>
                )}

                <title>{city.displayName}: {Math.round(cases).toLocaleString()} active cases</title>
              </g>
            );
          })}
        </svg>
      )}

      {/* City Detail Panel */}
      {selectedCity && selectedCityData && (
        <div style={{
          position: 'absolute',
          bottom: '72px',
          left: panelLeft,
          right: panelRight,
          width: '220px',
          zIndex: 10,
        }}
          className="bg-surface/95 backdrop-blur-sm border border-outline rounded-xl shadow-lg p-4"
        >
          <div className="flex items-start justify-between mb-3">
            <div>
              <h4 className="font-sans font-semibold text-on-background text-sm">
                {selectedCityData.displayName}
              </h4>
              <p className="font-mono text-xs text-on-surface-variant mt-0.5">
                Day {simulationDay} · {INTERVENTION_LABELS[activeIntervention]}
              </p>
            </div>
            <button
              onClick={() => setSelectedCity(null)}
              className="text-on-surface-variant hover:text-on-background text-lg leading-none mt-0.5"
            >×</button>
          </div>

          <div className="space-y-2">
            <div className="flex justify-between items-baseline">
              <span className="font-mono text-xs text-on-surface-variant uppercase">Active Cases</span>
              <span className="font-mono text-sm font-semibold text-on-background">
                {Math.round(cityStats[selectedCity]?.cases || 0).toLocaleString()}
              </span>
            </div>
            <div className="flex justify-between items-baseline">
              <span className="font-mono text-xs text-on-surface-variant uppercase">P10 – P90</span>
              <span className="font-mono text-xs text-on-surface-variant">
                {Math.round(cityStats[selectedCity]?.p10 || 0).toLocaleString()} – {Math.round(cityStats[selectedCity]?.p90 || 0).toLocaleString()}
              </span>
            </div>
            <div className="flex justify-between items-baseline">
              <span className="font-mono text-xs text-on-surface-variant uppercase">Population</span>
              <span className="font-mono text-xs text-on-background">
                {(selectedCityData.population / 1_000_000).toFixed(1)}M
              </span>
            </div>
            <div className="flex justify-between items-baseline">
              <span className="font-mono text-xs text-on-surface-variant uppercase">Attack Rate</span>
              <span className="font-mono text-xs text-on-background">
                {(((cityStats[selectedCity]?.cases || 0) / selectedCityData.population) * 100).toFixed(3)}%
              </span>
            </div>

            <div className="border-t border-outline pt-2 mt-2 space-y-1.5">
              {(() => {
                const cityRows = (resourceData[activeIntervention] ?? []) as any[];
                const cityRow = cityRows.find((r: any) =>
                  r.city?.toLowerCase() === selectedCity?.toLowerCase()
                );
                if (!cityRow) return (
                  <p className="font-mono text-[10px] text-on-surface-variant opacity-60 italic">
                    No resource data available
                  </p>
                );
                return (
                  <>
                    <div className="flex justify-between items-baseline">
                      <span className="font-mono text-xs text-on-surface-variant uppercase">Peak Oxygen</span>
                      <span className="font-mono text-xs text-on-background font-semibold">
                        {Math.round(cityRow.peak_oxygen_mt)} MT/day
                      </span>
                    </div>
                    <div className="flex justify-between items-baseline">
                      <span className="font-mono text-xs text-on-surface-variant uppercase">Peak ICU Beds</span>
                      <span className="font-mono text-xs text-on-background font-semibold">
                        {Math.round(cityRow.peak_icu_beds).toLocaleString()}
                      </span>
                    </div>
                  </>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* Scrubber overlay */}
      <div className="absolute bottom-0 left-0 right-0 bg-surface/92 backdrop-blur-sm px-4 py-2 border-t border-outline z-10">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setIsPlaying(p => !p)}
            className="shrink-0 flex items-center gap-2 bg-primary text-on-primary px-3 py-1.5 rounded-lg text-xs font-mono font-medium hover:opacity-90 transition-opacity"
          >
            {isPlaying ? (
              <>
                <svg width="8" height="10" viewBox="0 0 10 12" fill="currentColor">
                  <rect x="1" y="2" width="3" height="8" />
                  <rect x="6" y="2" width="3" height="8" />
                </svg>
                Pause
              </>
            ) : (
              <>
                <svg width="8" height="10" viewBox="0 0 10 12" fill="currentColor">
                  <polygon points="2,2 2,10 9,6" />
                </svg>
                Play simulation
              </>
            )}
          </button>
          <span className="font-mono text-sm text-on-surface-variant shrink-0">
            Day <span className="text-on-background font-semibold">{simulationDay}</span>
            <span className="text-xs ml-2 opacity-60">
              {simulationDay <= 32 ? '· Containment' : simulationDay <= 55 ? '· Exponential Liftoff' : `· ${INTERVENTION_LABELS[activeIntervention] ?? activeIntervention}`}
            </span>
          </span>
          <input
            type="range" min={1} max={180} value={simulationDay}
            onChange={e => {
              setIsPlaying(false);
              onDayChange(Number(e.target.value));
            }}
            className="flex-1 accent-primary h-1.5 rounded-full"
          />
        </div>
      </div>
    </div>
  );
}
