"""NOAA SWPC Ovation Aurora — global aurora visibility probability grid.

Source: https://services.swpc.noaa.gov/json/ovation_aurora_latest.json
Format: 1°×1° grid of aurora probability (0-100) covering the globe.
We push the raw blob to state.meta['aurora']; the front-end converts it
to a Cesium imagery layer (north + south overlays).

Refresh: 5 min (SWPC publishes every ~5 min).
"""
from __future__ import annotations

import asyncio

import httpx
from loguru import logger

URL = "https://services.swpc.noaa.gov/json/ovation_aurora_latest.json"
POLL_SEC = 300
TIMEOUT_SEC = 30


async def ovation_loop(state) -> None:
    async with httpx.AsyncClient(timeout=TIMEOUT_SEC, headers={"User-Agent": "graticule/0.1"}) as client:
        while True:
            try:
                r = await client.get(URL)
                r.raise_for_status()
                data = r.json()
                # data has: "Observation Time", "Forecast Time", "Data Format",
                # "coordinates" — list of [lon, lat, probability] triples (~64800 entries).
                state.set_meta("aurora", data)
                coords = data.get("coordinates") or []
                logger.info(f"SWPC Ovation: aurora grid loaded ({len(coords)} cells)")
            except httpx.HTTPStatusError as e:
                logger.warning(f"SWPC aurora http {e.response.status_code}")
            except Exception as e:
                logger.warning(f"SWPC aurora poll failed: {e}")
            await asyncio.sleep(POLL_SEC)
