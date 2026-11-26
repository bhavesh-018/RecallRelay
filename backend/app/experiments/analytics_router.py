"""Experiment summary metrics, deidentified CSV export, and outbox flush routes."""

from __future__ import annotations

import csv
from io import StringIO
from statistics import median
from typing import Callable

from fastapi import APIRouter, Depends, Query, Response as FastAPIResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.auth import OperatorSessionInfo, require_operator
from app.core.database import get_db
from app.experiments.flagsmith_client import FlagsmithAdapter
from app.experiments.outbox import dispatch_pending_outbox
from app.experiments.sessions_router import get_adapter_factory
from app.models.domain import DrillSession, EventOutbox

router = APIRouter(prefix="/api/experiments", tags=["experiments"])


def _summarize_variant(sessions: list[DrillSession]) -> dict[str, object]:
    exposed_n = len(sessions)
    success_n = sum(1 for s in sessions if s.outcome == "success")
    timeout_n = sum(1 for s in sessions if s.outcome == "timeout")
    abandoned_n = sum(1 for s in sessions if s.outcome in (None, "abandoned"))
    incorrect_total = sum(s.incorrect_attempts for s in sessions)
    success_times = [s.completed_seconds for s in sessions if s.outcome == "success" and s.completed_seconds is not None]
    rate = round((success_n / exposed_n) * 100.0, 2) if exposed_n > 0 else 0.0
    med_sec = round(float(median(success_times)), 2) if success_times else None
    return {
        "exposed_n": exposed_n,
        "success_n": success_n,
        "timeout_n": timeout_n,
        "abandoned_n": abandoned_n,
        "conversion_rate_pct": rate,
        "median_completion_seconds": med_sec,
        "total_incorrect_attempts": incorrect_total,
    }


@router.get("/summary")
def get_experiment_summary(
    include_practice: bool = Query(default=False),
    db: Session = Depends(get_db),
) -> dict[str, object]:
    """Return raw counts, conversion rates, exclusions, and outbox status for recall_response_flow."""
    stmt = select(DrillSession)
    if not include_practice:
        stmt = stmt.where(DrillSession.is_practice.is_(False))
    all_sessions = list(db.scalars(stmt).all())

    valid_exposed = [
        s
        for s in all_sessions
        if s.exposure_at is not None and s.validity_status in ("valid", "exposed")
    ]
    excluded = [s for s in all_sessions if s not in valid_exposed]

    by_variant = {
        "standard": _summarize_variant([s for s in valid_exposed if s.variant == "standard"]),
        "guided": _summarize_variant([s for s in valid_exposed if s.variant == "guided"]),
    }

    exclusions_by_reason: dict[str, int] = {}
    for s in excluded:
        exclusions_by_reason[s.validity_status] = exclusions_by_reason.get(s.validity_status, 0) + 1

    outbox_pending = int(
        db.scalar(select(func.count(EventOutbox.id)).where(EventOutbox.dispatch_status == "pending")) or 0
    )
    outbox_dispatched = int(
        db.scalar(select(func.count(EventOutbox.id)).where(EventOutbox.dispatch_status == "dispatched")) or 0
    )
    outbox_failed = int(
        db.scalar(select(func.count(EventOutbox.id)).where(EventOutbox.dispatch_status == "failed")) or 0
    )

    return {
        "feature_name": "recall_response_flow",
        "include_practice": include_practice,
        "total_sessions": len(all_sessions),
        "valid_exposed_n": len(valid_exposed),
        "excluded_n": len(excluded),
        "exclusions_by_reason": exclusions_by_reason,
        "variants": by_variant,
        "outbox": {
            "pending": outbox_pending,
            "dispatched": outbox_dispatched,
            "failed": outbox_failed,
        },
    }


@router.get("/export.csv")
def export_experiment_csv(
    include_practice: bool = Query(default=False),
    _operator: OperatorSessionInfo = Depends(require_operator),
    db: Session = Depends(get_db),
) -> FastAPIResponse:
    """Export deidentified DrillSession rows reproducing exact raw summary counts."""
    stmt = select(DrillSession).order_by(DrillSession.exposure_at.asc(), DrillSession.id.asc())
    if not include_practice:
        stmt = stmt.where(DrillSession.is_practice.is_(False))
    rows = list(db.scalars(stmt).all())

    buf = StringIO()
    writer = csv.writer(buf)
    writer.writerow(
        [
            "session_id",
            "participant_alias",
            "identity",
            "scenario_id",
            "variant",
            "is_practice",
            "validity_status",
            "outcome",
            "attempts",
            "incorrect_attempts",
            "completed_seconds",
            "exposure_at",
            "started_at",
            "finalized_at",
        ]
    )
    for s in rows:
        writer.writerow(
            [
                s.id,
                s.participant_alias,
                s.identity,
                s.scenario_id,
                s.variant or "",
                "true" if s.is_practice else "false",
                s.validity_status,
                s.outcome or "",
                s.attempts,
                s.incorrect_attempts,
                "" if s.completed_seconds is None else s.completed_seconds,
                s.exposure_at.isoformat() if s.exposure_at else "",
                s.started_at.isoformat() if s.started_at else "",
                s.finalized_at.isoformat() if s.finalized_at else "",
            ]
        )

    return FastAPIResponse(
        content=buf.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="recallrelay_experiment_results.csv"'},
    )


@router.post("/outbox/dispatch")
def flush_outbox(
    _operator: OperatorSessionInfo = Depends(require_operator),
    db: Session = Depends(get_db),
    adapter_factory: Callable[[bool], FlagsmithAdapter] = Depends(get_adapter_factory),
) -> dict[str, int]:
    """Retry dispatching pending or failed EventOutbox entries to Flagsmith."""
    adapter = adapter_factory(False)
    try:
        return dispatch_pending_outbox(db, adapter)
    finally:
        adapter.close()
