# IMD API key onboarding

SAARTHI runs in a single IMD-first mode (see `docs/SOURCE-MODES.md`): IMD is
the primary source, with Open-Meteo / OpenWeatherMap / SACHET-CAP backfill and
cache. There is no mode switch and no `IMD_ADAPTER` toggle — the only thing
that turns IMD on is a real key.

## 1. Generate the key

Request API access at the IMD portal (the API is credential-gated; without a
key the IMD adapter reports `UNCONFIGURED` and the app runs on backfill +
cache, honestly labelled).

## 2. Set the credentials

IMD needs three values (verified 2026-09-27 against the portal's logged-in
API docs — the old "just the key" setup was wrong):

- **Production (Render):** set them in the Render dashboard (Environment tab
  of the backend service). Redeploy after saving.
- **Local:** add them to your `.env`:
  ```ini
  IMD_API_KEY=<redacted>
  IMD_API_EMAIL=<redacted>
  IMD_API_PASSWORD=<your-portal-password>
  ```

Why three: every IMD API call sends **two** headers —
`X-API-KEY: <key>` (bound to the server IP registered on the portal) **and**
`Authorization: Bearer <JWT>` (your portal-user identity, expires after 1
hour). The backend mints the JWT itself by POSTing your portal email+password
to `https://api.imd.gov.in/api/oauth/token.php` and caches it until shortly
before expiry. The JWT must belong to the same portal user as the API key.

That is the whole change — no code change, no mode to flip. Restart the
backend and check the source actually took:

```bash
curl -s localhost:8003/api/sources | python -m json.tool | grep -A2 '"imd"'
```

Expected: `"status": "READY"`, `"detail": "IMD credentials present — verified on first use"`.

## 3. Any-location resolution (no hand-typed district list)

IMD endpoints take a numeric ID (`?id=...`), not a city name or coordinates —
so serving arbitrary user locations needs IMD's own station/district tables.
The backend fetches them once with the same dual-header auth and caches them
on disk (`backend/data/imd_mapping_cache.json`, 7-day TTL):

- **Current / forecast:** nearest IMD station to the user's GPS (haversine).
- **Warning / nowcast:** district name → IMD district ID.
- A "nearest" station more than 150 km away fails closed to Open-Meteo —
  that is outside IMD coverage, not the user's weather.

Nothing to configure for this except the two endpoint names:

```ini
IMD_PATH_STATION_MAPPING=stationmapping
IMD_PATH_DISTRICT_MAPPING=districtmapping
```

**These names are best-effort guesses** — the API docs sit behind the portal
login, so they could not be verified from outside. If the fetch 404s, the
error names the exact URL tried: open
`https://api.imd.gov.in/public/api_docs.php`, copy the real mapping endpoint
names, and paste them into these two vars. No code change needed.

`IMD_STATION_IDS` still exists as a **manual override** (exact district name
→ IDs) for pinning a wrong auto-match without touching code:

```ini
IMD_STATION_IDS={"Hyderabad": {"current": "<station-id>", "forecast": "<station-code>", "warning": "<district-id>", "nowcast": "<district-id>"}}
```

When callers pass no district (the `/api/weather` live paths only have
lat/lon), the GPS position drives resolution; `IMD_DEFAULT_DISTRICT`
(default `Hyderabad`) is only the last-resort name for warning/nowcast calls
that arrive with no district at all. IDs are never guessed: an unresolvable
location raises and the chain falls through to Open-Meteo, honestly labelled.

## 4. IP binding — read this before testing

`X-API-KEY` is **bound to the server IP** registered on the portal
(`api.imd.gov.in/public/ip.php`). A dev key bound to your laptop IP answers
**only from your laptop** — calls from anywhere else get rejected even with
perfect wiring. Consequences:

- The sandbox / CI can never validate the live path with a laptop-bound key.
  The wiring is covered by mocked tests (`tests/test_imd_live_auth.py`); the
  real handshake must be verified from the bound IP.
- For Render (production), generate the **Prod key** against the deployment's
  static outbound IP. Render free/shared plans have dynamic outbound IPs —
  confirm a static egress IP before generating the Prod key.

## 5. What changes for the user

Nothing in the UI has to change — that is the point of the single-mode design.
Before the key, IMD cards read `UNCONFIGURED` and answers ride the backfill
chain; after the key, the same cards read real IMD data, stamped `LIVE`. The
provenance chips always name the actual source.

## Still not covered by the key

- **CAP / SACHET** — separate feed. The official SACHET RSS URLs are now the
  built-in default (`backend/config.py`), so alerts work with zero config;
  override with `CAP_FEED_URLS` only if you need different state feeds.
- **WIS 2.0** — the MQTT push-ingest path is a documented stub
  (`wis2_adapter.py`); it needs a broker and the MQTT dependency. The app polls
  CAP instead. Shown honestly on the Trust view as `STUB / UNCONFIGURED`.
- **data.gov.in** — needs `DATAGOV_API_KEY` + `DATAGOV_RESOURCE_ID`.
- **OpenWeatherMap** — needs `OWM_API_KEY`; without it the second-opinion panel
  is hidden rather than shown empty.
