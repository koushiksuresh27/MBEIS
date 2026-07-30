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
    write_resource_projections
)
from backend.simulator.resource_calculator import calculate_resource_projections


N_DAYS = 180

# 15-city node data (research7.txt, CAGR-interpolated 2020 populations).
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
    'none': 1.0,
    'rail_only': 0.85,     # Transit Halt grounds flights, stops intercity buses/trains (reduces local contact density)
    'partial': 0.6,        # 40% reduction in local contacts
    'full': 0.25           # 75% reduction in local contacts (strict stay-at-home)
}

def haversine_km(lat1, lon1, lat2, lon2):
    R = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlmb = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlmb / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))

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

def haversine_distance(lat1, lon1, lat2, lon2):
    """Calculate distance in km between two lat/lon points."""
    R = 6371.0
    lat1, lon1, lat2, lon2 = map(np.radians, [lat1, lon1, lat2, lon2])
    dlat, dlon = lat2 - lat1, lon2 - lon1
    a = np.sin(dlat/2)**2 + np.cos(lat1) * np.cos(lat2) * np.sin(dlon/2)**2
    return R * 2 * np.arcsin(np.sqrt(a))

class MobilityCalibrator:
    def __init__(self, alpha=3.5, beta=0.03):
        # alpha: max boost factor for zero-distance commuter/informal travel
        # beta:  decay rate (km^-1). At beta=0.03, boost falls below 1.1× past ~80km
        #        and is negligible by ~150km.
        # NOTE: beta must stay large enough that the boost is neutral for national-hub
        # distances (>500km). The radiation-model raw weights already encode long-range
        # decay — this term exists only to capture short-range commuter/informal travel
        # NOT captured in the radiation model. Double-counting at hub distances causes
        # aviation to be structurally unable to compensate for terrestrial dominance.
        self.alpha = alpha
        self.beta = beta

    def apply_distance_decay(self, raw_matrix, distance_matrix):
        # Short-range commuter boost: S_ij = 1 + alpha * e^(-beta * d_ij)
        # Becomes negligible (<1.1x) past ~80km at beta=0.03.
        # Represents informal/commuter trips not captured in the radiation model.
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

# Approximate structural capacities (daily outbound train/bus pax) + Coordinates
STRUCTURAL_DATA = {
    "DELHI": {"lat": 28.6139, "lon": 77.2090, "cap": 450000},
    "MUMBAI": {"lat": 19.0760, "lon": 72.8777, "cap": 400000},
    "KOLKATA": {"lat": 22.5726, "lon": 88.3639, "cap": 350000},
    "BENGALURU": {"lat": 12.9716, "lon": 77.5946, "cap": 300000},
    "CHENNAI": {"lat": 13.0827, "lon": 80.2707, "cap": 250000},
    "HYDERABAD": {"lat": 17.3850, "lon": 78.4867, "cap": 200000},
    "AHMEDABAD": {"lat": 23.0225, "lon": 72.5714, "cap": 150000},
    "PUNE": {"lat": 18.5204, "lon": 73.8567, "cap": 150000},
    "LUCKNOW": {"lat": 26.8467, "lon": 80.9462, "cap": 100000},
    "JAIPUR": {"lat": 26.9124, "lon": 75.7873, "cap": 90000},
    "PATNA": {"lat": 25.5941, "lon": 85.1376, "cap": 100000},
    "KOCHI": {"lat": 9.9312, "lon": 76.2673, "cap": 80000},
    "VISAKHAPATNAM": {"lat": 17.6868, "lon": 83.2185, "cap": 70000},
    "BHOPAL": {"lat": 23.2599, "lon": 77.4126, "cap": 60000},
    "GUWAHATI": {"lat": 26.1445, "lon": 91.7362, "cap": 50000},
    "THIRUVANANTHAPURAM": {"lat": 8.5241, "lon": 76.9366, "cap": 60000},
    "THRISSUR": {"lat": 10.5276, "lon": 76.2144, "cap": 40000},
}

