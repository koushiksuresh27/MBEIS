# tests/test_crps.py
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.simulator.crps_validator import validate_crps

# Dummy data
ensemble = [
    [10.0, 20.0, 30.0],
    [12.0, 22.0, 32.0],
    [8.0, 18.0, 28.0]
]
observed = [9.0, 21.0, 31.0]

result = validate_crps(ensemble, observed)

assert "model" in result
assert "naive_baseline" in result
assert "skill_score" in result

# Basic sanity checks
assert result["model"]["crps_mean"] >= 0
assert result["naive_baseline"]["crps_mean"] >= 0

print("PASS: CRPS validation works.")
