import argparse
from backend.simulator import seird_engine
import argparse
import sys
print("run_scenario.py started", flush=True)  # add this
from backend.simulator import seird_engine

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--scenario_id", required=True)
    parser.add_argument("--origin_city", required=True)
    parser.add_argument("--n_iterations", type=int, default=500)
    parser.add_argument("--meta_edges_path", default="meta_mobility_edges.csv")
    args = parser.parse_args()

    seird_engine.run_simulation(
        scenario_id=args.scenario_id,
        origin_city=args.origin_city,
        intervention_types=["none", "rail_only", "partial", "full"],
        n_iterations=args.n_iterations,
        meta_edges_path=args.meta_edges_path,
    )

    print(f"All 4 intervention types written for scenario {args.scenario_id}")