"""Build the county lookup the alert ranker uses, from data already in the repo.

WHY THIS FILE EXISTS
--------------------
371 NWS alerts were live when this was measured and only 28 of them carried a
polygon. The other 343 are issued against forecast zones and name their area
only as a code: `geocode.SAME = ["008081"]`, which is a zero-prefixed county
FIPS -- 08081, Moffat County, Colorado. Without a FIPS table, 92% of the alerts
in the country have no position at all and cannot be ranked by distance.

`web/data/ne_counties.json` already holds every county with its FIPS, centroid,
bounding box and full ring, but it is 2.8 MB because of the rings. That file is
lazily loaded on a desktop for the county drawing tool. Pulling it down on a
phone to decide whether a warning is near you would cost more than the radar.

So this strips it to the three things the ranker needs and nothing else.

BBOX, NOT CENTROID, and this is the whole point
-----------------------------------------------
Distance to a zone alert is measured to the county's BOUNDING BOX, not to its
centroid. A bbox strictly contains its county, so "inside the bbox" is a
superset of "inside the county": it can include you when you are just outside,
and it can never exclude you when you are inside. For a warning system that is
the correct direction to be wrong in. Measuring to the centroid would put a
tornado warning for the county you are standing in at 40 km away in somewhere
like Elko or San Bernardino, and a 30 km radius would drop it.

The centroid is kept anyway, but only to fly the camera somewhere sensible and
to print a distance for something that is genuinely far off.

    py -V:3.13 scripts/build_county_index.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "web" / "data" / "ne_counties.json"
PLACES_SRC = ROOT / "web" / "data" / "ne_populated_places.geojson"
OUT = ROOT / "web" / "data" / "area_index.json"


def coerce(raw):
    """The source stores coordinate lists as JSON *strings*, not arrays."""
    if isinstance(raw, str):
        return json.loads(raw)
    return raw


def main() -> int:
    if not SRC.exists():
        print(f"missing {SRC}", file=sys.stderr)
        return 1

    doc = json.loads(SRC.read_text(encoding="utf-8"))
    rows = doc.get("counties") or doc.get("features") or []
    if not rows:
        print("source held no counties", file=sys.stderr)
        return 1

    out = {}
    skipped = []
    for r in rows:
        fips = str(r.get("f") or "").strip()
        if not fips:
            skipped.append(r.get("n"))
            continue
        # NWS SAME codes are six characters and every FIPS here must be five,
        # or the `same.slice(1)` join in app.js silently matches nothing.
        fips = fips.zfill(5)
        try:
            cx, cy = coerce(r.get("c"))
            w, s, e, n = coerce(r.get("b"))
        except Exception:
            skipped.append(r.get("n"))
            continue
        out[fips] = [
            round(float(cx), 4), round(float(cy), 4),      # centroid lon, lat
            round(float(w), 4), round(float(s), 4),        # bbox w, s
            round(float(e), 4), round(float(n), 4),        # bbox e, n
            r.get("n") or "",                              # name
            r.get("s") or "",                              # state
        ]

    if len(out) < 3000:
        print(f"only {len(out)} counties resolved; expected ~3200",
              file=sys.stderr)
        return 1

    places = build_places()

    payload = {
        "note": "counties: fips -> [clon, clat, w, s, e, n, name, state]. "
                "places: [lon, lat, name, region]. "
                "Built by scripts/build_county_index.py.",
        "count": len(out),
        "counties": out,
        "places": places,
    }
    OUT.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")

    src_mb = (SRC.stat().st_size + PLACES_SRC.stat().st_size) / 1e6
    out_kb = OUT.stat().st_size / 1e3
    print(f"{len(out)} counties + {len(places)} places  "
          f"{src_mb:.1f} MB -> {out_kb:.0f} KB  {OUT}")
    if skipped:
        print(f"skipped {len(skipped)}: {skipped[:6]}")
    return 0


def build_places():
    """Nearest populated place, for naming the spot the user is standing on.

    The county table cannot do this job. Asked which county contains Vancouver
    WA, a bounding-box lookup answered "Multnomah, OR" -- Portland's box
    reaches north across the Columbia and its centroid is nearer than Clark
    County's. That is the same superset property that makes bboxes right for
    "might this alert reach me" and wrong for "what is this place called".

    Nearest city has no such failure: it is an exact computation and the answer
    is the word a person actually uses for where they are.

    Coordinates keep three decimals, about 110 m, which is far finer than the
    question "what is the nearest town" can even mean.
    """
    if not PLACES_SRC.exists():
        print(f"no places source at {PLACES_SRC}; labels will fall back to "
              f"coordinates", file=sys.stderr)
        return []
    doc = json.loads(PLACES_SRC.read_text(encoding="utf-8"))
    rows = []
    for f in doc.get("features", []):
        p = f.get("properties") or {}
        name = (p.get("name") or "").strip()
        if not name:
            continue
        try:
            lon, lat = f["geometry"]["coordinates"][:2]
        except Exception:
            continue
        # State inside the US and Canada, country everywhere else: "Vancouver,
        # Washington" and "Vancouver, British Columbia" are both unambiguous,
        # and "Lyon, France" is more use than "Lyon, Auvergne".
        country = (p.get("country") or "").strip()
        state = (p.get("state") or "").strip()
        region = state if (state and country in
                           ("United States of America", "Canada")) else country
        rows.append([round(float(lon), 3), round(float(lat), 3), name, region])
    return rows


if __name__ == "__main__":
    raise SystemExit(main())
