"""Regression tests for two silent state-loss bugs found in the JSON store.

Both bugs were invisible: nothing raised, nothing logged, and the value even
round-tripped in-process. They only showed up as state that "disappeared" after
a restart — the persisted source mode reverted to hybrid and the demo panel
started 403-ing.

1. `mode:source_mode` contains a ':'. On Windows a ':' inside a path is not a
   filename, it starts an NTFS ALTERNATE DATA STREAM: the write succeeds, but no
   ordinary file appears — so the row is invisible to directory listings,
   backups, git and OneDrive sync.
2. `CACHE_FILE` was relative, so the store directory depended on the process
   working directory. Starting the server from the repo root and from
   `weathergpt/` pointed at two DIFFERENT `store/` dirs, and the mode, the demo
   alert store and the ledger silently diverged.
"""
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

BACKEND_ROOT = Path(__file__).resolve().parents[1]
ILLEGAL_ON_WINDOWS = set('<>:"/\\|?*')


def test_kv_filename_is_filesystem_safe():
    from backend.services import db

    name = db._kv_filename("mode:source_mode")
    assert ":" not in name, "a ':' in a filename becomes an NTFS data stream"
    assert not (set(name) & ILLEGAL_ON_WINDOWS), name
    assert name.startswith("kv_") and name.endswith(".json")
    # stable + collision-resistant for the two real-world shapes
    assert db._kv_filename("mode:source_mode") == db._kv_filename("mode:source_mode")
    assert db._kv_filename("mode:source_mode") != db._kv_filename("mode:source-mode")
    # a key that is already safe must not move (existing rows stay readable)
    assert db._kv_filename("alert_watch_state") == "kv_alert_watch_state.json"


def test_colon_key_lands_as_a_real_file(tmp_path, monkeypatch):
    """The exact key that broke: it must produce an ordinary, listable file."""
    from backend.services import db

    monkeypatch.setattr(db, "_json_path", lambda name: tmp_path / name)
    db._json_kv_set("mode:source_mode", "demo")

    on_disk = sorted(p.name for p in tmp_path.iterdir())
    assert "kv_mode_source_mode.json" in on_disk, f"no real file written, got {on_disk}"
    assert json.loads((tmp_path / "kv_mode_source_mode.json").read_text(encoding="utf-8")) == "demo"
    assert db._json_kv_get("mode:source_mode") == "demo"


def test_kv_get_still_reads_a_pre_sanitise_row(tmp_path, monkeypatch):
    """A row written before the fix must not be lost by the rename."""
    from backend.services import db

    monkeypatch.setattr(db, "_json_path", lambda name: tmp_path / name)
    (tmp_path / "kv_alert_watch_state.json").write_text('{"seen": 1}', encoding="utf-8")
    assert db._json_kv_get("alert_watch_state") == {"seen": 1}


def test_cache_file_is_absolute():
    """A relative CACHE_FILE is what let the store location follow the cwd."""
    from backend import config

    assert Path(config.CACHE_FILE).is_absolute(), config.CACHE_FILE
    assert Path(config.CACHE_FILE).parent == BACKEND_ROOT


def _store_probe(cwd: Path, env: dict) -> dict:
    """Import the backend in a fresh process from `cwd` and report its paths."""
    probe = (
        "import sys, json;"
        f"sys.path.insert(0, r'{BACKEND_ROOT}');"
        "from backend import config;"
        "from backend.services import db;"
        "print(json.dumps({'cache': config.CACHE_FILE,"
        " 'store': str(db._json_path('x').parent.resolve())}))"
    )
    out = subprocess.run(
        [sys.executable, "-c", probe],
        cwd=str(cwd), capture_output=True, text=True, timeout=120,
        env={**env, "PYTHONPATH": str(BACKEND_ROOT)},
    )
    assert out.returncode == 0, out.stderr
    return json.loads(out.stdout.strip().splitlines()[-1])


def test_store_dir_does_not_depend_on_cwd():
    """Import the backend from two different working directories; the store must
    resolve to the SAME place. This is the bug that split state in two.

    The env is scrubbed of SAARTHI_STORE_DIR (which conftest sets) so this
    exercises the real default resolution, not the test override.
    """
    env = {k: v for k, v in os.environ.items() if k != "SAARTHI_STORE_DIR"}
    from_root = _store_probe(BACKEND_ROOT.parent, env)
    from_pkg = _store_probe(BACKEND_ROOT, env)

    assert from_root["store"] == from_pkg["store"], (
        f"store location follows the cwd: {from_root['store']} vs {from_pkg['store']}"
    )
    assert Path(from_root["cache"]).is_absolute()
    # with no override, the store sits beside the (absolute) cache file
    assert Path(from_root["store"]) == Path(from_root["cache"]).parent / "store"


def test_store_dir_override_relocates_everything():
    """SAARTHI_STORE_DIR is what makes test isolation real — it must win, from
    any cwd, for every row (kv, documents and logs alike)."""
    override = BACKEND_ROOT / "_probe_store"
    env = {**os.environ, "SAARTHI_STORE_DIR": str(override)}
    resolved = _store_probe(BACKEND_ROOT.parent, env)
    assert Path(resolved["store"]) == override.resolve()
