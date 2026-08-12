from .attachments import build_attachments_router
from .intelligence import build_intelligence_router
from .inventory import build_inventory_router
from .movements import build_movements_router
from .products import build_products_router
from .settings import build_settings_router
from .transfers import build_transfers_router
from .warehouses import build_warehouses_router

__all__ = [
    "build_products_router",
    "build_warehouses_router",
    "build_movements_router",
    "build_inventory_router",
    "build_intelligence_router",
    "build_attachments_router",
    "build_settings_router",
    "build_transfers_router",
]
