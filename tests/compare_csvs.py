"""
compare_csvs.py
Compares old vs new meta_mobility_edges.csv to show the effect of
baking the NH road_class_multiplier into raw_daily_travelers.

Usage:
    python compare_csvs.py --old old_meta_mobility_edges.csv --new meta_mobility_edges.csv
"""

import argparse
import pandas as pd

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--old", required=True, help="Old CSV path")
    parser.add_argument("--new", required=True, help="New CSV path")
    args = parser.parse_args()

    old = pd.read_csv(args.old)
    new = pd.read_csv(args.new)

    merged = old.merge(
        new,
        on=["source_node_id", "target_node_id"],
        suffixes=("_old", "_new")
    )

    merged["delta"]   = merged["raw_daily_travelers_new"] - merged["raw_daily_travelers_old"]
    merged["pct_chg"] = (merged["delta"] / merged["raw_daily_travelers_old"]) * 100

    print("\n── All edges: old vs new raw_daily_travelers ─────────────────────────")
    print(f"{'Source':<16} {'Target':<16} {'Old':>12} {'New':>12} {'Delta':>12} {'% Change':>10}  Multiplier")
    print("─" * 90)

    for _, row in merged.sort_values("pct_chg", ascending=False).iterrows():
        mult = row.get("road_class_multiplier_old", "?")
        print(
            f"{row['source_node_id']:<16} {row['target_node_id']:<16} "
            f"{row['raw_daily_travelers_old']:>12,.0f} "
            f"{row['raw_daily_travelers_new']:>12,.0f} "
            f"{row['delta']:>12,.0f} "
            f"{row['pct_chg']:>9.1f}%  {mult}"
        )

    print("\n── Summary ───────────────────────────────────────────────────────────")
    print(f"  Total old : {merged['raw_daily_travelers_old'].sum():>14,.0f}")
    print(f"  Total new : {merged['raw_daily_travelers_new'].sum():>14,.0f}")
    print(f"  Net delta : {merged['delta'].sum():>14,.0f}")
    print(f"  Edges unchanged (mult=1.0) : {(merged['pct_chg'].abs() < 0.01).sum()}")
    print(f"  Edges boosted   (trunk)    : {(merged['pct_chg'] > 30).sum()}  (expect ~35% for trunk)")
    print(f"  Edges boosted   (primary)  : {((merged['pct_chg'] > 10) & (merged['pct_chg'] <= 30)).sum()}  (expect ~15% for primary)")

    print("\n── Anchor check ──────────────────────────────────────────────────────")
    anchor = merged[
        (merged["source_node_id"] == "Mumbai") &
        (merged["target_node_id"] == "Pune")
    ]
    if not anchor.empty:
        print(f"  Mumbai→Pune old : {anchor['raw_daily_travelers_old'].values[0]:>12,.0f}")
        print(f"  Mumbai→Pune new : {anchor['raw_daily_travelers_new'].values[0]:>12,.0f}")
        print(f"  (should still be ~300,000 if C was recalculated correctly)")

if __name__ == "__main__":
    main()