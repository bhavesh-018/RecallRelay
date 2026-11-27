"""Verification test for the 16-location multi-tier demo_large_drill.json fixture."""

from __future__ import annotations

from pathlib import Path
from typing import Generator

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.core.database import Base, create_engine_for_url, create_session_factory, get_db
from app.main import create_app
from app.shipments.seed import load_fixture_into_db

DEMO_LARGE_PATH = Path(__file__).resolve().parents[2] / "fixtures" / "demo_large_drill.json"


def test_demo_large_fixture_traces_sixteen_locations_without_double_counting(tmp_path: Path) -> None:
    """demo_large_drill.json seeds 16 locations across 3 tiers with exact 500-unit conservation."""
    db_url = f"sqlite:///{tmp_path / 'demo_large.db'}"
    engine = create_engine_for_url(db_url)
    Base.metadata.create_all(bind=engine)
    session_factory = create_session_factory(db_url)

    with session_factory() as db:
        counts = load_fixture_into_db(db, DEMO_LARGE_PATH)
        assert counts == {"locations_created": 16, "batches_created": 2, "shipments_created": 24}

    settings = Settings(app_env="test", database_url=db_url, operator_secret="large-demo-secret")
    app = create_app(settings)

    def _override_get_db() -> Generator[Session, None, None]:
        with session_factory() as session:
            yield session

    app.dependency_overrides[get_db] = _override_get_db
    app.dependency_overrides[get_settings] = lambda: settings

    with TestClient(app) as client:
        b17 = client.get("/api/batches/B17/trace").json()
        b18 = client.get("/api/batches/B18/trace").json()

    engine.dispose()

    assert len(b17["nodes"]) == 16
    assert len(b17["edges"]) == 15
    assert b17["opening_quantity"] == 500
    assert b17["accounted_total"] == 500
    assert b17["discrepancy"] == 0

    assert len(b18["nodes"]) == 10
    assert b18["opening_quantity"] == 320
    assert b18["accounted_total"] == 320
    assert b18["discrepancy"] == 0
