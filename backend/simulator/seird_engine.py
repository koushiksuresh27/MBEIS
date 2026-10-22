import numpy as np
import os
import csv
from scipy.stats import qmc, triang


from backend.simulator.simulator_io import (
    get_latest_pathogen_profile,
    write_seird_results,
    write_city_status,
    write_resource_projections,
    register_intervention_type,
    prune_old_scenarios
)
from backend.simulator.resource_calculator import calculate_resource_projections


N_DAYS = 180

# 15-city node data (GHSL/CAGR-interpolated 2020 populations).
CITIES = {
    "Delhi":         {"pop": 33_127_402, "lat": 28.7041, "lon": 77.1025},
    "Mumbai":        {"pop": 23_582_050, "lat": 19.0760, "lon": 72.8777},
    "Kolkata":       {"pop": 24_384_528, "lat": 22.5726, "lon": 88.3639},
    "Bengaluru":     {"pop": 13_678_383, "lat": 12.9716, "lon": 77.5946},
    "Chennai":       {"pop": 11_362_949, "lat": 13.0827, "lon": 80.2707},
    "Hyderabad":     {"pop": 9_790_908,  "lat": 17.3850, "lon": 78.4867},
    "Ahmedabad":     {"pop": 7_649_898,  "lat": 23.0225, "lon": 72.5714},
    "Pune":          {"pop": 7_926_450,  "lat": 18.5204, "lon": 73.8567},
    "Lucknow":       {"pop": 5_228_335,  "lat": 26.8467, "lon": 80.9462},
    "Kochi":         {"pop": 3_870_022,  "lat": 9.9312,  "lon": 76.2673},
    "Jaipur":        {"pop": 4_039_465,  "lat": 26.9124, "lon": 75.7873},
    "Patna":         {"pop": 5_175_312,  "lat": 25.5941, "lon": 85.1376},
    "Visakhapatnam": {"pop": 1_695_716,  "lat": 17.6868, "lon": 83.2185},
    "Bhopal":        {"pop": 2_451_628,  "lat": 23.2599, "lon": 77.4126},
    "Guwahati":      {"pop": 1_349_253,  "lat": 26.1445, "lon": 91.7362},
}


LOCAL_TRANSMISSION_MULTIPLIER = {
    'none':      1.00,
    'rail_only': 0.85,
    'partial':   0.60,
    'full':      0.25,
}

# Road 40%, Rail 40%, Air 20%, used as baseline weights in apply_intervention.
BASE_ROAD_SHARE = 0.40
BASE_RAIL_SHARE = 0.40
BASE_AIR_SHARE  = 0.20


def haversine_distance(lat1, lon1, lat2, lon2):
    """Calculate distance in km between two lat/lon points."""
    R = 6371.0
    lat1, lon1, lat2, lon2 = map(np.radians, [lat1, lon1, lat2, lon2])
    dlat, dlon = lat2 - lat1, lon2 - lon1
    a = np.sin(dlat/2)**2 + np.cos(lat1) * np.cos(lat2) * np.sin(dlon/2)**2
    return R * 2 * np.arcsin(np.sqrt(a))



STRUCTURAL_DATA = {
    "DELHI":             {"lat": 28.6139, "lon": 77.2090, "cap": 450000},
    "MUMBAI":            {"lat": 19.0760, "lon": 72.8777, "cap": 400000},
    "KOLKATA":           {"lat": 22.5726, "lon": 88.3639, "cap": 350000},
    "BENGALURU":         {"lat": 12.9716, "lon": 77.5946, "cap": 300000},
    "CHENNAI":           {"lat": 13.0827, "lon": 80.2707, "cap": 250000},
    "HYDERABAD":         {"lat": 17.3850, "lon": 78.4867, "cap": 200000},
    "AHMEDABAD":         {"lat": 23.0225, "lon": 72.5714, "cap": 150000},
    "PUNE":              {"lat": 18.5204, "lon": 73.8567, "cap": 150000},
    "LUCKNOW":           {"lat": 26.8467, "lon": 80.9462, "cap": 100000},
    "JAIPUR":            {"lat": 26.9124, "lon": 75.7873, "cap":  90000},
    "PATNA":             {"lat": 25.5941, "lon": 85.1376, "cap": 100000},
    "KOCHI":             {"lat":  9.9312, "lon": 76.2673, "cap":  80000},
    "VISAKHAPATNAM":     {"lat": 17.6868, "lon": 83.2185, "cap":  70000},
    "BHOPAL":            {"lat": 23.2599, "lon": 77.4126, "cap":  60000},
    "GUWAHATI":          {"lat": 26.1445, "lon": 91.7362, "cap":  50000},
    "THIRUVANANTHAPURAM":{"lat":  8.5241, "lon": 76.9366, "cap":  60000},
    "THRISSUR":          {"lat": 10.5276, "lon": 76.2144, "cap":  40000},
}


