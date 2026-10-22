import numpy as np

def compute_crps(ensemble_trajectories: list[list[float]], observed: list[float]) -> dict:
    """
    Args:
        ensemble_trajectories: list of N trajectories, each a list of daily
            values (e.g. daily infected counts). Shape: (n_runs, n_days).
        observed: list of daily observed values. Length must match n_days.

    Returns:
        {
            "crps_per_day": list[float],  # CRPS for each day
            "crps_mean": float,           # mean CRPS across all days
        }
    """
    ens = np.array(ensemble_trajectories)
    obs = np.array(observed)
    
    if ens.shape[1] != obs.shape[0]:
        raise ValueError("Number of days in ensemble trajectories must match length of observed data.")
        
    N, T = ens.shape
    ens_sorted = np.sort(ens, axis=0)
    
    term1 = np.mean(np.abs(ens - obs), axis=0)
    
    i_indices = np.arange(1, N + 1)[:, None]
    weights = (2 * i_indices - N - 1) / (N * N)
    term2 = np.sum(weights * ens_sorted, axis=0)
    
    crps_per_day = term1 - term2
    
    return {
        "crps_per_day": [float(v) for v in crps_per_day],
        "crps_mean": float(np.mean(crps_per_day))
    }

def compute_naive_baseline_crps(observed: list[float]) -> dict:
    """
    Computes a persistence (naive) baseline CRPS. 
    Forecast for day T is the observed value at day T-1.
    """
    obs = np.array(observed)
    if len(obs) <= 1:
        return {"crps_per_day": [0.0] * len(obs), "crps_mean": 0.0}
        
    forecasts = obs[:-1]
    actuals = obs[1:]
    
    crps_per_day = np.abs(forecasts - actuals)
    crps_per_day = np.insert(crps_per_day, 0, 0.0) # Day 0 has no baseline prediction
    
    return {
        "crps_per_day": [float(v) for v in crps_per_day],
        "crps_mean": float(np.mean(crps_per_day[1:])) # Exclude day 0 from mean
    }

def validate_crps(ensemble_trajectories: list[list[float]], observed: list[float]) -> dict:
    """
    Validates model against observations by reporting both model CRPS and 
    a naive-baseline CRPS.
    """
    model_crps = compute_crps(ensemble_trajectories, observed)
    baseline_crps = compute_naive_baseline_crps(observed)
    
    baseline_mean = baseline_crps["crps_mean"]
    skill_score = 1.0 - (model_crps["crps_mean"] / baseline_mean) if baseline_mean > 0 else 0.0
    
    return {
        "model": model_crps,
        "naive_baseline": baseline_crps,
        "skill_score": float(skill_score)
    }

def apply_ascertainment_correction(
    ensemble_trajectories: list[list[float]],
    early_rate: float = 0.025,
    ramp_start_rate: float = 0.03,
    ramp_end_rate: float = 0.10,
    early_phase_end: int = 32,
) -> tuple[list[list[float]], list[float]]:
    """
    Scales raw model output (true infections) down to expected
    ascertained-case-equivalent counts.
    Days [0, early_phase_end): flat early_rate.
    Days [early_phase_end, T): linear ramp from ramp_start_rate to
    ramp_end_rate.
    Returns (corrected_ensemble, rates_used_per_day).
    
    WHY: Confirmed cases severely undercounted true infections due to limited
    testing in early 2020. This corrects the model's true infections output
    down to the expected ascertained cases so they can be fairly scored against
    historical case counts.
    """
    ens = np.array(ensemble_trajectories)
    n_runs, n_days = ens.shape
    
    rates = np.zeros(n_days)
    for day in range(n_days):
        if day < early_phase_end:
            rates[day] = early_rate
        else:
            total_ramp_days = n_days - early_phase_end
            if total_ramp_days > 1:
                fraction = (day - early_phase_end) / (total_ramp_days - 1)
            else:
                fraction = 0.0
            rates[day] = ramp_start_rate + fraction * (ramp_end_rate - ramp_start_rate)
            
    corrected_ensemble = ens * rates
    return corrected_ensemble.tolist(), rates.tolist()

def validate_crps_with_ascertainment(
    ensemble_trajectories: list[list[float]],
    observed: list[float],
    early_rate: float = 0.025,
    ramp_start_rate: float = 0.03,
    ramp_end_rate: float = 0.10,
    early_phase_end: int = 32,
) -> dict:
    corrected_ensemble, rates = apply_ascertainment_correction(
        ensemble_trajectories, early_rate, ramp_start_rate, ramp_end_rate, early_phase_end
    )
    result = validate_crps(corrected_ensemble, observed)
    result["ascertainment_rates_applied"] = rates
    return result

