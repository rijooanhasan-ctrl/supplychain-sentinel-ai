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


GLOBAL_SUPPLY_CHAIN_HUBS: Dict[str, Dict[str, Any]] = {
    # India (Key manufacturing, assembly, and tech hubs)
    "pune": {"lat": 18.5204, "lon": 73.8567, "city": "Pune", "state": "Maharashtra", "country_code": "IN"},
    "pimpri": {"lat": 18.6298, "lon": 73.7997, "city": "Pimpri-Chinchwad", "state": "Maharashtra", "country_code": "IN"},
    "chinchwad": {"lat": 18.6298, "lon": 73.7997, "city": "Pimpri-Chinchwad", "state": "Maharashtra", "country_code": "IN"},
    "delhi": {"lat": 28.6139, "lon": 77.2090, "city": "Delhi", "state": "Delhi", "country_code": "IN"},
    "newdelhi": {"lat": 28.6139, "lon": 77.2090, "city": "New Delhi", "state": "Delhi", "country_code": "IN"},
    "ncr": {"lat": 28.6139, "lon": 77.2090, "city": "Delhi NCR", "state": "Delhi", "country_code": "IN"},
    "gurgaon": {"lat": 28.4595, "lon": 77.0266, "city": "Gurugram", "state": "Haryana", "country_code": "IN"},
    "gurugram": {"lat": 28.4595, "lon": 77.0266, "city": "Gurugram", "state": "Haryana", "country_code": "IN"},
    "noida": {"lat": 28.5355, "lon": 77.3910, "city": "Noida", "state": "Uttar Pradesh", "country_code": "IN"},
    "chennai": {"lat": 13.0827, "lon": 80.2707, "city": "Chennai", "state": "Tamil Nadu", "country_code": "IN"},
    "madras": {"lat": 13.0827, "lon": 80.2707, "city": "Chennai", "state": "Tamil Nadu", "country_code": "IN"},
    "mumbai": {"lat": 19.0760, "lon": 72.8777, "city": "Mumbai", "state": "Maharashtra", "country_code": "IN"},
    "bombay": {"lat": 19.0760, "lon": 72.8777, "city": "Mumbai", "state": "Maharashtra", "country_code": "IN"},
    "bangalore": {"lat": 12.9716, "lon": 77.5946, "city": "Bengaluru", "state": "Karnataka", "country_code": "IN"},
    "bengaluru": {"lat": 12.9716, "lon": 77.5946, "city": "Bengaluru", "state": "Karnataka", "country_code": "IN"},
    "hyderabad": {"lat": 17.3850, "lon": 78.4867, "city": "Hyderabad", "state": "Telangana", "country_code": "IN"},
    "ahmedabad": {"lat": 23.0225, "lon": 72.5714, "city": "Ahmedabad", "state": "Gujarat", "country_code": "IN"},
    "kolkata": {"lat": 22.5726, "lon": 88.3639, "city": "Kolkata", "state": "West Bengal", "country_code": "IN"},
    "calcutta": {"lat": 22.5726, "lon": 88.3639, "city": "Kolkata", "state": "West Bengal", "country_code": "IN"},
    "surat": {"lat": 21.1702, "lon": 72.8311, "city": "Surat", "state": "Gujarat", "country_code": "IN"},
    "jaipur": {"lat": 26.9124, "lon": 75.7873, "city": "Jaipur", "state": "Rajasthan", "country_code": "IN"},
    # China
    "shenzhen": {"lat": 22.5431, "lon": 114.0579, "city": "Shenzhen", "state": "Guangdong", "country_code": "CN"},
    "dongguan": {"lat": 23.0207, "lon": 113.7518, "city": "Dongguan", "state": "Guangdong", "country_code": "CN"},
    "guangzhou": {"lat": 23.1291, "lon": 113.2644, "city": "Guangzhou", "state": "Guangdong", "country_code": "CN"},
    "canton": {"lat": 23.1291, "lon": 113.2644, "city": "Guangzhou", "state": "Guangdong", "country_code": "CN"},
    "suzhou": {"lat": 31.2989, "lon": 120.5853, "city": "Suzhou", "state": "Jiangsu", "country_code": "CN"},
    "chengdu": {"lat": 30.5728, "lon": 104.0668, "city": "Chengdu", "state": "Sichuan", "country_code": "CN"},
    "shanghai": {"lat": 31.2304, "lon": 121.4737, "city": "Shanghai", "state": "Shanghai", "country_code": "CN"},
    "beijing": {"lat": 39.9042, "lon": 116.4074, "city": "Beijing", "state": "Beijing", "country_code": "CN"},
    "wuhan": {"lat": 30.5928, "lon": 114.3055, "city": "Wuhan", "state": "Hubei", "country_code": "CN"},
    "hangzhou": {"lat": 30.2741, "lon": 120.1551, "city": "Hangzhou", "state": "Zhejiang", "country_code": "CN"},
    "tianjin": {"lat": 39.3434, "lon": 117.3616, "city": "Tianjin", "state": "Tianjin", "country_code": "CN"},
    "chongqing": {"lat": 29.5630, "lon": 106.5516, "city": "Chongqing", "state": "Chongqing", "country_code": "CN"},
    "xian": {"lat": 34.3416, "lon": 108.9398, "city": "Xi'an", "state": "Shaanxi", "country_code": "CN"},
    "zhengzhou": {"lat": 34.7466, "lon": 113.6253, "city": "Zhengzhou", "state": "Henan", "country_code": "CN"},
    "ningbo": {"lat": 29.8683, "lon": 121.5440, "city": "Ningbo", "state": "Zhejiang", "country_code": "CN"},
    "nanjing": {"lat": 32.0603, "lon": 118.7969, "city": "Nanjing", "state": "Jiangsu", "country_code": "CN"},
    "wuxi": {"lat": 31.4912, "lon": 120.3119, "city": "Wuxi", "state": "Jiangsu", "country_code": "CN"},
    "kunshan": {"lat": 31.3846, "lon": 120.9814, "city": "Kunshan", "state": "Jiangsu", "country_code": "CN"},
    "hefei": {"lat": 31.8206, "lon": 117.2272, "city": "Hefei", "state": "Anhui", "country_code": "CN"},
    "foshan": {"lat": 23.0215, "lon": 113.1214, "city": "Foshan", "state": "Guangdong", "country_code": "CN"},
    # Taiwan
    "taipei": {"lat": 25.0330, "lon": 121.5654, "city": "Taipei", "state": "Taiwan", "country_code": "TW"},
    "hsinchu": {"lat": 24.8138, "lon": 120.9675, "city": "Hsinchu", "state": "Taiwan", "country_code": "TW"},
    "taichung": {"lat": 24.1477, "lon": 120.6736, "city": "Taichung", "state": "Taiwan", "country_code": "TW"},
    "tainan": {"lat": 22.9997, "lon": 120.2270, "city": "Tainan", "state": "Taiwan", "country_code": "TW"},
    "kaohsiung": {"lat": 22.6273, "lon": 120.3014, "city": "Kaohsiung", "state": "Taiwan", "country_code": "TW"},
    "taoyuan": {"lat": 24.9936, "lon": 121.3010, "city": "Taoyuan", "state": "Taiwan", "country_code": "TW"},
    # USA
    "austin": {"lat": 30.2672, "lon": -97.7431, "city": "Austin", "state": "Texas", "country_code": "US"},
    "sanjose": {"lat": 37.3382, "lon": -121.8863, "city": "San Jose", "state": "California", "country_code": "US"},
    "santaclara": {"lat": 37.3541, "lon": -121.9552, "city": "Santa Clara", "state": "California", "country_code": "US"},
    "sanfrancisco": {"lat": 37.7749, "lon": -122.4194, "city": "San Francisco", "state": "California", "country_code": "US"},
    "losangeles": {"lat": 34.0522, "lon": -118.2437, "city": "Los Angeles", "state": "California", "country_code": "US"},
    "seattle": {"lat": 47.6062, "lon": -122.3321, "city": "Seattle", "state": "Washington", "country_code": "US"},
    "dallas": {"lat": 32.7767, "lon": -96.7970, "city": "Dallas", "state": "Texas", "country_code": "US"},
    "houston": {"lat": 29.7604, "lon": -95.3698, "city": "Houston", "state": "Texas", "country_code": "US"},
    "chicago": {"lat": 41.8781, "lon": -87.6298, "city": "Chicago", "state": "Illinois", "country_code": "US"},
    "newyork": {"lat": 40.7128, "lon": -74.0060, "city": "New York", "state": "New York", "country_code": "US"},
    "boston": {"lat": 42.3601, "lon": -71.0589, "city": "Boston", "state": "Massachusetts", "country_code": "US"},
    "columbus": {"lat": 39.9612, "lon": -82.9988, "city": "Columbus", "state": "Ohio", "country_code": "US"},
    "reno": {"lat": 39.5296, "lon": -119.8138, "city": "Reno", "state": "Nevada", "country_code": "US"},
    "phoenix": {"lat": 33.4484, "lon": -112.0740, "city": "Phoenix", "state": "Arizona", "country_code": "US"},
    "atlanta": {"lat": 33.7490, "lon": -84.3880, "city": "Atlanta", "state": "Georgia", "country_code": "US"},
    # Germany
    "stuttgart": {"lat": 48.7758, "lon": 9.1829, "city": "Stuttgart", "state": "Baden-Württemberg", "country_code": "DE"},
    "munich": {"lat": 48.1351, "lon": 11.5820, "city": "Munich", "state": "Bavaria", "country_code": "DE"},
    "muenchen": {"lat": 48.1351, "lon": 11.5820, "city": "Munich", "state": "Bavaria", "country_code": "DE"},
    "frankfurt": {"lat": 50.1109, "lon": 8.6821, "city": "Frankfurt", "state": "Hesse", "country_code": "DE"},
    "berlin": {"lat": 52.5200, "lon": 13.4050, "city": "Berlin", "state": "Berlin", "country_code": "DE"},
    "hamburg": {"lat": 53.5511, "lon": 9.9937, "city": "Hamburg", "state": "Hamburg", "country_code": "DE"},
    "cologne": {"lat": 50.9375, "lon": 6.9603, "city": "Cologne", "state": "North Rhine-Westphalia", "country_code": "DE"},
    "koeln": {"lat": 50.9375, "lon": 6.9603, "city": "Cologne", "state": "North Rhine-Westphalia", "country_code": "DE"},
    "dresden": {"lat": 51.0504, "lon": 13.7373, "city": "Dresden", "state": "Saxony", "country_code": "DE"},
    "nuremberg": {"lat": 49.4521, "lon": 11.0767, "city": "Nuremberg", "state": "Bavaria", "country_code": "DE"},
    # Japan
    "osaka": {"lat": 34.6937, "lon": 135.5023, "city": "Osaka", "state": "Kansai", "country_code": "JP"},
    "tokyo": {"lat": 35.6762, "lon": 139.6503, "city": "Tokyo", "state": "Kanto", "country_code": "JP"},
    "kyoto": {"lat": 35.0116, "lon": 135.7681, "city": "Kyoto", "state": "Kansai", "country_code": "JP"},
    "yokohama": {"lat": 35.4437, "lon": 139.6380, "city": "Yokohama", "state": "Kanagawa", "country_code": "JP"},
    "nagoya": {"lat": 35.1815, "lon": 136.9066, "city": "Nagoya", "state": "Aichi", "country_code": "JP"},
    "fukuoka": {"lat": 33.5904, "lon": 130.4017, "city": "Fukuoka", "state": "Kyushu", "country_code": "JP"},
    # South Korea
    "seoul": {"lat": 37.5665, "lon": 126.9780, "city": "Seoul", "state": "Gyeonggi", "country_code": "KR"},
    "suwon": {"lat": 37.2636, "lon": 127.0286, "city": "Suwon", "state": "Gyeonggi", "country_code": "KR"},
    "incheon": {"lat": 37.4563, "lon": 126.7052, "city": "Incheon", "state": "Gyeonggi", "country_code": "KR"},
    "busan": {"lat": 35.1796, "lon": 129.0756, "city": "Busan", "state": "Gyeongsang", "country_code": "KR"},
    "paju": {"lat": 37.7599, "lon": 126.7799, "city": "Paju", "state": "Gyeonggi", "country_code": "KR"},
    # Vietnam
    "hanoi": {"lat": 21.0285, "lon": 105.8542, "city": "Hanoi", "state": "Red River Delta", "country_code": "VN"},
    "hochiminh": {"lat": 10.8231, "lon": 106.6297, "city": "Ho Chi Minh City", "state": "Southeast", "country_code": "VN"},
    "saigon": {"lat": 10.8231, "lon": 106.6297, "city": "Ho Chi Minh City", "state": "Southeast", "country_code": "VN"},
    "bacninh": {"lat": 21.1861, "lon": 106.0763, "city": "Bac Ninh", "state": "Red River Delta", "country_code": "VN"},
    "danang": {"lat": 16.0544, "lon": 108.2022, "city": "Da Nang", "state": "South Central Coast", "country_code": "VN"},
    # Singapore & Malaysia
    "singapore": {"lat": 1.3521, "lon": 103.8198, "city": "Singapore", "state": "Singapore", "country_code": "SG"},
    "penang": {"lat": 5.4141, "lon": 100.3288, "city": "Penang", "state": "Penang", "country_code": "MY"},
    "kualalumpur": {"lat": 3.1390, "lon": 101.6869, "city": "Kuala Lumpur", "state": "Kuala Lumpur", "country_code": "MY"},
}