def build_composite_matrix(
    meta_edges_path: str = None,
    dgca_path: str = None,
    irctc_path: str = None
):
    """
    Builds three independent mobility matrices and returns them as a dict.

    Three layers:
      road  — meta_mobility_edges.csv (NH highway-adjusted radiation model)
      rail  — irctc_mobility_edges.csv (IRCTC OD passenger matrix, normalized)
      air   — dgca_annual_weights.csv (DGCA annual passenger flows)

    Distance decay is applied to road only — rail OD already encodes route
    distances implicitly. Aviation is symmetric (DGCA reports undirected flows).

    Returns:
        names   — list of 15 city name strings
        matrices — dict with keys 'road', 'rail', 'air', each an (n, n) ndarray
    """
    BASE_DIR = os.path.dirname(os.path.abspath(__file__))
    if meta_edges_path is None or not os.path.exists(meta_edges_path):
        meta_edges_path = os.path.join(BASE_DIR, "meta_mobility_edges.csv")
    if dgca_path is None or not os.path.exists(dgca_path):
        dgca_path = os.path.join(BASE_DIR, "dgca_annual_weights.csv")
    if irctc_path is None or not os.path.exists(irctc_path):
        irctc_path = os.path.join(BASE_DIR, "irctc_mobility_edges.csv")

    names = list(CITIES.keys())
    n = len(names)
    name_to_idx = {name.upper(): i for i, name in enumerate(names)}

    W_raw_road = np.zeros((n, n))
    W_aviation = np.zeros((n, n))
    W_rail     = np.zeros((n, n))

    capacities = np.zeros((n, 1))

    for name1 in names:
        i = name_to_idx[name1.upper()]
        data1 = STRUCTURAL_DATA.get(name1.upper())
        capacities[i, 0] = data1["cap"] if data1 else 50000

    # ── 1. Load road layer (meta_mobility_edges.csv) ───────────────────────
    # raw_daily_travelers = Meta outbound fraction × city pop × radiation weight
    # × NH multiplier. Real unit: travelers/day. Row-stochastic normalization
    # is deferred to apply_row_stochastic_bound() so relative magnitudes survive.
    if os.path.exists(meta_edges_path):
        with open(meta_edges_path, newline='') as f:
            for row in csv.DictReader(f):
                src = row['source_node_id'].strip().upper()
                tgt = row['target_node_id'].strip().upper()
                if src in name_to_idx and tgt in name_to_idx:
                    i, j = name_to_idx[src], name_to_idx[tgt]
                    W_raw_road[i, j] = float(row['raw_daily_travelers'])
    else:
        print(f"[engine] WARNING: meta_edges not found at {meta_edges_path}")

    # ── 2. Load aviation layer (dgca_annual_weights.csv) ──────────────────
    # DGCA flows are undirected — force symmetry.
    city_aliases_dgca = {"TRIVANDRUM": "THIRUVANANTHAPURAM", "BENGALURU": "BENGALURU"}
    if os.path.exists(dgca_path):
        with open(dgca_path, newline='') as f:
            for row in csv.DictReader(f):
                src = city_aliases_dgca.get(row['CITY1'].strip().upper(), row['CITY1'].strip().upper())
                tgt = city_aliases_dgca.get(row['CITY2'].strip().upper(), row['CITY2'].strip().upper())
                if src in name_to_idx and tgt in name_to_idx:
                    i, j = name_to_idx[src], name_to_idx[tgt]
                    W_aviation[i, j] = float(row['DAILY_AVG'])
                    W_aviation[j, i] = W_aviation[i, j]   # symmetric
    else:
        print(f"[engine] WARNING: DGCA file not found at {dgca_path}")

    # ── 3. Load rail layer (irctc_mobility_edges.csv) ─────────────────────
    # IRCTC OD matrix is asymmetric (directional passenger flows).
    # normalized_rail_weight already sums to 1.0 per source row.
    if os.path.exists(irctc_path):
        with open(irctc_path, newline='') as f:
            for row in csv.DictReader(f):
                src = row['source_node_id'].strip().upper()
                tgt = row['target_node_id'].strip().upper()
                if src in name_to_idx and tgt in name_to_idx:
                    i, j = name_to_idx[src], name_to_idx[tgt]
                    W_rail[i, j] = float(row['raw_weekly_capacity']) / 7.0
    else:
        print(f"[engine] WARNING: IRCTC file not found at {irctc_path}")

    # Precompute unperturbed baseline row sums for Baseline-Anchored Normalization
    W_blended_baseline = (
        BASE_ROAD_SHARE * W_raw_road
        + BASE_RAIL_SHARE * W_rail
        + BASE_AIR_SHARE  * W_aviation
    )
    baseline_row_sums = W_blended_baseline.sum(axis=1, keepdims=True)
    safe_baseline_row_sums = np.where(baseline_row_sums == 0, 1e-9, baseline_row_sums)

    matrices = {
        'raw': {
            'road': W_raw_road,
            'rail': W_rail,
            'air':  W_aviation,
        },
        'capacities': capacities,
        'name_to_idx': name_to_idx,
        'baseline_row_sums': safe_baseline_row_sums,
    }

    return names, matrices


INTERVENTION_PARAMS = {
    'none':      {'road': 1.00, 'rail': 1.00, 'air': 1.00, 'flow': 1.00},
    'rail_only': {'road': 1.00, 'rail': 0.00, 'air': 1.00, 'flow': 1.00},
    'partial':   {'road': 0.33, 'rail': 0.33, 'air': 0.33, 'flow': 1.00},
    'full':      {'road': 0.05, 'rail': 0.00, 'air': 0.05, 'flow': 1.00},
}


def apply_intervention(matrices: dict, intervention_type: str, edge_cuts: list = None, city_quarantines: list = None, modal_shares: dict = None, edge_capacities: dict = None) -> np.ndarray:
    """
    Three-layer mobility blending for intervention scenarios with Baseline-Anchored Normalization.

    Mechanics & Baseline-Anchored Normalization:
        1. Directional edge cuts and corridor capacity throttles are applied to raw layers.
        2. Mode weights are scaled: (road_share * params['road'], etc.) and summed into W_blended.
        3. BASELINE-ANCHORED NORMALIZATION:
           W_blended is normalized by the UNPERTURBED baseline row sums S_i^(0), NOT by the
           post-cut/post-intervention row sums:
               W_normalized = W_blended / S_i^(0)
           This resolves two critical modeling artifacts:
             a. No Spillover Artifact on Edge Cuts: Severing a corridor (e.g. Delhi->Mumbai = 0)
                reduces outbound volume from Delhi without artificially inflating flows to other
                destinations (trips are aborted/canceled rather than forced onto other cities).
             b. No Modal Multiplier Cancellation: Uniform throttles (e.g. road=rail=air=0.33)
                directly reduce matrix volume by 0.33x without canceling in the denominator.
        4. Outbound nodal physical capacity bounds are applied (W_normalized * capacities).
        5. Optional flow factor is applied if non-unity (W_final *= params['flow']).
    """
    params = INTERVENTION_PARAMS.get(intervention_type, INTERVENTION_PARAMS['none'])
    if intervention_type not in INTERVENTION_PARAMS:
        print(f"[engine] WARNING: unknown intervention_type '{intervention_type}', using 'none'")

    raw         = matrices['raw']
    capacities  = matrices['capacities']
    name_to_idx = matrices['name_to_idx']

    road = raw['road'].copy()
    rail = raw['rail'].copy()
    air  = raw['air'].copy()

    # Apply per-edge, per-mode cuts by zeroing specific matrix cells
    if edge_cuts:
        for cut in edge_cuts:
            i = name_to_idx.get(cut['src'].upper())
            j = name_to_idx.get(cut['tgt'].upper())
            if i is None or j is None:
                print(f"[engine] WARNING: unknown city in edge_cut {cut}, skipping")
                continue
            if 'road' in cut['modes']: road[i, j] = 0.0
            if 'rail' in cut['modes']: rail[i, j] = 0.0
            if 'air'  in cut['modes']: air[i, j]  = 0.0

    # Apply dynamic edge capacity scaling (bidirectional corridor capacity)
    if edge_capacities:
        for key, cap in edge_capacities.items():
            parts = key.split('-')
            if len(parts) == 2:
                src, tgt = parts[0].strip().upper(), parts[1].strip().upper()
                i = name_to_idx.get(src)
                j = name_to_idx.get(tgt)
                if i is not None and j is not None:
                    cap_clamped = max(0.0, min(1.0, float(cap)))
                    road[i, j] *= cap_clamped; road[j, i] *= cap_clamped
                    rail[i, j] *= cap_clamped; rail[j, i] *= cap_clamped
                    air[i, j]  *= cap_clamped; air[j, i]  *= cap_clamped

    if city_quarantines:
        name_to_idx = matrices['name_to_idx']
        for city in city_quarantines:
            idx = next(
                (name_to_idx[k] for k in name_to_idx 
                 if k == city.strip().upper()), None
            )
            if idx is None:
                print(f"[engine] WARNING: city_quarantine '{city}' not found, skipping")
                continue
            road[idx, :] = 0.0; road[:, idx] = 0.0
            rail[idx, :] = 0.0; rail[:, idx] = 0.0
            air[idx,  :] = 0.0; air[:,  idx] = 0.0

    road_share = modal_shares['road'] if (modal_shares and 'road' in modal_shares) else BASE_ROAD_SHARE
    rail_share = modal_shares['rail'] if (modal_shares and 'rail' in modal_shares) else BASE_RAIL_SHARE
    air_share  = modal_shares['air']  if (modal_shares and 'air'  in modal_shares) else BASE_AIR_SHARE

    W_blended = (
        road_share * params['road'] * road
        + rail_share * params['rail'] * rail
        + air_share  * params['air']  * air
    )

    # Baseline-Anchored Normalization:
    # Denominator is the unperturbed baseline row sum S_i^(0), NOT the post-cut/post-intervention row sum.
    if modal_shares:
        W_blended_base = (
            road_share * raw['road']
            + rail_share * raw['rail']
            + air_share  * raw['air']
        )
        base_denom = W_blended_base.sum(axis=1, keepdims=True)
        safe_base_denom = np.where(base_denom == 0, 1e-9, base_denom)
    else:
        safe_base_denom = matrices.get('baseline_row_sums')
        if safe_base_denom is None:
            W_blended_base = (
                BASE_ROAD_SHARE * raw['road']
                + BASE_RAIL_SHARE * raw['rail']
                + BASE_AIR_SHARE  * raw['air']
            )
            base_denom = W_blended_base.sum(axis=1, keepdims=True)
            safe_base_denom = np.where(base_denom == 0, 1e-9, base_denom)

    W_normalized = np.where(safe_base_denom <= 1e-9, 0.0, W_blended / safe_base_denom)
    W_final  = W_normalized * capacities
    if 'flow' in params and params['flow'] != 1.0:
        W_final *= params['flow']
    return W_final


