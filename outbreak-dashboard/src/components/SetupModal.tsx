import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import type { ScenarioConfig } from '../types/scenario';

interface SetupModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSimulationComplete: (config: ScenarioConfig) => void;
  isFirstRun: boolean;
  previousConfig?: ScenarioConfig;
}

const CITIES = [
  'THRISSUR', 'KOCHI', 'THIRUVANANTHAPURAM', 'BENGALURU', 'CHENNAI',
  'MUMBAI', 'DELHI', 'KOLKATA', 'HYDERABAD', 'PUNE', 'AHMEDABAD', 'SURAT',
  'JAIPUR', 'LUCKNOW', 'PATNA', 'BHOPAL', 'VISAKHAPATNAM'
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
  previousConfig
}: SetupModalProps) {
  const [pathogens, setPathogens] = useState<any[]>([]);
  const [selectedPathogenId, setSelectedPathogenId] = useState<string | null>(null);
  const [selectedCity, setSelectedCity] = useState<string>('THRISSUR');
  const [selectedIterations, setSelectedIterations] = useState<number>(128);
  const [labelInput, setLabelInput] = useState<string>('');
  
  const [isRunning, setIsRunning] = useState(false);
  const [logs, setLogs] = useState<{ time: string; prefix?: string; text: string; colorClass: string; isComplete?: boolean }[]>([]);
  
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      if (previousConfig) {
        setSelectedCity(previousConfig.originCity);
        setSelectedIterations(previousConfig.nIterations);
        setLabelInput(previousConfig.scenarioLabel);
      }
      setIsRunning(false);
      setLogs([]);
      
      const fetchPathogens = async () => {
        const { data } = await supabase
          .from('reference_diseases')
          .select('reference_disease_id, name, r0_most_likely, cfr_most_likely, incubation_days_most_likely, infectious_period_most_likely')
          .order('name');
          
        if (data) {
          setPathogens(data);
          if (previousConfig) {
            const match = data.find(p => p.name === previousConfig.pathogenName);
            if (match) setSelectedPathogenId(match.reference_disease_id);
          }
        }
      };
      fetchPathogens();
    }
  }, [isOpen, previousConfig]);

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

  const canRun = selectedPathogenId !== null && !isNovelSelected;

  const handleRun = async () => {
    if (!canRun || !selectedPathogen) return;
    
    setIsRunning(true);
    setLogs([]);
    
    try {
      const response = await fetch('http://127.0.0.1:8000/api/v1/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scenario_id: SCENARIO_ID,
          origin_city: selectedCity,
          n_iterations: selectedIterations
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
                let isComplete = false;
                let prefix = '';
                
                if (data.type === 'progress') {
                  if (formattedMsg.includes('intervention=none')) {
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
                      scenarioId: SCENARIO_ID,
                      originCity: selectedCity,
                      nIterations: selectedIterations,
                      scenarioLabel: labelInput || `${selectedPathogen.name} · ${selectedCity}`,
                      pathogenName: selectedPathogen.name
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

  return (
    <div 
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={handleOverlayClick}
    >
      <div className="bg-surface max-w-2xl w-full rounded-2xl shadow-2xl overflow-hidden flex flex-col text-on-surface max-h-full">
        {/* SECTION 1 - Header */}
        <div className="flex justify-between items-start p-6 border-b border-outline shrink-0">
          <div>
            <h2 className="text-xl font-bold font-sans">Configure Scenario</h2>
            <p className="text-sm text-on-surface-variant mt-1">Set up your outbreak simulation parameters</p>
          </div>
          {!isFirstRun && (
            <button onClick={onClose} className="text-on-surface-variant hover:text-on-surface transition-colors p-1">
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>
          )}
        </div>

        <div className="p-6 overflow-y-auto flex-1">
          {!isRunning ? (
            <div className="space-y-8">
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
                          R0: {p.r0_most_likely.toFixed(2)} · CFR: {(p.cfr_most_likely * 100).toFixed(1)}% · Infectious period: {p.infectious_period_most_likely} days
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
                        <div className="font-medium font-sans mb-1">Novel / Emerging Pathogen</div>
                        <div className="text-xs font-mono text-on-surface-variant opacity-80">
                          AI pathogen profiling — next phase
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-[10px] font-mono uppercase bg-surface-container px-2 py-1 rounded text-on-surface-variant border border-outline">Coming Soon</span>
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
                      <textarea 
                        disabled 
                        placeholder="Pathogen profiler module — available in next phase"
                        className="w-full bg-surface-container/50 border border-outline rounded-lg p-3 text-sm font-mono resize-none opacity-60 text-on-surface"
                        rows={3}
                      />
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
              <button 
                onClick={handleRun}
                disabled={!canRun}
                className="w-full bg-primary text-on-primary py-3 rounded-xl font-bold font-sans transition-all disabled:opacity-50 disabled:cursor-not-allowed hover:bg-primary/90 active:scale-[0.98]"
              >
                Run Simulation
              </button>
              {!isFirstRun && (
                <button 
                  onClick={onClose}
                  className="w-full text-on-surface-variant text-sm font-medium hover:text-on-surface transition-colors py-2"
                >
                  Cancel
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
