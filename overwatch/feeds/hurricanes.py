"""NOAA NHC active tropical cyclones — Atlantic + East/Central Pacific basins.

Source: https://www.nhc.noaa.gov/CurrentStorms.json
Refresh: 5 min (NHC publishes ~3-6 hourly during active storms).
Off-season: empty list — layer renders 0. No key required.
"""
from __future__ import annotations

import asyncio

import httpx
from loguru import logger

NHC_URL = "https://www.nhc.noaa.gov/CurrentStorms.json"
POLL_SEC = 300
TIMEOUT_SEC = 20


async def nhc_loop(state) -> None:
    async with httpx.AsyncClient(timeout=TIMEOUT_SEC, headers={"User-Agent": "overwatch/0.1"}) as client:
        while True:
            try:
                r = await client.get(NHC_URL)
                r.raise_for_status()
                data = r.json()
                storms = data.get("activeStorms") or data.get("storms") or []
                entries: dict[str, dict] = {}
                for s in storms:
                    sid = s.get("id") or s.get("binNumber") or s.get("name")
                    if not sid:
                        continue
                    lat = _to_float(s.get("latitudeNumeric") or s.get("latitude"))
                    lon = _to_float(s.get("longitudeNumeric") or s.get("longitude"))
                    if lat is None or lon is None:
                        continue
                    entries[str(sid)] = {
                        "lat": lat,
                        "lon": lon,
                        "name": s.get("name"),
                        "classification": s.get("classification"),
                        "intensity": s.get("intensity"),  # max sustained wind, kt
                        "pressure": s.get("pressure"),    # mb
                        "movement": s.get("movement"),
                        "basin": s.get("basin"),
                        "advisory_url": s.get("publicAdvisory", {}).get("url") if isinstance(s.get("publicAdvisory"), dict) else None,
                        "track_url": s.get("forecastTrack", {}).get("kmzFile") if isinstance(s.get("forecastTrack"), dict) else None,
                        "last_update": s.get("lastUpdate"),
                    }
                state.replace_layer("hurricanes", entries)
                logger.info(f"NHC: {len(entries)} active storms")
            except httpx.HTTPStatusError as e:
                logger.warning(f"NHC http {e.response.status_code} — backing off 15m")
                await asyncio.sleep(900)
                continue
            except Exception as e:
                logger.warning(f"NHC poll failed: {e}")
            await asyncio.sleep(POLL_SEC)


def _to_float(v) -> float | None:
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None
