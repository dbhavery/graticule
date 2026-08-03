"""Convert Natural Earth admin-2 counties -> a compact county polygon file.

Input (repo root, gitignored):
  ne_10m_admin_2_counties.zip   3,224 US counties

Output (web/data/, gitignored):
  ne_counties.json

The output is deliberately NOT GeoJSON. GeoJSON's per-point [lon, lat] pairs
cost two brackets and a comma per vertex, and at 3,223 polygons that framing is
most of the file. Flat interleaved arrays with short keys cut it roughly in
half for identical geometry.

Shape:
  {"count": 3223,
   "counties": [
     {"n": "Whatcom", "s": "WA", "f": "53073", "t": "County",
      "a": 5484,                      # area km^2
      "c": [-121.7092, 48.8178],      # cartographer label point
      "b": [w, s, e, n],              # bbox, for the click hit-test prefilter
      "r": [[lon, lat, lon, lat, ...]]}   # rings, largest first
   ]}

★ Geometry is NOT simplified, and that is the point.

The app punches the selected counties out of a darkening mask as polygon
holes, and a selection is normally a contiguous block. Two adjacent counties
carry the same border vertices in opposite order, so their holes only meet if
both keep exactly the same vertices along that border. Any per-ring
simplifier breaks that: Douglas-Peucker's keep-set depends on the whole ring,
and A's ring is not B's ring, so a lit crack opens along every shared border.

A symmetric decimator (keep a vertex when its distance from the segment
joining its immediate neighbours clears a tolerance) does mostly hold the
property, and was measured at 554 split seams against 21,032 for uniform
sampling. But the reason to drop it is arithmetic, not algorithmic: Natural
Earth has ALREADY generalized this layer for 10m scale. The whole file is
144,029 vertices, 45 per county. Simplifying at 440 m bought 1.2 MB, and 1.2 MB
is not worth a class of rendering bug.

Run:
  uv run python scripts/build_counties.py
  uv run python scripts/build_counties.py --verify
"""
from __future__ import annotations

import io
import json
import zipfile
from pathlib import Path

import shapefile

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "web" / "data"
OUT.mkdir(parents=True, exist_ok=True)

# Rings below this are barrier islands and harbour rocks. They cost vertices,
# they are never the thing a user clicks, and as darkening holes they punch
# specks of brightness into the mask. Islands are not shared with a neighbour's
# mainland ring, so dropping them cannot open a seam.
MIN_RING_AREA_SQDEG = 0.0004
MAX_RINGS = 4
# 4 decimals ~= 11 m. Below the width of the border line drawn over it, and
# rounding is a pure per-vertex function so shared vertices stay identical.
PRECISION = 4


def _open(zip_path: Path) -> shapefile.Reader:
    with zipfile.ZipFile(zip_path) as z:
        sname = next(n for n in z.namelist() if n.endswith(".shp"))
        base = sname.rsplit(".", 1)[0]
        return shapefile.Reader(
            shp=io.BytesIO(z.read(base + ".shp")),
            shx=io.BytesIO(z.read(base + ".shx")),
            dbf=io.BytesIO(z.read(base + ".dbf")),
        )


def _ring_area(pts: list) -> float:
    """Unsigned shoelace area in square degrees. Only ever compared against a
    fixed threshold and other rings of the same county, so the lack of a
    cos(lat) term is fine."""
    s = 0.0
    n = len(pts)
    for i in range(n):
        x1, y1 = pts[i]
        x2, y2 = pts[(i + 1) % n]
        s += x1 * y2 - x2 * y1
    return abs(s) / 2.0


def _rings(shape) -> list[list]:
    """Closed rings, rounded, largest first, tiny ones dropped.

    The shapefile repeats a ring's first point as its last; that duplicate is
    stripped here because the client closes rings itself and a repeated vertex
    miscounts point-in-polygon crossings.
    """
    parts = list(shape.parts) + [len(shape.points)]
    rings = []
    for i in range(len(parts) - 1):
        pts = [(round(lon, PRECISION), round(lat, PRECISION))
               for lon, lat in shape.points[parts[i]:parts[i + 1]]]
        if len(pts) >= 2 and pts[0] == pts[-1]:
            pts = pts[:-1]
        if len(pts) < 3:
            continue
        area = _ring_area(pts)
        if area < MIN_RING_AREA_SQDEG:
            continue
        rings.append((area, pts))
    rings.sort(key=lambda r: -r[0])
    return [r[1] for r in rings[:MAX_RINGS]]


