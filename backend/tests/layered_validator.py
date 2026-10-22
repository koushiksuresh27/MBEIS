"""
layered_validator.py — Layered Validation Framework for Outbreak Response OS

Implements the 3-layer validation architecture:
  Layer 1: Structural Sanity (Mass conservation, nonnegative bounds)
  Layer 2: Historical Validation (Observation model with incubation-to-test delay,
           multi-metric scorecard: CRPS, MAE, 80%/95% coverage, peak error,
           and rolling-origin backtesting against multiple baselines)
  Layer 3: Intervention Robustness (Counterfactual policy comparison across arms)
"""

import numpy as np
from scipy.stats import gamma, lognorm
from typing import Dict, List, Tuple, Any, Optional


# ============================================================================
# LAYER 2: OBSERVATION MODEL (Infection -> Reported Case Convolution)
# ============================================================================

def get_infection_to_report_delay_kernel(
    mean_days: float = 6.0,
    std_days: float = 3.0,
    max_days: int = 21
) -> np.ndarray:
    """
    Constructs a discretized probability mass function for the total delay
    from biological infection (S -> E) to laboratory confirmation.
    
    Combines:
      - Incubation period (~5 days)
      - Symptom-onset to presentation and RT-PCR test reporting (~1-3 days)
    
    Uses a Gamma distribution, discretized and normalized over [0, max_days].
    """
    # Gamma distribution parameterization: shape k, scale theta
    # mean = k * theta, var = k * theta^2
    var = std_days ** 2
    theta = var / mean_days
    k = mean_days / theta
    
    days = np.arange(0, max_days + 1)
    # CDF differences for discrete daily bins
    cdf_vals = gamma.cdf(days + 0.5, a=k, scale=theta)
    cdf_vals_prev = gamma.cdf(days - 0.5, a=k, scale=theta)
    pmf = cdf_vals - cdf_vals_prev
    pmf[0] = gamma.cdf(0.5, a=k, scale=theta)
    
    # Normalize so sum = 1
    pmf = pmf / np.sum(pmf)
    return pmf


def apply_observation_model(
    ensemble_infections: np.ndarray,
    early_ascertainment: float = 0.025,
    ramp_start_ascertainment: float = 0.030,
    ramp_end_ascertainment: float = 0.100,
    early_phase_end: int = 32,
    delay_mean_days: float = 6.0,
    delay_std_days: float = 3.0,
    max_delay_days: int = 21
) -> Tuple[np.ndarray, np.ndarray]:
    """
    Converts simulated true biological infections into expected reported cases.
    
    Args:
        ensemble_infections: shape (N_mc, T) array of daily new infections (S -> E).
        early_ascertainment: fraction of infections reported during early phase.
        ramp_start_ascertainment: starting fraction for testing expansion.
        ramp_end_ascertainment: final fraction for testing expansion.
        early_phase_end: sim_day index where testing ramp-up begins.
        delay_mean_days: average days from infection to confirmed report.
        delay_std_days: standard deviation of infection-to-report delay.
        max_delay_days: truncation cutoff for delay kernel.
        
    Returns:
        (predicted_reported_cases, ascertainment_rates_used)
        predicted_reported_cases has shape (N_mc, T).
    """
    n_mc, n_days = ensemble_infections.shape
    kernel = get_infection_to_report_delay_kernel(
        mean_days=delay_mean_days,
        std_days=delay_std_days,
        max_days=max_delay_days
    )
    
    # Construct time-varying ascertainment rate
    rates = np.zeros(n_days)
    for day in range(n_days):
        if day < early_phase_end:
            rates[day] = early_ascertainment
        else:
            total_ramp = n_days - early_phase_end
            frac = (day - early_phase_end) / max(total_ramp - 1, 1)
            rates[day] = ramp_start_ascertainment + frac * (ramp_end_ascertainment - ramp_start_ascertainment)
            
    # Convolve each MC trajectory with delay kernel along time axis
    predicted_reported = np.zeros((n_mc, n_days))
    for i in range(n_mc):
        traj = ensemble_infections[i]
        # Convolve: (conv mode='full' then truncated to length n_days)
        convolved = np.convolve(traj, kernel, mode="full")[:n_days]
        # Multiply by time-dependent ascertainment
        predicted_reported[i] = convolved * rates
        
    return predicted_reported, rates


