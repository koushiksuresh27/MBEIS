import React from 'react';

interface PrintLayoutProps {
    scenarioConfig: any;
    summaryStats: any;
    cityTableData: any[];
    resourceStats: any;
    mlRecs: any;
    reportType: 'summary' | 'full';
}

const INTERVENTION_LABELS: Record<string, string> = {
    none: 'Baseline (None)',
    rail_only: 'Transit Halt',
    partial: 'Partial Lockdown',
    full: 'Full Quarantine'
};

export default function PrintLayout({
    scenarioConfig,
    summaryStats,
    cityTableData,
    resourceStats,
    mlRecs,
    reportType
}: PrintLayoutProps) {
    return (
        <div>
            {/* HEADER */}
            <div className="no-page-break" style={{ borderBottom: '2px solid black', paddingBottom: '12px', marginBottom: '20px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                        <div style={{ fontSize: '18pt', fontWeight: 'bold', letterSpacing: '1px' }}>
                            OUTBREAK RESPONSE OS
                        </div>
                        <div style={{ fontSize: '10pt', color: '#444', marginTop: '2px' }}>
                            Epidemic Intelligence & Simulation Platform
                        </div>
                    </div>
                    <div style={{ textAlign: 'right', fontSize: '9pt', color: '#444', fontFamily: 'monospace' }}>
                        <div>Generated: {new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' })}</div>
                        <div>Report: {reportType === 'summary' ? 'Simulation Summary' : 'Full Technical Report'}</div>
                    </div>
                </div>

                {/* Scenario metadata */}
                <div style={{ marginTop: '10px', display: 'flex', gap: '40px', fontSize: '9pt', fontFamily: 'monospace' }}>
                    <span><strong>Pathogen:</strong> {scenarioConfig?.pathogenName ?? 'COVID-19'}</span>
                    <span><strong>Origin:</strong> {scenarioConfig?.originCity ?? 'THRISSUR'}</span>
                    <span><strong>Iterations:</strong> {scenarioConfig?.nIterations ?? 128}</span>
                    <span><strong>Horizon:</strong> 270 days</span>
                </div>

                {/* Warning */}
                <div style={{ marginTop: '8px', fontSize: '8pt', color: '#666', fontStyle: 'italic' }}>
                    ⚠ FOR PLANNING AND SIMULATION PURPOSES ONLY — NOT FOR CLINICAL OR OPERATIONAL USE WITHOUT EXPERT REVIEW
                </div>
            </div>

            {/* SECTION 1 — NATIONAL EPIDEMIC SUMMARY */}
            <div className="no-page-break">
                <SectionTitle number="1" title="National Epidemic Summary" />
                <table>
                    <thead>
                        <tr>
                            <th>Intervention</th>
                            <th>Peak Active Cases</th>
                            <th>Peak Day</th>
                            <th>Active at Day 180</th>
                            <th>Verdict</th>
                        </tr>
                    </thead>
                    <tbody>
                        {['none', 'rail_only', 'partial', 'full'].map(key => {
                            const stat = summaryStats?.[key];
                            if (!stat) return null;
                            return (
                                <tr key={key}>
                                    <td><strong>{INTERVENTION_LABELS[key]}</strong></td>
                                    <td>{Math.round(stat.peakInfections).toLocaleString()}</td>
                                    <td>Day {stat.peakDay}</td>
                                    <td>{Math.round(stat.day180Val ?? 0).toLocaleString()}</td>
                                    <td style={{ fontSize: '8pt' }}>{stat.verdict}</td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            {/* SECTION 2 — RESOURCE REQUIREMENTS */}
            <div className="no-page-break" style={{ marginTop: '20px' }}>
                <SectionTitle number="2" title="Peak Resource Requirements" />
                <table>
                    <thead>
                        <tr>
                            <th>Intervention</th>
                            <th>Peak Oxygen (MT/day)</th>
                            <th>Peak ICU Beds</th>
                            <th>Oxygen Shortfall</th>
                        </tr>
                    </thead>
                    <tbody>
                        {['none', 'rail_only', 'partial', 'full'].map(key => {
                            const res = resourceStats?.resources?.[key];
                            if (!res) return null;
                            const shortfall = res.shortfall > 0
                                ? `⚠ ${Math.round(res.shortfall).toLocaleString()} MT/day`
                                : 'No shortfall';
                            return (
                                <tr key={key}>
                                    <td><strong>{INTERVENTION_LABELS[key]}</strong></td>
                                    <td>{Math.round(res.peakOxygen).toLocaleString()}</td>
                                    <td>{Math.round(res.peakICU).toLocaleString()}</td>
                                    <td>{shortfall}</td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
                <div style={{ fontSize: '8pt', color: '#666', marginTop: '4px', fontStyle: 'italic' }}>
                    National oxygen capacity ceiling: 17,000 MT/day
                </div>
            </div>

            {/* SECTION 3 — CITY BREAKDOWN */}
            <div className="page-break">
                <SectionTitle number="3" title="City-Level Active Cases at Day 180" />
                <table>
                    <thead>
                        <tr>
                            <th>City</th>
                            <th>Baseline</th>
                            <th>Transit Halt</th>
                            <th>Partial Lockdown</th>
                            <th>Full Quarantine</th>
                        </tr>
                    </thead>
                    <tbody>
                        {cityTableData.map(row => (
                            <tr key={row.city}>
                                <td><strong>{row.city.charAt(0).toUpperCase() + row.city.slice(1).toLowerCase()}</strong></td>
                                <td>{Math.round(row.none).toLocaleString()}</td>
                                <td>{Math.round(row.rail_only).toLocaleString()}</td>
                                <td>{Math.round(row.partial).toLocaleString()}</td>
                                <td>{Math.round(row.full).toLocaleString()}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {/* SECTION 4 — ML RECOMMENDATIONS (if available) */}
            {mlRecs && (
                <div className="no-page-break" style={{ marginTop: '20px' }}>
                    <SectionTitle number="4" title="ML Surrogate Model — Optimal Intervention Timing" />
                    <table>
                        <thead>
                            <tr>
                                <th>Intervention</th>
                                <th>Optimal Trigger Day</th>
                                <th>Predicted Peak</th>
                                <th>Cases Saved vs Baseline</th>
                                <th>Peak ICU Beds</th>
                                <th>Peak Oxygen</th>
                            </tr>
                        </thead>
                        <tbody>
                            {['rail_only', 'partial', 'full'].map(key => {
                                const rec = mlRecs?.recommendations?.[key];
                                if (!rec) return null;
                                return (
                                    <tr key={key}>
                                        <td><strong>{INTERVENTION_LABELS[key]}</strong></td>
                                        <td>Day {rec.optimal_trigger_day}</td>
                                        <td>{rec.predicted_peak_cases.toLocaleString()}</td>
                                        <td>{rec.cases_saved.toLocaleString()} ({rec.reduction_pct}%)</td>
                                        <td>{rec.predicted_peak_icu_beds.toLocaleString()}</td>
                                        <td>{rec.predicted_peak_oxygen_mt} MT/day</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                    <div style={{ fontSize: '8pt', color: '#666', marginTop: '4px', fontStyle: 'italic' }}>
                        ML surrogate model trained on simulation outputs. Validated on held-out MC iterations.
                    </div>
                </div>
            )}

            {/* FULL REPORT ONLY — Methodology */}
            {reportType === 'full' && (
                <div className="page-break">
                    <SectionTitle number="5" title="Methodology" />
                    <div style={{ fontSize: '9pt', lineHeight: '1.6' }}>
                        <p><strong>Simulation Engine:</strong> Multi-patch SEIRD model with behavioral feedback (SEIR-b, k=35). 15 Indian metro cities connected via 3-layer mobility matrix (road, rail, air).</p>
                        <p style={{ marginTop: '8px' }}><strong>Mobility Data:</strong> Road — Meta normalized terrestrial weights. Rail — IRCTC reserved seat capacity (irctc_mobility_edges.csv). Air — DGCA annual passenger data (dgca_annual_weights.csv).</p>
                        <p style={{ marginTop: '8px' }}><strong>Monte Carlo:</strong> 128 iterations using Sobol QMC sampling (seed=42). Parameters sampled: R₀, incubation period, CFR, infectious period.</p>
                        <p style={{ marginTop: '8px' }}><strong>Validation:</strong> CRPS skill score of -3.50 against Kerala COVID-19 ground truth data. Model tracks true infections; ground truth represents confirmed cases under early testing restrictions.</p>
                        <p style={{ marginTop: '8px' }}><strong>ML Surrogate:</strong> Random Forest Regressor trained on simulation outputs. 5-fold cross-validation MAPE reported in ML section.</p>
                    </div>

                    <div style={{ marginTop: '16px' }}>
                        <strong style={{ fontSize: '9pt' }}>Known Limitations:</strong>
                        <ol style={{ fontSize: '9pt', lineHeight: '1.8', marginTop: '4px' }}>
                            <li>Modal volume equalization — road/rail/air treated as equal volume before blending</li>
                            <li>IRCTC data captures reserved seat capacity only (~42% of true rail passengers)</li>
                            <li>Behavioral suppression uses perfect information (true I(t)/N), not reported cases</li>
                            <li>Transit Halt and Partial Lockdown have not peaked within 270-day window</li>
                        </ol>
                    </div>
                </div>
            )}

            {/* DISCLAIMER */}
            <div style={{ marginTop: '30px', borderTop: '1px solid #ccc', paddingTop: '10px', fontSize: '8pt', color: '#666' }}>
                <strong>Disclaimer:</strong> This report is generated from a computational simulation model for planning and research purposes only.
                Results should not be used for clinical decisions, public health mandates, or operational response without expert epidemiological review.
                Outbreak Response OS — Final Year Project, {new Date().getFullYear()}.
            </div>
        </div>
    );
}

// Helper component
function SectionTitle({ number, title }: { number: string; title: string }) {
    return (
        <div style={{
            fontSize: '11pt',
            fontWeight: 'bold',
            borderBottom: '1px solid #333',
            paddingBottom: '4px',
            marginBottom: '10px',
            marginTop: '16px',
            textTransform: 'uppercase',
            letterSpacing: '0.5px'
        }}>
            {number}. {title}
        </div>
    );
}