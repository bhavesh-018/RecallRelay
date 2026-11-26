"""FastAPI application factory and router registration."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.auth import router as operator_router
from app.core.config import Settings, get_settings
from app.recalls.router import router as recalls_router
from app.recalls.tasks_router import router as tasks_router
from app.shipments.router import router as shipments_router


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

    app.include_router(operator_router)
    app.include_router(shipments_router)
    app.include_router(recalls_router)
    app.include_router(tasks_router)
    return app


app = create_app()