def calculate_daily_infections(S, I, imported_I, N, R0, infectious_days, rng, local_mult,
                               k_sensitivity=35.0):
    
    N_safe = np.maximum(N, 1)

    # 1. Local prevalence (active infections as fraction of city population)
    prevalence = I / N_safe

    # 2. Endogenous behavioral dampening — organic public fear response
    #    At k=35: 1.9% prevalence halves local transmission spontaneously
    behavior_mult = np.exp(-k_sensitivity * prevalence)

    # 3. Stack both suppression axes: government policy × organic fear
    effective_mult = local_mult * behavior_mult

    # 4. Transmission rate with combined suppression
    beta = (R0 / infectious_days) * effective_mult
    total_I = I + imported_I
    force_of_infection = beta * (total_I / N_safe)

    force_of_infection = np.clip(force_of_infection, 0.0, 50.0)

    if force_of_infection.max() > 1.0:
        max_idx = force_of_infection.argmax()
        print(f"WARNING: force_of_infection exceeded 1.0 at index {max_idx} "
              f"(val: {force_of_infection[max_idx]:.3f})")

    p_infection = 1.0 - np.exp(-force_of_infection)
    p_infection = np.clip(p_infection, 0.0, 1.0)
    S_int = S.astype(int)
    new_exposed = rng.binomial(n=S_int, p=p_infection)
    return new_exposed.astype(float)


def run_mc_iteration(
    names, matrices, origin_city, intervention,
    r0, incubation_days, cfr, infectious_period, rng,
    seed_infections=500, k_sensitivity=35.0, edge_cuts=None, city_quarantines=None,
    vaccination=None, festivals=None
):
    """
    Single Monte Carlo iteration for a fixed intervention.
    Supports optional vaccination rollout and mass gathering / festival shocks.
    matrices: dict with keys 'road', 'rail', 'air' from build_composite_matrix.
    """
    from backend.simulator.seirv_engine import build_festival_multiplier, VaccinationParams

    n = len(names)
    pops = np.array([CITIES[c]["pop"] for c in names], dtype=float)
    S = pops.copy()
    E = np.zeros(n, dtype=float)
    I = np.zeros(n, dtype=float)
    R = np.zeros(n, dtype=float)
    D = np.zeros(n, dtype=float)
    V = np.zeros(n, dtype=float)
    V_pending = np.zeros(n, dtype=float)

    if origin_city in names:
        origin_idx = names.index(origin_city)
        I[origin_idx] = seed_infections
        S[origin_idx] -= seed_infections
    else:
        raise ValueError(
            f"run_mc_iteration: origin_city '{origin_city}' not in names list. "
            f"Ensure run_simulation normalized it before calling."
        )

    sigma = 1.0 / max(incubation_days, 0.1)
    gamma = 1.0 / max(infectious_period, 0.1)

    national_infected     = np.zeros(N_DAYS)
    national_deaths       = np.zeros(N_DAYS)
    national_new_infections = np.zeros(N_DAYS)
    city_active           = np.zeros((N_DAYS, n))

    # Build blended W matrix once per iteration (fixed for the full N_DAYS)
    W = apply_intervention(matrices, intervention, edge_cuts=edge_cuts, city_quarantines=city_quarantines)

    vax_params = VaccinationParams.from_dict(vaccination)
    fest_list = festivals or []
    city_idx_map = {c: i for i, c in enumerate(names)}

    for day in range(N_DAYS):
        fmult = build_festival_multiplier(day, fest_list, city_idx_map, n)
        local_mult = LOCAL_TRANSMISSION_MULTIPLIER.get(intervention, 1.0)
        N_safe = np.maximum(pops, 1.0)

        import_pressure = W.T @ (I / N_safe)

        prevalence = I / N_safe
        behavior_mult = np.exp(-k_sensitivity * prevalence)
        effective_mult = local_mult * behavior_mult * fmult
        beta = (r0 / max(infectious_period, 0.1)) * effective_mult
        total_I = I + import_pressure
        force_of_infection = beta * (total_I / N_safe)
        force_of_infection = np.clip(force_of_infection, 0.0, 50.0)

        force_V = (1.0 - vax_params.efficacy) * force_of_infection if vax_params.enabled else force_of_infection

        p_infection = np.clip(1.0 - np.exp(-force_of_infection), 0.0, 1.0)
        p_infection_V = np.clip(1.0 - np.exp(-force_V), 0.0, 1.0)

        # 4. Outflows from S (Competing risk: infection vs vaccination)
        dE_from_S = rng.binomial(n=S.astype(int), p=p_infection).astype(float)
        dV_new = np.zeros(n)
        if vax_params.enabled and day >= vax_params.start_day:
            eligible = S + R
            total_doses = vax_params.daily_rate * pops
            dV_new = np.minimum(S, total_doses * np.where(eligible > 0, S / eligible, 0.0))

        total_S_out = dE_from_S + dV_new
        scale = np.where(total_S_out > S, S / np.maximum(total_S_out, 1e-9), 1.0)
        dE_from_S *= scale
        dV_new *= scale

        # 5. Outflows from V (Breakthrough infection vs antibody waning)
        dE_from_V = rng.binomial(n=V.astype(int), p=p_infection_V).astype(float) if vax_params.enabled else np.zeros(n)
        omega = (1.0 / vax_params.waning_mean_days) if (vax_params.enabled and vax_params.waning_mean_days) else 0.0
        dS_waned = omega * V
        total_V_out = dE_from_V + dS_waned
        scale_V = np.where((total_V_out > V) & (total_V_out > 0), V / np.maximum(total_V_out, 1e-9), 1.0)
        dE_from_V *= scale_V
        dS_waned *= scale_V

        # 6. V_pending onset lag (maturation delay)
        onset_rate = 1.0 / max(vax_params.onset_days, 1)
        dV_graduated = np.clip(onset_rate * V_pending, 0.0, V_pending)
        dV_pending_in = dV_new

        # 7. Transitions: E -> I
        total_new_infections = dE_from_S + dE_from_V
        new_exposed_to_infectious = np.clip(sigma * E, 0.0, E)

        # 8. Transitions: I -> R / D with severity protection for breakthrough cases
        new_removed = np.clip(gamma * I, 0.0, I)
        breakthrough_ratio = np.where(total_new_infections > 0, dE_from_V / np.maximum(total_new_infections, 1e-9), 0.0)
        effective_cfr = cfr * (1.0 - vax_params.severity_efficacy * breakthrough_ratio)
        new_deaths = new_removed * effective_cfr
        new_recovered = new_removed - new_deaths

        # 9. Update state with mass-conservation bounds
        S = np.clip(S - dE_from_S - dV_new + dS_waned, 0.0, pops)
        E = np.clip(E + total_new_infections - new_exposed_to_infectious, 0.0, pops)
        I = np.clip(I + new_exposed_to_infectious - new_removed, 0.0, pops)
        R = np.clip(R + new_recovered, 0.0, pops)
        D = np.clip(D + new_deaths, 0.0, pops)
        V = np.clip(V + dV_graduated - dE_from_V - dS_waned, 0.0, pops)
        V_pending = np.clip(V_pending + dV_pending_in - dV_graduated, 0.0, pops)

        national_infected[day]       = I.sum()
        national_deaths[day]         = D.sum()
        national_new_infections[day] = total_new_infections.sum()
        city_active[day]             = I

    return national_infected, national_deaths, national_new_infections, city_active



