# Demo-ready checklist (WeatherGPT, SIH 2026 · PS 26068)

Status as of 9 Oct 2026, branch `feat/real-data-offline-qr-redesign`.
Everything marked **Done** was built and checked on this laptop; the
**You** items need a person with a phone or an account.

| # | Item | Status |
|---|---|---|
| 1 | HTTPS address for phones | **Done**: `scripts\demo-https.ps1` (tested end to end through a public address) |
| 2 | Real-phone test (mic, QR scan, push, install) | **You**: checklist below, 10 minutes |
| 3 | Fast first answer after a restart | **Done**: was 20-35 s, now 1-3 s |
| 4 | Groq rate limits | **Done**: backup model + answer cache; optional paid tier below |
| 5 | Old docs | **Done**: DEMO-SCRIPT, jury-questions, ARCHITECTURE rewritten; ADMIN-PANEL retired |
| 6 | Stray line in `.env` | **Done**: kept as a comment (`# IMD whitelisted this public IP ...`) |
| 7 | Unused old-app backend code | **Done**: ~1,330 lines removed (aviation, SOS relay simulator, citizen reports, demo socket) |

---

## 1. Start the demo (HTTPS, one command)

```powershell
powershell -ExecutionPolicy Bypass -File scripts\demo-https.ps1
```

It builds the app, starts the server (or reuses one already on port 8003),
opens a Cloudflare quick tunnel and prints an `https://….trycloudflare.com`
address plus a QR code (also saved as `logs\app-qr.png`). Then:

- Open **that address** on every phone and on the laptop. Share QR codes made
  from it point to it too; codes made from `localhost` only work on the laptop.
- `-SkipBuild` skips the frontend build when nothing changed.
- **Ctrl+C** stops the tunnel and the server. Stop it after the demo: while it
  runs anyone with the address can use the app, and chat answers spend your
  Groq/Sarvam credit.
- The address changes every run. Start it 10 minutes before you present and
  put the QR on the projector.

Checked through the tunnel (headless phone browser): secure context, the app
installs and works offline (service worker), push is available, 6 live cards,
a Telugu answer in 1.6 s, share links use the HTTPS address, and a phone
without the app opens a shared link.

**Permanent address instead (needs your team's accounts):** `render.yaml` +
`Dockerfile` deploy the app and the API as one service on Render (one HTTPS
address, no CORS setup). Put the keys from `.env` in the Render dashboard.
Render's free tier sleeps after 15 minutes idle: open the address 2 minutes
before presenting. `vercel.json` (frontend only) also works, but then set
`VITE_API_URL` on Vercel and `FRONTEND_ORIGINS` on the backend.

## 2. Phone test (10 minutes, do it once on Android Chrome)

Open the HTTPS address, then:

- [ ] Setup: pick Telugu, tap **Find my place** (allow location), pick a role.
- [ ] Today: the safety card reads aloud on **Listen**; Telugu voice is clear.
- [ ] Ask: tap the mic, say "రేపు వర్షం పడుతుందా?", hear the answer.
- [ ] Ask: "Will it rain in Patna tomorrow?" — the answer is labelled *Patna, Bihar*.
- [ ] Alerts: turn on **Alerts on this phone**, allow notifications, tap **Send a test alert**.
      The test arrives even with the browser closed.
- [ ] Share: show the QR; scan it with **another phone's normal camera**
      (no app): the WeatherGPT page opens with the snapshot.
- [ ] Share → **Receive from a phone**: scan the other phone's code with the
      in-app scanner (allow camera); it appears under *Received*.
- [ ] Chrome menu → **Add to Home screen**; open it from the icon.
- [ ] Airplane mode: reopen the app; Today shows *Saved · …*; Ask answers from
      saved data and sends the question when the network is back.
- [ ] SOS: 112 opens the dialler (do not call).

iPhone: push only works after **Add to Home Screen** (iOS 16.4+); everything
else works in Safari.

## 3. Speed (already handled)

The slow first answer had one root cause: every outgoing HTTPS request built a
new TLS context (reloading the certificate bundle) on the server's only event
loop. While the map collected 36 SACHET feeds the server froze for up to 4.7 s
at a time, so a question took 35 s. Now one shared context is used, and the
demo places are fetched at start-up and kept warm (`WARM_DISTRICTS`, default
`Hyderabad,Medchal Malkajgiri,Visakhapatnam` — add the districts you will
show, comma-separated, in `.env`).

Measured after a restart: first question for a warm place 1.0 s; a new place
2-3 s; a repeated question 0.1 s.

## 4. Groq limits (already handled; optional upgrade)

Groq's free tier allows **8,000 tokens per minute per model**; one answer uses
about 1,900. The server now:

- reuses the answer for the same question, place and data for 10 minutes
  (chip questions cost nothing the second time);
- moves to a second model (`LLM_FALLBACK_MODEL`, default `openai/gpt-oss-20b`,
  its own 8,000/min) when the first returns "rate limited".

Only when both are exhausted does the grounded template answer appear (correct
language, plainer wording). For a judging session with many people asking at
once, Groq's paid Developer tier removes the limit for a few rupees of use.

## 5. What the app does and does not do (say this, not more)

Built and working: official alerts from NDMA SACHET for all 36 states/UTs;
forecast, nowcast, sea state and model comparison (GFS, ECMWF, GEM, ICON) from
Open-Meteo; 20-year ERA5 climate comparison; chat and voice in English, Hindi
and Telugu (Groq + Sarvam) with a validator that blocks invented warnings and
numbers; questions about any district by name; 5 roles; push alerts in the
user's language; offline answers from saved data; QR sharing that works with
no app and no internet; SOS.

Not built yet (do not claim): SMS / IVR / WhatsApp delivery; an officials'
dashboard (the acknowledgement endpoints exist, no screen); a weighted risk
engine (severity comes from official alerts); WMO WIS 2.0; languages beyond
English, Hindi and Telugu; shelter information. IMD's API key is still being
rejected by IMD, so IMD shows *Not reachable* in Data sources — that is true
and is shown honestly.

## 6. If something goes wrong on stage

- **Tunnel address does not open:** rerun the script (new address, new QR).
  Or present from the laptop at `http://127.0.0.1:8003` — everything except
  phone features works.
- **Answers look plain (ending in "WeatherGPT Risk Interpretation for you…"):** Groq is busy;
  wait 30 s or ask a chip question that was already asked.
- **No internet at the venue:** the app still opens (installed) and answers
  from saved data; this is the offline story — show it.
