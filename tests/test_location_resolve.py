"""Location resolution — GPS coords map to the nearest known district (haversine)."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from backend.services.location_service import LocationService  # noqa: E402


def test_hyderabad_coords_resolve_hyderabad():
    loc = LocationService().resolve(17.385, 78.4867)
    assert loc["district"] == "Hyderabad"
    print("PASS: test_hyderabad_coords_resolve_hyderabad")


def test_mumbai_coords_resolve_mumbai():
    loc = LocationService().resolve(19.08, 72.88)
    assert loc["district"] == "Mumbai"
    print("PASS: test_mumbai_coords_resolve_mumbai")


def test_query_search_still_works():
    loc = LocationService().resolve(None, None, query="nellore")
    assert loc["district"] == "Nellore"
    print("PASS: test_query_search_still_works")


async def _demo_warning(district: str):
    from backend.services.imd_service import IMDService
    return await IMDService(adapter="demo").get_district_warning(district)


def test_demo_warning_retargets_district():
    import asyncio
    w = asyncio.run(_demo_warning("Visakhapatnam"))
    assert w is not None and w.district == "Visakhapatnam"
    assert w.source == "IMD"  # source label unchanged; provenance stays DEMO
    print("PASS: test_demo_warning_retargets_district")


def test_demo_cap_fixture_retargets_district():
    from backend.adapters import cap_adapter
    alerts, prov = cap_adapter.demo_fixture("Visakhapatnam")
    assert prov == "DEMO"
    assert alerts, "fixture must yield at least one alert"
    assert "Hyderabad" not in (alerts[0].get("areaDesc") or "")
    assert "Visakhapatnam" in (alerts[0].get("areaDesc") or "")
    print("PASS: test_demo_cap_fixture_retargets_district")


# --- typo tolerance: users mistype districts, voice garbles them worse ---

def test_alias_resolves_vizag():
    loc = LocationService().resolve(None, None, query="vizag")
    assert loc["district"] == "Visakhapatnam"
    print("PASS: test_alias_resolves_vizag")


def test_alias_resolves_bangalore_and_delhi():
    assert LocationService().resolve(None, None, query="bangalore")["district"] == "Bengaluru Urban"
    assert LocationService().resolve(None, None, query="delhi")["district"] == "New Delhi"
    print("PASS: test_alias_resolves_bangalore_and_delhi")


def test_mistyped_district_still_resolves():
    # Misspellings resolve instead of failing: the point of the fuzzy brain.
    assert LocationService().resolve(None, None, query="hydrbadd")["district"] == "Hyderabad"
    assert LocationService().resolve(None, None, query="mumbay")["district"] == "Mumbai"
    print("PASS: test_mistyped_district_still_resolves")


def test_search_flags_suggestions_for_typos():
    results = LocationService().search("bangalre")
    assert results and results[0]["district"] == "Bengaluru Urban"
    assert results[0].get("suggested") is True
    print("PASS: test_search_flags_suggestions_for_typos")


def test_exact_search_not_flagged_as_suggestion():
    results = LocationService().search("nellore")
    assert results and results[0]["district"] == "Nellore"
    assert not results[0].get("suggested")
    print("PASS: test_exact_search_not_flagged_as_suggestion")


def test_garbage_query_falls_back_to_coords():
    # No confident match -> nearest-district fallback, never a wrong guess.
    loc = LocationService().resolve(None, None, query="zzqqxx")
    assert loc.get("district")
    print("PASS: test_garbage_query_falls_back_to_coords")


if __name__ == "__main__":
    test_hyderabad_coords_resolve_hyderabad()
    test_mumbai_coords_resolve_mumbai()
    test_query_search_still_works()
    test_demo_warning_retargets_district()
    test_demo_cap_fixture_retargets_district()
    test_alias_resolves_vizag()
    test_alias_resolves_bangalore_and_delhi()
    test_mistyped_district_still_resolves()
    test_search_flags_suggestions_for_typos()
    test_exact_search_not_flagged_as_suggestion()
    test_garbage_query_falls_back_to_coords()
    print("\nAll location resolve tests passed.")
