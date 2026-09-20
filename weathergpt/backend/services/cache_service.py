"""Simple persistent local cache (memory + JSON file). No external deps for hackathon reliability."""
import json
import threading
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Optional

from .. import config as cfg
from ..utils.time import now_ist

TTLS = {"current": timedelta(minutes=30), "forecast": timedelta(hours=3), "warning": timedelta(hours=6)}

# Round2 S3.1.1: alert-snapshot TTL follows the warnings pattern (6h).
ALERT_TTL = TTLS["warning"]


class CacheService:
    def __init__(self, path: str = "") -> None:
        self.path = Path(path or cfg.CACHE_FILE)
        self._data: dict[str, dict] = {}
        self._lock = threading.Lock()
        # Round2 S3.1.1: in-memory hit/miss counters (replace hit_rate_num "n/a").
        # Kept in memory only: the JSON file holds data, not counters, so a
        # restart resets to 0/0 instead of reporting stale rates.
        self._hits = 0
        self._misses = 0
        self._load()

    def _load(self) -> None:
        try:
            if self.path.exists():
                self._data = json.loads(self.path.read_text(encoding="utf-8"))
        except Exception:
            self._data = {}

    def _save(self) -> None:
        try:
            with self._lock:
                self.path.write_text(json.dumps(self._data, default=str), encoding="utf-8")
        except Exception:
            pass

    def get(self, key: str) -> Optional[dict]:
        with self._lock:
            entry = self._data.get(key)
        if not entry:
            self._misses += 1
            return None
        expires = entry.get("expires_at")
        if expires and self._is_expired(expires):
            self._misses += 1
            return None
        self._hits += 1
        return entry.get("data")

    def set(self, key: str, data: dict, ttl: timedelta) -> None:
        entry = {
            "data": data,
            "retrieved_at": now_ist().isoformat(),
            "expires_at": (now_ist() + ttl).isoformat(),
        }
        with self._lock:
            self._data[key] = entry
        self._save()

    def last_snapshot(self) -> dict:
        with self._lock:
            return {k: v for k, v in self._data.items()}

    # -- Round2 S3.1.1: alert-snapshot helpers (6h TTL, warnings pattern) -----
    @staticmethod
    def alert_key(district: str) -> str:
        return f"alert:{(district or '').strip().lower()}"

    def set_alert(self, district: str, alert: dict) -> None:
        """Snapshot the latest alert payload for a district (6h TTL)."""
        self.set(self.alert_key(district), {"alert": alert, "district": district}, ALERT_TTL)

    def get_alert(self, district: str) -> Optional[dict]:
        """Return the cached alert snapshot, or None on miss/expiry."""
        entry = self.get(self.alert_key(district))
        if not entry:
            return None
        return entry.get("alert")

    def stats(self) -> dict:
        total = self._hits + self._misses
        rate = (self._hits / total) if total else 0.0
        return {"hits": self._hits, "misses": self._misses, "total": total, "hit_rate": round(rate, 4)}

    def reset_stats(self) -> None:
        self._hits = 0
        self._misses = 0

    def hit_rate_num(self) -> str:
        total = self._hits + self._misses
        if not total:
            return "0%"
        return f"{(self._hits / total):.0%}"

    @staticmethod
    def _is_expired(iso: str) -> bool:
        try:
            return datetime.fromisoformat(iso) <= now_ist()
        except ValueError:
            return True