"""
AirFlow AI — TTL Cache (ported from version2/cache.py)
Thread-safe in-memory cache with configurable TTL.
"""
import time
import threading


class TTLCache:
    """Thread-safe dictionary-based TTL cache."""

    def __init__(self, ttl_seconds: int = 300):
        self._store: dict = {}
        self._lock = threading.Lock()
        self.ttl = ttl_seconds

    def get(self, key: str):
        with self._lock:
            entry = self._store.get(key)
            if entry is None:
                return None
            if time.time() - entry["ts"] > self.ttl:
                del self._store[key]
                return None
            return entry["data"]

    def set(self, key: str, data, ttl: int | None = None) -> None:
        with self._lock:
            self._store[key] = {"data": data, "ts": time.time(), "ttl": ttl or self.ttl}

    def delete(self, key: str) -> None:
        with self._lock:
            self._store.pop(key, None)

    def clear(self) -> None:
        with self._lock:
            self._store.clear()

    def size(self) -> int:
        with self._lock:
            return len(self._store)


# Global shared cache instance (10-minute TTL)
cache = TTLCache(ttl_seconds=600)
