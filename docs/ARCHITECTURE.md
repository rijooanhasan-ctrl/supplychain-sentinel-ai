# System Architecture — SupplyChain Sentinel AI

## 1. Overview and Core Philosophy
"SupplyChain Sentinel AI" is an AI/ML-powered decision-support platform designed for the **SAP Hackfest 2026** (theme: *Resilient Supply Chains*). Its primary purpose is to provide early warning supply network risk prediction, scenario impact analysis, and actionable recovery recommendations for enterprise manufacturers (modeled as a high-complexity laptop manufacturer).

### Core Governance Constraints
- **Decision-Support Only:** The system is strictly an analytical and decision-support assistant. It **never** creates live purchase orders, modifies ERP transaction ledgers, or directly writes back mutations to operational business systems.
- **No Hidden Network Calls:** All external data flows through well-defined, isolated adapter boundaries. In Phase 2A, deterministic synthetic data is generated via `DemoAdapter`. Real SAP connectivity is decoupled behind an integration boundary.
- **Deterministic Pure Logic:** Business policies, metrics calculation, and ML scoring are decoupled from web delivery and database drivers.

---

## 2. Layered Backend Architecture

```
[ Frontend (React + Vite) ]
             |
             v  HTTP / JSON (/api/*)
+-------------------------------------------------------+
| FastAPI Application (backend/app/main.py)             |
|                                                       |
|  [ API Layer ] (backend/app/api/routes/)              |
|  Thin request handling, pagination validation,       |
|  and Pydantic response models (app/schemas/).        |
|                           |                           |
|                           v                           |
|  [ Domain Layer ] (backend/app/domain/)               |
|  Pure, testable business logic and risk algorithms.   |
|  Zero dependencies on HTTP frameworks or database.   |
|                           |                           |
|                           v                           |
|  [ Services Layer ] (backend/app/services/)           |
|  Dataset ingestion and use-case workflows.            |
|              |                         |              |
|              v                         v              |
|   [ Integrations Layer ]        [ Database Layer ]    |
|   (backend/app/integrations/)   (backend/app/db/)     |
|   SourceAdapter interface:      Local persistence:    |
|   - DemoAdapter (active)        SQLite (SQLAlchemy)   |
|   - SAPAdapter (future)                               |
+-------------------------------------------------------+
```

### Layer Responsibilities & Rules

1. **API Layer (`backend/app/api/`):**
   - **Routes stay thin:** Route functions parse query parameters (e.g. `limit`, `offset`, filters), execute optimized queries, and return typed Pydantic response schemas (`app/schemas/`).
   - No risk scoring, threshold logic, or data-fabrication calculations occur in route handlers.
   - **Read-Only:** The API exposes raw stored facts via GET requests only. Non-GET methods (POST, PUT, DELETE) are unrouted and return HTTP 405 Method Not Allowed.

2. **Domain Layer (`backend/app/domain/`):**
   - Will contain pure business logic, mathematical computations, and risk scoring functions in future phases.
   - Pure functions take inputs and return outputs with zero side effects.
   - Completely decoupled from web frameworks (FastAPI/Starlette) and database ORMs. Fully unit-testable without fixtures or mocks.

3. **Services Layer (`backend/app/services/`):**
   - `ingest.py`: Orchestrates loading `SourceDataset` into the relational database. Resolves business keys to internal IDs, validates all entity references, enforces all-or-nothing transactional guarantees, and guards against accidental data overwrites without explicit `--reset`.

4. **Integrations Layer (`backend/app/integrations/`):**
   - External systems are accessed **only** through a formal adapter interface (`SourceAdapter`).
   - Implementations:
     - `DemoAdapter`: Generates deterministic, synthetic supply chain datasets from `(seed, as_of)` using Python stdlib `random.Random`.
     - `SAPAdapter` (future): Connects via SAP OData/BTP APIs behind the same unified adapter interface.
   - High-level business logic is completely insulated from SAP communication details.

