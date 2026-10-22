import { useState } from 'react';

export default function MobilityArchitectureDossier() {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'road' | 'rail' | 'air' | 'engine'>('road');

  return (
    <div className="w-full bg-surface rounded-xl border border-outline shadow-xs overflow-hidden transition-all duration-200">
      {/* Bar Header (Collapsed Bar) */}
      <div 
        onClick={() => setIsOpen(!isOpen)}
        className="px-4 py-2.5 flex items-center justify-between cursor-pointer hover:bg-surface-variant/40 transition-colors select-none"
      >
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 text-primary shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="18" cy="5" r="3" />
              <circle cx="6" cy="12" r="3" />
              <circle cx="18" cy="19" r="3" />
              <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
              <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
            </svg>
            <span className="text-xs font-semibold text-on-surface font-sans uppercase tracking-wider">
              Engine Architecture & Mobility Provenance
            </span>
          </div>

          <div className="hidden sm:flex items-center gap-2 font-mono text-[11px]">
            <span className="px-2.5 py-0.5 rounded-md bg-primary/10 text-primary font-semibold border border-primary/20">
              Tri-Modal Transit (Road · Rail · Air)
            </span>
            <span className="px-2.5 py-0.5 rounded-md bg-primary/10 text-primary font-semibold border border-primary/20">
              15-Node Metapopulation QMC
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs font-medium text-on-surface-variant shrink-0">
          <span className="hidden md:inline font-mono text-[11px]">
            {isOpen ? 'Collapse Blueprint' : 'Inspect Methodology'}
          </span>
          <div className="p-1 rounded-md bg-surface-variant border border-outline/60 text-on-surface">
            <svg 
              className={`w-3.5 h-3.5 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} 
              viewBox="0 0 24 24" 
              fill="none" 
              stroke="currentColor" 
              strokeWidth="2.5" 
              strokeLinecap="round" 
              strokeLinejoin="round"
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </div>
        </div>
      </div>

      {/* Expanded Blueprint Details */}
      {isOpen && (
        <div className="border-t border-outline bg-surface-variant/20 p-4 sm:p-5 space-y-4">
          {/* Tab Selector */}
          <div className="flex items-center gap-2 border-b border-outline pb-2.5 overflow-x-auto">
            <button
              onClick={() => setActiveTab('road')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center gap-2 shrink-0 ${
                activeTab === 'road'
                  ? 'bg-surface text-primary shadow-xs border border-outline font-semibold'
                  : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-variant/60'
              }`}
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="1" y="3" width="15" height="13" />
                <polygon points="16 8 20 8 23 11 23 16 16 16 16 8" />
                <circle cx="5.5" cy="18.5" r="2.5" />
                <circle cx="18.5" cy="18.5" r="2.5" />
              </svg>
              <span>Terrestrial Highway (Meta)</span>
            </button>

            <button
              onClick={() => setActiveTab('rail')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center gap-2 shrink-0 ${
                activeTab === 'rail'
                  ? 'bg-surface text-primary shadow-xs border border-outline font-semibold'
                  : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-variant/60'
              }`}
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="4" y="3" width="16" height="16" rx="2" />
                <path d="M4 11h16" />
                <path d="M12 3v8" />
                <path d="m8 19-2 3" />
                <path d="m16 19 2 3" />
                <circle cx="8" cy="15" r="1" />
                <circle cx="16" cy="15" r="1" />
              </svg>
              <span>National Railway (IRCTC)</span>
            </button>

            <button
              onClick={() => setActiveTab('air')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center gap-2 shrink-0 ${
                activeTab === 'air'
                  ? 'bg-surface text-primary shadow-xs border border-outline font-semibold'
                  : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-variant/60'
              }`}
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.3c.4-.2.6-.6.5-1.1z" />
              </svg>
              <span>Domestic Aviation (DGCA)</span>
            </button>

            <button
              onClick={() => setActiveTab('engine')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center gap-2 shrink-0 ${
                activeTab === 'engine'
                  ? 'bg-surface text-primary shadow-xs border border-outline font-semibold'
                  : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-variant/60'
              }`}
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
                <line x1="12" y1="22.08" x2="12" y2="12" />
              </svg>
              <span>Beyond-Textbook SEIRD Engine</span>
            </button>
          </div>

          {/* Tab 1: Road */}
          {activeTab === 'road' && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5 text-xs">
              <div className="bg-surface rounded-lg p-3.5 border border-outline/70 space-y-1.5">
                <div className="flex items-center gap-2 text-on-surface font-semibold font-sans">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
                  <span>1. Extraction & Urban Footprint</span>
                </div>
                <p className="text-on-surface-variant leading-relaxed font-sans">
                  Pulls real-world movement probabilities using a <strong className="text-on-surface">28-day trailing average</strong> from the Meta (Facebook) Movement Distribution API to eliminate weekend and holiday volatility.
                </p>
                <div className="pt-1 text-[11px] font-mono text-on-surface-variant/90 border-t border-outline/40">
                  Node populations defined via <strong className="text-on-surface">GHSL 2020</strong> continuous urban agglomeration footprints rather than administrative boundaries.
                </div>
              </div>

              <div className="bg-surface rounded-lg p-3.5 border border-outline/70 space-y-1.5">
                <div className="flex items-center gap-2 text-on-surface font-semibold font-sans">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
                  <span>2. Modified Radiation Model</span>
                </div>
                <p className="text-on-surface-variant leading-relaxed font-sans">
                  Replaces the standard circular Radiation Model (which artificially zeroes out inter-city highway transit) with an engineered <strong className="text-on-surface">Corridor Strip</strong> algorithm.
                </p>
                <div className="pt-1 text-[11px] font-mono text-on-surface-variant/90 border-t border-outline/40">
                  Restricts intervening opportunity mass (S<sub>ij</sub>) strictly to the narrow geographic highway corridor, bound by a strict traveler budget (<code className="text-primary font-bold">mob_rate</code>).
                </div>
              </div>

              <div className="bg-surface rounded-lg p-3.5 border border-outline/70 space-y-1.5">
                <div className="flex items-center gap-2 text-on-surface font-semibold font-sans">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
                  <span>3. MoRTH Multipliers & Toll Anchor</span>
                </div>
                <p className="text-on-surface-variant leading-relaxed font-sans">
                  Applies Ministry of Road Transport and Highways (<strong className="text-on-surface">MoRTH</strong>) infrastructure weights: +35% boost on express trunk routes (e.g., NE4) and penalties for non-highway links.
                </p>
                <div className="pt-1 text-[11px] font-mono text-on-surface-variant/90 border-t border-outline/40">
                  Calibrated to physical ground truth: constant (<code className="text-primary font-bold">C</code>) forces Mumbai–Pune corridor to verified toll benchmark of <strong className="text-on-surface">300,000 daily travelers</strong>.
                </div>
              </div>
            </div>
          )}

          {/* Tab 2: Rail */}
          {activeTab === 'rail' && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5 text-xs">
              <div className="bg-surface rounded-lg p-3.5 border border-outline/70 space-y-1.5">
                <div className="flex items-center gap-2 text-on-surface font-semibold font-sans">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
                  <span>1. Deterministic Station Mapping</span>
                </div>
                <p className="text-on-surface-variant leading-relaxed font-sans">
                  Ingests comprehensive, deduplicated IRCTC national timetable schedules. Uses an exact station translation dictionary to map dozens of codes (e.g. NDLS, HNZM, CSMT, BCT) into our 15 target urban nodes.
                </p>
                <div className="pt-1 text-[11px] font-mono text-on-surface-variant/90 border-t border-outline/40">
                  Schedules are computationally sliced into direct, adjacent city-to-city hops, filtering out minor local bypasses.
                </div>
              </div>

              <div className="bg-surface rounded-lg p-3.5 border border-outline/70 space-y-1.5">
                <div className="flex items-center gap-2 text-on-surface font-semibold font-sans">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
                  <span>2. Capacity & Distance Decay</span>
                </div>
                <p className="text-on-surface-variant leading-relaxed font-sans">
                  Each scheduled passenger service is assigned a baseline capacity of <strong className="text-on-surface">1,760 passengers</strong> (1,100 berths adjusted by a 1.6x unreserved passenger multiplier).
                </p>
                <div className="pt-1 text-[11px] font-mono text-on-surface-variant/90 border-t border-outline/40">
                  Power-law distance decay applied: hops exceeding 800 km trigger a distance penalty (exponent 1.5) simulating passenger boarding/alighting turnover.
                </div>
              </div>

              <div className="bg-surface rounded-lg p-3.5 border border-outline/70 space-y-1.5">
                <div className="flex items-center gap-2 text-on-surface font-semibold font-sans">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
                  <span>3. MoR Floors & Log1p Soft-Cap</span>
                </div>
                <p className="text-on-surface-variant leading-relaxed font-sans">
                  Manual passenger floors from Ministry of Railways (<strong className="text-on-surface">MoR</strong>) data hardcoded for major high-density corridors (e.g. Mumbai–Bengaluru), with a Gravity fallback for zero-edge gaps.
                </p>
                <div className="pt-1 text-[11px] font-mono text-on-surface-variant/90 border-t border-outline/40">
                  Compressed via <code className="text-primary font-bold">log1p</code> soft capping rather than hard clamping, preserving true national rail corridor rank-order hierarchy.
                </div>
              </div>
            </div>
          )}

          {/* Tab 3: Air */}
          {activeTab === 'air' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 text-xs">
              <div className="bg-surface rounded-lg p-3.5 border border-outline/70 space-y-1.5">
                <div className="flex items-center gap-2 text-on-surface font-semibold font-sans">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
                  <span>Direct DGCA City-Pair Matrix</span>
                </div>
                <p className="text-on-surface-variant leading-relaxed font-sans">
                  Extracted directly from official Directorate General of Civil Aviation (<strong className="text-on-surface">DGCA</strong>) published domestic passenger reports. Directly maps scheduled commercial flight capacity between the 15 primary hub airports across India.
                </p>
                <div className="pt-1 text-[11px] font-mono text-on-surface-variant/90 border-t border-outline/40">
                  Reflects long-range domestic vectors where travel time is measured in hours rather than days.
                </div>
              </div>

              <div className="bg-surface rounded-lg p-3.5 border border-outline/70 space-y-1.5">
                <div className="flex items-center gap-2 text-on-surface font-semibold font-sans">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
                  <span>Modal Decoupling for Targeted Policy</span>
                </div>
                <p className="text-on-surface-variant leading-relaxed font-sans">
                  Calibrated to a national modal split of <strong className="text-on-surface">50% Road, 30% Rail, 20% Air</strong>. Because edge matrices are stored as discrete layers, policy interventions operate surgically.
                </p>
                <div className="pt-1 text-[11px] font-mono text-on-surface-variant/90 border-t border-outline/40">
                  Example: A &quot;Transit Halt&quot; intervention zeroes the IRCTC rail tensor without disrupting highway movement, whereas a Cordon Sanitaire applies 98% boundary containment across all three modes.
                </div>
              </div>
            </div>
          )}

          {/* Tab 4: Engine */}
          {activeTab === 'engine' && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5 text-xs">
              <div className="bg-surface rounded-lg p-3.5 border border-outline/70 space-y-1.5">
                <div className="flex items-center gap-2 text-on-surface font-semibold font-sans">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
                  <span>1. Spatial Metapopulation Coupling</span>
                </div>
                <p className="text-on-surface-variant leading-relaxed font-sans">
                  Not a single-bucket national model. Connects 15 urban metapopulation nodes through dynamic daily importation pressure:
                </p>
                <div className="p-2 rounded bg-surface-variant font-mono text-[11px] text-on-surface border border-outline/40 text-center">
                  F<sub>i</sub>(t) = &Sigma;<sub>j</sub> W<sub>ji</sub>(t) &middot; (I<sub>j</sub>(t) / N<sub>j</sub>)
                </div>
                <p className="text-on-surface-variant text-[11px]">
                  Enables testing of inter-city leakage and spatial cordon containment.
                </p>
              </div>

              <div className="bg-surface rounded-lg p-3.5 border border-outline/70 space-y-1.5">
                <div className="flex items-center gap-2 text-on-surface font-semibold font-sans">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
                  <span>2. Sobol Quasi-Monte Carlo (QMC)</span>
                </div>
                <p className="text-on-surface-variant leading-relaxed font-sans">
                  Replaces deterministic ODE curves with <strong className="text-on-surface">128 scrambled Sobol QMC draws</strong>. Explores joint parameter uncertainty across R<sub>0</sub>, incubation days, CFR, and infectious periods.
                </p>
                <div className="pt-1 text-[11px] font-mono text-on-surface-variant/90 border-t border-outline/40">
                  Stochastic binomial transitions capture early localized extinction vs super-spreading liftoff.
                </div>
              </div>

              <div className="bg-surface rounded-lg p-3.5 border border-outline/70 space-y-1.5">
                <div className="flex items-center gap-2 text-on-surface font-semibold font-sans">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
                  <span>3. Dynamic Healthcare Strain</span>
                </div>
                <p className="text-on-surface-variant leading-relaxed font-sans">
                  Translates active epidemiological compartments into clinical demands: ICU beds (5% severe rate) and Oxygen cylinders (15% moderate rate).
                </p>
                <div className="pt-1 text-[11px] font-mono text-on-surface-variant/90 border-t border-outline/40">
                  Continuously benchmarked against city acute bed capacity cliffs and the national <strong className="text-on-surface">17,000 MT/day</strong> liquid medical oxygen threshold.
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
