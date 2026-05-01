"""OpenSky Network ADS-B poll — anonymous, ~15s cadence.

State vector schema (per OpenSky API):
  [icao24, callsign, origin_country, time_position, last_contact, longitude,
   latitude, baro_altitude, on_ground, velocity, true_track, vertical_rate,
   sensors, geo_altitude, squawk, spi, position_source]
"""
from __future__ import annotations

import asyncio

import httpx
from loguru import logger

OPENSKY_URL = "https://opensky-network.org/api/states/all"
POLL_SEC = 15  # be polite to the anonymous endpoint
TIMEOUT_SEC = 25


async def opensky_loop(state) -> None:
    async with httpx.AsyncClient(timeout=TIMEOUT_SEC, headers={"User-Agent": "vantage/0.1"}) as client:
        while True:
            try:
                r = await client.get(OPENSKY_URL)
                r.raise_for_status()
                data = r.json()
                states = data.get("states") or []
                kept = 0
                for s in states:
                    icao24 = s[0]
                    lon, lat = s[5], s[6]
                    if lon is None or lat is None:
                        continue
                    state.upsert_plane(icao24, {
                        "callsign": (s[1] or "").strip() or None,
                        "country": s[2],
                        "lat": lat,
                        "lon": lon,
                        "alt": s[7] or s[13],
                        "heading": s[10],
                        "velocity": s[9],
                        "on_ground": bool(s[8]),
                    })
                    kept += 1
                logger.info(f"ADS-B: poll returned {len(states)} states, {kept} positioned, {len(state.planes)} tracked")
            except httpx.HTTPStatusError as e:
                logger.warning(f"ADS-B http {e.response.status_code} — backing off 60s")
                await asyncio.sleep(60)
                continue
            except Exception as e:
                logger.warning(f"ADS-B poll failed: {e}")
            await asyncio.sleep(POLL_SEC)