5. **Database Layer (`backend/app/db/`):**
   - Manages relational models (`models.py`) and connection pooling (`session.py`).
   - Enforces SQLite foreign keys on every connection via `PRAGMA foreign_keys=ON`.

---

## 3. Relational Entity Model

The relational schema represents the operational facts of the laptop manufacturing network:

1. **`DatasetMeta`**: Metadata record for the active dataset (`label="DEMO DATA"`, `source="demo"`, `seed`, `as_of`, `generator_version`, `generated_at`).
2. **`Warehouse`**: Facilities with roles (`plant` for Austin assembly, `regional` for distribution depots).
3. **`Product`**: Finished laptop models (`sku`, `name`, `selling_price`).
4. **`Component`**: Bill-of-materials components (`sku`, `name`, `category`, `unit_of_measure`, `criticality`, `is_active`).
5. **`BomLine`**: Product-to-component assembly mapping (`product_id`, `component_id`, `quantity_per_unit`).
6. **`Supplier`**: Component vendor partners (`code`, `name`, `country`).
7. **`SupplierComponent`**: Commercial procurement offer (`supplier_id`, `component_id`, `unit_cost`, `lead_time_days`, `min_order_qty`, `max_weekly_capacity`, `is_preferred`, `expedite_available`, `expedite_lead_time_days`, `expedite_cost_premium_pct`).
8. **`InventoryLevel`**: Stock levels per warehouse (`component_id`, `warehouse_id`, `on_hand`, `reserved`, `as_of_ts`). Usable stock is derived dynamically as `on_hand - reserved`.
9. **`PurchaseOrder`**: Inbound procurement orders (`po_number`, `supplier_id`, `status`, `order_date`, `promised_date`, `latest_estimate_date`).
10. **`PurchaseOrderLine`**: PO line items with destination warehouse and fulfillment tracking (`qty_ordered`, `qty_received`, `unit_price`).
11. **`CustomerOrder`**: Finished laptop customer demand book (`order_number`, `customer_name`, `product_id`, `quantity`, `due_date`, `priority`, `status`).
12. **`DemandRecord`**: Daily component consumption history at the plant warehouse (`component_id`, `date`, `quantity`).
13. **`DeliveryRecord`**: Historical shipment delivery records used to evaluate supplier on-time performance and quality rejection rates (`supplier_id`, `component_id`, `promised_date`, `actual_date`, `qty_ordered`, `qty_received`, `qty_rejected`).

---

## 4. Key Architectural Decisions

### A. Schema Creation vs. Migrations
- **Decision:** Schema tables are created lazily at application startup lifespan via `Base.metadata.create_all(engine)`.
- **Rationale:** During early hackathon prototyping (Phases 1 and 2), keeping dependencies minimal (no Alembic, no migration scripts) accelerates model iteration and keeps the SQLite database lightweight. Formal database migration tooling is deferred to a later operational phase.

### B. Money and Decimal Precision Handling
- **Decision:** Monetary amounts (unit costs, selling prices) use `Numeric(12, 2, asdecimal=True)`. Percentages use `Numeric(5, 4, asdecimal=True)`. In API JSON schemas, Decimal values serialize consistently as strings (e.g. `"250.00"`).
- **Rationale:** Financial calculations and procurement costs must remain exact without IEEE-754 binary floating-point roundoff errors. Using `Numeric(12, 2)` in SQLAlchemy 2.x with Python 3.13 sqlite3 avoids dialect warnings while preserving exact precision across all layers.

### C. Adapter Boundary & Business Keys
- **Decision:** `SourceDataset` DTOs reference entities using business keys (`sku`, `code`, `po_number`) rather than database primary key IDs.
- **Rationale:** External systems like SAP ERP or synthetic demo generators do not know internal auto-increment database integer keys. Translating business keys in `app/services/ingest.py` keeps adapters completely decoupled from internal database storage concerns.
