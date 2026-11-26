"""Phase 4 tests: idempotent recall publish, scoped tasks, response revisions, audit, and /join."""

from __future__ import annotations

from pathlib import Path
from typing import Generator

from fastapi.testclient import TestClient
import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.core.database import Base, create_engine_for_url, create_session_factory, get_db
from app.main import create_app
from app.models.domain import Response as ResponseModel
from app.shipments.seed import load_fixture_into_db

FIXTURE_PATH = Path(__file__).resolve().parents[2] / "fixtures" / "food_drill.json"


@pytest.fixture()
def recall_client(tmp_path: Path) -> Generator[tuple[TestClient, Session, dict[str, str]], None, None]:
    """Isolated seeded test client with authenticated operator headers."""
    db_url = f"sqlite:///{tmp_path / 'test_recalls.db'}"
    engine = create_engine_for_url(db_url)
    Base.metadata.create_all(bind=engine)
    session_factory = create_session_factory(db_url)

    with session_factory() as db:
        load_fixture_into_db(db, FIXTURE_PATH)

    settings = Settings(app_env="test", database_url=db_url, operator_secret="op-secret-123")
    app = create_app(settings)

    def _override_get_db() -> Generator[Session, None, None]:
        with session_factory() as session:
            yield session

    app.dependency_overrides[get_db] = _override_get_db
    app.dependency_overrides[get_settings] = lambda: settings

    with TestClient(app) as client, session_factory() as verify_db:
        login = client.post("/api/operator/login", json={"secret": "op-secret-123"})
        assert login.status_code == 200
        headers = {"Authorization": f"Bearer {login.json()['token']}"}
        yield client, verify_db, headers


def test_idempotent_recall_publish_and_batch_filtering(
    recall_client: tuple[TestClient, Session, dict[str, str]],
) -> None:
    """Publish generates tasks only for B17 locations and reuses them on repeat publish."""
    client, _, headers = recall_client

    # Operator auth required (clear session cookie set during fixture login)
    client.cookies.clear()
    assert client.post("/api/recalls", json={"batch_code": "B17"}).status_code == 401

    first = client.post("/api/recalls", headers=headers, json={"batch_code": "B17"})
    assert first.status_code == 201
    first_data = first.json()
    assert first_data["idempotent_reused"] is False
    assert first_data["batch_code"] == "B17"
    assert first_data["total_tasks"] == 5
    assert {t["location_id"] for t in first_data["tasks"]} == {
        "mfg_central",
        "dist_north",
        "shop_a",
        "shop_b",
        "shop_c",
    }

    # Repeat publish must reuse existing recall & exact task IDs
    second = client.post("/api/recalls", headers=headers, json={"batch_code": "B17"})
    assert second.status_code == 200
    second_data = second.json()
    assert second_data["idempotent_reused"] is True
    assert second_data["id"] == first_data["id"]
    assert [t["task_id"] for t in second_data["tasks"]] == [t["task_id"] for t in first_data["tasks"]]

    # B18 remains unaffected (no active recall)
    batches = {b["batch_code"]: b for b in client.get("/api/batches").json()["batches"]}
    assert batches["B17"]["has_active_recall"] is True
    assert batches["B18"]["has_active_recall"] is False


