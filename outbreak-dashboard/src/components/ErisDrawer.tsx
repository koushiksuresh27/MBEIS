import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useVoiceAgent } from '../context/VoiceAgentContext';
import ResearchDossierModal from './dossier/ResearchDossierModal';
import type { DossierData } from '../types/dossier';

interface ErisDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  scenarioId: string | null;
}

export interface LedgerEntry {
  id: string;
  source: 'voice' | 'notebook' | 'brief' | 'user_note';
  timestamp: number;
  query?: string;
  content: string;
  isPinned?: boolean;
  tag?: string;
  dossier?: DossierData;
}

import { BACKEND_URL } from '../config/backend';

const LANGUAGES = [
  { code: 'en-IN', label: 'EN', name: 'English' },
  { code: 'hi-IN', label: 'हि', name: 'हिंदी' },
  { code: 'ta-IN', label: 'த', name: 'தமிழ்' },
  { code: 'te-IN', label: 'తె', name: 'తెలుగు' },
  { code: 'ml-IN', label: 'മ', name: 'മലയാളം' },
  { code: 'bn-IN', label: 'বা', name: 'বাংলা' },
  { code: 'kn-IN', label: 'ಕ', name: 'ಕನ್ನಡ' },
  { code: 'gu-IN', label: 'ગ', name: 'ગુજરાતી' },
  { code: 'mr-IN', label: 'म', name: 'मराठी' },
];

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



