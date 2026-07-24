import math

# Oxygen flow rate constants [G1]
ICU_O2_FLOW_LPM = 24        # litres per minute, per ICU patient
NON_ICU_O2_FLOW_LPM = 10    # litres per minute, per non-ICU oxygen patient
LPM_TO_MT_PER_DAY = 0.002058  # conversion factor
NATIONAL_O2_CEILING_MT = 17000  # MT/day, fixed [G1] constant[cite: 1]

# You should ideally query this, but locking it here matches the reference baseline
COVID_REF_CFR = 0.02 

def clamp(value, min_value, max_value):
    return max(min_value, min(value, max_value))

def calculate_resource_projections(city_status_rows, scenario_id, profile):
    """
    Aggregates city_status (daily) into weekly resource projections.
    Dynamically scales the [G1] COVID baselines against the profile's CFR.
    """
    
    # 1. Calculate dynamic severity shares based on the profile's CFR[cite: 1]
    cfr = profile.get("cfr_most_likely", COVID_REF_CFR)
    severity_ratio = clamp(cfr / COVID_REF_CFR, 0.3, 15)
    
    icu_share = clamp(0.025 * severity_ratio, 0.025, 0.50)
    nonicu_share = clamp(0.205 * math.sqrt(severity_ratio), 0.205, 0.35)
    
    remaining_share = 1.0 - icu_share - nonicu_share
    isolation_share = remaining_share * (30 / 77)
    
    # 2. Group by (intervention_type, city, week)
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
            weekly_max[key] = max(weekly_max[key], active)
            
    # 3. Generate Projections
    projections = []
    for (inv, city, week), peak_active in weekly_max.items():
        icu = math.ceil(peak_active * icu_share)
        non_icu = math.ceil(peak_active * nonicu_share)
        isolation = math.ceil(peak_active * isolation_share)
        
        # O2 demand = (ICU patients * 24 LPM + non-ICU patients * 10 LPM) * conversion[cite: 1]
        oxygen_mt = (icu * ICU_O2_FLOW_LPM + non_icu * NON_ICU_O2_FLOW_LPM) * LPM_TO_MT_PER_DAY
        
        proj = {
            "scenario_id": scenario_id,
            "pathogen_profile_version": profile["version"],
            "intervention_type": inv,
            "city": city,
            "week": week,
            "projected_icu_beds_needed": icu,
            "projected_non_icu_beds_needed": non_icu,
            "projected_isolation_beds_needed": isolation,
            "projected_oxygen_mt_per_day": round(oxygen_mt, 3),
            "capacity_ceiling_oxygen_mt_per_day": NATIONAL_O2_CEILING_MT
        }
        projections.append(proj)
        
    return projections