"""NWS tsunami alerts — active warnings, watches, advisories, info statements.

Source: https://api.weather.gov/alerts/active?event=Tsunami
Refresh: 2 min. No key required.
"""
from __future__ import annotations

import asyncio

import httpx
from loguru import logger

NWS_URL = "https://api.weather.gov/alerts/active"
POLL_SEC = 120
TIMEOUT_SEC = 20

# NWS umbrella categories for tsunami events
TSUNAMI_EVENTS = {
    "Tsunami Warning",
    "Tsunami Watch",
    "Tsunami Advisory",
    "Tsunami Information Statement",
}


async def nws_tsunami_loop(state) -> None:
    headers = {
        "User-Agent": "vantage/0.1 (personal-situational-awareness, dbhavery@gmail.com)",
        "Accept": "application/geo+json",
    }
    async with httpx.AsyncClient(timeout=TIMEOUT_SEC, headers=headers) as client:
        while True:
            try:
                r = await client.get(NWS_URL, params={"event": list(TSUNAMI_EVENTS)})
                r.raise_for_status()
                data = r.json()
                features = data.get("features") or []
                entries: dict[str, dict] = {}
                for f in features:
                    props = f.get("properties") or {}
                    if props.get("event") not in TSUNAMI_EVENTS:
                        continue
                    fid = f.get("id") or props.get("id")
                    if not fid:
                        continue
                    geom = f.get("geometry") or {}
                    centroid = _centroid(geom)
                    if not centroid:
                        # No geometry — try parameter SAME centroid; otherwise skip
                        continue
                    lon, lat = centroid
                    entries[str(fid)] = {
                        "lat": lat,
                        "lon": lon,
                        "event": props.get("event"),
                        "severity": props.get("severity"),
                        "urgency": props.get("urgency"),
                        "headline": props.get("headline"),
                        "description": (props.get("description") or "")[:600],
                        "area": props.get("areaDesc"),
                        "sent": props.get("sent"),
                        "expires": props.get("expires"),
                    }
                state.replace_layer("tsunamis", entries)
                logger.info(f"NWS tsunami: {len(entries)} active alerts")
            except httpx.HTTPStatusError as e:
                logger.warning(f"NWS tsunami http {e.response.status_code} — backing off 10m")
                await asyncio.sleep(600)
                continue
            except Exception as e:
                logger.warning(f"NWS tsunami poll failed: {e}")
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
