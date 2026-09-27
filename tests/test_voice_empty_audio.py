"""Empty voice-upload rejection (no Sarvam key needed).

A 0-byte recording must be rejected with 422 before it ever reaches the STT
provider — forwarding silence to Sarvam wastes a keyed call and can only come
back empty. This also proves the rejection happens ahead of the provider
seam: the non-empty control below still reaches the honest browser-fallback.
"""
import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client():
    from backend.main import app
    with TestClient(app) as c:
        yield c


def test_empty_audio_upload_rejected_422(client):
    r = client.post(
        "/api/voice/transcribe?language=en",
        files={"file": ("speech.webm", b"", "audio/webm")},
    )
    assert r.status_code == 422
    assert "empty" in r.json()["detail"].lower()


def test_nonempty_audio_reaches_provider_seam(client):
    # No SARVAM_API_KEY in this environment -> honest browser-fallback, 200.
    r = client.post(
        "/api/voice/transcribe?language=en",
        files={"file": ("speech.webm", b"\x1aE\xdf\xa3fakedaudio", "audio/webm")},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["provider"] == "browser-fallback"
    assert body["using_browser_speech"] is True
