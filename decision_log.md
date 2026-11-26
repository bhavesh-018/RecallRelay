# RecallRelay · Architectural Decision Log (`decision_log.md`)

| ID | Date | Decision | Rationale | Impact / Boundaries |
| --- | --- | --- | --- | --- |
| **ADR-001** | 2026-11-26 | Server-side Flagsmith evaluation via Python SDK (`>=6.3.0`) | Prevents client/server identity splits, premature exposures before pressing Start, and client-forged conversion events. | Frontend renders variant returned by FastAPI; `EventOutbox` persists events before dispatch. |
| **ADR-002** | 2026-11-26 | Run FastAPI locally on port `8080` (Vite on `5173`) | Flagsmith self-hosted Docker Compose binds `8000` (`flagsmith`) and `8001` (`flagsmith-task-processor`). | Vite dev server proxies `/api` to `http://localhost:8080`. |
| **ADR-003** | 2026-11-26 | Use `cloudflared` quick HTTPS tunnel + `/join` entry route | Gives phones instant HTTPS access without separate cloud DB delays; `/join` enables zero-friction remote study onboarding alongside `/t/<token>` QR box links. | QR generation derives host dynamically from `PUBLIC_BASE_URL` or active request origin; `/join` stores 1 session per browser. |
| **ADR-004** | 2026-11-26 | Isolate `Study` vs. `Pilot` Flagsmith environments | Keeps Track 1 participant study frozen and uncontaminated while Track 2 AI agent applies and verifies real configuration writes in `Pilot`. | Agent allowlist permits writes only to `Pilot / recall_response_flow`. |
