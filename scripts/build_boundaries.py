"""Convert Natural Earth shapefiles into GeoJSON for the BOUNDARIES layer.

---- The state borders used to be wrong by kilometres --------------------

They were built from ne_10m_admin_1_states_provinces POLYGONS, outlined, then
"decimated" to at most 250 points per ring by keeping every k-th point. Both
halves of that were mistakes, and the second one was measured on 2026-08-15:

    displacement caused by the 250-point cap, over the 835 rings it touched
        median 5,131 m      p90 17,503 m      worst 162,702 m (Nunavut)

For comparison, a Douglas-Peucker pass was REMOVED from this project on
purpose because Don saw its 223 m error putting borders in the wrong place at
city zoom. The cap that stayed behind was 23x worse in the median and 700x
worse at the tail, and the comment above it claimed it "keeps coastline
fidelity at city zoom".

A point-count cap cannot make that claim. Douglas-Peucker guarantees a BOUND
on the deviation; keeping every k-th point guarantees nothing at all, because
it discards the points that carry the shape as readily as the redundant ones.

Outlining polygons was the other half:
  * every shared border was drawn TWICE, once from each side;
  * every COASTLINE was drawn as if it were a state border;
  * and scalerank > 5 dropped 3,128 of 4,596 admin-1 areas entirely.

So this now reads ne_10m_admin_1_states_provinces_LINES, which is the same
survey published as boundary lines: no coastlines, no duplicated edges, 197
countries, and a FEATURECLA that says what each line actually is.

---- Contiguous segments are joined before anything else ------------------

The shapefiles split a boundary wherever an attribute changes, which leaves
39,571 fragments for admin-1 and 7,785 for admin-0. Every fragment keeps both
its endpoints no matter what, so that fragmentation alone is a floor of 79,142
positions that no simplifier can go under. Joining them first:

    admin-1   39,571 lines -> 4,007      admin-0   7,785 lines -> 224

Nothing is lost: the per-feature properties were already dead. border-worker.js
parsed them into `props` and nothing has ever read it.

Inputs (in repo root, gitignored):
  - ne_10m_admin_0_boundary_lines_land.zip        country borders, as lines
  - ne_10m_admin_1_states_provinces_lines.zip     admin-1 borders, as lines
  - ne_10m_admin_0_countries_lakes.zip            polygons, for label anchors
  - ne_10m_admin_1_states_provinces.zip           polygons, for label anchors

Outputs (web/data/, gitignored):
  - ne_country_borders.geojson  LineString, merged, full fidelity
  - ne_state_borders.geojson    LineString, merged, full fidelity
  - ne_country_labels.geojson   Point at LABEL_X/Y
  - ne_state_labels.geojson     Point at polygon-bbox centroid

Coordinates are rounded to 5 decimals (1.1 m) here, which is what
slim_boundaries.py used to do in a second pass. That pass also wrote a
`.full.geojson` beside each output, and those files were being bundled into the
APK, 17.2 MB of them, referenced by nothing.

Run:
  py -V:3.13 scripts/build_boundaries.py
"""
from __future__ import annotations

import io
import json
import math
import urllib.request
import zipfile
from pathlib import Path

import shapefile

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "web" / "data"
OUT.mkdir(parents=True, exist_ok=True)


NACIS = "https://naciscdn.org/naturalearth/10m/cultural/"


def _ensure(name: str) -> Path:
    """Natural Earth zips live in the repo root and are gitignored. Fetch one
    if it is not there, so a fresh clone can build without a manual download."""
    local = ROOT / name
    if not local.exists():
        print(f"  fetching {NACIS + name} ...")
        urllib.request.urlretrieve(NACIS + name, local)
    return local


def _open(zip_path: Path) -> shapefile.Reader:
    with zipfile.ZipFile(zip_path) as z:
        sname = next(n for n in z.namelist() if n.endswith(".shp"))
        base = sname.rsplit(".", 1)[0]
        return shapefile.Reader(
            shp=io.BytesIO(z.read(base + ".shp")),
            shx=io.BytesIO(z.read(base + ".shx")),
            dbf=io.BytesIO(z.read(base + ".dbf")),
        )


EARTH_R = 6371000.0

Pt = tuple[float, float]


def _shape_parts(shape: shapefile.Shape) -> list[list[Pt]]:
    """Every part of a shape as its own list of points."""
    parts = list(shape.parts) + [len(shape.points)]
    out = []
    for i in range(len(parts) - 1):
        seg = [(float(x), float(y)) for x, y in shape.points[parts[i]:parts[i + 1]]]
        if len(seg) >= 2:
            out.append(seg)
    return out


