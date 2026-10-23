"""
Bedrock Tools Adapter for ERIS Autonomous Deep Research.
Converts research objectives into multi-fork simulations using the existing SEIRD engine,
deriving comparative curves, ICU deficits, and Liquid Medical Oxygen (MT/day)
benchmarked against the single source of truth NATIONAL_O2_CEILING_MT = 9690.
"""

from typing import Dict, Any, List
import numpy as np

from backend.simulator.seird_engine import run_deterministic_preview
from backend.simulator.resource_calculator import (
    NATIONAL_O2_CEILING_MT,
    LPM_TO_MT_PER_DAY,
    ICU_O2_FLOW_LPM_RESPIRATORY,
    NON_ICU_O2_FLOW_LPM_RESPIRATORY,
)

# Benchmark national ICU bed capacity baseline (~95,000 public+private ICU beds)
NATIONAL_ICU_BED_CAPACITY = 95_000

BEDROCK_SIMULATION_TOOL_SPEC = {
    "toolSpec": {
        "name": "run_simulation_forks",
        "description": (
            "Simulates up to 3 custom policy intervention variations over a 180-day horizon "
            "against the uncontrolled baseline. Returns daily active cases, ICU bed requirements, "
            f"and liquid medical oxygen demand in MT/day (benchmark ceiling: {NATIONAL_O2_CEILING_MT} MT/day). "
            "Supports multi-phase timing schedules, targeted edge cuts, mass gatherings, and ring vaccination."
        ),
        "inputSchema": {
            "json": {
                "type": "object",
                "properties": {
                    "origin_city": {
                        "type": "string",
                        "description": "Origin epicenter city (e.g. 'KOCHI', 'DELHI', 'MUMBAI'). Defaults to 'KOCHI'."
                    },
                    "plans": {
                        "type": "array",
                        "description": "List of 2 to 3 intervention plans to compare against baseline.",
                        "items": {
                            "type": "object",
                            "properties": {
                                "label": {
                                    "type": "string",
                                    "description": "Short, clear name for the plan (e.g. 'Plan A: Rail Cordon', 'Plan B: Tiered Caps')."
                                },
                                "schedule": {
                                    "type": "array",
                                    "description": "Sequential phase periods across the 180-day horizon.",
                                    "items": {
                                        "type": "object",
                                        "properties": {
                                            "from_day": {"type": "integer", "description": "Start day (1-180)"},
                                            "to_day": {"type": "integer", "description": "End day (1-180)"},
                                            "intervention": {
                                                "type": "string",
                                                "enum": ["none", "rail_only", "partial", "full"],
                                                "description": "Intervention intensity for this phase window."
                                            }
                                        },
                                        "required": ["from_day", "to_day", "intervention"]
                                    }
                                },
                                "edge_cuts": {
                                    "type": "array",
                                    "description": "Optional list of severed transit corridors.",
                                    "items": {
                                        "type": "object",
                                        "properties": {
                                            "src": {"type": "string"},
                                            "tgt": {"type": "string"},
                                            "modes": {
                                                "type": "array",
                                                "items": {"type": "string", "enum": ["road", "rail", "air"]}
                                            }
                                        },
                                        "required": ["src", "tgt", "modes"]
                                    }
                                },
                                "vaccination": {
                                    "type": "object",
                                    "description": "Optional vaccination rollout campaign parameters.",
                                    "properties": {
                                        "enabled": {"type": "boolean"},
                                        "start_day": {"type": "integer"},
                                        "daily_rate": {"type": "number"},
                                        "efficacy": {"type": "number"},
                                        "severity_efficacy": {"type": "number"}
                                    }
                                },
                                "festivals": {
                                    "type": "array",
                                    "description": "Optional mass gathering superspreader events.",
                                    "items": {
                                        "type": "object",
                                        "properties": {
                                            "name": {"type": "string"},
                                            "city": {"type": "string"},
                                            "start_day": {"type": "integer"},
                                            "end_day": {"type": "integer"},
                                            "crowd_mult": {"type": "number"},
                                            "attendee_frac": {"type": "number"}
                                        },
                                        "required": ["name", "city", "start_day", "end_day", "crowd_mult"]
                                    }
                                }
                            },
                            "required": ["label"]
                        }
                    }
                },
                "required": ["plans"]
            }
        }
    }
}


from scipy.stats import qmc, triang
from backend.simulator.seird_engine import (
    get_or_build_matrices,
    apply_intervention,
    LOCAL_TRANSMISSION_MULTIPLIER,
    CITIES,
)
from backend.simulator.seirv_engine import VaccinationParams


