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

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "web" / "icons"
RES = ROOT / "android" / "app" / "src" / "main" / "res"
STORE = ROOT / "docs" / "store"

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


# ---- Android launcher -------------------------------------------------------
#
# These were never generated. `npx cap add android` writes Capacitor's own logo
# into every mipmap folder and sets ic_launcher_background to #FFFFFF, and that
# is what shipped: a white tile with the framework's mark on the home screen,
# which is the first thing anyone sees and the last thing anyone would call
# finished. The web icons above were built properly and stopped at web/.
#
# Densities are dp * scale. A legacy icon is 48dp; an adaptive icon is 108dp
# with only the middle 72dp guaranteed to survive the launcher's mask, so the
# foreground draws the mark at 0.29 of the canvas (0.58 diameter, inside the
# 0.667 safe circle) on transparency.
LEGACY_DP, ADAPTIVE_DP, SPLASH_DP = 48, 108, 96
DENSITIES = {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}


def _mark(n: int, frac: float) -> Image.Image:
    """The globe alone, on transparency, at `frac` of the canvas."""
    img = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    _globe(ImageDraw.Draw(img), n / 2, n / 2, n * frac, max(1.0, n * 0.008))
    return img


def _shaped(n: int, shape: str) -> Image.Image:
    """A BG-filled tile masked to square, rounded square or circle."""
    tile = Image.new("RGBA", (n, n), BG)
    if shape == "square":
        return tile
    mask = Image.new("L", (n, n), 0)
    d = ImageDraw.Draw(mask)
    if shape == "circle":
        d.ellipse([0, 0, n - 1, n - 1], fill=255)
    else:
        d.rounded_rectangle([0, 0, n - 1, n - 1], radius=int(n * 0.22), fill=255)
    tile.putalpha(mask)
    return tile


def _launcher(size: int, shape: str) -> Image.Image:
    ss = size * SS
    img = _shaped(ss, shape)
    img.alpha_composite(_mark(ss, 0.34))
    return img.resize((size, size), Image.LANCZOS)


def android() -> list[Path]:
    made = []
    for name, scale in DENSITIES.items():
        folder = RES / f"mipmap-{name}"
        if not folder.is_dir():
            raise SystemExit(f"{folder} does not exist; is this a Capacitor project?")
        legacy = int(LEGACY_DP * scale)
        adaptive = int(ADAPTIVE_DP * scale)

        for fname, shape in (("ic_launcher.png", "rounded"),
                             ("ic_launcher_round.png", "circle")):
            p = folder / fname
            _launcher(legacy, shape).save(p, optimize=True)
            made.append(p)

        # The adaptive foreground sits on @color/ic_launcher_background, so it
        # must be the mark ALONE. Bake the panel dark into it as well and the
        # launcher's parallax shifts a visible dark square around inside the
        # mask.
        p = folder / "ic_launcher_foreground.png"
        _mark(adaptive * SS, 0.29).resize((adaptive, adaptive), Image.LANCZOS) \
            .save(p, optimize=True)
        made.append(p)

    # The launch window's mark, drawn at its natural size and centred by
    # drawable/launch_splash.xml rather than stretched across the window.
    # 96dp is roughly what Android 12's own splash icon occupies, so the two
    # paths look like the same app.
    for name, scale in DENSITIES.items():
        folder = RES / f"drawable-{name}"
        folder.mkdir(parents=True, exist_ok=True)
        n = int(SPLASH_DP * scale)
        p = folder / "splash_logo.png"
        _mark(n * SS, 0.44).resize((n, n), Image.LANCZOS).save(p, optimize=True)
        made.append(p)

    p = RES / "values" / "ic_launcher_background.xml"
    p.write_text(
        '<?xml version="1.0" encoding="utf-8"?>\n'
        "<resources>\n"
        f'    <color name="ic_launcher_background">'
        f"#{BG[0]:02X}{BG[1]:02X}{BG[2]:02X}</color>\n"
        "</resources>\n", encoding="utf-8")
    made.append(p)
    return made


