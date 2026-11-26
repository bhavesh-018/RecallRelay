"""Participant DrillSession start, render acknowledgment, submit, and finalize routes."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Callable

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.core.database import get_db
from app.experiments.flagsmith_client import FlagsmithAdapter
from app.experiments.sessions import (
    STUDY_DEADLINE_SECONDS,
    as_utc,
    get_flagsmith_adapter_for_session,
    serialize_session_state,
)
from app.models.domain import AuditEvent, DrillSession
from app.reconciliation.accounting import AccountingValidationError, validate_stock_balance

router = APIRouter(prefix="/api/sessions", tags=["experiment-sessions"])


class SessionSubmitRequest(BaseModel):
    """Participant submission payload for an isolated study DrillSession."""

    forwarded_qty: Any = 0
    sold_qty: Any
    remaining_qty: Any
    set_aside_qty: Any
    confirmed_set_aside: bool = False


class SessionFinalizeRequest(BaseModel):
    """Optional reason when finalizing an exposed session (timeout or abandoned)."""

    reason: str = "timeout"


def get_adapter_factory(
    settings: Settings = Depends(get_settings),
) -> Callable[[bool], FlagsmithAdapter]:
    """Dependency returning a factory for FlagsmithAdapter (overrideable in tests)."""
    return lambda is_practice: get_flagsmith_adapter_for_session(settings, is_practice)


def get_clock() -> Callable[[], datetime]:
    """Dependency returning current UTC time (overrideable in tests for 300s cutoff)."""
    return lambda: datetime.now(timezone.utc)


def _get_session_or_404(db: Session, scoped_token: str) -> DrillSession:
    session = db.scalar(select(DrillSession).where(DrillSession.scoped_token == scoped_token))
    if session is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Drill session token not found.",
        )
    return session


@router.get("/{scoped_token}")
def get_drill_session(
    scoped_token: str,
    db: Session = Depends(get_db),
    clock: Callable[[], datetime] = Depends(get_clock),
) -> dict[str, object]:
    """Retrieve current state, assigned variant, and remaining timer for a DrillSession."""
    session = _get_session_or_404(db, scoped_token)
    return serialize_session_state(session, clock())


@router.post("/{scoped_token}/start")
def start_drill_session(
    scoped_token: str,
    db: Session = Depends(get_db),
    adapter_factory: Callable[[bool], FlagsmithAdapter] = Depends(get_adapter_factory),
    clock: Callable[[], datetime] = Depends(get_clock),
) -> dict[str, object]:
    """Evaluate Flagsmith remotely on Start and lock variant + 300s server timer."""
    session = _get_session_or_404(db, scoped_token)
    now = as_utc(clock())

    # Reopening preserves original variant and original timer
    if session.exposure_at is not None and session.variant is not None:
        data = serialize_session_state(session, now)
        data["resumed"] = True
        return data

    adapter = adapter_factory(session.is_practice)
    try:
        eval_res = adapter.evaluate_recall_flow(
            identity=session.identity,
            feature_name="recall_response_flow",
            traits={"is_practice": session.is_practice, "scenario_id": session.scenario_id},
        )
    finally:
        adapter.close()

    if eval_res.error:
        session.validity_status = "excluded_eval_error"
        db.add(
            AuditEvent(
                actor=session.identity,
                action="session_eval_failed",
                entity_type="drill_session",
                entity_id=session.id,
                details_json={"error": eval_res.error},
            )
        )
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "code": "FLAGSMITH_UNAVAILABLE",
                "message": "Experiment assignment is temporarily unavailable. Please retry in a moment.",
            },
        )

    session.variant = eval_res.variant
    session.exposure_at = now
    session.validity_status = "exposed"
    db.add(
        AuditEvent(
            actor=session.identity,
            action="session_exposed",
            entity_type="drill_session",
            entity_id=session.id,
            details_json={
                "variant": session.variant,
                "exposure_sent": eval_res.exposure_sent,
                "experiment_id": eval_res.experiment_id,
            },
        )
    )
    db.commit()
    db.refresh(session)

    data = serialize_session_state(session, now)
    data["resumed"] = False
    return data


@router.post("/{scoped_token}/rendered")
def acknowledge_session_rendered(
    scoped_token: str,
    db: Session = Depends(get_db),
    clock: Callable[[], datetime] = Depends(get_clock),
) -> dict[str, object]:
    """Record that a usable workflow rendered on the participant device."""
    session = _get_session_or_404(db, scoped_token)
    now = as_utc(clock())

    if session.exposure_at is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "SESSION_NOT_STARTED", "message": "Call /start before /rendered."},
        )

    if session.started_at is None:
        session.started_at = now
        session.validity_status = "valid"
        db.add(
            AuditEvent(
                actor=session.identity,
                action="recall_drill_started",
                entity_type="drill_session",
                entity_id=session.id,
                details_json={"variant": session.variant},
            )
        )
        db.commit()
        db.refresh(session)

    return serialize_session_state(session, now)


@router.post("/{scoped_token}/submit")
def submit_drill_session(
    scoped_token: str,
    body: SessionSubmitRequest,
    db: Session = Depends(get_db),
    clock: Callable[[], datetime] = Depends(get_clock),
) -> dict[str, object]:
    """Validate participant counts against ground truth and enforce 300s primary cutoff."""
    session = _get_session_or_404(db, scoped_token)
    now = as_utc(clock())

    if session.exposure_at is None or session.variant is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "SESSION_NOT_STARTED", "message": "Press Start before submitting."},
        )

    # Idempotent double-click after already qualifying as success
    if session.outcome == "success":
        data = serialize_session_state(session, now)
        data["idempotent_duplicate"] = True
        data["late_completion_recorded"] = False
        return data

    session.attempts += 1
    if session.started_at is None:
        session.started_at = session.exposure_at
    if session.validity_status == "exposed":
        session.validity_status = "valid"

    try:
        validate_stock_balance(
            received=session.expected_received,
            forwarded=body.forwarded_qty,
            sold=body.sold_qty,
            remaining=body.remaining_qty,
            set_aside=body.set_aside_qty,
        )
    except AccountingValidationError as exc:
        session.incorrect_attempts += 1
        db.add(
            AuditEvent(
                actor=session.identity,
                action="recall_response_rejected",
                entity_type="drill_session",
                entity_id=session.id,
                details_json={"code": exc.code, "message": exc.message, "attempt": session.attempts},
            )
        )
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail={"code": exc.code, "message": exc.message},
        ) from exc

    ground_truth_ok = (
        int(body.forwarded_qty) == session.expected_forwarded
        and int(body.sold_qty) == session.expected_sold
        and int(body.remaining_qty) == session.expected_remaining
        and int(body.set_aside_qty) == session.expected_set_aside
        and bool(body.confirmed_set_aside)
    )
    if not ground_truth_ok:
        session.incorrect_attempts += 1
        msg = (
            "Please confirm that all remaining affected stock is set aside."
            if not body.confirmed_set_aside
            else "Submitted counts do not match the shop scenario card. Please double-check Sold, Remaining, and Set Aside."
        )
        db.add(
            AuditEvent(
                actor=session.identity,
                action="recall_response_mismatch",
                entity_type="drill_session",
                entity_id=session.id,
                details_json={"message": msg, "attempt": session.attempts},
            )
        )
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail={"code": "GROUND_TRUTH_MISMATCH", "message": msg},
        )

    elapsed = round((now - as_utc(session.exposure_at)).total_seconds(), 2)
    session.completed_seconds = elapsed

    late_completion = elapsed > STUDY_DEADLINE_SECONDS or session.outcome == "timeout"
    if late_completion:
        session.outcome = "timeout"
        if session.finalized_at is None:
            session.finalized_at = now
        audit_action = "recall_drill_late_completion"
    else:
        session.outcome = "success"
        session.finalized_at = now
        audit_action = "recall_drill_success"

    db.add(
        AuditEvent(
            actor=session.identity,
            action=audit_action,
            entity_type="drill_session",
            entity_id=session.id,
            details_json={
                "variant": session.variant,
                "elapsed_seconds": elapsed,
                "attempts": session.attempts,
                "incorrect_attempts": session.incorrect_attempts,
                "primary_outcome": session.outcome,
            },
        )
    )
    db.commit()
    db.refresh(session)

    data = serialize_session_state(session, now)
    data["idempotent_duplicate"] = False
    data["late_completion_recorded"] = late_completion
    return data


@router.post("/{scoped_token}/finalize")
def finalize_drill_session(
    scoped_token: str,
    body: SessionFinalizeRequest,
    db: Session = Depends(get_db),
    clock: Callable[[], datetime] = Depends(get_clock),
) -> dict[str, object]:
    """Finalize an uncompleted exposed session as timeout or abandoned."""
    session = _get_session_or_404(db, scoped_token)
    now = as_utc(clock())

    if session.outcome is not None:
        return serialize_session_state(session, now)

    if session.exposure_at is None:
        session.validity_status = "excluded_unexposed"
        session.outcome = "abandoned"
    else:
        elapsed = (now - as_utc(session.exposure_at)).total_seconds()
        if elapsed >= STUDY_DEADLINE_SECONDS or body.reason == "timeout":
            session.outcome = "timeout"
        else:
            session.outcome = "abandoned"
        if session.validity_status == "exposed":
            session.validity_status = "valid"

    session.finalized_at = now
    db.add(
        AuditEvent(
            actor=session.identity,
            action="recall_drill_finalized",
            entity_type="drill_session",
            entity_id=session.id,
            details_json={"outcome": session.outcome, "validity_status": session.validity_status},
        )
    )
    db.commit()
    db.refresh(session)
    return serialize_session_state(session, now)
