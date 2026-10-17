from app.api.routes.components import router as components_router
from app.api.routes.customer_orders import router as customer_orders_router
from app.api.routes.delivery_records import router as delivery_records_router
from app.api.routes.health import router as health_router
from app.api.routes.inventory import router as inventory_router
from app.api.routes.inventory_risk import router as inventory_risk_router
from app.api.routes.meta import router as meta_router
from app.api.routes.products import router as products_router
from app.api.routes.purchase_orders import router as purchase_orders_router
from app.api.routes.suppliers import router as suppliers_router
from app.api.routes.warehouses import router as warehouses_router

__all__ = [
    "health_router",
    "meta_router",
    "products_router",
    "components_router",
    "suppliers_router",
    "warehouses_router",
    "inventory_router",
    "inventory_risk_router",
    "purchase_orders_router",
    "customer_orders_router",
    "delivery_records_router",
]

