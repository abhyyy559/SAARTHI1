"""Which place a chat question is about.

"Will it rain in Patna tomorrow?" asked by someone whose saved place is
Visakhapatnam must be answered with Patna's data, not Visakhapatnam's, and
never with Visakhapatnam's numbers under Patna's name. The app sends the
user's saved coordinates; this module finds a different place named in the
question (or, for a short follow-up such as "what about tomorrow there?", in
the user's previous question).

Matching is deliberately strict: the whole candidate must equal a district
or city name or a known alias. State words ("west", "pradesh") and partial
or fuzzy matches never move the answer to another place: a wrong place is
worse than answering for home.
"""
from __future__ import annotations

import re

from .location_service import GAZETTEER, _ALIASES, _norm

# English prepositions ("in Patna", "for Medak"), romanised Hindi/Telugu
# postpositions ("patna mein", "hyderabad lo"), and a place opening the
# question ("Patna weather?").
_BEFORE = {"in", "at", "for", "near", "around", "over", "of"}
_AFTER = {"mein", "me", "mai", "main", "lo", "ka", "ki", "ke", "ku"}
_LEAD_NOUNS = {"weather", "rain", "rains", "forecast", "temperature", "mausam", "barish", "alert", "alerts", "warning", "warnings"}

# Places people name in their own script. Kept short and certain: each maps to
# the English name the gazetteer knows. (Hindi "गया" is also the verb "went",
# so Gaya is not listed.)
_NATIVE = {
    "हैदराबाद": "Hyderabad", "पटना": "Patna", "दिल्ली": "New Delhi", "मुंबई": "Mumbai",
    "कोलकाता": "Kolkata", "चेन्नई": "Chennai", "बेंगलुरु": "Bengaluru", "लखनऊ": "Lucknow",
    "जयपुर": "Jaipur", "भोपाल": "Bhopal", "पुणे": "Pune", "वाराणसी": "Varanasi",
    "विशाखापत्तनम": "Visakhapatnam", "पुरी": "Puri", "कटक": "Cuttack",
    "హైదరాబాద్": "Hyderabad", "విశాఖపట్నం": "Visakhapatnam", "విజయవాడ": "Vijayawada",
    "వరంగల్": "Warangal", "గుంటూరు": "Guntur", "తిరుపతి": "Tirupati", "నెల్లూరు": "Nellore",
    "కర్నూలు": "Kurnool", "కరీంనగర్": "Karimnagar", "ఖమ్మం": "Khammam", "నిజామాబాద్": "Nizamabad",
    "మెదక్": "Medak", "నల్గొండ": "Nalgonda", "కాకినాడ": "Kakinada", "చెన్నై": "Chennai",
    "బెంగళూరు": "Bengaluru", "ముంబై": "Mumbai", "ఢిల్లీ": "New Delhi", "పాట్నా": "Patna",
}
_EXTRA = {"delhi": "New Delhi"}

# A short question that leans on the previous one.
_FOLLOW_UP_RE = re.compile(
    r"^\s*(?:and|what about|how about|also|same|then)\b|\bthere\b|^\s*(?:और|फिर)|वहाँ|वहां|^\s*మరి|అక్కడ",
    re.I)


def _names(entry: dict) -> set[str]:
    out = {_norm(entry.get("district", "")), _norm(entry.get("city", ""))}
    out.update(_norm(a) for a in entry.get("aliases") or [])
    return {n for n in out if len(n) >= 3}


def _exact(name: str, home_state: str = "") -> dict | None:
    """The gazetteer entry whose own name (not its state) is exactly `name`."""
    q = _norm(_EXTRA.get(_norm(name), name))
    if len(q) < 3:
        return None
    alias = _ALIASES.get(q)
    if alias:
        q = _norm(alias)
    hits = [e for e in GAZETTEER if q in _names(e)]
    if not hits:
        return None
    # Same name in two states (Aurangabad, Bilaspur...): the user's own state first.
    hits.sort(key=lambda e: e.get("state") != home_state)
    return dict(hits[0])


def _candidates(text: str) -> list[str]:
    """Up to three words next to each place marker, longest first
    ("east godavari" is tried before "east")."""
    words = [re.sub(r"'s$", "", w) for w in re.sub(r"[^a-z\s.'-]", " ", text.lower()).split()]
    found: list[str] = []
    for i, w in enumerate(words):
        if w in _BEFORE:
            nxt = words[i + 1:i + 4]
            found.extend(" ".join(nxt[:n]) for n in range(len(nxt), 0, -1))
        if w in _AFTER and i > 0:
            prev = words[max(0, i - 3):i]
            found.extend(" ".join(prev[j:]) for j in range(len(prev)))
    for n in range(1, 4):
        if len(words) > n and words[n] in _LEAD_NOUNS:
            found.append(" ".join(words[:n]))
    return found


def place_in(text: str, home_state: str = "") -> dict | None:
    """A place named in `text`, or None."""
    for native, english in _NATIVE.items():
        if native in (text or ""):
            hit = _exact(english, home_state)
            if hit:
                return hit
    for cand in _candidates(text or ""):
        hit = _exact(cand, home_state)
        if hit:
            return hit
    return None


def asked_place(message: str, history: list[str] | None = None, home: dict | None = None) -> dict | None:
    """The place the question is about when it is not the user's own, else None.

    `history` holds the user's earlier questions, oldest first. Only a short
    follow-up inherits the previous question's place.
    """
    home = home or {}
    home_state = home.get("state") or ""
    hit = place_in(message, home_state)
    if hit is None and history and len((message or "").split()) <= 8 and _FOLLOW_UP_RE.search(message or ""):
        hit = place_in(history[-1], home_state)
    if hit is None:
        return None
    if hit.get("district") == home.get("district") and hit.get("state") == home.get("state"):
        return None
    return hit
