# RecallRelay

> **Fictional recall drill & Flagsmith experimentation workbench** built for **Toggle Wars: Flagsmith Experimentation Hackathon (WeMakeDevs × Flagsmith)**.

RecallRelay models a multi-tier supply-chain batch recall across a manufacturer, distributors, and retail locations. Operators trace affected batches without double-counting stock transfers, publish idempotent recall tasks with QR mobile response links, run a live **Flagsmith A/B experiment** comparing two participant reconciliation workflows, and review bounded AI-agent proposals that safely update Flagsmith `Pilot` flag weights only after deterministic validation and human approval.

### Judge & Reviewer Quick Links
- **Frozen Study Results (Track 1):** [reports/results.md](reports/results.md) · [Deidentified CSV](reports/recallrelay_experiment_results.csv) · [Summary JSON](reports/recallrelay_experiment_summary.json)
- **Experiment Protocol (Track 1):** [reports/experiment_protocol.md](reports/experiment_protocol.md)
- **Live Agent Evidence & 9/9 Eval Suite (Track 2):** [reports/agent_evidence.md](reports/agent_evidence.md)
- **Flagsmith Agent Skill (Track 4):** [skills/flagsmith-experiment-guard/SKILL.md](skills/flagsmith-experiment-guard/SKILL.md)
- **Known Limitations:** [reports/limitations.md](reports/limitations.md)
- **Task & Delivery Tracker:** [tasks.md](tasks.md)
- **Architectural Decisions (ADR-001–ADR-009):** [decision_log.md](decision_log.md)
- **License:** [LICENSE](LICENSE) (MIT)

---

## Technical Coverage Across All 4 Tracks

| Track | What RecallRelay Delivers | Key Implementation |
| --- | --- | --- |
| **1. Test Something Real** | Server-side Flagsmith A/B experiment on multivariate flag `recall_response_flow` (`standard` single-page vs. `guided` 3-step Count → Reconcile → Confirm), 300s server-side timer cutoff, durable PostgreSQL `EventOutbox`, consistent pseudonymous identities, and deidentified CSV export. | [flagsmith_client.py](backend/app/experiments/flagsmith_client.py), [sessions.py](backend/app/experiments/sessions.py), [outbox.py](backend/app/experiments/outbox.py), [analytics_router.py](backend/app/experiments/analytics_router.py) |
| **2. AI Agents & Feature Flags** | Bounded LLM product analyst (`<= 8` tool calls, `<= 2` repair attempts, `60s` budget) using Gemini, deterministic evidence validator rejecting fabricated counts/IDs, human operator approval with SHA-256 baseline config hash lock, Flagsmith Management API v2/v1 publish + independent readback verification, and a 9-scenario adversarial evaluation suite. | [orchestrator.py](backend/app/proposals/orchestrator.py), [validator.py](backend/app/proposals/validator.py), [executor.py](backend/app/proposals/executor.py), [run_evals.py](backend/tests/agent_evaluations/run_evals.py) |
| **3. Build on Open Source Flagsmith** | Fixture-agnostic reusable `<RecallFlow />` React component + backend reconciliation verified on a completely distinct second dataset (`fixtures/second_drill.json` — cold-chain vaccine vials `MED-404`/`MED-405` across 6 locations), plus a self-hosted Flagsmith Docker Compose profile (`localhost:8000`). | [RecallFlow.tsx](frontend/src/components/RecallFlow/RecallFlow.tsx), [second_drill.json](fixtures/second_drill.json), [docker-compose.yml](docker-compose.yml), [test_second_fixture_reuse.py](backend/tests/test_second_fixture_reuse.py) |
| **4. Flagsmith Agent Skills** | Installable Agent Skill (`flagsmith-experiment-guard`) backed by a token-efficient CLI (`inspect` → `preflight` → human-approved `apply` → `verify`) emitting `< 260`-byte JSON, hard-blocking `Production`/`Study` mutations, enforcing SHA-256 drift locks, and verifying live Flagsmith readback. | [SKILL.md](skills/flagsmith-experiment-guard/SKILL.md), [flagsmith_guard_cli.py](scripts/flagsmith_guard_cli.py), [test_flagsmith_guard_skill.py](backend/tests/test_flagsmith_guard_skill.py) |

---

## Architecture Overview

