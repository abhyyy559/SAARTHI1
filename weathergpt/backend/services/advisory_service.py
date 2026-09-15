"""Advisory engine — persona-specific guidance from verified facts. No unsupported claims."""
PERSONA_ADVISORIES = {
    "general": "Avoid waterlogged roads and follow local authority instructions.",
    "farmer": "Monitor field drainage and protect harvested produce from exposure.",
    "driver": "Check road conditions before travelling and avoid flooded roads.",
    "fisherman": "Avoid venturing into the sea during active warnings and follow marine bulletins.",
}


def advisory_for(verified: dict, user_type: str) -> str:
    base = PERSONA_ADVISORIES.get(user_type, PERSONA_ADVISORIES["general"])
    if not verified.get("verified"):
        return "No active official warning was found for your area. Continue following regular weather updates."
    if verified.get("severity") in ("RED", "ORANGE"):
        return f"{base} {verified.get('hazard', 'Severe weather')} is indicated — stay alert."
    return base