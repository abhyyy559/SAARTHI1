# SAARTHI — Live Demo Choreography (Round 2 Stage Script)

**Total: ~6 minutes. Every step uses the real pipeline — no mocks.**

Pre-demo setup (2 min before):
1. Backend: `DEMO_MODE=true` running. Frontend open at `?view=home`.
2. Admin panel: hit **Reset demo** so the stage starts clean.
3. District: set to **Kakinada** (the cyclone scenario's district) — or seed the
   thunderstorm scenario for Hyderabad if you prefer your home district.
4. Have a second phone/browser tab ready for the P2P hop story (optional).

---

## Act 1 — The hook (45 sec)

> "While researching this project, the team found a current warning telling
> fishermen not to go to sea. It existed on an official portal — and the team
> itself had no idea it was there. There is no cyclone today — but what if
> there were? This is the gap SAARTHI closes."

Open **Home**. Point at the situation banner: *"Warnings first, then answers."*

## Act 2 — The alert lifecycle (2 min) — `?view=admin`

1. Click **🌀 CYCLONE** (Kakinada · RED). Say: *"One tap. No slides — watch the
   real system."*
2. Within seconds: the **PRE-ALERT** notification fires. Flip to
   **Notifications** — show the unread badge and the timeline entry.
3. ~40s later it goes **ACTIVE**. Flip to **Home** — the alert card is there
   with the ACTIVE chip. Flip to **Alerts** — point at the lifecycle stepper
   rail (detected → issued → live → resolved).
4. Back in **Admin**, hit **Update** — new notification. Hit **Extend** — new
   notification. Say: *"Every transition is the real pipeline: store →
   notify → push → ledger. If a step didn't fire, you'd see it missing here."*
5. Open the alert's **History** — the full timeline.

## Act 3 — Offline + P2P (1.5 min) — the differentiator

1. On the live cyclone alert, click **📡 P2P relay**. The hop story appears:
   *you → relay-a → delivered*, labelled **SIMULATED** (honest badge — the jury
   will respect this).
2. Say: *"Severe weather knocks out the network exactly when warnings matter
   most. Our degradation ladder: cloud → cache → on-device rules → P2P relay
   → sync. The alert hops phone-to-phone with no internet."*
3. Toggle **Simulate offline** (topbar cloud icon). Reload **Home** — the cached
   verdict and alert snapshot still render, stamped **CACHED**, never presented
   as fresh. Say: *"Absence of data is never shown as safety. It says what it
   can't confirm."*

## Act 4 — Ask + Advisory (1 min) — `?view=ask`, `?view=advisory`

1. Ask: *"Is there a cyclone warning for Kakinada?"* — the answer cites the
   alert with provenance chips (source, when fetched).
2. Ask: *"What should I do?"* — the chat **refuses to give advice** and points
   to Advisory. Flip to **Advisory**: persona-tuned guidance (fisherman in
   Kakinada gets sea guidance; the same persona in Hyderabad is told sea
   warnings don't apply there).
3. Say: *"The AI explains. It never invents a warning, never changes a
   severity, never advises in chat. Severity is owned by the backend — the
   frontend is forbidden from deriving it, and tests enforce that."*

## Act 5 — Trust (30 sec) — `?view=trust`

Show the source status cards: every source reports its own status verbatim —
LIVE, CACHED, DEMO, UNCONFIGURED. *"Nothing is labelled LIVE unless it is.
   In our prototype the IMD key wasn't available on a Sunday — so the IMD
   adapter says DEMO, honestly, instead of pretending."*

## Close (15 sec)

> "Four things, live: the alert lifecycle, notifications, offline survival,
> and phone-to-phone relay. The production design adds the IMD API, WIS 2.0
> and PostgreSQL — the prototype proves the trust architecture with zero
> infrastructure."

End on the **Admin → Reset demo** for a clean handoff.

---

## If something goes wrong on stage
- Backend unreachable → the app shows "Reconnecting…" and serves cached data;
  narrate it as the offline story (it's a feature, not a bug).
- Scenario already seeded → Admin → Reset demo, re-seed.
- Push blocked in browser → the notification center still shows everything;
  say "browser blocked system push, the in-app trail is the source of truth."
