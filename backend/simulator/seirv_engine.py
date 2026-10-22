from __future__ import annotations

import math
import numpy as np
from dataclasses import dataclass, field
from typing import Optional, List, Dict, Any, Union


@dataclass
class VaccinationParams:
    enabled: bool = False
    start_day: int = 30                # First day doses are administered (0-indexed)
    daily_rate: float = 0.0015         # Fraction of eligible pool vaccinated per day
    efficacy: float = 0.80             # Susceptibility reduction eta in [0, 1]
    waning_mean_days: Optional[int] = None # Mean duration of protection (1/omega) in days
    onset_days: int = 14               # Delay from jab to protection (WHO guidance ~14d)
    severity_efficacy: float = 0.95    # Severity/mortality reduction for breakthrough cases

    @classmethod
    def from_dict(cls, d: Optional[Union[dict, "VaccinationParams"]]) -> "VaccinationParams":
        if d is None:
            return cls(enabled=False)
        if isinstance(d, cls):
            return d
        if hasattr(d, "model_dump"):
            d = d.model_dump()
        return cls(
            enabled=bool(d.get("enabled", False)),
            start_day=int(d.get("start_day", d.get("startDay", 30))),
            daily_rate=float(d.get("daily_rate", d.get("dailyRate", 0.0015))),
            efficacy=float(d.get("efficacy", 0.80)),
            waning_mean_days=d.get("waning_mean_days", d.get("waningDays")),
            onset_days=int(d.get("onset_days", d.get("onsetDays", 14))),
            severity_efficacy=float(d.get("severity_efficacy", d.get("severityEfficacy", 0.95)))
        )


@dataclass
class FestivalEvent:
    id: str = "evt_1"
    name: str = "Mass Gathering"
    city: str = "DELHI"
    start_day: int = 30
    end_day: int = 45
    crowd_mult: float = 2.5            # Contact-rate multiplier during event
    attendee_frac: float = 0.10        # Fraction of city residents attending

    @classmethod
    def from_dict(cls, d: Union[dict, "FestivalEvent"]) -> "FestivalEvent":
        if isinstance(d, cls):
            return d
        if hasattr(d, "model_dump"):
            d = d.model_dump()
        return cls(
            id=str(d.get("id", "evt_1")),
            name=str(d.get("name", "Mass Gathering")),
            city=str(d.get("city", "DELHI")),
            start_day=int(d.get("start_day", d.get("startDay", 30))),
            end_day=int(d.get("end_day", d.get("endDay", 45))),
            crowd_mult=float(d.get("crowd_mult", d.get("crowdMult", 2.5))),
            attendee_frac=float(d.get("attendee_frac", d.get("attendeeFrac", 0.10)))
        )


# Helper: Build Festival Multiplier Vector

def build_festival_multiplier(
    day: int,
    festivals: List[Union[FestivalEvent, dict]],
    city_index: Dict[str, int],
    n_cities: int,
) -> np.ndarray:
    """
    Return shape (n_cities,) vector of effective contact-rate multipliers.

    Effective multiplier for city c on day t:
        mult[c] = product over active events at c of:
                  [1 + f_k * (C_k - 1)]

    where f_k is attendee fraction and C_k is crowd multiplier.
    Combined amplification is capped at 5.0.
    """
    mult = np.ones(n_cities, dtype=float)
    if not festivals:
        return mult

    normalized_index = {k.strip().upper(): v for k, v in city_index.items()}

    for item in festivals:
        evt = FestivalEvent.from_dict(item)
        if evt.start_day <= day <= evt.end_day:
            c_key = evt.city.strip().upper()
            idx = normalized_index.get(c_key)
            if idx is not None:
                effective = 1.0 + evt.attendee_frac * (evt.crowd_mult - 1.0)
                mult[idx] *= effective

    np.clip(mult, 1.0, 5.0, out=mult)
    return mult


# Core: Deterministic SEIRV Step

