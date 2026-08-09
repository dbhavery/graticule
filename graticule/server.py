"""FastAPI server: serves the web/ static bundle + JSON snapshot + WebSocket feed."""
from __future__ import annotations

import asyncio
import json
import os
import re
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from loguru import logger

from graticule.feeds.adsb import opensky_loop
from graticule.feeds.airports import airports_loop
from graticule.feeds.ais import aisstream_loop
from graticule.feeds.aurora import ovation_loop
from graticule.feeds.cables import cables_loop
from graticule.feeds.fires import firms_loop
from graticule.feeds.hurricanes import nhc_loop
from graticule.feeds.launches import launches_loop
from graticule.feeds.news import gdelt_loop
from graticule.feeds.quakes import usgs_loop
from graticule.feeds.radar import rainviewer_loop
from graticule.feeds.satellites import celestrak_loop
from graticule.feeds.space_weather import space_weather_loop
from graticule.feeds.tfrs import tfr_loop
from graticule.feeds.tsunamis import nws_tsunami_loop
from graticule.feeds.volcanoes import gvp_loop
from graticule.state import state

WEB_DIR = Path(__file__).parent.parent / "web"


@asynccontextmanager
async def lifespan(app: FastAPI):
    feeds = [
        ("opensky",    opensky_loop),
        ("aisstream",  aisstream_loop),
        ("usgs",       usgs_loop),
        ("nhc",        nhc_loop),
        ("nws-tsu",    nws_tsunami_loop),
        ("gvp",        gvp_loop),
        ("firms",      firms_loop),
        ("celestrak",  celestrak_loop),
        ("rainviewer", rainviewer_loop),
        ("ovation",    ovation_loop),
        ("launches",   launches_loop),
        ("gdelt",      gdelt_loop),
        ("swpc-sw",    space_weather_loop),
        ("cables",     cables_loop),
        ("airports",   airports_loop),
        ("tfrs",       tfr_loop),
    ]
    tasks = [asyncio.create_task(fn(state), name=n) for n, fn in feeds]
    tasks.append(asyncio.create_task(_expire_loop(), name="expire"))
    tasks.append(asyncio.create_task(_flush_loop(), name="flush"))
    logger.info(f"graticule server up — {len(feeds)} feeds running")
    try:
        yield
    finally:
        for t in tasks:
            t.cancel()


async def _expire_loop() -> None:
    while True:
        await asyncio.sleep(60)
        state.expire()


# How often queued entity deltas go out as one frame per layer.
#
# 250 ms is chosen against what the client does with a frame, not against how
# fresh the data is. Aircraft positions are seconds old by the time ADS-B
# reaches us, so a quarter second changes nothing anybody can see. What it does
# change is that a burst of 1,244 single-entity frames, each one running
# updateCategoryCounts() and refreshAlerts() on a phone, becomes a handful of
# batches. Going lower buys no freshness and gives back the win.
FLUSH_INTERVAL_S = 0.25


async def _flush_loop() -> None:
    while True:
        await asyncio.sleep(FLUSH_INTERVAL_S)
        try:
            state.flush()
        except Exception:
            # A flush that raises must not kill the loop, or the app goes
            # silent while the server looks healthy.
            logger.exception("flush failed")


app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None)

# The static bundle is mostly generated GeoJSON, which is the most compressible
# payload there is: ne_counties.json goes 2.8 MB -> 816 KB, ne_state_borders
# 13 MB -> 3.4 MB. Static assets are served with no-store (see no_cache_static
# below, a WebView2 workaround), so every reload pays the full transfer and the
# compression is not a one-time saving.
#
# 4096 bytes is above every small JSON response we emit, so the CPU cost lands
# only on payloads where it buys something.
app.add_middleware(GZipMiddleware, minimum_size=4096)

# The native builds are not same-origin with this server and never can be.
# Android's WebView serves the app from https://localhost and iOS from
# capacitor://localhost -- real origins with real schemes, so every /api call
# and the WebSocket handshake are cross-origin and the browser blocks them
# without these headers.
#
# The allow-list is explicit rather than `*`. It is not a security boundary
# here (every endpoint is public, read-only, unauthenticated data), but `*` and
# allow_credentials cannot legally coexist, and writing the real origins down
# means the day this server does grow a credential the default is already
# closed. GRATICULE_ALLOWED_ORIGINS adds deployment origins without a code
# change.
_NATIVE_ORIGINS = [
    "https://localhost",       # Capacitor, Android
    "capacitor://localhost",   # Capacitor, iOS
    "ionic://localhost",       # older Capacitor/Ionic shells
    "http://localhost",        # `npx cap run` dev server
]
_EXTRA_ORIGINS = [
    o.strip() for o in os.getenv("GRATICULE_ALLOWED_ORIGINS", "").split(",") if o.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_NATIVE_ORIGINS + _EXTRA_ORIGINS,
    # A phone on a home network hits the desktop by LAN IP, and the emulator
    # reaches its host at the fixed alias 10.0.2.2. Neither is knowable in
    # advance, and both are private address space that no hostile page on the
    # public internet can be served from.
    allow_origin_regex=r"^https?://(10\.0\.2\.2|127\.0\.0\.1|localhost|"
                       r"10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|"
                       r"172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)(:\d+)?$",
    allow_methods=["GET", "OPTIONS"],
    allow_headers=["*"],
)


