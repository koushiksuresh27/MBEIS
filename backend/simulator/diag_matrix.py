"""
Diagnostic script for build_composite_matrix edge inspection.
Run with: python -m backend.simulator.diag_matrix
"""
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..'))

import numpy as np
import csv
from backend.simulator.seird_engine import (
    CITIES, STRUCTURAL_DATA, MobilityCalibrator,
    haversine_distance, build_composite_matrix
)

def run_diagnostics(label=""):
    BASE_DIR = os.path.dirname(os.path.abspath(__file__))
    meta_edges_path = os.path.join(BASE_DIR, "meta_mobility_edges.csv")
    dgca_path = os.path.join(BASE_DIR, "dgca_annual_weights.csv")

    names = list(CITIES.keys())
    n = len(names)
    name_to_idx = {name.upper(): i for i, name in enumerate(names)}

    W_raw_terr = np.zeros((n, n))
    W_aviation = np.zeros((n, n))
    distance_matrix = np.zeros((n, n))
    capacities = np.zeros((n, 1))
    edge_types = {}

    for name1 in names:
        i = name_to_idx[name1.upper()]
        data1 = STRUCTURAL_DATA.get(name1.upper())
        capacities[i, 0] = data1["cap"] if data1 else 50000
        for name2 in names:
            j = name_to_idx[name2.upper()]
            data2 = STRUCTURAL_DATA.get(name2.upper())
            if data1 and data2 and i != j:
                distance_matrix[i, j] = haversine_distance(
                    data1["lat"], data1["lon"], data2["lat"], data2["lon"]
                )

    if os.path.exists(meta_edges_path):
        with open(meta_edges_path, newline='') as f:
            for row in csv.DictReader(f):
                src, tgt = row['source_node_id'].strip().upper(), row['target_node_id'].strip().upper()
                if src in name_to_idx and tgt in name_to_idx:
                    i, j = name_to_idx[src], name_to_idx[tgt]
                    W_raw_terr[i, j] = float(row['normalized_terrestrial_weight'])
                    edge_types[tuple(sorted([i, j]))] = 'terrestrial'

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

    calibrator = MobilityCalibrator()  # uses engine class defaults (alpha=3.5, beta=0.03)
    W_terr_adjusted = calibrator.apply_distance_decay(W_raw_terr, distance_matrix)

    # --- Step 1 diagnostic: raw vs decay scalar vs adjusted terrestrial ---
    EDGES_OF_INTEREST = [
        ("KOCHI", "THRISSUR"),
        ("KOCHI", "DELHI"),
        ("KOCHI", "BENGALURU"),
        ("DELHI", "KOCHI"),
        ("BENGALURU", "KOCHI"),
    ]

    _, W_final, _ = build_composite_matrix(meta_edges_path, dgca_path)

    print(f"\n{'='*72}")
    print(f"  DIAGNOSTIC — {label}")
    print(f"{'='*72}")
    header = f"{'Edge':<26} {'Dist(km)':>9} {'Raw Terr':>10} {'Decay×':>8} {'Adj Terr':>10} {'Aviation':>10} {'Final':>12}"
    print(header)
    print("-" * 72)

    for src_name, tgt_name in EDGES_OF_INTEREST:
        i = name_to_idx.get(src_name.upper())
        j = name_to_idx.get(tgt_name.upper())
        if i is None or j is None:
            print(f"  {src_name}->{tgt_name}: NOT FOUND in name_to_idx")
            continue
        raw = W_raw_terr[i, j]
        adj = W_terr_adjusted[i, j]
        decay_x = (adj / raw) if raw > 0 else float('nan')
        avi = W_aviation[i, j]
        dist = distance_matrix[i, j]
        final = W_final[i, j]
        edge_label = f"{src_name}->{tgt_name}"
        print(f"  {edge_label:<24} {dist:>9.1f} {raw:>10.5f} {decay_x:>8.3f} {adj:>10.5f} {avi:>10.5f} {final:>12.1f}")

    print()

if __name__ == "__main__":
    run_diagnostics("CURRENT STATE")
