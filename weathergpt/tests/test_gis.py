"""GIS tests — point-in-polygon, circles, district fallback. Pure functions, no network."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from backend.services import district_service  # noqa: E402
from backend.services.gis_service import (  # noqa: E402
    haversine_km,
    names_district,
    parse_circle,
    parse_polygon,
    point_in_polygon,
    warning_relevant,
)

# Square around Hyderabad centre (17.385, 78.4867)
HYD_SQUARE = "17.3,78.4 17.3,78.6 17.5,78.6 17.5,78.4"


def test_inside_polygon():
    assert point_in_polygon(17.385, 78.4867, parse_polygon(HYD_SQUARE)) is True
    print("PASS: test_inside_polygon")


def test_outside_polygon():
    assert point_in_polygon(19.0, 72.8, parse_polygon(HYD_SQUARE)) is False
    print("PASS: test_outside_polygon")


def test_degenerate_polygon():
    assert point_in_polygon(17.385, 78.4867, parse_polygon("17.3,78.4 17.4,78.5")) is False
    assert point_in_polygon(17.385, 78.4867, parse_polygon("")) is False
    print("PASS: test_degenerate_polygon")


def test_circle_hit_and_miss():
    c = parse_circle("17.385,78.4867 25")
    assert c == (17.385, 78.4867, 25.0)
    assert haversine_km(17.385, 78.4867, 17.5, 78.5) < 25
    rel = warning_relevant({"area": "Somewhere else"}, 17.385, 78.4867, "Somewhere else")
    assert rel == {"relevant": True, "method": "district"}
    rel2 = warning_relevant({"area": "Hyderabad", "circle": "17.385,78.4867 25"}, 17.385, 78.4867, "Rangareddy")
    assert rel2 == {"relevant": True, "method": "circle"}
    rel3 = warning_relevant({"area": "Mumbai", "polygon": HYD_SQUARE}, 19.0, 72.8, "Mumbai")
    assert rel3 == {"relevant": False, "method": "polygon"}
    print("PASS: test_circle_hit_and_miss")


def test_no_coords_district_fallback():
    assert warning_relevant({"area": "Hyderabad district"}, None, None, "Hyderabad")["relevant"] is True
    assert warning_relevant({"area": "Mumbai"}, None, None, "Hyderabad")["relevant"] is False
    print("PASS: test_no_coords_district_fallback")


# --- the bug that started this: the district list is in the headline ---

# Verbatim shape of a live SACHET alert. Geometry empty, areaDesc a weather code,
# and the districts only in the free-text headline.
SACHET_ALERT = {
    "area": "MOD TSRA",
    "areaDesc": "MOD TSRA",
    "headline": (
        "Thunderstorm accompanied with Gusty winds(30-40 Kmph) very likely to occur "
        "at isolated places over Kamareddy, Medak, Medchal Malkajgiri, Ranga Reddy, "
        "Sangareddy, Siddipet, Yadadri Bhuvanagiri of Telangana during next 24 hours."
    ),
    "severity": "ORANGE",
    "polygon": "",
    "circle": "",
}


def test_headline_district_names_are_matched():
    """A district named in the headline must reach a user in that district."""
    rel = warning_relevant(SACHET_ALERT, 17.385, 78.4867, "Kamareddy")
    assert rel == {"relevant": True, "method": "district"}, rel
    print("PASS: test_headline_district_names_are_matched")


def test_area_code_alone_would_have_missed_it():
    """Guard the old behaviour: `areaDesc` is a weather code, not a place.

    If matching ever regresses to area-only, this is what it looks like — the
    district is absent from `area`, so the old code reported "nothing for you"
    about an alert that names the district outright.
    """
    assert "Kamareddy" not in SACHET_ALERT["areaDesc"]
    assert warning_relevant(
        {"area": "MOD TSRA", "areaDesc": "MOD TSRA"}, 17.385, 78.4867, "Kamareddy"
    )["relevant"] is False
    print("PASS: test_area_code_alone_would_have_missed_it")


def test_alias_spelling_matches_via_names():
    """The feed writes "Ranga Reddy"; the user's district is "Rangareddy"."""
    names = district_service.aliases_for("Rangareddy")
    assert "ranga reddy" in names, names
    assert warning_relevant(SACHET_ALERT, 17.385, 78.4867, "Rangareddy", names=names)["relevant"] is True
    # Without the aliases the exact-spelling match fails — which is the point.
    assert warning_relevant(SACHET_ALERT, 17.385, 78.4867, "Rangareddy")["relevant"] is False
    print("PASS: test_alias_spelling_matches_via_names")


def test_unnamed_district_is_not_relevant():
    """Never widen the match: a district absent from the alert stays unmatched."""
    rel = warning_relevant(SACHET_ALERT, 17.385, 78.4867, "Visakhapatnam")
    assert rel["relevant"] is False, rel
    print("PASS: test_unnamed_district_is_not_relevant")


def test_whole_phrase_matching_only():
    """`names_district` must not match inside a longer word."""
    assert names_district({"headline": "over Medak district"}, "Medak") is True
    assert names_district({"headline": "over Medakaranahalli"}, "Medak") is False
    # "Godavari" alone is a river, not a district; only the full name counts.
    assert names_district({"headline": "along the Godavari"}, "East Godavari") is False
    assert names_district({"headline": "over East Godavari"}, "East Godavari") is True
    print("PASS: test_whole_phrase_matching_only")


if __name__ == "__main__":
    test_inside_polygon()
    test_outside_polygon()
    test_degenerate_polygon()
    test_circle_hit_and_miss()
    test_no_coords_district_fallback()
    test_headline_district_names_are_matched()
    test_area_code_alone_would_have_missed_it()
    test_alias_spelling_matches_via_names()
    test_unnamed_district_is_not_relevant()
    test_whole_phrase_matching_only()
    print("\nAll GIS tests passed.")
