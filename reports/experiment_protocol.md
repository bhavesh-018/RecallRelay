# RecallRelay · Experiment Protocol (`Track 1: Test Something Real`)

## 1. Research Question & Hypothesis
- **Feature Flag:** `recall_response_flow` (multivariate Flagsmith feature in the isolated `Study` environment, Flagsmith Experiment `#718`).
- **Control (`standard`, 50%):** Single-page recall reconciliation form presenting all inputs (`Units Sold`, `Units Remaining`, `Units Set Aside`, and quarantine confirmation) together.
- **Treatment (`guided`, 50%):** 3-step progressive reconciliation flow (`1. Count` → `2. Reconcile` → `3. Confirm`) enforcing exact balance verification before quarantine confirmation.
- **Hypothesis:** Breaking inventory reconciliation into a 3-step guided verification flow (`guided`) reduces stock-entry errors and increases the rate of first-time backend-verified completions within 300 seconds compared to a single-page form (`standard`).

## 2. Controlled Task & Anti-Bias Design
- **Identical Fictional Scenario:** Every `/join` participant receives the exact same isolated mock shop scenario for Batch `B17` (*SunGrain Crunchy Oats 500g* — `15` packs received, `5` sold, `10` remaining on shelf to set aside in quarantine). Holding scenario arithmetic constant ensures that workflow design is the sole experimental variable.
- **Identical Notice & Validation:** Both `standard` and `guided` render the exact same `"Fictional recall drill"` banner, identical recall notice text, and identical server-side validation rules (`Received == Forwarded + Sold + Remaining`, `0 <= SetAside <= Remaining`, whole non-negative integers, ground-truth match).
- **Participant Isolation:** Remote `/join` sessions have no links to the Operator Console or experiment dashboard so participants are never exposed to A/B variant names or live metrics.
- **Zero PII:** Participants are assigned pseudonymous IDs (`study_<hex>` / alias `P-xx`) with zero login, email, or name collection.

## 3. Randomization, Exposure & Identity Consistency
- **Server-Side Remote Evaluation:** Variant assignment is evaluated exclusively on the FastAPI backend via the Flagsmith Python SDK (`flagsmith 6.7.0`, `enable_local_evaluation=False`, `enable_events=True`, `get_experiment_flag()`).
- **Late Exposure (No Pre-Start Contamination):** Flagsmith evaluation occurs only after the participant explicitly presses **Start Isolated Shop Drill** (`POST /api/sessions/{token}/start`), preventing unstarted page loads from polluting the denominator.
- **Consistent Identity:** The exact same pseudonymous `identity` passed to `get_experiment_flag()` is passed to `track_event("recall_drill_started", ...)` and `track_event("recall_drill_success", ...)`. Reopening the browser resumes the existing `scoped_token`, variant, and server-side start timestamp.

## 4. Primary & Secondary Metrics
- **Primary Metric (`recall_drill_success`, Flagsmith Occurrence · Higher is better):** First backend-verified correct reconciliation submitted within **300 seconds** of server-recorded `exposure_at`.
  - Duplicate submits or double-clicks record at most **one** logical success per session.
  - Submissions verified after `300s` are saved for completeness (`late_completion_recorded = true`) while the primary outcome remains `timeout`.
- **Secondary Metrics (PostgreSQL `drill_sessions`):**
  - Median completion time (seconds, among qualified completions)
  - Total incorrect validation attempts per variant
  - Timeout and abandonment counts

## 5. Exclusion Rules & Data Integrity
- **Practice Isolation:** All internal smoke tests and operator rehearsals use `is_practice = true` (evaluated against the separate `Pilot` environment) and are excluded by default from `/api/experiments/summary`, `/api/experiments/export.csv`, and `scripts/export_results.py`.
- **Outage Exclusions:** Sessions where Flagsmith remote evaluation returned an error (`validity_status = "eval_error"`) or sessions never started (`validity_status = "pending"`) are excluded from the valid exposed denominator and explicitly reported in `exclusions_by_reason`.
- **Durable Event Outbox:** Every Flagsmith event is persisted to PostgreSQL `event_outbox` before dispatch with idempotent retry (`POST /api/experiments/outbox/dispatch`), guaranteeing zero discrepancy between local raw counts and exported CSV rows.