// ── Metric Callout Grid Component ──
function ErisMetricGrid({ spec }: { spec: any }) {
  if (!spec || !spec.metrics || !Array.isArray(spec.metrics)) return null;

  return (
    <div className="my-2.5 p-2.5 rounded-xl bg-surface-container/60 border border-outline/25 shadow-2xs">
      {spec.title && (
        <div className="text-[10px] font-mono uppercase tracking-wider text-on-surface-variant font-bold mb-2">
          {spec.title}
        </div>
      )}
      <div className={`grid gap-2 ${spec.metrics.length === 2 ? 'grid-cols-2' : 'grid-cols-3'}`}>
        {spec.metrics.map((m: any, idx: number) => {
          const isGood = m.status === 'good' || m.value?.startsWith('-') || m.label?.toLowerCase().includes('saved');
          const isBad = m.status === 'bad' || m.status === 'critical' || m.label?.toLowerCase().includes('deficit');
          return (
            <div
              key={idx}
              className="p-2 rounded-lg bg-surface border border-outline/20 flex flex-col justify-between"
            >
              <span className="text-[9.5px] font-mono text-on-surface-variant font-medium leading-tight">
                {m.label}
              </span>
              <div className="my-0.5">
                <span className={`text-[13px] font-mono font-bold leading-none ${
                  isGood ? 'text-emerald-500' : isBad ? 'text-rose-500' : 'text-primary'
                }`}>
                  {m.value}
                </span>
              </div>
              {m.delta && (
                <span className="text-[8.5px] font-mono text-on-surface-variant/70 leading-tight">
                  {m.delta}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Transmission Ignition Cascade Flowchart ──
function ErisFlowchart({ spec }: { spec: any }) {
  if (!spec || !spec.nodes || !Array.isArray(spec.nodes)) return null;

  const title = spec.title || 'Transmission Cascade Sequence';

  return (
    <div className="my-2.5 p-2.5 rounded-xl bg-surface-container/60 border border-outline/25 shadow-2xs">
      <div className="text-[10.5px] font-mono font-semibold text-on-surface flex items-center gap-1.5 mb-2">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
        <span>{title}</span>
      </div>
      <div className="flex items-center gap-1.5 overflow-x-auto py-1 scrollbar-thin">
        {spec.nodes.map((node: any, idx: number) => {
          const cityName = node.city || node.label || node.name || node.id || `Hub ${idx + 1}`;
          const rawDay = node.day ?? node.ignition_day ?? node.time;
          const dayText = rawDay !== undefined 
            ? (typeof rawDay === 'number' ? `Day ${rawDay}` : (String(rawDay).toLowerCase().includes('day') ? rawDay : `Day ${rawDay}`))
            : '';
          const detail = node.detail || node.description || node.status || '';

          return (
            <div key={idx} className="flex items-center gap-1.5 shrink-0">
              <div className="px-2.5 py-1.5 rounded-lg bg-surface border border-outline/30 flex flex-col items-center min-w-[80px] text-center shadow-2xs">
                <span className="text-[11px] font-bold text-on-surface">{cityName}</span>
                {dayText && (
                  <span className="text-[9px] font-mono text-primary font-medium">{dayText}</span>
                )}
                {detail && (
                  <span className="text-[8px] font-mono text-on-surface-variant/70 mt-0.5 leading-tight">{detail}</span>
                )}
              </div>
              {idx < spec.nodes.length - 1 && (
                <span className="text-on-surface-variant/40 font-bold text-xs select-none">→</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ErisDossierCard({
  dossier,
  onOpenDossier
}: {
  dossier: DossierData;
  onOpenDossier: (d: DossierData) => void;
}) {
  const planCount = (dossier.scorecards?.length || 1) - 1;
  const bestPlan = dossier.scorecards?.[1];

  const cleanSnippet = (dossier.executive_verdict || '')
    .replace(/ERIS Epidemiological Intelligence Core:.*?---/s, '')
    .replace(/###\s*[0-9.]*\s*/g, '')
    .replace(/\*\*Scenario ID:\*\*.*?\n/g, '')
    .replace(/\*\*Epicenter:\*\*.*?\n/g, '')
    .replace(/[-*•]\s+/g, '')
    .replace(/\*\*/g, '')
    .replace(/---+/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  return (
    <div className="my-3 p-3.5 rounded-xl border border-primary/30 bg-primary/5 hover:border-primary/50 transition-all shadow-xs">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="p-1 rounded bg-primary/15 text-primary">
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
            </svg>
          </span>
          <span className="text-xs font-bold text-on-surface font-sans">
            Autonomous Research Dossier
          </span>
        </div>
        <span className="text-[9.5px] font-mono px-2 py-0.5 rounded-full bg-primary/10 text-primary font-bold border border-primary/25">
          {planCount > 0 ? `${planCount} Forks Evaluated` : 'Simulation Ready'}
        </span>
      </div>

      <p className="text-[11.5px] text-on-surface/90 font-sans leading-snug line-clamp-2 mb-2.5">
        {cleanSnippet || 'Coupled 180-day multi-fork SEIRD simulation and clinical verdict ready for review.'}
      </p>

      {bestPlan && bestPlan.reduction_pct > 0 && (
        <div className="flex items-center gap-3 text-[10.5px] font-mono mb-3 text-on-surface-variant bg-surface/70 p-2 rounded-lg border border-outline/20">
          <div>
            <span className="text-on-surface-variant/70">Peak Drop: </span>
            <span className="text-emerald-600 font-bold">-{bestPlan.reduction_pct}%</span>
          </div>
          <div>
            <span className="text-on-surface-variant/70">Lives Saved: </span>
            <span className="text-emerald-600 font-bold">+{bestPlan.deaths_saved.toLocaleString()}</span>
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => onOpenDossier(dossier)}
        className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-semibold bg-primary text-white hover:bg-primary/90 transition-all cursor-pointer shadow-xs active:scale-98"
      >
        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/></svg>
        <span>View Full Research Dossier</span>
      </button>
    </div>
  );
}

function FormattedLedgerContent({
  content,
  onOpenDossier,
}: {
  content: string;
  onOpenDossier?: (d: DossierData) => void;
}) {
  if (!content) return null;

  const rawLines = content.split('\n');
  const blocks: React.ReactNode[] = [];
  let currentTable: string[] = [];
  let inCodeBlock = false;
  let codeBlockType = '';
  let codeBlockLines: string[] = [];

  const flushTable = (key: number) => {
    if (currentTable.length === 0) return;
    const rows = currentTable
      .map(row => row.split('|').map(c => c.trim()).filter((_, idx, arr) => idx > 0 && idx < arr.length - 1))
      .filter(row => row.length > 0 && !row.every(cell => /^[-:]+$/.test(cell)));

    if (rows.length > 0) {
      const [header, ...bodyRows] = rows;
      blocks.push(
        <div key={`table-${key}`} className="my-2.5 overflow-x-auto rounded-lg border border-outline/25 shadow-2xs">
          <table className="w-full text-[11px] text-left border-collapse">
            <thead className="bg-surface-container border-b border-outline/20 font-semibold text-on-surface">
              <tr>
                {header.map((col, cIdx) => (
                  <th key={cIdx} className="px-2.5 py-1.5 whitespace-nowrap">{renderInlineFormatting(col)}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-outline/10 bg-surface">
              {bodyRows.map((bRow, rIdx) => (
                <tr key={rIdx} className="hover:bg-surface-variant/30 transition-colors">
                  {bRow.map((cell, cIdx) => (
                    <td key={cIdx} className="px-2.5 py-1.5">{renderInlineFormatting(cell)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
    currentTable = [];
  };

  rawLines.forEach((line, idx) => {
    const trimmed = line.trim();

    // Code block detection
    if (trimmed.startsWith('```')) {
      if (!inCodeBlock) {
        if (currentTable.length > 0) flushTable(idx);
        inCodeBlock = true;
        codeBlockType = trimmed.slice(3).trim().toLowerCase();
        codeBlockLines = [];
        return;
      } else {
        // Closing code block
        inCodeBlock = false;
        const blockText = codeBlockLines.join('\n').trim();
        const blockKey = `code-${idx}`;

        if (codeBlockType === 'eris-metric') {
          try {
            const spec = JSON.parse(blockText);
            blocks.push(<ErisMetricGrid key={blockKey} spec={spec} />);
            return;
          } catch (e) {
            console.warn('Failed to parse eris-metric JSON:', e);
          }
        } else if (codeBlockType === 'eris-flow') {
          try {
            const spec = JSON.parse(blockText);
            blocks.push(<ErisFlowchart key={blockKey} spec={spec} />);
            return;
          } catch (e) {
            console.warn('Failed to parse eris-flow JSON:', e);
          }
        } else if (codeBlockType === 'eris-dossier') {
          try {
            const dossierSpec: DossierData = JSON.parse(blockText);
            blocks.push(
              <ErisDossierCard
                key={blockKey}
                dossier={dossierSpec}
                onOpenDossier={(d) => onOpenDossier?.(d)}
              />
            );
            return;
          } catch (e) {
            console.warn('Failed to parse eris-dossier JSON:', e);
          }
        }

        // Fallback standard code block
        blocks.push(
          <pre
            key={blockKey}
            className="p-2.5 my-2 rounded-lg bg-surface-container font-mono text-[10.5px] text-on-surface overflow-x-auto border border-outline/25"
          >
            {blockText}
          </pre>
        );
        return;
      }
    }

    if (inCodeBlock) {
      codeBlockLines.push(line);
      return;
    }

    // Table row detection
    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      currentTable.push(trimmed);
      return;
    } else if (currentTable.length > 0) {
      flushTable(idx);
    }

    if (!trimmed) {
      blocks.push(<div key={`space-${idx}`} className="h-1.5" />);
      return;
    }

    // Section Headings (### or ##)
    if (trimmed.startsWith('### ') || trimmed.startsWith('## ')) {
      const title = trimmed.replace(/^#+\s*/, '');
      blocks.push(
        <div
          key={`head-${idx}`}
          className="text-[11px] font-bold uppercase tracking-wider text-primary dark:text-primary-400 font-mono mt-3 first:mt-0 mb-1.5 pb-1 border-b border-outline/15 flex items-center gap-1.5"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-primary" />
          <span>{renderInlineFormatting(title)}</span>
        </div>
      );
      return;
    }

    // Strategic Directive Callout (→ or -> or Action Directive)
    if (trimmed.startsWith('→') || trimmed.startsWith('->') || trimmed.toLowerCase().includes('recommended action:')) {
      const cleanText = trimmed.replace(/^[→\-]+>\s*|\s*→\s*/, '').trim();
      blocks.push(
        <div
          key={`dir-${idx}`}
          className="my-2 p-2.5 rounded-lg border border-primary/35 bg-primary/10 text-on-surface font-medium text-[11.5px] leading-relaxed flex items-start gap-2 shadow-2xs"
        >
          <span className="px-1.5 py-0.5 rounded bg-primary text-white text-[9px] font-bold uppercase tracking-wider shrink-0 mt-0.5">
            DIRECTIVE
          </span>
          <div className="flex-1 text-[11.5px]">
            {renderInlineFormatting(cleanText)}
          </div>
        </div>
      );
      return;
    }

    // Bullet List Items (- or * or •)
    if (/^[-*•]\s+/.test(trimmed)) {
      const itemText = trimmed.replace(/^[-*•]\s+/, '');
      blocks.push(
        <div key={`bullet-${idx}`} className="flex items-start gap-2 my-1 text-[11.5px] leading-relaxed">
          <span className="w-1.5 h-1.5 rounded-full bg-outline/60 mt-1.5 shrink-0" />
          <div className="flex-1 text-on-surface/90">
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
          <div key={`num-${idx}`} className="flex items-start gap-2 my-1 text-[11.5px] leading-relaxed">
            <span className="w-4 h-4 rounded-full bg-surface-container border border-outline/30 text-[9px] font-bold flex items-center justify-center shrink-0 mt-0.5 text-on-surface-variant">
              {num}
            </span>
            <div className="flex-1 text-on-surface/90">
              {renderInlineFormatting(itemText)}
            </div>
          </div>
        );
        return;
      }
    }

    // Standard paragraph text
    blocks.push(
      <p key={`p-${idx}`} className="text-on-surface/90 leading-relaxed text-[11.5px] my-1">
        {renderInlineFormatting(trimmed)}
      </p>
    );
  });

  if (currentTable.length > 0) {
    flushTable(rawLines.length);
  }

  return <div className="space-y-0.5">{blocks}</div>;
}

export default function ErisDrawer({ isOpen, onClose, scenarioId }: ErisDrawerProps) {
  const { history: voiceHistory, screenContext } = useVoiceAgent();

  const [notebookEntries, setNotebookEntries] = useState<LedgerEntry[]>(() => {
    try {
      const saved = localStorage.getItem(`mbeis_notebook_${scenarioId || 'default'}`);
      if (saved) {
        return JSON.parse(saved);
      }
    } catch (e) {
      console.warn('Could not parse saved notebook entries:', e);
    }
    return [
      {
        id: 'init-brief',
        source: 'brief',
        timestamp: Date.now() - 60000,
        query: 'ERIS Intelligence Ledger Active',
        content:
          '### Operational Status\n' +
          'ERIS analytical ledger is active with live simulation state preloaded. ' +
          'Spoken queries from the Voice Orb, typed scenario commands, and simulation findings are recorded here.\n\n' +
          '### Analytical Directives\n' +
          '- **Scenario Trajectory**: Ask about national peak timing, city ignition sequences, or deaths averted.\n' +
          '- **Resource Capacity**: Inquire about ICU bed and liquid medical oxygen shortfall against the 9,690 MT/day national ceiling.\n' +
          '- **War Room Brief**: Click **Brief** in the toolbar above to generate an executive crisis summary.\n\n' +
          '→ **Recommended Action**: Review baseline peak curves in Planner View before enacting regional cordons.',
        isPinned: false,
      },
    ];
  });

  // Sync to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(`mbeis_notebook_${scenarioId || 'default'}`, JSON.stringify(notebookEntries));
    } catch (e) {
      console.warn('Failed to save notebook entries to localStorage:', e);
    }
  }, [notebookEntries, scenarioId]);

  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [selectedLanguage, setSelectedLanguage] = useState('en-IN');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copiedAll, setCopiedAll] = useState(false);
  const [autoBriefLoading, setAutoBriefLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'all' | 'notes' | 'pinned'>('all');

  // Autonomous Deep Research Dossier State
  const [selectedDossier, setSelectedDossier] = useState<DossierData | null>(null);
  const [isResearching, setIsResearching] = useState(false);
  const [researchStatusMsg, setResearchStatusMsg] = useState<string | null>(null);
  const [researchStage, setResearchStage] = useState<number>(1);
  const [researchElapsedSec, setResearchElapsedSec] = useState<number>(0);

  // Live timer for research exploration
  useEffect(() => {
    if (!isResearching) {
      setResearchElapsedSec(0);
      return;
    }
    const t0 = Date.now();
    const interval = setInterval(() => {
      setResearchElapsedSec(Math.floor((Date.now() - t0) / 1000));
    }, 500);
    return () => clearInterval(interval);
  }, [isResearching]);

  // Manual Note Creation State
  const [isCreatingNote, setIsCreatingNote] = useState(false);
  const [newNoteTitle, setNewNoteTitle] = useState('');
  const [newNoteContent, setNewNoteContent] = useState('');
  const [newNoteTag, setNewNoteTag] = useState('Action');

  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll on new entries
  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [notebookEntries, voiceHistory, isLoading, isCreatingNote, isResearching]);

  // Listen for autonomous findings appended by the Voice Agent
  useEffect(() => {
    const handleAppendFinding = (e: Event) => {
      const customEvent = e as CustomEvent;
      const data = customEvent.detail;
      if (!data) return;
      const newEntry: LedgerEntry = {
        id: `voice-finding-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        source: data.pin_to_brief ? 'brief' : 'voice',
        timestamp: data.timestamp || Date.now(),
        query: data.title || 'Spoken Finding',
        content: data.finding || '',
        isPinned: !!data.pin_to_brief,
        dossier: data.dossier || undefined,
      };
      setNotebookEntries(prev => [newEntry, ...prev]);
    };

    window.addEventListener('eris-append-finding', handleAppendFinding);
    return () => window.removeEventListener('eris-append-finding', handleAppendFinding);
  }, []);

  // Listen for AI or external note creation events
  useEffect(() => {
    const handleCreateNoteEvent = (e: Event) => {
      const customEvent = e as CustomEvent;
      const data = customEvent.detail;
      if (!data) return;
      const newEntry: LedgerEntry = {
        id: `ai-note-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        source: 'user_note',
        timestamp: Date.now(),
        query: data.title || 'AI Strategy Note',
        content: data.content || '',
        isPinned: !!data.isPinned,
        tag: data.tag || 'AI Memo',
      };
      setNotebookEntries(prev => [newEntry, ...prev]);
      setActiveTab('notes');
    };

    window.addEventListener('eris-create-note', handleCreateNoteEvent);
    return () => window.removeEventListener('eris-create-note', handleCreateNoteEvent);
  }, []);

  // Merge voiceHistory from VoiceAgentContext into the ledger
  const allEntries = useMemo(() => {
    const combined: LedgerEntry[] = [...notebookEntries];

    // Convert voice history pairs (user query + assistant reply) into ledger entries
    for (let i = 0; i < voiceHistory.length; i++) {
      const turn = voiceHistory[i];
      if (turn.role === 'user') {
        const nextTurn = voiceHistory[i + 1];
        if (nextTurn && nextTurn.role === 'assistant') {
          const entryId = `voice-${turn.timestamp}`;
          if (!combined.some(e => e.id === entryId)) {
            combined.push({
              id: entryId,
              source: 'voice',
              timestamp: turn.timestamp,
              query: turn.content,
              content: nextTurn.content,
              isPinned: false,
            });
          }
          i++; // skip assistant turn
        }
      }
    }

    return combined.sort((a, b) => a.timestamp - b.timestamp);
  }, [notebookEntries, voiceHistory]);

  const visibleEntries = useMemo(() => {
    if (activeTab === 'notes') {
      return allEntries.filter(e => e.source === 'user_note' || e.source === 'notebook' || e.source === 'brief');
    }
    if (activeTab === 'pinned') {
      return allEntries.filter(e => e.isPinned);
    }
    return allEntries;
  }, [allEntries, activeTab]);

  // Save manual note
  const handleSaveNewNote = useCallback(() => {
    if (!newNoteTitle.trim() && !newNoteContent.trim()) return;
    const newEntry: LedgerEntry = {
      id: `manual-note-${Date.now()}`,
      source: 'user_note',
      timestamp: Date.now(),
      query: newNoteTitle.trim() || 'Operational Note',
      content: newNoteContent.trim(),
      isPinned: false,
      tag: newNoteTag || undefined,
    };
    setNotebookEntries(prev => [newEntry, ...prev]);
    setNewNoteTitle('');
    setNewNoteContent('');
    setIsCreatingNote(false);
    setActiveTab('notes');
  }, [newNoteTitle, newNoteContent, newNoteTag]);

  // Delete an entry
  const handleDeleteEntry = useCallback((id: string) => {
    setNotebookEntries(prev => prev.filter(e => e.id !== id));
  }, []);

  // Copy single entry to clipboard
  const handleCopyEntry = useCallback((entry: LedgerEntry) => {
    const text = entry.query
      ? `[${new Date(entry.timestamp).toLocaleTimeString()}] Query: ${entry.query}\nFinding: ${entry.content}`
      : `[${new Date(entry.timestamp).toLocaleTimeString()}] ${entry.content}`;
    navigator.clipboard.writeText(text);
    setCopiedId(entry.id);
    setTimeout(() => setCopiedId(null), 2000);
  }, []);

  // Copy complete exportable brief
  const handleCopyFullBrief = useCallback(() => {
    const header = `# ERIS Outbreak Intelligence Brief\nScenario ID: ${scenarioId || 'Active'}\nGenerated: ${new Date().toLocaleString()}\n\n---\n\n`;
    const body = allEntries
      .map((entry, idx) => {
        const time = new Date(entry.timestamp).toLocaleTimeString();
        const tag = entry.isPinned ? ' [PINNED]' : '';
        const title = entry.query ? `### ${idx + 1}. ${entry.query}${tag}` : `### ${idx + 1}. Log Item (${time})${tag}`;
        return `${title}\n*Logged: ${time} • Source: ${entry.source.toUpperCase()}*\n\n${entry.content}\n`;
      })
      .join('\n---\n\n');

    navigator.clipboard.writeText(header + body);
    setCopiedAll(true);
    setTimeout(() => setCopiedAll(false), 2500);
  }, [allEntries, scenarioId]);

  // Toggle pin
  const handleTogglePin = useCallback((id: string) => {
    setNotebookEntries(prev => {
      const exists = prev.some(entry => entry.id === id);
      if (exists) {
        return prev.map(entry => (entry.id === id ? { ...entry, isPinned: !entry.isPinned } : entry));
      }
      const voiceItem = allEntries.find(e => e.id === id);
      if (voiceItem) {
        return [{ ...voiceItem, isPinned: true }, ...prev];
      }
      return prev;
    });
  }, [allEntries]);

  // Submit typed query/note
  const handleSend = useCallback(async () => {
    const userMessage = inputValue.trim();
    if (!userMessage || !scenarioId || isLoading) return;

    setInputValue('');
    setIsLoading(true);

    try {
      const response = await fetch(`${BACKEND_URL}/api/v1/assistant/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scenario_id: scenarioId,
          message: userMessage,
          conversation_history: [],
          voice_mode: false, // Text mode gets rich structured brief formatting
          screen_context: screenContext,
        }),
      });

      if (!response.ok) throw new Error('API Error');
      const data = await response.json();
      let replyText: string = data.response || '';

      // Translation if non-English requested
      if (selectedLanguage !== 'en-IN') {
        try {
          const tRes = await fetch(`${BACKEND_URL}/api/v1/sarvam/translate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: replyText, target_language_code: selectedLanguage }),
          });
          const tData = await tRes.json();
          replyText = tData.translated_text || replyText;
        } catch {}
      }

      const newEntry: LedgerEntry = {
        id: `note-${Date.now()}`,
        source: 'notebook',
        timestamp: Date.now(),
        query: userMessage,
        content: replyText,
        isPinned: false,
      };

      const loggedFindings = data.logged_findings || [];
      const extraEntries: LedgerEntry[] = Array.isArray(loggedFindings)
        ? loggedFindings.map((f: any, idx: number) => ({
            id: `finding-${Date.now()}-${idx}`,
            source: 'user_note' as const,
            timestamp: f.timestamp || Date.now(),
            query: f.title || userMessage,
            content: f.finding || '',
            isPinned: !!f.pin_to_brief,
            tag: 'AI Finding',
          }))
        : [];

      setNotebookEntries(prev => [...extraEntries, ...prev, newEntry]);
    } catch (error) {
      console.error(error);
      setNotebookEntries(prev => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          source: 'notebook',
          timestamp: Date.now(),
          query: userMessage,
          content: 'Error: Failed to fetch analytical response from server.',
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  }, [inputValue, scenarioId, isLoading, selectedLanguage]);

  // Manual Trigger: War Room Brief
  const handleGenerateBrief = useCallback(async () => {
    if (!scenarioId || autoBriefLoading) return;
    setAutoBriefLoading(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/v1/eris/auto-brief`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenario_id: scenarioId }),
      });
      const data = await res.json();
      const briefText: string = data.response || '';

      const briefEntry: LedgerEntry = {
        id: `brief-${Date.now()}`,
        source: 'brief',
        timestamp: Date.now(),
        query: 'Executive War Room Brief',
        content: briefText,
        isPinned: true,
      };

      setNotebookEntries(prev => [briefEntry, ...prev]);
    } catch (err) {
      console.error('Auto-brief error:', err);
    } finally {
      setAutoBriefLoading(false);
    }
  }, [scenarioId, autoBriefLoading]);

  // Auto trigger on simulation complete event
  useEffect(() => {
    const handleSimComplete = () => {
      handleGenerateBrief();
    };
    window.addEventListener('simulation-complete', handleSimComplete);
    return () => window.removeEventListener('simulation-complete', handleSimComplete);
  }, [handleGenerateBrief]);

  // Autonomous Deep Research Dispatch (Bedrock Engine / Groq Fallback)
  const handleDispatchResearch = useCallback(async (customQuery?: string) => {
    if (isResearching) return;
    setIsResearching(true);
    setResearchStage(1);
    setResearchStatusMsg('Formulating candidate policy interventions via Inverse Planning...');

    const promptQuery =
      customQuery ||
      inputValue.trim() ||
      'Evaluate targeted transit cordons vs phased statewide restrictions vs ring vaccination over 180 days with hospital and oxygen stress';

    if (!customQuery && inputValue.trim()) {
      setInputValue('');
    }

    try {
      const res = await fetch(`${BACKEND_URL}/api/research/dispatch-mission`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: promptQuery,
          scenario_id: scenarioId || 'active_scenario',
          origin_city: 'KOCHI',
        }),
      });

      if (!res.ok) {
        throw new Error(`Dispatch failed with status ${res.status}`);
      }

      const { mission_id } = await res.json();

      // Poll for completion (up to 60s)
      const startTime = Date.now();
      let completed = false;

      while (!completed && Date.now() - startTime < 60000) {
        await new Promise((r) => setTimeout(r, 1000));
        const statusRes = await fetch(`${BACKEND_URL}/api/research/mission-status/${mission_id}`);
        if (!statusRes.ok) continue;

        const statusData = await statusRes.json();
        if (statusData.progress && statusData.progress.length > 0) {
          const latestProgress = statusData.progress[statusData.progress.length - 1];
          setResearchStatusMsg(latestProgress.msg || 'Simulating interventions...');
          const stageKey = latestProgress.stage || statusData.status;
          if (stageKey === 'inverse_planning') setResearchStage(1);
          else if (stageKey === 'sobol_sim') setResearchStage(2);
          else if (stageKey === 'stress_testing') setResearchStage(3);
          else if (stageKey === 'synthesis') setResearchStage(4);
          else if (stageKey === 'ready') setResearchStage(5);
        }

        if (statusData.status === 'ready') {
          completed = true;
          setResearchStage(5);
          let dossierData: DossierData = statusData.dossier;
          if (!dossierData && statusData.dossier_id) {
            const dRes = await fetch(`${BACKEND_URL}/api/research/dossier/${statusData.dossier_id}`);
            if (dRes.ok) {
              dossierData = await dRes.json();
            }
          }

          if (dossierData) {
            const newEntry: LedgerEntry = {
              id: `research-${Date.now()}`,
              source: 'brief',
              timestamp: Date.now(),
              query: `Autonomous Research: ${dossierData.title || dossierData.mission_title || promptQuery}`,
              content: `### Executive Verdict\n${dossierData.executive_verdict}\n\n→ **Strategic Directive**: ${dossierData.recommendation || 'Deploy localized containment cordons around primary transit edges.'}`,
              isPinned: true,
              tag: (dossierData.provenance === 'degraded_fallback' || dossierData.degraded_fallback) ? 'Research (Fallback)' : 'Deep Research',
              dossier: dossierData,
            };
            setNotebookEntries(prev => [newEntry, ...prev]);
            setSelectedDossier(dossierData);
          }
          break;
        } else if (statusData.status === 'failed') {
          throw new Error(statusData.error || 'Deep research mission encountered an error.');
        }
      }

      if (!completed) {
        throw new Error('Research mission timed out after 60 seconds.');
      }
    } catch (err: any) {
      console.error('Deep Research Dispatch Error:', err);
      setNotebookEntries(prev => [
        {
          id: `research-err-${Date.now()}`,
          source: 'notebook',
          timestamp: Date.now(),
          query: `Research: ${promptQuery}`,
          content: `⚠️ **Research Mission Failed**: ${err.message || 'Unable to complete simulation runs.'}`,
        },
        ...prev,
      ]);
    } finally {
      setIsResearching(false);
      setResearchStatusMsg(null);
      setResearchStage(1);
    }
  }, [isResearching, inputValue, scenarioId]);

  // Listen for external research trigger events
  useEffect(() => {
    const handleTriggerResearch = (e: Event) => {
      const data = (e as CustomEvent).detail;
      handleDispatchResearch(data?.query);
    };
    window.addEventListener('eris-dispatch-research', handleTriggerResearch);
    return () => window.removeEventListener('eris-dispatch-research', handleTriggerResearch);
  }, [handleDispatchResearch]);

  return (
    <>
      {isOpen && (
        <div
          className="fixed z-50 flex flex-col bg-surface border-l border-outline/40 shadow-2xl overflow-hidden"
          style={{ right: '0px', top: '0px', bottom: '0px', width: '450px' }}
        >
      {/* Notebook Dossier Header */}
      <div className="flex flex-col border-b border-outline/30 bg-surface-container/40 p-4 shrink-0">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-primary/10 text-primary flex items-center justify-center font-bold text-xs">
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 6h4" />
                <path d="M2 10h4" />
                <path d="M2 14h4" />
                <path d="M2 18h4" />
                <rect width="16" height="20" x="4" y="2" rx="2" />
                <path d="M9.5 8h5" />
                <path d="M9.5 12h5" />
                <path d="M9.5 16h5" />
              </svg>
            </div>
            <div>
              <div className="font-heading font-semibold text-sm text-on-surface tracking-tight leading-tight">
                ERIS Intelligence Notebook
              </div>
              <div className="text-[10px] font-mono text-on-surface-variant flex items-center gap-1.5 mt-0.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                <span>Live Analytical Ledger</span>
                <span>•</span>
                <span>{allEntries.length} entries</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => handleDispatchResearch()}
              disabled={isResearching}
              className="h-7.5 px-3 rounded-lg bg-indigo-500/15 border border-indigo-500/35 hover:border-indigo-500/65 text-indigo-700 dark:text-indigo-300 text-xs font-semibold flex items-center gap-1.5 shadow-xs hover:bg-indigo-500/25 transition-all cursor-pointer disabled:opacity-50"
              title="Run Autonomous Deep Research on multi-fork interventions (180 days)"
            >
              <svg className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
                <path d="M11 8v6" />
                <path d="M8 11h6" />
              </svg>
              <span>{isResearching ? 'Simulating...' : 'Research'}</span>
            </button>

            <button
              onClick={onClose}
              className="w-7 h-7 rounded-lg hover:bg-surface-variant flex items-center justify-center text-on-surface-variant hover:text-on-surface transition-colors cursor-pointer"
              title="Close Notebook"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        {/* Notebook Quick Actions Toolbar */}
        <div className="flex items-center justify-between pt-2 border-t border-outline/20 text-xs gap-2">
          {/* Tab Filter: All Activity | Notes & Memos | Pinned */}
          <div className="flex items-center gap-0.5 bg-surface-container rounded-lg p-0.5 border border-outline/20 shrink-0">
            <button
              onClick={() => setActiveTab('all')}
              className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors cursor-pointer ${
                activeTab === 'all'
                  ? 'bg-surface text-on-surface shadow-xs font-semibold'
                  : 'text-on-surface-variant hover:text-on-surface'
              }`}
            >
              All Activity
            </button>
            <button
              onClick={() => setActiveTab('notes')}
              className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors cursor-pointer flex items-center gap-1.5 ${
                activeTab === 'notes'
                  ? 'bg-surface text-emerald-700 dark:text-emerald-300 shadow-xs font-semibold'
                  : 'text-on-surface-variant hover:text-on-surface'
              }`}
            >
              <svg className="w-3 h-3 text-emerald-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
                <line x1="10" y1="9" x2="8" y2="9" />
              </svg>
              <span>Notes & Memos</span>
            </button>
            <button
              onClick={() => setActiveTab('pinned')}
              className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors cursor-pointer flex items-center gap-1.5 ${
                activeTab === 'pinned'
                  ? 'bg-surface text-amber-600 dark:text-amber-400 shadow-xs font-semibold'
                  : 'text-on-surface-variant hover:text-on-surface'
              }`}
            >
              <svg className="w-3 h-3 text-amber-500" viewBox="0 0 24 24" fill="currentColor">
                <path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z" />
              </svg>
              <span>Pinned</span>
            </button>
          </div>

          {/* Action Buttons: Brief & Export */}
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={handleGenerateBrief}
              disabled={autoBriefLoading}
              className="h-7 px-2.5 rounded-lg bg-surface border border-outline/30 hover:border-primary/50 text-on-surface text-[11px] font-medium flex items-center gap-1.5 shadow-xs hover:bg-surface-variant transition-all cursor-pointer disabled:opacity-50"
              title="Generate comprehensive War Room brief"
            >
              <svg className="w-3 h-3 text-amber-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3L12 3Z" />
              </svg>
              <span>Brief</span>
            </button>

            <button
              onClick={handleCopyFullBrief}
              className="h-7 px-3 rounded-lg bg-primary text-white text-[11px] font-semibold flex items-center gap-1.5 shadow-xs hover:bg-primary/90 transition-all cursor-pointer"
              title="Copy formatted markdown brief of all notebook entries"
            >
              {copiedAll ? (
                <>
                  <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  <span>Copied!</span>
                </>
              ) : (
                <>
                  <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
                    <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
                  </svg>
                  <span>Export</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {isResearching && (
        <div className="mx-3 my-2.5 p-3 rounded-xl bg-surface-container/90 border border-primary/30 shadow-md text-on-surface font-sans shrink-0 animate-in fade-in slide-in-from-top-2 duration-150">
          <div className="flex items-center justify-between pb-2 mb-2 border-b border-outline/20">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
              <span className="text-[10.5px] font-mono font-bold uppercase tracking-wider text-primary">
                Autonomous Inverse Discovery Engine
              </span>
            </div>
            <div className="flex items-center gap-1.5 font-mono text-[10.5px]">
              <span className="text-on-surface-variant/70 text-[9.5px]">Elapsed:</span>
              <span className="font-bold text-amber-500 px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/20">
                00:{researchElapsedSec.toString().padStart(2, '0')}s
              </span>
            </div>
          </div>

          {/* 4-Stage Stepper */}
          <div className="space-y-1.5 my-2">
            {[
              { num: 1, label: 'Candidate Policy Formulation', sub: 'Inverse Planning Levers' },
              { num: 2, label: '50-Iteration Sobol QMC', sub: 'Stochastic Parameter Sampling' },
              { num: 3, label: 'ICU & Oxygen Stress Testing', sub: '9,690 MT/day Ceiling Bound' },
              { num: 4, label: 'Dossier Synthesis & Directive', sub: 'P10/P50/P90 Envelopes' },
            ].map((st) => {
              const isDone = researchStage > st.num;
              const isCurrent = researchStage === st.num;
              return (
                <div key={st.num} className="flex items-center justify-between text-[10.5px]">
                  <div className="flex items-center gap-2">
                    <span className={`w-4 h-4 rounded-full flex items-center justify-center font-mono text-[9px] font-bold transition-colors ${
                      isDone
                        ? 'bg-emerald-500 text-white'
                        : isCurrent
                        ? 'bg-primary text-white animate-pulse'
                        : 'bg-surface-variant text-on-surface-variant'
                    }`}>
                      {isDone ? '✓' : st.num}
                    </span>
                    <span className={`font-medium ${isCurrent ? 'text-primary font-semibold' : isDone ? 'text-on-surface' : 'text-on-surface-variant/60'}`}>
                      {st.label}
                    </span>
                  </div>
                  <span className="font-mono text-[9px] text-on-surface-variant/60">
                    {st.sub}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Current Live Status readout */}
          <div className="mt-2 pt-1.5 border-t border-outline/15 flex items-center justify-between text-[10px] text-on-surface-variant font-mono">
            <span className="truncate max-w-[280px] text-primary/90 font-medium">{researchStatusMsg || 'Running stochastic exploration...'}</span>
            <span className="text-emerald-600 dark:text-emerald-400 font-semibold shrink-0">50 Sobol Runs</span>
          </div>
        </div>
      )}

      {autoBriefLoading && (
        <div className="px-4 py-2 bg-amber-500/10 border-b border-amber-500/20 flex items-center gap-2 text-[11px] text-amber-700 dark:text-amber-300 font-medium shrink-0">
          <span className="w-1.5 h-1.5 bg-amber-500 rounded-full animate-pulse" />
          <span>Synthesizing War Room Executive Brief from simulation runs...</span>
        </div>
      )}

      {/* Ledger Body: Structured Notes & Intelligence Log */}
      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3 bg-background">
        {/* In Notes View: Add Note Trigger Button */}
        {activeTab === 'notes' && !isCreatingNote && (
          <button
            onClick={() => setIsCreatingNote(true)}
            className="w-full py-2.5 px-3 rounded-xl border border-dashed border-emerald-500/50 hover:border-emerald-500 bg-emerald-500/5 hover:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 text-xs font-semibold flex items-center justify-center gap-2 transition-all cursor-pointer shadow-2xs group shrink-0"
          >
            <span className="w-5 h-5 rounded-full bg-emerald-500/15 group-hover:bg-emerald-500 group-hover:text-white flex items-center justify-center transition-colors">
              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </span>
            <span>New Operational Memo</span>
          </button>
        )}

        {/* Dedicated Note Creator Form (shown in Notes view when active) */}
        {activeTab === 'notes' && isCreatingNote && (
          <div className="rounded-xl border border-emerald-500/40 bg-surface p-3.5 shadow-sm space-y-3 shrink-0">
            <div className="flex items-center justify-between pb-1.5 border-b border-outline/15">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400 font-mono">
                <svg className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line x1="16" y1="13" x2="8" y2="13" />
                  <line x1="16" y1="17" x2="8" y2="17" />
                  <line x1="10" y1="9" x2="8" y2="9" />
                </svg>
                <span>NEW OPERATIONAL MEMO</span>
              </div>
              <button
                onClick={() => {
                  setIsCreatingNote(false);
                  setNewNoteTitle('');
                  setNewNoteContent('');
                }}
                className="text-on-surface-variant hover:text-on-surface p-1 rounded-md hover:bg-surface-variant transition-colors cursor-pointer"
                title="Cancel"
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            <div className="space-y-2.5">
              <div>
                <label className="block text-[10px] font-mono text-on-surface-variant uppercase tracking-wider mb-1 font-semibold">
                  Title / Directive
                </label>
                <input
                  type="text"
                  placeholder="e.g. Prioritize liquid oxygen tankers to Patna..."
                  value={newNoteTitle}
                  onChange={e => setNewNoteTitle(e.target.value)}
                  className="w-full bg-surface-container/70 border border-outline/30 rounded-lg px-3 py-1.5 text-xs text-on-surface placeholder:text-on-surface-variant/50 focus:outline-none focus:border-emerald-500 font-medium"
                />
              </div>

              <div>
                <label className="block text-[10px] font-mono text-on-surface-variant uppercase tracking-wider mb-1 font-semibold">
                  Details & Observations
                </label>
                <textarea
                  placeholder="Write action items, logistical requirements, or clinical observations..."
                  value={newNoteContent}
                  onChange={e => setNewNoteContent(e.target.value)}
                  rows={3}
                  className="w-full bg-surface-container/70 border border-outline/30 rounded-lg px-3 py-2 text-xs text-on-surface placeholder:text-on-surface-variant/50 focus:outline-none focus:border-emerald-500 resize-none font-sans leading-relaxed"
                />
              </div>
            </div>

            {/* Tag Selector on its own row */}
            <div>
              <div className="text-[10px] font-mono text-on-surface-variant uppercase tracking-wider mb-1.5 font-semibold">
                Category Tag
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                {['Action', 'Directive', 'Observation', 'Logistics'].map(tag => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => setNewNoteTag(newNoteTag === tag ? '' : tag)}
                    className={`px-2.5 py-1 rounded-md text-[10.5px] font-mono transition-all cursor-pointer border ${
                      newNoteTag === tag
                        ? 'bg-emerald-600 border-emerald-600 text-white shadow-xs font-semibold'
                        : 'bg-surface-container border-outline/25 text-on-surface-variant hover:text-on-surface hover:bg-surface-variant'
                    }`}
                  >
                    #{tag}
                  </button>
                ))}
              </div>
            </div>

            {/* Form Footer Action Row - Dedicated, clean, high contrast */}
            <div className="flex items-center justify-end gap-2 pt-2.5 border-t border-outline/15">
              <button
                type="button"
                onClick={() => {
                  setIsCreatingNote(false);
                  setNewNoteTitle('');
                  setNewNoteContent('');
                }}
                className="px-3 py-1.5 rounded-lg text-xs font-medium text-on-surface-variant hover:text-on-surface hover:bg-surface-variant transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveNewNote}
                disabled={!newNoteTitle.trim() && !newNoteContent.trim()}
                className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white shadow-sm flex items-center gap-1.5 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                <span>Save Memo</span>
              </button>
            </div>
          </div>
        )}

        {visibleEntries.length === 0 ? (
          <div className="h-44 flex flex-col items-center justify-center text-center text-on-surface-variant text-xs p-6 border border-dashed border-outline/25 rounded-xl bg-surface-container/20">
            {activeTab === 'pinned' ? (
              <>
                <svg className="w-8 h-8 text-amber-500/40 mb-2" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z" />
                </svg>
                <span className="font-semibold text-on-surface">No pinned entries</span>
                <span className="text-[11px] mt-1 opacity-75 max-w-xs">
                  Click the pin icon on any log, memo, or intelligence finding to keep it bookmarked here.
                </span>
              </>
            ) : activeTab === 'notes' ? (
              <>
                <svg className="w-8 h-8 text-emerald-500/40 mb-2" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line x1="16" y1="13" x2="8" y2="13" />
                  <line x1="16" y1="17" x2="8" y2="17" />
                  <line x1="10" y1="9" x2="8" y2="9" />
                </svg>
                <span className="font-semibold text-on-surface">No operational memos</span>
                <span className="text-[11px] mt-1 opacity-75 max-w-xs">
                  Create operational notes and tactical directives using the button above.
                </span>
              </>
            ) : (
              <>
                <svg className="w-8 h-8 text-on-surface-variant/30 mb-2" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M2 6h4" /><path d="M2 10h4" /><path d="M2 14h4" /><path d="M2 18h4" />
                  <rect width="16" height="20" x="4" y="2" rx="2" />
                  <path d="M9.5 8h5" /><path d="M9.5 12h5" /><path d="M9.5 16h5" />
                </svg>
                <span className="font-semibold text-on-surface">No entries found</span>
                <span className="text-[11px] mt-1 opacity-75 max-w-xs">
                  Spoken turns with the Voice Orb and typed scenario notes will appear here.
                </span>
              </>
            )}
          </div>
        ) : (
          visibleEntries.map((entry) => {
            const isVoice = entry.source === 'voice';
            const isBrief = entry.source === 'brief';
            const isUserNote = entry.source === 'user_note';
            const timeStr = new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

            return (
              <div
                key={entry.id}
                className={`relative rounded-xl border p-3.5 text-xs transition-all ${
                  entry.isPinned
                    ? 'bg-amber-500/5 border-amber-500/40 shadow-xs'
                    : isBrief
                    ? 'bg-primary/5 border-primary/30 shadow-xs'
                    : isUserNote
                    ? 'bg-emerald-500/5 border-emerald-500/30 shadow-xs'
                    : 'bg-surface border-outline/30 shadow-xs hover:border-outline/60'
                }`}
              >
                {/* Entry Meta Header */}
                <div className="flex items-center justify-between mb-2 pb-1.5 border-b border-outline/15 text-[10px] font-mono">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span
                      className={`px-1.5 py-0.5 rounded font-bold uppercase tracking-wider text-[9px] flex items-center gap-1 ${
                        isVoice
                          ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
                          : isBrief
                          ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                          : isUserNote
                          ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                          : 'bg-neutral-500/10 text-on-surface-variant'
                      }`}
                    >
                      {isVoice ? (
                        <>
                          <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                          </svg>
                          <span>VOICE LOG</span>
                        </>
                      ) : isBrief ? (
                        <>
                          <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3L12 3Z" />
                          </svg>
                          <span>WAR ROOM BRIEF</span>
                        </>
                      ) : isUserNote ? (
                        <>
                          <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                            <polyline points="14 2 14 8 20 8" />
                            <line x1="16" y1="13" x2="8" y2="13" />
                            <line x1="16" y1="17" x2="8" y2="17" />
                            <line x1="10" y1="9" x2="8" y2="9" />
                          </svg>
                          <span>OPERATIONAL MEMO</span>
                        </>
                      ) : (
                        <>
                          <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                          </svg>
                          <span>ANALYST NOTE</span>
                        </>
                      )}
                    </span>

                    {entry.tag && (
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-surface-container text-on-surface-variant font-medium border border-outline/20">
                        #{entry.tag}
                      </span>
                    )}

                    <span className="text-on-surface-variant">{timeStr}</span>
                  </div>

                  {/* Entry Quick Actions (Delete / Pin / Copy - To Note removed per user request) */}
                  <div className="flex items-center gap-1">
                    {/* Delete button for user notes */}
                    {isUserNote && (
                      <button
                        onClick={() => handleDeleteEntry(entry.id)}
                        className="p-1 rounded hover:bg-red-500/10 text-on-surface-variant hover:text-red-500 transition-colors cursor-pointer"
                        title="Delete memo"
                      >
                        <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M3 6h18" /><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" /><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                        </svg>
                      </button>
                    )}

                    <button
                      onClick={() => handleTogglePin(entry.id)}
                      className={`p-1 rounded hover:bg-surface-variant transition-colors cursor-pointer ${
                        entry.isPinned ? 'text-amber-500' : 'text-on-surface-variant hover:text-on-surface'
                      }`}
                      title={entry.isPinned ? 'Unpin from brief' : 'Pin to executive brief'}
                    >
                      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill={entry.isPinned ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="12" y1="17" x2="12" y2="22" />
                        <path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z" />
                      </svg>
                    </button>

                    <button
                      onClick={() => handleCopyEntry(entry)}
                      className="px-2 py-0.5 rounded hover:bg-surface-variant text-[10px] text-on-surface-variant hover:text-on-surface transition-colors cursor-pointer flex items-center gap-1 border border-outline/20"
                      title="Copy finding to clipboard"
                    >
                      {copiedId === entry.id ? (
                        <>
                          <svg className="w-3 h-3 text-emerald-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                          <span className="text-emerald-600 font-semibold">Copied</span>
                        </>
                      ) : (
                        <>
                          <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
                            <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
                          </svg>
                          <span>Copy</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>

                {/* Entry Query (if present) */}
                {entry.query && (
                  <div className="font-semibold text-on-surface mb-2 text-[12px] leading-snug">
                    {entry.query}
                  </div>
                )}

                {/* Entry Body Finding */}
                <div className="text-on-surface/90 font-sans text-[12px]">
                  <FormattedLedgerContent
                    content={entry.content}
                    onOpenDossier={(d) => setSelectedDossier(d)}
                  />
                  {entry.dossier && (
                    <ErisDossierCard
                      dossier={entry.dossier}
                      onOpenDossier={(d) => setSelectedDossier(d)}
                    />
                  )}
                </div>
              </div>
            );
          })
        )}

        {isLoading && (
          <div className="rounded-xl border border-primary/20 bg-primary/5 p-3 flex items-center gap-2.5 text-xs text-primary font-medium">
            <span className="w-2 h-2 bg-primary rounded-full animate-ping" />
            <span>Analyzing scenario data & writing finding...</span>
          </div>
        )}

        <div ref={scrollRef} />
      </div>

      {/* Analytical Query & Ledger Append Bar */}
      <div className="p-3.5 border-t border-outline/30 bg-surface shrink-0">
        {/* Output Language Selector */}
        <div className="flex items-center justify-between mb-2 text-[11px] text-on-surface-variant">
          <span className="font-mono">Log analytical inquiry:</span>
          <div className="flex items-center gap-1">
            <span>Language:</span>
            <select
              value={selectedLanguage}
              onChange={(e) => setSelectedLanguage(e.target.value)}
              className="bg-surface-container border border-outline/30 rounded px-1.5 py-0.5 text-[11px] text-on-surface font-medium focus:outline-none focus:border-primary cursor-pointer"
            >
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Command Bar Input (No Mic, Clean Analytical Console) */}
        <div className="flex items-center gap-1.5 bg-surface-container rounded-xl border border-outline/40 p-1 focus-within:border-primary focus-within:ring-1 focus-within:ring-primary/20 transition-all">
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !isLoading && handleSend()}
            placeholder="Type query to analyze or append finding... (Enter)"
            disabled={!scenarioId || isLoading}
            className="flex-1 bg-transparent px-3 py-1.5 text-xs text-on-surface placeholder:text-on-surface-variant/50 focus:outline-none disabled:opacity-50"
          />

          <button
            onClick={handleSend}
            disabled={!scenarioId || isLoading || !inputValue.trim()}
            className="h-8 px-3 rounded-lg bg-primary text-white text-xs font-semibold flex items-center gap-1.5 shadow-xs hover:bg-primary/90 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
            title="Log analytical query (Enter)"
          >
            <span>Log</span>
            <svg className="w-3.5 h-3.5 opacity-80" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 10 4 15 9 20" />
              <path d="M20 4v7a4 4 0 0 1-4 4H4" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  )}

  {/* Autonomous Research Dossier Modal - Full Viewport Level */}
  <ResearchDossierModal
    dossier={selectedDossier}
    isOpen={!!selectedDossier}
    onClose={() => setSelectedDossier(null)}
    onSaveToNotebook={(dossier) => {
      const newEntry: LedgerEntry = {
        id: `dossier-saved-${Date.now()}`,
        source: 'brief',
        timestamp: Date.now(),
        query: dossier.title,
        content: dossier.executive_verdict,
        isPinned: true,
        tag: 'Research Dossier',
        dossier: dossier,
      };
      setNotebookEntries(prev => [newEntry, ...prev]);
    }}
  />
</>
  );
}