# ---- Play Store graphics ----------------------------------------------------

FONT_REG = Path(r"C:\Windows\Fonts\segoeui.ttf")
FONT_BOLD = Path(r"C:\Windows\Fonts\segoeuib.ttf")


def _font(path: Path, size: int) -> ImageFont.FreeTypeFont:
    if not path.exists():
        raise SystemExit(f"missing font {path}; the feature graphic needs a real face")
    return ImageFont.truetype(str(path), size)


def feature_graphic() -> Image.Image:
    """1024x500, the banner at the top of the Play listing.

    Play crops this for some surfaces, so nothing that has to be read sits
    within 10% of an edge, and the mark is the only thing allowed to bleed.
    """
    W, H = 1024, 500
    img = Image.new("RGBA", (W, H), BG)

    # A soft glow behind the globe so the panel dark is not a flat field.
    glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(glow).ellipse([-180, -190, 560, 690], fill=(30, 92, 122, 120))
    img.alpha_composite(glow.filter(ImageFilter.GaussianBlur(90)))

    # The globe sits left of the text with real clearance. The first version of
    # this drew the wordmark at x=468 over a globe whose right limb reached
    # x=538, so the equator ran through the letters and the accent rule printed
    # across the G like a strikethrough. Numbers, not eyeballing: right limb is
    # GLOBE_X + H/2 + H*GLOBE_R, and TEXT_X is asserted clear of it below.
    ss = 4
    GLOBE_X, GLOBE_R, TEXT_X = 40, 0.33, 560
    globe = Image.new("RGBA", (H * ss, H * ss), (0, 0, 0, 0))
    _globe(ImageDraw.Draw(globe), H * ss / 2, H * ss / 2, H * ss * GLOBE_R,
           max(1.0, H * ss * 0.0055))
    img.alpha_composite(globe.resize((H, H), Image.LANCZOS), (GLOBE_X, 0))

    limb = GLOBE_X + H / 2 + H * GLOBE_R
    assert TEXT_X - limb >= 40, f"text starts {TEXT_X - limb:.0f}px from the limb"

    d = ImageDraw.Draw(img)
    # The rule goes ABOVE the wordmark. Through it, it reads as a strikethrough.
    d.line([TEXT_X + 2, 140, TEXT_X + 66, 140], fill=ACCENT, width=3)
    d.text((TEXT_X, 162), "Graticule", font=_font(FONT_BOLD, 82),
           fill=(233, 240, 247))
    d.text((TEXT_X, 282), "Live weather, sky and sea", font=_font(FONT_REG, 33),
           fill=(168, 179, 194))
    d.text((TEXT_X, 324), "on a 3D globe", font=_font(FONT_REG, 33),
           fill=(168, 179, 194))

    # Nothing readable within 10% of an edge, because Play crops this.
    widest = max(d.textlength("Graticule", font=_font(FONT_BOLD, 82)),
                 d.textlength("Live weather, sky and sea", font=_font(FONT_REG, 33)))
    assert TEXT_X + widest <= W * 0.93, f"text runs to {TEXT_X + widest:.0f} of {W}"
    return img.convert("RGB")


def store() -> list[Path]:
    STORE.mkdir(parents=True, exist_ok=True)
    made = []
    # Play wants a 512x512 32-bit PNG. The web icon is already exactly that
    # mark at exactly that size, so copying it keeps one source of truth
    # instead of a second drawing that drifts.
    p = STORE / "play-icon-512.png"
    build(512, maskable=False).save(p, optimize=True)
    made.append(p)

    p = STORE / "play-feature-graphic-1024x500.png"
    feature_graphic().save(p, optimize=True)
    made.append(p)
    return made


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

    made += android()
    made += store()

    for p in made:
        print(f"{p.relative_to(ROOT)}  {p.stat().st_size:,} bytes")


if __name__ == "__main__":
    main()