# ============================================================================
# LAYER 2: STATISTICAL SCORECARD (CRPS, MAE, COVERAGE, PEAK ERRORS)
# ============================================================================

def compute_empirical_crps(ens: np.ndarray, obs: np.ndarray) -> np.ndarray:
    """
    Closed-form Gneiting & Raftery (2007) order-statistic CRPS.
    ens: shape (N_mc, T)
    obs: shape (T,)
    Returns crps_per_day of shape (T,)
    """
    N, T = ens.shape
    ens_sorted = np.sort(ens, axis=0)
    term1 = np.mean(np.abs(ens - obs), axis=0)
    
    i_indices = np.arange(1, N + 1)[:, None]
    weights = (2 * i_indices - N - 1) / (N * N)
    term2 = np.sum(weights * ens_sorted, axis=0)
    
    crps_per_day = term1 - term2
    return np.maximum(crps_per_day, 0.0)


def compute_forecast_scorecard(
    predicted_ensemble: np.ndarray,
    observed: np.ndarray
) -> Dict[str, Any]:
    """
    Evaluates an ensemble forecast against ground truth observations.
    
    Args:
        predicted_ensemble: shape (N_mc, T)
        observed: shape (T,)
        
    Returns:
        dict containing:
          - crps_mean: mean CRPS over horizon
          - crps_per_day: daily CRPS list
          - mae: Mean Absolute Error of median forecast
          - coverage_80: percentage of observations in [p10, p90]
          - coverage_95: percentage of observations in [p2.5, p97.5]
          - sharpness_80: mean width of 80% prediction interval
          - peak_day_error: |predicted peak day - observed peak day|
          - cumulative_error_pct: % error in total cases over window
    """
    T = len(observed)
    if predicted_ensemble.shape[1] != T:
        raise ValueError(f"Ensemble horizon ({predicted_ensemble.shape[1]}) != observed length ({T})")
        
    p50 = np.percentile(predicted_ensemble, 50, axis=0)
    p10 = np.percentile(predicted_ensemble, 10, axis=0)
    p90 = np.percentile(predicted_ensemble, 90, axis=0)
    p025 = np.percentile(predicted_ensemble, 2.5, axis=0)
    p975 = np.percentile(predicted_ensemble, 97.5, axis=0)
    
    # CRPS
    crps_daily = compute_empirical_crps(predicted_ensemble, observed)
    crps_mean = float(np.mean(crps_daily))
    
    # MAE of median
    mae = float(np.mean(np.abs(p50 - observed)))
    
    # Coverage
    cov_80 = float(np.mean((observed >= p10) & (observed <= p90)) * 100.0)
    cov_95 = float(np.mean((observed >= p025) & (observed <= p975)) * 100.0)
    
    # Sharpness (mean 80% interval width)
    sharpness_80 = float(np.mean(p90 - p10))
    
    # Peak day error
    pred_peak_day = int(np.argmax(p50)) + 1
    obs_peak_day = int(np.argmax(observed)) + 1
    peak_day_error = abs(pred_peak_day - obs_peak_day)
    
    # Cumulative cases error
    sum_pred = float(np.sum(p50))
    sum_obs = float(np.sum(observed))
    cum_err_pct = float(abs(sum_pred - sum_obs) / max(sum_obs, 1.0) * 100.0)
    
    return {
        "crps_mean": round(crps_mean, 2),
        "crps_per_day": [round(float(v), 2) for v in crps_daily],
        "mae": round(mae, 2),
        "coverage_80": round(cov_80, 1),
        "coverage_95": round(cov_95, 1),
        "sharpness_80": round(sharpness_80, 1),
        "pred_peak_day": pred_peak_day,
        "obs_peak_day": obs_peak_day,
        "peak_day_error": peak_day_error,
        "cum_observed": int(sum_obs),
        "cum_predicted_p50": int(sum_pred),
        "cum_error_pct": round(cum_err_pct, 1)
    }