def build_composite_matrix(meta_edges_path=None, dgca_path=None):
    BASE_DIR = os.path.dirname(os.path.abspath(__file__))
    if meta_edges_path is None:
        meta_edges_path = os.path.join(BASE_DIR, "meta_mobility_edges.csv")
    if dgca_path is None:
        dgca_path = os.path.join(BASE_DIR, "dgca_annual_weights.csv")
        
    names = list(CITIES.keys())
    n = len(names)
    name_to_idx = {name.upper(): i for i, name in enumerate(names)}
    
    W_raw_terr = np.zeros((n, n))
    W_aviation = np.zeros((n, n))
    distance_matrix = np.zeros((n, n))
    capacities = np.zeros((n, 1))
    edge_types = {}
    
    # Build Geo-Distance Matrix & Capacity Array
    for name1 in names:
        i = name_to_idx[name1.upper()]
        data1 = STRUCTURAL_DATA.get(name1.upper())
        capacities[i, 0] = data1["cap"] if data1 else 50000
        for name2 in names:
            j = name_to_idx[name2.upper()]
            data2 = STRUCTURAL_DATA.get(name2.upper())
            if data1 and data2 and i != j:
                distance_matrix[i, j] = haversine_distance(data1["lat"], data1["lon"], data2["lat"], data2["lon"])

    # 1. Load Raw Terrestrial
    if os.path.exists(meta_edges_path):
        with open(meta_edges_path, newline='') as f:
            for row in csv.DictReader(f):
                src, tgt = row['source_node_id'].strip().upper(), row['target_node_id'].strip().upper()
                if src in name_to_idx and tgt in name_to_idx:
                    i, j = name_to_idx[src], name_to_idx[tgt]
                    W_raw_terr[i, j] = float(row['normalized_terrestrial_weight'])
                    edge_types[tuple(sorted([i, j]))] = 'terrestrial'
                    
    # 2. Load Aviation
    city_aliases = {"TRIVANDRUM": "THIRUVANANTHAPURAM", "BENGALURU": "BENGALURU"}
    if os.path.exists(dgca_path):
        with open(dgca_path, newline='') as f:
            for row in csv.DictReader(f):
                src = city_aliases.get(row['CITY1'].strip().upper(), row['CITY1'].strip().upper())
                tgt = city_aliases.get(row['CITY2'].strip().upper(), row['CITY2'].strip().upper())
                if src in name_to_idx and tgt in name_to_idx:
                    i, j = name_to_idx[src], name_to_idx[tgt]
                    W_aviation[i, j] = float(row['NORMALIZED'])
                    W_aviation[j, i] = W_aviation[i, j]
                    edge_types[tuple(sorted([i, j]))] = 'air'
                    
    # 3. Apply Calibrator Physics — use class defaults (alpha=3.5, beta=0.03)
    # DO NOT pass beta=0.005 here; that was the double-decay bug.
    calibrator = MobilityCalibrator()
    W_terr_adjusted = calibrator.apply_distance_decay(W_raw_terr, distance_matrix)
    
    # 4. Independent row-stochastic bounds for each modal layer.
    #    Rationale: np.maximum(terrestrial_adjusted, aviation) then a single bound lets
    #    the inflated short-range terrestrial term eclipse aviation on hub edges.
    #    Instead we bound each layer separately against outbound capacity first, then
    #    for air edges take elementwise max of the two bounded outputs.
    #    This keeps rows ≤ outbound capacity (row-stochastic property preserved) while
    #    guaranteeing aviation is a hard minimum on any DGCA-registered corridor.
    W_terr_final = calibrator.apply_row_stochastic_bound(W_terr_adjusted, capacities)
    W_air_final  = calibrator.apply_row_stochastic_bound(W_aviation,      capacities)
    
    # Start with terrestrial baseline, then enforce aviation floor on air corridors
    W_final = W_terr_final.copy()
    for (i, j), etype in edge_types.items():
        if etype == 'air':
            W_final[i, j] = max(W_terr_final[i, j], W_air_final[i, j])
            W_final[j, i] = max(W_terr_final[j, i], W_air_final[j, i])
    
    # Do NOT scale to 1.0. The biological engine needs the absolute traveler volume.
    return names, W_final, edge_types


