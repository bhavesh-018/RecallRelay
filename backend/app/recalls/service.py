"""Business logic for idempotent recall publishing and task overview."""

from __future__ import annotations

from dataclasses import asdict
import secrets
import uuid

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.domain import (
    AuditEvent,
    Location,
    ProductBatch,
    Recall,
    RecallTask,
    Response,
    Shipment,
)
from app.reconciliation.accounting import compute_batch_trace


def publish_recall(
    db: Session,
    *,
    batch_code: str,
    notice_text: str,
    notice_version: int = 1,
    is_drill: bool = True,
    actor: str = "operator",
) -> tuple[Recall, list[RecallTask], bool]:
    """Publish a recall notice idempotently and generate tasks only for affected locations."""
    batch = db.scalar(select(ProductBatch).where(ProductBatch.batch_code == batch_code))
    if batch is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Batch '{batch_code}' not found.",
        )

    existing_recall = db.scalar(
        select(Recall).where(
            Recall.batch_id == batch.id,
            Recall.notice_version == notice_version,
        )
    )
    if existing_recall is not None:
        existing_tasks = list(
            db.scalars(
                select(RecallTask)
                .where(RecallTask.recall_id == existing_recall.id)
                .order_by(RecallTask.location_id)
            ).all()
        )
        return existing_recall, existing_tasks, False

    locations = {loc.id: loc for loc in db.scalars(select(Location)).all()}
    shipments = list(db.scalars(select(Shipment).where(Shipment.batch_id == batch.id)).all())
    trace = compute_batch_trace(
        batch_id=batch.id,
        batch_code=batch.batch_code,
        product_name=batch.product_name,
        opening_location_id=batch.opening_location_id,
        opening_quantity=batch.opening_quantity,
        locations_by_id=locations,
        shipments=shipments,
    )

    recall = Recall(
        id=f"rec_{uuid.uuid4().hex[:12]}",
        batch_id=batch.id,
        notice_version=notice_version,
        notice_text=notice_text.strip(),
        is_drill=is_drill,
    )
    db.add(recall)
    db.flush()

    tasks: list[RecallTask] = []
    for node in trace.nodes:
        task = RecallTask(
            id=f"task_{uuid.uuid4().hex[:12]}",
            recall_id=recall.id,
            location_id=node.location_id,
            access_token=secrets.token_urlsafe(24),
            status="pending",
        )
        db.add(task)
        tasks.append(task)

    db.add(
        AuditEvent(
            actor=actor,
            action="publish_recall",
            entity_type="recall",
            entity_id=recall.id,
            revision_ref=notice_version,
            details_json={
                "batch_code": batch.batch_code,
                "task_count": len(tasks),
                "affected_locations": [n.location_id for n in trace.nodes],
                "is_drill": is_drill,
            },
        )
    )
    db.commit()
    db.refresh(recall)
    return recall, tasks, True


def build_recall_overview(db: Session, recall: Recall) -> dict[str, object]:
    """Assemble full operator overview for a recall including reconciliation and tasks."""
    batch = db.get(ProductBatch, recall.batch_id)
    if batch is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Batch not found.")

    locations = {loc.id: loc for loc in db.scalars(select(Location)).all()}
    shipments = list(db.scalars(select(Shipment).where(Shipment.batch_id == batch.id)).all())
    tasks = list(
        db.scalars(
            select(RecallTask)
            .where(RecallTask.recall_id == recall.id)
            .order_by(RecallTask.location_id)
        ).all()
    )
    task_ids = [t.id for t in tasks]
    responses_by_task: dict[str, Response] = {}
    responses_by_location: dict[str, Response] = {}
    if task_ids:
        for resp in db.scalars(select(Response).where(Response.task_id.in_(task_ids))).all():
            responses_by_task[resp.task_id] = resp
        for t in tasks:
            if t.id in responses_by_task:
                responses_by_location[t.location_id] = responses_by_task[t.id]

    trace = compute_batch_trace(
        batch_id=batch.id,
        batch_code=batch.batch_code,
        product_name=batch.product_name,
        opening_location_id=batch.opening_location_id,
        opening_quantity=batch.opening_quantity,
        locations_by_id=locations,
        shipments=shipments,
        responses_by_location=responses_by_location,
    )
    node_by_loc = {n.location_id: n for n in trace.nodes}

    task_items: list[dict[str, object]] = []
    for t in tasks:
        node = node_by_loc.get(t.location_id)
        resp = responses_by_task.get(t.id)
        task_items.append(
            {
                "task_id": t.id,
                "location_id": t.location_id,
                "location_name": locations[t.location_id].name if t.location_id in locations else t.location_id,
                "role": locations[t.location_id].role if t.location_id in locations else "unknown",
                "status": t.status,
                "access_token": t.access_token,
                "received": node.received if node else 0,
                "forwarded": node.forwarded if node else 0,
                "delivered_at": t.delivered_at.isoformat(),
                "acknowledged_at": t.acknowledged_at.isoformat() if t.acknowledged_at else None,
                "completed_at": t.completed_at.isoformat() if t.completed_at else None,
                "response": (
                    {
                        "response_id": resp.id,
                        "forwarded_qty": resp.forwarded_qty,
                        "sold_qty": resp.sold_qty,
                        "remaining_qty": resp.remaining_qty,
                        "set_aside_qty": resp.set_aside_qty,
                        "confirmed_set_aside": resp.confirmed_set_aside,
                        "discrepancy_reason": resp.discrepancy_reason,
                        "revision": resp.revision,
                        "updated_at": resp.updated_at.isoformat(),
                    }
                    if resp
                    else None
                ),
            }
        )

    completed_count = sum(1 for t in tasks if t.status == "reconciled")
    discrepancy_count = sum(1 for t in tasks if t.status == "discrepancy")

    return {
        "id": recall.id,
        "batch_id": batch.id,
        "batch_code": batch.batch_code,
        "product_name": batch.product_name,
        "notice_version": recall.notice_version,
        "notice_text": recall.notice_text,
        "is_drill": recall.is_drill,
        "published_at": recall.published_at.isoformat(),
        "total_tasks": len(tasks),
        "completed_tasks": completed_count,
        "discrepancy_tasks": discrepancy_count,
        "trace": asdict(trace),
        "tasks": task_items,
    }
