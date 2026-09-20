# WeatherGPT — Project Overview (for everyone, no tech background needed)

## The problem we are solving (SIH 2026 · Problem 26068 · MoES/IMD)

Weather information in India is scattered. IMD has portals, SACHET sends
disaster alerts, states publish bulletins — but a farmer in Warangal or a
fisherman in Visakhapatnam cannot read any of that and know what to do
today. TV gives generic forecasts. Apps show temperature, not decisions.

**Nobody explains what the data means for a specific person, in a specific
place, in a language they understand.**

That gap — between official data and human action — is what we built
WeatherGPT to close, under the Disaster Management theme.

## What WeatherGPT is (one paragraph)

WeatherGPT is a conversational assistant you talk to in English, Hindi, or
Telugu — by typing or by voice. You tell it who you are (farmer, fisherman,
driver, or general public) and it figures out where you are. Then it fetches
real weather and official warnings, checks them, and tells you what to do —
with proof of where every fact came from. It never guesses, and it says
plainly when it does not know.

## Who uses it and how it helps them

| User | Example question | What they get |
|---|---|---|
| Farmer | "Should I irrigate today?" | Rain forecast + warning check + field advice with a clear caveat that it is general guidance |
| Fisherman | "Can I go to sea tomorrow?" | Coastal check first (it knows Hyderabad has no sea), marine warnings, harbour advice |
| Driver | "Can I drive to Warangal?" | Route rain analysis across origin, midpoint, destination — never declares a route "safe" |
| General public | "Will it rain tomorrow?" | Forecast + active warnings, sourced and timestamped |
| Non-literate rural users | (speaks into the mic) | Full voice conversation: talk, hear the answer, keep talking — plus a speaking button on every answer |

## The features, in plain words

1. **Talk or type, 3 languages** — chat, voice input, spoken answers.
2. **Live voice mode** — a full-screen conversation like talking to a person; tap to interrupt.
3. **Safety verdict card** — one big clear state (ALL CLEAR / MODERATE / HIGH…), with a countdown showing when a warning expires and the source of every fact.
4. **Official alerts** — real government thunderstorm/flood alerts, plus community field reports (always labelled as community, never official).
5. **Emergency SOS** — encrypted distress messages with inbox and sync; works through connectivity drops via store-and-forward.
6. **Works offline, honestly** — last verified warnings stay on the phone with timestamps; expired warnings grey out instead of pretending to be live.
7. **Installable app (PWA)** — installs on Android/iPhone home screens, opens without internet for cached content.
8. **Onboarding tour** — the app points at each button and explains it, in your language.
9. **Ask-about-anything buttons** — every warning, alert, and advice card jumps into chat with a ready-made question.

## The one promise (our golden rule)

**The AI never invents weather.** Warnings, severity, and numbers come only
from official sources. The AI only explains and translates. If data is
missing, the app says "we cannot confirm" instead of guessing. This is what
makes it safe to demo to a jury and safe to imagine in villagers' hands.

## Honest limitations (say these before anyone else does)

- We cannot access IMD's private API (it needs a government permission
  letter) — so we use open official channels (SACHET alerts) plus global
  forecast data, and the app always names its source.
- It is a website that installs like an app, not a Play Store app.
- It needs internet for fresh data; offline it shows clearly-labelled
  cached data, never fresh-looking lies.
- SOS messaging is encrypted and queued, but true phone-to-phone mesh
  without any signal is future work.

## The 5-minute demo

1. *"Is there a red alert?"* → refuses correctly, states the real severity.
2. Same question as farmer vs fisherman → different advice.
3. Speak in Telugu → hear the answer in Telugu.
4. Alerts tab → file a field report → send an SOS → sync → simulated relay.
5. Kill the internet → cached warning with countdown → reconnect toast.

## Glossary (words we use)

- **Severity** (GREEN/YELLOW/ORANGE/RED) — the government's official scale. We never change it.
- **Risk** (LOW/MODERATE/HIGH/CRITICAL) — our own interpretation for you. Always labelled as ours.
- **Provenance** — the "source + timestamp" tag on every fact.
- **Verified** — a warning that passed all checks (right source, fresh, right district, still valid).
