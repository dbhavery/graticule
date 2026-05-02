"""Celestrak TLE feed — pushes Two-Line Element sets to the front-end where
satellite-js propagates positions every second. No backend math.

Groups fetched (curated for visual interest, totals ~1500 sats):
  - stations  (ISS, CSS/Tiangong, etc.)
  - geo      (geostationary)
  - gps-ops  (GPS constellation)
  - galileo  (EU GNSS)
  - starlink (subset; the full set is ~6000 — too many)
  - science  (Hubble, Chandra, JWST handled via 'visual' group also)
  - visual   (~150 brightest sats — guaranteed cool)

Refresh: 6h. Celestrak rate-limits aggressive clients; this is well under.
"""
from __future__ import annotations

import asyncio

import httpx
from loguru import logger

# (group_id, label, color, max_count) — Starlink is capped because the full
# constellation is ~10K and would choke the browser at 1 Hz propagation.
GROUPS = [
    ("stations", "Stations",       "#ffd14a", None),
    ("visual",   "Brightest",      "#ffeb99", None),
    ("geo",      "Geostationary",  "#a78bfa", None),
    ("gps-ops",  "GPS",            "#34d399", None),
    ("galileo",  "Galileo",        "#60a5fa", None),
    ("science",  "Science",        "#fbbf24", None),
    ("starlink", "Starlink",       "#f472b6", 500),
]
URL = "https://celestrak.org/NORAD/elements/gp.php"
REFRESH_SEC = 6 * 3600
TIMEOUT_SEC = 30


async def celestrak_loop(state) -> None:
    async with httpx.AsyncClient(timeout=TIMEOUT_SEC, headers={"User-Agent": "cupola/0.1"}) as client:
        while True:
            entries: dict[str, dict] = {}
            for group_id, label, color, max_count in GROUPS:
                try:
                    r = await client.get(URL, params={"GROUP": group_id, "FORMAT": "tle"})
                    r.raise_for_status()
                    parsed = _parse_tle(r.text)
                    if max_count is not None:
                        parsed = parsed[:max_count]
                    for name, l1, l2 in parsed:
                        # NORAD catalog id lives in cols 3-7 of line 1 (1-indexed)
                        try:
                            norad = int(l1[2:7].strip())
                        except ValueError:
                            continue
                        sat_id = str(norad)
                        # First group wins (preserves "stations"/"visual" tags over generic groups)
                        if sat_id in entries:
                            continue
                        entries[sat_id] = {
                            "name": name,
                            "tle1": l1,
                            "tle2": l2,
                            "group": group_id,
                            "group_label": label,
                            "color": color,
                        }
                    logger.info(f"Celestrak {group_id}: {len(parsed)} TLEs")
                except Exception as e:
                    logger.warning(f"Celestrak {group_id} failed: {e}")
                await asyncio.sleep(2)  # be polite between groups
            if entries:
                state.replace_layer("satellites", entries)
                logger.info(f"Celestrak: {len(entries)} unique satellites tracked")
            await asyncio.sleep(REFRESH_SEC)


def _parse_tle(text: str) -> list[tuple[str, str, str]]:
    lines = [ln.rstrip() for ln in text.splitlines() if ln.strip()]
    out: list[tuple[str, str, str]] = []
    i = 0
    while i + 2 < len(lines):
        name = lines[i].strip()
        l1 = lines[i + 1]
        l2 = lines[i + 2]
        if l1.startswith("1 ") and l2.startswith("2 "):
            out.append((name, l1, l2))
            i += 3
        else:
            i += 1
    return out