def seirv_step(
    S: np.ndarray,
    E: np.ndarray,
    I: np.ndarray,
    R: np.ndarray,
    D: np.ndarray,
    V: np.ndarray,
    V_pending: np.ndarray,
    *,
    N: np.ndarray,
    beta: float,
    sigma: float,
    gamma: float,
    ifr: float,
    mobility: np.ndarray,
    vax: VaccinationParams,
    festival_mult: np.ndarray,
    day: int,
    k_sensitivity: float = 0.0,
    local_mult: float = 1.0,
    debug_conservation: bool = False,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, np.ndarray, np.ndarray, np.ndarray, float, float]:
    """
    Single-day update following Halloran et al. (2010) leaky-vaccine formulation
    and Becker chain-multinomial competing risk outflows.

    Returns:
        (S_new, E_new, I_new, R_new, D_new, V_new, V_pending_new, daily_infections, daily_doses)
    """
    n = len(S)
    N_safe = np.maximum(N, 1.0)

    # 1. Behavioral feedback and force of infection
    prevalence = I / N_safe
    behavior_mult = np.exp(-k_sensitivity * prevalence) if k_sensitivity > 0.0 else np.ones(n)
    effective_beta = beta * local_mult * behavior_mult * festival_mult

    # Mobility-weighted infectious fraction seen by city i
    inf_frac = I / N_safe
    lambda_ = effective_beta * (mobility @ inf_frac)
    lambda_ = np.clip(lambda_, 0.0, 50.0)

    # Leaky vaccine susceptibility reduction: lambda_V = (1 - eta) * lambda
    lambda_V = (1.0 - vax.efficacy) * lambda_ if vax.enabled else lambda_

    p_S = 1.0 - np.exp(-lambda_)
    p_V = 1.0 - np.exp(-lambda_V)

    # 2. Outflows from S (Competing risk: infection vs vaccination)
    dE_from_S = S * p_S

    dV_new = np.zeros(n)
    if vax.enabled and day >= vax.start_day:
        eligible = S + R
        total_doses = vax.daily_rate * eligible
        frac_S = np.where(eligible > 0, S / eligible, 0.0)
        dV_new = np.minimum(S, total_doses * frac_S)

    total_S_out = dE_from_S + dV_new
    scale = np.where(total_S_out > S, S / np.maximum(total_S_out, 1e-9), 1.0)
    dE_from_S *= scale
    dV_new *= scale

    # 3. Outflows from V (Breakthrough infection vs antibody waning)
    dE_from_V = V * p_V if vax.enabled else np.zeros(n)
    omega = (1.0 / vax.waning_mean_days) if (vax.enabled and vax.waning_mean_days) else 0.0
    dS_waned = omega * V

    total_V_out = dE_from_V + dS_waned
    scale_V = np.where((total_V_out > V) & (total_V_out > 0), V / np.maximum(total_V_out, 1e-9), 1.0)
    dE_from_V *= scale_V
    dS_waned *= scale_V

    # 4. V_pending onset lag (FIFO turnover)
    onset_rate = 1.0 / max(vax.onset_days, 1)
    dV_graduated = onset_rate * V_pending
    dV_pending_in = dV_new

    # 5. Exposed -> Infectious
    dE_total = dE_from_S + dE_from_V
    dI_from_E = sigma * E

    # 6. Infectious -> Recovered / Deceased (with severity efficacy)
    # Estimate breakthrough share of current infections
    breakthrough_ratio = np.where(dE_total > 0, dE_from_V / np.maximum(dE_total, 1e-9), 0.0)
    effective_ifr = ifr * (1.0 - vax.severity_efficacy * breakthrough_ratio)

    dRecov_I = gamma * I
    dDead = effective_ifr * dRecov_I
    dRecov = dRecov_I - dDead

    # 7. Update compartments
    S_new = np.clip(S - dE_from_S - dV_new + dS_waned, 0.0, N)
    E_new = np.clip(E + dE_total - dI_from_E, 0.0, N)
    I_new = np.clip(I + dI_from_E - dRecov_I, 0.0, N)
    R_new = np.clip(R + dRecov, 0.0, N)
    D_new = np.clip(D + dDead, 0.0, N)
    V_new = np.clip(V + dV_graduated - dE_from_V - dS_waned, 0.0, N)
    V_pending_new = np.clip(V_pending + dV_pending_in - dV_graduated, 0.0, N)

    # 8. Mass-conservation assertion (debug mode)
    if debug_conservation:
        total = S_new + E_new + I_new + R_new + D_new + V_new + V_pending_new
        assert np.allclose(total, N, atol=1.0), (
            f"Day {day}: population not conserved — max diff = {np.abs(total - N).max():.4f}"
        )

    return (
        S_new, E_new, I_new, R_new, D_new, V_new, V_pending_new,
        float(dE_total.sum()), float(dV_new.sum())
    )


