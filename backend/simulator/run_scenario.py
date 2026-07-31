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
    args = parser.parse_args()

    CITY_ALIASES = {"THRISSUR": "Kochi", "Thrissur": "Kochi"}
    origin_city = CITY_ALIASES.get(args.origin_city, args.origin_city)

    seird_engine.run_simulation(
        scenario_id=args.scenario_id,
        origin_city=origin_city,
        intervention_types=["none", "rail_only", "partial", "full"],
        n_iterations=args.n_iterations,
        meta_edges_path=args.meta_edges_path,
        dgca_path=args.dgca_path,
        irctc_path=args.irctc_path,
    )

    print(f"All 4 intervention types written for scenario {args.scenario_id}")