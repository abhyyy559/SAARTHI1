"""CAP parser tests — §9 field extraction, malformed/empty feeds. Pure, no network."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from backend.adapters.cap_adapter import parse_cap, _rss_item_links  # noqa: E402

MINIMAL_CAP = """<?xml version="1.0" encoding="UTF-8"?>
<alert xmlns="urn:oasis:names:tc:emergency:cap:1.2">
  <identifier>IMD-HYD-001</identifier>
  <sender>imd@mausam.in</sender>
  <sent>2026-09-15T18:00:00+05:30</sent>
  <status>Actual</status>
  <msgType>Alert</msgType>
  <scope>Public</scope>
  <info>
    <language>en-IN</language>
    <category>Met</category>
    <event>Thunderstorm</event>
    <urgency>Expected</urgency>
    <severity>Moderate</severity>
    <certainty>Likely</certainty>
    <effective>2026-09-15T18:00:00+05:30</effective>
    <onset>2026-09-15T19:00:00+05:30</onset>
    <expires>2026-09-16T02:00:00+05:30</expires>
    <headline>Thunderstorm with lightning likely</headline>
    <description>Thunderstorm with lightning likely at isolated places.</description>
    <instruction>Avoid exposed areas.</instruction>
    <area>
      <areaDesc>Hyderabad district, Telangana</areaDesc>
      <polygon>17.3,78.4 17.3,78.6 17.5,78.6 17.5,78.4</polygon>
    </area>
  </info>
</alert>"""


def test_full_field_set():
    alerts = parse_cap(MINIMAL_CAP)
    assert len(alerts) == 1, f"expected 1 alert, got {len(alerts)}"
    a = alerts[0]
    for field in ("identifier", "sender", "sent", "status", "msgType", "scope",
                  "language", "category", "urgency", "certainty", "effective",
                  "onset", "expires", "headline", "description", "instruction",
                  "area", "polygon"):
        assert a.get(field), f"missing {field}"
    assert a["identifier"] == "IMD-HYD-001"
    assert a["severity"] == "YELLOW" and a["cap_severity"] == "Moderate"
    assert a["hazard"] == "Thunderstorm"
    print("PASS: test_full_field_set")


def test_malformed_and_empty():
    assert parse_cap("") == []
    assert parse_cap("   ") == []
    assert parse_cap("<not-xml") == []
    assert parse_cap('{"nope": true}') == []
    print("PASS: test_malformed_and_empty")


def test_json_shape():
    alerts = parse_cap('{"alerts": [{"event": "Heat Wave", "severity": "Severe", "area": "Nagpur"}]}')
    assert len(alerts) == 1 and alerts[0]["severity"] == "ORANGE"
    print("PASS: test_json_shape")


SACHET_RSS = """<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
<title>Telangana: CAP Disaster Alert Feeds</title>
<item><title>Thundering with Lightning likely over ADL</title>
<link>https://sachet.ndma.gov.in/cap_public_website/FetchXMLFile?identifier=1789629665262030</link></item>
<item><title>Moderate Rain likely over Warangal</title>
<link>https://sachet.ndma.gov.in/cap_public_website/FetchXMLFile?identifier=1789480863065030</link></item>
</channel></rss>"""


def test_rss_envelope_yields_item_links():
    assert parse_cap(SACHET_RSS) == []  # no inline alerts — links must be followed
    links = _rss_item_links(SACHET_RSS)
    assert len(links) == 2
    assert all("FetchXMLFile?identifier=" in u for u in links)
    assert _rss_item_links("") == []
    print("PASS: test_rss_envelope_yields_item_links")


# TGiCCC bulletins use district acronyms; people cannot act on 'HYD'.
def test_acronyms_expanded_in_parsed_alert():
    from backend.adapters.cap_adapter import _normalize
    alert = _normalize({
        "event": "Thunderstorm",
        "severity": "Moderate",
        "headline": "Gusty winds over ADL, BDDK, HNM, HYD, NZD in next 24 hours",
        "description": "Likely at many places over RR,SGD,SDP,VKD.",
        "areaDesc": "23 districts of Telangana",
    })
    for name in ("Adilabad", "Bhadradri Kothagudem", "Hanumakonda", "Hyderabad", "Nizamabad"):
        assert name in alert["headline"], name
    assert "ADL" not in alert["headline"]
    assert "Rangareddy" in alert["description"]
    print("PASS: test_acronyms_expanded_in_parsed_alert")


def test_unknown_acronym_left_alone():
    from backend.adapters.cap_adapter import _normalize
    alert = _normalize({"event": "Rain", "headline": "Rain over XYZQ district", "severity": "Minor"})
    assert "XYZQ" in alert["headline"]  # never guessed
    print("PASS: test_unknown_acronym_left_alone")


if __name__ == "__main__":
    test_full_field_set()
    test_malformed_and_empty()
    test_json_shape()
    test_rss_envelope_yields_item_links()
    print("\nAll CAP tests passed.")