@app.get("/api/snapshot")
async def snapshot() -> JSONResponse:
    return JSONResponse(state.snapshot())


@app.get("/api/config")
async def config() -> JSONResponse:
    """Public-safe runtime config the front-end needs (e.g., Cesium token).

    `fires_enabled` is now unconditionally true: FIRMS publishes the same
    detections as a keyless static archive, so the layer no longer depends on
    anyone holding a MAP_KEY. It stays in the payload because the front-end
    reads it, and because a future source outage is a real reason to switch a
    layer off centrally.

    `ships_enabled` still tracks a key, and honestly so — see feeds/ais.py.
    There is no keyless live AIS with global coverage; the free feeds are
    national. Claiming otherwise would put an empty layer in the UI.
    """
    return JSONResponse({
        "cesium_ion_token":    os.environ.get("CESIUM_ION_TOKEN") or "",
        "google_maps_api_key": os.environ.get("GOOGLE_MAPS_API_KEY") or "",
        "fires_enabled":       True,
        # True either way now: with a key it is global AISStream, without one it
        # is Digitraffic. The layer is live in both cases, so the toggle is live.
        "ships_enabled":       True,
        "ships_global":        bool(os.environ.get("AISSTREAM_KEY", "").strip()),
    })


#: SPC convective-outlook GeoJSON, cached briefly. Proxied rather than fetched
#: from the browser because spc.noaa.gov sends no Access-Control-Allow-Origin
#: header, so a direct front-end fetch is blocked by CORS.
_SPC_CACHE: dict[str, tuple[float, dict]] = {}
_SPC_TTL_S = 600.0


@app.get("/api/spc/outlook")
async def spc_outlook(day: str = "1") -> JSONResponse:
    """Day 1-3 SPC categorical convective outlook as GeoJSON."""
    if day not in {"1", "2", "3"}:
        return JSONResponse({"error": "day must be 1, 2 or 3"}, status_code=400)

    now = asyncio.get_event_loop().time()
    hit = _SPC_CACHE.get(day)
    if hit and now - hit[0] < _SPC_TTL_S:
        return JSONResponse(hit[1])

    url = f"https://www.spc.noaa.gov/products/outlook/day{day}otlk_cat.nolyr.geojson"
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            r = await client.get(url, headers={"User-Agent": "graticule/1.0"})
            r.raise_for_status()
            data = r.json()
    except Exception as exc:  # network, HTTP, or JSON decode
        logger.warning(f"SPC outlook day {day} fetch failed: {exc}")
        # Serve stale rather than nothing — an outlook valid 20 minutes ago is
        # far more useful than an empty map during a severe-weather event.
        if hit:
            return JSONResponse(hit[1])
        return JSONResponse({"error": str(exc)}, status_code=502)

    _SPC_CACHE[day] = (now, data)
    return JSONResponse(data)


#: METAR surface observations. Proxied because aviationweather.gov sends no
#: CORS header. Short TTL — METARs cycle hourly with specials in between.
_METAR_CACHE: tuple[float, list] | None = None
_METAR_TTL_S = 300.0


@app.get("/api/metar")
async def metar() -> JSONResponse:
    """CONUS + nearby surface observations as a trimmed JSON array."""
    global _METAR_CACHE
    now = asyncio.get_event_loop().time()
    if _METAR_CACHE and now - _METAR_CACHE[0] < _METAR_TTL_S:
        return JSONResponse(_METAR_CACHE[1])

    # Bounding box covers CONUS, southern Canada, Mexico, Alaska and Hawaii.
    # NOTE: aviationweather.gov orders bbox as lat0,lon0,lat1,lon1 — the
    # lon-first ordering used by most GIS APIs silently returns 204 No Content
    # here, which then fails JSON decoding rather than erroring usefully.
    url = (
        "https://aviationweather.gov/api/data/metar"
        "?format=json&taf=false&hours=2&bbox=15,-170,72,-60"
    )
    try:
        async with httpx.AsyncClient(timeout=25.0) as client:
            r = await client.get(url, headers={"User-Agent": "graticule/1.0"})
            r.raise_for_status()
            raw = r.json()
    except Exception as exc:
        logger.warning(f"METAR fetch failed: {exc}")
        if _METAR_CACHE:
            return JSONResponse(_METAR_CACHE[1])
        return JSONResponse({"error": str(exc)}, status_code=502)

    # Keep one observation per station (the API returns a 2-hour history) and
    # only the fields the station plot actually renders.
    latest: dict[str, dict] = {}
    for ob in raw if isinstance(raw, list) else []:
        sid = ob.get("icaoId")
        if not sid or ob.get("lat") is None or ob.get("lon") is None:
            continue
        prev = latest.get(sid)
        if prev and (prev.get("obsTime") or 0) >= (ob.get("obsTime") or 0):
            continue
        latest[sid] = {
            "id":    sid,
            "lat":   ob.get("lat"),
            "lon":   ob.get("lon"),
            "temp":  ob.get("temp"),
            "dewp":  ob.get("dewp"),
            "wdir":  ob.get("wdir"),
            "wspd":  ob.get("wspd"),
            "wgst":  ob.get("wgst"),
            "visib": ob.get("visib"),
            "altim": ob.get("altim"),
            "name":  ob.get("name"),
            "obsTime": ob.get("obsTime"),
        }

    out = list(latest.values())
    _METAR_CACHE = (now, out)
    logger.info(f"METAR: {len(out)} stations")
    return JSONResponse(out)


