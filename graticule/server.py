"""FastAPI server: serves the web/ static bundle + JSON snapshot + WebSocket feed."""
from __future__ import annotations

import asyncio
import json
import os
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse
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


app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None)


@app.get("/api/snapshot")
async def snapshot() -> JSONResponse:
    return JSONResponse(state.snapshot())


@app.get("/api/config")
async def config() -> JSONResponse:
    """Public-safe runtime config the front-end needs (e.g., Cesium token)."""
    return JSONResponse({
        "cesium_ion_token":    os.environ.get("CESIUM_ION_TOKEN") or "",
        "google_maps_api_key": os.environ.get("GOOGLE_MAPS_API_KEY") or "",
        "fires_enabled":       bool(os.environ.get("FIRMS_MAP_KEY", "").strip()),
        "ships_enabled":       bool(os.environ.get("AISSTREAM_KEY", "").strip()),
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


def run_server(port: int) -> None:
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning", access_log=False)
