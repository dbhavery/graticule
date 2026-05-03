"""NASA FIRMS active fire detections — global, 24h, MODIS + VIIRS.

Source: https://firms.modaps.eosdis.nasa.gov/api/area/csv/{MAP_KEY}/VIIRS_NOAA20_NRT/world/1
Free MAP_KEY at https://firms.modaps.eosdis.nasa.gov/api/. Without it the loop
logs once and exits gracefully (mirrors AIS pattern).
"""
from __future__ import annotations

import asyncio
import csv
import io
import os

import httpx
from loguru import logger

POLL_SEC = 1800  # 30 min — FIRMS NRT cadence is ~3h, no need to hammer
TIMEOUT_SEC = 60


async def firms_loop(state) -> None:
    map_key = os.environ.get("FIRMS_MAP_KEY", "").strip()
    if not map_key:
        logger.warning("FIRMS_MAP_KEY not set — wildfires layer disabled. Get a free key at https://firms.modaps.eosdis.nasa.gov/api/")
        return

    # VIIRS NOAA-20 = best resolution, 3-day rolling global window. CSV format.
    # Front-end fades dots by age so 72h-old detections render dim.
    url = f"https://firms.modaps.eosdis.nasa.gov/api/area/csv/{map_key}/VIIRS_NOAA20_NRT/world/3"
    async with httpx.AsyncClient(timeout=TIMEOUT_SEC, headers={"User-Agent": "graticule/0.1"}) as client:
        while True:
            try:
                r = await client.get(url)
                r.raise_for_status()
                reader = csv.DictReader(io.StringIO(r.text))
                entries: dict[str, dict] = {}
                for row in reader:
                    try:
                        lat = float(row["latitude"])
                        lon = float(row["longitude"])
                    except (KeyError, ValueError):
                        continue
                    # FIRMS rows lack a stable per-detection id — synthesize one
                    fid = f"{row.get('acq_date','?')}T{row.get('acq_time','?')}_{lat:.4f}_{lon:.4f}"
                    entries[fid] = {
                        "lat": lat,
                        "lon": lon,
                        "brightness": _f(row.get("bright_ti4")),
                        "frp": _f(row.get("frp")),  # fire radiative power, MW
                        "confidence": row.get("confidence"),
                        "daynight": row.get("daynight"),
                        "satellite": row.get("satellite"),
                        "acq_date": row.get("acq_date"),
                        "acq_time": row.get("acq_time"),
                    }
                state.replace_layer("fires", entries)
                logger.info(f"FIRMS: {len(entries)} fire detections (24h)")
            except httpx.HTTPStatusError as e:
                logger.warning(f"FIRMS http {e.response.status_code} — backing off 1h")
                await asyncio.sleep(3600)
                continue
            except Exception as e:
                logger.warning(f"FIRMS poll failed: {e}")
            await asyncio.sleep(POLL_SEC)


def _f(v) -> float | None:
    if v is None or v == "":
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None
