"""Scoped participant task routes, response revisions, audit history, and /join entry."""

from __future__ import annotations

from datetime import datetime, timezone
import secrets
from typing import Any
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.auth import OperatorSessionInfo, require_operator
from app.core.database import get_db
from app.models.domain import (
    AuditEvent,
    DrillSession,
    Location,
    ProductBatch,
    Recall,
    RecallTask,
    Response,
    Shipment,
)
from app.reconciliation.accounting import (
    AccountingValidationError,
    compute_batch_trace,
    validate_stock_balance,
)

router = APIRouter(prefix="/api", tags=["participant-tasks"])


class TaskResponseSubmission(BaseModel):
    """Participant quantity submission for a scoped recall task."""

    task_id: str | None = None
    forwarded_qty: Any = None
    sold_qty: Any
    remaining_qty: Any
    set_aside_qty: Any
    confirmed_set_aside: bool = False
    discrepancy_reason: str | None = None


class JoinStudyRequest(BaseModel):
    """Zero-friction remote study entry payload."""

    existing_token: str | None = None
    scenario_id: str = Field(default="isolated_shop_b17")
    is_practice: bool = False


def _load_task_context(db: Session, access_token: str) -> tuple[RecallTask, Recall, ProductBatch, Location, int, int]:
    """Resolve scoped task token and compute authoritative received/forwarded quantities."""
    task = db.scalar(select(RecallTask).where(RecallTask.access_token == access_token))
    if task is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Task link is invalid or expired.",
        )
    recall = db.get(Recall, task.recall_id)
    if recall is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Recall not found.")
    batch = db.get(ProductBatch, recall.batch_id)
    location = db.get(Location, task.location_id)
    if batch is None or location is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task context missing.")

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
    node = next((n for n in trace.nodes if n.location_id == task.location_id), None)
    received = node.received if node else 0
    forwarded = node.forwarded if node else 0
    return task, recall, batch, location, received, forwarded


@router.get("/tasks/{access_token}")
def get_scoped_task(access_token: str, db: Session = Depends(get_db)) -> dict[str, object]:
    """Fetch a location's recall task using its scoped access token."""
    task, recall, batch, location, received, forwarded = _load_task_context(db, access_token)

    if task.acknowledged_at is None:
        task.acknowledged_at = datetime.now(timezone.utc)
        if task.status == "pending":
            task.status = "acknowledged"
        db.add(
            AuditEvent(
                actor=f"participant:{location.id}",
                action="acknowledge_task",
                entity_type="recall_task",
                entity_id=task.id,
                details_json={"location_id": location.id, "batch_code": batch.batch_code},
            )
        )
        db.commit()
        db.refresh(task)

    resp = db.scalar(select(Response).where(Response.task_id == task.id))
    return {
        "task_id": task.id,
        "recall_id": recall.id,
        "batch_code": batch.batch_code,
        "product_name": batch.product_name,
        "location_id": location.id,
        "location_name": location.name,
        "role": location.role,
        "status": task.status,
        "banner": "Fictional recall drill",
        "is_drill": recall.is_drill,
        "notice_version": recall.notice_version,
        "notice_text": recall.notice_text,
        "received": received,
        "forwarded": forwarded,
        "acknowledged_at": task.acknowledged_at.isoformat() if task.acknowledged_at else None,
        "completed_at": task.completed_at.isoformat() if task.completed_at else None,
        "current_response": (
            {
                "response_id": resp.id,
                "forwarded_qty": resp.forwarded_qty,
                "sold_qty": resp.sold_qty,
                "remaining_qty": resp.remaining_qty,
                "set_aside_qty": resp.set_aside_qty,
                "confirmed_set_aside": resp.confirmed_set_aside,
                "discrepancy_reason": resp.discrepancy_reason,
                "revision": resp.revision,
                "submitted_at": resp.submitted_at.isoformat(),
                "updated_at": resp.updated_at.isoformat(),
            }
            if resp
            else None
        ),
    }


