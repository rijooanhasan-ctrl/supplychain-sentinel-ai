"""app/domain/money_format.py

Pure domain helper for formatting monetary amounts in USD or INR.
Strictly uses Decimal arithmetic (ROUND_HALF_UP) without floating-point math.
"""

from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP
from typing import Optional, Union


def format_money(
    amount_usd: Optional[Union[Decimal, str, int, float]],
    currency: str = "USD",
    rate: Optional[Decimal] = None,
) -> str:
    """Format a monetary USD amount into a currency string ($ or ₹) with exact Decimal arithmetic.

    - currency="INR": converts using rate with Decimal ROUND_HALF_UP to 2 decimals and Indian digit grouping (e.g. ₹1,23,456.00).
    - currency="USD": formats with standard 3-digit comma separation and $ symbol (e.g. $1,234.56).
    - Returns 'Unknown' if amount_usd is None.
    """
    if amount_usd is None:
        return "Unknown"

    if isinstance(amount_usd, Decimal):
        dec_amount = amount_usd
    else:
        dec_amount = Decimal(str(amount_usd))

    curr = (currency or "USD").strip().upper()

    if curr == "INR":
        if rate is None or not rate.is_finite() or rate <= Decimal("0"):
            raise ValueError("USD_TO_INR_RATE must be finite and greater than 0 when currency is 'INR'")
        converted = (dec_amount * rate).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        symbol = "₹"
        grouping = "indian"
    elif curr == "USD":
        converted = dec_amount.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        symbol = "$"
        grouping = "us"
    else:
        raise ValueError(f"Unsupported currency: {currency}")

    is_neg = converted < Decimal("0")
    abs_val = abs(converted)
    val_str = f"{abs_val:.2f}"
    parts = val_str.split(".")
    int_str = parts[0]
    dec_str = parts[1]

    if grouping == "us":
        n = len(int_str)
        formatted_int = ""
        for i, ch in enumerate(int_str):
            if i > 0 and (n - i) % 3 == 0:
                formatted_int += ","
            formatted_int += ch
    else:  # indian
        if len(int_str) <= 3:
            formatted_int = int_str
        else:
            last_three = int_str[-3:]
            remaining = int_str[:-3]
            chunks = []
            while remaining:
                chunks.append(remaining[-2:])
                remaining = remaining[:-2]
            chunks.reverse()
            formatted_int = ",".join(chunks) + "," + last_three

    prefix = f"-{symbol}" if is_neg else symbol
    return f"{prefix}{formatted_int}.{dec_str}"
