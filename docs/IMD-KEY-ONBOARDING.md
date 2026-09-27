# IMD API key onboarding

SAARTHI runs in a single IMD-first mode (see `docs/SOURCE-MODES.md`): IMD is
the primary source, with Open-Meteo / OpenWeatherMap / SACHET-CAP backfill and
cache. There is no mode switch and no `IMD_ADAPTER` toggle — the only thing
that turns IMD on is a real key.

## 1. Generate the key

Request API access at the IMD portal (the API is credential-gated; without a
key the IMD adapter reports `UNCONFIGURED` and the app runs on backfill +
cache, honestly labelled).

## 2. Set `IMD_API_KEY`

- **Production (Render):** set `IMD_API_KEY` in the Render dashboard
  (Environment tab of the backend service). Redeploy after saving.
- **Local:** add it to your `.env`:
  ```ini
  IMD_API_KEY=<the key>
  ```

That is the whole change — no code change, no mode to flip. Restart the
backend and check the source actually took:

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
IMD_PATH_NOWCAST=districtnowcast    # nowcast
```

If the key returns `400 Bad Request` or `401`, that is the wiring working and the
path or the auth scheme being wrong — not a broken integration. Adjust the
`IMD_PATH_*` line (or `IMD_BASE_URL`) and restart. No code change needed.

To see the exact URL being attempted:

```bash
cd weathergpt && IMD_API_KEY=<key> python -c "
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

Nothing in the UI has to change — that is the point of the single-mode design.
Before the key, IMD cards read `UNCONFIGURED` and answers ride the backfill
chain; after the key, the same cards read real IMD data, stamped `LIVE`. The
provenance chips always name the actual source.

## Still not covered by the key

- **CAP / SACHET** — separate feed, needs `CAP_FEED_URL`. It is the path that
  actually carries the NDMA alerts.
- **WIS 2.0** — the MQTT push-ingest path is a documented stub
  (`wis2_adapter.py`); it needs a broker and the MQTT dependency. The app polls
  CAP instead. Shown honestly on the Trust view as `STUB / UNCONFIGURED`.
- **data.gov.in** — needs `DATAGOV_API_KEY` + `DATAGOV_RESOURCE_ID`.
- **OpenWeatherMap** — needs `OWM_API_KEY`; without it the second-opinion panel
  is hidden rather than shown empty.
