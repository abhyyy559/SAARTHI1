# Alert Heatmap — Design Spec

**Date:** 2026-10-10
**Status:** Approved
**Author:** SAARTHI

## Goal

Add a geographic heatmap view showing alert severity, weather, and health
advisories across the Telangana + Andhra Pradesh districts SAARTHI serves.

## Background

The app already has `DistrictMap.jsx` — a schematic SVG map (one dot per
district, colored by worst active alert severity) that is fully offline and
tile-free. That map stays unchanged. This spec adds a *second*, richer map
view for users who want real geography and a heat layer.

Existing assets reused:

- `backend/data/districts_telangana_andhra.json` — district centroids
  (`district`, `state`, `latitude`, `longitude`, `aliases`).
- `backend/adapters/openmeteo_adapter.py` — live weather, no key required.
- `backend/services/alert_service.py` — `gather_alerts()` collects and
  classifies CAP/alerts for a district.
- `backend/services/advisory_cards_service.py` — heat/cold health card logic
  (`health_heat`, `health_cold`, `health_calm`, `health_no_data`).
- `frontend-react/src/api.js` — API client conventions and timeout policy.

## Architecture

```
GET /api/map/layers
        │
        ├── alerts   per-district worst active severity (0–4)
        ├── weather  temperature / humidity / condition (Open-Meteo, cached)
        └── health   risk score from weather (heat/cold thresholds)
```

One endpoint returns all three layers in a single payload so the frontend
makes one request and can swap layers client-side with no refetch.

### Backend — `backend/api/map.py`

New APIRouter, prefix `/api`.

`GET /api/map/layers` returns:

```json
{
  "generated_at": "...",
  "provenance": "LIVE",
  "districts": [
    {
      "district": "Hyderabad",
      "state": "Telangana",
      "latitude": 17.3856,
      "longitude": 78.4641,
      "alerts": { "severity": 4, "severity_label": "RED", "count": 2, "active": true },
      "weather": { "temperature": 32.3, "humidity": 34, "condition": "Clear", "precipitation": 0.0 },
      "health": { "risk": "high", "risk_score": 2, "basis": "heat" }
    }
  ]
}
```

Rules:

- **Alerts** — worst *active* severity per district. Terminal lifecycle states
  (`ENDED`, `CANCELLED`) never count. `count` is the number of active alerts.
  A district with no data reads `severity: 1` / `severity_label: "UNKNOWN"` and
  `active: false` — never a fabricated green.
- **Weather** — Open-Meteo current observation per district, batch-fetched with
  bounded concurrency and cached 10 minutes (`TTLS["current"]`). Unreachable
  weather yields `weather: null` for that district, not an invented number.
  `imd` source mode omits non-official weather rather than backfilling.
- **Health** — derived from the same weather numbers by reusing the existing
  heat/cold thresholds (no new risk model): sustained heat above the advisory
  heat threshold reads `high`, cold threshold reads `high`, otherwise `low`.
  Weather unavailable → `risk: "unknown"`, `risk_score: null`.
- **Provenance** — always names the actual chain result. Whole-endpoint failure
  returns `provenance: "UNAVAILABLE"` with an empty district list, never stale
  data passed off as live.

Failure is per-district, not all-or-nothing: one unreachable district does not
blank the map.

### Frontend — `frontend-react/src/components/AlertHeatmap.jsx`

- Leaflet map + `leaflet.heat` heat layer over OpenStreetMap tiles.
- Three toggleable layers as chip buttons: **Alerts**, **Weather**, **Health**.
  Only one heat layer is active at a time; chips switch the active layer.
- Heat intensity per district: alerts → normalized severity (0–1), weather →
  normalized temperature, health → risk score.
- Each district also renders a small circle marker with a popup showing the
  three values, so the exact numbers stay readable (the heat layer alone is
  deliberately coarse).
- Entry point: new `map` view, registered in `App.jsx` `VIEWS`, reachable from
  the desktop rail and the mobile tab bar in `Shell.jsx`.
- Loading state renders a status line; UNAVAILABLE renders an honest message.

### Files

| File | Change |
|---|---|
| `frontend-react/package.json` | add `leaflet`, `leaflet.heat`, `react-leaflet` |
| `backend/api/map.py` | new router |
| `backend/main.py` | register router |
| `frontend-react/src/components/AlertHeatmap.jsx` | new |
| `frontend-react/src/components/AlertHeatmap.css` | new |
| `frontend-react/src/api.js` | `mapLayers()` |
| `frontend-react/src/App.jsx` | register `map` view |
| `frontend-react/src/components/Shell.jsx` | rail + mobile nav entry |
| `frontend-react/src/i18n.js` + strings | labels for the new view |

## Non-goals

- No true state/district polygon outlines (centroid heat points only).
- No offline tile support — tiles need a network; the heat layer degrades
  gracefully to markers.
- No new health risk model — existing advisory thresholds are reused.

## Testing

- Backend: pytest for `/api/map/layers` — per-district failure isolation,
  provenance honesty, `imd` mode omitting non-official weather.
- Frontend: `node --test` for layer normalization helpers; build must pass.
