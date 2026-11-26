"""Tests for scripts/export_results.py reproducibility and practice exclusion."""

from __future__ import annotations

import csv
from datetime import datetime, timezone
import json
from pathlib import Path
import sys

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from app.core.database import Base, create_engine_for_url, create_session_factory
from app.models.domain import DrillSession
from scripts.export_results import export_results


def test_export_results_excludes_practice_by_default_and_matches_csv(tmp_path: Path) -> None:
    """Export script writes deidentified CSV + JSON whose raw counts match exactly."""
    db_url = f"sqlite:///{tmp_path / 'export_test.db'}"
    engine = create_engine_for_url(db_url)
    Base.metadata.create_all(bind=engine)
    session_factory = create_session_factory(db_url)
    now = datetime.now(timezone.utc)

    with session_factory() as db:
        db.add_all(
            [
                DrillSession(
                    id="sess_study_1",
                    participant_alias="S-01",
                    scenario_id="isolated_shop_b17",
                    identity="study_id_1",
                    scoped_token="tok_s1",
                    variant="standard",
                    exposure_at=now,
                    started_at=now,
                    validity_status="valid",
                    is_practice=False,
                    expected_received=15,
                    expected_forwarded=0,
                    expected_sold=5,
                    expected_remaining=10,
                    expected_set_aside=10,
                    attempts=2,
                    incorrect_attempts=1,
                    completed_seconds=95.0,
                    outcome="success",
                ),
                DrillSession(
                    id="sess_study_2",
                    participant_alias="S-02",
                    scenario_id="isolated_shop_b17",
                    identity="study_id_2",
                    scoped_token="tok_s2",
                    variant="guided",
                    exposure_at=now,
                    started_at=now,
                    validity_status="valid",
                    is_practice=False,
                    expected_received=15,
                    expected_forwarded=0,
                    expected_sold=5,
                    expected_remaining=10,
                    expected_set_aside=10,
                    attempts=1,
                    incorrect_attempts=0,
                    completed_seconds=42.0,
                    outcome="success",
                ),
                DrillSession(
                    id="sess_practice_ignored",
                    participant_alias="P-99",
                    scenario_id="isolated_shop_b17",
                    identity="practice_id_99",
                    scoped_token="tok_p99",
                    variant="guided",
                    exposure_at=now,
                    started_at=now,
                    validity_status="valid",
                    is_practice=True,
                    expected_received=15,
                    expected_forwarded=0,
                    expected_sold=5,
                    expected_remaining=10,
                    expected_set_aside=10,
                    attempts=1,
                    incorrect_attempts=0,
                    completed_seconds=30.0,
                    outcome="success",
                ),
            ]
        )
        db.commit()

    out_dir = tmp_path / "exports"
    result = export_results(database_url=db_url, out_dir=out_dir, include_practice=False)
    engine.dispose()

    summary = json.loads(Path(result["summary_path"]).read_text(encoding="utf-8"))
    with Path(result["csv_path"]).open("r", encoding="utf-8") as fh:
        rows = list(csv.DictReader(fh))

    assert len(rows) == 2
    assert all(r["is_practice"] == "false" for r in rows)
    assert summary["valid_exposed_n"] == 2
    assert summary["variants"]["standard"]["success_n"] == 1
    assert summary["variants"]["guided"]["success_n"] == 1