def run_simulation(
    scenario_id: str,
    origin_city: str,
    intervention_types: list,
    n_iterations: int = 128,
    seed_infections: int = 500,
    k_sensitivity: float = 35.0,
    edge_cuts=None,
    city_quarantines=None,
    meta_edges_path: str = "backend/simulator/meta_mobility_edges.csv",
    dgca_path: str = "backend/simulator/dgca_annual_weights.csv",
    irctc_path: str = "backend/simulator/irctc_mobility_edges.csv",
    vaccination=None,
    festivals=None
) -> dict:
    """
    Runs MC simulation for all specified interventions and writes to Supabase.
    """
    # Normalize origin_city at the boundary — single normalization point.
    # THRISSUR alias handled in run_scenario.py before this is called.
    names = list(CITIES.keys())
    matched = next(
        (c for c in names if c.strip().lower() == origin_city.strip().lower()), None
    )
    if matched is None:
        raise ValueError(
            f"origin_city '{origin_city}' not found in CITIES. Available: {names}"
        )
    origin_city = matched
    print(f"[engine] origin_city resolved to '{origin_city}'")

    profile = get_latest_pathogen_profile(scenario_id)

    names, matrices = build_composite_matrix(
        meta_edges_path=meta_edges_path,
        dgca_path=dgca_path,
        irctc_path=irctc_path
    )

    seird_rows_all = []
    city_rows_all  = []

    # QMC parameter sampling — Sobol low-discrepancy sequence
    # Samples the 4-dimensional biological parameter space:

    m = int(np.ceil(np.log2(n_iterations)))
    sampler = qmc.Sobol(d=4, scramble=True, seed=42)
    uniform_samples = sampler.random_base2(m=m)[:n_iterations]

    def to_triang(u, low, mode, high, default_low=1.5, default_mode=2.25, default_high=3.0):
        if low is None or mode is None or high is None:
            low, mode, high = default_low, default_mode, default_high
        low, mode, high = float(low), float(mode), float(high)
        scale = high - low
        if scale == 0:
            return np.full_like(u, low)
        c = (mode - low) / scale
        return triang.ppf(u, c=c, loc=low, scale=scale)

    r0_samples  = to_triang(uniform_samples[:, 0],
                             profile.get("r0_low"), profile.get("r0_most_likely"), profile.get("r0_high"),
                             default_low=1.5, default_mode=2.25, default_high=3.0)
    inc_samples = to_triang(uniform_samples[:, 1],
                             profile.get("incubation_days_low"),
                             profile.get("incubation_days_most_likely"),
                             profile.get("incubation_days_high"),
                             default_low=2.0, default_mode=8.0, default_high=14.0)
    cfr_samples = to_triang(uniform_samples[:, 2],
                             profile.get("cfr_low"), profile.get("cfr_most_likely"), profile.get("cfr_high"),
                             default_low=0.01, default_mode=0.021, default_high=0.07)

    if (
        profile.get("infectious_period_most_likely") is not None
        and profile.get("infectious_period_low") is not None
        and profile.get("infectious_period_high") is not None
    ):
        inf_samples = to_triang(uniform_samples[:, 3],
                                profile["infectious_period_low"],
                                profile["infectious_period_most_likely"],
                                profile["infectious_period_high"],
                                default_low=5.0, default_mode=7.0, default_high=10.0)
    else:
        inf_samples = np.full(n_iterations, 7.0)

    for intervention in intervention_types:
        print(f"Running {n_iterations} MC iterations for intervention={intervention}...")
        all_infected      = np.zeros((n_iterations, N_DAYS))
        all_deaths        = np.zeros((n_iterations, N_DAYS))
        all_new_infections = np.zeros((n_iterations, N_DAYS))
        all_city_active   = np.zeros((n_iterations, N_DAYS, len(names)))

        seed_sequence = np.random.SeedSequence(42)
        child_seeds   = seed_sequence.spawn(n_iterations)

        for it in range(n_iterations):
            rng = np.random.default_rng(child_seeds[it])
            inf, dth, new_inf, city_act = run_mc_iteration(
                names, matrices, origin_city, intervention,
                r0_samples[it], inc_samples[it], cfr_samples[it], inf_samples[it],
                rng,
                seed_infections=seed_infections,
                k_sensitivity=k_sensitivity,
                edge_cuts=edge_cuts,
                city_quarantines=city_quarantines,
                vaccination=vaccination,
                festivals=festivals
            )
            all_infected[it]       = inf
            all_deaths[it]         = dth
            all_new_infections[it] = new_inf
            all_city_active[it]    = city_act

        for day in range(N_DAYS):
            seird_rows_all.append({
                "scenario_id":               scenario_id,
                "pathogen_profile_version":  profile["version"],
                "intervention_type":         intervention,
                "day":                       day + 1,
                "infected_p10":  float(np.percentile(all_infected[:, day], 10)),
                "infected_p50":  float(np.percentile(all_infected[:, day], 50)),
                "infected_p90":  float(np.percentile(all_infected[:, day], 90)),
                "deaths_p10":    float(np.percentile(all_deaths[:, day], 10)),
                "deaths_p50":    float(np.percentile(all_deaths[:, day], 50)),
                "deaths_p90":    float(np.percentile(all_deaths[:, day], 90)),
                "trajectory_sample":
                    all_infected[:, day].tolist(),
                "new_infections_trajectory_sample":
                    all_new_infections[:, day].tolist(),
            })

            for ci, city in enumerate(names):
                city_rows_all.append({
                    "scenario_id":              scenario_id,
                    "pathogen_profile_version": profile["version"],
                    "intervention_type":        intervention,
                    "city":                     city,
                    "day":                      day + 1,
                    "active_cases_p10": float(np.percentile(all_city_active[:, day, ci], 10)),
                    "active_cases_p50": float(np.percentile(all_city_active[:, day, ci], 50)),
                    "active_cases_p90": float(np.percentile(all_city_active[:, day, ci], 90)),
                })

    # Write results grouped by intervention
    from itertools import groupby
    from operator import itemgetter

    sorted_seird = sorted(seird_rows_all, key=itemgetter("intervention_type"))
    for inv_type, group in groupby(sorted_seird, key=itemgetter("intervention_type")):
        write_seird_results(list(group))
        print(f"  [done] seird_results written for intervention={inv_type}")

    sorted_city = sorted(city_rows_all, key=itemgetter("intervention_type"))
    for inv_type, group in groupby(sorted_city, key=itemgetter("intervention_type")):
        city_group = list(group)
        write_city_status(city_group)
        print(f"  [done] city_status written for intervention={inv_type}")
        resource_rows = calculate_resource_projections(city_group, scenario_id, profile)
        write_resource_projections(resource_rows)
        print(f"  [done] resource_projections written for intervention={inv_type}")

    # Enforce rolling buffer: keep only the latest 5 scenarios in Supabase
    try:
        prune_old_scenarios(keep_limit=5)
    except Exception as e:
        print(f"[prune] Rolling buffer maintenance failed: {e}", flush=True)

    return {
        "seird_results": seird_rows_all,
        "city_status":   city_rows_all,
    }


