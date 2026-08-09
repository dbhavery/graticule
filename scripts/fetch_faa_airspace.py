"""Rebuild web/data/airspace.json from the FAA, replacing the OpenAIP extract.

WHY THIS EXISTS

The shipped `web/data/airspace.json` was an OpenAIP extract: 21.7 MB of it, in
the APK, credited nowhere. OpenAIP is CC BY-NC-SA 4.0, so that was two
problems at once. The attribution term was broken every day the app ran, and
NonCommercial is a live question the moment the thing is on a store listing.
The app's own code said `OpenAIP icaoClass` in a comment.

The FAA publishes the same airspace as a work of the United States government
under 17 U.S.C. 101: not protected by US copyright, no attribution term, no
share-alike. It is also the authority the app already defers to for alerts,
METAR and TFRs, so this is the better source and not a licence dodge.

WHAT IS DROPPED, AND WHY

The full layer is 6,061 features and about 136 MB. 4,343 of those are Class E,
and the bulk is `CLASS_E5`, the en-route blanket that covers most of the
country from 1,200 ft AGL. Drawn as a translucent polygon on a weather map it
is a wash over the whole screen that tells you nothing.

Kept: A, B, C, D, G, and the Class E SURFACE areas and extensions (E2, E3, E4),
which are the compact rings around airports that a chart actually shows.
That is 2,362 features.

THE SIMPLIFICATION, MEASURED

FAA arcs come back as dense point sequences: 852 vertices per polygon. The
service ignores `maxAllowableOffset`, so Douglas-Peucker runs here. Measured
over the first 250 polygons:

    tolerance      vertices      size        worst deviation
    none            213,046      46 MB       0 m
    0.0002 deg       15,035 (7%)  3.4 MB     ~22 m      <- shipped
    0.0005 deg       10,114 (5%)  2.3 MB     ~56 m
    0.001 deg         7,249 (3%)  1.7 MB     ~111 m

So 22 m of worst-case error buys 18.3 MB against the file it replaces.

This is NOT the border decimation Don rejected. That one charged 223 m of
error for 1.5 MB on lines drawn at every altitude. This is a tenth of the error
for twelve times the saving, on a layer that only draws below 800 km, where a
phone pixel is about 2.2 km at the top of its range and still ~140 m at 50 km
altitude. 22 m is sub-pixel everywhere it is ever seen.

It is not navigation data and the app says so. The FAA asks that derived
extracts not be presented as official source material; charts and the NASR
subscription are the authoritative products.

    py -V:3.13 scripts/fetch_faa_airspace.py
    py -V:3.13 scripts/fetch_faa_airspace.py --dry-run
"""
from __future__ import annotations

import argparse
import json
import math
import pathlib
import sys
import time
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "web" / "data" / "airspace.json"

# The FAA's own ArcGIS organisation. Confirmed by listing the org's services,
# not by pasting a URL from a search result.
SERVICE = ("https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/"
           "services/Class_Airspace/FeatureServer/0/query")

# The layer advertises maxRecordCount 2000, but 2000 features WITH geometry is
# a 504 and 500 takes 75 s. 250 answers in about 5.
PAGE = 250

WHERE = "CLASS<>'E' OR LOCAL_TYPE IN ('CLASS_E2','CLASS_E3','CLASS_E4')"

SIMPLIFY_DEG = 0.0002     # ~22 m worst case. See the table above.
COORD_DP = 6              # ~0.1 m. Rounding, not decimation.
DEG_TO_M = 111_320.0      # near the equator; over-states error away from it

FIELDS = ",".join([
    "NAME", "CLASS", "LOCAL_TYPE", "TYPE_CODE",
    "UPPER_VAL", "UPPER_UOM", "UPPER_CODE", "UPPER_DESC",
    "LOWER_VAL", "LOWER_UOM", "LOWER_CODE", "LOWER_DESC",
    "WKHR_CODE", "WKHR_RMK", "CITY", "STATE",
])


def fetch_page(offset: int) -> dict:
    q = urllib.parse.urlencode({
        "where": WHERE,
        "outFields": FIELDS,
        "outSR": "4326",
        "f": "geojson",
        "resultOffset": offset,
        "resultRecordCount": PAGE,
    })
    req = urllib.request.Request(f"{SERVICE}?{q}",
                                 headers={"User-Agent": "graticule/1.0"})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=180) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as e:                       # 504s happen under load
            if attempt == 3:
                raise
            print(f"    retry {attempt + 1} after {type(e).__name__}: {e}")
            time.sleep(4 * (attempt + 1))
    raise RuntimeError("unreachable")


def perp(p, a, b) -> float:
    """Point-to-segment distance, in degrees."""
    x0, y0 = p[0], p[1]
    x1, y1 = a[0], a[1]
    x2, y2 = b[0], b[1]
    dx, dy = x2 - x1, y2 - y1
    if dx == 0 and dy == 0:
        return math.hypot(x0 - x1, y0 - y1)
    t = max(0.0, min(1.0, ((x0 - x1) * dx + (y0 - y1) * dy) / (dx * dx + dy * dy)))
    return math.hypot(x0 - (x1 + t * dx), y0 - (y1 + t * dy))


