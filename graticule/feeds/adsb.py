"""Live aircraft from the community ADS-B network.

NO KEY REQUIRED.

This used to be OpenSky, which since 2025 wants an OAuth2 client to be usable:
the anonymous tier is ~5-10 requests a minute, so planes arrived in bursts and
sat frozen between them. Measured 2026-08-05, an anonymous OpenSky call for a
2-degree box around Kansas returned `429 Too many requests` outright.

The volunteer feeder networks publish the same ADS-B with no key, no account
and no OAuth dance. Measured the same afternoon, twelve 250 nm discs covering
the continental US, southern Canada and northern Mexico:

    adsb.fi          3,700 aircraft   11.7 s   0 rate-limited
    airplanes.live   3,269 aircraft    9.1 s   2 rate-limited
    adsb.lol         1,517 aircraft    8.5 s   7 rate-limited

They also carry more than OpenSky did. A state vector was a hex code, a
callsign and a country; these carry registration, ICAO airframe type and a
readable description, so the app can say "N628TS · Gulfstream G650" instead of
"a4b1c7". Squawk and the emergency flag come with them, which is what makes
7500/7600/7700 visible at all.

WHY A GRID: every one of these caps a query at a 250 nm radius, so continental
coverage is a set of overlapping discs, not one call. They are donated
infrastructure -- volunteers' receivers and someone's bandwidth -- so the discs
go out one at a time with a gap between them, never in parallel. Being rude to
a free service is how it stops being free.
"""
from __future__ import annotations

import asyncio
import os
import time

import httpx
from loguru import logger

TIMEOUT_SEC = 25

# Poll cadence. One sweep is 14 requests a second apart, so it costs ~14 s and
# a 30 s cycle leaves the network alone for half of every minute: 0.47 req/s
# sustained. At the 20 s cycle this was first written with, sweeps measured
# 18.8-30.2 s and the loop never stopped fetching, which is not a reasonable
# way to treat volunteers' receivers. Aircraft expire from state after 300 s,
# so a 30 s refresh is nowhere near the staleness limit.
POLL_SEC = 30
REQUEST_GAP_SEC = 1.0

# Providers in preference order, measured best first. All three speak the same
# response shape apart from the key the aircraft list hides under.
PROVIDERS = [
    ("adsb.fi",        "https://opendata.adsb.fi/api/v2/lat/{lat}/lon/{lon}/dist/{r}"),
    ("airplanes.live", "https://api.airplanes.live/v2/point/{lat}/{lon}/{r}"),
    ("adsb.lol",       "https://api.adsb.lol/v2/point/{lat}/{lon}/{r}"),
]

# 250 nm is ~463 km, so these discs overlap enough to leave no seam. Alaska and
# Hawaii are their own discs because a regular grid would spend a dozen queries
# on empty ocean to reach them.
RADIUS_NM = 250
GRID: list[tuple[float, float]] = [
    (30.0, -120.0), (30.0, -108.0), (30.0, -96.0), (30.0, -84.0),
    (38.0, -120.0), (38.0, -108.0), (38.0, -96.0), (38.0, -84.0),
    (46.0, -120.0), (46.0, -108.0), (46.0, -96.0), (46.0, -84.0),
    (61.2, -149.9),   # Anchorage
    (21.3, -157.9),   # Honolulu
]


def _aircraft(payload: dict) -> list[dict]:
    """adsb.fi calls the list `aircraft`; the other two call it `ac`."""
    for key in ("ac", "aircraft"):
        v = payload.get(key)
        if isinstance(v, list):
            return v
    return []


def _alt_ft(ac: dict) -> float | None:
    """Barometric altitude, or geometric when the transponder omits it.

    `alt_baro` is the string "ground" for an aircraft on the tarmac, which is
    not a number and must not become one -- float("ground") would raise and
    drop the aircraft entirely.
    """
    for key in ("alt_baro", "alt_geom"):
        v = ac.get(key)
        if isinstance(v, (int, float)):
            return float(v)
    return None


def _emergency(ac: dict) -> str | None:
    """Only a real emergency, never the string "none".

    The squawk is the belt-and-braces check: 7500 hijack, 7600 radio failure,
    7700 general emergency are the same declaration made a different way, and
    an aircraft can be squawking one while the emergency field lags.
    """
    v = (ac.get("emergency") or "").strip().lower()
    if v and v != "none":
        return v
    return {
        "7500": "hijack",
        "7600": "radio failure",
        "7700": "general emergency",
    }.get((ac.get("squawk") or "").strip())


