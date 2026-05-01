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
from vantage.state import state

WEB_DIR = Path(__file__).parent.parent / "web"


@asynccontextmanager
async def lifespan(app: FastAPI):
    tasks = [
        asyncio.create_task(opensky_loop(state), name="opensky"),
        asyncio.create_task(aisstream_loop(state), name="aisstream"),
        asyncio.create_task(_expire_loop(), name="expire"),
    ]
    logger.info("vantage server up — feeds running")
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
