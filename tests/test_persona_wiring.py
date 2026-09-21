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


def test_store_exposes_persona_and_district():
    store = _read('store.jsx')
    assert "setPersona" in store and "persona, setPersona" in store
    assert "loc, setDistrict, districts" in store  # context value carries location


def test_persona_role_grid_writes_to_store():
    # Persona selection moved out of the topbar into the Advisor role grid
    # (signal-board redesign: a role-card grid, no dropdown). Pin the new
    # wiring so a persona tap can never silently become cosmetic again.
    advisor = _read(os.path.join('components', 'Advisor.jsx'))
    assert re.search(r"onClick=\{\s*\(\s*\)\s*=>\s*onPick\(ut\.id\)", advisor), \
        "role card tap must call onPick with the user type"
    assert re.search(r"onPick=\{setPersona\}", advisor), \
        "role grid must wire onPick to the store's setPersona"
    # District selection likewise moved out of the topbar — it now lives in
    # the location prompt's manual district chips.
    loc = _read(os.path.join('components', 'LocationPrompt.jsx'))
    assert re.search(r"onClick=\{\s*\(\s*\)\s*=>\s*setDistrict\(r\)", loc), \
        "district chip must write location to store"


def test_homechat_sends_persona_and_location():
    # Phase 0 (2026-09-21): ChatPanel.jsx was dead code (nothing rendered it);
    # HomeChat.jsx is the live chat. The persona/location wiring contract is
    # unchanged — only the owner moved.
    chat = _read(os.path.join('components', 'HomeChat.jsx'))
    assert "user_type: persona" in chat, "chat must send the selected persona"
    assert "latitude: loc && loc.lat" in chat, "chat must send the selected district coords"
    assert "language: lang" in chat, "chat must send the selected language"
    assert "PERSONA_LABELS" in chat, "chat header must show who is being answered"


def test_persona_chips_differ_by_persona():
    # Phase 0 (2026-09-21): see above — ChatPanel.jsx deleted, HomeChat.jsx live.
    chat = _read(os.path.join('components', 'HomeChat.jsx'))
    assert "PERSONA_QUESTIONS[persona]" in chat, "question chips must follow persona"


def test_backend_advisory_differs_per_persona():
    from backend.services.advisory_service import advisory_for
    unavailable = {"verified": False, "warning_service": "unavailable"}
    fisher = advisory_for(unavailable, "fisherman", "en")
    farmer = advisory_for(unavailable, "farmer", "en")
    assert fisher != farmer
    assert "coastal" in fisher.lower() or "harbour" in fisher.lower()
