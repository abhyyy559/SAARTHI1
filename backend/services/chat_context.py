"""Personal context for one chat turn: who is asking, about where and when, and
the weather detail their question actually needs.

Before this, the phrasing layer saw the role as one word and a daily rain total.
A fisherman asking "is the sea rough tomorrow?" got no wave data, a farmer asking
"can I spray this evening?" got no hourly wind or rain chance, and a question
about Chennai was answered for wherever the phone happened to be. Everything
here is fetched from the same keyless Open-Meteo service the rest of live mode
uses, rounded to plain words where it can be, and handed to the LLM as data.
"""
from __future__ import annotations

import re
from datetime import datetime

from .. import config
from ..adapters import openmeteo_adapter
from ..adapters.registry import AdapterUnavailable
from ..utils.time import IST

# --- Profile -------------------------------------------------------------------
# Free-text fields the Settings "About you" section can send. Whitelisted and
# length-capped: this text goes into an LLM prompt, so nothing else gets in.
PROFILE_FIELDS = {
    "name": 40,
    "crop": 60, "crop_stage": 30, "land": 40,
    "boat": 40, "trip": 30,
    "vehicle": 40, "route": 60,
    "aircraft": 40,
    "work_hours": 40,
    "health": 80,
    "notes": 200,
}
_CTRL = re.compile(r"[\x00-\x1f\x7f]+")


def clean_profile(profile) -> dict:
    """Known keys only, plain one-line strings, capped. Empty values dropped."""
    if not isinstance(profile, dict):
        return {}
    out = {}
    for key, cap in PROFILE_FIELDS.items():
        val = profile.get(key)
        if isinstance(val, (list, tuple)):
            val = ", ".join(str(v) for v in val if v)
        if not isinstance(val, str):
            continue
        val = _CTRL.sub(" ", val).strip()[:cap].strip()
        if val:
            out[key] = val
    return out


HISTORY_TURNS = 6          # messages, i.e. three question/answer pairs
HISTORY_CHARS = 400


def clean_history(history) -> list[dict]:
    """The last few turns as {role: user|assistant, text}, newest last."""
    if not isinstance(history, list):
        return []
    out = []
    for item in history[-HISTORY_TURNS:]:
        if not isinstance(item, dict):
            continue
        role = item.get("role")
        text = item.get("text")
        if role not in ("user", "assistant") or not isinstance(text, str):
            continue
        text = _CTRL.sub(" ", text).strip()[:HISTORY_CHARS]
        if text:
            out.append({"role": role, "text": text})
    return out


# --- When is the question about? ------------------------------------------------
# Ordered: "day after tomorrow" must win over "tomorrow", "tonight" over "today".
_TIME_WORDS = (
    ("day_after", ("day after tomorrow", "parso", "parson", "परसों", "ఎల్లుండి")),
    ("week", ("this week", "next week", "weekend", "next few days", "coming days",
              "next 5 days", "next five days", "हफ्ते", "हफ़्ते", "सप्ताह", "వారం")),
    ("tonight", ("tonight", "this night", "at night", "आज रात", "रात", "ఈ రాత్రి", "రాత్రి")),
    ("tomorrow", ("tomorrow", "tmrw", "kal ", "कल", "రేపు")),
    ("now", ("right now", "now", "currently", "at the moment", "अभी", "ఇప్పుడు")),
    ("today", ("today", "this morning", "this afternoon", "this evening", "aaj",
               "आज", "ఈరోజు", "ఈ రోజు")),
)


def time_focus(question: str) -> str:
    """'now' | 'today' | 'tonight' | 'tomorrow' | 'day_after' | 'week' | ''."""
    q = f" {(question or '').lower()} "
    for focus, words in _TIME_WORDS:
        for w in words:
            if re.match(r"[a-z]", w):
                if re.search(rf"(?<![a-z]){re.escape(w.strip())}(?![a-z])", q):
                    return focus
            elif w in q:
                return focus
    return ""


# --- Where is the question about? -----------------------------------------------
# English words that are also place names somewhere in the gazetteer. Matching
# them would move a question about "the sea" or "a nice day" to some district.
_PLACE_STOPWORDS = {
    "rain", "sea", "today", "tomorrow", "will", "what", "when", "where", "safe",
    "hot", "cold", "wind", "storm", "flood", "home", "farm", "field", "city",
    "town", "village", "road", "river", "coast", "beach", "port", "harbour",
    "north", "south", "east", "west", "central", "urban", "rural", "district",
}
_place_index: dict[str, dict] | None = None


