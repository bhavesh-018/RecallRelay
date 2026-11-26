"""Deterministic proposal validator rejecting hallucinated evidence or unauthorized targets."""

from __future__ import annotations

from typing import Any

from app.proposals.tools import (
    ALLOWED_PROPOSAL_VARIANTS,
    ALLOWLISTED_PILOT_ENVIRONMENT,
    ALLOWLISTED_PILOT_FEATURE,
)

ALLOWED_RECOMMENDATION_TYPES: tuple[str, ...] = ("change_workflow", "collect_more_evidence")


def validate_proposal(
    proposal: dict[str, Any],
    drill_summary: dict[str, Any],
    pilot_flag: dict[str, Any],
) -> list[str]:
    """Validate an LLM-generated proposal against authoritative backend evidence and allowlists."""
    errors: list[str] = []

    target_env = str(proposal.get("target_environment", ""))
    if target_env != ALLOWLISTED_PILOT_ENVIRONMENT:
        errors.append(
            f"Target environment '{target_env}' is not allowlisted; only '{ALLOWLISTED_PILOT_ENVIRONMENT}' is permitted."
        )

    target_feature = str(proposal.get("target_feature", ""))
    if target_feature != ALLOWLISTED_PILOT_FEATURE:
        errors.append(
            f"Target feature '{target_feature}' is not allowlisted; only '{ALLOWLISTED_PILOT_FEATURE}' is permitted."
        )

    rec_type = str(proposal.get("recommendation_type", ""))
    if rec_type not in ALLOWED_RECOMMENDATION_TYPES:
        errors.append(
            f"recommendation_type '{rec_type}' must be one of {ALLOWED_RECOMMENDATION_TYPES}."
        )

    desired_variant = proposal.get("desired_variant")
    if rec_type == "change_workflow" and desired_variant not in ALLOWED_PROPOSAL_VARIANTS:
        errors.append(
            f"desired_variant '{desired_variant}' must be one of {ALLOWED_PROPOSAL_VARIANTS}."
        )

    baseline_hash = str(proposal.get("baseline_config_hash", ""))
    expected_hash = str(pilot_flag.get("baseline_config_hash", ""))
    if baseline_hash != expected_hash:
        errors.append(
            f"baseline_config_hash mismatch: got '{baseline_hash}', expected '{expected_hash}'."
        )

    # Evidence ID verification — zero invented IDs allowed
    known_evidence = set(drill_summary.get("evidence_ids") or [])
    cited_evidence = proposal.get("evidence_ids")
    if not isinstance(cited_evidence, list):
        errors.append("evidence_ids must be a list of record IDs.")
    else:
        if known_evidence and len(cited_evidence) == 0:
            errors.append("At least one existing evidence record ID must be cited.")
        invented = [eid for eid in cited_evidence if str(eid) not in known_evidence]
        if invented:
            errors.append(f"Invented or unknown evidence IDs rejected: {invented}.")

    # Quoted count verification against deterministic summary
    observed = proposal.get("observed_counts")
    if not isinstance(observed, dict):
        errors.append("observed_counts object is required.")
    else:
        variants = drill_summary.get("variants") or {}
        expected_counts = {
            "standard_exposed_n": int(variants.get("standard", {}).get("exposed_n", 0)),
            "standard_success_n": int(variants.get("standard", {}).get("success_n", 0)),
            "guided_exposed_n": int(variants.get("guided", {}).get("exposed_n", 0)),
            "guided_success_n": int(variants.get("guided", {}).get("success_n", 0)),
        }
        for key, expected_val in expected_counts.items():
            actual_val = observed.get(key)
            if actual_val != expected_val:
                errors.append(
                    f"Quoted count mismatch for '{key}': proposal cited {actual_val}, actual is {expected_val}."
                )

    rationale = str(proposal.get("rationale", "")).strip()
    if len(rationale) < 10:
        errors.append("rationale must be a clear explanation of at least 10 characters.")

    if proposal.get("skip_approval") is True or proposal.get("auto_apply") is True:
        errors.append("Bypassing human operator approval is strictly prohibited.")

    return errors
