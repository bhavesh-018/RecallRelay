"""Operator API routes for running the bounded agent and approving/rejecting proposals."""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.auth import OperatorSessionInfo, require_operator
from app.core.config import Settings, get_settings
from app.core.database import get_db
from app.experiments.flagsmith_client import FlagsmithManagementClient
from app.models.domain import AgentProposal, AgentRun, AgentToolCall, AuditEvent
from app.proposals.orchestrator import LLMCallable, run_bounded_agent_loop
from app.proposals.tools import get_pilot_flag

router = APIRouter(prefix="/api/agent", tags=["agent-workbench"])


class AgentRunRequest(BaseModel):
    """Operator prompt payload to trigger a bounded drill review run."""

    drill_id: str = Field(default="B17", min_length=1)
    instruction: str = Field(
        default="Review this drill and prepare a pilot workflow improvement.",
        min_length=5,
    )


class ProposalDecisionRequest(BaseModel):
    """Explicit revision-locked operator approval or rejection request."""

    revision: int = Field(ge=1)
    note: str | None = None


def get_llm_callable() -> LLMCallable | None:
    """Dependency returning optional custom LLM callable (overrideable in tests)."""
    return None


def get_mgmt_client() -> FlagsmithManagementClient | None:
    """Dependency returning optional FlagsmithManagementClient (overrideable in tests)."""
    return None


def _serialize_proposal(prop: AgentProposal) -> dict[str, object]:
    return {
        "id": prop.id,
        "drill_id": prop.drill_id,
        "target_environment": prop.target_environment,
        "target_feature": prop.target_feature,
        "baseline_config_hash": prop.baseline_config_hash,
        "diff": prop.diff_json,
        "evidence_ids": prop.evidence_ids_json,
        "rationale": prop.rationale,
        "status": prop.status,
        "revision": prop.revision,
        "approver": prop.approver,
        "approved_at": prop.approved_at.isoformat() if prop.approved_at else None,
        "apply_idempotency_key": prop.apply_idempotency_key,
        "created_at": prop.created_at.isoformat(),
        "updated_at": prop.updated_at.isoformat(),
    }


@router.post("/runs", status_code=status.HTTP_201_CREATED)
def trigger_agent_run(
    body: AgentRunRequest,
    operator: OperatorSessionInfo = Depends(require_operator),
    settings: Settings = Depends(get_settings),
    db: Session = Depends(get_db),
    llm_callable: LLMCallable | None = Depends(get_llm_callable),
    mgmt_client: FlagsmithManagementClient | None = Depends(get_mgmt_client),
) -> dict[str, object]:
    """Run the bounded product agent loop for one drill and persist run/tool/proposal records."""
    return run_bounded_agent_loop(
        db,
        settings=settings,
        drill_id=body.drill_id,
        operator_instruction=body.instruction,
        actor=operator.actor,
        llm_callable=llm_callable,
        mgmt_client=mgmt_client,
    )


@router.get("/proposals")
def list_agent_proposals(
    _operator: OperatorSessionInfo = Depends(require_operator),
    db: Session = Depends(get_db),
) -> dict[str, object]:
    """List persisted agent proposals alongside recent bounded runs and tool traces."""
    proposals = list(
        db.scalars(select(AgentProposal).order_by(AgentProposal.created_at.desc())).all()
    )
    runs = list(
        db.scalars(select(AgentRun).order_by(AgentRun.created_at.desc()).limit(10)).all()
    )
    run_items: list[dict[str, object]] = []
    for r in runs:
        tcs = list(
            db.scalars(
                select(AgentToolCall)
                .where(AgentToolCall.run_id == r.id)
                .order_by(AgentToolCall.id.asc())
            ).all()
        )
        run_items.append(
            {
                "id": r.id,
                "drill_id": r.drill_id,
                "state": r.state,
                "attempts": r.attempts,
                "model_name": r.model_name,
                "token_usage": r.token_usage_json,
                "error_message": r.error_message,
                "created_at": r.created_at.isoformat(),
                "completed_at": r.completed_at.isoformat() if r.completed_at else None,
                "tool_calls": [
                    {
                        "tool_name": tc.tool_name,
                        "status": tc.status,
                        "duration_ms": tc.duration_ms,
                        "input_hash": tc.input_hash,
                        "output_hash": tc.output_hash,
                    }
                    for tc in tcs
                ],
            }
        )

    return {
        "proposals": [_serialize_proposal(p) for p in proposals],
        "runs": run_items,
    }


