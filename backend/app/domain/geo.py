"""app/domain/geo.py

Pure domain module for geographic coordinate validation, country centroid resolution,
entity location resolution precedence, and supply concentration analysis.
Zero database, framework, or network dependencies.
"""

from __future__ import annotations

from dataclasses import dataclass, field
import json
import math
from pathlib import Path
import re
from typing import Any, Dict, List, Optional, Set, Tuple

FIXTURES_DIR = Path(__file__).resolve().parent.parent / "integrations" / "fixtures"
DEFAULT_COUNTRY_CENTROIDS_PATH = FIXTURES_DIR / "country_centroids.json"

_CACHED_CENTROIDS: Optional[List[Dict[str, Any]]] = None


def load_country_centroids(path: Optional[Path] = None) -> List[Dict[str, Any]]:
    """Load bundled country centroids fixture with in-memory caching."""
    global _CACHED_CENTROIDS
    if path is None and _CACHED_CENTROIDS is not None:
        return _CACHED_CENTROIDS

    target_path = path or DEFAULT_COUNTRY_CENTROIDS_PATH
    if not target_path.exists():
        return []
    try:
        with open(target_path, "r", encoding="utf-8") as f:
            data = json.load(f)
            if path is None:
                _CACHED_CENTROIDS = data
            return data
    except Exception:
        return []


class CountryMatch(dict):
    """Country centroid match result. Supports dict access, attributes, and string equality."""

    @property
    def alpha2(self) -> str:
        return self.get("alpha2", "")

    @property
    def alpha3(self) -> str:
        return self.get("alpha3", "")

    @property
    def name(self) -> str:
        return self.get("name", "")

    @property
    def lat(self) -> float:
        return float(self.get("lat", 0.0))

    @property
    def lon(self) -> float:
        return float(self.get("lon", 0.0))

    def __eq__(self, other: Any) -> bool:
        if isinstance(other, str):
            clean = other.strip().upper()
            return self.alpha2.upper() == clean or self.alpha3.upper() == clean or self.name.lower() == other.strip().lower()
        return super().__eq__(other)

    def __str__(self) -> str:
        return self.alpha2


@dataclass(frozen=True)
class LocationResult:
    """Standardized geographic location output for supply chain entities."""

    lat: Optional[float]
    lon: Optional[float]
    precision: str  # "exact" | "manual" | "country_centroid" | "unresolved"
    source: str  # Plain-language explanation
    country_code: Optional[str] = None
    label: Optional[str] = None


@dataclass
class CountryConcentrationItem:
    """Concentration profile for a single sourcing country."""

    country_code: str
    country_name: str
    supplier_count: int
    risk_distribution: Dict[str, int]  # counts by band: critical, high, medium, low, unknown
    high_risk_suppliers: List[str]
    single_country_components: List[str]
    open_po_count: int
    remaining_qty: float
    flagged: bool
    reason: Optional[str]

    def __getitem__(self, item: str) -> Any:
        return getattr(self, item)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "country_code": self.country_code,
            "country_name": self.country_name,
            "supplier_count": self.supplier_count,
            "risk_distribution": self.risk_distribution,
            "high_risk_suppliers": self.high_risk_suppliers,
            "single_country_components": self.single_country_components,
            "open_po_count": self.open_po_count,
            "remaining_qty": self.remaining_qty,
            "flagged": self.flagged,
            "reason": self.reason,
        }


def validate_lat_lon(
    lat: Any, lon: Any, allow_null_island: bool = False
) -> Tuple[bool, str]:
    """Validate latitude and longitude coordinates.

    Rules:
    - Must be numeric float or int, finite, not boolean.
    - -90.0 <= lat <= 90.0
    - -180.0 <= lon <= 180.0
    - Rejects (0.0, 0.0) as Null Island unless explicitly allowed.
    """
    if isinstance(lat, bool) or isinstance(lon, bool):
        return False, "Coordinates must be numbers, not booleans"

    if not isinstance(lat, (int, float)) or not isinstance(lon, (int, float)):
        return False, "Coordinates must be Numeric float or int, not strings"

    if math.isnan(lat) or math.isnan(lon) or math.isinf(lat) or math.isinf(lon):
        return False, "Coordinates must be finite numbers"

    lat_f = float(lat)
    lon_f = float(lon)

    if lat_f < -90.0 or lat_f > 90.0:
        return False, f"Latitude must be between -90 and 90 (got {lat_f})"

    if lon_f < -180.0 or lon_f > 180.0:
        return False, f"Longitude must be between -180 and 180 (got {lon_f})"

    if not allow_null_island and abs(lat_f) < 1e-6 and abs(lon_f) < 1e-6:
        return False, "Coordinates (0, 0) represent Null Island and are rejected"

    return True, ""


def _normalize_name(name: str) -> str:
    """Normalize country text for exact case/space/punctuation-insensitive matching."""
    return re.sub(r"[^a-z0-9]", "", name.lower())


