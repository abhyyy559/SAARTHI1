# When the IMD key arrives

Everything except the endpoint paths is already built and exercised. This is the
whole change.

## 1. Paste the key

`weathergpt/.env`:

```ini
IMD_API_KEY=<the key>
IMD_ADAPTER=live
```

`IMD_ADAPTER=live` is what stops the fixture adapter answering. With the key set
and `IMD_ADAPTER=demo` you still get fixtures (stamped DEMO) — deliberately, so a
key can be added without silently switching the demo to live data.

## 2. Restart the backend

```bash
cd SAARTHI && PYTHONPATH=weathergpt python -m uvicorn backend.main:app --port 8003
```

Then check the switch actually took:

```bash
curl -s localhost:8003/api/sources | python -m json.tool | grep -A2 '"imd"'
```

Expected: `"status": "READY"`, `"detail": "IMD credentials present — verified on first use"`.

## 3. If the paths are wrong

**This is the only unverified part.** The auth header
(`Authorization: Bearer <IMD_API_KEY>`) and the request/response handling are
tested and working, but IMD's real path list has never been seen — the platform
is credential-gated. The paths are therefore env vars:

```ini
IMD_BASE_URL=https://mausam.imd.gov.in/api/v1
IMD_PATH_CURRENT=current_wx        # current observation
IMD_PATH_FORECAST=cityforecastloc  # city forecast
IMD_PATH_WARNING=districtwarning   # district warning  <- the one alerts depend on
IMD_PATH_NOWCAST=districtnowcast   # nowcast
```

If the key returns `400 Bad Request` or `401`, that is the wiring working and the
path or the auth scheme being wrong — not a broken integration. Adjust the
`IMD_PATH_*` line (or `IMD_BASE_URL`) and restart. No code change needed.

To see the exact URL being attempted:

```bash
cd weathergpt && IMD_API_KEY=<key> IMD_ADAPTER=live python -c "
import sys, asyncio; sys.path.insert(0,'.')
import backend.services.imd_service as m
orig = m.httpx.AsyncClient
class Spy(orig):
    async def get(self, url, **kw):
        print('GET', url); return await super().get(url, **kw)
m.httpx.AsyncClient = Spy
from backend.services import imd_service
asyncio.run(imd_service.IMDService().get_district_warning('Hyderabad'))
"
```

## 4. What changes for the user

Nothing in the UI has to change — that is the point of the source-mode design:

| | now (`demo`) | after the key (`live`) |
|---|---|---|
| Weather | IMD-grade fixtures, stamped DEMO | real IMD, stamped LIVE |
| Warnings | fixtures | real district warnings |
| Alerts page | demo alerts | live official alerts |
| Push | works | works, now driven by real alerts |

Switch modes at runtime from the top bar or `POST /api/mode {"mode":"hybrid"}`.
`hybrid` keeps the multi-source fallback chain (IMD → SACHET/CAP → Open-Meteo),
so one IMD failure does not blank the screen. The chosen mode is persisted and
survives a restart.

## Still not covered by the key

- **CAP / SACHET** — separate feed, needs `CAP_FEED_URL`. It is the path that
  actually carries the NDMA alerts, and it is what is serving alerts today.
- **WIS 2.0** — the MQTT push-ingest path is a documented stub
  (`wis2_adapter.py`); it needs a broker and the MQTT dependency. The app polls
  CAP instead. Shown honestly on the Trust view as `STUB / UNCONFIGURED`.
- **data.gov.in** — needs `DATAGOV_API_KEY` + `DATAGOV_RESOURCE_ID`.
- **OpenWeatherMap** — needs `OWM_API_KEY`; without it the second-opinion panel
  is hidden rather than shown empty.
