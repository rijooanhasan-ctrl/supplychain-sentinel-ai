# SupplyChain Sentinel AI

AI/ML-powered supply-chain risk prediction and decision-support web application for **SAP Hackfest 2026** (Theme: *Resilient Supply Chains*).

> **Important Notices:**
> - **Decision-Support Only:** SupplyChain Sentinel AI is strictly an analytical and decision-support system. It does not create real purchase orders, touch real operational ERP transaction ledgers, or modify live enterprise data.
> - **Demo Data Notice:** All data currently processed, stored, and exposed by this application is **DEMO DATA** generated deterministically by the `DemoAdapter`. No live connection or network call to SAP or any external business system exists in this phase. Real enterprise systems are integrated only through an isolated adapter boundary.

---

## 1. Prerequisites

Before running the project locally on Windows 11, verify that the following tools are installed:
- **Python**: Version 3.13.x (invoke via `python`, not `python3` on Windows)
- **Node.js**: Version 20+ (verified with v24.16.0) and **npm** (v11.x)
- **Git**: Version 2.40+ (verified with v2.55.0)

---

## 2. Repository Layout

```
SAP/
├── .gitignore
├── README.md
├── docs/
│   └── ARCHITECTURE.md          # Architectural layers, adapter boundaries, and data model decisions
├── backend/
│   ├── .env.example             # Backend environment template
│   ├── requirements.txt         # Production runtime dependencies (FastAPI, Uvicorn, Pydantic, SQLAlchemy)
│   ├── requirements-dev.txt     # Development and testing dependencies (pytest, httpx)
│   ├── scripts/
│   │   └── verify_dataset_hash.py # Deterministic multi-table SHA-256 verification script
│   ├── app/
│   │   ├── __init__.py
│   │   ├── main.py              # FastAPI app factory, lifespan table creation, router registration
│   │   ├── cli.py               # Seed CLI command (python -m app.cli seed)
│   │   ├── core/
│   │   │   ├── __init__.py
│   │   │   └── config.py        # Pydantic Settings (env configuration and defaults)
│   │   ├── db/
│   │   │   ├── __init__.py
│   │   │   ├── models.py        # 13 SQLAlchemy 2.x declarative models with DB constraints
│   │   │   └── session.py       # Engine creation, lazy sessionmaker, SQLite foreign key pragmas
│   │   ├── schemas/
│   │   │   └── __init__.py      # Pydantic response models, UtcDatetime serializer, and envelopes
│   │   ├── api/
│   │   │   ├── __init__.py
│   │   │   └── routes/
│   │   │       ├── __init__.py
│   │   │       ├── health.py    # GET /api/health
│   │   │       ├── meta.py      # GET /api/meta
│   │   │       ├── products.py  # GET /api/products, /api/products/{id}
│   │   │       ├── components.py# GET /api/components, /api/components/{id}, demand-history
│   │   │       ├── suppliers.py # GET /api/suppliers, /api/suppliers/{id}
│   │   │       ├── warehouses.py# GET /api/warehouses
│   │   │       ├── inventory.py # GET /api/inventory
│   │   │       ├── purchase_orders.py # GET /api/purchase-orders, /api/purchase-orders/{id}
│   │   │       ├── customer_orders.py # GET /api/customer-orders
│   │   │       └── delivery_records.py# GET /api/delivery-records
│   │   ├── domain/              # Pure business logic layer (future phases)
│   │   ├── services/
│   │   │   ├── __init__.py
│   │   │   └── ingest.py        # Transactional dataset loader (load_dataset)
│   │   └── integrations/
│   │       ├── __init__.py
│   │       ├── base.py          # SourceAdapter interface and SourceDataset DTOs
│   │       └── demo_adapter.py  # Deterministic synthetic data generator
│   └── tests/
│       ├── __init__.py
│       ├── conftest.py          # Isolated temporary DB fixtures
│       ├── test_config.py       # Config defaults and monkeypatched overrides
│       ├── test_health.py       # /api/health endpoint and ISO timestamp
│       ├── test_models.py       # DB constraints and integrity error tests
│       ├── test_adapter.py      # DemoAdapter determinism and CPU-X7 scenario tests
│       ├── test_loader.py       # All-or-nothing loader and overwrite guard tests
│       ├── test_cli.py          # CLI seed command exit codes and argument tests
│       └── test_api.py          # Complete API endpoint, pagination, filter, and 404 tests
└── frontend/
    ├── package.json             # React 19, Vite, Tailwind CSS v4, Vitest dependencies
    ├── vite.config.ts           # Vite server config (port 5173, /api proxy to 8000, Vitest)
    ├── tsconfig.json            # TypeScript configuration
    └── src/
        ├── App.tsx              # "Data Sources & Integration Status" dashboard page
        ├── App.test.tsx         # Comprehensive Vitest tests (loading, counts, badges, retry)
        ├── index.css            # Tailwind CSS v4 styling
        ├── api/
        │   ├── http.ts          # Type-safe fetch wrapper, error normalization, AbortSignal
        │   ├── http.test.ts     # Unit tests for HTTP fetcher and error normalization
        │   ├── types.ts         # TypeScript interfaces mirroring backend schemas (exact string Decimals)
        │   ├── endpoints.ts     # Typed endpoint functions for all read-only GET APIs
        │   ├── useApi.ts        # Custom hook for cancellation-safe, reloadable data requests
        │   ├── useApi.test.ts   # Unit tests for useApi hook
        │   └── client.ts        # Health check client adapter (backward compatible)
        └── test/
            └── setup.ts         # Testing Library / jest-dom setup
```

