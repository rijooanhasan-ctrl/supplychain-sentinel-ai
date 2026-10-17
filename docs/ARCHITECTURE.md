# System Architecture — SupplyChain Sentinel AI

## 1. Overview and Core Philosophy
"SupplyChain Sentinel AI" is a decision-support platform designed for the SAP Hackfest 2026 (theme: Resilient Supply Chains). Its primary purpose is to provide early warning risk prediction, scenario impact analysis, and actionable mitigation guidance for enterprise supply networks.

### Core Governance Constraints
- **Decision-Support Only:** The system is strictly an analytical and decision-support assistant. It **never** creates live purchase orders, modifies ERP transaction ledgers, or directly writes back mutations to operational business systems without explicit external governance.
- **No Hidden Network Calls:** All external data flows through well-defined, isolated adapter boundaries. In Phase 1, only mock/demo data is supported. Real SAP connectivity is decoupled behind an integration boundary.
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
|  [ API Layer ] (backend/app/api/)                     |
|  Thin request handling, schema validation (Pydantic), |
|  HTTP status codes, and route dispatching.            |
|                           |                           |
|                           v                           |
|  [ Domain Layer ] (backend/app/domain/)               |
|  Pure, testable business logic and risk algorithms.   |
|  Zero dependencies on HTTP frameworks or database.   |
|                           |                           |
|                           v                           |
|  [ Services Layer ] (backend/app/services/)           |
|  Use-case orchestration and application workflows.   |
|              |                         |              |
|              v                         v              |
|   [ Integrations Layer ]        [ Database Layer ]    |
|   (backend/app/integrations/)   (backend/app/db/)     |
|   SourceAdapter interface:      Local persistence     |
|   - DemoAdapter (active)        (SQLite via SQLModel/ |
|   - SAPAdapter (future)         SQLAlchemy)           |
+-------------------------------------------------------+
```

### Layer Responsibilities & Rules

1. **API Layer (`backend/app/api/`):**
   - **Routes stay thin:** Route functions parse request parameters, call service/domain functions, and return typed Pydantic response models.
   - No complex conditional branching, business rules, or direct external system communication in route handlers.

2. **Domain Layer (`backend/app/domain/`):**
   - Contains pure business logic, mathematical computations, and risk scoring functions.
   - Pure functions take inputs and return outputs with zero side effects.
   - Completely decoupled from web frameworks (FastAPI/Starlette) and database ORMs. Fully unit-testable without fixtures or mocks.

3. **Services Layer (`backend/app/services/`):**
   - Coordinates multi-step business workflows, orchestrating between domain calculations, persistence, and external adapters.

4. **Integrations Layer (`backend/app/integrations/`):**
   - External systems are accessed **only** through a formal adapter interface (`SourceAdapter`).
   - Implementations:
     - `DemoAdapter`: Provides deterministic sample scenarios and risk metrics for development and demo environments.
     - `SAPAdapter` (future): Connects via SAP OData/BTP APIs behind the same unified adapter interface.
   - High-level business logic is completely insulated from SAP communication details.

5. **Database Layer (`backend/app/db/`):**
   - Manages SQLite schema, database sessions, and persistence.

---

## 3. Frontend Architecture

- **React + TypeScript + Vite + Tailwind CSS:** Provides a clean, responsive, accessible interface.
- **Single Source of Truth:** The frontend **only** displays backend-computed values and metrics. No critical risk scoring, threshold logic, or data-fabrication calculations occur in the browser.
- **Typed API Client:** All network interactions are encapsulated in dedicated typed client modules (`src/api/client.ts`), utilizing proxy routes (`/api`) to avoid hardcoded absolute endpoints.
