import { useMemo, useState, useEffect, useRef } from 'react';
import type { CityStatus } from '../../hooks/useCityStatus';
import { BACKEND_URL } from '../../config/backend';
import * as maplibregl from 'maplibre-gl';
import { setWorkerUrl } from 'maplibre-gl';
// @ts-ignore
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import 'maplibre-gl/dist/maplibre-gl.css';

setWorkerUrl(maplibreWorkerUrl);

interface BubbleMapProps {
  cityData: Record<string, Record<string, CityStatus[]>>;
  resourceData: Record<string, any[]>;
  activeIntervention: string;
  simulationDay: number;
  onDayChange: (day: number | ((prev: number) => number)) => void;
  onInterventionChange: (intervention: string) => void;
  customInterventions?: Array<{ key: string; label: string; color: string }>;
  onHandoffToPlanner?: (cuts: Array<{ src: string; tgt: string; modes: string[] }>) => void;
  originCity?: string;
  isLandingMini?: boolean;
}

const INTERVENTIONS = [
  { key: 'none', label: 'Baseline', color: '#C62828' },
  { key: 'rail_only', label: 'Transit Halt', color: '#F57F17' },
  { key: 'partial', label: 'Partial Lockdown', color: '#2E4A8C' },
  { key: 'full', label: 'Full Quarantine', color: '#2E7D32' },
];

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

interface RegionalCordon {
  id: string;
  name: string;
  badge: string;
  cities: string[];
  color: string;
  description: string;
}

const REGIONAL_CORDONS: RegionalCordon[] = [
  {
    id: 'south',
    name: 'Southern Rail Corridor',
    badge: 'South Rail Cordon',
    cities: ['KOCHI', 'BENGALURU', 'CHENNAI', 'HYDERABAD'],
    color: '#2563EB', // Tactical Deep Blue
    description: 'Quarantines the southern peninsula inter-state rail network.',
  },
  {
    id: 'ncr',
    name: 'NCR & Northern Belt',
    badge: 'North Belt Cordon',
    cities: ['DELHI', 'JAIPUR', 'LUCKNOW', 'PATNA'],
    color: '#D97706', // Tactical Amber
    description: 'Isolates Delhi NCR, Rajasthan, and the upper Gangetic basin.',
  },
  {
    id: 'west',
    name: 'Western Industrial Hub',
    badge: 'West Hub Cordon',
    cities: ['MUMBAI', 'PUNE', 'AHMEDABAD'],
    color: '#0D9488', // Tactical Teal
    description: 'Severs inter-regional links along the western economic spine.',
  },
];

