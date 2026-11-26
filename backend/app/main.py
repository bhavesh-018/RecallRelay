"""FastAPI application factory and baseline health endpoint."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import Settings, get_settings


def create_app(settings: Settings | None = None) -> FastAPI:
    """Create and configure the RecallRelay FastAPI application."""
    cfg = settings or get_settings()
    app = FastAPI(title=cfg.app_name, version="0.1.0")

    origins = [origin.strip() for origin in cfg.cors_origins.split(",") if origin.strip()]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/api/health", tags=["system"])
    def health() -> dict[str, object]:
        """Return service health metadata for readiness probes."""
        return {
            "status": "ok",
            "service": "recallrelay-api",
            "env": cfg.app_env,
            "port": cfg.app_port,
        }

    return app


app = create_app()
