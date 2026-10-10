"""Bluetooth mesh: the server half (gateway upload, signed alerts).

The phones verify messages in Java (MeshProtocol.java); the server must reach
the same verdict on the same bytes, so a phone-signed fixture is checked here
and a server-signed one is checked in the Android unit tests.
"""
import base64
import hashlib
import json
import time

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi.testclient import TestClient

from backend.main import app
from backend.services import mesh_service as ms

client = TestClient(app)


class Phone:
    """A phone's signing key, producing messages exactly as MeshProtocol.create does."""

    def __init__(self):
        self.key = ec.generate_private_key(ec.SECP256R1())
        self.pub = self.key.public_key().public_bytes(serialization.Encoding.DER,
                                                      serialization.PublicFormat.SubjectPublicKeyInfo)
        self.node = hashlib.sha256(self.pub).digest()[:8].hex()

    def msg(self, t, payload, *, ts=None, h=1, mid=None):
        ts = int(time.time()) if ts is None else ts
        hl, ttl = ms.RULES[t]
        m = {"v": 1, "t": t, "id": mid or hashlib.sha256(f"{self.node}{t}{ts}{payload}".encode()).digest()[:8].hex(),
             "o": self.node, "k": base64.b64encode(self.pub).decode(), "ts": ts, "exp": ts + ttl,
             "h": h, "hl": hl, "p": json.dumps(payload, separators=(",", ":"))}
        m["s"] = base64.b64encode(self.key.sign(ms.signed_bytes(m), ec.ECDSA(hashes.SHA256()))).decode()
        return m


# Signed by the Android code (MeshProtocol.create, run on the JVM) with a Hindi
# note. If this stops verifying, the phones and the server disagree about the
# signed bytes and every SOS a phone uploads would be refused.
JAVA_SIGNED_SOS = json.loads(r'''{"p":"{\"note\":\"दूसरी मंज़िल पर फंसे हैं \\u2014 3 लोग\",\"need\":\"trapped\",\"lon\":78.5,\"lat\":17.4}","s":"MEQCIDYyOV83umY2SmTFuvwkZUTrFd5lBx4EkgVOwMcWExedAiACNxRI9NBP9ZaDVJJR0rsMplBCCVkdlzUXrXpcbkEWRg==","t":"sos","hl":0,"v":1,"h":0,"id":"a4e2720c68a037d3","k":"MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE9G7yyOGMrhyyQfmfvECkxkw8uJr+LCrsgz06YzTLco1q+w2aK2Iyk07vhyGPmULb+THDPoquIPhupjw3a3ldlA==","exp":1790259200,"o":"f83f32f6f1d80a5b","ts":1790000000}''')


def test_a_phone_signed_sos_verifies_on_the_server():
    m = JAVA_SIGNED_SOS
    assert ms.check(m, now=m["ts"] + 10) is None
    assert json.loads(m["p"])["note"].startswith("दूसरी")
    assert ms.check({**m, "p": m["p"].replace("trapped", "medical")}, now=m["ts"] + 10) == "bad signature"


def test_valid_message_passes_and_tampering_fails():
    p = Phone()
    m = p.msg("sos", {"lat": 17.4, "lon": 78.5, "need": "medical"})
    assert ms.check(m) is None
    moved = {**m, "p": json.dumps({"lat": 18.0, "lon": 78.5, "need": "medical"})}
    assert ms.check(moved) == "bad signature"
    assert ms.check({**m, "o": Phone().node}) == "origin does not match key"
    assert ms.check({**m, "h": 9}) is None, "the hop count is not signed: relays raise it"


def test_rules_match_the_phones():
    p = Phone()
    now = int(time.time())
    assert ms.check(p.msg("report", {}, ts=now - 13 * 3600)) == "expired"
    assert ms.check(p.msg("sos", {}, ts=now + 3600)) == "from the future"
    assert ms.check(p.msg("sos", {"note": "x" * 141})) == "note too long"
    safe = p.msg("safe", {})
    assert ms.check({**safe, "h": 8}) == "bad hops"
    fake_alert = p.msg("alert", {"headline": "Fake cyclone"})
    assert ms.check(fake_alert) == "alert not signed by the server"


def test_gateway_upload_keeps_sos_and_folds_status():
    victim, helper, stranger = Phone(), Phone(), Phone()
    sos = victim.msg("sos", {"lat": 17.4, "lon": 78.5, "need": "trapped", "note": "2nd floor", "ppl": 3})
    going = helper.msg("sos_upd", {"ref": sos["id"], "st": "going"})
    fake_cancel = stranger.msg("sos_upd", {"ref": sos["id"], "st": "cancel"})
    r = client.post("/api/mesh/relay", json={"messages": [sos, going, fake_cancel, {"junk": 1}]}).json()
    assert r["accepted"] == 3 and len(r["rejected"]) == 1
    again = client.post("/api/mesh/relay", json={"messages": [sos]}).json()
    assert again["duplicate"] == 1 and again["accepted"] == 0

    inc = next(i for i in client.get("/api/mesh/sos").json()["incidents"] if i["id"] == sos["id"])
    assert inc["status"] == "active", "only the person who sent an SOS can cancel it"
    assert inc["responders"] == [helper.node]
    assert inc["need"] == "trapped" and inc["people"] == 3

    rescued = helper.msg("sos_upd", {"ref": sos["id"], "st": "rescued"}, ts=int(time.time()) + 1)
    client.post("/api/mesh/relay", json={"messages": [rescued]})
    inc = next(i for i in client.get("/api/mesh/sos").json()["incidents"] if i["id"] == sos["id"])
    assert inc["status"] == "rescued"


def test_reports_are_not_kept_by_the_server():
    r = client.post("/api/mesh/relay", json={"messages": [Phone().msg("report", {"kind": "flood"})]}).json()
    assert r["accepted"] == 0 and r["rejected"][0]["reason"] == "not kept by the server"


def test_server_signs_alerts_phones_can_check():
    k = client.get("/api/mesh/key").json()
    assert k["key"] == ms.public_key_b64()
    m = ms.alert_message({"identifier": "cap-1", "headline": "Heavy rain", "severity": "orange",
                          "expires": "2099-01-01T00:00:00Z"}, "Hyderabad")
    assert ms.check(m) is None
    assert m["exp"] - m["ts"] <= ms.RULES["alert"][1]
    again = ms.alert_message({"identifier": "cap-1", "headline": "Heavy rain"}, "Hyderabad")
    assert again["id"] == m["id"], "the same alert keeps one id, so phones drop copies"
    assert ms.alert_message({"identifier": "old", "expires": "2001-01-01T00:00:00Z"}, "Hyderabad") is None


def test_alerts_endpoint_returns_signed_messages(monkeypatch):
    async def fake_warnings(district="Hyderabad", lat=None, lon=None):
        return {"location": {"district": "Hyderabad"}, "warning": None,
                "cap_alerts": [{"identifier": "a1", "headline": "Thunderstorm", "official": True},
                               {"identifier": "a2", "headline": "Vendor alert", "official": False}]}

    import backend.api.weather as weather
    monkeypatch.setattr(weather, "warnings", fake_warnings)
    d = client.get("/api/mesh/alerts", params={"district": "Hyderabad"}).json()
    assert [json.loads(m["p"])["headline"] for m in d["messages"]] == ["Thunderstorm"]
    assert all(ms.check(m) is None for m in d["messages"])


def test_capacitor_origin_is_allowed():
    r = client.options("/api/mesh/key", headers={"Origin": "https://localhost",
                                                 "Access-Control-Request-Method": "GET"})
    assert r.headers.get("access-control-allow-origin") == "https://localhost"
