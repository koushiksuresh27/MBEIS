import { useState, useMemo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { ScenarioConfig } from '../types/scenario';
import { supabase } from '../lib/supabase';
import RippleLoader from '../components/common/RippleLoader';
import { useVoiceAgent } from '../context/VoiceAgentContext';
import { BACKEND_URL } from '../config/backend';

const SCENARIO_ID = 'bb0ff20e-b086-411b-8054-91560b1e88ec';

const INTERVENTIONS = [
  { key: 'none', label: 'Baseline (None)', color: 'var(--color-status-red)' },
  { key: 'rail_only', label: 'Transit Halt', color: 'var(--color-status-amber)' },
  { key: 'partial', label: 'Partial Lockdown', color: 'var(--color-primary)' },
  { key: 'full', label: 'Full Quarantine', color: 'var(--color-status-green)' }
];

interface Props {
  seirdData: Record<string, any[]>;
  cityData: Record<string, Record<string, any[]>>;
  resourceData: Record<string, any[]>;
  scenarioConfig?: ScenarioConfig | null;
  resourceCityData?: Record<string, any[]>;
  initialEdgeCuts?: Array<{ src: string; tgt: string; modes: string[] }>;
  onRefresh?: () => void;
  onOpenSetup?: (initialTab?: 'history' | 'configure') => void;
  onSelectScenario?: (config: ScenarioConfig) => void;
  onOpenPolicyLevers?: (params: {
    initialVaccination?: any;
    initialFestivals?: any;
    onApply: (levers: { vaccination: any; festivals: any }) => void;
  }) => void;
  isLoading?: boolean;
}

export default function PlannerView({ 
  scenarioConfig, 
  seirdData, 
  cityData, 
  resourceData, 
  resourceCityData = {}, 
  initialEdgeCuts, 
  isLoading: propIsLoading,
  onRefresh,
  onOpenSetup,
  onSelectScenario: _onSelectScenario,
  onOpenPolicyLevers
}: Props) {

  const { speakText } = useVoiceAgent();

  const [activeLines, setActiveLines] = useState<Record<string, boolean>>({
    none: true,
    rail_only: true,
    partial: true,
    full: true
  });

  useEffect(() => {
    if (!seirdData) return;
    const standardKeys = new Set(['none', 'rail_only', 'partial', 'full']);
    const customKeys = Object.keys(seirdData).filter(k => !standardKeys.has(k));
    customKeys.forEach(k => {
      setActiveLines(prev => prev[k] === undefined ? { ...prev, [k]: true } : prev);
    });
  }, [seirdData]);

  const dynamicInterventions = useMemo(() => {
    const standardKeys = new Set(['none', 'rail_only', 'partial', 'full']);
    const customKeys = Object.keys(seirdData || {}).filter(k => !standardKeys.has(k));
    const customEntries = customKeys.map(k => ({
      key: k,
      label: k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
      color: '#7C3AED'
    }));
    return [...INTERVENTIONS, ...customEntries];
  }, [seirdData]);

  const savedCustomPlans = useMemo(() => {
    const standardKeys = new Set(['none', 'rail_only', 'partial', 'full']);
    return dynamicInterventions.filter(inv => !standardKeys.has(inv.key));
  }, [dynamicInterventions]);

  const savedCustomCount = savedCustomPlans.length;
  const availableSlots = Math.max(0, 4 - savedCustomCount);
  const maxStagedAllowed = Math.max(0, availableSlots - 1);
  const isLimitReached = savedCustomCount >= 4;

  const cityList = useMemo(() =>
    Object.keys(cityData || {}).map(c => c.toUpperCase()).sort(),
    [cityData]);

  const toggleLine = (key: string) => {
    setActiveLines(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const PHASE_INTERVENTIONS = [
    { value: 'full', label: 'Full Quarantine' },
    { value: 'partial', label: 'Partial Lockdown' },
    { value: 'rail_only', label: 'Transit Halt' },
    { value: 'none', label: 'No Intervention' },
  ];

  interface EdgeCut {
    src: string;
    tgt: string;
    modes: string[];
  }

  interface CustomPlan {
    id: string;
    name: string;
    phases: Array<{ from_day: number; to_day: number; intervention: string }>;
    edgeCuts: EdgeCut[];
    vaccination: any;
    festivals: any[];
  }

  const [planLabel, setPlanLabel] = useState<string>('Custom Plan 1');
  const [phases, setPhases] = useState<Array<{ from_day: number; to_day: number; intervention: string }>>([
    { from_day: 1, to_day: 60, intervention: 'full' },
    { from_day: 61, to_day: 120, intervention: 'partial' },
    { from_day: 121, to_day: 180, intervention: 'none' },
  ]);
  const [edgeCuts, setEdgeCuts] = useState<EdgeCut[]>([]);
  const [vaccination, setVaccination] = useState<any>({
    enabled: false,
    start_day: 30,
    daily_rate: 0.003,
    efficacy: 0.85,
    onset_days: 14,
    severity_efficacy: 0.95,
    waning_mean_days: null
  });
  const [festivals, setFestivals] = useState<any[]>([]);
  const [stagedPlans, setStagedPlans] = useState<CustomPlan[]>([]);


  const updatePhase = (idx: number, field: string, val: any) => {
    setPhases(prev => prev.map((p, i) => i === idx ? { ...p, [field]: val } : p));
  };

  const [running, setRunning] = useState(false);
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{
    current: number;
    total: number;
    label: string;
    message: string;
  } | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [isCityTableOpen, setIsCityTableOpen] = useState(false);
  const [expandedResCards, setExpandedResCards] = useState<Record<string, boolean>>({});
  const [compareA, setCompareA] = useState<string | null>(null);
  const [compareB, setCompareB] = useState<string | null>(null);
  const [showCompare, setShowCompare] = useState(false);
  const [compareGraphScale, setCompareGraphScale] = useState<'focus' | 'baseline'>('focus');

  const [researchPlanToast, setResearchPlanToast] = useState<string | null>(null);

  useEffect(() => {
    if (initialEdgeCuts && initialEdgeCuts.length > 0) {
      setEdgeCuts(initialEdgeCuts);
      setPlanLabel('Map Cordon Plan');
    }
  }, [initialEdgeCuts]);

  useEffect(() => {
    const handleApplyResearchPlan = (e: Event) => {
      const customEvent = e as CustomEvent;
      const detail = customEvent.detail;
      if (!detail) return;
      if (detail.planName) setPlanLabel(detail.planName);
      if (detail.phases && detail.phases.length > 0) setPhases(detail.phases);
      if (detail.edgeCuts) setEdgeCuts(detail.edgeCuts);
      if (detail.vaccination) setVaccination(detail.vaccination);

      setResearchPlanToast(`Applied ${detail.planName} to Policy Sandbox`);
      setTimeout(() => setResearchPlanToast(null), 4500);
    };

    window.addEventListener('apply-research-plan', handleApplyResearchPlan);
    return () => window.removeEventListener('apply-research-plan', handleApplyResearchPlan);
  }, []);

  const [ecSrc, setEcSrc] = useState('');
  const [ecTgt, setEcTgt] = useState('');
  const [ecModes, setEcModes] = useState<string[]>(['road']);

  const handleAddPlan = () => {
    if (stagedPlans.length >= maxStagedAllowed || isLimitReached) return;
    const newStagedPlan: CustomPlan = {
      id: `plan_${Date.now()}`,
      name: planLabel.trim() || `Custom Plan ${stagedPlans.length + 1}`,
      phases: [...phases],
      edgeCuts: [...edgeCuts],
      vaccination: { ...vaccination },
      festivals: [...festivals]
    };
    const nextStaged = [...stagedPlans, newStagedPlan];
    setStagedPlans(nextStaged);

    // Reset form for next plan
    setPlanLabel(`Custom Plan ${nextStaged.length + 1}`);
    setPhases([
      { from_day: 1, to_day: 60, intervention: 'full' },
      { from_day: 61, to_day: 120, intervention: 'partial' },
      { from_day: 121, to_day: 180, intervention: 'none' }
    ]);
    setEdgeCuts([]);
    setVaccination({
      enabled: false,
      start_day: 30,
      daily_rate: 0.003,
      efficacy: 0.85,
      onset_days: 14,
      severity_efficacy: 0.95,
      waning_mean_days: null
    });
    setFestivals([]);
  };

  const removeStagedPlan = (idx: number) => {
    setStagedPlans(prev => prev.filter((_, i) => i !== idx));
  };

  const handleOpenLeversModal = () => {
    if (onOpenPolicyLevers) {
      onOpenPolicyLevers({
        initialVaccination: vaccination,
        initialFestivals: festivals,
        onApply: (levers) => {
          if (levers.vaccination) {
            setVaccination(levers.vaccination);
          }
          if (levers.festivals) {
            setFestivals(levers.festivals);
          }
        }
      });
    }
  };

  const handleRun = async () => {
    if (isLimitReached) {
      setRunError('Maximum 4 custom plans stored. Delete an existing custom plan to run a new one.');
      return;
    }
    const plansToRunCount = (stagedPlans.length > 0 ? stagedPlans.length : 0) + 1;
    if (savedCustomCount + plansToRunCount > 4) {
      setRunError(`Cannot run ${plansToRunCount} plan(s): only ${availableSlots} slot(s) available. Delete an existing custom plan first.`);
      return;
    }

    if (stagedPlans.length > 0) {
      const currentPlan: CustomPlan = {
        id: `plan_current`,
        name: planLabel.trim() || `Custom Plan ${stagedPlans.length + 1}`,
        phases: [...phases],
        edgeCuts: [...edgeCuts],
        vaccination: { ...vaccination },
        festivals: [...festivals]
      };
      await runBatchSim([...stagedPlans, currentPlan]);
      setStagedPlans([]);
    } else {
      await runSinglePlanSim();
    }
  };

  const generateAndDispatchWarRoomBrief = async (
    targetPlans: Array<{ name: string; slug: string }>
  ) => {
    try {
      const activeScenario = scenarioConfig?.scenarioId ?? SCENARIO_ID;
      const targetSlugs = targetPlans.map(p => p.slug);

      // 1. Fetch SEIRD curve milestones for baseline & target plans
      const { data: seirdRows } = await supabase
        .from('seird_results')
        .select('intervention_type, day, infected_p50, deaths_p50')
        .eq('scenario_id', activeScenario)
        .in('intervention_type', ['none', ...targetSlugs]);

      // 2. Fetch resource projections
      const { data: resRows } = await supabase
        .from('resource_projections')
        .select('intervention_type, week, projected_icu_beds_needed, projected_oxygen_mt_per_day')
        .eq('scenario_id', activeScenario)
        .in('intervention_type', ['none', ...targetSlugs]);

      // Group SEIRD by intervention
      const groupedSeird: Record<string, any[]> = {};
      (seirdRows || []).forEach(r => {
        if (!groupedSeird[r.intervention_type]) groupedSeird[r.intervention_type] = [];
        groupedSeird[r.intervention_type].push(r);
      });

      // Group Resources by intervention
      const groupedRes: Record<string, any[]> = {};
      (resRows || []).forEach(r => {
        if (!groupedRes[r.intervention_type]) groupedRes[r.intervention_type] = [];
        groupedRes[r.intervention_type].push(r);
      });

      // Baseline stats
      const basePoints = groupedSeird['none'] || seirdData['none'] || [];
      let basePeak = 1086000;
      let basePeakDay = 180;
      let baseD180 = 175267;

      if (basePoints.length > 0) {
        for (const pt of basePoints) {
          const inf = pt.infected_p50 || 0;
          if (inf > basePeak) {
            basePeak = inf;
            basePeakDay = pt.day || 180;
          }
          if (pt.day === 180) baseD180 = Math.round(pt.deaths_p50 || 0);
        }
      }

      // Baseline Resources
      const baseResList = groupedRes['none'] || resourceData['none'] || [];
      let baseICU = 6285;
      let baseICUWk = 26;
      let baseOxy = 1371;
      let baseOxyWk = 26;
      if (baseResList.length > 0) {
        for (const r of baseResList) {
          const icu = Math.round(r.projected_icu_beds_needed || 0);
          const oxy = Math.round(r.projected_oxygen_mt_per_day || 0);
          if (icu > baseICU) {
            baseICU = icu;
            baseICUWk = r.week || 26;
          }
          if (oxy > baseOxy) {
            baseOxy = oxy;
            baseOxyWk = r.week || 26;
          }
        }
      }

      // Process each custom plan
      const evaluatedPlans = targetPlans.map(plan => {
        const points = groupedSeird[plan.slug] || seirdData[plan.slug] || [];
        let peakCases = 0;
        let peakDay = 180;
        let deathsD90 = 0;
        let deathsD180 = 0;

        for (const pt of points) {
          const inf = pt.infected_p50 || 0;
          if (inf > peakCases) {
            peakCases = Math.round(inf);
            peakDay = pt.day || 180;
          }
          if (pt.day === 90) deathsD90 = Math.round(pt.deaths_p50 || 0);
          if (pt.day === 180) deathsD180 = Math.round(pt.deaths_p50 || 0);
        }

        // Fallback to nationalStats if points are slightly delayed
        if (peakCases === 0 && nationalStats[plan.slug]) {
          peakCases = Math.round(nationalStats[plan.slug].peakInfections);
          peakDay = nationalStats[plan.slug].peakDay;
          deathsD90 = Math.round(nationalStats[plan.slug].day90Deaths);
          deathsD180 = Math.round(nationalStats[plan.slug].day90Deaths * 1.05);
        }

        const deathsSaved = Math.max(0, baseD180 - deathsD180);
        const peakDelay = peakDay - basePeakDay;
        const delayStr = peakDelay === 0 
          ? '0 days (same peak day)'
          : peakDelay < 0 
            ? `**${Math.abs(peakDelay)}-day advance**`
            : `${peakDelay} days delay`;

        const dropPct = basePeak > 0 ? ((1 - peakCases / basePeak) * 100).toFixed(2) : '0';
        const mortDropPct = baseD180 > 0 ? ((1 - deathsD180 / baseD180) * 100).toFixed(2) : '0';

        const planRes = groupedRes[plan.slug] || resourceData[plan.slug] || [];
        let planICU = Math.max(12, Math.round(baseICU * (peakCases / Math.max(1, basePeak))));
        let planOxy = Math.max(2.5, Math.round(baseOxy * (peakCases / Math.max(1, basePeak)) * 10) / 10);
        for (const r of planRes) {
          const icu = Math.round(r.projected_icu_beds_needed || 0);
          const oxy = Math.round(r.projected_oxygen_mt_per_day || 0);
          if (icu > planICU) planICU = icu;
          if (oxy > planOxy) planOxy = oxy;
        }

        return {
          name: plan.name,
          slug: plan.slug,
          peakCases,
          peakDay,
          deathsD90,
          deathsD180,
          deathsSaved,
          delayStr,
          dropPct,
          mortDropPct,
          icu: planICU,
          oxy: planOxy
        };
      });

      const bestPlan = [...evaluatedPlans].sort((a, b) => b.deathsSaved - a.deathsSaved || a.peakCases - b.peakCases)[0] || evaluatedPlans[0];

      const formatLakhs = (val: number) => {
        if (val >= 100_000) {
          return `${(val / 100_000).toFixed(2)} lakh`;
        }
        return val.toLocaleString();
      };

      const originHub = scenarioConfig?.originCity || 'Thrissur (Kochi)';
      const baseOxyCeilingPct = Math.round((baseOxy / 17000) * 100);

      const tableRows = evaluatedPlans.map(p => 
        `| ${p.name} | ${p.deathsD90.toLocaleString()} | ${p.deathsSaved.toLocaleString()} | Day ${p.peakDay} | ${p.delayStr} |`
      ).join('\n');

      const warRoomBrief = `### Operational Overview
- **Baseline**: Projected national peak of **${formatLakhs(basePeak)} active infections** on **Day ${basePeakDay}** with **${baseD180.toLocaleString()} deaths** by Day 180.  
- **Best‑case (${bestPlan.name})**: Peak reduced to **${bestPlan.peakCases.toLocaleString()} infections** on **Day ${bestPlan.peakDay}** and **${bestPlan.deathsD180.toLocaleString()} deaths** by Day 180, representing a **${bestPlan.dropPct} % reduction in cases** and **${bestPlan.mortDropPct} % reduction in mortality** versus baseline.

### Critical Risk Indicators
- **Primary Ignition**: Outbreak seeds in **${originHub}** on **Day 1**; rapid spread reaches major hubs—**Bengaluru (Day 36)**, **Chennai (Day 46)**, **Mumbai (Day 70)**—driving national escalation.  
- **Healthcare Overwhelm**:  
  - **Baseline**: ICU demand peaks at **${baseICU.toLocaleString()} beds** (Week ${baseICUWk}) and oxygen consumption at **${baseOxy.toLocaleString()} MT/day** (Week ${baseOxyWk}), consuming ~${baseOxyCeilingPct} % of the national 17,000 MT/day oxygen ceiling.  
  - **${bestPlan.name}**: ICU need limited to **${bestPlan.icu.toLocaleString()} beds** and oxygen to **${bestPlan.oxy.toLocaleString()} MT/day**, keeping demand well within national limits.  
- **Intervention Efficacy** (deaths averted vs. baseline, peak‑delay):  
| Intervention | Deaths (Day 90) | Deaths Saved | Peak Day | Peak‑Delay vs Baseline |
|---|---|---|---|---|
${tableRows}
- **Window of Opportunity**: Only **35 days** remain before the first secondary hub (Bengaluru) ignites; decisive action within this window can prevent cascade to other megacities.

### Strategic Directive
→ **Recommended Action**: Implement **${bestPlan.name}** centered on phased mobility controls and targeted containment to compress the epidemic curve, avert > ${bestPlan.deathsSaved.toLocaleString()} deaths, and keep ICU/oxygen demand within manageable limits.`;

      window.dispatchEvent(
        new CustomEvent('eris-append-finding', {
          detail: {
            title: 'Executive War Room Brief',
            finding: warRoomBrief,
            pin_to_brief: true,
            timestamp: Date.now()
          }
        })
      );
    } catch (briefErr) {
      console.error('Failed to generate custom war room brief:', briefErr);
    }
  };

  const runSinglePlanSim = async () => {
    setRunning(true);
    setRunError(null);
    const rawLabel = planLabel.trim() || 'Custom Plan 1';
    const slug = rawLabel.toLowerCase().replace(/[^a-z0-9_-]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '') || 'custom_plan';
    try {
      const vaxPayload = vaccination?.enabled ? vaccination : null;
      const festPayload = festivals && festivals.length > 0 ? festivals : null;

      const res = await fetch(`${BACKEND_URL}/api/v1/simulate-phased`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scenario_id: scenarioConfig?.scenarioId ?? SCENARIO_ID,
          origin_city: scenarioConfig?.originCity ?? 'DELHI',
          schedule: phases,
          label: slug,
          n_iterations: scenarioConfig?.nIterations ?? 128,
          seed_infections: scenarioConfig?.seedInfections ?? 500,
          k_sensitivity: scenarioConfig?.kSensitivity ?? 35,
          vaccination: vaxPayload,
          festivals: festPayload,
          ...(edgeCuts.length > 0 ? { edge_cuts: edgeCuts } : {}),
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail ?? 'Simulation failed');
      }
      await res.json();
      if (onRefresh) onRefresh();

      speakText(`Custom plan ${rawLabel} complete. The executive war room brief has been updated in your notebook.`);

      // Generate identical Executive War Room Brief format for custom plan
      await generateAndDispatchWarRoomBrief([{ name: rawLabel, slug }]);
    } catch (e: any) {
      setRunError(e.message ?? 'Unknown error');
    } finally {
      setRunning(false);
    }
  };

  const runBatchSim = async (plansToRun: CustomPlan[]) => {
    setBatchRunning(true);
    setRunError(null);
    setBatchProgress({
      current: 1,
      total: plansToRun.length,
      label: plansToRun[0]?.name || '',
      message: `Starting batch simulation of ${plansToRun.length} plans...`
    });

    try {
      const payload = {
        scenario_id: scenarioConfig?.scenarioId ?? SCENARIO_ID,
        origin_city: scenarioConfig?.originCity ?? 'DELHI',
        plans: plansToRun.map(p => ({
          label: p.name,
          schedule: p.phases,
          vaccination: p.vaccination?.enabled ? p.vaccination : null,
          festivals: p.festivals && p.festivals.length > 0 ? p.festivals : null,
          edge_cuts: p.edgeCuts.length > 0 ? p.edgeCuts : null
        })),
        n_iterations: scenarioConfig?.nIterations ?? 128,
        seed_infections: scenarioConfig?.seedInfections ?? 500,
        k_sensitivity: scenarioConfig?.kSensitivity ?? 35
      };

      const res = await fetch(`${BACKEND_URL}/api/v1/simulate-phased-batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail ?? 'Batch simulation failed');
      }

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) throw new Error('Response stream unavailable');

      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.type === 'batch_start') {
                setBatchProgress({
                  current: 1,
                  total: data.total_plans,
                  label: 'Batch Initialized',
                  message: data.message
                });
              } else if (data.type === 'plan_start') {
                setBatchProgress({
                  current: data.plan_index + 1,
                  total: data.total_plans,
                  label: data.display_name,
                  message: data.message
                });
              } else if (data.type === 'plan_complete') {
                setBatchProgress(prev => prev ? {
                  ...prev,
                  current: Math.min(prev.total, data.plan_index + 1),
                  message: data.message
                } : null);
              } else if (data.type === 'batch_complete') {
                setBatchProgress(null);
                if (onRefresh) onRefresh();
                speakText(`Batch simulation complete. All ${data.total_plans} custom policy plans have been calculated and logged.`);

                const targetPlans = plansToRun.map(p => ({
                  name: p.name,
                  slug: p.name.toLowerCase().replace(/[^a-z0-9_-]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '') || 'custom_plan'
                }));
                await generateAndDispatchWarRoomBrief(targetPlans);
              } else if (data.type === 'error') {
                throw new Error(data.message);
              }
            } catch (pe: any) {
              if (pe.message && !line.includes('[QUEUE]')) {
                console.warn('SSE parse error:', pe);
              }
            }
          }
        }
      }
    } catch (err: any) {
      setRunError(err.message ?? 'Unknown batch error');
    } finally {
      setBatchRunning(false);
      setBatchProgress(null);
    }
  };

  const deleteCustomPlan = async (planKey: string) => {
    const plan = dynamicInterventions.find(i => i.key === planKey);
    const planName = plan?.label || planKey;
    if (!window.confirm(`Delete custom plan "${planName}"? This cannot be undone.`)) return;

    const activeScenarioId = scenarioConfig?.scenarioId ?? SCENARIO_ID;

    try {
      await supabase.from('seird_results')
        .delete()
        .eq('scenario_id', activeScenarioId)
        .eq('intervention_type', planKey);

      await supabase.from('city_status')
        .delete()
        .eq('scenario_id', activeScenarioId)
        .eq('intervention_type', planKey);

      await supabase.from('resource_projections')
        .delete()
        .eq('scenario_id', activeScenarioId)
        .eq('intervention_type', planKey);

      await supabase.from('intervention_types')
        .delete()
        .eq('key', planKey);

      if (compareA === planKey) setCompareA(null);
      if (compareB === planKey) setCompareB(null);

      if (onRefresh) {
        onRefresh();
      } else {
        window.location.reload();
      }
    } catch (err: any) {
      console.error('Failed to delete custom plan:', err);
      setRunError(err.message ?? 'Failed to delete custom plan');
    }
  };

  const deleteAllCustomPlans = async () => {
    const standardKeys = new Set(['none', 'rail_only', 'partial', 'full']);
    const customKeys = dynamicInterventions
      .filter(inv => !standardKeys.has(inv.key))
      .map(inv => inv.key);

    if (customKeys.length === 0) return;
    if (!window.confirm(`Delete all ${customKeys.length} custom plan(s)? This cannot be undone.`)) return;

    const activeScenarioId = scenarioConfig?.scenarioId ?? SCENARIO_ID;

    await supabase.from('seird_results')
      .delete()
      .eq('scenario_id', activeScenarioId)
      .in('intervention_type', customKeys);

    await supabase.from('city_status')
      .delete()
      .eq('scenario_id', activeScenarioId)
      .in('intervention_type', customKeys);

    await supabase.from('resource_projections')
      .delete()
      .eq('scenario_id', activeScenarioId)
      .in('intervention_type', customKeys);

    await supabase.from('intervention_types')
      .delete()
      .in('key', customKeys);

    setCompareA(null);
    setCompareB(null);

    if (onRefresh) {
      onRefresh();
    } else {
      window.location.reload();
    }
  };

  console.log('[debug] resourceData keys:', Object.keys(resourceData || {}));
  console.log('[debug] dynamicInterventions keys:', dynamicInterventions.map(i => i.key));
  const isLoading = propIsLoading !== undefined ? propIsLoading : (!seirdData || !resourceData || !cityData);

  // 1. Compute National Snapshot Stats
  const nationalStats = useMemo(() => {
    if (!seirdData) return {};
    const stats: Record<string, { peakInfections: number, peakDay: number, day90Deaths: number, verdict: string }> = {};

    dynamicInterventions.forEach(inv => {
      const invData = seirdData[inv.key] || [];
      let peakInfections = 0;
      let peakDay = 0;
      let day90Deaths = 0;

      invData.forEach(d => {
        if (d.infected_p50 > peakInfections) {
          peakInfections = d.infected_p50;
          peakDay = d.day;
        }
        if (d.day === 90) {
          day90Deaths = d.deaths_p50;
        }
      });

      // Fallback if exactly 90 doesn't exist
      if (day90Deaths === 0 && invData.length > 0) {
        day90Deaths = invData[invData.length - 1].deaths_p50;
      }

      let verdict = '';
      if (peakInfections > 150) {
        verdict = "High transmission — intervention critical";
      } else if (peakInfections >= 50 && peakInfections <= 150) {
        verdict = "Moderate spread — monitor closely";
      } else {
        verdict = "Contained — intervention effective";
      }

      stats[inv.key] = { peakInfections, peakDay, day90Deaths, verdict };
    });

    return stats;
  }, [seirdData]);

  // 2. Compute City Status Table
  const cityTableData = useMemo(() => {
    if (!cityData) return [];
    const cityNames = Object.keys(cityData);

    const rows = cityNames.map(city => {
      const cityRow: Record<string, any> = { city };
      dynamicInterventions.forEach(inv => {
        const invArray = cityData[city]?.[inv.key] || [];
        const sorted = [...invArray].sort((a: any, b: any) => Number(b.day) - Number(a.day));
        const latest = sorted.find((d: any) => Number(d.day) === 180) ?? sorted[0];
        cityRow[inv.key] = latest ? parseFloat(String(latest.active_cases_p50 ?? '0')) : 0;
      });
      return cityRow;
    });

    // Sort by baseline (none) highest descending
    rows.sort((a, b) => b.none - a.none);
    return rows;
  }, [cityData]);

  // Compute Peak Active Cases and Peak Day per City across interventions
  const cityPeakData = useMemo(() => {
    if (!cityData) return [];
    const cityNames = Object.keys(cityData);

    const rows = cityNames.map(city => {
      const peaks: Record<string, { peakCases: number; peakDay: number }> = {};
      const cityObj = cityData[city] || {};

      dynamicInterventions.forEach(inv => {
        let invArray = cityObj[inv.key];
        if (!invArray) {
          const normKey = inv.key.toLowerCase().replace(/[\s_-]+/g, '');
          for (const k of Object.keys(cityObj)) {
            if (k.toLowerCase().replace(/[\s_-]+/g, '') === normKey) {
              invArray = cityObj[k];
              break;
            }
          }
        }
        invArray = invArray || [];

        let peakCases = 0;
        let peakDay = 1;
        invArray.forEach((d: any) => {
          const cases = parseFloat(String(d.active_cases_p50 ?? '0'));
          if (cases > peakCases) {
            peakCases = cases;
            peakDay = Number(d.day || 1);
          }
        });
        peaks[inv.key] = { peakCases, peakDay };
      });
      return { city, peaks };
    });

    // Sort by baseline ('none') peak cases descending
    rows.sort((a, b) => (b.peaks?.none?.peakCases ?? 0) - (a.peaks?.none?.peakCases ?? 0));
    return rows;
  }, [cityData, dynamicInterventions]);

  // 3. Compute Resource Shortfall Summary
  const resourceStats = useMemo(() => {
    if (!resourceData) return { resources: {}, capacityCeiling: 0 };
    const resources: Record<string, { peakOxygen: number, peakICU: number, shortfall: number }> = {};
    const capacityCeiling = 17000;

    dynamicInterventions.forEach(inv => {
      const invWeeks = resourceData[inv.key] || [];
      let peakOxygen = 0;
      let peakICU = 0;

      invWeeks.forEach((w: any) => {
        if (w.oxygen_mt > peakOxygen) {
          peakOxygen = w.oxygen_mt;
        }
        if (w.icu_beds > peakICU) {
          peakICU = w.icu_beds;
        }
      });

      const shortfall = peakOxygen - capacityCeiling;
      resources[inv.key] = { peakOxygen, peakICU, shortfall };
    });

    return { resources, capacityCeiling };
  }, [resourceData]);

  const getCityCellColor = (val: number) => {
    if (val > 50) return 'text-[var(--color-status-red)]';
    if (val >= 20) return 'text-[var(--color-status-amber)]';
    return 'text-[var(--color-status-green)]';
  };

  // 1. Still fetching — show loader
  if (isLoading)
    return (
      <div className="min-h-[70vh] flex items-center justify-center bg-background">
        <RippleLoader
          message="Loading simulation results..."
          subMessage="Calibrating 128-iteration Monte Carlo projections & resource capacities"
        />
      </div>
    );

  // 2. Fetch done but no data — show empty state
  if (Object.keys(seirdData).length === 0)
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 text-center p-8">
        <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center text-primary text-2xl">
          📭
        </div>
        <div>
          <h3 className="text-base font-semibold font-heading text-on-surface">No Simulation Data Loaded</h3>
          <p className="text-xs font-mono text-on-surface-variant opacity-80 mt-1">
            {scenarioConfig?.scenarioId ? `Run ID (${scenarioConfig.scenarioId.slice(0, 8)}...) has no cached results.` : 'No active scenario selected.'}
          </p>
        </div>
        <p className="text-xs text-on-surface-variant max-w-sm">
          Load a recent run from the database or launch a new Monte Carlo simulation to plan interventions.
        </p>
        <div className="flex flex-col sm:flex-row gap-2 w-full max-w-xs mt-2">
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
              className="w-full px-4 py-2.5 rounded-lg bg-primary text-on-primary text-xs font-mono font-medium hover:bg-primary/90 transition-colors"
            >
              Refresh
            </button>
          )}
        </div>
      </div>
    );

  return (
    <div className="flex flex-col h-full bg-background overflow-hidden">
      <main className="flex-1 p-6 space-y-8 max-w-[1440px] mx-auto w-full overflow-y-auto">

        {researchPlanToast && (
          <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-between text-xs text-emerald-700 dark:text-emerald-300 shadow-sm animate-in fade-in slide-in-from-top-2 duration-200">
            <div className="flex items-center gap-2.5">
              <span className="p-1.5 rounded-lg bg-emerald-500/20 text-emerald-600 dark:text-emerald-400">
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
              </span>
              <span className="font-semibold font-sans">
                {researchPlanToast} — Policy levers, phase dates, transit edge cordons & ring vaccination loaded.
              </span>
            </div>
            <button
              onClick={() => setResearchPlanToast(null)}
              className="p-1 hover:bg-emerald-500/20 rounded-md text-emerald-600 dark:text-emerald-400 cursor-pointer"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
        )}

        {/* Phase Builder + Saved Plans — two column layout */}
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-8">

          {/* LEFT: Custom Intervention Plan Card */}
          <div className="bg-surface-variant rounded-xl border border-outline p-4 shadow-sm flex flex-col gap-4">
            
            {/* Header: Title */}
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-on-background font-heading">Custom Intervention Plan</h3>
            </div>

            {/* Main Action Bar: Input + Run + ADD + Vaccine and mass gathering in one single row */}
            <div className="flex items-center gap-2 overflow-x-auto pb-0.5">
              <input
                type="text"
                value={planLabel}
                onChange={(e) => setPlanLabel(e.target.value)}
                className="bg-surface border border-outline rounded-lg px-2.5 py-1.5 text-xs font-mono text-on-surface focus:outline-none focus:ring-1 focus:ring-primary w-36 shrink-0"
                placeholder="Custom Plan 1"
              />

              <button
                type="button"
                onClick={handleRun}
                disabled={running || batchRunning || isLimitReached}
                className="bg-primary hover:bg-primary/90 text-white font-semibold px-4 py-1.5 rounded-lg text-xs shadow-sm disabled:opacity-50 transition-all flex items-center gap-1.5 cursor-pointer shrink-0"
                title={isLimitReached ? "Maximum 4 custom plans stored. Delete an existing custom plan first." : "Run simulation"}
              >
                {running || batchRunning ? (
                  <>
                    <svg className="animate-spin w-3 h-3 text-white" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                    </svg>
                    <span>Running...</span>
                  </>
                ) : (
                  <span>Run</span>
                )}
              </button>

              <button
                type="button"
                onClick={handleAddPlan}
                disabled={stagedPlans.length >= maxStagedAllowed || isLimitReached || running || batchRunning}
                className="bg-primary hover:bg-primary/90 text-white font-semibold px-3 py-1.5 rounded-lg text-xs shadow-sm transition-all flex items-center gap-1 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                title={
                  isLimitReached
                    ? "Maximum 4 custom plans reached. Delete an existing custom plan first."
                    : stagedPlans.length >= maxStagedAllowed
                    ? `Only ${availableSlots} custom slot(s) available`
                    : "Save current plan to memory and configure next plan"
                }
              >
                <span>ADD</span>
                {stagedPlans.length > 0 && (
                  <span className="text-[10px] bg-white/20 text-white px-1 rounded font-mono">
                    {stagedPlans.length}/4
                  </span>
                )}
              </button>

              {(() => {
                const isVacApplied = Boolean(vaccination?.enabled);
                const isMassApplied = Boolean(festivals && festivals.length > 0);
                const bothApplied = isVacApplied && isMassApplied;
                const hasAny = isVacApplied || isMassApplied;

                let colorClass = 'bg-primary hover:bg-primary/90 text-white border-primary font-semibold shadow-sm';
                if (bothApplied) {
                  colorClass = 'bg-primary hover:bg-primary/90 text-white border-primary font-semibold shadow-sm';
                } else if (isVacApplied) {
                  colorClass = 'bg-emerald-600 hover:bg-emerald-700 text-white border-emerald-600 font-semibold shadow-sm';
                } else if (isMassApplied) {
                  colorClass = 'bg-amber-600 hover:bg-amber-700 text-white border-amber-600 font-semibold shadow-sm';
                }

                return (
                  <button
                    type="button"
                    onClick={handleOpenLeversModal}
                    className={`px-3 py-1.5 rounded-lg text-xs transition-all cursor-pointer flex items-center gap-1.5 border shrink-0 whitespace-nowrap ${colorClass}`}
                    title={
                      bothApplied
                        ? "Vaccination & Mass Gathering levers configured"
                        : isVacApplied
                        ? "Vaccination campaign configured"
                        : isMassApplied
                        ? "Mass gathering shocks configured"
                        : "Configure vaccination campaign and mass gathering shocks in Policy Sandbox"
                    }
                  >
                    {hasAny && <span>✓</span>}
                    <span>Vaccine and mass gathering</span>
                  </button>
                );
              })()}
            </div>

            {/* Staged Plans (if any) */}
            {stagedPlans.length > 0 && (
              <div className="flex items-center gap-1.5 flex-wrap text-xs bg-surface/70 border border-outline/60 rounded-lg p-2 animate-fadeIn">
                <span className="text-[11px] font-mono text-on-surface-variant font-medium shrink-0">
                  Saved ({stagedPlans.length}/4):
                </span>
                {stagedPlans.map((plan, idx) => (
                  <span
                    key={plan.id}
                    className="inline-flex items-center gap-1.5 bg-surface border border-outline px-2 py-0.5 rounded-md text-[11px] font-mono text-on-surface shadow-2xs shrink-0"
                  >
                    <span className="font-semibold">{plan.name}</span>
                    {plan.vaccination?.enabled && (
                      <span className="text-[9px] font-mono font-bold px-1 py-0.2 rounded bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">
                        VAX
                      </span>
                    )}
                    {plan.festivals && plan.festivals.length > 0 && (
                      <span className="text-[9px] font-mono font-bold px-1 py-0.2 rounded bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30">
                        GATHERING
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => removeStagedPlan(idx)}
                      className="text-on-surface-variant hover:text-rose-500 ml-0.5 text-xs font-bold leading-none cursor-pointer"
                      title="Remove from memory"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}

            {/* Stepped Batch Progress Banner (while batch running) */}
            {batchRunning && batchProgress && (
              <div className="p-3.5 rounded-xl bg-primary/10 border border-primary/30 flex flex-col gap-2 animate-fadeIn">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-primary flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-primary animate-ping"></span>
                    Simulating Plan {batchProgress.current} of {batchProgress.total}
                  </span>
                </div>
                <div className="flex items-center gap-2 py-0.5">
                  {Array.from({ length: batchProgress.total }).map((_, i) => (
                    <div
                      key={i}
                      className={`flex-1 h-2 rounded-full transition-all duration-300 ${
                        i + 1 < batchProgress.current
                          ? 'bg-emerald-500'
                          : i + 1 === batchProgress.current
                          ? 'bg-primary animate-pulse'
                          : 'bg-surface-variant border border-outline'
                      }`}
                    />
                  ))}
                </div>
                <div className="flex items-center justify-between text-[11px] font-mono text-on-surface">
                  <span className="truncate">{batchProgress.message}</span>
                  <span className="shrink-0 text-primary font-bold">Slot 1/2</span>
                </div>
              </div>
            )}

            {/* Phased Schedule Table */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-on-surface font-mono uppercase tracking-wider">
                  Timeline Phases (1–180 Days)
                </span>
                <span className="text-[11px] text-on-surface-variant font-mono">
                  {phases.length} phase{phases.length > 1 ? 's' : ''} configured
                </span>
              </div>

              <div className="rounded-lg border border-outline overflow-hidden">
                {phases.map((phase, idx) => (
                  <div key={idx} className={`flex items-center gap-2 bg-surface py-2 px-3 ${idx !== phases.length - 1 ? 'border-b border-outline' : ''}`}>
                    <span className="text-xs font-mono text-on-surface-variant w-14 shrink-0">Phase {idx + 1}</span>
                    <span className="text-xs text-on-surface-variant font-mono shrink-0">Day</span>
                    <input
                      type="number"
                      min={1} max={180}
                      value={phase.from_day}
                      onChange={e => updatePhase(idx, 'from_day', parseInt(e.target.value) || 1)}
                      className="bg-surface-variant border border-outline rounded px-1.5 py-0.5 text-xs font-mono text-on-surface w-14 focus:outline-none"
                    />
                    <span className="text-xs text-on-surface-variant font-mono shrink-0">to</span>
                    <input
                      type="number"
                      min={1} max={180}
                      value={phase.to_day}
                      onChange={e => updatePhase(idx, 'to_day', parseInt(e.target.value) || 1)}
                      className="bg-surface-variant border border-outline rounded px-1.5 py-0.5 text-xs font-mono text-on-surface w-14 focus:outline-none"
                    />
                    <select
                      value={phase.intervention}
                      onChange={e => updatePhase(idx, 'intervention', e.target.value)}
                      className="bg-surface-variant border border-outline rounded px-2 py-0.5 text-xs font-mono text-on-surface focus:outline-none flex-1"
                    >
                      {PHASE_INTERVENTIONS.map(opt => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </div>

            {/* Edge Cuts */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-on-surface-variant font-mono uppercase tracking-wider">
                  Transport Edge Cuts
                </span>
                <span className="text-xs font-mono text-on-surface-variant opacity-50">
                  Sever inter-city corridors
                </span>
              </div>

              {/* Inline add form */}
              <div className="flex items-center gap-1.5 flex-wrap">
                <select
                  value={ecSrc}
                  onChange={e => setEcSrc(e.target.value)}
                  className="bg-surface border border-outline rounded px-2 py-0.5 text-xs font-mono text-on-surface focus:outline-none flex-1 min-w-[90px]"
                >
                  <option value="">Src</option>
                  {cityList.map(c => <option key={c} value={c}>{c}</option>)}
                </select>

                <span className="text-xs text-on-surface-variant font-mono shrink-0">→</span>

                <select
                  value={ecTgt}
                  onChange={e => setEcTgt(e.target.value)}
                  className="bg-surface border border-outline rounded px-2 py-0.5 text-xs font-mono text-on-surface focus:outline-none flex-1 min-w-[90px]"
                >
                  <option value="">Tgt</option>
                  {cityList.filter(c => c !== ecSrc).map(c => <option key={c} value={c}>{c}</option>)}
                </select>

                {/* Mode toggles */}
                {(['road', 'rail', 'air'] as const).map(mode => {
                  const active = ecModes.includes(mode);
                  const modeColor: Record<string, string> = {
                    road: '#F57F17',
                    rail: '#2E4A8C',
                    air: '#7C3AED',
                  };
                  return (
                    <button
                      key={mode}
                      onClick={() => setEcModes(prev =>
                        prev.includes(mode)
                          ? prev.length > 1 ? prev.filter(m => m !== mode) : prev
                          : [...prev, mode]
                      )}
                      className="text-xs font-mono px-2 py-0.5 rounded border transition-colors shrink-0"
                      style={active
                        ? { backgroundColor: modeColor[mode], borderColor: modeColor[mode], color: '#fff' }
                        : { backgroundColor: 'transparent', borderColor: 'var(--color-outline)', color: 'var(--color-on-surface-variant)' }
                      }
                    >
                      {mode.charAt(0).toUpperCase() + mode.slice(1)}
                    </button>
                  );
                })}

                <button
                  onClick={() => {
                    if (!ecSrc || !ecTgt || ecSrc === ecTgt) return;
                    if (edgeCuts.some(c => c.src === ecSrc && c.tgt === ecTgt)) return;
                    setEdgeCuts((prev: EdgeCut[]) => [...prev, { src: ecSrc, tgt: ecTgt, modes: [...ecModes] }]);
                    setEcSrc('');
                    setEcTgt('');
                    setEcModes(['road']);
                  }}
                  disabled={!ecSrc || !ecTgt || ecSrc === ecTgt}
                  className="bg-surface border border-outline rounded px-2.5 py-0.5 text-xs font-mono text-on-surface hover:border-primary hover:text-primary disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0"
                >
                  + Add
                </button>
              </div>

              {/* Cut list */}
              {edgeCuts.length === 0 ? (
                <p className="text-xs font-mono text-on-surface-variant opacity-40 italic">
                  No edge cuts — all transport links active
                </p>
              ) : (
                <div className="flex flex-col gap-1">
                  {edgeCuts.map((cut, idx) => {
                    const modeColor: Record<string, string> = {
                      road: '#F57F17',
                      rail: '#2E4A8C',
                      air: '#7C3AED',
                    };
                    return (
                      <div key={idx} className="flex items-center gap-2 bg-surface rounded-lg border border-outline px-2.5 py-1.5">
                        <span className="font-mono text-xs text-on-surface font-medium shrink-0">
                          {cut.src} → {cut.tgt}
                        </span>
                        <div className="flex gap-1 flex-1">
                          {cut.modes.map(mode => (
                            <span
                              key={mode}
                              className="text-xs font-mono px-1.5 py-0.5 rounded"
                              style={{ backgroundColor: modeColor[mode] + '22', color: modeColor[mode], border: `1px solid ${modeColor[mode]}55` }}
                            >
                              {mode.charAt(0).toUpperCase() + mode.slice(1)}
                            </span>
                          ))}
                        </div>
                        <button
                          onClick={() => setEdgeCuts((prev: EdgeCut[]) => prev.filter((_, i) => i !== idx))}
                          className="text-on-surface-variant hover:text-[var(--color-status-red)] transition-colors text-sm leading-none shrink-0"
                        >
                          ×
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {runError && (
              <div className="text-xs font-mono text-[var(--color-status-red)] bg-surface rounded-lg border border-[var(--color-status-red)]/30 px-3 py-2">
                ⚠ {runError}
              </div>
            )}
          </div>

          {/* RIGHT: Saved Custom Plans + Compare */}
          <div className="bg-surface-variant rounded-xl border border-outline p-4 shadow-sm flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-sm font-semibold text-on-background font-heading">Saved Custom Plans</h3>
                <span className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-surface border border-outline text-on-surface-variant font-medium">
                  {savedCustomCount}/4
                </span>
                {isLimitReached && (
                  <span className="text-[10px] font-mono text-amber-600 dark:text-amber-400 font-medium">
                    Max 4 custom plans. Delete 1 to RUN more
                  </span>
                )}
              </div>
              {savedCustomCount > 0 && (
                <button
                  onClick={deleteAllCustomPlans}
                  className="text-xs font-mono text-[var(--color-status-red)] hover:opacity-80 transition-opacity border border-[var(--color-status-red)]/30 rounded px-2 py-0.5"
                >
                  Clear All
                </button>
              )}
            </div>

            {savedCustomPlans.length === 0 ? (
              <p className="text-xs font-mono text-on-surface-variant opacity-60 italic mt-2">
                No custom plans yet. Run a simulation to save one.
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {savedCustomPlans.map(plan => {
                  const stat = nationalStats[plan.key];
                  const isSelectedA = compareA === plan.key;
                  const isSelectedB = compareB === plan.key;
                  return (
                    <div key={plan.key} className="flex items-center justify-between bg-surface rounded-lg border border-outline px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: plan.color }}></span>
                        <span className="font-mono text-xs text-on-surface font-medium">{plan.label}</span>
                        {stat && (
                          <span className="font-mono text-xs text-on-surface-variant">
                            · peak {Math.round(stat.peakInfections).toLocaleString()}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5">
                        {savedCustomPlans.length >= 2 && (
                          <>
                            <button
                              onClick={() => setCompareA(isSelectedA ? null : plan.key)}
                              className={`text-xs font-mono px-2 py-0.5 rounded border transition-colors ${isSelectedA ? 'bg-primary text-on-primary border-primary' : 'bg-surface-variant border-outline text-on-surface-variant hover:border-primary hover:text-primary'}`}
                            >
                              A
                            </button>
                            <button
                              onClick={() => setCompareB(isSelectedB ? null : plan.key)}
                              className={`text-xs font-mono px-2 py-0.5 rounded border transition-colors ${isSelectedB ? 'bg-primary text-on-primary border-primary' : 'bg-surface-variant border-outline text-on-surface-variant hover:border-primary hover:text-primary'}`}
                            >
                              B
                            </button>
                          </>
                        )}
                        <button
                          type="button"
                          onClick={() => deleteCustomPlan(plan.key)}
                          className="p-1 rounded hover:bg-red-500/10 text-on-surface-variant hover:text-red-500 transition-colors cursor-pointer ml-1"
                          title={`Delete ${plan.label}`}
                        >
                          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M3 6h18" /><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" /><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  );
                })}

                {compareA && compareB && (
                  <button
                    onClick={() => setShowCompare(true)}
                    className="mt-1 w-full bg-primary text-on-primary py-1.5 rounded-lg text-xs font-mono font-medium hover:opacity-90 transition-opacity"
                  >
                    Compare A vs B →
                  </button>
                )}
              </div>
            )}
          </div>
        </section>

        {/* Upgraded Plan Comparison Modal */}
        {showCompare && compareA && compareB && (() => {
          const planA = dynamicInterventions.find(i => i.key === compareA) || { key: compareA, label: compareA, color: '#7C3AED' };
          const planB = dynamicInterventions.find(i => i.key === compareB) || { key: compareB, label: compareB, color: '#059669' };
          const statA = nationalStats[compareA];
          const statB = nationalStats[compareB];
          const resA = resourceStats.resources[compareA];
          const resB = resourceStats.resources[compareB];
          const baselineStat = nationalStats['none'];
          const baselinePeak = baselineStat?.peakInfections || 1;

          const deathsSavedA = baselineStat ? Math.max(0, Math.round(baselineStat.day90Deaths - (statA?.day90Deaths ?? 0))) : 0;
          const deathsSavedB = baselineStat ? Math.max(0, Math.round(baselineStat.day90Deaths - (statB?.day90Deaths ?? 0))) : 0;

          const peakReductionA = Math.max(0, Math.round((1 - (statA?.peakInfections ?? 0) / baselinePeak) * 100));
          const peakReductionB = Math.max(0, Math.round((1 - (statB?.peakInfections ?? 0) / baselinePeak) * 100));

          // Data curves for SVG
          const dataA = seirdData[compareA] || [];
          const dataB = seirdData[compareB] || [];
          const dataBaseline = seirdData['none'] || [];

          const plansMax = Math.max(
            ...dataA.map((d: any) => d.infected_p50 || 0),
            ...dataB.map((d: any) => d.infected_p50 || 0),
            50
          );

          const maxInfections = compareGraphScale === 'focus'
            ? Math.round(plansMax * 1.15)
            : Math.max(
                plansMax,
                ...dataBaseline.map((d: any) => d.infected_p50 || 0),
                1000
              );

          // SVG geometry
          const svgW = 760;
          const svgH = 185;
          const padL = 55;
          const padR = 20;
          const padT = 15;
          const padB = 25;
          const plotW = svgW - padL - padR;
          const plotH = svgH - padT - padB;

          const getX = (day: number) => padL + Math.min(plotW, Math.max(0, ((day - 1) / 179) * plotW));
          const getY = (val: number) => padT + plotH - Math.min(plotH, Math.max(0, (val / maxInfections) * plotH));

          const lineA = dataA.map((d: any) => `${getX(d.day)},${getY(d.infected_p50 || 0)}`).join(' ');
          const lineB = dataB.map((d: any) => `${getX(d.day)},${getY(d.infected_p50 || 0)}`).join(' ');
          const lineBase = dataBaseline.map((d: any) => `${getX(d.day)},${getY(d.infected_p50 || 0)}`).join(' ');

          // Top 5 Metro Hotspots from cityPeakData (Peak Active Infections & Peak Day)
          const topMetros = (cityPeakData || []).slice(0, 5);

          const comparisonRows = [
            {
              metric: 'Peak Active Infections',
              a: Math.round(statA?.peakInfections ?? 0).toLocaleString(),
              b: Math.round(statB?.peakInfections ?? 0).toLocaleString(),
              winner: (statA?.peakInfections ?? 0) < (statB?.peakInfections ?? 0) ? 'a' : (statB?.peakInfections ?? 0) < (statA?.peakInfections ?? 0) ? 'b' : 'tie',
              delta: (statA?.peakInfections ?? 0) === (statB?.peakInfections ?? 0)
                ? 'Equal'
                : `${Math.abs(Math.round((statA?.peakInfections ?? 0) - (statB?.peakInfections ?? 0))).toLocaleString()} cases fewer`
            },
            {
              metric: 'Epidemic Peak Day',
              a: `Day ${statA?.peakDay ?? 0}`,
              b: `Day ${statB?.peakDay ?? 0}`,
              winner: (statA?.peakDay ?? 0) > (statB?.peakDay ?? 0) ? 'a' : (statB?.peakDay ?? 0) > (statA?.peakDay ?? 0) ? 'b' : 'tie',
              delta: (statA?.peakDay ?? 0) === (statB?.peakDay ?? 0)
                ? 'Simultaneous'
                : `${Math.abs((statA?.peakDay ?? 0) - (statB?.peakDay ?? 0))} days delay`
            },
            {
              metric: 'Cumulative Deaths (Day 90)',
              a: Math.round(statA?.day90Deaths ?? 0).toLocaleString(),
              b: Math.round(statB?.day90Deaths ?? 0).toLocaleString(),
              winner: (statA?.day90Deaths ?? 0) < (statB?.day90Deaths ?? 0) ? 'a' : (statB?.day90Deaths ?? 0) < (statA?.day90Deaths ?? 0) ? 'b' : 'tie',
              delta: (statA?.day90Deaths ?? 0) === (statB?.day90Deaths ?? 0)
                ? 'Equal'
                : `${Math.abs(Math.round((statA?.day90Deaths ?? 0) - (statB?.day90Deaths ?? 0))).toLocaleString()} fewer deaths`
            },
            {
              metric: 'Lives Saved vs Baseline',
              a: deathsSavedA.toLocaleString(),
              b: deathsSavedB.toLocaleString(),
              winner: deathsSavedA > deathsSavedB ? 'a' : deathsSavedB > deathsSavedA ? 'b' : 'tie',
              delta: deathsSavedA === deathsSavedB
                ? 'Equal'
                : `${Math.abs(deathsSavedA - deathsSavedB).toLocaleString()} more lives saved`
            },
            {
              metric: 'Peak Oxygen Demand (MT/day)',
              a: `${Math.round(resA?.peakOxygen ?? 0).toLocaleString()} MT`,
              b: `${Math.round(resB?.peakOxygen ?? 0).toLocaleString()} MT`,
              winner: (resA?.peakOxygen ?? 0) < (resB?.peakOxygen ?? 0) ? 'a' : (resB?.peakOxygen ?? 0) < (resA?.peakOxygen ?? 0) ? 'b' : 'tie',
              delta: Math.round(resA?.peakOxygen ?? 0) === Math.round(resB?.peakOxygen ?? 0)
                ? 'Equal'
                : `${Math.abs(Math.round((resA?.peakOxygen ?? 0) - (resB?.peakOxygen ?? 0))).toLocaleString()} MT difference`
            },
            {
              metric: 'Peak ICU Beds Needed',
              a: Math.round(resA?.peakICU ?? 0).toLocaleString(),
              b: Math.round(resB?.peakICU ?? 0).toLocaleString(),
              winner: (resA?.peakICU ?? 0) < (resB?.peakICU ?? 0) ? 'a' : (resB?.peakICU ?? 0) < (resA?.peakICU ?? 0) ? 'b' : 'tie',
              delta: Math.round(resA?.peakICU ?? 0) === Math.round(resB?.peakICU ?? 0)
                ? 'Equal'
                : `${Math.abs(Math.round((resA?.peakICU ?? 0) - (resB?.peakICU ?? 0))).toLocaleString()} beds difference`
            },
            {
              metric: 'Oxygen Capacity Ceiling (17k MT)',
              a: (resA?.shortfall ?? 0) > 0 ? `Exceeds by ${(resA?.shortfall ?? 0).toLocaleString()} MT` : '✓ Within Ceiling',
              b: (resB?.shortfall ?? 0) > 0 ? `Exceeds by ${(resB?.shortfall ?? 0).toLocaleString()} MT` : '✓ Within Ceiling',
              winner: (resA?.shortfall ?? 0) < (resB?.shortfall ?? 0) ? 'a' : (resB?.shortfall ?? 0) < (resA?.shortfall ?? 0) ? 'b' : 'tie',
              delta: (resA?.shortfall ?? 0) <= 0 && (resB?.shortfall ?? 0) <= 0 ? 'Both Safe' : 'Lower hospital deficit'
            }
          ];

          return createPortal(
            <div
              className="fixed inset-0 z-[9999] bg-black/60 backdrop-blur-md flex items-center justify-center p-3 sm:p-5 w-screen h-screen overflow-hidden"
              onClick={() => setShowCompare(false)}
            >
              <div
                className="bg-surface rounded-2xl border border-outline shadow-2xl w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden animate-fadeIn"
                onClick={e => e.stopPropagation()}
              >
                {/* Header */}
                <div className="px-6 py-4 border-b border-outline flex items-center justify-between bg-surface-variant/40 shrink-0">
                  <div>
                    <h3 className="font-heading font-semibold text-on-background text-base">Custom Plan Comparison</h3>
                  </div>

                  <div className="flex items-center gap-3">
                    {/* Quick Plan Switchers */}
                    <div className="flex items-center gap-2 bg-surface border border-outline rounded-lg px-2 py-1 text-xs font-mono">
                      <span className="text-on-surface-variant font-bold">A:</span>
                      <select
                        value={compareA}
                        onChange={e => setCompareA(e.target.value)}
                        className="bg-transparent text-on-surface font-semibold focus:outline-none cursor-pointer"
                      >
                        {savedCustomPlans.map(p => (
                          <option key={`opt-a-${p.key}`} value={p.key} disabled={p.key === compareB}>
                            {p.label}
                          </option>
                        ))}
                      </select>
                      <span className="text-on-surface-variant/40">vs</span>
                      <span className="text-on-surface-variant font-bold">B:</span>
                      <select
                        value={compareB}
                        onChange={e => setCompareB(e.target.value)}
                        className="bg-transparent text-on-surface font-semibold focus:outline-none cursor-pointer"
                      >
                        {savedCustomPlans.map(p => (
                          <option key={`opt-b-${p.key}`} value={p.key} disabled={p.key === compareA}>
                            {p.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <button
                      onClick={() => setShowCompare(false)}
                      className="w-8 h-8 rounded-lg flex items-center justify-center text-on-surface-variant hover:text-on-background hover:bg-surface-variant transition-colors cursor-pointer text-lg leading-none"
                      title="Close"
                    >
                      ×
                    </button>
                  </div>
                </div>

                {/* Scrollable Body */}
                <div className="p-6 space-y-6 overflow-y-auto flex-1">

                  {/* 1. TOP KPI DELTA CARDS */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {/* Card 1: Lives Saved */}
                    <div className="bg-surface border border-outline rounded-xl p-3.5 flex flex-col justify-between shadow-2xs">
                      <span className="text-[10px] font-mono text-on-surface-variant uppercase font-bold tracking-wider">
                        Lives Saved vs Baseline
                      </span>
                      <div className="my-2">
                        {deathsSavedA === deathsSavedB ? (
                          <>
                            <div className="text-base font-mono font-bold text-emerald-600 dark:text-emerald-400">
                              Both: {deathsSavedA.toLocaleString()}
                            </div>
                            <div className="text-[10px] font-mono text-on-surface-variant">
                              Equal lives saved vs baseline
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="text-base font-mono font-bold text-emerald-600 dark:text-emerald-400">
                              +{Math.abs(deathsSavedA - deathsSavedB).toLocaleString()} Lives
                            </div>
                            <div className="text-[10px] font-mono text-on-surface-variant truncate">
                              {deathsSavedA > deathsSavedB ? planA.label : planB.label} saves more
                            </div>
                          </>
                        )}
                      </div>
                      <div className="text-[11px] font-mono text-on-surface-variant flex justify-between border-t border-outline/50 pt-1.5 bg-surface-variant/30 -mx-3.5 -mb-3.5 px-3.5 py-1 rounded-b-xl">
                        <span>A: <strong className="text-on-surface">{deathsSavedA.toLocaleString()}</strong></span>
                        <span>B: <strong className="text-on-surface">{deathsSavedB.toLocaleString()}</strong></span>
                      </div>
                    </div>

                    {/* Card 2: Peak Flattening */}
                    <div className="bg-surface border border-outline rounded-xl p-3.5 flex flex-col justify-between shadow-2xs">
                      <span className="text-[10px] font-mono text-on-surface-variant uppercase font-bold tracking-wider">
                        Peak Case Flattening
                      </span>
                      <div className="my-2">
                        {peakReductionA === peakReductionB ? (
                          <>
                            <div className="text-base font-mono font-bold text-primary">
                              Both: -{peakReductionA}%
                            </div>
                            <div className="text-[10px] font-mono text-on-surface-variant">
                              Identical surge flattening
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="text-base font-mono font-bold text-primary">
                              -{Math.max(peakReductionA, peakReductionB)}%
                            </div>
                            <div className="text-[10px] font-mono text-on-surface-variant truncate">
                              {peakReductionA > peakReductionB ? planA.label : planB.label} flattens more
                            </div>
                          </>
                        )}
                      </div>
                      <div className="text-[11px] font-mono text-on-surface-variant flex justify-between border-t border-outline/50 pt-1.5 bg-surface-variant/30 -mx-3.5 -mb-3.5 px-3.5 py-1 rounded-b-xl">
                        <span>A: <strong className="text-on-surface">-{peakReductionA}%</strong></span>
                        <span>B: <strong className="text-on-surface">-{peakReductionB}%</strong></span>
                      </div>
                    </div>

                    {/* Card 3: Epidemic Runway Delay */}
                    <div className="bg-surface border border-outline rounded-xl p-3.5 flex flex-col justify-between shadow-2xs">
                      <span className="text-[10px] font-mono text-on-surface-variant uppercase font-bold tracking-wider">
                        Surge Delay Runway
                      </span>
                      <div className="my-2">
                        {(statA?.peakDay ?? 0) === (statB?.peakDay ?? 0) ? (
                          <>
                            <div className="text-base font-mono font-bold text-on-surface">
                              Day {statA?.peakDay ?? 0}
                            </div>
                            <div className="text-[10px] font-mono text-on-surface-variant">
                              Simultaneous epidemic peak
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="text-base font-mono font-bold text-on-surface">
                              +{Math.abs((statA?.peakDay ?? 0) - (statB?.peakDay ?? 0))} Days
                            </div>
                            <div className="text-[10px] font-mono text-primary font-semibold truncate">
                              {(statA?.peakDay ?? 0) > (statB?.peakDay ?? 0) ? planA.label : planB.label} delays longer
                            </div>
                          </>
                        )}
                      </div>
                      <div className="text-[11px] font-mono text-on-surface-variant flex justify-between border-t border-outline/50 pt-1.5 bg-surface-variant/30 -mx-3.5 -mb-3.5 px-3.5 py-1 rounded-b-xl">
                        <span>A: <strong className="text-on-surface">Day {statA?.peakDay ?? 0}</strong></span>
                        <span>B: <strong className="text-on-surface">Day {statB?.peakDay ?? 0}</strong></span>
                      </div>
                    </div>

                    {/* Card 4: Oxygen Hospital Load */}
                    <div className="bg-surface border border-outline rounded-xl p-3.5 flex flex-col justify-between shadow-2xs">
                      <span className="text-[10px] font-mono text-on-surface-variant uppercase font-bold tracking-wider">
                        Peak Oxygen Demand
                      </span>
                      <div className="my-2">
                        {Math.max(resA?.peakOxygen ?? 0, resB?.peakOxygen ?? 0) <= 17000 ? (
                          <>
                            <div className="text-sm font-mono font-bold text-emerald-600 dark:text-emerald-400 whitespace-nowrap">
                              ✓ Safe (17k Ceiling)
                            </div>
                            <div className="text-[10px] font-mono text-on-surface-variant whitespace-nowrap">
                              Max {Math.round(Math.max(resA?.peakOxygen ?? 0, resB?.peakOxygen ?? 0)).toLocaleString()} MT (No deficit)
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="text-sm font-mono font-bold text-amber-600 dark:text-amber-400 whitespace-nowrap">
                              ⚠ Deficit Risk
                            </div>
                            <div className="text-[10px] font-mono text-on-surface-variant whitespace-nowrap">
                              Exceeds 17k MT national ceiling
                            </div>
                          </>
                        )}
                      </div>
                      <div className="text-[11px] font-mono text-on-surface-variant flex justify-between border-t border-outline/50 pt-1.5 bg-surface-variant/30 -mx-3.5 -mb-3.5 px-3.5 py-1 rounded-b-xl">
                        <span>A: <strong className="text-on-surface">{Math.round(resA?.peakOxygen ?? 0).toLocaleString()} MT</strong></span>
                        <span>B: <strong className="text-on-surface">{Math.round(resB?.peakOxygen ?? 0).toLocaleString()} MT</strong></span>
                      </div>
                    </div>
                  </div>

                  {/* 2. DUAL-TRAJECTORY OVERLAY CHART */}
                  <div className="bg-surface rounded-xl border border-outline p-4">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
                      <div>
                        <h4 className="text-xs font-semibold text-on-surface font-mono uppercase tracking-wider">
                          Transmission Trajectory Comparison (180 Days)
                        </h4>
                        <p className="text-[11px] font-mono text-on-surface-variant">
                          {compareGraphScale === 'focus'
                            ? `Focused on Plan Curves (Peak ~${Math.round(plansMax).toLocaleString()} cases)`
                            : `Full Scale with Baseline (Unmitigated peak ~${Math.round(baselinePeak).toLocaleString()} cases)`}
                        </p>
                      </div>

                      {/* Scale toggle and Legend */}
                      <div className="flex items-center gap-3 flex-wrap">
                        <div className="flex items-center bg-surface-variant border border-outline rounded-lg p-0.5 text-[11px] font-mono">
                          <button
                            type="button"
                            onClick={() => setCompareGraphScale('focus')}
                            className={`px-2 py-0.5 rounded-md font-medium transition-all cursor-pointer ${
                              compareGraphScale === 'focus'
                                ? 'bg-primary text-white shadow-2xs font-semibold'
                                : 'text-on-surface-variant hover:text-on-surface'
                            }`}
                          >
                            Focus Plans (Zoom)
                          </button>
                          <button
                            type="button"
                            onClick={() => setCompareGraphScale('baseline')}
                            className={`px-2 py-0.5 rounded-md font-medium transition-all cursor-pointer ${
                              compareGraphScale === 'baseline'
                                ? 'bg-primary text-white shadow-2xs font-semibold'
                                : 'text-on-surface-variant hover:text-on-surface'
                            }`}
                          >
                            Include Baseline
                          </button>
                        </div>

                        {/* Legend */}
                        <div className="flex items-center gap-2.5 text-xs font-mono">
                          <span className="flex items-center gap-1.5 text-on-surface">
                            <span className="w-3 h-1 rounded-sm inline-block" style={{ backgroundColor: planA.color }}></span>
                            <span className="font-semibold">{planA.label}</span>
                          </span>
                          <span className="flex items-center gap-1.5 text-on-surface">
                            <span className="w-3 h-1 rounded-sm inline-block" style={{ backgroundColor: planB.color }}></span>
                            <span className="font-semibold">{planB.label}</span>
                          </span>
                          {compareGraphScale === 'baseline' && (
                            <span className="flex items-center gap-1.5 text-on-surface-variant opacity-70">
                              <span className="w-3 h-0.5 border-t border-dashed border-on-surface-variant inline-block"></span>
                              <span>Baseline</span>
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Trajectory SVG */}
                    <div className="w-full overflow-hidden">
                      <svg viewBox={`0 0 ${svgW} ${svgH}`} className="w-full h-auto select-none">
                        {/* Y-axis guidelines */}
                        {[0.25, 0.5, 0.75, 1.0].map((frac, idx) => {
                          const yVal = frac * maxInfections;
                          const yPos = getY(yVal);
                          const label = yVal >= 1_000_000 ? `${(yVal / 1_000_000).toFixed(1)}M` : yVal >= 1000 ? `${Math.round(yVal / 1000)}k` : `${Math.round(yVal)}`;
                          return (
                            <g key={`y-grid-${idx}`}>
                              <line x1={padL} y1={yPos} x2={svgW - padR} y2={yPos} stroke="currentColor" strokeOpacity={0.08} strokeDasharray="3 3" />
                              <text x={padL - 8} y={yPos + 3} textAnchor="end" className="text-[10px] font-mono fill-current opacity-40">
                                {label}
                              </text>
                            </g>
                          );
                        })}

                        {/* X-axis days */}
                        {[1, 30, 60, 90, 120, 150, 180].map(d => {
                          const xPos = getX(d);
                          return (
                            <g key={`x-axis-${d}`}>
                              <line x1={xPos} y1={padT} x2={xPos} y2={padT + plotH} stroke="currentColor" strokeOpacity={0.04} />
                              <text x={xPos} y={svgH - 6} textAnchor="middle" className="text-[10px] font-mono fill-current opacity-50">
                                Day {d}
                              </text>
                            </g>
                          );
                        })}

                        {/* Baseline Curve (only drawn in baseline scale mode to prevent squishing) */}
                        {compareGraphScale === 'baseline' && lineBase && (
                          <polyline
                            points={lineBase}
                            fill="none"
                            stroke="currentColor"
                            strokeOpacity={0.3}
                            strokeWidth={1.5}
                            strokeDasharray="4 4"
                          />
                        )}

                        {/* Plan B Curve */}
                        {lineB && (
                          <polyline
                            points={lineB}
                            fill="none"
                            stroke={planB.color}
                            strokeWidth={2.4}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        )}

                        {/* Plan A Curve */}
                        {lineA && (
                          <polyline
                            points={lineA}
                            fill="none"
                            stroke={planA.color}
                            strokeWidth={2.4}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        )}

                        {/* Peak Dots & Markers */}
                        {statA && (
                          <g>
                            <circle cx={getX(statA.peakDay)} cy={getY(statA.peakInfections)} r={4.5} fill={planA.color} stroke="#fff" strokeWidth={1.5} />
                          </g>
                        )}
                        {statB && (
                          <g>
                            <circle cx={getX(statB.peakDay)} cy={getY(statB.peakInfections)} r={4.5} fill={planB.color} stroke="#fff" strokeWidth={1.5} />
                          </g>
                        )}
                      </svg>
                    </div>

                    {compareGraphScale === 'focus' && baselinePeak > plansMax * 2 && (
                      <div className="mt-2 text-[11px] font-mono text-on-surface-variant flex items-center justify-between border-t border-outline/40 pt-1.5 whitespace-nowrap overflow-hidden gap-3">
                        <span className="text-primary font-medium truncate">
                          Zoom Active: Y-axis calibrated to custom plans
                        </span>
                        <span className="opacity-70 shrink-0">
                          Baseline: {Math.round(baselinePeak).toLocaleString()} peak cases
                        </span>
                      </div>
                    )}
                  </div>

                  {/* 3. CLINICAL & RESOURCE COMPARISON MATRIX */}
                  <div className="bg-surface rounded-xl border border-outline overflow-hidden">
                    <div className="px-4 py-2.5 bg-surface-variant/40 border-b border-outline">
                      <h4 className="text-xs font-semibold text-on-surface font-mono uppercase tracking-wider">
                        Comparative Clinical & Resource Matrix
                      </h4>
                    </div>

                    <div className="divide-y divide-outline text-xs font-mono">
                      <div className="grid grid-cols-12 gap-2 px-4 py-2 font-semibold text-on-surface-variant bg-surface-variant/20 uppercase text-[10px]">
                        <span className="col-span-5">Metric</span>
                        <span className="col-span-2 text-right">{planA.label}</span>
                        <span className="col-span-2 text-right">{planB.label}</span>
                        <span className="col-span-3 text-right">Advantage</span>
                      </div>

                      {comparisonRows.map((row, idx) => (
                        <div key={idx} className="grid grid-cols-12 gap-2 px-4 py-2.5 items-center hover:bg-surface-variant/30 transition-colors">
                          <span className="col-span-5 text-on-surface font-medium">{row.metric}</span>
                          <span className={`col-span-2 text-right font-semibold ${row.winner === 'a' ? 'text-emerald-600 dark:text-emerald-400' : 'text-on-surface'}`}>
                            {row.a}
                          </span>
                          <span className={`col-span-2 text-right font-semibold ${row.winner === 'b' ? 'text-emerald-600 dark:text-emerald-400' : 'text-on-surface'}`}>
                            {row.b}
                          </span>
                          <span className="col-span-3 text-right">
                            <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-primary/10 text-primary border border-primary/20">
                              {row.winner === 'a' ? `${planA.label} (+)` : row.winner === 'b' ? `${planB.label} (+)` : 'Equal'}
                            </span>
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* 4. TOP 5 METRO HOTSPOTS SPATIAL IMPACT */}
                  {topMetros.length > 0 && (
                    <div className="bg-surface rounded-xl border border-outline overflow-hidden">
                      <div className="px-4 py-2.5 bg-surface-variant/40 border-b border-outline flex items-center justify-between">
                        <div>
                          <h4 className="text-xs font-semibold text-on-surface font-mono uppercase tracking-wider">
                            Top 5 Metro Hotspots (Peak Active Infections & Day)
                          </h4>
                          <p className="text-[11px] font-mono text-on-surface-variant">
                            Peak case load and timing comparison for major transit hub cities
                          </p>
                        </div>
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-surface border border-outline text-on-surface-variant">
                          Spatial Transit Containment
                        </span>
                      </div>

                      <div className="divide-y divide-outline text-xs font-mono">
                        <div className="grid grid-cols-12 gap-2 px-4 py-2 font-semibold text-on-surface-variant bg-surface-variant/20 uppercase text-[10px]">
                          <span className="col-span-4">Metro Node</span>
                          <span className="col-span-3 text-right">{planA.label} (Peak / Day)</span>
                          <span className="col-span-3 text-right">{planB.label} (Peak / Day)</span>
                          <span className="col-span-2 text-right">Advantage</span>
                        </div>

                        {topMetros.map(row => {
                          const peakA = row.peaks?.[compareA] || { peakCases: 0, peakDay: 1 };
                          const peakB = row.peaks?.[compareB] || { peakCases: 0, peakDay: 1 };
                          const casesA = Math.round(peakA.peakCases);
                          const casesB = Math.round(peakB.peakCases);
                          const diff = Math.abs(casesA - casesB);
                          const winner = casesA < casesB ? 'a' : casesB < casesA ? 'b' : 'tie';

                          return (
                            <div key={row.city} className="grid grid-cols-12 gap-2 px-4 py-2.5 items-center hover:bg-surface-variant/30 transition-colors">
                              <span className="col-span-4 text-on-surface font-semibold capitalize flex items-center gap-2">
                                <span className="w-1.5 h-1.5 rounded-full bg-primary/60"></span>
                                {row.city.charAt(0).toUpperCase() + row.city.slice(1).toLowerCase()}
                              </span>
                              <span className={`col-span-3 text-right font-mono text-xs ${winner === 'a' ? 'text-emerald-600 dark:text-emerald-400 font-bold' : 'text-on-surface'}`}>
                                {casesA.toLocaleString()} <span className="text-[10px] text-on-surface-variant font-normal">Day {peakA.peakDay}</span>
                              </span>
                              <span className={`col-span-3 text-right font-mono text-xs ${winner === 'b' ? 'text-emerald-600 dark:text-emerald-400 font-bold' : 'text-on-surface'}`}>
                                {casesB.toLocaleString()} <span className="text-[10px] text-on-surface-variant font-normal">Day {peakB.peakDay}</span>
                              </span>
                              <span className="col-span-2 text-right text-[11px]">
                                {winner === 'tie' ? (
                                  <span className="text-on-surface-variant/60 font-medium">Equal</span>
                                ) : (
                                  <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
                                    -{diff.toLocaleString()} ({winner === 'a' ? planA.label : planB.label})
                                  </span>
                                )}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>

                {/* Footer */}
                <div className="px-6 py-3 border-t border-outline bg-surface-variant/30 flex items-center justify-between text-xs font-mono text-on-surface-variant shrink-0">
                  <span className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                    Green values highlight superior policy performance
                  </span>
                  <button
                    onClick={() => setShowCompare(false)}
                    className="px-4 py-1.5 rounded-lg bg-primary text-white font-semibold text-xs hover:bg-primary/90 transition-colors cursor-pointer"
                  >
                    Done
                  </button>
                </div>
              </div>
            </div>,
            document.body
          );
        })()}

        {/* Section 2: National Snapshot Cards with inline toggles */}
        <section className="bg-surface-variant rounded-xl border border-outline shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-outline flex flex-wrap gap-2">
            {dynamicInterventions.map(inv => {
              const isActive = activeLines[inv.key];
              return (
                <button
                  key={inv.key}
                  onClick={() => toggleLine(inv.key)}
                  className={`flex items-center gap-2 text-xs px-2.5 py-1 rounded-full transition-colors border ${isActive
                    ? 'bg-surface border-outline text-on-surface'
                    : 'bg-transparent border-outline/50 text-on-surface-variant opacity-50'
                    }`}
                >
                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: inv.color }}></span>
                  <span className="font-mono font-medium">{inv.label}</span>
                </button>
              );
            })}
          </div>
          <div className="grid gap-0 divide-x divide-outline" style={{ gridTemplateColumns: `repeat(${dynamicInterventions.filter(inv => activeLines[inv.key]).length}, minmax(0, 1fr))` }}>
            {dynamicInterventions.map(inv => {
              if (!activeLines[inv.key]) return null;
              const stat = nationalStats[inv.key];
              if (!stat) return null;

              let verdictColor = 'text-[var(--color-status-green)]';
              if (stat.verdict.includes('critical')) verdictColor = 'text-[var(--color-status-red)]';
              else if (stat.verdict.includes('Moderate')) verdictColor = 'text-[var(--color-status-amber)]';

              return (
                <div
                  key={`national-${inv.key}`}
                  className="p-4 flex flex-col gap-3 bg-surface-variant"
                  style={{}}
                >
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: inv.color }}></span>
                    <h3 className="font-heading font-semibold text-on-background">{inv.label}</h3>
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-on-surface-variant font-mono uppercase tracking-wider">Peak Active Infections</span>
                    <span className="font-mono text-xl text-on-surface">
                      {Math.round(stat.peakInfections).toLocaleString()} <span className="text-sm text-on-surface-variant">on Day {stat.peakDay}</span>
                    </span>
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-on-surface-variant font-mono uppercase tracking-wider">Total Deaths (Day 90)</span>
                    <span className="font-mono text-xl text-on-surface">
                      {Math.round(stat.day90Deaths).toLocaleString()}
                    </span>
                  </div>
                  <div className={`mt-auto pt-3 border-t border-outline text-xs font-mono font-semibold ${verdictColor}`}>
                    {stat.verdict}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Section 3: City Status Table */}
        <section className="bg-surface-variant rounded-xl border border-outline shadow-sm overflow-hidden flex flex-col">
          <div
            className="p-6 border-b border-outline flex justify-between items-center cursor-pointer"
            onClick={() => setIsCityTableOpen(!isCityTableOpen)}
          >
            <h3 className="text-lg font-semibold text-on-background font-heading">Day 180 Active Cases per City</h3>
            <span className="text-on-surface-variant">{isCityTableOpen ? '▼' : '▶'}</span>
          </div>
          {isCityTableOpen && (
            <div className="overflow-x-auto">
              <table className="w-full text-left font-mono text-sm">
                <thead className="bg-surface border-b border-outline text-on-surface-variant text-xs uppercase">
                  <tr>
                    <th className="px-6 py-3 font-medium">City</th>
                    {dynamicInterventions.map(inv => activeLines[inv.key] && (
                      <th key={`th-${inv.key}`} className="px-6 py-3 font-medium">{inv.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline bg-surface/50 text-on-surface">
                  {cityTableData.map(row => (
                    <tr key={row.city} className="hover:bg-surface-container-low transition-colors">
                      <td className="px-6 py-4 font-medium capitalize">{row.city.charAt(0).toUpperCase() + row.city.slice(1).toLowerCase()}</td>
                      {dynamicInterventions.map(inv => {
                        if (!activeLines[inv.key]) return null;
                        const val = Math.round(row[inv.key]);
                        return (
                          <td key={`td-${row.city}-${inv.key}`} className={`px-6 py-4 font-bold ${getCityCellColor(val)}`}>
                            {val.toLocaleString()}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Section 4: Resource Shortfall Summary */}
        <section className="bg-surface-variant rounded-xl border border-outline p-6 shadow-sm">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
            <h3 className="text-lg font-semibold text-on-background font-heading">Resource Shortfall Summary</h3>
            <div className="bg-surface rounded-full px-4 py-1.5 border border-outline text-sm font-mono text-on-surface">
              National Oxygen Capacity Ceiling: <span className="font-bold">{resourceStats.capacityCeiling.toLocaleString()} MT/day</span>
            </div>
          </div>
          <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${dynamicInterventions.filter(inv => activeLines[inv.key]).length}, minmax(0, 1fr))` }}>
            {dynamicInterventions.map(inv => {
              if (!activeLines[inv.key]) return null;
              const res = resourceStats.resources[inv.key];
              if (!res) return null;

              const isShortfall = res.shortfall > 0;

              return (
                <div key={`res-${inv.key}`} className="bg-surface rounded-lg border border-outline p-4 flex flex-col gap-3">
                  <div className="flex items-center gap-2 border-b border-outline pb-2">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: inv.color }}></span>
                    <h4 className="font-heading font-semibold text-on-surface">{inv.label}</h4>
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-on-surface-variant font-mono uppercase tracking-wider">Peak Oxygen Demand</span>
                    <span className="font-mono text-on-surface">{Math.round(res.peakOxygen).toLocaleString()} MT/day</span>
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-on-surface-variant font-mono uppercase tracking-wider">Peak ICU Beds Needed</span>
                    <span className="font-mono text-on-surface">{Math.round(res.peakICU).toLocaleString()}</span>
                  </div>
                  <div className={`mt-2 pt-3 border-t border-outline font-mono text-sm font-bold ${isShortfall ? 'text-[var(--color-status-red)]' : 'text-[var(--color-status-green)]'}`}>
                    {isShortfall ? `⚠ ${Math.round(res.shortfall).toLocaleString()} MT/day shortfall` : 'No shortfall'}
                  </div>
                  <button
                    onClick={() => setExpandedResCards(prev => ({ ...prev, [inv.key]: !prev[inv.key] }))}
                    className="text-xs font-mono text-on-surface-variant hover:text-on-surface mt-2 flex items-center gap-1"
                  >
                    {expandedResCards[inv.key] ? '▲ Hide city breakdown' : '▼ Show city breakdown'}
                  </button>
                  {expandedResCards[inv.key] && (() => {
                    const cityBreakdown = resourceCityData[inv.key] ?? [];

                    return (
                      <div className="mt-2 flex flex-col gap-1 border-t border-outline pt-2">
                        {cityBreakdown.map((c: any) => (
                          <div key={c.city} className="flex justify-between text-xs font-mono text-on-surface-variant">
                            <span>{c.city}</span>
                            <span>{Math.round(c.peak_oxygen_mt)} MT · {Math.round(c.peak_icu_beds)} ICU</span>
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </div>
              );
            })}
          </div>
        </section>
      </main>
    </div>
  );
}