def test_scoped_task_response_validation_revisions_and_audit_trail(
    recall_client: tuple[TestClient, Session, dict[str, str]],
) -> None:
    """Scoped token enforces task isolation, deterministic validation, single row revisions, and audit history."""
    client, db, headers = recall_client

    pub = client.post("/api/recalls", headers=headers, json={"batch_code": "B17"}).json()
    shop_a = next(t for t in pub["tasks"] if t["location_id"] == "shop_a")
    shop_b = next(t for t in pub["tasks"] if t["location_id"] == "shop_b")
    token_a = shop_a["access_token"]

    # Open scoped task -> marks acknowledged and shows fictional drill banner
    task_view = client.get(f"/api/tasks/{token_a}")
    assert task_view.status_code == 200
    view_data = task_view.json()
    assert view_data["banner"] == "Fictional recall drill"
    assert view_data["received"] == 15
    assert view_data["forwarded"] == 0
    assert view_data["status"] == "acknowledged"

    # Tampered task_id in request body is rejected with 403
    tampered = client.post(
        f"/api/tasks/{token_a}/response",
        json={
            "task_id": shop_b["task_id"],
            "sold_qty": 5,
            "remaining_qty": 10,
            "set_aside_qty": 10,
            "confirmed_set_aside": True,
        },
    )
    assert tampered.status_code == 403
    assert tampered.json()["detail"]["code"] == "TASK_TOKEN_MISMATCH"

    # Invalid arithmetic rejected deterministically
    mismatch = client.post(
        f"/api/tasks/{token_a}/response",
        json={"sold_qty": 5, "remaining_qty": 9, "set_aside_qty": 9, "confirmed_set_aside": True},
    )
    assert mismatch.status_code == 422
    assert mismatch.json()["detail"]["code"] == "ACCOUNTING_MISMATCH"

    # Set-aside > remaining rejected
    over_aside = client.post(
        f"/api/tasks/{token_a}/response",
        json={"sold_qty": 5, "remaining_qty": 10, "set_aside_qty": 11, "confirmed_set_aside": True},
    )
    assert over_aside.status_code == 422
    assert over_aside.json()["detail"]["code"] == "SET_ASIDE_EXCEEDS_REMAINING"

    # Valid submission succeeds -> revision 1, task reconciled
    valid_payload = {
        "task_id": shop_a["task_id"],
        "sold_qty": 5,
        "remaining_qty": 10,
        "set_aside_qty": 10,
        "confirmed_set_aside": True,
    }
    first_sub = client.post(f"/api/tasks/{token_a}/response", json=valid_payload)
    assert first_sub.status_code == 200
    assert first_sub.json()["task_status"] == "reconciled"
    assert first_sub.json()["idempotent_duplicate"] is False
    assert first_sub.json()["response"]["revision"] == 1

    # Double-click identical submit preserves revision 1 and single DB row
    dup_sub = client.post(f"/api/tasks/{token_a}/response", json=valid_payload)
    assert dup_sub.status_code == 200
    assert dup_sub.json()["idempotent_duplicate"] is True
    assert dup_sub.json()["response"]["revision"] == 1

    # Correction updates same single row to revision 2
    revised = client.post(
        f"/api/tasks/{token_a}/response",
        json={"sold_qty": 6, "remaining_qty": 9, "set_aside_qty": 9, "confirmed_set_aside": True},
    )
    assert revised.status_code == 200
    assert revised.json()["response"]["revision"] == 2

    row_count = db.scalar(
        select(func.count(ResponseModel.id)).where(ResponseModel.task_id == shop_a["task_id"])
    )
    assert row_count == 1

    # Operator audit history shows acknowledge, reject, submit, and revise events
    audit_resp = client.get(f"/api/tasks/{shop_a['task_id']}/audit", headers=headers)
    assert audit_resp.status_code == 200
    actions = [ev["action"] for ev in audit_resp.json()["events"]]
    assert actions == [
        "acknowledge_task",
        "reject_response",
        "reject_response",
        "submit_response",
        "revise_response",
    ]


def test_join_auto_session_mints_and_resumes_same_identity(
    recall_client: tuple[TestClient, Session, dict[str, str]],
) -> None:
    """/join creates one isolated DrillSession per browser and resumes cleanly on refresh."""
    client, _, _ = recall_client

    first = client.post("/api/join", json={})
    assert first.status_code == 201
    s1 = first.json()
    assert s1["resumed"] is False
    assert s1["identity"].startswith("study_")
    assert s1["banner"] == "Fictional recall drill"

    resumed = client.post("/api/join", json={"existing_token": s1["scoped_token"]})
    assert resumed.status_code == 201
    s2 = resumed.json()
    assert s2["resumed"] is True
    assert s2["session_id"] == s1["session_id"]
    assert s2["identity"] == s1["identity"]
