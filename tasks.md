# RecallRelay · Implementation Task Tracker (`tasks.md`)

## Technical Coverage Gates (All 3 Tracks)
- **Track 1 (Test Something Real):** Multivariate flag `recall_response_flow` (`standard` vs. `guided`), real participant exposures/conversions, 300s cutoff, `EventOutbox`, deidentified CSV export.
- **Track 2 (AI Agents & Feature Flags):** Bounded tool loop (8 calls / 2 revisions / 60s), deterministic evidence validator, human approval + baseline hash lock, real Flagsmith Management API write/readback in `Pilot`, 9 evaluation scenarios + timing trials.
- **Track 3 (Build on Open Source Flagsmith):** Fixture-agnostic `RecallFlow` + reconciliation backend, `second_drill.json` verified without core code edits, documented self-hosted Flagsmith Docker Compose evaluation + events.

---

## Day 1 · November 26 — Complete Recall Path
- [x] **Pre-Kickoff:** Git `main` initialized, Flagsmith Docker smoke-tested, Cloud `Study`/`Pilot` keys ready, `cloudflared` installed.
- [x] **Phase 1 (`feature/phase-1-setup`):** `AGENTS.md`, `tasks.md`, `decision_log.md`, FastAPI `:8080` + pytest baseline, React/TS/Vite/Tailwind dark theme baseline.
- [x] **Phase 2 (`feature/flagsmith-spike`):** Flagsmith Python SDK (`>=6.3.0`) remote evaluation, practice `standard`/`guided` exposure + `track_event`, LLM + Management API smoke check. *(90-min timebox on self-hosted events before Cloud study fallback.)*
- [x] **Phase 3 (`feature/domain-foundation`):** PostgreSQL schema + Alembic, 5-location + `B17`/`B18` seed, shipment trace API, accounting checks, operator auth.
- [x] **Phase 4 (`feature/recall-lifecycle`):** Idempotent publish, batch-filtered task generation, scoped tokens, `/join` auto-session entry, response revisions, audit history.
- [x] **Phase 5 (`feature/vertical-ui`):** Operator overview (`<=5s` polling), batch trace view, publish screen, reusable `RecallFlow` (`standard` mode) + receipt, Playwright E2E.
- [ ] **Phase 6 (`feature/access-integration`):** Host-aware QR URLs, practice-only reset endpoint, `cloudflared` HTTPS mobile test, Day 1 Gate.

## Day 2 · November 27 — Experiment & Bounded Agent
- [ ] **Phase 7 (`feature/phase-7-guided-workflow`):** `RecallFlow` `guided` step-by-step mode + Playwright mobile checks.
- [ ] **Phase 8 (`feature/phase-8-verified-measurement`):** `DrillSession` identity, 300s cutoff, `EventOutbox`, unique success, CSV export.
- [ ] **Phase 9 (`feature/phase-9-practice-freeze`):** 2–4 practice testers, wording fixes, freeze `Study` configuration.
- [ ] **Phase 10 (Live Ops):** Study Block 1 collection (frozen codebase).
- [ ] **Phase 11 (`feature/phase-11-agent-workbench`):** Evidence tools, bounded LLM orchestrator, deterministic validator, Agent Workbench UI.
- [ ] **Phase 12 (`feature/phase-12-agent-integration`):** Flagsmith Management API apply/readback, stale-hash recovery, self-hosted config recovery, Study Block 2.

## Day 3 · November 28 — Verification, Reuse & Freeze
- [ ] **Phase 13 (`feature/phase-13-reliability-evals`):** 9 adversarial agent eval scenarios, accounting/outbox hardening.
- [ ] **Phase 14 (Live Ops):** Remaining study collection toward 30–40 target.
- [ ] **Phase 15 (`feature/phase-15-reuse-second-fixture`):** `fixtures/second_drill.json`, reuse tests, manual-vs-assisted timing trials.
- [ ] **Phase 16 (`feature/phase-16-reproducibility`):** Docker Compose, migrations, seed/reset scripts, `README.md`, license check, clean self-hosted verification.
- [ ] **Phases 17–19 (`feature/phase-17-19-freeze`):** 4 PM study close, `docs/results.md`, `docs/limitations.md`, release verification, `v1.0.0` freeze by 8 PM IST.
