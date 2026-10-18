"""tests/test_sap_mapping.py

Unit tests for pure SAP-style mapping layer.
Validates illustrative entity mappings, missing optional fields, and clear error raising on invalid records.
"""

from datetime import date, datetime, timezone
from decimal import Decimal
import pytest

from app.integrations.sap_mapping import (
    SapMappingError,
    map_sap_material,
    map_sap_plant,
    map_sap_purchase_order,
    map_sap_stock,
    map_sap_supplier,
)


def test_map_sap_material_success():
    record = {
        "Material": "MAT-CPU-99",
        "MaterialDescription": "Test Processor 4.0GHz",
        "MaterialGroup": "Semiconductors",
        "BaseUnit": "EA",
        "Criticality": "critical",
    }
    dto = map_sap_material(record)
    assert dto.sku == "MAT-CPU-99"
    assert dto.name == "Test Processor 4.0GHz"
    assert dto.category == "Semiconductors"
    assert dto.unit_of_measure == "EA"
    assert dto.criticality == "critical"
    assert dto.is_active is True


def test_map_sap_material_optional_criticality_default():
    record = {
        "Material": "MAT-RES-01",
        "MaterialDescription": "Surface Mount Resistor",
        "MaterialGroup": "Passives",
        "BaseUnit": "PC",
    }
    dto = map_sap_material(record)
    assert dto.criticality == "normal"


def test_map_sap_material_missing_fields_raises():
    with pytest.raises(SapMappingError, match="Missing mandatory SAP field: 'Material'"):
        map_sap_material({"MaterialDescription": "No SKU"})

    with pytest.raises(SapMappingError, match="Missing mandatory SAP field: 'MaterialDescription'"):
        map_sap_material({"Material": "MAT-01", "MaterialGroup": "G", "BaseUnit": "EA"})


def test_map_sap_supplier_success():
    record = {
        "Supplier": "VEND-100",
        "SupplierName": "Acme Micro Ltd",
        "Country": "US",
    }
    dto = map_sap_supplier(record)
    assert dto.code == "VEND-100"
    assert dto.name == "Acme Micro Ltd"
    assert dto.country == "US"


def test_map_sap_supplier_missing_fields_raises():
    with pytest.raises(SapMappingError, match="Missing mandatory SAP field: 'Supplier'"):
        map_sap_supplier({"SupplierName": "Name", "Country": "DE"})

    with pytest.raises(SapMappingError, match="Missing mandatory SAP field: 'Country'"):
        map_sap_supplier({"Supplier": "V1", "SupplierName": "Name"})


def test_map_sap_stock_success():
    ts = datetime(2026, 10, 18, 12, 0, tzinfo=timezone.utc)
    record = {
        "Material": "MAT-CPU-99",
        "Plant": "1010",
        "StorageLocation": "0001",
        "UnrestrictedStock": 500,
        "ReservedQuantity": 45,
    }
    dto = map_sap_stock(record, as_of_ts=ts)
    assert dto.component_sku == "MAT-CPU-99"
    assert dto.warehouse_code == "1010"
    assert dto.on_hand == 500
    assert dto.reserved == 45
    assert dto.as_of_ts == ts


def test_map_sap_stock_missing_unrestricted_raises():
    with pytest.raises(SapMappingError, match="Missing mandatory SAP field: 'UnrestrictedStock'"):
        map_sap_stock({"Material": "MAT-01", "Plant": "1010"})


def test_map_sap_purchase_order_success():
    header = {
        "PurchaseOrder": "4500000001",
        "Supplier": "VEND-100",
        "PurchaseOrderDate": "2026-10-10",
        "Status": "open",
        "items": [
            {
                "Material": "MAT-CPU-99",
                "Plant": "1010",
                "OrderQuantity": 200,
                "ReceivedQuantity": 0,
                "ScheduleLineDeliveryDate": "2026-10-25",
                "NetPriceAmount": "150.00",
            }
        ],
    }
    po_dto, lines = map_sap_purchase_order(header)
    assert po_dto.po_number == "4500000001"
    assert po_dto.supplier_code == "VEND-100"
    assert po_dto.order_date == date(2026, 10, 10)
    assert po_dto.promised_date == date(2026, 10, 25)
    assert po_dto.status == "open"
    assert len(lines) == 1
    assert lines[0].component_sku == "MAT-CPU-99"
    assert lines[0].warehouse_code == "1010"
    assert lines[0].qty_ordered == 200
    assert lines[0].qty_received == 0
    assert lines[0].unit_price == Decimal("150.00")


def test_map_sap_purchase_order_empty_items_raises():
    header = {
        "PurchaseOrder": "4500000002",
        "Supplier": "VEND-100",
        "PurchaseOrderDate": "2026-10-10",
        "items": [],
    }
    with pytest.raises(SapMappingError, match="must have at least one line item"):
        map_sap_purchase_order(header)


def test_map_sap_plant_success():
    dto = map_sap_plant("1010", "Frankfurt Plant")
    assert dto.code == "1010"
    assert dto.name == "Frankfurt Plant"
    assert dto.role == "plant"
