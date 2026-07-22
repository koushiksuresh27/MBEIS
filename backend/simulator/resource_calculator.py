import math

# [G1] Fixed conversion rates per 100 active cases
ICU_RATE = 0.025
NON_ICU_RATE = 0.205
ISOLATION_RATE = 0.300
# 100 active cases = 0.322 metric tonnes per day
OXYGEN_MT_RATE = 0.00322

def calculate_resource_projections(city_status_rows, scenario_id, pathogen_profile_version):
    """
    Takes a list of city_status dictionaries (daily granularity) and aggregates
    them into weekly resource projections using [G1] severity ratios.
    
    city_status_rows format expected:
    [
      {
         "scenario_id": "...", 
         "pathogen_profile_version": 1,
         "intervention_type": "none",
         "city": "BENGALURU",
         "day": 1,
         "active_cases_p50": 1500
      }, ...
    ]
    """
    # Group by (intervention_type, city, week)
    weekly_max = {}
    
    for row in city_status_rows:
        inv = row["intervention_type"]
        city = row["city"]
        day = row["day"]
        week = (day // 7) + 1
        active = row.get("active_cases_p50", 0)
        
        key = (inv, city, week)
        if key not in weekly_max:
            weekly_max[key] = active
        else:
            # We take the peak active cases in that week to be safe for capacity planning
            weekly_max[key] = max(weekly_max[key], active)
            
    projections = []
    for (inv, city, week), peak_active in weekly_max.items():
        icu = math.ceil(peak_active * ICU_RATE)
        non_icu = math.ceil(peak_active * NON_ICU_RATE)
        isolation = math.ceil(peak_active * ISOLATION_RATE)
        oxygen_mt = peak_active * OXYGEN_MT_RATE
        
        proj = {
            "scenario_id": scenario_id,
            "pathogen_profile_version": pathogen_profile_version,
            "intervention_type": inv,
            "city": city,
            "week": week,
            "projected_icu_beds_needed": icu,
            "projected_non_icu_beds_needed": non_icu,
            "projected_isolation_beds_needed": isolation,
            "projected_oxygen_mt_per_day": round(oxygen_mt, 3)
            # capacity_ceiling_oxygen_mt_per_day is omitted to use DB default 17000
        }
        projections.append(proj)
        
    return projections