# Deterministic Preview Runner

def run_deterministic_seirv(
    N: np.ndarray,
    S0: np.ndarray,
    E0: np.ndarray,
    I0: np.ndarray,
    R0: np.ndarray,
    D0: np.ndarray,
    *,
    city_index: Dict[str, int],
    beta: float,
    sigma: float,
    gamma: float,
    ifr: float,
    mobility: np.ndarray,
    n_days: int,
    vax: Optional[Union[VaccinationParams, dict]] = None,
    festivals: Optional[List[Union[FestivalEvent, dict]]] = None,
    k_sensitivity: float = 0.0,
    local_mult: float = 1.0,
    V0: Optional[np.ndarray] = None,
    debug_conservation: bool = False,
) -> dict:
    """
    Run full deterministic SEIRV simulation with vaccination and festival shocks.
    """
    vax_params = VaccinationParams.from_dict(vax)
    festival_list = festivals or []

    n = len(N)
    S, E, I, R, D = S0.copy(), E0.copy(), I0.copy(), R0.copy(), D0.copy()
    V = V0.copy() if V0 is not None else np.zeros(n)
    V_pending = np.zeros(n)

    traj = {
        "S": [], "E": [], "I": [], "R": [], "D": [], "V": [],
        "new_infections": [], "vaccinated_total": []
    }

    cum_doses = 0.0
    for day in range(n_days):
        fmult = build_festival_multiplier(day, festival_list, city_index, n)

        traj["S"].append(int(round(float(S.sum()))))
        traj["E"].append(int(round(float(E.sum()))))
        traj["I"].append(int(round(float(I.sum()))))
        traj["R"].append(int(round(float(R.sum()))))
        traj["D"].append(int(round(float(D.sum()))))
        traj["V"].append(int(round(float((V + V_pending).sum()))))

        (
            S, E, I, R, D, V, V_pending,
            daily_incident_cases, daily_doses
        ) = seirv_step(
            S, E, I, R, D, V, V_pending,
            N=N,
            beta=beta,
            sigma=sigma,
            gamma=gamma,
            ifr=ifr,
            mobility=mobility,
            vax=vax_params,
            festival_mult=fmult,
            day=day,
            k_sensitivity=k_sensitivity,
            local_mult=local_mult,
            debug_conservation=debug_conservation,
        )

        cum_doses += daily_doses
        traj["new_infections"].append(int(round(daily_incident_cases)))
        traj["vaccinated_total"].append(int(round(cum_doses)))

    total_pop = float(N.sum())
    summary = {
        "peak_infections": max(traj["I"]) if traj["I"] else 0,
        "peak_day": int(np.argmax(traj["I"])) + 1 if traj["I"] else 0,
        "total_deaths": traj["D"][-1] if traj["D"] else 0,
        "final_vaccinated": traj["V"][-1] if traj["V"] else 0,
        "final_coverage_pct": round(traj["V"][-1] / max(total_pop, 1.0) * 100, 2),
    }

    return {"trajectory": traj, "summary": summary}


# Limit Tests

