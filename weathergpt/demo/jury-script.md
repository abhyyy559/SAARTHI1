# WeatherGPT — 5-Minute Jury Demo Script (SIH 26068)

> Principle: every claim is clickable live. If offline, fixtures carry DEMO labels — narrate that as a feature ("graceful honesty"), never hide it.

## 0:00–0:30 — The gap (GapHero)
- "Three apps give three forecasts for the same street. AI chatbots invent red alerts. IMD warnings are district codes in English PDFs."
- Point at the hero: GFS vs ECMWF rain numbers disagreeing LIVE, and our agreement label.
- One line: "WeatherGPT is the verification layer between official data and humans."

## 0:30–1:30 — Live pipeline (Telugu voice)
- Switch language to తెలుగు. Hit 🎙, say: "రేపు హైదరాబాద్‌లో వర్షం పడుతుందా?"
- Watch the pipeline light: SOURCES → VALIDATE → RISK → ANSWER.
- Open "Why this answer?" — every fact has source + LIVE/CACHED/DEMO provenance.

## 1:30–3:00 — Evidence + refusal (the trust moment)
- Evidence inspector: Open-Meteo observation + forecast, timestamps, validity.
- Click "Try: Is there a red alert?" → system refuses to escalate. "This is our §50 safety suite, enforced by automated tests."
- Models panel: 4 live NWP models, WRF honestly marked UNCONFIGURED (planned NCMRWF input).

## 3:00–4:00 — Depth (climate + map)
- Climate panel: 21 real ERA5 years, trend + anomaly computed live from the series.
- Map: user GPS + warning geography; CAP polygons render here when the feed is configured.

## 4:00–5:00 — Close
- Source strip: every adapter reports LIVE/CACHED/DEMO/UNCONFIGURED — "nothing is ever presented as live when it isn't."
- "Authoritative data → validation → location/GIS → risk → grounded conversation → language + voice + map. The LLM never predicts weather; it translates verified intelligence into decisions."

## Fallback lines (offline / keyless)
- "No keys configured, so cross-check and server voice report UNCONFIGURED — the system says so openly instead of faking it."
- "IMD publishes no public JSON warning API, so warnings report UNAVAILABLE rather than hallucinate. The CAP parser is ready the day a feed URL is configured."
