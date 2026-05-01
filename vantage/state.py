"""In-memory live state + WebSocket fan-out.

One process, one StateStore. Feeds upsert; subscribers receive deltas.
Stale entries (no update in EXPIRE_SEC) drop on the next expire() call.
"""
from __future__ import annotations

import asyncio
import json
import time
from dataclasses import dataclass, field
from typing import Any

from fastapi import WebSocket
from loguru import logger

EXPIRE_SEC = 300  # 5 min — drop entities not updated since


@dataclass
class StateStore:
    planes: dict[str, dict[str, Any]] = field(default_factory=dict)
    ships: dict[str, dict[str, Any]] = field(default_factory=dict)
    subscribers: set[WebSocket] = field(default_factory=set)

    def upsert_plane(self, icao24: str, data: dict[str, Any]) -> None:
        data["ts"] = time.time()
        self.planes[icao24] = data
        self._broadcast({"type": "plane", "id": icao24, "data": data})

    def upsert_ship(self, mmsi: str, data: dict[str, Any]) -> None:
        data["ts"] = time.time()
        self.ships[mmsi] = data
        self._broadcast({"type": "ship", "id": mmsi, "data": data})

    def expire(self) -> None:
        now = time.time()
        for store_name, store in (("planes", self.planes), ("ships", self.ships)):
            stale = [k for k, v in store.items() if now - v.get("ts", 0) > EXPIRE_SEC]
            for k in stale:
                del store[k]
            if stale:
                logger.debug(f"expired {len(stale)} {store_name}")

    def snapshot(self) -> dict[str, Any]:
        return {"planes": self.planes, "ships": self.ships}

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
