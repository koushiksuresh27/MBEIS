import os
import glob
import json
import pandas as pd
import matplotlib.pyplot as plt
import numpy as np

def get_latest_output_dir():
    base_dir = os.path.join(os.path.dirname(__file__), "outputs")
    subdirs = [os.path.join(base_dir, d) for d in os.listdir(base_dir) if os.path.isdir(os.path.join(base_dir, d))]
    # Filter out directories like "charts" that are not event output dirs
    subdirs = [d for d in subdirs if not os.path.basename(d).startswith("charts")]
    if not subdirs:
        raise ValueError("No output directories found.")
    latest_dir = max(subdirs, key=os.path.getmtime)
    return latest_dir

def get_file_by_prefix(dir_path, prefix):
    files = glob.glob(os.path.join(dir_path, f"{prefix}*"))
    return max(files, key=os.path.getmtime) if files else None

def load_data():
    latest_dir = get_latest_output_dir()
    print(f"Reading from latest output directory: {latest_dir}")
    cb_file = get_file_by_prefix(latest_dir, "confidence_bands_")
    cs_file = get_file_by_prefix(latest_dir, "city_status_")
    lr_file = get_file_by_prefix(latest_dir, "lockdown_recommendations_")
    
    with open(cb_file, 'r') as f:
        cb = json.load(f)
    with open(cs_file, 'r') as f:
        cs = json.load(f)
        
    lr = []
    if lr_file:
        with open(lr_file, 'r') as f:
            lr = json.load(f)
            
    nodes_file = os.path.join(os.path.dirname(__file__), "data", "generated", "nodes.json")
    with open(nodes_file, 'r') as f:
        nodes = {n["node_id"]: n for n in json.load(f)}
        
    cap_file = os.path.join(os.path.dirname(__file__), "data", "generated", "hospital_capacity.json")
    with open(cap_file, 'r') as f:
        caps = {c["node_id"]: c for c in json.load(f)}
        
    return cb, cs, lr, nodes, caps

def main():
    cb, cs, lr, nodes, caps = load_data()
    
    charts_dir = os.path.join(os.path.dirname(__file__), "outputs", "charts")
    os.makedirs(charts_dir, exist_ok=True)
    
    saved_files = []
    
    # Chart 1: SEIRD curve for THRISSUR (P10/P50/P90 bands)
    plt.figure(figsize=(10, 6))
    thr = cb.get("THRISSUR")
    if thr:
        days = np.arange(len(thr["I_p50"]))
        plt.fill_between(days, thr["I_p10"], thr["I_p90"], color='red', alpha=0.2, label='Infections (P10-P90)')
        plt.plot(days, thr["I_p50"], 'r-', label='Infections (Median)')
        
        plt.fill_between(days, thr["D_p10"], thr["D_p90"], color='black', alpha=0.2, label='Deaths (P10-P90)')
        plt.plot(days, thr["D_p50"], 'k--', label='Deaths (Median)')
        
        thr_cap = caps.get("THRISSUR")
        if thr_cap:
            plt.axhline(y=thr_cap["total_beds"], color='orange', linestyle=':', label='Hospital Capacity')
            
        plt.title("SEIRD Bands: Thrissur")
        plt.xlabel("Days")
        plt.ylabel("Population Count")
        plt.legend()
        plt.grid(True, alpha=0.3)
        c1_path = os.path.join(charts_dir, "chart1_ka01_forecast.png")
        plt.savefig(c1_path)
        plt.close()
        saved_files.append(c1_path)
        
    # Chart 2: Peak infection day heatmap across all 22 nodes
    plt.figure(figsize=(12, 6))
    peak_days = []
    for nid, status in cs.items():
        peak_days.append({
            "nid": nid,
            "name": nodes[nid]["name"] if nid in nodes else nid,
            "peak_day": status["peak_day"],
            "is_ka": "KA" in nid
        })
    peak_days.sort(key=lambda x: x["peak_day"])
    
    names = [x["name"] for x in peak_days]
    days = [x["peak_day"] for x in peak_days]
    colors = ['blue' if x["is_ka"] else 'orange' for x in peak_days]
    
    plt.bar(names, days, color=colors)
    plt.xticks(rotation=45, ha="right")
    plt.title("Peak Infection Day by City")
    plt.ylabel("Peak Day")
    plt.tight_layout()
    c2_path = os.path.join(charts_dir, "chart2_peak_day.png")
    plt.savefig(c2_path)
    plt.close()
    saved_files.append(c2_path)
    
    # Chart 3: Peak I_P50 per city
    plt.figure(figsize=(12, 8))
    peak_Is = []
    for nid, bands in cb.items():
        peak_I = max(bands["P50"])
        peak_Is.append({
            "nid": nid,
            "name": nodes[nid]["name"] if nid in nodes else nid,
            "peak_I": peak_I
        })
    peak_Is.sort(key=lambda x: x["peak_I"], reverse=True)
    top_15 = peak_Is[:15]
    top_15.reverse()
    
    y_pos = np.arange(len(top_15))
    names = [x["name"] for x in top_15]
    vals = [x["peak_I"] for x in top_15]
    
    plt.barh(y_pos, vals, color='teal')
    plt.yticks(y_pos, names)
    
    thresholds = []
    for x in top_15:
        cap = caps.get(x["nid"])
        if cap:
            thresholds.append(cap["total_beds"] * cap.get("overwhelm_threshold_pct", 0.3))
        else:
            thresholds.append(0)
    plt.scatter(thresholds, y_pos, color='red', marker='|', s=200, zorder=3, label='Threshold')
    
    plt.title("Projected Peak Infectious Count (P50 median)")
    plt.xlabel("Peak Infectious Population")
    plt.legend()
    plt.tight_layout()
    c3_path = os.path.join(charts_dir, "chart3_peak_i_p50.png")
    plt.savefig(c3_path)
    plt.close()
    saved_files.append(c3_path)
    
    # Chart 4: Top 15 lockdown recommendations
    if lr:
        plt.figure(figsize=(12, 8))
        top_15_lr = lr[:15]
        top_15_lr.reverse()
        
        y_pos = np.arange(len(top_15_lr))
        labels = [f"{r['source_name']} <-> {r['target_name']} [{r['modes']}]" for r in top_15_lr]
        scores = [r["combined_score"] for r in top_15_lr]
        
        colors = []
        import matplotlib.patches as mpatches
        legend_patches = [
            mpatches.Patch(color='steelblue', label='Rail'),
            mpatches.Patch(color='coral', label='Air'),
            mpatches.Patch(color='purple', label='Both')
        ]
        
        for r in top_15_lr:
            m = r["modes"].lower()
            if "rail" in m and "air" in m:
                colors.append("purple")
            elif "rail" in m:
                colors.append("steelblue")
            elif "air" in m:
                colors.append("coral")
            else:
                colors.append("gray")
                
        plt.barh(y_pos, scores, color=colors)
        plt.yticks(y_pos, labels)
        plt.title("Lockdown Priority Score — Top 15 Travel Links")
        plt.xlabel("Combined Priority Score")
        plt.legend(handles=legend_patches)
        plt.tight_layout()
        c4_path = os.path.join(charts_dir, "chart4_lockdown_priority.png")
        plt.savefig(c4_path)
        plt.close()
        saved_files.append(c4_path)
        
    print("\nCharts successfully generated:")
    for f in saved_files:
        print("  -", f)

if __name__ == "__main__":
    main()
