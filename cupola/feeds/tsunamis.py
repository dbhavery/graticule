"""NWS active alerts — tsunamis + severe weather (US).

Source: https://api.weather.gov/alerts/active
Refresh: 2 min. No key required.

Splits the response into two layers:
  - `tsunamis` — Tsunami Warning/Watch/Advisory/Information
  - `severe`   — Tornado/Severe Thunderstorm/Flash Flood/Hurricane/Winter
                 Storm/Blizzard/Ice Storm/Fire Weather/Extreme Heat warnings
"""
from __future__ import annotations

import asyncio

import httpx
from loguru import logger

NWS_URL = "https://api.weather.gov/alerts/active"
POLL_SEC = 120
TIMEOUT_SEC = 30

TSUNAMI_EVENTS = {
    "Tsunami Warning",
    "Tsunami Watch",
    "Tsunami Advisory",
    "Tsunami Information Statement",
}

SEVERE_EVENTS = {
    "Tornado Warning",
    "Tornado Watch",
    "Severe Thunderstorm Warning",
    "Severe Thunderstorm Watch",
    "Flash Flood Warning",
    "Flash Flood Watch",
    "Flood Warning",
    "Hurricane Warning",
    "Hurricane Watch",
    "Tropical Storm Warning",
    "Tropical Storm Watch",
    "Winter Storm Warning",
    "Winter Storm Watch",
    "Blizzard Warning",
    "Ice Storm Warning",
    "Fire Weather Watch",
    "Red Flag Warning",
    "Extreme Heat Warning",
    "Extreme Cold Warning",
    "High Wind Warning",
    "Dust Storm Warning",
    "Avalanche Warning",
}


async def nws_tsunami_loop(state) -> None:
    headers = {
        "User-Agent": "cupola/0.1 (personal-situational-awareness, dbhavery@gmail.com)",
        "Accept": "application/geo+json",
    }
    async with httpx.AsyncClient(timeout=TIMEOUT_SEC, headers=headers) as client:
        while True:
            try:
                r = await client.get(NWS_URL, params={"status": "actual"})
                r.raise_for_status()
                data = r.json()
                features = data.get("features") or []
                tsu: dict[str, dict] = {}
                sev: dict[str, dict] = {}
                for f in features:
                    props = f.get("properties") or {}
                    event = props.get("event")
                    if event not in TSUNAMI_EVENTS and event not in SEVERE_EVENTS:
                        continue
                    fid = f.get("id") or props.get("id")
                    if not fid:
                        continue
                    centroid = _centroid(f.get("geometry") or {})
                    if not centroid:
                        continue
                    lon, lat = centroid
                    entry = {
                        "lat": lat,
                        "lon": lon,
                        "event": event,
                        "severity": props.get("severity"),
                        "urgency": props.get("urgency"),
                        "headline": props.get("headline"),
                        "description": (props.get("description") or "")[:600],
                        "area": props.get("areaDesc"),
                        "sent": props.get("sent"),
                        "expires": props.get("expires"),
                    }
                    if event in TSUNAMI_EVENTS:
                        tsu[str(fid)] = entry
                    else:
                        sev[str(fid)] = entry
                state.replace_layer("tsunamis", tsu)
                state.replace_layer("severe", sev)
                logger.info(f"NWS: {len(tsu)} tsunami / {len(sev)} severe-wx alerts")
            except httpx.HTTPStatusError as e:
                logger.warning(f"NWS alerts http {e.response.status_code} — backing off 10m")
                await asyncio.sleep(600)
                continue
            except Exception as e:
                logger.warning(f"NWS alerts poll failed: {e}")
            await asyncio.sleep(POLL_SEC)


def _centroid(geom: dict) -> tuple[float, float] | None:
    """Approximate centroid for Point / Polygon / MultiPolygon."""
    if not geom:
        return None
    gtype = geom.get("type")
    coords = geom.get("coordinates")
    if not coords:
        return None
    try:
        if gtype == "Point":
            return float(coords[0]), float(coords[1])
        rings = []
        if gtype == "Polygon":
            rings = coords
        elif gtype == "MultiPolygon":
            for poly in coords:
                rings.extend(poly)
        else:
            return None
        xs, ys = [], []
        for ring in rings:
            for pt in ring:
                xs.append(float(pt[0]))
                ys.append(float(pt[1]))
        if not xs:
            return None
        return sum(xs) / len(xs), sum(ys) / len(ys)
    except (TypeError, ValueError, IndexError):
        return None
