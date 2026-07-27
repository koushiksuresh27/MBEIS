import os
import sys
import inspect
import numpy as np

# Ensure backend module is in path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import backend.simulator.seird_engine as engine
from backend.simulator.seird_engine import CITIES, build_composite_matrix

def main():
    origin_city = "THRISSUR"
    pop_thrissur = CITIES[origin_city]["pop"]
    seed_val = int(0.01 * pop_thrissur)
    
    print("=" * 80)
    print(f"Thrissur Population: {pop_thrissur:,}")
    print(f"Calculated 1% Seed: {seed_val:,}")
    print(f"Mismatch: Hardcoded seed is 50000.0, which is > 1% of {origin_city}'s pop.")
    print("=" * 80)

    # Monkey patch run_mc_iteration (seed is now fixed natively)
    source = inspect.getsource(engine.run_mc_iteration)
    
    # Patch for 180 days
    source = source.replace('range(N_DAYS)', 'range(180)')
    source = source.replace('np.zeros(N_DAYS)', 'np.zeros(180)')
    source = source.replace('np.zeros((N_DAYS, n))', 'np.zeros((180, n))')
    
    # Insert day1_sum capture before loop
    source = source.replace('for day in range(180):', 'day1_sum = S.sum() + E.sum() + I.sum() + R.sum() + D.sum()\n    for day in range(180):')
    
    # Update return statement
    source = source.replace(
        'return national_infected, national_deaths, national_new_infections, city_active',
        'return national_infected, national_deaths, national_new_infections, city_active, day1_sum, S, E, I, R, D'
    )
    
    exec(source, engine.__dict__)

    # 1. Build composite matrix
    names, W_composite_base, edge_types = engine.build_composite_matrix()

    # 4. Run single iteration
    intervention = "none"
    r0 = 2.25
    incubation_days = 6.0
    cfr = 0.021
    infectious_period = 7.0
    rng = np.random.default_rng(42)

    inf, dth, new_inf, city_act, day1_sum, final_S, final_E, final_I, final_R, final_D = engine.run_mc_iteration(
        names, W_composite_base, edge_types, origin_city, intervention,
        r0, incubation_days, cfr, infectious_period, rng
    )

    # 5. Print Table with early stopping logic
    print(f"\n{'Day':<5} | {'National_Active':<17} | {'National_New':<14} | Top3_Cities (city: active_cases)")
    print("-" * 80)
    
    consecutive_drops = 0
    prior_active = 0
    actual_days_run = 180
    
    for day in range(180):
        nat_active = inf[day]
        nat_new = new_inf[day]
        
        # Track early stopping (drop from PRIOR day)
        if day > 0 and nat_active < prior_active:
            consecutive_drops += 1
        else:
            consecutive_drops = 0
            
        prior_active = nat_active
                
        # Top 3 cities
        daily_city_act = city_act[day]
        top3_idx = np.argsort(daily_city_act)[-3:][::-1]
        top3_str = ", ".join([f"{names[i].title()}: {int(daily_city_act[i])}" for i in top3_idx])
        
        print(f"{day+1:<5} | {int(nat_active):<17,} | {int(nat_new):<14,} | {top3_str}")
        
        if consecutive_drops >= 5:
            print(f"--- Stopping early: national active dropped for 5 consecutive days ---")
            actual_days_run = day + 1
            break
            
    # Calculate peak info
    peak_day_national = np.argmax(inf[:actual_days_run])
    peak_val_national = inf[peak_day_national]
    total_national_pop = sum(CITIES[c]["pop"] for c in names)
    peak_fraction = peak_val_national / total_national_pop
    
    # Mass conservation per city (Top 5 by final active cases)
    print("\n" + "=" * 80)
    print("FINAL DAY MASS CONSERVATION CHECK (Top 5 Cities)")
    print("=" * 80)
    print(f"{'City':<15} | {'S':<10} | {'E':<10} | {'I':<10} | {'R':<10} | {'D':<10} | {'Total Sum':<12} | {'Orig Pop':<12} | {'Drift'}")
    print("-" * 110)
    
    top5_idx = np.argsort(final_I)[-5:][::-1]
    
    all_mass_passed = True
    for idx in top5_idx:
        c_name = names[idx].title()
        s, e, i, r, d = final_S[idx], final_E[idx], final_I[idx], final_R[idx], final_D[idx]
        total_sum = s + e + i + r + d
        orig_pop = CITIES[names[idx]]["pop"]
        drift = total_sum - orig_pop
        
        if abs(drift) > 1.0:
            status = "FAIL"
            all_mass_passed = False
        else:
            status = "PASS"
            
        print(f"{c_name:<15} | {int(s):<10,} | {int(e):<10,} | {int(i):<10,} | {int(r):<10,} | {int(d):<10,} | {int(total_sum):<12,} | {orig_pop:<12,} | {drift:>.2f} ({status})")
        
    print(f"\nOverall Mass Conservation Test: {'PASS' if all_mass_passed else 'FAIL'}")
    
    print("\n" + "=" * 80)
    print("NATIONAL MASS CONSERVATION")
    print("=" * 80)
    final_day_sum = final_S.sum() + final_E.sum() + final_I.sum() + final_R.sum() + final_D.sum()
    print(f"Total True National Pop: {total_national_pop:,}")
    print(f"Day 1 Sum:               {day1_sum:,.2f}")
    print(f"Final Day Sum:           {final_day_sum:,.2f}")
    
    print("\n" + "=" * 80)
    print("SUMMARY STATISTICS")
    print("=" * 80)
    
    # Breach 10,000 days
    def get_breach_day(city_name, threshold=10000):
        idx = next((i for i, n in enumerate(names) if n.lower() == city_name.lower()), None)
        if idx is None:
            return "never (not found)"
        act = city_act[:, idx]
        breach_days = np.where(act >= threshold)[0]
        if len(breach_days) > 0:
            return f"Day {breach_days[0] + 1}"
        return "never"

    print(f"National Peak Day: Day {peak_day_national + 1}")
    print(f"Peak National Active Cases: {int(peak_val_national):,}")
    print(f"Fraction of National Pop: {peak_fraction * 100:.2f}%")
    print(f"Bengaluru breaches 10k active: {get_breach_day('BENGALURU')}")
    print(f"Delhi breaches 10k active: {get_breach_day('DELHI')}")
    print(f"Mumbai breaches 10k active: {get_breach_day('MUMBAI')}")
    print("=" * 80)

if __name__ == '__main__':
    main()
