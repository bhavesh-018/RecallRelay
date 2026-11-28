"""Track 4 tests: flagsmith-experiment-guard Agent Skill & token-efficient CLI safety gates."""

from __future__ import annotations

from pathlib import Path
import sys
from typing import Mapping

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from app.core.config import Settings
from app.experiments.flagsmith_client import PilotFlagSnapshot, compute_pilot_config_hash
from scripts.flagsmith_guard_cli import _compact_json, build_parser, run_cli_command


class StubGuardMgmtClient:
    """In-memory Flagsmith Management stub for testing CLI safety & readback."""

    def __init__(self) -> None:
        self.weights: dict[str, float] = {"standard": 50.0, "guided": 50.0}
        self.write_calls = 0

    def read_pilot_flag(self, environment_id: str, feature_name: str = "recall_response_flow") -> PilotFlagSnapshot:
        return PilotFlagSnapshot(
            environment_id=environment_id,
            feature_name=feature_name,
            feature_state_id=1882416,
            enabled=True,
            default_value="standard",
            multivariate_weights=dict(self.weights),
            config_hash=compute_pilot_config_hash(True, "standard", self.weights),
            raw={},
        )

    def update_pilot_multivariate_weights(
        self,
        environment_id: str,
        snapshot: PilotFlagSnapshot,
        desired_weights: Mapping[str, float],
    ) -> PilotFlagSnapshot:
        self.write_calls += 1
        self.weights = {str(k): float(v) for k, v in desired_weights.items()}
        return self.read_pilot_flag(environment_id, snapshot.feature_name)


def test_skill_blocks_production_and_study_writes_and_unapproved_apply() -> None:
    """Guard CLI blocks Production/Study mutations and requires explicit human approval."""
    parser = build_parser()
    mgmt = StubGuardMgmtClient()
    cfg = Settings(flagsmith_pilot_env_id="pilot-env-1")

    # 1. Production blocked
    code, res = run_cli_command(
        parser.parse_args(["preflight", "--env-name", "Production", "--standard", "0", "--guided", "100"]),
        settings=cfg,
        mgmt_client=mgmt,
    )
    assert code == 2 and res["code"] == "BLOCKED_ENVIRONMENT"

    # 2. Study blocked
    code, res = run_cli_command(
        parser.parse_args(["preflight", "--env-name", "Study", "--standard", "0", "--guided", "100"]),
        settings=cfg,
        mgmt_client=mgmt,
    )
    assert code == 2 and res["code"] == "BLOCKED_ENVIRONMENT"

    # 3. Inspect produces compact token-efficient JSON (< 260 bytes)
    code, inspected = run_cli_command(
        parser.parse_args(["inspect", "--env-name", "Pilot"]),
        settings=cfg,
        mgmt_client=mgmt,
    )
    assert code == 0 and inspected["ok"] is True
    assert len(_compact_json(inspected)) < 260
    baseline_hash = inspected["config_hash"]

    # 4. Missing human approval blocked with zero writes
    code, unapproved = run_cli_command(
        parser.parse_args(
            ["apply", "--env-name", "Pilot", "--baseline-hash", baseline_hash, "--standard", "0", "--guided", "100"]
        ),
        settings=cfg,
        mgmt_client=mgmt,
    )
    assert code == 2 and unapproved["code"] == "APPROVAL_REQUIRED"
    assert mgmt.write_calls == 0

    # 5. Stale hash drift blocked with zero writes
    code, stale = run_cli_command(
        parser.parse_args(
            [
                "apply",
                "--env-name",
                "Pilot",
                "--baseline-hash",
                "sha256:drifted",
                "--standard",
                "0",
                "--guided",
                "100",
                "--approved-by",
                "bhavesh",
            ]
        ),
        settings=cfg,
        mgmt_client=mgmt,
    )
    assert code == 2 and stale["code"] == "STALE_CONFIG_HASH"
    assert mgmt.write_calls == 0


def test_skill_completes_full_inspect_preflight_apply_verify_workflow() -> None:
    """Full end-to-end Pilot rollout completes cleanly with independent readback verification."""
    parser = build_parser()
    mgmt = StubGuardMgmtClient()
    cfg = Settings(flagsmith_pilot_env_id="pilot-env-1")

    code, inspected = run_cli_command(parser.parse_args(["inspect", "--env-name", "Pilot"]), settings=cfg, mgmt_client=mgmt)
    assert code == 0
    h = inspected["config_hash"]

    code, pre = run_cli_command(
        parser.parse_args(["preflight", "--env-name", "Pilot", "--baseline-hash", h, "--standard", "0", "--guided", "100"]),
        settings=cfg,
        mgmt_client=mgmt,
    )
    assert code == 0 and pre["requires_human_approval"] is True

    code, applied = run_cli_command(
        parser.parse_args(
            [
                "apply",
                "--env-name",
                "Pilot",
                "--baseline-hash",
                h,
                "--standard",
                "0",
                "--guided",
                "100",
                "--approved-by",
                "bhavesh",
            ]
        ),
        settings=cfg,
        mgmt_client=mgmt,
    )
    assert code == 0 and applied["status"] == "verified"
    assert mgmt.write_calls == 1

    code, verified = run_cli_command(
        parser.parse_args(["verify", "--env-name", "Pilot", "--expected-standard", "0", "--expected-guided", "100"]),
        settings=cfg,
        mgmt_client=mgmt,
    )
    assert code == 0 and verified["ok"] is True
    assert (REPO_ROOT / "skills" / "flagsmith-experiment-guard" / "SKILL.md").exists()
