# Outbreak Response OS — Final Plan (v3.1)

### Epidemic/Pandemic Intervention Simulator · 4-Person Team · July 2026

> \\\*\\\*This version replaces v2's system, not just its wording.\\\*\\\* v2 was a closed-loop \\\*detection\\\* system: field reports → officer confirmation → automatic pathogen matching → automatic resimulation → dashboard. That loop, and everything upstream of the pathogen profiler, is now cut. What remains from v2 — the pathogen profiler and the spread simulator — is kept, restructured around a different entry point and a different purpose.
>
> \\\*\\\*New purpose:\\\*\\\* this is now a \\\*\\\*planner-initiated intervention simulator\\\*\\\* for government decision-makers. A planner defines a scenario (a known disease, or a new/emerging one) and the system tells them: how it will likely spread, what different interventions (rail-only lockdown, partial lockdown, full lockdown, no action) would do to that spread, and what that implies for oxygen, beds, and staffing. It does not detect outbreaks from field data. It does not run automatically. A person starts it, on purpose, to ask "what happens if."
>
> \\\*\\\*Why this changed:\\\*\\\* the v2 loop was a well-engineered proof-of-concept of an idea, not a tool anyone would use — it assumed an entire field-reporting ecosystem into existence, and its two-template matched/unmatched detection was a thin classifier dressed as pathogen intelligence. This version narrows to the two components that were always the most defensible — analogical pathogen profiling and mobility-based intervention simulation — and points them at a real, recognizable planning task instead of a simulated detection pipeline.
>
> \\\*\\\*Phase 1 scope note (mid-presentation target):\\\*\\\* for the mid-presentation, hospital resource-reporting (`hospital\\\_status`, Sarvam voice/OCR intake, adaptive cadence) is \\\*\\\*cut entirely, not deferred\\\*\\\* — `resource\\\_projections` (Section 8.3) uses the static, sourced \\\[G1] ratios and capacity ceiling as fixed constants instead of joining against a live-reported facility number. This is a real, working demo target (not a plan-only walkthrough), so Section 8.3's formula is adjusted below to reflect what's actually being built for this phase. Live hospital reporting returns as a later-phase addition once Phase 1's core loop (profiler → simulator → dashboard) is solid.

\---

## 1\. System overview

Outbreak Response OS (v3) answers one question for a government planner: **"If we're facing this pathogen, what should we do, and what will it cost us?"**

A planner opens the tool and either:

* **(a)** selects a known epidemic/pandemic-causing pathogen from a reference library, or
* **(b)** describes a new or emerging pathogen (symptoms, transmission route, whatever is known) — the system profiles it by comparison against the reference library, honestly, without inventing false precision.

From there, the system simulates spread across a real mobility graph of cities, lets the planner compare intervention mechanics side by side (no action / rail-only lockdown / partial lockdown / full lockdown), and translates the projected caseload into concrete resource asks: beds, oxygen, staff, by city, by week.

**What stayed from v2, and why:**

* One shared Supabase (Postgres) database, one integration surface (Section 5).
* Versioned, never-overwritten outputs — every simulation run is tagged and retrievable, nothing silently replaces a prior scenario (Section 6).
* SEIRD + Monte Carlo simulation core, mobility graph, lockdown-ranking math (Section 8.2, from v2 §8.3).
* CRPS-vs-baseline validation discipline for the one arm that has ground truth to validate against (Section 4).
* Adaptive-cadence hospital resource reporting via Sarvam voice/doc-upload (Section 8.3, from earlier chat additions) — **deferred to a later phase; cut entirely for Phase 1's mid-presentation** (see scope note above).
* Officer/Analyst dual-view frontend pattern, renamed **Planner View / Analyst View** to match the new user (Section 9).

**What's cut, and why:**

