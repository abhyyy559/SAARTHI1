"""Emergency network tests — real Fernet crypto: roundtrip, tamper, dedup, replay, hops, sync."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from backend.services import emergency_service as es  # noqa: E402
from backend.models.emergency import EmergencyMessage  # noqa: E402


def _pkt(**kw):
    msg = es.seal("device-A", {"message_type": "NEED_HELP", "people_count": 2, **kw})
    return msg.model_dump(mode="json")


def test_seal_open_roundtrip():
    msg = es.seal("device-A", {"message_type": "IM_SAFE", "text": "ok"})
    body = es.open_packet(EmergencyMessage(**msg.model_dump(mode="json")))
    assert body["message_type"] == "IM_SAFE" and body["sender"] == "device-A"
    print("PASS: test_seal_open_roundtrip")


def test_tamper_fails_integrity():
    p = _pkt()
    p["ciphertext"] = p["ciphertext"][:-4] + "AAAA"
    r = es.receive(p)
    assert r["result"] == "error", r
    print("PASS: test_tamper_fails_integrity")


def test_dedup_and_replay_window():
    p = _pkt()
    r1 = es.receive(p)
    r2 = es.receive(p)
    assert r1["result"] == "stored" and r2["result"] == "duplicate", (r1, r2)
    # Aged envelope (signed time 5 days ago) must be rejected even with fresh outer field.
    import json as _json
    from datetime import timedelta
    from backend.utils.time import now_ist
    msg = es.seal("device-A", {"message_type": "NEED_HELP"})
    body = es.open_packet(msg)
    body["at"] = (now_ist() - timedelta(days=5)).isoformat()
    fresh = es._fernet().encrypt(_json.dumps(body).encode()).decode()
    import hmac as _hmac, hashlib as _hl
    sig = _hmac.new(es._hmac_key(), fresh.encode(), _hl.sha256).hexdigest()
    aged = msg.model_dump(mode="json")
    aged.update({"message_id": "msg-aged-test-1", "ciphertext": fresh, "nonce": fresh[:16], "signature": sig})
    r = es.receive(aged)
    assert r["result"] == "error" and "replay" in r["reason"], r
    print("PASS: test_dedup_and_replay_window")


def test_hop_limit_and_sync():
    p = _pkt()
    p["message_id"] = "msg-hop-test-1"
    p["hops"] = 10
    r = es.receive(p)
    assert r["result"] == "error" and "hop" in r["reason"], r
    svc = es.EmergencyMessagingService(es.SimulatedTransport())
    import asyncio
    out = asyncio.run(svc.sendEmergencyMessage("device-A", {"message_type": "ROAD_BLOCKED"}))
    assert out["provenance"] == "SIMULATED", out
    q = es.receive({**_pkt(), "message_id": "msg-queue-test-1", "queued_locally": True})
    assert q["result"] == "stored"
    s = es.sync_outbox()
    assert "msg-queue-test-1" in s["synced"], s
    print("PASS: test_hop_limit_and_sync")


if __name__ == "__main__":
    test_seal_open_roundtrip()
    test_tamper_fails_integrity()
    test_dedup_and_replay_window()
    test_hop_limit_and_sync()
    print("\nAll emergency tests passed.")