def _merge_chains(lines: list[list[Pt]]) -> list[list[Pt]]:
    """Join lines that share an endpoint into the longest chains possible.

    Exact endpoint equality only. These come out of one shapefile where a
    boundary was split at attribute changes, so the shared vertices are the
    same float, not merely close. Tolerant snapping would risk joining two
    borders that happen to touch.
    """
    ends: dict[Pt, list[int]] = {}
    for i, s in enumerate(lines):
        ends.setdefault(s[0], []).append(i)
        ends.setdefault(s[-1], []).append(i)
    used = [False] * len(lines)
    out: list[list[Pt]] = []
    for i in range(len(lines)):
        if used[i]:
            continue
        used[i] = True
        chain = list(lines[i])
        for _ in range(2):                       # grow the tail, flip, repeat
            while True:
                tail = chain[-1]
                nxt = next((j for j in ends.get(tail, ()) if not used[j]), None)
                if nxt is None:
                    break
                used[nxt] = True
                seg = lines[nxt]
                chain += seg[1:] if seg[0] == tail else list(reversed(seg))[1:]
            chain.reverse()
        out.append(chain)
    return out


def _unit(p: Pt) -> tuple[float, float, float]:
    lon, lat = math.radians(p[0]), math.radians(p[1])
    c = math.cos(lat)
    return (c * math.cos(lon), c * math.sin(lon), math.sin(lat))


def _seg_dist_m(p, a, b) -> float:
    """Distance from p to the great-circle segment a-b, all unit vectors.

    Done on the sphere rather than by scaling longitude by cos(latitude).
    The first version of this used one cosine for a whole line, which is
    harmless for a shapefile fragment and badly wrong once contiguous
    fragments are joined: a merged country border runs from the tropics to
    the Arctic, where that factor goes from 1 to near 0. The build's own
    tolerance check caught it, reporting 1,495 m of deviation against a 500 m
    bound.
    """
    nx = a[1] * b[2] - a[2] * b[1]
    ny = a[2] * b[0] - a[0] * b[2]
    nz = a[0] * b[1] - a[1] * b[0]
    nl = math.sqrt(nx * nx + ny * ny + nz * nz)
    if nl < 1e-15:                                    # a and b coincide
        dot = max(-1.0, min(1.0, p[0] * a[0] + p[1] * a[1] + p[2] * a[2]))
        return math.acos(dot) * EARTH_R
    nx, ny, nz = nx / nl, ny / nl, nz / nl
    along = p[0] * nx + p[1] * ny + p[2] * nz          # sine of cross-track
    # Does p project INSIDE the segment? Compare against the segment's own
    # angular width, using the footprint of p on the great circle.
    fx, fy, fz = p[0] - along * nx, p[1] - along * ny, p[2] - along * nz
    fl = math.sqrt(fx * fx + fy * fy + fz * fz)
    ab = a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
    if fl > 1e-15:
        fx, fy, fz = fx / fl, fy / fl, fz / fl
        if (a[0] * fx + a[1] * fy + a[2] * fz) >= ab and \
           (b[0] * fx + b[1] * fy + b[2] * fz) >= ab:
            return math.asin(min(1.0, abs(along))) * EARTH_R
    da = math.acos(max(-1.0, min(1.0, p[0] * a[0] + p[1] * a[1] + p[2] * a[2])))
    db = math.acos(max(-1.0, min(1.0, p[0] * b[0] + p[1] * b[1] + p[2] * b[2])))
    return min(da, db) * EARTH_R


def _douglas_peucker(pts: list[Pt], tol_m: float) -> tuple[list[Pt], float]:
    """Simplify with a BOUND on the deviation, in metres.

    Returns the kept points AND the worst distance actually discarded, so the
    caller can assert the bound held rather than trusting that it did.

    Iterative rather than recursive: a merged chain can carry tens of thousands
    of points and Python's recursion limit is not a cartographic parameter.
    """
    if len(pts) < 3 or tol_m <= 0:
        return list(pts), 0.0
    u = [_unit(p) for p in pts]
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    worst_dropped = 0.0
    stack = [(0, len(pts) - 1)]
    while stack:
        i, j = stack.pop()
        if j <= i + 1:
            continue
        best, bi = -1.0, -1
        for k in range(i + 1, j):
            d = _seg_dist_m(u[k], u[i], u[j])
            if d > best:
                best, bi = d, k
        if best > tol_m:
            keep[bi] = True
            stack.append((i, bi))
            stack.append((bi, j))
        elif best > worst_dropped:
            worst_dropped = best
    return [p for p, k in zip(pts, keep) if k], worst_dropped


