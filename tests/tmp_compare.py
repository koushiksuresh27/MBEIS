import pandas as pd
old = pd.read_csv('backend/simulator/meta_mobility_edges(no-nh).csv')
new = pd.read_csv('backend/simulator/meta_mobility_edges.csv')
merged = old.merge(new, on=['source_node_id', 'target_node_id'], suffixes=('_old', '_new'))
merged['delta'] = merged['raw_daily_travelers_new'] - merged['raw_daily_travelers_old']
merged['pct_chg'] = (merged['delta'] / merged['raw_daily_travelers_old']) * 100
print('Merged rows:', len(merged))
print('Total old:', merged['raw_daily_travelers_old'].sum())
print('Total new:', merged['raw_daily_travelers_new'].sum())
print(merged[['source_node_id','target_node_id','raw_daily_travelers_old','raw_daily_travelers_new','delta','pct_chg','road_class_multiplier_old']].sort_values('pct_chg', ascending=False).to_string(index=False))