#: Active NWS watches/warnings/advisories with polygons, for the alert cards.
_NWS_CACHE: tuple[float, dict] | None = None
_NWS_TTL_S = 60.0


@app.get("/api/nws/alerts")
async def nws_alerts() -> JSONResponse:
    """Active NWS alerts as GeoJSON, newest first."""
    global _NWS_CACHE
    now = asyncio.get_event_loop().time()
    if _NWS_CACHE and now - _NWS_CACHE[0] < _NWS_TTL_S:
        return JSONResponse(_NWS_CACHE[1])

    url = "https://api.weather.gov/alerts/active?status=actual&message_type=alert"
    try:
        async with httpx.AsyncClient(timeout=25.0, follow_redirects=True) as client:
            r = await client.get(url, headers={
                "User-Agent": "graticule/1.0 (dbhavery@gmail.com)",
                "Accept": "application/geo+json",
            })
            r.raise_for_status()
            data = r.json()
    except Exception as exc:
        logger.warning(f"NWS alerts fetch failed: {exc}")
        if _NWS_CACHE:
            return JSONResponse(_NWS_CACHE[1])
        return JSONResponse({"error": str(exc)}, status_code=502)

    _NWS_CACHE = (now, data)
    return JSONResponse(data)


#: NWS Local Storm Reports (hail, wind, tornado, flooding) from Iowa State.
_LSR_CACHE: tuple[float, dict] | None = None
_LSR_TTL_S = 180.0


@app.get("/api/lsr")
async def local_storm_reports(hours: int = 12) -> JSONResponse:
    """Recent local storm reports as GeoJSON."""
    hours = max(1, min(48, hours))
    global _LSR_CACHE
    now = asyncio.get_event_loop().time()
    if _LSR_CACHE and _LSR_CACHE[1].get("_hours") == hours and now - _LSR_CACHE[0] < _LSR_TTL_S:
        return JSONResponse(_LSR_CACHE[1])

    url = f"https://mesonet.agron.iastate.edu/geojson/lsr.py?hours={hours}"
    try:
        async with httpx.AsyncClient(timeout=25.0) as client:
            r = await client.get(url, headers={"User-Agent": "graticule/1.0"})
            r.raise_for_status()
            data = r.json()
    except Exception as exc:
        logger.warning(f"LSR fetch failed: {exc}")
        if _LSR_CACHE:
            return JSONResponse(_LSR_CACHE[1])
        return JSONResponse({"error": str(exc)}, status_code=502)

    data["_hours"] = hours
    _LSR_CACHE = (now, data)
    return JSONResponse(data)


#: Public camera networks. All keyless, all fetched concurrently and merged.
#:
#:   ALERTCalifornia  ~1,280 wildfire-detection cameras (UC San Diego / CAL FIRE)
#:   Caltrans CWWP2   ~3,480 highway CCTV across all 12 districts. Caltrans
#:                    states plainly there is no charge and documents no key.
#:                    Each record also carries 12 previous frames and an HLS
#:                    stream, so a camera can be looped or watched live.
#:   NYC DOT          ~970 city traffic cameras
#:
#: Images are handed to the client as absolute upstream URLs rather than
#: proxied. An <img> tag needs no CORS header, so proxying would only add a
#: hop and latency; only the camera *lists* need the server, because those are
#: fetched with fetch() and do need CORS.
_CAM_CACHE: tuple[float, dict] | None = None
_CAM_TTL_S = 1800.0

_ALERTCA_LIST = "https://cameras.alertcalifornia.org/public-camera-data/all_cameras-v3.json"
_ALERTCA_FRAME = "https://cameras.alertcalifornia.org/public-camera-data/{cid}/latest-frame.jpg"
_CALTRANS_LIST = "https://cwwp2.dot.ca.gov/data/d{d}/cctv/cctvStatusD{dd}.json"
_NYC_LIST = "https://webcams.nyctmc.org/api/cameras"


