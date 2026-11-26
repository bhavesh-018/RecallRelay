"""Baseline health endpoint tests."""

from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app


def test_health_endpoint_returns_ok() -> None:
    """Health check returns 200 and expected service identity."""
    app = create_app(Settings(app_env="test", app_port=8080))
    client = TestClient(app)

    response = client.get("/api/health")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "service": "recallrelay-api",
        "env": "test",
        "port": 8080,
    }
