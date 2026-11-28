---
name: flagsmith-experiment-guard
description: Safely inspect, preflight-check, update, and verify Flagsmith multivariate experiment flags using a token-efficient CLI with mandatory production/study protection, SHA-256 drift locking, and human approval gates. Use when an AI coding agent needs to audit a Flagsmith experiment flag or apply an operator-approved weight rollout in a non-production environment like Pilot or Staging.
---

# Flagsmith Experiment Guard Skill

A compact, safety-first Agent Skill for managing Flagsmith multivariate flags end-to-end (**Inspect → Preflight → Human-Approved Apply → Verify**) without wasting context tokens on verbose API payloads or risking accidental production/study mutations.

## When to Use This Skill
- Inspecting live Flagsmith multivariate feature weights and computing a deterministic SHA-256 baseline hash.
- Verifying that a target environment is allowlisted (never `Production` or frozen `Study`) before proposing a rollout.
- Applying a human-approved multivariate weight change (Flagsmith Cloud v2 Feature Versioning or v1/self-hosted) and running independent post-write readback verification.

## Hard Safety Rules (NEVER Bypass)
1. **Never mutate `Production` or `Study`:** The CLI hard-blocks any write targeting `Production`, `Prod`, or `Study` (`exit code 2`). Only allowlisted non-production environments (default: `Pilot`) are writable.
2. **Always lock on `baseline_config_hash`:** Never run `apply` without first running `inspect` and passing the exact `--baseline-hash` returned. If Flagsmith drifted externally, abort immediately.
3. **Never run `apply` without explicit human approval:** Always present the compact diff (`current_weights -> desired_weights`) and wait for explicit operator confirmation before passing `--approved-by <name>`.
4. **Always run `verify` after `apply`:** Confirm independent readback matches desired weights before reporting success.

## Token-Efficient CLI Workflow

All commands emit compact single-line JSON (`~120–250` bytes instead of multi-kilobyte raw Flagsmith API responses) to minimize LLM context usage.

### Step 1: Inspect Current Flag State & Baseline Hash
```bash
python scripts/flagsmith_guard_cli.py inspect \
  --env-name Pilot \
  --feature recall_response_flow
```
Returns compact JSON:
```json
{"ok":true,"env":"Pilot","feature":"recall_response_flow","enabled":true,"weights":{"guided":50.0,"standard":50.0},"config_hash":"sha256:..."}
```

### Step 2: Run Safety Preflight (Production Guard + Drift Check)
```bash
python scripts/flagsmith_guard_cli.py preflight \
  --env-name Pilot \
  --feature recall_response_flow \
  --baseline-hash "sha256:..." \
  --guided 100 --standard 0
```
- Exits `0` only if the environment is allowlisted, weights sum to `100.0`, and the live `config_hash` still matches `--baseline-hash`.
- Exits `2` on blocked environments (`Production`/`Study`), invalid weights, or hash drift (`STALE_CONFIG_HASH`).

### Step 3: Present Diff & Request Human Approval
Show the user:
- Target environment & feature (`Pilot / recall_response_flow`)
- `Before` → `After` weights
- `baseline_config_hash`
Wait for explicit user confirmation.

### Step 4: Apply & Independently Verify
```bash
python scripts/flagsmith_guard_cli.py apply \
  --env-name Pilot \
  --feature recall_response_flow \
  --baseline-hash "sha256:..." \
  --guided 100 --standard 0 \
  --approved-by "<operator_name>"
```
Automatically publishes via Flagsmith Cloud v2 Feature Versioning (or classic v1/self-hosted PUT), re-reads Flagsmith independently, and returns `{"ok":true,"status":"verified",...}`.

### Step 5: Standalone Verification (Optional / Post-Timeout Recovery)
```bash
python scripts/flagsmith_guard_cli.py verify \
  --env-name Pilot \
  --feature recall_response_flow \
  --expected-guided 100 --expected-standard 0
```
