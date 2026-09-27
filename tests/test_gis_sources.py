"""GIS jobs and WIS2 must appear in /api/sources with honest statuses.

Regression: the Trust & sources panel only showed adapters (SACHET CAP,
Open-Meteo, WIS2, IMD) while the "How it works" explainer documented three GIS
jobs — GIS never appeared in the sources section. These jobs are now
first-class sources with the same honesty rules as adapters: no mock is ever
labelled LIVE.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from backend.adapters import registry  # noqa: E402


def test_gis_jobs_present_with_honest_status():
    snap = {s["name"]: s for s in registry.snapshot()}
    # Job 1 "Where am I?" — pure local haversine math, always live-capable.
    assert snap["gis-location"]["status"] == "LIVE"
    # Job 3 "Hazard distance" — pure local haversine math, always live-capable.
    assert snap["gis-hazard"]["status"] == "LIVE"
    # Job 2 "Am I inside the warning polygon?" — district-name matching is the
    # live working path; polygon/circle geometry matching activates only when
    # a CAP bulletin actually carries geometry, which live SACHET feeds
    # currently do not. The status is LIVE for the working path, with the
    # detail saying exactly which half is idle — never an inflated claim that
    # geometry matching is verified.
    assert snap["gis-polygon"]["status"] == "LIVE"
    assert "district-name matching live" in snap["gis-polygon"]["detail"]
    assert "geometry" in snap["gis-polygon"]["detail"]
    # WIS 2.0 — MQTT broker/deps not set; CAP polling used instead.
    assert snap["wis2"]["status"] == "UNCONFIGURED"
    assert "CAP polling" in snap["wis2"]["detail"]


def test_gis_location_reports_live_after_real_resolve():
    from backend.services.location_service import LocationService

    LocationService().resolve(17.385, 78.4867)  # Hyderabad GPS fix
    st = registry.get_status("gis-location")
    assert st.status == "LIVE"
    assert st.updated_at, "a real run must refresh the checked-at timestamp"
    assert "Hyderabad" in st.detail