export default function BubbleMap({
  cityData,
  resourceData,
  activeIntervention,
  simulationDay,
  onDayChange,
  onInterventionChange,
  customInterventions = [],
  onHandoffToPlanner,
  originCity,
  isLandingMini = false,
}: BubbleMapProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [selectedCity, setSelectedCity] = useState<string | null>(null);

  // Network & Spatial Intervention State
  const [activeCordons, setActiveCordons] = useState<Set<string>>(new Set());
  // Maps edgeKey (e.g. 'HYDERABAD-MUMBAI') to the list of severed modes (subset of ['road', 'rail', 'air'])
  const [edgeModeCuts, setEdgeModeCuts] = useState<Record<string, string[]>>({});
  const [selectedEdge, setSelectedEdge] = useState<{
    from: string;
    to: string;
    type: string;
    defaultWeight: number;
  } | null>(null);
  const [hoveredEdgeKey, setHoveredEdgeKey] = useState<string | null>(null);

  // Detect true origin city from props or from Day 1 active cases in cityData
  const detectedOriginCity = useMemo(() => {
    if (originCity) return originCity.toUpperCase();
    for (const [cityName, interventions] of Object.entries(cityData || {})) {
      const rows = interventions[activeIntervention] || interventions['none'] || Object.values(interventions)[0] || [];
      const day1 = rows.find(r => Number(r.day) === 1);
      if (day1 && Number(day1.active_cases_p50) > 0) {
        return cityName.toUpperCase();
      }
    }
    return 'KOCHI';
  }, [originCity, cityData, activeIntervention]);

  // Real-time ODE fast preview state
  const [liveCityCurves, setLiveCityCurves] = useState<Record<string, number[]> | null>(null);
  const [previewData, setPreviewData] = useState<any | null>(null);
  const [baselinePreviewData, setBaselinePreviewData] = useState<any | null>(null);
  const [showImpactModal, setShowImpactModal] = useState<boolean>(false);
  const [modalTab, setModalTab] = useState<'trajectory' | 'cities'>('trajectory');
  const [modalDay, setModalDay] = useState<number>(simulationDay);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);

  // Invalidate baseline preview cache when origin city or intervention changes
  useEffect(() => {
    setBaselinePreviewData(null);
  }, [detectedOriginCity, activeIntervention]);

  useEffect(() => {
    setModalDay(simulationDay);
  }, [simulationDay]);

  const getEdgeKey = (a: string, b: string) => [a, b].sort().join('-');

  const isEdgeCutByCordon = (cityA: string, cityB: string, cordons: Set<string>) => {
    for (const cordonId of cordons) {
      const cordon = REGIONAL_CORDONS.find(c => c.id === cordonId);
      if (!cordon) continue;
      const aIn = cordon.cities.includes(cityA);
      const bIn = cordon.cities.includes(cityB);
      if ((aIn && !bIn) || (!aIn && bIn)) {
        return true;
      }
    }
    return false;
  };

  const getEffectiveEdgeCuts = (cityA: string, cityB: string): string[] => {
    const key = getEdgeKey(cityA, cityB);
    if (edgeModeCuts[key] !== undefined) {
      return edgeModeCuts[key];
    }
    if (isEdgeCutByCordon(cityA, cityB, activeCordons)) {
      return ['road', 'rail', 'air'];
    }
    return [];
  };

  const toggleEdgeModeCut = (cityA: string, cityB: string, mode: string) => {
    const key = getEdgeKey(cityA, cityB);
    setEdgeModeCuts(prev => {
      const current = prev[key] !== undefined
        ? prev[key]
        : (isEdgeCutByCordon(cityA, cityB, activeCordons) ? ['road', 'rail', 'air'] : []);
      const nextModes = current.includes(mode)
        ? current.filter(m => m !== mode)
        : [...current, mode];
      return {
        ...prev,
        [key]: nextModes,
      };
    });
  };

  const setAllEdgeModes = (cityA: string, cityB: string, severAll: boolean) => {
    const key = getEdgeKey(cityA, cityB);
    setEdgeModeCuts(prev => ({
      ...prev,
      [key]: severAll ? ['road', 'rail', 'air'] : [],
    }));
  };

  const resetAllNetworkControls = () => {
    setActiveCordons(new Set());
    setEdgeModeCuts({});
    setSelectedEdge(null);
    setLiveCityCurves(null);
    setPreviewData(null);
    setShowImpactModal(false);
  };

  const toggleCordon = (cordonId: string) => {
    setActiveCordons(prev => {
      const next = new Set(prev);
      if (next.has(cordonId)) {
        next.delete(cordonId);
      } else {
        next.add(cordonId);
      }
      return next;
    });
  };

  const buildEdgeCutsPayload = () => {
    const cuts: Array<{ src: string; tgt: string; modes: string[] }> = [];
    const allCityKeys = Object.keys(CITIES);
    for (let i = 0; i < allCityKeys.length; i++) {
      for (let j = i + 1; j < allCityKeys.length; j++) {
        const src = allCityKeys[i];
        const tgt = allCityKeys[j];
        const severed = getEffectiveEdgeCuts(src, tgt);
        if (severed.length > 0) {
          cuts.push({ src, tgt, modes: severed });
          cuts.push({ src: tgt, tgt: src, modes: severed });
        }
      }
    }
    return cuts;
  };

  // Real-time ODE Fast Preview effect
  useEffect(() => {
    if (activeCordons.size === 0 && Object.keys(edgeModeCuts).length === 0) {
      setLiveCityCurves(null);
      setPreviewData(null);
      return;
    }

    const cuts = buildEdgeCutsPayload();
    if (cuts.length === 0) {
      setLiveCityCurves(null);
      setPreviewData(null);
      return;
    }

    const timer = setTimeout(async () => {
      setIsPreviewLoading(true);
      try {
        const fetchBaseline = !baselinePreviewData
          ? fetch(`${BACKEND_URL}/api/v1/playground/preview`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              origin_city: detectedOriginCity,
              n_days: 180,
              intervention: activeIntervention,
              edge_cuts: [],
            }),
          }).then(r => r.json())
          : Promise.resolve(baselinePreviewData);

        const fetchCordon = fetch(`${BACKEND_URL}/api/v1/playground/preview`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            origin_city: detectedOriginCity,
            n_days: 180,
            intervention: activeIntervention,
            edge_cuts: cuts,
          }),
        }).then(r => r.json());

        const [baseData, cordData] = await Promise.all([fetchBaseline, fetchCordon]);

        if (baseData && baseData.status === 'success') {
          setBaselinePreviewData(baseData);
        }
        if (cordData && cordData.status === 'success') {
          setPreviewData(cordData);
          if (cordData.city_curves) {
            setLiveCityCurves(cordData.city_curves);
          }
        }
      } catch (err) {
        console.error('Fast ODE preview fetch error:', err);
      } finally {
        setIsPreviewLoading(false);
      }
    }, 60);

    return () => clearTimeout(timer);
  }, [activeCordons, edgeModeCuts, activeIntervention, BACKEND_URL, baselinePreviewData, detectedOriginCity]);

  const allInterventions = useMemo(() => {
    const standardKeys = new Set(['none', 'rail_only', 'partial', 'full']);
    const extras = customInterventions.filter(i => !standardKeys.has(i.key));
    return [...INTERVENTIONS, ...extras];
  }, [customInterventions]);

  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [, forceRerender] = useState(0);

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    // Map Style Options:
    // - Default: `https://api.maptiler.com/maps/basic-v2/style.json?key=${import.meta.env.VITE_MAPTILER_KEY}`
    // - Carto Positron: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json'
    // - Stamen Toner: `https://api.maptiler.com/maps/toner-v2/style.json?key=${import.meta.env.VITE_MAPTILER_KEY}`
    // - MapTiler Pastel (Aquarelle/Soft): `https://api.maptiler.com/maps/pastel/style.json?key=${import.meta.env.VITE_MAPTILER_KEY}`
    const mapStyleUrl = `https://api.maptiler.com/maps/pastel/style.json?key=${import.meta.env.VITE_MAPTILER_KEY}`;

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: mapStyleUrl,
      center: isLandingMini ? [79.6, 21.8] : [82.5, 22.5],
      zoom: isLandingMini ? 3.60 : 3.3,
      minZoom: isLandingMini ? 3.05 : 3,
      maxZoom: isLandingMini ? 3.40 : 8,
      interactive: !isLandingMini,
      maxBounds: isLandingMini ? [[58.0, 3.0], [102.0, 40.0]] : undefined,
      attributionControl: false,
    });

    if (isLandingMini) {
      map.dragPan.disable();
      map.scrollZoom.disable();
      map.boxZoom.disable();
      map.dragRotate.disable();
      map.keyboard.disable();
      map.doubleClickZoom.disable();
      map.touchZoomRotate.disable();
    }

    const hideBaseSymbols = () => {
      try {
        const styleLayers = map.getStyle()?.layers || [];
        for (const l of styleLayers) {
          if (l.type === 'symbol') {
            map.setLayoutProperty(l.id, 'visibility', 'none');
          }
        }
      } catch (err) {
        console.warn('Could not hide base symbol layers:', err);
      }
    };

    map.on('load', () => {
      map.resize();
      hideBaseSymbols();

      map.addSource('india-states', {
        type: 'geojson',
        data: '/india_states_soi_simplified.geojson',
      });
      map.addLayer({
        id: 'state-fills',
        type: 'fill',
        source: 'india-states',
        paint: {
          'fill-color': '#CBD5E1',
          'fill-opacity': isLandingMini ? 0.12 : 0.18,
        },
      });
      map.addLayer({
        id: 'state-borders',
        type: 'line',
        source: 'india-states',
        paint: {
          'line-color': '#94A3B8',
          'line-width': isLandingMini ? 0.8 : 1,
        },
      });
      setMapReady(true);
    });

    map.on('styledata', hideBaseSymbols);
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
      let cases = 0;
      let p10 = 0;
      let p90 = 0;

      if (liveCityCurves && liveCityCurves[cityKey]) {
        const dayIdx = Math.max(0, Math.min(179, simulationDay - 1));
        cases = liveCityCurves[cityKey][dayIdx] ?? 0;
        p10 = Math.round(cases * 0.85);
        p90 = Math.round(cases * 1.15);
      } else {
        const normalizedKey = Object.keys(cityData).find(
          k => k.toLowerCase() === cityKey.toLowerCase()
        ) ?? cityKey;
        const cityRows = cityData[normalizedKey]?.[activeIntervention] ?? [];
        const row = cityRows.find(r => Number(r.day) === Number(simulationDay));
        cases = parseFloat(String(row?.active_cases_p50 ?? '0'));
        p10 = parseFloat(String(row?.active_cases_p10 ?? '0'));
        p90 = parseFloat(String(row?.active_cases_p90 ?? '0'));
      }

      casesByCity[cityKey] = cases;
      statsByCity[cityKey] = {
        cases,
        p10,
        p90,
      };
    });

    const allCases = Object.values(casesByCity);
    const max = allCases.length > 0 ? Math.max(...allCases) : 0;

    const sortedCities = Object.entries(casesByCity)
      .sort((a, b) => b[1] - a[1])
      .map(entry => entry[0]);
    const topThree = new Set(sortedCities.slice(0, 3));

    return { cityCases: casesByCity, maxCases: max, topThreeCities: topThree, cityStats: statsByCity };
  }, [cityData, activeIntervention, simulationDay, liveCityCurves]);

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
    <div className="relative w-full h-full bg-[#F4F5F7] overflow-hidden">
      {/* Interactive Guidance Card (Vertical, compact, top-left over Northwest space) */}
      {isLandingMini && (
        <div className="absolute top-3 left-3 z-10 pointer-events-none">
          <div className="bg-white/95 backdrop-blur-md rounded-xl p-2.5 border border-slate-200/90 shadow-xs w-[135px] pointer-events-auto">
            <div className="flex items-center gap-1.5 mb-2">
              <span className="w-1.5 h-1.5 rounded-full bg-[#2E4A8C] animate-pulse shrink-0" />
              <span className="text-[9px] font-mono uppercase tracking-wider font-bold text-slate-700">
                Explore
              </span>
            </div>

            <div className="space-y-2 text-[10px] font-sans text-slate-600 leading-tight">
              <div>
                <span className="font-semibold text-slate-800 block text-[10px] mb-0.5">
                  Touch Hubs
                </span>
                <span className="text-[9.5px] text-slate-500 leading-tight block">
                  Inspect active cases &amp; attack rate
                </span>
              </div>

              <div className="border-t border-slate-200/80 pt-1.5">
                <span className="font-semibold text-slate-800 block text-[10px] mb-0.5">
                  Timeline
                </span>
                <span className="text-[9.5px] text-slate-500 leading-tight block">
                  Scrub or run 180-day spread
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Top overlay */}
      {!isLandingMini && (
        <div className="absolute top-0 left-0 right-0 flex flex-col gap-2 p-3 pointer-events-none z-10">
          <div className="flex items-start justify-between">
            <div className="bg-surface/90 backdrop-blur-sm px-3 py-2 rounded-lg border border-outline pointer-events-auto shadow-sm">
              <p className="font-heading font-semibold text-on-background text-xs">City-Level Spread & Network Flows</p>
              <p className="font-mono text-[10px] text-on-surface-variant">Interactive Corridor Capacity & Spatial Cordons</p>
            </div>

            <div className="flex gap-1.5 flex-wrap justify-end pointer-events-auto">
              {allInterventions.map(inv => (
                <button
                  key={inv.key}
                  onClick={() => onInterventionChange(inv.key)}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-mono border transition-all ${activeIntervention === inv.key
                    ? 'bg-surface border-outline text-on-background shadow-sm font-semibold'
                    : 'bg-surface/70 border-outline/50 text-on-surface-variant opacity-60 hover:opacity-80'
                    }`}
                >
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: inv.color }} />
                  {inv.label}
                </button>
              ))}
            </div>
          </div>

          {/* Regional Cordon Sanitaire Controls */}
          <div className="flex items-center gap-1.5 flex-wrap pointer-events-auto bg-surface/90 backdrop-blur-sm p-1.5 rounded-xl border border-outline shadow-sm max-w-fit">
            <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-on-surface-variant px-1 flex items-center gap-1.5">
              <svg className="w-3.5 h-3.5 text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
              <span>Cordon Sanitaire:</span>
            </span>
            {REGIONAL_CORDONS.map(cordon => {
              const isActive = activeCordons.has(cordon.id);
              return (
                <button
                  key={cordon.id}
                  onClick={() => toggleCordon(cordon.id)}
                  style={isActive ? { borderColor: cordon.color } : undefined}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-sans transition-all border-2 ${isActive
                    ? 'bg-surface text-on-surface font-bold shadow-xs'
                    : 'border-outline/40 bg-surface/80 text-on-surface-variant hover:bg-surface-variant/60 font-medium'
                    }`}
                  title={cordon.description}
                >
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: cordon.color }} />
                  <span>{cordon.badge}</span>
                  {isActive && (
                    <span
                      className="text-[9px] px-1.5 py-0.5 rounded font-mono font-bold tracking-wider"
                      style={{ backgroundColor: `${cordon.color}18`, color: cordon.color }}
                    >
                      ACTIVE
                    </span>
                  )}
                </button>
              );
            })}

            {(activeCordons.size > 0 || Object.keys(edgeModeCuts).length > 0) && (
              <>
                <div className="h-5 w-[1px] bg-outline/40 mx-0.5" />

                {/* Action 1: Inspect 180-Day Impact */}
                <button
                  onClick={() => setShowImpactModal(true)}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold bg-surface hover:bg-surface-variant text-on-surface border border-outline/50 hover:border-outline shadow-xs transition-all cursor-pointer active:scale-95 shrink-0"
                  title="Open interactive 180-day impact projection modal"
                >
                  <svg className={`w-3.5 h-3.5 text-primary shrink-0 ${isPreviewLoading ? 'animate-spin' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                  </svg>
                  <span>Inspect 180-Day Impact</span>
                </button>

                {/* Action 2: Send to Plan */}
                {onHandoffToPlanner && (
                  <button
                    onClick={() => {
                      const cuts = buildEdgeCutsPayload();
                      onHandoffToPlanner(cuts);
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary text-white hover:bg-primary/90 shadow-xs transition-all cursor-pointer active:scale-95 shrink-0"
                    title="Transfer network edge cuts to the Custom Intervention Plan for full simulation"
                  >
                    <svg className="w-3.5 h-3.5 text-white/90 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="5" y1="12" x2="19" y2="12" />
                      <polyline points="12 5 19 12 12 19" />
                    </svg>
                    <span>Send to Plan</span>
                  </button>
                )}

                {/* Action 3: Reset */}
                <button
                  onClick={resetAllNetworkControls}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-on-surface-variant hover:text-on-surface bg-surface hover:bg-surface-variant border border-outline/40 hover:border-outline transition-all cursor-pointer shadow-xs active:scale-95 shrink-0"
                  title="Clear all active cordons and restore baseline mobility capacities"
                >
                  <svg className="w-3.5 h-3.5 text-on-surface-variant shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                    <path d="M3 3v5h5" />
                  </svg>
                  <span>Reset</span>
                </button>
              </>
            )}
          </div>
        </div>
      )}

      <div ref={mapContainerRef} style={{ width: '100%', height: '100%', minHeight: isLandingMini ? '100%' : '420px' }} />

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

          {/* Mobility Edges with Interactive Hitboxes & Capacity Styling */}
          {MOBILITY_EDGES.map((edge, idx) => {
            const [cityAKey, cityBKey, weight, type] = edge;
            const posA = project(cityAKey as string);
            const posB = project(cityBKey as string);
            if (!posA || !posB) return null;

            const aTop = topThreeCities.has(cityAKey as string);
            const bTop = topThreeCities.has(cityBKey as string);
            const bothTop = aTop && bTop;

            const edgeKey = getEdgeKey(cityAKey as string, cityBKey as string);
            const severedModes = getEffectiveEdgeCuts(cityAKey as string, cityBKey as string);
            const isFullySevered = severedModes.length === 3;
            const isPartiallySevered = severedModes.length > 0 && !isFullySevered;
            const isSelected = selectedEdge && getEdgeKey(selectedEdge.from, selectedEdge.to) === edgeKey;
            const isHovered = hoveredEdgeKey === edgeKey;

            const strokeColor = isFullySevered
              ? '#DC2626'
              : isPartiallySevered
                ? '#D97706'
                : interventionEdgeColor;

            const strokeWidth = isSelected
              ? 3.5
              : (weight as number) > 0.1
                ? 2.2
                : (weight as number) > 0.04
                  ? 1.6
                  : 1.2;

            const strokeDash = isFullySevered
              ? '4 3'
              : isPartiallySevered
                ? '6 3'
                : type === 'air'
                  ? '4 4'
                  : undefined;

            const strokeOpacity = isFullySevered
              ? 0.9
              : isPartiallySevered
                ? 0.8
                : bothTop
                  ? 0.5 + (weight as number) * 0.4
                  : 0.15 + (weight as number) * 0.3;

            const midX = (posA.x + posB.x) / 2;
            const midY = (posA.y + posB.y) / 2;

            return (
              <g key={`edge-${idx}`}>
                {/* Halo for selected edge */}
                {isSelected && (
                  <line
                    x1={posA.x} y1={posA.y}
                    x2={posB.x} y2={posB.y}
                    stroke="#2563EB"
                    strokeWidth={strokeWidth + 6}
                    strokeOpacity={0.35}
                    strokeLinecap="round"
                  />
                )}

                {/* Visual edge line */}
                <line
                  x1={posA.x} y1={posA.y}
                  x2={posB.x} y2={posB.y}
                  stroke={strokeColor}
                  strokeWidth={isHovered ? strokeWidth + 1 : strokeWidth}
                  strokeDasharray={strokeDash}
                  strokeOpacity={strokeOpacity}
                  style={{ transition: 'stroke 0.2s, stroke-width 0.2s, stroke-opacity 0.2s' }}
                />

                {/* Severed Badge Marker on Midpoint */}
                {isFullySevered && (
                  <g transform={`translate(${midX}, ${midY})`} style={{ pointerEvents: 'none' }}>
                    <circle r={7} fill="#DC2626" stroke="#FFFFFF" strokeWidth={1.5} />
                    <line x1={-3} y1={-3} x2={3} y2={3} stroke="#FFFFFF" strokeWidth={1.5} strokeLinecap="round" />
                    <line x1={3} y1={-3} x2={-3} y2={3} stroke="#FFFFFF" strokeWidth={1.5} strokeLinecap="round" />
                  </g>
                )}

                {/* Partially Severed Badge Marker on Midpoint */}
                {isPartiallySevered && (
                  <g transform={`translate(${midX}, ${midY})`} style={{ pointerEvents: 'none' }}>
                    <circle r={6.5} fill="#D97706" stroke="#FFFFFF" strokeWidth={1.2} />
                    <text y={2.5} textAnchor="middle" fontSize={6} fill="#FFFFFF" fontFamily="var(--font-mono)" fontWeight="bold">
                      {severedModes.length}/3
                    </text>
                  </g>
                )}

                {/* Invisible thick hit-target line for clicking */}
                <line
                  x1={posA.x} y1={posA.y}
                  x2={posB.x} y2={posB.y}
                  stroke="transparent"
                  strokeWidth={18}
                  style={{ cursor: 'pointer', pointerEvents: 'stroke' }}
                  onMouseEnter={() => setHoveredEdgeKey(edgeKey)}
                  onMouseLeave={() => setHoveredEdgeKey(null)}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedCity(null);
                    setSelectedEdge({
                      from: cityAKey as string,
                      to: cityBKey as string,
                      type: type as string,
                      defaultWeight: weight as number,
                    });
                  }}
                >
                  <title>
                    Corridor: {cityAKey} ↔ {cityBKey} ({type.toUpperCase()}) — {isFullySevered ? '🚫 Severed (All modes 0%)' : isPartiallySevered ? `⚠️ Partial (${severedModes.join(', ')} cut)` : '✅ Active (All modes open)'} (Click to configure)
                  </title>
                </line>
              </g>
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
                {/* Regional Cordon Perimeter Rings */}
                {activeCordons.size > 0 && (() => {
                  const cordonForCity = REGIONAL_CORDONS.find(c => activeCordons.has(c.id) && c.cities.includes(cityKey));
                  if (!cordonForCity) return null;
                  return (
                    <circle
                      cx={pos.x} cy={pos.y}
                      r={radius + 8}
                      fill="none"
                      stroke={cordonForCity.color}
                      strokeWidth={2}
                      strokeDasharray="4 2"
                      opacity={0.85}
                      style={{ pointerEvents: 'none' }}
                    />
                  );
                })()}

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
                    strokeWidth={1.5}
                    strokeDasharray="3 3"
                    opacity={0.6}
                  />
                )}

                <text
                  x={pos.x}
                  y={pos.y - radius - 5}
                  textAnchor="middle"
                  fontSize={radius > 14 ? 9.5 : 8.5}
                  fontWeight="500"
                  fill="#475569"
                  stroke="#FFFFFF"
                  strokeWidth={1.8}
                  strokeOpacity={0.9}
                  paintOrder="stroke fill"
                  strokeLinejoin="round"
                  fontFamily="var(--font-mono)"
                  letterSpacing="0.02em"
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

      {/* Floating Corridor Modal Cuts Popover */}
      {!isLandingMini && selectedEdge && (
        <div
          style={{
            position: 'absolute',
            bottom: '72px',
            right: '12px',
            width: '310px',
            zIndex: 20,
          }}
          className="bg-surface/95 backdrop-blur-md border border-outline rounded-xl shadow-xl p-3.5 text-on-surface animate-in fade-in slide-in-from-bottom-2"
        >
          {/* Header */}
          <div className="flex items-start justify-between pb-2.5 mb-2.5 border-b border-outline/50">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-primary/10 text-primary uppercase font-bold tracking-wider">
                  Corridor Control
                </span>
                <span className="text-[10px] font-mono text-on-surface-variant font-medium">
                  Weight: {selectedEdge.defaultWeight.toFixed(3)}
                </span>
              </div>
              <h4 className="font-heading font-semibold text-on-background text-sm mt-1">
                {CITIES[selectedEdge.from]?.displayName ?? selectedEdge.from} ↔ {CITIES[selectedEdge.to]?.displayName ?? selectedEdge.to}
              </h4>
            </div>
            <button
              onClick={() => setSelectedEdge(null)}
              className="text-on-surface-variant hover:text-on-background rounded-md p-1 hover:bg-surface-variant transition-colors cursor-pointer"
              title="Close panel"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>

          {(() => {
            const severedModes = getEffectiveEdgeCuts(selectedEdge.from, selectedEdge.to);
            const isCutByCordon = isEdgeCutByCordon(selectedEdge.from, selectedEdge.to, activeCordons);
            const isFullySevered = severedModes.length === 3;
            const isPartiallySevered = severedModes.length > 0 && !isFullySevered;

            const MODES = [
              {
                key: 'rail',
                label: 'Rail Corridor',
                share: '40%',
                desc: 'Passenger & freight rail network',
                icon: (
                  <svg className="w-3.5 h-3.5 text-on-surface-variant" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="4" y="3" width="16" height="16" rx="2" />
                    <path d="M4 11h16" />
                    <path d="M12 3v8" />
                    <path d="m8 19-2 3" />
                    <path d="m16 19 2 3" />
                    <circle cx="8" cy="15" r="1" />
                    <circle cx="16" cy="15" r="1" />
                  </svg>
                )
              },
              {
                key: 'air',
                label: 'Air Corridor',
                share: '20%',
                desc: 'Scheduled commercial aviation',
                icon: (
                  <svg className="w-3.5 h-3.5 text-on-surface-variant" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z" />
                  </svg>
                )
              },
              {
                key: 'road',
                label: 'Highway / Road',
                share: '40%',
                desc: 'National highway corridors',
                icon: (
                  <svg className="w-3.5 h-3.5 text-on-surface-variant" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="1" y="3" width="15" height="13" />
                    <polygon points="16 8 20 8 23 11 23 16 16 16 8" />
                    <circle cx="5.5" cy="18.5" r="2.5" />
                    <circle cx="18.5" cy="18.5" r="2.5" />
                  </svg>
                )
              },
            ] as const;

            return (
              <div className="space-y-2.5">
                {/* Status Indicator */}
                <div className={`px-2.5 py-1.5 rounded-lg border text-xs font-mono flex items-center justify-between ${isFullySevered
                  ? 'bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/20'
                  : isPartiallySevered
                    ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20'
                    : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20'
                  }`}>
                  <div className="flex items-center gap-1.5 font-semibold">
                    <span className={`w-1.5 h-1.5 rounded-full ${isFullySevered ? 'bg-rose-500' : isPartiallySevered ? 'bg-amber-500' : 'bg-emerald-500'
                      }`} />
                    <span>
                      {isFullySevered
                        ? 'Containment Active (0%)'
                        : isPartiallySevered
                          ? `Throttled (${severedModes.length}/3 Cut)`
                          : 'Operational (100%)'}
                    </span>
                  </div>
                  <span className="text-[10px] opacity-75 font-sans">
                    {isFullySevered ? 'Full Lockdown' : isPartiallySevered ? 'Partial Flow' : 'Unrestricted'}
                  </span>
                </div>

                {isCutByCordon && edgeModeCuts[getEdgeKey(selectedEdge.from, selectedEdge.to)] === undefined && (
                  <div className="text-[10px] font-mono bg-primary/10 text-primary border border-primary/20 p-2 rounded-lg flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
                    <span>Isolated by Active Regional Cordon Sanitaire</span>
                  </div>
                )}

                {/* Per-Mode Direct Cut Toggles */}
                <div className="space-y-1.5">
                  {MODES.map(m => {
                    const isCut = severedModes.includes(m.key);
                    return (
                      <div
                        key={m.key}
                        className={`flex items-center justify-between p-2 rounded-lg border transition-all ${isCut
                          ? 'bg-rose-500/5 border-rose-500/30'
                          : 'bg-surface border-outline/50 hover:border-outline'
                          }`}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <div className={`w-6 h-6 rounded flex items-center justify-center shrink-0 border ${isCut
                            ? 'bg-rose-500/10 border-rose-500/20 text-rose-600'
                            : 'bg-surface-variant/50 border-outline/40 text-on-surface-variant'
                            }`}>
                            {m.icon}
                          </div>
                          <div className="min-w-0">
                            <div className="text-xs font-medium text-on-surface flex items-center gap-1">
                              <span className="truncate">{m.label}</span>
                              <span className="text-[10px] font-mono text-on-surface-variant/70">
                                {m.share}
                              </span>
                            </div>
                            <div className="text-[10px] text-on-surface-variant/80 truncate">
                              {isCut ? 'Corridor halted (0% flow)' : m.desc}
                            </div>
                          </div>
                        </div>

                        <button
                          onClick={() => toggleEdgeModeCut(selectedEdge.from, selectedEdge.to, m.key)}
                          className={`px-2 py-0.5 rounded text-[10px] font-mono font-medium transition-all cursor-pointer border shrink-0 ml-2 ${isCut
                            ? 'bg-rose-500/10 text-rose-600 border-rose-500/30 hover:bg-rose-500/20 font-semibold'
                            : 'bg-surface border-outline/70 text-on-surface-variant hover:border-primary hover:text-primary'
                            }`}
                        >
                          {isCut ? 'Severed' : 'Active'}
                        </button>
                      </div>
                    );
                  })}
                </div>

                {/* Quick Bulk Actions */}
                <div className="flex gap-2 pt-2 border-t border-outline/40">
                  <button
                    onClick={() => setAllEdgeModes(selectedEdge.from, selectedEdge.to, true)}
                    className="flex-1 py-1 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 border border-rose-500/20 text-[11px] font-sans font-medium transition-colors cursor-pointer"
                  >
                    Sever Corridor
                  </button>
                  <button
                    onClick={() => setAllEdgeModes(selectedEdge.from, selectedEdge.to, false)}
                    className="flex-1 py-1 rounded-lg bg-surface-variant/60 hover:bg-surface-variant text-on-surface border border-outline/60 text-[11px] font-sans font-medium transition-colors cursor-pointer"
                  >
                    Restore Baseline
                  </button>
                </div>
              </div>
            );
          })()}
        </div>
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
              <h4 className="font-heading font-semibold text-on-background text-sm">
                {selectedCityData.displayName}
              </h4>
              <p className="font-mono text-xs text-on-surface-variant mt-0.5">
                Day {simulationDay} · {allInterventions.find(i => i.key === activeIntervention)?.label ?? activeIntervention}
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
                Run simulation
              </>
            )}
          </button>
          <span className="font-mono text-xs sm:text-sm text-on-surface-variant shrink-0">
            Day <span className="text-on-background font-semibold">{simulationDay}</span>
            {!isLandingMini && (
              <span className="text-xs ml-2 opacity-60">
                {simulationDay <= 32 ? '· Containment' : simulationDay <= 55 ? '· Exponential Liftoff' : `· ${allInterventions.find(i => i.key === activeIntervention)?.label ?? activeIntervention}`}
              </span>
            )}
          </span>
          <input
            type="range" min={1} max={180} value={simulationDay}
            onChange={e => {
              setIsPlaying(false);
              onDayChange(Number(e.target.value));
            }}
            className="flex-1 min-w-[70px] accent-primary h-1.5 rounded-full"
          />
        </div>
      </div>

      {/* Executive Cordon Sanitaire Impact Modal (Professional Two-Column Layout) */}
      {!isLandingMini && showImpactModal && previewData && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/50 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowImpactModal(false);
          }}
        >
          <div className="relative flex flex-col bg-background shadow-2xl rounded-2xl overflow-hidden border border-outline w-full max-w-5xl h-[88vh] max-h-[840px]">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 bg-surface border-b border-outline shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shrink-0">
                  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                  </svg>
                </div>
                <div>
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <h2 className="text-base font-semibold font-heading text-on-surface tracking-tight">
                      Spatial Cordon Sanitaire Impact Analysis
                    </h2>
                    <span className="text-[11px] px-2.5 py-0.5 rounded-full bg-surface-container font-sans text-on-surface-variant border border-outline font-medium">
                      Fast ODE · Epicenter: {detectedOriginCity}
                    </span>
                  </div>
                  <p className="text-xs text-on-surface-variant font-sans mt-0.5">
                    180-Day Epidemic Trajectory & Multi-City Network Dampening Analysis
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div className="hidden sm:flex items-center gap-1.5 flex-wrap">
                  {Array.from(activeCordons).map(cid => {
                    const c = REGIONAL_CORDONS.find(rc => rc.id === cid);
                    return (
                      <span
                        key={cid}
                        style={{ borderColor: c ? `${c.color}50` : undefined, color: c?.color }}
                        className="text-xs font-sans px-2.5 py-0.5 rounded-full bg-surface border-2 font-bold"
                      >
                        {c?.badge ?? cid}
                      </span>
                    );
                  })}
                  {Object.keys(edgeModeCuts).length > 0 && (
                    <span className="text-xs font-sans px-2.5 py-0.5 rounded-full bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/20 font-semibold">
                      {Object.keys(edgeModeCuts).length} Custom Cuts
                    </span>
                  )}
                </div>
                <button
                  onClick={() => setShowImpactModal(false)}
                  className="p-1.5 rounded-lg text-on-surface-variant hover:bg-surface-variant transition-colors"
                  title="Close Analysis"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                  </svg>
                </button>
              </div>
            </div>

            {/* Modal Body: Non-sticky scrolling container with Tab Switcher, KPIs, and Content */}
            <div className="flex-1 overflow-y-auto p-5 sm:p-6 bg-surface-container/15 min-h-0 space-y-4">

              {/* Tab Navigation Switcher & Horizon Indicator */}
              <div className="flex items-center justify-between flex-wrap gap-2.5 pb-1">
                <div className="flex items-center gap-1.5 p-1 bg-surface-container/80 rounded-xl border border-outline/50 shadow-xs">
                  <button
                    onClick={() => setModalTab('trajectory')}
                    className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-sans transition-all ${modalTab === 'trajectory'
                      ? 'bg-surface text-primary font-bold shadow-xs border border-outline/40'
                      : 'text-on-surface-variant hover:text-on-surface font-medium'
                      }`}
                  >
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                    </svg>
                    <span>National Trajectory & Scrubber</span>
                  </button>
                  <button
                    onClick={() => setModalTab('cities')}
                    className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-sans transition-all ${modalTab === 'cities'
                      ? 'bg-surface text-primary font-bold shadow-xs border border-outline/40'
                      : 'text-on-surface-variant hover:text-on-surface font-medium'
                      }`}
                  >
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect width="18" height="18" x="3" y="3" rx="2" />
                      <line x1="3" x2="21" y1="9" y2="9" />
                      <line x1="9" x2="9" y1="21" y2="9" />
                    </svg>
                    <span>Regional Node Breakdown (15 Cities)</span>
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-xs font-sans text-on-surface-variant">Timeline Horizon:</span>
                  <span className="text-xs font-mono font-bold px-2.5 py-0.5 rounded-full bg-primary/10 border border-primary/25 text-primary">
                    Day {modalDay} <span className="font-normal opacity-70">/ 180</span>
                  </span>
                </div>
              </div>

              {/* Executive KPI Cards (Non-sticky, flows naturally) */}
              {(() => {
                const dayIdx = Math.max(0, Math.min(179, modalDay - 1));
                const baseActive = baselinePreviewData?.national_trajectory?.active?.[dayIdx] ?? 0;
                const cordActive = previewData?.national_trajectory?.active?.[dayIdx] ?? 0;
                const deltaActive = cordActive - baseActive;
                const pctActive = baseActive > 0 ? ((deltaActive / baseActive) * 100).toFixed(1) : '0.0';

                const baseSummary = baselinePreviewData?.summary ?? { peak_day: 157, peak_active_cases: 0, total_deaths: 0 };
                const cordSummary = previewData?.summary ?? { peak_day: 177, peak_active_cases: 0, total_deaths: 0 };
                const peakDelay = Math.max(0, cordSummary.peak_day - baseSummary.peak_day);
                const peakDrop = baseSummary.peak_active_cases > 0
                  ? Math.round(((baseSummary.peak_active_cases - cordSummary.peak_active_cases) / baseSummary.peak_active_cases) * 100)
                  : 0;
                const deathsSaved = Math.max(0, baseSummary.total_deaths - cordSummary.total_deaths);

                return (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div className="bg-surface p-3.5 rounded-xl border border-outline flex flex-col justify-between shadow-xs">
                      <span className="text-[11px] font-sans font-medium text-on-surface-variant">
                        Active Cases (Day {modalDay})
                      </span>
                      <div className="my-1.5">
                        <div className="text-lg font-bold text-on-surface font-mono">
                          {cordActive.toLocaleString()}
                        </div>
                        <div className="text-[11px] font-sans text-on-surface-variant">
                          Baseline: {baseActive.toLocaleString()}
                        </div>
                      </div>
                      <span className={`text-[11px] font-sans font-semibold px-2 py-0.5 rounded-full max-w-fit border ${deltaActive <= 0
                        ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20'
                        : 'bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/20'
                        }`}>
                        {deltaActive <= 0 ? '↓ ' : '↑ '}{Math.abs(deltaActive).toLocaleString()} ({pctActive}%)
                      </span>
                    </div>

                    <div className="bg-surface p-3.5 rounded-xl border border-outline flex flex-col justify-between shadow-xs">
                      <span className="text-[11px] font-sans font-medium text-on-surface-variant">
                        Surge Runway Buffer
                      </span>
                      <div className="my-1.5">
                        <div className="text-lg font-bold text-primary font-mono">
                          +{peakDelay} Days Delay
                        </div>
                        <div className="text-[11px] font-sans text-on-surface-variant">
                          Day {baseSummary.peak_day} → Day {cordSummary.peak_day}
                        </div>
                      </div>
                      <span className="text-[11px] font-sans font-semibold px-2 py-0.5 rounded-full max-w-fit bg-primary/10 text-primary border border-primary/20">
                        Critical Preparedness Window
                      </span>
                    </div>

                    <div className="bg-surface p-3.5 rounded-xl border border-outline flex flex-col justify-between shadow-xs">
                      <span className="text-[11px] font-sans font-medium text-on-surface-variant">
                        Peak Active Load
                      </span>
                      <div className="my-1.5">
                        <div className="text-lg font-bold text-on-surface font-mono">
                          {cordSummary.peak_active_cases >= 1_000_000
                            ? `${(cordSummary.peak_active_cases / 1_000_000).toFixed(2)}M`
                            : cordSummary.peak_active_cases.toLocaleString()}
                        </div>
                        <div className="text-[11px] font-sans text-on-surface-variant">
                          Baseline: {(baseSummary.peak_active_cases / 1_000_000).toFixed(2)}M
                        </div>
                      </div>
                      <span className="text-[11px] font-sans font-semibold px-2 py-0.5 rounded-full max-w-fit bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/20">
                        ↓ {peakDrop}% Peak Load Flattened
                      </span>
                    </div>

                    <div className="bg-surface p-3.5 rounded-xl border border-outline flex flex-col justify-between shadow-xs">
                      <span className="text-[11px] font-sans font-medium text-on-surface-variant">
                        180-Day Mortality
                      </span>
                      <div className="my-1.5">
                        <div className="text-lg font-bold text-rose-600 font-mono">
                          {cordSummary.total_deaths.toLocaleString()}
                        </div>
                        <div className="text-[11px] font-sans text-on-surface-variant">
                          Baseline: {baseSummary.total_deaths.toLocaleString()}
                        </div>
                      </div>
                      <span className="text-[11px] font-sans font-semibold px-2 py-0.5 rounded-full max-w-fit bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20">
                        ↓ {deathsSaved.toLocaleString()} Fatalities Saved
                      </span>
                    </div>
                  </div>
                );
              })()}

              {/* Tab 1: Trajectory with Scrubber ABOVE Graph */}
              {modalTab === 'trajectory' && (
                <div className="space-y-4">
                  {/* 1. Scrubber Control Card (ABOVE Graph as requested) */}
                  <div className="p-4 bg-surface rounded-2xl border border-outline shadow-xs space-y-3">
                    <div className="flex items-center justify-between text-xs font-sans flex-wrap gap-2">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-on-surface">Timeline Horizon Scrubber:</span>
                        <span className="font-bold text-primary font-mono text-xs bg-primary/10 px-3 py-0.5 rounded-full border border-primary/20">
                          Day {modalDay} <span className="font-normal text-on-surface-variant">/ 180</span>
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-[10px] text-on-surface-variant uppercase font-sans font-semibold">Jumps:</span>
                        {[
                          { d: 30, label: 'Day 30 (Containment)' },
                          { d: 60, label: 'Day 60 (Liftoff)' },
                          { d: 90, label: 'Day 90 (Peak)' },
                          { d: 120, label: 'Day 120 (Decline)' },
                          { d: 180, label: 'Day 180 (End)' },
                        ].map(p => (
                          <button
                            key={p.d}
                            onClick={() => setModalDay(p.d)}
                            className={`px-2.5 py-1 rounded-lg text-xs font-sans transition-all border ${modalDay === p.d
                              ? 'bg-primary text-white border-primary font-bold shadow-xs'
                              : 'bg-surface text-on-surface-variant border-outline hover:bg-surface-variant font-medium'
                              }`}
                          >
                            {p.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <input
                      type="range"
                      min={1}
                      max={180}
                      value={modalDay}
                      onChange={e => setModalDay(Number(e.target.value))}
                      className="w-full accent-primary h-2 rounded-lg cursor-pointer bg-surface-container"
                    />
                  </div>

                  {/* 2. Trajectory Chart Card (BELOW Scrubber) */}
                  {(() => {
                    const baseDays = baselinePreviewData?.national_trajectory?.active || [];
                    const cordDays = previewData?.national_trajectory?.active || [];
                    if (baseDays.length === 0 || cordDays.length === 0) return null;

                    const maxVal = Math.max(...baseDays, ...cordDays, 1);
                    const chartW = 860;
                    const chartH = 210;

                    const getSvgPoints = (arr: number[]) => {
                      return arr.map((val, idx) => {
                        const x = (idx / 179) * chartW;
                        const y = chartH - (val / maxVal) * (chartH - 24) - 12;
                        return `${x.toFixed(1)},${y.toFixed(1)}`;
                      }).join(' ');
                    };

                    const basePoints = getSvgPoints(baseDays);
                    const cordPoints = getSvgPoints(cordDays);

                    const dayIdx = Math.max(0, Math.min(179, modalDay - 1));
                    const baseActiveVal = baseDays[dayIdx] || 0;
                    const cordActiveVal = cordDays[dayIdx] || 0;
                    const deltaActive = cordActiveVal - baseActiveVal;

                    const currentX = ((modalDay - 1) / 179) * chartW;
                    const currentCordY = chartH - ((cordDays[modalDay - 1] || 0) / maxVal) * (chartH - 24) - 12;

                    return (
                      <div className="p-5 bg-surface rounded-2xl border border-outline shadow-xs space-y-4">
                        <div className="flex items-center justify-between flex-wrap gap-2">
                          <div>
                            <h3 className="text-xs font-semibold font-heading text-on-surface uppercase tracking-wider">
                              180-Day National Active Transmission Curve
                            </h3>
                            <p className="text-[11px] text-on-surface-variant font-sans mt-0.5">
                              Comparing unmitigated network propagation vs. active spatial cordons
                            </p>
                          </div>
                          <div className="flex items-center gap-4 text-xs font-sans flex-wrap">
                            <span className="flex items-center gap-1.5 text-on-surface-variant">
                              <span className="w-3.5 h-0.5 border-t-2 border-dashed border-red-500 inline-block" /> Baseline: <span className="font-mono font-semibold">{baseDays[modalDay - 1]?.toLocaleString() || '0'}</span>
                            </span>
                            <span className="flex items-center gap-1.5 text-primary font-semibold">
                              <span className="w-3.5 h-1 bg-primary rounded inline-block" /> Cordon: <span className="font-mono font-bold">{cordDays[modalDay - 1]?.toLocaleString() || '0'}</span>
                            </span>
                            {deltaActive < 0 && (
                              <span className="text-[11px] font-sans font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
                                ↓ {Math.abs(deltaActive).toLocaleString()} Averted
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="relative w-full h-[225px] overflow-hidden bg-surface-container/20 rounded-xl p-3 border border-outline/50">
                          <svg viewBox={`0 0 ${chartW} ${chartH}`} className="w-full h-full overflow-visible">
                            <defs>
                              <linearGradient id="proCordonGradTab" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="#2563EB" stopOpacity="0.25" />
                                <stop offset="100%" stopColor="#2563EB" stopOpacity="0.02" />
                              </linearGradient>
                            </defs>

                            {/* Active timeline scrubbed area shading (from Day 1 to modalDay) */}
                            <rect x={0} y={0} width={Math.max(0, currentX)} height={chartH} fill="#2563EB" opacity={0.04} />

                            {/* Y-axis guidelines and magnitude markers */}
                            <line x1="0" y1={chartH - 12} x2={chartW} y2={chartH - 12} stroke="currentColor" strokeOpacity="0.12" strokeWidth="1" />
                            <line x1="0" y1={chartH / 2} x2={chartW} y2={chartH / 2} stroke="currentColor" strokeOpacity="0.06" strokeWidth="1" strokeDasharray="3 3" />
                            <text x={6} y={16} fill="currentColor" opacity={0.35} fontSize={9} fontFamily="var(--font-mono)">
                              {maxVal >= 1_000_000 ? `${(maxVal / 1_000_000).toFixed(1)}M` : maxVal.toLocaleString()}
                            </text>
                            <text x={6} y={chartH / 2 - 4} fill="currentColor" opacity={0.30} fontSize={9} fontFamily="var(--font-mono)">
                              {maxVal >= 1_000_000 ? `${(maxVal / 2_000_000).toFixed(1)}M` : Math.round(maxVal / 2).toLocaleString()}
                            </text>

                            {/* Baseline Polyline */}
                            <polyline
                              fill="none"
                              stroke="#DC2626"
                              strokeWidth="2"
                              strokeDasharray="5 3"
                              opacity="0.85"
                              points={basePoints}
                            />

                            {/* Cordon Area Fill */}
                            <polygon
                              fill="url(#proCordonGradTab)"
                              points={`0,${chartH} ${cordPoints} ${chartW},${chartH}`}
                            />

                            {/* Cordon Active Polyline */}
                            <polyline
                              fill="none"
                              stroke="#2563EB"
                              strokeWidth="3.2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              points={cordPoints}
                            />

                            {/* Vertical Day Scrubber Cursor Line */}
                            <line
                              x1={currentX}
                              y1="0"
                              x2={currentX}
                              y2={chartH}
                              stroke="#2563EB"
                              strokeWidth="1.8"
                              strokeDasharray="2 2"
                              opacity="0.9"
                            />
                            <circle
                              cx={currentX}
                              cy={currentCordY}
                              r="4.5"
                              fill="#2563EB"
                              stroke="#ffffff"
                              strokeWidth="2"
                            />

                            {/* Floating Cursor Pill Label */}
                            <g transform={`translate(${currentX}, ${Math.max(28, currentCordY)})`}>
                              <rect
                                x={currentX > chartW - 140 ? -135 : 10}
                                y="-24"
                                width="125"
                                height="22"
                                rx="6"
                                fill="#0F172A"
                                opacity="0.92"
                              />
                              <text
                                x={currentX > chartW - 140 ? -72 : 72}
                                y="-9"
                                textAnchor="middle"
                                fill="#FFFFFF"
                                fontSize="10"
                                fontFamily="var(--font-mono)"
                                fontWeight="bold"
                              >
                                Day {modalDay}: {Math.round(cordDays[modalDay - 1] || 0).toLocaleString()}
                              </text>
                            </g>
                          </svg>
                        </div>

                        <div className="flex items-center justify-between text-[11px] font-sans text-on-surface-variant px-1">
                          <span>Day 1 (Seeded in {detectedOriginCity})</span>
                          <span>Day 90 (Peak Surge Horizon)</span>
                          <span>Day 180 (Full Containment)</span>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}

              {modalTab === 'cities' && (
                <div className="p-5 bg-surface rounded-2xl border border-outline shadow-xs flex flex-col max-w-4xl mx-auto min-h-[420px]">
                  <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                    <div>
                      <h3 className="text-xs font-semibold font-heading text-on-surface uppercase tracking-wider">
                        Regional Node Transmission Breakdown
                      </h3>
                      <p className="text-[11px] text-on-surface-variant font-sans mt-0.5">
                        Active case counts and surge postponement metrics across 15 national mobility nodes at Day {modalDay}
                      </p>
                    </div>
                    <span className="text-xs font-mono font-medium px-2.5 py-1 rounded-lg bg-surface-container border border-outline text-on-surface">
                      Seed City: {detectedOriginCity}
                    </span>
                  </div>

                  <div className="overflow-x-auto rounded-xl border border-outline">
                    <table className="w-full text-left font-sans text-xs">
                      <thead className="bg-surface-container/70 sticky top-0 z-10 border-b border-outline">
                        <tr className="text-[10px] uppercase font-bold text-on-surface-variant">
                          <th className="py-2.5 px-4">Node City</th>
                          <th className="py-2.5 px-3">Status</th>
                          <th className="py-2.5 px-3">Baseline Cases</th>
                          <th className="py-2.5 px-3">Cordon Cases</th>
                          <th className="py-2.5 px-3">Day {modalDay} Delta</th>
                          <th className="py-2.5 px-3">Peak Timing</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-outline/50 bg-surface">
                        {Object.keys(CITIES).map(cityKey => {
                          const dayIdx = Math.max(0, Math.min(179, modalDay - 1));
                          const baseCases = baselinePreviewData?.city_curves?.[cityKey]?.[dayIdx] ?? 0;
                          const cordCases = previewData?.city_curves?.[cityKey]?.[dayIdx] ?? 0;
                          const delta = cordCases - baseCases;
                          const pct = baseCases > 0 ? ((delta / baseCases) * 100).toFixed(0) : '0';

                          const baseCurve = baselinePreviewData?.city_curves?.[cityKey] || [];
                          const cordCurve = previewData?.city_curves?.[cityKey] || [];
                          const basePeak = baseCurve.indexOf(Math.max(...baseCurve)) + 1;
                          const cordPeak = cordCurve.indexOf(Math.max(...cordCurve)) + 1;
                          const shift = cordPeak - basePeak;

                          let isShielded = false;
                          let shieldColor = '#2563EB';
                          for (const cid of activeCordons) {
                            const c = REGIONAL_CORDONS.find(rc => rc.id === cid);
                            if (c?.cities.includes(cityKey)) {
                              isShielded = true;
                              shieldColor = c.color;
                            }
                          }

                          return (
                            <tr key={cityKey} className="hover:bg-surface-container/30 transition-colors">
                              <td className="py-2.5 px-4 font-semibold text-on-surface">
                                <span>{CITIES[cityKey]?.displayName || cityKey}</span>
                              </td>
                              <td className="py-2.5 px-3">
                                {isShielded ? (
                                  <span
                                    className="text-[10px] px-2 py-0.5 rounded-full font-sans font-bold border"
                                    style={{ backgroundColor: `${shieldColor}15`, borderColor: `${shieldColor}35`, color: shieldColor }}
                                  >
                                    Cordoned
                                  </span>
                                ) : (
                                  <span className="text-[10px] px-2 py-0.5 rounded-full font-sans text-on-surface-variant bg-surface-container border border-outline font-medium">
                                    Open Node
                                  </span>
                                )}
                              </td>
                              <td className="py-2.5 px-3 text-on-surface-variant font-mono">{baseCases.toLocaleString()}</td>
                              <td className="py-2.5 px-3 text-on-surface font-bold font-mono">{cordCases.toLocaleString()}</td>
                              <td className="py-2.5 px-3 font-mono">
                                <span className={delta < 0 ? 'text-emerald-600 dark:text-emerald-400 font-bold' : delta > 0 ? 'text-rose-600 font-bold' : 'text-on-surface-variant'}>
                                  {delta < 0 ? '↓ ' : delta > 0 ? '↑ ' : ''}{Math.abs(delta).toLocaleString()} ({pct}%)
                                </span>
                              </td>
                              <td className="py-2.5 px-3 text-on-surface-variant font-sans">
                                {shift > 0 ? (
                                  <span className="text-emerald-600 dark:text-emerald-400 font-bold">+{shift}d Delay</span>
                                ) : shift < 0 ? (
                                  <span className="text-amber-600 font-medium">{shift}d</span>
                                ) : (
                                  <span className="text-on-surface-variant text-[11px]">Peak Day {basePeak}</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer Actions */}
            <div className="px-6 py-3.5 bg-surface border-t border-outline flex items-center justify-between gap-3 shrink-0">
              <button
                onClick={() => {
                  onDayChange(modalDay);
                  setShowImpactModal(false);
                }}
                className="px-3.5 py-2 rounded-lg text-xs font-sans font-medium border border-outline bg-surface-container/60 hover:bg-surface-variant text-on-surface transition-colors flex items-center gap-1.5"
              >
                <span>Sync Map Day to Day {modalDay}</span>
              </button>

              <div className="flex items-center gap-3">
                <button
                  onClick={() => setShowImpactModal(false)}
                  className="px-3.5 py-2 rounded-lg text-xs font-sans text-on-surface-variant hover:text-on-surface transition-colors"
                >
                  Close
                </button>

                {onHandoffToPlanner && (
                  <button
                    onClick={() => {
                      const cuts = buildEdgeCutsPayload();
                      setShowImpactModal(false);
                      onHandoffToPlanner(cuts);
                    }}
                    className="py-2 px-5 rounded-lg bg-primary text-white text-xs font-bold font-sans shadow-md hover:bg-primary/90 active:scale-[0.99] transition-all flex items-center gap-2 cursor-pointer"
                  >
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M5 12h14" />
                      <path d="m12 5 7 7-7 7" />
                    </svg>
                    <span>Run 128 Monte Carlo Simulation</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
