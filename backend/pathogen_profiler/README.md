# Pathogen Profiler Service

The **Pathogen Profiler** is a Python/FastAPI service for the **Outbreak Response OS**.

Its purpose is to convert either a known disease or a free-text description of an emerging pathogen into **simulation-ready epidemiological parameters** for the downstream Monte Carlo epidemic simulator.

The core design principle is:

> **Never invent epidemiological precision.**

Known diseases use sourced values from the reference database. Unknown diseases use deliberately wider ranges derived from similar reference diseases, with an explicit explanation of how those ranges were produced.

---

## 1. Architecture

The profiler has two stages.

### Stage 1 — Reference Disease Match

Used when the planner selects a known disease.

```text
Planner
   │
   │ disease_name
   ▼
Pathogen Profiler
   │
   ▼
reference_diseases
   │
   ▼
Sourced reference profile
```

Stage 1 does **not** use an LLM.

The service looks up the selected disease directly in the `reference_diseases` Supabase table.

The returned profile links to the reference disease using:

```text
matched_reference_disease_id
```

The service does not invent or modify the reference values.

---

## 2. Stage 2 — Emerging/Unknown Pathogen

Used when the planner describes a pathogen in free text.

Example:

```text
A respiratory pathogen that spreads through droplets,
has an incubation period of approximately one week,
and causes moderate respiratory disease.
```

The flow is:

```text
Planner Description
        │
        ▼
LLM Similarity Matching
        │
        ▼
1–2 Closest Reference Diseases
        │
        ▼
Similarity Weights
        │
        ▼
Deterministic Range Derivation
        │
        ▼
Derived Pathogen Profile
```

The LLM is responsible for identifying similar reference diseases.

It must not simply invent epidemiological parameter values.

Similarity is primarily determined using:

1. Transmission route
2. Incubation pattern
3. Severity pattern

---

## 3. Epidemiological Parameters

Every simulation parameter is represented as a three-value range:

```json
{
  "low": 0.0,
  "most_likely": 0.0,
  "high": 0.0
}
```

The three values represent:

* `low` — lower plausible bound
* `most_likely` — best estimate
* `high` — upper plausible bound

The values are intended to be consumed by the downstream Monte Carlo simulator.

---

## 4. Provenance Rules

These rules are fundamental to the service.

### Rule 1 — Never invent epidemiological values

The profiler must never create unsupported precision.

Reference disease parameters must come from supplied, authoritative sources.

---

### Rule 2 — Known diseases use reference data

For Stage 1:

```text
Known Disease
     ↓
reference_diseases
     ↓
Return sourced reference information
```

No LLM-derived values are used.

---

### Rule 3 — Derived profiles require derivation_basis

Every derived profile must contain:

```text
derivation_basis
```

This field explains:

* which reference diseases contributed
* their similarity weights
* which features influenced those weights
* why those diseases were considered similar

A derived profile without `derivation_basis` is invalid.

---

### Rule 4 — Derived ranges must represent uncertainty

A derived disease should not simply copy one reference disease's range.

The resulting range must be deliberately wider than any single contributing disease's range.

This allows uncertainty in the disease match to propagate into the downstream Monte Carlo simulation.

---

### Rule 5 — Similarity and parameter derivation are separate concerns

The LLM determines:

```text
Which diseases are similar?
How similar are they?
Why?
```

Application code determines:

```text
How should the epidemiological ranges be derived?
```

This separation prevents the LLM from silently inventing numerical precision.

---

## 5. Request Contract

The profiler accepts either a known disease name or a free-text description.

Example known-disease request:

```json
{
  "scenario_id": "scenario-001",
  "version": 1,
  "disease_name": "COVID-19"
}
```

Example emerging-pathogen request:

```json
{
  "scenario_id": "scenario-002",
  "version": 1,
  "description": "A respiratory pathogen with approximately one week incubation."
}
```

A request must provide exactly one of:

```text
disease_name
```

or

```text
description
```

---

## 6. Current Project Structure

```text
pathogen_profiler/
│
├── __init__.py
├── main.py
├── config.py
├── db.py
├── schema.py
├── requirements.txt
├── README.md
│
├── prompts/
│   └── stage2_similarity.txt
│
├── reference_library/
│   └── seed_reference_diseases.sql
│
└── tests/
    ├── test_stage1_match.py
    ├── test_stage2_derive.py
    └── test_schema_validation.py
```

Some files are created in later development phases.

---

## 7. Local Configuration

Create a `.env` file in the project root:

```env
SUPABASE_URL=your_supabase_project_url
SUPABASE_KEY=your_supabase_key
```

Do not commit `.env` to Git.

The environment variables are loaded through `config.py`.

---

## 8. Running Locally

From the repository root:

```bash
pip install -r backend/pathogen_profiler/requirements.txt
```

Start the FastAPI development server:

```bash
uvicorn backend.pathogen_profiler.main:app --reload
```

The API will be available at:

```text
http://127.0.0.1:8000
```

Interactive API documentation:

```text
http://127.0.0.1:8000/docs
```

Alternative documentation:

```text
http://127.0.0.1:8000/redoc
```

---

## 9. Current Endpoints

### Health Check

```http
GET /health
```

Example response:

```json
{
  "status": "healthy",
  "service": "pathogen_profiler"
}
```

### Root

```http
GET /
```

Example response:

```json
{
  "service": "Pathogen Profiler",
  "status": "running",
  "version": "1.0.0"
}
```

The profiling endpoints will be added during the Stage 1 and Stage 2 implementation phases.

---

## 10. Development Roadmap

### Phase 1 — Foundation

* FastAPI application
* Supabase configuration
* Pydantic schemas
* Dependency configuration
* Documentation

### Phase 2 — Reference Library

* Create `reference_diseases`
* Add sourced COVID-19 parameters
* Add additional sourced diseases
* Add provenance/citation information

### Phase 3 — Stage 1

* Implement exact disease lookup
* Return reference disease information
* Link profiles using `matched_reference_disease_id`
* Add tests

### Phase 4 — Stage 2

* Implement LLM tool-call schema
* Implement similarity matching
* Implement weighted derivation
* Enforce wider derived ranges
* Generate `derivation_basis`
* Persist derived profiles
* Add tests

### Phase 5 — Deployment

* Configure Render
* Configure production environment variables
* Add health monitoring
* Connect the profiler to the downstream simulator

---

## 11. Design Principle

The profiler should prefer:

```text
Honest uncertainty
```

over:

```text
False precision
```

A wide range with a transparent derivation is preferable to a precise-looking number that cannot be justified.

The uncertainty produced here directly affects the uncertainty shown by the downstream epidemic simulator.
