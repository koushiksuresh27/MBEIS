import argparse
import sys
from backend.simulator import seird_engine

print("run_scenario.py started", flush=True)

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--scenario_id",     required=True)
    parser.add_argument("--origin_city",     required=True)
    parser.add_argument("--n_iterations",    type=int, default=500)
    parser.add_argument("--meta_edges_path", default="backend/simulator/meta_mobility_edges.csv")
    parser.add_argument("--dgca_path",       default="backend/simulator/dgca_annual_weights.csv")
    parser.add_argument("--irctc_path",      default="backend/simulator/irctc_mobility_edges.csv")
    parser.add_argument("--edge_cuts",   default=None,
                        help='JSON array of per-edge modal cuts. Each entry needs src, tgt, and modes. '
                             'Cuts are directional — add two entries to cut both directions. '
                             'Example: \'[{"src":"Delhi","tgt":"Mumbai","modes":["rail","air"]}]\'')
    parser.add_argument("--seed_infections", type=int, default=500)
    parser.add_argument("--k_sensitivity",   type=float, default=35.0)
    parser.add_argument("--vaccination",      default=None,
                        help='JSON object with vaccination params')
    parser.add_argument("--festivals",        default=None,
                        help='JSON array of festival events')
    parser.add_argument("--city_quarantines", default=None,
                        help='JSON array of city names to isolate')
    args = parser.parse_args()

    import json
    edge_cuts = json.loads(args.edge_cuts) if args.edge_cuts else None
    vaccination = json.loads(args.vaccination) if args.vaccination else None
    festivals = json.loads(args.festivals) if args.festivals else None
    city_quarantines = json.loads(args.city_quarantines) if args.city_quarantines else None

    CITY_ALIASES = {
        "THRISSUR": "Kochi", "Thrissur": "Kochi",
        "THIRUVANANTHAPURAM": "Kochi", "Thiruvananthapuram": "Kochi",
        "SURAT": "Ahmedabad", "Surat": "Ahmedabad"
    }
    origin_city = CITY_ALIASES.get(args.origin_city.strip().upper(), CITY_ALIASES.get(args.origin_city, args.origin_city))

    # ── Cache check (TEMP: disabled for testing — uncomment below to re-enable) ──
    # if is_simulation_current(args.scenario_id, origin_city, args.n_iterations):
    #     print("intervention:none [cached]", flush=True)
    #     print("intervention:rail_only [cached]", flush=True)
    #     print("intervention:partial [cached]", flush=True)
    #     print("intervention:full [cached]", flush=True)
    #     print(f"[cache] All 4 interventions already computed for current profile version — skipping simulation", flush=True)
    #     print(f"All 4 intervention types written for scenario {args.scenario_id}", flush=True)
    #     sys.exit(0)

    # ── Full simulation ────────────────────────────────────────────────────

    seird_engine.run_simulation(
        scenario_id=args.scenario_id,
        origin_city=origin_city,
        intervention_types=["none", "rail_only", "partial", "full"],
        n_iterations=args.n_iterations,
        seed_infections=args.seed_infections,
        k_sensitivity=args.k_sensitivity,
        edge_cuts=edge_cuts,
        city_quarantines=city_quarantines,
        meta_edges_path=args.meta_edges_path,
        dgca_path=args.dgca_path,
        irctc_path=args.irctc_path,
        vaccination=vaccination,
        festivals=festivals,
    )

    print(f"All 4 intervention types written for scenario {args.scenario_id}", flush=True)