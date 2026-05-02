"""AISStream.io WebSocket — global AIS ship positions.

Free key required: https://aisstream.io (instant signup). Without AISSTREAM_KEY
in env, this loop logs once and exits — the rest of the app keeps running.
"""
from __future__ import annotations

import asyncio
import json
import os

import websockets
from loguru import logger

AIS_URL = "wss://stream.aisstream.io/v0/stream"


async def aisstream_loop(state) -> None:
    api_key = os.environ.get("AISSTREAM_KEY", "").strip()
    if not api_key:
        logger.warning("AISSTREAM_KEY not set — AIS feed disabled. Get a free key at https://aisstream.io")
        return

    while True:
        try:
            async with websockets.connect(AIS_URL, max_size=2**22) as ws:
                await ws.send(json.dumps({
                    "APIKey": api_key,
                    "BoundingBoxes": [[[-90, -180], [90, 180]]],  # whole world
                    "FilterMessageTypes": ["PositionReport", "ShipStaticData"],
                }))
                logger.info("AIS: connected")
                async for raw in ws:
                    msg = json.loads(raw)
                    mtype = msg.get("MessageType")
                    meta = msg.get("MetaData") or {}
                    if mtype == "PositionReport":
                        pr = msg["Message"]["PositionReport"]
                        mmsi = str(pr["UserID"])
                        existing = state.ships.get(mmsi, {})
                        state.upsert_ship(mmsi, {
                            **existing,
                            "lat": pr["Latitude"],
                            "lon": pr["Longitude"],
                            "heading": pr.get("TrueHeading"),
                            "course": pr.get("Cog"),
                            "speed": pr.get("Sog"),
                            "name": existing.get("name") or (meta.get("ShipName", "") or "").strip() or None,
                        })
                    elif mtype == "ShipStaticData":
                        sd = msg["Message"]["ShipStaticData"]
                        mmsi = str(sd["UserID"])
                        existing = state.ships.get(mmsi, {})
                        existing["name"] = (sd.get("Name", "") or "").strip() or existing.get("name")
                        existing["type"] = sd.get("Type")
                        existing["destination"] = (sd.get("Destination", "") or "").strip() or None
                        if "lat" in existing:
                            state.upsert_ship(mmsi, existing)
        except Exception as e:
            logger.warning(f"AIS connection lost: {e} — reconnecting in 10s")
            await asyncio.sleep(10)