def resolve_country(
    text: Optional[str], centroids_data: Optional[List[Dict[str, Any]]] = None
) -> Optional[CountryMatch]:
    """Resolve country text matching ISO-3166 alpha-2, alpha-3, or normalized English name.

    Never guesses and does not fuzzy-match.
    """
    if not text or not str(text).strip():
        return None

    if centroids_data is None:
        centroids_data = load_country_centroids()

    raw = str(text).strip()
    norm = _normalize_name(raw)
    upper_raw = raw.upper()

    # 1. Exact match on alpha-2
    for c in centroids_data:
        if c.get("alpha2", "").upper() == upper_raw:
            return CountryMatch(c)

    # 2. Exact match on alpha-3
    for c in centroids_data:
        if c.get("alpha3", "").upper() == upper_raw:
            return CountryMatch(c)

    # 3. Exact normalized name match
    matches = [c for c in centroids_data if _normalize_name(c.get("name", "")) == norm]
    if len(matches) == 1:
        return CountryMatch(matches[0])

    # Standard common aliases
    aliases = {
        "usa": "US",
        "unitedstatesofamerica": "US",
        "uk": "GB",
        "greatbritain": "GB",
        "southkorea": "KR",
        "republicofkorea": "KR",
        "koreasouth": "KR",
        "vietnam": "VN",
        "uae": "AE",
    }
    if norm in aliases:
        target_a2 = aliases[norm]
        for c in centroids_data:
            if c.get("alpha2", "").upper() == target_a2:
                return CountryMatch(c)

    return None


def resolve_location(
    entity_type: str,  # "supplier" | "warehouse"
    code: str,
    country_text: Optional[str],
    overrides: Dict[str, Any],  # keyed by entity_type -> code -> {lat, lon, note, ...} or flat
    fixtures: Dict[str, Any],  # keyed by "suppliers" | "warehouses" -> code -> {lat, lon, ...} or flat
    country_centroids: Optional[List[Dict[str, Any]]] = None,
) -> LocationResult:
    """Resolve entity location with strictly defined precedence order:

    1. Validated manual override (precision="manual", source="Manually set by user")
    2. Fixture entry for the code (precision="exact", source="Illustrative demo location")
    3. Country centroid (suppliers only; precision="country_centroid", source="Country centre (approximate)")
    4. Unresolved (precision="unresolved", source="Unresolved: ...")
    """
    clean_code = str(code).strip()
    type_key = f"{entity_type.lower()}s"

    # 1. Manual override
    type_overrides = overrides.get(entity_type.lower(), overrides)
    if clean_code in type_overrides:
        ov = type_overrides[clean_code]
        lat, lon = ov.get("lat"), ov.get("lon")
        ok, _ = validate_lat_lon(lat, lon)
        if ok:
            return LocationResult(
                lat=float(lat),
                lon=float(lon),
                precision="manual",
                source="Manually set by user",
                country_code=ov.get("country_code"),
                label=ov.get("note") or f"{clean_code} (manual)",
            )

    # 2. Fixture entry (support nested "suppliers" dict or flat dict)
    type_fixtures = fixtures.get(type_key, fixtures.get(entity_type.lower(), fixtures))
    if clean_code in type_fixtures:
        fix = type_fixtures[clean_code]
        lat, lon = fix.get("lat"), fix.get("lon")
        ok, _ = validate_lat_lon(lat, lon)
        if ok:
            return LocationResult(
                lat=float(lat),
                lon=float(lon),
                precision="exact",
                source=fix.get("source") or "Illustrative demo location",
                country_code=fix.get("country_code"),
                label=fix.get("city") or clean_code,
            )

    # 3. Country centroid (suppliers only; warehouses have no country column)
    if entity_type.lower() == "supplier" and country_text:
        country_match = resolve_country(country_text, country_centroids)
        if country_match:
            lat = country_match.lat
            lon = country_match.lon
            ok, _ = validate_lat_lon(lat, lon)
            if ok:
                return LocationResult(
                    lat=float(lat),
                    lon=float(lon),
                    precision="country_centroid",
                    source="Country centre (approximate)",
                    country_code=country_match.alpha2,
                    label=f"{country_match.name} (approximate)",
                )

    # 4. Unresolved
    reason = (
        f"Unresolved: Warehouse without location data"
        if entity_type.lower() == "warehouse"
        else f"Unresolved: Country '{country_text}' could not be matched"
        if country_text
        else f"Unresolved: No country or coordinate provided for {clean_code}"
    )
    return LocationResult(
        lat=None,
        lon=None,
        precision="unresolved",
        source=reason,
        country_code=None,
        label=None,
    )


