"""Multi-source alert chain — shape contract and failure behavior. Pure, no network."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import asyncio  # noqa: E402

from backend.adapters import alert_sources as asc  # noqa: E402


def test_mk_alert_matches_cap_shape():
    a = asc._mk_alert(
        source=asc.SOURCE_BY_NAME["gdacs"], identifier="gdacs-1-2",
        hazard="FL Flood in India", severity="ORANGE",
        headline="Orange Flood in India", message="Flood in India",
        instruction="Follow official guidance.", area="India",
        effective="2026-09-16T01:00:00", expires="2026-09-17T01:00:00",
    )
    # Every field the AlertCenter card and relevance filter rely on must exist.
    for field in ("source", "identifier", "hazard", "severity", "headline",
                  "message", "instruction", "areaDesc", "area", "effective",
                  "expires", "issued_at", "cap_severity"):
        assert field in a, field
    assert a["severity"] in ("RED", "ORANGE", "YELLOW", "GREEN")
    assert a["areaDesc"] == "India"
    print("PASS: test_mk_alert_matches_cap_shape")


def test_chain_never_raises_and_reports_unavailable(monkeypatch):
    # All sources failing -> ([], UNAVAILABLE), never an exception.
    async def boom(lat, lon, district):
        raise RuntimeError("network down")
    for name in ("_from_weatherintouch", "_from_weatherapi", "_from_gdacs"):
        monkeypatch.setattr(asc, name, boom)
    alerts, prov = asyncio.run(asc.get_alerts(17.385, 78.4867, "Hyderabad"))
    assert alerts == []
    assert prov == "UNAVAILABLE"
    print("PASS: test_chain_never_raises_and_reports_unavailable")


def test_chain_first_source_with_alerts_wins(monkeypatch):
    # InTouch fails, WeatherAPI returns alerts -> chain stops there, LIVE provenance.
    async def boom(lat, lon, district):
        raise RuntimeError("down")
    async def hit(lat, lon, district):
        return [asc._mk_alert(
            source=asc.SOURCE_BY_NAME["weatherapi"], identifier="wapi-1",
            hazard="Flood warning", severity="ORANGE", headline="Flood",
            message="Flood warning", instruction="Move up.", area="Hyderabad",
            effective="2026-09-17T10:00:00", expires="2026-09-18T10:00:00")]
    monkeypatch.setattr(asc, "_from_weatherintouch", boom)
    monkeypatch.setattr(asc, "_from_weatherapi", hit)
    alerts, prov = asyncio.run(asc.get_alerts(17.385, 78.4867, "Hyderabad"))
    assert prov == "LIVE" and len(alerts) == 1 and alerts[0]["source"].endswith("WeatherAPI.com")
    print("PASS: test_chain_first_source_with_alerts_wins")


def test_gdacs_distance_filter():
    # A feature 30 degrees away must be filtered out (not the user's alert).
    far = {
        "geometry": {"coordinates": [40.0, 50.0]},
        "properties": {"eventid": 1, "episodeid": 1, "eventtype": "FL",
                       "alertlevel": "Orange", "eventname": "Flood", "country": "India"},
    }
    import backend.adapters.alert_sources as m

    async def run():
        return await m._from_gdacs(17.385, 78.4867, "Hyderabad")

    class FakeResp:
        def raise_for_status(self): pass
        def json(self): return {"features": [far]}

    class FakeClient:
        def __init__(self, *a, **k): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
        async def get(self, *a, **k): return FakeResp()

    orig = m.httpx.AsyncClient
    m.httpx.AsyncClient = FakeClient
    try:
        alerts = asyncio.run(run())
    finally:
        m.httpx.AsyncClient = orig
    assert alerts == [], "far-away events must not become user alerts"
    print("PASS: test_gdacs_distance_filter")


if __name__ == "__main__":
    test_mk_alert_matches_cap_shape()
    test_chain_never_raises_and_reports_unavailable(None)
    test_chain_first_source_with_alerts_wins(None)
    test_gdacs_distance_filter()
    print("\nAll alert source tests passed.")