def _index() -> dict[str, dict]:
    global _place_index
    if _place_index is None:
        from . import location_service as ls
        idx: dict[str, dict] = {}
        for entry in ls.GAZETTEER:
            for name in ls._names(entry):
                if len(name) >= 4 and name not in _PLACE_STOPWORDS:
                    idx.setdefault(name, entry)
        for alias, district in ls._ALIASES.items():
            hit = next((e for e in ls.GAZETTEER if e["district"] == district), None)
            if hit and len(alias) >= 3:
                idx.setdefault(alias, hit)
        _place_index = idx
    return _place_index


def place_in_text(text: str) -> dict | None:
    """The gazetteer entry a sentence names exactly, longest name first."""
    from .district_service import norm_name
    words = norm_name(text or "").split()
    idx = _index()
    for n in (3, 2, 1):
        for i in range(len(words) - n + 1):
            hit = idx.get(" ".join(words[i:i + n]))
            if hit:
                return dict(hit)
    return None


def place_for_turn(question: str, history: list[dict]) -> dict | None:
    """The place this turn asks about, when it is not the user's own.

    A short follow-up ("and tomorrow?") keeps the place the previous question
    named; a full new question without a place is about the user's location.
    """
    hit = place_in_text(question)
    if hit:
        return hit
    if len((question or "").split()) <= 6:
        for turn in reversed(history or []):
            if turn.get("role") == "user":
                return place_in_text(turn.get("text", ""))
    return None


# --- Plain words for the numbers -------------------------------------------------
def wind_words(kmh) -> str | None:
    if not isinstance(kmh, (int, float)):
        return None
    if kmh < 12:
        return "light"
    if kmh < 30:
        return "moderate"
    if kmh < 50:
        return "strong"
    if kmh < 62:
        return "very strong (near gale)"
    if kmh < 89:
        return "gale"
    return "storm force"


def sea_words(m) -> str | None:
    """WMO sea-state words for a significant wave height in metres."""
    if not isinstance(m, (int, float)):
        return None
    if m < 0.1:
        return "calm"
    if m < 0.5:
        return "smooth"
    if m < 1.25:
        return "slight"
    if m < 2.5:
        return "moderate"
    if m < 4:
        return "rough"
    if m < 6:
        return "very rough"
    return "high"


def uv_words(uv) -> str | None:
    if not isinstance(uv, (int, float)):
        return None
    if uv < 3:
        return "low"
    if uv < 6:
        return "moderate"
    if uv < 8:
        return "high"
    if uv < 11:
        return "very high"
    return "extreme"


# --- Detailed weather -----------------------------------------------------------
_HOURLY = ("temperature_2m,apparent_temperature,precipitation_probability,precipitation,"
           "weather_code,wind_speed_10m,wind_gusts_10m,visibility,uv_index,relative_humidity_2m")
_DAILY = ("weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,"
          "precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max,uv_index_max,"
          "sunrise,sunset")
MARINE_BASE = "https://marine-api.open-meteo.com/v1/marine"

# Parts of the day, as people talk about them. (start hour, end hour exclusive)
_PERIODS = (("morning", 5, 11), ("afternoon", 11, 16), ("evening", 16, 20), ("night", 20, 29))
# WMO codes ranked by how much they matter to someone outside.
_SEVERITY = {95: 9, 96: 9, 99: 9, 82: 8, 65: 7, 67: 7, 81: 6, 63: 5, 80: 4, 61: 3,
             55: 3, 53: 2, 51: 2, 45: 2, 48: 2, 3: 1, 2: 1, 1: 0, 0: 0}


def _r(v, nd=0):
    if not isinstance(v, (int, float)) or isinstance(v, bool):
        return None
    return int(round(v)) if nd == 0 else round(v, nd)


def _worst_code(codes) -> str | None:
    codes = [c for c in codes if isinstance(c, (int, float))]
    if not codes:
        return None
    worst = max(codes, key=lambda c: _SEVERITY.get(int(c), 1))
    return openmeteo_adapter._condition(worst)


def _summarise_period(rows: list[dict]) -> dict:
    def col(k):
        return [r[k] for r in rows if isinstance(r.get(k), (int, float))]
    temps, feels = col("temperature_2m"), col("apparent_temperature")
    wind, gust = col("wind_speed_10m"), col("wind_gusts_10m")
    vis, uv, prob, rain = col("visibility"), col("uv_index"), col("precipitation_probability"), col("precipitation")
    waves = col("wave_height")
    out = {
        "sky": _worst_code([r.get("weather_code") for r in rows]),
        "temp_c": [_r(min(temps)), _r(max(temps))] if temps else None,
        "feels_like_max_c": _r(max(feels)) if feels else None,
        "rain_chance_max_pct": _r(max(prob)) if prob else None,
        "rain_mm": _r(sum(rain), 1) if rain else None,
        "wind_max_kmh": _r(max(wind)) if wind else None,
        "wind_words": wind_words(max(wind)) if wind else None,
        "gust_max_kmh": _r(max(gust)) if gust else None,
        "visibility_min_km": _r(min(vis) / 1000, 1) if vis else None,
        "uv_max": _r(max(uv)) if uv else None,
        "uv_words": uv_words(max(uv)) if uv else None,
    }
    if waves:
        out["wave_max_m"] = _r(max(waves), 1)
        out["sea_words"] = sea_words(max(waves))
    return {k: v for k, v in out.items() if v is not None}


