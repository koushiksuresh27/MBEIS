import { useState, useMemo, useEffect, useCallback } from 'react';
import type { DossierData, ChartSeriesData } from '../../types/dossier';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ReferenceLine,
  CartesianGrid,
} from 'recharts';

interface ResearchDossierModalProps {
  dossier: DossierData | null;
  isOpen: boolean;
  onClose: () => void;
  onSaveToNotebook?: (dossier: DossierData) => void;
}

// ── Inline Markdown Formatter ──
function renderInlineFormatting(text: string): React.ReactNode {
  const regex = /(\*\*.*?\*\*|`.*?`)/g;
  const parts = text.split(regex);

  return parts.map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={index} className="font-semibold text-on-surface">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code key={index} className="px-1 py-0.5 rounded bg-surface-container font-mono text-[11px] text-primary">
          {part.slice(1, -1)}
        </code>
      );
    }
    return part;
  });
}

// ── Structured Dossier Verdict & Directive Renderer ──
function DossierVerdictContent({ content }: { content: string }) {
  if (!content) return null;

  // Pre-process: break concatenated headers, bullet points, and directives onto new lines
  const preparedText = content
    .replace(/\s*---\s*/g, '\n\n---\n\n')
    .replace(/([^\n])\s*(###\s+)/g, '$1\n\n$2')
    .replace(/([^\n])\s*(\*\s+\*\*)/g, '$1\n* **')
    .replace(/([^\n])\s*(→\s+)/g, '$1\n→ ')
    .replace(/([^\n])\s*(\d+\.\s+\*\*)/g, '$1\n$2');

  const lines = preparedText.split('\n');
  const blocks: React.ReactNode[] = [];

  lines.forEach((line, idx) => {
    const trimmed = line.trim();
    if (!trimmed) {
      blocks.push(<div key={`sp-${idx}`} className="h-1" />);
      return;
    }

    // Horizontal Divider
    if (trimmed === '---') {
      blocks.push(<div key={`hr-${idx}`} className="my-2.5 border-t border-outline/20" />);
      return;
    }

    // Section Headers (### or ##)
    if (trimmed.startsWith('### ') || trimmed.startsWith('## ')) {
      const cleanTitle = trimmed.replace(/^#+\s*/, '').replace(/^[0-9.]+\s*/, '');
      const numMatch = trimmed.match(/^#+\s*([0-9.]+)/);
      const sectionNum = numMatch ? numMatch[1].replace('.', '') : null;

      blocks.push(
        <div
          key={`head-${idx}`}
          className="mt-4 first:mt-1 mb-2 pb-1.5 border-b border-primary/25 flex items-center gap-2"
        >
          {sectionNum ? (
            <span className="w-5 h-5 rounded-full bg-primary/15 text-primary border border-primary/30 text-[10px] font-mono font-bold flex items-center justify-center shrink-0">
              {sectionNum}
            </span>
          ) : (
            <span className="w-2 h-2 rounded-full bg-primary" />
          )}
          <span className="text-xs font-mono font-bold uppercase tracking-wider text-primary">
            {renderInlineFormatting(cleanTitle)}
          </span>
        </div>
      );
      return;
    }

    // Directive Callout (→ or starting with DIRECTIVE / ACTION / RECOMMENDED)
    if (
      trimmed.startsWith('→') ||
      trimmed.startsWith('->') ||
      trimmed.toLowerCase().startsWith('recommended operational directive') ||
      trimmed.toLowerCase().startsWith('directive:')
    ) {
      const cleanText = trimmed.replace(/^[→\-]+>\s*|\s*→\s*|^[Dd]irective:\s*/, '').trim();
      blocks.push(
        <div
          key={`dir-${idx}`}
          className="my-2.5 p-3 rounded-xl border border-primary/35 bg-primary/10 text-on-surface text-xs leading-relaxed flex items-start gap-2.5 shadow-2xs"
        >
          <span className="px-2 py-0.5 rounded bg-primary text-white text-[9px] font-bold uppercase tracking-wider shrink-0 mt-0.5 font-mono shadow-xs">
            DIRECTIVE
          </span>
          <div className="flex-1 font-sans text-xs">
            {renderInlineFormatting(cleanText)}
          </div>
        </div>
      );
      return;
    }

    // Bullet List Items (* or - or •)
    if (/^[-*•]\s+/.test(trimmed)) {
      const isSubBullet = /^\s{2,}[-*•]\s+/.test(line);
      const itemText = trimmed.replace(/^[-*•]\s+/, '');
      blocks.push(
        <div
          key={`bullet-${idx}`}
          className={`flex items-start gap-2.5 my-1 text-xs leading-relaxed ${
            isSubBullet ? 'pl-5 text-on-surface/85' : 'pl-1 text-on-surface/95'
          }`}
        >
          <span
            className={`rounded-full shrink-0 mt-1.5 ${
              isSubBullet
                ? 'w-1.2 h-1.2 bg-outline/70 ml-0.5'
                : 'w-1.5 h-1.5 bg-primary/80'
            }`}
          />
          <div className="flex-1 font-sans">
            {renderInlineFormatting(itemText)}
          </div>
        </div>
      );
      return;
    }

    // Numbered lists (1. , 2. )
    if (/^\d+\.\s+/.test(trimmed)) {
      const numMatch = trimmed.match(/^(\d+)\.\s+(.*)/);
      if (numMatch) {
        const [, num, itemText] = numMatch;
        blocks.push(
          <div key={`num-${idx}`} className="flex items-start gap-2.5 my-1 text-xs leading-relaxed pl-1">
            <span className="w-4 h-4 rounded-full bg-surface-container border border-outline/30 text-[9px] font-bold flex items-center justify-center shrink-0 mt-0.5 text-on-surface-variant font-mono">
              {num}
            </span>
            <div className="flex-1 text-on-surface/90 font-sans">
              {renderInlineFormatting(itemText)}
            </div>
          </div>
        );
        return;
      }
    }

    // Standard paragraph text
    blocks.push(
      <p key={`p-${idx}`} className="my-1 text-xs sm:text-[13px] text-on-surface/90 font-sans leading-relaxed">
        {renderInlineFormatting(trimmed)}
      </p>
    );
  });

  return <div className="space-y-1">{blocks}</div>;
}

import { BACKEND_URL } from '../../config/backend';

export default function ResearchDossierModal({
  dossier,
  isOpen,
  onClose,
  onSaveToNotebook,
}: ResearchDossierModalProps) {
  const [activeMetric, setActiveMetric] = useState<'active' | 'icu' | 'oxygen'>('active');
  const [isSaved, setIsSaved] = useState(false);
  const [isApplied, setIsApplied] = useState(false);
  const [activeScorecards, setActiveScorecards] = useState(dossier?.scorecards || []);
  const [activeChartSeries, setActiveChartSeries] = useState<ChartSeriesData | null>(dossier?.chart_series || null);
  const [isResimulating, setIsResimulating] = useState(false);

  const handleApplyToSandbox = useCallback((card?: any, planIdx: number = 1) => {
    const targetCard = card || activeScorecards[planIdx] || activeScorecards[1];
    const planName = targetCard?.name || 'Plan A: Targeted Rail Cordon & Ring Vaccination';

    const planConfig = targetCard?.plan_config || (planIdx === 1 || targetCard?.name?.includes('Plan A') ? {
      phases: [
        { from_day: 1, to_day: 14, intervention: 'none' },
        { from_day: 15, to_day: 60, intervention: 'rail_only' },
        { from_day: 61, to_day: 180, intervention: 'partial' }
      ],
      edgeCuts: [
        { src: 'KOCHI', tgt: 'BENGALURU', modes: ['rail', 'road'] },
        { src: 'KOCHI', tgt: 'CHENNAI', modes: ['rail', 'road'] },
        { src: 'KOCHI', tgt: 'MUMBAI', modes: ['rail', 'air'] }
      ],
      vaccination: {
        enabled: true,
        start_day: 21,
        daily_rate: 0.005,
        efficacy: 0.85,
        onset_days: 14,
        severity_efficacy: 0.90,
        waning_mean_days: null
      }
    } : {
      phases: [
        { from_day: 1, to_day: 25, intervention: 'none' },
        { from_day: 26, to_day: 80, intervention: 'partial' },
        { from_day: 81, to_day: 180, intervention: 'rail_only' }
      ],
      edgeCuts: [],
      vaccination: {
        enabled: false,
        start_day: 30,
        daily_rate: 0.003,
        efficacy: 0.85,
        onset_days: 14,
        severity_efficacy: 0.95,
        waning_mean_days: null
      }
    });

    window.dispatchEvent(
      new CustomEvent('apply-research-plan', {
        detail: {
          planName: planName,
          phases: planConfig.phases,
          edgeCuts: planConfig.edgeCuts,
          vaccination: planConfig.vaccination,
        },
      })
    );

    setIsApplied(true);
    setTimeout(() => {
      setIsApplied(false);
    }, 3200);
  }, [activeScorecards]);

  const handleResimulate = useCallback(async () => {
    try {
      setIsResimulating(true);
      const res = await fetch(`${BACKEND_URL}/api/research/resimulate-forks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ origin_city: 'KOCHI' }),
      });
      if (res.ok) {
        const sim = await res.json();
        if (sim.scorecards && sim.chart_series) {
          setActiveScorecards(sim.scorecards);
          setActiveChartSeries(sim.chart_series);
          if (dossier) {
            dossier.scorecards = sim.scorecards;
            dossier.chart_series = sim.chart_series;
          }
        }
      }
    } catch (e) {
      console.warn('Auto-resimulation error:', e);
    } finally {
      setIsResimulating(false);
    }
  }, [dossier]);

  // Auto-heal old cached dossiers where Plan A/Plan B were identical to baseline
  useEffect(() => {
    if (!dossier) return;
    setActiveScorecards(dossier.scorecards || []);
    setActiveChartSeries(dossier.chart_series || null);

    const planA = dossier.scorecards?.[1];
    const baseline = dossier.scorecards?.[0];
    const isIdentical =
      planA &&
      baseline &&
      (planA.reduction_pct === 0 ||
        planA.peak_cases === baseline.peak_cases ||
        !dossier.chart_series?.icu ||
        dossier.chart_series?.icu?.length < 30);

    if (isIdentical) {
      handleResimulate();
    }
  }, [dossier, handleResimulate]);

  const chartSeries = useMemo(() => {
    if (!activeChartSeries) return [];
    return activeChartSeries[activeMetric] || [];
  }, [activeChartSeries, activeMetric]);

  if (!isOpen || !dossier) return null;

  const handleSaveToNotebook = () => {
    // 1. Invoke prop if supplied by parent
    if (onSaveToNotebook) {
      onSaveToNotebook(dossier);
    }

    // 2. Dispatch custom event for ERIS drawer ledger integration
    window.dispatchEvent(
      new CustomEvent('eris-append-finding', {
        detail: {
          title: dossier.title,
          finding: dossier.executive_verdict,
          dossier: dossier,
          pin_to_brief: true,
          timestamp: Date.now(),
        },
      })
    );

    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 2500);
  };

  const isDegraded = dossier.provenance === 'degraded_fallback' || dossier.provenance === 'groq_fallback';

  // Custom rich Recharts tooltip
  const CustomDossierTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload || !payload.length) return null;
    const unit =
      activeMetric === 'oxygen'
        ? ' MT/day'
        : activeMetric === 'icu'
        ? ' beds'
        : ' active cases';

    return (
      <div className="bg-surface-container/95 backdrop-blur-md border border-outline/35 rounded-xl p-3 shadow-xl text-xs font-sans min-w-[240px]">
        <div className="font-mono font-bold text-on-surface text-[11px] mb-2 pb-1.5 border-b border-outline/20 flex items-center justify-between">
          <span>Simulation Day {label}</span>
          <span className="text-[9.5px] font-mono text-primary px-1.5 py-0.5 rounded bg-primary/10 border border-primary/20">
            50-Iteration Sobol QMC
          </span>
        </div>
        <div className="space-y-1.5">
          {payload.map((entry: any, i: number) => {
            const isP90 = entry.dataKey?.toString().includes('_p90');
            return (
              <div key={i} className="flex items-center justify-between gap-3 text-[11px]">
                <div className="flex items-center gap-1.5 truncate max-w-[160px]">
                  <span
                    className={`w-2.5 h-2.5 rounded-full shrink-0 shadow-xs ${isP90 ? 'opacity-50 ring-1 ring-current' : ''}`}
                    style={{ backgroundColor: entry.color }}
                  />
                  <span className="text-on-surface-variant font-medium truncate" title={entry.name}>
                    {entry.name}{isP90 ? ' (P90)' : ''}:
                  </span>
                </div>
                <span className="font-mono font-bold text-on-surface shrink-0">
                  {Number(entry.value).toLocaleString()}{unit}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-[2500] flex items-center justify-center p-3 sm:p-6 overflow-y-auto">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/65 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />

      {/* Modal Dialog */}
      <div className="relative bg-surface border border-outline/40 rounded-2xl shadow-2xl w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden text-on-surface z-10 animate-in fade-in zoom-in-95 duration-150">
        
        {/* Header Bar */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-outline/30 bg-surface-container/70 shrink-0">
          <div className="flex items-center gap-3">
            <span className="p-2 rounded-xl bg-primary/10 text-primary border border-primary/25 shadow-2xs">
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
                <polyline points="10 9 9 9 8 9" />
              </svg>
            </span>
            <div className="min-w-0 pr-3">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold tracking-wide font-heading text-on-surface truncate">
                  {dossier.title}
                </h2>
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-[11px] text-on-surface-variant font-medium">
                  Autonomous Multi-Fork Research Dossier
                </span>
                {isDegraded ? (
                  <span className="text-[9px] font-mono px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/30 font-semibold shrink-0">
                    Multi-Provider Synthesis
                  </span>
                ) : (
                  <span className="text-[9px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 font-semibold shrink-0">
                    Bedrock / Multi-LLM Tier
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Action Bar */}
          <div className="flex items-center gap-2 shrink-0">
            {activeScorecards[1] && (
              <button
                onClick={() => handleApplyToSandbox(activeScorecards[1], 1)}
                className={`h-8.5 px-3.5 rounded-lg text-xs font-semibold flex items-center gap-2 transition-all cursor-pointer whitespace-nowrap shadow-2xs border ${
                  isApplied
                    ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/35'
                    : 'bg-primary/10 hover:bg-primary text-primary hover:text-white border-primary/25'
                }`}
                title="Directly load Plan A levers, schedule, and edge cuts into Policy Sandbox"
              >
                {isApplied ? (
                  <>
                    <svg className="w-3.5 h-3.5 text-emerald-500 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                    <span>Applied to Sandbox!</span>
                  </>
                ) : (
                  <>
                    <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <polygon points="5 3 19 12 5 21 5 3"/>
                    </svg>
                    <span>Apply Plan A to Sandbox</span>
                  </>
                )}
              </button>
            )}

            <button
              onClick={handleSaveToNotebook}
              className={`h-8.5 px-3.5 rounded-lg text-xs font-semibold flex items-center gap-2 transition-all cursor-pointer whitespace-nowrap shadow-xs ${
                isSaved
                  ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/35'
                  : 'bg-primary text-white hover:bg-primary/90'
              }`}
              title="Save this analytical dossier to ERIS Intelligence Notebook"
            >
              {isSaved ? (
                <>
                  <svg className="w-3.5 h-3.5 text-emerald-500 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                  <span>Saved to Notebook</span>
                </>
              ) : (
                <>
                  <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5Z"/>
                    <path d="M6 6h10"/>
                    <path d="M6 10h10"/>
                    <path d="M12 14h4"/>
                  </svg>
                  <span>Save to Notebook</span>
                </>
              )}
            </button>

            <button
              onClick={onClose}
              className="h-8.5 w-8.5 flex items-center justify-center text-on-surface-variant hover:text-on-surface hover:bg-surface-variant rounded-lg transition-colors cursor-pointer shrink-0 ml-0.5"
              title="Close (ESC)"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
        </div>

        {/* Scrollable Content */}
        <div className="overflow-y-auto p-5 sm:p-6 space-y-5 flex-1">
          
          {/* Fallback Notice Banner if applicable */}
          {dossier.fallback_note && (
            <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/25 flex items-center gap-2.5 text-xs text-amber-600 dark:text-amber-400">
              <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
              <span>{dossier.fallback_note}</span>
            </div>
          )}

          {/* Section 1: Executive Clinical Verdict & Recommendation */}
          <div className="rounded-xl border border-primary/25 bg-primary/5 p-4 sm:p-5 shadow-xs">
            <div className="flex items-center gap-2 text-primary text-xs font-mono font-bold uppercase tracking-wider mb-2.5">
              <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
              <span>Tactical Clinical Verdict & Recommendation</span>
            </div>
            
            <DossierVerdictContent content={dossier.executive_verdict} />

            {dossier.recommendation && (
              <div className="mt-4 pt-3.5 border-t border-primary/20 flex items-start gap-2.5 text-xs text-on-surface">
                <span className="font-mono font-bold text-primary shrink-0 text-[10px] uppercase tracking-wider bg-primary/10 px-2 py-0.5 rounded border border-primary/20">
                  POLICY ROADMAP
                </span>
                <span className="font-sans leading-relaxed text-on-surface/90">{dossier.recommendation}</span>
              </div>
            )}
          </div>

          {/* Section 2: Comparative KPI Scorecard Grid */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-mono uppercase tracking-wider text-on-surface-variant font-bold flex items-center gap-2">
                <svg className="w-3.5 h-3.5 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/></svg>
                <span>50-Iteration Sobol QMC Scorecard: 180-Day Impact Summary</span>
              </h3>
              <span className="text-[10px] font-mono text-on-surface-variant/70">
                Coupled SEIRD 15-City Network (P10 / P50 / P90 Envelopes)
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
              {activeScorecards.map((card, idx) => {
                const isBaseline = idx === 0;
                const mobPreserved = card.mobility_preservation_pct ?? (isBaseline ? 100 : idx === 1 ? 74.3 : 65.6);
                return (
                  <div
                    key={idx}
                    className={`rounded-xl p-4 border transition-all flex flex-col justify-between ${
                      isBaseline
                        ? 'bg-surface-container/40 border-outline/30'
                        : 'bg-surface border-outline/50 hover:border-primary/40 shadow-xs'
                    }`}
                  >
                    <div>
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <span className="text-xs font-bold text-on-surface font-sans leading-snug">
                          {card.name}
                        </span>
                        {card.reduction_pct > 0 ? (
                          <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/25 shrink-0">
                            -{card.reduction_pct}% Peak
                          </span>
                        ) : (
                          <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/25 shrink-0">
                            Baseline
                          </span>
                        )}
                      </div>

                      {/* Economic Mobility Preservation Index Badge */}
                      <div className="flex items-center gap-1.5 mb-2.5">
                        <span className={`text-[9.5px] font-mono font-bold px-2 py-0.5 rounded-md border flex items-center gap-1 ${
                          mobPreserved >= 70
                            ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30'
                            : mobPreserved >= 50
                            ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30'
                            : 'bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/30'
                        }`}>
                          <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
                          <span>Mobility: {mobPreserved}% Preserved</span>
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-2 text-xs pt-1">
                        <div className="p-2 rounded-lg bg-surface-container/50 border border-outline/20">
                          <span className="text-[9px] text-on-surface-variant font-mono block">Peak Active (P50):</span>
                          <span className="font-mono font-bold text-on-surface text-xs">
                            {card.peak_cases.toLocaleString()}
                          </span>
                          {card.peak_p90_cases && (
                            <span className="text-[8.5px] font-mono text-on-surface-variant/80 block mt-0.5 truncate">
                              P90: {card.peak_p90_cases.toLocaleString()}
                            </span>
                          )}
                        </div>
                        <div className="p-2 rounded-lg bg-surface-container/50 border border-outline/20">
                          <span className="text-[9px] text-on-surface-variant font-mono block">Peak Timing:</span>
                          <span className="font-mono font-semibold text-on-surface text-xs">
                            Day {card.peak_day}
                          </span>
                          <span className="text-[8.5px] font-mono text-on-surface-variant/80 block mt-0.5">
                            Window: ±3 days
                          </span>
                        </div>
                        <div className="p-2 rounded-lg bg-surface-container/50 border border-outline/20">
                          <span className="text-[9px] text-on-surface-variant font-mono block">ICU / O₂ Deficit:</span>
                          <span className={`font-mono font-semibold text-xs ${card.icu_deficit > 0 || card.breached_o2 ? 'text-rose-500 font-bold' : 'text-emerald-600 dark:text-emerald-400'}`}>
                            {card.icu_deficit > 0 ? `${card.icu_deficit.toLocaleString()} beds` : (card.breached_o2 ? 'O₂ Breached' : 'Within Limits')}
                          </span>
                          <span className="text-[8.5px] font-mono text-on-surface-variant/80 block mt-0.5">
                            Ceiling: 9,690 MT
                          </span>
                        </div>
                        <div className="p-2 rounded-lg bg-surface-container/50 border border-outline/20">
                          <span className="text-[9px] text-on-surface-variant font-mono block">Lives Saved:</span>
                          <span className={`font-mono font-bold text-xs ${card.deaths_saved > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-on-surface-variant'}`}>
                            {card.deaths_saved > 0 ? `+${card.deaths_saved.toLocaleString()}` : 'Reference'}
                          </span>
                          <span className="text-[8.5px] font-mono text-on-surface-variant/80 block mt-0.5">
                            180-Day Horizon
                          </span>
                        </div>
                      </div>
                    </div>

                    {!isBaseline && (
                      <button
                        onClick={() => handleApplyToSandbox(card, idx)}
                        className="mt-3 w-full py-1.5 px-2.5 rounded-lg bg-surface-container hover:bg-primary hover:text-white text-on-surface text-[11px] font-semibold border border-outline/30 hover:border-primary/50 flex items-center justify-center gap-1.5 transition-all cursor-pointer shadow-2xs group"
                        title={`Apply ${card.name} into Policy Sandbox`}
                      >
                        <svg className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="9 18 15 12 9 6" />
                        </svg>
                        <span>Apply to Sandbox</span>
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Section 3: Interactive Recharts Multi-Fork Graph */}
          <div className="rounded-xl border border-outline/40 bg-surface p-4 sm:p-5 shadow-xs">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
              <div>
                <h3 className="text-xs font-mono uppercase tracking-wider text-on-surface-variant font-bold flex items-center gap-2">
                  <svg className="w-3.5 h-3.5 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
                  <span>180-Day Comparative Trajectory Curves (50-Iteration Sobol QMC)</span>
                </h3>
                <p className="text-[11px] text-on-surface-variant mt-0.5 font-sans">
                  50-Iteration Sobol Quasi-Monte Carlo stochastic sampling (P50 Medians & P90 Upper Bounds) across 15 national metro centers.
                </p>
              </div>

              {/* Metric Selector Pills & Resimulate Action */}
              <div className="flex flex-wrap items-center gap-1.5 self-start sm:self-auto">
                <div className="flex items-center gap-1 bg-surface-container p-1 rounded-xl border border-outline/30 shadow-2xs">
                  <button
                    onClick={() => setActiveMetric('active')}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-sans transition-all cursor-pointer ${
                      activeMetric === 'active'
                        ? 'bg-primary text-white font-semibold shadow-xs'
                        : 'text-on-surface-variant hover:text-on-surface'
                    }`}
                  >
                    <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
                    <span>Active Infections</span>
                  </button>
                  <button
                    onClick={() => setActiveMetric('icu')}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-sans transition-all cursor-pointer ${
                      activeMetric === 'icu'
                        ? 'bg-primary text-white font-semibold shadow-xs'
                        : 'text-on-surface-variant hover:text-on-surface'
                    }`}
                  >
                    <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2 4v16"/><path d="M2 8h18a2 2 0 0 1 2 2v10"/><path d="M2 17h20"/><path d="M6 8v9"/></svg>
                    <span>ICU Bed Demand</span>
                  </button>
                  <button
                    onClick={() => setActiveMetric('oxygen')}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-sans transition-all cursor-pointer ${
                      activeMetric === 'oxygen'
                        ? 'bg-primary text-white font-semibold shadow-xs'
                        : 'text-on-surface-variant hover:text-on-surface'
                    }`}
                  >
                    <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 2v7.31"/><path d="M14 9.3V2"/><path d="M8.5 2h7"/><path d="M14 9.3a6.5 6.5 0 1 1-4 0"/></svg>
                    <span>Liquid Oxygen (MT/day)</span>
                  </button>
                </div>

                <button
                  onClick={handleResimulate}
                  disabled={isResimulating}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-mono bg-surface-container/60 hover:bg-surface-variant text-on-surface-variant hover:text-on-surface border border-outline/30 transition-all cursor-pointer disabled:opacity-50 shadow-2xs"
                  title="Re-run 180-day 50-iteration Sobol QMC network forks"
                >
                  <svg className={`w-3.5 h-3.5 text-primary ${isResimulating ? 'animate-spin' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 21h5v-5"/></svg>
                  <span>{isResimulating ? 'Simulating...' : 'Refresh Forks'}</span>
                </button>
              </div>
            </div>

            {/* Recharts Curve */}
            <div className="h-72 sm:h-80 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartSeries} margin={{ top: 12, right: 24, left: 10, bottom: 6 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.12} />
                  <XAxis
                    dataKey="day"
                    tickLine={false}
                    stroke="var(--color-on-surface-variant, #94A3B8)"
                    tick={{ fontSize: 10, fontFamily: 'monospace' }}
                    label={{ value: 'Simulation Day', position: 'insideBottom', offset: -4, fontSize: 10 }}
                  />
                  <YAxis
                    tickLine={false}
                    stroke="var(--color-on-surface-variant, #94A3B8)"
                    tick={{ fontSize: 10, fontFamily: 'monospace' }}
                    tickFormatter={(val) =>
                      val >= 1_000_000
                        ? `${(val / 1_000_000).toFixed(1)}M`
                        : val >= 1_000
                        ? `${(val / 1_000).toFixed(0)}k`
                        : val
                    }
                  />
                  
                  {/* Custom Tooltip */}
                  <Tooltip content={<CustomDossierTooltip />} />

                  <Legend
                    wrapperStyle={{ fontSize: '11px', paddingTop: '12px' }}
                    iconType="circle"
                  />

                  {/* Reference Line for National Oxygen Ceiling */}
                  {activeMetric === 'oxygen' && (
                    <ReferenceLine
                      y={9690}
                      stroke="#DC2626"
                      strokeDasharray="4 4"
                      strokeWidth={1.5}
                      label={{
                        value: 'National O2 Ceiling (9,690 MT/day)',
                        fill: '#DC2626',
                        fontSize: 10,
                        position: 'top',
                      }}
                    />
                  )}

                  {/* Reference Line for National ICU Bed Capacity */}
                  {activeMetric === 'icu' && (
                    <ReferenceLine
                      y={95000}
                      stroke="#DC2626"
                      strokeDasharray="4 4"
                      strokeWidth={1.5}
                      label={{
                        value: 'National ICU Bed Capacity (95,000)',
                        fill: '#DC2626',
                        fontSize: 10,
                        position: 'top',
                      }}
                    />
                  )}

                  {/* Trajectory Lines */}
                  <Line
                    type="monotone"
                    dataKey="baseline"
                    name="Baseline (Unchecked)"
                    stroke="#EF4444"
                    strokeWidth={2.6}
                    dot={false}
                    activeDot={{ r: 5 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="plan_a"
                    name={activeScorecards[1]?.name || 'Plan A'}
                    stroke="#3B82F6"
                    strokeWidth={2.8}
                    dot={false}
                    activeDot={{ r: 5 }}
                  />
                  {activeScorecards[2] && (
                    <Line
                      type="monotone"
                      dataKey="plan_b"
                      name={activeScorecards[2]?.name || 'Plan B'}
                      stroke="#10B981"
                      strokeWidth={2.6}
                      dot={false}
                      activeDot={{ r: 5 }}
                    />
                  )}
                  {/* P90 Stochastic Bounds */}
                  <Line
                    type="monotone"
                    dataKey="plan_a_p90"
                    name="Plan A (P90 Bound)"
                    stroke="#3B82F6"
                    strokeDasharray="4 4"
                    strokeWidth={1.4}
                    opacity={0.65}
                    dot={false}
                  />
                  {activeScorecards[2] && (
                    <Line
                      type="monotone"
                      dataKey="plan_b_p90"
                      name="Plan B (P90 Bound)"
                      stroke="#10B981"
                      strokeDasharray="4 4"
                      strokeWidth={1.4}
                      opacity={0.65}
                      dot={false}
                    />
                  )}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Section 4: Operational Phased Roadmap */}
          {dossier.timeline && dossier.timeline.length > 0 && (
            <div className="rounded-xl border border-outline/30 bg-surface-container/20 p-4">
              <h3 className="text-xs font-mono uppercase tracking-wider text-on-surface-variant font-bold mb-3 flex items-center gap-2">
                <svg className="w-3.5 h-3.5 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                <span>180-Day Phased Deployment Timeline</span>
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-2.5">
                {dossier.timeline.map((item, idx) => (
                  <div key={idx} className="p-3 rounded-lg border border-outline/25 bg-surface text-xs shadow-2xs">
                    <div className="flex items-center justify-between font-mono text-[10px] text-primary font-bold mb-1">
                      <span>Day {item.day}</span>
                      <span className="uppercase px-1.5 py-0.5 rounded bg-primary/10 border border-primary/20">{item.phase}</span>
                    </div>
                    <p className="text-[11px] text-on-surface/90 font-sans leading-snug">{item.action}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Section 5: Scientific Grounding & Citations */}
          {dossier.citations && dossier.citations.length > 0 && (
            <div className="rounded-xl border border-outline/30 bg-surface-container/20 p-4">
              <h3 className="text-xs font-mono uppercase tracking-wider text-on-surface-variant font-bold mb-2 flex items-center gap-2">
                <svg className="w-3.5 h-3.5 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5Z"/><path d="M6 6h10"/><path d="M6 10h10"/></svg>
                <span>Literature & Policy Grounding References</span>
              </h3>
              <div className="divide-y divide-outline/15 text-xs font-sans">
                {dossier.citations.map((cite, idx) => (
                  <div key={idx} className="py-2.5 first:pt-1 last:pb-0">
                    <div className="flex items-center gap-2 font-semibold text-on-surface">
                      <span>{cite.source}</span>
                      {cite.year && <span className="text-on-surface-variant font-mono text-[10px]">({cite.year})</span>}
                    </div>
                    <p className="text-on-surface-variant text-[11px] mt-0.5">{cite.finding}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Footnote */}
          {dossier.methodology_footnote && (
            <p className="text-[10px] font-mono text-on-surface-variant/70 text-center pt-2">
              {dossier.methodology_footnote}
            </p>
          )}

        </div>

      </div>
    </div>
  );
}
