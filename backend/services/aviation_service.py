"""Aviation weather briefing — deterministic data assembly, no LLM for data.

Eval gap #1 (Aviation weather briefing). Serves:
- Key feature 3 (NWP integration): winds aloft from GFS pressure levels.
- Expected outcome: "intelligent weather decision-support ... for aviation".

Honesty rules, enforced here:
- Every section is {status: OK | UNAVAILABLE, ...}. Missing input is an
  UNAVAILABLE section with a reason, never synthesized.
- WIS2/MQTT/WRF-style gaps are irrelevant here, but the same rule applies to
  turbulence/icing: without data to support an assessment we say so honestly.
- Cloud cover is explicitly labelled "proxy, not a measured ceiling";
  visibility is a forecast proxy, not a measured RVR. Never emit anything that
  looks like a synthetic METAR/TAF string.
- The LLM is NEVER the source of weather truth in this path: data comes only
  from adapters (Open-Meteo GFS) and the official alert chain. The mandatory
  disclaimer is a fixed template, not generated.
- Backend severity is authoritative: alert severity passes through
  `build_verdict` untouched (UNKNOWN stays UNKNOWN).

Source-mode semantics (docs/SOURCE-MODES.md):
- demo: labelled DEMO fixtures (sample data for the demo), never live.
- imd: official-only. GFS/Open-Meteo is NOT official, so every non-official
  meteorology section reports UNAVAILABLE instead of backfilling. Alerts use
  the official chain only.
- hybrid: the full honest chain — live GFS meteorology + official alerts.
"""
from __future__ import annotations

import asyncio
import math

from .. import config
from ..adapters import openmeteo_adapter
from ..adapters.registry import AdapterUnavailable
from . import alert_service
from .location_service import LocationService
from .verdict_service import build_verdict

SOURCE = "aviation-briefing"

DISCLAIMER = {
    "en": "Planning aid only — NOT an official METAR/TAF. Check IMD aviation bulletins before flight.",
    "hi": "केवल योजना-सहायता के लिए — यह कोई आधिकारिक METAR/TAF नहीं है। उड़ान से पहले IMD के विमानन बुलेटिन अवश्य देखें।",
    "te": "ప్రణాళిక సహాయం మాత్రమే — ఇది అధికారిక METAR/TAF కాదు. విమానం ముందు IMD విమానయాన బులెటిన్లను తప్పనిసరిగా చూడండి.",
}

_LEVELS = (850, 700, 500)


def _lang(lang: str) -> str:
    return lang if lang in ("en", "hi", "te") else "en"


def _official_only() -> bool:
    return config.current_source_mode() == "imd"


