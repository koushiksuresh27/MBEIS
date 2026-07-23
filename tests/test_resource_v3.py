# tests/test_resource_v3.py
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.simulator.resource_calculator import calculate_resource_projections

rows = [{
    "scenario_id": "test-scenario", 
    "pathogen_profile_version": 1,
    "intervention_type": "none",
    "city": "TEST_CITY",
    "day": 5,
    "active_cases_p50": 100000
}]

res = calculate_resource_projections(rows, "test-scenario", 1)
assert len(res) == 1
r = res[0]

# 100000 active cases
# ICU = 2500
# Non-ICU = 20500
# Oxygen = (2500*24 + 20500*10) * 0.002058 = (60000 + 205000) * 0.002058 = 265000 * 0.002058 = 545.37
assert r["projected_icu_beds_needed"] == 2500
assert r["projected_non_icu_beds_needed"] == 20500
assert r["projected_isolation_beds_needed"] == 30000
assert r["projected_oxygen_mt_per_day"] == 545.37
assert r["capacity_ceiling_oxygen_mt_per_day"] == 17000

print("PASS: Resource calculation [G1] logic works.")
