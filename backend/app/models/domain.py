"""Core domain, experiment, outbox, and AI agent ORM models."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


def utcnow() -> datetime:
    """Return timezone-aware UTC timestamp."""
    return datetime.now(timezone.utc)


class Location(Base):
    """Supply-chain participant location (manufacturer, distributor, shop, etc.)."""

    __tablename__ = "locations"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    role: Mapped[str] = mapped_column(String(40), nullable=False)
    parent_id: Mapped[str | None] = mapped_column(ForeignKey("locations.id"), nullable=True)
    dataset_key: Mapped[str] = mapped_column(String(64), nullable=False, default="food_drill", index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)


class ProductBatch(Base):
    """Tracked product batch originating at an opening location."""

    __tablename__ = "product_batches"
    __table_args__ = (
        CheckConstraint("opening_quantity >= 0", name="ck_batch_opening_nonneg"),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    product_name: Mapped[str] = mapped_column(String(160), nullable=False)
    batch_code: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    opening_location_id: Mapped[str] = mapped_column(ForeignKey("locations.id"), nullable=False)
    opening_quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    dataset_key: Mapped[str] = mapped_column(String(64), nullable=False, default="food_drill", index=True)
    is_practice: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)

    opening_location: Mapped[Location] = relationship("Location")
    shipments: Mapped[list[Shipment]] = relationship("Shipment", back_populates="batch")


class Shipment(Base):
    """Accepted batch transfer between two known locations."""

    __tablename__ = "shipments"
    __table_args__ = (
        CheckConstraint("quantity > 0", name="ck_shipment_qty_positive"),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    batch_id: Mapped[str] = mapped_column(ForeignKey("product_batches.id"), nullable=False, index=True)
    sender_id: Mapped[str] = mapped_column(ForeignKey("locations.id"), nullable=False)
    receiver_id: Mapped[str] = mapped_column(ForeignKey("locations.id"), nullable=False)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    accepted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)

    batch: Mapped[ProductBatch] = relationship("ProductBatch", back_populates="shipments")
    sender: Mapped[Location] = relationship("Location", foreign_keys=[sender_id])
    receiver: Mapped[Location] = relationship("Location", foreign_keys=[receiver_id])


class Recall(Base):
    """Published recall notice targeting a single batch."""

    __tablename__ = "recalls"
    __table_args__ = (
        UniqueConstraint("batch_id", "notice_version", name="uq_recall_batch_version"),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    batch_id: Mapped[str] = mapped_column(ForeignKey("product_batches.id"), nullable=False, index=True)
    notice_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    notice_text: Mapped[str] = mapped_column(Text, nullable=False)
    is_drill: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    published_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)


class RecallTask(Base):
    """Location-scoped task generated when a recall notice is published."""

    __tablename__ = "recall_tasks"
    __table_args__ = (
        UniqueConstraint("recall_id", "location_id", name="uq_recall_task_location"),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    recall_id: Mapped[str] = mapped_column(ForeignKey("recalls.id"), nullable=False, index=True)
    location_id: Mapped[str] = mapped_column(ForeignKey("locations.id"), nullable=False)
    access_token: Mapped[str] = mapped_column(String(128), unique=True, nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(32), default="pending", nullable=False)
    delivered_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    acknowledged_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class Response(Base):
    """Single current reconciled response per RecallTask (edits increment revision)."""

    __tablename__ = "responses"
    __table_args__ = (
        CheckConstraint("forwarded_qty >= 0", name="ck_resp_fwd_nonneg"),
        CheckConstraint("sold_qty >= 0", name="ck_resp_sold_nonneg"),
        CheckConstraint("remaining_qty >= 0", name="ck_resp_rem_nonneg"),
        CheckConstraint("set_aside_qty >= 0", name="ck_resp_aside_nonneg"),
        CheckConstraint("set_aside_qty <= remaining_qty", name="ck_resp_aside_le_rem"),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    task_id: Mapped[str] = mapped_column(ForeignKey("recall_tasks.id"), unique=True, nullable=False)
    forwarded_qty: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    sold_qty: Mapped[int] = mapped_column(Integer, nullable=False)
    remaining_qty: Mapped[int] = mapped_column(Integer, nullable=False)
    set_aside_qty: Mapped[int] = mapped_column(Integer, nullable=False)
    confirmed_set_aside: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    discrepancy_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    revision: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    submitted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)


class DrillSession(Base):
    """Independent participant session for Track 1 A/B workflow evaluation."""

    __tablename__ = "drill_sessions"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    participant_alias: Mapped[str] = mapped_column(String(64), nullable=False)
    scenario_id: Mapped[str] = mapped_column(String(64), nullable=False)
    scenario_revision: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    notice_revision: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    identity: Mapped[str] = mapped_column(String(128), unique=True, nullable=False, index=True)
    scoped_token: Mapped[str] = mapped_column(String(128), unique=True, nullable=False, index=True)
    variant: Mapped[str | None] = mapped_column(String(32), nullable=True)
    exposure_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finalized_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    validity_status: Mapped[str] = mapped_column(String(32), default="pending", nullable=False)
    is_practice: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    expected_received: Mapped[int] = mapped_column(Integer, nullable=False)
    expected_forwarded: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    expected_sold: Mapped[int] = mapped_column(Integer, nullable=False)
    expected_remaining: Mapped[int] = mapped_column(Integer, nullable=False)
    expected_set_aside: Mapped[int] = mapped_column(Integer, nullable=False)
    attempts: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    incorrect_attempts: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    completed_seconds: Mapped[float | None] = mapped_column(Float, nullable=True)
    outcome: Mapped[str | None] = mapped_column(String(32), nullable=True)


class AuditEvent(Base):
    """Append-only audit trail for recalls, tasks, responses, and agent approvals."""

    __tablename__ = "audit_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    actor: Mapped[str] = mapped_column(String(128), nullable=False)
    action: Mapped[str] = mapped_column(String(64), nullable=False)
    entity_type: Mapped[str] = mapped_column(String(64), nullable=False)
    entity_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    revision_ref: Mapped[int | None] = mapped_column(Integer, nullable=True)
    details_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)


class EventOutbox(Base):
    """Durable outbox for retry-safe Flagsmith experimentation event dispatch."""

    __tablename__ = "event_outbox"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    logical_event_id: Mapped[str] = mapped_column(String(128), unique=True, nullable=False, index=True)
    identity: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    event_name: Mapped[str] = mapped_column(String(64), nullable=False)
    payload_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    dispatch_status: Mapped[str] = mapped_column(String(32), default="pending", nullable=False, index=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    dispatched_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class AgentProposal(Base):
    """Human-reviewed pilot workflow proposal generated by the bounded product agent."""

    __tablename__ = "agent_proposals"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    drill_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    target_environment: Mapped[str] = mapped_column(String(64), nullable=False)
    target_feature: Mapped[str] = mapped_column(String(64), nullable=False)
    baseline_config_hash: Mapped[str] = mapped_column(String(128), nullable=False)
    diff_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    evidence_ids_json: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    rationale: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="pending_review", nullable=False)
    revision: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    approver: Mapped[str | None] = mapped_column(String(128), nullable=True)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    apply_idempotency_key: Mapped[str | None] = mapped_column(String(128), unique=True, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)


class AgentRun(Base):
    """Execution record for a bounded product agent invocation."""

    __tablename__ = "agent_runs"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    drill_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    state: Mapped[str] = mapped_column(String(32), nullable=False)
    permitted_tools_json: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    attempts: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    model_name: Mapped[str] = mapped_column(String(64), nullable=False)
    token_usage_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class AgentToolCall(Base):
    """Individual tool call trace recorded during an AgentRun."""

    __tablename__ = "agent_tool_calls"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    run_id: Mapped[str] = mapped_column(ForeignKey("agent_runs.id"), nullable=False, index=True)
    tool_name: Mapped[str] = mapped_column(String(64), nullable=False)
    input_hash: Mapped[str] = mapped_column(String(128), nullable=False)
    output_hash: Mapped[str] = mapped_column(String(128), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False)
    duration_ms: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
