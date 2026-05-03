"""OpenSky Network ADS-B poll.

Anonymous tier rate-limits hard (~5-10 req/min) so by default planes appear
in bursts. OpenSky migrated authentication to OAuth2 client_credentials in
2025: register a client at https://opensky-network.org/, download the
credentials JSON, and put the values into .env as OPENSKY_CLIENT_ID and
OPENSKY_CLIENT_SECRET. With auth the quota lifts to ~4000 req/day so planes
stream smoothly every 6 seconds.

Legacy OPENSKY_USER / OPENSKY_PASS basic-auth is still honored as a fallback
for older accounts but OpenSky is deprecating it; OAuth2 is the path forward.

State vector schema (per OpenSky API):
  [icao24, callsign, origin_country, time_position, last_contact, longitude,
   latitude, baro_altitude, on_ground, velocity, true_track, vertical_rate,
   sensors, geo_altitude, squawk, spi, position_source]
"""
from __future__ import annotations

import asyncio
import os
import time
from typing import Optional

import httpx
from loguru import logger

OPENSKY_URL = "https://opensky-network.org/api/states/all"
OPENSKY_TOKEN_URL = "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token"
TIMEOUT_SEC = 25


class OAuthState:
    """Tiny holder for the cached bearer token + its expiry."""
    def __init__(self, client_id: str, client_secret: str) -> None:
        self.client_id = client_id
        self.client_secret = client_secret
        self.token: Optional[str] = None
        self.expires_at: float = 0.0

    async def fetch_token(self, client: httpx.AsyncClient) -> str:
        # Refresh ~30 seconds before actual expiry so a long request doesn't
        # cross the boundary mid-flight.
        if self.token and time.time() < self.expires_at - 30:
            return self.token
        r = await client.post(
            OPENSKY_TOKEN_URL,
            data={
                "grant_type": "client_credentials",
                "client_id": self.client_id,
                "client_secret": self.client_secret,
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        r.raise_for_status()
        d = r.json()
        self.token = d["access_token"]
        self.expires_at = time.time() + int(d.get("expires_in", 1800))
        logger.info(
            f"ADS-B: OAuth token acquired, expires in {int(d.get('expires_in', 1800))}s"
        )
        return self.token


async def opensky_loop(state) -> None:
    cid = os.getenv("OPENSKY_CLIENT_ID")
    cs = os.getenv("OPENSKY_CLIENT_SECRET")
    user = os.getenv("OPENSKY_USER")
    pw = os.getenv("OPENSKY_PASS")

    oauth: Optional[OAuthState] = None
    basic_auth = None
    if cid and cs:
        oauth = OAuthState(cid, cs)
        poll_sec = 6
        logger.info(f"ADS-B: OAuth2 client {cid!r}, polling every {poll_sec}s")
    elif user and pw:
        basic_auth = (user, pw)
        poll_sec = 6
        logger.info(f"ADS-B: HTTP Basic as {user!r} (legacy), polling every {poll_sec}s")
    else:
        poll_sec = 15
        logger.info(
            "ADS-B: anonymous tier (set OPENSKY_CLIENT_ID/SECRET in .env to lift rate limit)"
        )

    async with httpx.AsyncClient(
        timeout=TIMEOUT_SEC,
        headers={"User-Agent": "graticule/0.1"},
        auth=basic_auth,
    ) as client:
        while True:
            try:
                headers = {}
                if oauth is not None:
                    token = await oauth.fetch_token(client)
                    headers["Authorization"] = f"Bearer {token}"
                r = await client.get(OPENSKY_URL, headers=headers)
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
                # 401 → token went stale somehow; force a refetch next loop
                if code == 401 and oauth is not None:
                    oauth.token = None
                    logger.warning("ADS-B 401 — invalidating cached token")
                    await asyncio.sleep(2)
                    continue
                backoff = 30 if (oauth or basic_auth) else 60
                logger.warning(f"ADS-B http {code} — backing off {backoff}s")
                await asyncio.sleep(backoff)
                continue
            except Exception as e:
                logger.warning(f"ADS-B poll failed: {e}")
            await asyncio.sleep(poll_sec)
