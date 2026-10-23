export interface DossierScorecard {
  name: string;
  peak_cases: number;
  peak_p90_cases?: number;
  peak_day: number;
  icu_deficit: number;
  icu_deficit_p90?: number;
  oxygen_mt: number;
  oxygen_deficit_p90?: number;
  peak_oxygen?: number;
  deaths_saved: number;
  reduction_pct: number;
  mobility_preservation_pct?: number;
  breached_o2?: boolean;
  plan_config?: any;
}

export interface DossierCitation {
  source: string;
  year?: string;
  finding: string;
}

export interface DossierTimelineItem {
  day: number;
  phase: string;
  action: string;
}

export interface ChartSeriesData {
  active: Array<{ day: number; baseline: number; [planKey: string]: number }>;
  icu: Array<{ day: number; baseline: number; [planKey: string]: number }>;
  oxygen: Array<{ day: number; baseline: number; [planKey: string]: number }>;
}

export interface DossierData {
  dossier_id: string;
  title: string;
  mission_title?: string;
  scenario_id?: string;
  provenance?: 'bedrock_sonnet' | 'bedrock_haiku' | 'degraded_fallback' | string;
  degraded_fallback?: boolean;
  executive_verdict: string;
  recommendation: string;
  scorecards: DossierScorecard[];
  chart_series: ChartSeriesData;
  citations: DossierCitation[];
  timeline: DossierTimelineItem[];
  methodology_footnote?: string;
  fallback_note?: string;
}
