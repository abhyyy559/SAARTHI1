"""Rule-based risk engine. Never mutates official severity; labels output 'WeatherGPT Risk'."""
from ..rules.weather_rules import HAZARD_CONTEXT  # noqa: F401 (kept for future scoring)

SEVERITY_WEIGHT = {"GREEN": 0, "YELLOW": 1, "ORANGE": 2, "RED": 3}
USER_EXPOSURE = {"general": 1, "farmer": 2, "driver": 2, "fisherman": 3}


class RiskService:
    def risk(self, verified: dict, user_type: str) -> dict:
        if verified.get("warning_service") == "unavailable":
            return {"level": "UNKNOWN", "hazard": "", "official_severity": None,
                    "source": "WEATHERGPT"}
        severity = verified.get("severity", "GREEN")
        base = SEVERITY_WEIGHT.get(severity, 0)
        exposure = USER_EXPOSURE.get(user_type, 1)
        score = base * exposure

        if base == 0:
            level = "LOW"
        elif severity == "RED":
            level = "CRITICAL"  # RED is take-action for everyone, any persona
        elif base == 2:
            level = "HIGH" if score <= 4 else "CRITICAL"  # ORANGE minimum HIGH
        elif score <= 2:
            level = "MODERATE"
        elif score <= 4:
            level = "HIGH"
        else:
            level = "CRITICAL"

        return {
            "level": level,
            "hazard": verified.get("hazard", ""),
            "official_severity": severity,
            "source": "WEATHERGPT",
        }