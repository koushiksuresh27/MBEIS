import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import type { ScenarioConfig } from '../types/scenario';
import { saveNovelPathogenProfile, syncReferenceDiseaseProfile } from '../lib/pathogenProfileService';

interface SetupModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSimulationComplete: (config: ScenarioConfig) => void;
  isFirstRun: boolean;
  previousConfig?: ScenarioConfig;
  sandboxHandoff?: any;
  initialTab?: 'history' | 'configure';
}

const CITIES = [
  'DELHI', 'MUMBAI', 'KOLKATA', 'BENGALURU', 'CHENNAI',
  'HYDERABAD', 'AHMEDABAD', 'PUNE', 'LUCKNOW', 'KOCHI',
  'JAIPUR', 'PATNA', 'BHOPAL', 'VISAKHAPATNAM', 'GUWAHATI'
];

const CONFIDENCE_LEVELS = [
  { label: 'Quick (50)', value: 50 },
  { label: 'Standard (128)', value: 128 },
  { label: 'Full (500)', value: 500 }
];

const SCENARIO_ID = 'bb0ff20e-b086-411b-8054-91560b1e88ec';

export default function SetupModal({
  isOpen,
  onClose,
  onSimulationComplete,
  isFirstRun,
  previousConfig,
  sandboxHandoff,
  initialTab = 'configure'
}: SetupModalProps) {
  const [modalTab, setModalTab] = useState<'history' | 'configure'>(initialTab);
  const [recentScenarios, setRecentScenarios] = useState<any[]>([]);
  const [loadingHistory, setLoadingHistory] = useState<boolean>(false);
  const [deletingScenarioId, setDeletingScenarioId] = useState<string | null>(null);

  const [pathogens, setPathogens] = useState<any[]>([]);
  const [selectedPathogenId, setSelectedPathogenId] = useState<string | null>(null);
  const [selectedCity, setSelectedCity] = useState<string>('DELHI');
  const [selectedIterations, setSelectedIterations] = useState<number>(128);
  const [labelInput, setLabelInput] = useState<string>('');
  const [seedInfections, setSeedInfections] = useState<number>(500);
  const [kSensitivity, setKSensitivity] = useState<number>(35);
  
  const [isRunning, setIsRunning] = useState(false);
  const [logs, setLogs] = useState<{ time: string; prefix?: string; text: string; colorClass: string; isComplete?: boolean }[]>([]);
  
  // Custom Novel Pathogen Form State
  const [novelName, setNovelName] = useState<string>('Novel Strain (Disease X)');
  const [novelR0Mode, setNovelR0Mode] = useState<number>(2.8);
  const [novelR0Low, setNovelR0Low] = useState<number>(2.0);
  const [novelR0High, setNovelR0High] = useState<number>(4.0);

  const [novelCfrMode, setNovelCfrMode] = useState<number>(0.025);
  const [novelCfrLow, setNovelCfrLow] = useState<number>(0.015);
  const [novelCfrHigh, setNovelCfrHigh] = useState<number>(0.040);

  const [novelIncMode, setNovelIncMode] = useState<number>(5.0);
  const [novelIncLow, setNovelIncLow] = useState<number>(3.0);
  const [novelIncHigh, setNovelIncHigh] = useState<number>(8.0);

  const [novelInfMode, setNovelInfMode] = useState<number>(7.0);
  const [novelInfLow, setNovelInfLow] = useState<number>(5.0);
  const [novelInfHigh, setNovelInfHigh] = useState<number>(10.0);
  
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      if (initialTab) {
        setModalTab(initialTab);
      }

      const fetchRecent = async () => {
        try {
          setLoadingHistory(true);
          const { data } = await supabase
            .from('scenarios')
            .select('scenario_id, origin_city, pathogen_description, created_at')
            .order('created_at', { ascending: false })
            .limit(5);

          if (data) {
            setRecentScenarios(data);
          }
        } catch (e) {
          console.error('Failed to load recent scenarios:', e);
        } finally {
          setLoadingHistory(false);
        }
      };

      fetchRecent();

      if (sandboxHandoff) {
        setSelectedPathogenId('novel');
        setNovelName(sandboxHandoff.presetName || 'Policy Sandbox Variant');
        if (sandboxHandoff.r0) {
          const r0 = sandboxHandoff.r0;
          setNovelR0Mode(r0);
          setNovelR0Low(Number(Math.max(0.2, r0 * 0.75).toFixed(2)));
          setNovelR0High(Number((r0 * 1.35).toFixed(2)));
        }
        if (sandboxHandoff.cfr) {
          const cfr = sandboxHandoff.cfr;
          setNovelCfrMode(cfr);
          setNovelCfrLow(Number(Math.max(0.0001, cfr * 0.75).toFixed(4)));
          setNovelCfrHigh(Number((cfr * 1.35).toFixed(4)));
        }
        if (sandboxHandoff.incubationDays) {
          const inc = sandboxHandoff.incubationDays;
          setNovelIncMode(inc);
          setNovelIncLow(Number(Math.max(1, inc - 2).toFixed(1)));
          setNovelIncHigh(Number((inc + 3).toFixed(1)));
        }
        if (sandboxHandoff.originCity) setSelectedCity(sandboxHandoff.originCity);
        if (sandboxHandoff.seedInfections) setSeedInfections(sandboxHandoff.seedInfections);
        if (sandboxHandoff.kSensitivity) setKSensitivity(sandboxHandoff.kSensitivity);
        setLabelInput(sandboxHandoff.presetName || 'Sandbox Benchmark');
      } else if (previousConfig) {
        setSelectedCity(previousConfig.originCity);
        setSelectedIterations(previousConfig.nIterations);
        setLabelInput(previousConfig.scenarioLabel);
        if (previousConfig.seedInfections) setSeedInfections(previousConfig.seedInfections);
        if (previousConfig.kSensitivity) setKSensitivity(previousConfig.kSensitivity);
      }
      setIsRunning(false);
      setLogs([]);
      
      const fetchPathogens = async () => {
        const { data } = await supabase
          .from('reference_diseases')
          .select('reference_disease_id, name, r0_low, r0_high, r0_most_likely, cfr_low, cfr_high, cfr_most_likely, incubation_days_low, incubation_days_high, incubation_days_most_likely')
          .order('name');

        // Retry once if the result comes back empty (race with DB connection)
        const finalData = (!data || data.length === 0)
          ? await new Promise<typeof data>(resolve =>
              setTimeout(async () => {
                const { data: retryData } = await supabase
                  .from('reference_diseases')
                  .select('reference_disease_id, name, r0_low, r0_high, r0_most_likely, cfr_low, cfr_high, cfr_most_likely, incubation_days_low, incubation_days_high, incubation_days_most_likely')
                  .order('name');
                resolve(retryData);
              }, 1500)
            )
          : data;

        if (finalData) {
          setPathogens(finalData);
          if (previousConfig && previousConfig.pathogenName) {
            const searchName = previousConfig.pathogenName.toLowerCase();
            const match = finalData.find((p: any) => 
              p.name.toLowerCase().includes(searchName) || 
              searchName.includes(p.name.toLowerCase())
            );
            if (match) setSelectedPathogenId(match.reference_disease_id);
          }
        }
      };
      fetchPathogens();
    }
  }, [isOpen, previousConfig, sandboxHandoff]);

  useEffect(() => {
    if (logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs]);

  if (!isOpen) return null;

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget && !isFirstRun) {
      onClose();
    }
  };

  const selectedPathogen = pathogens.find(p => p.reference_disease_id === selectedPathogenId);
  const isNovelSelected = selectedPathogenId === 'novel';

  const isTriangularValid = 
    novelR0Low <= novelR0Mode && novelR0Mode <= novelR0High &&
    novelCfrLow <= novelCfrMode && novelCfrMode <= novelCfrHigh &&
    novelIncLow <= novelIncMode && novelIncMode <= novelIncHigh;

  const canRun = isNovelSelected 
    ? (novelName.trim().length > 0 && isTriangularValid) 
    : (selectedPathogenId !== null && selectedPathogen !== undefined);

  const applyArchetype = (type: 'zoonotic' | 'respiratory' | 'rapid') => {
    if (type === 'zoonotic') {
      setNovelName('High-Fatality Zoonotic Spillover');
      setNovelR0Mode(1.4); setNovelR0Low(1.1); setNovelR0High(1.9);
      setNovelCfrMode(0.35); setNovelCfrLow(0.25); setNovelCfrHigh(0.45);
      setNovelIncMode(12.0); setNovelIncLow(8.0); setNovelIncHigh(16.0);
      setNovelInfMode(9.0); setNovelInfLow(6.0); setNovelInfHigh(12.0);
    } else if (type === 'respiratory') {
      setNovelName('High-Virulence Respiratory Strain');
      setNovelR0Mode(3.8); setNovelR0Low(2.8); setNovelR0High(4.8);
      setNovelCfrMode(0.035); setNovelCfrLow(0.02); setNovelCfrHigh(0.05);
      setNovelIncMode(4.5); setNovelIncLow(3.0); setNovelIncHigh(6.5);
      setNovelInfMode(7.5); setNovelInfLow(5.0); setNovelInfHigh(10.0);
    } else if (type === 'rapid') {
      setNovelName('Ultra-Transmissible Variant');
      setNovelR0Mode(7.5); setNovelR0Low(5.0); setNovelR0High(10.0);
      setNovelCfrMode(0.003); setNovelCfrLow(0.001); setNovelCfrHigh(0.006);
      setNovelIncMode(3.0); setNovelIncLow(2.0); setNovelIncHigh(4.5);
      setNovelInfMode(6.0); setNovelInfLow(4.0); setNovelInfHigh(8.0);
    }
  };

  const handleRun = async () => {
    if (!canRun) return;
    
    setIsRunning(true);
    setLogs([]);
    
    try {
      // Phase 1: Dynamic scenario isolation per simulation run
      const activeScenarioId = crypto.randomUUID();
      const finalName = isNovelSelected ? novelName : (selectedPathogen?.name || 'Simulation Scenario');

      // Register new unique scenario row in Supabase
      const { error: scenErr } = await supabase.from('scenarios').insert({
        scenario_id: activeScenarioId,
        origin_city: selectedCity,
        start_date: new Date().toISOString().split('T')[0],
        reference_disease_id: isNovelSelected ? null : selectedPathogen?.reference_disease_id,
        pathogen_description: finalName,
        simulation_window_days: 180,
      });

      if (scenErr) {
        throw new Error(`Failed to initialize scenario: ${scenErr.message}`);
      }

      // 1. Sync or write pathogen profile to Supabase
      if (isNovelSelected) {
        setLogs(prev => [...prev, {
          time: new Date().toLocaleTimeString([], { hour12: false }),
          prefix: '[PROFILE]',
          text: `Writing versioned profile for "${novelName}" (R0: ${novelR0Low}-${novelR0Mode}-${novelR0High}, CFR: ${(novelCfrMode*100).toFixed(1)}%)...`,
          colorClass: 'text-primary font-semibold'
        }]);

        const saveRes = await saveNovelPathogenProfile(activeScenarioId, {
          name: novelName,
          r0: { low: novelR0Low, most_likely: novelR0Mode, high: novelR0High },
          cfr: { low: novelCfrLow, most_likely: novelCfrMode, high: novelCfrHigh },
          incubation: { low: novelIncLow, most_likely: novelIncMode, high: novelIncHigh },
          infectious: { low: novelInfLow, most_likely: novelInfMode, high: novelInfHigh },
        });

        if (!saveRes.success) {
          throw new Error(`Failed to save novel pathogen profile: ${saveRes.error}`);
        }
      } else if (selectedPathogen) {
        const syncRes = await syncReferenceDiseaseProfile(activeScenarioId, selectedPathogen);
        if (!syncRes.success) {
          throw new Error(`Failed to initialize pathogen profile: ${syncRes.error}`);
        }
      }

      const backendBase = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000';
      const response = await fetch(`${backendBase}/api/v1/simulate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scenario_id: activeScenarioId,
          origin_city: selectedCity,
          n_iterations: selectedIterations,
          seed_infections: seedInfections,
          k_sensitivity: kSensitivity,
          ...(sandboxHandoff?.vaccination ? { vaccination: sandboxHandoff.vaccination } : {}),
          ...(sandboxHandoff?.festivals ? { festivals: sandboxHandoff.festivals } : {}),
          ...(sandboxHandoff?.quarantinedCities ? { quarantined_cities: sandboxHandoff.quarantinedCities } : {}),
        })
      });

      if (!response.body) throw new Error('No response body');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let done = false;

      while (!done) {
        const { value, done: readerDone } = await reader.read();
        done = readerDone;
        if (value) {
          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split('\n');
          
          lines.forEach(line => {
            if (line.startsWith('data: ')) {
              const jsonStr = line.substring(6).trim();
              if (!jsonStr) return;
              try {
                const data = JSON.parse(jsonStr);
                const timeStr = new Date().toLocaleTimeString([], { hour12: false });
                let colorClass = 'text-slate-200';
                let formattedMsg = data.message;
                if (!formattedMsg) return;

                const lowerMsg = formattedMsg.toLowerCase();
                if (lowerMsg.includes('no cached results') || lowerMsg.includes('rows for') || lowerMsg.includes('rows added') || (lowerMsg.includes('inserted') && lowerMsg.includes('rows'))) {
                  return;
                }

                let isComplete = false;
                let prefix = '';
                
                if (data.type === 'progress') {
                  if (formattedMsg.startsWith('[QUEUE]')) {
                    prefix = '[QUEUE]';
                    formattedMsg = formattedMsg.replace('[QUEUE]', '').trim();
                    colorClass = 'text-amber-400 font-semibold';
                  } else if (formattedMsg.includes('intervention=none')) {
                    prefix = '[BASE]';
                  } else if (formattedMsg.includes('intervention=rail_only')) {
                    prefix = '[HALT]';
                  } else if (formattedMsg.includes('intervention=partial')) {
                    prefix = '[PART]';
                  } else if (formattedMsg.includes('intervention=full')) {
                    prefix = '[FULL]';
                  } else if (formattedMsg.includes('written')) {
                    colorClass = 'text-primary font-semibold';
                  }
                } else if (data.type === 'complete') {
                  prefix = '[DONE]';
                  colorClass = 'text-green-500 font-bold';
                  isComplete = true;
                } else if (data.type === 'error') {
                  prefix = '[ERR]';
                  colorClass = 'text-red-500 font-bold';
                }
                
                setLogs(prev => [...prev, { time: timeStr, prefix, text: formattedMsg, colorClass, isComplete }]);
                
                if (data.type === 'complete') {
                  setTimeout(() => {
                    onSimulationComplete({
                      scenarioId: activeScenarioId,
                      originCity: selectedCity,
                      nIterations: selectedIterations,
                      scenarioLabel: labelInput || `${finalName} · ${selectedCity}`,
                      pathogenName: finalName || 'Custom Strain',
                      seedInfections,
                      kSensitivity,
                    });
                  }, 1200);
                } else if (data.type === 'error') {
                  setIsRunning(false);
                }
              } catch (e) {
                console.error("Error parsing SSE JSON", e);
              }
            }
          });
        }
      }
    } catch (error: any) {
      setLogs(prev => [...prev, { 
        time: new Date().toLocaleTimeString([], { hour12: false }), 
        prefix: '[ERR]',
        text: `Connection Error: ${error.message}`, 
        colorClass: 'text-red-500 font-bold' 
      }]);
      setIsRunning(false);
    }
  };

  const handleSelectStoredScenario = (scen: any) => {
    onSimulationComplete({
      scenarioId: scen.scenario_id,
      originCity: scen.origin_city || 'DELHI',
      nIterations: 128,
      scenarioLabel: `${scen.pathogen_description || 'Simulation'} · ${scen.origin_city || 'DELHI'}`,
      pathogenName: scen.pathogen_description || 'Simulation Strain',
      seedInfections: 500,
      kSensitivity: 35,
    });
    onClose();
  };

  const handleDeleteStoredScenario = async (scenarioId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (deletingScenarioId) return;

    try {
      setDeletingScenarioId(scenarioId);

      // 1. Call backend delete endpoint
      try {
        await fetch(`${import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000'}/api/v1/scenarios/${scenarioId}`, {
          method: 'DELETE',
        });
      } catch (backendErr) {
        console.warn('Backend delete notice:', backendErr);
      }

      // 2. Also ensure Supabase delete runs directly on frontend tables
      for (const table of ['resource_projections', 'lockdown_recommendations', 'city_status', 'seird_results', 'pathogen_profiles', 'scenarios']) {
        try {
          await supabase.from(table).delete().eq('scenario_id', scenarioId);
        } catch (_) {}
      }

      // 3. Update local list immediately
      setRecentScenarios(prev => prev.filter(s => s.scenario_id !== scenarioId));
    } catch (err) {
      console.error('Failed to delete scenario run:', err);
    } finally {
      setDeletingScenarioId(null);
    }
  };


  return (
    <div 
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={handleOverlayClick}
    >
      <div className="bg-surface max-w-2xl w-full rounded-2xl border border-outline shadow-2xl overflow-hidden flex flex-col text-on-surface max-h-[90vh]">
        {/* SECTION 1 - Header with Tabs directly next to Simulation Hub */}
        <div className="flex justify-between items-start p-6 border-b border-outline shrink-0 gap-4">
          <div>
            <div className="flex items-center gap-3.5 flex-wrap">
              <h2 className="text-xl font-semibold font-heading">Simulation Hub</h2>

              {!isRunning && (
                <div className="flex items-center gap-1.5 bg-surface-variant/40 p-1 rounded-xl border border-outline/50">
                  <button
                    type="button"
                    onClick={() => setModalTab('history')}
                    className={`px-3 py-1 rounded-lg text-xs font-mono font-medium transition-all flex items-center gap-1.5 cursor-pointer ${
                      modalTab === 'history'
                        ? 'bg-primary text-on-primary shadow-xs font-semibold'
                        : 'text-on-surface-variant hover:text-on-surface'
                    }`}
                  >
                    <span>Stored Scenarios</span>
                    {recentScenarios.length > 0 && (
                      <span className={`px-1.5 py-0.2 rounded-full text-[10px] ${
                        modalTab === 'history' ? 'bg-white/20 text-white' : 'bg-primary/10 text-primary font-bold'
                      }`}>
                        {recentScenarios.length}
                      </span>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => setModalTab('configure')}
                    className={`px-3 py-1 rounded-lg text-xs font-mono font-medium transition-all cursor-pointer ${
                      modalTab === 'configure'
                        ? 'bg-primary text-on-primary shadow-xs font-semibold'
                        : 'text-on-surface-variant hover:text-on-surface'
                    }`}
                  >
                    <span>Configure New Run</span>
                  </button>
                </div>
              )}
            </div>
            <p className="text-xs text-on-surface-variant mt-1.5">Switch active scenario run or configure a new simulation</p>
          </div>

          {!isFirstRun && (
            <button onClick={onClose} className="text-on-surface-variant hover:text-on-surface transition-colors p-1 cursor-pointer">
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>
          )}
        </div>

        <div className="p-6 overflow-y-auto flex-1">
          {modalTab === 'history' && !isRunning ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono uppercase tracking-wider text-on-surface-variant opacity-80 font-bold">
                  RECENT RUNS
                </span>
              </div>

              {loadingHistory ? (
                <div className="py-12 flex flex-col items-center justify-center gap-3">
                  <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin"></div>
                  <span className="text-xs font-mono text-on-surface-variant">Loading stored runs...</span>
                </div>
              ) : recentScenarios.length === 0 ? (
                <div className="py-12 text-center text-on-surface-variant font-mono text-xs">
                  No stored runs found in Supabase. Configure a run to start!
                </div>
              ) : (
                <div className="space-y-2.5">
                  {recentScenarios.map((scen, idx) => {
                    const isActive = previousConfig?.scenarioId === scen.scenario_id;
                    const dateStr = scen.created_at ? new Date(scen.created_at).toLocaleString() : 'Recent';
                    return (
                      <div
                        key={scen.scenario_id}
                        className={`p-4 rounded-xl border transition-all flex items-center justify-between gap-4 ${
                          isActive
                            ? 'bg-primary/5 border-primary shadow-sm'
                            : 'bg-surface-variant/40 border-outline hover:border-outline/80'
                        }`}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-semibold text-sm text-on-surface truncate">
                              {scen.pathogen_description || 'Simulation Run'}
                            </span>
                            {isActive && (
                              <span className="text-[10px] px-2 py-0.5 rounded font-mono font-bold bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">
                                ACTIVE RUN
                              </span>
                            )}
                            {idx === 0 && !isActive && (
                              <span className="text-[10px] px-2 py-0.5 rounded font-mono font-semibold bg-primary/10 text-primary">
                                LATEST
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-3 text-xs font-mono text-on-surface-variant">
                            <span>Origin: <strong className="text-on-surface">{scen.origin_city || 'DELHI'}</strong></span>
                            <span>•</span>
                            <span>{dateStr}</span>
                            <span>•</span>
                            <span className="opacity-60">{scen.scenario_id.slice(0, 8)}...</span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={() => handleSelectStoredScenario(scen)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-mono font-medium transition-colors shrink-0 ${
                              isActive
                                ? 'bg-surface border border-outline text-on-surface cursor-default opacity-80'
                                : 'bg-primary text-on-primary hover:bg-primary/90'
                            }`}
                          >
                            {isActive ? 'Current' : 'Load Run →'}
                          </button>
                          <button
                            type="button"
                            onClick={(e) => handleDeleteStoredScenario(scen.scenario_id, e)}
                            disabled={deletingScenarioId === scen.scenario_id}
                            className="p-1.5 rounded-lg border border-transparent hover:border-red-500/30 hover:bg-red-500/10 text-on-surface-variant hover:text-red-500 transition-colors cursor-pointer disabled:opacity-40"
                            title="Delete this scenario run"
                          >
                            {deletingScenarioId === scen.scenario_id ? (
                              <div className="w-3.5 h-3.5 border-2 border-red-500 border-t-transparent rounded-full animate-spin" />
                            ) : (
                              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M3 6h18" /><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" /><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                              </svg>
                            )}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : !isRunning ? (
            <div className="space-y-8">
              {/* Policy Sandbox Configuration Banner */}
              {sandboxHandoff && (sandboxHandoff.vaccination?.enabled || (sandboxHandoff.festivals && sandboxHandoff.festivals.length > 0) || (sandboxHandoff.quarantinedCities && sandboxHandoff.quarantinedCities.length > 0)) && (
                <div className="p-3.5 rounded-xl bg-primary/5 border border-primary/20 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-primary inline-block"></span>
                    <span className="text-xs font-semibold text-primary">Policy Sandbox Active</span>
                  </div>
                  <div className="flex flex-wrap gap-2 pt-0.5 font-mono text-[11px]">
                    {sandboxHandoff.vaccination?.enabled && (
                      <span className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">
                        Vaccination: {(sandboxHandoff.vaccination.efficacy * 100).toFixed(0)}% efficacy, {(sandboxHandoff.vaccination.dailyRate * 100).toFixed(1)}%/day
                      </span>
                    )}
                    {sandboxHandoff.festivals && sandboxHandoff.festivals.length > 0 && (
                      <span className="px-2 py-0.5 rounded bg-amber-500/10 text-amber-600 border border-amber-500/20">
                        Gathering: {sandboxHandoff.festivals[0].name} ({sandboxHandoff.festivals[0].crowdMult}x, Day {sandboxHandoff.festivals[0].startDay}–{sandboxHandoff.festivals[0].endDay})
                      </span>
                    )}
                    {sandboxHandoff.quarantinedCities && sandboxHandoff.quarantinedCities.length > 0 && (
                      <span className="px-2 py-0.5 rounded bg-purple-500/10 text-purple-600 border border-purple-500/20">
                        Cordon: {sandboxHandoff.quarantinedCities.join(', ')}
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* SECTION 2 - Pathogen Selection */}
              <div>
                <label className="block text-xs font-mono uppercase tracking-wider text-on-surface-variant opacity-80 mb-3">
                  Select Pathogen
                </label>
                <div className="flex flex-col gap-3">
                  {pathogens.map(p => (
                    <div 
                      key={p.reference_disease_id}
                      onClick={() => setSelectedPathogenId(p.reference_disease_id)}
                      className={`cursor-pointer border rounded-xl p-4 flex justify-between items-center transition-all ${
                        selectedPathogenId === p.reference_disease_id 
                          ? 'border-primary bg-surface-variant shadow-sm' 
                          : 'border-outline hover:border-outline/80 bg-transparent'
                      }`}
                    >
                      <div>
                        <div className="font-medium font-sans mb-1">{p.name}</div>
                        <div className="text-xs font-mono text-on-surface-variant opacity-80">
                          R0: {p.r0_most_likely != null ? Number(p.r0_most_likely).toFixed(2) : (p.r0_low != null ? `${p.r0_low}-${p.r0_high}` : '—')} · CFR: {p.cfr_most_likely != null ? (Number(p.cfr_most_likely) * 100).toFixed(1) : (p.cfr_low != null ? (Number(p.cfr_low) * 100).toFixed(1) : '—')}% · Incubation: {p.incubation_days_most_likely ?? p.incubation_days_low ?? '—'} days
                        </div>
                      </div>
                      <div className={`w-5 h-5 rounded-full border flex items-center justify-center shrink-0 ${
                        selectedPathogenId === p.reference_disease_id ? 'border-primary bg-primary text-on-primary' : 'border-outline'
                      }`}>
                        {selectedPathogenId === p.reference_disease_id && (
                          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                        )}
                      </div>
                    </div>
                  ))}
                  
                  {/* Novel Pathogen Card */}
                  <div 
                    onClick={() => setSelectedPathogenId('novel')}
                    className={`cursor-pointer border rounded-xl p-4 flex flex-col gap-3 transition-all ${
                      isNovelSelected 
                        ? 'border-primary bg-surface-variant shadow-sm' 
                        : 'border-outline hover:border-outline/80 bg-transparent'
                    }`}
                  >
                    <div className="flex justify-between items-center">
                      <div>
                        <div className="font-medium font-sans mb-1 flex items-center gap-2">
                          <span>Novel / Emerging Pathogen</span>
                          <span className="text-[10px] px-2 py-0.5 rounded bg-primary/10 text-primary font-mono font-semibold">
                            Triangular Bounds
                          </span>
                        </div>
                        <div className="text-xs font-mono text-on-surface-variant opacity-80">
                          Custom empirical parameterization with low / mode / high intervals
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className={`w-5 h-5 rounded-full border flex items-center justify-center shrink-0 ${
                          isNovelSelected ? 'border-primary bg-primary text-on-primary' : 'border-outline'
                        }`}>
                          {isNovelSelected && (
                            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                          )}
                        </div>
                      </div>
                    </div>

                    {isNovelSelected && (
                      <div className="space-y-4 pt-2 border-t border-outline/50" onClick={(e) => e.stopPropagation()}>
                        {/* Name Input */}
                        <div>
                          <label className="block text-xs font-semibold text-on-surface mb-1">
                            Pathogen Designation / Strain Identity
                          </label>
                          <input
                            type="text"
                            value={novelName}
                            onChange={(e) => setNovelName(e.target.value)}
                            placeholder="e.g. H5N1 Clade 2.3.4.4b, Nipah Variant-X, Pathogen-X"
                            className="w-full bg-surface border border-outline rounded-lg px-3 py-2 text-sm text-on-surface focus:outline-none focus:border-primary"
                          />
                        </div>

                        {/* Quick Biological Archetype Pills */}
                        <div>
                          <label className="block text-[11px] font-semibold text-on-surface-variant uppercase tracking-wider mb-1.5">
                            Standard Empirical Archetypes
                          </label>
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => applyArchetype('respiratory')}
                              className="px-2.5 py-1 rounded-lg border border-outline bg-surface text-xs text-on-surface hover:border-primary font-medium transition-colors"
                            >
                              Respiratory Surge (R₀ 3.8 · CFR 3.5%)
                            </button>
                            <button
                              type="button"
                              onClick={() => applyArchetype('zoonotic')}
                              className="px-2.5 py-1 rounded-lg border border-outline bg-surface text-xs text-on-surface hover:border-primary font-medium transition-colors"
                            >
                              Zoonotic Spillover (R₀ 1.4 · CFR 35%)
                            </button>
                            <button
                              type="button"
                              onClick={() => applyArchetype('rapid')}
                              className="px-2.5 py-1 rounded-lg border border-outline bg-surface text-xs text-on-surface hover:border-primary font-medium transition-colors"
                            >
                              Ultra-Transmissible (R₀ 7.5 · CFR 0.3%)
                            </button>
                          </div>
                        </div>

                        {/* Triangular R0 */}
                        <div className="bg-surface p-3 rounded-lg border border-outline space-y-2">
                          <div className="flex justify-between items-center text-xs">
                            <span className="font-semibold text-on-surface">Basic Reproduction Number (R₀)</span>
                            <span className="font-mono text-primary font-bold">
                              Triang({novelR0Low.toFixed(1)} ── {novelR0Mode.toFixed(1)} ── {novelR0High.toFixed(1)})
                            </span>
                          </div>
                          <input
                            type="range"
                            min="0.5"
                            max="12.0"
                            step="0.1"
                            value={novelR0Mode}
                            onChange={(e) => {
                              const mode = parseFloat(e.target.value);
                              setNovelR0Mode(mode);
                              setNovelR0Low(Number(Math.max(0.2, mode * 0.75).toFixed(2)));
                              setNovelR0High(Number((mode * 1.35).toFixed(2)));
                            }}
                            className="w-full accent-primary"
                          />
                          <div className="grid grid-cols-3 gap-2 text-xs">
                            <div>
                              <span className="text-[10px] text-on-surface-variant block">Low bound</span>
                              <input
                                type="number"
                                step="0.1"
                                value={novelR0Low}
                                onChange={(e) => setNovelR0Low(parseFloat(e.target.value) || 0.2)}
                                className="w-full bg-background border border-outline rounded px-2 py-1 font-mono text-xs text-on-surface"
                              />
                            </div>
                            <div>
                              <span className="text-[10px] text-on-surface-variant block">Most Likely</span>
                              <input
                                type="number"
                                step="0.1"
                                value={novelR0Mode}
                                onChange={(e) => setNovelR0Mode(parseFloat(e.target.value) || 0.5)}
                                className="w-full bg-background border border-outline rounded px-2 py-1 font-mono text-xs text-on-surface font-bold text-primary"
                              />
                            </div>
                            <div>
                              <span className="text-[10px] text-on-surface-variant block">High bound</span>
                              <input
                                type="number"
                                step="0.1"
                                value={novelR0High}
                                onChange={(e) => setNovelR0High(parseFloat(e.target.value) || 1.0)}
                                className="w-full bg-background border border-outline rounded px-2 py-1 font-mono text-xs text-on-surface"
                              />
                            </div>
                          </div>
                        </div>

                        {/* Triangular CFR */}
                        <div className="bg-surface p-3 rounded-lg border border-outline space-y-2">
                          <div className="flex justify-between items-center text-xs">
                            <span className="font-semibold text-on-surface">Case Fatality Rate (CFR %)</span>
                            <span className="font-mono text-rose-600 font-bold">
                              Triang({(novelCfrLow * 100).toFixed(1)}% ── {(novelCfrMode * 100).toFixed(1)}% ── {(novelCfrHigh * 100).toFixed(1)}%)
                            </span>
                          </div>
                          <input
                            type="range"
                            min="0.001"
                            max="0.45"
                            step="0.005"
                            value={novelCfrMode}
                            onChange={(e) => {
                              const mode = parseFloat(e.target.value);
                              setNovelCfrMode(mode);
                              setNovelCfrLow(Number(Math.max(0.0001, mode * 0.75).toFixed(4)));
                              setNovelCfrHigh(Number((mode * 1.35).toFixed(4)));
                            }}
                            className="w-full accent-rose-600"
                          />
                          <div className="grid grid-cols-3 gap-2 text-xs">
                            <div>
                              <span className="text-[10px] text-on-surface-variant block">Low CFR %</span>
                              <input
                                type="number"
                                step="0.1"
                                value={Number((novelCfrLow * 100).toFixed(2))}
                                onChange={(e) => setNovelCfrLow((parseFloat(e.target.value) || 0.1) / 100)}
                                className="w-full bg-background border border-outline rounded px-2 py-1 font-mono text-xs text-on-surface"
                              />
                            </div>
                            <div>
                              <span className="text-[10px] text-on-surface-variant block">Mode CFR %</span>
                              <input
                                type="number"
                                step="0.1"
                                value={Number((novelCfrMode * 100).toFixed(2))}
                                onChange={(e) => setNovelCfrMode((parseFloat(e.target.value) || 0.1) / 100)}
                                className="w-full bg-background border border-outline rounded px-2 py-1 font-mono text-xs text-on-surface font-bold text-rose-600"
                              />
                            </div>
                            <div>
                              <span className="text-[10px] text-on-surface-variant block">High CFR %</span>
                              <input
                                type="number"
                                step="0.1"
                                value={Number((novelCfrHigh * 100).toFixed(2))}
                                onChange={(e) => setNovelCfrHigh((parseFloat(e.target.value) || 0.2) / 100)}
                                className="w-full bg-background border border-outline rounded px-2 py-1 font-mono text-xs text-on-surface"
                              />
                            </div>
                          </div>
                        </div>

                        {/* Incubation and Infectious Triplet Inputs */}
                        <div className="grid grid-cols-2 gap-3 text-xs">
                          <div className="bg-surface p-2.5 rounded-lg border border-outline">
                            <span className="font-semibold text-on-surface block mb-1">Incubation (Days)</span>
                            <div className="flex gap-1.5 font-mono text-[11px]">
                              <input
                                type="number"
                                step="0.5"
                                value={novelIncLow}
                                onChange={(e) => setNovelIncLow(parseFloat(e.target.value) || 1)}
                                className="w-1/3 bg-background border border-outline rounded px-1.5 py-1 text-center"
                                title="Low bound"
                              />
                              <input
                                type="number"
                                step="0.5"
                                value={novelIncMode}
                                onChange={(e) => setNovelIncMode(parseFloat(e.target.value) || 2)}
                                className="w-1/3 bg-background border border-outline rounded px-1.5 py-1 text-center font-bold text-primary"
                                title="Mode"
                              />
                              <input
                                type="number"
                                step="0.5"
                                value={novelIncHigh}
                                onChange={(e) => setNovelIncHigh(parseFloat(e.target.value) || 3)}
                                className="w-1/3 bg-background border border-outline rounded px-1.5 py-1 text-center"
                                title="High bound"
                              />
                            </div>
                          </div>

                          <div className="bg-surface p-2.5 rounded-lg border border-outline">
                            <span className="font-semibold text-on-surface block mb-1">Infectious (Days)</span>
                            <div className="flex gap-1.5 font-mono text-[11px]">
                              <input
                                type="number"
                                step="0.5"
                                value={novelInfLow}
                                onChange={(e) => setNovelInfLow(parseFloat(e.target.value) || 2)}
                                className="w-1/3 bg-background border border-outline rounded px-1.5 py-1 text-center"
                                title="Low bound"
                              />
                              <input
                                type="number"
                                step="0.5"
                                value={novelInfMode}
                                onChange={(e) => setNovelInfMode(parseFloat(e.target.value) || 3)}
                                className="w-1/3 bg-background border border-outline rounded px-1.5 py-1 text-center font-bold text-primary"
                                title="Mode"
                              />
                              <input
                                type="number"
                                step="0.5"
                                value={novelInfHigh}
                                onChange={(e) => setNovelInfHigh(parseFloat(e.target.value) || 4)}
                                className="w-1/3 bg-background border border-outline rounded px-1.5 py-1 text-center"
                                title="High bound"
                              />
                            </div>
                          </div>
                        </div>

                        {!isTriangularValid && (
                          <div className="text-xs text-rose-600 bg-rose-500/10 border border-rose-500/20 p-2 rounded-lg font-mono">
                            Invariant violation: Each parameter must strictly follow Low ≤ Most Likely ≤ High.
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* SECTION 3 - Scenario Configuration */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-mono uppercase tracking-wider text-on-surface-variant opacity-80 mb-2">
                    Origin City
                  </label>
                  <select 
                    value={selectedCity}
                    onChange={(e) => setSelectedCity(e.target.value)}
                    className="w-full bg-surface-variant border border-outline rounded-lg px-4 py-2.5 text-sm font-sans text-on-surface focus:outline-none focus:border-primary appearance-none cursor-pointer"
                  >
                    {CITIES.map(city => (
                      <option key={city} value={city}>{city}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-mono uppercase tracking-wider text-on-surface-variant opacity-80 mb-2">
                    Confidence
                  </label>
                  <div className="flex bg-surface-variant rounded-lg p-1 border border-outline">
                    {CONFIDENCE_LEVELS.map(level => (
                      <button
                        key={level.value}
                        onClick={() => setSelectedIterations(level.value)}
                        className={`flex-1 px-2 py-1.5 rounded-md text-[11px] font-medium transition-colors ${
                          selectedIterations === level.value
                            ? 'bg-primary text-on-primary shadow-sm'
                            : 'text-on-surface-variant hover:text-on-surface'
                        }`}
                      >
                        {level.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-mono uppercase tracking-wider text-on-surface-variant opacity-80 mb-2">
                    Scenario Label (optional)
                  </label>
                  <input 
                    type="text"
                    value={labelInput}
                    onChange={(e) => setLabelInput(e.target.value)}
                    placeholder="e.g. Wave 2 — Thrissur origin"
                    className="w-full bg-surface-variant border border-outline rounded-lg px-4 py-2.5 text-sm font-sans text-on-surface focus:outline-none focus:border-primary placeholder:text-on-surface-variant/50"
                  />
                </div>
                <div>
                  <label className="block text-xs font-mono uppercase tracking-wider text-on-surface-variant opacity-80 mb-2">
                    Seed Infections
                  </label>
                  <input
                    type="number"
                    value={seedInfections}
                    onChange={e => setSeedInfections(Number(e.target.value))}
                    min={1}
                    className="w-full bg-surface-variant border border-outline rounded-lg px-4 py-2.5 text-sm font-mono text-on-surface focus:outline-none focus:border-primary"
                  />
                  <p className="text-xs font-mono text-on-surface-variant opacity-50 mt-1">Active cases in origin city at Day 0</p>
                </div>
                <div>
                  <label className="block text-xs font-mono uppercase tracking-wider text-on-surface-variant opacity-80 mb-2">
                    Behavioral Sensitivity (k)
                  </label>
                  <input
                    type="number"
                    value={kSensitivity}
                    onChange={e => setKSensitivity(Number(e.target.value))}
                    min={1}
                    className="w-full bg-surface-variant border border-outline rounded-lg px-4 py-2.5 text-sm font-mono text-on-surface focus:outline-none focus:border-primary"
                  />
                  <p className="text-xs font-mono text-on-surface-variant opacity-50 mt-1">Public fear response strength (SEIR-b). Higher = stronger self-limiting</p>
                </div>
              </div>
            </div>
          ) : (
            <div className="h-full flex flex-col">
              <div className="flex items-center gap-3 mb-4">
                <span className="relative flex h-3 w-3">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-primary"></span>
                </span>
                <span className="font-mono text-sm text-on-surface font-medium">Running simulation...</span>
              </div>
              
              <div className="flex-1 bg-[#1a1c1e] text-[#e3e2e6] rounded-lg p-4 font-mono text-xs overflow-y-auto h-56 border border-outline/30 flex flex-col">
                {logs.map((log, i) => (
                  <div key={i} className={`mb-1.5 ${log.colorClass} leading-relaxed`}>
                    <span className="opacity-50 mr-2">[{log.time}]</span>
                    {log.prefix && <span className="opacity-60 mr-2">{log.prefix}</span>}
                    {log.text}
                  </div>
                ))}
                <div ref={logEndRef} />
              </div>
            </div>
          )}
        </div>

        {/* SECTION 4 - Run Controls */}
        <div className="p-6 border-t border-outline bg-surface shrink-0">
          {!isRunning && (
            <div className="flex flex-col gap-3">
              {modalTab === 'configure' && (
                <>
                  {isFirstRun && (
                    <button 
                      onClick={() => {
                        onSimulationComplete({
                          scenarioId: SCENARIO_ID,
                          originCity: 'DELHI',
                          nIterations: 128,
                          scenarioLabel: 'Demo Scenario',
                          pathogenName: 'SARS-CoV-2 (Demo)',
                          seedInfections: 500,
                          kSensitivity: 35,
                        });
                      }}
                      className="w-full bg-surface-variant text-primary border border-primary py-3 rounded-xl font-bold font-sans transition-all hover:bg-primary/10 active:scale-[0.98] flex items-center justify-center gap-2"
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                      Load Demo Scenario
                    </button>
                  )}
                  <button 
                    onClick={handleRun}
                    disabled={!canRun}
                    className="w-full bg-primary text-on-primary py-3 rounded-xl font-bold font-sans transition-all disabled:opacity-50 disabled:cursor-not-allowed hover:bg-primary/90 active:scale-[0.98]"
                  >
                    Run Simulation
                  </button>
                </>
              )}
              {modalTab === 'history' && (
                <button
                  type="button"
                  onClick={() => setModalTab('configure')}
                  className="w-full bg-primary text-on-primary py-3 rounded-xl font-bold font-sans transition-all hover:bg-primary/90 active:scale-[0.98] flex items-center justify-center gap-2"
                >
                  <span>Configure New Scenario</span>
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
