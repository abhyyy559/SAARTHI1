"""The alert gatherer is shared, so chat and the Alerts page cannot diverge.

The bug this guards: `api/weather.py` merged the commercial chain
(InTouch → WeatherAPI → GDACS) on top of SACHET/CAP, but `api/chat.py` called
`cap_adapter` directly. The Alerts page could therefore list an alert that the
chat verdict had never seen, and the two screens could disagree about how
dangerous the day was. Severity is decided once; its inputs are gathered once.

Pure — no network. `warning_relevant` is the real one, so the classification
assertions exercise the actual district/state logic.
"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import asyncio  # noqa: E402

from backend.adapters import alert_sources as asc  # noqa: E402
from backend.services import alert_service  # noqa: E402

HYD = dict(lat=17.385, lon=78.4867, district="Hyderabad", state="Telangana")


def _alert(identifier, area, severity="ORANGE"):
    return {
        "source": "TEST", "identifier": identifier, "areaDesc": area, "area": area,
        "severity": severity, "hazard": "Heavy Rain", "headline": f"Heavy Rain in {area}",
        "message": "Heavy rain expected.", "instruction": "Follow official guidance.",
        "effective": "2026-09-17T10:00:00", "expires": "2026-09-17T20:00:00",
        "issued_at": "2026-09-17T10:00:00", "cap_severity": severity,
    }


def _wire(monkeypatch, cap, chain, cap_prov="LIVE", chain_prov="LIVE"):
    async def fake_cap():
        return cap, cap_prov
    async def fake_chain(lat, lon, district):
        return chain, chain_prov
    monkeypatch.setattr(alert_service.cap_adapter, "fetch_alerts", fake_cap)
    monkeypatch.setattr(asc, "get_alerts", fake_chain)


def test_chain_alerts_are_merged_not_dropped(monkeypatch):
    # CAP has one alert for our district; the chain has one we have never seen.
    _wire(monkeypatch,
          cap=[_alert("cap-1", "Hyderabad")],
          chain=[_alert("chain-1", "Hyderabad")])
    got = asyncio.run(alert_service.gather_alerts(**HYD))
    ids = {a["identifier"] for a in got["relevant"]}
    assert ids == {"cap-1", "chain-1"}, ids
    assert alert_service.CAP_SOURCE in got["feeds"]
    assert alert_service.CHAIN_SOURCE in got["feeds"]
    print("PASS: test_chain_alerts_are_merged_not_dropped")


def test_same_alert_from_two_feeds_is_not_double_counted(monkeypatch):
    _wire(monkeypatch,
          cap=[_alert("dup-1", "Hyderabad")],
          chain=[_alert("dup-1", "Hyderabad")])
    got = asyncio.run(alert_service.gather_alerts(**HYD))
    assert len(got["relevant"]) == 1, [a["identifier"] for a in got["relevant"]]
    print("PASS: test_same_alert_from_two_feeds_is_not_double_counted")


def test_missing_identifier_is_not_treated_as_a_match(monkeypatch):
    # A blank identifier is not evidence of sameness. De-duplicating on None
    # would silently collapse several distinct alerts into one.
    _wire(monkeypatch,
          cap=[_alert(None, "Hyderabad"), _alert(None, "Hyderabad")],
          chain=[])
    got = asyncio.run(alert_service.gather_alerts(**HYD))
    assert len(got["relevant"]) == 2, [a["identifier"] for a in got["relevant"]]
    print("PASS: test_missing_identifier_is_not_treated_as_a_match")


def test_relevant_nearby_and_dropped_are_separated(monkeypatch):
    _wire(monkeypatch,
          cap=[_alert("mine", "Hyderabad"),
               _alert("state", "Telangana State"),
               _alert("elsewhere", "Kerala")],
          chain=[])
    got = asyncio.run(alert_service.gather_alerts(**HYD))
    assert [a["identifier"] for a in got["relevant"]] == ["mine"]
    # Same state but not confirmed for this district -> context, never a calm.
    assert [a["identifier"] for a in got["nearby"]] == ["state"]
    assert all(a["identifier"] != "elsewhere" for a in got["relevant"] + got["nearby"])
    print("PASS: test_relevant_nearby_and_dropped_are_separated")


def test_every_alert_carries_its_own_provenance(monkeypatch):
    # So a screen can label each row with where THAT alert came from, instead of
    # one blanket source over a mixed list.
    _wire(monkeypatch,
          cap=[_alert("cap-1", "Hyderabad")],
          chain=[_alert("chain-1", "Hyderabad")],
          cap_prov="LIVE", chain_prov="CACHED")
    got = asyncio.run(alert_service.gather_alerts(**HYD))
    provs = {a["identifier"]: a["provenance"] for a in got["relevant"]}
    assert provs == {"cap-1": "LIVE", "chain-1": "CACHED"}, provs
    print("PASS: test_every_alert_carries_its_own_provenance")


def test_imd_mode_skips_the_commercial_chain_entirely(monkeypatch):
    # imd mode is official-only (docs/SOURCE-MODES.md): IMD + SACHET/CAP, nothing
    # commercial. The chain must not even be called.
    called = []

    async def fake_cap():
        return [_alert("cap-1", "Hyderabad")], "LIVE"

    async def fake_chain(lat, lon, district):
        called.append(True)
        return [_alert("chain-1", "Hyderabad")], "LIVE"

    monkeypatch.setattr(alert_service.cap_adapter, "fetch_alerts", fake_cap)
    monkeypatch.setattr(asc, "get_alerts", fake_chain)

    got = asyncio.run(alert_service.gather_alerts(force_official_only=True, **HYD))
    assert called == [], "the commercial chain must not run in imd mode"
    assert [a["identifier"] for a in got["relevant"]] == ["cap-1"]
    assert alert_service.CHAIN_SOURCE not in got["feeds"]
    print("PASS: test_imd_mode_skips_the_commercial_chain_entirely")


def test_a_failing_chain_never_blocks_the_official_feed(monkeypatch):
    async def fake_cap():
        return [_alert("cap-1", "Hyderabad")], "LIVE"

    async def boom(lat, lon, district):
        raise RuntimeError("chain down")

    monkeypatch.setattr(alert_service.cap_adapter, "fetch_alerts", fake_cap)
    monkeypatch.setattr(asc, "get_alerts", boom)

    got = asyncio.run(alert_service.gather_alerts(**HYD))
    assert [a["identifier"] for a in got["relevant"]] == ["cap-1"]
    assert got["provenance"] == "LIVE"
    print("PASS: test_a_failing_chain_never_blocks_the_official_feed")


def test_both_endpoints_use_the_shared_gatherer():
    # The structural guard. If someone reintroduces a private alert loop in
    # either endpoint, this fails and says why.
    root = os.path.join(os.path.dirname(__file__), '..', 'backend', 'api')
    for name in ("weather.py", "chat.py"):
        with open(os.path.join(root, name), encoding='utf-8') as fh:
            body = fh.read()
        assert "gather_alerts" in body, f"{name} must use the shared alert gatherer"
        assert "cap_adapter.fetch_alerts()" not in body, (
            f"{name} must not build its own CAP list — that is how the two screens diverged"
        )
    print("PASS: test_both_endpoints_use_the_shared_gatherer")


# --------------------------------------------------------------------------
# Concurrent duplicate work is shared, not repeated.
#
# Home mounts two components that both need the alert chain for the same place
# (the verdict card and the advisory). Served independently that is two full
# passes over NDMA and the commercial chain: the user waits twice as long and a
# public feed takes twice the load. This is de-duplication of IN-FLIGHT work, so
# the answer stays exactly as live as the request that produced it — it is not a
# cache, and nothing is served after the fact.
# --------------------------------------------------------------------------
def test_concurrent_identical_requests_share_one_fetch(monkeypatch):
    calls = {"cap": 0, "chain": 0}

    async def fake_cap():
        calls["cap"] += 1
        await asyncio.sleep(0.05)  # hold it open so the second request overlaps
        return [_alert("cap-1", "Hyderabad")], "LIVE"

    async def fake_chain(lat, lon, district):
        calls["chain"] += 1
        await asyncio.sleep(0.05)
        return [], "UNAVAILABLE"

    monkeypatch.setattr(alert_service.cap_adapter, "fetch_alerts", fake_cap)
    monkeypatch.setattr(asc, "get_alerts", fake_chain)

    async def run():
        return await asyncio.gather(
            alert_service.gather_alerts(**HYD),
            alert_service.gather_alerts(**HYD),
        )

    a, b = asyncio.run(run())
    assert calls["cap"] == 1, f"official feed fetched {calls['cap']} times"
    assert calls["chain"] == 1, f"chain fetched {calls['chain']} times"
    # Both callers still get a complete, identical answer.
    assert [x["identifier"] for x in a["relevant"]] == ["cap-1"]
    assert [x["identifier"] for x in b["relevant"]] == ["cap-1"]
    # ...on their own lists, so one endpoint cannot edit the other's payload.
    assert a["relevant"] is not b["relevant"]


def test_different_places_are_not_shared(monkeypatch):
    """Sharing must key on the question. Two districts are two questions."""
    calls = {"cap": 0}

    async def fake_cap():
        calls["cap"] += 1
        await asyncio.sleep(0.05)
        return [_alert("cap-1", "Hyderabad")], "LIVE"

    async def fake_chain(lat, lon, district):
        return [], "UNAVAILABLE"

    monkeypatch.setattr(alert_service.cap_adapter, "fetch_alerts", fake_cap)
    monkeypatch.setattr(asc, "get_alerts", fake_chain)

    async def run():
        return await asyncio.gather(
            alert_service.gather_alerts(**HYD),
            alert_service.gather_alerts(lat=18.32, lon=78.34, district="Kamareddy", state="Telangana"),
        )

    asyncio.run(run())
    assert calls["cap"] == 2, f"expected one fetch per place, got {calls['cap']}"