# PHASED INTERVENTION RUNNER
# from_day and to_day are 1-indexed, inclusive on both ends.

def _resolve_intervention_for_day(day_1indexed: int, schedule: list) -> str:
    """
    Returns the intervention type that applies on a given day (1-indexed).
    Falls back to 'none' if the day falls outside all defined phases.
    """
    for phase in schedule:
        if phase["from_day"] <= day_1indexed <= phase["to_day"]:
            return phase["intervention"]
    return "none"


def run_phased_mc_iteration(
    names, matrices, origin_city, schedule,
    r0, incubation_days, cfr, infectious_period, rng,
    edge_cuts=None, city_quarantines=None, seed_infections=500, k_sensitivity=35.0,
    vaccination=None, festivals=None
):
    
    from backend.simulator.seirv_engine import build_festival_multiplier, VaccinationParams

    n = len(names)
    pops = np.array([CITIES[c]["pop"] for c in names], dtype=float)
    S = pops.copy()
    E = np.zeros(n, dtype=float)
    I = np.zeros(n, dtype=float)
    R = np.zeros(n, dtype=float)
    D = np.zeros(n, dtype=float)
    V = np.zeros(n, dtype=float)
    V_pending = np.zeros(n, dtype=float)

    if origin_city in names:
        origin_idx = names.index(origin_city)
        I[origin_idx] = seed_infections
        S[origin_idx] -= seed_infections
    else:
        raise ValueError(
            f"run_phased_mc_iteration: origin_city '{origin_city}' not in names. "
            f"Ensure run_phased_simulation normalized it before calling."
        )

    sigma = 1.0 / max(incubation_days, 0.1)
    gamma = 1.0 / max(infectious_period, 0.1)

    national_infected      = np.zeros(N_DAYS)
    national_deaths        = np.zeros(N_DAYS)
    national_new_infections = np.zeros(N_DAYS)
    city_active            = np.zeros((N_DAYS, n))

    # Pre-cache blended W matrices for each unique intervention in the schedule
    unique_interventions = set(p["intervention"] for p in schedule) | {"none"}
    W_cache = {
        inv: apply_intervention(matrices, inv, edge_cuts=edge_cuts, city_quarantines=city_quarantines)
        for inv in unique_interventions
    }

    vax_params = VaccinationParams.from_dict(vaccination)
    fest_list = festivals or []
    city_idx_map = {c: i for i, c in enumerate(names)}

    for day in range(N_DAYS):
        day_1indexed = day + 1
        current_intervention = _resolve_intervention_for_day(day_1indexed, schedule)

        W = W_cache[current_intervention]
        local_mult = LOCAL_TRANSMISSION_MULTIPLIER.get(current_intervention, 1.0)
        fmult = build_festival_multiplier(day, fest_list, city_idx_map, n)
        N_safe = np.maximum(pops, 1.0)

        import_pressure = W.T @ (I / N_safe)

        prevalence = I / N_safe
        behavior_mult = np.exp(-k_sensitivity * prevalence)
        effective_mult = local_mult * behavior_mult * fmult
        beta = (r0 / max(infectious_period, 0.1)) * effective_mult
        total_I = I + import_pressure
        force_of_infection = beta * (total_I / N_safe)
        force_of_infection = np.clip(force_of_infection, 0.0, 50.0)

        force_V = (1.0 - vax_params.efficacy) * force_of_infection if vax_params.enabled else force_of_infection

        p_infection = np.clip(1.0 - np.exp(-force_of_infection), 0.0, 1.0)
        p_infection_V = np.clip(1.0 - np.exp(-force_V), 0.0, 1.0)

        # 4. Outflows from S (Competing risk: infection vs vaccination)
        dE_from_S = rng.binomial(n=S.astype(int), p=p_infection).astype(float)
        dV_new = np.zeros(n)
        if vax_params.enabled and day >= vax_params.start_day:
            eligible = S + R
            total_doses = vax_params.daily_rate * pops
            dV_new = np.minimum(S, total_doses * np.where(eligible > 0, S / eligible, 0.0))

        total_S_out = dE_from_S + dV_new
        scale = np.where(total_S_out > S, S / np.maximum(total_S_out, 1e-9), 1.0)
        dE_from_S *= scale
        dV_new *= scale

        # 5. Outflows from V (Breakthrough infection vs antibody waning)
        dE_from_V = rng.binomial(n=V.astype(int), p=p_infection_V).astype(float) if vax_params.enabled else np.zeros(n)
        omega = (1.0 / vax_params.waning_mean_days) if (vax_params.enabled and vax_params.waning_mean_days) else 0.0
        dS_waned = omega * V
        total_V_out = dE_from_V + dS_waned
        scale_V = np.where((total_V_out > V) & (total_V_out > 0), V / np.maximum(total_V_out, 1e-9), 1.0)
        dE_from_V *= scale_V
        dS_waned *= scale_V

        # 6. V_pending onset lag (maturation delay)
        onset_rate = 1.0 / max(vax_params.onset_days, 1)
        dV_graduated = np.clip(onset_rate * V_pending, 0.0, V_pending)
        dV_pending_in = dV_new

        # 7. Transitions: E -> I
        total_new_infections = dE_from_S + dE_from_V
        new_exposed_to_infectious = np.clip(sigma * E, 0.0, E)

        # 8. Transitions: I -> R / D with severity protection for breakthrough cases
        new_removed = np.clip(gamma * I, 0.0, I)
        breakthrough_ratio = np.where(total_new_infections > 0, dE_from_V / np.maximum(total_new_infections, 1e-9), 0.0)
        effective_cfr = cfr * (1.0 - vax_params.severity_efficacy * breakthrough_ratio)
        new_deaths = new_removed * effective_cfr
        new_recovered = new_removed - new_deaths

        # 9. Update state with mass-conservation bounds
        S = np.clip(S - dE_from_S - dV_new + dS_waned, 0.0, pops)
        E = np.clip(E + total_new_infections - new_exposed_to_infectious, 0.0, pops)
        I = np.clip(I + new_exposed_to_infectious - new_removed, 0.0, pops)
        R = np.clip(R + new_recovered, 0.0, pops)
        D = np.clip(D + new_deaths, 0.0, pops)
        V = np.clip(V + dV_graduated - dE_from_V - dS_waned, 0.0, pops)
        V_pending = np.clip(V_pending + dV_pending_in - dV_graduated, 0.0, pops)

        national_infected[day]       = I.sum()
        national_deaths[day]         = D.sum()
        national_new_infections[day] = total_new_infections.sum()
        city_active[day]             = I

    return national_infected, national_deaths, national_new_infections, city_active


