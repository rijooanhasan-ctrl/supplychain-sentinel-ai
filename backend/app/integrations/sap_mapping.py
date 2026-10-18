"""app/integrations/sap_mapping.py

Pure mapping layer converting illustrative SAP-style OData/BAPI dictionary records
into standardized SourceDataset domain DTOs.

DISCLAIMER & INTEGRATION HONESTY:
The field names used in this module (e.g. Material, MaterialDescription, MaterialGroup,
BaseUnit, Plant, UnrestrictedStock, PurchaseOrder, Supplier, ScheduleLineDeliveryDate)
are strictly ILLUSTRATIVE conceptual representations inspired by common SAP S/4HANA
OData service structures (such as API_MATERIAL_DOCUMENT_SRV, API_PURCHASEORDER_PROCESS_SRV,
and A_Product).

They DO NOT represent a verified or active connection to any live SAP instance.
Before production use with an enterprise SAP system, all entity schemas and property
names MUST be verified against the official SAP Business Accelerator Hub
(https://api.sap.com) and the specific target system's metadata document ($metadata).
"""

from __future__ import annotations

from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Any, Dict, List, Optional, Tuple

from app.integrations.base import (
    ComponentDTO,
    InventoryLevelDTO,
    PurchaseOrderDTO,
    PurchaseOrderLineDTO,
    SupplierDTO,
    WarehouseDTO,
)


class SapMappingError(ValueError):
    """Raised when an illustrative SAP record cannot be mapped due to missing or invalid data."""
    pass


def map_sap_material(record: Dict[str, Any]) -> ComponentDTO:
    """Map an illustrative SAP Material Master record to ComponentDTO.

    Expected illustrative fields:
    - Material (str, mandatory): Material code / SKU
    - MaterialDescription (str, mandatory): Plain description
    - MaterialGroup (str, mandatory): Category / classification
    - BaseUnit (str, mandatory): Unit of measure (e.g. EA, PC)
    - Criticality (str, optional): Default 'normal'
    """
    if not isinstance(record, dict):
        raise SapMappingError("Material record must be a dictionary.")

    sku = str(record.get("Material") or "").strip()
    if not sku:
        raise SapMappingError("Missing mandatory SAP field: 'Material' (Material SKU).")

    desc = str(record.get("MaterialDescription") or "").strip()
    if not desc:
        raise SapMappingError(f"Missing mandatory SAP field: 'MaterialDescription' for material '{sku}'.")

    group = str(record.get("MaterialGroup") or "").strip()
    if not group:
        raise SapMappingError(f"Missing mandatory SAP field: 'MaterialGroup' for material '{sku}'.")

    uom = str(record.get("BaseUnit") or "").strip()
    if not uom:
        raise SapMappingError(f"Missing mandatory SAP field: 'BaseUnit' for material '{sku}'.")

    crit_raw = str(record.get("Criticality") or "normal").strip().lower()
    if crit_raw in ("critical", "high"):
        criticality = crit_raw
    else:
        criticality = "normal"

    return ComponentDTO(
        sku=sku,
        name=desc,
        category=group,
        unit_of_measure=uom,
        criticality=criticality,
        is_active=True,
    )


def map_sap_supplier(record: Dict[str, Any]) -> SupplierDTO:
    """Map an illustrative SAP Supplier record to SupplierDTO.

    Expected illustrative fields:
    - Supplier (str, mandatory): Vendor / Supplier account number
    - SupplierName (str, mandatory): Supplier business name
    - Country (str, mandatory): 2-letter ISO country code
    """
    if not isinstance(record, dict):
        raise SapMappingError("Supplier record must be a dictionary.")

    code = str(record.get("Supplier") or "").strip()
    if not code:
        raise SapMappingError("Missing mandatory SAP field: 'Supplier' (Vendor code).")

    name = str(record.get("SupplierName") or "").strip()
    if not name:
        raise SapMappingError(f"Missing mandatory SAP field: 'SupplierName' for supplier '{code}'.")

    country = str(record.get("Country") or "").strip().upper()
    if not country:
        raise SapMappingError(f"Missing mandatory SAP field: 'Country' for supplier '{code}'.")

    return SupplierDTO(
        code=code,
        name=name,
        country=country,
    )


