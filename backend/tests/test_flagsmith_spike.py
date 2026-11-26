"""Unit and integration tests for Phase 2 Flagsmith SDK, Management API, and LLM spike."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping

import httpx
import pytest

from app.core.config import Settings
from app.experiments.flagsmith_client import (
    DEFAULT_FLOW_VARIANT,
    FlagsmithAdapter,
    FlagsmithManagementClient,
    compute_pilot_config_hash,
)
from app.experiments.spike import run_llm_smoke_check


@dataclass
class FakeExperiment:
    id: int
    in_experiment: bool


@dataclass
class FakeFlag:
    enabled: bool
    value: Any
    variant: str | None = None
    experiment: FakeExperiment | None = None
    is_default: bool = False


class FakeFlagsmithClient:
    """In-memory stub simulating Flagsmith 6.7 remote evaluation and event calls."""

    def __init__(self, assignments: dict[str, FakeFlag] | None = None, fail: bool = False) -> None:
        self.assignments = assignments or {}
        self.fail = fail
        self.eval_calls: list[tuple[str, str]] = []
        self.tracked_events: list[dict[str, Any]] = []
        self.flushed = False
        self.closed = False

    def get_experiment_flag(
        self,
        feature_name: str,
        identifier: str,
        traits: Mapping[str, Any] | None = None,
    ) -> FakeFlag:
        self.eval_calls.append((feature_name, identifier))
        if self.fail:
            raise RuntimeError("Flagsmith API unreachable")
        return self.assignments[identifier]

    def track_event(
        self,
        event: str,
        identifier: str | None = None,
        value: Any = None,
        traits: Mapping[str, Any] | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> None:
        self.tracked_events.append(
            {
                "event": event,
                "identifier": identifier,
                "value": value,
                "metadata": metadata,
            }
        )

    def flush_events(self) -> None:
        self.flushed = True

    def close(self) -> None:
        self.closed = True


def test_two_practice_identities_receive_distinct_variants_and_track_same_identity() -> None:
    """Verify standard and guided assignment and consistent identity event tracking."""
    fake = FakeFlagsmithClient(
        assignments={
            "practice_a": FakeFlag(
                enabled=True,
                value="standard",
                variant="standard",
                experiment=FakeExperiment(id=101, in_experiment=True),
            ),
            "practice_b": FakeFlag(
                enabled=True,
                value="guided",
                variant="guided",
                experiment=FakeExperiment(id=101, in_experiment=True),
            ),
        }
    )
    adapter = FlagsmithAdapter(fake)

    res_a = adapter.evaluate_recall_flow("practice_a")
    res_b = adapter.evaluate_recall_flow("practice_b")
    adapter.track_outcome_event("recall_drill_success", "practice_b", value=1, flush=True)

    assert res_a.variant == "standard"
    assert res_a.exposure_sent is True
    assert res_b.variant == "guided"
    assert res_b.experiment_id == 101
    assert fake.eval_calls == [
        ("recall_response_flow", "practice_a"),
        ("recall_response_flow", "practice_b"),
    ]
    assert fake.tracked_events == [
        {
            "event": "recall_drill_success",
            "identifier": "practice_b",
            "value": 1,
            "metadata": None,
        }
    ]
    assert fake.flushed is True


def test_flagsmith_unavailable_returns_safe_default_with_error() -> None:
    """Flagsmith outage returns explicit error so study enrollment can pause safely."""
    adapter = FlagsmithAdapter(FakeFlagsmithClient(fail=True))

    res = adapter.evaluate_recall_flow("study_user_1")

    assert res.variant == DEFAULT_FLOW_VARIANT
    assert res.is_default is True
    assert res.exposure_sent is False
    assert res.error == "Flagsmith API unreachable"


def test_unknown_variant_falls_back_to_standard_safely() -> None:
    """Unexpected Flagsmith values never propagate arbitrary UI modes."""
    fake = FakeFlagsmithClient(
        assignments={
            "practice_c": FakeFlag(enabled=True, value="unexpected_mode", variant="unexpected_mode")
        }
    )
    adapter = FlagsmithAdapter(fake)

    res = adapter.evaluate_recall_flow("practice_c")

    assert res.variant == "standard"
    assert res.is_default is True


def test_management_client_reads_pilot_flag_and_produces_deterministic_hash() -> None:
    """Management API readback extracts multivariate weights and stable config hash."""

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["Authorization"] == "Api-Key mgmt-secret"
        assert "/environments/env-pilot-1/featurestates/" in str(request.url)
        return httpx.Response(
            200,
            json={
                "results": [
                    {
                        "id": 9001,
                        "enabled": True,
                        "feature_state_value": "standard",
                        "feature": {"id": 42, "name": "recall_response_flow"},
                        "multivariate_feature_state_values": [
                            {
                                "percentage_allocation": 50.0,
                                "multivariate_feature_option": {"value": "standard"},
                            },
                            {
                                "percentage_allocation": 50.0,
                                "multivariate_feature_option": {"value": "guided"},
                            },
                        ],
                    }
                ]
            },
        )

    transport = httpx.MockTransport(handler)
    with httpx.Client(transport=transport) as http_client:
        mgmt = FlagsmithManagementClient(
            management_token="mgmt-secret",
            admin_api_url="https://api.flagsmith.com/api/v1/",
            http_client=http_client,
        )
        snap = mgmt.read_pilot_flag("env-pilot-1", "recall_response_flow")

    expected_hash = compute_pilot_config_hash(
        enabled=True,
        default_value="standard",
        multivariate_weights={"guided": 50.0, "standard": 50.0},
    )
    assert snap.feature_state_id == 9001
    assert snap.enabled is True
    assert snap.multivariate_weights == {"standard": 50.0, "guided": 50.0}
    assert snap.config_hash == expected_hash


def test_llm_smoke_check_missing_key_reports_clean_error() -> None:
    """Missing LLM API key fails deterministically without raising."""
    res = run_llm_smoke_check(Settings(llm_provider="gemini", llm_api_key="", llm_model="gemini-2.5-flash"))
    assert res["ok"] is False
    assert "LLM_API_KEY" in res["error"]


def test_llm_smoke_check_gemini_parses_reply() -> None:
    """Gemini smoke check calls generateContent and extracts text response."""

    def handler(request: httpx.Request) -> httpx.Response:
        assert "gemini-2.5-flash:generateContent" in str(request.url)
        return httpx.Response(
            200,
            json={"candidates": [{"content": {"parts": [{"text": "OK"}]}}]},
        )

    with httpx.Client(transport=httpx.MockTransport(handler)) as http_client:
        res = run_llm_smoke_check(
            Settings(llm_provider="gemini", llm_api_key="test-key", llm_model="gemini-2.5-flash"),
            http_client=http_client,
        )

    assert res == {
        "ok": True,
        "provider": "gemini",
        "model": "gemini-2.5-flash",
        "reply": "OK",
        "error": None,
    }


def test_empty_identity_raises_value_error() -> None:
    """Blank participant identities must be rejected before SDK calls."""
    adapter = FlagsmithAdapter(FakeFlagsmithClient())
    with pytest.raises(ValueError):
        adapter.evaluate_recall_flow("   ")
    with pytest.raises(ValueError):
        adapter.track_outcome_event("recall_drill_success", "")


def test_flagsmith_cloud_variant_keys_resolve_via_flag_value() -> None:
    """Flagsmith Cloud returns variant='control'/'Variant_1' with value='standard'/'guided'."""
    fake = FakeFlagsmithClient(
        assignments={
            "p_ctrl": FakeFlag(
                enabled=True,
                value="standard",
                variant="control",
                experiment=FakeExperiment(id=718, in_experiment=True),
            ),
            "p_var1": FakeFlag(
                enabled=True,
                value="guided",
                variant="Variant_1",
                experiment=FakeExperiment(id=718, in_experiment=True),
            ),
        }
    )
    adapter = FlagsmithAdapter(fake)
    r1 = adapter.evaluate_recall_flow("p_ctrl")
    r2 = adapter.evaluate_recall_flow("p_var1")
    assert r1.variant == "standard" and r1.is_default is False and r1.exposure_sent is True
    assert r2.variant == "guided" and r2.is_default is False and r2.exposure_sent is True


def test_management_client_resolves_integer_mv_option_ids_and_token_fallback() -> None:
    """Flagsmith Cloud Account Token auth and integer MV option IDs resolve cleanly."""
    put_payloads: list[dict[str, Any]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.headers.get("Authorization") == "Api-Key acct-token":
            return httpx.Response(401, json={"detail": "Invalid Api-Key"})
        assert request.headers.get("Authorization") == "Token acct-token"
        url = str(request.url)
        if "/environments/env-cloud/featurestates/9002/" in url and request.method == "PUT":
            import json as _json
            body = _json.loads(request.content.decode("utf-8"))
            put_payloads.append(body)
            return httpx.Response(200, json=body)
        if "/environments/env-cloud/featurestates/" in url:
            return httpx.Response(
                200,
                json={
                    "results": [
                        {
                            "id": 9002,
                            "enabled": True,
                            "feature_state_value": "standard",
                            "feature": 306168,
                            "multivariate_feature_state_values": [
                                {
                                    "id": 387076,
                                    "multivariate_feature_option": 37423,
                                    "percentage_allocation": 50.0,
                                }
                            ],
                        }
                    ]
                },
            )
        if url.endswith("/environments/env-cloud/"):
            return httpx.Response(200, json={"id": 119111, "name": "Pilot", "project": 55588})
        if "/projects/55588/features/306168/" in url:
            return httpx.Response(
                200,
                json={
                    "id": 306168,
                    "name": "recall_response_flow",
                    "multivariate_options": [{"id": 37423, "string_value": "guided"}],
                },
            )
        return httpx.Response(404)

    with httpx.Client(transport=httpx.MockTransport(handler)) as http_client:
        mgmt = FlagsmithManagementClient(
            management_token="acct-token",
            admin_api_url="https://api.flagsmith.com/api/v1/",
            http_client=http_client,
        )
        snap = mgmt.read_pilot_flag("env-cloud", "recall_response_flow")
        assert snap.multivariate_weights == {"guided": 50.0, "standard": 50.0}
        updated = mgmt.update_pilot_multivariate_weights(
            "env-cloud", snap, {"guided": 100.0, "standard": 0.0}
        )
        assert updated.multivariate_weights == {"guided": 100.0, "standard": 0.0}
        assert put_payloads[0]["multivariate_feature_state_values"][0]["percentage_allocation"] == 100.0
