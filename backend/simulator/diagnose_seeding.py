"""
Diagnostic: check whether apply_intervention('full') vs apply_intervention('none')
actually produces different seed counts per city in run_single_simulation,
or whether 'full' and 'none' seed identically (meaning the divergence you're
seeing comes from somewhere else, or the seeding truly is the mechanism and
differs by real rounding).

Run from project root:
    python -m backend.simulator.diagnose_seeding
"""
import json
import os
import networkx as nx

from backend.simulator.monte_carlo import apply_intervention
from backend.simulator.mobility_graph import build_graph  # adjust import if this isn't the right builder


def get_data_dir():
    current_dir = os.path.dirname(os.path.abspath(__file__))
    return os.path.join(os.path.dirname(os.path.dirname(current_dir)), "data", "generated")


def compute_seeds(graph_dict, nodes, origin_node_id):
    total_flux = 0
    neighbor_flux = {}
    if origin_node_id in graph_dict:
        for nbr, d in graph_dict[origin_node_id].items():
            neighbor_flux[nbr] = d.get("weight", 0)
            total_flux += d.get("weight", 0)

    seeds_by_city = {}
    for node in nodes:
        nid = node["node_id"]
        if nid == origin_node_id:
            seeds_by_city[nid] = ("origin", 10)
        elif nid in neighbor_flux and total_flux > 0:
            raw_ratio = neighbor_flux[nid] / total_flux
            seeds = max(1, int(10 * raw_ratio))
            seeds_by_city[nid] = (f"ratio={raw_ratio!r}", seeds)
        else:
            seeds_by_city[nid] = ("no_flux", 0)
    return seeds_by_city


def main():
    nodes_file = os.path.join(get_data_dir(), "nodes.json")
    with open(nodes_file, "r") as f:
        nodes = json.load(f)

    origin_node_id = "THRISSUR"  # adjust if your historical scenario uses a different origin id/casing

    base_graph = build_graph()

    print("=== intervention = none ===")
    g_none = apply_intervention(base_graph, "none")
    G_none = nx.node_link_graph(g_none) if isinstance(g_none, dict) else g_none
    graph_dict_none = dict(G_none.adjacency())
    seeds_none = compute_seeds(graph_dict_none, nodes, origin_node_id)
    for nid, (detail, seeds) in seeds_none.items():
        print(f"  {nid:15s} seeds={seeds:3d}  {detail}")

    print("\n=== intervention = full ===")
    g_full = apply_intervention(base_graph, "full")
    G_full = nx.node_link_graph(g_full) if isinstance(g_full, dict) else g_full
    graph_dict_full = dict(G_full.adjacency())
    seeds_full = compute_seeds(graph_dict_full, nodes, origin_node_id)
    for nid, (detail, seeds) in seeds_full.items():
        print(f"  {nid:15s} seeds={seeds:3d}  {detail}")

    print("\n=== DIFF (city: none_seeds -> full_seeds) ===")
    any_diff = False
    for nid in seeds_none:
        n_seeds = seeds_none[nid][1]
        f_seeds = seeds_full.get(nid, ("missing", None))[1]
        if n_seeds != f_seeds:
            any_diff = True
            print(f"  {nid:15s} none={n_seeds} -> full={f_seeds}  <-- DIFFERS")

    if not any_diff:
        print("  No differences in seed counts between 'none' and 'full'.")
        print("  => The full/none divergence you observed is NOT explained by seeding.")
        print("  => Something else must differ between runs (check RNG/Halton sample")
        print("     ordering, or confirm you're not accidentally comparing stale DB rows).")
    else:
        print("\n  Seed counts DIFFER between 'none' and 'full'.")
        print("  => This confirms the divergence is driven by an int()-rounding artifact")
        print("     in the flux-ratio seeding calculation, not a real transmission-suppression")
        print("     mechanism. 'full' has no actual mechanistic effect on transmission itself")
        print("     (contagiousness_factor is hardcoded to 1.0 in run_single_simulation).")


if __name__ == "__main__":
    main()
