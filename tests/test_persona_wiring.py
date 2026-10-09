""""I am a" persona feature - wiring contract tests.

These assert the actual data flow that makes the persona dropdown functional
(the original bug: it was cosmetic). Backend behaviour (advisory/risk per
persona) is covered live in test_unknown_risk.py; here we pin the frontend
wiring so the dropdown can never silently become cosmetic again.
"""
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

SRC = os.path.join(os.path.dirname(__file__), '..', 'frontend-react', 'src')


def _read(name: str) -> str:
    with open(os.path.join(SRC, name), encoding='utf-8') as f:
        return f.read()


def test_store_exposes_persona_and_location():
    # Frontend rebuild (2026-10-09): App.jsx owns the store; prefs persist.
    app = _read('App.jsx')
    assert "setPersona = useCallback" in app and "writePref('persona'" in app
    assert re.search(r"persona: persona \|\| 'general',[^}]*setPersona, loc, setLoc", app), \
        "context value must carry persona and location"


def test_persona_pickers_write_to_store():
    # Both role pickers (Today's "For you" row, Setup/Settings grid) must call
    # the store's setPersona, so a role tap can never become cosmetic.
    today = _read(os.path.join('screens', 'Today.jsx'))
    assert re.search(r"onClick=\{\(\) => setPersona\(r\.id\)\}", today)
    setup = _read(os.path.join('components', 'Setup.jsx'))
    assert re.search(r"setPersona\(r\.id\)", setup)
    # A picked place writes the store's location.
    assert re.search(r"setLoc\(\{ district: p\.district", setup)


def test_chat_sends_persona_location_language():
    ask = _read(os.path.join('screens', 'Ask.jsx'))
    assert "user_type: persona" in ask, "chat must send the selected persona"
    assert "latitude: loc.lat, longitude: loc.lon" in ask, "chat must send the selected place"
    assert "language: lang" in ask, "chat must send the selected language"
    api = _read(os.path.join('lib', 'api.js'))
    assert "user_type: persona, language: lang" in api, "advisory must follow persona + language"


def test_persona_chips_differ_by_persona():
    ask = _read(os.path.join('screens', 'Ask.jsx'))
    assert "CHIPS[persona]" in ask, "question chips must follow persona"


def test_backend_advisory_differs_per_persona():
    from backend.services.advisory_service import advisory_for
    unavailable = {"verified": False, "warning_service": "unavailable"}
    fisher = advisory_for(unavailable, "fisherman", "en")
    farmer = advisory_for(unavailable, "farmer", "en")
    assert fisher != farmer
    assert "coastal" in fisher.lower() or "harbour" in fisher.lower()
