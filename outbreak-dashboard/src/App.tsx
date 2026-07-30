import { useState, useEffect } from 'react';
import AnalystView from './pages/AnalystView';
import PlannerView from './pages/PlannerView';
import BubbleMap from './components/analyst-view/BubbleMap';
import { useCityStatus } from './hooks/useCityStatus';
import SetupModal from './components/SetupModal';
import type { ScenarioConfig } from './types/scenario';

const SCENARIO_ID = 'bb0ff20e-b086-411b-8054-91560b1e88ec';

function App() {
  const [view, setView] = useState<'planner' | 'analyst' | 'map'>('analyst');
  const [isDark, setIsDark] = useState(false);
  const [mapDay, setMapDay] = useState(180);
  const [mapIntervention, setMapIntervention] = useState('none');

  const [modalOpen, setModalOpen] = useState(false);
  const [isFirstRun, setIsFirstRun] = useState(false);
  const [scenarioConfig, setScenarioConfig] = useState<ScenarioConfig | null>(null);

  const handleSimulationComplete = (config: ScenarioConfig) => {
    setScenarioConfig(config);
    setIsFirstRun(false);
    setModalOpen(false);
    window.dispatchEvent(new CustomEvent('simulation-complete'));
  };

  const { data: cityData, loading: cityLoading } = useCityStatus(SCENARIO_ID);

  useEffect(() => {
    if (isDark) {
      document.documentElement.setAttribute('data-theme', 'dark');
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
  }, [isDark]);

  return (
    <div className="flex flex-col h-screen bg-background overflow-hidden">
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
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
              view === 'planner' 
                ? 'bg-surface shadow-sm text-on-surface' 
                : 'text-on-surface-variant opacity-60 hover:opacity-100 hover:bg-surface-variant'
            }`}
          >
            Planner View
          </button>
          <button 
            onClick={() => setView('analyst')}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
              view === 'analyst' 
                ? 'bg-surface shadow-sm text-on-surface' 
                : 'text-on-surface-variant opacity-60 hover:opacity-100 hover:bg-surface-variant'
            }`}
          >
            Analyst View
          </button>
          <button 
            onClick={() => setView('map')}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
              view === 'map' 
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
            <div className="bg-tertiary-fixed rounded-lg border border-tertiary/20 px-3 py-1.5 shadow-sm text-xs font-medium text-on-tertiary-fixed">
              [ LLM Copilot — Kishore/Sujay ]
            </div>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <div className="flex-1 overflow-hidden relative">
        {view === 'planner' ? (
          <PlannerView />
        ) : view === 'map' ? (
          <div className="w-full h-full">
            {cityLoading ? (
              <div className="flex items-center justify-center h-full font-mono text-on-surface-variant">
                Loading city data...
              </div>
            ) : (
            <BubbleMap
              cityData={cityData || {}}
              activeIntervention={mapIntervention}
              simulationDay={mapDay}
              onDayChange={setMapDay}
              onInterventionChange={setMapIntervention}
            />
            )}
          </div>
        ) : (
          <AnalystView />
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
  );
}

export default App;