def apply_intervention(W_base, edge_types, intervention_type):
    """
    Apply intervention-specific mobility down-weighting.
    
    Escalation logic — every higher intervention includes all restrictions below it:
      none:      air 100%,  terrestrial 100%
      rail_only: air 0%,    terrestrial 100%
      partial:   air 0%,    terrestrial 50%
      full:      air 0%,    terrestrial 15%
    
    A Full Quarantine always grounds all flights. Leaving 15% of air
    traffic running during a full quarantine is epidemiologically indefensible.
    """
    W = W_base.copy()
    n = W.shape[0]

    for i in range(n):
        for j in range(i + 1, n):
            is_air = edge_types.get(tuple(sorted([i, j]))) == 'air'

            if intervention_type == 'none':
                pass

            elif intervention_type == 'rail_only':
                if is_air:
                    W[i, j] = 0.0
                    W[j, i] = 0.0
                else:
                    W[i, j] *= 0.3
                    W[j, i] *= 0.3

            elif intervention_type == 'partial':
                if is_air:
                    W[i, j] = 0.0
                    W[j, i] = 0.0
                else:
                    W[i, j] *= 0.5
                    W[j, i] *= 0.5

            elif intervention_type == 'full':
                if is_air:
                    W[i, j] = 0.0
                    W[j, i] = 0.0
                else:
                    W[i, j] *= 0.15
                    W[j, i] *= 0.15

    return W
def calculate_daily_infections(S, I, imported_I, N, R0, infectious_days, rng, local_mult):
    """
    Standard Incidence calculation merging both local and imported infections.
    """
    N_safe = np.maximum(N, 1) 
    # Multiply beta by the local lockdown policy scalar
    beta = (R0 / infectious_days) * local_mult
    
    # Total infectious pressure = local spread + newly arrived infected passengers
    total_I = I + imported_I
    
    # baseline_risk was removed because 1e-7 daily compounds over 90+ days to silently
    # ignite unexposed cities. The zero-state lock is already structurally solved by 
    # the aviation floor and improved terrestrial data providing genuine import pressure.
    
    # Standard Incidence: Force of infection scaled by local density
    force_of_infection = beta * (total_I / N_safe)
    
    if force_of_infection.max() > 1.0:
        max_idx = force_of_infection.argmax()
        print(f"WARNING: force_of_infection exceeded 1.0 at index {max_idx} (val: {force_of_infection[max_idx]:.3f})")
    
    # Convert rate to a daily probability strictly bounded between [0, 1]
    p_infection = 1.0 - np.exp(-force_of_infection)
    
    # Execute the stochastic draw using the isolated PRNG stream
    S_int = S.astype(int)
    new_exposed = rng.binomial(n=S_int, p=p_infection)
    
    return new_exposed.astype(float)

