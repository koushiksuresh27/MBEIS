import { useState, useEffect, useMemo } from 'react';
import PrintLayout from './components/print/PrintLayout';
import AnalystView from './pages/AnalystView';
import PlannerView from './pages/PlannerView';
import BubbleMap from './components/analyst-view/BubbleMap';
import { useCityStatus } from './hooks/useCityStatus';
import { useResourceProjections } from './hooks/useResourceProjections';
import { useSeirdResults } from './hooks/useSeirdResults';
import SetupModal from './components/SetupModal';
import type { ScenarioConfig } from './types/scenario';

const SCENARIO_ID = 'bb0ff20e-b086-411b-8054-91560b1e88ec';

function App() {
  const [view, setView] = useState<'planner' | 'analyst' | 'map'>('analyst');
  const [isDark, setIsDark] = useState(false);
  const [mapDay, setMapDay] = useState(1);
  const [mapIntervention, setMapIntervention] = useState('none');

  const [modalOpen, setModalOpen] = useState(false);
  const [isFirstRun, setIsFirstRun] = useState(false);
  const [scenarioConfig, setScenarioConfig] = useState<ScenarioConfig | null>(null);
  const [reportType, setReportType] = useState<'summary' | 'full'>('summary');
  const [showExportMenu, setShowExportMenu] = useState(false);

  const handleSimulationComplete = (config: ScenarioConfig) => {
    setScenarioConfig(config);
    setIsFirstRun(false);
    setModalOpen(false);
    // Delay firing the event so Supabase has time to finish writing all rows
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('simulation-complete'));
    }, 2000);
  };

  const { data: seirdData, loading: seirdLoading } = useSeirdResults(SCENARIO_ID);
  const { data: cityData, loading: cityLoading } = useCityStatus(SCENARIO_ID);
  const { data: resourceData, cityData: resourceCityData, loading: resourceLoading } = useResourceProjections(SCENARIO_ID);

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

  useEffect(() => {
    if (isDark) {
      document.documentElement.setAttribute('data-theme', 'dark');
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
  }, [isDark]);

  const handleRefresh = () => {
    window.dispatchEvent(new CustomEvent('simulation-complete'));
  };

  const handleExport = (type: 'summary' | 'full') => {
    setShowExportMenu(false);
    setReportType(type);

    const dashRoot = document.getElementById('dashboard-root');
    const printRoot = document.getElementById('print-root');

    if (!printRoot || !dashRoot) {
      console.error('Could not find print-root or dashboard-root');
      return;
    }

    console.log('Before:', printRoot.style.display, dashRoot.style.display);

    dashRoot.style.setProperty('display', 'none', 'important');
    printRoot.style.setProperty('display', 'block', 'important');

    console.log('After:', printRoot.style.display, dashRoot.style.display);

    document.title = `OutbreakResponseOS_${type}_${new Date().toISOString().split('T')[0]}`;

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        window.onafterprint = () => {
          document.title = 'Outbreak Response OS';
          dashRoot.style.removeProperty('display');
          printRoot.style.setProperty('display', 'none', 'important');
          window.onafterprint = null;
        };
        window.print();
      });
    });
  };

  return (
    <>
      <div id="dashboard-root" className="flex flex-col h-screen bg-background overflow-hidden">
      {/* Global Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-outline bg-surface sticky top-0 z-10 shrink-0">
        <div className="flex flex-col">
          <h1 className="text-lg font-bold text-primary tracking-tight font-sans">Outbreak Response OS</h1>
          <p className="text-xs text-on-surface-variant font-mono">
            {scenarioConfig
              ? `${scenarioConfig.pathogenName} · ${scenarioConfig.originCity} · ${scenarioConfig.nIterations} iterations`
              : 'Configure a scenario to begin'}
          </p>
        </div>

        {/* View Mode Toggle */}
        <div className="flex items-center bg-surface-container rounded-lg p-1 border border-outline">
          <button
            onClick={() => setView('planner')}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${view === 'planner'
              ? 'bg-surface shadow-sm text-on-surface'
              : 'text-on-surface-variant opacity-60 hover:opacity-100 hover:bg-surface-variant'
              }`}
          >
            Planner View
          </button>
          <button
            onClick={() => setView('analyst')}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${view === 'analyst'
              ? 'bg-surface shadow-sm text-on-surface'
              : 'text-on-surface-variant opacity-60 hover:opacity-100 hover:bg-surface-variant'
              }`}
          >
            Analyst View
          </button>
          <button
            onClick={() => setView('map')}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${view === 'map'
              ? 'bg-surface shadow-sm text-on-surface'
              : 'text-on-surface-variant opacity-60 hover:opacity-100 hover:bg-surface-variant'
              }`}
          >
            Spread Map
          </button>
        </div>

        {/* Header Badges & Actions */}
        <div className="flex items-center gap-4">
          <button
            onClick={() => setIsDark(!isDark)}
            className="p-2 rounded-full text-on-surface-variant hover:bg-surface-variant hover:text-on-surface transition-colors"
            title="Toggle Dark Mode"
          >
            {isDark ? (
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>
            )}
          </button>

          <div className="flex items-center gap-2">
            {!isFirstRun && (
              <button
                onClick={() => setModalOpen(true)}
                className="bg-surface rounded-lg border border-outline px-3 py-1.5 shadow-sm text-xs font-medium text-on-surface hover:bg-surface-variant transition-colors"
              >
                New Scenario
              </button>
            )}

            <div className="relative">
              <button
                onClick={() => setShowExportMenu(!showExportMenu)}
                className="bg-surface rounded-lg border border-outline px-3 py-1.5 shadow-sm text-xs font-medium text-on-surface hover:bg-surface-variant transition-colors"
              >
                ↓ Export PDF
              </button>
              {showExportMenu && (
                <div className="absolute right-0 top-8 bg-surface border border-outline rounded-lg shadow-lg z-50 overflow-hidden w-52">
                  <button
                    onClick={() => handleExport('summary')}
                    className="block w-full text-left px-4 py-2.5 text-sm font-mono text-on-surface hover:bg-surface-variant"
                  >
                    Summary Report (2-3 pages)
                  </button>
                  <button
                    onClick={() => handleExport('full')}
                    className="block w-full text-left px-4 py-2.5 text-sm font-mono text-on-surface hover:bg-surface-variant border-t border-outline"
                  >
                    Full Technical Report (5-6 pages)
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <div className="flex-1 overflow-hidden relative">
        {view === 'planner' ? (
          <PlannerView seirdData={seirdData || {}} cityData={cityData || {}} resourceData={resourceData || {}} resourceCityData={resourceCityData || {}} scenarioConfig={scenarioConfig} onRefresh={handleRefresh} />
        ) : view === 'map' ? (
          <div className="w-full h-full">
            {cityLoading ? (
              <div className="flex items-center justify-center h-full font-mono text-on-surface-variant">
                Loading city data...
              </div>
            ) : (
              <BubbleMap
                cityData={cityData || {}}
                resourceData={resourceCityData || {}}
                activeIntervention={mapIntervention}
                simulationDay={mapDay}
                onDayChange={setMapDay}
                onInterventionChange={setMapIntervention}
                customInterventions={dynamicInterventions.filter(
                  i => !['none', 'rail_only', 'partial', 'full'].includes(i.key)
                )}
              />
            )}
          </div>
        ) : (
          <AnalystView
            seirdData={seirdData || {}}
            cityData={cityData || {}}
            resourceData={resourceData || {}}
            isLoading={seirdLoading || cityLoading || resourceLoading}
            onRefresh={handleRefresh}
          />
        )}
      </div>
      <SetupModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        onSimulationComplete={handleSimulationComplete}
        isFirstRun={isFirstRun}
        previousConfig={scenarioConfig ?? undefined}
      />
      </div>
      <div id="print-root" style={{ display: 'none' }}>
        <PrintLayout
          scenarioConfig={scenarioConfig}
          summaryStats={nationalStats}
          cityTableData={cityTableData}
          resourceStats={resourceStats}
          mlRecs={null}
          reportType={reportType}
        />
      </div>
    </>
  );
}

export default App;
