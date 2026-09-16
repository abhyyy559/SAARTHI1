"""RAG-lite retrieval over local emergency-guidance docs (§37).

Keyword-overlap retrieval (no vectors in MVP) for: emergency guidance,
verified reference material, offline Q&A. Every hit carries its source label.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

_KB = Path(__file__).resolve().parent.parent / "data" / "emergency_guidance.json"
_WORD = re.compile(r"[a-zA-Z\u0900-\u097F\u0C00-\u0C7F]+")

HAZARD_KEYS = {
    "flood": {"flood", "baarish", "paani", "varada", "floodwater", "baaDh", "inundation"},
    "thunderstorm": {"thunder", "lightning", " Bijli".strip(), "storm", "aandhi", "urumu", "merupu"},
    "heatwave": {"heat", "loo", "garmi", "vadagalu", "heatwave", "temperature high"},
    "cyclone": {"cyclone", "toofan", "tufan", "storm surge", "chakravat"},
}


def _load() -> dict:
    try:
        return json.loads(_KB.read_text(encoding="utf-8"))
    except Exception:
        return {"source": "unavailable", "docs": []}


def retrieve(query: str, lang: str = "en", top_k: int = 1) -> list[dict]:
    kb = _load()
    docs = kb.get("docs") or []
    q = (query or "").lower()
    tokens = set(_WORD.findall(q))
    scored = []
    for d in docs:
        if d.get("lang") != lang:
            continue
        body = (d.get("title", "") + " " + d.get("body", "")).lower()
        overlap = len(tokens & set(_WORD.findall(body)))
        hazard_hit = 2 if any(k in q for k in HAZARD_KEYS.get(d.get("hazard", ""), set())) else 0
        scored.append((overlap + hazard_hit, d))
    scored.sort(key=lambda x: -x[0])
    hits = [d for s, d in scored[:top_k] if s > 0]
    return [{"id": d["id"], "hazard": d["hazard"], "title": d["title"],
             "body": d["body"], "source": kb.get("source", "")} for d in hits]
