import { useState, useEffect, useRef, useCallback } from 'react';
import { BACKEND_URL } from '../config/backend';

interface PlaygroundDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onCommitToMonteCarlo?: (params: any) => void;
  mode?: 'default' | 'planner_levers';
  onApplyPlannerLevers?: (levers: { vaccination: any; festivals: any }) => void;
  initialVaccination?: any;
  initialFestivals?: any;
}

interface PreviewSummary {
  peak_day: number;
  peak_active_cases: number;
  total_deaths: number;
  attack_rate_pct: number;
  final_vaccinated?: number;
  final_coverage_pct?: number;
}

interface TopCity {
  city: string;
  population: number;
  peak_day: number;
  peak_active: number;
  total_deaths: number;
}

interface TrajectoryData {
  days: number[];
  active: number[];
  deaths: number[];
  recovered: number[];
  new_infections: number[];
  vaccinated?: number[];
}

interface PolicyPreset {
  id: string;
  name: string;
  category: string;
  summary: string;
  description: string;
  r0: number;
  cfr: number;
  incubation: number;
  infectious: number;
  kSensitivity: number;
  roadShare: number;
  railShare: number;
  airShare: number;
  intervention: string;
  seed: number;
  origin: string;
  quarantinedCities?: string[];
  vax?: {
    enabled: boolean;
    startDay: number;
    dailyRate: number;
    efficacy: number;
    onsetDays: number;
    severityEfficacy: number;
    waningDays: number | null;
  };
  festival?: {
    enabled: boolean;
    name: string;
    city: string;
    startDay: number;
    endDay: number;
    crowdMult: number;
    attendeeFrac: number;
  };
}

const POLICY_PRESETS: PolicyPreset[] = [
  {
    id: 'baseline',
    name: 'Unmitigated Transmission Baseline',
    category: 'Reference Standard',
    summary: 'Natural outbreak spread with normal transit & no containment.',
    description: 'Natural history of outbreak with normal multi-modal transit flows and no emergency suppression.',
    r0: 2.5,
    cfr: 0.02,
    incubation: 5.0,
    infectious: 7.0,
    kSensitivity: 35.0,
    roadShare: 0.40,
    railShare: 0.40,
    airShare: 0.20,
    intervention: 'none',
    seed: 500,
    origin: 'DELHI',
  },
  {
    id: 'aviation_restriction',
    name: 'Aviation Border Restriction Protocol',
    category: 'Port & Border Containment',
    summary: 'Air travel capped to 5%; road & rail corridors open.',
    description: 'International & domestic air corridor capacity restricted to 5% with terrestrial transit remaining operational.',
    r0: 2.5,
    cfr: 0.02,
    incubation: 5.0,
    infectious: 7.0,
    kSensitivity: 35.0,
    roadShare: 0.52,
    railShare: 0.43,
    airShare: 0.05,
    intervention: 'none',
    seed: 500,
    origin: 'DELHI',
  },
  {
    id: 'compliance_decay',
    name: 'Public Compliance Degradation & Relapse',
    category: 'Behavioral Vulnerability',
    summary: 'Quarantine fatigue; public fear drops & cases rebound.',
    description: 'Quarantine fatigue sets in; public fear sensitivity drops to k=8.0, sparking spontaneous community transmission rebound.',
    r0: 2.8,
    cfr: 0.025,
    incubation: 4.5,
    infectious: 7.0,
    kSensitivity: 8.0,
    roadShare: 0.40,
    railShare: 0.40,
    airShare: 0.20,
    intervention: 'none',
    seed: 1500,
    origin: 'MUMBAI',
  },
  {
    id: 'surge_stress',
    name: 'High-Virulence Healthcare Stress Benchmark',
    category: 'Crisis Stress-Testing',
    summary: 'Simulates Delta-class surge strain (R₀=3.8, CFR=3.5%).',
    description: 'Simulates high-transmissibility Delta/Omicron-class mutation (R0=3.8, CFR=3.5%) to evaluate system surge capacity.',
    r0: 3.8,
    cfr: 0.035,
    incubation: 3.5,
    infectious: 8.0,
    kSensitivity: 40.0,
    roadShare: 0.40,
    railShare: 0.40,
    airShare: 0.20,
    intervention: 'none',
    seed: 1000,
    origin: 'DELHI',
  },
  {
    id: 'zoonotic_protocol',
    name: 'High-Fatality Zoonotic Spillover Protocol',
    category: 'Severe Pathogen Containment',
    summary: 'Severe 35% fatality virus with 12-day incubation.',
    description: 'High mortality profile (CFR=35%) with extended 12-day incubation, requiring immediate aggressive ring-fencing.',
    r0: 1.4,
    cfr: 0.35,
    incubation: 12.0,
    infectious: 9.0,
    kSensitivity: 60.0,
    roadShare: 0.35,
    railShare: 0.35,
    airShare: 0.30,
    intervention: 'rail_only',
    seed: 200,
    origin: 'KOCHI',
  },
  {
    id: 'metro_cordon',
    name: 'Tier-1 Metropolitan Cordon Sanitaire',
    category: 'Perimeter Containment',
    summary: 'Strict transit quarantine ring-fencing Delhi & Mumbai.',
    description: 'Immediate strict multi-modal transit quarantine around Tier-1 transmission centers (Delhi, Mumbai).',
    r0: 2.5,
    cfr: 0.02,
    incubation: 5.0,
    infectious: 7.0,
    kSensitivity: 35.0,
    roadShare: 0.40,
    railShare: 0.40,
    airShare: 0.20,
    intervention: 'full',
    seed: 500,
    origin: 'DELHI',
    quarantinedCities: ['DELHI', 'MUMBAI'],
  },
  {
    id: 'immunization_campaign',
    name: 'National Immunization Rollout',
    category: 'Pharmaceutical Interventions',
    summary: 'Vaccination starts Day 20 with 0.3%/day coverage.',
    description: 'Dynamic vaccination rollout starting at Day 20 with 0.3%/day eligible coverage and 95% severity attenuation.',
    r0: 2.5,
    cfr: 0.02,
    incubation: 5.0,
    infectious: 7.0,
    kSensitivity: 35.0,
    roadShare: 0.40,
    railShare: 0.40,
    airShare: 0.20,
    intervention: 'none',
    seed: 500,
    origin: 'DELHI',
    vax: {
      enabled: true,
      startDay: 20,
      dailyRate: 0.003,
      efficacy: 0.85,
      onsetDays: 14,
      severityEfficacy: 0.95,
      waningDays: null,
    },
  },
  {
    id: 'kumbh_surge',
    name: 'Kumbh Mela Pilgrimage Vector',
    category: 'Mass Gathering Shock',
    summary: 'Mass pilgrimage gathering with 3.0x transmission shock.',
    description: '15-day mass pilgrimage (Days 25–40) in Delhi with 3.0x contact amplification among 15% of regional population.',
    r0: 2.5,
    cfr: 0.02,
    incubation: 5.0,
    infectious: 7.0,
    kSensitivity: 35.0,
    roadShare: 0.40,
    railShare: 0.40,
    airShare: 0.20,
    intervention: 'none',
    seed: 500,
    origin: 'DELHI',
    festival: {
      enabled: true,
      name: 'Kumbh Mela Pilgrimage',
      city: 'DELHI',
      startDay: 25,
      endDay: 40,
      crowdMult: 3.0,
      attendeeFrac: 0.15,
    },
  },
];

const CITIES = [
  'DELHI', 'MUMBAI', 'KOLKATA', 'BENGALURU', 'CHENNAI',
  'HYDERABAD', 'AHMEDABAD', 'PUNE', 'LUCKNOW', 'KOCHI',
  'JAIPUR', 'PATNA', 'BHOPAL', 'VISAKHAPATNAM', 'GUWAHATI'
];

