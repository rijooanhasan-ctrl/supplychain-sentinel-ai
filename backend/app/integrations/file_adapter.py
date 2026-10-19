"""app/integrations/file_adapter.py

File-based SourceAdapter for user-supplied CSV data import.
Validates all CSV schemas, constraints, foreign keys, and business rules,
and packages valid data into a SourceDataset.
"""

from __future__ import annotations

import csv
from datetime import date, datetime, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

from app.integrations.base import (
    BomLineDTO,
    ComponentDTO,
    CustomerOrderDTO,
    DatasetMetaDTO,
    DeliveryRecordDTO,
    DemandRecordDTO,
    InventoryLevelDTO,
    ProductDTO,
    PurchaseOrderDTO,
    PurchaseOrderLineDTO,
    SourceAdapter,
    SourceDataset,
    SupplierComponentDTO,
    SupplierDTO,
    WarehouseDTO,
)
from app.integrations.csv_schema import (
    ALL_CSV_FILES,
    CSV_COLUMNS,
    NULLABLE_COLUMNS,
    OPTIONAL_FILES,
    REQUIRED_FILES,
)

MAX_ERRORS = 50


def parse_bool(val: str) -> Optional[bool]:
    v = val.strip().lower()
    if v in ("true", "1", "yes", "t"):
        return True
    if v in ("false", "0", "no", "f"):
        return False
    return None


