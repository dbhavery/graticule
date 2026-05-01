"""In-memory live state + WebSocket fan-out, generic across layers.

One process, one StateStore. Feeds upsert into named layers (planes, ships,
quakes, hurricanes, volcanoes, fires, tsunamis, satellites). Subscribers
receive deltas. Stale entries (no update in their layer's expiry window)
drop on the next expire() call.

Static / one-shot layers (volcanoes, satellite TLEs, weather metadata) live
in `meta` — not subject to the rolling expiry. Imagery overlay layers
(radar, aurora) push their metadata blob there too so the front-end can
build the imagery URLs.
"""
from __future__ import annotations

import asyncio
import json
import time
from dataclasses import dataclass, field
from typing import Any

from fastapi import WebSocket
from loguru import logger

# Per-layer expiry. Layers not listed here never expire (volcanoes, sat TLEs).
EXPIRE_SEC: dict[str, int] = {
    "planes":     300,    # 5 min
    "ships":      900,    # 15 min — AIS positions can be sparse
    "quakes":     7 * 86400,  # 7d — match USGS all_week feed; client filters by age
    "hurricanes": 21600,  # 6 h — NHC publishes ~3-6 hourly
    "tsunamis":   3600,   # 1 h — alerts are short-lived
    "fires":      4 * 86400,  # 4d — FIRMS rolling 3d feed; small slack
    "launches":   7200,   # 2 h — feed-side full replace each refresh anyway
    "news":       7200,   # 2 h — likewise
    "severe":     3600,   # 1 h — NWS active alerts
    "tfrs":       3600,   # 1 h
}


@dataclass
class StateStore:
    # Dynamic layers (rolling, per-entity)
    layers: dict[str, dict[str, dict[str, Any]]] = field(default_factory=lambda: {
        "planes":     {},
        "ships":      {},
        "quakes":     {},
        "hurricanes": {},
        "tsunamis":   {},
        "fires":      {},
        "volcanoes":  {},  # one-shot static, but uses the same per-id dict shape
        "satellites": {},  # holds {id: {name, tle1, tle2}} — propagated client-side
        "launches":   {},
        "news":       {},
        "severe":     {},
        "airports":   {},
        "tfrs":       {},
    })
    # Singleton metadata blobs (radar tile manifest, aurora grid, etc.)
    meta: dict[str, Any] = field(default_factory=dict)

    subscribers: set[WebSocket] = field(default_factory=set)

    # ---------- generic upsert / clear ----------

    def upsert(self, layer: str, entity_id: str, data: dict[str, Any]) -> None:
        """Insert or update one entity in a layer; broadcast a delta."""
        if layer not in self.layers:
            self.layers[layer] = {}
        data["ts"] = time.time()
        self.layers[layer][entity_id] = data
        self._broadcast({"type": layer, "id": entity_id, "data": data})

    def replace_layer(self, layer: str, entries: dict[str, dict[str, Any]]) -> None:
        """Atomic replacement — used by feeds that fetch a complete snapshot
        each cycle (hurricanes, tsunamis, satellites, volcanoes one-shot)."""
        now = time.time()
        for v in entries.values():
            v.setdefault("ts", now)
        self.layers[layer] = entries
        self._broadcast({"type": f"{layer}:reset", "data": entries})

    def set_meta(self, key: str, value: Any) -> None:
        self.meta[key] = value
        self._broadcast({"type": "meta", "key": key, "data": value})

    # ---------- back-compat shims ----------
    # (the existing adsb.py and ais.py modules call these names)

    def upsert_plane(self, icao24: str, data: dict[str, Any]) -> None:
        self.upsert("planes", icao24, data)

    def upsert_ship(self, mmsi: str, data: dict[str, Any]) -> None:
        self.upsert("ships", mmsi, data)

    @property
    def planes(self) -> dict[str, dict[str, Any]]:
        return self.layers["planes"]

    @property
    def ships(self) -> dict[str, dict[str, Any]]:
        return self.layers["ships"]

    # ---------- expiry / snapshot ----------

    def expire(self) -> None:
        now = time.time()
        for layer, store in self.layers.items():
            limit = EXPIRE_SEC.get(layer)
            if not limit:
                continue
            stale = [k for k, v in store.items() if now - v.get("ts", 0) > limit]
            for k in stale:
                del store[k]
            if stale:
                logger.debug(f"expired {len(stale)} {layer}")

    def snapshot(self) -> dict[str, Any]:
        return {"layers": self.layers, "meta": self.meta}

    # ---------- subscribers ----------

    def subscribe(self, ws: WebSocket) -> None:
        self.subscribers.add(ws)

    def unsubscribe(self, ws: WebSocket) -> None:
        self.subscribers.discard(ws)

    def _broadcast(self, msg: dict[str, Any]) -> None:
        if not self.subscribers:
            return
        text = json.dumps(msg, default=str)
        for ws in list(self.subscribers):
            asyncio.create_task(self._safe_send(ws, text))

    async def _safe_send(self, ws: WebSocket, text: str) -> None:
        try:
            await ws.send_text(text)
        except Exception:
            self.subscribers.discard(ws)


state = StateStore()
