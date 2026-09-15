"""Intent/entity extraction — structure-only, never answers the question."""
RAIN_WORDS_EN = ["rain", "rainy", "rainfall", "downpour", "shower", "wet"]
STORM_WORDS_EN = ["storm", "thunder", "lightning", "wind", "cyclone", "hail"]
HOT_WORDS_EN = ["hot", "heat", "warm", "temperature"]

_HAZARD_ALIASES = {
    "rain": RAIN_WORDS_EN,
    "thunderstorm": STORM_WORDS_EN,
    "heat": HOT_WORDS_EN,
}


class WeatherRules:
    def parse(self, message: str) -> dict:
        text = message.lower()

        has_rain = any(w in text for w in RAIN_WORDS_EN)
        has_storm = any(w in text for w in STORM_WORDS_EN)
        has_current = any(w in text for w in ["current", "now", "today", "present", "temp", "temperature"])

        if "travel" in text or "trip" in text or "drive" in text or "road" in text:
            intent = "travel_risk"
        elif has_storm:
            intent = "warning"
        elif has_rain or has_current:
            intent = "forecast" if "tomorrow" in text or "later" in text or "week" in text else "current"
        elif "danger" in text or "alert" in text or "warning" in text:
            intent = "warning"
        else:
            intent = "current"

        time = "tomorrow" if "tomorrow" in text else ("today" if "today" in text else ("morning" if "morning" in text else "now"))

        hazard = None
        for name, words in _HAZARD_ALIASES.items():
            if any(w in text for w in words):
                hazard = name
                break

        return {"intent": intent, "time": time, "hazard": hazard}


HAZARD_CONTEXT = {"rain": "Rain", "thunderstorm": "Thunderstorm", "heat": "Heat"}