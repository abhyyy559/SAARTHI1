"""Regression tests for production findings (Sept 2026 verification).

1. Coastal gazetteer: Visakhapatnam must resolve to itself, not snap to Warangal.
2. Weather fallback: when Open-Meteo is rate-limited (HTTP 429), the chain falls
   back to OpenWeatherMap instead of returning UNAVAILABLE.
3. Voice contract: the server stores what it reads - frontend sends 'file',
   Sarvam expects 'audio' - the adapter must bridge, and transcribe must work.
"""
import asyncio
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from backend.services.location_service import LocationService  # noqa: E402


def test_vizag_resolves_to_vizag():
    loc = LocationService().resolve(17.6868, 83.2185)
    assert loc["district"] == "Visakhapatnam", f"coastal snap bug: got {loc['district']}"


def test_coastal_districts_present():
    names = {e["district"] for e in __import__(
        "backend.services.location_service", fromlist=["GAZETTEER"]).GAZETTEER}
    for coastal in ("Visakhapatnam", "Kakinada", "Krishna", "Nellore", "Kerala"):
        assert coastal in names, f"missing coastal district: {coastal}"


def test_owm_fallback_on_openmeteo_429(monkeypatch):
    """Open-Meteo 429 -> AdapterUnavailable -> OWM current fills in (LIVE)."""
    from backend.adapters import openmeteo_adapter, owm_adapter
    from backend.adapters.registry import AdapterUnavailable

    async def om_fail(lat, lon):
        raise AdapterUnavailable("open-meteo unreachable: 429 Too Many Requests")

    async def owm_ok(lat, lon):
        from backend.models.weather import WeatherObservation
        from backend.utils.time import now_ist
        obs = WeatherObservation(source="OpenWeatherMap", temperature=28.0,
                                 humidity=70.0, rainfall=0.0, wind_speed=12.0,
                                 condition="Clear", observed_at=now_ist())
        return obs, "LIVE"

    monkeypatch.setattr(openmeteo_adapter, "get_current", om_fail)
    monkeypatch.setattr(owm_adapter, "get_current", owm_ok)
    from backend.api.weather import _live_current
    data, prov = asyncio.run(_live_current(17.6868, 83.2185))
    assert prov == "LIVE", f"expected OWM LIVE fallback, got {prov}"
    assert data.get("source") == "OpenWeatherMap"


def test_transcribe_accepts_frontend_file_field(monkeypatch):
    """Contract: the endpoint accepts multipart field 'file' (what the web app sends)
    and reaches the STT provider. No external call: key is monkeypatched away,
    so a well-formed request yields the honest browser-fallback response."""
    from fastapi.testclient import TestClient
    from backend.main import app
    import backend.config as cfg

    monkeypatch.setattr(cfg, "SARVAM_API_KEY", "")
    client = TestClient(app)
    r = client.post("/api/voice/transcribe",
                    files={"file": ("speech.webm", b"fake-bytes", "audio/webm")},
                    data={"language": "te"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["provider"] == "browser-fallback" and body["using_browser_speech"] is True


if __name__ == "__main__":
    test_coastal_districts_present()
    test_owm_fallback_on_openmeteo_429(None)
    test_transcribe_accepts_frontend_file_field(None)
    print("all new regression tests passed")
