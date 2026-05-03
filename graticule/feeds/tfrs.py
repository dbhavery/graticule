"""FAA Temporary Flight Restrictions (TFRs) — US airspace, with real polygons.

Primary source: https://tfr.faa.gov/geoserver/TFR/ows  (FAA's public GeoServer
WFS — exposes TFR:V_TFR_LOC as a Polygon feature type with NOTAM_KEY / TITLE /
STATE / LEGAL properties; ~70 features at any time).

Each TFR is plotted as the actual polygon when the WFS query succeeds. We also
fetch https://tfr.faa.gov/tfrapi/exportTfrList for type/facility/created
metadata that V_TFR_LOC doesn't expose, joined on notam_id. If the WFS layer
fails, we fall back to plotting at the state centroid (legacy behavior).

Refresh: 15 min.
"""
from __future__ import annotations

import asyncio
from typing import Any

import httpx
from loguru import logger

WFS_URL = "https://tfr.faa.gov/geoserver/TFR/ows"
LIST_URL = "https://tfr.faa.gov/tfrapi/exportTfrList"
POLL_SEC = 900
TIMEOUT_SEC = 30

# Approximate state centroids (US 50 + DC + territories). Used only when the
# WFS polygon feed fails — the FAA's exportTfrList JSON has no coordinates.
STATE_CENTROIDS: dict[str, tuple[float, float]] = {
    "AL": (32.806671, -86.791130), "AK": (61.370716, -152.404419),
    "AZ": (33.729759, -111.431221), "AR": (34.969704, -92.373123),
    "CA": (36.116203, -119.681564), "CO": (39.059811, -105.311104),
    "CT": (41.597782, -72.755371),  "DE": (39.318523, -75.507141),
    "FL": (27.766279, -81.686783),  "GA": (33.040619, -83.643074),
    "HI": (21.094318, -157.498337), "ID": (44.240459, -114.478828),
    "IL": (40.349457, -88.986137),  "IN": (39.849426, -86.258278),
    "IA": (42.011539, -93.210526),  "KS": (38.526600, -96.726486),
    "KY": (37.668140, -84.670067),  "LA": (31.169546, -91.867805),
    "ME": (44.693947, -69.381927),  "MD": (39.063946, -76.802101),
    "MA": (42.230171, -71.530106),  "MI": (43.326618, -84.536095),
    "MN": (45.694454, -93.900192),  "MS": (32.741646, -89.678696),
    "MO": (38.456085, -92.288368),  "MT": (46.921925, -110.454353),
    "NE": (41.125370, -98.268082),  "NV": (38.313515, -117.055374),
    "NH": (43.452492, -71.563896),  "NJ": (40.298904, -74.521011),
    "NM": (34.840515, -106.248482), "NY": (42.165726, -74.948051),
    "NC": (35.630066, -79.806419),  "ND": (47.528912, -99.784012),
    "OH": (40.388783, -82.764915),  "OK": (35.565342, -96.928917),
    "OR": (44.572021, -122.070938), "PA": (40.590752, -77.209755),
    "RI": (41.680893, -71.511780),  "SC": (33.856892, -80.945007),
    "SD": (44.299782, -99.438828),  "TN": (35.747845, -86.692345),
    "TX": (31.054487, -97.563461),  "UT": (40.150032, -111.862434),
    "VT": (44.045876, -72.710686),  "VA": (37.769337, -78.169968),
    "WA": (47.400902, -121.490494), "WV": (38.491226, -80.954453),
    "WI": (44.268543, -89.616508),  "WY": (42.755966, -107.302490),
    "DC": (38.897438, -77.026817),  "PR": (18.220833, -66.590149),
    "VI": (18.335765, -64.896335),  "GU": (13.444304, 144.793732),
    "AS": (-14.270972, -170.132217),"MP": (15.097974, 145.673057),
}


def _poly_centroid(ring: list[list[float]]) -> tuple[float, float] | None:
    """Bounding-box centre of an [lon,lat] ring — good enough for picking +
    panel-anchor; not the geometric centroid but cheap and stable."""
    if not ring:
        return None
    lons = [c[0] for c in ring if isinstance(c, (list, tuple)) and len(c) >= 2]
    lats = [c[1] for c in ring if isinstance(c, (list, tuple)) and len(c) >= 2]
    if not lons or not lats:
        return None
    return (sum(lons) / len(lons), sum(lats) / len(lats))


def _ring_from_geom(geom: dict[str, Any]) -> list[list[float]] | None:
    """Pull a single outer ring out of Polygon / MultiPolygon GeoJSON, picking
    the largest ring by point-count when there are several."""
    t = (geom or {}).get("type")
    if t == "Polygon":
        rings = geom.get("coordinates") or []
        return rings[0] if rings else None
    if t == "MultiPolygon":
        polys = geom.get("coordinates") or []
        if not polys:
            return None
        # Largest outer ring across all polygons
        best = max((p[0] for p in polys if p), key=len, default=None)
        return best
    return None