def map_sap_stock(record: Dict[str, Any], as_of_ts: Optional[datetime] = None) -> InventoryLevelDTO:
    """Map an illustrative SAP Stock (Material / Plant / StorageLocation) record to InventoryLevelDTO.

    Expected illustrative fields:
    - Material (str, mandatory): Material SKU
    - Plant (str, mandatory): Plant / Warehouse code
    - UnrestrictedStock (numeric, mandatory): Usable on-hand stock
    - ReservedQuantity (numeric, optional): Reserved stock (defaults to 0)
    """
    if not isinstance(record, dict):
        raise SapMappingError("Stock record must be a dictionary.")

    material = str(record.get("Material") or "").strip()
    if not material:
        raise SapMappingError("Missing mandatory SAP field: 'Material' in stock record.")

    plant = str(record.get("Plant") or "").strip()
    if not plant:
        raise SapMappingError(f"Missing mandatory SAP field: 'Plant' for material '{material}'.")

    unrestricted = record.get("UnrestrictedStock")
    if unrestricted is None:
        raise SapMappingError(f"Missing mandatory SAP field: 'UnrestrictedStock' for material '{material}'.")
    try:
        on_hand = int(unrestricted)
    except (ValueError, TypeError) as exc:
        raise SapMappingError(f"Invalid 'UnrestrictedStock' value: {unrestricted}") from exc

    reserved_raw = record.get("ReservedQuantity", 0)
    try:
        reserved = int(reserved_raw) if reserved_raw is not None else 0
    except (ValueError, TypeError) as exc:
        raise SapMappingError(f"Invalid 'ReservedQuantity' value: {reserved_raw}") from exc

    ts = as_of_ts or datetime.now(timezone.utc)

    return InventoryLevelDTO(
        component_sku=material,
        warehouse_code=plant,
        on_hand=on_hand,
        reserved=reserved,
        as_of_ts=ts,
    )


