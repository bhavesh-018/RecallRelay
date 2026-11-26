"""Phase 2 integration spike runner for Flagsmith + Management API + LLM quota."""

from __future__ import annotations

import json
from typing import Any

import httpx

from app.core.config import Settings, get_settings
from app.experiments.flagsmith_client import (
    FlagsmithAdapter,
    FlagsmithManagementClient,
    build_flagsmith_client,
)


def run_llm_smoke_check(
    settings: Settings,
    http_client: httpx.Client | None = None,
) -> dict[str, Any]:
    """Execute a minimal LLM call to confirm working API key and model quota."""
    provider = settings.llm_provider.strip().lower()
    api_key = settings.llm_api_key.strip()
    model = settings.llm_model.strip()

    if not api_key:
        return {
            "ok": False,
            "provider": provider,
            "model": model,
            "reply": None,
            "error": "LLM_API_KEY is not configured.",
        }

    def _call(client: httpx.Client) -> dict[str, Any]:
        if provider == "gemini":
            url = (
                f"https://generativelanguage.googleapis.com/v1beta/models/"
                f"{model}:generateContent?key={api_key}"
            )
            body = {
                "contents": [{"parts": [{"text": "Reply with exactly one word: OK"}]}],
                "generationConfig": {"maxOutputTokens": 16, "temperature": 0},
            }
            resp = client.post(url, json=body, timeout=15.0)
            resp.raise_for_status()
            data = resp.json()
            text = (
                data.get("candidates", [{}])[0]
                .get("content", {})
                .get("parts", [{}])[0]
                .get("text", "")
                .strip()
            )
            return {"ok": bool(text), "provider": provider, "model": model, "reply": text, "error": None}

        if provider == "openai":
            url = "https://api.openai.com/v1/chat/completions"
            headers = {"Authorization": f"Bearer {api_key}"}
            body = {
                "model": model,
                "messages": [{"role": "user", "content": "Reply with exactly one word: OK"}],
                "max_tokens": 16,
                "temperature": 0,
            }
            resp = client.post(url, headers=headers, json=body, timeout=15.0)
            resp.raise_for_status()
            data = resp.json()
            text = data["choices"][0]["message"]["content"].strip()
            return {"ok": bool(text), "provider": provider, "model": model, "reply": text, "error": None}

        if provider == "anthropic":
            url = "https://api.anthropic.com/v1/messages"
            headers = {
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01",
            }
            body = {
                "model": model,
                "max_tokens": 16,
                "messages": [{"role": "user", "content": "Reply with exactly one word: OK"}],
            }
            resp = client.post(url, headers=headers, json=body, timeout=15.0)
            resp.raise_for_status()
            data = resp.json()
            text = data["content"][0]["text"].strip()
            return {"ok": bool(text), "provider": provider, "model": model, "reply": text, "error": None}

        return {
            "ok": False,
            "provider": provider,
            "model": model,
            "reply": None,
            "error": f"Unsupported LLM_PROVIDER: {provider}",
        }

    try:
        if http_client is not None:
            return _call(http_client)
        with httpx.Client() as client:
            return _call(client)
    except Exception as exc:  # noqa: BLE001
        return {
            "ok": False,
            "provider": provider,
            "model": model,
            "reply": None,
            "error": str(exc),
        }


def run_phase2_spike(settings: Settings | None = None) -> dict[str, Any]:
    """Run Flagsmith SDK, Management API read, and LLM smoke checks."""
    cfg = settings or get_settings()
    report: dict[str, Any] = {
        "flagsmith_sdk": {"ok": False},
        "flagsmith_management": {"ok": False},
        "llm": {},
    }

    sdk_key = cfg.flagsmith_pilot_key or cfg.flagsmith_study_key
    if not sdk_key:
        report["flagsmith_sdk"] = {
            "ok": False,
            "error": "Neither FLAGSMITH_PILOT_KEY nor FLAGSMITH_STUDY_KEY is set.",
        }
    else:
        client = build_flagsmith_client(
            environment_key=sdk_key,
            api_url=cfg.flagsmith_api_url,
            events_url=cfg.flagsmith_events_url,
        )
        adapter = FlagsmithAdapter(client)
        try:
            evals = []
            for identity in ("practice_spike_alpha", "practice_spike_beta"):
                res = adapter.evaluate_recall_flow(identity, cfg.flagsmith_pilot_feature_name)
                adapter.track_outcome_event("recall_drill_started", identity, metadata={"practice": True})
                adapter.track_outcome_event("recall_drill_success", identity, value=1, metadata={"practice": True})
                evals.append(
                    {
                        "identity": res.identity,
                        "variant": res.variant,
                        "enabled": res.enabled,
                        "in_experiment": res.in_experiment,
                        "exposure_sent": res.exposure_sent,
                        "is_default": res.is_default,
                        "error": res.error,
                    }
                )
            adapter.flush()
            report["flagsmith_sdk"] = {"ok": all(e["error"] is None for e in evals), "evaluations": evals}
        finally:
            adapter.close()

    if not cfg.flagsmith_management_token or not cfg.flagsmith_pilot_env_id:
        report["flagsmith_management"] = {
            "ok": False,
            "error": "FLAGSMITH_MANAGEMENT_TOKEN or FLAGSMITH_PILOT_ENV_ID is not configured.",
        }
    else:
        try:
            mgmt = FlagsmithManagementClient(
                management_token=cfg.flagsmith_management_token,
                admin_api_url=cfg.flagsmith_admin_api_url,
            )
            snap = mgmt.read_pilot_flag(
                environment_id=cfg.flagsmith_pilot_env_id,
                feature_name=cfg.flagsmith_pilot_feature_name,
            )
            report["flagsmith_management"] = {
                "ok": True,
                "feature_state_id": snap.feature_state_id,
                "enabled": snap.enabled,
                "multivariate_weights": snap.multivariate_weights,
                "config_hash": snap.config_hash,
            }
        except Exception as exc:  # noqa: BLE001
            report["flagsmith_management"] = {"ok": False, "error": str(exc)}

    report["llm"] = run_llm_smoke_check(cfg)
    return report


if __name__ == "__main__":
    print(json.dumps(run_phase2_spike(), indent=2))