- **Backend (`backend/`):** FastAPI + SQLAlchemy 2 + Alembic + PostgreSQL 15 + Flagsmith Python SDK (`flagsmith >= 6.3.0`, remote evaluation with `enable_events=True`) + `httpx` for Flagsmith Management API and Gemini API.
- **Frontend (`frontend/`):** React 18 + TypeScript + Vite 6 + Tailwind CSS v4 + Vitest 3. Understated dark operator console (`Overview`, `Batch Trace`, `Publish Recall`, `Experiment Summary`, `Agent Workbench`) and mobile-first participant views (`/join`, `/task/:token`).
- **Domain Accounting Invariants:**
  - `Received == Forwarded + Sold + Remaining` (strictly non-negative integers).
  - `0 <= SetAside <= Remaining` and explicit quarantine confirmation required for completion.
  - Transfers move stock between nodes without double-counting total batch holdings.
- **Port Layout:**
  - `5432` — RecallRelay PostgreSQL (`recallrelay_postgres`)
  - `8080` — RecallRelay FastAPI backend
  - `5173` — RecallRelay Vite frontend
  - `8000` / `8001` — Self-hosted Open-Source Flagsmith (`--profile flagsmith`)

---

## Quickstart (Fresh Checkout)

### Prerequisites
- Python `3.12+`
- Node.js `20+` (`npm`)
- Docker Desktop / Docker Compose

### 1. Configure Environment
```bash
cp .env.example .env
```
Update `.env` with your `OPERATOR_SECRET`, Flagsmith keys (`FLAGSMITH_STUDY_KEY`, `FLAGSMITH_PILOT_KEY`, `FLAGSMITH_MANAGEMENT_TOKEN`, `FLAGSMITH_PILOT_ENV_ID`), and `LLM_API_KEY` (Gemini).

### 2. Start PostgreSQL, Run Migrations & Seed
```bash
docker compose up -d postgres
cd backend
python -m venv .venv
# Windows PowerShell: .\.venv\Scripts\Activate.ps1
# macOS / Linux:      source .venv/bin/activate
pip install -r requirements.txt
alembic upgrade head
cd ..
python scripts/seed.py --fixture fixtures/food_drill.json --reset
```

To load the larger 16-location, 3-tier demo dataset (`SunGrain Central Mill` → 3 regional hubs → 12 retail stores, 500 units):
```bash
python scripts/seed.py --fixture fixtures/demo_large_drill.json --reset
```

To load the completely distinct second fixture (cold-chain medical vials `MED-404` / `MED-405`) without modifying any core code:
```bash
python scripts/seed.py --fixture fixtures/second_drill.json --reset
```

### 3. Run Backend & Frontend
```bash
# Terminal 1 (Backend on :8080)
cd backend
uvicorn app.main:app --host 0.0.0.0 --port 8080

# Terminal 2 (Frontend on :5173)
cd frontend
npm install
npm run dev -- --host 0.0.0.0 --port 5173
```

Open `http://localhost:5173` for the Operator Console, or `http://localhost:5173/join` for the participant drill entry.

---

## Flagsmith Cloud Setup (Tracks 1 & 2)

1. Create two environments in your Flagsmith project: **`Study`** (read-only for the agent) and **`Pilot`** (allowlisted target for operator-approved agent writes).
2. Create a multivariate feature named **`recall_response_flow`**:
   - **Enabled:** ON
   - **Control Value:** `standard` (50%)
   - **Variant 1:** `guided` (50%)
3. In **`Study`**, create metric **`recall_drill_success`** (`Occurrence`, `Higher is better`) and launch an **Experiment** on `recall_response_flow`.
4. Populate `.env` with `FLAGSMITH_STUDY_KEY`, `FLAGSMITH_PILOT_KEY`, `FLAGSMITH_MANAGEMENT_TOKEN` (Account Token or Org Master Key), and `FLAGSMITH_PILOT_ENV_ID` (Pilot environment key).
5. Run the live integration smoke check:
   ```bash
   cd backend
   python -m app.experiments.spike
   ```
   All three checks (`flagsmith_sdk`, `flagsmith_management`, `llm`) should report `"ok": true`.

---

## Open-Source Self-Hosted Flagsmith Setup (Track 3)

RecallRelay includes an isolated `flagsmith` Compose profile running official open-source Flagsmith (`localhost:8000`) and its task processor (`localhost:8001`) against its own PostgreSQL instance:

```bash
docker compose --profile flagsmith up -d
```

1. Open `http://localhost:8000`, create a local admin account, org, and project.
2. Create multivariate feature `recall_response_flow` (`standard` 50% / `guided` 50%) and enable it.
3. Copy the local **Server-side Environment Key** (`ser....`) from **SDK Keys** and point `.env` at:
   ```env
   FLAGSMITH_STUDY_KEY=ser.<your-local-key>
   FLAGSMITH_API_URL=http://localhost:8000/api/v1/
   FLAGSMITH_EVENTS_URL=http://localhost:8000/
   FLAGSMITH_ADMIN_API_URL=http://localhost:8000/api/v1/
   ```