def map_sap_purchase_order(
    header: Dict[str, Any],
    items: Optional[List[Dict[str, Any]]] = None,
) -> Tuple[PurchaseOrderDTO, List[PurchaseOrderLineDTO]]:
    """Map an illustrative SAP Purchase Order header and items to PurchaseOrderDTO and lines.

    Expected illustrative fields:
    Header:
    - PurchaseOrder (str, mandatory): PO document number
    - Supplier (str, mandatory): Vendor code
    - PurchaseOrderDate (str/date, mandatory): Order creation date (YYYY-MM-DD)
    - Status (str, optional): Open | In_Transit | Partially_Received | Received
    Items (can be provided as list or inside header['items']):
    - Material (str, mandatory): Material SKU
    - Plant (str, mandatory): Receiving plant
    - OrderQuantity (numeric, mandatory): Ordered quantity
    - ReceivedQuantity (numeric, optional): Received quantity
    - ScheduleLineDeliveryDate (str/date, optional): Promised delivery date
    - NetPriceAmount (numeric, optional): Unit price
    """
    if not isinstance(header, dict):
        raise SapMappingError("Purchase order header must be a dictionary.")

    po_number = str(header.get("PurchaseOrder") or "").strip()
    if not po_number:
        raise SapMappingError("Missing mandatory SAP field: 'PurchaseOrder' (PO number).")

    supplier_code = str(header.get("Supplier") or "").strip()
    if not supplier_code:
        raise SapMappingError(f"Missing mandatory SAP field: 'Supplier' on PO '{po_number}'.")

    order_date_raw = header.get("PurchaseOrderDate")
    if not order_date_raw:
        raise SapMappingError(f"Missing mandatory SAP field: 'PurchaseOrderDate' on PO '{po_number}'.")
    if isinstance(order_date_raw, date):
        order_date = order_date_raw
    else:
        try:
            order_date = datetime.strptime(str(order_date_raw).strip(), "%Y-%m-%d").date()
        except ValueError as exc:
            raise SapMappingError(f"Invalid date format for 'PurchaseOrderDate' on PO '{po_number}': {order_date_raw}") from exc

    # Parse items
    raw_items = items if items is not None else header.get("items", [])
    if not raw_items:
        raise SapMappingError(f"PO '{po_number}' must have at least one line item.")

    po_lines: List[PurchaseOrderLineDTO] = []
    earliest_delivery: Optional[date] = None

    for idx, item in enumerate(raw_items, start=1):
        if not isinstance(item, dict):
            raise SapMappingError(f"Item #{idx} on PO '{po_number}' must be a dictionary.")

        mat = str(item.get("Material") or "").strip()
        if not mat:
            raise SapMappingError(f"Missing 'Material' on line #{idx} of PO '{po_number}'.")

        plant = str(item.get("Plant") or "").strip()
        if not plant:
            raise SapMappingError(f"Missing 'Plant' on line #{idx} of PO '{po_number}'.")

        qty_ord = item.get("OrderQuantity")
        if qty_ord is None:
            raise SapMappingError(f"Missing 'OrderQuantity' on line #{idx} of PO '{po_number}'.")
        try:
            qty_ordered = int(qty_ord)
        except (ValueError, TypeError) as exc:
            raise SapMappingError(f"Invalid 'OrderQuantity' on line #{idx} of PO '{po_number}': {qty_ord}") from exc

        qty_rec_raw = item.get("ReceivedQuantity", 0)
        try:
            qty_received = int(qty_rec_raw) if qty_rec_raw is not None else 0
        except (ValueError, TypeError) as exc:
            raise SapMappingError(f"Invalid 'ReceivedQuantity' on line #{idx} of PO '{po_number}': {qty_rec_raw}") from exc

        price_raw = item.get("NetPriceAmount", "0.00")
        try:
            unit_price = Decimal(str(price_raw))
        except Exception:
            unit_price = Decimal("0.00")

        # Delivery date on schedule line
        deliv_raw = item.get("ScheduleLineDeliveryDate")
        if deliv_raw:
            if isinstance(deliv_raw, date):
                d_date = deliv_raw
            else:
                try:
                    d_date = datetime.strptime(str(deliv_raw).strip(), "%Y-%m-%d").date()
                except ValueError:
                    d_date = None
            if d_date:
                if earliest_delivery is None or d_date < earliest_delivery:
                    earliest_delivery = d_date

        po_lines.append(
            PurchaseOrderLineDTO(
                component_sku=mat,
                warehouse_code=plant,
                qty_ordered=qty_ordered,
                qty_received=qty_received,
                unit_price=unit_price,
            )
        )

    promised_date = earliest_delivery or order_date

    # Determine status if not explicitly given
    explicit_status = str(header.get("Status") or "").strip().lower()
    if explicit_status in ("open", "in_transit", "partially_received", "received", "cancelled"):
        status = explicit_status
    else:
        tot_ordered = sum(l.qty_ordered for l in po_lines)
        tot_received = sum(l.qty_received for l in po_lines)
        if tot_received == 0:
            status = "open"
        elif tot_received >= tot_ordered:
            status = "received"
        else:
            status = "partially_received"

    po_dto = PurchaseOrderDTO(
        po_number=po_number,
        supplier_code=supplier_code,
        status=status,
        order_date=order_date,
        promised_date=promised_date,
        latest_estimate_date=None,
        lines=po_lines,
    )

    return po_dto, po_lines


def map_sap_plant(plant_code: str, plant_name: str) -> WarehouseDTO:
    """Map an illustrative SAP Plant code to WarehouseDTO."""
    code = str(plant_code).strip()
    if not code:
        raise SapMappingError("Plant code cannot be empty.")
    name = str(plant_name or f"Plant {code}").strip()
    return WarehouseDTO(
        code=code,
        name=name,
        role="plant",
    )