def build() -> dict:
    r = _open(ROOT / "ne_10m_admin_2_counties.zip")
    out, skipped = [], 0
    for rec in r.iterShapeRecords():
        d = rec.record.as_dict()
        rings = _rings(rec.shape)
        name = (d.get("NAME") or "").strip()
        if not rings or not name:
            skipped += 1
            continue
        w, s, e, n = rec.shape.bbox
        lon, lat = d.get("longitude"), d.get("latitude")
        if lon is None or lat is None:
            lon, lat = (w + e) / 2.0, (s + n) / 2.0
        out.append({
            "n": name,
            "s": (d.get("REGION") or "").strip(),
            "f": (d.get("CODE_LOCAL") or "").strip(),
            "t": (d.get("TYPE_EN") or d.get("TYPE") or "County").strip(),
            "a": int(d.get("AREA_SQKM") or 0),
            "c": [round(float(lon), PRECISION), round(float(lat), PRECISION)],
            "b": [round(v, PRECISION) for v in (w, s, e, n)],
            "r": [[v for p in ring for v in p] for ring in rings],
        })
    if skipped:
        print(f"  skipped {skipped} records with no usable ring or name")
    return {"count": len(out), "counties": out}


# ---------------------------------------------------------------------------
# Verification


def _point_in_rings(rings: list[list[float]], x: float, y: float) -> bool:
    """Even-odd ray cast over flat [lon, lat, ...] rings. Mirrors adHitTest()
    in web/app.js; if the two ever disagree, clicks land on the wrong county."""
    hit = False
    for flat in rings:
        n = len(flat) // 2
        j = n - 1
        for i in range(n):
            xi, yi = flat[2 * i], flat[2 * i + 1]
            xj, yj = flat[2 * j], flat[2 * j + 1]
            if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
                hit = not hit
            j = i
    return hit


def verify(data: dict) -> int:
    """Three checks, each able to fail.

    1. Border sharing. If Natural Earth had generalized each county
       independently the shared-vertex count would collapse, and no simplifier
       decision on our side could produce watertight holes. This is the
       assumption the whole file rests on, so it is measured rather than
       assumed.
    2. Hit test, positive control. Every cartographer label point must land
       inside its own county.
    3. Hit test, negative control. The same point shifted 20 degrees east must
       land inside none of them. Without this, a hit test that returns True
       unconditionally would pass check 2.
    """
    counties = data["counties"]
    failures = 0

    owners: dict[tuple, set] = {}
    for i, c in enumerate(counties):
        for flat in c["r"]:
            for k in range(0, len(flat), 2):
                owners.setdefault((flat[k], flat[k + 1]), set()).add(i)
    shared = sum(1 for o in owners.values() if len(o) >= 2)
    pct = 100.0 * shared / max(1, len(owners))
    print(f"  border sharing: {shared:,} of {len(owners):,} distinct vertices "
          f"belong to 2+ counties ({pct:.1f}%)")
    if pct < 40.0:
        print("    FAIL: borders are not shared; darkening holes will crack")
        failures += 1

    miss = [c for c in counties if not _point_in_rings(c["r"], c["c"][0], c["c"][1])]
    print(f"  hit test, positive: {len(counties) - len(miss):,}/{len(counties):,} "
          f"label points land inside their own county")
    for c in miss[:5]:
        print(f"    miss: {c['n']}, {c['s']} at {c['c']}")
    if miss:
        failures += 1

    false_hits = sum(1 for c in counties
                     if _point_in_rings(c["r"], c["c"][0] + 20.0, c["c"][1]))
    print(f"  hit test, negative: {false_hits} counties claim a point "
          f"20 deg to their east")
    if false_hits:
        failures += 1

    return failures


def main() -> None:
    import sys

    print("building counties ...")
    data = build()
    raw = json.dumps(data, separators=(",", ":")).encode("utf-8")
    (OUT / "ne_counties.json").write_bytes(raw)

    verts = sum(len(ring) // 2 for c in data["counties"] for ring in c["r"])
    states = {c["s"] for c in data["counties"]}
    print(f"  {data['count']:,} counties across {len(states)} states/territories")
    print(f"  {verts:,} vertices, {len(raw):,} bytes "
          f"({len(raw) / max(1, data['count']):.0f} B/county)")
    print(f"  -> {OUT / 'ne_counties.json'}")

    if "--verify" in sys.argv:
        print("\nverifying ...")
        failures = verify(data)
        print("  OK" if not failures else f"  {failures} CHECK(S) FAILED")
        raise SystemExit(1 if failures else 0)


if __name__ == "__main__":
    main()
