# MBEIS — Mobility Based Epidemic Intervention Simulator

> **A full-stack, mobility-calibrated epidemic intelligence operating system that models pathogen propagation across India's multi-modal transit networks, evaluates non-pharmaceutical & pharmaceutical interventions, and forecasts healthcare capacity exhaustion to support emergency preparedness.**

---
## Contributors

<table style="width:100%; text-align:center; border:none;">
  <tr>
    <td style="width:33.33%;">
      <img src="https://github.com/koushiksuresh27.png" width="100%" height="250" style="object-fit:cover;" alt="Koushik"/>
    </td>
    <td style="width:33.33%;">
      <img src="https://github.com/AbhinavBhardawaj.png" width="100%" height="250" style="object-fit:cover;" alt="Abhinav"/>
    </td>
    <td style="width:33.33%;">
      <img src="https://github.com/sujayks1.png" width="100%" height="250" style="object-fit:cover;" alt="Sujay"/>
    </td>
  </tr>
  <tr>
    <td><a href="https://github.com/koushiksuresh27">@koushiksuresh27</a></td>
    <td><a href="https://github.com/AbhinavBhardawaj">@AbhinavBhardawaj</a></td>
    <td><a href="https://github.com/sujayks1">@sujayks1</a></td>
  </tr>
</table>

---

> [!NOTE]
> **Academic Project — Not for Real-World Clinical Deployment**
>
> This is a **student engineering capstone project** developed as part of an academic curriculum. We are undergraduate engineering students, not professional epidemiologists or clinicians. This simulator is intended for research exploration and decision-support simulation.

---

