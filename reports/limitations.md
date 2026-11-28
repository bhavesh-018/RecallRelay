# RecallRelay · Known Boundaries & Limitations

1. **Fictional Drill Scope (Not Regulatory Production Software):**
   - All supply-chain datasets (`food_drill.json`, `second_drill.json`, `demo_large_drill.json`) are fictional training fixtures. Real-world food or pharmaceutical recall deployment would require formal domain compliance review (e.g., FSSAI / FDA traceability rules), ERP/WMS integration, and legal sign-off.
2. **Small-Sample Experiment Uncertainty:**
   - The frozen Track 1 cohort contains `27` valid exposed human sessions (`18` `standard`, `9` `guided`; `22` verified completions). While `guided` showed a `+11.11pp` higher completion rate (`88.89%` vs. `77.78%`), the sample is too small for formal statistical significance and should be treated as directional pilot evidence warranting a larger follow-up cohort.
3. **Dense Notice Text Driving Reading Errors:**
   - Ground-truth validation on `/join` remained strictly frozen throughout the study to preserve experimental integrity. Several participants entered mathematically balanced but factually mismatched splits (e.g., swapping sold and remaining quantities), highlighting that visual callout badges for notice quantities should be tested in a future iteration.
4. **Self-Hosted Open-Source Flagsmith Events Boundary:**
   - Open-source self-hosted Flagsmith (`docker compose --profile flagsmith up -d` on `localhost:8000`) serves multivariate flag evaluations deterministically (`8/8` verified across `standard` and `guided`), but returns `405` on Flagsmith Cloud's separate Events ingestion microservice (`events.api.flagsmith.com`). RecallRelay mitigates this via its durable PostgreSQL `EventOutbox` and `scripts/export_results.py`, ensuring full local reproducibility even when running completely self-hosted.
5. **Narrow Agent Write Scope by Design:**
   - Both the Track 2 bounded product agent (`Agent Workbench`) and the Track 4 `flagsmith-experiment-guard` Agent Skill intentionally restrict writes to non-production environments (`Pilot / recall_response_flow`) with mandatory human approval and SHA-256 baseline drift locking. Autonomous production flag rollouts are explicitly out of scope.
6. **Quick Tunnel Hosting for Live Recruitment:**
   - Live human recruitment used an ephemeral `cloudflared` HTTPS quick tunnel backed by local Docker PostgreSQL. Production deployment would use managed PostgreSQL, a fixed HTTPS domain, and persistent background workers.
