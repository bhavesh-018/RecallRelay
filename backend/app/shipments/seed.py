"""Fixture-agnostic supply chain dataset loader and seeder."""

from __future__ import annotations

from datetime import datetime
import json
from pathlib import Path
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.models.domain import Location, ProductBatch, Shipment
from app.reconciliation.accounting import validate_shipment_transfer


def _parse_iso_datetime(value: str) -> datetime:
    """Parse ISO-8601 timestamp string including trailing Z."""
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def load_fixture_into_db(
    db: Session,
    fixture_path: str | Path,
    reset_dataset: bool = False,
) -> dict[str, int]:
    """Validate and load a supply-chain JSON fixture into PostgreSQL/SQLite."""
    path = Path(fixture_path)
    payload: dict[str, Any] = json.loads(path.read_text(encoding="utf-8"))
    dataset_key = str(payload.get("dataset_key") or path.stem)

    if reset_dataset:
        batch_ids = list(
            db.scalars(select(ProductBatch.id).where(ProductBatch.dataset_key == dataset_key)).all()
        )
        if batch_ids:
            db.execute(delete(Shipment).where(Shipment.batch_id.in_(batch_ids)))
            db.execute(delete(ProductBatch).where(ProductBatch.id.in_(batch_ids)))
        db.execute(delete(Location).where(Location.dataset_key == dataset_key))
        db.flush()

    loc_count = 0
    for loc_data in payload.get("locations", []):
        existing = db.get(Location, loc_data["id"])
        if existing is None:
            db.add(
                Location(
                    id=loc_data["id"],
                    name=loc_data["name"],
                    role=loc_data["role"],
                    parent_id=loc_data.get("parent_id"),
                    dataset_key=dataset_key,
                )
            )
            loc_count += 1

    db.flush()

    batches_by_code: dict[str, ProductBatch] = {}
    available_by_batch_loc: dict[tuple[str, str], int] = {}
    batch_count = 0

    for batch_data in payload.get("batches", []):
        existing_batch = db.get(ProductBatch, batch_data["id"])
        if existing_batch is None:
            batch_obj = ProductBatch(
                id=batch_data["id"],
                product_name=batch_data["product_name"],
                batch_code=batch_data["batch_code"],
                opening_location_id=batch_data["opening_location_id"],
                opening_quantity=int(batch_data["opening_quantity"]),
                dataset_key=dataset_key,
                is_practice=bool(batch_data.get("is_practice", False)),
            )
            db.add(batch_obj)
            batch_count += 1
        else:
            batch_obj = existing_batch
        batches_by_code[batch_obj.batch_code] = batch_obj
        available_by_batch_loc[(batch_obj.id, batch_obj.opening_location_id)] = batch_obj.opening_quantity

    db.flush()

    ship_count = 0
    ordered_shipments = sorted(
        payload.get("shipments", []),
        key=lambda item: (item["accepted_at"], item["id"]),
    )
    for sh_data in ordered_shipments:
        batch_obj = batches_by_code[sh_data["batch_code"]]
        sender_key = (batch_obj.id, sh_data["sender_id"])
        receiver_key = (batch_obj.id, sh_data["receiver_id"])
        sender_avail = available_by_batch_loc.get(sender_key, 0)
        qty = validate_shipment_transfer(sender_avail, sh_data["quantity"])

        available_by_batch_loc[sender_key] = sender_avail - qty
        available_by_batch_loc[receiver_key] = available_by_batch_loc.get(receiver_key, 0) + qty

        if db.get(Shipment, sh_data["id"]) is None:
            db.add(
                Shipment(
                    id=sh_data["id"],
                    batch_id=batch_obj.id,
                    sender_id=sh_data["sender_id"],
                    receiver_id=sh_data["receiver_id"],
                    quantity=qty,
                    accepted_at=_parse_iso_datetime(sh_data["accepted_at"]),
                )
            )
            ship_count += 1

    db.commit()
    return {
        "locations_created": loc_count,
        "batches_created": batch_count,
        "shipments_created": ship_count,
    }