def run_mc_iteration(names, base_W, edge_types, origin_city, intervention, r0, incubation_days, cfr, infectious_period, rng):
    n = len(names)
    pops = np.array([CITIES[c]["pop"] for c in names], dtype=float)
    S = pops.copy()
    E = np.zeros(n)
    I = np.zeros(n)
    R = np.zeros(n)
    D = np.zeros(n)

    if origin_city in names:
        origin_idx = names.index(origin_city)
        # S must be decremented by the seed amount to preserve mass conservation
        seed = 500
        I[origin_idx] = seed
        S[origin_idx] -= seed
    else:
        # Should never reach here after run_simulation's boundary normalization.
        # Raise instead of silently seeding the wrong city.
        raise ValueError(
            f"run_mc_iteration: origin_city '{origin_city}' not in names list. "
            f"Ensure run_simulation normalized it via strip().upper() before calling."
        )

    beta = r0 / infectious_period
    sigma = 1.0 / incubation_days
    gamma = 1.0 / infectious_period

    national_infected = np.zeros(N_DAYS)
    national_deaths = np.zeros(N_DAYS)
    national_new_infections = np.zeros(N_DAYS)
    city_active = np.zeros((N_DAYS, n))
    
    W = apply_intervention(base_W, edge_types, intervention)
    mobility_mult = LOCAL_TRANSMISSION_MULTIPLIER.get(intervention, 1.0)
    effective_beta = beta  # local transmission unaffected by travel restrictions

    for day in range(N_DAYS):
        # Fetch the local lockdown multiplier for the current policy
        local_mult = LOCAL_TRANSMISSION_MULTIPLIER.get(intervention, 1.0)
        
        # 1. Calculate incoming infected passengers using W.T (inbound flow)
        import_pressure = W.T @ (I / np.maximum(pops, 1))
        
        # 2. Pass imported passengers directly into the strictly bounded Binomial function
        total_new_infections = calculate_daily_infections(S, I, import_pressure, pops, r0, infectious_period, rng, local_mult)
        
        new_exposed_to_infectious = sigma * E
        new_removed = gamma * I
        new_deaths = new_removed * cfr
        new_recovered = new_removed * (1 - cfr)

        # Capping flows to available compartment sizes to prevent mass-conservation bugs
        total_new_infections = np.minimum(total_new_infections, S)
        new_exposed_to_infectious = np.minimum(new_exposed_to_infectious, E)
        new_removed = np.minimum(new_removed, I)

        S = S - total_new_infections
        E = E + total_new_infections - new_exposed_to_infectious
        I = I + new_exposed_to_infectious - new_removed
        R = R + new_recovered
        D = D + new_deaths

        national_infected[day] = I.sum()
        national_deaths[day] = D.sum()
        national_new_infections[day] = total_new_infections.sum()
        city_active[day] = I

    return national_infected, national_deaths, national_new_infections, city_active

def triangular(low, mode, high, size):
    return np.random.triangular(float(low), float(mode), float(high), size)

