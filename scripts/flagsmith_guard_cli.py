"""Token-efficient Flagsmith Guard CLI powering the flagsmith-experiment-guard Agent Skill."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys
from typing import Any

REPO_ROOT = Path(__file__).resolve().parent.parent
BACKEND_DIR = REPO_ROOT / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.core.config import Settings, get_settings  # noqa: E402
from app.experiments.flagsmith_client import FlagsmithManagementClient  # noqa: E402

BLOCKED_ENVIRONMENTS = {"production", "prod", "study", "live"}
ALLOWLISTED_WRITE_ENVIRONMENTS = {"pilot", "staging", "development", "dev"}


def _compact_json(payload: dict[str, Any]) -> str:
    """Emit minimal single-line JSON for maximum LLM token efficiency."""
    return json.dumps(payload, separators=(",", ":"), sort_keys=True)


def _check_environment_safety(env_name: str, *, for_write: bool) -> str | None:
    normalized = env_name.strip().lower()
    if for_write:
        if normalized in BLOCKED_ENVIRONMENTS:
            return f"BLOCKED_ENVIRONMENT: '{env_name}' is protected and cannot be mutated by an agent."
        if normalized not in ALLOWLISTED_WRITE_ENVIRONMENTS:
            return f"UNALLOWLISTED_ENVIRONMENT: '{env_name}' is not in {sorted(ALLOWLISTED_WRITE_ENVIRONMENTS)}."
    return None


def _validate_weights(standard: float, guided: float) -> str | None:
    if standard < 0 or guided < 0 or standard > 100 or guided > 100:
        return "INVALID_WEIGHTS: weights must be between 0 and 100."
    if abs((standard + guided) - 100.0) > 0.01:
        return f"INVALID_WEIGHTS: standard ({standard}) + guided ({guided}) must equal 100."
    return None


def run_cli_command(
    args: argparse.Namespace,
    *,
    settings: Settings | None = None,
    mgmt_client: FlagsmithManagementClient | None = None,
) -> tuple[int, dict[str, Any]]:
    """Execute one token-efficient guard CLI command and return (exit_code, compact_payload)."""
    cfg = settings or get_settings()
    env_id = (getattr(args, "env_id", "") or "").strip() or cfg.flagsmith_pilot_env_id
    feature = (getattr(args, "feature", "") or "").strip() or cfg.flagsmith_pilot_feature_name
    env_name = (getattr(args, "env_name", "") or "Pilot").strip()

    client = mgmt_client or FlagsmithManagementClient(
        management_token=cfg.flagsmith_management_token,
        admin_api_url=cfg.flagsmith_admin_api_url,
    )

    if args.command == "inspect":
        snap = client.read_pilot_flag(environment_id=env_id, feature_name=feature)
        return 0, {
            "ok": True,
            "env": env_name,
            "feature": snap.feature_name,
            "enabled": snap.enabled,
            "weights": snap.multivariate_weights,
            "config_hash": snap.config_hash,
        }

    if args.command == "preflight":
        env_err = _check_environment_safety(env_name, for_write=True)
        if env_err:
            return 2, {"ok": False, "code": "BLOCKED_ENVIRONMENT", "error": env_err}
        weight_err = _validate_weights(args.standard, args.guided)
        if weight_err:
            return 2, {"ok": False, "code": "INVALID_WEIGHTS", "error": weight_err}

        snap = client.read_pilot_flag(environment_id=env_id, feature_name=feature)
        if args.baseline_hash and snap.config_hash != args.baseline_hash:
            return 2, {
                "ok": False,
                "code": "STALE_CONFIG_HASH",
                "expected": args.baseline_hash,
                "actual": snap.config_hash,
            }
        return 0, {
            "ok": True,
            "env": env_name,
            "feature": feature,
            "config_hash": snap.config_hash,
            "before": snap.multivariate_weights,
            "after": {"standard": float(args.standard), "guided": float(args.guided)},
            "requires_human_approval": True,
        }

    if args.command == "apply":
        env_err = _check_environment_safety(env_name, for_write=True)
        if env_err:
            return 2, {"ok": False, "code": "BLOCKED_ENVIRONMENT", "error": env_err}
        if not (args.approved_by or "").strip():
            return 2, {
                "ok": False,
                "code": "APPROVAL_REQUIRED",
                "error": "--approved-by <operator> is mandatory before applying Flagsmith changes.",
            }
        weight_err = _validate_weights(args.standard, args.guided)
        if weight_err:
            return 2, {"ok": False, "code": "INVALID_WEIGHTS", "error": weight_err}

        snap = client.read_pilot_flag(environment_id=env_id, feature_name=feature)
        if snap.config_hash != args.baseline_hash:
            return 2, {
                "ok": False,
                "code": "STALE_CONFIG_HASH",
                "expected": args.baseline_hash,
                "actual": snap.config_hash,
            }

        desired = {"standard": float(args.standard), "guided": float(args.guided)}
        client.update_pilot_multivariate_weights(env_id, snap, desired)
        readback = client.read_pilot_flag(environment_id=env_id, feature_name=feature)
        verified = (
            abs(readback.multivariate_weights.get("guided", -1.0) - desired["guided"]) < 0.01
            and abs(readback.multivariate_weights.get("standard", -1.0) - desired["standard"]) < 0.01
        )
        return (0 if verified else 1), {
            "ok": verified,
            "status": "verified" if verified else "mismatch",
            "env": env_name,
            "feature": feature,
            "approved_by": args.approved_by.strip(),
            "weights": readback.multivariate_weights,
            "new_config_hash": readback.config_hash,
        }

    if args.command == "verify":
        snap = client.read_pilot_flag(environment_id=env_id, feature_name=feature)
        matched = (
            abs(snap.multivariate_weights.get("guided", -1.0) - float(args.expected_guided)) < 0.01
            and abs(snap.multivariate_weights.get("standard", -1.0) - float(args.expected_standard)) < 0.01
        )
        return (0 if matched else 1), {
            "ok": matched,
            "env": env_name,
            "feature": feature,
            "weights": snap.multivariate_weights,
            "config_hash": snap.config_hash,
        }

    return 2, {"ok": False, "error": f"Unknown command: {args.command}"}


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="flagsmith_guard_cli",
        description="Token-efficient Flagsmith Guard CLI for Agent Skills (inspect/preflight/apply/verify).",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    for name in ("inspect", "preflight", "apply", "verify"):
        p = sub.add_parser(name)
        p.add_argument("--env-name", default="Pilot", help="Logical environment name (Production/Study blocked for writes)")
        p.add_argument("--env-id", default="", help="Override FLAGSMITH_PILOT_ENV_ID")
        p.add_argument("--feature", default="recall_response_flow", help="Flagsmith feature name")
        if name in ("preflight", "apply"):
            p.add_argument("--baseline-hash", required=(name == "apply"), default="", help="Expected SHA-256 baseline hash")
            p.add_argument("--standard", type=float, required=True, help="Desired weight % for standard")
            p.add_argument("--guided", type=float, required=True, help="Desired weight % for guided")
        if name == "apply":
            p.add_argument("--approved-by", default="", help="Human operator name approving this change")
        if name == "verify":
            p.add_argument("--expected-standard", type=float, required=True)
            p.add_argument("--expected-guided", type=float, required=True)

    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    code, payload = run_cli_command(args)
    print(_compact_json(payload))
    raise SystemExit(code)


if __name__ == "__main__":
    main()
