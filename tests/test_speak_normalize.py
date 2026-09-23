"""TTS spoken-form normalization tests.

Sarvam bulbul mangles bare numerals ("234" read digit-by-digit, "26°C"
garbled), so backend/utils/speak_sanitize.py::expand_spoken_forms rewrites
numbers/units into speakable words before the TTS call. EN gets full
expansion; HI/TE get unit words only (digits left for Sarvam's native
handling). Stdlib only — no new dependencies.

Also pins the EN/HI/TE-only language guard: "ta" must never resolve to a
Sarvam locale or be synthesized.
"""
import base64

import pytest

from backend import config
from backend.adapters import tts_provider
from backend.adapters.registry import AdapterUnavailable
from backend.utils.speak_sanitize import (
    expand_spoken_forms,
    resolve_tts_language,
    sanitize_for_tts,
)


# --- English cardinals -----------------------------------------------------

@pytest.mark.parametrize("text,expected", [
    ("0 alerts", "zero alerts"),
    ("5 mm", "five millimeters"),
    ("21 districts", "twenty one districts"),
    ("100 villages", "one hundred villages"),
    ("234 alerts issued", "two hundred thirty four alerts issued"),
    ("1000 people", "one thousand people"),
    ("1,000 people", "one thousand people"),  # thousand separator folded
    ("999999 records", "nine hundred ninety nine thousand nine hundred ninety nine records"),
    ("1000000 records", "1000000 records"),  # above the word cap: digits kept
])
def test_en_cardinals(text, expected):
    assert expand_spoken_forms(text, "en") == expected


def test_en_cardinal_locales_equivalent():
    assert expand_spoken_forms("234", "en-IN") == expand_spoken_forms("234", "en")


# --- English decimals / ordinals / years ------------------------------------

@pytest.mark.parametrize("text,expected", [
    ("26.5 mm", "twenty six point five millimeters"),
    ("0.5 percent", "zero point five percent"),
    ("1st dose", "first dose"),
    ("2nd wave", "second wave"),
    ("3rd alert", "third alert"),
    ("11th hour", "eleventh hour"),
    ("12th district", "twelfth district"),
    ("13th month", "thirteenth month"),
    ("21st century", "twenty first century"),
    ("100th day", "one hundredth day"),
    ("2026 forecast", "twenty twenty six forecast"),
    ("2006 floods", "two thousand six floods"),
    ("2000 census", "two thousand census"),
    ("1999 cyclone", "nineteen ninety nine cyclone"),
    ("1100 hours", "eleven hundred hours"),
])
def test_en_decimals_ordinals_years(text, expected):
    assert expand_spoken_forms(text, "en") == expected


# --- English units ----------------------------------------------------------

@pytest.mark.parametrize("text,expected", [
    ("High of 26°C", "High of twenty six degrees Celsius"),
    ("Range 26–30°C", "Range twenty six to thirty degrees Celsius"),  # en dash
    ("Range 26-30°C", "Range twenty six to thirty degrees Celsius"),  # hyphen
    ("Humidity 80%", "Humidity eighty percent"),
    ("Wind 60 km/h", "Wind sixty kilometers per hour"),
    ("Rain 5 mm", "Rain five millimeters"),
    ("Visibility 10 km", "Visibility ten kilometers"),
    ("Gusts 12 m/s", "Gusts twelve meters per second"),
    ("Low of -5°C", "Low of minus five degrees Celsius"),
])
def test_en_units(text, expected):
    assert expand_spoken_forms(text, "en") == expected


# --- digit guards: words, IDs, URLs ------------------------------------------

def test_digits_inside_words_and_ids_untouched():
    assert expand_spoken_forms("call alert-123 now", "en") == "call alert-123 now"
    assert expand_spoken_forms("code abc123", "en") == "code abc123"


def test_url_digits_removed_by_sanitize_before_expansion():
    # The real pipeline is sanitize -> expand; sanitize strips the URL first.
    raw = "see https://example.com/9 for 26°C details"
    assert expand_spoken_forms(sanitize_for_tts(raw), "en") == \
        "see for twenty six degrees Celsius details"


# --- Hindi / Telugu: unit words, digits pass through -------------------------

def test_hi_units_digits_kept():
    out = expand_spoken_forms("तापमान 26°C, नमी 80%, हवा 60 km/h", "hi")
    assert out == "तापमान 26 डिग्री सेल्सियस, नमी 80 प्रतिशत, हवा 60 किलोमीटर प्रति घंटा"


def test_te_units_digits_kept():
    out = expand_spoken_forms("ఉష్ణోగ్రత 26°C, తేమ 80%", "te")
    assert out == "ఉష్ణోగ్రత 26 డిగ్రీల సెల్సియస్, తేమ 80 శాతం"


def test_hi_te_range():
    assert expand_spoken_forms("26–30°C", "hi") == "26 से 30 डिग्री सेल्सियस"
    assert expand_spoken_forms("26–30°C", "te") == "26 నుండి 30 డిగ్రీల సెల్సియస్"


def test_hi_te_cardinals_not_expanded():
    # Sarvam handles native numerals; we must not rewrite them.
    assert expand_spoken_forms("234 सूचनाएं", "hi") == "234 सूचनाएं"
    assert expand_spoken_forms("234 హెచ్చరికలు", "te") == "234 హెచ్చరికలు"


