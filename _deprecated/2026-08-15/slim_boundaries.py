"""Slim the Natural Earth reference-line GeoJSON.

The boundary layers ship at full 10m fidelity with raw float64 repr: 13.1 MB of
state borders and 4.1 MB of country borders, 395,238 coordinates between them,
for lines drawn one pixel wide. Measured in-page, building the entities costs
242 ms; fetching them costs 1.7 s on localhost, and the ground-polyline compile
that follows stalled the main thread for 5-9 s at boot. That is the whole
reason the reference lines could not be defaulted on, which in turn is why
radar drew over an unlabelled globe.

One reduction, not two. Coordinates are rounded to 5 decimals: 1.1 m, well
under the source data's own accuracy, and it is where nearly all of the bytes
were -- 40.9 bytes per coordinate before, because float64 repr writes 15
significant digits.

---- The Douglas-Peucker pass is gone, and it should never have been here ----

It ran at 0.002 degrees and the docstring justified that as "sub-pixel until
the camera is below roughly 200 km". True, and irrelevant: people zoom in.
Below 200 km it is not sub-pixel, and at city zoom a 223 m displacement is tens
of pixels of border sitting in the wrong place. Don reported exactly that.

What made it a bad trade was never measured until now:

    tolerance   max error   country verts   state verts   total MB
      0.002        223 m       74.4%          82.6%          6.8
      0.0                       100%           100%          8.3

The whole pass was buying 1.5 MB and charging 223 m of accuracy for it, on a
map whose entire job is showing you where things are. Those megabytes are also
bundled inside the APK now, where they are paid once at install rather than on
every load.

The real cost was never the vertex count anyway: it was `clampToGround: true`
on 13,098 polylines, which compiled ground geometry against live terrain tiles
and cost 10x the frame rate. That is fixed at the source, and terrain is now
gated by altitude, so vertices are cheap again.

Run from the repo root:  py -V:3.13 scripts/slim_boundaries.py
Writes <name>.geojson in place after saving <name>.full.geojson beside it.
"""
from __future__ import annotations

import json
import shutil
from pathlib import Path

DATA = Path(__file__).resolve().parents[1] / "web" / "data"
FILES = ["ne_country_borders", "ne_state_borders"]
# 0 disables the simplify pass entirely. Kept as a knob rather than deleted,
# because the measurement above is what justifies the value and a future
# payload problem should have to re-argue it against these numbers.
TOLERANCE = 0.0   # degrees; see the note above before raising this
DECIMALS = 5


def _perp2(pt, a, b):
    """Squared perpendicular distance from pt to the segment a-b, in degrees."""
    (x, y), (x1, y1), (x2, y2) = pt, a, b
    dx, dy = x2 - x1, y2 - y1
    if dx == 0 and dy == 0:
        return (x - x1) ** 2 + (y - y1) ** 2
    t = ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)
    t = max(0.0, min(1.0, t))
    px, py = x1 + t * dx, y1 + t * dy
    return (x - px) ** 2 + (y - py) ** 2


def simplify(points, tol):
    """Iterative Douglas-Peucker. Iterative rather than recursive because some
    of these lines run tens of thousands of points and Python's stack is not
    that deep."""
    if len(points) < 3:
        return points
    # tol 0 means "keep every vertex". Falling through would still drop points
    # that are EXACTLY collinear, and on data that is mostly meridians and
    # parallels -- which is most of the western United States -- that is a
    # large and silent fraction.
    if tol <= 0:
        return points
    tol2 = tol * tol
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        lo, hi = stack.pop()
        if hi - lo < 2:
            continue
        worst, worst_i = -1.0, -1
        a, b = points[lo], points[hi]
        for i in range(lo + 1, hi):
            d = _perp2(points[i], a, b)
            if d > worst:
                worst, worst_i = d, i
        if worst > tol2:
            keep[worst_i] = True
            stack.append((lo, worst_i))
            stack.append((worst_i, hi))
    return [p for p, k in zip(points, keep) if k]


def main() -> None:
    for name in FILES:
        src = DATA / f"{name}.geojson"
        full = DATA / f"{name}.full.geojson"
        if not src.exists():
            print(f"skip {name}: not found")
            continue
        if not full.exists():
            shutil.copy2(src, full)

        before_bytes = full.stat().st_size
        doc = json.loads(full.read_text(encoding="utf-8"))
        feats = doc.get("features", [])
        before_pts = after_pts = 0
        out = []
        for f in feats:
            geom = f.get("geometry") or {}
            coords = geom.get("coordinates") or []
            before_pts += len(coords)
            pts = [(float(c[0]), float(c[1])) for c in coords
                   if isinstance(c, (list, tuple)) and len(c) >= 2]
            pts = simplify(pts, TOLERANCE)
            if len(pts) < 2:
                continue
            geom["coordinates"] = [[round(x, DECIMALS), round(y, DECIMALS)] for x, y in pts]
            after_pts += len(pts)
            out.append(f)
        doc["features"] = out

        src.write_text(json.dumps(doc, separators=(",", ":")), encoding="utf-8")
        after_bytes = src.stat().st_size
        print(f"{name}: {before_bytes/1e6:.1f} MB -> {after_bytes/1e6:.1f} MB "
              f"({after_bytes/before_bytes:.0%}), "
              f"{before_pts:,} -> {after_pts:,} points, "
              f"{len(feats):,} -> {len(out):,} features")


if __name__ == "__main__":
    main()