def execute_simulation_forks(args: Dict[str, Any], n_iterations: int = 50) -> Dict[str, Any]:
    """
    Executes baseline + proposed plans using 50-iteration Sobol Quasi-Monte Carlo (QMC).
    Explores the 4D parameter uncertainty space (R0, Incubation, CFR, Infectious Window).
    Returns P10, P50 (median), and P90 (worst-case) trajectories for Active Cases,
    ICU Bed Deficits, and Liquid Medical Oxygen (MT/day) benchmarked against NATIONAL_O2_CEILING_MT,
    as well as the Economic Mobility Preservation Index.
    """
    origin_city_raw = (args.get("origin_city") or "KOCHI").strip().upper()
    plans_args = args.get("plans") or []
    n_days = 180

    names, matrices = get_or_build_matrices()
    n = len(names)

    # City name resolution
    CITY_ALIASES = {
        "THRISSUR": "Kochi",
        "THIRUVANANTHAPURAM": "Kochi",
        "SURAT": "Ahmedabad",
        "BANGALORE": "Bengaluru",
    }
    resolved = CITY_ALIASES.get(origin_city_raw, origin_city_raw)
    matched = next((c for c in names if c.strip().lower() == resolved.strip().lower()), "Kochi")
    origin_city = matched
    origin_idx = names.index(origin_city)
    pops = np.array([CITIES[c]["pop"] for c in names], dtype=float)

    # 1. Generate 50 Sobol QMC parameter draws across 4 biological dimensions
    m = int(np.ceil(np.log2(n_iterations)))
    sampler = qmc.Sobol(d=4, scramble=True, seed=42)
    uniform_samples = sampler.random_base2(m=m)[:n_iterations]

    def to_triang(u, low, mode, high):
        scale = high - low
        c = (mode - low) / scale
        return triang.ppf(u, c=c, loc=low, scale=scale)

    r0_samples = to_triang(uniform_samples[:, 0], 1.5, 2.25, 3.0)
    inc_samples = to_triang(uniform_samples[:, 1], 2.0, 5.0, 14.0)
    cfr_samples = to_triang(uniform_samples[:, 2], 0.01, 0.021, 0.07)
    inf_samples = to_triang(uniform_samples[:, 3], 5.0, 7.0, 10.0)

    ss = np.random.SeedSequence(42)
    child_seeds = ss.spawn(n_iterations)

    FLOW_WEIGHTS = {"none": 1.0, "rail_only": 0.75, "partial": 0.33, "full": 0.05}

    def simulate_plan_sobol(schedule, edge_cuts=None, vaccination=None):
        distinct_invs = set()
        if schedule:
            for phase in schedule:
                p_item = phase.dict() if hasattr(phase, "dict") else (phase.model_dump() if hasattr(phase, "model_dump") else phase)
                distinct_invs.add(p_item.get("intervention", "none"))
        distinct_invs.add("none")

        W_cache = {inv: apply_intervention(matrices, inv, edge_cuts=edge_cuts) for inv in distinct_invs}
        local_mult_cache = {inv: LOCAL_TRANSMISSION_MULTIPLIER.get(inv, 1.0) for inv in distinct_invs}

        day_inv = ["none"] * n_days
        if schedule:
            for phase in schedule:
                p_item = phase.dict() if hasattr(phase, "dict") else (phase.model_dump() if hasattr(phase, "model_dump") else phase)
                f = max(1, p_item.get("from_day", 1))
                t = min(n_days, p_item.get("to_day", n_days))
                inv = p_item.get("intervention", "none")
                for d in range(f - 1, t):
                    day_inv[d] = inv

        # Calculate Economic Mobility Preservation Score
        avg_flow = sum(FLOW_WEIGHTS.get(day_inv[d], 1.0) for d in range(n_days)) / n_days
        cut_penalty = (len(edge_cuts) * 0.025) if edge_cuts else 0.0
        mobility_score = round(max(5.0, (avg_flow - cut_penalty) * 100.0), 1)

        vax_params = VaccinationParams.from_dict(vaccination)
        all_active = np.zeros((n_iterations, n_days))
        all_deaths = np.zeros((n_iterations, n_days))

        for it in range(n_iterations):
            rng = np.random.default_rng(child_seeds[it])
            S = pops.copy()
            E = np.zeros(n)
            I = np.zeros(n)
            R = np.zeros(n)
            D = np.zeros(n)
            V = np.zeros(n)
            V_pending = np.zeros(n)

            seed_val = min(500.0, pops[origin_idx])
            I[origin_idx] = seed_val
            S[origin_idx] -= seed_val

            sigma = 1.0 / max(inc_samples[it], 0.1)
            gamma = 1.0 / max(inf_samples[it], 0.1)
            cfr_val = cfr_samples[it]
            r0_val = r0_samples[it]

            N_safe = np.maximum(pops, 1.0)

            for day in range(n_days):
                inv_today = day_inv[day]
                W = W_cache[inv_today]
                local_mult = local_mult_cache[inv_today]

                import_pressure = W.T @ (I / N_safe)
                prevalence = I / N_safe
                behavior_mult = np.exp(-35.0 * prevalence)
                beta = (r0_val / max(inf_samples[it], 0.1)) * (local_mult * behavior_mult)
                total_I = I + import_pressure
                force_inf = np.clip(beta * (total_I / N_safe), 0.0, 50.0)
                force_V = (1.0 - vax_params.efficacy) * force_inf if vax_params.enabled else force_inf

                p_inf = np.clip(1.0 - np.exp(-force_inf), 0.0, 1.0)
                p_inf_V = np.clip(1.0 - np.exp(-force_V), 0.0, 1.0)

                dE_S = rng.binomial(n=S.astype(int), p=p_inf).astype(float)
                dV_new = np.zeros(n)
                if vax_params.enabled and day >= vax_params.start_day:
                    eligible = S + R
                    total_doses = vax_params.daily_rate * pops
                    dV_new = np.minimum(S, total_doses * np.where(eligible > 0, S / eligible, 0.0))

                total_out = dE_S + dV_new
                scale = np.where(total_out > S, S / np.maximum(total_out, 1e-9), 1.0)
                dE_S *= scale
                dV_new *= scale

                dE_V = rng.binomial(n=V.astype(int), p=p_inf_V).astype(float) if vax_params.enabled else np.zeros(n)
                omega = (1.0 / vax_params.waning_mean_days) if (vax_params.enabled and vax_params.waning_mean_days) else 0.0
                dS_w = omega * V
                total_V_out = dE_V + dS_w
                scale_V = np.where((total_V_out > V) & (total_V_out > 0), V / np.maximum(total_V_out, 1e-9), 1.0)
                dE_V *= scale_V
                dS_w *= scale_V

                onset_rate = 1.0 / max(vax_params.onset_days, 1)
                dV_grad = np.clip(onset_rate * V_pending, 0.0, V_pending)
                V_pending += (dV_new - dV_grad)
                V += (dV_grad - dE_V - dS_w)
                S += dS_w - (dE_S + dV_new)

                dI = rng.binomial(n=E.astype(int), p=np.clip(1.0 - np.exp(-sigma), 0.0, 1.0)).astype(float)
                E += (dE_S + dE_V) - dI

                d_resolved = rng.binomial(n=I.astype(int), p=np.clip(1.0 - np.exp(-gamma), 0.0, 1.0)).astype(float)
                dD = rng.binomial(n=d_resolved.astype(int), p=np.clip(cfr_val, 0.0, 1.0)).astype(float)
                dR = d_resolved - dD

                I += dI - d_resolved
                R += dR
                D += dD

                all_active[it, day] = np.sum(I)
                all_deaths[it, day] = np.sum(D)

        return all_active, all_deaths, mobility_score

    # 2. Run Baseline Sobol Simulation
    b_act_runs, b_dth_runs, b_mobility = simulate_plan_sobol(schedule=None)
    b_act_p50 = np.percentile(b_act_runs, 50, axis=0)
    b_act_p10 = np.percentile(b_act_runs, 10, axis=0)
    b_act_p90 = np.percentile(b_act_runs, 90, axis=0)

    b_peak_p50 = int(round(np.max(b_act_p50)))
    b_peak_p90 = int(round(np.max(b_act_p90)))
    b_peak_day = int(np.argmax(b_act_p50) + 1)
    b_deaths_p50 = int(round(np.percentile(b_dth_runs[:, -1], 50)))

    # ICU & Oxygen calculations
    b_icu_p50 = (b_act_p50 * 0.05).astype(int)
    b_icu_p90 = (b_act_p90 * 0.05).astype(int)
    b_o2_p50 = (np.round((b_icu_p50 * ICU_O2_FLOW_LPM_RESPIRATORY + (b_icu_p50 * 2.0) * NON_ICU_O2_FLOW_LPM_RESPIRATORY) * LPM_TO_MT_PER_DAY)).astype(int)
    b_o2_p90 = (np.round((b_icu_p90 * ICU_O2_FLOW_LPM_RESPIRATORY + (b_icu_p90 * 2.0) * NON_ICU_O2_FLOW_LPM_RESPIRATORY) * LPM_TO_MT_PER_DAY)).astype(int)

    fork_results = {}
    plan_slugs = []

    # 3. Run Proposed Policy Plans
    for idx, p in enumerate(plans_args[:3]):
        label = p.get("label") or f"Plan {chr(65 + idx)}"
        slug = f"plan_{chr(97 + idx)}"
        plan_slugs.append((slug, label))

        schedule = p.get("schedule")
        edge_cuts = p.get("edge_cuts")
        vaccination = p.get("vaccination")

        p_act_runs, p_dth_runs, p_mobility = simulate_plan_sobol(
            schedule=schedule,
            edge_cuts=edge_cuts,
            vaccination=vaccination
        )

        p_act_p50 = np.percentile(p_act_runs, 50, axis=0)
        p_act_p10 = np.percentile(p_act_runs, 10, axis=0)
        p_act_p90 = np.percentile(p_act_runs, 90, axis=0)

        p_peak_p50 = int(round(np.max(p_act_p50)))
        p_peak_p90 = int(round(np.max(p_act_p90)))
        p_peak_day = int(np.argmax(p_act_p50) + 1)
        p_deaths_p50 = int(round(np.percentile(p_dth_runs[:, -1], 50)))

        p_icu_p50 = (p_act_p50 * 0.05).astype(int)
        p_icu_p90 = (p_act_p90 * 0.05).astype(int)
        p_o2_p50 = (np.round((p_icu_p50 * ICU_O2_FLOW_LPM_RESPIRATORY + (p_icu_p50 * 2.0) * NON_ICU_O2_FLOW_LPM_RESPIRATORY) * LPM_TO_MT_PER_DAY)).astype(int)
        p_o2_p90 = (np.round((p_icu_p90 * ICU_O2_FLOW_LPM_RESPIRATORY + (p_icu_p90 * 2.0) * NON_ICU_O2_FLOW_LPM_RESPIRATORY) * LPM_TO_MT_PER_DAY)).astype(int)

        deaths_saved = max(0, b_deaths_p50 - p_deaths_p50)
        drop_pct_p50 = round(max(0.0, (b_peak_p50 - p_peak_p50) / max(b_peak_p50, 1) * 100.0), 1)
        drop_pct_p90 = round(max(0.0, (b_peak_p90 - p_peak_p90) / max(b_peak_p90, 1) * 100.0), 1)

        fork_results[slug] = {
            "label": label,
            "peak_day": p_peak_day,
            "peak_cases": p_peak_p50,
            "peak_cases_p90": p_peak_p90,
            "deaths_saved": deaths_saved,
            "reduction_pct": drop_pct_p50,
            "reduction_pct_p90": drop_pct_p90,
            "icu_deficit": max(0, int(np.max(p_icu_p50)) - NATIONAL_ICU_BED_CAPACITY),
            "icu_deficit_p90": max(0, int(np.max(p_icu_p90)) - NATIONAL_ICU_BED_CAPACITY),
            "oxygen_mt": int(np.max(p_o2_p50)),
            "oxygen_mt_p90": int(np.max(p_o2_p90)),
            "mobility_score": p_mobility,
            "act_p50": p_act_p50,
            "act_p10": p_act_p10,
            "act_p90": p_act_p90,
            "icu_p50": p_icu_p50,
            "icu_p10": (p_act_p10 * 0.05).astype(int),
            "icu_p90": p_icu_p90,
            "o2_p50": p_o2_p50,
            "o2_p10": (np.round(((p_act_p10 * 0.05) * ICU_O2_FLOW_LPM_RESPIRATORY + ((p_act_p10 * 0.05) * 2.0) * NON_ICU_O2_FLOW_LPM_RESPIRATORY) * LPM_TO_MT_PER_DAY)).astype(int),
            "o2_p90": p_o2_p90,
            "schedule": schedule,
            "edge_cuts": edge_cuts,
            "vaccination": vaccination,
        }

    # 4. Build Sampled Chart Series (Sample every 2 days for smooth Recharts rendering)
    sampled_days = sorted(list(set(
        list(range(0, 181, 2)) +
        [b_peak_day] + [f["peak_day"] for f in fork_results.values()]
    )))

    chart_series_active = []
    chart_series_icu = []
    chart_series_oxygen = []

    for d in sampled_days:
        idx = max(0, min(179, d - 1 if d > 0 else 0))

        # Active
        pt_act = {
            "day": d,
            "baseline": int(round(b_act_p50[idx])),
            "baseline_p10": int(round(b_act_p10[idx])),
            "baseline_p90": int(round(b_act_p90[idx])),
        }
        for slug, _ in plan_slugs:
            pt_act[slug] = int(round(fork_results[slug]["act_p50"][idx]))
            pt_act[f"{slug}_p10"] = int(round(fork_results[slug]["act_p10"][idx]))
            pt_act[f"{slug}_p90"] = int(round(fork_results[slug]["act_p90"][idx]))
        chart_series_active.append(pt_act)

        # ICU
        pt_icu = {
            "day": d,
            "baseline": int(round(b_icu_p50[idx])),
            "baseline_p10": int(round(b_act_p10[idx] * 0.05)),
            "baseline_p90": int(round(b_icu_p90[idx])),
        }
        for slug, _ in plan_slugs:
            pt_icu[slug] = int(round(fork_results[slug]["icu_p50"][idx]))
            pt_icu[f"{slug}_p10"] = int(round(fork_results[slug]["icu_p10"][idx]))
            pt_icu[f"{slug}_p90"] = int(round(fork_results[slug]["icu_p90"][idx]))
        chart_series_icu.append(pt_icu)

        # Oxygen
        pt_o2 = {
            "day": d,
            "baseline": int(round(b_o2_p50[idx])),
            "baseline_p90": int(round(b_o2_p90[idx])),
        }
        for slug, _ in plan_slugs:
            pt_o2[slug] = int(round(fork_results[slug]["o2_p50"][idx]))
            pt_o2[f"{slug}_p90"] = int(round(fork_results[slug]["o2_p90"][idx]))
        chart_series_oxygen.append(pt_o2)

    # 5. Build Comparative Scorecards with Sobol QMC Confidence Metrics
    scorecards = [
        {
            "name": "Baseline (Unchecked)",
            "peak_cases": b_peak_p50,
            "peak_p90_cases": b_peak_p90,
            "peak_cases_p90": b_peak_p90,
            "peak_day": b_peak_day,
            "icu_deficit": max(0, int(np.max(b_icu_p50)) - NATIONAL_ICU_BED_CAPACITY),
            "icu_deficit_p90": max(0, int(np.max(b_icu_p90)) - NATIONAL_ICU_BED_CAPACITY),
            "oxygen_mt": int(np.max(b_o2_p50)),
            "oxygen_mt_p90": int(np.max(b_o2_p90)),
            "deaths_saved": 0,
            "reduction_pct": 0.0,
            "mobility_score": 100.0,
            "mobility_preservation_pct": 100.0,
            "breached_o2": int(np.max(b_o2_p90)) > NATIONAL_O2_CEILING_MT,
            "stochastic_method": f"{n_iterations}-Iteration Sobol QMC",
        }
    ]

    for slug, label in plan_slugs:
        fr = fork_results[slug]
        scorecards.append({
            "name": label,
            "peak_cases": fr["peak_cases"],
            "peak_p90_cases": fr["peak_cases_p90"],
            "peak_cases_p90": fr["peak_cases_p90"],
            "peak_day": fr["peak_day"],
            "icu_deficit": fr["icu_deficit"],
            "icu_deficit_p90": fr["icu_deficit_p90"],
            "oxygen_mt": fr["oxygen_mt"],
            "oxygen_mt_p90": fr["oxygen_mt_p90"],
            "deaths_saved": fr["deaths_saved"],
            "reduction_pct": fr["reduction_pct"],
            "reduction_pct_p90": fr["reduction_pct_p90"],
            "mobility_score": fr["mobility_score"],
            "mobility_preservation_pct": fr["mobility_score"],
            "breached_o2": fr["oxygen_mt_p90"] > NATIONAL_O2_CEILING_MT,
            "stochastic_method": f"{n_iterations}-Iteration Sobol QMC",
            "schedule": fr["schedule"],
            "edge_cuts": fr["edge_cuts"],
            "vaccination": fr["vaccination"],
            "plan_config": {
                "phases": fr["schedule"] or [],
                "edgeCuts": fr["edge_cuts"] or [],
                "vaccination": fr["vaccination"] or {
                    "enabled": False,
                    "start_day": 30,
                    "daily_rate": 0.003,
                    "efficacy": 0.85
                }
            }
        })

    return {
        "status": "success",
        "origin_city": origin_city,
        "national_o2_ceiling_mt": NATIONAL_O2_CEILING_MT,
        "national_icu_capacity": NATIONAL_ICU_BED_CAPACITY,
        "stochastic_iterations": n_iterations,
        "scorecards": scorecards,
        "chart_series": {
            "active": chart_series_active,
            "icu": chart_series_icu,
            "oxygen": chart_series_oxygen,
        },
        "plans_evaluated": [f["label"] for f in fork_results.values()],
    }