def simplify(pts, tol):
    """Douglas-Peucker, iterative so a 4,000-vertex ring cannot blow the stack."""
    if len(pts) < 3:
        return pts[:]
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        i, j = stack.pop()
        if j <= i + 1:
            continue
        dmax, idx = 0.0, i
        for k in range(i + 1, j):
            d = perp(pts[k], pts[i], pts[j])
            if d > dmax:
                dmax, idx = d, k
        if dmax > tol:
            keep[idx] = True
            stack.append((i, idx))
            stack.append((idx, j))
    return [p for p, k in zip(pts, keep) if k]


def worst_deviation(orig, simp) -> float:
    """Farthest an original vertex sits from the simplified ring, in metres."""
    worst = 0.0
    segs = list(zip(simp, simp[1:]))
    if not segs:
        return 0.0
    for p in orig:
        best = min(perp(p, a, b) for a, b in segs)
        if best > worst:
            worst = best
    return worst * DEG_TO_M


def limit(val, uom, code, desc) -> dict | None:
    if val is None and not desc:
        return None
    return {
        "value": None if val is None else int(val),
        "unit": (uom or "FT").strip().upper(),
        # SFC / MSL / AGL. The label is kept because "SFC" and "0 FT MSL" are
        # not the same claim.
        "datum": (code or "").strip().upper() or None,
        "label": (desc or "").strip() or None,
    }


def rings_of(geom: dict):
    """Every outer ring, as its own polygon.

    The app draws one PolygonHierarchy per record, so a MultiPolygon has to
    become several records or all but the first vanish silently. A missing
    Class B shelf looks exactly like a Class B that was never there.
    """
    if not geom:
        return
    t = geom.get("type")
    if t == "Polygon" and geom.get("coordinates"):
        yield geom["coordinates"][0]
    elif t == "MultiPolygon":
        for poly in geom.get("coordinates") or []:
            if poly:
                yield poly[0]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(OUT))
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    records = []
    offset = pages = multi = 0
    classes: dict[str, int] = {}
    verts_in = verts_out = 0
    worst = 0.0

    while True:
        page = fetch_page(offset)
        feats = page.get("features") or []
        pages += 1
        print(f"  page {pages:>3}  offset {offset:>6}  {len(feats)} features")

        for f in feats:
            props = f.get("properties") or {}
            cls = (props.get("CLASS") or "").strip().upper() or "?"
            ringlist = list(rings_of(f.get("geometry") or {}))
            if len(ringlist) > 1:
                multi += 1
            for ring in ringlist:
                pts = [[p[0], p[1]] for p in ring
                       if isinstance(p, (list, tuple)) and len(p) >= 2
                       and isinstance(p[0], (int, float))
                       and isinstance(p[1], (int, float))]
                if len(pts) < 3:
                    continue
                simp = simplify(pts, SIMPLIFY_DEG)
                if len(simp) < 3:
                    continue
                verts_in += len(pts)
                verts_out += len(simp)
                # Sampled rather than exhaustive: this is O(n*m) and the point
                # is to catch a tolerance mistake, not to certify every ring.
                if pages <= 2:
                    worst = max(worst, worst_deviation(pts, simp))
                coords = [[round(x, COORD_DP), round(y, COORD_DP)] for x, y in simp]
                records.append({
                    "name": (props.get("NAME") or "").strip(),
                    "class": cls,
                    "type": (props.get("LOCAL_TYPE") or props.get("TYPE_CODE")
                             or "").strip(),
                    "upper": limit(props.get("UPPER_VAL"), props.get("UPPER_UOM"),
                                   props.get("UPPER_CODE"), props.get("UPPER_DESC")),
                    "lower": limit(props.get("LOWER_VAL"), props.get("LOWER_UOM"),
                                   props.get("LOWER_CODE"), props.get("LOWER_DESC")),
                    "hours": (props.get("WKHR_RMK") or props.get("WKHR_CODE")
                              or "").strip() or None,
                    "city": (props.get("CITY") or "").strip() or None,
                    "state": (props.get("STATE") or "").strip() or None,
                    "geometry": {"type": "Polygon", "coordinates": [coords]},
                })
                classes[cls] = classes.get(cls, 0) + 1

        # NOTE: exceededTransferLimit lives under `properties` on this service,
        # not at the top level. Reading it from the top level returns None, the
        # loop stops after one page, and you ship 250 of 2,362 polygons with
        # nothing to tell you.
        more = (page.get("properties") or {}).get("exceededTransferLimit") \
            or page.get("exceededTransferLimit")
        if not more or not feats:
            break
        offset += len(feats)
        time.sleep(0.4)          # the FAA is a public service, not a target

    if not records:
        sys.exit("no records fetched -- refusing to write an empty airspace file")

    print(f"\n  {len(records)} polygons from {pages} pages")
    print(f"  {multi} features were MultiPolygon and became several records")
    print(f"  vertices {verts_in} -> {verts_out} "
          f"({verts_out / max(1, verts_in) * 100:.1f}%)")
    print(f"  worst sampled deviation ~{worst:.0f} m (tolerance {SIMPLIFY_DEG} deg)")
    for k in sorted(classes):
        print(f"    class {k:<3} {classes[k]:>6}")

    if worst > 60:
        sys.exit(f"simplification error {worst:.0f} m is larger than the "
                 f"~22 m this tolerance was chosen for -- refusing to write")

    if args.dry_run:
        print("\n  --dry-run: nothing written")
        return

    dest = pathlib.Path(args.out)
    blob = json.dumps(records, separators=(",", ":"))
    dest.write_text(blob, encoding="utf-8")
    print(f"\n  wrote {dest}  ({len(blob) / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
