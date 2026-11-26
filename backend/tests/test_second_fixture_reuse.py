"""Track 3 reuse test: verify second_drill.json works end-to-end with zero core logic edits."""

from __future__ import annotations

from pathlib import Path
from typing import Generator

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.core.database import Base, create_engine_for_url, create_session_factory, get_db
from app.main import create_app
from app.shipments.seed import load_fixture_into_db

SECOND_FIXTURE_PATH = Path(__file__).resolve().parents[2] / "fixtures" / "second_drill.json"


def test_second_fixture_traces_publishes_and_reconciles_without_core_edits(tmp_path: Path) -> None:
    """Six-location 2-depot coldchain fixture reconciles 205 remaining + 35 sold = 240 cleanly."""
    db_url = f"sqlite:///{tmp_path / 'test_second_fixture.db'}"
    engine = create_engine_for_url(db_url)
    Base.metadata.create_all(bind=engine)
    session_factory = create_session_factory(db_url)

    with session_factory() as db:
        counts = load_fixture_into_db(db, SECOND_FIXTURE_PATH)
        assert counts == {"locations_created": 6, "batches_created": 2, "shipments_created": 7}

    settings = Settings(app_env="test", database_url=db_url, operator_secret="reuse-secret")
    app = create_app(settings)

    def _override_get_db() -> Generator[Session, None, None]:
        with session_factory() as session:
            yield session

    app.dependency_overrides[get_db] = _override_get_db
    app.dependency_overrides[get_settings] = lambda: settings

    with TestClient(app) as client:
        token = client.post("/api/operator/login", json={"secret": "reuse-secret"}).json()["token"]
        headers = {"Authorization": f"Bearer {token}"}

        # MED-404 traces to 6 locations; unaffected MED-405 traces only to its 3 locations
        t404 = client.get("/api/batches/MED-404/trace").json()
        assert t404["opening_quantity"] == 240
        assert len(t404["nodes"]) == 6
        assert len(t404["edges"]) == 5

        t405 = client.get("/api/batches/MED-405/trace").json()
        assert t405["opening_quantity"] == 120
        assert len(t405["nodes"]) == 3

        # Publish recall for MED-404 -> generates 6 tasks; MED-405 untouched
        pub = client.post(
            "/api/recalls",
            headers=headers,
            json={"batch_code": "MED-404", "notice_text": "Fictional cold-chain drill for MED-404."},
        ).json()
        assert pub["total_tasks"] == 6

        expected_submissions = {
            "plant_west": {"forwarded_qty": 160, "sold_qty": 0, "remaining_qty": 80, "set_aside_qty": 80},
            "depot_alpha": {"forwarded_qty": 60, "sold_qty": 0, "remaining_qty": 30, "set_aside_qty": 30},
            "depot_beta": {"forwarded_qty": 45, "sold_qty": 0, "remaining_qty": 25, "set_aside_qty": 25},
            "clinic_1": {"forwarded_qty": 0, "sold_qty": 12, "remaining_qty": 23, "set_aside_qty": 23},
            "clinic_2": {"forwarded_qty": 0, "sold_qty": 5, "remaining_qty": 20, "set_aside_qty": 20},
            "clinic_3": {"forwarded_qty": 0, "sold_qty": 18, "remaining_qty": 27, "set_aside_qty": 27},
        }

        for task in pub["tasks"]:
            payload = {**expected_submissions[task["location_id"]], "confirmed_set_aside": True}
            resp = client.post(f"/api/tasks/{task['access_token']}/response", json=payload)
            assert resp.status_code == 200
            assert resp.json()["task_status"] == "reconciled"

        overview = client.get(f"/api/recalls/{pub['id']}").json()
        assert overview["completed_tasks"] == 6
        assert overview["trace"]["opening_quantity"] == 240
        assert overview["trace"]["total_remaining"] == 205
        assert overview["trace"]["total_sold"] == 35
        assert overview["trace"]["total_set_aside"] == 205
        assert overview["trace"]["accounted_total"] == 240
        assert overview["trace"]["discrepancy"] == 0

    engine.dispose()
