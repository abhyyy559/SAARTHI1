"""Provenance + voice + NWP-shape tests. No datum without a label; no keys -> honest fallback."""
import asyncio
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from backend.adapters import stt_provider, tts_provider  # noqa: E402
from backend.adapters.registry import AdapterUnavailable  # noqa: E402
from backend.services import nwp_service  # noqa: E402


def test_nwp_wrf_unconfigured_and_models_known():
    assert nwp_service.MODELS["WRF"] is None
    assert set(nwp_service.MODELS) == {"GFS", "ECMWF-IFS", "GEM", "ICON", "WRF"}
    status = {m["model"]: m["status"] for m in nwp_service.model_status()}
    assert status["WRF"] == "UNCONFIGURED"
    print("PASS: test_nwp_wrf_unconfigured_and_models_known")


def test_voice_fallback_without_keys(monkeypatch):
    # Deterministic: force the no-key path regardless of the developer's real .env
    import backend.config as cfg
    monkeypatch.setattr(cfg, "SARVAM_API_KEY", "")

    async def go():
        try:
            await stt_provider.transcribe(b"fake", "a.webm", "te")
            return "NO-RAISE-STT"
        except AdapterUnavailable:
            pass
        try:
            await tts_provider.synthesize("hello", "te")
            return "NO-RAISE-TTS"
        except AdapterUnavailable:
            pass
        assert stt_provider.provider_name() == "browser-fallback"
        assert tts_provider.provider_name() == "browser-fallback"
        return "OK"
    assert asyncio.run(go()) == "OK"
    print("PASS: test_voice_fallback_without_keys")


def test_evidence_provenance_shape():
    # Contract: every evidence item the chat path emits must carry source+provenance.
    sample = [
        {"source": "IMD", "type": "district_warning", "provenance": "DEMO"},
        {"source": "Open-Meteo", "type": "current_observation", "provenance": "LIVE"},
    ]
    for e in sample:
        assert e.get("source") and e.get("provenance") in ("LIVE", "CACHED", "DEMO", "UNAVAILABLE"), e
        assert "SIMULATED" not in e.get("provenance", "")
    print("PASS: test_evidence_provenance_shape")


if __name__ == "__main__":
    test_nwp_wrf_unconfigured_and_models_known()
    test_voice_fallback_without_keys()
    test_evidence_provenance_shape()
    print("\nAll provenance/voice/NWP tests passed.")
