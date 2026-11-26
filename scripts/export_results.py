"""Export deidentified RecallRelay experiment results (CSV + JSON summary) with row-count verification."""

from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path
import sys
from typing import Any

REPO_ROOT = Path(__file__).resolve().parent.parent
BACKEND_DIR = REPO_ROOT / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from sqlalchemy import select  # noqa: E402

from app.core.config import get_settings  # noqa: E402
from app.core.database import create_session_factory  # noqa: E402
from app.experiments.analytics_router import _summarize_variant  # noqa: E402
from app.models.domain import DrillSession, EventOutbox  # noqa: E402


CSV_HEADERS = [
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


def export_results(
    *,
    database_url: str,
    out_dir: Path,
    include_practice: bool = False,
) -> dict[str, Any]:
    """Write deidentified CSV and summary JSON, then verify CSV reproduces raw summary counts."""
    out_dir.mkdir(parents=True, exist_ok=True)
    csv_path = out_dir / "recallrelay_experiment_results.csv"
    summary_path = out_dir / "recallrelay_experiment_summary.json"

    session_factory = create_session_factory(database_url)
    with session_factory() as db:
        stmt = select(DrillSession).order_by(DrillSession.exposure_at.asc(), DrillSession.id.asc())
        if not include_practice:
            stmt = stmt.where(DrillSession.is_practice.is_(False))
        rows = list(db.scalars(stmt).all())

        valid_exposed = [
            s
            for s in rows
            if s.exposure_at is not None and s.validity_status in ("valid", "exposed")
        ]
        excluded = [s for s in rows if s not in valid_exposed]
        exclusions_by_reason: dict[str, int] = {}
        for s in excluded:
            exclusions_by_reason[s.validity_status] = exclusions_by_reason.get(s.validity_status, 0) + 1

        outbox_rows = list(db.scalars(select(EventOutbox)).all())
        outbox_counts = {
            "pending": sum(1 for e in outbox_rows if e.dispatch_status == "pending"),
            "dispatched": sum(1 for e in outbox_rows if e.dispatch_status == "dispatched"),
            "failed": sum(1 for e in outbox_rows if e.dispatch_status == "failed"),
        }

        summary = {
            "feature_name": "recall_response_flow",
            "include_practice": include_practice,
            "total_sessions": len(rows),
            "valid_exposed_n": len(valid_exposed),
            "excluded_n": len(excluded),
            "exclusions_by_reason": exclusions_by_reason,
            "variants": {
                "standard": _summarize_variant([s for s in valid_exposed if s.variant == "standard"]),
                "guided": _summarize_variant([s for s in valid_exposed if s.variant == "guided"]),
            },
            "outbox": outbox_counts,
        }

        with csv_path.open("w", newline="", encoding="utf-8") as fh:
            writer = csv.writer(fh)
            writer.writerow(CSV_HEADERS)
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

    # Re-read CSV to verify raw counts match summary exactly
    with csv_path.open("r", newline="", encoding="utf-8") as fh:
        csv_rows = list(csv.DictReader(fh))

    csv_valid = [
        r for r in csv_rows if r["exposure_at"] and r["validity_status"] in ("valid", "exposed")
    ]
    for variant in ("standard", "guided"):
        v_rows = [r for r in csv_valid if r["variant"] == variant]
        v_success = sum(1 for r in v_rows if r["outcome"] == "success")
        assert len(v_rows) == summary["variants"][variant]["exposed_n"], (
            f"CSV exposed_n mismatch for {variant}"
        )
        assert v_success == summary["variants"][variant]["success_n"], (
            f"CSV success_n mismatch for {variant}"
        )

    summary_path.write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    return {
        "csv_path": str(csv_path),
        "summary_path": str(summary_path),
        "summary": summary,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Export deidentified RecallRelay experiment results.")
    parser.add_argument(
        "--database-url",
        default="",
        help="Override DATABASE_URL from .env",
    )
    parser.add_argument(
        "--out-dir",
        default=str(REPO_ROOT / "exports"),
        help="Output directory for CSV and JSON files (default: ./exports)",
    )
    parser.add_argument(
        "--include-practice",
        action="store_true",
        help="Include is_practice=True sessions (default: study sessions only)",
    )
    args = parser.parse_args()
    db_url = args.database_url.strip() or get_settings().database_url
    result = export_results(
        database_url=db_url,
        out_dir=Path(args.out_dir),
        include_practice=args.include_practice,
    )
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