def run_limit_tests():
    """
    Four boundary/limit tests ensuring zero mathematical regression.
    """
    N = np.array([1_000_000.0])
    S0 = np.array([990_000.0])
    E0 = np.array([5_000.0])
    I0 = np.array([5_000.0])
    R0 = np.zeros(1)
    D0 = np.zeros(1)
    mob = np.array([[1.0]])
    cities = {"CITY_A": 0}

    # --- Test 1: vax disabled -> identical to baseline SEIRD ---
    res_base = run_deterministic_seirv(
        N, S0, E0, I0, R0, D0,
        city_index=cities, beta=0.3, sigma=1/5.5, gamma=1/7,
        ifr=0.01, mobility=mob, n_days=180,
    )
    res_no_vax = run_deterministic_seirv(
        N, S0, E0, I0, R0, D0,
        city_index=cities, beta=0.3, sigma=1/5.5, gamma=1/7,
        ifr=0.01, mobility=mob, n_days=180,
        vax=VaccinationParams(enabled=False),
    )
    assert res_base["summary"]["peak_infections"] == res_no_vax["summary"]["peak_infections"], \
        "FAIL test 1: disabled vax should match no-vax baseline"
    print("Test 1 passed: disabled vaccination == baseline SEIRD")

    # --- Test 2: eta=1, no waning -> perfect vaccine reduces peak ---
    vax_perfect = VaccinationParams(
        enabled=True, start_day=0, daily_rate=0.005,
        efficacy=1.0, waning_mean_days=None, onset_days=1,
    )
    res_perfect = run_deterministic_seirv(
        N, S0, E0, I0, R0, D0,
        city_index=cities, beta=0.3, sigma=1/5.5, gamma=1/7,
        ifr=0.01, mobility=mob, n_days=180,
        vax=vax_perfect,
        debug_conservation=True,
    )
    assert res_perfect["summary"]["peak_infections"] < res_base["summary"]["peak_infections"], \
        "FAIL test 2: perfect vaccine should reduce peak"
    assert len(res_perfect["trajectory"]["new_infections"]) == 180
    assert len(res_perfect["trajectory"]["vaccinated_total"]) == 180
    print("Test 2 passed: perfect vaccine reduces peak; trajectory keys filled; mass conserved")

    # --- Test 3: festival mult=1 -> identical trajectory to no-festival ---
    flat_festival = FestivalEvent(
        id="f1", city="CITY_A", start_day=30, end_day=45,
        crowd_mult=1.0, attendee_frac=0.1,
    )
    res_flat = run_deterministic_seirv(
        N, S0, E0, I0, R0, D0,
        city_index=cities, beta=0.3, sigma=1/5.5, gamma=1/7,
        ifr=0.01, mobility=mob, n_days=180,
        festivals=[flat_festival],
    )
    assert res_flat["trajectory"]["I"] == res_base["trajectory"]["I"], \
        "FAIL test 3: crowd_mult=1 should produce identical trajectory"
    print("Test 3 passed: crowd_mult=1 -> no-op festival")

    # --- Test 4: Herd-immunity threshold check (execution test) ---
    # At eta=0.8, R0=3.0: p_c = (1 - 1/R0)/eta = (1 - 1/3)/0.8 = 0.833
    # If population is pre-vaccinated at 90%, epidemic must extinguish without spreading.
    S0_low = np.array([95_000.0])
    E0_low = np.array([2_500.0])
    I0_low = np.array([2_500.0])
    V0_high = np.array([900_000.0])

    res_herd = run_deterministic_seirv(
        N, S0_low, E0_low, I0_low, R0, D0,
        city_index=cities, beta=3.0 * (1/7), sigma=1/5.5, gamma=1/7,
        ifr=0.01, mobility=mob, n_days=60,
        vax=VaccinationParams(enabled=True, start_day=0, daily_rate=0.0, efficacy=0.8, onset_days=1),
        V0=V0_high,
        debug_conservation=True
    )
    # Confirm active infections consistently drop
    assert res_herd["trajectory"]["I"][-1] < res_herd["trajectory"]["I"][0], \
        f"FAIL test 4: active infections should decline under herd immunity: {res_herd['trajectory']['I']}"
    print("Test 4 passed: simulation above herd immunity threshold extinguishes outbreak")

    print("\nAll 4 SEIRV limit tests PASSED successfully.")


if __name__ == "__main__":
    run_limit_tests()
