"""GIS tests — point-in-polygon, circles, district fallback. Pure functions, no network."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from backend.services.gis_service import (  # noqa: E402
    haversine_km,
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


if __name__ == "__main__":
    test_inside_polygon()
    test_outside_polygon()
    test_degenerate_polygon()
    test_circle_hit_and_miss()
    test_no_coords_district_fallback()
    print("\nAll GIS tests passed.")