def sweep_ascertainment_sensitivity(
    ensemble_trajectories: list[list[float]],
    observed: list[float]
) -> list[dict]:
    results = []
    early_rates = [0.0145, 0.025, 0.036]
    ramp_end_rates = [0.06, 0.10, 0.15]
    ramp_start_rate = 0.03
    
    for er in early_rates:
        for rer in ramp_end_rates:
            res = validate_crps_with_ascertainment(
                ensemble_trajectories, observed,
                early_rate=er,
                ramp_start_rate=ramp_start_rate,
                ramp_end_rate=rer
            )
            results.append({
                "early_rate": er,
                "ramp_start_rate": ramp_start_rate,
                "ramp_end_rate": rer,
                "model_crps": res["model"]["crps_mean"],
                "baseline_crps": res["naive_baseline"]["crps_mean"],
                "skill_score": res["skill_score"]
            })
            
    results.sort(key=lambda x: x["skill_score"], reverse=True)
    return results


def compute_exp_growth_baseline_crps(
    observed: list[float],
    fit_window: int = 14,
) -> dict:
    """
    Exponential-growth baseline CRPS (stronger than naive persistence).

    Method:
        1. Fit y = a * exp(lambda * t) to observed[0:fit_window] via log-linear OLS.
        2. Project forward for days fit_window..T-1.
        3. Days 0..fit_window-1 use persistence (no forecast available).
        4. CRPS for a deterministic forecast is simply |forecast - observed|.

    Returns same structure as compute_naive_baseline_crps.

    Citation: Epidemic forecasting baselines -- Funk et al. 2019 (PLOS Comp Biol).
    """
    obs = np.array(observed, dtype=float)
    T = len(obs)

    crps_per_day = np.zeros(T)

    # Days 0..fit_window-1: persistence (same as naive baseline)
    for d in range(1, min(fit_window, T)):
        crps_per_day[d] = abs(obs[d] - obs[d - 1])

    if T <= fit_window:
        return {
            "crps_per_day": [float(v) for v in crps_per_day],
            "crps_mean": float(np.mean(crps_per_day[1:])),
        }

    # Fit log-linear OLS on [0, fit_window)
    t_fit = np.arange(fit_window, dtype=float)
    y_fit = obs[:fit_window]
    # Protect against zero/negative values in log
    y_safe = np.maximum(y_fit, 1.0)
    log_y = np.log(y_safe)
    # OLS: log_y = log(a) + lambda * t
    A = np.vstack([np.ones(fit_window), t_fit]).T
    try:
        coeffs, _, _, _ = np.linalg.lstsq(A, log_y, rcond=None)
        log_a, lam = coeffs
    except Exception:
        # Fallback to persistence if fit fails
        lam = 0.0
        log_a = np.log(max(obs[fit_window - 1], 1.0))

    # Project forward
    for d in range(fit_window, T):
        forecast = np.exp(log_a + lam * d)
        crps_per_day[d] = abs(forecast - obs[d])

    return {
        "crps_per_day": [float(v) for v in crps_per_day],
        "crps_mean": float(np.mean(crps_per_day[fit_window:])),
        "growth_rate_lambda": float(lam),
        "doubling_time_days": float(np.log(2) / lam) if lam > 0 else float("inf"),
    }


def compare_all_baselines(
    ensemble_trajectories: list[list[float]],
    observed: list[float],
) -> dict:
    """
    Convenience wrapper: computes model CRPS, naive-persistence CRPS, and
    exponential-growth CRPS, then returns skill scores for both comparisons.

    Used in run_crps_validation.py to populate the 'three baselines' table.
    """
    model_result    = compute_crps(ensemble_trajectories, observed)
    naive_result    = compute_naive_baseline_crps(observed)
    exp_result      = compute_exp_growth_baseline_crps(observed)

    model_mean  = model_result["crps_mean"]
    naive_mean  = naive_result["crps_mean"]
    exp_mean    = exp_result["crps_mean"]

    skill_vs_naive = 1.0 - (model_mean / naive_mean) if naive_mean > 0 else 0.0
    skill_vs_exp   = 1.0 - (model_mean / exp_mean)   if exp_mean   > 0 else 0.0

    return {
        "model_crps_mean":        model_mean,
        "naive_baseline_mean":    naive_mean,
        "exp_growth_baseline_mean": exp_mean,
        "skill_vs_naive":         float(skill_vs_naive),
        "skill_vs_exp_growth":    float(skill_vs_exp),
        "exp_growth_rate_lambda": exp_result.get("growth_rate_lambda"),
        "exp_doubling_time":      exp_result.get("doubling_time_days"),
        "model_crps_per_day":     model_result["crps_per_day"],
        "naive_crps_per_day":     naive_result["crps_per_day"],
        "exp_crps_per_day":       exp_result["crps_per_day"],
    }
