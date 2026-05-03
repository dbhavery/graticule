"""Smithsonian Global Volcanism Program — Holocene volcanoes catalog.

Source: GVP WFS endpoint, GeoJSON output (~1215 Holocene volcanoes).

We tag each volcano with `active` = True when it's erupted within the last
10 years (Last_Eruption_Year >= now - 10). Front-end colors active ones
bright red and dims the rest, satisfying the "show what's happening now"
intent without losing the catalog as a reference layer.
"""
from __future__ import annotations

import asyncio
from datetime import datetime

import httpx
from loguru import logger

GVP_URL = "https://webservices.volcano.si.edu/geoserver/GVP-VOTW/ows"
GVP_PARAMS = {
    "service": "WFS",
    "version": "2.0.0",
    "request": "GetFeature",
    "typeName": "GVP-VOTW:Smithsonian_VOTW_Holocene_Volcanoes",
    "outputFormat": "application/json",
    "srsName": "EPSG:4326",
}
ACTIVE_WITHIN_YEARS = 10
REFRESH_SEC = 86400  # 24h — catalog is largely static
TIMEOUT_SEC = 60


async def gvp_loop(state) -> None:
    async with httpx.AsyncClient(timeout=TIMEOUT_SEC, headers={"User-Agent": "graticule/0.1"}) as client:
        while True:
            try:
                r = await client.get(GVP_URL, params=GVP_PARAMS)
                r.raise_for_status()
                data = r.json()
                features = data.get("features") or []
                this_year = datetime.utcnow().year
                cutoff_year = this_year - ACTIVE_WITHIN_YEARS
                entries: dict[str, dict] = {}
                active_count = 0
                for f in features:
                    props = f.get("properties") or {}
                    geom = f.get("geometry") or {}
                    coords = geom.get("coordinates") or []
                    if len(coords) < 2:
                        continue
                    lon, lat = coords[0], coords[1]
                    vid = props.get("Volcano_Number") or f.get("id")
                    if not vid:
                        continue
                    last_year_str = str(props.get("Last_Eruption_Year") or "").strip()
                    last_year = None
                    if last_year_str.isdigit():
                        last_year = int(last_year_str)
                    is_active = last_year is not None and last_year >= cutoff_year
                    if is_active:
                        active_count += 1
                    entries[str(vid)] = {
                        "lat": lat,
                        "lon": lon,
                        "name": props.get("Volcano_Name"),
                        "country": props.get("Country"),
                        "region": props.get("Region"),
                        "type": props.get("Primary_Volcano_Type"),
                        "elevation_m": props.get("Elevation"),
                        "last_eruption": last_year,
                        "active": is_active,
                    }
                state.replace_layer("volcanoes", entries)
                logger.info(f"GVP: {len(entries)} Holocene volcanoes ({active_count} active in last {ACTIVE_WITHIN_YEARS}y)")
            except httpx.HTTPStatusError as e:
                logger.warning(f"GVP http {e.response.status_code} — retry in 1h")
                await asyncio.sleep(3600)
                continue
            except Exception as e:
                logger.warning(f"GVP fetch failed: {e}")
                await asyncio.sleep(3600)
                continue
            await asyncio.sleep(REFRESH_SEC)