def group_by_country(
    suppliers: List[Dict[str, Any]],
    routes: Optional[List[Dict[str, Any]]] = None,
    single_country_components_map: Optional[Dict[str, List[str]]] = None,
) -> Dict[str, Dict[str, Any]]:
    """Group resolved suppliers by country code."""
    routes = routes or []
    single_country_components_map = single_country_components_map or {}

    # Map supplier_code -> open PO count and remaining qty from routes
    supp_routes_po: Dict[str, int] = {}
    supp_routes_qty: Dict[str, float] = {}
    for r in routes:
        s_code = r.get("supplier_code", "")
        supp_routes_po[s_code] = supp_routes_po.get(s_code, 0) + r.get("open_po_count", 0)
        supp_routes_qty[s_code] = supp_routes_qty.get(s_code, 0.0) + float(r.get("remaining_qty", 0.0))

    groups: Dict[str, Dict[str, Any]] = {}
    for s in suppliers:
        loc = s.get("location") or {}
        c_code = loc.get("country_code") or s.get("country") or "UNKNOWN"
        c_name = s.get("country_name") or c_code

        if c_code not in groups:
            groups[c_code] = {
                "country_code": c_code,
                "country_name": c_name,
                "supplier_count": 0,
                "risk_distribution": {"critical": 0, "high": 0, "medium": 0, "low": 0, "unknown": 0},
                "high_risk_suppliers": [],
                "single_country_components": single_country_components_map.get(c_code, []),
                "open_po_count": 0,
                "remaining_qty": 0.0,
            }

        g = groups[c_code]
        g["supplier_count"] += 1
        band = s.get("risk_band") or "unknown"
        g["risk_distribution"][band] = g["risk_distribution"].get(band, 0) + 1
        s_code = s.get("code") or s.get("name") or ""
        if band in ("high", "critical"):
            g["high_risk_suppliers"].append(s_code)

        g["open_po_count"] += supp_routes_po.get(s_code, s.get("open_po_count", 0))
        g["remaining_qty"] += supp_routes_qty.get(s_code, s.get("remaining_qty", 0.0))

    return groups


def compute_concentration(
    groups_or_suppliers: Any = None,
    total_suppliers: Optional[int] = None,
    min_suppliers: int = 3,
    share_threshold: float = 0.40,
    suppliers_resolved: Any = None,
    supplier_component_offers: Optional[Dict[str, Set[str]]] = None,
    component_criticalities: Optional[Dict[str, str]] = None,
    min_share: Optional[float] = None,
    **kwargs,
) -> List[CountryConcentrationItem]:
    """Evaluate country concentration against pre-registered defaults.

    Flags when supplier_count >= min_suppliers and share >= share_threshold,
    OR any single-country-sourced critical component exists.
    """
    target = groups_or_suppliers if groups_or_suppliers is not None else suppliers_resolved
    if min_share is not None:
        share_threshold = min_share

    if isinstance(target, dict):
        groups = target
        total = total_suppliers if total_suppliers is not None else sum(g["supplier_count"] for g in groups.values())
    else:
        supp_resolved = target or []
        offers = supplier_component_offers or kwargs.get("supplier_component_offers", {})
        criticalities = component_criticalities or kwargs.get("component_criticalities", {})

        supplier_countries = {
            s["code"]: (s.get("location") or {}).get("country_code") or s.get("country")
            for s in supp_resolved
        }
        single_map: Dict[str, List[str]] = {}
        for c_sku, s_codes in offers.items():
            c_countries = {supplier_countries.get(sc) for sc in s_codes if sc in supplier_countries}
            c_countries.discard(None)
            if len(c_countries) == 1:
                sole_c = next(iter(c_countries))
                single_map.setdefault(sole_c, []).append(c_sku)

        groups = group_by_country(supp_resolved, single_country_components_map=single_map)
        total = len(supp_resolved)

    results: List[CountryConcentrationItem] = []
    for c_code, g in groups.items():
        count = g["supplier_count"]
        share = count / total if total > 0 else 0.0
        share_flag = (count >= min_suppliers) and (share >= share_threshold)

        single_comps = g.get("single_country_components", [])
        crit_flag = len(single_comps) > 0

        flagged = share_flag or crit_flag
        reasons = []
        if share_flag:
            reasons.append(
                f"Concentration threshold met: holds {count} of {total} ({share:.1%}) suppliers (threshold: >= {min_suppliers} suppliers and >= {share_threshold:.0%})"
            )
        if crit_flag:
            reasons.append(
                f"Country is sole source for component(s): {', '.join(sorted(single_comps))}"
            )

        reason_str = " · ".join(reasons) if flagged else None

        results.append(
            CountryConcentrationItem(
                country_code=c_code,
                country_name=g["country_name"],
                supplier_count=count,
                risk_distribution=g["risk_distribution"],
                high_risk_suppliers=g["high_risk_suppliers"],
                single_country_components=sorted(single_comps),
                open_po_count=g["open_po_count"],
                remaining_qty=g["remaining_qty"],
                flagged=flagged,
                reason=reason_str,
            )
        )

    results.sort(key=lambda item: (-int(item.flagged), -item.supplier_count, item.country_code))
    return results


# Export alias
concentration = compute_concentration
