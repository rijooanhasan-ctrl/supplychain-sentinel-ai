#!/usr/bin/env python3
"""SupplyChain Sentinel AI - Read-only End-to-End Smoke Test Script.

Validates:
- Every API endpoint returns HTTP 200 with valid JSON.
- Read-only enforcement: POST to API endpoints returns HTTP 405.
- Every web frontend route returns HTTP 200 with HTML shell (root div + script tag),
  including SPA fallback for unknown routes.
- Demo story assertions (when demo dataset is active, skipped otherwise).
- No currency symbols leaked into API numeric/money fields.
- Difference sentence formatting and currency symbol rules.

Only Python standard library is used (no requests, no httpx, no Playwright).
"""

from decimal import Decimal
import argparse
import json
import re
import sys
import urllib.error
import urllib.request
import functools
from typing import Any, Dict, List, Optional, Tuple

# Ensure stdout uses UTF-8 and auto-flushes on Windows terminals and pipes
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
print = functools.partial(print, flush=True)


def check_no_currency_symbol(val: Any) -> bool:
    """Verify that a money field is formatted without currency symbols ($ or ₹)."""
    if val is None:
        return True
    s = str(val).strip()
    if "$" in s or "₹" in s or "INR" in s or "USD" in s:
        return False
    # Should parse cleanly as Decimal
    try:
        Decimal(s)
        return True
    except Exception:
        return False


def validate_html_response(html: str) -> Tuple[bool, str]:
    """Verify that a frontend response contains HTML root mount point and script tag."""
    if not html or not isinstance(html, str):
        return False, "Response body is empty"
    if 'id="root"' not in html and "id='root'" not in html:
        return False, 'Missing root div (<div id="root">)'
    if "<script" not in html:
        return False, "Missing <script> tag"
    return True, "Valid HTML shell"


def validate_difference_sentence(sentence: str, display_currency: str) -> Tuple[bool, str]:
    """Verify executive summary difference_sentence rules."""
    if not sentence:
        return False, "difference_sentence is empty"

    sentence_lower = sentence.lower()
    if "savings" in sentence_lower:
        return False, "difference_sentence contains forbidden word 'savings'"
    if "loss estimate" in sentence_lower:
        return False, "difference_sentence contains forbidden phrase 'loss estimate'"

    # Upper-bound wording check
    if "upper bound" not in sentence_lower:
        return False, "difference_sentence missing required 'upper bound' wording"

    # Currency symbol check
    if display_currency == "INR":
        if "₹" not in sentence:
            return False, "difference_sentence expected '₹' for INR display currency"
        if "$" in sentence:
            return False, "difference_sentence contains unexpected '$' for INR display currency"
    elif display_currency == "USD":
        if "$" not in sentence:
            return False, "difference_sentence expected '$' for USD display currency"
        if "₹" in sentence:
            return False, "difference_sentence contains unexpected '₹' for USD display currency"

    return True, "Valid difference_sentence"


