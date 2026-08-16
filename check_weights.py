import sys
sys.path.insert(0, '.')
from backend.simulator.seird_engine import build_composite_matrix, apply_intervention
import numpy as np

names, matrices = build_composite_matrix(
    meta_edges_path='backend/simulator/meta_mobility_edges.csv',
    dgca_path='backend/simulator/dgca_annual_weights.csv',
    irctc_path='backend/simulator/irctc_mobility_edges.csv'
)

road_total = matrices['road'].sum()
rail_total = matrices['rail'].sum()
air_total  = matrices['air'].sum()
grand_total = road_total + rail_total + air_total

print('MODAL_SHARES', round(road_total/grand_total*100,1), round(rail_total/grand_total*100,1), round(air_total/grand_total*100,1))

for inv in ['none', 'rail_only', 'partial', 'full']:
    W = apply_intervention(matrices, inv)
    none_sum = apply_intervention(matrices, 'none').sum()
    print(f'INTERVENTION {inv} sum={round(W.sum())} pct_of_baseline={round(W.sum()/none_sum*100,1)}')

delhi_idx  = names.index('Delhi')
mumbai_idx = names.index('Mumbai')
for inv in ['none', 'rail_only', 'partial', 'full']:
    W = apply_intervention(matrices, inv)
    print(f'CORRIDOR_DEL_BOM {inv} {round(W[delhi_idx, mumbai_idx],1)}')

rail_only_val = apply_intervention(matrices, 'rail_only')[delhi_idx, mumbai_idx]
full_val      = apply_intervention(matrices, 'full')[delhi_idx, mumbai_idx]
print('ANOMALY_CHECK rail_only_lt_full', rail_only_val < full_val)