"""Phase 8 tests: 300s cutoff, reopen preservation, double-submit, EventOutbox retry, and CSV export."""

from __future__ import annotations

import csv
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from io import StringIO
from pathlib import Path
from typing import Any, Generator, Mapping

from fastapi.testclient import TestClient
import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.core.database import Base, create_engine_for_url, create_session_factory, get_db
from app.experiments.flagsmith_client import FlagsmithAdapter
from app.experiments.sessions_router import get_adapter_factory, get_clock
from app.main import create_app
from app.models.domain import EventOutbox


@dataclass
class StubExperiment:
    id: int = 77
    in_experiment: bool = True


@dataclass
class StubFlag:
    enabled: bool = True
    value: str = "guided"
    variant: str = "guided"
    experiment: StubExperiment | None = None
    is_default: bool = False


class ControllableFlagsmithClient:
    """Stub Flagsmith client supporting variant assignment, eval outage, and track outage."""

    def __init__(self) -> None:
        self.next_variant = "guided"
        self.fail_eval = False
        self.fail_track = False
        self.evals: list[tuple[str, str]] = []
        self.events: list[tuple[str, str | None, Any]] = []

    def get_experiment_flag(
        self,
        feature_name: str,
        identifier: str,
        traits: Mapping[str, Any] | None = None,
    ) -> StubFlag:
        self.evals.append((feature_name, identifier))
        if self.fail_eval:
            raise RuntimeError("Flagsmith evaluation timeout")
        return StubFlag(
            enabled=True,
            value=self.next_variant,
            variant=self.next_variant,
            experiment=StubExperiment(),
        )

    def track_event(
        self,
        event: str,
        identifier: str | None = None,
        value: Any = None,
        traits: Mapping[str, Any] | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> None:
        if self.fail_track:
            raise RuntimeError("Events endpoint unreachable")
        self.events.append((event, identifier, value))

    def flush_events(self) -> None:
        return None

    def close(self) -> None:
        return None


@pytest.fixture()
def exp_env(tmp_path: Path) -> Generator[dict[str, Any], None, None]:
    """Create isolated test client with controllable clock and Flagsmith client."""
    db_url = f"sqlite:///{tmp_path / 'test_exp.db'}"
    engine = create_engine_for_url(db_url)
    Base.metadata.create_all(bind=engine)
    session_factory = create_session_factory(db_url)

    clock_state = {"now": datetime(2026, 11, 27, 10, 0, 0, tzinfo=timezone.utc)}
    stub_client = ControllableFlagsmithClient()

    settings = Settings(app_env="test", database_url=db_url, operator_secret="exp-secret")
    app = create_app(settings)

    def _override_get_db() -> Generator[Session, None, None]:
        with session_factory() as session:
            yield session

    app.dependency_overrides[get_db] = _override_get_db
    app.dependency_overrides[get_settings] = lambda: settings
    app.dependency_overrides[get_adapter_factory] = lambda: (lambda _is_practice: FlagsmithAdapter(stub_client))
    app.dependency_overrides[get_clock] = lambda: (lambda: clock_state["now"])

    with TestClient(app) as client, session_factory() as db:
        login = client.post("/api/operator/login", json={"secret": "exp-secret"})
        assert login.status_code == 200
        headers = {"Authorization": f"Bearer {login.json()['token']}"}
        yield {
            "client": client,
            "db": db,
            "headers": headers,
            "clock": clock_state,
            "flagsmith": stub_client,
        }


def test_reopen_preserves_timer_and_double_submit_records_single_success(exp_env: dict[str, Any]) -> None:
    """Reopen keeps original variant & timer; double-submit creates only 1 logical success."""
    client: TestClient = exp_env["client"]
    db: Session = exp_env["db"]
    clock = exp_env["clock"]
    stub: ControllableFlagsmithClient = exp_env["flagsmith"]

    joined = client.post("/api/join", json={"is_practice": False}).json()
    token = joined["scoped_token"]
    identity = joined["identity"]

    stub.next_variant = "guided"
    started = client.post(f"/api/sessions/{token}/start").json()
    assert started["variant"] == "guided"
    assert started["remaining_seconds"] == 300.0

    # Advance 40s and reopen -> variant stays guided even if Flagsmith changed, timer is 260s
    clock["now"] += timedelta(seconds=40)
    stub.next_variant = "standard"
    reopened = client.post(f"/api/sessions/{token}/start").json()
    assert reopened["resumed"] is True
    assert reopened["variant"] == "guided"
    assert reopened["remaining_seconds"] == 260.0
    assert len(stub.evals) == 1

    # Acknowledge render
    assert client.post(f"/api/sessions/{token}/rendered").status_code == 200

    # Submit valid ground truth at t=45s
    clock["now"] += timedelta(seconds=5)
    valid_body = {
        "forwarded_qty": 0,
        "sold_qty": 5,
        "remaining_qty": 10,
        "set_aside_qty": 10,
        "confirmed_set_aside": True,
    }
    first = client.post(f"/api/sessions/{token}/submit", json=valid_body).json()
    assert first["outcome"] == "success"
    assert first["completed_seconds"] == 45.0
    assert first["idempotent_duplicate"] is False

    # Double-click submit returns idempotent duplicate without second success event
    dup = client.post(f"/api/sessions/{token}/submit", json=valid_body).json()
    assert dup["idempotent_duplicate"] is True

    success_outbox = list(
        db.scalars(select(EventOutbox).where(EventOutbox.event_name == "recall_drill_success")).all()
    )
    assert len(success_outbox) == 1
    assert success_outbox[0].identity == identity
    assert success_outbox[0].dispatch_status == "dispatched"


def test_correct_after_301_seconds_keeps_primary_timeout_outcome(exp_env: dict[str, Any]) -> None:
    """Late correct completion is stored for usability while primary metric stays timeout."""
    client: TestClient = exp_env["client"]
    db: Session = exp_env["db"]
    clock = exp_env["clock"]

    token = client.post("/api/join", json={"is_practice": False}).json()["scoped_token"]
    assert client.post(f"/api/sessions/{token}/start").status_code == 200

    # Advance past 300-second deadline
    clock["now"] += timedelta(seconds=301)
    res = client.post(
        f"/api/sessions/{token}/submit",
        json={
            "forwarded_qty": 0,
            "sold_qty": 5,
            "remaining_qty": 10,
            "set_aside_qty": 10,
            "confirmed_set_aside": True,
        },
    )
    assert res.status_code == 200
    data = res.json()
    assert data["outcome"] == "timeout"
    assert data["late_completion_recorded"] is True
    assert data["completed_seconds"] == 301.0

    # No recall_drill_success event may be emitted for a >300s submission
    success_rows = list(
        db.scalars(select(EventOutbox).where(EventOutbox.event_name == "recall_drill_success")).all()
    )
    assert len(success_rows) == 0


def test_outbox_retry_recovers_after_transient_dispatch_failure(exp_env: dict[str, Any]) -> None:
    """Transient Flagsmith event outage preserves outcome in outbox and succeeds on retry."""
    client: TestClient = exp_env["client"]
    headers = exp_env["headers"]
    stub: ControllableFlagsmithClient = exp_env["flagsmith"]

    token = client.post("/api/join", json={"is_practice": False}).json()["scoped_token"]
    assert client.post(f"/api/sessions/{token}/start").status_code == 200

    # Simulate Flagsmith event endpoint outage during submit
    stub.fail_track = True
    sub = client.post(
        f"/api/sessions/{token}/submit",
        json={
            "forwarded_qty": 0,
            "sold_qty": 5,
            "remaining_qty": 10,
            "set_aside_qty": 10,
            "confirmed_set_aside": True,
        },
    )
    assert sub.status_code == 200
    assert sub.json()["outcome"] == "success"

    summary_before = client.get("/api/experiments/summary").json()
    assert summary_before["outbox"]["failed"] >= 1

    # Recover network and flush outbox
    stub.fail_track = False
    flushed = client.post("/api/experiments/outbox/dispatch", headers=headers)
    assert flushed.status_code == 200
    assert flushed.json()["dispatched"] >= 1
    assert flushed.json()["pending_remaining"] == 0


def test_eval_outage_exclusions_and_csv_reproduces_raw_counts(exp_env: dict[str, Any]) -> None:
    """Summary & CSV exclude practice by default and match raw counts identically."""
    client: TestClient = exp_env["client"]
    headers = exp_env["headers"]
    clock = exp_env["clock"]
    stub: ControllableFlagsmithClient = exp_env["flagsmith"]

    # 1. Guided study success
    stub.next_variant = "guided"
    t1 = client.post("/api/join", json={"is_practice": False}).json()["scoped_token"]
    client.post(f"/api/sessions/{t1}/start")
    clock["now"] += timedelta(seconds=30)
    client.post(
        f"/api/sessions/{t1}/submit",
        json={"forwarded_qty": 0, "sold_qty": 5, "remaining_qty": 10, "set_aside_qty": 10, "confirmed_set_aside": True},
    )

    # 2. Standard study timeout
    stub.next_variant = "standard"
    t2 = client.post("/api/join", json={"is_practice": False}).json()["scoped_token"]
    client.post(f"/api/sessions/{t2}/start")
    clock["now"] += timedelta(seconds=310)
    client.post(f"/api/sessions/{t2}/finalize", json={"reason": "timeout"})

    # 3. Study session blocked by Flagsmith outage -> excluded_eval_error
    stub.fail_eval = True
    t3 = client.post("/api/join", json={"is_practice": False}).json()["scoped_token"]
    outage = client.post(f"/api/sessions/{t3}/start")
    assert outage.status_code == 503
    assert outage.json()["detail"]["code"] == "FLAGSMITH_UNAVAILABLE"

    # 4. Practice session -> excluded from default study summary & CSV
    stub.fail_eval = False
    tp = client.post("/api/join", json={"is_practice": True}).json()["scoped_token"]
    client.post(f"/api/sessions/{tp}/start")
    client.post(
        f"/api/sessions/{tp}/submit",
        json={"forwarded_qty": 0, "sold_qty": 5, "remaining_qty": 10, "set_aside_qty": 10, "confirmed_set_aside": True},
    )

    summary = client.get("/api/experiments/summary").json()
    assert summary["valid_exposed_n"] == 2
    assert summary["excluded_n"] == 1
    assert summary["exclusions_by_reason"]["excluded_eval_error"] == 1
    assert summary["variants"]["guided"]["success_n"] == 1
    assert summary["variants"]["guided"]["exposed_n"] == 1
    assert summary["variants"]["standard"]["timeout_n"] == 1
    assert summary["variants"]["standard"]["exposed_n"] == 1

    # Export CSV and verify it reproduces the exact numerator and denominator
    csv_resp = client.get("/api/experiments/export.csv", headers=headers)
    assert csv_resp.status_code == 200
    parsed = list(csv.DictReader(StringIO(csv_resp.text)))
    assert len(parsed) == 3  # 2 valid study + 1 excluded study; 0 practice rows
    assert all(row["is_practice"] == "false" for row in parsed)
    valid_csv = [r for r in parsed if r["validity_status"] in ("valid", "exposed")]
    assert len(valid_csv) == summary["valid_exposed_n"]
    assert sum(1 for r in valid_csv if r["outcome"] == "success") == 1
