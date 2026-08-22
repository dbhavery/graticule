"""Bake the borders into transparent raster tiles, so boot uploads no geometry.

The borders were 157,607 positions at boot, and Cesium's PolylineGeometry turns
every position into FOUR fat vertices -- position, prev, next, expand, st, each
split high/low for precision -- which measured ~352 bytes per position and
2,147 ms of `Primitive.update` on the device (issues.md 69, 70).

A raster tile costs the GPU one texture upload for the handful of tiles on
screen, and costs the main thread nothing at all. The accuracy is unchanged
because the tiles are rendered FROM the same Census/Natural Earth lines the
vector path uses; what is lost is the ability to restyle at runtime, which this
app never did -- both layers are one slate colour.

    py -V:3.13 scripts/build_border_tiles.py [--max-level 7] [--estimate]

---- Why a GEOGRAPHIC scheme, and why it stops where it does ----------------

Cesium's GeographicTilingScheme puts 2x1 tiles over the whole ellipsoid at
level 0, which matches lon/lat source data with no reprojection and no polar
distortion.

The pyramid is NOT taken to the depth that would make it sharp at city zoom.
Borders are a 1-D feature in a 2-D grid, so the tiles they touch grow by about
2.5x per level rather than 4x, and it still runs away:

    L4    193      L6   1,628      L8   11,551
    L5    563      L7   4,507      L9   27,395

L0-L8 is 18,548 files, which is more bytes AND 18,000 more files than the
3.6 MB of overview GeoJSON it would replace. So the raster covers the FAR view
-- which is boot, and where the whole world is on screen at once -- and the
existing vector detail path still takes over on descent, where only a handful
of lines are in view. That handoff already exists; this only changes what is
drawn above it.
"""
from __future__ import annotations

import argparse
import json
import math
import shutil
import sys
from collections import defaultdict
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "web" / "data"
OUT = DATA / "border_tiles"

# Source is the FULL-accuracy line work, not the simplified overview: the
# rasteriser's own pixel grid is the only simplification wanted here.
SOURCES = {
    "countries": DATA / "ne_country_borders.geojson",
    "states": DATA / "ne_state_borders.geojson",
}

TILE = 256
# Draw at 3x and box-filter down. Pillow's line drawing has no antialiasing,
# and an aliased 1px border on a globe crawls badly as the camera moves.
SS = 3
# Line weight in final tile pixels. Cesium samples a tile at roughly 1:1 when
# the level matches screen resolution, so this is the on-screen weight.
LINE_PX = {"countries": 1.15, "states": 1.0}
COLOR = (203, 213, 225)          # #cbd5e1, the colour both layers already use


def load_lines(path: Path) -> list[list[tuple[float, float]]]:
    doc = json.loads(path.read_text(encoding="utf-8"))
    out = []
    for f in doc.get("features", []):
        coords = (f.get("geometry") or {}).get("coordinates") or []
        pts = [(c[0], c[1]) for c in coords
               if isinstance(c, list) and len(c) >= 2
               and isinstance(c[0], (int, float)) and isinstance(c[1], (int, float))]
        if len(pts) >= 2:
            out.append(pts)
    return out


def bin_segments(lines, level: int) -> dict[tuple[int, int], list]:
    """Which segments touch which tile.

    Walks each segment in steps smaller than a tile so a long span cannot skip
    the tiles in the middle of it, which would leave holes in the middle of
    straight borders -- the kind of defect that looks like missing data rather
    than a bug.
    """
    nx, ny = 2 * 2**level, 2**level
    dx, dy = 360.0 / nx, 180.0 / ny
    bins: dict[tuple[int, int], list] = defaultdict(list)
    for pts in lines:
        for i in range(len(pts) - 1):
            (x0, y0), (x1, y1) = pts[i], pts[i + 1]
            steps = max(1, int(max(abs(x1 - x0) / dx, abs(y1 - y0) / dy) * 2) + 1)
            seen = set()
            for s in range(steps + 1):
                t = s / steps
                X = int((x0 + (x1 - x0) * t + 180.0) / dx)
                Y = int((90.0 - (y0 + (y1 - y0) * t)) / dy)
                X = min(max(X, 0), nx - 1)
                Y = min(max(Y, 0), ny - 1)
                # Neighbours too: a segment passing near a tile edge still puts
                # ink inside it once the line has width.
                for ox in (-1, 0, 1):
                    for oy in (-1, 0, 1):
                        tx, ty = X + ox, Y + oy
                        if 0 <= tx < nx and 0 <= ty < ny:
                            seen.add((tx, ty))
            for key in seen:
                bins[key].append(((x0, y0), (x1, y1)))
    return bins


