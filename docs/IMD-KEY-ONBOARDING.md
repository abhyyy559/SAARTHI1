# When the IMD key arrives

The integration speaks the real public IMD API (`api.imd.gov.in/api/v1` —
verified 2026-10-09 against https://api.imd.gov.in/public/api_reference.html).
Endpoint paths already match the official names (`districtwarning`,
`districtnowcast`, `current_wx`, `cityforecastloc`); district/station rows are
matched locally by name, so no id table is needed.

## 1. Paste the key

`.env` (gitignored — never commit it):

```ini
IMD_API_KEY=<the hex portal key>
IMD_JWT=<the portal-issued JWT>
IMD_ADAPTER=live
SOURCE_MODE=hybrid
```

Auth (PROVEN 2026-10-09 by probing the live API with a real portal key): the
gateway is DUAL-credential — it reads `x-api-key: <IMD_API_KEY>` AND
`Authorization: Bearer <IMD_JWT>`. Key-only calls get
`{"error":"Authorization header missing or invalid"}`; key + non-JWT Bearer
gets `{"error":"Invalid or expired JWT token"}`. The hex API key alone can
never pass. Mint the JWT per the official [IMD API Portal User Guide](https://api.imd.gov.in/public/IMD_API_Portal_User_Guide.pdf)
(§7–8: key = server identity and is IP-bound; JWT = user identity, expires
automatically, must belong to the same account as the key):

```http
POST https://api.imd.gov.in/api/oauth/token.php
Content-Type: application/json

{"email": "<portal account email>", "password": "<portal password>"}
→ {"access_token": "<paste ONLY this value as IMD_JWT>", ...}
```

Until both are set, IMD reports UNCONFIGURED naming
the missing piece (key without JWT says so explicitly), and hybrid serves
SACHET/CAP + Open-Meteo instead. If IMD gives you a header/query scheme
instead, no code change is needed:

```ini
IMD_AUTH_SCHEME=header   # or: bearer (default) | query
IMD_AUTH_HEADER=X-API-Key
IMD_AUTH_PARAM=api_key
```

`IMD_ADAPTER=live` is what stops the fixture adapter answering. With the key set
and `IMD_ADAPTER=demo` you still get fixtures (stamped DEMO) — deliberately, so a
key can be added without silently switching the demo to live data.

## 2. Restart the backend

```bash
cd SAARTHI && python -m uvicorn backend.main:app --port 8000
```

Then check the switch actually took:

```bash
curl -s localhost:8000/api/sources | python -m json.tool | grep -A2 '"imd"'
```

Then prove live data (needs the key — without it IMD reports UNCONFIGURED
and hybrid serves SACHET/CAP + Open-Meteo instead):

```bash
curl -s "localhost:8000/api/weather/warnings?district=Hyderabad" | python -m json.tool | grep -i provenance
```

Expected: `"warning_provenance": "LIVE"` with an IMD `Day_1` warning, or
`"status": "ok"` with `warning: null` on a genuinely calm day — never DEMO.

## 3. If the schema drifts

The parsers accept the documented shapes (bare list or `{"data": [...]}`,
any field casing) plus the legacy `{"warnings": [...]}` envelope, and
`IMD_FIELD_MAP` remaps renamed fields without a code edit:

```ini
IMD_FIELD_MAP={"temp": "Temperature"}
```

A shape the parser cannot read raises (→ `UNAVAILABLE` on screen with the
reason in logs), never a silent fixture. Check the backend log for
`live districtwarning failed:` — it names the exact cause.

## 4. What changes for the user

Nothing in the UI has to change — that is the point of the source-mode design:

| | now (`demo`) | after the key (`hybrid` + key) |
|---|---|---|
| Weather | IMD-grade fixtures, stamped DEMO | IMD (nearest station) → Open-Meteo → OWM, stamped LIVE |
| Warnings | fixtures | real IMD Day-1 district warnings |
| Alerts page | demo alerts | live official alerts (IMD + SACHET/CAP) |
| Push | works | works, now driven by real alerts |
| QR share/scan | works offline | works offline, now sharing real alerts |

Switch modes at runtime from the Admin view or `POST /api/mode {"mode":"hybrid"}`.
`hybrid` keeps the multi-source fallback chain (IMD → SACHET/CAP → Open-Meteo),
so one IMD failure does not blank the screen. The chosen mode is persisted and
survives a restart.

## Still not covered by the key

- **CAP / SACHET** — separate feed, needs `CAP_FEED_URLS` (keyless, works
  today — it is what serves official alerts in hybrid mode right now).
- **data.gov.in** — needs `DATAGOV_API_KEY` + `DATAGOV_RESOURCE_ID`.
- **OpenWeatherMap** — needs `OWM_API_KEY`; without it the second-opinion panel
  is hidden rather than shown empty.