@router.post("/tasks/{access_token}/response")
def submit_task_response(
    access_token: str,
    body: TaskResponseSubmission,
    db: Session = Depends(get_db),
) -> dict[str, object]:
    """Validate and persist a single idempotent response per task with audit revisions."""
    task, _recall, batch, location, received, expected_forwarded = _load_task_context(db, access_token)

    if body.task_id is not None and body.task_id != task.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": "TASK_TOKEN_MISMATCH",
                "message": "Provided task_id does not match the scoped task token.",
            },
        )

    forwarded_qty = expected_forwarded if body.forwarded_qty is None else body.forwarded_qty

    try:
        validate_stock_balance(
            received=received,
            forwarded=forwarded_qty,
            sold=body.sold_qty,
            remaining=body.remaining_qty,
            set_aside=body.set_aside_qty,
        )
    except AccountingValidationError as exc:
        db.add(
            AuditEvent(
                actor=f"participant:{location.id}",
                action="reject_response",
                entity_type="recall_task",
                entity_id=task.id,
                details_json={
                    "code": exc.code,
                    "message": exc.message,
                    "submitted": {
                        "forwarded_qty": forwarded_qty,
                        "sold_qty": body.sold_qty,
                        "remaining_qty": body.remaining_qty,
                        "set_aside_qty": body.set_aside_qty,
                    },
                },
            )
        )
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail={"code": exc.code, "message": exc.message},
        ) from exc

    is_complete = bool(body.confirmed_set_aside and body.set_aside_qty == body.remaining_qty)
    next_status = "reconciled" if is_complete else "pending_quarantine"

    existing = db.scalar(select(Response).where(Response.task_id == task.id))
    now = datetime.now(timezone.utc)
    idempotent_duplicate = False

    if existing is None:
        resp = Response(
            id=f"resp_{uuid.uuid4().hex[:12]}",
            task_id=task.id,
            forwarded_qty=int(forwarded_qty),
            sold_qty=int(body.sold_qty),
            remaining_qty=int(body.remaining_qty),
            set_aside_qty=int(body.set_aside_qty),
            confirmed_set_aside=bool(body.confirmed_set_aside),
            discrepancy_reason=body.discrepancy_reason,
            revision=1,
            submitted_at=now,
            updated_at=now,
        )
        db.add(resp)
        audit_action = "submit_response"
    else:
        same_payload = (
            existing.forwarded_qty == int(forwarded_qty)
            and existing.sold_qty == int(body.sold_qty)
            and existing.remaining_qty == int(body.remaining_qty)
            and existing.set_aside_qty == int(body.set_aside_qty)
            and existing.confirmed_set_aside == bool(body.confirmed_set_aside)
            and existing.discrepancy_reason == body.discrepancy_reason
        )
        if same_payload:
            resp = existing
            idempotent_duplicate = True
            audit_action = ""
        else:
            existing.forwarded_qty = int(forwarded_qty)
            existing.sold_qty = int(body.sold_qty)
            existing.remaining_qty = int(body.remaining_qty)
            existing.set_aside_qty = int(body.set_aside_qty)
            existing.confirmed_set_aside = bool(body.confirmed_set_aside)
            existing.discrepancy_reason = body.discrepancy_reason
            existing.revision += 1
            existing.updated_at = now
            resp = existing
            audit_action = "revise_response"

    task.status = next_status
    if is_complete and task.completed_at is None:
        task.completed_at = now

    if audit_action:
        db.add(
            AuditEvent(
                actor=f"participant:{location.id}",
                action=audit_action,
                entity_type="recall_task",
                entity_id=task.id,
                revision_ref=resp.revision,
                details_json={
                    "batch_code": batch.batch_code,
                    "location_id": location.id,
                    "forwarded_qty": resp.forwarded_qty,
                    "sold_qty": resp.sold_qty,
                    "remaining_qty": resp.remaining_qty,
                    "set_aside_qty": resp.set_aside_qty,
                    "confirmed_set_aside": resp.confirmed_set_aside,
                    "task_status": task.status,
                },
            )
        )

    db.commit()
    db.refresh(resp)
    db.refresh(task)

    return {
        "task_id": task.id,
        "task_status": task.status,
        "idempotent_duplicate": idempotent_duplicate,
        "response": {
            "response_id": resp.id,
            "forwarded_qty": resp.forwarded_qty,
            "sold_qty": resp.sold_qty,
            "remaining_qty": resp.remaining_qty,
            "set_aside_qty": resp.set_aside_qty,
            "confirmed_set_aside": resp.confirmed_set_aside,
            "discrepancy_reason": resp.discrepancy_reason,
            "revision": resp.revision,
            "submitted_at": resp.submitted_at.isoformat(),
            "updated_at": resp.updated_at.isoformat(),
        },
    }


