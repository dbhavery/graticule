"""Slim the Natural Earth reference-line GeoJSON.

The boundary layers ship at full 10m fidelity with raw float64 repr: 13.1 MB of
state borders and 4.1 MB of country borders, 395,238 coordinates between them,
for lines drawn one pixel wide. Measured in-page, building the entities costs
242 ms; fetching them costs 1.7 s on localhost, and the ground-polyline compile
that follows stalled the main thread for 5-9 s at boot. That is the whole
reason the reference lines could not be defaulted on, which in turn is why
radar drew over an unlabelled globe.

Two lossless-at-render reductions:
  * Douglas-Peucker at 0.002 degrees. 220 m at the equator -- sub-pixel until
    the camera is below roughly 200 km, and these layers already stop drawing
    at 8 Mm.
  * Coordinates rounded to 5 decimals. 1.1 m, well under the source data's own
    accuracy, and it is where most of the bytes are: 40.9 bytes per coordinate
    before, because float64 repr writes 15 significant digits.

Run from the repo root:  py -V:3.13 scripts/slim_boundaries.py
Writes <name>.geojson in place after saving <name>.full.geojson beside it.
"""
from __future__ import annotations

import json
import shutil
from pathlib import Path

DATA = Path(__file__).resolve().parents[1] / "web" / "data"
FILES = ["ne_country_borders", "ne_state_borders"]
TOLERANCE = 0.002   # degrees
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
