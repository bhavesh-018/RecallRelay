# RecallRelay · Implementation Task Tracker (`tasks.md`)

## Technical Coverage Gates (All 3 Tracks)
- **Track 1 (Test Something Real):** Multivariate flag `recall_response_flow` (`standard` vs. `guided`), real participant exposures/conversions (Flagsmith Cloud Experiment `#718`), 300s cutoff, `EventOutbox`, deidentified CSV export (`scripts/export_results.py`).
- **Track 2 (AI Agents & Feature Flags):** Bounded tool loop (8 calls / 2 revisions / 60s), deterministic evidence validator, human approval + baseline hash lock, live Flagsmith Management API v2 write/readback in `Pilot` (`prop_d7bf6870ad13`), 9/9 adversarial evaluation suite.
- **Track 3 (Build on Open Source Flagsmith):** Fixture-agnostic `<RecallFlow />` + reconciliation backend, `second_drill.json` (cold-chain) and `demo_large_drill.json` (16-location 3-tier) verified without core code edits, live self-hosted Flagsmith Docker Compose (`localhost:8000`) serving both variants.

---

## Day 1 · November 26 — Complete Recall Path
- [x] **Pre-Kickoff:** Git `main` initialized, Flagsmith Docker smoke-tested, Cloud `Study`/`Pilot` keys ready, `cloudflared` installed.
- [x] **Phase 1 (`feature/phase-1-setup`):** `AGENTS.md`, `tasks.md`, `decision_log.md`, FastAPI `:8080` + pytest baseline, React/TS/Vite/Tailwind dark theme baseline.
- [x] **Phase 2 (`feature/flagsmith-spike`):** Flagsmith Python SDK (`>=6.3.0`) remote evaluation, practice `standard`/`guided` exposure + `track_event`, LLM + Management API smoke check.
- [x] **Phase 3 (`feature/domain-foundation`):** PostgreSQL schema + Alembic, 5-location + `B17`/`B18` seed, shipment trace API, accounting checks, operator auth.
- [x] **Phase 4 (`feature/recall-lifecycle`):** Idempotent publish, batch-filtered task generation, scoped tokens, `/join` auto-session entry, response revisions, audit history.
- [x] **Phase 5 (`feature/vertical-ui`):** Operator overview (`<=5s` polling), batch trace view, publish screen, reusable `RecallFlow` (`standard` mode) + receipt.
- [x] **Phase 6 (`feature/access-integration`):** Host-aware QR URLs, practice-only reset endpoint, `cloudflared` HTTPS mobile test, Day 1 Gate.

## Day 2 · November 27 — Experiment & Bounded Agent
- [x] **Phase 7 (`feature/guided-workflow`):** `RecallFlow` `guided` step-by-step mode.
- [x] **Phase 8 (`feature/verified-measurement`):** `DrillSession` identity, 300s cutoff, `EventOutbox`, unique success, CSV export.
- [x] **Phase 9–10 (`fix/live-api-headers` + `fix/flagsmith-v2-versioning`):** Live Flagsmith Cloud `Study` Experiment `#718` + `Pilot` v2 feature versioning + Gemini `3.5-flash-lite` verified; live study collection launched over HTTPS `cloudflared`.
- [x] **Phase 11 (`feature/agent-workbench`):** Evidence tools, bounded LLM orchestrator, deterministic validator, Agent Workbench UI.
- [x] **Phase 12 (`feature/agent-integration`):** Flagsmith Management API apply/readback, stale-hash recovery, live Pilot apply verified (`prop_d7bf6870ad13`), self-hosted Docker Compose profile verified on `localhost:8000`.

## Day 3 · November 28 — Verification, Reuse, UI Polish & Freeze
- [x] **Phase 13 (`feature/reliability-evals`):** 9 adversarial agent eval scenarios (`9 / 9 passed`), accounting/outbox hardening.
- [x] **Phase 15 (`feature/reuse-second-fixture` + `feature/demo-dataset-and-ui-polish`):** `fixtures/second_drill.json` (6-location cold-chain) + `fixtures/demo_large_drill.json` (16-location 3-tier), reuse tests, full-bleed enterprise Dark/Light UI overhaul (`feature/production-ui-overhaul`).
- [x] **Phase 16 (`feature/reproducibility` + `feature/release-docs`):** `README.md`, `LICENSE` (MIT), `scripts/export_results.py`, `reports/experiment_protocol.md`, `reports/agent_evidence.md`, clean self-hosted Flagsmith verification (`8/8` deterministic evaluations across both variants).
- [ ] **Phase 14 & 17–19 (`feature/release-freeze`):** Complete live Track 1 human study collection, freeze `reports/results.md` + `reports/limitations.md` from `scripts/export_results.py`, final audit, and tag `v1.0.0` before 8:00 PM IST.
