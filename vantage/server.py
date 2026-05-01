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

from vantage.feeds.adsb import opensky_loop
from vantage.feeds.ais import aisstream_loop
from vantage.feeds.aurora import ovation_loop
from vantage.feeds.fires import firms_loop
from vantage.feeds.hurricanes import nhc_loop
from vantage.feeds.quakes import usgs_loop
from vantage.feeds.radar import rainviewer_loop
from vantage.feeds.satellites import celestrak_loop
from vantage.feeds.tsunamis import nws_tsunami_loop
from vantage.feeds.volcanoes import gvp_loop
from vantage.state import state

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
    ]
    tasks = [asyncio.create_task(fn(state), name=n) for n, fn in feeds]
    tasks.append(asyncio.create_task(_expire_loop(), name="expire"))
    logger.info(f"vantage server up — {len(feeds)} feeds running")
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
        "cesium_ion_token": os.environ.get("CESIUM_ION_TOKEN") or "",
        "fires_enabled":    bool(os.environ.get("FIRMS_MAP_KEY", "").strip()),
        "ships_enabled":    bool(os.environ.get("AISSTREAM_KEY", "").strip()),
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
