"""app/services/globe.py

Service orchestrator for geographic data resolution, supply routes extraction,
country concentration analysis, and override persistence.
Composes existing queries and pure domain calculations.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timezone
import json
import logging
import os
from pathlib import Path
import tempfile
from typing import Any, Dict, List, Optional, Set, Tuple

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.core.config import Settings, get_settings
from app.db.models import (
    Component,
    DatasetMeta,
    InventoryLevel,
    PurchaseOrder,
    PurchaseOrderLine,
    Supplier,
    SupplierComponent,
    Warehouse,
)
from app.domain.geo import (
    compute_concentration,
    resolve_location,
    validate_lat_lon,
)
from app.services.supplier_risk import (
    build_supplier_risk_config,
    compute_all_supplier_risk_results,
)

logger = logging.getLogger("app.services.globe")

FIXTURES_DIR = Path(__file__).resolve().parent.parent / "integrations" / "fixtures"
COUNTRY_CENTROIDS_PATH = FIXTURES_DIR / "country_centroids.json"
DEMO_LOCATIONS_PATH = FIXTURES_DIR / "demo_locations.json"
OVERRIDES_PATH: Optional[Path] = None


def _get_data_dir() -> Path:
    """Resolve backend data directory."""
    d = Path(__file__).resolve().parent.parent.parent / "data"
    d.mkdir(parents=True, exist_ok=True)
    return d


def get_overrides_file_path() -> Path:
    if OVERRIDES_PATH is not None:
        return OVERRIDES_PATH
    return _get_data_dir() / "location_overrides.json"


def load_all_overrides() -> Dict[str, Any]:
    """Safely load the entire overrides JSON file."""
    path = get_overrides_file_path()
    if not path.exists():
        return {}
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
            return data if isinstance(data, dict) else {}
    except Exception as exc:
        logger.warning("Could not read location overrides file: %s", exc)
        return {}


def get_dataset_key(meta: Optional[DatasetMeta]) -> str:
    """Consistently format dataset key from DatasetMeta label and generated_at."""
    if not meta:
        return "default|unknown"
    gen_at_str = meta.generated_at.isoformat() if hasattr(meta.generated_at, "isoformat") else str(meta.generated_at)
    return f"{meta.label}|{gen_at_str}"


def load_dataset_overrides(dataset_key: str) -> Dict[str, Any]:
    """Load overrides scoped to a specific dataset key f'{label}|{generated_at}'."""
    all_ov = load_all_overrides()
    ds_ov = all_ov.get(dataset_key, {})
    return ds_ov if isinstance(ds_ov, dict) else {}


def save_location_override(
    dataset_key: str,
    entity_type: str,  # "supplier" | "warehouse"
    code: str,
    lat: Optional[float] = None,
    lon: Optional[float] = None,
    note: Optional[str] = None,
    clear: bool = False,
) -> Dict[str, Any]:
    """Atomic write for a location override scoped strictly by dataset key.

    Does not modify any database table.
    """
    path = get_overrides_file_path()
    all_ov = load_all_overrides()

    if dataset_key not in all_ov:
        all_ov[dataset_key] = {"supplier": {}, "warehouse": {}}

    ds_ov = all_ov[dataset_key]
    if "supplier" not in ds_ov:
        ds_ov["supplier"] = {}
    if "warehouse" not in ds_ov:
        ds_ov["warehouse"] = {}

    type_key = entity_type.lower()
    clean_code = str(code).strip()

    if clear:
        ds_ov[type_key].pop(clean_code, None)
    else:
        ds_ov[type_key][clean_code] = {
            "lat": float(lat) if lat is not None else None,
            "lon": float(lon) if lon is not None else None,
            "note": str(note)[:200] if note else None,
            "saved_at": datetime.now(timezone.utc).isoformat(),
        }

    # Atomic write via temp file in same directory + os.replace
    dir_path = path.parent
    dir_path.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", dir=dir_path, delete=False, encoding="utf-8") as tf:
        json.dump(all_ov, tf, indent=2)
        temp_name = tf.name

    os.replace(temp_name, path)
    return ds_ov[type_key].get(clean_code, {})


def load_country_centroids() -> List[Dict[str, Any]]:
    if not COUNTRY_CENTROIDS_PATH.exists():
        return []
    try:
        with open(COUNTRY_CENTROIDS_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as exc:
        logger.warning("Could not read country centroids fixture: %s", exc)
        return []


def load_demo_locations() -> Dict[str, Any]:
    if not DEMO_LOCATIONS_PATH.exists():
        return {}
    try:
        with open(DEMO_LOCATIONS_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as exc:
        logger.warning("Could not read demo locations fixture: %s", exc)
        return {}


def load_location_overrides() -> Dict[str, Any]:
    """Alias for loading all location overrides."""
    return load_all_overrides()


def get_globe_data(session: Session, settings: Optional[Settings] = None) -> Dict[str, Any]:
    """Top-level accessor for globe data with optional settings fallback."""
    if settings is None:
        settings = get_settings()
    return build_globe_data(session, settings)


def build_globe_data(session: Session, settings: Settings) -> Dict[str, Any]:
    """Compose complete supply chain globe visualization data."""
    meta = session.scalar(select(DatasetMeta).order_by(DatasetMeta.id.desc()).limit(1))
    if meta is None:
        return {
            "seeded": False,
            "as_of": None,
            "dataset": None,
            "suppliers": [],
            "warehouses": [],
            "routes": [],
            "concentration": [],
            "unresolved": [],
            "coverage": {
                "suppliers_total": 0,
                "suppliers_mapped": 0,
                "suppliers_unresolved": 0,
                "warehouses_total": 0,
                "warehouses_mapped": 0,
                "warehouses_unresolved": 0,
                "approximate_count": 0,
            },
            "config": {
                "concentration_min_suppliers": settings.GLOBE_CONCENTRATION_MIN_SUPPLIERS,
                "concentration_share": settings.GLOBE_CONCENTRATION_SHARE,
            },
            "notes": ["Database is not seeded yet."],
        }

    as_of = meta.as_of
    gen_at_str = meta.generated_at.isoformat() if hasattr(meta.generated_at, "isoformat") else str(meta.generated_at)
    dataset_key = f"{meta.label}|{gen_at_str}"
    active_dataset = getattr(session, "info", {}).get("active_dataset", "demo")

    overrides = load_dataset_overrides(dataset_key)
    country_centroids = load_country_centroids()
    demo_locations = load_demo_locations()

    # Load entities
    suppliers = session.scalars(select(Supplier).order_by(Supplier.code)).all()
    warehouses = session.scalars(select(Warehouse).order_by(Warehouse.code)).all()
    components = session.scalars(select(Component)).all()
    comp_map = {c.id: c for c in components}
    comp_criticalities = {c.sku: c.criticality for c in components}

    # Load supplier components
    offers = session.scalars(
        select(SupplierComponent)
        .options(selectinload(SupplierComponent.component), selectinload(SupplierComponent.supplier))
    ).all()
    supp_offers_by_supp: Dict[int, List[Dict[str, str]]] = defaultdict(list)
    offers_by_comp_sku: Dict[str, Set[str]] = defaultdict(set)
    for off in offers:
        c_sku = off.component.sku
        s_code = off.supplier.code
        supp_offers_by_supp[off.supplier_id].append({"sku": c_sku, "name": off.component.name})
        offers_by_comp_sku[c_sku].add(s_code)

    # Compute supplier risk results via existing supplier_risk service
    risk_cfg = build_supplier_risk_config(settings)
    risk_results = compute_all_supplier_risk_results(session, as_of, suppliers, risk_cfg)

    # Resolve suppliers
    resolved_suppliers: List[Dict[str, Any]] = []
    unresolved_list: List[Dict[str, Any]] = []
    approx_count = 0

    for s in suppliers:
        loc_res = resolve_location(
            entity_type="supplier",
            code=s.code,
            country_text=s.country,
            overrides=overrides,
            fixtures=demo_locations,
            country_centroids=country_centroids,
        )

        r_item = risk_results.get(s.id)
        band = r_item.risk_band if r_item else "unknown"
        score = r_item.risk_score if r_item else None
        ot_rate = r_item.on_time_rate if r_item else None
        n_delivs = r_item.n_deliveries if r_item else 0
        conf = r_item.confidence if r_item else "low"
        open_po_c = r_item.informational_po.open_po_count if r_item else 0
        slipped_po_c = r_item.informational_po.open_pos_slipped_count if r_item else 0
        overdue_po_c = r_item.informational_po.open_pos_overdue_count if r_item else 0
        rem_qty = float(r_item.informational_po.open_remaining_qty) if r_item else 0.0

        loc_dict = None
        if loc_res.precision != "unresolved" and loc_res.lat is not None and loc_res.lon is not None:
            loc_dict = {
                "lat": loc_res.lat,
                "lon": loc_res.lon,
                "precision": loc_res.precision,
                "source": loc_res.source,
                "country_code": loc_res.country_code or s.country,
                "label": loc_res.label,
            }
            if loc_res.precision == "country_centroid":
                approx_count += 1
        else:
            unresolved_list.append(
                {
                    "entity_type": "supplier",
                    "code": s.code,
                    "name": s.name,
                    "reason": loc_res.source,
                }
            )

        resolved_suppliers.append(
            {
                "code": s.code,
                "id": s.id,
                "name": s.name,
                "country": s.country,
                "location": loc_dict,
                "risk_band": band,
                "risk_score": score,
                "on_time_rate": ot_rate,
                "n_deliveries": n_delivs,
                "confidence": conf,
                "components": supp_offers_by_supp.get(s.id, []),
                "open_po_count": open_po_c,
                "overdue_po_count": overdue_po_c,
                "slipped_po_count": slipped_po_c,
                "remaining_qty": rem_qty,
            }
        )

    # Resolve warehouses with inventory summaries
    wh_inv_levels = session.scalars(select(InventoryLevel)).all()
    inv_by_wh: Dict[int, List[InventoryLevel]] = defaultdict(list)
    for inv in wh_inv_levels:
        inv_by_wh[inv.warehouse_id].append(inv)

    resolved_warehouses: List[Dict[str, Any]] = []
    for w in warehouses:
        loc_res = resolve_location(
            entity_type="warehouse",
            code=w.code,
            country_text=None,
            overrides=overrides,
            fixtures=demo_locations,
            country_centroids=country_centroids,
        )

        w_levels = inv_by_wh.get(w.id, [])
        total_oh = sum(lv.on_hand for lv in w_levels)
        comps_held = len(w_levels)
        zero_usable = sum(1 for lv in w_levels if (lv.on_hand - lv.reserved) <= 0)

        loc_dict = None
        if loc_res.precision != "unresolved" and loc_res.lat is not None and loc_res.lon is not None:
            loc_dict = {
                "lat": loc_res.lat,
                "lon": loc_res.lon,
                "precision": loc_res.precision,
                "source": loc_res.source,
                "country_code": loc_res.country_code,
                "label": loc_res.label,
            }
            if loc_res.precision == "country_centroid":
                approx_count += 1
        else:
            unresolved_list.append(
                {
                    "entity_type": "warehouse",
                    "code": w.code,
                    "name": w.name,
                    "reason": loc_res.source,
                }
            )

        resolved_warehouses.append(
            {
                "code": w.code,
                "id": w.id,
                "name": w.name,
                "role": w.role,
                "location": loc_dict,
                "inventory_summary": {
                    "components_held": comps_held,
                    "total_on_hand": total_oh,
                    "zero_usable_components_count": zero_usable,
                },
            }
        )

    # Extract routes from active PO lines:
    # A route exists ONLY for (supplier, warehouse) pairs appearing on an open/in_transit/partially_received PO line
    open_statuses = {"open", "in_transit", "partially_received"}
    active_pos = session.scalars(
        select(PurchaseOrder)
        .options(selectinload(PurchaseOrder.lines).selectinload(PurchaseOrderLine.warehouse), selectinload(PurchaseOrder.supplier))
        .where(PurchaseOrder.status.in_(open_statuses))
    ).all()

    routes_map: Dict[Tuple[str, str], Dict[str, Any]] = {}

    for po in active_pos:
        s_code = po.supplier.code
        # Check if PO is overdue or slipped
        exp_date = po.latest_estimate_date or po.promised_date
        is_overdue = exp_date < as_of
        is_slipped = po.latest_estimate_date is not None and po.latest_estimate_date > po.promised_date

        for line in po.lines:
            rem = max(0, line.qty_ordered - line.qty_received)
            if rem <= 0:
                continue
            w_code = line.warehouse.code
            pair = (s_code, w_code)

            if pair not in routes_map:
                routes_map[pair] = {
                    "supplier_code": s_code,
                    "warehouse_code": w_code,
                    "po_numbers": set(),
                    "open_po_count": 0,
                    "remaining_qty": 0.0,
                    "any_overdue": False,
                    "any_slipped": False,
                    "label": "Estimated route - not live shipment tracking",
                }

            routes_map[pair]["po_numbers"].add(po.po_number)
            routes_map[pair]["remaining_qty"] += rem
            if is_overdue:
                routes_map[pair]["any_overdue"] = True
            if is_slipped:
                routes_map[pair]["any_slipped"] = True

    # Finalize routes count and convert po_numbers set to sorted list
    final_routes = []
    for pair, r_data in routes_map.items():
        r_data["open_po_count"] = len(r_data["po_numbers"])
        r_data["po_numbers"] = sorted(r_data["po_numbers"])
        final_routes.append(r_data)
    final_routes.sort(key=lambda r: (r["supplier_code"], r["warehouse_code"]))

    # Country concentration analysis
    concentration_items = compute_concentration(
        suppliers_resolved=resolved_suppliers,
        supplier_component_offers=offers_by_comp_sku,
        component_criticalities=comp_criticalities,
        min_suppliers=settings.GLOBE_CONCENTRATION_MIN_SUPPLIERS,
        min_share=settings.GLOBE_CONCENTRATION_SHARE,
    )
    concentration_dicts = [
        {
            "country_code": ci.country_code,
            "country_name": ci.country_name,
            "supplier_count": ci.supplier_count,
            "risk_distribution": ci.risk_distribution,
            "high_risk_suppliers": ci.high_risk_suppliers,
            "single_country_components": ci.single_country_components,
            "open_po_count": ci.open_po_count,
            "remaining_qty": ci.remaining_qty,
            "flagged": ci.flagged,
            "reason": ci.reason,
        }
        for ci in concentration_items
    ]

    mapped_supps = sum(1 for s in resolved_suppliers if s["location"] is not None)
    mapped_whs = sum(1 for w in resolved_warehouses if w["location"] is not None)

    return {
        "seeded": True,
        "as_of": as_of.isoformat(),
        "dataset": {
            "label": meta.label,
            "source": meta.source,
            "active_dataset": active_dataset,
            "generated_at": gen_at_str,
            "is_live": False,
        },
        "suppliers": resolved_suppliers,
        "warehouses": resolved_warehouses,
        "routes": final_routes,
        "concentration": concentration_dicts,
        "unresolved": unresolved_list,
        "coverage": {
            "suppliers_total": len(resolved_suppliers),
            "suppliers_mapped": mapped_supps,
            "suppliers_unresolved": len(resolved_suppliers) - mapped_supps,
            "warehouses_total": len(resolved_warehouses),
            "warehouses_mapped": mapped_whs,
            "warehouses_unresolved": len(resolved_warehouses) - mapped_whs,
            "approximate_count": approx_count,
        },
        "config": {
            "concentration_min_suppliers": settings.GLOBE_CONCENTRATION_MIN_SUPPLIERS,
            "concentration_share": settings.GLOBE_CONCENTRATION_SHARE,
        },
        "notes": [
            "Decision support only. No real purchase orders or live ERP writes.",
            "All geographic locations are illustrative demo coordinates or user-configured overrides; no live GPS tracking is used.",
            "Routes reflect planned purchase order destination warehouses, not real-time shipment paths.",
            "Supply concentration is calculated from active supplier offers and does not represent live disruption feeds.",
        ],
    }