def _compass(deg: float | None) -> str | None:
    if deg is None:
        return None
    pts = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
           "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"]
    return pts[int((float(deg) + 11.25) // 22.5) % 16]


def _unavailable(section: str, reason: str) -> dict:
    return {"section": section, "status": "UNAVAILABLE", "reason": reason,
            "provenance": "UNAVAILABLE"}


def _fetch_error_reason(inputs: dict | None) -> str | None:
    """The feed died (or was withheld): name it. Never synthesize around it."""
    if not isinstance(inputs, dict):
        return "meteorology feed unreachable"
    return inputs.get("_fetch_error")


def _demo_fixture() -> dict:
    """Labelled sample data for demo mode. Deterministic and clearly marked —
    never presented as live numbers."""
    def _lvl(p: int) -> dict:
        return {"level_hpa": p, "wind_speed_kt": 12 + p // 100,
                "wind_direction_deg": 250, "wind_from": "WSW",
                "temperature_c": None, "relative_humidity_pct": None}

    return {
        "source": "DEMO fixture", "model": "GFS (demo sample)",
        "levels_now": [_lvl(1000), _lvl(850), _lvl(700), _lvl(500)],
        "levels_plus6h": [_lvl(1000), _lvl(850), _lvl(700), _lvl(500)],
        "visibility_m": 9000, "cloud_cover_low_pct": 25,
        "cloud_cover_mid_pct": 40, "cloud_cover_high_pct": 10,
        "sunrise": "06:05", "sunset": "18:35",
        "demo": True,
        "note": "Sample data for demo — not real observations.",
    }


async def _fetch_inputs(lat: float, lon: float) -> dict:
    if config.DEMO_MODE:
        return _demo_fixture()
    if _official_only():
        # imd mode: GFS/Open-Meteo is non-official. Never backfill — every
        # meteorology section below will report UNAVAILABLE with this reason.
        raise AdapterUnavailable(
            "imd mode: non-official meteorology withheld (GFS/Open-Meteo is not IMD)")
    data, _ = await openmeteo_adapter.get_aviation_inputs(lat, lon)
    return data


# ---------------------------------------------------------------------------
# Pure section builders (no I/O). Deterministic: same input -> same output.
# ---------------------------------------------------------------------------

def _section_winds(inputs: dict, official_only: bool) -> dict:
    if official_only:
        return _unavailable("winds_aloft",
                            "imd mode: non-official data withheld — official aviation sources only")
    err = _fetch_error_reason(inputs)
    if err:
        return _unavailable("winds_aloft", err)
    inputs = inputs or {}
    prov = "DEMO" if inputs.get("demo") else "Open-Meteo (GFS gfs_seamless)"

    def _row(p: int, key: str) -> dict | None:
        levels = inputs.get(key) or []
        hit = next((l for l in levels if l.get("level_hpa") == p), None)
        if hit is None:
            return None
        spd, deg = hit.get("wind_speed_kt"), hit.get("wind_direction_deg")
        if spd is None and deg is None:
            return None  # level missing from the feed — say so, don't pad
        return {"level_hpa": p, "wind_speed_kt": spd,
                "wind_direction_deg": deg, "wind_from": _compass(deg)}

    now = [_row(p, "levels_now") for p in _LEVELS]
    plus6 = [_row(p, "levels_plus6h") for p in _LEVELS]
    if all(r is None for r in (*now, *plus6)):
        return _unavailable("winds_aloft",
                            "GFS pressure-level winds missing from the feed")
    return {
        "section": "winds_aloft", "status": "OK", "provenance": prov,
        "data": {"now": now, "plus_6h": plus6},
        "note": "GFS model winds, not IMD aviation observations.",
    }


def _section_cloud(inputs: dict, official_only: bool) -> dict:
    if official_only:
        return _unavailable("cloud",
                            "imd mode: non-official data withheld — official aviation sources only")
    err = _fetch_error_reason(inputs)
    if err:
        return _unavailable("cloud", err)
    inputs = inputs or {}
    prov = "DEMO" if inputs.get("demo") else "Open-Meteo (GFS gfs_seamless)"
    vals = {k: inputs.get(k) for k in
            ("cloud_cover_low_pct", "cloud_cover_mid_pct", "cloud_cover_high_pct")}
    if all(v is None for v in vals.values()):
        return _unavailable("cloud", "cloud-cover layers missing from the feed")
    return {
        "section": "cloud", "status": "OK", "provenance": prov,
        "data": vals,
        # Explicit: a cover percentage is a proxy, never a measured ceiling.
        "proxy": True,
        "note": "Cloud cover is a proxy — NOT a measured ceiling. No measured cloud-base data available.",
    }


def _section_visibility(inputs: dict, official_only: bool) -> dict:
    if official_only:
        return _unavailable("visibility",
                            "imd mode: non-official data withheld — official aviation sources only")
    err = _fetch_error_reason(inputs)
    if err:
        return _unavailable("visibility", err)
    inputs = inputs or {}
    prov = "DEMO" if inputs.get("demo") else "Open-Meteo (GFS gfs_seamless)"
    vis = inputs.get("visibility_m")
    if vis is None:
        return _unavailable("visibility", "visibility value missing from the feed")
    return {
        "section": "visibility", "status": "OK", "provenance": prov,
        "data": {"visibility_m": vis},
        "proxy": True,
        "note": "Forecast visibility — a proxy, NOT a measured RVR.",
    }


def _vector_shear(a: dict | None, b: dict | None) -> float | None:
    """Vertical wind shear magnitude (kt) between two level dicts."""
    try:
        if not a or not b:
            return None
        sa, da = a.get("wind_speed_kt"), a.get("wind_direction_deg")
        sb, db = b.get("wind_speed_kt"), b.get("wind_direction_deg")
        if None in (sa, da, sb, db):
            return None
        # u/v point in the wind-to direction (meteorological "from" + 180)
        dux = math.cos(math.radians(90 - db)) * sb - math.cos(math.radians(90 - da)) * sa
        duy = math.sin(math.radians(90 - db)) * sb - math.sin(math.radians(90 - da)) * sa
        return round(math.hypot(dux, duy), 1)
    except (TypeError, ValueError):
        return None


def _section_turbulence_icing(inputs: dict, official_only: bool) -> dict:
    """Turbulence/icing only when the data supports it.

    Real inputs available: wind shear between 850 and 500 hPa (computed from
    real level winds), temperature/RH profile. A full turbulence or icing
    assessment (pilot reports, SIGMETs, microphysics) is NOT available, so
    both stay labelled coarse proxies / honest gaps — never official grades."""
    if official_only:
        return _unavailable("turbulence_icing",
                            "imd mode: non-official data withheld — official aviation sources only")
    err = _fetch_error_reason(inputs)
    if err:
        return _unavailable("turbulence_icing", err)
    inputs = inputs or {}
    levels = inputs.get("levels_now") or []
    by_p = {l.get("level_hpa"): l for l in levels if isinstance(l, dict)}
    shear = _vector_shear(by_p.get(850), by_p.get(500))
    if shear is None:
        # GFS levels missing entirely — the honest answer.
        return _unavailable("turbulence_icing",
                            "insufficient data for turbulence/icing assessment "
                            "(GFS pressure-level winds missing)")

    # Coarse proxy from real shear, labelled as such. Thresholds are a crude
    # screening rule, never an official turbulence category.
    proxy_band = "low" if shear < 15 else ("moderate" if shear <= 25 else "elevated")

    # Freezing-level proxy: first level pair straddling 0°C, interpolated.
    temps = [(p, (by_p.get(p) or {}).get("temperature_c")) for p in (1000, 850, 700, 500)]
    freezing = None
    for (p1, t1), (p2, t2) in zip(temps, temps[1:]):
        if t1 is not None and t2 is not None and t1 * t2 < 0:
            frac = abs(t1) / (abs(t1) + abs(t2))
            freezing = {"between_hpa": [p1, p2], "interp_fraction": round(frac, 2)}
            break

    return {
        "section": "turbulence_icing", "status": "OK",
        "provenance": "DEMO" if inputs.get("demo") else "Open-Meteo (GFS gfs_seamless)",
        "data": {
            "wind_shear_850_500_kt": shear,
            "turbulence_proxy_band": proxy_band,
            "freezing_level_proxy": freezing,
        },
        "proxy": True,
        "note": ("Turbulence is a coarse proxy from vertical wind shear only, "
                 "not an official turbulence forecast. Icing: insufficient data "
                 "for a real icing assessment — temperature profile shown for "
                 "context; check IMD aviation bulletins."),
    }


def _section_sun(inputs: dict, official_only: bool) -> dict:
    if official_only:
        return _unavailable("sun",
                            "imd mode: non-official data withheld — official aviation sources only")
    err = _fetch_error_reason(inputs)
    if err:
        return _unavailable("sun", err)
    inputs = inputs or {}
    prov = "DEMO" if inputs.get("demo") else "Open-Meteo"
    sr, ss = inputs.get("sunrise"), inputs.get("sunset")
    if sr is None and ss is None:
        return _unavailable("sun", "sunrise/sunset missing from the feed")
    return {
        "section": "sun", "status": "OK", "provenance": prov,
        "data": {"sunrise": sr, "sunset": ss},
    }


async def _section_alerts(lat: float, lon: float, official_only: bool) -> dict:
    """Active official alerts + the single authoritative verdict.

    gather_alerts honours source mode itself (force_official_only in imd
    mode); build_verdict decides the level once. Severity passes through —
    the briefing never re-grades."""
    loc = LocationService().resolve(lat, lon)
    gathered = await alert_service.gather_alerts(
        lat=lat, lon=lon, district=loc.get("district", ""),
        state=loc.get("state", ""), force_official_only=official_only)
    verdict = build_verdict(
        cap_alerts=gathered.get("relevant"),
        nearby_alerts=gathered.get("nearby"),
        warning_service_available=bool(gathered.get("available", True)))

    def _summary(a: dict) -> dict:
        return {
            "identifier": a.get("identifier"),
            "headline": a.get("headline") or a.get("event") or a.get("title"),
            "severity": a.get("severity"),  # backend-authoritative, never touched
            "event": a.get("event"),
            "area": a.get("area") or a.get("area_desc"),
            "source": a.get("source"),
            "provenance": a.get("provenance"),
        }

    return {
        "section": "alerts", "status": "OK",
        "provenance": gathered.get("provenance", "UNAVAILABLE"),
        "data": {
            "verdict": verdict,
            "relevant": [_summary(a) for a in gathered.get("relevant", [])],
            "nearby": [_summary(a) for a in gathered.get("nearby", [])],
            "feeds_answered": bool(gathered.get("available", False)),
        },
    }


async def build_briefing(lat: float, lon: float, lang: str = "en") -> dict:
    """Assemble the briefing. The two I/O passes run CONCURRENTLY
    (asyncio.gather); concurrency never changes provenance semantics."""
    language = _lang(lang)
    only_official = _official_only()
    loc = LocationService().resolve(lat, lon)

    # One meteorology fetch + the alert gather, concurrently. Inputs drive the
    # pure section builders below; alert inputs come from the official chain.
    # A dead meteorology feed must not kill the briefing (or the alerts): it
    # becomes a named failure the sections report as UNAVAILABLE.
    try:
        inputs, alerts = await asyncio.gather(
            _fetch_inputs(lat, lon), _section_alerts(lat, lon, only_official),
        )
    except AdapterUnavailable as exc:
        inputs = {"_fetch_error": str(exc) or "meteorology feed unreachable"}
        alerts = await _section_alerts(lat, lon, only_official)

    sections = [
        _section_winds(inputs, only_official),
        _section_cloud(inputs, only_official),
        _section_visibility(inputs, only_official),
        _section_turbulence_icing(inputs, only_official),
        _section_sun(inputs, only_official),
        alerts,
    ]
    return {
        "status": "ok",
        "location": {"latitude": lat, "longitude": lon,
                     "district": loc.get("district"), "state": loc.get("state")},
        "lang": language,
        "sections": sections,
        "disclaimer": DISCLAIMER[language],
        "source": SOURCE,
        "mode": config.current_source_mode(),
    }
