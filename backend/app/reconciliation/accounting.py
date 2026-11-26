"""Deterministic stock accounting equations and batch trace builder."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping, Sequence


class AccountingValidationError(ValueError):
    """Deterministic validation error with machine-readable code."""

    def __init__(self, code: str, message: str) -> None:
        self.code = code
        self.message = message
        super().__init__(message)


def _require_non_negative_int(value: Any, field_name: str) -> int:
    """Validate that a stock quantity is an exact non-negative integer (not bool/float)."""
    if isinstance(value, bool) or not isinstance(value, int):
        raise AccountingValidationError(
            "INVALID_INTEGER",
            f"'{field_name}' must be a whole non-negative integer.",
        )
    if value < 0:
        raise AccountingValidationError(
            "NEGATIVE_QUANTITY",
            f"'{field_name}' cannot be negative ({value}).",
        )
    return value


def validate_shipment_transfer(sender_available: int, quantity: Any) -> int:
    """Validate positive integer shipment quantity against sender's available stock."""
    if isinstance(quantity, bool) or not isinstance(quantity, int):
        raise AccountingValidationError(
            "INVALID_TRANSFER_QUANTITY",
            "Shipment quantity must be a positive whole integer.",
        )
    if quantity <= 0:
        raise AccountingValidationError(
            "NON_POSITIVE_TRANSFER",
            f"Shipment quantity must be positive (got {quantity}).",
        )
    if quantity > sender_available:
        raise AccountingValidationError(
            "INSUFFICIENT_STOCK_FOR_TRANSFER",
            f"Cannot transfer {quantity} units; sender only holds {sender_available} units.",
        )
    return quantity


def validate_stock_balance(
    received: Any,
    forwarded: Any,
    sold: Any,
    remaining: Any,
    set_aside: Any,
) -> None:
    """Enforce Received = Forwarded + Sold + Remaining and 0 <= SetAside <= Remaining."""
    recv_i = _require_non_negative_int(received, "received")
    fwd_i = _require_non_negative_int(forwarded, "forwarded")
    sold_i = _require_non_negative_int(sold, "sold")
    rem_i = _require_non_negative_int(remaining, "remaining")
    aside_i = _require_non_negative_int(set_aside, "set_aside")

    expected_total = fwd_i + sold_i + rem_i
    if recv_i != expected_total:
        raise AccountingValidationError(
            "ACCOUNTING_MISMATCH",
            (
                f"Stock balance mismatch: received ({recv_i}) must equal "
                f"forwarded ({fwd_i}) + sold ({sold_i}) + remaining ({rem_i}) = {expected_total}."
            ),
        )
    if aside_i > rem_i:
        raise AccountingValidationError(
            "SET_ASIDE_EXCEEDS_REMAINING",
            f"Set-aside quantity ({aside_i}) cannot exceed remaining stock ({rem_i}).",
        )


@dataclass(frozen=True)
class LocationTraceNode:
    """Reconciled stock state for one location reached by a batch."""

    location_id: str
    location_name: str
    role: str
    received: int
    forwarded: int
    sold: int
    remaining: int
    set_aside: int
    confirmed_set_aside: bool
    has_response: bool
    status: str


@dataclass(frozen=True)
class ShipmentEdge:
    """Directed batch transfer edge between two locations."""

    shipment_id: str
    sender_id: str
    sender_name: str
    receiver_id: str
    receiver_name: str
    quantity: int
    accepted_at: str


@dataclass(frozen=True)
class BatchTraceSummary:
    """Complete trace and non-double-counted batch-level reconciliation."""

    batch_id: str
    batch_code: str
    product_name: str
    opening_location_id: str
    opening_quantity: int
    total_remaining: int
    total_sold: int
    total_set_aside: int
    accounted_total: int
    discrepancy: int
    nodes: list[LocationTraceNode]
    edges: list[ShipmentEdge]


