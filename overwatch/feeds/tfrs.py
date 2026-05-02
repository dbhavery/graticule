"""FAA Temporary Flight Restrictions (TFRs) — US airspace.

Source: https://tfr.faa.gov/tfrapi/exportTfrList (FAA's own JSON aggregator,
free, no key, returns all currently-published TFRs).

Each TFR has notam_id + type + facility + state + description, but no
lat/lon — the FAA's new tfr3 SPA pulls boundary polygons from a different
endpoint we couldn't reverse-engineer cleanly. As a pragmatic v1 we plot
each TFR at its state's centroid; the description carries the actual
location text. Click a dot to see full details in the side panel.

Refresh: 15 min.
"""
from __future__ import annotations

import asyncio

import httpx
from loguru import logger

URL = "https://tfr.faa.gov/tfrapi/exportTfrList"
POLL_SEC = 900
TIMEOUT_SEC = 30

# Approximate state centroids (US 50 + DC + territories). Good enough for
# distinguishing where a TFR lives at globe scale.
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


async def tfr_loop(state) -> None:
    headers = {
        "User-Agent": "overwatch/0.1 (research; contact dbhavery@gmail.com)",
        "Accept": "application/json",
    }
    async with httpx.AsyncClient(timeout=TIMEOUT_SEC, headers=headers, follow_redirects=True) as client:
        while True:
            try:
                r = await client.get(URL)
                r.raise_for_status()
                data = r.json()
                if not isinstance(data, list):
                    raise ValueError(f"unexpected payload shape: {type(data).__name__}")
                entries: dict[str, dict] = {}
                for tfr in data:
                    notam_id = (tfr.get("notam_id") or "").strip()
                    if not notam_id:
                        continue
                    state_code = (tfr.get("state") or "").strip().upper()
                    coords = STATE_CENTROIDS.get(state_code)
                    if not coords:
                        continue  # unknown / non-state location
                    lat, lon = coords
                    entries[notam_id] = {
                        "lat": lat,
                        "lon": lon,
                        "name": notam_id,
                        "type": tfr.get("type"),
                        "facility": tfr.get("facility"),
                        "state": state_code,
                        "description": tfr.get("description"),
                        "created": tfr.get("creation_date"),
                    }
                state.replace_layer("tfrs", entries)
                logger.info(f"FAA TFRs: {len(entries)} active (state-centroid plotted)")
            except httpx.HTTPStatusError as e:
                logger.warning(f"FAA TFR http {e.response.status_code} — backing off 1h")
                await asyncio.sleep(3600)
                continue
            except Exception as e:
                logger.warning(f"FAA TFR poll failed: {e!r}")
            await asyncio.sleep(POLL_SEC)
