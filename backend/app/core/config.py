"""Application settings loaded from environment variables."""

from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration for RecallRelay FastAPI service."""

    app_name: str = "RecallRelay API"
    app_env: str = "development"
    app_port: int = 8080
    public_base_url: str = "http://localhost:5173"
    cors_origins: str = "http://localhost:5173"
    database_url: str = "postgresql+psycopg://recallrelay:recallrelay@localhost:5432/recallrelay"

    # Flagsmith server-side SDK (Study / Pilot / Self-hosted)
    flagsmith_study_key: str = ""
    flagsmith_pilot_key: str = ""
    flagsmith_api_url: str = "https://edge.api.flagsmith.com/api/v1/"
    flagsmith_events_url: str = "https://events.api.flagsmith.com/"
    flagsmith_admin_api_url: str = "https://api.flagsmith.com/api/v1/"
    flagsmith_management_token: str = ""
    flagsmith_pilot_env_id: str = ""
    flagsmith_pilot_feature_name: str = "recall_response_flow"

    # Operator authentication
    operator_secret: str = "dev-operator-secret-change-me"

    # Bounded product agent LLM config
    llm_provider: str = "gemini"
    llm_api_key: str = ""
    llm_model: str = "gemini-2.5-flash"

    model_config = SettingsConfigDict(
        env_file=(".env", "../.env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )


@lru_cache
def get_settings() -> Settings:
    """Return cached application settings instance."""
    return Settings()
