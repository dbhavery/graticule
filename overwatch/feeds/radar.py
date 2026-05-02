"""RainViewer global precipitation radar — Cesium imagery layer.

Source: https://api.rainviewer.com/public/weather-maps.json
Returns a list of recent (past) and nowcast (future) tile timestamps.
We push the manifest into state.meta['radar']; the front-end picks the
latest 'past' frame and adds it as a tile imagery provider.

Refresh: 5 min (RainViewer publishes new frames every 10 min).
"""
from __future__ import annotations

import asyncio

import httpx
from loguru import logger

URL = "https://api.rainviewer.com/public/weather-maps.json"
POLL_SEC = 300
TIMEOUT_SEC = 20


async def rainviewer_loop(state) -> None:
    async with httpx.AsyncClient(timeout=TIMEOUT_SEC, headers={"User-Agent": "overwatch/0.1"}) as client:
        while True:
            try:
                r = await client.get(URL)
                r.raise_for_status()
                data = r.json()
                state.set_meta("radar", {
                    "host": data.get("host"),
                    "past":     data.get("radar", {}).get("past", []),
                    "nowcast":  data.get("radar", {}).get("nowcast", []),
                    "satellite": data.get("satellite", {}).get("infrared", []),
                })
                past_n = len(data.get("radar", {}).get("past", []))
                logger.info(f"RainViewer: {past_n} past radar frames available")
            except httpx.HTTPStatusError as e:
                logger.warning(f"RainViewer http {e.response.status_code}")
            except Exception as e:
                logger.warning(f"RainViewer poll failed: {e}")
            await asyncio.sleep(POLL_SEC)