> **Note on Self-Hosted Events:** Open-source self-hosted Flagsmith does not bundle Flagsmith Cloud's separate `events.api.flagsmith.com` ingestion microservice. RecallRelay records every exposure and outcome durably in PostgreSQL (`drill_sessions` + `event_outbox`), so experiment counts and CSV exports remain 100% reproducible even when running fully self-hosted.

---

## Reusable `<RecallFlow />` Component Interface (Track 3)

Located at [`frontend/src/components/RecallFlow/RecallFlow.tsx`](frontend/src/components/RecallFlow/RecallFlow.tsx), `<RecallFlow />` is decoupled from any specific industry fixture, API client, or routing layer.

### Props (`RecallFlowProps`)
```ts
export interface RecallFlowProps {
  banner?: string;                   // Defaults to "Fictional recall drill"
  batchCode: string;                 // e.g. "B17" or "MED-404"
  productName: string;               // e.g. "Spiced Almond Granola" or "Cold-Chain Vial"
  locationName: string;              // e.g. "Shop North" or "Clinic East"
  noticeText: string;                // Recall notice shown identically in both variants
  received: number;                  // Authoritative received units for this node
  forwarded: number;                 // Authoritative forwarded units for this node
  workflow?: 'standard' | 'guided';  // Flagsmith-controlled workflow mode
  initialValues?: Partial<RecallFlowValues>;
  submitting?: boolean;
  errorMessage?: string | null;
  onSubmit: (values: RecallFlowValues) => Promise<void> | void;
}
```

### Supported Inputs & Boundaries
- **Enforced client & server invariants:** Whole non-negative integers only; `received === forwarded + sold_qty + remaining_qty`; `0 <= set_aside_qty <= remaining_qty`; explicit confirmation checkbox required.
- **Identical safety guarantees across variants:** Both `standard` (single-page form) and `guided` (3-step Count → Reconcile → Confirm) render the exact same notice banner, quantities, and validation rules.
- **Boundary:** `<RecallFlow />` does not call Flagsmith directly or manage participant auth tokens; the host application resolves the variant server-side and passes `workflow` + `onSubmit`.

---

## Testing, Agent Evaluations & Reproducible Results Export

### Backend Unit & Integration Suite
```bash
cd backend
pytest -v
```

### Frontend Typecheck, Unit Tests & Production Build
```bash
cd frontend
npx tsc -b && npm test && npm run build
```

### Adversarial Product-Agent Evaluation Suite (9 Scenarios)
```bash
cd backend
python -m tests.agent_evaluations.run_evals
```
Verifies prompt-injection resistance, fabricated evidence rejection, non-allowlisted target blocking, stale config hash conflict blocking, unapproved write denial, timeout-after-commit reconciliation, and LLM outage graceful fallback (`9 / 9 passed`).

### Reproducible Deidentified Study Export
```bash
python scripts/export_results.py --out-dir ./exports
```
Writes `recallrelay_experiment_results.csv` and `recallrelay_experiment_summary.json` (excluding `is_practice=True` by default) and automatically re-reads the CSV to verify exact numerator/denominator parity with the summary JSON.

---

## Dependencies & Licensing

All backend and frontend dependencies are permissive open-source packages (MIT, BSD-3-Clause, Apache-2.0, LGPL-3.0 for `psycopg`) with zero proprietary assets:
- **Backend:** FastAPI (MIT), Uvicorn (BSD-3), Pydantic (MIT), SQLAlchemy (MIT), Alembic (MIT), psycopg (LGPL-3), Flagsmith Python SDK (BSD-3), httpx (BSD-3), qrcode (BSD-3), pytest (MIT).
- **Frontend:** React & React DOM (MIT), React Router (MIT), Lucide Icons (ISC), Tailwind CSS (MIT), Vite (MIT), Vitest (MIT), TypeScript (Apache-2.0).

---

## Known Boundaries & Limitations
- **Fictional Drill Scope:** All scenarios (`food_drill.json`, `second_drill.json`) are synthetic training fixtures; real regulatory recall workflows require domain legal/compliance review.
- **Single Allowlisted Agent Target:** By design, the product agent can only propose and apply multivariate weight updates to `Pilot / recall_response_flow` after human approval — never `Study` or `Production`.
- **Small-Sample Caution:** Hackathon participant cohorts are small; RecallRelay always displays raw numerators, denominators, timeouts, exclusions, and explicit uncertainty statements rather than over-claiming statistical significance.