* The Field-layer detect→confirm→auto-recalibrate loop (v2 §5.1, §5.3, §8.1's Doctor/Officer roles as system triggers). Nobody validated that field workers would use it; it also isn't needed if scenarios are planner-initiated rather than field-triggered.
* Dengue as a template (v2 §8.2) — it's not person-to-person, and this system now scopes explicitly to epidemic/pandemic-capable pathogens on a human mobility graph.
* The binary matched/unmatched two-template classifier (v2 §8.2) — replaced by a broader reference library and analogical (nearest-neighbor / weighted-similarity) estimation, Section 7.

\---

## 2\. Grounding frameworks

Retained from v2, re-scoped to the new purpose:

|WHO HEPR dimension|Status|
|-|-|
|Across geographic levels|Core — simulation spans a multi-city mobility graph; intervention comparison is inherently cross-geographic|
|Across surveillance types|Out of scope — this system doesn't do surveillance/detection at all now|
|Across sectors (One Health)|Out of scope|
|Across the emergency cycle|Planning/response only — this is a *decision-support* tool for planners choosing interventions, not a detection or field-response tool|

|IHR (2005) tier|Capacity|Maps to|
|-|-|-|
|National|Assess, plan, hold capacity|The entire system now lives here — this is a national/state-level planning tool|
|Local / Intermediate|—|Out of scope in this phase (v2's Field layer is cut)|

\---

## 3\. Team \& ownership (Phase 1 reassignment)

This is a genuine reshuffle from the v3 draft above, driven by two Phase 1 decisions: hospital resource-reporting is cut entirely for now (so that module disappears as work), and Abhinav moves onto the pathogen profiler instead of Kishore.

|Module|Owner|Notes|
|-|-|-|
|Schema, Supabase setup,|**Koushik**|Owns getting the shared database running first — every other module depends on this existing before their work is testable end-to-end|
|Spread simulator + intervention comparison|**Koushik**|Unchanged from v3 (Section 8) — SEIRD/Monte Carlo core, mobility graph, four intervention variants, `resource\\\_projections` now built against static \[G1] figures (see note below)|
|Pathogen profiler (reference library + analogical estimation)|**Abhinav**|New for Phase 1 — takes over Section 7's two-stage profiler (Stage 1 match, Stage 2 weighted analogical estimation with `derivation\\\_basis` provenance)|
|Command/Planner dashboard (Section 9) + LLM copilot (Section 10)|**Kishore + Sujay, co-owned**  |Kishore moves off profiling and onto this jointly with Sujay — scenario input, Planner/Analyst dual view, planner-copilot Edge Function|

**What's cut from ownership entirely this phase:** the hospital resource-reporting module (Section 8.3's `hospital\\\_status`, Sarvam voice/OCR, adaptive cadence) has no owner this phase because it isn't being built — see the Phase 1 scope note above. It returns as a later-phase module once the core loop is proven.

**Why this split makes sense for a working mid-presentation demo:** you (Koushik) are the one dependency everyone else needs first (schema) and the one person whose module (simulator) needs real `pathogen\\\_profiles` rows to run against — so keeping schema and simulator together under one owner avoids a handoff delay. Abhinav taking the full profiler module (rather than splitting it) means one person owns Section 7 end-to-end, including the "which reference diseases are relevant, on which axes" weighting decision that shouldn't be split across two people. Putting Kishore and Sujay together on the dashboard means the two most demo-visible pieces — the visual output and the LLM layer that narrates it — are built by people coordinating directly with each other, which matters more for a live demo than for a written plan.



\---

## 4\. Demo scenarios — two arms, reframed around planning, not detection

### 4.1 Arm one: validation (known pathogen, known history)

|Field|Value|
|-|-|
|Purpose|Prove the simulator's projections are credible by checking them against something that actually happened|
|Scenario|Planner selects "COVID-19" from the reference library, sets origin = Thrissur, Kerala, start = 2020-01-30|
|Simulation window|90 days (to 2020-04-29), 15 cities|
|Intervention comparison|Run the simulation under: (a) no intervention, (b) rail-only restriction, (c) partial (city-level) lockdown, (d) the actual historical full lockdown (Day 54 = March 24, 2020) — show all four side by side|
|Validation|CRPS of the (d) full-lockdown run vs. archived case data, reported **alongside CRPS for a naive exponential-growth baseline** — raw CRPS alone is misleading here since confirmed-case counts in this window are confounded by rapidly changing testing capacity, not just the true epidemic curve|
|Historical data|A one-time batch script loads 90 days of archived case data as the simulator's ground-truth comparison set — this is reference data for validation only, not a live reporting path (there is no live reporting path in this phase)|
|**Secondary validation signal (oxygen demand)**|The simulator's projected caseload, run through the Section 8.3 resource-conversion ratios, produces a projected national oxygen-demand curve. This can be checked, directionally, against real historical Government of India oxygen-demand data for the same period: pre-pandemic baseline demand was around 1,000 MT/day, rising to a first-wave high of 3,095 MT/day by 29 September 2020, before surging in the second wave to 5,500 MT/day (third week of April 2021), 7,100 MT/day (fourth week of April 2021), and a peak of 8,943 MT/day on 9 May 2021 \[G1]. This is a directional sanity check, not a formal CRPS validation — the real curve reflects national policy interventions and industrial reallocation the simulator doesn't model, so agreement in shape/order-of-magnitude is the bar, not point-for-point accuracy.|
|**Demo timeline / mobility-calibration reference**|A peer-reviewed account of India's first-wave timeline \[G2] documents cases going from \~100 by 15 March 2020 to over 1,071 by 30 March, under the four-phase lockdown running 24 March–31 May 2020 — useful as citable color for the time-scrubber's key days (Section 5.4). The same source reports real Google-mobility-report figures for the first lockdown phase — grocery/pharmacy mobility fell 64.2%, recreation/retail 70.51%, transit stations 65.6%, parks 46.17%, workplaces 60.03% — a real reference point for calibrating how much the `full` intervention variant (Section 8.2) should down-weight mobility-graph edges, rather than picking a down-weighting factor arbitrarily.|

This arm proves three things now, not two: the simulator is credible on case counts, the intervention-comparison mechanic produces a sensible answer on a case where we already know what happened, *and* the resource-translation layer (Section 8.3) produces oxygen-demand figures that are at least directionally consistent with what actually happened — the four-way comparison should show the real lockdown outperforming "no action" on both case count and oxygen demand, which is the sanity check that makes the tool trustworthy before a planner ever uses it on something novel. The \[G2] mobility figures also give the `full`-lockdown variant's edge-weighting a real calibration anchor instead of an arbitrary down-weighting factor.

### 4.2 Arm two: a new/emerging pathogen (profiler is exercised, not just the simulator)

|Field|Value|
|-|-|
|Purpose|Show the profiler handling something outside its reference library honestly, and show the simulator/intervention-comparison working on the profiler's output — not just on a clean pre-set template|
|Scenario|Planner enters a synthetic "emerging pathogen" — symptoms and transmission description deliberately don't cleanly match any single reference-library entry (see Section 7 for the profiling mechanism)|
|Design target|Parameters that sit between known references rather than matching one — e.g. respiratory transmission like influenza, but incubation and CFR closer to Nipah — so the profiler has to reason about *which* reference diseases are relevant on *which* axes, not just pick the nearest single match|
|Expected system behavior|Profiler identifies nearest reference diseases by similarity, produces a **range estimate with explicit provenance** ("derived from similarity to Nipah \[primary] and pandemic influenza \[secondary], not from direct epidemiological data — treat as a starting hypothesis") rather than a confident point estimate; simulator runs across that full range, not a single number; dashboard visibly labels this as a derived/interpolated profile, distinct from the confidently-known COVID profile in Arm One|
|Validation|None — there's no ground truth for a synthetic pathogen. Success is legibility: does the planner clearly see this is a reasoned estimate, not a fact?|

**Framing note, unchanged from v2:** Nipah is a real, current reference point, not a hypothetical textbook example — a confirmed Nipah outbreak occurred in West Bengal, India in January 2026, with a further case in Kerala in June 2026 (sourced parameter figures in Section 7). Worth naming factually in the team's writeup as the reason Nipah anchors part of the reference library, without leaning on it for more than it's worth. Real people were affected by these outbreaks.

\---

## 5\. Architecture

### 5.1 The flow — planner-initiated, not field-triggered

```
Planner opens tool
      │
      ▼
Selects known pathogen  OR  describes new/emerging pathogen
      │                            │
      │                            ▼
      │                   Pathogen profiler (Section 7):
      │                   compare against reference library →
      │                   matched (confident) or derived (analogical estimate)
      │                            │
      └────────────┬───────────────┘
                    ▼
       Spread simulator (Section 8):
       runs SEIRD + Monte Carlo across mobility graph,
       under multiple intervention scenarios side by side
                    │
                    ▼
       Planner/Analyst dashboard (Section 9):
       spread projections, intervention comparison,
       resource implications (beds/oxygen/staff by city/week)
                    │
                    ▼
       Planner reviews, adjusts scenario, re-runs — iterative, not a one-shot report
```

This is now a **request-response tool a planner drives**, not a background system that reacts to field data. There is no webhook chain triggered by a confirmed case report, because there is no case-report intake in this phase. The "recalibration" concept from v2 becomes "the planner asks for a new run" — simpler, and it matches how the system will actually be used (a planner iterating on scenarios, not a system reacting to live events).

### 5.2 Runtime architecture — same one-integration-surface principle, one fewer trigger path

* **Frontend** (Planner/Analyst dashboard, Section 9): talks only to Supabase — Postgrest + Realtime + Auth + Edge Functions. Unchanged principle from v2.
* **Backend compute** (Pathogen profiler, Spread simulator): Python services on Render. **Now invoked directly by a Supabase Edge Function when a planner submits or edits a scenario** — not by a Database Webhook reacting to a case-report confirmation, since that trigger no longer exists. The Edge Function calls the Python service's endpoint synchronously-from-the-frontend's-perspective (the frontend awaits a job-id, then subscribes to Realtime for completion — same non-blocking pattern as v2, different trigger source).
* **LLM layer** (Section 7's profiler LLM calls, Section 10's planner copilot): Supabase Edge Functions, same reasoning as v2 — schema-validated tool calls, service role key held as an Edge Function secret, frontend never talks to a Python service or an LLM API directly.
* Still one integration surface: frontend ↔ Supabase only. Backend services ↔ Supabase only. Nothing calls a Python service directly from the browser.

### 5.3 Scenario execution, mechanically

```
Planner submits scenario (pathogen selection or description + city/origin + date)
      → row inserted into `scenarios` table
      → Edge Function invokes Abhinav's profiler service (synchronous call, job-based)
      → profiler writes a `pathogen\\\_profiles` row tagged to this scenario\\\_id, versioned
      → Edge Function invokes Koushik's simulator service, once per intervention type requested
      → simulator writes `seird\\\_results`/`city\\\_status`/`resource\\\_projections` rows,
        each tagged with `scenario\\\_id` + `pathogen\\\_profile\\\_version` + `intervention\\\_type`
      → Realtime pushes completion to the dashboard
      → planner sees all requested intervention variants side by side
```

**Kept from v2, because the reasoning still holds:** every write is versioned and tagged (now by `scenario\\\_id` + `intervention\\\_type` instead of `event\\\_id`), nothing is overwritten, the dashboard always selects by highest version rather than assuming "latest row = latest result." Idempotency still matters — a planner might re-run the same scenario, and a duplicate run must not silently corrupt or double-count results.

**What's simpler than v2:** no `pg\\\_net` Database Webhook chain, no at-most-once delivery problem to design around, no confirmation-status trigger. The planner clicking "run" is the trigger. This removes a real chunk of v2's operational complexity (Sections 5.3, 15's webhook-specific resilience concerns) without losing anything the new purpose needs.

### 5.4 Demo pacing

Retained from v2: since Arm One's 90 days are pre-computed for the four intervention variants, the dashboard includes a time scrubber so the audience isn't sitting through 90 simulated days in real time — jump to key days (Day 1, Day 16, Day 54, Day 90) and watch the four intervention lines diverge.

\---

## 6\. Database

|Table|Notes|Change from v2|
|-|-|-|
|`scenarios`|**New.** `scenario\\\_id`, planner-entered pathogen (reference ID or free-text description), origin city, start date, `created\\\_by`, `created\\\_at`. This replaces `case\\\_reports` as the thing that mints an identifier everything else attaches to.|Replaces v2's `case\\\_reports` as the ID-minting table — but a scenario is planner-entered, not field-reported|
|`reference\\\_diseases`|**New.** The expanded library from Section 7 — one row per known epidemic/pandemic-capable disease (COVID, Nipah, H5N1/H7N9, MERS, Ebola, pandemic influenza, etc.), each with R0/incubation/CFR ranges + transmission-route metadata + literature sources.|Replaces v2's two hardcoded templates (COVID, Dengue) inline in the profiler service — now a real table, queryable, extensible without a code change|
|`pathogen\\\_profiles`|Versioned, never overwritten. `scenario\\\_id`, `profile\\\_type`: `matched` (confident, from `reference\\\_diseases`) or `derived` (analogical estimate, Section 7). `data\\\_confidence`. **Decided (Phase 1), and now matching the live schema: every numeric parameter is stored as a triple — `r0\\\_low`/`r0\\\_most\\\_likely`/`r0\\\_high`, `incubation\\\_days\\\_low`/`incubation\\\_days\\\_most\\\_likely`/`incubation\\\_days\\\_high`, `cfr\\\_low`/`cfr\\\_most\\\_likely`/`cfr\\\_high` — never a single point value.** For `matched` profiles, `low`/`high` = the reference-library's literature range, `most\\\_likely` = its central estimate. For `derived` profiles, Stage 2's weighted range becomes `low`/`high` (deliberately wider than any single contributing disease's own range) and `most\\\_likely` = the similarity-weighted average. Koushik's simulator samples all three from a triangular distribution per Monte Carlo iteration — this is what makes a `derived` profile's uncertainty show up automatically as a wider fan chart, with no extra dashboard logic. `matched\\\_reference\\\_disease\\\_id` links a `matched` profile directly back to its `reference\\\_diseases` row. For `derived` profiles: `derivation\\\_basis` (which reference diseases contributed, and their similarity weights) — this is the provenance field that makes a derived estimate legible instead of a black box.|Same table name, `match\\\_status` (`matched`/`unmatched`) replaced by `profile\\\_type` (`matched`/`derived`) since "unmatched" implied a dead-end where "derived" implies a reasoned estimate exists. **New this revision: point-value fields replaced by low/most\_likely/high triples — decided jointly for Abhinav (writes) and Koushik (reads) so derived-profile uncertainty propagates into the simulation instead of being discarded at the profiler boundary.**|
|`seird\\\_results`, `city\\\_status`|P10/P50/P90 plus individual-trajectory sample. Tagged with `scenario\\\_id`, `pathogen\\\_profile\\\_version`, **`intervention\\\_type`** (`none`/`rail\\\_only`/`partial`/`full`).|Added `intervention\\\_type` tag — v2 only ever ran one scenario at a time; v3's core feature is comparing several side by side, so this tag is what makes that queryable|
|`lockdown\\\_recommendations`|Same as v2 — betweenness/eigenvector-ranked city priority list, now generated per intervention type where relevant.|Minor: tagged with `intervention\\\_type` too|
|`resource\\\_projections`|Derived from `city\\\_status` (projected caseload) run through fixed \[G1]-sourced ratios — **Phase 1: no `hospital\\\_status` join**, capacity compared against the static \[G1] national capacity ceiling (\~17,000 MT/day oxygen) instead of a live per-facility figure. Projected beds/oxygen/staff shortfall by city, by week, by `intervention\\\_type`. This is the table that answers "what does this cost us in oxygen/beds/doctors."|New table — concrete resource-management output. Formula simplified for Phase 1 per the scope note above; live per-facility join is a later-phase upgrade|
|~~`hospital\\\_status`~~|**Cut for Phase 1** — no live hospital reporting this phase (see scope note at top of document). Beds/oxygen/staff figures use fixed \[G1] ratios and the \[G1] national capacity ceiling instead. The full design (adaptive cadence, Sarvam voice/OCR/manual-form intake) remains documented as a later-phase addition, not deleted from the plan.|Deferred, not redesigned — original design intact for a future phase|
|`user\\\_roles`|`user\\\_id`, `role` (`planner`/`hospital`/`analyst`) — narrower role set than v2 since there's no doctor/officer field-reporting role anymore.|Narrowed — `hospital` and `doctor`/`officer` roles from v2 are gone except `hospital`, which is retained purely for resource reporting|

\---

## 7\. Pathogen profiler — Abhinav (Phase 1; redesigned mechanism, replaces v2 §8.2)

This is the section that changed the most. v2's profiler was a binary classifier against two hardcoded templates. v3's profiler does **analogical reasoning against an expanded reference library** — the way an epidemiologist actually reasons about a genuinely new pathogen in its first weeks: by comparison to known relatives, transparently, never by invented precision.

### 7.1 Reference library (`reference\\\_diseases`)

A small set (5–10 entries) of real epidemic/pandemic-capable, person-to-person-transmissible pathogens, each with literature-sourced ranges — not point values, since real figures vary by study and setting:

|Disease|R0 range|Incubation|CFR range|Transmission route|
|-|-|-|-|-|
|COVID-19 (India-calibrated)|\~1.5–3.0|\~2–14 days (median 5–6)|\~1–7%, highly time-varying — see v2's sourced figures|Respiratory/airborne|
|Nipah virus|<1 (nosocomial/close-contact spread, not sustained community transmission)|3–14 days, rare reports to 45|40–75% (WHO)|Close/nosocomial contact, some respiratory|
|H5N1 / H7N9 avian influenza|Historically low community R0, high severity|2–5 days, up to \~7–9|\~49–50% globally (H5N1), country-level figures reported as high as \~84%|Primarily zoonotic, limited human-to-human historically|
|MERS-CoV|<1 typically, higher in nosocomial clusters|\~5–7 days, up to 14|\~34%|Respiratory, strong nosocomial component|
|Pandemic influenza (1918/2009-style reference)|\~1.4–2.8 depending on strain/era|\~1–4 days|Highly variable by strain (0.1%–2%+)|Respiratory/airborne|
|Ebola virus disease|\~1.5–2.5 in unmitigated outbreaks|2–21 days|25–90% depending on strain/care access|Direct contact with bodily fluids|

*(Exact figures need the same literature-sourcing pass v2 already did for COVID/Nipah/H5N1 — Section 8.2 of v2 has usable sourced figures for three of these already; MERS/Ebola/pandemic-flu figures need the same treatment before being hardcoded. Ranges above are directional placeholders for planning purposes, not final values.)*

Each entry stores transmission-route metadata (respiratory / close-contact / nosocomial / vector-borne / bodily-fluid) as a structured field, not free text — this is what makes similarity-scoring meaningful rather than superficial (Section 7.3).

### 7.2 Two-stage LLM pipeline — extraction is LLM work, estimation is constrained, not invented

**Stage 1 — Structuring and comparison (LLM, low-risk, pure extraction):**
Takes the planner's input (a known disease selection, or free-text description of a new/emerging one) and:

1. Structures it into the same schema as `reference\\\_diseases` (transmission route, any known incubation/severity information).
2. Computes a similarity score against every reference-library entry.
3. If similarity to any single entry is high → **`matched`** — use that entry's ranges directly, high confidence.
4. If no single entry is a strong match → proceed to Stage 2.

This stage is genuinely low-risk: it's information extraction and comparison against a fixed, human-curated table, not invention.

**Stage 2 — Analogical estimation (constrained, not free generation):**
For a `derived` (no-strong-match) profile:

1. Identify the **nearest N reference diseases by similarity**, not just the single nearest one.
2. **Weight the similarity by transmission-route match first, then incubation-pattern match, then severity-pattern match** — this priority order is fixed by the team (Abhinav owns this explicitly), not left for the LLM to decide implicitly. An LLM deciding on its own that "fever" is a meaningful similarity signal (it appears in nearly everything) is exactly the failure mode to avoid.
3. Produce a **weighted range**, not a point estimate — e.g. if 70% similar to Nipah and 40% similar to pandemic influenza on the fixed weighting criteria, the resulting R0/CFR/incubation range leans toward Nipah's range but is explicitly wider than Nipah's own range alone, reflecting the added uncertainty of an imperfect match.
4. **Every derived profile carries `derivation\\\_basis`**: which reference diseases contributed, their similarity weights, and which specific features drove the weighting (e.g. "primary similarity: Nipah, driven by close-contact transmission route and high reported severity; secondary: pandemic influenza, driven by respiratory component"). This is what a planner or judge can inspect to see *why* the system produced this range — not a black-box number.

**What this pipeline explicitly does not do:** it never has an LLM freely invent an R0 or CFR value untethered to the reference library. The claim the system can honestly make is *"this estimate is derived from similarity to known diseases, shown with its reasoning, not from direct epidemiological data on this specific pathogen"* — a real, defensible claim, weaker than false precision but stronger than a pure guess.

### 7.3 What Abhinav owns explicitly (decisions, not implementation details)

* The fixed feature-priority order for similarity weighting (transmission route → incubation pattern → severity pattern), so the LLM's role is applying a defined rubric, not inventing its own notion of similarity.
* Sourcing and maintaining the reference-library ranges, with citations (same bar v2 already set for COVID/Nipah/H5N1).
* The threshold for "strong single match" vs. "no strong match, use Stage 2" — analogous to v2's minimum-case-count threshold decision, this needs a stated number the team can defend, not an implicit LLM judgment call.

\---

## 8\. Spread simulator + intervention comparison — Koushik (expanded from v2 §8.3)

Mechanically unchanged from v2 where v2 was already solid; the new work is running and presenting **multiple intervention variants of the same scenario side by side**, and translating output into resource asks.

### 8.1 Simulation core (retained from v2)

* SEIRD via `solve\\\_ivp`. Monte Carlo via `scipy.stats.qmc` + antithetic variates as the core baseline (Sobol/LHS as stretch, unchanged reasoning from v2 — antithetic variates are near-zero-risk, Sobol's power-of-2 constraint is fiddly and invisible to a demo audience).
* Weighted-edge NetworkX mobility graph, same as v2.
* Betweenness + eigenvector centrality for lockdown-priority ranking, same as v2.
* CRPS via `properscoring`, always reported against a naive-baseline comparison, unchanged from v2 — this is what Arm One's validation still relies on.

### 8.2 New: intervention mechanics as first-class, comparable scenario variants

Instead of one simulation per scenario, the simulator runs (or the planner selects to run) several **intervention variants** against the same underlying pathogen profile and mobility graph:

|Intervention type|What it changes in the model|
|-|-|
|`none`|Baseline mobility graph, unmodified — the counterfactual|
|`rail\\\_only`|Removes or heavily down-weights inter-city rail edges in the mobility graph; road/local mobility unaffected|
|`partial`|Down-weights inter-city edges above some threshold (e.g. only high-traffic city pairs restricted), leaves local intra-city mobility unaffected|
|`full`|Down-weights both inter- and intra-city mobility edges substantially — models a full lockdown|

Each variant is a separate simulation run against the **same** `pathogen\\\_profile\\\_version`, tagged by `intervention\\\_type`, so the dashboard can show all four projected curves on one chart — this side-by-side comparison is the actual new core deliverable of v3, not an afterthought.

### 8.3 Resource translation (`resource\\\_projections`) — Phase 1: static figures, no live hospital feed

For each intervention variant, project **beds/oxygen/staff shortfall by city, by week**:

```
projected\\\_active\\\_cases (from city\\\_status)
    × severity-to-hospitalization-rate (sourced, see below)
    × oxygen-flow-rate-per-case (sourced, see below)
    − fixed \\\[G1] national capacity ceiling (Phase 1; not a per-facility live figure)
    = projected shortfall, by resource type, by week, by intervention variant
```

This is what makes the tool answer "what should we do about oxygen cylinders, doctors, beds" concretely, rather than leaving resource planning as a manual inference from a caseload chart. **Phase 1 deliberately compares against a fixed national ceiling rather than a live per-city facility number** — hospital reporting is cut this phase (see scope note at top of document), so there's no `hospital\\\_status` row to join against yet. The formula's structure (multiply projected cases by sourced ratios, compare against a capacity figure) stays identical for the later phase when a live join replaces the fixed constant — this is a swap of one input, not a redesign.

**The severity-to-hospitalization-rate conversion is sourced, not a placeholder.** The Government of India's October 2021 oxygen-preparedness report (MoHFW/DPIIT/DGHS/PESO/NITI Aayog) \[G1] gives an official, expert-consensus breakdown per 100 active COVID cases:

|Category of care|Share of 100 active cases|Beds needed|Oxygen need|
|-|-|-|-|
|ICU|2.5 cases|2.5 ICU beds|All 2.5 cases need oxygen (mechanical ventilator, NIV, or free-flow)|
|Non-ICU hospital, oxygen-supported|20.5 cases|20.5 non-ICU beds|10 of these cases sized for oxygen need (covers unmet need + possible more-severe variants)|
|Isolation care (hospital-setting)|30 cases|30 isolation beds|None|
|Home isolation|47 cases|—|None|

**Oxygen flow rate per case, also sourced from \[G1]:** ICU setting = 24 litres/minute/day; non-ICU setting = 10 litres/minute/day. Composite: 100 active cases → 230.4 KL (0.322 metric tonnes) of oxygen per day. This is the exact multiplier `resource\\\_projections` should apply to `city\\\_status`'s projected active-case count to get a projected daily oxygen requirement, compared for Phase 1 against the fixed \[G1] national ceiling described below rather than a live-reported facility figure.

**This ratio is COVID-specific** (it reflects COVID-19's particular severity distribution, not a generic epidemic curve). For Arm Two's derived/novel-pathogen profile (Section 7.2), the severity distribution scales with the profile's derived CFR signal rather than reusing the COVID ratio unmodified.

**Decided formula (Koushik + Abhinav, joint ownership):**

```
COVID\_REF\_CFR = reference\_diseases.cfr\_most\_likely where disease = 'COVID-19'
severity\_ratio = clamp(profile.cfr\_most\_likely / COVID\_REF\_CFR, 0.3, 15)

icu\_share    = clamp(2.5%  × severity\_ratio,       2.5%, 50%)
nonicu\_share = clamp(20.5% × sqrt(severity\_ratio), 20.5%, 35%)

remaining = 100% − icu\_share − nonicu\_share
isolation\_hospital\_share = remaining × (30/77)   # preserves G1's original 30:47 ratio
home\_isolation\_share     = remaining × (47/77)
```

* Anchored to COVID's own `reference\_diseases` CFR (not a second hardcoded constant) so the scaling stays consistent if that sourced figure is ever refined.
* ICU share scales **linearly** with the CFR ratio — proportionally more lethal implies proportionally more ICU need.
* Non-ICU share scales **sub-linearly** (`sqrt`) — COVID's own non-ICU-oxygen bucket already spans a broad severity band, so it shouldn't grow as fast as ICU.
* Caps (50% ICU / 35% non-ICU) keep a very high-CFR derived profile (e.g. a Nipah-anchored design target, CFR ratio 15–25x) from producing an unreviewable output — output stays in a range a planner can sanity-check.
* Isolation/home-isolation split preserves \[G1]'s original 30:47 proportion on whatever share remains, rather than inventing a new ratio.
* At `severity\_ratio = 1` (a `matched` COVID scenario) this collapses exactly back to \[G1]'s original 2.5/20.5/30/47 split — Arm One's validation numbers are unaffected.
* **Oxygen flow rate per patient (24 L/min ICU, 10 L/min non-ICU) is not scaled** — it's a clinical-care constant, not a function of infection/fatality rate. Only the *share of cases* falling into each bucket scales with severity.
* **UI requirement:** wherever a `derived` profile's resource projection is shown, label it — e.g. "ICU/oxygen split scaled from COVID baseline by relative severity, not independently sourced" — consistent with the caveat already required in Section 13.



**National capacity ceiling, also from \[G1]** — for Phase 1 this is the fixed comparison figure `resource\\\_projections` uses in place of a live per-facility number (not merely a fallback default for missing data): total production capacity across LMO plants, Air Separation Units, PSA plants, direct steel-plant supply, and oxygen concentrators was estimated at 14,727 MT/day, plus an emergency buffer of about 3,000 MT/day sustainable for roughly 16 days from stored stockpiles — a combined ceiling of around 17,000 MT/day at the time of the report. When live hospital reporting returns in a later phase, this national figure is superseded by real per-city `hospital\\\_status` data, and this constant becomes the fallback default it was originally designed to be.

### 8.4 What's simpler than v2 here

No Database Webhook trigger, no idempotent-recalibration-on-confirmed-case design — the simulator runs on request, once per intervention variant the planner asks for. Idempotency still matters (a re-run of the same scenario+intervention combination shouldn't silently double-write), but the at-most-once-webhook-delivery problem from v2 §5.3 doesn't exist in this design at all.

\---

## 9\. Planner / Analyst dashboard — Kishore + Sujay (Phase 1; expanded from v2 §8.4)

### 9.1 Scenario input (new — this used to implicitly come from the Field layer)

* Planner selects a known pathogen from `reference\\\_diseases`, **or** describes a new/emerging one (structured prompts: symptoms, suspected transmission route, any known cases) — this free-text path is what triggers Abhinav's Stage 2 profiler.
* Sets origin city and start date.
* Selects which intervention variants to run (default: all four, for comparison).

### 9.2 Two view modes — same principle as discussed, renamed for the new user

* **Planner View (default):** plain-language framing, one status sentence per city per intervention ("Under a rail-only lockdown, Kochi's hospitals may hit capacity around week 6; under a full lockdown, around week 11"), one-tap comparison toggle between intervention variants, resource-shortfall summary by city. Every claim paired with a number, never bare qualitative language — retained from v2's Officer-view principle, same reasoning.
* **Analyst View:** the full v2 §8.4 design, unchanged — fan chart + individual-trajectory/spaghetti view toggle, log-scale option, real bed-capacity line drawn on every relevant chart, numeric confidence intervals, bubble-map choropleth, CRPS-vs-baseline validation display, `derivation\\\_basis` inspector for derived pathogen profiles (Section 7.2's provenance data surfaces here).
* Both views share one `useScenarioData(scenario\\\_id)` hook and one Supabase subscription — no duplicated queries, consistent with the original toggle design from this chat.

### 9.3 Retained from v2, mechanically unchanged

* Real bed-capacity threshold as an explicit line on every relevant chart.
* Four confidence/profile states, relabeled: matched-high / matched-medium / matched-low / **derived** (replaces v2's UNMATCHED — same visual distinctness principle, different label since "derived" now has a real estimate behind it, not a dead-end).
* Red reserved for capacity breaches only; profile-confidence gets a separate, non-competing badge.
* Bubble-map choropleth (city lat/long, circle size/color by intensity), not full GeoJSON polygons.
* Demo-mode time scrubber (Section 5.4).

### 9.4 Cut from v2

* Directive composer as a push-to-field-officers tool (v2 §8.4) — there's no field officer role to receive directives in this phase. If a planning-summary export is wanted (e.g. "generate a briefing document for this scenario"), that's a smaller, different feature — worth a separate decision, not assumed back in by default.

\---

## 10\. LLM layer

Two roles, both Supabase Edge Functions, same schema-validated tool-calling discipline as v2:

* **Pathogen profiler LLM calls (Section 7):** Stage 1 extraction/comparison, Stage 2 constrained analogical weighting. Grounded against the `reference\\\_diseases` table via the service role key; never outputs a final number without the weighting/provenance structure in Section 7.2.
* **Planner copilot:** summarizes a scenario's results across intervention variants in plain language, explains why a lockdown-priority ranking came out the way it did, answers planner questions grounded in the current scenario's actual data — never free-generates epidemiological claims not traceable to `pathogen\\\_profiles`/`seird\\\_results`/`resource\\\_projections`.

Dropped from v2: the Field assistant (no field role in this phase).

\---

## 11\. Auth \& access control

Narrower than v2, matching the smaller role set (Section 6):

|Runtime|Client|Key|
|-|-|-|
|Frontend (Planner/Analyst dashboard)|`supabase-js`|anon key, subject to RLS|
|Pathogen profiler, Spread simulator (Render)|`supabase-py`|service role key (bypasses RLS)|
|LLM Edge Functions|`supabase-js` (Deno)|service role key, held as an Edge Function secret|

**As deployed (verified against the live project, migration `00003\_rls\_policies`):** RLS is enabled on every table. `planner` and `analyst` roles can both `SELECT` on `scenarios`, `pathogen\_profiles`, `reference\_diseases`, `seird\_results`, `city\_status`, `resource\_projections`, `lockdown\_recommendations`; only `planner` can `INSERT` into `scenarios`. `user\_roles` itself is self-read-only (`auth.uid() = user\_id`). There is no `hospital` role policy anywhere — correctly consistent with `hospital\_status` being cut this phase, deferred together for a later phase as originally planned. No table has frontend-facing `INSERT`/`UPDATE` policies for the backend-written tables (`pathogen\_profiles`, `seird\_results`, `city\_status`, `resource\_projections`, `lockdown\_recommendations`) — those are written exclusively via the service-role key from Render/Edge Functions, matching Section 5.2's architecture.

**Decided: RLS disabled for development (as of this revision).** The team hit the empty-`user\_roles` blocker (below) and chose to `alter table ... disable row level security` on all eight tables rather than seed roles immediately — anon key now has unrestricted read/write across every table for the duration of development. This was a deliberate speed tradeoff, not an oversight: **RLS must be re-enabled and the policies re-verified before demo day** (re-run the seed script below, then `alter table ... enable row level security` on all eight tables, then confirm each teammate's login can still read what they need). Add this to the pre-demo checklist in Section 15/16 — an untested policy re-enable right before a live demo is a real risk if left until the last minute.

**Known blocker this unblocks:** `user\_roles` currently has zero rows. Every policy defined above gates on `current\_user\_role()`, which resolves to null for anyone not present in `user\_roles` — so once RLS is re-enabled, every frontend read will return empty/denied for all four team members until the seed insert below runs.

```sql
-- Run once, after every teammate has signed in at least once (so auth.users has their row):
insert into user\_roles (user\_id, role)
select id, 'planner' from auth.users where email = 'koushik@example.com'
union all
select id, 'planner' from auth.users where email = 'kishore@example.com'
union all
select id, 'analyst' from auth.users where email = 'sujay@example.com'
union all
select id, 'analyst' from auth.users where email = 'abhinav@example.com';
```

Same Week-1-not-retrofitted discipline as v2, same explicit acknowledgment that the service-role key's blast radius is a real tradeoff, not a cost-free convenience.

\---

## 12\. Core vs. stretch

|Core|Stretch|
|-|-|
|Scenario input (known-pathogen selection + free-text new-pathogen description)|Planner-facing scenario templates/presets library beyond the demo's two arms|
|Reference disease library (5–10 entries, sourced ranges)|Expanding the library significantly beyond the demo set|
|Two-stage profiler: Stage 1 match, Stage 2 weighted analogical estimation with provenance|Bayes-factor-style rigor on the similarity-weighting step (more rigorous than the fixed feature-priority rubric)|
|SEIRD + Monte Carlo (antithetic variates core), mobility graph, lockdown ranking|Sobol-sequence QMC upgrade; radiation-model mobility upgrade|
|Four intervention variants (none/rail-only/partial/full), side-by-side comparison|Planner-defined custom intervention mechanics beyond the four presets|
|Resource-projection translation (beds/oxygen/staff shortfall by city/week)|Live "what-if" resimulation with instant redraw on parameter tweak (Gabriel Goh calculator UX reference, from v2 §8.3/8.4)|
|Adaptive-cadence hospital reporting, 3 input methods via Sarvam (form/OCR/voice)|SMS/WhatsApp reporting reminders|
|CRPS validation with baseline comparison (Arm One)|—|
|Planner/Analyst dual view, capacity overlay, numeric-paired confidence/derivation labels, bubble-map choropleth|Log-scale toggle on the fan chart; planning-summary export/briefing-doc generation|
|Auth/RBAC via `user\\\_roles` + RLS (narrower role set than v2)|—|
|~~Field-layer detection loop~~ — cut entirely this phase|~~Directive composer~~ — cut, no field role to receive directives|

\---

## 13\. Known limitations — stated on purpose

* **This is a planning/simulation tool, not a detection system.** It does not identify that an outbreak is happening — a planner must already know or suspect one, and initiates the scenario themselves. This is a deliberate scope choice, not an oversight: v2's detection loop assumed a field-reporting ecosystem that was never validated with real users, and this phase focuses on the two components (profiling, simulation) that stand on their own merit.
* **The reference library is small and its ranges are literature-derived, not fitted to India-specific data** for most entries except COVID (Section 7.1) — MERS/Ebola/pandemic-flu figures need the same sourcing rigor before being presented as final.
* **The analogical estimation in Stage 2 (Section 7.2) is a reasoned interpolation, not a validated predictive method.** It mirrors how an epidemiologist reasons about a new pathogen in its first weeks, but it has no ground truth to be checked against — Arm Two's success criterion is legibility of reasoning, not statistical accuracy, and the plan should never claim otherwise in the writeup or pitch.
* **The severity-to-hospitalization-rate and oxygen-flow-rate conversions (Section 8.3) are now sourced from an official Government of India report \[G1]** — this closes what was previously an unstated-assumption gap. The caveat that remains: those ratios are COVID-specific; for a derived/novel-pathogen profile (Arm Two), Section 8.3 now applies a decided CFR-ratio scaling formula (linear ICU scaling, sub-linear non-ICU scaling, capped, on a COVID-relative basis) rather than reusing the COVID split unmodified — this is a stated, documented scaling assumption, not an independently validated one, and the dashboard must present it in the writeup as "adapted from a sourced COVID baseline," not as an equally well-grounded figure for a pathogen with no real-world resource-utilization data.
* **No genomic/wastewater surveillance, no cross-sector data** — unchanged from v2, still out of scope.
* **Hospital resource reporting is manual/OCR/voice entry, not a real HMIS/ABDM integration** — same reasoning as v2: genuine integration is a 6–12 month build even for a funded team, naming the gap is more honest than a shallow fake integration.
* **CRPS on the Arm One validation is still confounded by testing-ascertainment changes over the demo window** — mitigated by baseline comparison, not eliminated, unchanged from v2. \[G2]'s state-level case data illustrates this concretely: Maharashtra alone accounted for 174,761 of India's confirmed cases by 1 July 2020, a scale far beyond most other states — a real, sourced example of how uneven testing capacity and reporting made raw case counts a noisy signal, not just an abstract caveat.

\---

## 14\. Schema-as-code: Supabase CLI migrations

Unchanged from v2 — still the enforcement mechanism for "contracts are sacred," still necessary now that `scenarios`, `reference\\\_diseases`, and `resource\\\_projections` are new tables four people will read/write against.

```bash
supabase init
supabase link --project-ref <project-ref>

supabase migration new create\\\_scenarios\\\_and\\\_reference\\\_diseases
# ...write the SQL in the generated file under supabase/migrations/...
supabase db reset          # apply locally, verify
supabase db push           # deploy to the linked remote project
```

Commit `supabase/migrations/` to the shared repo. Same Studio-drift-reconciliation workflow as v2 (`supabase db diff` before merging any dashboard-made change).

\---

## 15\. Demo-day resilience

Simplified relative to v2, since there's no webhook chain to worry about:

* **Warm-up ping:** 5–10 minutes before the demo slot, hit the profiler and simulator Render services' health-check endpoints, and invoke the planner-copilot Edge Function once.
* **Pre-computed Arm One results:** since Arm One is a known historical scenario, its four intervention-variant results can be pre-computed and cached before the demo — the time scrubber (Section 5.4) plays through pre-existing data, removing live-computation risk from the highest-stakes validation moment.
* **Arm Two computed live** (or with a recorded fallback) — this is fine, since Arm Two's whole point is showing the reasoning process, and a short wait for a Stage 2 profiler call is a smaller risk surface than v2's full webhook chain ever was.
* **Recorded backup segment:** a 60–90 second screen recording of a full scenario run (input → profiler → simulator → dashboard with intervention comparison), ready to play if live connectivity fails.
* **RLS re-enable, done days before, not day-of:** RLS was disabled for development (Section 11). Re-enable it, re-run the `user\_roles` seed, and confirm every teammate's login still returns data — at least a few days before the demo, with time to debug if a policy turns out wrong. Re-enabling RLS for the first time hours before a live demo is its own risk surface; don't create a new one at the same time you're trying to de-risk everything else.

\---

## 16\. Integration test checklist

* \[ ] Planner selects a known pathogen → Stage 1 profiler returns a `matched` profile with correct reference-library values
* \[ ] Planner describes a novel pathogen → Stage 2 profiler returns a `derived` profile with a populated `derivation\\\_basis`, not a bare number
* \[ ] Simulator runs all four intervention variants against the same `pathogen\\\_profile\\\_version` → four distinct, correctly-tagged `seird\\\_results` rows
* \[ ] `resource\\\_projections` correctly compares projected caseload (via \[G1] ratios) against the fixed \[G1] national capacity ceiling — Phase 1 has no `hospital\\\_status` join to verify yet
* \[ ] For a COVID scenario, `resource\\\_projections`' oxygen/ICU/non-ICU figures match the \[G1]-sourced ratios (2.5% ICU, 20.5% non-ICU-oxygen per 100 active cases; 24 L/min ICU, 10 L/min non-ICU) — spot-check the arithmetic against Table 2 of \[G1] directly
* \[ ] Dashboard renders all four intervention variants on one comparison chart, correctly selecting highest version per scenario/city
* \[ ] Run Arm One end-to-end and confirm the full-lockdown variant's CRPS is reported against the naive-baseline CRPS, not alone
* \[ ] Run Arm Two end-to-end and confirm the `derived` profile's provenance is visibly inspectable in Analyst View, not just a hidden field
* \[ ] ~~Confirm hospital reporting cadence switches to daily when a scenario references that city, and back to twice-monthly otherwise~~ — deferred with `hospital\\\_status` to a later phase (see scope note)

\---

## 17\. AI-assisted development rules

Unchanged from v2:

1. Contracts (inter-module table/field ownership) are sacred — never changed by AI, always pasted into prompts, enforced via migrations (Section 14).
2. One person owns integration testing (Section 16 is their checklist).
3. Prompt discipline — exact schema, exact stack, "do not add features beyond what's described."
4. No gold-plating — no Redis, Celery, Docker, async task queues unless a real bottleneck forces it.

\---

## 18\. Sign-off (Phase 1)

|Module|Owner|Signature|Date|
|-|-|-|-|
|Schema, Supabase setup, RLS foundation|Koushik|\_\_\_\_\_\_\_\_\_\_\_\_\_\_|\_\_\_\_\_\_|
|Spread simulator + intervention comparison|Koushik|\_\_\_\_\_\_\_\_\_\_\_\_\_\_|\_\_\_\_\_\_|
|Pathogen profiler|Abhinav|\_\_\_\_\_\_\_\_\_\_\_\_\_\_|\_\_\_\_\_\_|
|Planner/Analyst dashboard + LLM copilot|Kishore + Sujay|\_\_\_\_\_\_\_\_\_\_\_\_\_\_|\_\_\_\_\_\_|



\---

## 19\. Sources

* **\[G1]** *Preparedness to meet oxygen requirements for possible future surge of COVID-19 cases: Review of progress and the way forward.* MoHFW / DPIIT / DGHS / PESO / NITI Aayog, 5 October 2021. Government of India inter-ministerial report — source of Section 8.3's severity-to-hospitalization-rate ratios, oxygen flow-rate-per-case figures, national oxygen production/storage capacity estimates, and the historical oxygen-demand curve used as Arm One's secondary validation signal (Section 4.1).
* **\[G2]** Ghosh, A., Nundy, S., \& Mallick, T. K. *How India is dealing with COVID-19 pandemic.* Sensors International, 1 (2020), 100021. Peer-reviewed paper — source of Section 4.1's first-wave lockdown timeline and the Google-mobility-report-derived percentage drops used as a calibration reference for the `full` intervention variant's mobility-graph edge weighting (Section 8.2). Used narrowly for these two figures only — the paper's broader economic/environmental/mental-health discussion is outside this system's scope, and some of its 2020-era medical content (e.g. hydroxychloroquine prophylaxis, Ayurvedic remedies) has since been superseded by later evidence and should not be cited as current guidance.

*Outbreak Response OS · Final Plan v3 · July 2026*

