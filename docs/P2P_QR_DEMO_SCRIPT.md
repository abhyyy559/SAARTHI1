# P2P QR Relay — 3-Phone Demo Script

**What this proves:** an alert travels phone-to-phone with **zero internet on
both phones** — no pairing, no Bluetooth setup, no accounts. One phone shows
rotating QR codes, the other scans them with its camera.

**You need:** 3 phones, all with the app open (install/open once while online
so the app shell is saved for offline). Phones 2 and 3 will go offline during
the demo. Camera needs `https` (the production URL) — it will not work over
plain `http` on a LAN IP. **Demo on Android:** camera access via the browser
is unreliable inside iOS web views, so keep the scanning phones on Android.

**Where in the app:** More → **Offline & nearby** → **QR relay — zero
internet needed** → tabs **Show QR** / **Scan QR**.

---

## Cast

| Phone | Role | Network during demo |
|-------|------|---------------------|
| Phone 1 | Admin — creates & activates the alert | Online |
| Phone 2 | User A — receives via push, then goes offline | Offline from step 4 |
| Phone 3 | User B — never had the alert, fully offline | Offline throughout |

---

## The flow

### Act 1 — The alert goes out (all online)

1. **Phone 1 (admin):** create and activate a thunderstorm alert for the demo
   district (Admin → demo alerts). Keep this phone online throughout.
2. **Phone 2:** with the app closed, receives the **push notification**.
   Tap it — the alert opens. (This is the Layer-1 path: push with app closed.)
3. **Phone 3:** stays offline, shows nothing. Point this out — *this phone has
   no alert and no internet.*

### Act 2 — Phone 2 goes dark

4. **Phone 2:** turn on **airplane mode** (Wi-Fi + mobile data off).
5. **Phone 2:** open the app → the alert is still there, labelled with when it
   was saved. Say: *"No internet — this is the phone's own saved copy."*
6. **Phone 2:** More → Offline & nearby → QR relay → **Show QR** tab → pick
   the alert. Rotating QR frames appear with **"Frame i of n"** and
   **"Hop 0 of 5"**.

### Act 3 — The handoff (the money shot)

7. **Phone 3:** (airplane mode ON) → QR relay → **Scan QR** tab → **Start
   camera** → point at Phone 2's screen.
8. Watch the progress line: *"3 of 7 frames scanned"* — frames assemble in any
   order, so a shaky hand doesn't matter.
9. **Phone 3:** the alert appears, badged **"Via P2P relay · Hop 0 of 5"** and
   *"Phone-to-phone — could not verify with the server."*
   - A demo alert shows the **Community** badge — honest, because demo data is
     not an official CAP feed. (A real alert carrying the official flag keeps
     its **Official** badge through the relay; the flag is never invented.)
10. **Phone 3:** the acknowledgement is **queued automatically** — note
    *"Acknowledgement queued — it will send when this phone is back online."*
    No tap needed; the queue survives the phone staying offline.

### Act 4 — Relay it further (hop limit)

11. **Phone 3:** tap **"Relay this further"** → the Show QR tab opens with
    **"Hop 1 of 5"**. The hop count travelled inside the payload — it was not
    reset.
12. (Optional, if you have a 4th phone) Scan Phone 3's code → **"Hop 2 of 5"**.
    Past the limit, a phone **refuses** with *"Hop limit reached — this phone
    will not relay further"* instead of relaying silently. Critical (RED)
    alerts allow 10 hops; normal alerts 5.

### Act 5 — Back online, everything syncs

13. **Phones 2 & 3:** turn airplane mode **off**.
14. **Phone 3:** QR relay → Scan tab → **"Send now"** → *"Acknowledgement
    sent."* The queued ack POSTs to the server.
15. **Phone 1 (admin):** open the coverage dashboard — the acknowledgement
    from the offline phone is now visible.

---

## If something goes wrong (say it out loud — honesty scores points)

| Problem | What to say / do |
|---------|------------------|
| Camera blocked | "The browser needs camera permission — allow it and retry." |
| "Checksum failed" | "A frame got corrupted in the camera — the phone rejected it instead of showing a broken alert. Rescan." |
| Wrong QR scanned (a random QR) | "Not a SAARTHI relay code — ignored." The phone counts these, it never crashes. |
| Too many hops | "Hop limit reached — the chain stops here by design, so stale alerts can't circulate forever." |
| Phone 2 shows no alert to share | "Open the app once while online first, so the phone has a saved copy." |

## One-line summary for the jury

> "When both phones have no internet, the alert still travels — as QR codes
> from one screen to another phone's camera — with the hop count and the
> source baked into the payload, so a relayed alert can never pretend to be
> something it isn't."