async def _fetch_alertca(client: httpx.AsyncClient) -> list[dict]:
    r = await client.get(_ALERTCA_LIST, headers={"User-Agent": "graticule/1.0"})
    r.raise_for_status()
    out = []
    for f in r.json().get("features", []):
        c = (f.get("geometry") or {}).get("coordinates") or []
        # ~900 of ~2,180 records carry [null, null]. A NaN position corrupts
        # Cesium's frustum computation, so they never reach the client.
        if len(c) < 2 or c[0] is None or c[1] is None:
            continue
        p = f.get("properties") or {}
        cid = p.get("id")
        out.append({
            "lon": c[0], "lat": c[1], "network": "ALERTCalifornia",
            "id": cid, "name": p.get("name") or cid,
            "place": (p.get("county") or "").title(), "state": p.get("state") or "CA",
            "image": _ALERTCA_FRAME.format(cid=cid),
            "az_current": p.get("az_current"), "tilt_current": p.get("tilt_current"),
            "last_frame_ts": p.get("last_frame_ts"),
        })
    return out


async def _fetch_caltrans_district(client: httpx.AsyncClient, d: int) -> list[dict]:
    r = await client.get(_CALTRANS_LIST.format(d=d, dd=f"{d:02d}"),
                         headers={"User-Agent": "graticule/1.0"})
    r.raise_for_status()
    out = []
    for rec in r.json().get("data", []):
        c = rec.get("cctv") or {}
        loc = c.get("location") or {}
        img = ((c.get("imageData") or {}).get("static") or {}).get("currentImageURL")
        if not img:
            continue
        try:
            lon, lat = float(loc["longitude"]), float(loc["latitude"])
        except (KeyError, TypeError, ValueError):
            continue
        if not (-180 <= lon <= 180 and -90 <= lat <= 90) or (lon == 0 and lat == 0):
            continue
        out.append({
            "lon": lon, "lat": lat, "network": "Caltrans",
            "id": f"ct-{loc.get('district')}-{loc.get('index', '')}-{c.get('index', '')}",
            "name": loc.get("locationName") or loc.get("nearbyPlace") or "Caltrans CCTV",
            "place": loc.get("county") or loc.get("nearbyPlace") or "", "state": "CA",
            "route": loc.get("route") or "", "direction": loc.get("direction") or "",
            "image": img,
            "stream": (c.get("imageData") or {}).get("streamingVideoURL") or "",
            "in_service": c.get("inService") == "true",
        })
    return out


async def _fetch_nyc(client: httpx.AsyncClient) -> list[dict]:
    r = await client.get(_NYC_LIST, headers={"User-Agent": "graticule/1.0"})
    r.raise_for_status()
    out = []
    for c in r.json():
        try:
            lon, lat = float(c["longitude"]), float(c["latitude"])
        except (KeyError, TypeError, ValueError):
            continue
        out.append({
            "lon": lon, "lat": lat, "network": "NYC DOT",
            "id": c.get("id"), "name": c.get("name") or "NYC camera",
            "place": c.get("area") or "New York City", "state": "NY",
            "image": c.get("imageUrl") or "",
            "in_service": str(c.get("isOnline", "")).lower() == "true",
        })
    return out


@app.get("/api/cameras")
async def public_cameras() -> JSONResponse:
    """Every public camera network we can reach without a key, as GeoJSON."""
    global _CAM_CACHE
    now = asyncio.get_event_loop().time()
    if _CAM_CACHE and now - _CAM_CACHE[0] < _CAM_TTL_S:
        return JSONResponse(_CAM_CACHE[1])

    async with httpx.AsyncClient(timeout=45.0, follow_redirects=True) as client:
        jobs = [_fetch_alertca(client), _fetch_nyc(client)]
        jobs += [_fetch_caltrans_district(client, d) for d in range(1, 13)]
        # One dead network must not take the layer down with it.
        results = await asyncio.gather(*jobs, return_exceptions=True)

    cams, networks, failures = [], {}, []
    for res in results:
        if isinstance(res, Exception):
            failures.append(str(res))
            continue
        cams.extend(res)
    for c in cams:
        networks[c["network"]] = networks.get(c["network"], 0) + 1

    if not cams:
        logger.warning(f"all camera networks failed: {failures}")
        if _CAM_CACHE:
            return JSONResponse(_CAM_CACHE[1])
        return JSONResponse({"error": "all camera sources unavailable"}, status_code=502)

    data = {
        "type": "FeatureCollection",
        "networks": networks,
        "credit": "ALERTCalifornia / UC San Diego · Caltrans CWWP2 · NYC DOT",
        "features": [{
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [c.pop("lon"), c.pop("lat")]},
            "properties": {"kind": "cameras", **c},
        } for c in cams],
    }
    _CAM_CACHE = (now, data)
    logger.info(f"cameras: {len(cams)} from {networks}"
                + (f" ({len(failures)} sources failed)" if failures else ""))
    return JSONResponse(data)


#: Storm spotter reports — Spotter Network's public GRLevelX placefile.
#: This is the "Storm Chaser Feeds" row without a per-chaser partnership:
#: the same ground-truth reports the desktop radar apps plot.
_SPOT_CACHE: tuple[float, dict] | None = None
_SPOT_TTL_S = 120.0
_SPOT_URL = "https://www.spotternetwork.org/feeds/reports.txt"

