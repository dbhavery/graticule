"""Convert Natural Earth shapefiles → minimal GeoJSON for the BOUNDARIES layer.

Inputs (in repo root, gitignored):
  - ne_10m_admin_0_boundary_lines_land.zip   (515 polylines — country borders)
  - ne_10m_admin_0_countries_lakes.zip       (258 polygons — used for labels via LABEL_X/LABEL_Y)
  - ne_10m_admin_1_states_provinces.zip      (4596 polygons — first-level admin)

Outputs (web/data/, gitignored):
  - ne_country_borders.geojson  (FeatureCollection of LineString)
  - ne_country_labels.geojson   (FeatureCollection of Point at LABEL_X/Y)
  - ne_state_borders.geojson    (FeatureCollection of LineString — polygon outlines)
  - ne_state_labels.geojson     (FeatureCollection of Point at polygon-bbox centroid)

Run:
  uv run python scripts/build_boundaries.py
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


def _open(zip_path: Path) -> shapefile.Reader:
    with zipfile.ZipFile(zip_path) as z:
        sname = next(n for n in z.namelist() if n.endswith(".shp"))
        base = sname.rsplit(".", 1)[0]
        return shapefile.Reader(
            shp=io.BytesIO(z.read(base + ".shp")),
            shx=io.BytesIO(z.read(base + ".shx")),
            dbf=io.BytesIO(z.read(base + ".dbf")),
        )


def _polygon_to_outline_lines(shape: shapefile.Shape, max_pts: int | None = None) -> list[list[list[float]]]:
    """Each part of the polygon becomes a closed polyline (ring).

    If max_pts is set, decimates each ring to ≤ max_pts via uniform sampling
    (keep every k-th point). Cheap proxy for Douglas-Peucker; good enough at
    globe-overview scales.
    """
    parts = list(shape.parts) + [len(shape.points)]
    rings: list[list[list[float]]] = []
    for i in range(len(parts) - 1):
        pts = shape.points[parts[i]:parts[i + 1]]
        n = len(pts)
        if n < 2:
            continue
        if max_pts and n > max_pts:
            step = max(2, (n + max_pts - 1) // max_pts)
            kept = pts[::step]
            if kept[-1] != pts[-1]:
                kept = list(kept) + [pts[-1]]
            pts = kept
        ring = [[lon, lat] for lon, lat in pts]
        rings.append(ring)
    return rings


def _bbox_center(shape: shapefile.Shape) -> tuple[float, float]:
    w, s, e, n = shape.bbox
    return (w + e) / 2.0, (s + n) / 2.0


def country_borders() -> dict:
    r = _open(ROOT / "ne_10m_admin_0_boundary_lines_land.zip")
    feats = []
    for rec in r.iterShapeRecords():
        d = rec.record.as_dict()
        # Skip "indefinite" / disputed lines — they look messy on the globe
        fc = (d.get("FEATURECLA") or "").lower()
        if "indefinite" in fc or "disputed" in fc:
            continue
        parts = list(rec.shape.parts) + [len(rec.shape.points)]
        for i in range(len(parts) - 1):
            seg = [[lon, lat] for lon, lat in rec.shape.points[parts[i]:parts[i + 1]]]
            if len(seg) < 2:
                continue
            feats.append({
                "type": "Feature",
                "geometry": {"type": "LineString", "coordinates": seg},
                "properties": {
                    "kind": "country_border",
                    "left":  d.get("ADM0_LEFT") or "",
                    "right": d.get("ADM0_RIGHT") or "",
                },
            })
    return {"type": "FeatureCollection", "features": feats}


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


def state_borders_and_labels() -> tuple[dict, dict]:
    r = _open(ROOT / "ne_10m_admin_1_states_provinces.zip")
    border_feats = []
    label_feats = []
    # 250 points per ring keeps coastline fidelity at city zoom while still
    # cutting the ~47 MB raw output to a manageable ~15 MB. (Full undecimated
    # 1.3M pts is overkill but readable; 80 was too aggressive — Don flagged
    # state lines as inaccurate when zoomed in.)
    MAX_PTS_PER_RING = 250
    for rec in r.iterShapeRecords():
        d = rec.record.as_dict()
        # Skip the smallest-rank features (Natural Earth uses scalerank to mark
        # zoom band; rank > 5 is regional-detail and clutters the globe view)
        scalerank = d.get("scalerank")
        if scalerank is not None and scalerank > 5:
            continue
        name = d.get("name") or ""
        adm0 = d.get("admin") or d.get("iso_a2") or ""
        # Polygon outline → decimated polylines
        for ring in _polygon_to_outline_lines(rec.shape, max_pts=MAX_PTS_PER_RING):
            border_feats.append({
                "type": "Feature",
                "geometry": {"type": "LineString", "coordinates": ring},
                "properties": {
                    "kind": "state_border",
                    "name": name,
                    "country": adm0,
                },
            })
        if name:
            lon, lat = _bbox_center(rec.shape)
            label_feats.append({
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [lon, lat]},
                "properties": {
                    "kind": "state_label",
                    "name": name,
                    "country": adm0,
                    "labelrank": int(d.get("labelrank") or 6),
                },
            })
    return (
        {"type": "FeatureCollection", "features": border_feats},
        {"type": "FeatureCollection", "features": label_feats},
    )


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
    cb = country_borders()
    print(f"  {len(cb['features'])} features → {write('ne_country_borders.geojson', cb):,} bytes")

    print("building country labels …")
    cl = country_labels()
    print(f"  {len(cl['features'])} features → {write('ne_country_labels.geojson', cl):,} bytes")

    print("building state borders + labels …")
    sb, sl = state_borders_and_labels()
    print(f"  {len(sb['features'])} border features → {write('ne_state_borders.geojson', sb):,} bytes")
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
