"""Server-side Flagsmith remote evaluation and Management API read helpers."""

from __future__ import annotations

from dataclasses import dataclass, field
import hashlib
import json
from typing import Any, Mapping, Protocol

from flagsmith import Flagsmith
from flagsmith.analytics import EventProcessorConfig
import httpx

ALLOWED_FLOW_VARIANTS: tuple[str, ...] = ("standard", "guided")
DEFAULT_FLOW_VARIANT = "standard"


class FlagsmithClientProtocol(Protocol):
    """Minimal protocol satisfied by flagsmith.Flagsmith for testing."""

    def get_experiment_flag(
        self,
        feature_name: str,
        identifier: str,
        traits: Mapping[str, Any] | None = None,
    ) -> Any: ...

    def track_event(
        self,
        event: str,
        identifier: str | None = None,
        value: Any = None,
        traits: Mapping[str, Any] | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> None: ...

    def flush_events(self) -> None: ...

    def close(self) -> None: ...


@dataclass(frozen=True)
class FlagEvaluationResult:
    """Outcome of evaluating a multivariate workflow flag for an identity."""

    feature_name: str
    identity: str
    variant: str
    enabled: bool
    in_experiment: bool
    experiment_id: int | None
    exposure_sent: bool
    is_default: bool
    error: str | None = None


@dataclass(frozen=True)
class PilotFlagSnapshot:
    """Readback snapshot of an allowlisted Flagsmith pilot feature state."""

    environment_id: str
    feature_name: str
    feature_state_id: int
    enabled: bool
    default_value: str | None
    multivariate_weights: dict[str, float]
    config_hash: str
    raw: dict[str, Any]
    option_value_map: dict[int, str] = field(default_factory=dict)


def build_flagsmith_client(
    environment_key: str,
    api_url: str = "https://edge.api.flagsmith.com/api/v1/",
    events_url: str = "https://events.api.flagsmith.com/",
    timeout_seconds: int = 10,
) -> Flagsmith:
    """Construct a remote-evaluation Flagsmith SDK client with events enabled."""
    return Flagsmith(
        environment_key=environment_key,
        api_url=api_url,
        enable_local_evaluation=False,
        enable_events=True,
        event_processor_config=EventProcessorConfig(events_api_url=events_url),
        request_timeout_seconds=timeout_seconds,
    )


def compute_pilot_config_hash(
    enabled: bool,
    default_value: str | None,
    multivariate_weights: Mapping[str, float],
) -> str:
    """Compute a deterministic SHA-256 hash over pilot feature configuration."""
    canonical = {
        "enabled": bool(enabled),
        "default_value": default_value,
        "multivariate_weights": {
            str(k): round(float(v), 4) for k, v in sorted(multivariate_weights.items())
        },
    }
    encoded = json.dumps(canonical, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return f"sha256:{hashlib.sha256(encoded).hexdigest()}"


class FlagsmithAdapter:
    """Server-side wrapper enforcing remote evaluation and consistent identity."""

    def __init__(self, client: FlagsmithClientProtocol) -> None:
        self._client = client

    def evaluate_recall_flow(
        self,
        identity: str,
        feature_name: str = "recall_response_flow",
        traits: Mapping[str, Any] | None = None,
    ) -> FlagEvaluationResult:
        """Evaluate the workflow flag remotely for one pseudonymous identity."""
        if not identity or not identity.strip():
            raise ValueError("Participant identity must be a non-empty string.")

        try:
            flag = self._client.get_experiment_flag(
                feature_name=feature_name,
                identifier=identity,
                traits=traits,
            )
        except Exception as exc:  # noqa: BLE001
            return FlagEvaluationResult(
                feature_name=feature_name,
                identity=identity,
                variant=DEFAULT_FLOW_VARIANT,
                enabled=False,
                in_experiment=False,
                experiment_id=None,
                exposure_sent=False,
                is_default=True,
                error=str(exc),
            )

        raw_value = getattr(flag, "value", None)
        variant_key = getattr(flag, "variant", None)
        raw_str = str(raw_value) if raw_value is not None else ""
        variant_str = str(variant_key) if variant_key is not None else ""
        if raw_str in ALLOWED_FLOW_VARIANTS:
            candidate = raw_str
        elif variant_str in ALLOWED_FLOW_VARIANTS:
            candidate = variant_str
        else:
            candidate = raw_str or variant_str or DEFAULT_FLOW_VARIANT
        is_allowed = candidate in ALLOWED_FLOW_VARIANTS
        resolved_variant = candidate if is_allowed else DEFAULT_FLOW_VARIANT

        experiment = getattr(flag, "experiment", None)
        in_experiment = bool(experiment and getattr(experiment, "in_experiment", False))
        experiment_id = getattr(experiment, "id", None) if experiment else None
        enabled = bool(getattr(flag, "enabled", False))
        exposure_sent = bool(enabled and in_experiment and variant_key is not None)

        return FlagEvaluationResult(
            feature_name=feature_name,
            identity=identity,
            variant=resolved_variant,
            enabled=enabled,
            in_experiment=in_experiment,
            experiment_id=experiment_id,
            exposure_sent=exposure_sent,
            is_default=bool(getattr(flag, "is_default", False) or not is_allowed),
            error=None,
        )

    def track_outcome_event(
        self,
        event_name: str,
        identity: str,
        value: str | int | float | bool | None = None,
        metadata: dict[str, Any] | None = None,
        flush: bool = False,
    ) -> None:
        """Record an experiment or funnel event for the exact same identity."""
        if not identity or not identity.strip():
            raise ValueError("Participant identity must be a non-empty string.")

        self._client.track_event(
            event=event_name,
            identifier=identity,
            value=value,
            metadata=metadata,
        )
        if flush:
            self._client.flush_events()

    def flush(self) -> None:
        """Flush buffered Flagsmith exposure and outcome events."""
        self._client.flush_events()

    def close(self) -> None:
        """Flush and close the underlying SDK client."""
        self._client.close()


class FlagsmithManagementClient:
    """Minimal Flagsmith Admin/Management API client for reading allowlisted pilot config."""

    def __init__(
        self,
        management_token: str,
        admin_api_url: str = "https://api.flagsmith.com/api/v1/",
        http_client: httpx.Client | None = None,
    ) -> None:
        if not management_token or not management_token.strip():
            raise ValueError("Flagsmith management token is required.")
        self._token = management_token.strip()
        self._base_url = admin_api_url.rstrip("/")
        self._external_client = http_client

    def _auth_header_candidates(self) -> list[dict[str, str]]:
        if self._token.startswith(("Api-Key ", "Token ")):
            return [{"Authorization": self._token}]
        return [
            {"Authorization": f"Api-Key {self._token}"},
            {"Authorization": f"Token {self._token}"},
        ]

    def _request_with_auth(
        self,
        client: httpx.Client,
        method: str,
        url: str,
        *,
        params: dict[str, Any] | None = None,
        json_body: dict[str, Any] | None = None,
    ) -> httpx.Response:
        resp: httpx.Response | None = None
        for headers in self._auth_header_candidates():
            resp = client.request(
                method,
                url,
                headers=headers,
                params=params,
                json=json_body,
                timeout=10.0,
            )
            if resp.status_code != 401:
                break
        assert resp is not None
        resp.raise_for_status()
        return resp

    def _resolve_option_value_map(
        self,
        client: httpx.Client,
        environment_id: str,
        state: dict[str, Any],
    ) -> dict[int, str]:
        mv_list = state.get("multivariate_feature_state_values", []) or []
        needs_lookup = any(
            isinstance(mv.get("multivariate_feature_option"), int) and mv.get("value") is None
            for mv in mv_list
        )
        if not needs_lookup:
            return {}

        feature_ref = state.get("feature")
        feature_id = feature_ref.get("id") if isinstance(feature_ref, dict) else feature_ref
        if not feature_id:
            return {}

        env_resp = self._request_with_auth(
            client,
            "GET",
            f"{self._base_url}/environments/{environment_id}/",
        )
        project_id = env_resp.json().get("project")
        if not project_id:
            return {}

        feat_resp = self._request_with_auth(
            client,
            "GET",
            f"{self._base_url}/projects/{project_id}/features/{feature_id}/",
        )
        mapping: dict[int, str] = {}
        for opt in feat_resp.json().get("multivariate_options", []) or []:
            opt_id = opt.get("id")
            val = opt.get("string_value")
            if val is None:
                val = opt.get("value")
            if val is None:
                val = opt.get("integer_value")
            if val is None:
                val = opt.get("boolean_value")
            if opt_id is not None and val is not None:
                mapping[int(opt_id)] = str(val)
        return mapping

    @staticmethod
    def _extract_weights(
        state: dict[str, Any],
        default_value: str | None,
        option_value_map: Mapping[int, str],
    ) -> dict[str, float]:
        weights: dict[str, float] = {}
        for mv in state.get("multivariate_feature_state_values", []) or []:
            option = mv.get("multivariate_feature_option")
            if isinstance(option, dict):
                opt_val = option.get("value")
            elif isinstance(option, int) and option in option_value_map:
                opt_val = option_value_map[option]
            else:
                opt_val = mv.get("value")
            if opt_val is not None:
                weights[str(opt_val)] = float(mv.get("percentage_allocation", 0.0))

        if weights and default_value is not None and default_value not in weights:
            weights[default_value] = max(0.0, round(100.0 - sum(weights.values()), 4))
        return weights

    def read_pilot_flag(
        self,
        environment_id: str,
        feature_name: str = "recall_response_flow",
    ) -> PilotFlagSnapshot:
        """Read current pilot feature state and compute a deterministic baseline hash."""
        if not environment_id or not str(environment_id).strip():
            raise ValueError("Flagsmith pilot environment ID is required.")

        url = f"{self._base_url}/environments/{environment_id}/featurestates/"

        def _fetch(client: httpx.Client) -> tuple[dict[str, Any], dict[int, str]]:
            resp = self._request_with_auth(client, "GET", url, params={"feature_name": feature_name})
            payload = resp.json()
            results = payload.get("results", payload) if isinstance(payload, dict) else payload
            if not isinstance(results, list):
                raise ValueError("Unexpected featurestates response payload from Flagsmith API.")
            chosen: dict[str, Any] | None = None
            for item in results:
                feature_obj = item.get("feature")
                name = feature_obj.get("name") if isinstance(feature_obj, dict) else item.get("feature_name")
                if name == feature_name:
                    chosen = item
                    break
            if chosen is None and len(results) == 1:
                chosen = results[0]
            if chosen is None:
                raise LookupError(f"Feature '{feature_name}' not found in environment '{environment_id}'.")
            option_map = self._resolve_option_value_map(client, str(environment_id), chosen)
            return chosen, option_map

        if self._external_client is not None:
            state, option_map = _fetch(self._external_client)
        else:
            with httpx.Client() as client:
                state, option_map = _fetch(client)

        enabled = bool(state.get("enabled", False))
        raw_val = state.get("feature_state_value")
        default_value = None if raw_val is None else str(raw_val)
        weights = self._extract_weights(state, default_value, option_map)

        config_hash = compute_pilot_config_hash(enabled, default_value, weights)
        return PilotFlagSnapshot(
            environment_id=str(environment_id),
            feature_name=feature_name,
            feature_state_id=int(state["id"]),
            enabled=enabled,
            default_value=default_value,
            multivariate_weights=weights,
            config_hash=config_hash,
            raw=state,
            option_value_map=option_map,
        )

    def _update_via_v2_version(
        self,
        client: httpx.Client,
        snapshot: PilotFlagSnapshot,
        desired_weights: Mapping[str, float],
    ) -> dict[str, Any]:
        env_num = snapshot.raw.get("environment")
        feat_ref = snapshot.raw.get("feature")
        feat_id = feat_ref.get("id") if isinstance(feat_ref, dict) else feat_ref
        if not env_num or not feat_id:
            raise ValueError("Missing numeric environment or feature ID for Flagsmith v2 versioning.")

        ver_base = f"{self._base_url}/environments/{env_num}/features/{feat_id}/versions"
        ver_resp = self._request_with_auth(
            client,
            "POST",
            f"{ver_base}/",
            json_body={"description": "RecallRelay operator-approved pilot workflow update"},
        )
        version_uuid = ver_resp.json()["uuid"]

        fs_list_resp = self._request_with_auth(
            client,
            "GET",
            f"{ver_base}/{version_uuid}/featurestates/",
        )
        fs_items = fs_list_resp.json()
        if isinstance(fs_items, dict):
            fs_items = fs_items.get("results", [])
        draft_fs = next(
            (
                item
                for item in fs_items
                if item.get("feature_segment") is None and item.get("identity") is None
            ),
            fs_items[0],
        )

        mv_items = []
        for mv in draft_fs.get("multivariate_feature_state_values", []) or []:
            option = mv.get("multivariate_feature_option")
            if isinstance(option, dict):
                opt_val = option.get("value")
            elif isinstance(option, int) and option in snapshot.option_value_map:
                opt_val = snapshot.option_value_map[option]
            else:
                opt_val = mv.get("value")
            updated_mv = dict(mv)
            if opt_val is not None and str(opt_val) in desired_weights:
                updated_mv["percentage_allocation"] = float(desired_weights[str(opt_val)])
            mv_items.append(updated_mv)

        put_payload = {
            "id": draft_fs["id"],
            "feature": feat_id,
            "enabled": bool(draft_fs.get("enabled", snapshot.enabled)),
            "feature_state_value": draft_fs.get("feature_state_value"),
            "multivariate_feature_state_values": mv_items,
        }
        updated_resp = self._request_with_auth(
            client,
            "PUT",
            f"{ver_base}/{version_uuid}/featurestates/{draft_fs['id']}/",
            json_body=put_payload,
        )
        self._request_with_auth(
            client,
            "POST",
            f"{ver_base}/{version_uuid}/publish/",
            json_body={},
        )
        return updated_resp.json()

    def update_pilot_multivariate_weights(
        self,
        environment_id: str,
        snapshot: PilotFlagSnapshot,
        desired_weights: Mapping[str, float],
    ) -> PilotFlagSnapshot:
        """Apply updated multivariate percentage allocations to an allowlisted pilot feature state."""
        use_v2 = bool(snapshot.raw.get("environment_feature_version"))
        url = f"{self._base_url}/environments/{environment_id}/featurestates/{snapshot.feature_state_id}/"

        mv_items = []
        for mv in snapshot.raw.get("multivariate_feature_state_values", []) or []:
            option = mv.get("multivariate_feature_option")
            if isinstance(option, dict):
                opt_val = option.get("value")
            elif isinstance(option, int) and option in snapshot.option_value_map:
                opt_val = snapshot.option_value_map[option]
            else:
                opt_val = mv.get("value")
            updated_mv = dict(mv)
            if opt_val is not None and str(opt_val) in desired_weights:
                updated_mv["percentage_allocation"] = float(desired_weights[str(opt_val)])
            mv_items.append(updated_mv)

        payload: dict[str, Any] = {
            "id": snapshot.feature_state_id,
            "enabled": snapshot.enabled,
            "feature_state_value": snapshot.default_value,
            "multivariate_feature_state_values": mv_items,
        }
        if "feature" in snapshot.raw:
            payload["feature"] = snapshot.raw["feature"]

        def _put(client: httpx.Client) -> dict[str, Any]:
            if use_v2:
                return self._update_via_v2_version(client, snapshot, desired_weights)
            resp = self._request_with_auth(client, "PUT", url, json_body=payload)
            return resp.json()

        if self._external_client is not None:
            updated_raw = _put(self._external_client)
        else:
            with httpx.Client() as client:
                updated_raw = _put(client)

        new_enabled = bool(updated_raw.get("enabled", snapshot.enabled))
        raw_val = updated_raw.get("feature_state_value")
        if isinstance(raw_val, dict):
            raw_val = raw_val.get("string_value")
        new_default = None if raw_val is None else str(raw_val)
        new_weights = self._extract_weights(updated_raw, new_default, snapshot.option_value_map)
        return PilotFlagSnapshot(
            environment_id=str(environment_id),
            feature_name=snapshot.feature_name,
            feature_state_id=int(updated_raw.get("id", snapshot.feature_state_id)),
            enabled=new_enabled,
            default_value=new_default,
            multivariate_weights=new_weights or dict(desired_weights),
            config_hash=compute_pilot_config_hash(new_enabled, new_default, new_weights or desired_weights),
            raw=updated_raw,
            option_value_map=dict(snapshot.option_value_map),
        )
