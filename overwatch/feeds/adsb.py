"""OpenSky Network ADS-B poll.

Anonymous tier rate-limits hard (~5–10 req/min) so by default planes appear
in bursts. Setting OPENSKY_USER / OPENSKY_PASS in .env enables HTTP Basic
auth which lifts the limit to ~4000 req/day — much smoother.

State vector schema (per OpenSky API):
  [icao24, callsign, origin_country, time_position, last_contact, longitude,
   latitude, baro_altitude, on_ground, velocity, true_track, vertical_rate,
   sensors, geo_altitude, squawk, spi, position_source]
"""
from __future__ import annotations

import asyncio
import os

import httpx
from loguru import logger

OPENSKY_URL = "https://opensky-network.org/api/states/all"
TIMEOUT_SEC = 25


async def opensky_loop(state) -> None:
    user = os.getenv("OPENSKY_USER")
    pw = os.getenv("OPENSKY_PASS")
    auth = (user, pw) if (user and pw) else None
    poll_sec = 6 if auth else 15  # authenticated quota is generous; anon must crawl
    if auth:
        logger.info(f"ADS-B: authenticated as {user!r}, polling every {poll_sec}s")
    else:
        logger.info(f"ADS-B: anonymous tier (set OPENSKY_USER/PASS in .env to lift rate limit)")

    async with httpx.AsyncClient(
        timeout=TIMEOUT_SEC,
        headers={"User-Agent": "overwatch/0.1"},
        auth=auth,
    ) as client:
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
                code = e.response.status_code
                # Authenticated tier should rarely hit 429; anon hits it constantly
                backoff = 30 if auth else 60
                logger.warning(f"ADS-B http {code} — backing off {backoff}s")
                await asyncio.sleep(backoff)
                continue
            except Exception as e:
                logger.warning(f"ADS-B poll failed: {e}")
            await asyncio.sleep(poll_sec)
