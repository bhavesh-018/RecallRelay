"""Operator authentication helpers and FastAPI dependency."""

from __future__ import annotations

import base64
from datetime import datetime, timedelta, timezone
import hashlib
import hmac
import json
from typing import Annotated

from fastapi import APIRouter, Cookie, Depends, Header, HTTPException, Response, status
from pydantic import BaseModel

from app.core.config import Settings, get_settings

OPERATOR_COOKIE_NAME = "rr_operator_session"


class OperatorLoginRequest(BaseModel):
    """Credentials payload for operator login."""

    secret: str


class OperatorSessionInfo(BaseModel):
    """Verified operator session metadata."""

    actor: str
    role: str
    expires_at: str


def create_operator_token(
    secret_key: str,
    actor: str = "operator",
    ttl_hours: int = 24,
) -> tuple[str, datetime]:
    """Create an HMAC-SHA256 signed operator session token."""
    expires_at = datetime.now(timezone.utc) + timedelta(hours=ttl_hours)
    payload = json.dumps(
        {"actor": actor, "role": "operator", "exp": int(expires_at.timestamp())},
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    payload_b64 = base64.urlsafe_b64encode(payload).decode("ascii").rstrip("=")
    sig = hmac.new(secret_key.encode("utf-8"), payload_b64.encode("ascii"), hashlib.sha256).hexdigest()
    return f"{payload_b64}.{sig}", expires_at


def verify_operator_token(token: str, secret_key: str) -> OperatorSessionInfo:
    """Validate signature and expiry of an operator token."""
    if not token or "." not in token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or malformed operator session token.",
        )
    payload_b64, sig = token.split(".", 1)
    expected_sig = hmac.new(
        secret_key.encode("utf-8"),
        payload_b64.encode("ascii"),
        hashlib.sha256,
    ).hexdigest()
    if not hmac.compare_digest(sig, expected_sig):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid operator session token.",
        )
    padded = payload_b64 + "=" * (-len(payload_b64) % 4)
    try:
        data = json.loads(base64.urlsafe_b64decode(padded).decode("utf-8"))
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Corrupt operator session payload.",
        ) from exc

    exp_ts = int(data.get("exp", 0))
    now_ts = int(datetime.now(timezone.utc).timestamp())
    if exp_ts <= now_ts:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Operator session expired.",
        )
    return OperatorSessionInfo(
        actor=str(data.get("actor", "operator")),
        role=str(data.get("role", "operator")),
        expires_at=datetime.fromtimestamp(exp_ts, tz=timezone.utc).isoformat(),
    )


def require_operator(
    authorization: Annotated[str | None, Header()] = None,
    rr_operator_session: Annotated[str | None, Cookie()] = None,
    settings: Settings = Depends(get_settings),
) -> OperatorSessionInfo:
    """FastAPI dependency enforcing an authenticated operator session."""
    token: str | None = None
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization[7:].strip()
    elif rr_operator_session:
        token = rr_operator_session.strip()

    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Operator authentication required.",
        )
    return verify_operator_token(token, settings.operator_secret)


router = APIRouter(prefix="/api/operator", tags=["operator"])


@router.post("/login")
def operator_login(
    body: OperatorLoginRequest,
    response: Response,
    settings: Settings = Depends(get_settings),
) -> dict[str, str]:
    """Authenticate an operator and issue a signed session cookie and bearer token."""
    if not hmac.compare_digest(body.secret, settings.operator_secret):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid operator credentials.",
        )
    token, expires_at = create_operator_token(settings.operator_secret)
    response.set_cookie(
        key=OPERATOR_COOKIE_NAME,
        value=token,
        httponly=True,
        samesite="lax",
    )
    return {
        "token": token,
        "role": "operator",
        "expires_at": expires_at.isoformat(),
    }


@router.get("/me", response_model=OperatorSessionInfo)
def operator_me(operator: OperatorSessionInfo = Depends(require_operator)) -> OperatorSessionInfo:
    """Return currently authenticated operator session details."""
    return operator
