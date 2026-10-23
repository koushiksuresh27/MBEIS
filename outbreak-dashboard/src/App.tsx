import { useState, useEffect, useMemo } from 'react';
import PrintLayout, { ExecutiveBrief } from './components/print/PrintLayout';
import AnalystView from './pages/AnalystView';
import PlannerView from './pages/PlannerView';
import BubbleMap from './components/analyst-view/BubbleMap';
import { useCityStatus } from './hooks/useCityStatus';
import { useResourceProjections } from './hooks/useResourceProjections';
import { useSeirdResults } from './hooks/useSeirdResults';
import SetupModal from './components/SetupModal';
import type { ScenarioConfig } from './types/scenario';
import { useWHODon } from './hooks/useWHODon';
import WHOAlertsModal from './components/WHOAlertsModal';
import ErisDrawer from './components/ErisDrawer';
import PlaygroundDrawer from './components/PlaygroundDrawer';
import RippleLoader from './components/common/RippleLoader';
import { VoiceAgentProvider, useVoiceAgent } from './context/VoiceAgentContext';
import VoicePartnerDock from './components/voice/VoicePartnerDock';
import { supabase } from './lib/supabase';
import LandingPortal from './components/landing/LandingPortal';
import type { Session } from '@supabase/supabase-js';

const SCENARIO_ID = 'bb0ff20e-b086-411b-8054-91560b1e88ec';

function ScreenContextSync({
  view,
  scenarioId,
  isPlaygroundOpen,
  isErisOpen,
  mapDay,
  mapIntervention,
}: {
  view: 'planner' | 'analyst' | 'map';
  scenarioId: string;
  isPlaygroundOpen: boolean;
  isErisOpen: boolean;
  mapDay: number;
  mapIntervention: string;
}) {
  const { updateScreenContext } = useVoiceAgent();

  useEffect(() => {
    let screenSummary = '';
    let activeFeatures: string[] = [];

    if (view === 'map') {
      screenSummary = `User is currently viewing the Spread Map (Day ${mapDay}, ${mapIntervention.toUpperCase()} intervention). This is the interactive geographic mobility network of India.`;
      activeFeatures = [
        'Regional Cordon Sanitaire controls: South Rail Cordon, North Belt Cordon, West Hub Cordon (applies 98% strict boundary containment and 75% internal emergency movement restrictions to stop interstate leakage)',
        'Interactive Corridor Capacity sliders (throttle or sever specific rail/road edges between city pairs)',
        'Day playback timeline slider (Day 1 Thrissur seed through Day 180)',
        'City infection bubbles (green=low, yellow=medium, red=high outbreak activity)'
      ];
    } else if (view === 'analyst') {
      screenSummary = 'User is currently viewing the Analyst View (Detailed epidemiological risk breakdown and city ignition sequence).';
      activeFeatures = [
        'Top 10 City Ignition sequence (days until active cases cross 100 in each city)',
        'Healthcare capacity exhaustion curves (ICU beds and Oxygen demand vs the 17,000 MT/day capacity ceiling)',
        'Monte Carlo stochastic trajectory and P10-P90 uncertainty confidence intervals'
      ];
    } else if (view === 'planner') {
      screenSummary = 'User is currently viewing the Planner View (Intervention comparison & strategic policy roadmap).';
      activeFeatures = [
        'SEIRD macro trajectory comparison across 4 policies (Baseline, Transit Halt, Partial Restrictions, Full Quarantine)',
        'Strategic Policy Recommendations dossier',
        'Healthcare resource shortfall comparisons'
      ];
    }

    if (isPlaygroundOpen) {
      activeFeatures.push('Policy Sandbox / What-If ODE Explorer is open on screen with interactive sliders for transmission, testing, and quarantine timings');
    }
    if (isErisOpen) {
      activeFeatures.push('ERIS Intelligence Notebook & Ledger drawer is open on screen');
    }

    updateScreenContext({
      currentView: view,
      scenarioId,
      isPlaygroundOpen,
      activeFeatures,
      screenSummary,
    });
  }, [view, scenarioId, isPlaygroundOpen, isErisOpen, mapDay, mapIntervention, updateScreenContext]);

  return null;
}