#: Placefile lines look like:
#:   Icon: 42.036,-72.755,000,5,3,"Reported By: Tim Saridakis\nRotating Wall
#:   Cloud\nTime: 2026-08-03 04:57:04 UTC\nNotes: ..."
_SPOT_ICON = re.compile(
    r'^Icon:\s*(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?),\s*\d+,\s*\d+,\s*(\d+),\s*"(.*)"\s*$',
    re.MULTILINE,
)


def _parse_spotter_placefile(text: str) -> list[dict]:
    feats = []
    for lat, lon, icon, blob in _SPOT_ICON.findall(text):
        # The placefile escapes newlines as a literal backslash-n.
        lines = [ln.strip() for ln in blob.split("\\n") if ln.strip()]
        rec = {"reporter": "", "report": "", "time": "", "notes": ""}
        for ln in lines:
            low = ln.lower()
            if low.startswith("reported by:"):
                rec["reporter"] = ln.split(":", 1)[1].strip()
            elif low.startswith("time:"):
                rec["time"] = ln.split(":", 1)[1].strip()
            elif low.startswith("notes:"):
                rec["notes"] = ln.split(":", 1)[1].strip()
            elif not rec["report"]:
                rec["report"] = ln
        try:
            flat, flon = float(lat), float(lon)
        except ValueError:
            continue
        if not (-90 <= flat <= 90 and -180 <= flon <= 180):
            continue
        feats.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [flon, flat]},
            "properties": {"kind": "spotters", "icon": int(icon), **rec},
        })
    return feats


@app.get("/api/spotters")
async def spotter_reports() -> JSONResponse:
    """Live storm-spotter reports as GeoJSON."""
    global _SPOT_CACHE
    now = asyncio.get_event_loop().time()
    if _SPOT_CACHE and now - _SPOT_CACHE[0] < _SPOT_TTL_S:
        return JSONResponse(_SPOT_CACHE[1])

    try:
        async with httpx.AsyncClient(timeout=25.0, follow_redirects=True) as client:
            r = await client.get(_SPOT_URL, headers={"User-Agent": "graticule/1.0"})
            r.raise_for_status()
            text = r.text
    except Exception as exc:
        logger.warning(f"spotter reports fetch failed: {exc}")
        if _SPOT_CACHE:
            return JSONResponse(_SPOT_CACHE[1])
        return JSONResponse({"error": str(exc)}, status_code=502)

    data = {"type": "FeatureCollection",
            "features": _parse_spotter_placefile(text),
            "credit": "Spotter Network"}
    _SPOT_CACHE = (now, data)
    return JSONResponse(data)




# ═══════════════════════════════════════════════════════════════════════════
#  WATER  —  river gauges, tide stations, marine buoys
#  Three keyless federal feeds. Between them they cover the part of a severe
#  weather picture that radar cannot show: what the rain did after it landed,
#  what the surge is doing at the coast, and what the sea state is offshore.
# ═══════════════════════════════════════════════════════════════════════════

#: River gauges — NOAA National Water Prediction Service.
#:
#: Chosen over USGS Water Services, which was the obvious first stop. USGS
#: gives a stage in feet and nothing to compare it against, and its bbox is
#: area-limited ("your requested width must be less than or equal to 1.9
#: degrees at latitude 30.0 with requested height of 15.0"), so national
#: coverage costs 50 state queries. NWPS carries the observed stage, the
#: forecast stage, AND the flood category the local river forecast centre has
#: assigned, which is the difference between a number and a warning.
_RIVER_CACHE: tuple[float, dict] | None = None
_RIVER_TTL_S = 600.0
_RIVER_URL = "https://api.water.noaa.gov/nwps/v1/gauges"

#: The whole of North America in one request 504s after 60 s. These four tiles
#: each return in 15-40 s and are fetched concurrently.
_RIVER_TILES = [
    (-180.0, 15.0, -125.0, 72.0),   # Alaska, Hawaii, the Pacific
    (-125.0, 24.0, -100.0, 50.0),   # west
    (-100.0, 24.0, -85.0, 50.0),    # plains and midwest
    (-85.0, 15.0, -60.0, 50.0),     # east, Gulf, Puerto Rico
]

#: NWPS flood categories, least to most severe. The client colours by these.
_FLOOD_RANK = {
    "no_flooding": 0, "not_defined": 0, "obs_not_current": 0,
    "fcst_not_current": 0, "low_water_threshold": 0,
    "action": 1, "minor": 2, "moderate": 3, "major": 4,
}
#: NWPS uses -999 as its no-data sentinel. Left alone it plots as a river
#: 999 feet below its bed.
_NWPS_MISSING = -999


def _nwps_reading(block: dict) -> dict | None:
    if not block:
        return None
    value = block.get("primary")
    if value is None or value == _NWPS_MISSING:
        return None
    out = {"value": value, "unit": block.get("primaryUnit") or "ft",
           "valid": block.get("validTime") or ""}
    flow = block.get("secondary")
    if flow is not None and flow != _NWPS_MISSING:
        out["flow"] = flow
        out["flow_unit"] = block.get("secondaryUnit") or ""
    return out


