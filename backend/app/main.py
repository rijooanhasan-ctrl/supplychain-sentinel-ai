from contextlib import asynccontextmanager
import logging
import time
from typing import Optional
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

from app.api.routes.alerts import router as alerts_router
from app.api.routes.components import router as components_router
from app.api.routes.customer_orders import router as customer_orders_router
from app.api.routes.delivery_records import router as delivery_records_router
from app.api.routes.executive_summary import router as executive_summary_router
from app.api.routes.forecasting import router as forecasting_router
from app.api.routes.health import router as health_router
from app.api.routes.integration_status import router as integration_status_router
from app.api.routes.inventory import router as inventory_router
from app.api.routes.inventory_risk import router as inventory_risk_router
from app.api.routes.meta import router as meta_router
from app.api.routes.products import router as products_router
from app.api.routes.purchase_orders import router as purchase_orders_router
from app.api.routes.recovery import router as recovery_router
from app.api.routes.simulation import router as simulation_router
from app.api.routes.supplier_risk import router as supplier_risk_router
from app.api.routes.suppliers import router as suppliers_router
from app.api.routes.warehouses import router as warehouses_router
from app.core.config import Settings, get_settings
from app.db.models import Base
from app.db.session import create_engine_and_sessionmaker, get_db, get_engine

logger = logging.getLogger("app.api")


class RequestLoggingMiddleware(BaseHTTPMiddleware):
    """Logs method, path (without query strings or secrets), status, and duration."""

    async def dispatch(self, request: Request, call_next):
        start_time = time.perf_counter()
        response = await call_next(request)
        duration_ms = (time.perf_counter() - start_time) * 1000.0
        logger.info(
            "%s %s -> %s (%.2fms)",
            request.method,
            request.url.path,
            response.status_code,
            duration_ms,
        )
        return response


def create_app(settings: Optional[Settings] = None) -> FastAPI:
    if settings is None:
        settings = get_settings()

    @asynccontextmanager
    async def app_lifespan(application: FastAPI):
        # Create database tables lazily on startup
        if not hasattr(application.state, "engine"):
            engine, session_factory = create_engine_and_sessionmaker(settings.DATABASE_URL)
            application.state.engine = engine
            application.state.session_factory = session_factory
        Base.metadata.create_all(application.state.engine)
        yield

    app = FastAPI(
        title=settings.APP_NAME,
        version=settings.API_VERSION,
        docs_url="/docs",
        redoc_url="/redoc",
        lifespan=app_lifespan,
    )

    # Bind active settings to FastAPI dependency injection
    app.dependency_overrides[get_settings] = lambda: settings

    # Bind active DB session factory
    def get_scoped_db():
        if hasattr(app.state, "session_factory"):
            db = app.state.session_factory()
        else:
            engine, sf = create_engine_and_sessionmaker(settings.DATABASE_URL)
            db = sf()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = get_scoped_db

    # Request logging middleware
    app.add_middleware(RequestLoggingMiddleware)

    # Consistent 500 error handler without exposing stack traces
    @app.exception_handler(Exception)
    async def unhandled_exception_handler(request: Request, exc: Exception):
        logger.error("Unhandled server exception on %s %s: %s", request.method, request.url.path, exc)
        return JSONResponse(
            status_code=500,
            content={"detail": "Internal server error"},
        )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.CORS_ORIGINS,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Register API routers under /api
    app.include_router(health_router, prefix="/api")
    app.include_router(meta_router, prefix="/api")
    app.include_router(integration_status_router, prefix="/api")
    app.include_router(products_router, prefix="/api")
    app.include_router(components_router, prefix="/api")
    app.include_router(suppliers_router, prefix="/api")
    app.include_router(warehouses_router, prefix="/api")
    app.include_router(inventory_router, prefix="/api")
    app.include_router(inventory_risk_router, prefix="/api")
    app.include_router(supplier_risk_router, prefix="/api")
    app.include_router(purchase_orders_router, prefix="/api")
    app.include_router(customer_orders_router, prefix="/api")
    app.include_router(delivery_records_router, prefix="/api")
    app.include_router(forecasting_router, prefix="/api")
    app.include_router(alerts_router, prefix="/api")
    app.include_router(recovery_router, prefix="/api")
    app.include_router(simulation_router, prefix="/api")
    app.include_router(executive_summary_router, prefix="/api")

    return app


app = create_app()

