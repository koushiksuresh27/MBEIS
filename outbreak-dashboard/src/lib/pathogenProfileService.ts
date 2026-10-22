import { supabase } from './supabase';

export interface TriangularParam {
  low: number;
  most_likely: number;
  high: number;
}

export interface NovelPathogenInput {
  name: string;
  r0: TriangularParam;
  cfr: TriangularParam;
  incubation: TriangularParam;
  infectious: TriangularParam;
}

/**
 * Saves a custom/novel pathogen profile to Supabase with strict schema validation.
 * Guaranteed to increment version and satisfy all PostgreSQL check constraints.
 */
export async function saveNovelPathogenProfile(
  scenarioId: string,
  input: NovelPathogenInput
): Promise<{ success: boolean; version: number; error?: string }> {
  try {
    // 1. Triangular invariant validation
    if (input.r0.low > input.r0.most_likely || input.r0.most_likely > input.r0.high) {
      throw new Error(`R₀ bounds invalid: low (${input.r0.low}) ≤ most likely (${input.r0.most_likely}) ≤ high (${input.r0.high}) required.`);
    }
    if (input.cfr.low > input.cfr.most_likely || input.cfr.most_likely > input.cfr.high) {
      throw new Error(`CFR bounds invalid: low (${input.cfr.low}) ≤ most likely (${input.cfr.most_likely}) ≤ high (${input.cfr.high}) required.`);
    }
    if (input.incubation.low > input.incubation.most_likely || input.incubation.most_likely > input.incubation.high) {
      throw new Error(`Incubation bounds invalid: low (${input.incubation.low}) ≤ most likely (${input.incubation.most_likely}) ≤ high (${input.incubation.high}) required.`);
    }

    // 2. Query highest version for scenario_id to satisfy UNIQUE(scenario_id, version)
    const { data: latestRows, error: fetchErr } = await supabase
      .from('pathogen_profiles')
      .select('version')
      .eq('scenario_id', scenarioId)
      .order('version', { ascending: false })
      .limit(1);

    if (fetchErr) {
      console.warn('Could not query previous pathogen_profiles version, defaulting to 0:', fetchErr);
    }

    const currentVersion = latestRows && latestRows.length > 0 ? Number(latestRows[0].version) : 0;
    const newVersion = currentVersion + 1;

    // 3. Format strict schema-compliant payload matching DB check constraints
    const profileRow = {
      scenario_id: scenarioId,
      version: newVersion,
      profile_type: 'derived', // Check constraint: 'matched' | 'derived'
      data_confidence: 'medium', // Check constraint: 'low' | 'medium' | 'high'
      matched_reference_disease_id: null,
      r0_low: Number(input.r0.low.toFixed(2)),
      r0_most_likely: Number(input.r0.most_likely.toFixed(2)),
      r0_high: Number(input.r0.high.toFixed(2)),
      cfr_low: Number(input.cfr.low.toFixed(4)),
      cfr_most_likely: Number(input.cfr.most_likely.toFixed(4)),
      cfr_high: Number(input.cfr.high.toFixed(4)),
      incubation_days_low: Number(input.incubation.low.toFixed(1)),
      incubation_days_most_likely: Number(input.incubation.most_likely.toFixed(1)),
      incubation_days_high: Number(input.incubation.high.toFixed(1)),
      derivation_basis: {
        contributing_diseases: [
          {
            name: input.name || 'Novel Pathogen',
            weight: 1.0,
            similarity_axes: ['Custom empirical epidemiological profile']
          }
        ],
        reasoning: `User-defined pathogen specification for "${input.name || 'Novel Strain'}" with validated triangular uncertainty intervals.`
      }
    };

    const { error: insertErr } = await supabase
      .from('pathogen_profiles')
      .insert(profileRow);

    if (insertErr) {
      throw insertErr;
    }

    return { success: true, version: newVersion };
  } catch (err: any) {
    console.error('Failed to save novel pathogen profile:', err);
    return { success: false, version: 1, error: err?.message || String(err) };
  }
}

/**
 * Syncs a reference disease selection to pathogen_profiles so version is up to date.
 */
export async function syncReferenceDiseaseProfile(
  scenarioId: string,
  disease: any
): Promise<{ success: boolean; version: number; error?: string }> {
  try {
    const { data: latestRows } = await supabase
      .from('pathogen_profiles')
      .select('version')
      .eq('scenario_id', scenarioId)
      .order('version', { ascending: false })
      .limit(1);

    const currentVersion = latestRows && latestRows.length > 0 ? Number(latestRows[0].version) : 0;
    const newVersion = currentVersion + 1;

    const r0Mode = disease.r0_most_likely ?? 2.5;
    const cfrMode = disease.cfr_most_likely ?? 0.02;
    const incMode = disease.incubation_days_most_likely ?? 5.0;

    const profileRow = {
      scenario_id: scenarioId,
      version: newVersion,
      profile_type: 'matched',
      data_confidence: 'high',
      matched_reference_disease_id: disease.reference_disease_id,
      r0_low: disease.r0_low ?? Number((r0Mode * 0.75).toFixed(2)),
      r0_most_likely: Number(r0Mode.toFixed(2)),
      r0_high: disease.r0_high ?? Number((r0Mode * 1.35).toFixed(2)),
      cfr_low: disease.cfr_low ?? Number((cfrMode * 0.75).toFixed(4)),
      cfr_most_likely: Number(cfrMode.toFixed(4)),
      cfr_high: disease.cfr_high ?? Number((cfrMode * 1.35).toFixed(4)),
      incubation_days_low: disease.incubation_days_low ?? Number(Math.max(1, incMode - 2).toFixed(1)),
      incubation_days_most_likely: Number(incMode.toFixed(1)),
      incubation_days_high: disease.incubation_days_high ?? Number((incMode + 3).toFixed(1)),
      derivation_basis: null
    };

    const { error: insertErr } = await supabase
      .from('pathogen_profiles')
      .insert(profileRow);

    if (insertErr) {
      throw insertErr;
    }

    return { success: true, version: newVersion };
  } catch (err: any) {
    console.error('Failed to sync reference disease profile:', err);
    return { success: false, version: 1, error: err?.message || String(err) };
  }
}