class FileAdapter(SourceAdapter):
    """Adapter reading user-supplied CSV files from a directory."""

    name: str = "file-import"
    is_live: bool = False
    label: str = "USER-SUPPLIED DATA (file import)"

    def __init__(self, path: Path | str, as_of: date) -> None:
        self.path = Path(path)
        self.as_of = as_of
        self._parsed_raw: Dict[str, List[Tuple[int, Dict[str, str]]]] = {}
        self._errors: List[str] = []
        self._warnings: List[str] = []
        self._validated = False

    def _add_error(self, msg: str) -> bool:
        """Add an error if under MAX_ERRORS limit. Returns True if cap reached."""
        if len(self._errors) < MAX_ERRORS:
            self._errors.append(msg)
        if len(self._errors) >= MAX_ERRORS:
            if len(self._errors) == MAX_ERRORS:
                self._errors.append(f"Reached maximum limit of {MAX_ERRORS} validation errors. Halting further reporting.")
            return True
        return False

    def validate(self) -> Tuple[List[str], List[str]]:
        """Validate all present CSV files and cross-table references.

        Returns (errors, warnings).
        """
        if self._validated:
            return self._errors, self._warnings

        self._errors = []
        self._warnings = []
        self._parsed_raw = {}

        if not self.path.exists() or not self.path.is_dir():
            self._add_error(f"Directory does not exist: {self.path}")
            self._validated = True
            return self._errors, self._warnings

        # Check required files
        for req_file in REQUIRED_FILES:
            file_path = self.path / req_file
            if not file_path.exists():
                if self._add_error(f"Missing required file: {req_file}"):
                    self._validated = True
                    return self._errors, self._warnings

        # Read and check syntax/columns for all present files
        for filename in ALL_CSV_FILES:
            file_path = self.path / filename
            if not file_path.exists():
                continue

            try:
                with open(file_path, "r", encoding="utf-8-sig", newline="") as f:
                    reader = csv.reader(f)
                    try:
                        header = next(reader)
                    except StopIteration:
                        if self._add_error(f"{filename}: line 1: File is empty (missing header row)"):
                            break
                        continue

                    # Strip whitespace from headers
                    header = [c.strip() for c in header]
                    expected_cols = CSV_COLUMNS[filename]
                    missing_cols = [c for c in expected_cols if c not in header]
                    if missing_cols:
                        if self._add_error(f"{filename}: line 1: Missing expected column(s): {', '.join(missing_cols)}"):
                            break
                        continue

                    rows: List[Tuple[int, Dict[str, str]]] = []
                    # Read rows with line numbers (header was line 1)
                    line_no = 1
                    for raw_row in reader:
                        line_no += 1
                        # Skip blank lines
                        if not raw_row or all(not cell.strip() for cell in raw_row):
                            continue
                        if len(raw_row) != len(header):
                            if self._add_error(
                                f"{filename}: line {line_no}: Row has {len(raw_row)} columns, expected {len(header)}"
                            ):
                                break
                            continue
                        row_dict = {header[i]: raw_row[i].strip() for i in range(len(header))}
                        rows.append((line_no, row_dict))
                    self._parsed_raw[filename] = rows
            except Exception as e:
                if self._add_error(f"{filename}: Failed to read CSV: {e}"):
                    break

        if self._errors:
            self._validated = True
            return self._errors, self._warnings

        # Validation phase: data types, non-null, duplicates, enums, FKs
        self._validate_warehouses()
        self._validate_components()
        self._validate_suppliers()
        self._validate_inventory()
        self._validate_products()
        self._validate_bom()
        self._validate_supplier_offers()
        self._validate_purchase_orders()
        self._validate_customer_orders()
        self._validate_demand_history()
        self._validate_delivery_history()

        self._validated = True
        return self._errors, self._warnings

    def _validate_warehouses(self) -> None:
        filename = "warehouses.csv"
        rows = self._parsed_raw.get(filename, [])
        codes_seen: Set[str] = set()
        plant_count = 0

        for line_no, row in rows:
            code = row.get("code", "")
            name = row.get("name", "")
            role = row.get("role", "")

            if not code:
                if self._add_error(f"{filename}: line {line_no}: 'code' cannot be empty"):
                    return
            elif code in codes_seen:
                if self._add_error(f"{filename}: line {line_no}: Duplicate warehouse code '{code}'"):
                    return
            codes_seen.add(code)

            if not name:
                if self._add_error(f"{filename}: line {line_no}: 'name' cannot be empty"):
                    return

            if role not in ("plant", "regional"):
                if self._add_error(f"{filename}: line {line_no}: Invalid role '{role}'. Must be 'plant' or 'regional'"):
                    return
            elif role == "plant":
                plant_count += 1

        if plant_count == 0:
            if self._add_error(f"{filename}: At least one warehouse with role 'plant' is required for production consumption (found 0)"):
                return
        elif plant_count > 1:
            if self._add_error(f"{filename}: Exactly one warehouse with role 'plant' is required for production consumption (found {plant_count})"):
                return

    def _validate_components(self) -> None:
        filename = "components.csv"
        rows = self._parsed_raw.get(filename, [])
        skus_seen: Set[str] = set()

        for line_no, row in rows:
            sku = row.get("sku", "")
            name = row.get("name", "")
            category = row.get("category", "")
            uom = row.get("unit_of_measure", "")
            criticality = row.get("criticality", "")
            is_active_str = row.get("is_active", "")

            if not sku:
                if self._add_error(f"{filename}: line {line_no}: 'sku' cannot be empty"):
                    return
            elif sku in skus_seen:
                if self._add_error(f"{filename}: line {line_no}: Duplicate component SKU '{sku}'"):
                    return
            skus_seen.add(sku)

            if not name:
                if self._add_error(f"{filename}: line {line_no}: 'name' cannot be empty"):
                    return
            if not category:
                if self._add_error(f"{filename}: line {line_no}: 'category' cannot be empty"):
                    return
            if not uom:
                if self._add_error(f"{filename}: line {line_no}: 'unit_of_measure' cannot be empty"):
                    return

            if criticality not in ("critical", "high", "normal"):
                if self._add_error(
                    f"{filename}: line {line_no}: Invalid criticality '{criticality}'. Must be 'critical', 'high', or 'normal'"
                ):
                    return

            if parse_bool(is_active_str) is None:
                if self._add_error(
                    f"{filename}: line {line_no}: Invalid boolean value for 'is_active': '{is_active_str}' (expected true/false)"
                ):
                    return

    def _validate_suppliers(self) -> None:
        filename = "suppliers.csv"
        rows = self._parsed_raw.get(filename, [])
        codes_seen: Set[str] = set()

        for line_no, row in rows:
            code = row.get("code", "")
            name = row.get("name", "")
            country = row.get("country", "")

            if not code:
                if self._add_error(f"{filename}: line {line_no}: 'code' cannot be empty"):
                    return
            elif code in codes_seen:
                if self._add_error(f"{filename}: line {line_no}: Duplicate supplier code '{code}'"):
                    return
            codes_seen.add(code)

            if not name:
                if self._add_error(f"{filename}: line {line_no}: 'name' cannot be empty"):
                    return
            if not country:
                if self._add_error(f"{filename}: line {line_no}: 'country' cannot be empty"):
                    return

    def _get_known_components(self) -> Set[str]:
        return {r.get("sku", "") for _, r in self._parsed_raw.get("components.csv", []) if r.get("sku")}

    def _get_known_warehouses(self) -> Set[str]:
        return {r.get("code", "") for _, r in self._parsed_raw.get("warehouses.csv", []) if r.get("code")}

    def _get_known_suppliers(self) -> Set[str]:
        return {r.get("code", "") for _, r in self._parsed_raw.get("suppliers.csv", []) if r.get("code")}

    def _get_known_products(self) -> Set[str]:
        return {r.get("sku", "") for _, r in self._parsed_raw.get("products.csv", []) if r.get("sku")}

    def _validate_inventory(self) -> None:
        filename = "inventory.csv"
        rows = self._parsed_raw.get(filename, [])
        pairs_seen: Set[Tuple[str, str]] = set()
        known_components = self._get_known_components()
        known_warehouses = self._get_known_warehouses()

        for line_no, row in rows:
            comp_sku = row.get("component_sku", "")
            wh_code = row.get("warehouse_code", "")
            on_hand_str = row.get("on_hand", "")
            reserved_str = row.get("reserved", "")

            if not comp_sku:
                if self._add_error(f"{filename}: line {line_no}: 'component_sku' cannot be empty"):
                    return
            elif comp_sku not in known_components:
                if self._add_error(f"{filename}: line {line_no}: Unknown component SKU '{comp_sku}' (not found in components.csv)"):
                    return

            if not wh_code:
                if self._add_error(f"{filename}: line {line_no}: 'warehouse_code' cannot be empty"):
                    return
            elif wh_code not in known_warehouses:
                if self._add_error(f"{filename}: line {line_no}: Unknown warehouse code '{wh_code}' (not found in warehouses.csv)"):
                    return

            pair = (comp_sku, wh_code)
            if pair in pairs_seen:
                if self._add_error(
                    f"{filename}: line {line_no}: Duplicate inventory entry for component '{comp_sku}' and warehouse '{wh_code}'"
                ):
                    return
            pairs_seen.add(pair)

            try:
                on_hand = int(on_hand_str)
                if on_hand < 0:
                    if self._add_error(f"{filename}: line {line_no}: 'on_hand' cannot be negative ({on_hand})"):
                        return
            except ValueError:
                if self._add_error(f"{filename}: line {line_no}: Invalid integer for 'on_hand': '{on_hand_str}'"):
                    return

            try:
                reserved = int(reserved_str)
                if reserved < 0:
                    if self._add_error(f"{filename}: line {line_no}: 'reserved' cannot be negative ({reserved})"):
                        return
            except ValueError:
                if self._add_error(f"{filename}: line {line_no}: Invalid integer for 'reserved': '{reserved_str}'"):
                    return

    def _validate_products(self) -> None:
        filename = "products.csv"
        if filename not in self._parsed_raw:
            return
        rows = self._parsed_raw[filename]
        skus_seen: Set[str] = set()

        for line_no, row in rows:
            sku = row.get("sku", "")
            name = row.get("name", "")
            price_str = row.get("selling_price", "")

            if not sku:
                if self._add_error(f"{filename}: line {line_no}: 'sku' cannot be empty"):
                    return
            elif sku in skus_seen:
                if self._add_error(f"{filename}: line {line_no}: Duplicate product SKU '{sku}'"):
                    return
            skus_seen.add(sku)

            if not name:
                if self._add_error(f"{filename}: line {line_no}: 'name' cannot be empty"):
                    return

            try:
                price = Decimal(price_str)
                if price < Decimal("0"):
                    if self._add_error(f"{filename}: line {line_no}: 'selling_price' cannot be negative ({price_str})"):
                        return
            except (InvalidOperation, ValueError):
                if self._add_error(f"{filename}: line {line_no}: Invalid decimal for 'selling_price': '{price_str}'"):
                    return

    def _validate_bom(self) -> None:
        filename = "bom.csv"
        if filename not in self._parsed_raw:
            return
        rows = self._parsed_raw[filename]
        pairs_seen: Set[Tuple[str, str]] = set()
        known_products = self._get_known_products()
        known_components = self._get_known_components()

        for line_no, row in rows:
            p_sku = row.get("product_sku", "")
            c_sku = row.get("component_sku", "")
            qty_str = row.get("quantity_per_unit", "")

            if not p_sku:
                if self._add_error(f"{filename}: line {line_no}: 'product_sku' cannot be empty"):
                    return
            elif p_sku not in known_products:
                if self._add_error(f"{filename}: line {line_no}: Unknown product SKU '{p_sku}' (not found in products.csv)"):
                    return

            if not c_sku:
                if self._add_error(f"{filename}: line {line_no}: 'component_sku' cannot be empty"):
                    return
            elif c_sku not in known_components:
                if self._add_error(f"{filename}: line {line_no}: Unknown component SKU '{c_sku}' (not found in components.csv)"):
                    return

            pair = (p_sku, c_sku)
            if pair in pairs_seen:
                if self._add_error(f"{filename}: line {line_no}: Duplicate BOM entry for product '{p_sku}' and component '{c_sku}'"):
                    return
            pairs_seen.add(pair)

            try:
                qty = int(qty_str)
                if qty <= 0:
                    if self._add_error(f"{filename}: line {line_no}: 'quantity_per_unit' must be greater than 0 ({qty})"):
                        return
            except ValueError:
                if self._add_error(f"{filename}: line {line_no}: Invalid integer for 'quantity_per_unit': '{qty_str}'"):
                    return

    def _validate_supplier_offers(self) -> None:
        filename = "supplier_offers.csv"
        if filename not in self._parsed_raw:
            return
        rows = self._parsed_raw[filename]
        pairs_seen: Set[Tuple[str, str]] = set()
        known_suppliers = self._get_known_suppliers()
        known_components = self._get_known_components()

        for line_no, row in rows:
            s_code = row.get("supplier_code", "")
            c_sku = row.get("component_sku", "")
            cost_str = row.get("unit_cost", "")
            lt_str = row.get("lead_time_days", "")
            moq_str = row.get("min_order_qty", "")
            cap_str = row.get("max_weekly_capacity", "")
            pref_str = row.get("is_preferred", "")
            exp_avail_str = row.get("expedite_available", "")
            exp_lt_str = row.get("expedite_lead_time_days", "")
            exp_prem_str = row.get("expedite_cost_premium_pct", "")

            if not s_code:
                if self._add_error(f"{filename}: line {line_no}: 'supplier_code' cannot be empty"):
                    return
            elif s_code not in known_suppliers:
                if self._add_error(f"{filename}: line {line_no}: Unknown supplier code '{s_code}' (not found in suppliers.csv)"):
                    return

            if not c_sku:
                if self._add_error(f"{filename}: line {line_no}: 'component_sku' cannot be empty"):
                    return
            elif c_sku not in known_components:
                if self._add_error(f"{filename}: line {line_no}: Unknown component SKU '{c_sku}' (not found in components.csv)"):
                    return

            pair = (s_code, c_sku)
            if pair in pairs_seen:
                if self._add_error(f"{filename}: line {line_no}: Duplicate supplier offer for supplier '{s_code}' and component '{c_sku}'"):
                    return
            pairs_seen.add(pair)

            try:
                cost = Decimal(cost_str)
                if cost <= Decimal("0"):
                    if self._add_error(f"{filename}: line {line_no}: 'unit_cost' must be greater than 0 ({cost_str})"):
                        return
            except (InvalidOperation, ValueError):
                if self._add_error(f"{filename}: line {line_no}: Invalid decimal for 'unit_cost': '{cost_str}'"):
                    return

            try:
                lt = int(lt_str)
                if lt < 0:
                    if self._add_error(f"{filename}: line {line_no}: 'lead_time_days' cannot be negative ({lt})"):
                        return
            except ValueError:
                if self._add_error(f"{filename}: line {line_no}: Invalid integer for 'lead_time_days': '{lt_str}'"):
                    return

            try:
                moq = int(moq_str)
                if moq < 1:
                    if self._add_error(f"{filename}: line {line_no}: 'min_order_qty' must be at least 1 ({moq})"):
                        return
            except ValueError:
                if self._add_error(f"{filename}: line {line_no}: Invalid integer for 'min_order_qty': '{moq_str}'"):
                    return

            if cap_str:
                try:
                    cap = int(cap_str)
                    if cap < 0:
                        if self._add_error(f"{filename}: line {line_no}: 'max_weekly_capacity' cannot be negative ({cap})"):
                            return
                except ValueError:
                    if self._add_error(f"{filename}: line {line_no}: Invalid integer for 'max_weekly_capacity': '{cap_str}'"):
                        return

            if parse_bool(pref_str) is None:
                if self._add_error(f"{filename}: line {line_no}: Invalid boolean for 'is_preferred': '{pref_str}'"):
                    return

            if parse_bool(exp_avail_str) is None:
                if self._add_error(f"{filename}: line {line_no}: Invalid boolean for 'expedite_available': '{exp_avail_str}'"):
                    return

            if exp_lt_str:
                try:
                    exp_lt = int(exp_lt_str)
                    if exp_lt < 0:
                        if self._add_error(f"{filename}: line {line_no}: 'expedite_lead_time_days' cannot be negative ({exp_lt})"):
                            return
                except ValueError:
                    if self._add_error(f"{filename}: line {line_no}: Invalid integer for 'expedite_lead_time_days': '{exp_lt_str}'"):
                        return

            if exp_prem_str:
                try:
                    prem = Decimal(exp_prem_str)
                    if prem < Decimal("0") or prem > Decimal("1"):
                        if self._add_error(f"{filename}: line {line_no}: 'expedite_cost_premium_pct' must be between 0 and 1 ({exp_prem_str})"):
                            return
                except (InvalidOperation, ValueError):
                    if self._add_error(f"{filename}: line {line_no}: Invalid decimal for 'expedite_cost_premium_pct': '{exp_prem_str}'"):
                        return

    def _validate_purchase_orders(self) -> None:
        filename = "purchase_orders.csv"
        if filename not in self._parsed_raw:
            return
        rows = self._parsed_raw[filename]
        known_suppliers = self._get_known_suppliers()
        known_components = self._get_known_components()
        known_warehouses = self._get_known_warehouses()

        po_headers: Dict[str, Tuple[int, Dict[str, str]]] = {}

        for line_no, row in rows:
            po_num = row.get("po_number", "")
            s_code = row.get("supplier_code", "")
            status = row.get("status", "")
            ord_date_str = row.get("order_date", "")
            prom_date_str = row.get("promised_date", "")
            est_date_str = row.get("latest_estimate_date", "")
            c_sku = row.get("component_sku", "")
            wh_code = row.get("warehouse_code", "")
            qty_ord_str = row.get("qty_ordered", "")
            qty_rec_str = row.get("qty_received", "")
            price_str = row.get("unit_price", "")

            if not po_num:
                if self._add_error(f"{filename}: line {line_no}: 'po_number' cannot be empty"):
                    return

            # Header consistency across rows with same po_number
            header_dict = {
                "supplier_code": s_code,
                "status": status,
                "order_date": ord_date_str,
                "promised_date": prom_date_str,
                "latest_estimate_date": est_date_str,
            }
            if po_num in po_headers:
                prev_line, prev_header = po_headers[po_num]
                for fld, curr_val in header_dict.items():
                    prev_val = prev_header[fld]
                    if curr_val != prev_val:
                        if self._add_error(
                            f"{filename}: line {line_no}: Inconsistent header for PO '{po_num}': field '{fld}' was '{prev_val}' on line {prev_line} but is '{curr_val}' on line {line_no}"
                        ):
                            return
            else:
                po_headers[po_num] = (line_no, header_dict)

                # Validate header fields on first encounter
                if not s_code:
                    if self._add_error(f"{filename}: line {line_no}: 'supplier_code' cannot be empty"):
                        return
                elif s_code not in known_suppliers:
                    if self._add_error(f"{filename}: line {line_no}: Unknown supplier code '{s_code}' (not found in suppliers.csv)"):
                        return

                if status not in ("open", "in_transit", "partially_received", "received", "cancelled"):
                    if self._add_error(
                        f"{filename}: line {line_no}: Invalid PO status '{status}'. Must be one of: open, in_transit, partially_received, received, cancelled"
                    ):
                        return

                try:
                    datetime.strptime(ord_date_str, "%Y-%m-%d").date()
                except ValueError:
                    if self._add_error(f"{filename}: line {line_no}: Invalid ISO date for 'order_date': '{ord_date_str}' (expected YYYY-MM-DD)"):
                        return

                try:
                    datetime.strptime(prom_date_str, "%Y-%m-%d").date()
                except ValueError:
                    if self._add_error(f"{filename}: line {line_no}: Invalid ISO date for 'promised_date': '{prom_date_str}' (expected YYYY-MM-DD)"):
                        return

                if est_date_str:
                    try:
                        datetime.strptime(est_date_str, "%Y-%m-%d").date()
                    except ValueError:
                        if self._add_error(f"{filename}: line {line_no}: Invalid ISO date for 'latest_estimate_date': '{est_date_str}' (expected YYYY-MM-DD)"):
                            return

            # Validate line fields
            if not c_sku:
                if self._add_error(f"{filename}: line {line_no}: 'component_sku' cannot be empty"):
                    return
            elif c_sku not in known_components:
                if self._add_error(f"{filename}: line {line_no}: Unknown component SKU '{c_sku}' (not found in components.csv)"):
                    return

            if not wh_code:
                if self._add_error(f"{filename}: line {line_no}: 'warehouse_code' cannot be empty"):
                    return
            elif wh_code not in known_warehouses:
                if self._add_error(f"{filename}: line {line_no}: Unknown warehouse code '{wh_code}' (not found in warehouses.csv)"):
                    return

            try:
                qty_ord = int(qty_ord_str)
                if qty_ord <= 0:
                    if self._add_error(f"{filename}: line {line_no}: 'qty_ordered' must be greater than 0 ({qty_ord})"):
                        return
            except ValueError:
                if self._add_error(f"{filename}: line {line_no}: Invalid integer for 'qty_ordered': '{qty_ord_str}'"):
                    return
                qty_ord = 0

            try:
                qty_rec = int(qty_rec_str)
                if qty_rec < 0:
                    if self._add_error(f"{filename}: line {line_no}: 'qty_received' cannot be negative ({qty_rec})"):
                        return
                elif qty_rec > qty_ord:
                    if self._add_error(f"{filename}: line {line_no}: 'qty_received' ({qty_rec}) cannot exceed 'qty_ordered' ({qty_ord})"):
                        return
            except ValueError:
                if self._add_error(f"{filename}: line {line_no}: Invalid integer for 'qty_received': '{qty_rec_str}'"):
                    return

            try:
                price = Decimal(price_str)
                if price < Decimal("0"):
                    if self._add_error(f"{filename}: line {line_no}: 'unit_price' cannot be negative ({price_str})"):
                        return
            except (InvalidOperation, ValueError):
                if self._add_error(f"{filename}: line {line_no}: Invalid decimal for 'unit_price': '{price_str}'"):
                    return

    def _validate_customer_orders(self) -> None:
        filename = "customer_orders.csv"
        if filename not in self._parsed_raw:
            return
        rows = self._parsed_raw[filename]
        known_products = self._get_known_products()
        orders_seen: Set[str] = set()

        for line_no, row in rows:
            ord_num = row.get("order_number", "")
            cust_name = row.get("customer_name", "")
            p_sku = row.get("product_sku", "")
            qty_str = row.get("quantity", "")
            due_str = row.get("due_date", "")
            priority = row.get("priority", "")
            status = row.get("status", "")

            if not ord_num:
                if self._add_error(f"{filename}: line {line_no}: 'order_number' cannot be empty"):
                    return
            elif ord_num in orders_seen:
                if self._add_error(f"{filename}: line {line_no}: Duplicate customer order number '{ord_num}'"):
                    return
            orders_seen.add(ord_num)

            if not cust_name:
                if self._add_error(f"{filename}: line {line_no}: 'customer_name' cannot be empty"):
                    return

            if not p_sku:
                if self._add_error(f"{filename}: line {line_no}: 'product_sku' cannot be empty"):
                    return
            elif p_sku not in known_products:
                if self._add_error(f"{filename}: line {line_no}: Unknown product SKU '{p_sku}' (not found in products.csv)"):
                    return

            try:
                qty = int(qty_str)
                if qty <= 0:
                    if self._add_error(f"{filename}: line {line_no}: 'quantity' must be greater than 0 ({qty})"):
                        return
            except ValueError:
                if self._add_error(f"{filename}: line {line_no}: Invalid integer for 'quantity': '{qty_str}'"):
                    return

            try:
                datetime.strptime(due_str, "%Y-%m-%d").date()
            except ValueError:
                if self._add_error(f"{filename}: line {line_no}: Invalid ISO date for 'due_date': '{due_str}' (expected YYYY-MM-DD)"):
                    return

            if priority not in ("critical", "high", "normal", "low"):
                if self._add_error(
                    f"{filename}: line {line_no}: Invalid priority '{priority}'. Must be critical, high, normal, or low"
                ):
                    return

            if status not in ("open", "in_production", "shipped", "cancelled"):
                if self._add_error(
                    f"{filename}: line {line_no}: Invalid status '{status}'. Must be open, in_production, shipped, or cancelled"
                ):
                    return

    def _validate_demand_history(self) -> None:
        filename = "demand_history.csv"
        if filename not in self._parsed_raw:
            return
        rows = self._parsed_raw[filename]
        known_components = self._get_known_components()
        pairs_seen: Set[Tuple[str, str]] = set()

        days_by_component: Dict[str, Set[date]] = {}
        has_post_as_of = False

        for line_no, row in rows:
            c_sku = row.get("component_sku", "")
            d_str = row.get("date", "")
            qty_str = row.get("quantity", "")

            if not c_sku:
                if self._add_error(f"{filename}: line {line_no}: 'component_sku' cannot be empty"):
                    return
            elif c_sku not in known_components:
                if self._add_error(f"{filename}: line {line_no}: Unknown component SKU '{c_sku}' (not found in components.csv)"):
                    return

            parsed_date: Optional[date] = None
            try:
                parsed_date = datetime.strptime(d_str, "%Y-%m-%d").date()
            except ValueError:
                if self._add_error(f"{filename}: line {line_no}: Invalid ISO date for 'date': '{d_str}' (expected YYYY-MM-DD)"):
                    return

            pair = (c_sku, d_str)
            if pair in pairs_seen:
                if self._add_error(f"{filename}: line {line_no}: Duplicate demand record for component '{c_sku}' and date '{d_str}'"):
                    return
            pairs_seen.add(pair)

            try:
                qty = int(qty_str)
                if qty < 0:
                    if self._add_error(f"{filename}: line {line_no}: 'quantity' cannot be negative ({qty})"):
                        return
            except ValueError:
                if self._add_error(f"{filename}: line {line_no}: Invalid integer for 'quantity': '{qty_str}'"):
                    return

            if parsed_date:
                if parsed_date >= self.as_of:
                    has_post_as_of = True
                if c_sku not in days_by_component:
                    days_by_component[c_sku] = set()
                days_by_component[c_sku].add(parsed_date)

        if has_post_as_of:
            self._warnings.append(
                f"Demand history contains records on or after as-of date ({self.as_of}). History should end the day before the as-of date."
            )

        for c_sku in known_components:
            days_count = len(days_by_component.get(c_sku, set()))
            if 0 < days_count < 28:
                self._warnings.append(
                    f"Component '{c_sku}' has only {days_count} days of demand history (< 28 days recommended for stable forecasts)."
                )

    def _validate_delivery_history(self) -> None:
        filename = "delivery_history.csv"
        if filename not in self._parsed_raw:
            return
        rows = self._parsed_raw[filename]
        known_suppliers = self._get_known_suppliers()
        known_components = self._get_known_components()

        for line_no, row in rows:
            s_code = row.get("supplier_code", "")
            c_sku = row.get("component_sku", "")
            prom_str = row.get("promised_date", "")
            act_str = row.get("actual_date", "")
            ord_str = row.get("qty_ordered", "")
            rec_str = row.get("qty_received", "")
            rej_str = row.get("qty_rejected", "")

            if not s_code:
                if self._add_error(f"{filename}: line {line_no}: 'supplier_code' cannot be empty"):
                    return
            elif s_code not in known_suppliers:
                if self._add_error(f"{filename}: line {line_no}: Unknown supplier code '{s_code}' (not found in suppliers.csv)"):
                    return

            if not c_sku:
                if self._add_error(f"{filename}: line {line_no}: 'component_sku' cannot be empty"):
                    return
            elif c_sku not in known_components:
                if self._add_error(f"{filename}: line {line_no}: Unknown component SKU '{c_sku}' (not found in components.csv)"):
                    return

            try:
                datetime.strptime(prom_str, "%Y-%m-%d").date()
            except ValueError:
                if self._add_error(f"{filename}: line {line_no}: Invalid ISO date for 'promised_date': '{prom_str}' (expected YYYY-MM-DD)"):
                    return

            try:
                datetime.strptime(act_str, "%Y-%m-%d").date()
            except ValueError:
                if self._add_error(f"{filename}: line {line_no}: Invalid ISO date for 'actual_date': '{act_str}' (expected YYYY-MM-DD)"):
                    return

            try:
                qty_ord = int(ord_str)
                if qty_ord <= 0:
                    if self._add_error(f"{filename}: line {line_no}: 'qty_ordered' must be greater than 0 ({qty_ord})"):
                        return
            except ValueError:
                if self._add_error(f"{filename}: line {line_no}: Invalid integer for 'qty_ordered': '{ord_str}'"):
                    return
                qty_ord = 0

            try:
                qty_rec = int(rec_str)
                if qty_rec < 0:
                    if self._add_error(f"{filename}: line {line_no}: 'qty_received' cannot be negative ({qty_rec})"):
                        return
                elif qty_rec > qty_ord:
                    if self._add_error(f"{filename}: line {line_no}: 'qty_received' ({qty_rec}) cannot exceed 'qty_ordered' ({qty_ord})"):
                        return
            except ValueError:
                if self._add_error(f"{filename}: line {line_no}: Invalid integer for 'qty_received': '{rec_str}'"):
                    return
                qty_rec = 0

            try:
                qty_rej = int(rej_str)
                if qty_rej < 0:
                    if self._add_error(f"{filename}: line {line_no}: 'qty_rejected' cannot be negative ({qty_rej})"):
                        return
                elif qty_rej > qty_rec:
                    if self._add_error(f"{filename}: line {line_no}: 'qty_rejected' ({qty_rej}) cannot exceed 'qty_received' ({qty_rec})"):
                        return
            except ValueError:
                if self._add_error(f"{filename}: line {line_no}: Invalid integer for 'qty_rejected': '{rej_str}'"):
                    return

    def get_coverage_report(self) -> Dict[str, Any]:
        """Return a structured coverage report detailing present vs missing entity feeds."""
        covered: List[str] = []
        missing: List[str] = []
        row_counts: Dict[str, int] = {}

        for filename in ALL_CSV_FILES:
            entity_name = filename.replace(".csv", "")
            if filename in self._parsed_raw and (self.path / filename).exists():
                covered.append(entity_name)
                row_counts[entity_name] = len(self._parsed_raw[filename])
            else:
                missing.append(entity_name)

        notes: Dict[str, str] = {}
        if "demand_history" in missing:
            notes["demand_history"] = "no demand_history.csv: demand forecasts and shortage projections will show 'insufficient history'"
        if "supplier_offers" in missing:
            notes["supplier_offers"] = "no supplier_offers.csv: no recovery options"
        if "delivery_history" in missing:
            notes["delivery_history"] = "no delivery_history.csv: supplier risk unknown"
        if any(e in missing for e in ("customer_orders", "bom", "products")):
            notes["customer_exposure"] = "no customer_orders/bom/products: exposed-orders figures unavailable"

        return {
            "source": self.name,
            "is_live": self.is_live,
            "label": self.label,
            "as_of": str(self.as_of),
            "entities_covered": covered,
            "entities_missing": missing,
            "row_counts": row_counts,
            "notes": notes,
            "warnings": self._warnings,
        }

    def fetch_dataset(self) -> SourceDataset:
        """Fetch and return the complete dataset structured with business keys.

        Guarantees that if validation fails, nothing is loaded.
        """
        errors, warnings = self.validate()
        if errors:
            raise ValueError(f"File validation failed with {len(errors)} error(s):\n" + "\n".join(errors))

        # 1. Warehouses
        warehouses: List[WarehouseDTO] = []
        for _, row in self._parsed_raw.get("warehouses.csv", []):
            warehouses.append(
                WarehouseDTO(
                    code=row["code"],
                    name=row["name"],
                    role=row["role"],
                )
            )

        # 2. Components
        components: List[ComponentDTO] = []
        for _, row in self._parsed_raw.get("components.csv", []):
            components.append(
                ComponentDTO(
                    sku=row["sku"],
                    name=row["name"],
                    category=row["category"],
                    unit_of_measure=row["unit_of_measure"],
                    criticality=row["criticality"],
                    is_active=bool(parse_bool(row["is_active"])),
                )
            )

        # 3. Suppliers
        suppliers: List[SupplierDTO] = []
        for _, row in self._parsed_raw.get("suppliers.csv", []):
            suppliers.append(
                SupplierDTO(
                    code=row["code"],
                    name=row["name"],
                    country=row["country"],
                )
            )

        # 4. Inventory Levels
        as_of_ts = datetime(self.as_of.year, self.as_of.month, self.as_of.day, 0, 0, 0, tzinfo=timezone.utc)
        inventory_levels: List[InventoryLevelDTO] = []
        for _, row in self._parsed_raw.get("inventory.csv", []):
            inventory_levels.append(
                InventoryLevelDTO(
                    component_sku=row["component_sku"],
                    warehouse_code=row["warehouse_code"],
                    on_hand=int(row["on_hand"]),
                    reserved=int(row["reserved"]),
                    as_of_ts=as_of_ts,
                )
            )

        # 5. Products
        products: List[ProductDTO] = []
        for _, row in self._parsed_raw.get("products.csv", []):
            products.append(
                ProductDTO(
                    sku=row["sku"],
                    name=row["name"],
                    selling_price=Decimal(row["selling_price"]),
                )
            )

        # 6. BOM Lines
        bom_lines: List[BomLineDTO] = []
        for _, row in self._parsed_raw.get("bom.csv", []):
            bom_lines.append(
                BomLineDTO(
                    product_sku=row["product_sku"],
                    component_sku=row["component_sku"],
                    quantity_per_unit=int(row["quantity_per_unit"]),
                )
            )

        # 7. Supplier Components (Offers)
        supplier_components: List[SupplierComponentDTO] = []
        for _, row in self._parsed_raw.get("supplier_offers.csv", []):
            cap = int(row["max_weekly_capacity"]) if row.get("max_weekly_capacity") else None
            exp_lt = int(row["expedite_lead_time_days"]) if row.get("expedite_lead_time_days") else None
            exp_prem = Decimal(row["expedite_cost_premium_pct"]) if row.get("expedite_cost_premium_pct") else None
            supplier_components.append(
                SupplierComponentDTO(
                    supplier_code=row["supplier_code"],
                    component_sku=row["component_sku"],
                    unit_cost=Decimal(row["unit_cost"]),
                    lead_time_days=int(row["lead_time_days"]),
                    min_order_qty=int(row["min_order_qty"]),
                    max_weekly_capacity=cap,
                    is_preferred=bool(parse_bool(row.get("is_preferred", "false"))),
                    expedite_available=bool(parse_bool(row.get("expedite_available", "false"))),
                    expedite_lead_time_days=exp_lt,
                    expedite_cost_premium_pct=exp_prem,
                )
            )

        # 8. Purchase Orders (Grouped by po_number)
        po_dict: Dict[str, PurchaseOrderDTO] = {}
        for _, row in self._parsed_raw.get("purchase_orders.csv", []):
            po_num = row["po_number"]
            if po_num not in po_dict:
                ord_date = datetime.strptime(row["order_date"], "%Y-%m-%d").date()
                prom_date = datetime.strptime(row["promised_date"], "%Y-%m-%d").date()
                est_date = (
                    datetime.strptime(row["latest_estimate_date"], "%Y-%m-%d").date()
                    if row.get("latest_estimate_date")
                    else None
                )
                po_dict[po_num] = PurchaseOrderDTO(
                    po_number=po_num,
                    supplier_code=row["supplier_code"],
                    status=row["status"],
                    order_date=ord_date,
                    promised_date=prom_date,
                    latest_estimate_date=est_date,
                    lines=[],
                )
            po_dict[po_num].lines.append(
                PurchaseOrderLineDTO(
                    component_sku=row["component_sku"],
                    warehouse_code=row["warehouse_code"],
                    qty_ordered=int(row["qty_ordered"]),
                    qty_received=int(row["qty_received"]),
                    unit_price=Decimal(row["unit_price"]),
                )
            )
        purchase_orders = list(po_dict.values())

        # 9. Customer Orders
        customer_orders: List[CustomerOrderDTO] = []
        for _, row in self._parsed_raw.get("customer_orders.csv", []):
            due_date = datetime.strptime(row["due_date"], "%Y-%m-%d").date()
            customer_orders.append(
                CustomerOrderDTO(
                    order_number=row["order_number"],
                    customer_name=row["customer_name"],
                    product_sku=row["product_sku"],
                    quantity=int(row["quantity"]),
                    due_date=due_date,
                    priority=row["priority"],
                    status=row["status"],
                )
            )

        # 10. Demand Records
        demand_records: List[DemandRecordDTO] = []
        for _, row in self._parsed_raw.get("demand_history.csv", []):
            rec_date = datetime.strptime(row["date"], "%Y-%m-%d").date()
            demand_records.append(
                DemandRecordDTO(
                    component_sku=row["component_sku"],
                    date=rec_date,
                    quantity=int(row["quantity"]),
                )
            )

        # 11. Delivery Records
        delivery_records: List[DeliveryRecordDTO] = []
        for _, row in self._parsed_raw.get("delivery_history.csv", []):
            prom_date = datetime.strptime(row["promised_date"], "%Y-%m-%d").date()
            act_date = datetime.strptime(row["actual_date"], "%Y-%m-%d").date()
            delivery_records.append(
                DeliveryRecordDTO(
                    supplier_code=row["supplier_code"],
                    component_sku=row["component_sku"],
                    promised_date=prom_date,
                    actual_date=act_date,
                    qty_ordered=int(row["qty_ordered"]),
                    qty_received=int(row["qty_received"]),
                    qty_rejected=int(row["qty_rejected"]),
                )
            )

        meta = DatasetMetaDTO(
            label=self.label,
            source=self.name,
            seed=0,
            as_of=self.as_of,
            generator_version="0.1.0-file-import",
            generated_at=datetime.now(timezone.utc),
        )

        return SourceDataset(
            meta=meta,
            warehouses=warehouses,
            products=products,
            components=components,
            bom_lines=bom_lines,
            suppliers=suppliers,
            supplier_components=supplier_components,
            inventory_levels=inventory_levels,
            purchase_orders=purchase_orders,
            customer_orders=customer_orders,
            demand_records=demand_records,
            delivery_records=delivery_records,
        )