# Common 3-letter IATA/hub codes mapping to supply chain hub keys
AIRPORT_OR_HUB_CODE_MAP: Dict[str, str] = {
    "del": "delhi",
    "che": "chennai",
    "maa": "chennai",
    "pun": "pune",
    "pnq": "pune",
    "bom": "mumbai",
    "blr": "bangalore",
    "hyd": "hyderabad",
    "ccu": "kolkata",
    "amd": "ahmedabad",
    "jai": "jaipur",
    "sjc": "sanjose",
    "aus": "austin",
    "dfw": "dallas",
    "sea": "seattle",
    "sfo": "sanfrancisco",
    "lax": "losangeles",
    "ord": "chicago",
    "jfk": "newyork",
    "nyc": "newyork",
    "bos": "boston",
    "cmh": "columbus",
    "rno": "reno",
    "tpe": "taipei",
    "szx": "shenzhen",
    "can": "guangzhou",
    "sha": "shanghai",
    "pvg": "shanghai",
    "pek": "beijing",
    "ctu": "chengdu",
    "str": "stuttgart",
    "muc": "munich",
    "fra": "frankfurt",
    "ber": "berlin",
    "ham": "hamburg",
    "hnd": "tokyo",
    "nrt": "tokyo",
    "tyo": "tokyo",
    "kix": "osaka",
    "osa": "osaka",
    "icn": "seoul",
    "sel": "seoul",
    "pus": "busan",
    "sin": "singapore",
    "kul": "kualalumpur",
    "pen": "penang",
    "han": "hanoi",
    "sgn": "hochiminh",
}


