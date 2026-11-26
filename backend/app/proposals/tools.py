"""Allowlisted read-only tools for the RecallRelay bounded product agent."""

from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.experiments.flagsmith_client import (
    FlagsmithManagementClient,
    compute_pilot_config_hash,
)
from app.models.domain import (
    AuditEvent,
    DrillSession,
    ProductBatch,
    Recall,
    RecallTask,
    Response,
)

ALLOWLISTED_PILOT_ENVIRONMENT = "Pilot"
ALLOWLISTED_PILOT_FEATURE = "recall_response_flow"
ALLOWED_PROPOSAL_VARIANTS: tuple[str, ...] = ("standard", "guided")
PERMITTED_AGENT_TOOLS: tuple[str, ...] = (
    "get_drill_summary",
    "get_discrepancies",
    "get_pilot_flag",
    "preview_workflow_change",
    "validate_proposal",
)


def _resolve_recall(db: Session, drill_id: str) -> Recall | None:
    """Resolve drill_id as either a Recall.id or a ProductBatch.batch_code."""
    recall = db.get(Recall, drill_id)
    if recall is not None:
        return recall
    batch = db.scalar(select(ProductBatch).where(ProductBatch.batch_code == drill_id))
    if batch is None:
        return None
    return db.scalar(
        select(Recall).where(Recall.batch_id == batch.id).order_by(Recall.notice_version.desc())
    )


def get_drill_summary(db: Session, drill_id: str) -> dict[str, Any]:
    """Read-only tool returning deterministic drill counts and referenced evidence IDs."""
    recall = _resolve_recall(db, drill_id)
    tasks: list[RecallTask] = []
    responses: list[Response] = []
    if recall is not None:
        tasks = list(db.scalars(select(RecallTask).where(RecallTask.recall_id == recall.id)).all())
        task_ids = [t.id for t in tasks]
        if task_ids:
            responses = list(db.scalars(select(Response).where(Response.task_id.in_(task_ids))).all())

    sessions = list(
        db.scalars(
            select(DrillSession).where(
                DrillSession.exposure_at.is_not(None),
                DrillSession.validity_status.in_(("valid", "exposed")),
            )
        ).all()
    )

    by_variant: dict[str, dict[str, int]] = {}
    for variant in ALLOWED_PROPOSAL_VARIANTS:
        v_sessions = [s for s in sessions if s.variant == variant]
        by_variant[variant] = {
            "exposed_n": len(v_sessions),
            "success_n": sum(1 for s in v_sessions if s.outcome == "success"),
            "timeout_n": sum(1 for s in v_sessions if s.outcome == "timeout"),
            "incorrect_attempts": sum(s.incorrect_attempts for s in v_sessions),
        }

    evidence_ids = [t.id for t in tasks] + [s.id for s in sessions]
    return {
        "drill_id": drill_id,
        "recall_id": recall.id if recall else None,
        "total_tasks": len(tasks),
        "reconciled_tasks": sum(1 for t in tasks if t.status == "reconciled"),
        "pending_tasks": sum(1 for t in tasks if t.status != "reconciled"),
        "responses_recorded": len(responses),
        "session_total_exposed": len(sessions),
        "variants": by_variant,
        "evidence_ids": evidence_ids,
    }


def get_discrepancies(db: Session, drill_id: str) -> dict[str, Any]:
    """Read-only tool returning backend-calculated missing tasks and rejected attempts."""
    recall = _resolve_recall(db, drill_id)
    missing_task_ids: list[str] = []
    task_ids: list[str] = []
    if recall is not None:
        tasks = list(db.scalars(select(RecallTask).where(RecallTask.recall_id == recall.id)).all())
        task_ids = [t.id for t in tasks]
        missing_task_ids = [t.id for t in tasks if t.status != "reconciled"]

    rejected_events = list(
        db.scalars(
            select(AuditEvent).where(
                AuditEvent.action.in_(
                    ("reject_response", "recall_response_rejected", "recall_response_mismatch")
                )
            )
        ).all()
    )

    relevant_rejections = [
        {
            "audit_id": ev.id,
            "entity_id": ev.entity_id,
            "action": ev.action,
            "code": ev.details_json.get("code"),
        }
        for ev in rejected_events
        if (not task_ids or ev.entity_id in task_ids or ev.entity_type == "drill_session")
    ]

    return {
        "drill_id": drill_id,
        "missing_or_incomplete_tasks": missing_task_ids,
        "rejected_attempt_count": len(relevant_rejections),
        "rejections": relevant_rejections[:25],
    }


def get_pilot_flag(
    settings: Settings,
    mgmt_client: FlagsmithManagementClient | None = None,
) -> dict[str, Any]:
    """Read allowlisted Pilot / recall_response_flow config and deterministic baseline hash."""
    client = mgmt_client
    if client is None and settings.flagsmith_management_token and settings.flagsmith_pilot_env_id:
        client = FlagsmithManagementClient(
            management_token=settings.flagsmith_management_token,
            admin_api_url=settings.flagsmith_admin_api_url,
        )

    if client is not None and settings.flagsmith_pilot_env_id:
        snap = client.read_pilot_flag(
            environment_id=settings.flagsmith_pilot_env_id,
            feature_name=ALLOWLISTED_PILOT_FEATURE,
        )
        return {
            "source": "flagsmith_management_api",
            "target_environment": ALLOWLISTED_PILOT_ENVIRONMENT,
            "environment_id": snap.environment_id,
            "target_feature": snap.feature_name,
            "feature_state_id": snap.feature_state_id,
            "enabled": snap.enabled,
            "default_value": snap.default_value,
            "multivariate_weights": snap.multivariate_weights,
            "baseline_config_hash": snap.config_hash,
        }

    # Local fallback when Flagsmith Management API credentials are not configured yet
    weights = {"standard": 50.0, "guided": 50.0}
    baseline_hash = compute_pilot_config_hash(
        enabled=True,
        default_value="standard",
        multivariate_weights=weights,
    )
    return {
        "source": "local_simulated",
        "target_environment": ALLOWLISTED_PILOT_ENVIRONMENT,
        "environment_id": settings.flagsmith_pilot_env_id or "pilot-local",
        "target_feature": ALLOWLISTED_PILOT_FEATURE,
        "feature_state_id": 0,
        "enabled": True,
        "default_value": "standard",
        "multivariate_weights": weights,
        "baseline_config_hash": baseline_hash,
    }


def preview_workflow_change(
    pilot_flag: dict[str, Any],
    desired_variant: str,
) -> dict[str, Any]:
    """Build a read-only before/after diff preview for an allowlisted workflow change."""
    if desired_variant not in ALLOWED_PROPOSAL_VARIANTS:
        raise ValueError(
            f"Desired variant '{desired_variant}' is not allowlisted. Allowed: {ALLOWED_PROPOSAL_VARIANTS}."
        )

    before_weights = dict(pilot_flag.get("multivariate_weights") or {"standard": 50.0, "guided": 50.0})
    after_weights = {
        "standard": 100.0 if desired_variant == "standard" else 0.0,
        "guided": 100.0 if desired_variant == "guided" else 0.0,
    }
    return {
        "target_environment": ALLOWLISTED_PILOT_ENVIRONMENT,
        "target_feature": ALLOWLISTED_PILOT_FEATURE,
        "baseline_config_hash": pilot_flag["baseline_config_hash"],
        "before": {"multivariate_weights": before_weights},
        "after": {"multivariate_weights": after_weights, "desired_variant": desired_variant},
        "predicted_effect": (
            f"Routes 100% of Pilot practice identities to '{desired_variant}' "
            f"without altering the frozen Study environment."
        ),
    }
