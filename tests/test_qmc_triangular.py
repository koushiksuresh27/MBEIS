# tests/test_qmc_triangular.py
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.simulator.monte_carlo import run_monte_carlo
from backend.simulator.mobility_graph import build_graph

if __name__ == '__main__':
    # Fake profile matching the new flat format (COVID-19 triples)
    profile = {
        "r0_low": 1.4, "r0_most_likely": 2.87, "r0_high": 5.7,
        "incubation_days_low": 2, "incubation_days_most_likely": 5.1,
        "incubation_days_high": 14,
        "cfr_low": 0.005, "cfr_most_likely": 0.023, "cfr_high": 0.072,
        "data_confidence": "high"
    }

    G = build_graph()
    res = run_monte_carlo(profile, G, "THRISSUR", n_runs=20, days=30)

    # Check structure
    assert "confidence_bands" in res
    assert "peak_infection_day" in res
    for nid, bands in res["confidence_bands"].items():
        for i in range(len(bands["P50"])):
            assert bands["P10"][i] <= bands["P50"][i] <= bands["P90"][i], \
                f"Monotonicity violated at {nid} day {i}"

    print("PASS: QMC triangular sampling works, P10 <= P50 <= P90 holds.")
