"""Submarine cables — TeleGeography Submarine Cable Map.

Source: https://www.submarinecablemap.com/api/v3/cable/cable-geo.json
Free, no key. Attribution required ("Submarine cables courtesy of TeleGeography").

Refresh: 24h (the dataset changes when new cables come online — ~quarterly).
The feed pushes a single 'cables' meta blob (one big GeoJSON) rather than
per-cable layer entries, so the front-end can render polylines once.
"""
from __future__ import annotations

import asyncio

import httpx
from loguru import logger

URL = "https://www.submarinecablemap.com/api/v3/cable/cable-geo.json"
REFRESH_SEC = 86400
TIMEOUT_SEC = 60


async def cables_loop(state) -> None:
    async with httpx.AsyncClient(timeout=TIMEOUT_SEC, headers={"User-Agent": "cupola/0.1"}) as client:
        while True:
            try:
                r = await client.get(URL)
                r.raise_for_status()
                data = r.json()
                features = data.get("features") or []
                state.set_meta("cables", {
                    "count": len(features),
                    "geojson": data,
                })
                logger.info(f"TeleGeography: {len(features)} submarine cables")
            except httpx.HTTPStatusError as e:
                logger.warning(f"Cables http {e.response.status_code} — backing off 6h")
                await asyncio.sleep(21600)
                continue
            except Exception as e:
                logger.warning(f"Cables fetch failed: {e!r}")
                await asyncio.sleep(3600)
                continue
            await asyncio.sleep(REFRESH_SEC)