# The overview level, drawn while the camera is high enough that the detail
# cannot be seen. 500 m is chosen from pixels, not from taste: Cesium's default
# 60 degree field of view puts about 1.155*h metres across a canvas of W pixels,
# so one pixel is 1.155*h/W metres. The app swaps to full detail at 1,000 km,
# where a 1,920 px window shows 601 m per pixel. 500 m is under that, so the
# overview is sub-pixel everywhere it is ever shown, and app.js raises the swap
# altitude on a wider canvas so it stays that way.
OVERVIEW_TOL_M = 500.0


def _overview(lines: list[list[Pt]], kind: str) -> dict:
    out, worst = [], 0.0
    for s in lines:
        simp, dropped = _douglas_peucker(s, OVERVIEW_TOL_M)
        worst = max(worst, dropped)
        out.append(simp)
    base = sum(len(s) for s in lines)
    n = sum(len(s) for s in out)
    print(f"  overview at {OVERVIEW_TOL_M:.0f} m: {n:,} positions "
          f"({100 * n / base:.0f}% of {base:,}), worst measured deviation "
          f"{worst:,.0f} m")
    if worst > OVERVIEW_TOL_M * 1.01:
        raise SystemExit(f"the simplifier exceeded its own tolerance "
                         f"({worst:.0f} m > {OVERVIEW_TOL_M:.0f} m), which means "
                         f"the bound it is chosen for does not hold")
    return {"type": "FeatureCollection",
            "features": [_feature(s, kind) for s in out]}


def _feature(line: list[Pt], kind: str) -> dict:
    return {
        "type": "Feature",
        "geometry": {"type": "LineString",
                     "coordinates": [[round(x, 5), round(y, 5)] for x, y in line]},
        # `kind` is the only property anything reads. The per-feature names the
        # old build carried were parsed by border-worker.js into `props` and
        # never used, and they are what forced the lines to stay fragmented.
        "properties": {"kind": kind},
    }


def _bbox_center(shape: shapefile.Shape) -> tuple[float, float]:
    w, s, e, n = shape.bbox
    return (w + e) / 2.0, (s + n) / 2.0


def country_borders() -> dict:
    r = _open(ROOT / "ne_10m_admin_0_boundary_lines_land.zip")
    raw: list[list[Pt]] = []
    for rec in r.iterShapeRecords():
        d = rec.record.as_dict()
        # Skip "indefinite" / disputed lines. They look messy on the globe and
        # this app has no business taking a side.
        fc = (d.get("FEATURECLA") or "").lower()
        if "indefinite" in fc or "disputed" in fc:
            continue
        raw.extend(_shape_parts(rec.shape))
    merged = _merge_chains(raw)
    print(f"  {len(raw):,} segments joined into {len(merged):,} lines, "
          f"{sum(len(s) for s in merged):,} positions")
    return ({"type": "FeatureCollection",
             "features": [_feature(s, "country_border") for s in merged]},
            _overview(merged, "country_border"))


# What each admin-1 line actually is. The statistical classes are census and
# reporting geography rather than administrative boundaries, and drawing them
# as state lines is the same category error as drawing coastlines as state
# lines, which is what outlining the polygons used to do.
ADMIN1_KEEP = {"Admin-1 boundary", "Admin-1 region boundary"}


TIGER_STATES = ("https://www2.census.gov/geo/tiger/GENZ2023/shp/"
                "cb_2023_us_state_500k.zip")


def _ensure_tiger() -> Path:
    local = ROOT / "cb_2023_us_state_500k.zip"
    if not local.exists():
        print(f"  fetching {TIGER_STATES} ...")
        urllib.request.urlretrieve(TIGER_STATES, local)
    return local


