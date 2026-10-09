# WeatherGPT — Stage demo (about 6 minutes)

Everything below is the real app on live data: no admin panel, no seeded
scenarios, no simulated steps. What you show depends on today's weather and
today's official alerts, so check them 10 minutes before (step 0).

**Hook (say it first):** "Every weather app gives you a number. We give you a
decision, in your language, from official sources, even with no internet."

## 0. Ten minutes before

1. `powershell -ExecutionPolicy Bypass -File scripts\demo-https.ps1` and put
   the printed QR on the projector (see `docs/DEMO-READY.md`).
2. On the laptop, open the HTTPS address. On the phone, scan the QR.
3. Open **Map → Alerts** and note one district with an official alert today
   (orange/red dots). You will ask about it in step 3. If there are none,
   use "Will it rain in Patna tomorrow?" with any city.
4. Phone: Telugu, your district, role *Farmer*. Laptop: English.

## 1. First run, for someone who cannot read (45 s) — laptop

- Landing → **Get Started** → pick a language (it speaks the language name),
  **Find my place**, pick a role from pictures.
- Say: "Three taps, all pictures. Nothing is assumed — no default place, no
  default role."

## 2. Today: one colour, one picture, one button (60 s)

- Point at the big safety card: colour + icon = the official verdict. Tap
  **Listen**.
- Point at the chips under it: *Checked: NDMA SACHET*, *IMD not connected*.
  Say: "We say exactly what we checked. If nothing could be checked the card
  is grey — never green. Absence of data is never shown as safety."
- Scroll: weather now, next 3 days, **Do weather models agree?** (GFS,
  ECMWF, GEM, ICON — the NWP feature), **For you** (role-specific guidance,
  general not official), **20 years at this place** (ERA5 climate).

## 3. Ask by voice, in Telugu (90 s) — phone

- Tap the mic, say: "రేపు వర్షం పడుతుందా?" (Will it rain tomorrow?). The answer
  is spoken back in Telugu.
- Type or say a question about another place: "Will it rain in Patna
  tomorrow?" — the bubble is labelled *Patna, Bihar*. Then: "What about
  tomorrow there?" — it remembers the place.
- Ask "Was last year hotter than usual here?" — answered from the 20-year
  record, with the years it compared.
- Say: "The AI only phrases facts we fetched. A validator blocks invented
  warnings and numbers, and rain under 2.5 mm is called very light, as IMD
  defines it — never 'yes, it will rain'. Each answer says what it is based on."

## 4. Alerts and the map (60 s) — laptop

- **Alerts** tab: your district first, then elsewhere in the state, worst
  first, each with expiry time and the issuing authority. Tap **Explain** on
  one: the chatbot explains it in simple words.
- **Map**: all 36 state feeds as a heatmap; switch to **Rain tomorrow** and
  **Heat tomorrow**; tap **Listen** for the spoken summary with the nearest
  alert and its distance.

## 5. No internet, no app (90 s) — the differentiator

- Phone: **Share** → show the QR to the audience. Anyone scans it with a
  normal camera: the page opens with the snapshot and its time — no app,
  no login.
- Switch to **Text: no internet needed**: a camera shows the words even with
  no network at all.
- Second phone (or the laptop camera): **Receive from a phone** → scan → it
  appears under *Received* with **Pass it on** (phone to phone, up to 5 hops).
- Phone to airplane mode: reopen Today — every card says *Saved · n min ago*.
  Ask a question — it answers from saved data and sends it when the network
  is back.
- Say: "Disasters cut networks exactly when warnings matter. Saved data
  always shows its age; it is never passed off as live."

## 6. Close (30 s)

- Tap **SOS**: 112 / 108 / 1077 / 1070 through the dialler, and *Send my
  location* by SMS — both work without internet.
- Close: "It's not a chatbot guessing at weather — it's a decision engine
  built on verified data, in the user's own language, and it keeps working
  when the network doesn't."

## If something goes wrong

- **Plain answer ending in "WeatherGPT Risk Interpretation for you…":** the LLM is
  rate-limited; say "this is our grounded fallback — same facts, no AI" and
  ask again in 30 s.
- **IMD shows Not reachable:** true — IMD has not activated our key. "Every
  chain tries IMD first; SACHET carries the official alerts meanwhile."
- **Tunnel down:** rerun the script, or present from the laptop.
- **No alert anywhere today:** good news; show the green card and explain that
  grey would mean "could not check".
