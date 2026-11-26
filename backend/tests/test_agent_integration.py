"""Phase 12 tests: Flagsmith Management API apply, readback verification, stale conflict, and timeout recovery."""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Generator, Mapping

from fastapi.testclient import TestClient
import httpx
import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.core.database import Base, create_engine_for_url, create_session_factory, get_db
from app.experiments.flagsmith_client import PilotFlagSnapshot, compute_pilot_config_hash
from app.main import create_app
from app.models.domain import AuditEvent, DrillSession
from app.proposals.router import get_llm_callable, get_mgmt_client


class WritableStubMgmtClient:
    """Stub Flagsmith Management API supporting reads, writes, and simulated write timeouts."""

    def __init__(self) -> None:
        self.weights: dict[str, float] = {"standard": 50.0, "guided": 50.0}
        self.write_calls = 0
        self.timeout_after_applying = False

    def read_pilot_flag(self, environment_id: str, feature_name: str = "recall_response_flow") -> PilotFlagSnapshot:
        return PilotFlagSnapshot(
            environment_id=environment_id,
            feature_name=feature_name,
            feature_state_id=999,
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
        if self.timeout_after_applying:
            raise httpx.ReadTimeout("Upstream timed out after committing change")
        return self.read_pilot_flag(environment_id, snapshot.feature_name)


@pytest.fixture()
def integration_env(tmp_path: Path) -> Generator[dict[str, Any], None, None]:
    """Isolated environment wired with WritableStubMgmtClient and a valid proposal LLM."""
    db_url = f"sqlite:///{tmp_path / 'test_agent_int.db'}"
    engine = create_engine_for_url(db_url)
    Base.metadata.create_all(bind=engine)
    session_factory = create_session_factory(db_url)

    with session_factory() as db:
        now = datetime.now(timezone.utc)
        db.add(
            DrillSession(
                id="sess_pilot_1",
                participant_alias="P-01",
                scenario_id="isolated_shop_b17",
                identity="practice_p1",
                scoped_token="tok_p1",
                variant="guided",
                exposure_at=now,
                started_at=now,
                validity_status="valid",
                is_practice=True,
                expected_received=15,
                expected_forwarded=0,
                expected_sold=5,
                expected_remaining=10,
                expected_set_aside=10,
                attempts=1,
                incorrect_attempts=0,
                completed_seconds=38.0,
                outcome="success",
            )
        )
        db.commit()

    mgmt = WritableStubMgmtClient()

    def valid_llm(_prompt: str, _errs: list[str]) -> tuple[dict[str, Any], dict[str, Any]]:
        snap = mgmt.read_pilot_flag("pilot-env-1")
        return (
            {
                "target_environment": "Pilot",
                "target_feature": "recall_response_flow",
                "baseline_config_hash": snap.config_hash,
                "recommendation_type": "change_workflow",
                "desired_variant": "guided",
                "evidence_ids": ["sess_pilot_1"],
                "observed_counts": {
                    "standard_exposed_n": 0,
                    "standard_success_n": 0,
                    "guided_exposed_n": 1,
                    "guided_success_n": 1,
                },
                "rationale": "Guided workflow completed cleanly in Pilot drill evidence.",
            },
            {"totalTokens": 180},
        )

    settings = Settings(
        app_env="test",
        database_url=db_url,
        operator_secret="int-op-secret",
        flagsmith_pilot_env_id="pilot-env-1",
    )
    app = create_app(settings)

    def _override_get_db() -> Generator[Session, None, None]:
        with session_factory() as session:
            yield session

    app.dependency_overrides[get_db] = _override_get_db
    app.dependency_overrides[get_settings] = lambda: settings
    app.dependency_overrides[get_mgmt_client] = lambda: mgmt
    app.dependency_overrides[get_llm_callable] = lambda: valid_llm

    with TestClient(app) as client, session_factory() as verify_db:
        login = client.post("/api/operator/login", json={"secret": "int-op-secret"})
        headers = {"Authorization": f"Bearer {login.json()['token']}"}
        yield {"client": client, "db": verify_db, "headers": headers, "mgmt": mgmt}


def test_unapproved_apply_blocked_and_approved_apply_verifies_idempotently(
    integration_env: dict[str, Any],
) -> None:
    """Unapproved apply is denied; approved apply writes once, reads back, and is idempotent."""
    client: TestClient = integration_env["client"]
    db: Session = integration_env["db"]
    headers = integration_env["headers"]
    mgmt: WritableStubMgmtClient = integration_env["mgmt"]

    prop = client.post("/api/agent/runs", headers=headers, json={"drill_id": "B17"}).json()["proposal"]
    prop_id = prop["id"]

    # Unapproved write denied
    denied = client.post(f"/api/agent/proposals/{prop_id}/apply", headers=headers, json={"revision": 1})
    assert denied.status_code == 409
    assert denied.json()["detail"]["code"] == "UNAPPROVED_PROPOSAL"
    assert mgmt.write_calls == 0

    # Approve then apply
    assert client.post(f"/api/agent/proposals/{prop_id}/approve", headers=headers, json={"revision": 1}).status_code == 200
    applied = client.post(f"/api/agent/proposals/{prop_id}/apply", headers=headers, json={"revision": 1})
    assert applied.status_code == 200
    data = applied.json()
    assert data["status"] == "verified"
    assert data["readback_weights"] == {"standard": 0.0, "guided": 100.0}
    assert mgmt.write_calls == 1

    # Repeat apply is idempotent — zero second write
    repeat = client.post(f"/api/agent/proposals/{prop_id}/apply", headers=headers, json={"revision": 1})
    assert repeat.status_code == 200
    assert repeat.json()["idempotent_reused"] is True
    assert mgmt.write_calls == 1

    actions = [
        ev.action
        for ev in db.scalars(
            select(AuditEvent).where(AuditEvent.entity_id == prop_id).order_by(AuditEvent.id.asc())
        ).all()
    ]
    assert "apply_intent" in actions
    assert "verify_applied_change" in actions


def test_timeout_after_upstream_write_reconciles_via_readback_without_duplicate_write(
    integration_env: dict[str, Any],
) -> None:
    """Timeout after upstream commit reconciles cleanly to verified via readback."""
    client: TestClient = integration_env["client"]
    headers = integration_env["headers"]
    mgmt: WritableStubMgmtClient = integration_env["mgmt"]

    prop_id = client.post("/api/agent/runs", headers=headers, json={"drill_id": "B17"}).json()["proposal"]["id"]
    assert client.post(f"/api/agent/proposals/{prop_id}/approve", headers=headers, json={"revision": 1}).status_code == 200

    mgmt.timeout_after_applying = True
    res = client.post(f"/api/agent/proposals/{prop_id}/apply", headers=headers, json={"revision": 1})
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "verified"
    assert body["reconciled_after_timeout"] is True
    assert mgmt.write_calls == 1


def test_stale_drift_between_approval_and_apply_blocks_write(
    integration_env: dict[str, Any],
) -> None:
    """Config drift after approval blocks apply with 409 STALE_CONFIG_HASH and zero writes."""
    client: TestClient = integration_env["client"]
    headers = integration_env["headers"]
    mgmt: WritableStubMgmtClient = integration_env["mgmt"]

    prop_id = client.post("/api/agent/runs", headers=headers, json={"drill_id": "B17"}).json()["proposal"]["id"]
    assert client.post(f"/api/agent/proposals/{prop_id}/approve", headers=headers, json={"revision": 1}).status_code == 200

    # External drift occurs after approval
    mgmt.weights = {"standard": 30.0, "guided": 70.0}
    res = client.post(f"/api/agent/proposals/{prop_id}/apply", headers=headers, json={"revision": 1})
    assert res.status_code == 409
    assert res.json()["detail"]["code"] == "STALE_CONFIG_HASH"
    assert mgmt.write_calls == 0
