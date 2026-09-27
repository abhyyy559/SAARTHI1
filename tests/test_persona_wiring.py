"""Role ("I am a") wiring contract tests — from-scratch frontend (2026-09-27).

These pin the actual data flow that makes the role picker functional, so it
can never silently become cosmetic again:
- role persisted in localStorage ('saarthi:role')
- RoleGrid taps write the role (onPick -> setRole)
- advisory + chat API calls carry the role as user_type/persona
Backend behaviour (advisory/risk per role) is covered live in
test_unknown_risk.py; here we pin the frontend wiring.
"""
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

SRC = os.path.join(os.path.dirname(__file__), '..', 'frontend-react', 'src')


def _read(name: str) -> str:
    with open(os.path.join(SRC, name), encoding='utf-8') as f:
        return f.read()


def test_role_persisted_in_local_storage():
    views = _read('views.jsx')
    assert "useLocalStorage('saarthi:role'" in views, \
        "the selected role must be persisted (saarthi:role), not held in transient state"


def test_role_grid_writes_role():
    # RoleGrid renders the tappable grid; a tap must call onPick with the role id.
    components = _read('components.jsx')
    assert re.search(r'export function RoleGrid\(\{\s*value,\s*onPick\s*\}\)', components), \
        "RoleGrid must accept value + onPick"
    assert 'className="role-grid"' in components, \
        "the role grid must render with the role-grid class"
    assert re.search(r'onClick=\{\(\) => onPick\(r\)\}', components), \
        "role card tap must call onPick with the role id"
    # AdviceView wires the grid to the persisted role — never cosmetic.
    views = _read('views.jsx')
    assert re.search(r'onPick=\{pick\}', views), \
        "AdviceView must wire RoleGrid onPick to its pick handler"
    assert re.search(r'setRole\(r\)', views), \
        "the pick handler must write the role via setRole"


def test_advisory_calls_send_persona():
    api = _read('api.js')
    assert re.search(r'user_type=\$\{encodeURIComponent\(persona\)\}', api), \
        "profileAdvisory must send the role as user_type"
    assert re.search(r'persona=\$\{encodeURIComponent\(persona\)\}', api), \
        "advisoryCards must send the role as persona"
    views = _read('views.jsx')
    assert 'api.advisoryCards(loc, role, lang)' in views, \
        "AdviceView must pass the selected role to advisoryCards"
    assert 'api.profileAdvisory(loc, role, lang)' in views, \
        "AdviceView must pass the selected role to profileAdvisory"


def test_chat_sends_persona_and_location():
    # HomeView's agent composer posts { message, latitude, longitude, district,
    # language, user_type } — the backend ChatRequest only understands
    # latitude/longitude; sending lat/lon would be silently dropped by Pydantic
    # and every user would get Hyderabad's weather. The backend tailors advice
    # + caveats by user_type, so dropping it would silently de-personalize
    # chat answers.
    views = _read('views.jsx')
    m = re.search(r'const body = \{([^}]+)\};\s*\n\s*let evMeta = null;', views)
    assert m, "HomeView's agent composer must build a chat request body"
    body = m.group(1)
    assert 'user_type: role' in body, "chat must send the selected role as user_type"
    assert 'latitude: loc.lat' in body and 'longitude: loc.lon' in body, \
        "chat must send coords as latitude/longitude (backend contract)"
    assert 'district: loc.district' in body, "chat must send the district"
    assert 'language: lang' in body, "chat must send the selected language"


def test_backend_advisory_differs_per_persona():
    from backend.services.advisory_service import advisory_for
    unavailable = {"verified": False, "warning_service": "unavailable"}
    fisher = advisory_for(unavailable, "fisherman", "en")
    farmer = advisory_for(unavailable, "farmer", "en")
    assert fisher != farmer
    assert "coastal" in fisher.lower() or "harbour" in fisher.lower()
