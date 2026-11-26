"""Durable PostgreSQL EventOutbox for idempotent, retry-safe Flagsmith event dispatch."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
import uuid

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.experiments.flagsmith_client import FlagsmithAdapter
from app.models.domain import EventOutbox


def enqueue_outbox_event(
    db: Session,
    *,
    logical_event_id: str,
    identity: str,
    event_name: str,
    value: str | int | float | bool | None = None,
    metadata: dict[str, Any] | None = None,
) -> tuple[EventOutbox, bool]:
    """Persist an experiment event idempotently by logical_event_id before dispatch."""
    existing = db.scalar(
        select(EventOutbox).where(EventOutbox.logical_event_id == logical_event_id)
    )
    if existing is not None:
        return existing, False

    row = EventOutbox(
        id=f"ev_{uuid.uuid4().hex[:12]}",
        logical_event_id=logical_event_id,
        identity=identity,
        event_name=event_name,
        payload_json={"value": value, "metadata": metadata or {}},
        dispatch_status="pending",
        attempts=0,
    )
    db.add(row)
    db.flush()
    return row, True


def dispatch_pending_outbox(
    db: Session,
    adapter: FlagsmithAdapter,
    *,
    limit: int = 100,
) -> dict[str, int]:
    """Attempt delivery of pending/failed outbox events to Flagsmith safely."""
    rows = list(
        db.scalars(
            select(EventOutbox)
            .where(EventOutbox.dispatch_status.in_(("pending", "failed")))
            .order_by(EventOutbox.created_at.asc())
            .limit(limit)
        ).all()
    )

    dispatched = 0
    failed = 0
    now = datetime.now(timezone.utc)

    for row in rows:
        row.attempts += 1
        payload = row.payload_json or {}
        try:
            adapter.track_outcome_event(
                event_name=row.event_name,
                identity=row.identity,
                value=payload.get("value"),
                metadata=payload.get("metadata"),
                flush=False,
            )
            row.dispatch_status = "dispatched"
            row.dispatched_at = now
            row.last_error = None
            dispatched += 1
        except Exception as exc:  # noqa: BLE001
            row.dispatch_status = "failed"
            row.last_error = str(exc)
            failed += 1

    if dispatched > 0:
        try:
            adapter.flush()
        except Exception as exc:  # noqa: BLE001
            # Mark batch failed if flush fails so subsequent retry can re-deliver
            for row in rows:
                if row.dispatch_status == "dispatched" and row.dispatched_at == now:
                    row.dispatch_status = "failed"
                    row.dispatched_at = None
                    row.last_error = f"Flush error: {exc}"
            failed += dispatched
            dispatched = 0

    db.commit()

    pending_remaining = int(
        db.scalar(
            select(func.count(EventOutbox.id)).where(
                EventOutbox.dispatch_status.in_(("pending", "failed"))
            )
        )
        or 0
    )
    return {
        "attempted": len(rows),
        "dispatched": dispatched,
        "failed": failed,
        "pending_remaining": pending_remaining,
    }