function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [isGuest, setIsGuest] = useState(false);

  const handleEnterDashboard = () => {
    setIsGuest(true);
    window.history.pushState({ page: 'dashboard' }, '', '#dashboard');
  };

  const handleSignOut = async () => {
    if (session) {
      await supabase.auth.signOut();
    }
    setIsGuest(false);
    window.history.pushState({ page: 'landing' }, '', '#overview');
  };

  useEffect(() => {
    const handlePopState = () => {
      if (!window.location.hash.includes('dashboard')) {
        setIsGuest(false);
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: currentSession } }) => {
      setSession(currentSession);
      setIsAuthLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, currentSession) => {
      setSession(currentSession);
      setIsAuthLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const [view, setView] = useState<'planner' | 'analyst' | 'map'>('analyst');
  const [isDark, setIsDark] = useState(false);
  const [mapDay, setMapDay] = useState(1);
  const [mapIntervention, setMapIntervention] = useState('none');

  const [modalOpen, setModalOpen] = useState(false);
  const [whoModalOpen, setWhoModalOpen] = useState(false);
  const [isErisOpen, setIsErisOpen] = useState(false);
  const [isPlaygroundOpen, setIsPlaygroundOpen] = useState(false);
  const [playgroundMode, setPlaygroundMode] = useState<'default' | 'planner_levers'>('default');
  const [plannerLeversHandoff, setPlannerLeversHandoff] = useState<{
    initialVaccination?: any;
    initialFestivals?: any;
    onApply?: (levers: { vaccination: any; festivals: any }) => void;
  } | null>(null);

  const handleOpenPolicyLevers = (params: {
    initialVaccination?: any;
    initialFestivals?: any;
    onApply: (levers: { vaccination: any; festivals: any }) => void;
  }) => {
    setPlaygroundMode('planner_levers');
    setPlannerLeversHandoff(params);
    setIsPlaygroundOpen(true);
  };

  const [sandboxHandoff, setSandboxHandoff] = useState<any>(null);
  const [pendingEdgeCuts, setPendingEdgeCuts] = useState<Array<{ src: string; tgt: string; modes: string[] }>>([]);
  const [isFirstRun, setIsFirstRun] = useState(false);
  const [modalInitialTab, setModalInitialTab] = useState<'history' | 'configure'>('configure');

  // Tier 1: Restore scenarioConfig from localStorage
  const [scenarioConfig, setScenarioConfig] = useState<ScenarioConfig | null>(() => {
    try {
      const raw = localStorage.getItem('mbeis_active_scenario');
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  });

  const updateScenarioConfig = (config: ScenarioConfig | null) => {
    setScenarioConfig(config);
    if (config) {
      try {
        localStorage.setItem('mbeis_active_scenario', JSON.stringify(config));
      } catch (e) {
        console.error('Failed to save scenario to localStorage', e);
      }
    } else {
      localStorage.removeItem('mbeis_active_scenario');
    }
  };

  useEffect(() => {
    const handleApplyPlan = () => {
      setView('planner');
    };
    window.addEventListener('apply-research-plan', handleApplyPlan);
    return () => window.removeEventListener('apply-research-plan', handleApplyPlan);
  }, []);

  // Tier 2: Auto-load latest valid scenario from Supabase if none exists
  useEffect(() => {
    if (scenarioConfig?.scenarioId) return;

    async function loadLatestScenario() {
      try {
        const { data: latest } = await supabase
          .from('scenarios')
          .select('scenario_id, origin_city, pathogen_description, created_at')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (latest && latest.scenario_id) {
          const restoredConfig: ScenarioConfig = {
            scenarioId: latest.scenario_id,
            originCity: latest.origin_city || 'DELHI',
            nIterations: 128,
            scenarioLabel: `${latest.pathogen_description || 'Simulation'} · ${latest.origin_city || 'DELHI'}`,
            pathogenName: latest.pathogen_description || 'Custom Pathogen',
          };
          updateScenarioConfig(restoredConfig);
        }
      } catch (err) {
        console.error('Failed to auto-load latest scenario from Supabase:', err);
      }
    }

    loadLatestScenario();
  }, [scenarioConfig]);

  const { alerts: whoAlerts, loading: whoLoading } = useWHODon();
  const [reportType, setReportType] = useState<'executive' | 'full'>('executive');
  const [showExportMenu, setShowExportMenu] = useState(false);

  const handleSimulationComplete = (config: ScenarioConfig) => {
    updateScenarioConfig(config);
    setIsFirstRun(false);
    setModalOpen(false);
    // Delay firing the event so Supabase has time to finish writing all rows
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('simulation-complete'));
      setIsErisOpen(true);
    }, 1500);
  };

  const activeScenarioId = scenarioConfig?.scenarioId ?? SCENARIO_ID;
  const { data: seirdData, loading: seirdLoading } = useSeirdResults(activeScenarioId);
  const { data: cityData, loading: cityLoading } = useCityStatus(activeScenarioId);
  const { data: resourceData, cityData: resourceCityData, loading: resourceLoading } = useResourceProjections(activeScenarioId);

  // Recovery: If current scenarioId has 0 results, auto-fallback to newest scenario with valid data
  useEffect(() => {
    if (!seirdLoading && seirdData && Object.keys(seirdData).length === 0 && scenarioConfig) {
      async function recoverPrunedScenario() {
        try {
          const { data: latest } = await supabase
            .from('scenarios')
            .select('scenario_id, origin_city, pathogen_description, created_at')
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

          if (latest && latest.scenario_id && latest.scenario_id !== scenarioConfig?.scenarioId) {
            const restoredConfig: ScenarioConfig = {
              scenarioId: latest.scenario_id,
              originCity: latest.origin_city || 'DELHI',
              nIterations: 128,
              scenarioLabel: `${latest.pathogen_description || 'Simulation'} · ${latest.origin_city || 'DELHI'}`,
              pathogenName: latest.pathogen_description || 'Custom Pathogen',
            };
            updateScenarioConfig(restoredConfig);
          }
        } catch (err) {
          console.error('Recovery failed:', err);
        }
      }
      recoverPrunedScenario();
    }
  }, [seirdLoading, seirdData, scenarioConfig]);

  const STANDARD_KEYS = new Set(['none', 'rail_only', 'partial', 'full']);

  const dynamicInterventionKeys = useMemo(() => {
    const customKeys = Object.keys(seirdData || {}).filter(k => !STANDARD_KEYS.has(k));
    return ['none', 'rail_only', 'partial', 'full', ...customKeys];
  }, [seirdData]);

  const nationalStats = useMemo(() => {
    if (!seirdData) return {};
    const stats: Record<string, any> = {};
    dynamicInterventionKeys.forEach(key => {
      const invData = seirdData[key] || [];
      let peakInfections = 0, peakDay = 0, day90Deaths = 0, day180Val = 0;
      invData.forEach((d: any) => {
        if (d.infected_p50 > peakInfections) { peakInfections = d.infected_p50; peakDay = d.day; }
        if (d.day === 90) day90Deaths = d.deaths_p50;
        if (d.day === 180) day180Val = d.infected_p50;
      });
      if (day90Deaths === 0 && invData.length > 0) day90Deaths = invData[invData.length - 1].deaths_p50;
      const verdict = peakInfections > 150 ? 'High transmission — intervention critical'
        : peakInfections >= 50 ? 'Moderate spread — monitor closely'
          : 'Contained — intervention effective';
      stats[key] = { peakInfections, peakDay, day90Deaths, day180Val, verdict };
    });
    return stats;
  }, [seirdData, dynamicInterventionKeys]);

  const cityTableData = useMemo(() => {
    if (!cityData) return [];
    return Object.keys(cityData)
      .map(city => {
        const row: Record<string, any> = { city };
        dynamicInterventionKeys.forEach(key => {
          const invArray = cityData[city]?.[key] || [];
          const sorted = [...invArray].sort((a: any, b: any) => Number(b.day) - Number(a.day));
          const latest = sorted.find((d: any) => Number(d.day) === 180) ?? sorted[0];
          row[key] = latest ? parseFloat(String(latest.active_cases_p50 ?? '0')) : 0;
        });
        return row;
      })
      .sort((a, b) => b.none - a.none);
  }, [cityData, dynamicInterventionKeys]);

  const resourceStats = useMemo(() => {
    if (!resourceData) return { resources: {}, capacityCeiling: 17000 };
    const resources: Record<string, any> = {};
    dynamicInterventionKeys.forEach(key => {
      const invWeeks = resourceData[key] || [];
      let peakOxygen = 0, peakICU = 0;
      invWeeks.forEach((w: any) => {
        if (w.oxygen_mt > peakOxygen) peakOxygen = w.oxygen_mt;
        if (w.icu_beds > peakICU) peakICU = w.icu_beds;
      });
      resources[key] = { peakOxygen, peakICU, shortfall: peakOxygen - 17000 };
    });
    return { resources, capacityCeiling: 17000 };
  }, [resourceData, dynamicInterventionKeys]);

  const dynamicInterventions = useMemo(() => {
    const firstCity = Object.values(cityData || {})[0];
    const allKeys = firstCity ? Object.keys(firstCity) : [];
    const standardKeys = new Set(['none', 'rail_only', 'partial', 'full']);
    const customKeys = allKeys.filter(k => !standardKeys.has(k));
    const customEntries = customKeys.map(k => ({
      key: k,
      label: k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
      color: '#7C3AED'
    }));
    return [
      { key: 'none', label: 'Baseline', color: '#C62828' },
      { key: 'rail_only', label: 'Transit Halt', color: '#F57F17' },
      { key: 'partial', label: 'Partial Lockdown', color: '#2E4A8C' },
      { key: 'full', label: 'Full Quarantine', color: '#2E7D32' },
      ...customEntries
    ];
  }, [cityData]);

  const chartData = useMemo(() => {
    if (!seirdData || Object.keys(seirdData).length === 0) return [];
    const combinedData = [];
    for (let day = 1; day <= 180; day++) {
      const dayData: any = { day };
      dynamicInterventions.forEach(inv => {
        const invData = seirdData[inv.key]?.find((d: any) => d.day === day);
        if (invData) {
          dayData[`${inv.key}_infected_p50`] = invData.infected_p50;
          dayData[`${inv.key}_infected_band`] = [invData.infected_p10, invData.infected_p90];
          dayData[`${inv.key}_deaths_p50`] = invData.deaths_p50;
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
  }, [seirdData, dynamicInterventions]);

  const rtChartData = useMemo(() => {
    if (!seirdData || Object.keys(seirdData).length === 0) return [];
    const infectiousDays = 7.0;
    const result = [];
    for (let day = 2; day <= 179; day++) {
      const dayObj: any = { day };
      dynamicInterventions.forEach(inv => {
        const invData = seirdData[inv.key] || [];
        const prev = invData.find((d: any) => d.day === day - 1);
        const curr = invData.find((d: any) => d.day === day);
        const next = invData.find((d: any) => d.day === day + 1);
        if (prev && curr && next && curr.infected_p50 > 10) {
          const growthRate = (next.infected_p50 - prev.infected_p50) / (2 * curr.infected_p50);
          const rt = 1 + growthRate * infectiousDays;
          dayObj[`${inv.key}_rt`] = Math.max(0, Math.min(rt, 6));
        } else {
          dayObj[`${inv.key}_rt`] = null;
        }
      });
      result.push(dayObj);
    }
    return result;
  }, [seirdData, dynamicInterventions]);

  const resourceChartData = useMemo(() => {
    if (!resourceData || Object.keys(resourceData).length === 0) return [];
    const combinedData = [];
    for (let week = 1; week <= 26; week++) {
      const weekData: any = { week };
      dynamicInterventions.forEach(inv => {
        const invDataList = resourceData[inv.key]?.filter((d: any) => d.week === week);
        if (invDataList && invDataList.length > 0) {
          weekData[`${inv.key}_oxygen_mt`] = invDataList.reduce((sum: number, d: any) => sum + d.oxygen_mt, 0);
          weekData[`${inv.key}_icu_beds`] = invDataList.reduce((sum: number, d: any) => sum + d.icu_beds, 0);
          weekData[`${inv.key}_non_icu_beds`] = invDataList.reduce((sum: number, d: any) => sum + d.non_icu_beds, 0);
          weekData[`${inv.key}_isolation_beds`] = invDataList.reduce((sum: number, d: any) => sum + d.isolation_beds, 0);
        }
      });
      combinedData.push(weekData);
    }
    return combinedData;
  }, [resourceData, dynamicInterventions]);

  useEffect(() => {
    if (isDark) {
      document.documentElement.setAttribute('data-theme', 'dark');
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
  }, [isDark]);

  useEffect(() => {
    const handleOpenSetup = (e: any) => {
      const { disease } = e.detail;
      // Extract first word of disease to help matching
      const diseasePrefix = disease ? disease.split(' ')[0] : '';

      setScenarioConfig(prev => ({
        ...(prev || {}),
        pathogenName: diseasePrefix || disease,
        originCity: 'DELHI', // Default to a major city since WHO alerts are country-level
        nIterations: 128,
        scenarioLabel: `WHO Alert: ${diseasePrefix || disease}`
      }) as ScenarioConfig);

      setModalOpen(true);
    };

    window.addEventListener('open-setup', handleOpenSetup);
    return () => window.removeEventListener('open-setup', handleOpenSetup);
  }, []);

  useEffect(() => {
    const handleToggleNotebook = () => setIsErisOpen(prev => !prev);
    window.addEventListener('toggle-eris-notebook', handleToggleNotebook);
    return () => window.removeEventListener('toggle-eris-notebook', handleToggleNotebook);
  }, []);

  const handleRefresh = () => {
    window.dispatchEvent(new CustomEvent('simulation-data-refresh'));
  };

  const handleExport = (type: 'executive' | 'full') => {
    setShowExportMenu(false);
    setReportType(type);

    // Strip dark theme so print is always white
    const wasDark = document.documentElement.hasAttribute('data-theme');
    document.documentElement.removeAttribute('data-theme');

    console.log('chartData length:', chartData.length);
    console.log('rtChartData length:', rtChartData.length);
    console.log('resourceChartData length:', resourceChartData.length);

    document.title = `MBEIS_${type}_${new Date().toISOString().split('T')[0]}`;

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        window.onafterprint = () => {
          document.title = 'MBEIS';
          // Restore dark theme after printing
          if (wasDark) document.documentElement.setAttribute('data-theme', 'dark');
          window.onafterprint = null;
        };
        window.print();
      });
    });
  };

  if (isAuthLoading) {
    return (
      <div className="flex items-center justify-center h-screen w-screen bg-background">
        <RippleLoader
          message="MBEIS"
          subMessage="Authenticating secure institutional session..."
        />
      </div>
    );
  }

  if (!session && !isGuest) {
    return (
      <LandingPortal
        onAuthSuccess={handleEnterDashboard}
        onGuestAccess={handleEnterDashboard}
      />
    );
  }

  return (
    <VoiceAgentProvider>
      <ScreenContextSync
        view={view}
        scenarioId={activeScenarioId}
        isPlaygroundOpen={isPlaygroundOpen}
        isErisOpen={isErisOpen}
        mapDay={mapDay}
        mapIntervention={mapIntervention}
      />
      <div id="dashboard-root" className="flex flex-col h-screen bg-background overflow-hidden">
        {/* Global Header */}
        <header className="flex items-center justify-between px-6 py-4 border-b border-outline bg-surface sticky top-0 z-40 shrink-0">
          <div className="flex items-center gap-3 shrink-0 max-w-[280px]">
            <div className="w-9 h-9 text-primary flex items-center justify-center shrink-0">
              <svg className="w-8 h-8" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2.2">
                <circle cx="24" cy="24" r="5" strokeWidth="2.5" />
                <circle cx="24" cy="13" r="5" strokeDasharray="1 0" />
                <circle cx="24" cy="35" r="5" strokeDasharray="1 0" />
                <circle cx="13" cy="24" r="5" strokeDasharray="1 0" />
                <circle cx="35" cy="24" r="5" strokeDasharray="1 0" />
                <circle cx="16" cy="16" r="5" opacity="0.65" />
                <circle cx="32" cy="16" r="5" opacity="0.65" />
                <circle cx="16" cy="32" r="5" opacity="0.65" />
                <circle cx="32" cy="32" r="5" opacity="0.65" />
              </svg>
            </div>
            <div className="flex flex-col min-w-0">
              <h1 className="text-xl font-extrabold text-primary tracking-tight font-heading whitespace-nowrap leading-tight">MBEIS</h1>
              <p className="text-[11px] text-on-surface-variant font-mono truncate tracking-wider">
                EPIDEMIC DECISION SUPPORT
              </p>
            </div>
          </div>

          {/* Navigation & Header Actions - Fixed & Evenly Spaced */}
          <div className="flex items-center gap-2.5 shrink-0">
            {/* View Mode Toggle */}
            <div className="flex items-center bg-surface-container rounded-lg p-1 border border-outline shrink-0">
              <button
                onClick={() => setView('planner')}
                className={`px-3.5 py-1.5 rounded-md text-sm font-medium transition-colors cursor-pointer ${view === 'planner'
                  ? 'bg-surface shadow-sm text-on-surface'
                  : 'text-on-surface-variant opacity-60 hover:opacity-100 hover:bg-surface-variant'
                  }`}
              >
                Planner View
              </button>
              <button
                onClick={() => setView('analyst')}
                className={`px-3.5 py-1.5 rounded-md text-sm font-medium transition-colors cursor-pointer ${view === 'analyst'
                  ? 'bg-surface shadow-sm text-on-surface'
                  : 'text-on-surface-variant opacity-60 hover:opacity-100 hover:bg-surface-variant'
                  }`}
              >
                Analyst View
              </button>
              <button
                onClick={() => setView('map')}
                className={`px-3.5 py-1.5 rounded-md text-sm font-medium transition-colors cursor-pointer ${view === 'map'
                  ? 'bg-surface shadow-sm text-on-surface'
                  : 'text-on-surface-variant opacity-60 hover:opacity-100 hover:bg-surface-variant'
                  }`}
              >
                Spread Map
              </button>
            </div>

            {/* Dark Mode Toggle */}
            <button
              onClick={() => setIsDark(!isDark)}
              className="p-1.5 rounded-lg text-on-surface-variant hover:bg-surface-variant hover:text-on-surface transition-colors shrink-0 flex items-center justify-center cursor-pointer"
              title="Toggle Dark Mode"
            >
              {isDark ? (
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>
              )}
            </button>

            {/* Notebook Button */}
            <button
              onClick={() => setIsErisOpen(!isErisOpen)}
              className={`px-2.5 py-1.5 rounded-lg border text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer shrink-0 ${
                isErisOpen
                  ? 'bg-primary text-white border-primary shadow-xs'
                  : 'bg-surface border-outline text-on-surface hover:bg-surface-variant'
              }`}
              title="Toggle ERIS Intelligence Notebook & Ledger"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 6h4" />
                <path d="M2 10h4" />
                <path d="M2 14h4" />
                <path d="M2 18h4" />
                <rect width="16" height="20" x="4" y="2" rx="2" />
                <path d="M9.5 8h5" />
                <path d="M9.5 12h5" />
                <path d="M9.5 16h5" />
              </svg>
              <span>Notebook</span>
            </button>

            {/* Policy Sandbox Button */}
            <button
              onClick={() => {
                if (isPlaygroundOpen) {
                  setIsPlaygroundOpen(false);
                  setPlaygroundMode('default');
                  setPlannerLeversHandoff(null);
                } else {
                  setPlaygroundMode('default');
                  setPlannerLeversHandoff(null);
                  setIsPlaygroundOpen(true);
                }
              }}
              className={`relative rounded-lg border px-3 py-1.5 shadow-sm text-xs font-semibold transition-all flex items-center gap-1.5 shrink-0 cursor-pointer ${
                isPlaygroundOpen
                  ? 'bg-primary text-white border-primary shadow'
                  : 'bg-surface border-outline text-on-surface hover:bg-surface-variant'
              }`}
              title="Interactive Policy Sandbox & What-If ODE Explorer"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="4" y1="21" x2="4" y2="14"></line>
                <line x1="4" y1="10" x2="4" y2="3"></line>
                <line x1="12" y1="21" x2="12" y2="12"></line>
                <line x1="12" y1="8" x2="12" y2="3"></line>
                <line x1="20" y1="21" x2="20" y2="16"></line>
                <line x1="20" y1="12" x2="20" y2="3"></line>
              </svg>
              <span>Policy Sandbox</span>
              <span className={`text-[9px] px-1 py-0.2 rounded font-mono font-bold ${
                isPlaygroundOpen ? 'bg-white/20 text-white' : 'bg-emerald-500/10 text-emerald-600'
              }`}>
                ODE
              </span>
            </button>

            {/* WHO Alerts Button */}
            <button
              onClick={() => setWhoModalOpen(true)}
              className="relative bg-surface rounded-lg border border-outline px-3 py-1.5 shadow-sm text-xs font-medium text-on-surface hover:bg-surface-variant transition-colors flex items-center gap-1.5 shrink-0 cursor-pointer"
            >
              🌐 WHO Alerts
              {whoAlerts.length > 0 && (
                <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-amber-500 rounded-full border border-surface shadow-sm"></span>
              )}
            </button>

            {/* New Scenario Button */}
            <button
              onClick={() => {
                setModalInitialTab('configure');
                setModalOpen(true);
              }}
              className="bg-surface rounded-lg border border-outline px-3 py-1.5 shadow-sm text-xs font-medium text-on-surface hover:bg-surface-variant transition-colors shrink-0 cursor-pointer"
            >
              New Scenario
            </button>

            {/* Export PDF */}
            <div className="relative shrink-0">
              <button
                onClick={() => setShowExportMenu(!showExportMenu)}
                className="bg-surface rounded-lg border border-outline px-3 py-1.5 shadow-sm text-xs font-medium text-on-surface hover:bg-surface-variant transition-colors cursor-pointer"
              >
                ↓ Export PDF
              </button>
              {showExportMenu && (
                <>
                  <div
                    className="fixed inset-0 z-[90]"
                    onClick={() => setShowExportMenu(false)}
                  />
                  <div className="absolute right-0 top-full mt-1.5 bg-surface border border-outline rounded-xl shadow-2xl z-[100] overflow-hidden min-w-[260px] whitespace-nowrap">
                    <button
                      onClick={() => handleExport('executive')}
                      className="block w-full text-left px-4 py-2.5 text-xs font-mono text-on-surface hover:bg-surface-container transition-colors cursor-pointer"
                    >
                      Executive Brief (1 page)
                    </button>
                    <button
                      onClick={() => handleExport('full')}
                      className="block w-full text-left px-4 py-2.5 text-xs font-mono text-on-surface hover:bg-surface-container border-t border-outline/40 transition-colors cursor-pointer"
                    >
                      Full Technical Report (4-5 pages)
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </header>

        {/* Main Content Area */}
        <div className="flex-1 overflow-hidden relative">
          <div className={`w-full h-full ${view === 'planner' ? 'block' : 'hidden'}`}>
            <PlannerView
              seirdData={seirdData || {}}
              cityData={cityData || {}}
              resourceData={resourceData || {}}
              resourceCityData={resourceCityData || {}}
              scenarioConfig={scenarioConfig}
              initialEdgeCuts={pendingEdgeCuts}
              isLoading={seirdLoading || cityLoading || resourceLoading}
              onRefresh={handleRefresh}
              onOpenSetup={(tab) => {
                setModalInitialTab(tab || 'configure');
                setModalOpen(true);
              }}
              onSelectScenario={(cfg) => handleSimulationComplete(cfg)}
              onOpenPolicyLevers={handleOpenPolicyLevers}
            />
          </div>

          <div className={`w-full h-full ${view === 'map' ? 'block' : 'hidden'}`}>
            {cityLoading ? (
              <div className="flex items-center justify-center h-full bg-background">
                <RippleLoader
                  message="Loading spatial mobility network..."
                  subMessage="Aggregating 15 national metro nodes and transit corridors"
                />
              </div>
            ) : (
              <BubbleMap
                cityData={cityData || {}}
                resourceData={resourceCityData || {}}
                activeIntervention={mapIntervention}
                simulationDay={mapDay}
                originCity={scenarioConfig?.originCity || 'KOCHI'}
                onDayChange={setMapDay}
                onInterventionChange={setMapIntervention}
                onHandoffToPlanner={(cuts) => {
                  setPendingEdgeCuts(cuts);
                  setView('planner');
                }}
                customInterventions={dynamicInterventions.filter(
                  i => !['none', 'rail_only', 'partial', 'full'].includes(i.key)
                )}
              />
            )}
          </div>

          <div className={`w-full h-full ${view === 'analyst' ? 'block' : 'hidden'}`}>
            <AnalystView
              seirdData={seirdData || {}}
              cityData={cityData || {}}
              resourceData={resourceData || {}}
              isLoading={seirdLoading || cityLoading || resourceLoading}
              onRefresh={handleRefresh}
              chartData={chartData}
              rtChartData={rtChartData}
              resourceChartData={resourceChartData}
              scenarioId={activeScenarioId}
              scenarioConfig={scenarioConfig}
              onOpenSetup={(tab) => {
                setModalInitialTab(tab || 'configure');
                setModalOpen(true);
              }}
              onSelectScenario={(cfg) => handleSimulationComplete(cfg)}
              onSignOut={handleSignOut}
            />
          </div>
        </div>
        <SetupModal
          isOpen={modalOpen}
          onClose={() => {
            setModalOpen(false);
            setSandboxHandoff(null);
          }}
          onSimulationComplete={handleSimulationComplete}
          isFirstRun={isFirstRun}
          previousConfig={scenarioConfig ?? undefined}
          sandboxHandoff={sandboxHandoff}
          initialTab={modalInitialTab}
        />
        <WHOAlertsModal
          isOpen={whoModalOpen}
          onClose={() => setWhoModalOpen(false)}
          alerts={whoAlerts}
          loading={whoLoading}
          onSimulate={(alert) => {
            setWhoModalOpen(false);
            window.dispatchEvent(new CustomEvent('open-setup', { detail: { origin: alert.country, disease: alert.title } }));
          }}
        />
        <ErisDrawer
          isOpen={isErisOpen}
          onClose={() => setIsErisOpen(false)}
          scenarioId={(scenarioConfig || (seirdData && Object.keys(seirdData).length > 0)) ? activeScenarioId : null}
        />
        <PlaygroundDrawer
          isOpen={isPlaygroundOpen}
          onClose={() => {
            setIsPlaygroundOpen(false);
            setPlaygroundMode('default');
            setPlannerLeversHandoff(null);
          }}
          mode={playgroundMode}
          initialVaccination={plannerLeversHandoff?.initialVaccination}
          initialFestivals={plannerLeversHandoff?.initialFestivals}
          onApplyPlannerLevers={(levers) => {
            if (plannerLeversHandoff?.onApply) {
              plannerLeversHandoff.onApply(levers);
            }
          }}
          onCommitToMonteCarlo={(params) => {
            setSandboxHandoff(params);
            setIsPlaygroundOpen(false);
            setModalOpen(true);
          }}
        />
      </div>
      <div id="print-root" style={{ display: 'none' }}>
        {reportType === 'executive' ? (
          <ExecutiveBrief
            scenarioConfig={scenarioConfig}
            summaryStats={nationalStats}
            resourceStats={resourceStats}
            dynamicInterventionKeys={dynamicInterventionKeys}
            interventionLabels={Object.fromEntries(
              dynamicInterventions.map(i => [i.key, i.label])
            )}
            interventionColors={Object.fromEntries(
              dynamicInterventions.map(i => [i.key, i.color])
            )}
          />
        ) : (
          <PrintLayout
            scenarioConfig={scenarioConfig}
            summaryStats={nationalStats}
            cityTableData={cityTableData}
            resourceStats={resourceStats}
            mlRecs={null}
            reportType="full"
            dynamicInterventionKeys={dynamicInterventionKeys}
            interventionLabels={Object.fromEntries(
              dynamicInterventions.map(i => [i.key, i.label])
            )}
            interventionColors={Object.fromEntries(
              dynamicInterventions.map(i => [i.key, i.color])
            )}
            chartData={chartData}
            rtChartData={rtChartData}
            resourceChartData={resourceChartData}
          />
        )}
      </div>
      <VoicePartnerDock />
    </VoiceAgentProvider>
  );
}

export default App;
