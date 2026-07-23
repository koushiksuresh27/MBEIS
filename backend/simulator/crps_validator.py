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