def us_state_borders() -> list[list[Pt]]:
    """US state lines from the Census Bureau, not from Natural Earth.

    Natural Earth 10m is a 1:10,000,000 product and it shows. Scored against
    the Census Bureau's own rendition of the same interior state lines it sits

        median 470 m off, p90 1,175 m, worst 9,504 m

    which is the same order of error Don rejected when a Douglas-Peucker pass
    displaced borders by 223 m. No amount of care in this script fixes that,
    because it is the source. So for the United States the source changes.

    TIGER/Line cartographic boundaries are a work of the US government, public
    domain, and authoritative. They ship as state POLYGONS, so the interior
    boundaries have to be recovered: an edge between two states belongs to both
    polygons and therefore appears exactly twice, while a coastline or a
    national border appears once. Counting them separates the two cleanly,
    which is only true because TIGER is topologically consistent:

        284,144 segments -> 240,610 unique -> 43,534 appearing twice

    Coastline is deliberately left out. This app draws no coastline anywhere
    else, and the globe imagery already shows where the sea is.
    """
    r = _open(_ensure_tiger())
    seen: dict[tuple[Pt, Pt], int] = {}
    for rec in r.iterShapeRecords():
        for part in _shape_parts(rec.shape):
            pts = [(round(x, 6), round(y, 6)) for x, y in part]
            for a, b in zip(pts, pts[1:]):
                key = (a, b) if a <= b else (b, a)
                seen[key] = seen.get(key, 0) + 1
    interior = [[a, b] for (a, b), n in seen.items() if n >= 2]
    merged = _merge_chains(interior)
    print(f"  US: {len(interior):,} interior segments joined into "
          f"{len(merged):,} lines, {sum(len(s) for s in merged):,} positions")
    return merged


def state_borders() -> dict:
    r = _open(_ensure("ne_10m_admin_1_states_provinces_lines.zip"))
    raw: list[list[Pt]] = []
    skipped: dict[str, int] = {}
    for rec in r.iterShapeRecords():
        d = rec.record.as_dict()
        fc = d.get("FEATURECLA") or ""
        if fc not in ADMIN1_KEEP:
            skipped[fc] = skipped.get(fc, 0) + 1
            continue
        # The US comes from the Census Bureau instead. Dropping it here is what
        # stops the two sources drawing the same state line twice, ~470 m apart.
        if (d.get("ADM0_NAME") or "") == "United States of America":
            continue
        raw.extend(_shape_parts(rec.shape))
    merged = _merge_chains(raw)
    print(f"  world minus US: {len(raw):,} segments joined into "
          f"{len(merged):,} lines, {sum(len(s) for s in merged):,} positions")
    print(f"  not drawn: {skipped}")
    merged += us_state_borders()
    print(f"  combined: {len(merged):,} lines, "
          f"{sum(len(s) for s in merged):,} positions")
    return ({"type": "FeatureCollection",
             "features": [_feature(s, "state_border") for s in merged]},
            _overview(merged, "state_border"))


def country_labels() -> dict:
    r = _open(ROOT / "ne_10m_admin_0_countries_lakes.zip")
    feats = []
    for rec in r.iterShapeRecords():
        d = rec.record.as_dict()
        name = d.get("NAME") or d.get("ADMIN") or ""
        if not name:
            continue
        # LABEL_X/LABEL_Y are pre-positioned by Natural Earth cartographers
        lon = d.get("LABEL_X")
        lat = d.get("LABEL_Y")
        if lon is None or lat is None:
            lon, lat = _bbox_center(rec.shape)
        labelrank = d.get("LABELRANK") or 5
        min_zoom = d.get("MIN_ZOOM") or 0.0
        feats.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [float(lon), float(lat)]},
            "properties": {
                "kind": "country_label",
                "name": name,
                "labelrank": int(labelrank),
                "min_zoom": float(min_zoom),
                "type": d.get("TYPE") or "",
                "iso_a3": d.get("ADM0_A3") or "",
            },
        })
    return {"type": "FeatureCollection", "features": feats}


def state_labels() -> dict:
    """Label anchors still come from the POLYGONS, because a label needs an
    area to sit in the middle of and a boundary line has no inside.

    scalerank > 5 is dropped here and only here. As a filter on which admin-1
    areas get a NAME on a phone screen that is a reasonable cartographic call;
    as a filter on which BORDERS exist, which is what it used to also be, it
    silently deleted 3,128 of 4,596 areas from the map.
    """
    r = _open(ROOT / "ne_10m_admin_1_states_provinces.zip")
    feats = []
    for rec in r.iterShapeRecords():
        d = rec.record.as_dict()
        scalerank = d.get("scalerank")
        if scalerank is not None and scalerank > 5:
            continue
        name = d.get("name") or ""
        if not name:
            continue
        lon, lat = _bbox_center(rec.shape)
        feats.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [lon, lat]},
            "properties": {
                "kind": "state_label",
                "name": name,
                "country": d.get("admin") or d.get("iso_a2") or "",
                "labelrank": int(d.get("labelrank") or 6),
            },
        })
    return {"type": "FeatureCollection", "features": feats}


POPULATED_PLACES_URL = (
    "https://naciscdn.org/naturalearth/10m/cultural/ne_10m_populated_places.zip"
)


