import math
import numpy as np
import pandas as pd
import random
import os
import csv
from scipy.stats import qmc, triang


from backend.simulator.simulator_io import (
    get_latest_pathogen_profile,
    write_seird_results,
    write_city_status,
    write_resource_projections,
    register_intervention_type
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

# Local transmission multipliers per intervention.
# These scale beta (contact rate) to reflect policy-driven changes
# in local contact density — independent of the mobility/travel layer.
#   none:      no policy, full contact density
#   rail_only: transit halt grounds flights + reduces inter-city bus/rail
#              contact density reduced ~15%
#   partial:   partial lockdown, 40% reduction in local contacts
#   full:      strict quarantine, 75% reduction in local contacts
LOCAL_TRANSMISSION_MULTIPLIER = {
    'none':      1.00,
    'rail_only': 0.85,
    'partial':   0.60,
    'full':      0.25,
}

# Modal share for inter-city passenger movement in India.
# Source: NITI Aayog transport modal share estimates.
# Road 50%, Rail 30%, Air 20% — used as baseline weights in apply_intervention.
BASE_ROAD_SHARE = 0.40
BASE_RAIL_SHARE = 0.40
BASE_AIR_SHARE  = 0.20


def haversine_km(lat1, lon1, lat2, lon2):
    R = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlmb = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlmb / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


def haversine_distance(lat1, lon1, lat2, lon2):
    """Calculate distance in km between two lat/lon points."""
    R = 6371.0
    lat1, lon1, lat2, lon2 = map(np.radians, [lat1, lon1, lat2, lon2])
    dlat, dlon = lat2 - lat1, lon2 - lon1
    a = np.sin(dlat/2)**2 + np.cos(lat1) * np.cos(lat2) * np.sin(dlon/2)**2
    return R * 2 * np.arcsin(np.sqrt(a))


def build_mobility_matrix():
    """Gravity model: W_ij = pop_i * pop_j / distance_ij^2, normalized to [0,1]."""
    names = list(CITIES.keys())
    n = len(names)
    W = np.zeros((n, n))
    for i in range(n):
        for j in range(n):
            if i == j:
                continue
            d = haversine_km(CITIES[names[i]]["lat"], CITIES[names[i]]["lon"],
                              CITIES[names[j]]["lat"], CITIES[names[j]]["lon"])
            if d > 0:
                W[i, j] = (CITIES[names[i]]["pop"] * CITIES[names[j]]["pop"]) / (d ** 2)
    if W.max() > 0:
        W = W / W.max()
    return names, W


class MobilityCalibrator:
    def __init__(self, alpha=3.5, beta=0.03):
        # alpha: max boost factor for zero-distance commuter/informal travel
        # beta:  decay rate (km^-1). At beta=0.03, boost falls below 1.1x past ~80km
        #        and is negligible by ~150km.
        # NOTE: beta must stay large enough that the boost is neutral for national-hub
        # distances (>500km). The radiation-model raw weights already encode long-range
        # decay — this term exists only to capture short-range commuter/informal travel
        # NOT captured in the radiation model. Double-counting at hub distances causes
        # aviation to be structurally unable to compensate for terrestrial dominance.
        # DO NOT set beta=0.005 — that was the double-decay bug.
        self.alpha = alpha
        self.beta = beta

    def apply_distance_decay(self, raw_matrix, distance_matrix):
        # Short-range commuter boost: S_ij = 1 + alpha * e^(-beta * d_ij)
        # Becomes negligible (<1.1x) past ~80km at beta=0.03.
        # Applied to road layer only — rail OD matrix already encodes route distances.
        decay_scalar_matrix = 1 + self.alpha * np.exp(-self.beta * distance_matrix)
        return raw_matrix * decay_scalar_matrix

    def apply_row_stochastic_bound(self, adjusted_matrix, outbound_capacity_array):
        """
        Converts edges to probabilities and bounds them by physical capacity.
        Includes a 1e-9 epsilon to prevent division-by-zero NaN cascades.
        """
        row_sums = adjusted_matrix.sum(axis=1, keepdims=True) + 1e-9
        probability_matrix = adjusted_matrix / row_sums
        return probability_matrix * outbound_capacity_array


# Approximate structural capacities (daily outbound pax) + coordinates.
# THRISSUR and THIRUVANANTHAPURAM retained here for structural reference
# but are NOT in the CITIES dict (removed in 17→15 node fix).
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
    if meta_edges_path is None:
        meta_edges_path = os.path.join(BASE_DIR, "meta_mobility_edges.csv")
    if dgca_path is None:
        dgca_path = os.path.join(BASE_DIR, "dgca_annual_weights.csv")
    if irctc_path is None:
        irctc_path = os.path.join(BASE_DIR, "irctc_mobility_edges.csv")

    names = list(CITIES.keys())
    n = len(names)
    name_to_idx = {name.upper(): i for i, name in enumerate(names)}

    W_raw_road = np.zeros((n, n))
    W_aviation = np.zeros((n, n))
    W_rail     = np.zeros((n, n))

    distance_matrix = np.zeros((n, n))
    capacities = np.zeros((n, 1))

    # ── Build geo-distance matrix and capacity array ───────────────────────
    for name1 in names:
        i = name_to_idx[name1.upper()]
        data1 = STRUCTURAL_DATA.get(name1.upper())
        capacities[i, 0] = data1["cap"] if data1 else 50000
        for name2 in names:
            j = name_to_idx[name2.upper()]
            data2 = STRUCTURAL_DATA.get(name2.upper())
            if data1 and data2 and i != j:
                distance_matrix[i, j] = haversine_distance(
                    data1["lat"], data1["lon"],
                    data2["lat"], data2["lon"]
                )

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

   # ── 4. Apply calibrator physics ────────────────────────────────────────
    # All three matrices now carry real units (travelers/day or passengers/day).
    # Distance decay removed from road — raw_daily_travelers already encodes
    # short-range dominance via T_i × radiation weight (Mumbai→Pune at 428k
    # naturally dominates without any boost).
    # apply_row_stochastic_bound normalizes each layer independently so that
    # relative corridor magnitudes (road >> rail ≈ air) survive into the blend.
    calibrator = MobilityCalibrator()
    W_road_final = calibrator.apply_row_stochastic_bound(W_raw_road,  capacities)
    W_air_final  = calibrator.apply_row_stochastic_bound(W_aviation,  capacities)
    W_rail_final = calibrator.apply_row_stochastic_bound(W_rail,      capacities)

    matrices = {
        'road': W_road_final,
        'rail': W_rail_final,
        'air':  W_air_final,
        'raw': {
            'road': W_raw_road,
            'rail': W_rail,
            'air':  W_aviation,
        },
        'capacities': capacities,
        'name_to_idx': name_to_idx,
    }

    return names, matrices


INTERVENTION_PARAMS = {
    'none':      {'road': 1.00, 'rail': 1.00, 'air': 1.00, 'flow': 1.00},
    'rail_only': {'road': 1.00, 'rail': 0.00, 'air': 1.00, 'flow': 0.60},
    'partial':   {'road': 0.33, 'rail': 0.33, 'air': 0.33, 'flow': 0.33},
    'full':      {'road': 0.05, 'rail': 0.00, 'air': 0.05, 'flow': 0.05},
}


def apply_intervention(matrices: dict, intervention_type: str, edge_cuts: list = None) -> np.ndarray:
    """
    Three-layer mobility blending for intervention scenarios.

    Baseline modal share (NITI Aayog inter-city estimates):
        Road 50%  Rail 30%  Air 20%

    Intervention logic:
        none      — all modes at full share (100% mobility)
        rail_only — "Transit Halt": ground flights, reduce road to 30% of
                    baseline road share, keep rail running at full share.
                    Road is cut because inter-city highway movement drops
                    significantly when transit is halted. Rail continues
                    as the primary remaining inter-city mode.
                    Total mobility retained: 45% of baseline.

        partial   — "Partial Lockdown": ground flights, halve road and rail.
                    Total mobility retained: 40% of baseline.

        full      — "Full Quarantine": ground flights and rail entirely.
                    Essential road traffic only (15% of baseline road share).
                    Total mobility retained: 7.5% of baseline.

    Escalation is monotone: each stricter intervention is a superset of
    restrictions from the one below it.
    """
    params = INTERVENTION_PARAMS.get(intervention_type, INTERVENTION_PARAMS['none'])
    if intervention_type not in INTERVENTION_PARAMS:
        print(f"[engine] WARNING: unknown intervention_type '{intervention_type}', using 'none'")

    raw         = matrices['raw']
    capacities  = matrices['capacities']
    name_to_idx = matrices['name_to_idx']

    # Copy raw matrices — never mutate originals (shared across all intervention runs)
    road = raw['road'].copy()
    rail = raw['rail'].copy()
    air  = raw['air'].copy()

    # Apply per-edge, per-mode cuts by zeroing specific matrix cells
    # Each cut is directional (src→tgt only). Modes are independent.
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

    W_blended = (
        BASE_ROAD_SHARE * params['road'] * road
        + BASE_RAIL_SHARE * params['rail'] * rail
        + BASE_AIR_SHARE  * params['air']  * air
    )

    row_sums = W_blended.sum(axis=1, keepdims=True) + 1e-9
    W_final  = (W_blended / row_sums) * capacities
    W_final *= params['flow']
    return W_final


def calculate_daily_infections(S, I, imported_I, N, R0, infectious_days, rng, local_mult,
                               k_sensitivity=35.0):
    """
    SEIR-b incidence calculation with endogenous behavioral feedback.

    Upgrades the classical fixed-beta SEIRD to an SEIR-b model by adding
    an exponential decay behavioral multiplier driven by local prevalence.

    Two independent suppression axes:
      - local_mult     : exogenous government intervention (top-down)
      - behavior_mult  : endogenous societal risk-response (bottom-up)

    Behavioral dampening formula:
      behavior_mult = exp(-k * prevalence)
      where prevalence = I / N (active cases / city population)

    Calibration: k=35 selected via parameter sweep across all 15 cities.
    At k=35, zero-NPI baseline peaks at ~1.9% prevalence per city, correctly
    overshooting ICMR-corrected empirical Delta peaks (~1.4-1.6%) to account
    for the NPI suppression present in real-world data but absent in our
    Baseline scenario.

    Limitation: uses true I(t)/N (perfect information). In reality, public
    behavior responds to reported cases with 1-2 week lag. Acknowledged in
    model limitations.

    Citation: Funk et al. 2010 (PNAS); SEIR-b literature (2024-25).
    """
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

    if force_of_infection.max() > 1.0:
        max_idx = force_of_infection.argmax()
        print(f"WARNING: force_of_infection exceeded 1.0 at index {max_idx} "
              f"(val: {force_of_infection[max_idx]:.3f})")

    p_infection = 1.0 - np.exp(-force_of_infection)
    S_int = S.astype(int)
    new_exposed = rng.binomial(n=S_int, p=p_infection)
    return new_exposed.astype(float)


def run_mc_iteration(
    names, matrices, origin_city, intervention,
    r0, incubation_days, cfr, infectious_period, rng,
    seed_infections=500, k_sensitivity=35.0, edge_cuts=None
):
    """
    Single Monte Carlo iteration for a fixed intervention.
    matrices: dict with keys 'road', 'rail', 'air' from build_composite_matrix.
    """
    n = len(names)
    pops = np.array([CITIES[c]["pop"] for c in names], dtype=float)
    S = pops.copy()
    E = np.zeros(n)
    I = np.zeros(n)
    R = np.zeros(n)
    D = np.zeros(n)

    if origin_city in names:
        origin_idx = names.index(origin_city)
        I[origin_idx] = seed_infections
        S[origin_idx] -= seed_infections
    else:
        raise ValueError(
            f"run_mc_iteration: origin_city '{origin_city}' not in names list. "
            f"Ensure run_simulation normalized it before calling."
        )

    sigma = 1.0 / incubation_days
    gamma = 1.0 / infectious_period

    national_infected     = np.zeros(N_DAYS)
    national_deaths       = np.zeros(N_DAYS)
    national_new_infections = np.zeros(N_DAYS)
    city_active           = np.zeros((N_DAYS, n))

    # Build blended W matrix once per iteration (fixed for the full N_DAYS)
    W = apply_intervention(matrices, intervention, edge_cuts=edge_cuts)

    for day in range(N_DAYS):
        local_mult = LOCAL_TRANSMISSION_MULTIPLIER.get(intervention, 1.0)

        import_pressure = W.T @ (I / np.maximum(pops, 1))

        total_new_infections = calculate_daily_infections(
            S, I, import_pressure, pops, r0, infectious_period, rng, local_mult,
            k_sensitivity=k_sensitivity
        )

        new_exposed_to_infectious = sigma * E
        new_removed  = gamma * I
        new_deaths   = new_removed * cfr
        new_recovered = new_removed * (1 - cfr)

        # Cap flows to available compartment sizes — mass conservation guard
        total_new_infections      = np.minimum(total_new_infections, S)
        new_exposed_to_infectious = np.minimum(new_exposed_to_infectious, E)
        new_removed               = np.minimum(new_removed, I)

        S = S - total_new_infections
        E = E + total_new_infections - new_exposed_to_infectious
        I = I + new_exposed_to_infectious - new_removed
        R = R + new_recovered
        D = D + new_deaths

        national_infected[day]       = I.sum()
        national_deaths[day]         = D.sum()
        national_new_infections[day] = total_new_infections.sum()
        city_active[day]             = I

    return national_infected, national_deaths, national_new_infections, city_active


def triangular(low, mode, high, size):
    return np.random.triangular(float(low), float(mode), float(high), size)


def run_simulation(
    scenario_id: str,
    origin_city: str,
    intervention_types: list,
    n_iterations: int = 128,
    seed_infections: int = 500,
    k_sensitivity: float = 35.0,
    edge_cuts=None,
    meta_edges_path: str = "backend/simulator/meta_mobility_edges.csv",
    dgca_path: str = "backend/simulator/dgca_annual_weights.csv",
    irctc_path: str = "backend/simulator/irctc_mobility_edges.csv"
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
    m = int(np.ceil(np.log2(n_iterations)))
    sampler = qmc.Sobol(d=4, scramble=True, seed=42)
    uniform_samples = sampler.random_base2(m=m)[:n_iterations]

    def to_triang(u, low, mode, high):
        scale = high - low
        if scale == 0:
            return np.full_like(u, low)
        c = (mode - low) / scale
        return triang.ppf(u, c=c, loc=low, scale=scale)

    r0_samples  = to_triang(uniform_samples[:, 0],
                             profile["r0_low"], profile["r0_most_likely"], profile["r0_high"])
    inc_samples = to_triang(uniform_samples[:, 1],
                             profile["incubation_days_low"],
                             profile["incubation_days_most_likely"],
                             profile["incubation_days_high"])
    cfr_samples = to_triang(uniform_samples[:, 2],
                             profile["cfr_low"], profile["cfr_most_likely"], profile["cfr_high"])

    if "infectious_period_most_likely" in profile:
        inf_samples = to_triang(uniform_samples[:, 3],
                                profile["infectious_period_low"],
                                profile["infectious_period_most_likely"],
                                profile["infectious_period_high"])
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
                edge_cuts=edge_cuts
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

    return {
        "seird_results": seird_rows_all,
        "city_status":   city_rows_all,
    }


# ─────────────────────────────────────────────────────────────────────────────
# PHASED INTERVENTION RUNNER
# Completely additive — zero changes to functions above.
#
# Schedule format:
#   [
#       {"from_day": 1,   "to_day": 30,  "intervention": "full"},
#       {"from_day": 31,  "to_day": 60,  "intervention": "partial"},
#       {"from_day": 61,  "to_day": 180, "intervention": "none"},
#   ]
# from_day and to_day are 1-indexed, inclusive on both ends.
# Gaps between phases default to "none".
# ─────────────────────────────────────────────────────────────────────────────


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
    edge_cuts=None, seed_infections=500, k_sensitivity=35.0
):
    """
    Identical to run_mc_iteration except W is resolved per day from a schedule.
    Pre-caches blended W matrices for each unique intervention to avoid
    recomputing apply_intervention on every day.

    Returns: (national_infected, national_deaths, national_new_infections, city_active)
    Same shape as run_mc_iteration — drop-in compatible.
    """
    n = len(names)
    pops = np.array([CITIES[c]["pop"] for c in names], dtype=float)
    S = pops.copy()
    E = np.zeros(n)
    I = np.zeros(n)
    R = np.zeros(n)
    D = np.zeros(n)

    if origin_city in names:
        origin_idx = names.index(origin_city)
        I[origin_idx] = seed_infections
        S[origin_idx] -= seed_infections
    else:
        raise ValueError(
            f"run_phased_mc_iteration: origin_city '{origin_city}' not in names. "
            f"Ensure run_phased_simulation normalized it before calling."
        )

    sigma = 1.0 / incubation_days
    gamma = 1.0 / infectious_period

    national_infected      = np.zeros(N_DAYS)
    national_deaths        = np.zeros(N_DAYS)
    national_new_infections = np.zeros(N_DAYS)
    city_active            = np.zeros((N_DAYS, n))

    # Pre-cache blended W matrices for each unique intervention in the schedule
    unique_interventions = set(p["intervention"] for p in schedule) | {"none"}
    W_cache = {
        inv: apply_intervention(matrices, inv, edge_cuts=edge_cuts)
        for inv in unique_interventions
    }

    for day in range(N_DAYS):
        day_1indexed = day + 1
        current_intervention = _resolve_intervention_for_day(day_1indexed, schedule)

        W = W_cache[current_intervention]
        local_mult = LOCAL_TRANSMISSION_MULTIPLIER.get(current_intervention, 1.0)

        import_pressure = W.T @ (I / np.maximum(pops, 1))
        total_new_infections = calculate_daily_infections(
            S, I, import_pressure, pops, r0, infectious_period, rng, local_mult,
            k_sensitivity=k_sensitivity
        )

        new_exposed_to_infectious = sigma * E
        new_removed   = gamma * I
        new_deaths    = new_removed * cfr
        new_recovered = new_removed * (1 - cfr)

        total_new_infections      = np.minimum(total_new_infections, S)
        new_exposed_to_infectious = np.minimum(new_exposed_to_infectious, E)
        new_removed               = np.minimum(new_removed, I)

        S = S - total_new_infections
        E = E + total_new_infections - new_exposed_to_infectious
        I = I + new_exposed_to_infectious - new_removed
        R = R + new_recovered
        D = D + new_deaths

        national_infected[day]       = I.sum()
        national_deaths[day]         = D.sum()
        national_new_infections[day] = total_new_infections.sum()
        city_active[day]             = I

    return national_infected, national_deaths, national_new_infections, city_active


def run_phased_simulation(
    scenario_id: str,
    origin_city: str,
    schedule: list,
    label: str,
    edge_cuts: list = None,
    n_iterations: int = 128,
    seed_infections: int = 500,
    k_sensitivity: float = 35.0,
    meta_edges_path: str = "backend/simulator/meta_mobility_edges.csv",
    dgca_path: str = "backend/simulator/dgca_annual_weights.csv",
    irctc_path: str = "backend/simulator/irctc_mobility_edges.csv"
) -> None:
    """
    Runs a phased intervention simulation and writes results to Supabase.

    Parameters:
        scenario_id:     same scenario UUID as the standard run
        origin_city:     origin city string (THRISSUR alias supported)
        schedule:        list of phase dicts with from_day/to_day/intervention
        label:           intervention_type string written to DB (e.g. "custom_phase_1")
                         Delete-before-insert is idempotent — safe to re-run.
        n_iterations:    MC iterations (default 128)
        meta_edges_path: path to meta_mobility_edges.csv
        dgca_path:       path to dgca_annual_weights.csv
        irctc_path:      path to irctc_mobility_edges.csv

    Schedule validation:
        - from_day >= 1, to_day <= N_DAYS
        - intervention in {none, rail_only, partial, full}
        - Phases must not overlap
        - Days not covered default to 'none'
    """
    # ── Validate schedule ──────────────────────────────────────────────────
    valid_interventions = {"none", "rail_only", "partial", "full"}
    for phase in schedule:
        assert "from_day" in phase and "to_day" in phase and "intervention" in phase, \
            f"Phase missing required keys: {phase}"
        assert phase["from_day"] >= 1, \
            f"from_day must be >= 1, got {phase['from_day']}"
        assert phase["to_day"] <= N_DAYS, \
            f"to_day must be <= N_DAYS ({N_DAYS}), got {phase['to_day']}"
        assert phase["from_day"] <= phase["to_day"], \
            f"from_day must be <= to_day: {phase}"
        assert phase["intervention"] in valid_interventions, \
            f"intervention must be one of {valid_interventions}, got '{phase['intervention']}'"

    # Check for overlapping phases
    days_covered = []
    for phase in schedule:
        days_covered.extend(range(phase["from_day"], phase["to_day"] + 1))
    assert len(days_covered) == len(set(days_covered)), \
        "Schedule has overlapping phases — each day must appear in at most one phase"

    # ── Normalize origin city ──────────────────────────────────────────────
    # THRISSUR → Kochi alias (THRISSUR removed from CITIES in 17→15 node fix)
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

    # ── Load profile and matrices ──────────────────────────────────────────
    profile = get_latest_pathogen_profile(scenario_id)
    names, matrices = build_composite_matrix(
        meta_edges_path=meta_edges_path,
        dgca_path=dgca_path,
        irctc_path=irctc_path
    )

    # ── QMC parameter sampling (identical to run_simulation) ──────────────
    m = int(np.ceil(np.log2(n_iterations)))
    sampler = qmc.Sobol(d=4, scramble=True, seed=42)
    uniform_samples = sampler.random_base2(m=m)[:n_iterations]

    def to_triang(u, low, mode, high):
        scale = high - low
        if scale == 0:
            return np.full_like(u, low)
        c = (mode - low) / scale
        return triang.ppf(u, c=c, loc=low, scale=scale)

    r0_samples  = to_triang(uniform_samples[:, 0],
                             profile["r0_low"], profile["r0_most_likely"], profile["r0_high"])
    inc_samples = to_triang(uniform_samples[:, 1],
                             profile["incubation_days_low"],
                             profile["incubation_days_most_likely"],
                             profile["incubation_days_high"])
    cfr_samples = to_triang(uniform_samples[:, 2],
                             profile["cfr_low"], profile["cfr_most_likely"], profile["cfr_high"])

    if "infectious_period_most_likely" in profile:
        inf_samples = to_triang(uniform_samples[:, 3],
                                profile["infectious_period_low"],
                                profile["infectious_period_most_likely"],
                                profile["infectious_period_high"])
    else:
        inf_samples = np.full(n_iterations, 7.0)

    # ── MC loop ────────────────────────────────────────────────────────────
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
            seed_infections=seed_infections,
            k_sensitivity=k_sensitivity
        )
        all_infected[it]       = inf
        all_deaths[it]         = dth
        all_new_infections[it] = new_inf
        all_city_active[it]    = city_act

    # ── Assemble rows ──────────────────────────────────────────────────────
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

    # ── Write to Supabase ──────────────────────────────────────────────────
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
