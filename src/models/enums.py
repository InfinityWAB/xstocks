from __future__ import annotations

import enum


class ValuationMethod(str, enum.Enum):
    FIFO = "fifo"    # First In, First Out
    LIFO = "lifo"    # Last In, First Out
    FEFO = "fefo"    # First Expired, First Out
    CMUP = "cmup"    # Weighted Average Cost


class ABCClass(str, enum.Enum):
    A = "A"
    B = "B"
    C = "C"


class XYZClass(str, enum.Enum):
    X = "X"
    Y = "Y"
    Z = "Z"


class BatchStatus(str, enum.Enum):
    ACTIVE = "active"
    QUARANTINE = "quarantine"
    DEPLETED = "depleted"
    EXPIRED = "expired"


class StockMoveType(str, enum.Enum):
    IN = "in"
    OUT = "out"
    TRANSFER = "transfer"
    ADJUSTMENT = "adjustment"


class InventoryType(str, enum.Enum):
    CYCLE = "cycle"
    FULL = "full"


class InventoryStatus(str, enum.Enum):
    DRAFT = "draft"
    IN_PROGRESS = "in_progress"
    VALIDATED = "validated"
    CANCELLED = "cancelled"


class TransferSuggestionStatus(str, enum.Enum):
    SUGGESTED = "suggested"
    APPROVED = "approved"
    REJECTED = "rejected"
    EXECUTED = "executed"


class LocationType(str, enum.Enum):
    """Odoo-style location typing — drives which routes/circuits a location can play in."""

    STOCK_INTERNAL = "stock_internal"
    RECEIVING = "receiving"
    SHIPPING = "shipping"
    TRANSIT = "transit"
    LOSS = "loss"
    VIRTUAL_CUSTOMER = "virtual_customer"
    VIRTUAL_SUPPLIER = "virtual_supplier"


class StockTransferStatus(str, enum.Enum):
    DRAFT = "draft"
    READY = "ready"
    DONE = "done"
    CANCELLED = "cancelled"


class AttachmentOwnerType(str, enum.Enum):
    """Entity type an uploaded file (ext.storage) is attached to."""

    PRODUCT = "product"
    BATCH = "batch"
    WAREHOUSE = "warehouse"
    INVENTORY_COUNT = "inventory_count"
    CONTROLLED_SUBSTANCE_REGISTER = "controlled_substance_register"


class AlertType(str, enum.Enum):
    """Which xstock alert an AlertSubscription row configures recipients for."""

    STOCK_THRESHOLD = "stock_threshold"
    BATCH_EXPIRY = "batch_expiry"
    CONSUMPTION_ANOMALY = "consumption_anomaly"
    COLD_CHAIN_EXCURSION = "cold_chain_excursion"
    CONTROLLED_SUBSTANCE_VARIANCE = "controlled_substance_variance"
    TRANSFER_SUGGESTION = "transfer_suggestion"
