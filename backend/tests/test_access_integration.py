"""Phase 6 tests: host-aware QR code generation and practice-only reset isolation."""

from __future__ import annotations

from pathlib import Path
from typing import Generator

from fastapi.testclient import TestClient
import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.core.database import Base, create_engine_for_url, create_session_factory, get_db
from app.main import create_app
from app.models.domain import DrillSession, Recall
from app.shipments.seed import load_fixture_into_db

FIXTURE_PATH = Path(__file__).resolve().parents[2] / "fixtures" / "food_drill.json"


@pytest.fixture()
def access_client(tmp_path: Path) -> Generator[tuple[TestClient, Session, dict[str, str]], None, None]:
    """Isolated seeded client for QR and practice reset tests."""
    db_url = f"sqlite:///{tmp_path / 'test_access.db'}"
    engine = create_engine_for_url(db_url)
    Base.metadata.create_all(bind=engine)
    session_factory = create_session_factory(db_url)

    with session_factory() as db:
        load_fixture_into_db(db, FIXTURE_PATH)

    settings = Settings(
        app_env="test",
        database_url=db_url,
        operator_secret="op-access-secret",
        public_base_url="http://localhost:5173",
    )
    app = create_app(settings)

    def _override_get_db() -> Generator[Session, None, None]:
        with session_factory() as session:
            yield session

    app.dependency_overrides[get_db] = _override_get_db
    app.dependency_overrides[get_settings] = lambda: settings

    with TestClient(app) as client, session_factory() as verify_db:
        login = client.post("/api/operator/login", json={"secret": "op-access-secret"})
        assert login.status_code == 200
        headers = {"Authorization": f"Bearer {login.json()['token']}"}
        yield client, verify_db, headers


def test_host_aware_qr_generation_png_and_json(
    access_client: tuple[TestClient, Session, dict[str, str]],
) -> None:
    """QR endpoint enforces operator auth, generates valid PNG bytes, and flags localhost."""
    client, _, headers = access_client

    pub = client.post("/api/recalls", headers=headers, json={"batch_code": "B17"}).json()
    shop_a = next(t for t in pub["tasks"] if t["location_id"] == "shop_a")
    task_id = shop_a["task_id"]
    token = shop_a["access_token"]

    # Unauthenticated request rejected
    client.cookies.clear()
    assert client.get(f"/api/tasks/{task_id}/qr").status_code == 401

    # Default localhost base_url triggers localhost warning
    local_json = client.get(f"/api/tasks/{task_id}/qr?format=json", headers=headers)
    assert local_json.status_code == 200
    lj = local_json.json()
    assert lj["target_url"] == f"http://localhost:5173/t/{token}"
    assert lj["is_localhost_warning"] is True
    assert lj["banner"] == "Fictional recall drill"
    assert lj["qr_data_url"].startswith("data:image/png;base64,")

    # Forwarded HTTPS cloudflared host clears localhost warning and returns PNG signature
    png_resp = client.get(
        f"/api/tasks/{task_id}/qr?format=png",
        headers={
            **headers,
            "X-Forwarded-Proto": "https",
            "X-Forwarded-Host": "demo-drill.trycloudflare.com",
        },
    )
    assert png_resp.status_code == 200
    assert png_resp.headers["content-type"] == "image/png"
    assert png_resp.headers["x-qr-target-url"] == f"https://demo-drill.trycloudflare.com/t/{token}"
    assert png_resp.headers["x-qr-localhost-warning"] == "false"
    assert png_resp.content[:8] == b"\x89PNG\r\n\x1a\n"


def test_practice_reset_clears_practice_only_and_preserves_study_sessions(
    access_client: tuple[TestClient, Session, dict[str, str]],
) -> None:
    """Practice reset deletes practice sessions and demo recalls without touching real study data."""
    client, db, headers = access_client

    # Publish B17 recall and create 1 real study session + 1 practice session
    assert client.post("/api/recalls", headers=headers, json={"batch_code": "B17"}).status_code == 201
    study = client.post("/api/join", json={"is_practice": False}).json()
    practice = client.post("/api/join", json={"is_practice": True}).json()
    assert study["is_practice"] is False
    assert practice["is_practice"] is True

    # Unauthenticated reset rejected
    client.cookies.clear()
    assert client.post("/api/practice/reset").status_code == 401

    # Authenticated reset removes practice session & demo recalls, preserves real study session
    reset = client.post("/api/practice/reset", headers=headers)
    assert reset.status_code == 200
    data = reset.json()
    assert data["practice_sessions_deleted"] == 1
    assert data["study_sessions_preserved"] == 1
    assert data["recalls_deleted"] == 1

    remaining_sessions = list(db.scalars(select(DrillSession)).all())
    assert len(remaining_sessions) == 1
    assert remaining_sessions[0].id == study["session_id"]
    assert list(db.scalars(select(Recall)).all()) == []
