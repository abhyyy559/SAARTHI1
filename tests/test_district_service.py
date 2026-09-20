"""District gazetteer tests — the data file, the alias table, and text matching.

No network. This is the module that decides whether an official alert naming a
district reaches a user in that district, so the failure modes here are silent:
a wrong alias or a too-eager match does not crash, it just quietly shows the
wrong people the wrong warning.
"""
import sys, os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from backend.services import district_service  # noqa: E402
from backend.services.location_service import GAZETTEER, LocationService  # noqa: E402


# --- the data file ---

def test_gazetteer_covers_every_district_of_both_states():
    """The CAP feeds address all 33 Telangana and 26 Andhra districts; the old
    hand-written list carried 14 places in total, so most users resolved to a
    district hundreds of kilometres away and were matched against the wrong one."""
    by_state = {}
    for row in district_service.DISTRICTS:
        by_state.setdefault(row["state"], []).append(row["district"])
    assert len(by_state["Telangana"]) == 33, sorted(by_state["Telangana"])
    assert len(by_state["Andhra Pradesh"]) == 26, sorted(by_state["Andhra Pradesh"])
    print("PASS: test_gazetteer_covers_every_district_of_both_states")


def test_every_row_is_usable():
    for row in district_service.DISTRICTS:
        assert row["district"].strip()
        assert row["state"] in ("Telangana", "Andhra Pradesh")
        assert 12.0 <= row["latitude"] <= 20.0, row
        assert 76.0 <= row["longitude"] <= 85.0, row
        # Provenance of the coordinate, so nobody mistakes an HQ pin for geometry.
        assert row["coord_source"] in ("gadm", "hq"), row
        assert isinstance(row["coastal"], bool)
        assert row["aliases"], row
    print("PASS: test_every_row_is_usable")


def test_no_alias_means_two_different_districts():
    """A spelling that maps to two districts would make matching a coin flip."""
    seen = {}
    for row in district_service.DISTRICTS:
        for alias in row["aliases"]:
            key = district_service.norm_name(alias)
            assert key not in seen or seen[key] == row["district"], (alias, seen.get(key), row["district"])
            seen[key] = row["district"]
    print("PASS: test_no_alias_means_two_different_districts")


def test_coastal_flag_is_present_for_the_coast():
    """`coastal` drives the "you are inland, sea advice does not apply" line, so a
    missing flag is a wrong statement, not a missing nicety."""
    assert district_service.is_coastal("Visakhapatnam") is True
    assert district_service.is_coastal("Hyderabad") is False
    # Outside our coverage the answer is "unknown", which is not "inland".
    assert district_service.is_coastal("Mumbai") is None
    print("PASS: test_coastal_flag_is_present_for_the_coast")


def test_every_telangana_district_has_an_acronym_expansion():
    """TGiCCC bulletins abbreviate districts, and an unexpanded acronym is not
    neutral: it stays literal ("KMD"), matches no district name, and the alert
    reaches nobody in the district it was issued for.

    This is the drift guard between the two district tables — the gazetteer and
    the acronym map must name the same 33 districts.
    """
    from backend.adapters.cap_adapter import _TG_DISTRICT_ACRONYMS

    covered = set(_TG_DISTRICT_ACRONYMS.values())
    known = {d["district"] for d in district_service.DISTRICTS}
    missing = sorted(d for d in known if district_service.state_of(d) == "Telangana" and d not in covered)
    assert missing == [], f"Telangana districts with no acronym expansion: {missing}"
    # No acronym may name a district that does not exist...
    assert covered <= known, sorted(covered - known)
    # ...and none may be ambiguous between two of them.
    assert len(set(_TG_DISTRICT_ACRONYMS.values())) == len(_TG_DISTRICT_ACRONYMS)
    print("PASS: test_every_telangana_district_has_an_acronym_expansion")


# --- aliases ---

def test_aliases_cover_the_spellings_the_feeds_use():
    assert "ranga reddy" in district_service.aliases_for("Rangareddy")
    assert "kothagudem" in district_service.aliases_for("Bhadradri Kothagudem")
    assert "asifabad" in district_service.aliases_for("Komaram Bheem Asifabad")
    assert "vijayawada" in district_service.aliases_for("NTR")
    # A district we do not carry still matches itself, so a coverage gap degrades
    # to the old exact-match behaviour instead of breaking.
    assert district_service.aliases_for("Mumbai") == {"mumbai"}
    print("PASS: test_aliases_cover_the_spellings_the_feeds_use")


# --- text matching ---

LIVE_HEADLINE = (
    "Moderate Rain/thundershowers is very likely to occur at many places over "
    "Kamareddy, Medak, Medchal Malkajgiri, Ranga Reddy, Sangareddy, Siddipet, "
    "Yadadri Bhuvanagiri of Telangana during next 24 hours."
)


def test_find_in_text_reads_a_real_headline():
    found = district_service.find_in_text(LIVE_HEADLINE)
    assert "Kamareddy" in found
    assert "Rangareddy" in found, found          # via the "Ranga Reddy" alias
    assert "Yadadri Bhuvanagiri" in found
    assert "Hyderabad" not in found
    print("PASS: test_find_in_text_reads_a_real_headline")