def run_simulation(
    scenario_id: str,
    origin_city: str,
    intervention_types: list[str],
    n_iterations: int = 128,
    meta_edges_path: str = "backend/simulator/meta_mobility_edges.csv",
    dgca_path: str = "dgca_annual_weights.csv"
) -> None:
    # Normalize origin_city at the boundary: case-insensitive lookup
    # so that DB values match CITIES keys.
    # This must be the single normalization point — do not add case-folding
    # anywhere else (e.g. in run_mc_iteration) so the fix stays auditable.
    names = list(CITIES.keys())
    matched = next((c for c in names if c.strip().lower() == origin_city.strip().lower()), None)
    if matched is None:
        raise ValueError(f"origin_city '{origin_city}' not found in CITIES. Available: {names}")
    origin_city = matched
    print(f"[engine] origin_city resolved to '{origin_city}'")

    profile = get_latest_pathogen_profile(scenario_id)
    
    names, W_composite_base, edge_types = build_composite_matrix(meta_edges_path=meta_edges_path, dgca_path=dgca_path)
    
    seird_rows_all = []
    city_rows_all = []
    
    # 1. Draw all random samples using Quasi-Monte Carlo (Sobol Sequence)
    # Generate a 4-dimensional low-discrepancy sequence
    m = int(np.ceil(np.log2(n_iterations)))
    sampler = qmc.Sobol(d=4, scramble=True, seed=42)
    uniform_samples = sampler.random_base2(m=m)[:n_iterations]
    
    # Inverse Transform Sampling function: maps Uniform[0,1] to Triangular bounds
    def to_triang(u, low, mode, high):
        scale = high - low
        if scale == 0:
            return np.full_like(u, low)
        c = (mode - low) / scale
        return triang.ppf(u, c=c, loc=low, scale=scale)

    r0_samples = to_triang(uniform_samples[:, 0], profile["r0_low"], profile["r0_most_likely"], profile["r0_high"])
    inc_samples = to_triang(uniform_samples[:, 1], profile["incubation_days_low"], profile["incubation_days_most_likely"], profile["incubation_days_high"])
    cfr_samples = to_triang(uniform_samples[:, 2], profile["cfr_low"], profile["cfr_most_likely"], profile["cfr_high"])
    
    if "infectious_period_most_likely" in profile:
        inf_samples = to_triang(uniform_samples[:, 3], profile["infectious_period_low"], profile["infectious_period_most_likely"], profile["infectious_period_high"])
    else:
        inf_samples = np.full(n_iterations, 7.0)

    for intervention in intervention_types:
        print(f"Running {n_iterations} MC iterations for intervention={intervention}...")
        all_infected = np.zeros((n_iterations, N_DAYS))
        all_deaths = np.zeros((n_iterations, N_DAYS))
        all_new_infections = np.zeros((n_iterations, N_DAYS))
        all_city_active = np.zeros((n_iterations, N_DAYS, len(names)))
        seed_sequence = np.random.SeedSequence(42)
        child_seeds = seed_sequence.spawn(n_iterations)

        for it in range(n_iterations):
            rng = np.random.default_rng(child_seeds[it])
            inf, dth, new_inf, city_act = run_mc_iteration(
                names, W_composite_base, edge_types, origin_city, intervention,
                r0_samples[it], inc_samples[it], cfr_samples[it], inf_samples[it],
                rng
            )
            all_infected[it] = inf
            all_deaths[it] = dth
            all_new_infections[it] = new_inf
            all_city_active[it] = city_act

        for day in range(N_DAYS):
            seird_rows_all.append({
                "scenario_id": scenario_id,
                "pathogen_profile_version": profile["version"],
                "intervention_type": intervention,
                "day": day + 1,
                "infected_p10": float(np.percentile(all_infected[:, day], 10)),
                "infected_p50": float(np.percentile(all_infected[:, day], 50)),
                "infected_p90": float(np.percentile(all_infected[:, day], 90)),
                "deaths_p10": float(np.percentile(all_deaths[:, day], 10)),
                "deaths_p50": float(np.percentile(all_deaths[:, day], 50)),
                "deaths_p90": float(np.percentile(all_deaths[:, day], 90)),
                "trajectory_sample": all_infected[:, day].tolist(),
                "new_infections_trajectory_sample": all_new_infections[:, day].tolist(),
            })
            
            for ci, city in enumerate(names):
                city_rows_all.append({
                    "scenario_id": scenario_id,
                    "pathogen_profile_version": profile["version"],
                    "intervention_type": intervention,
                    "city": city,
                    "day": day + 1,
                    "active_cases_p10": float(np.percentile(all_city_active[:, day, ci], 10)),
                    "active_cases_p50": float(np.percentile(all_city_active[:, day, ci], 50)),
                    "active_cases_p90": float(np.percentile(all_city_active[:, day, ci], 90)),
                })
                
    # Group and write results via existing io functions
    from itertools import groupby
    from operator import itemgetter
    
    sorted_seird = sorted(seird_rows_all, key=itemgetter("intervention_type"))
    for inv_type, group in groupby(sorted_seird, key=itemgetter("intervention_type")):
        write_seird_results(list(group))
        print(f"  [done] seird_results written for intervention={inv_type}")        
    sorted_city = sorted(city_rows_all, key=itemgetter("intervention_type"))
    for inv_type, group in groupby(sorted_city, key=itemgetter("intervention_type")):
        # Convert group to a list so it can be used multiple times
        city_group = list(group)
        
        # 1. Write the city status 
        write_city_status(city_group)
        print(f"  [done] city_status written for intervention={inv_type}")
        
        # 2. Wire up the resource calculator
        # (Pass the profile so the calculator can scale severity based on CFR)
        resource_rows = calculate_resource_projections(city_group, scenario_id, profile)
        
        # 3. Write the resource projections to Supabase
        write_resource_projections(resource_rows)
        print(f"  [done] resource_projections written for intervention={inv_type}")

    return {
        "seird_results": seird_rows_all,
        "city_status": city_rows_all,
    }
    



