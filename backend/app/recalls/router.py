"""Operator recall publishing and overview API endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response as FastAPIResponse, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.auth import OperatorSessionInfo, require_operator
from app.core.database import get_db
from app.models.domain import ProductBatch, Recall, RecallTask
from app.recalls.service import build_recall_overview, publish_recall

router = APIRouter(prefix="/api/recalls", tags=["recalls"])

DEFAULT_DRILL_NOTICE = (
    "FICTIONAL RECALL DRILL — ACTION REQUIRED: Inspect your location inventory for the "
    "affected batch, count all units sold and remaining on hand, and confirm all remaining "
    "affected stock has been set aside in quarantine."
)


class RecallPublishRequest(BaseModel):
    """Payload to publish a batch recall drill notice."""

    batch_code: str
    notice_text: str = Field(default=DEFAULT_DRILL_NOTICE, min_length=10)
    notice_version: int = Field(default=1, ge=1)
    is_drill: bool = True


@router.post("", status_code=status.HTTP_201_CREATED)
def create_or_reuse_recall(
    body: RecallPublishRequest,
    http_response: FastAPIResponse,
    operator: OperatorSessionInfo = Depends(require_operator),
    db: Session = Depends(get_db),
) -> dict[str, object]:
    """Publish a recall notice idempotently and return generated location tasks."""
    recall, _tasks, created = publish_recall(
        db,
        batch_code=body.batch_code,
        notice_text=body.notice_text,
        notice_version=body.notice_version,
        is_drill=body.is_drill,
        actor=operator.actor,
    )
    if not created:
        http_response.status_code = status.HTTP_200_OK
    overview = build_recall_overview(db, recall)
    overview["idempotent_reused"] = not created
    return overview


@router.get("")
def list_recalls(db: Session = Depends(get_db)) -> dict[str, object]:
    """List published recalls with task completion counts."""
    recalls = list(db.scalars(select(Recall).order_by(Recall.published_at.desc())).all())
    items: list[dict[str, object]] = []
    for rec in recalls:
        batch = db.get(ProductBatch, rec.batch_id)
        tasks = list(db.scalars(select(RecallTask).where(RecallTask.recall_id == rec.id)).all())
        items.append(
            {
                "id": rec.id,
                "batch_code": batch.batch_code if batch else rec.batch_id,
                "product_name": batch.product_name if batch else "",
                "notice_version": rec.notice_version,
                "is_drill": rec.is_drill,
                "published_at": rec.published_at.isoformat(),
                "total_tasks": len(tasks),
                "completed_tasks": sum(1 for t in tasks if t.status == "reconciled"),
            }
        )
    return {"recalls": items}


@router.get("/{recall_id}")
def get_recall(recall_id: str, db: Session = Depends(get_db)) -> dict[str, object]:
    """Return full operator overview and reconciliation status for one recall."""
    recall = db.get(Recall, recall_id)
    if recall is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Recall '{recall_id}' not found.",
        )
    return build_recall_overview(db, recall)