def _hourly_rows(data: dict, marine: dict | None) -> list[dict]:
    hourly = data.get("hourly") or {}
    times = hourly.get("time") or []
    keys = [k for k in hourly if k != "time"]
    waves = {}
    if marine:
        mh = marine.get("hourly") or {}
        waves = dict(zip(mh.get("time") or [], mh.get("wave_height") or []))
    rows = []
    for i, t in enumerate(times):
        row = {"time": t}
        for k in keys:
            vals = hourly.get(k) or []
            row[k] = vals[i] if i < len(vals) else None
        if t in waves:
            row["wave_height"] = waves[t]
        rows.append(row)
    return rows


def summarise(data: dict, marine: dict | None = None, now: datetime | None = None) -> dict:
    """Compact, plain-worded detail: parts of today/tomorrow/day after + 5-day outlook."""
    now = now or datetime.now(IST)
    rows = _hourly_rows(data, marine)
    by_day: dict[str, list[dict]] = {}
    for row in rows:
        try:
            ts = datetime.fromisoformat(row["time"])
        except (TypeError, ValueError):
            continue
        row["_ts"] = ts
        by_day.setdefault(ts.date().isoformat(), []).append(row)
    day_keys = sorted(by_day)
    labels = ["today", "tomorrow", "day after tomorrow"]
    periods = []
    for di, day in enumerate(day_keys[:3]):
        for name, start, end in _PERIODS:
            chunk = []
            for row in by_day[day]:
                h = row["_ts"].hour
                if start <= h < min(end, 24):
                    chunk.append(row)
            if end > 24 and di + 1 < len(day_keys):   # night runs past midnight
                chunk += [r for r in by_day[day_keys[di + 1]] if r["_ts"].hour < end - 24]
            # Parts of today that are already over are not a forecast.
            chunk = [r for r in chunk if r["_ts"].replace(tzinfo=IST) >= now.replace(minute=0, second=0, microsecond=0)]
            if not chunk:
                continue
            periods.append({"day": labels[di], "part": name, **_summarise_period(chunk)})

    daily = data.get("daily") or {}
    marine_daily = (marine or {}).get("daily") or {}
    wave_max = dict(zip(marine_daily.get("time") or [], marine_daily.get("wave_height_max") or []))
    outlook = []
    for i, d in enumerate((daily.get("time") or [])[:5]):
        def at(k):
            vals = daily.get(k) or []
            return vals[i] if i < len(vals) else None
        try:
            weekday = datetime.fromisoformat(d).strftime("%A")
        except ValueError:
            weekday = None
        item = {
            "date": d, "weekday": weekday,
            "sky": openmeteo_adapter._condition(at("weather_code")) if at("weather_code") is not None else None,
            "temp_c": [_r(at("temperature_2m_min")), _r(at("temperature_2m_max"))],
            "rain_mm": _r(at("precipitation_sum"), 1),
            "rain_chance_max_pct": _r(at("precipitation_probability_max")),
            "wind_max_kmh": _r(at("wind_speed_10m_max")),
            "wind_words": wind_words(at("wind_speed_10m_max")),
            "gust_max_kmh": _r(at("wind_gusts_10m_max")),
            "uv_max": _r(at("uv_index_max")),
            "sunrise": (at("sunrise") or "")[11:16] or None,
            "sunset": (at("sunset") or "")[11:16] or None,
        }
        if wave_max.get(d) is not None:
            item["wave_max_m"] = _r(wave_max[d], 1)
            item["sea_words"] = sea_words(wave_max[d])
        outlook.append({k: v for k, v in item.items() if v is not None})
    out = {"parts_of_day": periods, "outlook": outlook}
    if marine is not None:
        out["sea_data"] = "available" if wave_max or any("wave_max_m" in p for p in periods) else "not available for this point"
    return out


async def _marine(lat: float, lon: float) -> dict | None:
    from ..utils.upstream_cache import remember
    import httpx

    params = {"latitude": round(lat, 2), "longitude": round(lon, 2),
              "hourly": "wave_height", "daily": "wave_height_max",
              "forecast_days": 3, "timezone": "Asia/Kolkata"}

    async def fetch():
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.get(MARINE_BASE, params=params)
            resp.raise_for_status()
            return resp.json()

    try:
        return await remember(("open-meteo-marine",) + tuple(sorted(params.items())), 600, fetch)
    except Exception:
        return None


