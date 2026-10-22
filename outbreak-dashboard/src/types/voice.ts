export type VoiceState =
  | 'off'
  | 'idle'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'muted'
  | 'error'
  | 'attention';

export interface ScreenContext {
  currentView: 'planner' | 'analyst' | 'map';
  scenarioId: string;
  selectedCity?: string;
  activeIntervention?: string;
  visibleFilters?: Record<string, any>;
  lastRiskRanking?: Array<{ city: string; peak_active_cases: number; peak_day: number }>;
  isPlaygroundOpen?: boolean;
  activeFeatures?: string[];
  screenSummary?: string;
}

export interface VoiceConversationTurn {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  language?: string;
  audioBase64?: string;
}

export interface VoiceAgentContextType {
  state: VoiceState;
  isMuted: boolean;
  errorMessage: string | null;
  history: VoiceConversationTurn[];
  activeLanguage: string;
  currentTranscript: string;
  agentResponse: string;
  analyser: AnalyserNode | null;
  activeSpeaker: 'user' | 'agent' | null;
  speaker: 'roopa' | 'aayan';
  setSpeaker: (speaker: 'roopa' | 'aayan') => void;
  micMode: 'ptt' | 'free';
  setMicMode: (mode: 'ptt' | 'free') => void;
  activate: () => Promise<void>;
  deactivate: () => void;
  toggleMute: () => void;
  setAttention: (active: boolean) => void;
  speakText: (text: string, languageCode?: string) => Promise<void>;
  updateScreenContext: (context: Partial<ScreenContext>) => void;
  screenContext: ScreenContext;
}
