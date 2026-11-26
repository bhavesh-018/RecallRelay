"""Batch list, shipment trace, and operator shipment recording API routes."""

from __future__ import annotations

from dataclasses import asdict
from datetime import datetime, timezone
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, StrictInt
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.auth import OperatorSessionInfo, require_operator
from app.core.database import get_db
from app.models.domain import AuditEvent, Location, ProductBatch, Recall, RecallTask, Response, Shipment
from app.reconciliation.accounting import (
    AccountingValidationError,
    compute_batch_trace,
    validate_shipment_transfer,
)

router = APIRouter(prefix="/api", tags=["batches-shipments"])


class ShipmentCreateRequest(BaseModel):
    """Request body for recording a batch transfer between two locations."""

    batch_code: str
    sender_id: str
    receiver_id: str
    quantity: StrictInt


@router.get("/batches")
def list_batches(
    dataset_key: str | None = Query(default=None),
    db: Session = Depends(get_db),
) -> dict[str, object]:
    """List tracked product batches with optional dataset filtering."""
    stmt = select(ProductBatch).order_by(ProductBatch.batch_code)
    if dataset_key:
        stmt = stmt.where(ProductBatch.dataset_key == dataset_key)
    batches = list(db.scalars(stmt).all())

    items: list[dict[str, object]] = []
    for batch in batches:
        ship_count = len(list(db.scalars(select(Shipment.id).where(Shipment.batch_id == batch.id)).all()))
        active_recall = db.scalar(
            select(Recall)
            .where(Recall.batch_id == batch.id)
            .order_by(Recall.notice_version.desc())
        )
        items.append(
            {
                "id": batch.id,
                "batch_code": batch.batch_code,
                "product_name": batch.product_name,
                "opening_location_id": batch.opening_location_id,
                "opening_quantity": batch.opening_quantity,
                "dataset_key": batch.dataset_key,
                "is_practice": batch.is_practice,
                "shipment_count": ship_count,
                "has_active_recall": active_recall is not None,
                "latest_recall_id": active_recall.id if active_recall else None,
            }
        )
    return {"batches": items}


@router.get("/batches/{batch_code}/trace")
def get_batch_trace(
    batch_code: str,
    db: Session = Depends(get_db),
) -> dict[str, object]:
    """Return full supply-chain trace and non-double-counted reconciliation for one batch."""
    batch = db.scalar(select(ProductBatch).where(ProductBatch.batch_code == batch_code))
    if batch is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Batch '{batch_code}' not found.",
        )

    locations = {loc.id: loc for loc in db.scalars(select(Location)).all()}
    shipments = list(db.scalars(select(Shipment).where(Shipment.batch_id == batch.id)).all())

    responses_by_location: dict[str, Response] = {}
    latest_recall = db.scalar(
        select(Recall).where(Recall.batch_id == batch.id).order_by(Recall.notice_version.desc())
    )
    if latest_recall is not None:
        tasks = list(db.scalars(select(RecallTask).where(RecallTask.recall_id == latest_recall.id)).all())
        task_ids = [t.id for t in tasks]
        task_loc = {t.id: t.location_id for t in tasks}
        if task_ids:
            for resp in db.scalars(select(Response).where(Response.task_id.in_(task_ids))).all():
                responses_by_location[task_loc[resp.task_id]] = resp

    summary = compute_batch_trace(
        batch_id=batch.id,
        batch_code=batch.batch_code,
        product_name=batch.product_name,
        opening_location_id=batch.opening_location_id,
        opening_quantity=batch.opening_quantity,
        locations_by_id=locations,
        shipments=shipments,
        responses_by_location=responses_by_location,
    )
    return asdict(summary)


@router.post("/shipments", status_code=status.HTTP_201_CREATED)
def record_shipment(
    body: ShipmentCreateRequest,
    operator: OperatorSessionInfo = Depends(require_operator),
    db: Session = Depends(get_db),
) -> dict[str, object]:
    """Record an accepted transfer for a batch after deterministic stock validation."""
    if body.sender_id == body.receiver_id:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "SELF_TRANSFER", "message": "Sender and receiver locations must differ."},
        )

    batch = db.scalar(select(ProductBatch).where(ProductBatch.batch_code == body.batch_code))
    if batch is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Batch '{body.batch_code}' not found.")

    sender = db.get(Location, body.sender_id)
    receiver = db.get(Location, body.receiver_id)
    if sender is None or receiver is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sender or receiver location not found.")

    locations = {loc.id: loc for loc in db.scalars(select(Location)).all()}
    existing_shipments = list(db.scalars(select(Shipment).where(Shipment.batch_id == batch.id)).all())
    trace = compute_batch_trace(
        batch_id=batch.id,
        batch_code=batch.batch_code,
        product_name=batch.product_name,
        opening_location_id=batch.opening_location_id,
        opening_quantity=batch.opening_quantity,
        locations_by_id=locations,
        shipments=existing_shipments,
    )
    sender_node = next((n for n in trace.nodes if n.location_id == body.sender_id), None)
    sender_avail = sender_node.remaining if sender_node else 0

    try:
        qty = validate_shipment_transfer(sender_avail, body.quantity)
    except AccountingValidationError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": exc.code, "message": exc.message},
        ) from exc

    shipment = Shipment(
        id=f"ship_{uuid.uuid4().hex[:12]}",
        batch_id=batch.id,
        sender_id=body.sender_id,
        receiver_id=body.receiver_id,
        quantity=qty,
        accepted_at=datetime.now(timezone.utc),
    )
    db.add(shipment)
    db.add(
        AuditEvent(
            actor=operator.actor,
            action="record_shipment",
            entity_type="shipment",
            entity_id=shipment.id,
            details_json={
                "batch_code": batch.batch_code,
                "sender_id": body.sender_id,
                "receiver_id": body.receiver_id,
                "quantity": qty,
            },
        )
    )
    db.commit()
    return {
        "id": shipment.id,
        "batch_code": batch.batch_code,
        "sender_id": shipment.sender_id,
        "receiver_id": shipment.receiver_id,
        "quantity": shipment.quantity,
        "accepted_at": shipment.accepted_at.isoformat(),
    }
