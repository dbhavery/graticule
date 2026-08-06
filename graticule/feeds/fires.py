"""NASA FIRMS active fire detections — global, VIIRS NOAA-20.

NO KEY REQUIRED.

FIRMS publishes the same detections two ways. The `/api/area/csv/{MAP_KEY}/...`
endpoint needs a free MAP_KEY and a signup; the `/data/active_fire/.../csv/`
archive is a plain static file with no key, no referrer check and no account.
This module reads the archive, and only uses the keyed API when a MAP_KEY
happens to be present (it lands a little sooner after each satellite pass).

Measured 2026-08-05, the two side by side:

    keyed   api/area/csv/.../world/3       179,107 rows   15.0 MB   1877 ms
    keyless data/.../J1_..._Global_24h.csv 174,637 rows   14.6 MB    807 ms

so dropping the key costs nothing in coverage and is twice as fast.

THE TWO FILES DO NOT SHARE A SCHEMA. The archive has 13 columns to the API's
14, and `confidence` is spelled out (`low`/`nominal`/`high`) where the API uses
single letters (`l`/`n`/`h`). A parser written against one silently mislabels
the other, so both go through _normalize and the front-end sees one shape. The
full words are what the detail panel shows, so those win.
"""
from __future__ import annotations

import asyncio
import csv
import io
import os

import httpx
from loguru import logger

POLL_SEC = 1800  # 30 min — FIRMS refreshes on satellite passes, ~3h apart
TIMEOUT_SEC = 120  # a 15 MB CSV on a slow line

ARCHIVE = "https://firms.modaps.eosdis.nasa.gov/data/active_fire"

# NOAA-20 first: newest bird, 375 m, best of the VIIRS series. Suomi-NPP is the
# same instrument on an older platform and covers for an outage rather than
# adding anything, so it is a fallback and not a second fetch.
KEYLESS_SOURCES = [
    ("NOAA-20", f"{ARCHIVE}/noaa-20-viirs-c2/csv/J1_VIIRS_C2_Global_24h.csv"),
    ("Suomi-NPP", f"{ARCHIVE}/suomi-npp-viirs-c2/csv/SUOMI_VIIRS_C2_Global_24h.csv"),
]

# The archive already spells these out; the keyed API does not.
_CONFIDENCE = {"l": "low", "n": "nominal", "h": "high"}


def _f(v) -> float | None:
    if v is None or v == "":
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _normalize(text: str) -> dict[str, dict]:
    """CSV text (either schema) -> the entity dict the front-end expects."""
    entries: dict[str, dict] = {}
    for row in csv.DictReader(io.StringIO(text)):
        try:
            lat = float(row["latitude"])
            lon = float(row["longitude"])
        except (KeyError, ValueError):
            continue
        conf = (row.get("confidence") or "").strip()
        # A row is keyed by where and when it was seen. FIRMS ships no stable
        # per-detection id, and two passes of the same fire are two detections,
        # so this is the identity: same pixel, same second, same detection.
        fid = f"{row.get('acq_date', '?')}T{row.get('acq_time', '?')}_{lat:.4f}_{lon:.4f}"
        entries[fid] = {
            "lat": lat,
            "lon": lon,
            "brightness": _f(row.get("bright_ti4")),
            "frp": _f(row.get("frp")),  # fire radiative power, MW
            "confidence": _CONFIDENCE.get(conf.lower(), conf) or None,
            "daynight": row.get("daynight"),
            "satellite": row.get("satellite"),
            "acq_date": row.get("acq_date"),
            "acq_time": row.get("acq_time"),
        }
    return entries


async def _fetch_keyless(client: httpx.AsyncClient) -> tuple[str, dict[str, dict]]:
    last: Exception | None = None
    for name, url in KEYLESS_SOURCES:
        try:
            r = await client.get(url)
            r.raise_for_status()
            entries = _normalize(r.text)
            if entries:
                return name, entries
            logger.warning(f"FIRMS {name}: parsed 0 rows, trying the next source")
        except Exception as e:  # noqa: BLE001
            last = e
            logger.warning(f"FIRMS {name} failed ({e}); trying the next source")
    if last:
        raise last
    raise RuntimeError("FIRMS: every keyless source returned an empty file")


async def firms_loop(state) -> None:
    map_key = os.environ.get("FIRMS_MAP_KEY", "").strip()
    keyed_url = (
        f"https://firms.modaps.eosdis.nasa.gov/api/area/csv/{map_key}"
        "/VIIRS_NOAA20_NRT/world/3"
    ) if map_key else None

    if keyed_url:
        logger.info("FIRMS: MAP_KEY present, using the NRT API (keyless archive is the fallback)")
    else:
        logger.info("FIRMS: no key needed, reading the public archive")

    async with httpx.AsyncClient(
        timeout=TIMEOUT_SEC,
        headers={"User-Agent": "graticule/1.0"},
        follow_redirects=True,
    ) as client:
        while True:
            try:
                entries: dict[str, dict] = {}
                source = ""
                if keyed_url:
                    try:
                        r = await client.get(keyed_url)
                        r.raise_for_status()
                        entries = _normalize(r.text)
                        source = "NRT API"
                    except Exception as e:  # noqa: BLE001
                        # A dead or throttled key must not take the layer down
                        # when the same data sits behind no key at all.
                        logger.warning(f"FIRMS keyed API failed ({e}); falling back to the archive")
                if not entries:
                    source, entries = await _fetch_keyless(client)
                state.replace_layer("fires", entries)
                logger.info(f"FIRMS: {len(entries)} fire detections via {source}")
            except Exception as e:  # noqa: BLE001
                logger.warning(f"FIRMS poll failed: {e}")
            await asyncio.sleep(POLL_SEC)
