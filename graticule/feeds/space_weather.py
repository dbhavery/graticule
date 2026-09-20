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
PLASMA_URL = "https://services.swpc.noaa.gov/json/rtsw/rtsw_wind_1m.json"
XRAY_URL  = "https://services.swpc.noaa.gov/json/goes/primary/xray-flares-latest.json"
POLL_SEC = 300
TIMEOUT_SEC = 20


async def space_weather_loop(state) -> None:
    async with httpx.AsyncClient(timeout=TIMEOUT_SEC, headers={"User-Agent": "graticule/0.1"}) as client:
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

            # --- Solar wind plasma (real-time solar wind) ---
            #
            # THIS URL WAS DEAD. /products/solar-wind/plasma-2-hour.json 404s,
            # as does every other plasma-*.json under that path, and because
            # this block has its own try/except the loop went on writing a
            # blob with `solar_wind: None` in it and logged a warning nobody
            # was reading. Found 2026-09-20 when the same URL failed in the
            # browser port, where the failure was visible.
            #
            # The replacement is a list of objects rather than rows behind a
            # header row, so the parsing is different as well as the address.
            try:
                r = await client.get(PLASMA_URL)
                r.raise_for_status()
                rows = r.json()
                best = None
                for row in rows if isinstance(rows, list) else []:
                    if not isinstance(row, dict):
                        continue
                    if _f(row.get("proton_speed")) is None:
                        continue
                    # By newest timestamp, not by position: the old endpoint
                    # was oldest-first and this one is not documented either
                    # way, and guessing wrong shows an hours-old reading as
                    # the current one.
                    if best is None or str(row.get("time_tag")) > str(best.get("time_tag")):
                        best = row
                if best is not None:
                    blob["solar_wind"] = {
                        "speed_kms":   _f(best.get("proton_speed")),
                        "density_cm3": _f(best.get("proton_density")),
                        "temp_k":      _f(best.get("proton_temperature")),
                        "time":        best.get("time_tag"),
                    }
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
