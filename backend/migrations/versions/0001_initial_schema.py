"""Initial RecallRelay schema covering supply chain, experiments, outbox, and agent runs.

Revision ID: 0001_initial_schema
Revises: None
Create Date: 2026-11-26
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0001_initial_schema"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "locations",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("role", sa.String(length=40), nullable=False),
        sa.Column("parent_id", sa.String(length=64), sa.ForeignKey("locations.id"), nullable=True),
        sa.Column("dataset_key", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_locations_dataset_key", "locations", ["dataset_key"])

    op.create_table(
        "product_batches",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("product_name", sa.String(length=160), nullable=False),
        sa.Column("batch_code", sa.String(length=64), nullable=False, unique=True),
        sa.Column("opening_location_id", sa.String(length=64), sa.ForeignKey("locations.id"), nullable=False),
        sa.Column("opening_quantity", sa.Integer(), nullable=False),
        sa.Column("dataset_key", sa.String(length=64), nullable=False),
        sa.Column("is_practice", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("opening_quantity >= 0", name="ck_batch_opening_nonneg"),
    )
    op.create_index("ix_product_batches_batch_code", "product_batches", ["batch_code"])
    op.create_index("ix_product_batches_dataset_key", "product_batches", ["dataset_key"])

    op.create_table(
        "shipments",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("batch_id", sa.String(length=64), sa.ForeignKey("product_batches.id"), nullable=False),
        sa.Column("sender_id", sa.String(length=64), sa.ForeignKey("locations.id"), nullable=False),
        sa.Column("receiver_id", sa.String(length=64), sa.ForeignKey("locations.id"), nullable=False),
        sa.Column("quantity", sa.Integer(), nullable=False),
        sa.Column("accepted_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("quantity > 0", name="ck_shipment_qty_positive"),
    )
    op.create_index("ix_shipments_batch_id", "shipments", ["batch_id"])

    op.create_table(
        "recalls",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("batch_id", sa.String(length=64), sa.ForeignKey("product_batches.id"), nullable=False),
        sa.Column("notice_version", sa.Integer(), nullable=False),
        sa.Column("notice_text", sa.Text(), nullable=False),
        sa.Column("is_drill", sa.Boolean(), nullable=False),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("batch_id", "notice_version", name="uq_recall_batch_version"),
    )
    op.create_index("ix_recalls_batch_id", "recalls", ["batch_id"])

    op.create_table(
        "recall_tasks",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("recall_id", sa.String(length=64), sa.ForeignKey("recalls.id"), nullable=False),
        sa.Column("location_id", sa.String(length=64), sa.ForeignKey("locations.id"), nullable=False),
        sa.Column("access_token", sa.String(length=128), nullable=False, unique=True),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("delivered_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("acknowledged_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("recall_id", "location_id", name="uq_recall_task_location"),
    )
    op.create_index("ix_recall_tasks_recall_id", "recall_tasks", ["recall_id"])
    op.create_index("ix_recall_tasks_access_token", "recall_tasks", ["access_token"])

    op.create_table(
        "responses",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("task_id", sa.String(length=64), sa.ForeignKey("recall_tasks.id"), nullable=False, unique=True),
        sa.Column("forwarded_qty", sa.Integer(), nullable=False),
        sa.Column("sold_qty", sa.Integer(), nullable=False),
        sa.Column("remaining_qty", sa.Integer(), nullable=False),
        sa.Column("set_aside_qty", sa.Integer(), nullable=False),
        sa.Column("confirmed_set_aside", sa.Boolean(), nullable=False),
        sa.Column("discrepancy_reason", sa.Text(), nullable=True),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("forwarded_qty >= 0", name="ck_resp_fwd_nonneg"),
        sa.CheckConstraint("sold_qty >= 0", name="ck_resp_sold_nonneg"),
        sa.CheckConstraint("remaining_qty >= 0", name="ck_resp_rem_nonneg"),
        sa.CheckConstraint("set_aside_qty >= 0", name="ck_resp_aside_nonneg"),
        sa.CheckConstraint("set_aside_qty <= remaining_qty", name="ck_resp_aside_le_rem"),
    )

    op.create_table(
        "drill_sessions",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("participant_alias", sa.String(length=64), nullable=False),
        sa.Column("scenario_id", sa.String(length=64), nullable=False),
        sa.Column("scenario_revision", sa.Integer(), nullable=False),
        sa.Column("notice_revision", sa.Integer(), nullable=False),
        sa.Column("identity", sa.String(length=128), nullable=False, unique=True),
        sa.Column("scoped_token", sa.String(length=128), nullable=False, unique=True),
        sa.Column("variant", sa.String(length=32), nullable=True),
        sa.Column("exposure_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finalized_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("validity_status", sa.String(length=32), nullable=False),
        sa.Column("is_practice", sa.Boolean(), nullable=False),
        sa.Column("expected_received", sa.Integer(), nullable=False),
        sa.Column("expected_forwarded", sa.Integer(), nullable=False),
        sa.Column("expected_sold", sa.Integer(), nullable=False),
        sa.Column("expected_remaining", sa.Integer(), nullable=False),
        sa.Column("expected_set_aside", sa.Integer(), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("incorrect_attempts", sa.Integer(), nullable=False),
        sa.Column("completed_seconds", sa.Float(), nullable=True),
        sa.Column("outcome", sa.String(length=32), nullable=True),
    )
    op.create_index("ix_drill_sessions_identity", "drill_sessions", ["identity"])
    op.create_index("ix_drill_sessions_scoped_token", "drill_sessions", ["scoped_token"])

    op.create_table(
        "audit_events",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("actor", sa.String(length=128), nullable=False),
        sa.Column("action", sa.String(length=64), nullable=False),
        sa.Column("entity_type", sa.String(length=64), nullable=False),
        sa.Column("entity_id", sa.String(length=64), nullable=False),
        sa.Column("revision_ref", sa.Integer(), nullable=True),
        sa.Column("details_json", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_audit_events_entity_id", "audit_events", ["entity_id"])

    op.create_table(
        "event_outbox",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("logical_event_id", sa.String(length=128), nullable=False, unique=True),
        sa.Column("identity", sa.String(length=128), nullable=False),
        sa.Column("event_name", sa.String(length=64), nullable=False),
        sa.Column("payload_json", sa.JSON(), nullable=False),
        sa.Column("dispatch_status", sa.String(length=32), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("dispatched_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_event_outbox_logical_event_id", "event_outbox", ["logical_event_id"])
    op.create_index("ix_event_outbox_identity", "event_outbox", ["identity"])
    op.create_index("ix_event_outbox_dispatch_status", "event_outbox", ["dispatch_status"])

    op.create_table(
        "agent_proposals",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("drill_id", sa.String(length=64), nullable=False),
        sa.Column("target_environment", sa.String(length=64), nullable=False),
        sa.Column("target_feature", sa.String(length=64), nullable=False),
        sa.Column("baseline_config_hash", sa.String(length=128), nullable=False),
        sa.Column("diff_json", sa.JSON(), nullable=False),
        sa.Column("evidence_ids_json", sa.JSON(), nullable=False),
        sa.Column("rationale", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("approver", sa.String(length=128), nullable=True),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("apply_idempotency_key", sa.String(length=128), nullable=True, unique=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_agent_proposals_drill_id", "agent_proposals", ["drill_id"])

    op.create_table(
        "agent_runs",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("drill_id", sa.String(length=64), nullable=False),
        sa.Column("state", sa.String(length=32), nullable=False),
        sa.Column("permitted_tools_json", sa.JSON(), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("model_name", sa.String(length=64), nullable=False),
        sa.Column("token_usage_json", sa.JSON(), nullable=False),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_agent_runs_drill_id", "agent_runs", ["drill_id"])

    op.create_table(
        "agent_tool_calls",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("run_id", sa.String(length=64), sa.ForeignKey("agent_runs.id"), nullable=False),
        sa.Column("tool_name", sa.String(length=64), nullable=False),
        sa.Column("input_hash", sa.String(length=128), nullable=False),
        sa.Column("output_hash", sa.String(length=128), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("duration_ms", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_agent_tool_calls_run_id", "agent_tool_calls", ["run_id"])


def downgrade() -> None:
    op.drop_table("agent_tool_calls")
    op.drop_table("agent_runs")
    op.drop_table("agent_proposals")
    op.drop_table("event_outbox")
    op.drop_table("audit_events")
    op.drop_table("drill_sessions")
    op.drop_table("responses")
    op.drop_table("recall_tasks")
    op.drop_table("recalls")
    op.drop_table("shipments")
    op.drop_table("product_batches")
    op.drop_table("locations")
