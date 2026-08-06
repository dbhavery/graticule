"""AIS ship positions.

Two sources, and they are NOT equivalent — the difference is the whole story
of this file.

  AISStream.io   global, live, free, but needs a key (instant signup).
  Digitraffic    live, free, NO KEY AT ALL, but Finnish waters and the Baltic.

Every other free AIS aggregator checked on 2026-08-05 wanted a key, an account
or both: MarineTraffic, VesselFinder, AISHub and BarentsWatch all gate the
live stream, and Kystverket's open endpoint answered 503. The US Coast Guard
publishes no live public feed at all — NOAA's Marine Cadastre AIS is
historical, months behind, and useless for a live map.

So there is no keyless GLOBAL live AIS. Rather than ship an empty toggle or
imply worldwide coverage the data cannot back, Digitraffic runs when there is
no key and the layer says which waters it is showing. A regional layer that is
honest about being regional beats a global layer that is empty.
"""
from __future__ import annotations

import asyncio
import json
import os

import httpx
import websockets
from loguru import logger

AIS_URL = "wss://stream.aisstream.io/v0/stream"

# Finnish Transport Infrastructure Agency. No key, no account, no rate limit
# published; they ask only for a User-Agent that identifies the caller.
DT_LOCATIONS = "https://meri.digitraffic.fi/api/ais/v1/locations"
DT_VESSELS = "https://meri.digitraffic.fi/api/ais/v1/vessels"
DT_POLL_SEC = 60
DT_META_EVERY = 15  # vessel names change far more slowly than positions do

# Worldwide AIS is thousands of messages a minute, so 90 s of total silence is
# not a lull -- it means nothing is coming. Two such connections and the key is
# treated as dead.
AIS_SILENCE_SEC = 90
AIS_SILENT_LIMIT = 2


async def _digitraffic_loop(state) -> None:
    """Keyless AIS, Baltic and Finnish waters.

    Positions and identities come from two different endpoints and are joined
    on MMSI: /locations carries where a vessel is, /vessels carries what it is.
    Names are fetched every fifteenth pass because a vessel's name does not
    change between minutes and the file is 400 KB.
    """
    # Announce the source so the UI's coverage note follows what is ACTUALLY
    # feeding the layer, not whether a key exists in the environment. Reaching
    # here with a key set means aisstream was tried and failed, and a label
    # that still said "worldwide" would be a lie the user cannot see through.
    state.set_meta("ships_source", {
        "name": "Digitraffic",
        "global": False,
        "note": "Baltic & Finnish waters only (keyless Digitraffic feed). "
                "A free aisstream.io key extends this worldwide.",
    })

    meta: dict[str, dict] = {}
    tick = 0
    async with httpx.AsyncClient(
        timeout=60,
        headers={"User-Agent": "graticule/1.0 (+https://github.com/dbhavery)"},
        follow_redirects=True,
    ) as client:
        while True:
            try:
                if tick % DT_META_EVERY == 0:
                    r = await client.get(DT_VESSELS)
                    r.raise_for_status()
                    meta = {str(v["mmsi"]): v for v in r.json() if v.get("mmsi")}
                tick += 1

                r = await client.get(DT_LOCATIONS)
                r.raise_for_status()
                feats = r.json().get("features") or []
                n = 0
                for f in feats:
                    coords = (f.get("geometry") or {}).get("coordinates") or []
                    if len(coords) < 2:
                        continue
                    lon, lat = coords[0], coords[1]
                    props = f.get("properties") or {}
                    mmsi = str(f.get("mmsi") or props.get("mmsi") or "")
                    if not mmsi:
                        continue
                    m = meta.get(mmsi, {})
                    state.upsert_ship(mmsi, {
                        "lat": lat,
                        "lon": lon,
                        "heading": props.get("heading"),
                        "course": props.get("cog"),
                        "speed": props.get("sog"),
                        "name": (m.get("name") or "").strip() or None,
                        "type": m.get("shipType"),
                        "destination": (m.get("destination") or "").strip() or None,
                        "source": "Digitraffic (Baltic)",
                    })
                    n += 1
                logger.info(f"AIS: {n} vessels via Digitraffic (Baltic/Finnish waters, keyless)")
            except Exception as e:  # noqa: BLE001
                logger.warning(f"AIS Digitraffic poll failed: {e}")
            await asyncio.sleep(DT_POLL_SEC)


async def aisstream_loop(state) -> None:
    api_key = os.environ.get("AISSTREAM_KEY", "").strip()
    if not api_key:
        logger.info(
            "AISSTREAM_KEY not set — falling back to Digitraffic (keyless, Baltic only). "
            "A free key at https://aisstream.io turns this into global coverage."
        )
        await _digitraffic_loop(state)
        return

    # A connection that opens and then says nothing is the failure mode that
    # actually happened: measured 2026-08-05, aisstream.io accepted the key,
    # accepted the subscription and sent not one message in 25 s, and the app
    # had shown an empty ships layer for as long as anyone had looked. The old
    # loop could not tell that apart from a quiet ocean, because `async for`
    # simply waits forever.
    #
    # So silence is now a failure with a deadline. After two silent connections
    # the loop gives up on the key and takes the keyless feed, because 1,377
    # real vessels in the Baltic beat nothing at all worldwide. It does not
    # come back: a service that is down stays down for longer than a retry
    # timer, and flapping between two sources would make the layer unreadable.
    silent_attempts = 0

    while True:
        try:
            async with websockets.connect(AIS_URL, max_size=2**22) as ws:
                await ws.send(json.dumps({
                    "APIKey": api_key,
                    "BoundingBoxes": [[[-90, -180], [90, 180]]],  # whole world
                    "FilterMessageTypes": ["PositionReport", "ShipStaticData"],
                }))
                logger.info("AIS: connected")
                state.set_meta("ships_source", {
                    "name": "AISStream", "global": True, "note": "",
                })
                got_any = False
                while True:
                    try:
                        raw = await asyncio.wait_for(ws.recv(), timeout=AIS_SILENCE_SEC)
                    except asyncio.TimeoutError:
                        break
                    got_any = True
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

                # Fell out of the receive loop: the socket went quiet.
                if got_any:
                    silent_attempts = 0
                    logger.warning(
                        f"AIS: no traffic for {AIS_SILENCE_SEC}s — reconnecting"
                    )
                else:
                    silent_attempts += 1
                    logger.warning(
                        f"AIS: aisstream accepted the key then sent nothing in "
                        f"{AIS_SILENCE_SEC}s (attempt {silent_attempts}/{AIS_SILENT_LIMIT})"
                    )
                    if silent_attempts >= AIS_SILENT_LIMIT:
                        logger.warning(
                            "AIS: giving up on aisstream and switching to Digitraffic "
                            "(keyless, Baltic only) — a live regional layer beats an "
                            "empty global one"
                        )
                        await _digitraffic_loop(state)
                        return
        except Exception as e:
            logger.warning(f"AIS connection lost: {e} — reconnecting in 10s")
            await asyncio.sleep(10)
