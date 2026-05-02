"""NOAA SWPC space-weather telemetry.

Three signals, all free, no key:
  - Kp planetary index           (geomagnetic activity, 0-9)
  - Solar wind speed + density   (DSCOVR plasma, 1-min)
  - GOES X-ray flare class       (background X-ray flux)

Pushed to state.meta['space_weather']. Refreshed every 5 min — none of these
move faster than that for headline purposes.
"""
from __future__ import annotations

import asyncio

import httpx
from loguru import logger

KP_URL    = "https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json"
PLASMA_URL = "https://services.swpc.noaa.gov/products/solar-wind/plasma-2-hour.json"
XRAY_URL  = "https://services.swpc.noaa.gov/json/goes/primary/xray-flares-latest.json"
POLL_SEC = 300
TIMEOUT_SEC = 20


async def space_weather_loop(state) -> None:
    async with httpx.AsyncClient(timeout=TIMEOUT_SEC, headers={"User-Agent": "cupola/0.1"}) as client:
        while True:
            blob = {"kp": None, "solar_wind": None, "xray": None}

            # --- Kp index (last row is most recent) ---
            try:
                r = await client.get(KP_URL)
                r.raise_for_status()
                rows = r.json()
                if isinstance(rows, list) and rows:
                    # Two known shapes: list-of-dicts (current) and list-of-lists (legacy header+rows)
                    for row in reversed(rows):
                        v, t = None, None
                        if isinstance(row, dict):
                            v = _f(row.get("Kp"))
                            t = row.get("time_tag")
                        elif isinstance(row, list) and len(row) >= 2:
                            v = _f(row[1])
                            t = row[0]
                        if v is not None:
                            blob["kp"] = {"value": v, "time": t}
                            break
            except Exception as e:
                logger.warning(f"SWPC Kp failed: {e!r}")

            # --- Solar wind plasma (DSCOVR) ---
            try:
                r = await client.get(PLASMA_URL)
                r.raise_for_status()
                rows = r.json()
                if isinstance(rows, list) and len(rows) >= 2:
                    # Schema: ["time_tag","density","speed","temperature"]
                    # Walk back to find the latest row with non-null speed
                    for row in reversed(rows[1:]):
                        sp = _f(row[2]) if len(row) > 2 else None
                        if sp is not None:
                            blob["solar_wind"] = {
                                "speed_kms":   sp,
                                "density_cm3": _f(row[1]) if len(row) > 1 else None,
                                "temp_k":      _f(row[3]) if len(row) > 3 else None,
                                "time":        row[0],
                            }
                            break
            except Exception as e:
                logger.warning(f"SWPC plasma failed: {e}")

            # --- GOES X-ray latest flare ---
            try:
                r = await client.get(XRAY_URL)
                r.raise_for_status()
                data = r.json()
                # API returns a list of recent flare events (or {} if none)
                if isinstance(data, list) and data:
                    f = data[0]
                    blob["xray"] = {
                        "class": f.get("max_class"),
                        "peak":  f.get("max_time"),
                        "begin": f.get("begin_time"),
                        "end":   f.get("end_time"),
                    }
            except Exception as e:
                logger.warning(f"SWPC xray failed: {e}")

            state.set_meta("space_weather", blob)
            kp = blob["kp"]["value"] if blob["kp"] else "?"
            sw = blob["solar_wind"]["speed_kms"] if blob["solar_wind"] else "?"
            xc = blob["xray"]["class"] if blob["xray"] else "—"
            logger.info(f"SWPC: Kp={kp}  solar_wind={sw} km/s  xray={xc}")
            await asyncio.sleep(POLL_SEC)


def _f(v) -> float | None:
    if v is None or v == "":
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None