@router.get("/tasks/{task_id}/audit")
def get_task_audit_history(
    task_id: str,
    _operator: OperatorSessionInfo = Depends(require_operator),
    db: Session = Depends(get_db),
) -> dict[str, object]:
    """Return chronological audit events for one recall task."""
    task = db.get(RecallTask, task_id)
    if task is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Task '{task_id}' not found.")

    events = list(
        db.scalars(
            select(AuditEvent)
            .where(AuditEvent.entity_id == task_id)
            .order_by(AuditEvent.created_at.asc(), AuditEvent.id.asc())
        ).all()
    )
    return {
        "task_id": task_id,
        "events": [
            {
                "id": ev.id,
                "actor": ev.actor,
                "action": ev.action,
                "entity_type": ev.entity_type,
                "entity_id": ev.entity_id,
                "revision_ref": ev.revision_ref,
                "details": ev.details_json,
                "created_at": ev.created_at.isoformat(),
            }
            for ev in events
        ],
    }


@router.post("/join", status_code=status.HTTP_201_CREATED)
def join_study_drill(
    body: JoinStudyRequest,
    db: Session = Depends(get_db),
) -> dict[str, object]:
    """Mint or resume one isolated shop DrillSession per browser for remote participants."""
    if body.existing_token:
        existing = db.scalar(
            select(DrillSession).where(DrillSession.scoped_token == body.existing_token.strip())
        )
        if existing is not None:
            return {
                "session_id": existing.id,
                "participant_alias": existing.participant_alias,
                "identity": existing.identity,
                "scoped_token": existing.scoped_token,
                "scenario_id": existing.scenario_id,
                "is_practice": existing.is_practice,
                "resumed": True,
                "banner": "Fictional recall drill",
            }

    prefix = "practice" if body.is_practice else "study"
    short_id = uuid.uuid4().hex[:8]
    session = DrillSession(
        id=f"sess_{uuid.uuid4().hex[:12]}",
        participant_alias=f"P-{short_id[:4].upper()}",
        scenario_id=body.scenario_id,
        scenario_revision=1,
        notice_revision=1,
        identity=f"{prefix}_{short_id}",
        scoped_token=secrets.token_urlsafe(24),
        validity_status="pending",
        is_practice=body.is_practice,
        expected_received=15,
        expected_forwarded=0,
        expected_sold=5,
        expected_remaining=10,
        expected_set_aside=10,
    )
    db.add(session)
    db.add(
        AuditEvent(
            actor=session.identity,
            action="join_drill_session",
            entity_type="drill_session",
            entity_id=session.id,
            details_json={"scenario_id": session.scenario_id, "is_practice": session.is_practice},
        )
    )
    db.commit()
    db.refresh(session)

    return {
        "session_id": session.id,
        "participant_alias": session.participant_alias,
        "identity": session.identity,
        "scoped_token": session.scoped_token,
        "scenario_id": session.scenario_id,
        "is_practice": session.is_practice,
        "resumed": False,
        "banner": "Fictional recall drill",
    }