# --- idempotency ---------------------------------------------------------------

@pytest.mark.parametrize("lang", ["en", "hi", "te"])
def test_expand_is_idempotent(lang):
    samples = {
        "en": "High of 26°C, range 26–30°C, 234 alerts, 26.5 mm, the 21st, in 2026.",
        "hi": "तापमान 26°C, नमी 80%, हवा 60 km/h",
        "te": "ఉష్ణోగ్రత 26°C, తేమ 80%",
    }
    once = expand_spoken_forms(samples[lang], lang)
    assert expand_spoken_forms(once, lang) == once


def test_idempotent_with_sanitize_pipeline():
    raw = "## Alert\n\nHigh of 26°C in Hyderabad. See https://example.com/x for 234 cases."
    once = expand_spoken_forms(sanitize_for_tts(raw), "en")
    assert expand_spoken_forms(once, "en") == once
    assert "https://" not in once


# --- sanitize contract preserved -------------------------------------------------

def test_sanitize_600_char_truncation_intact():
    long = "Word 123. " * 200
    truncated = sanitize_for_tts(long)
    assert len(truncated) <= 600
    # Expansion applies after truncation and still expands.
    assert "one hundred twenty three" in expand_spoken_forms(truncated, "en")


def test_expand_empty_input():
    assert expand_spoken_forms("", "en") == ""


# --- language guard: EN/HI/TE only, "ta" never maps -------------------------------

@pytest.mark.parametrize("given,expected", [
    ("en", "en-IN"), ("en-IN", "en-IN"),
    ("hi", "hi-IN"), ("hi-IN", "hi-IN"),
    ("te", "te-IN"), ("te-IN", "te-IN"),
])
def test_resolve_tts_language_supported(given, expected):
    assert resolve_tts_language(given) == expected


@pytest.mark.parametrize("bad", ["ta", "ta-IN", "fr", "xx"])
def test_resolve_tts_language_rejects_unsupported(bad):
    with pytest.raises(ValueError):
        resolve_tts_language(bad)


def test_resolve_tts_language_empty_defaults_to_en():
    assert resolve_tts_language("") == "en-IN"


def test_expand_rejects_tamil():
    with pytest.raises(ValueError):
        expand_spoken_forms("hello", "ta")
    with pytest.raises(ValueError):
        expand_spoken_forms("hello", "ta-IN")


# --- provider insertion: synthesize expands before POST ----------------------------

class _FakeResp:
    def raise_for_status(self):
        pass

    def json(self):
        return {"audios": [base64.b64encode(b"FAKEWAV").decode("ascii")]}


class _FakeHttp:
    def __init__(self):
        self.posts = []

    async def post(self, url, headers=None, json=None):
        self.posts.append({"url": url, "json": json})
        return _FakeResp()


async def test_synthesize_posts_expanded_text(monkeypatch):
    fake = _FakeHttp()
    monkeypatch.setattr(tts_provider, "_http", lambda: fake)
    monkeypatch.setattr(config, "SARVAM_API_KEY", "test-key", raising=False)
    audio_b64, provider = await tts_provider.synthesize("High of 26°C in Hyderabad.", "en")
    assert provider == "sarvam-live"
    assert base64.b64decode(audio_b64) == b"FAKEWAV"
    sent = fake.posts[0]["json"]
    assert sent["inputs"] == ["High of twenty six degrees Celsius in Hyderabad."]
    assert sent["target_language_code"] == "en-IN"
    assert "ta" not in sent["target_language_code"]


async def test_synthesize_rejects_tamil_without_network(monkeypatch):
    fake = _FakeHttp()
    monkeypatch.setattr(tts_provider, "_http", lambda: fake)
    monkeypatch.setattr(config, "SARVAM_API_KEY", "test-key", raising=False)
    with pytest.raises(AdapterUnavailable, match="unsupported TTS language"):
        await tts_provider.synthesize("hello", "ta")
    assert fake.posts == []  # rejected before any HTTP


async def test_synthesize_still_requires_key(monkeypatch):
    monkeypatch.setattr(config, "SARVAM_API_KEY", "", raising=False)
    with pytest.raises(AdapterUnavailable):
        await tts_provider.synthesize("High of 26°C.", "en")


# --- voice endpoint: browser fallback gets expanded text ---------------------------

@pytest.fixture
def client():
    from backend.main import app
    from fastapi.testclient import TestClient
    with TestClient(app) as c:
        yield c


def test_voice_synthesize_fallback_returns_expanded_text(client, monkeypatch):
    monkeypatch.setattr(config, "SARVAM_API_KEY", "", raising=False)
    r = client.post("/api/voice/synthesize",
                    json={"text": "High of 26°C.", "language": "en"})
    assert r.status_code == 200
    body = r.json()
    assert body["provider"] == "browser-fallback"
    assert body["client_speech"] is True
    assert body["text"] == "High of twenty six degrees Celsius."


def test_voice_synthesize_fallback_hindi_units(client, monkeypatch):
    monkeypatch.setattr(config, "SARVAM_API_KEY", "", raising=False)
    r = client.post("/api/voice/synthesize",
                    json={"text": "तापमान 26°C", "language": "hi"})
    assert r.status_code == 200
    assert r.json()["text"] == "तापमान 26 डिग्री सेल्सियस"
