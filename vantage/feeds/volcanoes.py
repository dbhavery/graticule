"""Smithsonian Global Volcanism Program — Holocene volcanoes.

Source: GVP WFS endpoint, GeoJSON output.
This is largely static data (geographic positions of ~1500 Holocene volcanoes),
so we fetch once at startup and again every 24h to catch GVP DB edits.
"""
from __future__ import annotations

import asyncio

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
REFRESH_SEC = 86400  # 24h
TIMEOUT_SEC = 60


async def gvp_loop(state) -> None:
    async with httpx.AsyncClient(timeout=TIMEOUT_SEC, headers={"User-Agent": "vantage/0.1"}) as client:
        while True:
            try:
                r = await client.get(GVP_URL, params=GVP_PARAMS)
                r.raise_for_status()
                data = r.json()
                features = data.get("features") or []
                entries: dict[str, dict] = {}
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
                    entries[str(vid)] = {
                        "lat": lat,
                        "lon": lon,
                        "name": props.get("Volcano_Name"),
                        "country": props.get("Country"),
                        "region": props.get("Region"),
                        "type": props.get("Primary_Volcano_Type"),
                        "elevation_m": props.get("Elevation"),
                        "last_eruption": props.get("Last_Eruption_Year"),
                    }
                state.replace_layer("volcanoes", entries)
                logger.info(f"GVP: {len(entries)} Holocene volcanoes loaded")
            except httpx.HTTPStatusError as e:
                logger.warning(f"GVP http {e.response.status_code} — retry in 1h")
                await asyncio.sleep(3600)
                continue
            except Exception as e:
                logger.warning(f"GVP fetch failed: {e}")
                await asyncio.sleep(3600)
                continue
            await asyncio.sleep(REFRESH_SEC)
