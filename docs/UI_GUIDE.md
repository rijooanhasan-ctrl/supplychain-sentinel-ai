# SupplyChain Sentinel AI — Frontend UI & Visualization Guide

This document describes the frontend design system, accessible visualization architecture, plain-language terminology standards, and component extension patterns for **SupplyChain Sentinel AI** (SAP Hackfest 2026).

---

## 1. Landing Page Architecture (`/` — Overview)

The landing page provides an immediate, self-explanatory operational overview for executive decision-makers, supply chain planners, and plant managers. It is assembled from eight modular, independently-loading sections.

```
+-----------------------------------------------------------------------------------+
| 1. HeadlineStrip: Natural-language executive summary banner + dataset badge & date|
+-----------------------------------------------------------------------------------+
| 2. KPI Tiles (4-column grid):                                                     |
|    [Components at Risk]   [Soonest Shortage]   [Late Deliveries]   [Open Alerts]  |
+-----------------------------------------------------------------------------------+
| 3. Component Risk Mix: Stacked proportional bar showing critical/high/med/low mix |
+-----------------------------------------------------------------------------------+
| 4. Shortage Runway Chart: 30-day timeline with stock runout, gap hatching & PO ▼  |
+-----------------------------------------------------------------------------------+
| 5. Inbound Delivery Schedule: Chronological list of POs with slipped & overdue tags|
+-----------------------------------------------------------------------------------+
| 6. Supplier On-Time Reliability: Horizontal performance bars sorted worst-first   |
+-----------------------------------------------------------------------------------+
| 7. "How to read this page" collapsible educational guidance panel                 |
+-----------------------------------------------------------------------------------+
| 8. Operational Baseline & Master Catalog summary + Decision Support Disclaimer    |
+-----------------------------------------------------------------------------------+
```

### Modular Block Summary & Data Sources

| Block | Primary Purpose | API Source | Fallback / Resilience |
| :--- | :--- | :--- | :--- |
| **HeadlineStrip** | 1-line plain-language executive summary of the supply chain state. | `GET /api/executive-summary` + `GET /api/meta` | Shimmers during fetch; displays clean fallback if executive endpoint is unavailable. |
| **KPI Tiles** | At-a-glance critical indicators with ⓘ glossary tooltips. | `GET /api/inventory-risk`<br>`GET /api/purchase-orders`<br>`GET /api/alerts` | Each tile handles loading independently; clicking navigates directly to the underlying page. |
| **Risk Mix Bar** | Proportional distribution of catalog components across risk tiers. | `GET /api/inventory-risk` | Interactive swatches filter to `/inventory-risk?risk_level=<lvl>`; includes "View as table" toggle. |
| **Runway Chart** | 30-day visual runway for critical components, highlighting delivery gaps. | `GET /api/inventory-risk` | Individual error & retry boundaries; provides tabular alternative and links to Simulator. |
| **Delivery Timeline** | Inbound shipments schedule with overdue and slipped promise badges. | `GET /api/purchase-orders` | Overdue summary strip at top; dashed arrows for slipped supplier dates; tabular alternative. |
| **Supplier Reliability** | Supplier on-time delivery percentages ranked worst-performing first. | `GET /api/supplier-risk` | Displays "limited history" badges for `< 5` deliveries; tabular alternative. |
| **How to Read Panel** | Plain-language glossary and chart interpretation guide. | Static (`src/constants/glossary.ts`) | Collapsible with `aria-expanded` and persistent state. |
| **Disclaimer Footer** | Legal and decision-support compliance statement. | Static | Preserves boundary notice: *"Decision support only. No orders are created."* |

---

## 2. Reading the Shortage Runway Chart

The **Runway Chart** (`src/components/charts/RunwayChart.tsx`) is the central visual tool for supply chain planners. It answers two immediate questions:
1. *When will we run out of stock?*
2. *Will our incoming purchase order arrive in time to prevent a line stoppage?*

### Chart Anatomy

```
Component SKU        0d (Today)      7d             14d            21d            28d         30d+
CPU-X7              [==== Usable Stock ====]░░░ Shortage Gap ░░░░▼ (PO-2026-001 arrives Day 18)
                    <------ 10 days ------> <----- 8 days ----->
```

1. **Time Axis**: Left-to-right horizontal timeline spanning Day 0 (today / `as_of` date) through Day 30+.
2. **Usable Stock Bar**: Solid bar filled with the component's risk level color and an accessible SVG pattern. The width corresponds to `days_until_shortage`.
3. **Shortage Gap (Red Diagonal Hatching)**: If an inbound shipment is scheduled *after* stock runs out, a hatched red segment visually highlights the supply deficit interval (`delivery_days - shortage_days`).
4. **Replenishment Marker (`▼`)**: An inverted blue triangle placed at the arrival date of the next confirmed purchase order. Hovering reveals the PO number, quantity, and supplier.
5. **Unscheduled Deficit Warning**: If a component has a projected shortage but **no purchase orders exist**, the gap extends to Day 30 with a red dashed border and an *"Unscheduled"* warning tag.
6. **One-Click Simulation**: Clicking any component SKU navigates directly to `/simulator?component_id=<id>` with what-if scenario levers pre-loaded.
7. **Dynamic Summary**: An amber status strip above the chart computes dynamic totals (e.g., *"1 component faces projected stockouts (1 within 14 days); the earliest shortage is CPU-X7 in 10 days"*).