@router.post("/proposals/{proposal_id}/approve")
def approve_proposal(
    proposal_id: str,
    body: ProposalDecisionRequest,
    operator: OperatorSessionInfo = Depends(require_operator),
    settings: Settings = Depends(get_settings),
    db: Session = Depends(get_db),
    mgmt_client: FlagsmithManagementClient | None = Depends(get_mgmt_client),
) -> dict[str, object]:
    """Explicitly approve a specific proposal revision after checking baseline config hash."""
    proposal = db.get(AgentProposal, proposal_id)
    if proposal is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Proposal not found.")

    if proposal.revision != body.revision:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "REVISION_MISMATCH",
                "message": f"Approval named revision {body.revision}, but current revision is {proposal.revision}.",
            },
        )

    if proposal.status != "pending_review":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "INVALID_PROPOSAL_STATE",
                "message": f"Proposal cannot be approved from state '{proposal.status}'.",
            },
        )

    # Check live pilot baseline hash before allowing approval
    current_pilot = get_pilot_flag(settings, mgmt_client)
    if current_pilot["baseline_config_hash"] != proposal.baseline_config_hash:
        proposal.status = "stale_conflict"
        db.add(
            AuditEvent(
                actor=operator.actor,
                action="proposal_stale_conflict",
                entity_type="agent_proposal",
                entity_id=proposal.id,
                revision_ref=proposal.revision,
                details_json={
                    "expected_hash": proposal.baseline_config_hash,
                    "current_hash": current_pilot["baseline_config_hash"],
                },
            )
        )
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "STALE_CONFIG_HASH",
                "message": "Pilot configuration changed after proposal generation. Regenerate a fresh proposal.",
            },
        )

    now = datetime.now(timezone.utc)
    proposal.status = "approved"
    proposal.approver = operator.actor
    proposal.approved_at = now
    proposal.apply_idempotency_key = f"apply_{proposal.id}_rev{proposal.revision}"
    db.add(
        AuditEvent(
            actor=operator.actor,
            action="approve_proposal",
            entity_type="agent_proposal",
            entity_id=proposal.id,
            revision_ref=proposal.revision,
            details_json={"note": body.note, "baseline_config_hash": proposal.baseline_config_hash},
        )
    )
    db.commit()
    db.refresh(proposal)
    return _serialize_proposal(proposal)


@router.post("/proposals/{proposal_id}/reject")
def reject_proposal(
    proposal_id: str,
    body: ProposalDecisionRequest,
    operator: OperatorSessionInfo = Depends(require_operator),
    db: Session = Depends(get_db),
) -> dict[str, object]:
    """Explicitly reject a proposal revision, guaranteeing no Flagsmith write occurs."""
    proposal = db.get(AgentProposal, proposal_id)
    if proposal is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Proposal not found.")

    if proposal.revision != body.revision:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "REVISION_MISMATCH",
                "message": f"Rejection named revision {body.revision}, but current revision is {proposal.revision}.",
            },
        )

    if proposal.status != "pending_review":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "INVALID_PROPOSAL_STATE",
                "message": f"Proposal cannot be rejected from state '{proposal.status}'.",
            },
        )

    proposal.status = "rejected"
    proposal.approver = operator.actor
    db.add(
        AuditEvent(
            actor=operator.actor,
            action="reject_proposal",
            entity_type="agent_proposal",
            entity_id=proposal.id,
            revision_ref=proposal.revision,
            details_json={"note": body.note},
        )
    )
    db.commit()
    db.refresh(proposal)
    return _serialize_proposal(proposal)