export default function PlaygroundDrawer({
  isOpen,
  onClose,
  onCommitToMonteCarlo,
  mode = 'default',
  onApplyPlannerLevers,
  initialVaccination,
  initialFestivals
}: PlaygroundDrawerProps) {
  // Scenario Parameters
  const [selectedPreset, setSelectedPreset] = useState<string>('baseline');
  const [r0, setR0] = useState<number>(2.5);
  const [cfr, setCfr] = useState<number>(0.02);
  const [incubationDays, setIncubationDays] = useState<number>(5.0);
  const [infectiousDays, setInfectiousDays] = useState<number>(7.0);
  const [kSensitivity, setKSensitivity] = useState<number>(35.0);
  const [originCity, setOriginCity] = useState<string>('DELHI');
  const [seedInfections, setSeedInfections] = useState<number>(500);
  const [intervention, setIntervention] = useState<string>('none');
  
  // Modal shares (normalized to sum to 1.0)
  const [roadShare, setRoadShare] = useState<number>(0.40);
  const [railShare, setRailShare] = useState<number>(0.40);
  const [airShare, setAirShare] = useState<number>(0.20);

  // Tab State
  const [activeTab, setActiveTab] = useState<'biology' | 'mobility' | 'governance' | 'vaccination' | 'festivals'>('biology');

  // Vaccination State
  const [vaxEnabled, setVaxEnabled] = useState<boolean>(false);
  const [vaxStartDay, setVaxStartDay] = useState<number>(20);
  const [vaxDailyRate, setVaxDailyRate] = useState<number>(0.003); // 0.3% / day
  const [vaxEfficacy, setVaxEfficacy] = useState<number>(0.85); // 85%
  const [vaxOnsetDays, setVaxOnsetDays] = useState<number>(14); // 14 days
  const [vaxSeverityEfficacy, setVaxSeverityEfficacy] = useState<number>(0.95); // 95%
  const [vaxWaningDays, setVaxWaningDays] = useState<number | null>(null);

  // Festival / Mass Gathering State
  const [festivalEnabled, setFestivalEnabled] = useState<boolean>(false);
  const [festivalName, setFestivalName] = useState<string>('Kumbh Mela Pilgrimage');
  const [festivalCity, setFestivalCity] = useState<string>('DELHI');
  const [festivalStartDay, setFestivalStartDay] = useState<number>(25);
  const [festivalEndDay, setFestivalEndDay] = useState<number>(40);
  const [festivalCrowdMult, setFestivalCrowdMult] = useState<number>(3.0);
  const [festivalAttendeeFrac, setFestivalAttendeeFrac] = useState<number>(0.15);

  // Governance & Cordon State
  const [quarantinedCities, setQuarantinedCities] = useState<string[]>([]);

  // Preview Result State
  const [summary, setSummary] = useState<PreviewSummary | null>(null);
  const [trajectory, setTrajectory] = useState<TrajectoryData | null>(null);
  const [topCities, setTopCities] = useState<TopCity[]>([]);
  const [isCalculating, setIsCalculating] = useState<boolean>(false);

  const debounceTimerRef = useRef<any>(null);

  const applyPreset = (preset: PolicyPreset) => {
    setSelectedPreset(preset.id);
    setR0(preset.r0);
    setCfr(preset.cfr);
    setIncubationDays(preset.incubation);
    setInfectiousDays(preset.infectious);
    setKSensitivity(preset.kSensitivity);
    setRoadShare(preset.roadShare);
    setRailShare(preset.railShare);
    setAirShare(preset.airShare);
    setIntervention(preset.intervention);
    setSeedInfections(preset.seed);
    setOriginCity(preset.origin);

    if (preset.vax) {
      setVaxEnabled(preset.vax.enabled);
      setVaxStartDay(preset.vax.startDay);
      setVaxDailyRate(preset.vax.dailyRate);
      setVaxEfficacy(preset.vax.efficacy);
      setVaxOnsetDays(preset.vax.onsetDays);
      setVaxSeverityEfficacy(preset.vax.severityEfficacy);
      setVaxWaningDays(preset.vax.waningDays);
    } else {
      setVaxEnabled(false);
    }

    if (preset.quarantinedCities) {
      setQuarantinedCities(preset.quarantinedCities);
    } else {
      setQuarantinedCities([]);
    }

    if (preset.festival) {
      setFestivalEnabled(preset.festival.enabled);
      setFestivalName(preset.festival.name);
      setFestivalCity(preset.festival.city);
      setFestivalStartDay(preset.festival.startDay);
      setFestivalEndDay(preset.festival.endDay);
      setFestivalCrowdMult(preset.festival.crowdMult);
      setFestivalAttendeeFrac(preset.festival.attendeeFrac);
    } else {
      setFestivalEnabled(false);
    }
  };
  
  useEffect(() => {
    if (isOpen && mode === 'planner_levers') {
      setActiveTab('vaccination');
      if (initialVaccination) {
        setVaxEnabled(Boolean(initialVaccination.enabled));
        if (initialVaccination.start_day !== undefined) setVaxStartDay(initialVaccination.start_day);
        if (initialVaccination.daily_rate !== undefined) setVaxDailyRate(initialVaccination.daily_rate);
        if (initialVaccination.efficacy !== undefined) setVaxEfficacy(initialVaccination.efficacy);
        if (initialVaccination.onset_days !== undefined) setVaxOnsetDays(initialVaccination.onset_days);
        if (initialVaccination.severity_efficacy !== undefined) setVaxSeverityEfficacy(initialVaccination.severity_efficacy);
        if (initialVaccination.waning_mean_days !== undefined) setVaxWaningDays(initialVaccination.waning_mean_days);
      }
      if (initialFestivals && initialFestivals.length > 0) {
        setFestivalEnabled(true);
        const f = initialFestivals[0];
        if (f.name) setFestivalName(f.name);
        if (f.city) setFestivalCity(f.city);
        if (f.start_day !== undefined) setFestivalStartDay(f.start_day);
        if (f.end_day !== undefined) setFestivalEndDay(f.end_day);
        if (f.crowd_mult !== undefined) setFestivalCrowdMult(f.crowd_mult);
        if (f.attendee_frac !== undefined) setFestivalAttendeeFrac(f.attendee_frac);
      }
    }
  }, [isOpen, mode, initialVaccination, initialFestivals]);

  const fetchPreview = useCallback(async () => {
    setIsCalculating(true);
    try {
      const payload = {
        origin_city: originCity,
        n_days: 180,
        seed_infections: seedInfections,
        k_sensitivity: kSensitivity,
        intervention: intervention,
        pathogen: {
          r0_mode: r0,
          r0_min: Math.max(0.2, Number((r0 * 0.7).toFixed(2))),
          r0_max: Math.min(30.0, Number((r0 * 1.35).toFixed(2))),
          incubation_days: incubationDays,
          infectious_days: infectiousDays,
          cfr: cfr,
        },
        modal_shares: {
          road: roadShare,
          rail: railShare,
          air: airShare,
        },
        quarantined_cities: quarantinedCities.length > 0 ? quarantinedCities : null,
        vaccination: vaxEnabled ? {
          enabled: true,
          start_day: vaxStartDay,
          daily_rate: vaxDailyRate,
          efficacy: vaxEfficacy,
          onset_days: vaxOnsetDays,
          severity_efficacy: vaxSeverityEfficacy,
          waning_mean_days: vaxWaningDays,
        } : null,
        festivals: festivalEnabled ? [
          {
            id: 'evt_1',
            name: festivalName,
            city: festivalCity,
            start_day: festivalStartDay,
            end_day: festivalEndDay,
            crowd_mult: festivalCrowdMult,
            attendee_frac: festivalAttendeeFrac,
          }
        ] : null,
      };

      const res = await fetch(`${BACKEND_URL}/api/v1/playground/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        throw new Error(`Server returned ${res.status}`);
      }

      const data = await res.json();
      setSummary(data.summary);
      setTrajectory(data.national_trajectory);
      setTopCities(data.top_cities || []);
    } catch (err) {
      console.error('Playground preview error:', err);
    } finally {
      setIsCalculating(false);
    }
  }, [
    r0, cfr, incubationDays, infectiousDays, kSensitivity, originCity,
    seedInfections, intervention, roadShare, railShare, airShare,
    quarantinedCities,
    vaxEnabled, vaxStartDay, vaxDailyRate, vaxEfficacy, vaxOnsetDays,
    vaxSeverityEfficacy, vaxWaningDays,
    festivalEnabled, festivalName, festivalCity, festivalStartDay, festivalEndDay,
    festivalCrowdMult, festivalAttendeeFrac, BACKEND_URL
  ]);

  // Scrubbing debounced trigger (80ms debounce)
  useEffect(() => {
    if (!isOpen) return;
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      fetchPreview();
    }, 80);

    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, [isOpen, fetchPreview]);

  if (!isOpen) return null;

  // High-Resolution SVG Line Chart Generator
  const renderPreviewChart = () => {
    if (!trajectory || !trajectory.active || trajectory.active.length === 0) {
      return (
        <div className="h-44 flex items-center justify-center text-xs text-on-surface-variant font-mono">
          Awaiting simulation compute...
        </div>
      );
    }

    const maxActive = Math.max(...trajectory.active, 1);
    const maxDeaths = Math.max(...trajectory.deaths, 1);
    const width = 520;
    const height = 160;
    const padding = 20;

    const pointsActive = trajectory.active.map((val, i) => {
      const x = padding + (i / (trajectory.active.length - 1)) * (width - 2 * padding);
      const y = height - padding - (val / maxActive) * (height - 2 * padding);
      return `${x},${y}`;
    }).join(' ');

    const pointsDeaths = trajectory.deaths.map((val, i) => {
      const x = padding + (i / (trajectory.deaths.length - 1)) * (width - 2 * padding);
      const y = height - padding - (val / maxDeaths) * (height - 2 * padding);
      return `${x},${y}`;
    }).join(' ');

    const peakIndex = trajectory.active.indexOf(maxActive);
    const peakX = padding + (peakIndex / (trajectory.active.length - 1)) * (width - 2 * padding);
    const peakY = height - padding - (maxActive / maxActive) * (height - 2 * padding);

    return (
      <div className="relative bg-surface rounded-xl p-3 border border-outline overflow-hidden shadow-sm">
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-44 overflow-visible">
          {/* Baseline grid lines */}
          <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} stroke="currentColor" strokeOpacity="0.15" strokeWidth="1" />
          <line x1={padding} y1={padding} x2={width - padding} y2={padding} stroke="currentColor" strokeOpacity="0.08" strokeWidth="1" strokeDasharray="3 3" />
          <line x1={padding} y1={height / 2} x2={width - padding} y2={height / 2} stroke="currentColor" strokeOpacity="0.05" strokeWidth="1" strokeDasharray="2 2" />

          {/* Mass Gathering Window Shading */}
          {festivalEnabled && (() => {
            const boxX = padding + (Math.max(0, festivalStartDay - 1) / 179) * (width - 2 * padding);
            const boxW = Math.max(8, ((Math.min(180, festivalEndDay) - Math.max(1, festivalStartDay)) / 179) * (width - 2 * padding));
            const badgeW = 126;
            // Prevent badge from overflowing the chart right boundary
            const badgeX = Math.min(boxX, width - padding - badgeW - 2);

            return (
              <g>
                <rect
                  x={boxX}
                  y={padding}
                  width={boxW}
                  height={height - 2 * padding}
                  fill="#F59E0B"
                  fillOpacity="0.09"
                  stroke="#F59E0B"
                  strokeWidth="1.2"
                  strokeDasharray="3 3"
                  rx="2"
                />
                <g transform={`translate(${badgeX}, ${padding + 5})`}>
                  <rect
                    x="0"
                    y="0"
                    width={badgeW}
                    height="18"
                    rx="4"
                    fill="#FEF3C7"
                    stroke="#F59E0B"
                    strokeWidth="0.9"
                    opacity="0.96"
                  />
                  <text
                    x={badgeW / 2}
                    y="12.5"
                    fill="#B45309"
                    fontSize="9"
                    fontFamily="ui-sans-serif, system-ui, sans-serif"
                    fontWeight="600"
                    textAnchor="middle"
                  >
                    {festivalName.length > 15 ? festivalName.slice(0, 14) + '…' : festivalName} ({festivalCrowdMult}×)
                  </text>
                </g>
              </g>
            );
          })()}

          {/* Vaccinated Progress Curve (emerald dotted) */}
          {vaxEnabled && trajectory.vaccinated && trajectory.vaccinated.length > 0 && (() => {
            const maxVax = Math.max(...trajectory.vaccinated, 1);
            const pointsVax = trajectory.vaccinated.map((val, i) => {
              const x = padding + (i / (trajectory.vaccinated!.length - 1)) * (width - 2 * padding);
              const y = height - padding - (val / maxVax) * (height - 2 * padding);
              return `${x},${y}`;
            }).join(' ');
            return (
              <polyline
                fill="none"
                stroke="#10B981"
                strokeWidth="2.2"
                strokeDasharray="4 2"
                opacity="0.85"
                points={pointsVax}
              />
            );
          })()}

          {/* Cumulative Deaths curve (dashed red/amber) */}
          <polyline fill="none" stroke="#DC2626" strokeWidth="1.8" strokeDasharray="4 2" opacity="0.8" points={pointsDeaths} />
          
          {/* Active Cases curve (primary blue/indigo solid) */}
          <polyline fill="none" stroke="#2563EB" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" points={pointsActive} />

          {/* Peak indicator dot */}
          <circle cx={peakX} cy={peakY} r="4.5" fill="#2563EB" stroke="#ffffff" strokeWidth="1.5" />
        </svg>

        <div className="flex flex-wrap items-center justify-between mt-2 px-1 text-[11px] font-mono text-on-surface-variant gap-2">
          <div className="flex items-center flex-wrap gap-3">
            <span className="flex items-center gap-1.5 text-blue-600 font-medium">
              <span className="w-3 h-1 bg-blue-600 rounded inline-block"></span> Active Surge
            </span>
            <span className="flex items-center gap-1.5 text-red-600 font-medium">
              <span className="w-3 h-1 bg-red-600 rounded inline-block border-b border-dashed"></span> Deaths
            </span>
            {vaxEnabled && (
              <span className="flex items-center gap-1.5 text-emerald-600 font-medium">
                <span className="w-3 h-1 bg-emerald-500 rounded inline-block border-b border-dotted"></span> Vaccinated
              </span>
            )}
            {festivalEnabled && (
              <span className="flex items-center gap-1.5 text-amber-600 font-medium">
                <span className="w-2.5 h-2 bg-amber-400/30 border border-amber-500 rounded-xs inline-block"></span> Gathering Window
              </span>
            )}
          </div>
          <span>Day 1 ─── Day 180</span>
        </div>
      </div>
    );
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/60 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="relative flex flex-col bg-background shadow-2xl rounded-2xl overflow-hidden border border-outline w-full max-w-5xl h-[88vh] max-h-[860px]"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-3.5 bg-surface border-b border-outline shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="4" y1="21" x2="4" y2="14"></line>
                <line x1="4" y1="10" x2="4" y2="3"></line>
                <line x1="12" y1="21" x2="12" y2="12"></line>
                <line x1="12" y1="8" x2="12" y2="3"></line>
                <line x1="20" y1="21" x2="20" y2="16"></line>
                <line x1="20" y1="12" x2="20" y2="3"></line>
                <line x1="1" y1="14" x2="7" y2="14"></line>
                <line x1="9" y1="8" x2="15" y2="8"></line>
                <line x1="17" y1="16" x2="23" y2="16"></line>
              </svg>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold font-heading text-on-surface tracking-tight leading-tight">
                  {mode === 'planner_levers' ? 'Policy Sandbox: Levers Configuration' : 'Policy Sandbox'}
                </h2>
                <span className={`text-[10px] px-2 py-0.5 rounded font-mono border ${
                  mode === 'planner_levers' 
                    ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30 font-semibold' 
                    : 'bg-surface-container text-on-surface-variant border-outline'
                }`}>
                  {mode === 'planner_levers' ? 'Custom Plan Levers' : 'Deterministic SEIR-b'}
                </span>
              </div>
              <p className="text-[11px] text-on-surface-variant font-mono">
                {mode === 'planner_levers' ? 'Configure Vaccination Campaign & Mass Gathering Shocks' : 'Live Epidemic Trajectory'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-on-surface-variant hover:bg-surface-variant transition-colors"
              title="Close Sandbox"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>
        </div>

        {/* Two-Column Body: LEFT = Live Results & Handoff, RIGHT = Controls & Sliders */}
        <div className="flex-1 grid grid-cols-1 md:grid-cols-12 overflow-hidden min-h-0">
          
          {/* ================= LEFT COLUMN: Live Trajectory & Output ================= */}
          <div className="md:col-span-7 flex flex-col p-5 bg-surface-container/30 border-r border-outline overflow-y-auto space-y-4">
            
            {/* National Trajectory Card */}
            <div className="p-4 bg-surface rounded-xl border border-outline space-y-3 shadow-sm">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-on-surface uppercase tracking-wider">
                    National Epidemic Trajectory
                  </span>
                  {isCalculating && (
                    <span className="flex items-center gap-1 text-[10px] text-primary font-mono animate-pulse">
                      <span className="w-2 h-2 rounded-full bg-primary inline-block"></span>
                      Solving ODE...
                    </span>
                  )}
                </div>
                <span className="text-[10px] text-on-surface-variant font-mono">
                  180 Days Horizon
                </span>
              </div>

              {renderPreviewChart()}

              {/* KPI Output Grid */}
              {summary && (
                <div className={`grid ${vaxEnabled ? 'grid-cols-5' : 'grid-cols-4'} gap-2 pt-1`}>
                  <div className="bg-surface-container/60 p-2 rounded-lg border border-outline text-center">
                    <span className="text-[10px] text-on-surface-variant block font-medium">Peak Day</span>
                    <span className="text-xs sm:text-sm font-bold text-primary font-mono">Day {summary.peak_day}</span>
                  </div>
                  <div className="bg-surface-container/60 p-2 rounded-lg border border-outline text-center">
                    <span className="text-[10px] text-on-surface-variant block font-medium">Peak Surge</span>
                    <span className="text-xs sm:text-sm font-bold text-on-surface font-mono">
                      {(summary.peak_active_cases / 1_000_000).toFixed(2)}M
                    </span>
                  </div>
                  <div className="bg-surface-container/60 p-2 rounded-lg border border-outline text-center">
                    <span className="text-[10px] text-on-surface-variant block font-medium">Fatalities</span>
                    <span className="text-xs sm:text-sm font-bold text-rose-600 font-mono">
                      {summary.total_deaths >= 1_000_000
                        ? `${(summary.total_deaths / 1_000_000).toFixed(2)}M`
                        : `${(summary.total_deaths / 1_000).toFixed(1)}k`}
                    </span>
                  </div>
                  <div className="bg-surface-container/60 p-2 rounded-lg border border-outline text-center">
                    <span className="text-[10px] text-on-surface-variant block font-medium">Attack Rate</span>
                    <span className="text-xs sm:text-sm font-bold text-amber-600 font-mono">
                      {summary.attack_rate_pct}%
                    </span>
                  </div>
                  {vaxEnabled && (
                    <div className="bg-emerald-500/10 p-2 rounded-lg border border-emerald-500/30 text-center">
                      <span className="text-[10px] text-emerald-700 dark:text-emerald-400 block font-medium">Coverage</span>
                      <span className="text-xs sm:text-sm font-bold text-emerald-600 font-mono">
                        {summary.final_coverage_pct ?? 0}%
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Top Impacted Cities Breakdown */}
            {topCities.length > 0 && (
              <div className="p-3.5 bg-surface rounded-xl border border-outline space-y-2">
                <span className="text-[11px] font-semibold text-on-surface-variant uppercase tracking-wider block">
                  Highest Surge Metropolitan Nodes
                </span>
                <div className="grid grid-cols-2 gap-2">
                  {topCities.slice(0, 6).map((c) => (
                    <div
                      key={c.city}
                      className="p-2 rounded-lg bg-surface-container/50 border border-outline font-mono text-on-surface flex items-center justify-between text-xs"
                    >
                      <span className="font-semibold">{c.city}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-primary font-bold">{(c.peak_active / 1000).toFixed(0)}k</span>
                        <span className="text-on-surface-variant text-[10px]">(Day {c.peak_day})</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Monte Carlo Handoff CTA Box */}
            {/* Action Bar */}
            <div className={`mt-auto p-4 rounded-xl border space-y-2.5 ${
              mode === 'planner_levers'
                ? 'bg-emerald-500/5 border-emerald-500/25'
                : 'bg-primary/5 border-primary/20'
            }`}>
              <div>
                <h3 className={`text-xs font-semibold font-heading ${
                  mode === 'planner_levers' ? 'text-emerald-700 dark:text-emerald-400' : 'text-primary'
                }`}>
                  {mode === 'planner_levers' ? 'Import Levers into Custom Plan' : 'Ready for Monte Carlo Verification?'}
                </h3>
                <p className="text-[11px] text-on-surface-variant mt-0.5">
                  {mode === 'planner_levers'
                    ? 'Transfer active vaccination & mass gathering shock parameters into your custom phased policy in Planner View.'
                    : 'Transfer these parameters into the simulation engine to run 128 Monte Carlo stochastic iterations with travel shocks.'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (mode === 'planner_levers') {
                    if (onApplyPlannerLevers) {
                      onApplyPlannerLevers({
                        vaccination: vaxEnabled ? {
                          enabled: true,
                          start_day: vaxStartDay,
                          daily_rate: vaxDailyRate,
                          efficacy: vaxEfficacy,
                          onset_days: vaxOnsetDays,
                          severity_efficacy: vaxSeverityEfficacy,
                          waning_mean_days: vaxWaningDays ?? null,
                        } : {
                          enabled: false,
                          start_day: 30,
                          daily_rate: 0.003,
                          efficacy: 0.85,
                          onset_days: 14,
                          severity_efficacy: 0.95,
                          waning_mean_days: null
                        },
                        festivals: festivalEnabled ? [
                          {
                            id: 'evt_1',
                            name: festivalName,
                            city: festivalCity,
                            start_day: festivalStartDay,
                            end_day: festivalEndDay,
                            crowd_mult: festivalCrowdMult,
                            attendee_frac: festivalAttendeeFrac,
                          }
                        ] : [],
                      });
                    }
                    onClose();
                    return;
                  }

                  if (onCommitToMonteCarlo) {
                    onCommitToMonteCarlo({
                      presetName: POLICY_PRESETS.find(p => p.id === selectedPreset)?.name || 'Custom Scenario',
                      r0,
                      cfr,
                      incubationDays,
                      infectiousDays,
                      kSensitivity,
                      originCity,
                      seedInfections,
                      intervention,
                      roadShare,
                      railShare,
                      airShare,
                      vaccination: vaxEnabled ? {
                        enabled: true,
                        startDay: vaxStartDay,
                        dailyRate: vaxDailyRate,
                        efficacy: vaxEfficacy,
                        onsetDays: vaxOnsetDays,
                        severityEfficacy: vaxSeverityEfficacy,
                        waningDays: vaxWaningDays,
                      } : null,
                      festivals: festivalEnabled ? [
                        {
                          id: 'evt_1',
                          name: festivalName,
                          city: festivalCity,
                          startDay: festivalStartDay,
                          endDay: festivalEndDay,
                          crowdMult: festivalCrowdMult,
                          attendeeFrac: festivalAttendeeFrac,
                        }
                      ] : null,
                      quarantinedCities: quarantinedCities.length > 0 ? quarantinedCities : null,
                    });
                  }
                  onClose();
                }}
                className={`w-full py-2.5 rounded-lg text-white text-xs font-bold shadow-md active:scale-[0.99] transition-all flex items-center justify-center gap-2 cursor-pointer ${
                  mode === 'planner_levers'
                    ? 'bg-emerald-600 hover:bg-emerald-700'
                    : 'bg-primary hover:bg-primary/90'
                }`}
              >
                <span>{mode === 'planner_levers' ? 'Send to MC Run' : 'Run 128 Monte Carlo Simulation'}</span>
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="9 18 15 12 9 6"></polyline>
                </svg>
              </button>
            </div>

          </div>

          {/* ================= RIGHT COLUMN: Parameters & Controls ================= */}
          <div className="md:col-span-5 flex flex-col p-5 overflow-y-auto space-y-4">
            
            {/* Presets Selector (Hidden in planner_levers mode) */}
            {mode !== 'planner_levers' && (
              <div>
                <div className="flex items-center justify-between mb-1.5 gap-2">
                  <label className="text-[10px] xl:text-[11px] font-semibold text-on-surface-variant uppercase tracking-wide flex items-baseline gap-1.5 min-w-0">
                    <span className="shrink-0">Government Policy &amp; Scenario Presets</span>
                    <span className="text-[8px] xl:text-[8.5px] font-normal text-on-surface-variant/75 tracking-tight shrink-0">(NDMA / MoHFW)</span>
                  </label>
                  <button
                    onClick={() => applyPreset(POLICY_PRESETS[0])}
                    className="text-[10px] text-primary hover:underline font-medium shrink-0 ml-auto"
                  >
                    Reset
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {POLICY_PRESETS.map((p) => {
                    const isSelected = selectedPreset === p.id;
                    return (
                      <button
                        key={p.id}
                        onClick={() => applyPreset(p)}
                        title={p.description}
                        className={`text-left p-2.5 rounded-lg border transition-all text-xs flex flex-col justify-between ${
                          isSelected
                            ? 'border-primary bg-primary/10 text-primary shadow-xs font-semibold ring-1 ring-primary/30'
                            : 'border-outline hover:border-outline-variant bg-surface text-on-surface'
                        }`}
                      >
                        <div>
                          <div className="font-semibold text-xs leading-snug line-clamp-2">
                            {p.name}
                          </div>
                          <div className="text-[10px] text-on-surface-variant/85 leading-snug line-clamp-2 mt-1 font-normal">
                            {p.summary}
                          </div>
                        </div>
                        <div className="mt-2 flex items-center justify-between text-[9px] font-mono text-on-surface-variant/70 border-t border-outline/30 pt-1">
                          <span className="truncate">{p.category}</span>
                          {isSelected && <span className="font-semibold text-primary shrink-0 ml-1">✓ Active</span>}
                        </div>
                      </button>
                    );
                  })}
                </div>

                {/* Active Preset Operational Briefing Box */}
                {(() => {
                  const active = POLICY_PRESETS.find(p => p.id === selectedPreset) || POLICY_PRESETS[0];
                  return (
                    <div className="mt-2.5 p-3 rounded-xl bg-surface-container/60 border border-outline text-xs">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <div className="flex items-center gap-1.5 font-semibold text-on-surface">
                          <span className="w-2 h-2 rounded-full bg-primary shrink-0" />
                          <span className="font-heading text-xs font-semibold">{active.name}</span>
                        </div>
                        <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-surface border border-outline text-on-surface-variant font-medium shrink-0">
                          {active.category}
                        </span>
                      </div>
                      <p className="text-[11px] text-on-surface-variant leading-relaxed mb-2 font-sans">
                        {active.description}
                      </p>
                      <div className="grid grid-cols-4 gap-1.5 pt-2 border-t border-outline/50 text-[10px] font-mono text-on-surface-variant">
                        <div className="bg-surface px-1.5 py-1 rounded border border-outline/40">
                          <span className="text-on-surface-variant/70 block text-[8.5px]">BASIC R₀</span>
                          <span className="font-semibold text-on-surface">{active.r0}</span>
                        </div>
                        <div className="bg-surface px-1.5 py-1 rounded border border-outline/40">
                          <span className="text-on-surface-variant/70 block text-[8.5px]">FATALITY (CFR)</span>
                          <span className="font-semibold text-on-surface">{(active.cfr * 100).toFixed(1)}%</span>
                        </div>
                        <div className="bg-surface px-1.5 py-1 rounded border border-outline/40">
                          <span className="text-on-surface-variant/70 block text-[8.5px]">TRANSIT</span>
                          <span className="font-semibold text-on-surface uppercase truncate block">{active.intervention}</span>
                        </div>
                        <div className="bg-surface px-1.5 py-1 rounded border border-outline/40">
                          <span className="text-on-surface-variant/70 block text-[8.5px]">SEED ORIGIN</span>
                          <span className="font-semibold text-on-surface truncate block">{active.origin}</span>
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}

            {/* Tab Selector: Professional Navigation Bar */}
            <div className="shrink-0 bg-surface-container/60 p-1.5 rounded-xl border border-outline space-y-1.5">
              {mode !== 'planner_levers' && (
                <div className="grid grid-cols-3 gap-1.5">
                  <button
                    type="button"
                    onClick={() => setActiveTab('biology')}
                    className={`py-2 px-1 text-[11px] font-semibold text-center rounded-lg transition-all ${
                      activeTab === 'biology'
                        ? 'bg-primary text-white shadow-sm'
                        : 'bg-surface hover:bg-surface-container text-on-surface-variant hover:text-on-surface border border-outline'
                    }`}
                  >
                    Pathogen Biology
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab('mobility')}
                    className={`py-2 px-1 text-[11px] font-semibold text-center rounded-lg transition-all ${
                      activeTab === 'mobility'
                        ? 'bg-primary text-white shadow-sm'
                        : 'bg-surface hover:bg-surface-container text-on-surface-variant hover:text-on-surface border border-outline'
                    }`}
                  >
                    Mobility Network
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab('governance')}
                    className={`py-2 px-1 text-[11px] font-semibold text-center rounded-lg transition-all flex items-center justify-center gap-1.5 ${
                      activeTab === 'governance'
                        ? 'bg-primary text-white shadow-sm'
                        : 'bg-surface hover:bg-surface-container text-on-surface-variant hover:text-on-surface border border-outline'
                    }`}
                  >
                    <span>Governance & NPI</span>
                    {quarantinedCities.length > 0 && (
                      <span className="w-1.5 h-1.5 rounded-full bg-rose-400"></span>
                    )}
                  </button>
                </div>
              )}

              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={() => setActiveTab('vaccination')}
                  className={`py-2 px-2 text-[11px] font-semibold text-center rounded-lg transition-all flex items-center justify-center gap-1.5 ${
                    activeTab === 'vaccination'
                      ? 'bg-emerald-600 text-white shadow-sm'
                      : 'bg-surface hover:bg-surface-container text-on-surface-variant hover:text-on-surface border border-outline'
                  }`}
                >
                  <span>Vaccination</span>
                  {vaxEnabled && (
                    <span className={`w-1.5 h-1.5 rounded-full ${activeTab === 'vaccination' ? 'bg-white' : 'bg-emerald-500'}`}></span>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('festivals')}
                  className={`py-2 px-2 text-[11px] font-semibold text-center rounded-lg transition-all flex items-center justify-center gap-1.5 ${
                    activeTab === 'festivals'
                      ? 'bg-amber-600 text-white shadow-sm'
                      : 'bg-surface hover:bg-surface-container text-on-surface-variant hover:text-on-surface border border-outline'
                  }`}
                >
                  <span>Mass Gatherings</span>
                  {festivalEnabled && (
                    <span className={`w-2 h-2 rounded-full ${activeTab === 'festivals' ? 'bg-white' : 'bg-amber-500'}`}></span>
                  )}
                </button>
              </div>
            </div>

            {/* Tab 1: Pathogen Biology Controls */}
            {activeTab === 'biology' && (
              <div className="space-y-3.5 bg-surface p-3.5 rounded-xl border border-outline">
                <div>
                  <div className="flex justify-between text-xs font-medium text-on-surface mb-1">
                    <span>Basic Reproduction Number (R₀)</span>
                    <span className="font-mono text-primary font-bold">{r0.toFixed(1)}</span>
                  </div>
                  <input
                    type="range"
                    min="0.5"
                    max="12.0"
                    step="0.1"
                    value={r0}
                    onChange={(e) => { setSelectedPreset('custom'); setR0(parseFloat(e.target.value)); }}
                    className="w-full accent-primary"
                  />
                  <div className="flex justify-between text-[10px] text-on-surface-variant font-mono">
                    <span>0.5 (Low)</span>
                    <span>2.5 (COVID)</span>
                    <span>12.0 (Measles)</span>
                  </div>
                </div>

                <div>
                  <div className="flex justify-between text-xs font-medium text-on-surface mb-1">
                    <span>Case Fatality Rate (CFR)</span>
                    <span className="font-mono text-rose-600 font-bold">{(cfr * 100).toFixed(2)}%</span>
                  </div>
                  <input
                    type="range"
                    min="0.001"
                    max="0.45"
                    step="0.005"
                    value={cfr}
                    onChange={(e) => { setSelectedPreset('custom'); setCfr(parseFloat(e.target.value)); }}
                    className="w-full accent-rose-600"
                  />
                  <div className="flex justify-between text-[10px] text-on-surface-variant font-mono">
                    <span>0.1% (Flu)</span>
                    <span>2.0% (Delta)</span>
                    <span>40.0% (Nipah)</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="flex justify-between text-xs font-medium text-on-surface mb-1">
                      <span>Incubation (Days)</span>
                      <span className="font-mono text-primary">{incubationDays.toFixed(1)}d</span>
                    </div>
                    <input
                      type="range"
                      min="1.0"
                      max="18.0"
                      step="0.5"
                      value={incubationDays}
                      onChange={(e) => { setSelectedPreset('custom'); setIncubationDays(parseFloat(e.target.value)); }}
                      className="w-full accent-primary"
                    />
                  </div>

                  <div>
                    <div className="flex justify-between text-xs font-medium text-on-surface mb-1">
                      <span>Infectious (Days)</span>
                      <span className="font-mono text-primary">{infectiousDays.toFixed(1)}d</span>
                    </div>
                    <input
                      type="range"
                      min="2.0"
                      max="20.0"
                      step="0.5"
                      value={infectiousDays}
                      onChange={(e) => { setSelectedPreset('custom'); setInfectiousDays(parseFloat(e.target.value)); }}
                      className="w-full accent-primary"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Tab 2: Mobility & Travel Modal Splits */}
            {activeTab === 'mobility' && (
              <div className="space-y-3.5 bg-surface p-3.5 rounded-xl border border-outline">
                <p className="text-[11px] text-on-surface-variant">
                  Adjust passenger transit modal allocation. Shares auto-normalize to 100% capacity in the engine.
                </p>

                <div>
                  <div className="flex justify-between text-xs font-medium text-on-surface mb-1">
                    <span>Road Highway Transport Share</span>
                    <span className="font-mono text-primary font-bold">{(roadShare * 100).toFixed(0)}%</span>
                  </div>
                  <input
                    type="range"
                    min="0.0"
                    max="1.0"
                    step="0.05"
                    value={roadShare}
                    onChange={(e) => { setSelectedPreset('custom'); setRoadShare(parseFloat(e.target.value)); }}
                    className="w-full accent-primary"
                  />
                </div>

                <div>
                  <div className="flex justify-between text-xs font-medium text-on-surface mb-1">
                    <span>Rail Passenger Transport Share</span>
                    <span className="font-mono text-primary font-bold">{(railShare * 100).toFixed(0)}%</span>
                  </div>
                  <input
                    type="range"
                    min="0.0"
                    max="1.0"
                    step="0.05"
                    value={railShare}
                    onChange={(e) => { setSelectedPreset('custom'); setRailShare(parseFloat(e.target.value)); }}
                    className="w-full accent-primary"
                  />
                </div>

                <div>
                  <div className="flex justify-between text-xs font-medium text-on-surface mb-1">
                    <span>Aviation Flight Network Share</span>
                    <span className="font-mono text-primary font-bold">{(airShare * 100).toFixed(0)}%</span>
                  </div>
                  <input
                    type="range"
                    min="0.0"
                    max="1.0"
                    step="0.05"
                    value={airShare}
                    onChange={(e) => { setSelectedPreset('custom'); setAirShare(parseFloat(e.target.value)); }}
                    className="w-full accent-primary"
                  />
                </div>
              </div>
            )}

            {/* Tab 3: Governance, Seeding & NPI */}
            {activeTab === 'governance' && (
              <div className="space-y-3.5 bg-surface p-3.5 rounded-xl border border-outline">
                <div>
                  <label className="text-xs font-medium text-on-surface block mb-1">
                    Active Non-Pharmaceutical Intervention (NPI)
                  </label>
                  <select
                    value={intervention}
                    onChange={(e) => { setSelectedPreset('custom'); setIntervention(e.target.value); }}
                    className="w-full bg-background border border-outline rounded-lg px-2.5 py-1.5 text-xs text-on-surface focus:outline-none focus:border-primary"
                  >
                    <option value="none">Baseline (No Restriction)</option>
                    <option value="rail_only">Transit Halt (Ground Flights + Halt Rail)</option>
                    <option value="partial">Partial Lockdown (40% Local Contacts Cut)</option>
                    <option value="full">Strict Quarantine (75% Local Contacts Cut)</option>
                  </select>
                </div>

                <div>
                  <div className="flex justify-between text-xs font-medium text-on-surface mb-1">
                    <span>Public Fear & Awareness Sensitivity (k)</span>
                    <span className="font-mono text-primary font-bold">{kSensitivity.toFixed(0)}</span>
                  </div>
                  <input
                    type="range"
                    min="0.0"
                    max="100.0"
                    step="1.0"
                    value={kSensitivity}
                    onChange={(e) => { setSelectedPreset('custom'); setKSensitivity(parseFloat(e.target.value)); }}
                    className="w-full accent-primary"
                  />
                  <div className="flex justify-between text-[10px] text-on-surface-variant font-mono">
                    <span>k=0 (No Fear/Fatigue)</span>
                    <span>k=35 (Standard SEIR-b)</span>
                    <span>k=80 (Hyper-Aware)</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium text-on-surface block mb-1">
                      Epicenter Origin City
                    </label>
                    <select
                      value={originCity}
                      onChange={(e) => { setSelectedPreset('custom'); setOriginCity(e.target.value); }}
                      className="w-full bg-background border border-outline rounded-lg px-2 py-1.5 text-xs text-on-surface"
                    >
                      {CITIES.map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <div className="flex justify-between text-xs font-medium text-on-surface mb-1">
                      <span>Initial Seed</span>
                      <span className="font-mono text-primary">{seedInfections}</span>
                    </div>
                    <input
                      type="range"
                      min="50"
                      max="5000"
                      step="50"
                      value={seedInfections}
                      onChange={(e) => { setSelectedPreset('custom'); setSeedInfections(parseInt(e.target.value)); }}
                      className="w-full accent-primary"
                    />
                  </div>
                </div>

                {/* Regional Cordon Sanitaire Selection */}
                <div className="pt-2.5 border-t border-outline">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-semibold text-on-surface">
                      Targeted Regional Cordon Sanitaires
                    </span>
                    {quarantinedCities.length > 0 && (
                      <button
                        type="button"
                        onClick={() => { setSelectedPreset('custom'); setQuarantinedCities([]); }}
                        className="text-[10px] text-rose-500 hover:underline font-mono font-medium"
                      >
                        Reset ({quarantinedCities.length})
                      </button>
                    )}
                  </div>
                  <p className="text-[10px] text-on-surface-variant mb-2">
                    Sever all incoming and outgoing travel edges for targeted epicenter nodes.
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {CITIES.slice(0, 10).map((city) => {
                      const isQuarantined = quarantinedCities.includes(city);
                      return (
                        <button
                          key={city}
                          type="button"
                          onClick={() => {
                            setSelectedPreset('custom');
                            setQuarantinedCities((prev) =>
                              isQuarantined ? prev.filter((c) => c !== city) : [...prev, city]
                            );
                          }}
                          className={`px-2 py-1 rounded-md text-[10px] font-mono transition-all border ${
                            isQuarantined
                              ? 'bg-rose-500/20 border-rose-500 text-rose-600 dark:text-rose-400 font-bold shadow-sm'
                              : 'bg-surface-container/60 border-outline text-on-surface hover:border-primary/50'
                          }`}
                        >
                          {isQuarantined ? '⛔ ' : ''}{city}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* Tab 4: Vaccination Campaign Controls */}
            {activeTab === 'vaccination' && (
              <div className="space-y-4 bg-surface p-4 rounded-xl border border-outline">
                {/* Master Switch */}
                <div className="flex items-center justify-between pb-3 border-b border-outline">
                  <div>
                    <span className="text-xs font-bold text-on-surface flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                      Immunization Program Activation
                    </span>
                    <p className="text-[10px] text-on-surface-variant mt-0.5">
                      Leaky vaccine protection (Halloran et al.) drawn from eligible pool (S + R).
                    </p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={vaxEnabled}
                      onChange={(e) => {
                        setSelectedPreset('custom');
                        setVaxEnabled(e.target.checked);
                      }}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-surface-variant peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-600"></div>
                  </label>
                </div>

                {!vaxEnabled ? (
                  <div className="p-3 rounded-lg bg-surface-container/50 border border-outline text-[11px] text-on-surface-variant space-y-1.5">
                    <p className="font-semibold text-on-surface">Vaccination Rollout Inactive</p>
                    <p>
                      Toggle the switch above to simulate mass immunization campaigns, evaluating herd immunity thresholds, onset delays, and severity attenuation against mortality.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div>
                      <div className="flex justify-between text-xs font-medium text-on-surface mb-1">
                        <span>Campaign Rollout Start</span>
                        <span className="font-mono text-emerald-600 font-bold">Day {vaxStartDay}</span>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max="120"
                        step="5"
                        value={vaxStartDay}
                        onChange={(e) => { setSelectedPreset('custom'); setVaxStartDay(parseInt(e.target.value)); }}
                        className="w-full accent-emerald-600"
                      />
                      <div className="flex justify-between text-[10px] text-on-surface-variant font-mono">
                        <span>Day 0</span>
                        <span>Day 30 (Surge)</span>
                        <span>Day 90+</span>
                      </div>
                    </div>

                    <div>
                      <div className="flex justify-between text-xs font-medium text-on-surface mb-1">
                        <span>Daily Administration Rate</span>
                        <span className="font-mono text-emerald-600 font-bold">{(vaxDailyRate * 100).toFixed(2)}% / day</span>
                      </div>
                      <input
                        type="range"
                        min="0.0005"
                        max="0.01"
                        step="0.0005"
                        value={vaxDailyRate}
                        onChange={(e) => { setSelectedPreset('custom'); setVaxDailyRate(parseFloat(e.target.value)); }}
                        className="w-full accent-emerald-600"
                      />
                      <div className="flex justify-between text-[10px] text-on-surface-variant font-mono">
                        <span>0.05%</span>
                        <span>0.30% (Standard)</span>
                        <span>1.00% (Blitz)</span>
                      </div>
                    </div>

                    <div>
                      <div className="flex justify-between text-xs font-medium text-on-surface mb-1">
                        <span>Infection Efficacy (Transmission Reduction)</span>
                        <span className="font-mono text-emerald-600 font-bold">{(vaxEfficacy * 100).toFixed(0)}%</span>
                      </div>
                      <input
                        type="range"
                        min="0.30"
                        max="0.99"
                        step="0.05"
                        value={vaxEfficacy}
                        onChange={(e) => { setSelectedPreset('custom'); setVaxEfficacy(parseFloat(e.target.value)); }}
                        className="w-full accent-emerald-600"
                      />
                      <div className="flex justify-between text-[10px] text-on-surface-variant font-mono">
                        <span>30%</span>
                        <span>70% (Standard)</span>
                        <span>95% (mRNA Tier)</span>
                      </div>
                    </div>

                    <div>
                      <div className="flex justify-between text-xs font-medium text-on-surface mb-1">
                        <span>Severity Protection (Breakthrough Fatality Reduction)</span>
                        <span className="font-mono text-emerald-600 font-bold">{(vaxSeverityEfficacy * 100).toFixed(0)}%</span>
                      </div>
                      <input
                        type="range"
                        min="0.50"
                        max="0.99"
                        step="0.05"
                        value={vaxSeverityEfficacy}
                        onChange={(e) => { setSelectedPreset('custom'); setVaxSeverityEfficacy(parseFloat(e.target.value)); }}
                        className="w-full accent-emerald-600"
                      />
                      <div className="flex justify-between text-[10px] text-on-surface-variant font-mono">
                        <span>50%</span>
                        <span>85% (Standard)</span>
                        <span>99% (Maximum)</span>
                      </div>
                    </div>

                    <div>
                      <div className="flex justify-between text-xs font-medium text-on-surface mb-1">
                        <span>Protection Onset Delay (Immune Response)</span>
                        <span className="font-mono text-emerald-600 font-bold">{vaxOnsetDays} days</span>
                      </div>
                      <input
                        type="range"
                        min="1"
                        max="30"
                        step="1"
                        value={vaxOnsetDays}
                        onChange={(e) => { setSelectedPreset('custom'); setVaxOnsetDays(parseInt(e.target.value)); }}
                        className="w-full accent-emerald-600"
                      />
                      <div className="flex justify-between text-[10px] text-on-surface-variant font-mono">
                        <span>1 Day (Instant)</span>
                        <span>14 Days (Standard)</span>
                        <span>28 Days</span>
                      </div>
                    </div>

                    <div>
                      <label className="text-xs font-medium text-on-surface block mb-1.5">
                        Antibody Waning Duration (1/ω)
                      </label>
                      <div className="grid grid-cols-3 gap-2">
                        <button
                          type="button"
                          onClick={() => { setSelectedPreset('custom'); setVaxWaningDays(null); }}
                          className={`py-1.5 px-2 rounded-lg text-[11px] font-mono border transition-all ${
                            vaxWaningDays === null
                              ? 'bg-emerald-500/10 border-emerald-600 text-emerald-600 font-bold'
                              : 'bg-background border-outline text-on-surface-variant hover:text-on-surface'
                          }`}
                        >
                          Permanent
                        </button>
                        <button
                          type="button"
                          onClick={() => { setSelectedPreset('custom'); setVaxWaningDays(180); }}
                          className={`py-1.5 px-2 rounded-lg text-[11px] font-mono border transition-all ${
                            vaxWaningDays === 180
                              ? 'bg-emerald-500/10 border-emerald-600 text-emerald-600 font-bold'
                              : 'bg-background border-outline text-on-surface-variant hover:text-on-surface'
                          }`}
                        >
                          180 Days
                        </button>
                        <button
                          type="button"
                          onClick={() => { setSelectedPreset('custom'); setVaxWaningDays(365); }}
                          className={`py-1.5 px-2 rounded-lg text-[11px] font-mono border transition-all ${
                            vaxWaningDays === 365
                              ? 'bg-emerald-500/10 border-emerald-600 text-emerald-600 font-bold'
                              : 'bg-background border-outline text-on-surface-variant hover:text-on-surface'
                          }`}
                        >
                          365 Days
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Tab 5: Mass Gathering & Festival Shocks */}
            {activeTab === 'festivals' && (
              <div className="space-y-4 bg-surface p-4 rounded-xl border border-outline">
                {/* Master Switch */}
                <div className="flex items-center justify-between pb-3 border-b border-outline">
                  <div>
                    <span className="text-xs font-bold text-on-surface flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-amber-500"></span>
                      Mass Gathering & Superspreading Shocks
                    </span>
                    <p className="text-[10px] text-on-surface-variant mt-0.5">
                      Simulate temporary crowd transmission amplification scoped to participating attendees.
                    </p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={festivalEnabled}
                      onChange={(e) => {
                        setSelectedPreset('custom');
                        setFestivalEnabled(e.target.checked);
                      }}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-surface-variant peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-amber-600"></div>
                  </label>
                </div>

                {!festivalEnabled ? (
                  <div className="p-3 rounded-lg bg-surface-container/50 border border-outline text-[11px] text-on-surface-variant space-y-1.5">
                    <p className="font-semibold text-on-surface">No Active Gathering Injected</p>
                    <p>
                      Activate to inject religious pilgrimages (e.g. Kumbh Mela), election rallies, or national sports events to test localized surge acceleration and inter-city export shocks.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3.5">
                    {/* Event Quick-Picks */}
                    <div>
                      <span className="text-[10px] text-on-surface-variant uppercase tracking-wider block font-semibold mb-1">
                        Gathering Templates
                      </span>
                      <div className="grid grid-cols-3 gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedPreset('custom');
                            setFestivalName('Kumbh Pilgrimage');
                            setFestivalCity('DELHI');
                            setFestivalStartDay(25);
                            setFestivalEndDay(40);
                            setFestivalCrowdMult(3.0);
                            setFestivalAttendeeFrac(0.15);
                          }}
                          className="p-1.5 rounded-lg border border-outline bg-background hover:bg-surface-variant text-[10px] font-mono text-left"
                        >
                          <div className="font-semibold truncate">Kumbh Mela</div>
                          <div className="text-on-surface-variant">15d · 3.0x</div>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedPreset('custom');
                            setFestivalName('Mega Rally');
                            setFestivalCity('MUMBAI');
                            setFestivalStartDay(30);
                            setFestivalEndDay(37);
                            setFestivalCrowdMult(2.5);
                            setFestivalAttendeeFrac(0.10);
                          }}
                          className="p-1.5 rounded-lg border border-outline bg-background hover:bg-surface-variant text-[10px] font-mono text-left"
                        >
                          <div className="font-semibold truncate">Election Rally</div>
                          <div className="text-on-surface-variant">7d · 2.5x</div>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedPreset('custom');
                            setFestivalName('Championship');
                            setFestivalCity('AHMEDABAD');
                            setFestivalStartDay(20);
                            setFestivalEndDay(30);
                            setFestivalCrowdMult(2.2);
                            setFestivalAttendeeFrac(0.08);
                          }}
                          className="p-1.5 rounded-lg border border-outline bg-background hover:bg-surface-variant text-[10px] font-mono text-left"
                        >
                          <div className="font-semibold truncate">Sports Cup</div>
                          <div className="text-on-surface-variant">10d · 2.2x</div>
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs font-medium text-on-surface block mb-1">
                          Host Metropolitan City
                        </label>
                        <select
                          value={festivalCity}
                          onChange={(e) => { setSelectedPreset('custom'); setFestivalCity(e.target.value); }}
                          className="w-full bg-background border border-outline rounded-lg px-2 py-1.5 text-xs text-on-surface"
                        >
                          {CITIES.map((c) => (
                            <option key={c} value={c}>{c}</option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="text-xs font-medium text-on-surface block mb-1">
                          Event Label
                        </label>
                        <input
                          type="text"
                          value={festivalName}
                          onChange={(e) => { setSelectedPreset('custom'); setFestivalName(e.target.value); }}
                          className="w-full bg-background border border-outline rounded-lg px-2.5 py-1.5 text-xs text-on-surface"
                          placeholder="Event Name"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <div className="flex justify-between text-xs font-medium text-on-surface mb-1">
                          <span>Start Day</span>
                          <span className="font-mono text-amber-600 font-bold">Day {festivalStartDay}</span>
                        </div>
                        <input
                          type="range"
                          min="1"
                          max="120"
                          step="1"
                          value={festivalStartDay}
                          onChange={(e) => {
                            setSelectedPreset('custom');
                            const s = parseInt(e.target.value);
                            setFestivalStartDay(s);
                            if (s >= festivalEndDay) setFestivalEndDay(s + 5);
                          }}
                          className="w-full accent-amber-600"
                        />
                      </div>

                      <div>
                        <div className="flex justify-between text-xs font-medium text-on-surface mb-1">
                          <span>End Day</span>
                          <span className="font-mono text-amber-600 font-bold">Day {festivalEndDay}</span>
                        </div>
                        <input
                          type="range"
                          min={festivalStartDay + 1}
                          max="160"
                          step="1"
                          value={festivalEndDay}
                          onChange={(e) => { setSelectedPreset('custom'); setFestivalEndDay(parseInt(e.target.value)); }}
                          className="w-full accent-amber-600"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <div className="flex justify-between text-xs font-medium text-on-surface mb-1">
                          <span>Crowd Multiplier (C_k)</span>
                          <span className="font-mono text-amber-600 font-bold">{festivalCrowdMult.toFixed(1)}x</span>
                        </div>
                        <input
                          type="range"
                          min="1.2"
                          max="5.0"
                          step="0.1"
                          value={festivalCrowdMult}
                          onChange={(e) => { setSelectedPreset('custom'); setFestivalCrowdMult(parseFloat(e.target.value)); }}
                          className="w-full accent-amber-600"
                        />
                      </div>

                      <div>
                        <div className="flex justify-between text-xs font-medium text-on-surface mb-1">
                          <span>Attendee Fraction (f_k)</span>
                          <span className="font-mono text-amber-600 font-bold">{(festivalAttendeeFrac * 100).toFixed(0)}%</span>
                        </div>
                        <input
                          type="range"
                          min="0.01"
                          max="0.30"
                          step="0.01"
                          value={festivalAttendeeFrac}
                          onChange={(e) => { setSelectedPreset('custom'); setFestivalAttendeeFrac(parseFloat(e.target.value)); }}
                          className="w-full accent-amber-600"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

          </div>

        </div>
      </div>
    </div>
  );
}