---

## 3. Database Seeding CLI

To seed the local database with deterministic synthetic demo data:
```powershell
# Navigate to backend/
cd "C:\Users\SK MD Rijooan Hasan\Desktop\SAP\backend"

# Seed default demo dataset (seed=42, as_of=today UTC)
& ".\.venv\Scripts\python.exe" -m app.cli seed --reset

# Optional: seed with specific seed or reference as-of date
& ".\.venv\Scripts\python.exe" -m app.cli seed --seed 100 --as-of 2026-03-01 --reset
```
*Note: To protect stored data, the CLI refuses to overwrite an existing database without the explicit `--reset` flag.*

> **Deterministic Synthetic Timestamps:** All timestamps generated for synthetic datasets (such as `DatasetMeta.generated_at` and inventory `as_of_ts`) are deterministic synthetic UTC timestamps derived directly from the reference `as_of` date (`as_of 00:00:00 UTC`), rather than wall-clock times. This ensures 100% reproducible dataset verification hashes across distinct seeding runs with identical parameters.

---

## 4. Running the Application

### Backend API Server
From `backend/`:
```powershell
& ".\.venv\Scripts\python.exe" -m uvicorn app.main:app --reload --port 8000
```
- Interactive API Swagger documentation: `http://localhost:8000/docs`
- Health check: `http://localhost:8000/api/health`
- Dataset metadata: `http://localhost:8000/api/meta`

### Frontend Application
From `frontend/`:
```powershell
npm run dev
```
- Web Application: `http://localhost:5173` (proxies `/api/*` to `http://localhost:8000`)
- Features the **Data Sources & Integration Status** page with live health indicators, active dataset metadata, unverified integration badges, and full database entity record counts.

---

## 5. Read-Only API Endpoints

All data endpoints return standard JSON envelopes with pagination (`items`, `total`, `limit`, `offset`):

| Method | Endpoint | Description & Filters |
| :--- | :--- | :--- |
| `GET` | `/api/health` | Health status and data source verification |
| `GET` | `/api/meta` | Active dataset metadata, seed, as-of date, and entity counts |
| `GET` | `/api/products` | Finished laptop models (`limit`, `offset`) |
| `GET` | `/api/products/{id}` | Product detail with BOM lines and component information |
| `GET` | `/api/components` | Component catalog (filters: `category`, `q`, `is_active`) |
| `GET` | `/api/components/{id}` | Component detail with supplier offers and warehouse inventory |
| `GET` | `/api/components/{id}/demand-history` | Component demand history (filter: `days=1..365`, default 90) |
| `GET` | `/api/suppliers` | Supplier directory (`limit`, `offset`) |
| `GET` | `/api/suppliers/{id}` | Supplier detail with offered components and terms |
| `GET` | `/api/warehouses` | Warehouse facilities (Austin plant, regional hubs) |
| `GET` | `/api/inventory` | Inventory stock (filters: `component_id`, `warehouse_id`) |
| `GET` | `/api/purchase-orders` | Purchase orders (filters: `status`, `supplier_id`, `component_id`) |
| `GET` | `/api/purchase-orders/{id}` | Purchase order detail with line items and fulfillment status |
| `GET` | `/api/customer-orders` | Customer order book (filters: `status`, `priority`, `product_id`) |
| `GET` | `/api/delivery-records` | Historical supplier delivery performance (filters: `supplier_id`, `component_id`) |

---

## 6. Running Tests

### Backend Test Suite (33 tests)
From `backend/`:
```powershell
& ".\.venv\Scripts\python.exe" -m pytest tests -v
```

### Frontend Test Suite (20 tests)
From `frontend/`:
```powershell
npm test
```

### Frontend Linting & Production Build
From `frontend/`:
```powershell
npm run lint
npm run build
```
