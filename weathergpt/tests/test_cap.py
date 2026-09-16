"""CAP parser tests — §9 field extraction, malformed/empty feeds. Pure, no network."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from backend.adapters.cap_adapter import parse_cap  # noqa: E402

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


if __name__ == "__main__":
    test_full_field_set()
    test_malformed_and_empty()
    test_json_shape()
    print("\nAll CAP tests passed.")
