# 3D Interactive Supply-Chain Globe

## 1. Overview & Control Tower Philosophy
The **3D Interactive Supply-Chain Globe** provides an executive-grade geospatial control tower for **SupplyChain Sentinel AI** (SAP Hackfest 2026). It visualizes global supplier networks, receiving warehouse hubs, active purchase order transit routes, and geopolitical supply concentration risks.

The interface is styled in a modern dark aerospace control room theme (`#070b14` canvas, glowing cyan/amber nodes, curved geodesic supply arcs) that highlights critical supply vulnerabilities at a glance.

```
                 +-----------------------------------------+
                 |          Frontend (/globe route)        |
                 |  - React-Globe.gl + Three.js            |
                 |  - Offline textures & GeoJSON           |
                 |  - WebGL fallback: Accessible table     |
                 +--------------------+--------------------+
                                      |
                     GET /api/globe   |   POST /api/locations/override
                                      v
                 +-----------------------------------------+
                 |            FastAPI Backend              |
                 |  - app/domain/geo.py (Pure algorithms)  |
                 |  - app/services/globe.py                |
                 |  - Resolution precedence & overrides    |
                 +-----------------------------------------+
```

---

## 2. Architecture & Data Precedence

### Four-Tier Location Resolution
To support both the built-in synthetic demo dataset and newly uploaded customer datasets (which often only contain two-letter country codes or messy vendor addresses), the backend applies a deterministic 4-stage resolution hierarchy:

1. **User Overrides:** Location overrides saved via `POST /api/locations/override`. These overrides are dataset-isolated into `backend/data/location_overrides_<dataset_key>.json` and never mutate the SQLite database.
2. **Demo Fixtures:** Exact pre-mapped facility coordinates in `backend/app/integrations/fixtures/demo_locations.json`.
3. **Country Centroid Fallback:** Public-domain ISO 3166-1 alpha-2 geographical centroids (`country_centroids.json`). Mark entity as `source: "country_centroid"`, `precision: "country"`, and `is_approximate: true`.
4. **Unresolved:** If neither coordinates nor a recognized country code exist, the entity is placed in the `needs_location` list for user review and placement.

### Coordinate Validation & "Null Island" Protection
All coordinates undergo strict range and validity checks:
- Latitude must be between `-90.0` and `+90.0`.
- Longitude must be between `-180.0` and `+180.0`.
- Non-finite values (`NaN`, `Inf`) are rejected.
- **Null Island Protection:** Exact `(0.0, 0.0)` coordinates (the Gulf of Guinea weather buoy) are strictly rejected as invalid missing-data artifacts unless explicitly permitted.

---

## 3. Offline Bundled Assets & Licensing
The globe runs 100% offline with zero external CDN dependencies, network roundtrips, or API keys:

| Asset File | Size | Resolution | Source & License |
|---|---|---|---|
| `earth-night.jpg` | 545 KB | 2048x1024 | NASA Earth Observatory / Black Marble (Public Domain) |
| `earth-topology.png` | 1.25 MB | 2048x1024 | NASA Visible Earth Bathymetry / Elevation (Public Domain) |
| `night-sky.png` | 477 KB | 2048x1024 | NASA Deep Field Starfield Texture (Public Domain) |
| `countries-110m.geojson` | 245 KB | 1:110m scale | Natural Earth Vector Boundaries (Public Domain) |

**Total Asset Footprint:** ~2.48 MB (well within the 6 MB bundle budget).

---

## 4. Supply Concentration Risk Modeling
The concentration layer (`compute_concentration` in `app/domain/geo.py`) analyzes the loaded supplier base to detect geopolitical single points of failure:

- **Volume Concentration:** Any country hosting $\ge 40\%$ of active suppliers (with at least 3 suppliers total).
- **Critical Component Monopoly:** Any country that is the sole supplier nation of a critical component SKU.
- **Visual Encoding:**
  - Polygon fill: Graduated cyan based on supplier count.
  - Flagged polygon fill: Elevated amber translucent tint with orange border and higher 3D altitude.
  - Hover tooltip: Breakdown of active suppliers, open purchase order quantities, and flagged reason.

---

## 5. Security & Safety Controls

1. **XSS Protection:** Vendor and facility names from uploaded CSV files are strictly sanitized using `escapeHtml()` before embedding into Three.js HTML tooltips, SVG markers, or detail panels.
2. **Decision-Support Guardrail:** The system **never** places real purchase orders, re-routes shipments, or contacts live SAP servers. All visualized routes are analytical models derived from open purchase order lines.
3. **Database Immutability:** `backend/sentinel.db` remains 100% read-only with an invariant SHA-256 hash (`0f84999d5149a8780fe7797cb5d5eb2fb6d815b73a0efe782568fed5740e73a1`).
4. **Override Gating:** Manual location updates are gated behind `ENABLE_WEB_IMPORT=1` and stored strictly in JSON files isolated by active dataset signature.

---

## 6. Accessibility & WebGL Fallback
If the user's browser or device does not support WebGL hardware acceleration:
- WebGL detection automatically identifies missing contexts (`isWebGLSupported()`).
- The page seamlessly switches to `GlobeListFallback`, presenting all suppliers, warehouses, coordinates, and open order pipelines in an accessible, sortable table.
- Users can toggle between the 3D Globe and Locations List at any time using the top floating view switcher.
- Respects `prefers-reduced-motion`: Disables smooth camera animation pans and point pulsing when the operating system requests reduced motion.
