# RecallRelay · Repository Conventions (`AGENTS.md`)

> Single source of truth for domain rules and milestones: `docs/RecallRelay_3_Day_Roadmap.md`.

## 1. Branching, Commits & Verification
- **Never** commit or edit directly on `main`. Always work on `feature/<work-name>` branched from `main` (e.g., `feature/flagsmith-spike`, `feature/domain-foundation` — do not include `phase-` in branch names).
- Use atomic **Conventional Commits** (`feat:`, `fix:`, `test:`, `refactor:`, `chore:`, `docs:`).
- AI agent commits, pushes the feature branch to `origin`, pulls latest `main` before new branches, and provides the **PR Title & Description**; the human owner merges PRs into `main` on GitHub.
- Every slice must pass automated verification before moving on or opening a PR:
  - Backend: `backend/.venv/Scripts/python.exe -m pytest`
  - Frontend: `npx tsc -b && npm test && npm run build`

## 2. Module Boundaries & Ownership
```text
backend/
  app/
    core/            # Settings, DB engine/session, auth helpers
    models/          # SQLAlchemy ORM models & Alembic migrations
    shipments/       # Locations, batches, shipment trace & transfer checks
    recalls/         # Recall publish (idempotent), scoped task tokens, /join
    reconciliation/  # Deterministic stock accounting & validation
    experiments/     # Flagsmith Python SDK adapter, DrillSession, EventOutbox, CSV export
    proposals/       # Bounded AI agent tools, validator, approval, Management API apply
  tests/             # pytest unit, integration, and agent evaluation suites
frontend/
  src/
    components/RecallFlow/  # Reusable fixture-agnostic standard & guided UI (Track 3)
    pages/operator/         # Overview, Batch Trace, Publish, Experiment Summary, Agent Workbench
    pages/participant/      # Scoped QR task, /join, Response Receipt
    api/                    # Typed FastAPI client
fixtures/
  food_drill.json           # Primary 5-location demo (B17 recalled, B18 unaffected)
  second_drill.json         # Track 3 second dataset verifying zero hardcoded assumptions
```

## 3. Non-Negotiable Domain & Engineering Invariants
1. **Accounting equation:** `opening_or_received = forwarded + sold + remaining`, with `0 <= set_aside <= remaining`. Forwarded and set-aside units are never double-counted at batch level.
2. **Idempotency:** Recall publish, task reopen, and response submission/double-click preserve one logical task and one logical response (revisions append audit records).
3. **Experimentation discipline:**
   - Remote evaluation and verified outcome events run server-side via `flagsmith >= 6.3.0`.
   - Use the **exact same pseudonymous identity** for assignment, exposure, and outcome events.
   - Server timestamps enforce the **300-second** primary window; persist events to `EventOutbox` before dispatch.
   - Keep `Study` (real participant data) strictly isolated from `Pilot`, `practice`, operator, and agent runs.
4. **Bounded AI agent:** Allowlisted read/preview/validate tools + `Pilot` environment only. Human operator approval + exact revision + baseline config hash match are required before any Flagsmith Management API write, followed by readback verification.
5. **UI & Design System:**
   - Linear/Datadog-inspired dark mode (`#09090B` canvas, `#18181B` cards, `#27272A` borders, `#EDEDED` text, `#3B82F6` primary accent). No neon glows or cheesy gradients.
   - Every participant page must clearly display **"Fictional recall drill."**

## 4. Local Port Allocation
- Flagsmith Self-Hosted Docker UI/API: `8000` (Task processor: `8001`)
- RecallRelay FastAPI Backend: `8080`
- RecallRelay Vite Frontend: `5173` (proxying `/api` -> `http://localhost:8080`)
