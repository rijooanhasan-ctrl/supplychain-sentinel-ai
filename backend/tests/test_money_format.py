from decimal import Decimal
import pytest
from app.domain.money_format import format_money


def test_format_money_usd():
    assert format_money(Decimal("1234.56"), currency="USD") == "$1,234.56"
    assert format_money(Decimal("2507110.00"), currency="USD") == "$2,507,110.00"
    assert format_money(Decimal("0.00"), currency="USD") == "$0.00"
    assert format_money(Decimal("-50.25"), currency="USD") == "-$50.25"
    assert format_money(None, currency="USD") == "Unknown"


def test_format_money_inr_at_rate_83_5():
    rate = Decimal("83.5")
    # 250.00 * 83.5 = 20,875.00
    assert format_money(Decimal("250.00"), currency="INR", rate=rate) == "₹20,875.00"
    # 2507110.00 * 83.5 = 20,93,43,685.00 (lakh/crore grouping)
    assert format_money(Decimal("2507110.00"), currency="INR", rate=rate) == "₹20,93,43,685.00"
    assert format_money(Decimal("0.00"), currency="INR", rate=rate) == "₹0.00"
    assert format_money(Decimal("-250.00"), currency="INR", rate=rate) == "-₹20,875.00"
    assert format_money(None, currency="INR", rate=rate) == "Unknown"


def test_format_money_indian_grouping_tiers():
    rate = Decimal("1.0")
    assert format_money(Decimal("50.00"), currency="INR", rate=rate) == "₹50.00"
    assert format_money(Decimal("500.00"), currency="INR", rate=rate) == "₹500.00"
    assert format_money(Decimal("5000.00"), currency="INR", rate=rate) == "₹5,000.00"
    assert format_money(Decimal("50000.00"), currency="INR", rate=rate) == "₹50,000.00"
    assert format_money(Decimal("500000.00"), currency="INR", rate=rate) == "₹5,00,000.00"
    assert format_money(Decimal("5000000.00"), currency="INR", rate=rate) == "₹50,00,000.00"
    assert format_money(Decimal("50000000.00"), currency="INR", rate=rate) == "₹5,00,00,000.00"


def test_format_money_rounding_half_up():
    rate = Decimal("1.0")
    # Half-up: 0.005 -> 0.01
    assert format_money(Decimal("10.005"), currency="INR", rate=rate) == "₹10.01"
    # 0.004 -> 0.00
    assert format_money(Decimal("10.004"), currency="INR", rate=rate) == "₹10.00"
    # 0.005 in USD -> $10.01
    assert format_money(Decimal("10.005"), currency="USD") == "$10.01"


def test_format_money_validations():
    with pytest.raises(ValueError, match="USD_TO_INR_RATE must be finite and greater than 0"):
        format_money(Decimal("100.00"), currency="INR", rate=None)

    with pytest.raises(ValueError, match="USD_TO_INR_RATE must be finite and greater than 0"):
        format_money(Decimal("100.00"), currency="INR", rate=Decimal("0"))

    with pytest.raises(ValueError, match="USD_TO_INR_RATE must be finite and greater than 0"):
        format_money(Decimal("100.00"), currency="INR", rate=Decimal("-10.5"))

    with pytest.raises(ValueError, match="Unsupported currency"):
        format_money(Decimal("100.00"), currency="EUR")