[![CI Simulation Matrix](https://img.shields.io/badge/CI%20Simulation%20Matrix-passing-brightgreen?logo=github)](https://github.com)
[![Python](https://img.shields.io/badge/Python-3.12-3776AB?logo=python&logoColor=white)](https://python.org)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.100+-009688?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![React](https://img.shields.io/badge/React-18.x-61DAFB?logo=react&logoColor=black)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://typescriptlang.org)
[![Tailwind CSS v4](https://img.shields.io/badge/TailwindCSS-v4.0-38B2AC?logo=tailwind-css&logoColor=white)](https://tailwindcss.com)
[![Supabase](https://img.shields.io/badge/Supabase-PostgreSQL-3ECF8E?logo=supabase&logoColor=white)](https://supabase.com)
[![License](https://img.shields.io/badge/License-MIT-yellow)](LICENSE)

`Python 3.12` • `FastAPI` • `WebSockets` • `React 18` • `TypeScript` • `Vite` • `Tailwind CSS v4` • `MapLibre GL JS` • `Recharts` • `Supabase (PostgreSQL)` • `SciPy (QMC Sobol)` • `Groq SDK` • `Sarvam AI`

---

## Table of Contents

- [Problem Statement](#problem-statement)
- [System Architecture](#system-architecture)
  - [High-Level Topology](#high-level-topology)
  - [Backend Architecture & Modules](#backend-architecture--modules)
  - [Frontend Architecture & Components](#frontend-architecture--components)
- [Key Capabilities & Subsystems](#key-capabilities--subsystems)
- [The Science & Mathematical Framework](#the-science--mathematical-framework)
  - [SEIRD-b & SVEIRD Compartmental Models](#seird-b--sveird-compartmental-models)
  - [Quasi-Monte Carlo (Sobol Low-Discrepancy Sampling)](#quasi-monte-carlo-sobol-low-discrepancy-sampling)
  - [3-Layer Asymmetric Mobility Network](#3-layer-asymmetric-mobility-network)
  - [Pharmaceutical Interventions & Mass Gathering Shocks](#pharmaceutical-interventions--mass-gathering-shocks)
  - [Healthcare Capacity & Clinical Resource Math](#healthcare-capacity--clinical-resource-math)
- [The Interface Ecosystem](#the-interface-ecosystem)
  - [1. Analyst View](#1-analyst-view)
  - [2. Planner View](#2-planner-view)
  - [3. Spread Map (Spatial Transit Network)](#3-spread-map-spatial-transit-network)
  - [4. Policy Sandbox (Sub-50ms Deterministic ODE Explorer)](#4-policy-sandbox-sub-50ms-deterministic-ode-explorer)
  - [5. ERIS — AI Epidemic Intelligence Agent & Voice Copilot](#5-eris--ai-epidemic-intelligence-agent--voice-copilot)
  - [6. WHO Disease Outbreak News (DON) Live Intel](#6-who-disease-outbreak-news-don-live-intel)
- [Data Sources & Provenance](#data-sources--provenance)
- [Empirical Validation & Calibration](#empirical-validation--calibration)
- [Tech Stack](#tech-stack)
- [Getting Started](#getting-started)
- [Environment Variables](#environment-variables)
- [API Reference](#api-reference)
- [Known Limitations](#known-limitations)
- [Roadmap](#roadmap)
- [License](#license)

---

## Problem Statement

During acute infectious outbreaks, public health planners, district collectors, and emergency response task forces face an asymmetry of information:
1. **Academic epidemiological models** (SEIR / metapopulation models) take weeks to compute, run on proprietary clusters, and output static academic papers rather than operational insights.
2. **Mobility vectors** (inter-city passenger rail, domestic flights, and national highways) act as high-speed epidemic bridges that seed secondary metros before local surveillance registers a single case.
3. **Logistics bottlenecks** (ICU surge capacity and liquid medical oxygen distribution) often collapse before patient case curves peak.

MBEIS bridges this gap by combining **multi-modal transport telemetry**, **endogenous behavioral feedback**, **quasi-Monte Carlo stochastic ensembles**, **sub-50ms ODE exploration**, and an **AI intelligence copilot (ERIS)** into a single unified operating platform.

---

## System Architecture

### High-Level Topology

```
                                 [ User / Emergency Task Force ]
                                                │
                                                ▼
┌───────────────────────────────────────────────────────────────────────────────────────────────┐
│                           React 18 + TypeScript Outbreak Dashboard                            │
│  ┌──────────────────┐  ┌──────────────────┐  ┌────────────────────┐  ┌─────────────────────┐  │
│  │   Analyst View   │  │   Planner View   │  │     Spread Map     │  │   Policy Sandbox    │  │
│  │ (Epicurves, ICU, │  │ (Phased Plans,   │  │ (MapLibre GL JS,   │  │  (Sub-50ms ODE,     │  │
│  │  Mortality Bar)  │  │  A/B Comparison) │  │  Cordon Sanitaire) │  │  Vax & Festivals)   │  │
│  └────────┬─────────┘  └────────┬─────────┘  └─────────┬──────────┘  └──────────┬──────────┘  │
│           │                     │                      │                        │             │
│           └─────────────────────┴──────────┬───────────┴────────────────────────┘             │
│                                            │                                                  │
│                                            ▼                                                  │
│                       ┌───────────────────────────────────────────┐                           │
│                       │   ERIS Agent Hub & Voice Partner Dock     │                           │
│                       │   (Groq LLM Pool + Sarvam Multilingual)   │                           │
│                       └────────────────────┬──────────────────────┘                           │
└────────────────────────────────────────────┼──────────────────────────────────────────────────┘
                                             │ HTTP REST + SSE Streaming + WebSockets
                                             ▼
┌───────────────────────────────────────────────────────────────────────────────────────────────┐
│                                FastAPI Server (OutbreakResponseOS v3)                         │
│  • Concurrency Queue Manager (Semaphore bounded)                                              │
│  • SSE Simulation Streaming (/api/v1/simulate)                                                │
│  • Sub-50ms Deterministic ODE Solver (/api/v1/playground/preview)                             │
│  • Full-Duplex Voice WebSocket Relay (/api/v1/voice/stream)                                   │
│  • Automated War Room Brief Generator (/api/v1/eris/auto-brief)                               │
└──────────────────────┬─────────────────────────────────────────────────┬──────────────────────┘
                       │                                                 │
                       ▼                                                 ▼
┌──────────────────────────────────────────────┐       ┌────────────────────────────────────────┐
│             Simulation Engine                │       │          Supabase (PostgreSQL)         │
│  • seird_engine.py: QMC, SEIRD-b & Matrix W  │       │  • scenarios (Multi-scenario hub)      │
│  • seirv_engine.py: SVEIRD, Vax, & Kumbh ODE │       │  • pathogen_profiles (Triangular R0)   │
│  • resource_calculator.py: ICU & O2 Modeling │◄─────►│  • seird_results (P10/P50/P90 runs)    │
│  • groq_manager.py: Fault-Tolerant Key Pool  │       │  • city_status (15-city spatial data)  │
│  • meta_mobility_edges.csv, IRCTC, DGCA      │       │  • resource_projections (ICU / O2 MT)  │
└──────────────────────────────────────────────┘       └────────────────────────────────────────┘
```

### Backend Architecture & Modules (`backend/`)

| File / Module | Responsibility |
|---|---|
| `main.py` | FastAPI application gateway handling HTTP endpoints, SSE simulation progress relays, and the full-duplex Sarvam voice WebSocket bridge. |
| `simulator/seird_engine.py` | Core mathematical engine: 128 Sobol QMC parameter sampling, SEIRD-b compartmental step math, and dynamic 3-layer mobility matrix compositing. |
| `simulator/seirv_engine.py` | Sub-50 millisecond deterministic SVEIRD ODE engine powering real-time Policy Sandbox scrubs, vaccine uptake kinetics, and festival super-spreader shocks. |
| `simulator/resource_calculator.py` | Converts dynamic active case projections into weekly ICU bed demand, non-ICU hospitalization, and liquid medical oxygen demand (MT/day) calibrated against MoHFW protocols. |
| `simulator/simulator_io.py` | All Supabase database reads and chunked idempotent writes (`DELETE` before `INSERT` pattern ensuring zero duplicate runs). |
| `simulator/healthcare_capacity.py` | Baseline healthcare infrastructure parameters (ICU beds, non-ICU beds, and isolation capacities) for all 15 Indian metropolitan nodes. |
| `groq_manager.py` | Circular thread-safe API key pool manager with automated rate-limit detection, exponential backoff, and model fallback tiering (`gpt-oss-120b` → `gpt-oss-20b`). |
| `who_don_service.py` | Automated web scraper and parser for WHO Disease Outbreak News (DON), performing NLP extraction and city coordinate geo-tagging. |

### Frontend Architecture & Components (`outbreak-dashboard/src/`)

| File / Component | Responsibility |
|---|---|
| `App.tsx` | Central application shell managing global state, multi-scenario persistence switcher, view routing, and drawer mounts. |
| `pages/AnalystView.tsx` | Analytical epidemiology cockpit featuring Active Case Fan/Spaghetti curves, Incidence Epicurves, ICU Saturation, Oxygen Demand, and the Policy Trade-off & Lives Saved scorecard. |
| `pages/PlannerView.tsx` | Phased intervention builder, corridor-level cordon sanitaire controls, and comparative A/B strategy evaluator. |
| `components/map/BubbleMap.tsx` | Interactive MapLibre GL JS vector canvas rendering 15 metropolitan nodes with disease bubble overlays and directional transit flows. |
| `components/playground/PlaygroundDrawer.tsx` | Slideout drawer running real-time deterministic ODE sweeps in under 50ms for instantaneous parameter experimentation. |
| `components/assistant/ErisDrawer.tsx` | ERIS AI analytical partner interface featuring context-grounded epidemic insights, automatic war-room briefs, and tool-assisted policy queries. |
| `components/voice/VoiceOrb.tsx` | 3D canvas particle orb visualizer providing state-driven visual feedback (Listening, Thinking, Speaking) with real-time audio frequency reactivity. |
| `context/VoiceAgentContext.tsx` | Full-duplex voice orchestration capturing mic audio (16kHz PCM downsampled), streaming to the backend WebSocket, and synthesizing low-latency speaker playback. |
| `hooks/useSeirdResults.ts` | Fetches national P10/P50/P90 percentile trajectories per intervention strategy with multi-scenario cache keys. |
| `hooks/useCityStatus.ts` | Queries daily spatial epidemic status across all 15 metropolitan nodes. |
| `hooks/useResourceProjections.ts` | Fetches weekly healthcare resource projections and computes national aggregate deficits. |

---

## Key Capabilities & Subsystems

1. **Dual-Engine Computational Architecture**:
   - **Stochastic High-Assurance Engine**: 128 Quasi-Monte Carlo iterations using Sobol low-discrepancy sequences with empirical triangular distributions for confidence-interval calibration (P10, P50, P90).
   - **Real-Time Interactive ODE Engine**: Sub-50 millisecond deterministic SEIRV solver enabling instantaneous slider scrubbing, corridor cutting, and policy experimentation.
2. **Dynamic Scenario Isolation & Persistence Hub**:
   - Every simulation run produces a cryptographic `scenario_id` with versioned pathogen parameter profiles.
   - 3-tier reload resilience: `localStorage` instant state restore, automatic Supabase recovery if data is pruned, and a built-in **Stored Scenarios Switcher** (up to 5 recent runs) that keeps the main top navigation clean.
3. **Cross-Modal Cordon Sanitaire**:
   - Interactive spatial containment allowing health officers to cut transit corridors per mode:
     - 🚆 **Rail**: [ Active | Severed ]
     - ✈️ **Air**: [ Active | Severed ]
     - 🛣️ **Road**: [ Active | Severed ]
   - Strict mathematical parity between Map toggles, Sandbox previews, and 128-run Monte Carlo execution.
4. **Pharmaceutical Rollout & Mass Gathering Modeling**:
   - Leaky vaccination mechanics with dose uptake delay, severity mitigation, and waning protection.
   - Super-spreader mass gathering multipliers (e.g. Kumbh Mela pilgrimage shocks) scoped to regional attendee fractions.
5. **ERIS Voice & Intelligence Copilot**:
   - Integrated analytical AI assistant powered by a circular rotating **Groq LLM Key Pool** (auto-failover across up to 20 keys).
   - Full-duplex multilingual voice partner powered by **Sarvam AI** with Push-to-Talk (Spacebar) and hands-free VAD in 9 Indian languages.

---

## The Science & Mathematical Framework

### SEIRD-b & SVEIRD Compartmental Models

Every individual in each of the 15 national metropolitan nodes resides in a defined compartment.

```
       ┌───────────────────────────────┐
       │     Vaccination Flow (v)      │
       ▼                               │
S ──► V_pending ──► V ──(waning)──► S  │
│                                      │
├──► E ──► I ──► R                     │
│          └───► D                     │
└──────────────────────────────────────┘
```

#### Behavioral Adaptation (SEIR-b)
Standard models produce runaway exponential spikes because they assume human contact rates remain static during catastrophic mortality. MBEIS incorporates **endogenous fear-mediated contact reduction**:

```text
Prevalence[i] = I[i] / N[i]

Behavioral Multiplier = exp(-k · Prevalence[i])

β[i, effective] = (R₀ / infectious_days) · Policy_Multiplier · exp(-k · (I[i] / N[i]))
```

*At k = 35.0, when 2% of a metro's population becomes visibly infected, public contact naturally contracts by ~50%, accurately mirroring empirical mobility drops observed during COVID-19 Waves 1 & 2.*

#### SVEIRD Leaky Vaccine Dynamics
- **V_pending**: Dose administered, awaiting immune onset lag (τ ≈ 14 days).
- **η_susc**: Susceptibility reduction (60% – 90%).
- **η_sev**: Severity / mortality reduction (90% – 98%) preventing transition to compartment D.
- **ω**: Waning rate (days⁻¹) returning vaccinated individuals to susceptible pool S.

---

### Quasi-Monte Carlo (Sobol Low-Discrepancy Sampling)

Rather than pseudo-random Monte Carlo (which clusters and produces sample gaps), MBEIS samples the 4-dimensional biological space (R₀, Incubation, Infectious duration, CFR) using **Sobol low-discrepancy sequences**:

```python
sampler = qmc.Sobol(d=4, scramble=True, seed=42)
samples = sampler.random_base2(m=7)  # 2^7 = 128 perfectly space-filling points

# Transformed through inverse CDF of triangular parameter bounds:
r0_samples  = to_triang(samples[:, 0], r0_low,  r0_mode,  r0_high)
inc_samples = to_triang(samples[:, 1], inc_low,  inc_mode, inc_high)
cfr_samples = to_triang(samples[:, 2], cfr_low,  cfr_mode, cfr_high)
inf_samples = to_triang(samples[:, 3], inf_low,  inf_mode, inf_high)
```
*128 Sobol iterations achieve statistical convergence equivalent to 300–500 standard pseudo-random iterations.*

---

### 3-Layer Asymmetric Mobility Network

The inter-city transmission tensor `W` combines three empirical layers:

1. **Road Layer (`W_road`)**:
   - 211 directed corridors computed via a National Highway-weighted **Radiation Model**.
   - Trunk corridors (NH44, NH48, Golden Quadrilateral) receive capacity weightings based on MoRTH lane benchmarks.
2. **Rail Layer (`W_rail`)**:
   - Built from **IRCTC origin-destination seat capacity schedules**.
   - Highly directional and asymmetric (e.g., Delhi → Lucknow accounts for 22.9% of outbound Delhi rail volume).
3. **Air Layer (`W_air`)**:
   - Calibrated from **DGCA (Directorate General of Civil Aviation) annual scheduled domestic passenger flows**.
   - Delhi–Mumbai (6.4M passengers/year) serves as the national normalization baseline (1.0).

**Composite Blending:**
```text
W_active = Σ (α_m · W_m ⊙ C_m)   for m ∈ {road, rail, air}
```

Where `α_m` is the modal share and `C_m` is the binary/capacity cordon mask applied by the user.

---

### Pharmaceutical Interventions & Mass Gathering Shocks

#### Mass Gathering Vector (e.g. Kumbh Mela / Major Pilgrimage)
Mass gatherings amplify contact rates in a specific city over a finite time window `[T_start, T_end]`:

```text
β_festival(t) = β₀ · [1 + (γ_crowd - 1) · f_attendee]   for t ∈ [T_start, T_end]
```

Where `γ_crowd` is the crowding multiplier (2.0× – 4.0×) and `f_attendee` is the fraction of the host metro participating.

---

### Healthcare Capacity & Clinical Resource Math

Resource requirements are calculated weekly across all 15 metropolitan nodes:

```text
Severity Ratio = CFR_pathogen / CFR_COVID19_Ref

Projected ICU Demand = I(t) · ICU_Rate_base · Severity Ratio

Oxygen Demand (MT/day) = (ICU Beds · 24 LPM + Non-ICU Beds · 10 LPM) × 0.002058
```

- **National Oxygen Production Ceiling**: 9,690 MT/day (Parliamentary Standing Committee on Health & Family Welfare).
- **National ICU Surge Capacity Threshold**: 95,000 ICU beds.

---

## The Interface Ecosystem

### 1. Analyst View
- **Active Infections (I)**: Fan-chart (P10 – P90 confidence band) and Spaghetti plot (100 individual Monte Carlo sample trajectories) with Linear/Log toggle.
- **Daily New Infections (Incidence Epicurve)**: Measures true daily infection velocity (ΔI + recoveries + deaths) over 180 days.
- **Cumulative Fatalities (D)**: 180-day projected mortality curves with percentile bounds.
- **Effective Reproduction Number (Rₜ)**: Real-time trajectory plotted against the critical Rₜ = 1.0 stabilization threshold.
- **National Oxygen Demand (MT/day)**: Weekly demand vs the 9,690 MT/day capacity line.
- **National ICU Bed Saturation**: Weekly critical care load vs the 95,000 ICU bed national threshold.
- **Intervention Policy Trade-offs & Lives Saved**: Side-by-side comparative bar chart and scorecard displaying lives saved, mortality reduction %, and peak delay gained.

### 2. Planner View
- **Multi-Phase Intervention Builder**: Construct custom phased policy schedules (e.g. Phase 1: Full Lockdown → Phase 2: Partial → Phase 3: Transit Halt).
- **Corridor Cordon Controls**: Specify custom city-pair edge cuts directly into the phased simulation schedule.
- **A/B Strategy Comparison**: Instant differential analysis between candidate policy plans.

### 3. Spread Map (Spatial Transit Network)
- **MapLibre GL JS Vector Canvas**: Displays all 15 metropolitan nodes with infection-scaled SVG circles and directional inter-city transit lines.
- **Day Scrubber & Autoplay**: Animate outbreak propagation from Day 0 to Day 180.
- **Binary Modal Cordon Sanitaire**: Click any transport corridor to sever Rail, Air, or Road links individually.

### 4. Policy Sandbox (Sub-50ms Deterministic ODE Explorer)
- Interactive slideout drawer executing in-memory deterministic ODE sweeps in under 50 milliseconds.
- Test biological parameter variations, modal share shifts, vaccination programs, and festival shocks before committing to full 128-iteration Monte Carlo runs.

### 5. ERIS — AI Epidemic Intelligence Agent & Voice Copilot
- **Circular Groq LLM Key Pool**: Rotates across up to 20 API keys with automatic rate-limit detection, backoff, and model fallback (`gpt-oss-120b` → `gpt-oss-20b`).
- **Sarvam Multilingual Voice Partner**: Full-duplex voice interaction with Push-to-Talk (Spacebar) and hands-free VAD supporting 9 Indian languages (*English, Hindi, Tamil, Telugu, Malayalam, Bengali, Kannada, Gujarati, Marathi*).
- **Automated War Room Briefing**: Instant executive memo generation summarizing national peak cases, ignition sequence, and capacity deficits upon simulation completion.

### 6. WHO Disease Outbreak News (DON) Live Intel
- Real-time ingestion of global disease outbreak bulletins from the World Health Organization.
- Automated spatial geo-tagging and one-click transfer into the simulation sandbox.

---

## Data Sources & Provenance

> **Data Accuracy & Methodology Disclaimer:**
> Datasets utilized across MBEIS were compiled and harmonized via custom Python processing pipelines. Only DGCA commercial aviation flows were ingested directly from an official primary government statistical publication. Road and passenger rail figures are mathematically modeled approximations — actual origin-destination (OD) booking matrices from IRCTC and MoRTH are restricted or classified. Non-DGCA figures serve as calibrated engineering estimates for academic simulation, not verified ground truth.

| Dataset | Source & Methodology | Calibration / Accuracy Profile |
|---|---|---|
| **Road Mobility Network** | Modeled via radiation transport model + open National Highway network geometries (MoRTH) | ⚠️ **Estimated** — Real-time vehicular traffic counters unavailable; capacity scaled by highway classification |
| **Rail Mobility Network** | Synthesized from public IRCTC train schedules, coach configurations, and override heuristics | ⚠️ **Estimated** — True passenger origin-destination manifests are restricted; directional seat capacity modeled |
| **Domestic Aviation Network** | DGCA (Directorate General of Civil Aviation) Civil Aviation Statistics portal | ✅ **Official Government Record** — Route-level annual scheduled passenger counts |
| **City Metapopulation** | Global Human Settlement Layer (GHSL 2020 R2023A), CAGR-interpolated | ✅ **Peer-Reviewed Public Dataset** — High-resolution spatial urban agglomeration boundaries |
| **Healthcare Infrastructure** | Aggregated from state health bulletins, National Health Profile, and public emergency reporting | ⚠️ **Approximate** — Decentralized municipal reporting with varied reporting cadences |
| **Liquid Medical Oxygen Ceiling** | Parliamentary Standing Committee on Health & Family Welfare (2021 reports) | ✅ **Official Parliamentary Record** — Benchmark ceiling set at 9,690 MT/day |
| **Historical Benchmark Data** | covid19india.org crowdsourced epidemiological repository | ✅ **Validated Research Benchmark** — Widely cited in academic literature for Wave 1/2 dynamics |

---

## Empirical Validation & Calibration

MBEIS is validated against India's first COVID-19 wave (January–May 2020, 15-city metapopulation network) using **CRPS (Continuous Ranked Probability Score)**:

- **Ascertainment Calibration**: Accounts for early-2020 testing limitations (ICMR restrictive criteria captured ~2.5% – 10% of true infections).
- **Skill Score**: The raw unadjusted CRPS skill score is **-0.43** against naive persistence due to severe early ascertainment bias (Days 1–55, where true biological infections exceeded confirmed positive tests by ~85–90%). Once calibrated, the spatial metapopulation network accurately captures peak timing and secondary city transmission lags (e.g. Delhi/Mumbai seeding → 3–4 week delayed peaks in Patna and Guwahati).

---

## Tech Stack

### Frontend
- **Framework**: React 18 with TypeScript
- **Bundler**: Vite
- **Styling**: Tailwind CSS v4.0 with customized semantic tokens
- **Visualizations**: Recharts, SVG Spaghetti Trajectory Renderers
- **Maps**: MapLibre GL JS, MapTiler Vector Basemaps, GeoJSON
- **Audio Processing**: Web Audio API (16kHz PCM, AnalyserNodes, WebAudio ScriptProcessor)

### Backend
- **Runtime**: Python 3.12
- **API Framework**: FastAPI, Uvicorn, WebSockets, SSE Streaming
- **Scientific Computing**: NumPy, SciPy (`scipy.stats.qmc`, `scipy.stats.triang`), Pandas, NetworkX
- **Database Client**: Supabase Python Client (PostgreSQL)
- **AI / LLM Orchestration**: Groq Python SDK with thread-safe key pool manager
- **Voice Infrastructure**: Sarvam AI WebSocket Audio Streaming

---

## Getting Started

### Prerequisites
- Node.js 20+ or 22+
- Python 3.12
- Supabase Project (PostgreSQL instance with MBEIS schema applied)

### Quick Start

1. **Clone the repository**:
   ```bash
   git clone https://github.com/your-username/MBEIS.git
   cd MBEIS
   ```

2. **Configure Environment Variables**:
   Copy `.env.example` in both the root and frontend directories:
   ```bash
   cp .env.example .env
   cp outbreak-dashboard/.env.example outbreak-dashboard/.env
   ```
   *(Fill in your Supabase credentials, Groq API keys, and MapTiler key).*

3. **Install Dependencies**:
   ```bash
   # Install Backend Dependencies
   pip install -r requirements.txt

   # Install Frontend Dependencies
   cd outbreak-dashboard
   npm install
   cd ..
   ```

4. **Launch the Entire Stack**:
   On Windows, simply run the automated batch launcher:
   ```cmd
   start.bat
   ```
   *Or launch manually in separate terminals:*
   ```bash
   # Terminal 1: Backend
   python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000 --reload

   # Terminal 2: Frontend
   cd outbreak-dashboard
   npm run dev
   ```

5. Open your browser at `http://localhost:5173`.

---

## Environment Variables

### Root / Backend (`.env`)

```env
API_ENV=development
VITE_API_URL=http://localhost:8000

# Database
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-supabase-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key
SUPABASE_DB_PASSWORD=your-db-password

# Spatial Basemaps
VITE_MAPTILER_KEY=your-maptiler-key

# AI Copilot (Groq Pool)
GROQ_API_KEY=gsk_primary_key
GROQ_API_KEY_1=gsk_key_1
GROQ_API_KEY_2=gsk_key_2

# Voice Infrastructure
SARVAM_API_KEY=your-sarvam-key
```

### Frontend (`outbreak-dashboard/.env`)

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-supabase-anon-key
VITE_MAPTILER_KEY=your-maptiler-key
VITE_BACKEND_URL=http://localhost:8000
```

---

## API Reference

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/health` | Server health check and timestamp |
| `GET` | `/api/v1/who-don` | Fetches parsed WHO Disease Outbreak News bulletins with coordinates |
| `POST` | `/api/v1/simulate` | Initiates 128-iteration Monte Carlo run via Server-Sent Events (SSE) |
| `POST` | `/api/v1/simulate-phased` | Runs multi-phase scheduled intervention plan with corridor cuts |
| `POST` | `/api/v1/playground/preview` | Sub-50ms deterministic ODE solver for interactive slider scrubbing |
| `POST` | `/api/v1/assistant/chat` | ERIS analytical assistant chat endpoint with tool execution |
| `POST` | `/api/v1/eris/auto-brief` | Automated executive war room memo generator |
| `WS` | `/api/v1/voice/stream` | Full-duplex WebSocket stream for real-time STT → LLM → TTS voice relay |

---

## Known Limitations

- **Coarse Spatial Metapopulation**: Models 15 primary urban transit hubs (~60% of India's urban population); does not resolve intra-district rural dispersion.
- **Homogeneous Population Stratification**: Does not currently implement age-structured contact matrices (POLYMOD).
- **Asymptomatic Carriage**: Asymptomatic and symptomatic cases are aggregated within the infectious compartment I.
- **Exogenous Clinical Scaling**: Healthcare capacity projections are derived from case volume; disease CFR does not dynamically increase when local ICU capacity hits 100% exhaustion.

---

## Roadmap

### Completed Milestones
- [x] **Sub-50ms Deterministic ODE Solver** — In-memory SEIRV preview calculation for instantaneous interactive parameter scrubbing (`seirv_engine.py`)
- [x] **Leaky SVEIRD Vaccination Kinetics** — Clinical severity attenuation, immune onset latency, and protection waning mechanics
- [x] **Regional Super-Spreader Shocks** — Kumbh Mela and religious pilgrimage crowding multiplier vectors
- [x] **Cross-Modal Cordon Sanitaire** — Independent corridor severance across Rail, Air, and Road modes with synchronized map and sandbox parity
- [x] **Multi-Scenario Persistence Hub** — Instant scenario switcher preserving recent runs with zero reload loss
- [x] **ERIS Voice Copilot** — Full-duplex WebSocket voice stream powered by Sarvam AI supporting 9 Indian languages
- [x] **Circular Groq LLM Key Pool** — High-availability rotating pool with automatic rate-limit failover and model tiering
- [x] **WHO Outbreak News Feed** — Real-time automated ingestion, NLP extraction, and geo-coordinate mapping of WHO DON bulletins
- [x] **Executive Analytical Dashboards** — Daily incidence epicurves, national ICU bed saturation tracking, and policy intervention comparison scorecards

### Future Research Horizons
- [ ] **Age-Structured Contact Matrices** — Integrate POLYMOD demographic contact matrices calibrated for India
- [ ] **Pan-India District Scale (700+ Nodes)** — High-resolution district-level OD matrix synthesis (pending official data agreements)
- [ ] **Dynamic Healthcare Feedback on Mortality** — Model nonlinear increases in pathogen CFR when local ICU beds reach 100% saturation
- [ ] **Ensemble Kalman Filter (EnKF) Assimilation** — Real-time state updating assimilating live IDSP daily case surveillance
- [ ] **Multi-Strain & Genomic Variant Competition** — Dual-pathogen competitive emergence with immune escape dynamics

---

## License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.

---

<p align="center">
  <b>MBEIS</b> — Mobility Based Epidemic Intervention Simulator<br>
  <i>Engineering data-driven resilience for public health emergency response.</i>
</p>
