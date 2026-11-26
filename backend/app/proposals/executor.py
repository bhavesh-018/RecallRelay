"""Serialized Flagsmith Management API apply, readback verification, and timeout recovery."""

from __future__ import annotations

import threading
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.experiments.flagsmith_client import FlagsmithManagementClient, PilotFlagSnapshot
from app.models.domain import AgentProposal, AuditEvent
from app.proposals.tools import ALLOWLISTED_PILOT_FEATURE, get_pilot_flag

_PILOT_WRITE_LOCK = threading.Lock()


def _weights_match(actual: dict[str, float], desired: dict[str, float]) -> bool:
    """Compare multivariate weight dictionaries with floating-point tolerance."""
    if set(actual.keys()) != set(desired.keys()):
        return False
    return all(abs(float(actual[k]) - float(desired[k])) < 0.01 for k in desired)


def apply_and_verify_proposal(
    db: Session,
    *,
    proposal_id: str,
    revision: int,
    actor: str,
    settings: Settings,
    mgmt_client: FlagsmithManagementClient | None = None,
) -> dict[str, Any]:
    """Apply an operator-approved pilot diff, reconcile timeouts via readback, and verify state."""
    proposal = db.get(AgentProposal, proposal_id)
    if proposal is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Proposal not found.")

    if proposal.revision != revision:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "REVISION_MISMATCH",
                "message": f"Apply named revision {revision}, but proposal is at revision {proposal.revision}.",
            },
        )

    if proposal.status == "verified":
        return {
            "proposal_id": proposal.id,
            "status": proposal.status,
            "idempotent_reused": True,
            "reconciled_after_timeout": False,
            "baseline_config_hash": proposal.baseline_config_hash,
        }

    if proposal.status != "approved":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "UNAPPROVED_PROPOSAL",
                "message": f"Cannot apply proposal in status '{proposal.status}'; explicit human approval is required.",
            },
        )

    diff = proposal.diff_json or {}
    if diff.get("recommendation_type") != "change_workflow":
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail={
                "code": "NOT_APPLICABLE",
                "message": "Proposal recommends collecting more evidence and has no Flagsmith write to apply.",
            },
        )

    after_cfg = diff.get("after") or {}
    desired_weights: dict[str, float] = {
        str(k): float(v) for k, v in (after_cfg.get("multivariate_weights") or {}).items()
    }
    if not desired_weights:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail={"code": "EMPTY_DIFF", "message": "Proposal has no multivariate weights to apply."},
        )

    client = mgmt_client
    if client is None and settings.flagsmith_management_token and settings.flagsmith_pilot_env_id:
        client = FlagsmithManagementClient(
            management_token=settings.flagsmith_management_token,
            admin_api_url=settings.flagsmith_admin_api_url,
        )

    with _PILOT_WRITE_LOCK:
        # 1. Reread live config to detect stale baseline before writing
        current_pilot = get_pilot_flag(settings, client)
        if current_pilot["baseline_config_hash"] != proposal.baseline_config_hash:
            proposal.status = "stale_conflict"
            db.add(
                AuditEvent(
                    actor=actor,
                    action="apply_stale_conflict",
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
                    "message": "Pilot configuration drifted after approval. Regenerate and re-approve a fresh proposal.",
                },
            )

        # 2. Persist apply intent with idempotency key BEFORE external API write
        db.add(
            AuditEvent(
                actor=actor,
                action="apply_intent",
                entity_type="agent_proposal",
                entity_id=proposal.id,
                revision_ref=proposal.revision,
                details_json={
                    "apply_idempotency_key": proposal.apply_idempotency_key,
                    "desired_weights": desired_weights,
                },
            )
        )
        db.commit()

        # 3. Execute external Flagsmith Management API write (or explicit local simulation if unconfigured)
        reconciled_after_timeout = False
        if client is None or not settings.flagsmith_pilot_env_id:
            proposal.status = "verified"
            db.add(
                AuditEvent(
                    actor=actor,
                    action="verify_applied_change",
                    entity_type="agent_proposal",
                    entity_id=proposal.id,
                    revision_ref=proposal.revision,
                    details_json={
                        "mode": "local_simulated",
                        "desired_weights": desired_weights,
                    },
                )
            )
            db.commit()
            return {
                "proposal_id": proposal.id,
                "status": proposal.status,
                "mode": "local_simulated",
                "idempotent_reused": False,
                "reconciled_after_timeout": False,
                "readback_weights": desired_weights,
            }

        snap: PilotFlagSnapshot = client.read_pilot_flag(
            environment_id=settings.flagsmith_pilot_env_id,
            feature_name=ALLOWLISTED_PILOT_FEATURE,
        )
        try:
            client.update_pilot_multivariate_weights(
                environment_id=settings.flagsmith_pilot_env_id,
                snapshot=snap,
                desired_weights=desired_weights,
            )
        except Exception as write_exc:  # noqa: BLE001
            # 4. Timeout/error recovery: read back upstream state before failing or retrying
            try:
                readback = client.read_pilot_flag(
                    environment_id=settings.flagsmith_pilot_env_id,
                    feature_name=ALLOWLISTED_PILOT_FEATURE,
                )
            except Exception as read_exc:  # noqa: BLE001
                proposal.status = "failed"
                db.add(
                    AuditEvent(
                        actor=actor,
                        action="apply_failed",
                        entity_type="agent_proposal",
                        entity_id=proposal.id,
                        revision_ref=proposal.revision,
                        details_json={"write_error": str(write_exc), "readback_error": str(read_exc)},
                    )
                )
                db.commit()
                raise HTTPException(
                    status_code=status.HTTP_502_BAD_GATEWAY,
                    detail={"code": "APPLY_FAILED", "message": f"Write and readback failed: {write_exc}"},
                ) from read_exc

            if _weights_match(readback.multivariate_weights, desired_weights):
                reconciled_after_timeout = True
            else:
                proposal.status = "failed"
                db.add(
                    AuditEvent(
                        actor=actor,
                        action="apply_failed",
                        entity_type="agent_proposal",
                        entity_id=proposal.id,
                        revision_ref=proposal.revision,
                        details_json={
                            "write_error": str(write_exc),
                            "readback_weights": readback.multivariate_weights,
                        },
                    )
                )
                db.commit()
                raise HTTPException(
                    status_code=status.HTTP_502_BAD_GATEWAY,
                    detail={"code": "APPLY_FAILED", "message": f"Flagsmith apply failed: {write_exc}"},
                ) from write_exc

        # 5. Mandatory post-write readback verification
        verified_snap = client.read_pilot_flag(
            environment_id=settings.flagsmith_pilot_env_id,
            feature_name=ALLOWLISTED_PILOT_FEATURE,
        )
        if not _weights_match(verified_snap.multivariate_weights, desired_weights):
            proposal.status = "failed"
            db.add(
                AuditEvent(
                    actor=actor,
                    action="verify_mismatch",
                    entity_type="agent_proposal",
                    entity_id=proposal.id,
                    revision_ref=proposal.revision,
                    details_json={
                        "desired_weights": desired_weights,
                        "readback_weights": verified_snap.multivariate_weights,
                    },
                )
            )
            db.commit()
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail={"code": "READBACK_MISMATCH", "message": "Readback weights did not match desired diff."},
            )

        proposal.status = "verified"
        db.add(
            AuditEvent(
                actor=actor,
                action="verify_applied_change",
                entity_type="agent_proposal",
                entity_id=proposal.id,
                revision_ref=proposal.revision,
                details_json={
                    "mode": "flagsmith_management_api",
                    "reconciled_after_timeout": reconciled_after_timeout,
                    "before_hash": proposal.baseline_config_hash,
                    "after_hash": verified_snap.config_hash,
                    "readback_weights": verified_snap.multivariate_weights,
                },
            )
        )
        db.commit()

        return {
            "proposal_id": proposal.id,
            "status": proposal.status,
            "mode": "flagsmith_management_api",
            "idempotent_reused": False,
            "reconciled_after_timeout": reconciled_after_timeout,
            "before_hash": proposal.baseline_config_hash,
            "after_hash": verified_snap.config_hash,
            "readback_weights": verified_snap.multivariate_weights,
        }