def _notam_id_from_key(notam_key: str) -> str:
    """V_TFR_LOC NOTAM_KEY is `6/6432-1-FDC-F`; exportTfrList notam_id is
    `6/6432`. Strip everything from the first dash on."""
    if not notam_key:
        return ""
    return notam_key.split("-", 1)[0].strip()


async def _fetch_wfs_polygons(client: httpx.AsyncClient) -> dict[str, dict] | None:
    """Returns {notam_id: feature-dict} or None on failure."""
    try:
        r = await client.get(WFS_URL, params={
            "service": "WFS",
            "version": "2.0.0",
            "request": "GetFeature",
            "typeNames": "TFR:V_TFR_LOC",
            "outputFormat": "application/json",
            "srsName": "EPSG:4326",
        })
        r.raise_for_status()
        data = r.json()
    except Exception as e:
        logger.warning(f"FAA WFS V_TFR_LOC fetch failed: {e!r}")
        return None
    out: dict[str, dict] = {}
    for f in data.get("features", []):
        props = f.get("properties") or {}
        nid = _notam_id_from_key(props.get("NOTAM_KEY") or "")
        if not nid:
            continue
        ring = _ring_from_geom(f.get("geometry") or {})
        if not ring:
            continue
        out[nid] = {
            "ring": ring,
            "title": props.get("TITLE") or "",
            "state": (props.get("STATE") or "").strip().upper(),
            "legal": props.get("LEGAL") or "",
            "modified": props.get("LAST_MODIFICATION_DATETIME") or "",
        }
    return out


async def _fetch_metadata(client: httpx.AsyncClient) -> dict[str, dict]:
    """Returns {notam_id: metadata} from exportTfrList — type/facility/created."""
    try:
        r = await client.get(LIST_URL)
        r.raise_for_status()
        data = r.json()
    except Exception as e:
        logger.warning(f"FAA exportTfrList fetch failed: {e!r}")
        return {}
    out: dict[str, dict] = {}
    for tfr in data:
        nid = (tfr.get("notam_id") or "").strip()
        if not nid:
            continue
        out[nid] = {
            "type": tfr.get("type"),
            "facility": tfr.get("facility"),
            "description": tfr.get("description"),
            "created": tfr.get("creation_date"),
        }
    return out


async def tfr_loop(state) -> None:
    headers = {
        "User-Agent": "graticule/0.1 (research; contact dbhavery@gmail.com)",
        "Accept": "application/json",
    }
    async with httpx.AsyncClient(timeout=TIMEOUT_SEC, headers=headers, follow_redirects=True) as client:
        while True:
            try:
                # Fetch both in parallel — WFS gives polygons, exportTfrList gives type/facility
                polys, meta = await asyncio.gather(
                    _fetch_wfs_polygons(client),
                    _fetch_metadata(client),
                )

                entries: dict[str, dict] = {}

                # Primary path: polygon-backed entries from V_TFR_LOC.
                if polys:
                    for nid, p in polys.items():
                        ring = p["ring"]
                        center = _poly_centroid(ring)
                        if not center:
                            continue
                        lon, lat = center
                        m = meta.get(nid, {})
                        entries[nid] = {
                            "lat": lat,
                            "lon": lon,
                            "polygon": ring,
                            "name": nid,
                            "notam_id": nid,
                            "state": p["state"],
                            "legal": p["legal"],
                            "title": p["title"],
                            "description": m.get("description") or p["title"],
                            "type": m.get("type"),
                            "facility": m.get("facility"),
                            "created": m.get("created"),
                            "modified": p["modified"],
                        }

                # Fill in state-centroid stubs for any TFRs in the list that don't
                # have a WFS polygon (typically space-ops / non-CONUS items where
                # V_TFR_LOC hasn't ingested geometry yet).
                try:
                    r = await client.get(LIST_URL)
                    r.raise_for_status()
                    for tfr in r.json():
                        nid = (tfr.get("notam_id") or "").strip()
                        if not nid or nid in entries:
                            continue
                        sc = STATE_CENTROIDS.get((tfr.get("state") or "").upper())
                        if not sc:
                            continue
                        lat, lon = sc
                        entries[nid] = {
                            "lat": lat, "lon": lon, "name": nid, "notam_id": nid,
                            "type": tfr.get("type"), "facility": tfr.get("facility"),
                            "state": (tfr.get("state") or "").upper(),
                            "description": tfr.get("description"),
                            "created": tfr.get("creation_date"),
                        }
                except Exception as e:
                    logger.warning(f"FAA TFR list-fill failed: {e!r}")

                poly_count = sum(1 for v in entries.values() if v.get("polygon"))
                logger.info(f"FAA TFRs: {len(entries)} active ({poly_count} polygon-backed, {len(entries) - poly_count} state-centroid)")

                state.replace_layer("tfrs", entries)
            except Exception as e:
                logger.warning(f"FAA TFR poll failed: {e!r}")
            await asyncio.sleep(POLL_SEC)