def test_find_in_text_is_whole_phrase():
    assert district_service.find_in_text("over Medak district") == {"Medak"}
    assert district_service.find_in_text("over Medakaranahalli") == set()
    assert district_service.find_in_text("") == set()
    print("PASS: test_find_in_text_is_whole_phrase")


def test_find_in_text_is_case_and_punctuation_insensitive():
    assert "Hyderabad" in district_service.find_in_text("...over HYDERABAD.")
    assert "Hyderabad" in district_service.find_in_text("over hyderabad,")
    print("PASS: test_find_in_text_is_case_and_punctuation_insensitive")


# --- the resolver ---

def test_district_the_old_gazetteer_could_not_resolve():
    """Kamareddy was absent from the 14-entry list, so a user there silently
    resolved to whichever city happened to be nearest."""
    loc = LocationService().resolve(None, None, query="Kamareddy")
    assert loc["district"] == "Kamareddy", loc
    assert loc["state"] == "Telangana"
    print("PASS: test_district_the_old_gazetteer_could_not_resolve")


def test_feed_spelling_finds_the_district():
    """A user who reads "Ranga Reddy" in an alert must be able to search it."""
    loc = LocationService().resolve(None, None, query="Ranga Reddy")
    assert loc["district"] == "Rangareddy", loc
    print("PASS: test_feed_spelling_finds_the_district")


def test_gps_fix_lands_in_the_right_district():
    # ~Kamareddy town, which the old gazetteer resolved to Nizamabad or Hyderabad.
    assert LocationService().resolve(18.32, 78.34)["district"] == "Kamareddy"
    # A coastal AP fix resolves to that district, not to Visakhapatnam.
    bapatla = LocationService().resolve(15.90, 80.47)
    assert bapatla["district"] == "Bapatla", bapatla
    assert bapatla["coastal"] is True
    # The two districts that share the old Krishna region still resolve apart:
    # Machilipatnam is in Krishna, Vijayawada is in NTR.
    assert LocationService().resolve(16.1873, 81.1389)["district"] == "Krishna"
    assert LocationService().resolve(16.5062, 80.6480)["district"] == "NTR"
    print("PASS: test_gps_fix_lands_in_the_right_district")


def test_districts_resolve_to_themselves_from_their_own_coordinate():
    """A district's own coordinate should resolve back to that district.

    58 of 59 do. The exception is Krishna, and it is expected rather than a bug:
    the GADM polygon is the *pre-2022* Krishna district, which contained
    Vijayawada — now NTR — so the old polygon's centroid sits inside modern NTR
    territory. No user's GPS fix lands on a polygon centroid, and the districts
    users actually live in resolve correctly (see the test above).
    """
    wrong = []
    for row in district_service.DISTRICTS:
        got = LocationService().resolve(row["latitude"], row["longitude"])
        if got["district"] != row["district"]:
            wrong.append((row["district"], got["district"]))
    assert wrong == [("Krishna", "NTR")], wrong
    print("PASS: test_districts_resolve_to_themselves_from_their_own_coordinate")


def test_no_wildcard_tokens_in_the_gazetteer():
    """Regression: "Dr. B.R. Ambedkar Konaseema" used to contribute the tokens "b"
    and "r", and the resolver tests "token is a substring of the query", so every
    query containing a "b" matched that district — "hydrbadd" and "bangalore" both
    resolved to a place in coastal Andhra Pradesh."""
    from backend.services.location_service import _tokens

    for entry in GAZETTEER:
        for tok in _tokens(entry):
            assert len(tok) >= 3, (entry["district"], tok)
    assert LocationService().resolve(None, None, query="hydrbadd")["district"] == "Hyderabad"
    assert LocationService().resolve(None, None, query="bangalore")["district"] == "Bengaluru Urban"
    print("PASS: test_no_wildcard_tokens_in_the_gazetteer")


def test_city_entries_still_win_their_own_district():
    """City entries name a town, which is what the answer layer wants to say."""
    assert LocationService().resolve(None, None, query="Machilipatnam")["city"] == "Machilipatnam"
    assert LocationService().resolve(None, None, query="Machilipatnam")["district"] == "Krishna"
    # No district appears twice in the merged list.
    keys = [(e["state"], e["district"]) for e in GAZETTEER]
    assert len(keys) == len(set(keys)), [k for k in keys if keys.count(k) > 1]
    print("PASS: test_city_entries_still_win_their_own_district")


if __name__ == "__main__":
    test_gazetteer_covers_every_district_of_both_states()
    test_every_row_is_usable()
    test_no_alias_means_two_different_districts()
    test_coastal_flag_is_present_for_the_coast()
    test_every_telangana_district_has_an_acronym_expansion()
    test_aliases_cover_the_spellings_the_feeds_use()
    test_find_in_text_reads_a_real_headline()
    test_find_in_text_is_whole_phrase()
    test_find_in_text_is_case_and_punctuation_insensitive()
    test_district_the_old_gazetteer_could_not_resolve()
    test_feed_spelling_finds_the_district()
    test_gps_fix_lands_in_the_right_district()
    test_districts_resolve_to_themselves_from_their_own_coordinate()
    test_no_wildcard_tokens_in_the_gazetteer()
    test_city_entries_still_win_their_own_district()
    print("\nAll district gazetteer tests passed.")