def match_city_or_hub(
    text: Optional[str],
    code: Optional[str] = None,
    country_hint: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    """Scan entity name, code, or description for recognized global supply-chain cities/hubs."""
    sorted_hubs = sorted(GLOBAL_SUPPLY_CHAIN_HUBS.keys(), key=lambda k: len(k), reverse=True)

    # 1. Check code tokens (e.g. WH-REG-DEL -> 'del', WH-REG-CHE -> 'che')
    if code:
        code_tokens = [re.sub(r"[^a-z0-9]", "", tok.lower()) for tok in re.split(r"[-_\s/.]+", str(code))]
        for token in code_tokens:
            if not token:
                continue
            if token in AIRPORT_OR_HUB_CODE_MAP:
                hub_key = AIRPORT_OR_HUB_CODE_MAP[token]
                hub_data = GLOBAL_SUPPLY_CHAIN_HUBS.get(hub_key)
                if hub_data and (not country_hint or hub_data["country_code"] == country_hint.strip().upper()):
                    return hub_data
            if token in GLOBAL_SUPPLY_CHAIN_HUBS:
                hub_data = GLOBAL_SUPPLY_CHAIN_HUBS[token]
                if not country_hint or hub_data["country_code"] == country_hint.strip().upper():
                    return hub_data

    # 2. Check entity text (name / description)
    if text:
        text_str = str(text).lower()
        norm_text = re.sub(r"[^a-z0-9]", "", text_str)

        for hub_key in sorted_hubs:
            hub_data = GLOBAL_SUPPLY_CHAIN_HUBS[hub_key]
            pattern = rf"\b{re.escape(hub_key)}\b"
            if re.search(pattern, text_str) or hub_key in norm_text:
                if not country_hint or hub_data["country_code"] == country_hint.strip().upper():
                    return hub_data

        # Fallback if country_hint was specified but didn't match directly
        if country_hint:
            for hub_key in sorted_hubs:
                hub_data = GLOBAL_SUPPLY_CHAIN_HUBS[hub_key]
                pattern = rf"\b{re.escape(hub_key)}\b"
                if re.search(pattern, text_str) or hub_key in norm_text:
                    return hub_data

    return None


def resolve_location(
    entity_type: str,  # "supplier" | "warehouse"
    code: str,
    country_text: Optional[str] = None,
    overrides: Optional[Dict[str, Any]] = None,
    fixtures: Optional[Dict[str, Any]] = None,
    country_centroids: Optional[List[Dict[str, Any]]] = None,
    name: Optional[str] = None,
    index_in_country: int = 0,
) -> LocationResult:
    """Resolve entity location with strictly defined precedence order:

    1. Explicit manual override (exact lat/lon saved by user or location CSV)
    2. Fixture entry for the code (precision="exact", source="Illustrative demo location")
    3. Auto-detected City/State/Hub matching from name or code (precision="exact")
    4. Manual country-level fallback (if override was coarse country selection)
    5. Country centroid (suppliers only; precision="country_centroid")
    6. Unresolved (warehouses without location or suppliers without recognized country)
    """
    clean_code = str(code).strip()
    type_key = f"{entity_type.lower()}s"
    if overrides is None:
        overrides = {}
    if fixtures is None:
        fixtures = {}

    type_overrides = overrides.get(entity_type.lower(), overrides)

    # 1. Check for manual override with explicit coordinates
    if clean_code in type_overrides:
        ov = type_overrides[clean_code]
        lat, lon = ov.get("lat"), ov.get("lon")
        ok, _ = validate_lat_lon(lat, lon)
        note = ov.get("note") or ""
        # If it was an explicit exact placement (not a coarse country fallback), return immediately
        if ok and note != "Manually set (country)":
            return LocationResult(
                lat=float(lat),
                lon=float(lon),
                precision="manual",
                source="Manually set by user",
                country_code=ov.get("country_code"),
                label=note or f"{clean_code} (manual)",
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

    # 3. Smart City / State / Hub Auto-Resolver (checks entity name and code)
    matched_hub = match_city_or_hub(name, clean_code, country_text)
    if matched_hub:
        return LocationResult(
            lat=float(matched_hub["lat"]),
            lon=float(matched_hub["lon"]),
            precision="exact",
            source=f"Auto-resolved: {matched_hub['city']}, {matched_hub['state']}",
            country_code=matched_hub["country_code"],
            label=f"{matched_hub['city']}, {matched_hub['country_code']}",
        )

    # 4. If manual override was set via coarse country picker, use it now if city wasn't matched
    if clean_code in type_overrides:
        ov = type_overrides[clean_code]
        lat, lon = ov.get("lat"), ov.get("lon")
        ok, _ = validate_lat_lon(lat, lon)
        if ok:
            return LocationResult(
                lat=float(lat),
                lon=float(lon),
                precision="manual",
                source="Manually set (country)",
                country_code=ov.get("country_code"),
                label=ov.get("note") or f"{clean_code} (manual)",
            )

    # 5. Country centroid (suppliers only; warehouses have no country column)
    if entity_type.lower() == "supplier" and country_text:
        country_match = resolve_country(country_text, country_centroids)
        if country_match:
            lat = country_match.lat
            lon = country_match.lon
            # Deterministic radial dispersion: space multiple entities in the same country
            if index_in_country > 0:
                radius = 0.35 + 0.1 * (index_in_country % 4)
                angle = (index_in_country * 137.5) * (math.pi / 180.0)
                lat += radius * math.sin(angle)
                cos_lat = max(0.2, math.cos(math.radians(lat)))
                lon += (radius / cos_lat) * math.cos(angle)

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

    # 6. Unresolved fallback
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
