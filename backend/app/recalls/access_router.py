"""Host-aware QR code generation and authenticated practice-only reset endpoints."""

from __future__ import annotations

import base64
from io import BytesIO
from pathlib import Path
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response as FastAPIResponse, status
import qrcode
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.core.auth import OperatorSessionInfo, require_operator
from app.core.config import Settings, get_settings
from app.core.database import get_db
from app.models.domain import (
    AuditEvent,
    DrillSession,
    Location,
    ProductBatch,
    Recall,
    RecallTask,
    Response,
)
from app.shipments.seed import load_fixture_into_db

router = APIRouter(prefix="/api", tags=["access-integration"])

DEFAULT_FIXTURE_PATH = Path(__file__).resolve().parents[3] / "fixtures" / "food_drill.json"


def resolve_public_base_url(
    request: Request,
    settings: Settings,
    override_base_url: str | None = None,
) -> tuple[str, bool]:
    """Resolve participant-accessible base URL and flag localhost-only addresses."""
    candidate: str | None = None
    if override_base_url and override_base_url.strip():
        candidate = override_base_url.strip().rstrip("/")
    else:
        fwd_host = request.headers.get("x-forwarded-host", "").strip()
        fwd_proto = request.headers.get("x-forwarded-proto", "https").strip()
        if fwd_host:
            candidate = f"{fwd_proto}://{fwd_host}".rstrip("/")
        elif settings.public_base_url and settings.public_base_url.strip():
            candidate = settings.public_base_url.strip().rstrip("/")
        else:
            candidate = str(request.base_url).rstrip("/")

    parsed = urlparse(candidate)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail={"code": "INVALID_BASE_URL", "message": "base_url must be a valid http(s) origin."},
        )

    host = (parsed.hostname or "").lower()
    is_localhost = host in ("localhost", "127.0.0.1", "0.0.0.0", "::1")
    return candidate, is_localhost


def generate_qr_png_bytes(target_url: str) -> bytes:
    """Render a high-contrast PNG QR code for a scoped participant task URL."""
    qr = qrcode.QRCode(
        version=None,
        error_correction=qrcode.constants.ERROR_CORRECT_M,
        box_size=8,
        border=2,
    )
    qr.add_data(target_url)
    qr.make(fit=True)
    img = qr.make_image(fill_color="black", back_color="white")
    buffer = BytesIO()
    img.save(buffer, format="PNG")
    return buffer.getvalue()


@router.get("/tasks/{task_id}/qr")
def get_task_qr(
    task_id: str,
    request: Request,
    output_format: str = Query(default="png", alias="format", pattern="^(png|json)$"),
    base_url: str | None = Query(default=None),
    _operator: OperatorSessionInfo = Depends(require_operator),
    settings: Settings = Depends(get_settings),
    db: Session = Depends(get_db),
) -> object:
    """Generate a host-aware QR code for one scoped participant recall task."""
    task = db.get(RecallTask, task_id)
    if task is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Task '{task_id}' not found.",
        )

    location = db.get(Location, task.location_id)
    resolved_base, is_localhost = resolve_public_base_url(request, settings, base_url)
    target_url = f"{resolved_base}/t/{task.access_token}"
    png_bytes = generate_qr_png_bytes(target_url)

    if output_format == "json":
        b64 = base64.b64encode(png_bytes).decode("ascii")
        return {
            "task_id": task.id,
            "location_id": task.location_id,
            "location_name": location.name if location else task.location_id,
            "target_url": target_url,
            "is_localhost_warning": is_localhost,
            "banner": "Fictional recall drill",
            "qr_data_url": f"data:image/png;base64,{b64}",
        }

    return FastAPIResponse(
        content=png_bytes,
        media_type="image/png",
        headers={
            "X-QR-Target-URL": target_url,
            "X-QR-Localhost-Warning": "true" if is_localhost else "false",
        },
    )


@router.post("/practice/reset")
def reset_practice_fixture(
    operator: OperatorSessionInfo = Depends(require_operator),
    db: Session = Depends(get_db),
) -> dict[str, object]:
    """Reset practice drill sessions and food_drill tasks while strictly preserving real study data."""
    practice_deleted = db.execute(
        delete(DrillSession).where(DrillSession.is_practice.is_(True))
    ).rowcount or 0

    study_preserved = int(
        db.scalar(select(func.count(DrillSession.id)).where(DrillSession.is_practice.is_(False))) or 0
    )

    food_batch_ids = list(
        db.scalars(select(ProductBatch.id).where(ProductBatch.dataset_key == "food_drill")).all()
    )
    recalls_deleted = 0
    if food_batch_ids:
        recall_ids = list(
            db.scalars(select(Recall.id).where(Recall.batch_id.in_(food_batch_ids))).all()
        )
        if recall_ids:
            task_ids = list(
                db.scalars(select(RecallTask.id).where(RecallTask.recall_id.in_(recall_ids))).all()
            )
            if task_ids:
                db.execute(delete(Response).where(Response.task_id.in_(task_ids)))
                db.execute(delete(RecallTask).where(RecallTask.id.in_(task_ids)))
            recalls_deleted = db.execute(delete(Recall).where(Recall.id.in_(recall_ids))).rowcount or 0

    db.flush()
    reseeded = load_fixture_into_db(db, DEFAULT_FIXTURE_PATH, reset_dataset=False)

    db.add(
        AuditEvent(
            actor=operator.actor,
            action="practice_reset",
            entity_type="dataset",
            entity_id="food_drill",
            details_json={
                "practice_sessions_deleted": practice_deleted,
                "study_sessions_preserved": study_preserved,
                "recalls_deleted": recalls_deleted,
            },
        )
    )
    db.commit()

    return {
        "status": "reset_complete",
        "dataset_key": "food_drill",
        "practice_sessions_deleted": practice_deleted,
        "study_sessions_preserved": study_preserved,
        "recalls_deleted": recalls_deleted,
        "reseeded": reseeded,
    }