def validate_phased_schedule(schedule: list) -> None:
    """Validates a phased intervention schedule without bare asserts."""
    valid_interventions = {"none", "rail_only", "partial", "full"}
    if not schedule:
        raise ValueError("Schedule cannot be empty.")
    days_covered = []
    for phase in schedule:
        p = phase.dict() if hasattr(phase, "dict") else (phase.model_dump() if hasattr(phase, "model_dump") else phase)
        if "from_day" not in p or "to_day" not in p or "intervention" not in p:
            raise ValueError(f"Phase missing required keys (from_day, to_day, intervention): {phase}")
        f_day = p["from_day"]
        t_day = p["to_day"]
        inv = p["intervention"]
        if f_day < 1:
            raise ValueError(f"from_day must be >= 1, got {f_day}")
        if t_day > N_DAYS:
            raise ValueError(f"to_day must be <= {N_DAYS}, got {t_day}")
        if f_day > t_day:
            raise ValueError(f"from_day ({f_day}) must be <= to_day ({t_day})")
        if inv not in valid_interventions:
            raise ValueError(f"intervention must be one of {sorted(valid_interventions)}, got '{inv}'")
        days_covered.extend(range(f_day, t_day + 1))
    if len(days_covered) != len(set(days_covered)):
        raise ValueError("Schedule has overlapping phases — each day must appear in at most one phase.")


