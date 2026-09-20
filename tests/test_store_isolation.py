"""The test suite must not touch the developer's real store.

Regression guard for a leak that was invisible until it mattered: conftest set
`DEMO_ALERT_STORE_FILE`, `NOTIFICATION_STORE_FILE` and `DELIVERY_STORE_FILE`,
but no backend code read them — the Round-2 stores go through services/db.py,
which resolved to `<cache_dir>/store/docs_*.json` regardless. Tests that call
`reset_store()` therefore CLEARED the real demo alerts and notification log.
Running `pytest` before a demo wiped the demo.

The fix is `SAARTHI_STORE_DIR`, honoured by `db._json_path`, which relocates the
whole JSON store for the process.
"""
import os
from pathlib import Path

from backend import config
from backend.services import db


def test_store_dir_is_redirected_for_tests():
    """conftest must have moved the store somewhere that is not the real one."""
    assert os.environ.get("SAARTHI_STORE_DIR"), "conftest did not set SAARTHI_STORE_DIR"

    real_store = Path(config.CACHE_FILE).parent / "store"
    in_use = db._json_path("x").parent
    assert in_use.resolve() != real_store.resolve(), (
        f"tests are writing to the REAL store: {in_use}"
    )
    assert Path(os.environ["SAARTHI_STORE_DIR"]).resolve() == in_use.resolve()


def test_writing_a_demo_alert_does_not_touch_the_real_store():
    """A real write through the store layer must land in the temp dir only."""
    from backend.services import demo_alert_store

    real_alerts = Path(config.CACHE_FILE).parent / "store" / "docs_demo_alerts.json"
    before = real_alerts.read_bytes() if real_alerts.exists() else None

    demo_alert_store.reset_store()
    demo_alert_store.create({"title": "isolation probe", "district": "Hyderabad"})

    written = db._json_path("docs_demo_alerts.json")
    assert written.exists(), "the alert was not written anywhere"
    assert "isolation probe" in written.read_text(encoding="utf-8")
    assert written.resolve() != real_alerts.resolve()

    after = real_alerts.read_bytes() if real_alerts.exists() else None
    assert after == before, "the test run modified the real demo alert store"


def test_notification_log_is_isolated():
    from backend.services import notification_service

    real_log = Path(config.CACHE_FILE).parent / "store" / "log_notifications.json"
    before = real_log.read_bytes() if real_log.exists() else None

    notification_service.reset_store()
    notification_service.log("active", "probe title", "probe body", district="Hyderabad")

    written = db._json_path("log_notifications.json")
    assert written.exists()
    assert written.resolve() != real_log.resolve()

    after = real_log.read_bytes() if real_log.exists() else None
    assert after == before, "the test run modified the real notification log"