# ============================================================================
# LAYER 2: BASELINE GENERATORS
# ============================================================================

def generate_persistence_forecast(past_observed: np.ndarray, horizon: int) -> np.ndarray:
    """
    Persistence forecast: projects the latest known observed daily count forward.
    Returns array of shape (horizon,).
    """
    last_val = past_observed[-1] if len(past_observed) > 0 else 0.0
    return np.full(horizon, float(last_val))


def generate_moving_average_forecast(past_observed: np.ndarray, horizon: int, window: int = 7) -> np.ndarray:
    """
    Moving average forecast: projects the 7-day trailing average forward.
    Returns array of shape (horizon,).
    """
    if len(past_observed) == 0:
        return np.zeros(horizon)
    trailing = past_observed[-window:] if len(past_observed) >= window else past_observed
    mean_val = float(np.mean(trailing))
    return np.full(horizon, mean_val)


def generate_growth_rate_forecast(past_observed: np.ndarray, horizon: int, window: int = 7) -> np.ndarray:
    """
    Exponential growth extrapolation based on past 7 days, with safeguards.
    """
    if len(past_observed) < 2:
        return generate_persistence_forecast(past_observed, horizon)
    trailing = past_observed[-window:] if len(past_observed) >= window else past_observed
    
    # Calculate geometric mean growth factor
    ratios = []
    for i in range(1, len(trailing)):
        if trailing[i - 1] > 0:
            ratios.append(trailing[i] / trailing[i - 1])
    if not ratios:
        return generate_persistence_forecast(past_observed, horizon)
        
    avg_growth = float(np.median(ratios))
    # Safeguard growth factor between [0.80, 1.25]
    avg_growth = max(0.80, min(1.25, avg_growth))
    
    curr = float(trailing[-1])
    preds = np.zeros(horizon)
    for h in range(horizon):
        curr *= avg_growth
        preds[h] = curr
    return preds


def compute_deterministic_baseline_scorecard(forecast: np.ndarray, observed: np.ndarray) -> Dict[str, Any]:
    """
    Scores a deterministic point forecast (CRPS collapses to MAE).
    """
    mae = float(np.mean(np.abs(forecast - observed)))
    crps = mae  # For point forecasts, CRPS == MAE
    sum_pred = float(np.sum(forecast))
    sum_obs = float(np.sum(observed))
    cum_err_pct = float(abs(sum_pred - sum_obs) / max(sum_obs, 1.0) * 100.0)
    
    return {
        "crps_mean": round(crps, 2),
        "mae": round(mae, 2),
        "cum_predicted": int(sum_pred),
        "cum_error_pct": round(cum_err_pct, 1)
    }


# ============================================================================
# LAYER 2: ROLLING-ORIGIN BACKTEST
# ============================================================================