def run_phased_simulation(
    scenario_id: str,
    origin_city: str,
    schedule: list,
    label: str,
    edge_cuts: list = None,
    city_quarantines=None,
    n_iterations: int = 128,
    seed_infections: int = 500,
    k_sensitivity: float = 35.0,
    meta_edges_path: str = "backend/simulator/meta_mobility_edges.csv",
    dgca_path: str = "backend/simulator/dgca_annual_weights.csv",
    irctc_path: str = "backend/simulator/irctc_mobility_edges.csv",
    vaccination=None,
    festivals=None
) -> None:
    
    validate_phased_schedule(schedule)

    CITY_ALIASES = {"THRISSUR": "Kochi"}
    origin_city = CITY_ALIASES.get(origin_city.strip().upper(), origin_city)

    names = list(CITIES.keys())
    matched = next(
        (c for c in names if c.strip().lower() == origin_city.strip().lower()), None
    )
    if matched is None:
        raise ValueError(
            f"origin_city '{origin_city}' not found in CITIES. Available: {names}"
        )
    origin_city = matched
    print(f"[phased] origin_city resolved to '{origin_city}'")
    print(f"[phased] schedule: {schedule}")
    print(f"[phased] label: '{label}'")

    profile = get_latest_pathogen_profile(scenario_id)
    names, matrices = build_composite_matrix(
        meta_edges_path=meta_edges_path,
        dgca_path=dgca_path,
        irctc_path=irctc_path
    )

    m = int(np.ceil(np.log2(n_iterations)))
    sampler = qmc.Sobol(d=4, scramble=True, seed=42)
    uniform_samples = sampler.random_base2(m=m)[:n_iterations]

    def to_triang(u, low, mode, high, default_low=1.5, default_mode=2.25, default_high=3.0):
        if low is None or mode is None or high is None:
            low, mode, high = default_low, default_mode, default_high
        low, mode, high = float(low), float(mode), float(high)
        scale = high - low
        if scale == 0:
            return np.full_like(u, low)
        c = (mode - low) / scale
        return triang.ppf(u, c=c, loc=low, scale=scale)

    r0_samples  = to_triang(uniform_samples[:, 0],
                             profile.get("r0_low"), profile.get("r0_most_likely"), profile.get("r0_high"),
                             default_low=1.5, default_mode=2.25, default_high=3.0)
    inc_samples = to_triang(uniform_samples[:, 1],
                             profile.get("incubation_days_low"),
                             profile.get("incubation_days_most_likely"),
                             profile.get("incubation_days_high"),
                             default_low=2.0, default_mode=8.0, default_high=14.0)
    cfr_samples = to_triang(uniform_samples[:, 2],
                             profile.get("cfr_low"), profile.get("cfr_most_likely"), profile.get("cfr_high"),
                             default_low=0.01, default_mode=0.021, default_high=0.07)

    if (
        profile.get("infectious_period_most_likely") is not None
        and profile.get("infectious_period_low") is not None
        and profile.get("infectious_period_high") is not None
    ):
        inf_samples = to_triang(uniform_samples[:, 3],
                                profile["infectious_period_low"],
                                profile["infectious_period_most_likely"],
                                profile["infectious_period_high"],
                                default_low=5.0, default_mode=7.0, default_high=10.0)
    else:
        inf_samples = np.full(n_iterations, 7.0)

    print(f"[phased] Running {n_iterations} MC iterations...")
    all_infected       = np.zeros((n_iterations, N_DAYS))
    all_deaths         = np.zeros((n_iterations, N_DAYS))
    all_new_infections = np.zeros((n_iterations, N_DAYS))
    all_city_active    = np.zeros((n_iterations, N_DAYS, len(names)))

    seed_sequence = np.random.SeedSequence(42)
    child_seeds   = seed_sequence.spawn(n_iterations)

    for it in range(n_iterations):
        rng = np.random.default_rng(child_seeds[it])
        inf, dth, new_inf, city_act = run_phased_mc_iteration(
            names, matrices, origin_city, schedule,
            r0_samples[it], inc_samples[it], cfr_samples[it], inf_samples[it],
            rng,
            edge_cuts=edge_cuts,
            city_quarantines=city_quarantines,
            seed_infections=seed_infections,
            k_sensitivity=k_sensitivity,
            vaccination=vaccination,
            festivals=festivals
        )
        all_infected[it]       = inf
        all_deaths[it]         = dth
        all_new_infections[it] = new_inf
        all_city_active[it]    = city_act

    seird_rows = []
    city_rows  = []

    for day in range(N_DAYS):
        seird_rows.append({
            "scenario_id":              scenario_id,
            "pathogen_profile_version": profile["version"],
            "intervention_type":        label,
            "day":                      day + 1,
            "infected_p10":  float(np.percentile(all_infected[:, day], 10)),
            "infected_p50":  float(np.percentile(all_infected[:, day], 50)),
            "infected_p90":  float(np.percentile(all_infected[:, day], 90)),
            "deaths_p10":    float(np.percentile(all_deaths[:, day], 10)),
            "deaths_p50":    float(np.percentile(all_deaths[:, day], 50)),
            "deaths_p90":    float(np.percentile(all_deaths[:, day], 90)),
            "trajectory_sample":
                all_infected[:, day].tolist(),
            "new_infections_trajectory_sample":
                all_new_infections[:, day].tolist(),
        })
        for ci, city in enumerate(names):
            city_rows.append({
                "scenario_id":              scenario_id,
                "pathogen_profile_version": profile["version"],
                "intervention_type":        label,
                "city":                     city,
                "day":                      day + 1,
                "active_cases_p10": float(np.percentile(all_city_active[:, day, ci], 10)),
                "active_cases_p50": float(np.percentile(all_city_active[:, day, ci], 50)),
                "active_cases_p90": float(np.percentile(all_city_active[:, day, ci], 90)),
            })

    register_intervention_type(label)
    print(f"  [done] intervention_type '{label}' registered in lookup table")

    write_seird_results(seird_rows)
    print(f"  [done] seird_results written for label='{label}'")

    write_city_status(city_rows)
    print(f"  [done] city_status written for label='{label}'")

    resource_rows = calculate_resource_projections(city_rows, scenario_id, profile)
    write_resource_projections(resource_rows)
    print(f"  [done] resource_projections written for label='{label}'")

    print(f"[phased] Done. Results written as intervention_type='{label}'")


# ── Fast Deterministic ODE Preview Engine (<50ms, Zero DB Writes) ──────────
_CACHED_NAMES = None
_CACHED_MATRICES = None

def get_or_build_matrices():
    global _CACHED_NAMES, _CACHED_MATRICES
    if _CACHED_MATRICES is None:
        _CACHED_NAMES, _CACHED_MATRICES = build_composite_matrix()
    return _CACHED_NAMES, _CACHED_MATRICES


