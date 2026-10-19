import ast
from pathlib import Path
import pytest

from scripts.smoke_test import (
    check_no_currency_symbol,
    validate_difference_sentence,
    validate_html_response,
)


def test_check_no_currency_symbol():
    # Valid numeric strings without currency symbols
    assert check_no_currency_symbol("85550.00") is True
    assert check_no_currency_symbol("0.0") is True
    assert check_no_currency_symbol("2507110.00") is True
    assert check_no_currency_symbol("123.456") is True
    assert check_no_currency_symbol(None) is True

    # Leaked currency symbols or alphabetic text
    assert check_no_currency_symbol("$85550.00") is False
    assert check_no_currency_symbol("₹85550.00") is False
    assert check_no_currency_symbol("85550.00 INR") is False
    assert check_no_currency_symbol("85550.00 USD") is False
    assert check_no_currency_symbol("invalid_number") is False


def test_validate_html_response():
    valid_html = '<html><head></head><body><div id="root"></div><script type="module" src="/assets/index.js"></script></body></html>'
    valid, msg = validate_html_response(valid_html)
    assert valid is True

    # Missing root div
    bad_html_no_root = '<html><body><div>Hello</div><script src="/app.js"></script></body></html>'
    valid, msg = validate_html_response(bad_html_no_root)
    assert valid is False
    assert "Missing root div" in msg

    # Missing script tag
    bad_html_no_script = '<html><body><div id="root"></div></body></html>'
    valid, msg = validate_html_response(bad_html_no_script)
    assert valid is False
    assert "Missing <script> tag" in msg

    # Empty body
    valid, msg = validate_html_response("")
    assert valid is False


def test_validate_difference_sentence_rules():
    # Valid INR sentence
    inr_sentence = (
        "Acting costs ₹71,43,425.00; exposed order value in the first shortage window falls from "
        "₹20,93,43,685.00 to ₹14,27,16,196.00 (upper bound, not a loss)."
    )
    valid, msg = validate_difference_sentence(inr_sentence, "INR")
    assert valid is True

    # Valid USD sentence
    usd_sentence = (
        "Acting costs $85,550.00; exposed order value in the first shortage window falls from "
        "$2,507,110.00 to $1,709,176.00 (upper bound, not a loss)."
    )
    valid, msg = validate_difference_sentence(usd_sentence, "USD")
    assert valid is True

    # Forbidden word: savings
    bad_savings = (
        "Acting results in savings of ₹71,43,425.00 (upper bound, not a loss)."
    )
    valid, msg = validate_difference_sentence(bad_savings, "INR")
    assert valid is False
    assert "savings" in msg

    # Forbidden phrase: loss estimate
    bad_loss = (
        "Acting costs ₹71,43,425.00; loss estimate is reduced (upper bound, not a loss)."
    )
    valid, msg = validate_difference_sentence(bad_loss, "INR")
    assert valid is False
    assert "loss estimate" in msg

    # Missing upper bound wording
    bad_no_upper = "Acting costs ₹71,43,425.00; exposed order value falls."
    valid, msg = validate_difference_sentence(bad_no_upper, "INR")
    assert valid is False
    assert "upper bound" in msg

    # Currency symbol mismatch: $ in INR
    mismatch_inr = "Acting costs $85,550.00; upper bound, not a loss."
    valid, msg = validate_difference_sentence(mismatch_inr, "INR")
    assert valid is False

    # Currency symbol mismatch: ₹ in USD
    mismatch_usd = "Acting costs ₹71,43,425.00; upper bound, not a loss."
    valid, msg = validate_difference_sentence(mismatch_usd, "USD")
    assert valid is False


def test_smoke_script_uses_no_external_network_library():
    """Verify that backend/scripts/smoke_test.py uses only urllib from standard library."""
    script_path = Path(__file__).resolve().parent.parent / "scripts" / "smoke_test.py"
    assert script_path.exists(), "smoke_test.py does not exist"

    source = script_path.read_text(encoding="utf-8")
    tree = ast.parse(source, filename=str(script_path))

    forbidden_modules = {
        "requests",
        "httpx",
        "aiohttp",
        "urllib3",
        "playwright",
        "selenium",
        "curl",
    }

    imported_modules = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                imported_modules.add(alias.name.split(".")[0])
        elif isinstance(node, ast.ImportFrom):
            if node.module:
                imported_modules.add(node.module.split(".")[0])

    forbidden_found = imported_modules.intersection(forbidden_modules)
    assert not forbidden_found, f"Found forbidden network libraries in smoke_test.py: {forbidden_found}"
    assert "urllib" in imported_modules, "smoke_test.py should use standard library urllib"
