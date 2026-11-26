"""SQLAlchemy database engine, session factory, and declarative base."""

from __future__ import annotations

from collections.abc import Generator

from sqlalchemy import Engine, create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.core.config import get_settings


class Base(DeclarativeBase):
    """Base class for all RecallRelay ORM models."""


def create_engine_for_url(database_url: str) -> Engine:
    """Create a SQLAlchemy engine with dialect-appropriate defaults."""
    connect_args: dict[str, object] = {}
    if database_url.startswith("sqlite"):
        connect_args["check_same_thread"] = False
    return create_engine(database_url, future=True, pool_pre_ping=True, connect_args=connect_args)


def create_session_factory(database_url: str) -> sessionmaker[Session]:
    """Return a configured sessionmaker bound to the target database URL."""
    engine = create_engine_for_url(database_url)
    return sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)


def get_db() -> Generator[Session, None, None]:
    """Yield a request-scoped database session."""
    settings = get_settings()
    session_local = create_session_factory(settings.database_url)
    db = session_local()
    try:
        yield db
    finally:
        db.close()
