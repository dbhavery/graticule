"""OurAirports — global airport database, large airports only.

Source: https://davidmegginson.github.io/ourairports-data/airports.csv
Free, public domain. ~80K airports total worldwide; we filter to only
'large_airport' (commercial international hubs) and 'medium_airport' for a
manageable ~5,000-entry layer.

One-shot fetch at startup, refresh weekly.
"""
from __future__ import annotations

import asyncio
import csv
import io

import httpx
from loguru import logger

URL = "https://davidmegginson.github.io/ourairports-data/airports.csv"
REFRESH_SEC = 7 * 86400
TIMEOUT_SEC = 60

KEEP_TYPES = {"large_airport", "medium_airport"}


async def airports_loop(state) -> None:
    async with httpx.AsyncClient(timeout=TIMEOUT_SEC, headers={"User-Agent": "vantage/0.1"}, follow_redirects=True) as client:
        while True:
            try:
                r = await client.get(URL)
                r.raise_for_status()
                reader = csv.DictReader(io.StringIO(r.text))
                entries: dict[str, dict] = {}
                for row in reader:
                    if row.get("type") not in KEEP_TYPES:
                        continue
                    try:
                        lat = float(row["latitude_deg"])
                        lon = float(row["longitude_deg"])
                    except (KeyError, ValueError):
                        continue
                    aid = row.get("ident") or row.get("id")
                    if not aid:
                        continue
                    entries[aid] = {
                        "lat": lat,
                        "lon": lon,
                        "name": row.get("name"),
                        "iata": row.get("iata_code"),
                        "icao": row.get("ident"),
                        "type": row.get("type"),
                        "elevation_ft": _i(row.get("elevation_ft")),
                        "country": row.get("iso_country"),
                        "region": row.get("iso_region"),
                        "municipality": row.get("municipality"),
                        "scheduled_service": row.get("scheduled_service") == "yes",
                    }
                state.replace_layer("airports", entries)
                large = sum(1 for e in entries.values() if e["type"] == "large_airport")
                logger.info(f"OurAirports: {len(entries)} airports ({large} large)")
            except httpx.HTTPStatusError as e:
                logger.warning(f"OurAirports http {e.response.status_code} — retry in 1d")
                await asyncio.sleep(86400)
                continue
            except Exception as e:
                logger.warning(f"OurAirports fetch failed: {e!r}")
                await asyncio.sleep(3600)
                continue
            await asyncio.sleep(REFRESH_SEC)


def _i(v) -> int | None:
    if v is None or v == "":
        return None
    try:
        return int(v)
    except (TypeError, ValueError):
        return None
