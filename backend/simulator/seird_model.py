import numpy as np
import pandas as pd
from scipy.integrate import solve_ivp

def run_seird_node(population, R0, incubation_mean, clinical_duration, mortality_rate, contagiousness_factor, seed_infections=10, days=90):
    sigma = 1.0 / incubation_mean
    gamma = 1.0 / clinical_duration
    mu = mortality_rate * gamma
    
    # The prompt specified Beta = R0 * (gamma + mu). 
    # We optionally scale by contagiousness_factor for realism, but sticking to prompt formula as closely as possible.
    beta = R0 * (gamma + mu) * contagiousness_factor
    
    def seird_deriv(t, y):
        S, E, I, R, D = y
        N = S + E + I + R + D
        
        dSdt = -beta * S * I / N
        dEdt = beta * S * I / N - sigma * E
        dIdt = sigma * E - gamma * I - mu * I
        dRdt = gamma * I
        dDdt = mu * I
        
        return [dSdt, dEdt, dIdt, dRdt, dDdt]
        
    I0 = seed_infections
    E0 = seed_infections
    S0 = population - I0 - E0
    R0_state = 0
    D0 = 0
    
    y0 = [S0, E0, I0, R0_state, D0]
    t_eval = np.arange(0, days + 1)
    
    sol = solve_ivp(seird_deriv, [0, days], y0, method='RK45', t_eval=t_eval)
    
    df = pd.DataFrame({
        'day': sol.t,
        'S': sol.y[0],
        'E': sol.y[1],
        'I': sol.y[2],
        'R': sol.y[3],
        'D': sol.y[4]
    })
    
    return df
