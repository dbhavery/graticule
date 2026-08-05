"""Generate the app icons.

Checked in as a script rather than as loose binaries so the mark can be
regenerated when the brand moves, and so nobody has to guess what produced a
PNG sitting in a folder.

The mark is the thing the app is named after: a graticule, the grid of
parallels and meridians on a globe. Drawn as an orthographic projection so the
lines curve the way they do on the real thing, in the app's own accent cyan on
its own panel dark.

Two families, and the difference matters. `icon-*` is the plain mark. Android
crops `maskable-*` to whatever shape the launcher uses -- circle, squircle,
teardrop -- and only the middle 80% is guaranteed to survive, so the maskable
pair draws the same mark at 62% and floods the corners with the background.
Ship a plain icon as maskable and Android crops the edges off it.
"""
from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parents[1] / "web" / "icons"

BG = (11, 14, 19, 255)        # --rail-bg #0b0e13
DEEP = (4, 7, 13, 255)        # --panel far back
ACCENT = (92, 214, 255, 255)  # --accent #5cd6ff
DIM = (92, 214, 255, 90)

SS = 4                        # supersample factor, downsampled at the end


def _globe(d: ImageDraw.ImageDraw, cx: float, cy: float, r: float, w: float) -> None:
    """An orthographic graticule: the limb, five parallels, six meridians."""
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(9, 24, 34, 255))

    # Parallels are straight chords in an orthographic view from the equator.
    for lat in (-60, -30, 0, 30, 60):
        y = cy - r * math.sin(math.radians(lat))
        half = r * math.cos(math.radians(lat))
        lw = w * (1.7 if lat == 0 else 1.0)
        d.line([cx - half, y, cx + half, y], fill=ACCENT if lat == 0 else DIM, width=int(lw))

    # Meridians project to ellipses whose semi-minor axis is r*sin(longitude).
    for lon in (0, 30, 60, 90, 120, 150):
        a = abs(r * math.sin(math.radians(lon)))
        lw = w * (1.7 if lon == 90 else 1.0)
        if a < w:                       # edge-on: a straight line, not an ellipse
            d.line([cx, cy - r, cx, cy + r], fill=ACCENT, width=int(lw))
            continue
        d.arc([cx - a, cy - r, cx + a, cy + r], 0, 360,
              fill=ACCENT if lon == 90 else DIM, width=int(lw))

    d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=ACCENT, width=int(w * 2.2))


def build(size: int, maskable: bool) -> Image.Image:
    n = size * SS
    img = Image.new("RGBA", (n, n), BG)
    d = ImageDraw.Draw(img)

    if not maskable:
        # A rounded square, the way an iOS icon is masked. Android gets the
        # maskable pair instead, which must stay square to the bleed.
        d.rounded_rectangle([0, 0, n - 1, n - 1], radius=int(n * 0.22), fill=BG)

    # Maskable keeps the mark inside the guaranteed-safe middle 80%.
    frac = 0.31 if maskable else 0.38
    _globe(d, n / 2, n / 2, n * frac, max(1.0, n * 0.008))

    return img.resize((size, size), Image.LANCZOS)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    made = []
    for size in (180, 192, 512):
        p = OUT / f"icon-{size}.png"
        build(size, maskable=False).save(p, optimize=True)
        made.append(p)
    for size in (192, 512):
        p = OUT / f"maskable-{size}.png"
        build(size, maskable=True).save(p, optimize=True)
        made.append(p)

    # Favicon, so a browser tab is not a blank page glyph.
    ico = OUT.parent / "favicon.ico"
    build(64, maskable=False).save(ico, sizes=[(16, 16), (32, 32), (48, 48), (64, 64)])
    made.append(ico)

    for p in made:
        print(f"{p.relative_to(OUT.parents[1])}  {p.stat().st_size:,} bytes")


if __name__ == "__main__":
    main()
