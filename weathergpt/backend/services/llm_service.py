"""Grounded LLM service — builds evidence package, then composes a grounded answer.
LLM is rehearsal/delivery layer only. Rule-based template guarantees no invention when no LLM key."""
import textwrap
from .. import config

SYSTEM_RULES = textwrap.dedent(
    """\
    You are the conversational intelligence layer of WeatherGPT.
    Use only verified backend information for weather facts.
    Do not invent weather observations, forecasts or warnings.
    Do not create emergency warnings.
    Do not modify official warning severity.
    Do not claim that a warning exists unless the verified backend contains an active warning.
    Always distinguish between:
    1. Official meteorological information.
    2. WeatherGPT interpretation/advisory.
    If information is unavailable, stale or incomplete, say so.
    Always prioritize the latest valid authoritative information.
    When discussing an emergency warning, include: hazard, affected location, validity, source.
    When appropriate, provide practical actions.
    Never present AI-generated advice as an official government instruction.
    """
)


def build_evidence_package(*, location: dict, current: dict, forecast: dict, verified: dict, risk: dict, user_type: str) -> dict:
    return {
        "source": "IMD",
        "source_type": ["current_observation", "city_forecast", "district_warning"],
        "location": location,
        "current_weather": current,
        "forecast": forecast,
        "verified_warning": verified,
        "weathergpt_risk": risk.get("level"),
        "user_type": user_type,
    }


class LLMService:
    def __init__(self) -> None:
        self.enabled = bool(config.LLM_API_KEY)
        # NOTE: no external SDK import — keep demo self-contained.

    def generate_grounded_response(self, evidence: dict) -> tuple[str, bool]:
        """Return (answer, structured_fallback). Never fabricates data."""
        verified = evidence.get("verified_warning", {})
        current = evidence.get("current_weather", {})
        forecast = evidence.get("forecast", {})
        risk = evidence.get("weathergpt_risk", "LOW")
        location_name = evidence.get("location", {}).get("city") or evidence.get("location", {}).get("district")
        loc = location_name or "your area"
        user_type = evidence.get("user_type", "general")
        src = evidence.get("source_name", evidence.get("source", "IMD"))

        days = forecast.get("days") or []
        tomorrow = days[1] if len(days) > 1 else (days[0] if days else {})
        fc_rain = tomorrow.get("rainfall")
        fc_min = tomorrow.get("min_temperature")
        fc_max = tomorrow.get("max_temperature")

        lines = []
        warn = verified.get("verified", False)

        if warn:
            lines.append(
                f"There is an active official warning for {loc}: {verified.get('severity')} — {verified.get('hazard')}."
            )
            if verified.get("valid_until"):
                lines.append(f"It is valid until {verified.get('valid_until')}.")
        else:
            lines.append(f"No active severe weather warning was found for {loc}.")

        if fc_rain is not None and fc_rain > 0:
            lines.append(f"Rain is possible tomorrow in {loc} according to the latest {src} forecast (expected rainfall: {fc_rain} mm).")
        elif fc_rain == 0:
            lines.append(f"The {src} forecast shows no significant rainfall expected tomorrow.")
        else:
            lines.append("Tomorrow's forecast rainfall information is not available from the current data.")

        if fc_min is not None and fc_max is not None:
            lines.append(f"Tomorrow's temperature range: {fc_min}–{fc_max}°C.")

        if warn:
            lines.append(
                "What you can do: stay alert, follow local authority instructions, and avoid exposed areas during the warning period."
            )

        lines.append(f"WeatherGPT Risk Interpretation for you ({user_type}): {risk}.")
        lines.append("This is our interpretation, not an IMD rating.")

        answer = " ".join(lines)
        return answer, not self.enabled