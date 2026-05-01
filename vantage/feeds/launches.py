"""Launch Library 2 — upcoming orbital launches worldwide.

Source: https://ll.thespacedevs.com/2.2.0/launch/upcoming/
Free, rate-limited (~15 req/h anonymous). 30-min poll keeps us comfortably
under the cap.

Each launch carries the launch-pad lat/lon, NET (no-earlier-than) timestamp,
mission name, vehicle, agency, and image — enough to render a pulsing ring
on the globe with a T-minus countdown chip.
"""
from __future__ import annotations

import asyncio

import httpx
from loguru import logger

URL = "https://ll.thespacedevs.com/2.2.0/launch/upcoming/"
POLL_SEC = 1800  # 30 min
TIMEOUT_SEC = 30


async def launches_loop(state) -> None:
    async with httpx.AsyncClient(timeout=TIMEOUT_SEC, headers={"User-Agent": "vantage/0.1"}) as client:
        while True:
            try:
                r = await client.get(URL, params={"limit": 20})
                r.raise_for_status()
                data = r.json()
                results = data.get("results") or []
                entries: dict[str, dict] = {}
                for L in results:
                    lid = L.get("id") or L.get("slug")
                    if not lid:
                        continue
                    pad = L.get("pad") or {}
                    lat = _f(pad.get("latitude"))
                    lon = _f(pad.get("longitude"))
                    if lat is None or lon is None:
                        continue
                    rocket = L.get("rocket") or {}
                    config = rocket.get("configuration") or {}
                    mission = L.get("mission") or {}
                    agency = (L.get("launch_service_provider") or {}).get("name")
                    entries[str(lid)] = {
                        "lat": lat,
                        "lon": lon,
                        "name": L.get("name"),
                        "net": L.get("net"),                         # ISO timestamp (no-earlier-than)
                        "window_start": L.get("window_start"),
                        "window_end": L.get("window_end"),
                        "status": (L.get("status") or {}).get("name"),
                        "vehicle": config.get("name") or config.get("full_name"),
                        "agency": agency,
                        "pad_name": pad.get("name"),
                        "pad_location": (pad.get("location") or {}).get("name"),
                        "mission_name": mission.get("name"),
                        "mission_type": mission.get("type"),
                        "mission_orbit": (mission.get("orbit") or {}).get("name"),
                        "url": L.get("url"),
                    }
                state.replace_layer("launches", entries)
                logger.info(f"Launch Library: {len(entries)} upcoming launches")
            except httpx.HTTPStatusError as e:
                logger.warning(f"Launch Library http {e.response.status_code} — backing off 1h")
                await asyncio.sleep(3600)
                continue
            except Exception as e:
                logger.warning(f"Launch Library poll failed: {e}")
            await asyncio.sleep(POLL_SEC)


def _f(v) -> float | None:
    if v is None or v == "":
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None