def _on_ground(ac: dict) -> bool:
    """These feeds report the ground as the literal string "ground" in the
    altitude field rather than a separate boolean."""
    return ac.get("alt_baro") == "ground"


async def _sweep(client: httpx.AsyncClient, state, name: str, tpl: str) -> tuple[int, int]:
    """One full pass of the grid. Returns (positioned, rate_limited)."""
    positioned = rate_limited = 0
    for i, (lat, lon) in enumerate(GRID):
        if i:
            await asyncio.sleep(REQUEST_GAP_SEC)
        try:
            r = await client.get(tpl.format(lat=lat, lon=lon, r=RADIUS_NM))
        except Exception as e:  # noqa: BLE001
            logger.debug(f"ADS-B {name} disc {lat}/{lon} failed: {e}")
            continue
        if r.status_code == 429:
            rate_limited += 1
            continue
        if r.status_code != 200:
            logger.debug(f"ADS-B {name} disc {lat}/{lon} http {r.status_code}")
            continue
        try:
            payload = r.json()
        except Exception:  # noqa: BLE001
            continue
        for ac in _aircraft(payload):
            hexid = (ac.get("hex") or "").strip()
            lat_v, lon_v = ac.get("lat"), ac.get("lon")
            if not hexid or lat_v is None or lon_v is None:
                continue
            # Altitude in feet here, where OpenSky gave metres. The front-end
            # reads `alt` as metres, so convert rather than relabel: a silent
            # unit swap would put every aircraft three times too high.
            alt_ft = _alt_ft(ac)
            state_alt = alt_ft * 0.3048 if alt_ft is not None else None
            gs_kt = ac.get("gs")
            state.upsert_plane(hexid, {
                "callsign": (ac.get("flight") or "").strip() or None,
                "country": None,          # not carried by these feeds; see below
                "lat": lat_v,
                "lon": lon_v,
                "alt": state_alt,                                   # metres
                "heading": ac.get("track") or ac.get("dir"),
                "velocity": gs_kt * 0.514444 if isinstance(gs_kt, (int, float)) else None,
                "on_ground": _on_ground(ac),
                # New, and the reason this feed is an upgrade rather than a
                # like-for-like swap:
                "registration": (ac.get("r") or "").strip() or None,
                "type": (ac.get("t") or "").strip() or None,
                "desc": (ac.get("desc") or "").strip() or None,
                "squawk": (ac.get("squawk") or "").strip() or None,
                # These feeds send the literal string "none" for normal
                # traffic. Passed through, every aircraft in the sky would
                # carry an "Emergency: none" chip, and a field that is always
                # present is a field nobody reads -- including on the one
                # aircraft where it says "hijack".
                "emergency": _emergency(ac),
            })
            positioned += 1
    return positioned, rate_limited


async def opensky_loop(state) -> None:
    """Kept under its old name so server.py's task table does not move.

    The network behind it is no longer OpenSky. Renaming the symbol is a
    separate change to a separate file and this one is already large enough.
    """
    # Honoured only if someone deliberately sets it; nothing needs it any more.
    if os.getenv("OPENSKY_CLIENT_ID"):
        logger.info("ADS-B: OPENSKY_* is set but no longer used — the keyless feeds are better")

    order = list(PROVIDERS)
    async with httpx.AsyncClient(
        timeout=TIMEOUT_SEC,
        headers={"User-Agent": "graticule/1.0 (+https://github.com/dbhavery)"},
        follow_redirects=True,
    ) as client:
        while True:
            t0 = time.perf_counter()
            try:
                positioned = 0
                for idx, (name, tpl) in enumerate(order):
                    positioned, limited = await _sweep(client, state, name, tpl)
                    if positioned:
                        if limited:
                            logger.debug(f"ADS-B {name}: {limited}/{len(GRID)} discs rate-limited")
                        logger.info(
                            f"ADS-B: {positioned} positioned via {name}, "
                            f"{len(state.planes)} tracked, {time.perf_counter() - t0:.1f}s"
                        )
                        # Stick with whatever answered: rotating providers on a
                        # healthy feed would spread load for no gain and make
                        # every log line a different source.
                        if idx:
                            order.insert(0, order.pop(idx))
                        break
                    logger.warning(f"ADS-B {name} returned nothing; trying the next provider")
                else:
                    logger.warning("ADS-B: every provider came back empty this sweep")
            except Exception as e:  # noqa: BLE001
                logger.warning(f"ADS-B sweep failed: {e}")
            # Measure the gap from the START of the sweep, so a slow sweep does
            # not compound into an ever-later poll.
            await asyncio.sleep(max(1.0, POLL_SEC - (time.perf_counter() - t0)))