---

## 3. Design System & Accessibility Standards

The frontend enforces strict WCAG 2.1 AA accessibility guidelines across all views:

### Color Palette & Contrast Tokens (`src/theme/riskPalette.ts`)

Color is **never the sole indicator** of status or severity. Every color token is paired with text badges and unique SVG fill patterns.

| Risk Level | Text Hex | Background Hex | Contrast vs BG | SVG Pattern ID | Visual Pattern Style |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Critical** | `#991b1b` | `#fef2f2` | **8.1:1** (>= 4.5:1) | `pattern-risk-critical` | Heavy cross-hatch (`+` / `x`) |
| **High** | `#9a3412` | `#fff7ed` | **6.7:1** (>= 4.5:1) | `pattern-risk-high` | Diagonal forward stripes (`///`) |
| **Medium** | `#92400e` | `#fffbeb` | **6.4:1** (>= 4.5:1) | `pattern-risk-medium` | Stippled dots (`:::`) |
| **Low** | `#166534` | `#f0fdf4` | **7.5:1** (>= 4.5:1) | `pattern-risk-low` | Fine reverse diagonal stripes (`\\\`) |
| **None** | `#334155` | `#f8fafc` | **10.5:1** (>= 4.5:1) | `pattern-risk-none` | Horizontal thin rules (`---`) |
| **Unknown** | `#475569` | `#f1f5f9` | **8.2:1** (>= 4.5:1) | `pattern-risk-unknown` | Open grid |

*All contrast ratios are programmatically verified in automated unit tests (`src/theme/riskPalette.test.ts`) using the W3C relative luminance formula.*

### Screen-Reader & Tabular Equivalents

- **"View as table" Toggle**: Every visual chart component (`RiskMixBar`, `RunwayChart`, `DeliveryTimeline`, `SupplierReliabilityBars`) provides an accessible table toggle via `ChartCard`.
- **Keyboard Navigation**: Tooltips (`InfoTip`) and collapsible panels (`HowToReadPanel`) are fully keyboard-navigable (`Tab`, `Enter`, `Space`, `Escape`).
- **Responsive Layout**: Designed for mobile (360px viewport) up to high-density desktop displays (1920px).

---

## 4. Plain-Language Terminology Standards

To prevent executive misunderstanding and comply with hackfest presentation rules, the application enforces the following vocabulary across all UI elements and documentation:

1. **Upper-Bound Exposure**: Customer order values affected by component stockouts represent an *upper bound of financial exposure*, **never** a "savings" or "loss estimate" (orders may be rescheduled or fulfilled from safety stock).
2. **Usable Stock Runway**: Days of inventory remaining at projected demand rates before a stockout occurs.
3. **Slipped Delivery**: A purchase order whose latest supplier estimated delivery date is strictly later than the contractually promised date.
4. **Overdue Delivery**: An open purchase order whose expected delivery date has passed relative to the system `as_of` date.
5. **No Live SAP Connection**: The application is an analytical decision-support tool operating on synthetic demo data; it never connects to live SAP ERP systems or generates actual purchase orders.

---

## 5. Adding a New Chart with Shared Components

When creating new visualizations, use the standardized shared component kit:

```tsx
import React, { useState } from 'react';
import { ChartCard } from '../ui/ChartCard';
import { StatusLegend } from '../ui/StatusLegend';
import { GLOSSARY } from '../../constants/glossary';

export const MyNewChart: React.FC = () => {
  const { data, loading, error, reload } = useApi(fetchMyChartData);

  return (
    <ChartCard
      title="My Chart Title"
      subtitle="Plain-language description of what this chart displays."
      infoTerm={GLOSSARY.runway.term}
      infoDescription={GLOSSARY.runway.definition}
      loading={loading}
      error={error}
      onRetry={reload}
      isEmpty={!data || data.length === 0}
      emptyMessage="No data available for the selected parameters."
      testId="my-new-chart-card"
      tableView={<MyAccessibleDataTable data={data} />}
    >
      <div className="space-y-4">
        {/* Render pure SVG / HTML visual representation */}
        <svg viewBox="0 0 500 100" role="img" aria-label="Accessible chart description">
          {/* Use pattern fills from SvgPatternDefs */}
        </svg>

        {/* Standardized Legend */}
        <StatusLegend
          items={[
            { level: 'critical', label: 'Critical Risk', count: 2 },
            { level: 'high', label: 'High Risk', count: 4 },
          ]}
        />
      </div>
    </ChartCard>
  );
};
```