_SEA_WORDS = ("sea", "wave", "boat", "fish", "beach", "tide", "swell", "coast",
              "समुद्र", "लहर", "नाव", "मछली", "సముద్ర", "అల", "పడవ", "చేప")


def wants_sea(question: str, user_type: str) -> bool:
    q = (question or "").lower()
    return user_type == "fisherman" or any(w in q for w in _SEA_WORDS)


async def weather_detail(lat: float, lon: float, *, marine: bool = False) -> dict | None:
    """Hourly-derived detail for the answer, or None when it cannot be fetched.

    Only in live modes that may use Open-Meteo: demo mode answers from its
    fixtures, and imd mode serves official facts or nothing (SOURCE-MODES.md).
    """
    mode = config.current_source_mode()
    if config.DEMO_MODE or mode in ("demo", "imd"):
        return None
    try:
        data = await openmeteo_adapter._fetch({
            "latitude": lat, "longitude": lon, "hourly": _HOURLY, "daily": _DAILY,
            "timezone": "Asia/Kolkata", "forecast_days": 5,
        })
    except AdapterUnavailable:
        return None
    sea = await _marine(lat, lon) if marine else None
    if marine and sea is None:
        sea = {}
    try:
        return summarise(data, sea if marine else None)
    except Exception:
        return None


def trim_detail(detail: dict | None, focus: str = "") -> dict | None:
    """Only the parts of the day the question is about.

    The prompt is billed per token against a small per-minute budget, so a
    question about tonight does not carry the day after tomorrow.
    """
    if not detail:
        return detail
    keep_days = {
        "now": ("today",), "today": ("today",), "tonight": ("today",),
        "tomorrow": ("tomorrow",), "day_after": ("day after tomorrow",), "week": (),
    }.get(focus, ("today", "tomorrow"))
    parts = [p for p in detail.get("parts_of_day") or [] if p.get("day") in keep_days]
    if focus in ("now", "today", "tonight"):
        # Overnight and early-morning questions run into tomorrow morning.
        parts += [p for p in detail.get("parts_of_day") or []
                  if p.get("day") == "tomorrow" and p.get("part") == "morning"]
    outlook = detail.get("outlook") or []
    out = {**detail, "parts_of_day": parts,
           "outlook": outlook if focus in ("week", "day_after") else outlook[:3]}
    return out


def detail_numbers(detail: dict | None) -> list[float]:
    """Every number in the detail, so the response validator accepts them."""
    out: list[float] = []

    def walk(v):
        if isinstance(v, bool):
            return
        if isinstance(v, (int, float)):
            out.append(float(v))
        elif isinstance(v, dict):
            for x in v.values():
                walk(x)
        elif isinstance(v, list):
            for x in v:
                walk(x)
    walk(detail or {})
    return out


# --- What matters to whom --------------------------------------------------------
PERSONA_FOCUS = {
    "general": "daily plans: rain timing, heat or cold, wind, umbrella/clothing, and safety warnings.",
    "farmer": ("field work: rain amount and timing (sowing, irrigation, harvest), wind and rain chance for "
               "spraying (spray only in calm, dry hours), heat stress for crops and animals, and storage "
               "of harvested produce."),
    "fisherman": ("going to sea: wind and gusts, sea state and wave height, storms and lightning, visibility, "
                  "and official sea warnings. Never call the sea safe when wind is strong, waves are "
                  "rough or worse, or a warning is in force."),
    "driver": ("the road: heavy rain and waterlogging, fog and visibility, strong cross-winds, storms, and "
               "the safest time window to drive."),
    "aviation": ("flying: surface wind and gusts, visibility, cloud and thunderstorms. Planning help only, "
                 "never a replacement for an official METAR/TAF briefing."),
    "commuter": "the commute: rain and waterlogging at commute times (morning and evening), heat, and delays.",
    "employee": "getting to and from work, rain at commute times, heat, and whether to plan for delays.",
    "outdoor-worker": ("working outside: heat and feels-like temperature, UV, lightning and storms, and the "
                       "safest hours to work and rest."),
    "student": "school travel: rain at school times, heat, and outdoor activities.",
    "researcher": ("exact values, ranges, timings and data limits; more numbers are fine, and say where data "
                   "is missing."),
    "disaster_manager": ("official warnings first, then hazards by time (heavy rain, wind, waves, heat), and "
                         "where conditions may get worse."),
}

# Personas that may see more numbers than the plain two.
NUMERIC_PERSONAS = {"researcher", "aviation", "disaster_manager", "fisherman"}