async def _fetch_river_tile(client: httpx.AsyncClient, box: tuple) -> list[dict]:
    xmin, ymin, xmax, ymax = box
    r = await client.get(_RIVER_URL, params={
        "srid": "EPSG_4326",
        "bbox.xmin": xmin, "bbox.ymin": ymin,
        "bbox.xmax": xmax, "bbox.ymax": ymax,
    }, headers={"User-Agent": "graticule/1.0"})
    r.raise_for_status()
    out = []
    for g in r.json().get("gauges", []):
        lat, lon = g.get("latitude"), g.get("longitude")
        if lat is None or lon is None:
            continue
        status = g.get("status") or {}
        observed = _nwps_reading(status.get("observed"))
        # A gauge with no current reading is a dot that says nothing. The
        # forecast-only ones are kept, because a river forecast to crest is
        # exactly what a viewer wants to see before it does.
        forecast = _nwps_reading(status.get("forecast"))
        if not observed and not forecast:
            continue
        cat = ((status.get("observed") or {}).get("floodCategory") or "not_defined")
        out.append({
            "lon": lon, "lat": lat,
            "id": g.get("lid") or "",
            "name": g.get("name") or "River gauge",
            "state": ((g.get("state") or {}).get("abbreviation") or ""),
            "wfo": ((g.get("wfo") or {}).get("abbreviation") or ""),
            "rfc": ((g.get("rfc") or {}).get("name") or ""),
            "flood_category": cat,
            "flood_rank": _FLOOD_RANK.get(cat, 0),
            "observed": observed,
            "forecast": forecast,
        })
    return out


@app.get("/api/rivers")
async def river_gauges() -> JSONResponse:
    """Every NWPS river gauge in North America with a live or forecast stage."""
    global _RIVER_CACHE
    now = asyncio.get_event_loop().time()
    if _RIVER_CACHE and now - _RIVER_CACHE[0] < _RIVER_TTL_S:
        return JSONResponse(_RIVER_CACHE[1])

    async with httpx.AsyncClient(timeout=90.0, follow_redirects=True) as client:
        results = await asyncio.gather(
            *(_fetch_river_tile(client, b) for b in _RIVER_TILES),
            return_exceptions=True)

    gauges, failures = [], []
    for res in results:
        if isinstance(res, Exception):
            failures.append(str(res))
        else:
            gauges.extend(res)
    if not gauges:
        logger.warning(f"all river tiles failed: {failures}")
        if _RIVER_CACHE:
            return JSONResponse(_RIVER_CACHE[1])
        return JSONResponse({"error": "river gauges unavailable"}, status_code=502)

    # Tiles share edges, so a gauge on a boundary arrives twice.
    seen, unique = set(), []
    for g in gauges:
        if g["id"] and g["id"] in seen:
            continue
        seen.add(g["id"])
        unique.append(g)

    flooding = sum(1 for g in unique if g["flood_rank"] >= 1)
    data = {
        "type": "FeatureCollection",
        "flooding": flooding,
        "credit": "NOAA National Water Prediction Service",
        "features": [{
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [g.pop("lon"), g.pop("lat")]},
            "properties": {"kind": "rivers", **g},
        } for g in unique],
    }
    _RIVER_CACHE = (now, data)
    logger.info(f"rivers: {len(unique)} gauges, {flooding} at or above action stage"
                + (f" ({len(failures)} tiles failed)" if failures else ""))
    return JSONResponse(data)


#: Tide stations — NOAA CO-OPS. The station list is one request; live water
#: level is per-station, so it is fetched on click rather than for all 300 up
#: front. See /api/tide/{station}.
_TIDE_CACHE: tuple[float, dict] | None = None
_TIDE_TTL_S = 86400.0          # the station list is effectively static
_TIDE_STATIONS = "https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations.json"
_TIDE_DATA = "https://api.tidesandcurrents.noaa.gov/api/prod/datagetter"


@app.get("/api/tides")
async def tide_stations() -> JSONResponse:
    """NOAA water-level stations as GeoJSON. Levels come from /api/tide/{id}."""
    global _TIDE_CACHE
    now = asyncio.get_event_loop().time()
    if _TIDE_CACHE and now - _TIDE_CACHE[0] < _TIDE_TTL_S:
        return JSONResponse(_TIDE_CACHE[1])

    try:
        async with httpx.AsyncClient(timeout=45.0, follow_redirects=True) as client:
            r = await client.get(_TIDE_STATIONS, params={"type": "waterlevels"},
                                 headers={"User-Agent": "graticule/1.0"})
            r.raise_for_status()
            stations = r.json().get("stations", [])
    except Exception as exc:
        logger.warning(f"tide station list failed: {exc}")
        if _TIDE_CACHE:
            return JSONResponse(_TIDE_CACHE[1])
        return JSONResponse({"error": str(exc)}, status_code=502)

    feats = []
    for s in stations:
        lat, lon = s.get("lat"), s.get("lng")
        if lat is None or lon is None:
            continue
        feats.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [lon, lat]},
            "properties": {
                "kind": "tides",
                "id": s.get("id") or "",
                "name": s.get("name") or "Tide station",
                "state": s.get("state") or "",
                "tidal": bool(s.get("tidal")),
                "great_lakes": bool(s.get("greatlakes")),
                "storm_surge": bool(s.get("stormsurge")),
                "affiliations": s.get("affiliations") or "",
            },
        })
    data = {"type": "FeatureCollection", "features": feats,
            "credit": "NOAA CO-OPS"}
    _TIDE_CACHE = (now, data)
    logger.info(f"tides: {len(feats)} stations")
    return JSONResponse(data)