def draw_tile(segs, level: int, tx: int, ty: int, width_px: float) -> Image.Image | None:
    nx, ny = 2 * 2**level, 2**level
    dx, dy = 360.0 / nx, 180.0 / ny
    west = -180.0 + tx * dx
    north = 90.0 - ty * dy
    n = TILE * SS
    img = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    w = max(1, round(width_px * SS))
    drew = False
    for (x0, y0), (x1, y1) in segs:
        ax = (x0 - west) / dx * n
        ay = (north - y0) / dy * n
        bx = (x1 - west) / dx * n
        by = (north - y1) / dy * n
        # Cheap reject, with a margin for the line's own width.
        m = w + 2
        if (max(ax, bx) < -m or min(ax, bx) > n + m
                or max(ay, by) < -m or min(ay, by) > n + m):
            continue
        d.line([(ax, ay), (bx, by)], fill=COLOR + (255,), width=w, joint="curve")
        drew = True
    if not drew:
        return None
    img = img.resize((TILE, TILE), Image.LANCZOS)
    if not img.getbbox():
        return None
    return img


ALPHA_LEVELS = 32
_PALETTE = []
for _i in range(ALPHA_LEVELS):
    _PALETTE += list(COLOR)
_PALETTE += [0] * (768 - len(_PALETTE))
_TRNS = bytes(round(i * 255 / (ALPHA_LEVELS - 1)) for i in range(ALPHA_LEVELS))


def save(img: Image.Image, path: Path) -> int:
    """8-bit palette + tRNS, not 32-bit RGBA.

    Every pixel in these tiles is the SAME colour at a different coverage, so
    three of the four RGBA channels are a constant repeated 65,536 times per
    tile and only alpha carries anything. Written as RGBA the L0-L6 pyramid was
    23.5 MB; as an indexed image whose palette is 32 copies of #cbd5e1 and
    whose tRNS chunk holds the 32 alpha steps, the same pixels are a quarter of
    that. 32 steps is invisible on a hairline.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    idx = img.split()[3].point(
        lambda v: min(ALPHA_LEVELS - 1, (v * ALPHA_LEVELS) // 256))
    out = Image.new("P", img.size)
    out.putdata(idx.getdata())
    out.putpalette(_PALETTE)
    out.save(path, "PNG", optimize=True, transparency=_TRNS, bits=8)
    return path.stat().st_size


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--max-level", type=int, default=7)
    ap.add_argument("--estimate", action="store_true",
                    help="bake one level only and extrapolate, for sizing")
    args = ap.parse_args()

    if OUT.exists() and not args.estimate:
        shutil.rmtree(OUT)

    manifest: dict[str, dict[str, list[int]]] = {}
    grand = 0
    for key, src in SOURCES.items():
        lines = load_lines(src)
        print(f"\n{key}: {len(lines):,} lines, "
              f"{sum(len(l) for l in lines):,} positions from {src.name}")
        manifest[key] = {}
        for level in range(args.max_level + 1):
            bins = bin_segments(lines, level)
            nx = 2 * 2**level
            written, size = 0, 0
            keys: list[int] = []
            for (tx, ty), segs in sorted(bins.items()):
                img = draw_tile(segs, level, tx, ty, LINE_PX[key])
                if img is None:
                    continue
                if not args.estimate:
                    size += save(img, OUT / key / str(level) / str(tx) / f"{ty}.png")
                keys.append(ty * nx + tx)
                written += 1
            manifest[key][str(level)] = sorted(keys)
            grand += size
            print(f"   L{level}: {written:>6,} tiles  {size / 1024:>9,.0f} KB"
                  f"   {size / written if written else 0:>6.0f} B/tile")
            if args.estimate and level >= 5:
                break

    if args.estimate:
        return

    # Which tiles exist, so the app never asks for one that does not. A 404 per
    # empty tile would be thousands of failed requests and a console full of
    # errors that border_perf_test gates on.
    mpath = DATA / "border_tiles.manifest.json"
    mpath.write_text(json.dumps(manifest, separators=(",", ":")), encoding="utf-8")
    print(f"\nmanifest {mpath.stat().st_size / 1024:,.0f} KB -> {mpath.name}")
    print(f"tiles    {grand / 1024 / 1024:,.1f} MB in {OUT}")
    print(f"replaces {(DATA / 'ne_country_borders.overview.geojson').stat().st_size / 1024 / 1024 + (DATA / 'ne_state_borders.overview.geojson').stat().st_size / 1024 / 1024:,.1f} MB of overview GeoJSON")


if __name__ == "__main__":
    main()
