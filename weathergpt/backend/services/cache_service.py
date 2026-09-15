"""Simple persistent local cache (memory + JSON file). No external deps for hackathon reliability."""
import json
import threading
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Optional

from .. import config as cfg
from ..utils.time import now_ist

TTLS = {"current": timedelta(minutes=30), "forecast": timedelta(hours=3), "warning": timedelta(hours=6)}


class CacheService:
    def __init__(self, path: str = "") -> None:
        self.path = Path(path or cfg.CACHE_FILE)
        self._data: dict[str, dict] = {}
        self._lock = threading.Lock()
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
            return None
        expires = entry.get("expires_at")
        if expires and self._is_expired(expires):
            return None
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

    def hit_rate_num(self) -> str:
        return "n/a"

    @staticmethod
    def _is_expired(iso: str) -> bool:
        try:
            return datetime.fromisoformat(iso) <= now_ist()
        except ValueError:
            return True