def compute_batch_trace(
    *,
    batch_id: str,
    batch_code: str,
    product_name: str,
    opening_location_id: str,
    opening_quantity: int,
    locations_by_id: Mapping[str, Any],
    shipments: Sequence[Any],
    responses_by_location: Mapping[str, Any] | None = None,
) -> BatchTraceSummary:
    """Build a fixture-agnostic trace and reconcile batch stock without double-counting."""
    if opening_location_id not in locations_by_id:
        raise AccountingValidationError(
            "UNKNOWN_OPENING_LOCATION",
            f"Opening location '{opening_location_id}' not found.",
        )

    opening_qty = _require_non_negative_int(opening_quantity, "opening_quantity")
    received_map: dict[str, int] = {opening_location_id: opening_qty}
    forwarded_map: dict[str, int] = {opening_location_id: 0}
    reached_order: list[str] = [opening_location_id]
    edges: list[ShipmentEdge] = []

    ordered_shipments = sorted(shipments, key=lambda s: (s.accepted_at, s.id))
    for sh in ordered_shipments:
        if sh.batch_id != batch_id:
            continue
        if sh.sender_id not in locations_by_id or sh.receiver_id not in locations_by_id:
            raise AccountingValidationError(
                "UNKNOWN_SHIPMENT_LOCATION",
                f"Shipment '{sh.id}' references an unknown location.",
            )
        sender_avail = received_map.get(sh.sender_id, 0) - forwarded_map.get(sh.sender_id, 0)
        qty = validate_shipment_transfer(sender_avail, sh.quantity)

        forwarded_map[sh.sender_id] = forwarded_map.get(sh.sender_id, 0) + qty
        received_map[sh.receiver_id] = received_map.get(sh.receiver_id, 0) + qty
        forwarded_map.setdefault(sh.receiver_id, 0)
        if sh.receiver_id not in reached_order:
            reached_order.append(sh.receiver_id)

        accepted_iso = (
            sh.accepted_at.isoformat() if hasattr(sh.accepted_at, "isoformat") else str(sh.accepted_at)
        )
        edges.append(
            ShipmentEdge(
                shipment_id=sh.id,
                sender_id=sh.sender_id,
                sender_name=locations_by_id[sh.sender_id].name,
                receiver_id=sh.receiver_id,
                receiver_name=locations_by_id[sh.receiver_id].name,
                quantity=qty,
                accepted_at=accepted_iso,
            )
        )

    resp_map = responses_by_location or {}
    nodes: list[LocationTraceNode] = []
    total_remaining = 0
    total_sold = 0
    total_set_aside = 0

    for loc_id in reached_order:
        loc = locations_by_id[loc_id]
        recv = received_map[loc_id]
        fwd = forwarded_map[loc_id]
        resp = resp_map.get(loc_id)
        if resp is not None:
            sold = resp.sold_qty
            rem = resp.remaining_qty
            aside = resp.set_aside_qty
            confirmed = bool(resp.confirmed_set_aside)
            has_resp = True
            try:
                validate_stock_balance(recv, fwd, sold, rem, aside)
                status = "reconciled" if (confirmed and aside == rem) else "pending_quarantine"
            except AccountingValidationError:
                status = "discrepancy"
        else:
            sold = 0
            rem = recv - fwd
            aside = 0
            confirmed = False
            has_resp = False
            status = "unreported"

        total_remaining += rem
        total_sold += sold
        total_set_aside += aside
        nodes.append(
            LocationTraceNode(
                location_id=loc_id,
                location_name=loc.name,
                role=loc.role,
                received=recv,
                forwarded=fwd,
                sold=sold,
                remaining=rem,
                set_aside=aside,
                confirmed_set_aside=confirmed,
                has_response=has_resp,
                status=status,
            )
        )

    accounted_total = total_remaining + total_sold
    discrepancy = opening_qty - accounted_total
    return BatchTraceSummary(
        batch_id=batch_id,
        batch_code=batch_code,
        product_name=product_name,
        opening_location_id=opening_location_id,
        opening_quantity=opening_qty,
        total_remaining=total_remaining,
        total_sold=total_sold,
        total_set_aside=total_set_aside,
        accounted_total=accounted_total,
        discrepancy=discrepancy,
        nodes=nodes,
        edges=edges,
    )