def run_rolling_origin_backtest(
    predicted_ensemble_full: np.ndarray,
    observed_full: np.ndarray,
    origins: List[Dict[str, int]]
) -> List[Dict[str, Any]]:
    """
    Executes rolling-origin forecast evaluations.
    origins: list of dicts with keys {"origin_day": int, "horizon_days": int, "phase_label": str}
    
    Example:
      - origin_day=28, horizon=7 (Forecast days 29–35)
      - origin_day=35, horizon=14 (Forecast days 36–49)
      - origin_day=42, horizon=28 (Forecast days 43–70)
      - origin_day=56, horizon=28 (Forecast days 57–84)
    """
    results = []
    
    for sched in origins:
        orig = sched["origin_day"]
        horizon = sched["horizon_days"]
        label = sched.get("phase_label", f"Day {orig} +{horizon}d")
        
        start_idx = orig  # Day orig is 1-indexed, so index orig is day orig+1
        end_idx = orig + horizon
        
        if end_idx > len(observed_full):
            continue
            
        obs_window = observed_full[start_idx:end_idx]
        past_obs = observed_full[:orig]
        pred_window = predicted_ensemble_full[:, start_idx:end_idx]
        
        # Model scorecard
        model_scores = compute_forecast_scorecard(pred_window, obs_window)
        
        # Baselines
        persist_pred = generate_persistence_forecast(past_obs, horizon)
        persist_scores = compute_deterministic_baseline_scorecard(persist_pred, obs_window)
        
        ma_pred = generate_moving_average_forecast(past_obs, horizon, window=7)
        ma_scores = compute_deterministic_baseline_scorecard(ma_pred, obs_window)
        
        growth_pred = generate_growth_rate_forecast(past_obs, horizon, window=7)
        growth_scores = compute_deterministic_baseline_scorecard(growth_pred, obs_window)
        
        # Skill score vs persistence
        base_crps = persist_scores["crps_mean"]
        skill_score = 1.0 - (model_scores["crps_mean"] / base_crps) if base_crps > 0 else 0.0
        
        results.append({
            "phase_label": label,
            "origin_day": orig,
            "horizon_days": horizon,
            "window_days": f"Days {orig + 1}–{end_idx}",
            "model": model_scores,
            "baseline_persistence": persist_scores,
            "baseline_moving_avg": ma_scores,
            "baseline_growth": growth_scores,
            "skill_score_vs_persistence": round(float(skill_score), 4)
        })
        
    return results


# ============================================================================
# LAYER 3: INTERVENTION VALIDATION (Counterfactual Robustness)
# ============================================================================

def evaluate_intervention_robustness(
    intervention_ensembles: Dict[str, np.ndarray]
) -> List[Dict[str, Any]]:
    """
    Compares the 4 policy arms (none, rail_only, partial, full) to evaluate
    decision quality and effect robustness across Monte Carlo iterations.
    
    Args:
        intervention_ensembles: dict of arm_name -> array of shape (N_mc, T)
        
    Returns:
        Summary metrics for each intervention arm.
    """
    if "none" not in intervention_ensembles:
        return []
        
    none_ens = intervention_ensembles["none"]
    none_peak_p50 = np.max(np.percentile(none_ens, 50, axis=0))
    none_cum_p50 = np.percentile(np.sum(none_ens, axis=1), 50)
    
    comparisons = []
    
    for arm, ens in intervention_ensembles.items():
        daily_p50 = np.percentile(ens, 50, axis=0)
        daily_p10 = np.percentile(ens, 10, axis=0)
        daily_p90 = np.percentile(ens, 90, axis=0)
        
        peak_p50 = np.max(daily_p50)
        peak_day = int(np.argmax(daily_p50)) + 1
        
        cum_totals = np.sum(ens, axis=1)
        cum_p50 = np.percentile(cum_totals, 50)
        cum_p10 = np.percentile(cum_totals, 10)
        cum_p90 = np.percentile(cum_totals, 90)
        
        # Reductions vs unmitigated
        peak_reduction_pct = ((none_peak_p50 - peak_p50) / max(none_peak_p50, 1)) * 100.0
        cum_reduction_pct = ((none_cum_p50 - cum_p50) / max(none_cum_p50, 1)) * 100.0
        
        comparisons.append({
            "arm": arm,
            "peak_day": peak_day,
            "peak_p50": round(float(peak_p50), 1),
            "peak_p10": round(float(np.max(daily_p10)), 1),
            "peak_p90": round(float(np.max(daily_p90)), 1),
            "cum_infections_p50": int(cum_p50),
            "cum_infections_p10": int(cum_p10),
            "cum_infections_p90": int(cum_p90),
            "peak_reduction_pct": round(float(peak_reduction_pct), 1),
            "cumulative_reduction_pct": round(float(cum_reduction_pct), 1),
        })
        
    return comparisons
