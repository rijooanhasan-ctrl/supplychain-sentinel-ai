# SAP Integration Architecture & Readiness Guide

## 1. Executive Summary & Honesty Statement

**SupplyChain Sentinel AI** is a decision-support system built for resilient supply chain analysis. 
- **Current Connection State**: There is **NO live connection to SAP** or any external enterprise resource planning (ERP) system.
- **Data Source**: All baseline demonstrations utilize synthetic demo data or local static JSON sample fixtures.
- **Read-Only Invariant**: The system **never** creates purchase orders, writes stock movements, or mutates state in any external system.

---

## 2. What Exists Today

The project implements an enterprise integration boundary designed to be "SAP-ready" in architecture without pretending to have active connectivity:

1. **Source Adapter Boundary (`app.integrations.base`)**:
   - `SourceAdapter` abstract base class requiring `name: str`, `is_live: bool`, `fetch_dataset() -> SourceDataset`, and `get_coverage_report() -> Dict[str, Any]`.
   - `SourceDataset` typed container holding standardized domain Data Transfer Objects (`ComponentDTO`, `SupplierDTO`, `WarehouseDTO`, `PurchaseOrderDTO`, etc.).

2. **Illustrative SAP Mapping Layer (`app.integrations.sap_mapping`)**:
   - Pure, stateless transformation functions converting SAP-like dictionary structures into internal domain DTOs:
     - `map_sap_material`: Maps Material Master records (`Material`, `MaterialDescription`, `MaterialGroup`, `BaseUnit`, `Criticality`).
     - `map_sap_supplier`: Maps Supplier Master records (`Supplier`, `SupplierName`, `Country`).
     - `map_sap_plant`: Maps Plant records (`Plant`, `PlantName`).
     - `map_sap_stock`: Maps Plant Storage Location stock records (`Material`, `Plant`, `StorageLocation`, `UnrestrictedStock`, `ReservedQuantity`).
     - `map_sap_purchase_order`: Maps PO Header and Item schedule records (`PurchaseOrder`, `Supplier`, `PurchaseOrderDate`, `Material`, `Plant`, `OrderQuantity`, `ScheduleLineDeliveryDate`, `ReceivedQuantity`).
   - *Honesty Notice*: All field names in this mapping layer are strictly illustrative abstractions of standard SAP S/4HANA OData concepts. They must be validated against the SAP Business Accelerator Hub for the specific target system.

3. **Static Sample Adapter (`app.integrations.sap_sample_adapter.SapSampleAdapter`)**:
   - Implements `SourceAdapter` with `is_live = False` and `name = "sap-style-sample"`.
   - Loads purely from a local static JSON fixture (`backend/app/integrations/fixtures/sap_style_sample.json`).
   - Zero network dependencies: strictly makes no HTTP, socket, or external network requests.
   - Generates an explicit **Coverage Report** identifying what entities are supplied vs missing:
     - *Covered*: `plants`, `materials`, `stock`, `purchase_orders`, `suppliers`.
     - *Missing / Not in Fixture*: `demand_history`, `delivery_performance`, `multi_source_offers` (these remain unpopulated; the adapter never invents synthetic data to fill real missing gaps).

4. **Integration Status Endpoint (`GET /api/integration-status`)**:
   - Exposes active adapter status, `is_live` flag (false), covered and missing entity sets, and mandatory connectivity notice.
   - Surfaces directly on the frontend `/data-sources` page.

---

## 3. What Does NOT Exist

- No live network connection to SAP BTP, S/4HANA Cloud, or SAP ECC.
- No SAP credentials, API keys, or certificates configured or stored.
- No background sync workers, webhooks, or scheduled ERP extraction daemons.
- No transactional or write-back endpoints (all endpoints under `/api` are strictly read-only GET requests).

---

## 4. Prerequisites for a Real SAP Connector

To establish a live, production-grade SAP connector, an organization must complete the following steps:

### A. Infrastructure & Credentials
1. **SAP BTP or S/4HANA Cloud Account**: An active SAP tenant with access to relevant Communication Scenarios or SAP Integration Suite.
2. **Authentication Secrets**: OAuth2 Client ID, Client Secret, and Token URL (or X.509 Client Certificates) provisioned in SAP Cloud Identity Services.
3. **Secret Storage**: Credentials stored strictly as environment variables or cloud secret managers (AWS Secrets Manager, Azure Key Vault, HashiCorp Vault), **never** committed to version control.

### B. API Verification & Field Mapping
1. **SAP Business Accelerator Hub Alignment**:
   - Cross-reference illustrative fields with standard SAP S/4HANA Cloud OData APIs:
     - Product Master: `API_PRODUCT_SRV` (e.g. `A_Product`, `A_ProductDescription`, `A_ProductPlant`).
     - Material Stock: `API_MATERIAL_STOCK_SRV` (e.g. `A_MaterialStock`, `A_MatlStkInAcctMod`).
     - Purchase Orders: `API_PURCHASEORDER_PROCESS_SRV` (e.g. `A_PurchaseOrder`, `A_PurchaseOrderItem`, `A_POScheduleLine`).
     - Business Partner / Supplier: `API_BUSINESS_PARTNER` (e.g. `A_BusinessPartner`, `A_Supplier`).
2. **Schema Extensibility**: Support customer-specific custom fields (`YY1_...`) via configurable mapping configuration files.

### C. Enterprise Robustness
1. **Pagination & Query Limits**: Standard SAP OData endpoints enforce maximum page sizes (e.g. 50 or 100 items per response). Implement `$top` and `$skip` or delta token pagination.
2. **Resilience & Rate Limiting**: Exponential backoff, retry handling on HTTP 429 / 503, connection pooling, and circuit breaker patterns.
3. **Audit & Compliance**: Transparent ingestion logs recording timestamp, record counts, and schema validation failures without logging sensitive payload content or authorization tokens.

---

## 5. Read-Only-First Plan

Any future live integration MUST adhere to the following architectural guardrails:

```
[ SAP S/4HANA Cloud / BTP ]
            │  (OData v2/v4 HTTPS GET Only)
            ▼
┌──────────────────────────────┐
│     LiveSapAdapter (Read)    │
│  - OAuth2 Client Credentials │
│  - Pagination ($top/$skip)   │
│  - Schema Validation         │
└──────────────┬───────────────┘
               │  Pure Mapping (sap_mapping.py)
               ▼
┌──────────────────────────────┐
│ Local Decision-Support DB    │  ◄── Sentinel AI operates entirely here!
│ (SQLite / PostgreSQL Replica)│      - Disruption simulations
└──────────────┬───────────────┘      - Shortage risk calculations
               │                      - Recovery plan suggestions
               ▼
   [ Decision Makers / UI ]
   (No automated write-back; human procurement executes POs in SAP)
```

1. **Strictly Read-Only Ingestion**: All SAP API interaction will consist of read-only `GET` queries.
2. **Local Replica Decoupling**: Sentinel AI performs simulations, scenario modeling, and recovery plan evaluations against its own local decision-support database.
3. **Human-in-the-Loop Safeguard**: Decision recommendations remain strictly advisory. PO creation, rescheduling, or supplier transfers must be manually executed by authorized supply chain operators directly within native SAP GUI / Fiori applications.
