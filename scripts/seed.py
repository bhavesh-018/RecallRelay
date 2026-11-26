"""CLI helper to seed RecallRelay database from any JSON drill fixture."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

BACKEND_DIR = Path(__file__).resolve().parents[1] / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.core.config import get_settings
from app.core.database import create_session_factory
from app.shipments.seed import load_fixture_into_db


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed RecallRelay database from a JSON fixture.")
    parser.add_argument(
        "--fixture",
        default=str(Path(__file__).resolve().parents[1] / "fixtures" / "food_drill.json"),
        help="Path to the drill fixture JSON file.",
    )
    parser.add_argument(
        "--reset",
        action="store_true",
        help="Replace existing records belonging to the fixture's dataset_key.",
    )
    args = parser.parse_args()

    session_factory = create_session_factory(get_settings().database_url)
    with session_factory() as db:
        counts = load_fixture_into_db(db, args.fixture, reset_dataset=args.reset)
    print(json.dumps({"fixture": args.fixture, **counts}))


if __name__ == "__main__":
    main()
