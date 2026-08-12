"""Business exceptions for the xstock plugin."""


class ProductNotFoundError(Exception):
    def __init__(self, product_id: str) -> None:
        super().__init__(f"product {product_id!r} not found")
        self.product_id = product_id


class DuplicateProductCodeError(Exception):
    def __init__(self, code: str) -> None:
        super().__init__(f"product code {code!r} already exists")
        self.code = code


class WarehouseNotFoundError(Exception):
    def __init__(self, warehouse_id: str) -> None:
        super().__init__(f"warehouse {warehouse_id!r} not found")
        self.warehouse_id = warehouse_id


class DuplicateWarehouseCodeError(Exception):
    def __init__(self, code: str) -> None:
        super().__init__(f"warehouse code {code!r} already exists")
        self.code = code


class StockLocationNotFoundError(Exception):
    def __init__(self, location_id: str) -> None:
        super().__init__(f"stock location {location_id!r} not found")
        self.location_id = location_id


class DuplicateStockLocationCodeError(Exception):
    def __init__(self, warehouse_id: str, code: str) -> None:
        super().__init__(f"location code {code!r} already exists in warehouse {warehouse_id!r}")
        self.warehouse_id = warehouse_id
        self.code = code


class InsufficientStockError(Exception):
    def __init__(self, product_id: str, requested: float, available: float) -> None:
        super().__init__(
            f"insufficient stock for product {product_id!r}: requested {requested}, available {available}"
        )
        self.product_id = product_id
        self.requested = requested
        self.available = available


class WitnessRequiredError(Exception):
    def __init__(self, product_id: str) -> None:
        super().__init__(
            f"a witness_id is required to issue controlled substance {product_id!r} (double signature rule)"
        )
        self.product_id = product_id


class InvalidWitnessError(Exception):
    """Raised when witness_id fails the double-signature rule: either it's
    the same actor as created_by (self-witnessing), or it doesn't resolve to
    an active member of the current tenant (audit xstock Constat 1)."""

    def __init__(self, witness_id: str, reason: str) -> None:
        super().__init__(f"invalid witness {witness_id!r}: {reason}")
        self.witness_id = witness_id
        self.reason = reason


class SelfValidatedOverrideError(Exception):
    """Raised when the same actor who counted a controlled-substance
    variance line also tries to be the one overriding/justifying it at
    validation — no second look (audit xstock Constat 1)."""

    def __init__(self, product_id: str, actor_id: str) -> None:
        super().__init__(
            f"actor {actor_id!r} counted product {product_id!r} and cannot also validate "
            "its own controlled-substance variance override (second-look required)"
        )
        self.product_id = product_id
        self.actor_id = actor_id


class ControlledSubstanceRequiresLotTrackingError(Exception):
    def __init__(self, product_id: str) -> None:
        super().__init__(
            f"controlled substance {product_id!r} must be lot-tracked (is_lot_tracked=True)"
        )
        self.product_id = product_id


class InsufficientDemandHistoryError(Exception):
    def __init__(self, product_id: str, points: int, required: int) -> None:
        super().__init__(
            f"product {product_id!r} has {points} demand data point(s), "
            f"needs at least {required} to compute this"
        )
        self.product_id = product_id
        self.points = points
        self.required = required


class InventoryCountNotFoundError(Exception):
    def __init__(self, inventory_count_id: str) -> None:
        super().__init__(f"inventory count {inventory_count_id!r} not found")
        self.inventory_count_id = inventory_count_id


class InventoryCountLineNotFoundError(Exception):
    def __init__(self, inventory_count_id: str, product_id: str) -> None:
        super().__init__(
            f"no line for product {product_id!r} in inventory count {inventory_count_id!r}"
        )
        self.inventory_count_id = inventory_count_id
        self.product_id = product_id


class InventoryCountNotDraftOrInProgressError(Exception):
    def __init__(self, inventory_count_id: str, status: str) -> None:
        super().__init__(
            f"inventory count {inventory_count_id!r} is {status!r} — cannot be modified"
        )
        self.inventory_count_id = inventory_count_id
        self.status = status


class UncountedLinesError(Exception):
    def __init__(self, inventory_count_id: str) -> None:
        super().__init__(
            f"inventory count {inventory_count_id!r} has uncounted lines — cannot be closed"
        )
        self.inventory_count_id = inventory_count_id


class AmbiguousBatchAdjustmentError(Exception):
    """
    A lot-tracked product's inventory line has a variance but the affected
    batch can't be inferred: either no batch currently holds stock in this
    warehouse (variance found stock the system has no batch record for) or
    more than one batch does (which specific lot the variance belongs to is
    unknowable from a product-level count line). Batch-level count lines
    would resolve this but aren't implemented yet — surfacing the ambiguity
    beats silently misattributing the correction to the wrong lot.
    """

    def __init__(self, product_id: str, batch_count: int) -> None:
        super().__init__(
            f"cannot auto-resolve which batch to adjust for product {product_id!r} "
            f"({batch_count} batch(es) hold stock in this warehouse) — adjust manually"
        )
        self.product_id = product_id
        self.batch_count = batch_count


class ControlledSubstanceVarianceError(Exception):
    """
    Zero-tolerance reconciliation failure on a controlled substance line.
    Spec §3.2-h: any non-zero variance blocks closure and requires a
    justified declaration + hierarchical approval — modeled here as the
    caller passing `override_reason` to InventoryService.validate_count().
    """

    def __init__(self, product_id: str, variance: float) -> None:
        super().__init__(
            f"controlled substance {product_id!r} has a non-zero variance ({variance}) — "
            "closure blocked, requires a justified override"
        )
        self.product_id = product_id
        self.variance = variance


class AttachmentNotFoundError(Exception):
    def __init__(self, attachment_id: str) -> None:
        super().__init__(f"attachment {attachment_id!r} not found")
        self.attachment_id = attachment_id


class AttachmentContentMissingError(Exception):
    """DB metadata row exists but the backend (ext.storage) has no matching blob — data integrity issue."""

    def __init__(self, attachment_id: str) -> None:
        super().__init__(
            f"attachment {attachment_id!r} has a metadata row but no content in the storage backend"
        )
        self.attachment_id = attachment_id


class TransferSuggestionNotFoundError(Exception):
    def __init__(self, suggestion_id: str) -> None:
        super().__init__(f"transfer suggestion {suggestion_id!r} not found")
        self.suggestion_id = suggestion_id


class InvalidTransferSuggestionTransitionError(Exception):
    def __init__(self, suggestion_id: str, from_status: str, to_status: str) -> None:
        super().__init__(
            f"transfer suggestion {suggestion_id!r} cannot go from {from_status!r} to {to_status!r}"
        )
        self.suggestion_id = suggestion_id
        self.from_status = from_status
        self.to_status = to_status


class StockTransferNotFoundError(Exception):
    def __init__(self, transfer_id: str) -> None:
        super().__init__(f"stock transfer {transfer_id!r} not found")
        self.transfer_id = transfer_id


class InvalidStockTransferTransitionError(Exception):
    def __init__(self, transfer_id: str, from_status: str, to_status: str) -> None:
        super().__init__(
            f"stock transfer {transfer_id!r} cannot go from {from_status!r} to {to_status!r}"
        )
        self.transfer_id = transfer_id
        self.from_status = from_status
        self.to_status = to_status
