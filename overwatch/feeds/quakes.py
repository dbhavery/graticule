"""USGS earthquake feed — last 24h, all magnitudes, polled every 60s.

Source: https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson
No key required.
"""
from __future__ import annotations

import asyncio

import httpx
from loguru import logger

USGS_URL = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_week.geojson"
POLL_SEC = 60
TIMEOUT_SEC = 20

# Active-event window: keep last 72h of quakes (USGS feed covers 7d).
WINDOW_HOURS = 72


async def usgs_loop(state) -> None:
    async with httpx.AsyncClient(timeout=TIMEOUT_SEC, headers={"User-Agent": "overwatch/0.1"}) as client:
        while True:
            try:
                r = await client.get(USGS_URL)
                r.raise_for_status()
                data = r.json()
                features = data.get("features") or []
                import time as _time
                cutoff_ms = (_time.time() - WINDOW_HOURS * 3600) * 1000
                entries: dict[str, dict] = {}
                for f in features:
                    props = f.get("properties") or {}
                    if (props.get("time") or 0) < cutoff_ms:
                        continue
                    geom = f.get("geometry") or {}
                    coords = geom.get("coordinates") or []
                    if len(coords) < 2:
                        continue
                    lon, lat = coords[0], coords[1]
                    depth = coords[2] if len(coords) > 2 else None
                    qid = f.get("id")
                    if not qid:
                        continue
                    entries[qid] = {
                        "lat": lat,
                        "lon": lon,
                        "depth_km": depth,
                        "mag": props.get("mag"),
                        "place": props.get("place"),
                        "time": props.get("time"),
                        "url": props.get("url"),
                        "tsunami": bool(props.get("tsunami")),
                        "felt": props.get("felt"),
                        "alert": props.get("alert"),
                        "type": props.get("type"),
                    }
                state.replace_layer("quakes", entries)
                logger.info(f"USGS: {len(entries)} quakes (last {WINDOW_HOURS}h)")
            except httpx.HTTPStatusError as e:
                logger.warning(f"USGS http {e.response.status_code} — backing off 5m")
                await asyncio.sleep(300)
                continue
            except Exception as e:
                logger.warning(f"USGS poll failed: {e}")
            await asyncio.sleep(POLL_SEC)