def _ensure_populated_places() -> Path | None:
    """Download Natural Earth populated_places once into the repo root if not
    already present. Cached file is gitignored via the ne_*.zip rule."""
    local = ROOT / "ne_10m_populated_places.zip"
    if local.exists():
        return local
    print(f"  fetching {POPULATED_PLACES_URL} (~1.5 MB) …")
    try:
        import urllib.request
        urllib.request.urlretrieve(POPULATED_PLACES_URL, local)
        return local
    except Exception as e:
        print(f"  populated_places fetch failed: {e}")
        return None


def populated_places() -> dict | None:
    """Convert NE populated_places to a Point FeatureCollection. Properties
    include NAME, NAMEASCII, SCALERANK (lower = bigger city), POP_MIN, POP_MAX,
    ADM0NAME (country), ADM1NAME (state), and LATITUDE/LONGITUDE.
    SCALERANK 0 = world capitals; 6+ = small towns. We keep all and let the
    front-end DDC-gate by rank.
    """
    zp = _ensure_populated_places()
    if not zp:
        return None
    r = _open(zp)
    feats = []
    for rec in r.iterShapeRecords():
        d = rec.record.as_dict()
        name = (d.get("NAME") or d.get("NAMEASCII") or "").strip()
        if not name:
            continue
        # NE includes both real coordinate fields and a SHAPE point. Use
        # LATITUDE/LONGITUDE since they're the cartographer-curated label position.
        lon = d.get("LONGITUDE")
        lat = d.get("LATITUDE")
        if lon is None or lat is None:
            if not rec.shape.points:
                continue
            lon, lat = rec.shape.points[0]
        feats.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [float(lon), float(lat)]},
            "properties": {
                "kind": "city_label",
                "name": name,
                "scalerank": int(d.get("SCALERANK") or 6),
                "labelrank": int(d.get("LABELRANK") or 6),
                "rank_max": int(d.get("RANK_MAX") or 0),
                "pop_max": int(d.get("POP_MAX") or 0),
                "pop_min": int(d.get("POP_MIN") or 0),
                "country": d.get("ADM0NAME") or "",
                "state": d.get("ADM1NAME") or "",
                "featurecla": d.get("FEATURECLA") or "",
            },
        })
    return {"type": "FeatureCollection", "features": feats}


# Airspace used to be built here, from an OpenAIP export named us_asp.json in
# the project root. It is not any more, and this note is where the function
# was, because a generator that quietly rewrites a file from a licence you
# stopped using is worse than no generator at all.
#
# OpenAIP is CC BY-NC-SA 4.0: an attribution term the app never honoured, and a
# NonCommercial clause that becomes a real question on a store listing. The
# data is now FAA Class Airspace, a work of the US government with neither.
#
#     py -V:3.13 scripts/fetch_faa_airspace.py
#
# The OpenAIP source files were moved to _deprecated/2026-08-09/ rather than
# deleted. If you restore one, do not point it at web/data/airspace.json.


def write(name: str, data) -> int:
    p = OUT / name
    raw = json.dumps(data, separators=(",", ":")).encode("utf-8")
    p.write_bytes(raw)
    return len(raw)


def main() -> None:
    print("building country borders …")
    cb, cbo = country_borders()
    print(f"  {len(cb['features'])} features → {write('ne_country_borders.geojson', cb):,} bytes")
    print(f"  {len(cbo['features'])} overview → "
          f"{write('ne_country_borders.overview.geojson', cbo):,} bytes")

    print("building country labels …")
    cl = country_labels()
    print(f"  {len(cl['features'])} features → {write('ne_country_labels.geojson', cl):,} bytes")

    print("building state borders …")
    sb, sbo = state_borders()
    print(f"  {len(sb['features'])} border features → {write('ne_state_borders.geojson', sb):,} bytes")
    print(f"  {len(sbo['features'])} overview → "
          f"{write('ne_state_borders.overview.geojson', sbo):,} bytes")

    print("building state labels …")
    sl = state_labels()
    print(f"  {len(sl['features'])} label features → {write('ne_state_labels.geojson', sl):,} bytes")

    print("building populated places (cities/towns) …")
    pp = populated_places()
    if pp is None:
        print("  populated_places fetch failed — skipping city labels")
    else:
        print(f"  {len(pp['features'])} city features → {write('ne_populated_places.geojson', pp):,} bytes")

    print("airspace: not built here — run scripts/fetch_faa_airspace.py")

    print(f"\noutput dir: {OUT}")


if __name__ == "__main__":
    main()
