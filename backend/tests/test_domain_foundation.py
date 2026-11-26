"""Phase 3 tests: fixture seeding, B17/B18 trace isolation, accounting, and operator auth."""

from __future__ import annotations

from pathlib import Path
from typing import Generator

from fastapi.testclient import TestClient
import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.database import Base, create_engine_for_url, create_session_factory, get_db
from app.main import create_app
from app.models.domain import AuditEvent, Location, ProductBatch, Response, Shipment
from app.reconciliation.accounting import (
    AccountingValidationError,
    compute_batch_trace,
    validate_shipment_transfer,
    validate_stock_balance,
)
from app.shipments.seed import load_fixture_into_db

FIXTURE_PATH = Path(__file__).resolve().parents[2] / "fixtures" / "food_drill.json"


@pytest.fixture()
def seeded_client(tmp_path: Path) -> Generator[tuple[TestClient, Session], None, None]:
    """Create an isolated SQLite DB seeded with food_drill.json and a TestClient."""
    db_url = f"sqlite:///{tmp_path / 'test_domain.db'}"
    engine = create_engine_for_url(db_url)
    Base.metadata.create_all(bind=engine)
    session_factory = create_session_factory(db_url)

    with session_factory() as db:
        load_fixture_into_db(db, FIXTURE_PATH)

    settings = Settings(
        app_env="test",
        database_url=db_url,
        operator_secret="test-op-secret",
    )
    app = create_app(settings)

    def _override_get_db() -> Generator[Session, None, None]:
        with session_factory() as session:
            yield session

    from app.core.config import get_settings

    app.dependency_overrides[get_db] = _override_get_db
    app.dependency_overrides[get_settings] = lambda: settings

    with TestClient(app) as client, session_factory() as verify_session:
        yield client, verify_session


def test_seed_loads_b17_and_b18_batches(seeded_client: tuple[TestClient, Session]) -> None:
    """Batch list returns both B17 and B18 with expected opening quantities."""
    client, _ = seeded_client
    resp = client.get("/api/batches")
    assert resp.status_code == 200
    batches = {b["batch_code"]: b for b in resp.json()["batches"]}
    assert set(batches.keys()) == {"B17", "B18"}
    assert batches["B17"]["opening_quantity"] == 100
    assert batches["B18"]["opening_quantity"] == 80


def test_b17_trace_reaches_five_locations_without_double_counting(
    seeded_client: tuple[TestClient, Session],
) -> None:
    """B17 traces accurately across 5 locations while B18 stays unaffected."""
    client, db = seeded_client

    trace_b17 = client.get("/api/batches/B17/trace")
    assert trace_b17.status_code == 200
    data = trace_b17.json()
    assert data["opening_quantity"] == 100
    assert data["accounted_total"] == 100
    assert data["discrepancy"] == 0
    assert len(data["nodes"]) == 5
    assert len(data["edges"]) == 4

    by_loc = {node["location_id"]: node for node in data["nodes"]}
    assert (by_loc["mfg_central"]["received"], by_loc["mfg_central"]["forwarded"]) == (100, 60)
    assert (by_loc["dist_north"]["received"], by_loc["dist_north"]["forwarded"]) == (60, 40)
    assert by_loc["shop_a"]["received"] == 15
    assert by_loc["shop_b"]["received"] == 15
    assert by_loc["shop_c"]["received"] == 10

    # Verify B18 stays isolated with its own quantities
    trace_b18 = client.get("/api/batches/B18/trace")
    assert trace_b18.status_code == 200
    assert trace_b18.json()["opening_quantity"] == 80
    assert trace_b18.json()["accounted_total"] == 80

    # Verify full batch reconciliation when all 5 locations report final counts
    batch_b17 = db.scalar(select(ProductBatch).where(ProductBatch.batch_code == "B17"))
    assert batch_b17 is not None
    locations = {loc.id: loc for loc in db.scalars(select(Location)).all()}
    shipments = list(db.scalars(select(Shipment).where(Shipment.batch_id == batch_b17.id)).all())

    responses_by_loc = {
        "mfg_central": Response(id="r1", task_id="t1", forwarded_qty=60, sold_qty=0, remaining_qty=40, set_aside_qty=40, confirmed_set_aside=True),
        "dist_north": Response(id="r2", task_id="t2", forwarded_qty=40, sold_qty=0, remaining_qty=20, set_aside_qty=20, confirmed_set_aside=True),
        "shop_a": Response(id="r3", task_id="t3", forwarded_qty=0, sold_qty=5, remaining_qty=10, set_aside_qty=10, confirmed_set_aside=True),
        "shop_b": Response(id="r4", task_id="t4", forwarded_qty=0, sold_qty=3, remaining_qty=12, set_aside_qty=12, confirmed_set_aside=True),
        "shop_c": Response(id="r5", task_id="t5", forwarded_qty=0, sold_qty=2, remaining_qty=8, set_aside_qty=8, confirmed_set_aside=True),
    }
    summary = compute_batch_trace(
        batch_id=batch_b17.id,
        batch_code=batch_b17.batch_code,
        product_name=batch_b17.product_name,
        opening_location_id=batch_b17.opening_location_id,
        opening_quantity=batch_b17.opening_quantity,
        locations_by_id=locations,
        shipments=shipments,
        responses_by_location=responses_by_loc,
    )
    assert summary.total_remaining == 90
    assert summary.total_sold == 10
    assert summary.total_set_aside == 90
    assert summary.accounted_total == 100
    assert summary.discrepancy == 0