@app.get("/api/tide/{station}")
async def tide_detail(station: str) -> JSONResponse:
    """Live water level plus today's highs and lows for one station.

    Fetched on click. Doing this for all 301 stations up front would be 602
    requests against CO-OPS every refresh to populate a panel showing one.
    """
    if not re.fullmatch(r"[0-9A-Za-z]{3,12}", station):
        return JSONResponse({"error": "bad station id"}, status_code=400)

    common = {"station": station, "datum": "MLLW", "units": "english",
              "format": "json", "application": "graticule"}
    try:
        async with httpx.AsyncClient(timeout=25.0, follow_redirects=True) as client:
            level_r, pred_r = await asyncio.gather(
                client.get(_TIDE_DATA, params={**common, "date": "latest",
                                               "product": "water_level",
                                               "time_zone": "gmt"}),
                client.get(_TIDE_DATA, params={**common, "date": "today",
                                               "product": "predictions",
                                               "interval": "hilo",
                                               "time_zone": "lst_ldt"}),
                return_exceptions=True)
    except Exception as exc:
        return JSONResponse({"error": str(exc)}, status_code=502)

    out: dict = {"station": station}
    # CO-OPS answers 200 with {"error": {...}} for a station that carries no
    # water level, so status_code alone does not tell you whether this worked.
    if not isinstance(level_r, Exception) and level_r.status_code == 200:
        body = level_r.json()
        rows = body.get("data") or []
        if rows:
            out["level"] = {"t": rows[-1].get("t"), "v": rows[-1].get("v")}
            out["name"] = (body.get("metadata") or {}).get("name")
        elif body.get("error"):
            out["level_error"] = (body["error"] or {}).get("message", "")
    if not isinstance(pred_r, Exception) and pred_r.status_code == 200:
        body = pred_r.json()
        out["predictions"] = [
            {"t": p.get("t"), "v": p.get("v"), "type": p.get("type")}
            for p in (body.get("predictions") or [])
        ]
    return JSONResponse(out)


#: Marine buoys — NDBC. One 108 KB text file carries the latest observation
#: from every station on the network, worldwide, so this is a single request
#: rather than a fetch per buoy.
_BUOY_CACHE: tuple[float, dict] | None = None
_BUOY_TTL_S = 900.0
_BUOY_URL = "https://www.ndbc.noaa.gov/data/latest_obs/latest_obs.txt"

#: Column order of latest_obs.txt after the two header lines. 'MM' is missing.
#:   STN LAT LON YYYY MM DD hh mm WDIR WSPD GST WVHT DPD APD MWD PRES PTDY
#:   ATMP WTMP DEWP VIS TIDE
_BUOY_FIELDS = [
    ("wind_dir", 8, "deg"), ("wind_speed", 9, "m/s"), ("gust", 10, "m/s"),
    ("wave_height", 11, "m"), ("dom_period", 12, "s"), ("avg_period", 13, "s"),
    ("wave_dir", 14, "deg"), ("pressure", 15, "hPa"), ("pressure_tend", 16, "hPa"),
    ("air_temp", 17, "C"), ("water_temp", 18, "C"), ("dew_point", 19, "C"),
    ("visibility", 20, "nmi"), ("tide", 21, "ft"),
]


def _parse_latest_obs(text: str) -> list[dict]:
    out = []
    for line in text.splitlines():
        if not line or line.startswith("#"):
            continue
        cols = line.split()
        if len(cols) < 22:
            continue
        try:
            lat, lon = float(cols[1]), float(cols[2])
        except ValueError:
            continue
        if not (-90 <= lat <= 90 and -180 <= lon <= 180):
            continue
        rec = {"id": cols[0]}
        for name, idx, _unit in _BUOY_FIELDS:
            raw = cols[idx]
            if raw == "MM":
                continue
            try:
                rec[name] = float(raw)
            except ValueError:
                continue
        # A station reporting nothing but its own position is a dot with no
        # content behind it.
        if len(rec) == 1:
            continue
        try:
            rec["obs_time"] = (f"{cols[3]}-{int(cols[4]):02d}-{int(cols[5]):02d}T"
                               f"{int(cols[6]):02d}:{int(cols[7]):02d}Z")
        except ValueError:
            rec["obs_time"] = ""
        out.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [lon, lat]},
            "properties": {"kind": "buoys", **rec},
        })
    return out


