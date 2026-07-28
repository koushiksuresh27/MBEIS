import { usePathogenProfile } from '../../hooks/usePathogenProfile';

interface DerivationBasisInspectorProps {
  scenarioId: string;
}

export default function DerivationBasisInspector({ scenarioId }: DerivationBasisInspectorProps) {
  const { profile, loading, error } = usePathogenProfile(scenarioId);

  if (loading || error || !profile) {
    return null;
  }

  //if (profile.profile_type !== 'derived') {
  //return null;
  // }

  return (
    <div className="bg-surface-variant rounded-xl border border-outline p-6 shadow-sm flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <h3 className="font-sans font-semibold text-on-background text-lg">
          Pathogen Profile Provenance
        </h3>
        <span className="font-mono text-xs uppercase bg-[#FFF3E0] text-[#F57F17] border border-[#F57F17]/30 px-2 py-0.5 rounded-full">
          DERIVED PROFILE
        </span>
      </div>

      {/* Section 1: Parameter ranges table */}
      <div>
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-outline">
              <th className="py-2 pl-2 font-mono text-xs uppercase text-on-surface-variant">Parameter</th>
              <th className="py-2 px-2 font-mono text-xs uppercase text-on-surface-variant">Low</th>
              <th className="py-2 px-2 font-mono text-xs uppercase text-on-surface-variant">Most Likely</th>
              <th className="py-2 px-2 font-mono text-xs uppercase text-on-surface-variant">High</th>
            </tr>
          </thead>
          <tbody className="font-mono text-sm">
            <tr className="border-b border-outline/50 bg-surface-container/50">
              <td className="py-2 pl-2 text-on-background">R0</td>
              <td className="py-2 px-2 text-on-surface-variant">{profile.r0_low}</td>
              <td className="py-2 px-2 text-on-surface-variant">{profile.r0_most_likely}</td>
              <td className="py-2 px-2 text-on-surface-variant">{profile.r0_high}</td>
            </tr>
            <tr className="border-b border-outline/50">
              <td className="py-2 pl-2 text-on-background">Incubation (days)</td>
              <td className="py-2 px-2 text-on-surface-variant">{profile.incubation_days_low}</td>
              <td className="py-2 px-2 text-on-surface-variant">{profile.incubation_days_most_likely}</td>
              <td className="py-2 px-2 text-on-surface-variant">{profile.incubation_days_high}</td>
            </tr>
            <tr className="bg-surface-container/50">
              <td className="py-2 pl-2 text-on-background">CFR (%)</td>
              <td className="py-2 px-2 text-on-surface-variant">{profile.cfr_low}</td>
              <td className="py-2 px-2 text-on-surface-variant">{profile.cfr_most_likely}</td>
              <td className="py-2 px-2 text-on-surface-variant">{profile.cfr_high}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Section 2: Derivation Basis */}
      {profile.derivation_basis && (
        <div className="flex flex-col gap-4">
          <h4 className="font-sans font-semibold text-sm text-on-background">
            Derivation Basis
          </h4>
          <div className="flex flex-col gap-3">
            {profile.derivation_basis.contributing_diseases.map((disease, idx) => (
              <div key={idx} className="flex flex-col gap-1">
                <div className="flex justify-between items-end">
                  <span className="font-sans text-sm text-on-background font-medium">
                    {disease.name}
                  </span>
                  <span className="font-mono text-xs text-on-surface-variant">
                    {Math.round(disease.weight * 100)}%
                  </span>
                </div>
                <div className="bg-outline/30 w-full rounded-full h-1.5 overflow-hidden">
                  <div
                    className="h-1.5 rounded-full bg-primary"
                    style={{ width: `${Math.max(0, Math.min(100, disease.weight * 100))}%` }}
                  />
                </div>
                <div className="font-mono text-xs text-on-surface-variant mt-0.5">
                  {disease.similarity_axes.join(', ')}
                </div>
              </div>
            ))}
          </div>
          {profile.derivation_basis.reasoning && (
            <div className="text-sm font-sans text-on-surface-variant italic border-l-2 border-outline pl-3 mt-2">
              {profile.derivation_basis.reasoning}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