def test_accounting_rejects_invalid_balances_and_excess_set_aside() -> None:
    """Deterministic accounting rejects mismatches, negatives, floats, and over-set-aside."""
    validate_stock_balance(received=15, forwarded=0, sold=5, remaining=10, set_aside=10)

    with pytest.raises(AccountingValidationError) as mismatch:
        validate_stock_balance(received=15, forwarded=0, sold=5, remaining=9, set_aside=9)
    assert mismatch.value.code == "ACCOUNTING_MISMATCH"

    with pytest.raises(AccountingValidationError) as excess:
        validate_stock_balance(received=15, forwarded=0, sold=5, remaining=10, set_aside=11)
    assert excess.value.code == "SET_ASIDE_EXCEEDS_REMAINING"

    with pytest.raises(AccountingValidationError) as neg:
        validate_stock_balance(received=15, forwarded=0, sold=-1, remaining=16, set_aside=0)
    assert neg.value.code == "NEGATIVE_QUANTITY"

    with pytest.raises(AccountingValidationError) as frac:
        validate_stock_balance(received=15, forwarded=0, sold=5.5, remaining=9, set_aside=9)
    assert frac.value.code == "INVALID_INTEGER"

    with pytest.raises(AccountingValidationError) as over_transfer:
        validate_shipment_transfer(sender_available=20, quantity=21)
    assert over_transfer.value.code == "INSUFFICIENT_STOCK_FOR_TRANSFER"


def test_operator_auth_and_shipment_transfer_guard(
    seeded_client: tuple[TestClient, Session],
) -> None:
    """Operator routes require valid login; shipments enforce available sender stock."""
    client, db = seeded_client

    # Unauthenticated access rejected
    assert client.get("/api/operator/me").status_code == 401
    assert (
        client.post(
            "/api/shipments",
            json={"batch_code": "B17", "sender_id": "dist_north", "receiver_id": "shop_c", "quantity": 5},
        ).status_code
        == 401
    )

    # Bad secret rejected
    assert client.post("/api/operator/login", json={"secret": "wrong"}).status_code == 401

    # Valid login succeeds
    login_resp = client.post("/api/operator/login", json={"secret": "test-op-secret"})
    assert login_resp.status_code == 200
    token = login_resp.json()["token"]
    headers = {"Authorization": f"Bearer {token}"}

    me_resp = client.get("/api/operator/me", headers=headers)
    assert me_resp.status_code == 200
    assert me_resp.json()["role"] == "operator"

    # Transfer exceeding distributor's 20 remaining units rejected cleanly
    bad_ship = client.post(
        "/api/shipments",
        headers=headers,
        json={"batch_code": "B17", "sender_id": "dist_north", "receiver_id": "shop_c", "quantity": 25},
    )
    assert bad_ship.status_code == 422
    assert bad_ship.json()["detail"]["code"] == "INSUFFICIENT_STOCK_FOR_TRANSFER"

    # Valid transfer of 5 units succeeds and logs AuditEvent
    good_ship = client.post(
        "/api/shipments",
        headers=headers,
        json={"batch_code": "B17", "sender_id": "dist_north", "receiver_id": "shop_c", "quantity": 5},
    )
    assert good_ship.status_code == 201
    audit = db.scalar(select(AuditEvent).where(AuditEvent.action == "record_shipment"))
    assert audit is not None
    assert audit.details_json["quantity"] == 5
