"""FastAPI server: serves the web/ static bundle + JSON snapshot + WebSocket feed."""
from __future__ import annotations

import asyncio
import json
import os
from contextlib import asynccontextmanager
from pathlib import Path

import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from loguru import logger

from overwatch.feeds.adsb import opensky_loop
from overwatch.feeds.airports import airports_loop
from overwatch.feeds.ais import aisstream_loop
from overwatch.feeds.aurora import ovation_loop
from overwatch.feeds.cables import cables_loop
from overwatch.feeds.fires import firms_loop
from overwatch.feeds.hurricanes import nhc_loop
from overwatch.feeds.launches import launches_loop
from overwatch.feeds.news import gdelt_loop
from overwatch.feeds.quakes import usgs_loop
from overwatch.feeds.radar import rainviewer_loop
from overwatch.feeds.satellites import celestrak_loop
from overwatch.feeds.space_weather import space_weather_loop
from overwatch.feeds.tfrs import tfr_loop
from overwatch.feeds.tsunamis import nws_tsunami_loop
from overwatch.feeds.volcanoes import gvp_loop
from overwatch.state import state

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
    logger.info(f"overwatch server up — {len(feeds)} feeds running")
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
    return FileResponse(WEB_DIR / "index.html")


# Static assets — served AFTER explicit routes above
app.mount("/static", StaticFiles(directory=WEB_DIR), name="static")


def run_server(port: int) -> None:
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning", access_log=False)
