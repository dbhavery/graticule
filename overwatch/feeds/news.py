"""NASA EONET — Earth Observatory Natural Event Tracker.

Source: https://eonet.gsfc.nasa.gov/api/v3/events?status=open
Free, no key. Curated catalog of currently-active natural events: wildfires,
severe storms, volcanoes, floods, drought, dust/haze, landslides, sea-ice,
manmade hazards, etc. Each event carries one or more geometry points.

This is an ideal "what's happening on Earth right now" layer — different
from our raw observation feeds (USGS, NHC, FIRMS) because it's editorially
curated and links to source imagery.

Refresh: 15 min.
"""
from __future__ import annotations

import asyncio

import httpx
from loguru import logger

URL = "https://eonet.gsfc.nasa.gov/api/v3/events"
POLL_SEC = 900
TIMEOUT_SEC = 30


async def gdelt_loop(state) -> None:
    """Function name kept for import stability — actually pulls EONET."""
    async with httpx.AsyncClient(timeout=TIMEOUT_SEC, headers={"User-Agent": "overwatch/0.1"}) as client:
        while True:
            try:
                r = await client.get(URL, params={"status": "open", "limit": 200})
                r.raise_for_status()
                data = r.json()
                events = data.get("events") or []
                entries: dict[str, dict] = {}
                for e in events:
                    geometries = e.get("geometry") or []
                    if not geometries:
                        continue
                    # Take the most recent geometry as the event location
                    g = geometries[-1]
                    coords = g.get("coordinates") or []
                    gtype = g.get("type")
                    if gtype != "Point" or len(coords) < 2:
                        continue
                    lon, lat = coords[0], coords[1]
                    eid = e.get("id")
                    if not eid:
                        continue
                    cats = [c.get("title") for c in (e.get("categories") or []) if c.get("title")]
                    sources = [s.get("url") for s in (e.get("sources") or []) if s.get("url")]
                    entries[str(eid)] = {
                        "lat": lat,
                        "lon": lon,
                        "name": e.get("title"),
                        "categories": cats,
                        "date": g.get("date"),
                        "magnitude_value": g.get("magnitudeValue"),
                        "magnitude_unit": g.get("magnitudeUnit"),
                        "sources": sources,
                        "link": e.get("link"),
                    }
                state.replace_layer("news", entries)
                logger.info(f"EONET: {len(entries)} active natural events")
            except httpx.HTTPStatusError as e:
                logger.warning(f"EONET http {e.response.status_code} — backing off 30m")
                await asyncio.sleep(1800)
                continue
            except Exception as e:
                logger.warning(f"EONET poll failed: {e!r}")
            await asyncio.sleep(POLL_SEC)