@app.get("/api/buoys")
async def marine_buoys() -> JSONResponse:
    """Latest observation from every NDBC station, worldwide."""
    global _BUOY_CACHE
    now = asyncio.get_event_loop().time()
    if _BUOY_CACHE and now - _BUOY_CACHE[0] < _BUOY_TTL_S:
        return JSONResponse(_BUOY_CACHE[1])

    try:
        async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
            r = await client.get(_BUOY_URL, headers={"User-Agent": "graticule/1.0"})
            r.raise_for_status()
            text = r.text
    except Exception as exc:
        logger.warning(f"buoy fetch failed: {exc}")
        if _BUOY_CACHE:
            return JSONResponse(_BUOY_CACHE[1])
        return JSONResponse({"error": str(exc)}, status_code=502)

    feats = _parse_latest_obs(text)
    data = {"type": "FeatureCollection", "features": feats,
            "credit": "NOAA National Data Buoy Center"}
    _BUOY_CACHE = (now, data)
    logger.info(f"buoys: {len(feats)} stations reporting")
    return JSONResponse(data)


@app.websocket("/ws")
async def ws(websocket: WebSocket) -> None:
    await websocket.accept()
    state.subscribe(websocket)
    try:
        await websocket.send_text(json.dumps({"type": "snapshot", "data": state.snapshot()}, default=str))
        while True:
            # Drain any client pings; we don't process them
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        state.unsubscribe(websocket)


@app.get("/")
async def index() -> FileResponse:
    # WebView2 caches aggressively — force a fresh fetch every load so
    # rebuilds show up without manual reload tricks.
    return FileResponse(
        WEB_DIR / "index.html",
        headers={"Cache-Control": "no-store, no-cache, must-revalidate, max-age=0"},
    )


# ---------------------------------------------------------------------------
# Installable-app plumbing.
#
# All four have to be served from the ROOT, not from /static, and the service
# worker is the reason. A worker's default scope is the directory it was served
# from, so /static/sw.js can only ever control /static/* -- it would never see
# the navigation to "/" that it exists to keep working offline. The manifest is
# at the root for the same reason its `scope` and `start_url` are "/".
# ---------------------------------------------------------------------------


@app.get("/sw.js")
async def service_worker() -> FileResponse:
    return FileResponse(
        WEB_DIR / "sw.js",
        media_type="application/javascript",
        # The worker script itself must never be served stale, or a deploy
        # cannot replace the worker that is caching the old deploy.
        headers={"Cache-Control": "no-cache", "Service-Worker-Allowed": "/"},
    )


@app.get("/manifest.webmanifest")
async def manifest() -> FileResponse:
    return FileResponse(
        WEB_DIR / "manifest.webmanifest",
        media_type="application/manifest+json",
    )


@app.get("/offline.html")
async def offline() -> FileResponse:
    return FileResponse(WEB_DIR / "offline.html", media_type="text/html")


# ---------------------------------------------------------------------------
# Store listing pages.
#
# Google Play requires a privacy policy URL and a support URL, and both have to
# resolve for a reviewer who has never installed the app. They are served from
# the ROOT rather than /static because the URL is typed into a store console by
# a human and then quoted back to users: "/privacy" survives that, and
# "/static/privacy.html" is a URL nobody would choose to publish.
#
# Both extensions are answered so a link written either way resolves, rather
# than a 404 sitting behind a store listing field that is checked once.
# ---------------------------------------------------------------------------


@app.get("/privacy")
@app.get("/privacy.html")
async def privacy() -> FileResponse:
    return FileResponse(WEB_DIR / "privacy.html", media_type="text/html")


@app.get("/support")
@app.get("/support.html")
async def support() -> FileResponse:
    return FileResponse(WEB_DIR / "support.html", media_type="text/html")


@app.get("/favicon.ico")
async def favicon() -> FileResponse:
    return FileResponse(WEB_DIR / "favicon.ico", media_type="image/x-icon")


@app.middleware("http")
async def no_cache_static(request, call_next):
    """Disable caching for /static/* so WebView2 always fetches the latest JS/CSS/data."""
    response = await call_next(request)
    if request.url.path.startswith("/static/"):
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    return response


# Static assets — served AFTER explicit routes above
app.mount("/static", StaticFiles(directory=WEB_DIR), name="static")


def run_server(port: int, host: str | None = None) -> None:
    """Serve the app.

    Default binding stays 127.0.0.1: the desktop build is a pywebview window
    talking to itself, and a weather server that listens on every interface by
    accident is a service nobody asked to run.

    A phone cannot reach 127.0.0.1 on another machine, so the Android build
    needs 0.0.0.0. That is opt-in through GRATICULE_HOST or the `host`
    argument, so turning it on is a decision somebody made rather than a
    default somebody inherited.
    """
    bind = host or os.getenv("GRATICULE_HOST", "127.0.0.1")
    if bind not in ("127.0.0.1", "localhost"):
        logger.warning(f"Serving on {bind}:{port} -- reachable from the network")
    uvicorn.run(app, host=bind, port=port, log_level="warning", access_log=False)