def run_deterministic_preview(
    origin_city: str = "DELHI",
    n_days: int = 180,
    seed_infections: int = 500,
    k_sensitivity: float = 35.0,
    r0: float = 2.5,
    incubation_days: float = 5.0,
    infectious_days: float = 7.0,
    cfr: float = 0.02,
    modal_shares: dict = None,
    edge_cuts: list = None,
    edge_capacities: dict = None,
    quarantined_cities: list = None,
    intervention: str = "none",
    schedule: list = None,
    vaccination: dict = None,
    festivals: list = None
) -> dict:
    
    from backend.simulator.seirv_engine import build_festival_multiplier, VaccinationParams

    names, matrices = get_or_build_matrices()
    n = len(names)

    CITY_ALIASES = {
        "THRISSUR": "Kochi",
        "THIRUVANANTHAPURAM": "Kochi",
        "SURAT": "Ahmedabad"
    }
    resolved = CITY_ALIASES.get(origin_city.strip().upper(), origin_city)
    matched = next((c for c in names if c.strip().lower() == resolved.strip().lower()), "Delhi")
    origin_city_name = matched
    origin_idx = names.index(origin_city_name)

    pops = np.array([CITIES[c]["pop"] for c in names], dtype=float)
    S = pops.copy()
    E = np.zeros(n, dtype=float)
    I = np.zeros(n, dtype=float)
    R = np.zeros(n, dtype=float)
    D = np.zeros(n, dtype=float)
    V = np.zeros(n, dtype=float)
    V_pending = np.zeros(n, dtype=float)

    seed_val = float(min(seed_infections, pops[origin_idx]))
    I[origin_idx] = seed_val
    S[origin_idx] -= seed_val

    sigma = 1.0 / max(incubation_days, 0.1)
    gamma = 1.0 / max(infectious_days, 0.1)

    national_infected       = np.zeros(n_days)
    national_deaths         = np.zeros(n_days)
    national_recovered      = np.zeros(n_days)
    national_new_infections = np.zeros(n_days)
    national_vaccinated     = np.zeros(n_days)
    city_active             = np.zeros((n_days, n))
    city_deaths             = np.zeros((n_days, n))

    distinct_interventions = set()
    if schedule:
        for phase in schedule:
            p = phase.dict() if hasattr(phase, "dict") else (phase.model_dump() if hasattr(phase, "model_dump") else phase)
            distinct_interventions.add(p.get("intervention", "none"))
    else:
        distinct_interventions.add(intervention)
    distinct_interventions.add("none")

    W_cache = {
        inv: apply_intervention(
            matrices, inv,
            edge_cuts=edge_cuts,
            city_quarantines=quarantined_cities,
            modal_shares=modal_shares,
            edge_capacities=edge_capacities
        )
        for inv in distinct_interventions
    }
    local_mult_cache = {
        inv: LOCAL_TRANSMISSION_MULTIPLIER.get(inv, 1.0)
        for inv in distinct_interventions
    }

    day_intervention = ["none"] * n_days
    if schedule:
        for phase in schedule:
            p = phase.dict() if hasattr(phase, "dict") else (phase.model_dump() if hasattr(phase, "model_dump") else phase)
            f_day = max(1, p.get("from_day", 1))
            t_day = min(n_days, p.get("to_day", n_days))
            inv = p.get("intervention", "none")
            for d in range(f_day - 1, t_day):
                day_intervention[d] = inv
    else:
        day_intervention = [intervention] * n_days

    N_safe = np.maximum(pops, 1.0)

    vax_params = VaccinationParams.from_dict(vaccination)
    fest_list = festivals or []
    city_idx_map = {c: i for i, c in enumerate(names)}

    for day in range(n_days):
        inv_today = day_intervention[day]
        W = W_cache.get(inv_today, W_cache["none"])
        local_mult = local_mult_cache.get(inv_today, 1.0)

        # 1. Festival / event multiplier for today
        fmult = build_festival_multiplier(day, fest_list, city_idx_map, n)

        # 2. Inter-city import pressure via network mobility
        import_pressure = W.T @ (I / N_safe)

        # 3. Behavioral feedback & transmission rate
        prevalence = I / N_safe
        behavior_mult = np.exp(-k_sensitivity * prevalence)
        effective_mult = local_mult * behavior_mult * fmult
        beta = (r0 / max(infectious_days, 0.1)) * effective_mult
        total_I = I + import_pressure
        force_of_infection = beta * (total_I / N_safe)
        force_of_infection = np.clip(force_of_infection, 0.0, 50.0)

        # Leaky vaccine force of infection for V
        force_V = (1.0 - vax_params.efficacy) * force_of_infection if vax_params.enabled else force_of_infection

        p_infection = np.clip(1.0 - np.exp(-force_of_infection), 0.0, 1.0)
        p_infection_V = np.clip(1.0 - np.exp(-force_V), 0.0, 1.0)

        # 4. Outflows from S (Competing risk: infection vs vaccination)
        dE_from_S = S * p_infection
        dV_new = np.zeros(n)
        if vax_params.enabled and day >= vax_params.start_day:
            eligible = S + R
            total_doses = vax_params.daily_rate * pops
            dV_new = np.minimum(S, total_doses * np.where(eligible > 0, S / eligible, 0.0))

        total_S_out = dE_from_S + dV_new
        scale = np.where(total_S_out > S, S / np.maximum(total_S_out, 1e-9), 1.0)
        dE_from_S *= scale
        dV_new *= scale

        # 5. Outflows from V (Breakthrough infection vs antibody waning)
        dE_from_V = V * p_infection_V if vax_params.enabled else np.zeros(n)
        omega = (1.0 / vax_params.waning_mean_days) if (vax_params.enabled and vax_params.waning_mean_days) else 0.0
        dS_waned = omega * V
        total_V_out = dE_from_V + dS_waned
        scale_V = np.where((total_V_out > V) & (total_V_out > 0), V / np.maximum(total_V_out, 1e-9), 1.0)
        dE_from_V *= scale_V
        dS_waned *= scale_V

        # 6. V_pending onset lag
        onset_rate = 1.0 / max(vax_params.onset_days, 1)
        dV_graduated = onset_rate * V_pending
        dV_pending_in = dV_new

        # 7. Transitions: E -> I
        total_new_infections = dE_from_S + dE_from_V
        new_exposed_to_infectious = np.clip(sigma * E, 0.0, E)

        # 8. Transitions: I -> R / D with severity protection for breakthroughs
        new_removed = np.clip(gamma * I, 0.0, I)
        breakthrough_ratio = np.where(total_new_infections > 0, dE_from_V / np.maximum(total_new_infections, 1e-9), 0.0)
        effective_cfr = cfr * (1.0 - vax_params.severity_efficacy * breakthrough_ratio)
        new_deaths = new_removed * effective_cfr
        new_recovered = new_removed - new_deaths

        # 9. Update state with mass-conservation bounds
        S = np.clip(S - dE_from_S - dV_new + dS_waned, 0.0, pops)
        E = np.clip(E + total_new_infections - new_exposed_to_infectious, 0.0, pops)
        I = np.clip(I + new_exposed_to_infectious - new_removed, 0.0, pops)
        R = np.clip(R + new_recovered, 0.0, pops)
        D = np.clip(D + new_deaths, 0.0, pops)
        V = np.clip(V + dV_graduated - dE_from_V - dS_waned, 0.0, pops)
        V_pending = np.clip(V_pending + dV_pending_in - dV_graduated, 0.0, pops)

        national_infected[day]       = float(I.sum())
        national_deaths[day]         = float(D.sum())
        national_recovered[day]      = float(R.sum())
        national_new_infections[day] = float(total_new_infections.sum())
        national_vaccinated[day]     = float((V + V_pending).sum())
        city_active[day]             = I.copy()
        city_deaths[day]             = D.copy()

    peak_idx = int(np.argmax(national_infected))
    peak_day = peak_idx + 1
    peak_active = float(national_infected[peak_idx])
    total_deaths = float(national_deaths[-1])
    total_pop = float(pops.sum())

    # Extract Top 5 affected cities by peak active cases
    top_city_indices = np.argsort(city_active.max(axis=0))[::-1][:5]
    top_cities = []
    for idx in top_city_indices:
        c_name = names[idx]
        c_curve = city_active[:, idx]
        c_peak_day = int(np.argmax(c_curve)) + 1
        top_cities.append({
            "city": c_name,
            "population": int(pops[idx]),
            "peak_day": c_peak_day,
            "peak_active": int(round(float(c_curve.max()))),
            "total_deaths": int(round(float(city_deaths[-1, idx])))
        })

    return {
        "status": "success",
        "origin_city": origin_city_name,
        "n_days": n_days,
        "summary": {
            "peak_day": peak_day,
            "peak_active_cases": int(round(peak_active)),
            "total_deaths": int(round(total_deaths)),
            "attack_rate_pct": round(float((total_pop - S.sum()) / total_pop * 100), 2),
            "final_vaccinated": int(round(national_vaccinated[-1])),
            "final_coverage_pct": round(float(national_vaccinated[-1]) / max(total_pop, 1.0) * 100, 2)
        },
        "national_trajectory": {
            "days": list(range(1, n_days + 1)),
            "active": [int(round(x)) for x in national_infected],
            "deaths": [int(round(x)) for x in national_deaths],
            "recovered": [int(round(x)) for x in national_recovered],
            "new_infections": [int(round(x)) for x in national_new_infections],
            "vaccinated": [int(round(x)) for x in national_vaccinated]
        },
        "top_cities": top_cities,
        "city_curves": {
            names[idx].upper(): [int(round(val)) for val in city_active[:, idx]]
            for idx in range(n)
        }
    }

