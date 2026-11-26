"""DrillSession evaluation, 300-second cutoff, and deterministic fallback helpers."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
from typing import Any, Mapping

from app.core.config import Settings
from app.experiments.flagsmith_client import FlagsmithAdapter, build_flagsmith_client
from app.models.domain import DrillSession

STUDY_DEADLINE_SECONDS = 300.0

DEFAULT_STUDY_NOTICE = (
    "FICTIONAL RECALL DRILL — ACTION REQUIRED: Your shop received 15 packs of "
    "SunGrain Crunchy Oats 500g (Batch B17). Register records show 5 packs were sold, "
    "and 10 unopened packs remain on the shelf to be set aside in quarantine."
)


def as_utc(dt: datetime) -> datetime:
    """Ensure a datetime from SQLite or PostgreSQL is timezone-aware UTC."""
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def compute_remaining_seconds(session: DrillSession, now: datetime | None = None) -> float:
    """Compute remaining seconds in the 300-second primary window from server exposure_at."""
    if session.exposure_at is None:
        return STUDY_DEADLINE_SECONDS
    current = as_utc(now or datetime.now(timezone.utc))
    elapsed = (current - as_utc(session.exposure_at)).total_seconds()
    return max(0.0, round(STUDY_DEADLINE_SECONDS - elapsed, 2))


@dataclass
class _LocalFlag:
    enabled: bool
    value: str
    variant: str
    experiment: Any = None
    is_default: bool = False


class LocalDeterministicFlagsmithClient:
    """Deterministic 50/50 fallback used only when no Flagsmith SDK key is configured locally."""

    def get_experiment_flag(
        self,
        feature_name: str,
        identifier: str,
        traits: Mapping[str, Any] | None = None,
    ) -> _LocalFlag:
        digest = hashlib.sha256(f"{feature_name}:{identifier}".encode("utf-8")).digest()
        variant = "guided" if (digest[0] % 2 == 1) else "standard"
        return _LocalFlag(enabled=True, value=variant, variant=variant)

    def track_event(
        self,
        event: str,
        identifier: str | None = None,
        value: Any = None,
        traits: Mapping[str, Any] | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> None:
        return None

    def flush_events(self) -> None:
        return None

    def close(self) -> None:
        return None


def get_flagsmith_adapter_for_session(settings: Settings, is_practice: bool) -> FlagsmithAdapter:
    """Select Study or Pilot Flagsmith SDK key (or deterministic local dev fallback)."""
    key = settings.flagsmith_pilot_key if is_practice else settings.flagsmith_study_key
    if not key:
        key = settings.flagsmith_study_key or settings.flagsmith_pilot_key
    if key:
        client = build_flagsmith_client(
            environment_key=key,
            api_url=settings.flagsmith_api_url,
            events_url=settings.flagsmith_events_url,
        )
        return FlagsmithAdapter(client)
    return FlagsmithAdapter(LocalDeterministicFlagsmithClient())


def serialize_session_state(session: DrillSession, now: datetime | None = None) -> dict[str, object]:
    """Serialize DrillSession state for participant UI rendering."""
    current = as_utc(now or datetime.now(timezone.utc))
    elapsed: float | None = None
    if session.exposure_at is not None:
        elapsed = max(0.0, round((current - as_utc(session.exposure_at)).total_seconds(), 2))

    return {
        "session_id": session.id,
        "participant_alias": session.participant_alias,
        "identity": session.identity,
        "scoped_token": session.scoped_token,
        "scenario_id": session.scenario_id,
        "scenario_revision": session.scenario_revision,
        "notice_revision": session.notice_revision,
        "banner": "Fictional recall drill",
        "batch_code": "B17",
        "product_name": "SunGrain Crunchy Oats 500g",
        "location_name": f"Isolated Shop ({session.participant_alias})",
        "notice_text": DEFAULT_STUDY_NOTICE,
        "received": session.expected_received,
        "forwarded": session.expected_forwarded,
        "variant": session.variant,
        "is_practice": session.is_practice,
        "validity_status": session.validity_status,
        "outcome": session.outcome,
        "attempts": session.attempts,
        "incorrect_attempts": session.incorrect_attempts,
        "exposure_at": session.exposure_at.isoformat() if session.exposure_at else None,
        "started_at": session.started_at.isoformat() if session.started_at else None,
        "finalized_at": session.finalized_at.isoformat() if session.finalized_at else None,
        "elapsed_seconds": elapsed,
        "remaining_seconds": compute_remaining_seconds(session, current),
        "completed_seconds": session.completed_seconds,
        "deadline_seconds": int(STUDY_DEADLINE_SECONDS),
    }