class SmokeTestRunner:
    def __init__(self, api_base: str, web_base: Optional[str] = None):
        self.api_base = api_base.rstrip("/")
        self.web_base = web_base.rstrip("/") if web_base else None
        self.passed = 0
        self.failed = 0
        self.skipped = 0

    def record_pass(self, name: str, detail: str = ""):
        self.passed += 1
        msg = f"[PASS] {name}"
        if detail:
            msg += f" - {detail}"
        print(msg)

    def record_fail(self, name: str, reason: str):
        self.failed += 1
        print(f"[FAIL] {name} - {reason}")

    def record_skip(self, name: str, reason: str):
        self.skipped += 1
        print(f"[SKIP] {name} - {reason}")

    def http_get_json(self, url: str) -> Tuple[int, Optional[Dict[str, Any]], str]:
        req = urllib.request.Request(url, headers={"Accept": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                status = resp.status
                body = resp.read().decode("utf-8")
                try:
                    data = json.loads(body)
                    return status, data, ""
                except json.JSONDecodeError as e:
                    return status, None, f"Invalid JSON: {e}"
        except urllib.error.HTTPError as e:
            return e.code, None, f"HTTPError {e.code}: {e.reason}"
        except Exception as e:
            return 0, None, f"Connection error: {e}"

    def http_get_text(self, url: str) -> Tuple[int, Optional[str], str]:
        req = urllib.request.Request(url, headers={"Accept": "text/html,*/*"})
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                status = resp.status
                body = resp.read().decode("utf-8", errors="replace")
                return status, body, ""
        except urllib.error.HTTPError as e:
            return e.code, None, f"HTTPError {e.code}: {e.reason}"
        except Exception as e:
            return 0, None, f"Connection error: {e}"

    def http_post(self, url: str) -> Tuple[int, str]:
        req = urllib.request.Request(url, data=b"{}", headers={"Content-Type": "application/json"}, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                return resp.status, ""
        except urllib.error.HTTPError as e:
            return e.code, e.reason
        except Exception as e:
            return 0, str(e)

    def run_api_checks(self) -> Dict[str, Any]:
        endpoints = [
            "/api/health",
            "/api/meta",
            "/api/integration-status",
            "/api/products",
            "/api/components",
            "/api/suppliers",
            "/api/warehouses",
            "/api/inventory",
            "/api/purchase-orders",
            "/api/customer-orders",
            "/api/delivery-records",
            "/api/inventory-risk",
            "/api/supplier-risk",
            "/api/forecasting/evaluation",
            "/api/alerts",
            "/api/recommendations",
            "/api/simulation?component_id=1",
            "/api/executive-summary",
            # Detail endpoints
            "/api/products/1",
            "/api/components/1",
            "/api/suppliers/1",
            "/api/purchase-orders/1",
            "/api/inventory-risk/1",
            "/api/supplier-risk/1",
            "/api/forecasting/components/1",
        ]

        cached_responses: Dict[str, Any] = {}

        for ep in endpoints:
            url = f"{self.api_base}{ep}"
            status, data, err = self.http_get_json(url)
            name = f"GET {ep}"
            if status == 200 and data is not None:
                self.record_pass(name, "HTTP 200 OK with valid JSON")
                cached_responses[ep] = data
            else:
                self.record_fail(name, f"Status {status}, {err}")

        return cached_responses

    def run_get_only_checks(self):
        post_endpoints = ["/api/products", "/api/purchase-orders"]
        for ep in post_endpoints:
            url = f"{self.api_base}{ep}"
            status, reason = self.http_post(url)
            name = f"POST {ep} (GET-only enforcement)"
            if status == 405:
                self.record_pass(name, "HTTP 405 Method Not Allowed as expected")
            else:
                self.record_fail(name, f"Expected HTTP 405, got {status} ({reason})")

    def run_web_checks(self):
        if not self.web_base:
            self.record_skip("Web route checks", "No web URL provided")
            return

        routes = [
            "/",
            "/executive-summary",
            "/alerts",
            "/recommendations",
            "/simulator",
            "/inventory-risk",
            "/supplier-risk",
            "/forecasting",
            "/inventory",
            "/suppliers",
            "/purchase-orders",
            "/data-sources",
            "/report",
            "/unknown-route-test-404-spa-fallback",
        ]

        for route in routes:
            url = f"{self.web_base}{route}"
            status, html, err = self.http_get_text(url)
            name = f"WEB {route}"
            if status != 200 or html is None:
                self.record_fail(name, f"Status {status}, {err}")
                continue

            valid, reason = validate_html_response(html)
            if valid:
                self.record_pass(name, "HTTP 200 with root div and script tag (SPA shell)")
            else:
                self.record_fail(name, reason)

    def run_story_checks(self, responses: Dict[str, Any]):
        meta = responses.get("/api/meta")
        if not meta or not isinstance(meta, dict):
            self.record_skip("Story checks", "Could not inspect /api/meta")
            return

        is_demo = (
            meta.get("as_of") == "2026-10-17"
            and meta.get("data_source") == "demo"
        )

        if not is_demo:
            print("story checks skipped (not the demo dataset)")
            self.record_skip("Story checks", "Dataset is not the demo dataset (as_of 2026-10-17, source demo)")
            return

        print("Executing demo dataset story checks...")

        # 1. Executive Summary checks
        summary = responses.get("/api/executive-summary")
        if not summary:
            self.record_fail("Story: Executive Summary", "Response not available")
            return

        top_risks = summary.get("top_risks", [])
        if not top_risks:
            self.record_fail("Story: Top Risks", "top_risks is empty")
        else:
            top0 = top_risks[0]
            # CPU-X7 first top risk
            if top0.get("component_sku") == "CPU-X7":
                self.record_pass("Story: CPU-X7 top risk", "CPU-X7 is first top risk")
            else:
                self.record_fail("Story: CPU-X7 top risk", f"Expected CPU-X7, got {top0.get('component_sku')}")

            # shortage_date 2026-10-21
            if top0.get("shortage_date") == "2026-10-21":
                self.record_pass("Story: Shortage Date", "shortage_date is 2026-10-21")
            else:
                self.record_fail("Story: Shortage Date", f"Expected 2026-10-21, got {top0.get('shortage_date')}")

            # units short before next inbound 289.5
            if top0.get("units_short_before_next_inbound") == 289.5:
                self.record_pass("Story: Units Short", "units_short_before_next_inbound is 289.5")
            else:
                self.record_fail("Story: Units Short", f"Expected 289.5, got {top0.get('units_short_before_next_inbound')}")

            # do-nothing exposure count 15 and selling value "2507110.00"
            exp_count = top0.get("exposed_orders_count")
            exp_val = top0.get("exposed_selling_value")
            if exp_count == 15 and exp_val == "2507110.00":
                self.record_pass("Story: CPU-X7 Exposure", f"15 orders, value {exp_val}")
            else:
                self.record_fail("Story: CPU-X7 Exposure", f"Expected (15, '2507110.00'), got ({exp_count}, '{exp_val}')")

        # 2. Priority Decision checks
        pdec = summary.get("priority_decision", {})
        rec_opt_id = pdec.get("recommended_option_id")
        rec_cost = pdec.get("incremental_cost")
        residual = pdec.get("residual_unmet_before_next_inbound")
        later_note = pdec.get("later_shortage_note") or ""

        if rec_opt_id == "alt_supplier.SUP-NEXUS" and rec_cost == "85550.00" and residual == 0.0:
            self.record_pass("Story: Recommended Option", f"alt_supplier.SUP-NEXUS cost={rec_cost} residual={residual}")
        else:
            self.record_fail("Story: Recommended Option", f"Expected alt_supplier.SUP-NEXUS, 85550.00, 0.0; got {rec_opt_id}, {rec_cost}, {residual}")

        if "2026-11-02" in later_note:
            self.record_pass("Story: Later Shortage Note", f"Mentions 2026-11-02: '{later_note}'")
        else:
            self.record_fail("Story: Later Shortage Note", f"Expected mention of 2026-11-02, got '{later_note}'")

        # 3. Headline check: contains "9 components"
        headline = summary.get("headline", "")
        if "9 components" in headline:
            self.record_pass("Story: Headline Risk Count", f"Headline contains '9 components': '{headline}'")
        else:
            self.record_fail("Story: Headline Risk Count", f"Expected '9 components' in headline, got '{headline}'")

        # 4. Supplier Risk checks: SUP-HELIX on-time rate 0.55 and band high
        sup_risk = responses.get("/api/supplier-risk", {})
        items = sup_risk.get("items", [])
        helix = next((s for s in items if s.get("supplier_code") == "SUP-HELIX"), None)
        if helix:
            ot_rate = helix.get("on_time_rate")
            band = helix.get("risk_band")
            if ot_rate == 0.55 and band == "high":
                self.record_pass("Story: SUP-HELIX Supplier Risk", f"on_time_rate={ot_rate}, risk_band={band}")
            else:
                self.record_fail("Story: SUP-HELIX Supplier Risk", f"Expected (0.55, 'high'), got ({ot_rate}, '{band}')")
        else:
            self.record_fail("Story: SUP-HELIX Supplier Risk", "SUP-HELIX not found in /api/supplier-risk items")

        # 5. Simulation with supplier_delay_days=7
        sim_url = f"{self.api_base}/api/simulation?component_id=1&supplier_delay_days=7"
        s_status, sim_data, s_err = self.http_get_json(sim_url)
        if s_status == 200 and sim_data:
            disrupted = sim_data.get("disrupted", {})
            unmet = disrupted.get("unmet_before_next_inbound")
            if unmet == 999.0:
                self.record_pass("Story: Simulation 7-Day Delay", f"unmet_before_next_inbound is {unmet}")
            else:
                self.record_fail("Story: Simulation 7-Day Delay", f"Expected 999.0, got {unmet}")
        else:
            self.record_fail("Story: Simulation 7-Day Delay", f"Failed to fetch simulation: {s_status} {s_err}")

        # 6. Money field currency leakage checks
        # API money fields stay USD strings (e.g. incremental_cost "85550.00" has no currency symbol)
        if check_no_currency_symbol(rec_cost):
            self.record_pass("Currency: rec_cost no leakage", f"incremental_cost is '{rec_cost}' without currency symbol")
        else:
            self.record_fail("Currency: rec_cost leakage", f"incremental_cost leaked currency symbol: '{rec_cost}'")

        if check_no_currency_symbol(top0.get("exposed_selling_value")):
            self.record_pass("Currency: exposure no leakage", f"exposed_selling_value is '{top0.get('exposed_selling_value')}' without currency symbol")
        else:
            self.record_fail("Currency: exposure leakage", f"exposed_selling_value leaked currency symbol: '{top0.get('exposed_selling_value')}'")

        # 7. Difference sentence validation
        cost_comp = summary.get("cost_comparison", {})
        diff_sent = cost_comp.get("difference_sentence", "")
        disp_curr = meta.get("display_currency", "USD")
        valid_sent, sent_msg = validate_difference_sentence(diff_sent, disp_curr)
        if valid_sent:
            self.record_pass("Generated Sentence: difference_sentence", f"{sent_msg} (currency={disp_curr})")
        else:
            self.record_fail("Generated Sentence: difference_sentence", sent_msg)

    def run(self) -> int:
        print("=" * 70)
        print(" SupplyChain Sentinel AI - E2E Smoke Test")
        print(f" API URL: {self.api_base}")
        print(f" WEB URL: {self.web_base or '(skipped)'}")
        print("=" * 70)

        # 1. API GET endpoints
        responses = self.run_api_checks()

        # 2. GET-only enforcement (POST rejected with 405)
        self.run_get_only_checks()

        # 3. Frontend Web routes
        self.run_web_checks()

        # 4. Demo story checks
        self.run_story_checks(responses)

        print("=" * 70)
        total = self.passed + self.failed + self.skipped
        print(f"Summary: {self.passed} passed, {self.failed} failed, {self.skipped} skipped (total {total} checks)")
        print("=" * 70)

        return 1 if self.failed > 0 else 0


def main():
    parser = argparse.ArgumentParser(description="SupplyChain Sentinel AI Smoke Test")
    parser.add_argument("--api", default="http://localhost:8000", help="API base URL (default: http://localhost:8000)")
    parser.add_argument("--web", default="http://localhost:4173", help="Web base URL (default: http://localhost:4173)")
    parser.add_argument("--skip-web", action="store_true", help="Skip web route checks")
    args = parser.parse_args()

    web_url = None if args.skip_web or not args.web else args.web
    runner = SmokeTestRunner(api_base=args.api, web_base=web_url)
    exit_code = runner.run()
    sys.exit(exit_code)


if __name__ == "__main__":
    main()
