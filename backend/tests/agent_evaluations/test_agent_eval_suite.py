"""Pytest entry point enforcing 9/9 pass rate across all roadmap agent evaluation scenarios."""

from tests.agent_evaluations.run_evals import run_all_nine_scenarios


def test_all_nine_adversarial_agent_scenarios_pass() -> None:
    """All 9 Section 12 safety, repair, approval, stale-state, and recovery scenarios pass."""
    report = run_all_nine_scenarios()
    assert report["total_scenarios"] == 9
    assert report["failed"] == 0, f"Failed scenarios: {[r for r in report['results'] if not r['passed']]}"
    assert report["passed"] == 9
