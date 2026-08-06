"""Look at the globe. Nothing else in this repo does.

Don found a hole through the North Pole by tilting the camera and looking at
it, while 112 automated checks passed. Every one of those checks reads STATE:
counts, flags, layer objects, DOM attributes. Both defects he found were
PIXELS, so none of them could see either one.

This suite renders the globe from the angles a person reaches in the first
minute and inspects the resulting image. Two independent detectors, because
one clever trick that happens to work is not a test suite:

  1. SENTINEL. Set globe.baseColor to magenta. That colour is what shows
     through wherever no imagery is drawn, and nothing else in the app is
     magenta. When the app is correct the sentinel is invisible, so it costs
     nothing; when imagery is missing it is a screaming pink hole. This is
     the detector that would have caught the polar gap on the day it shipped.

  2. GOLDEN FRAME. Compare against a committed reference image. Catches
     everything the sentinel cannot: a smear, a wrong colour grade, a cap
     pasted on at the wrong brightness, terrain gone flat, atmosphere gone.

The render is forced deterministic first (clock frozen at the solstice, every
data layer off), or the frames would differ run to run with the sun and the
live feeds and the goldens would be noise. Each view is then captured twice:
once flat-lit with the sentinel showing, because sun shading multiplies the
surface colour and would hide a magenta gap on the night side, and once lit
the way a person sees it, which is the frame that becomes the golden.

    py -V:3.13 scripts/globe_visual_test.py 8743
    py -V:3.13 scripts/globe_visual_test.py 8743 --update    # rebuild goldens
    py -V:3.13 scripts/globe_visual_test.py 8743 --selftest  # prove it can fail

Playwright lives in the 3.13 interpreter, not the project venv.
"""

import argparse
import asyncio
import base64
import io
import pathlib
import sys

from PIL import Image, ImageChops
from playwright.async_api import async_playwright

HERE = pathlib.Path(__file__).resolve().parent
REFDIR = HERE / "visual_reference"
OUTDIR = HERE / "_visual_out"

# Capture at working size, store and compare at half. Half is still ~700x425,
# far more than enough to see a hole in a planet, and keeps the committed
# reference set around 1 MB instead of 4.
SHOT = (1400, 850)
CMP = (700, 425)

# lookAt(target, HeadingPitchRange) frames the TARGET from a distance, which is
# what "tilt north and look at the pole" actually means. camera.setView with a
# pitch aims FROM an altitude and puts the globe off screen entirely.
#
#                name          lon     lat   heading  pitch      range m
VIEWS = [
    ("north_pole",           -90.0,   90.0,      0,     -30,   9_000_000),
    ("south_pole",             0.0,  -90.0,      0,     -30,   9_000_000),
    ("north_pole_overhead",  -90.0,   90.0,      0,     -90,   7_000_000),
    ("na_oblique",          -100.0,   55.0,      0,     -35,  11_000_000),
    ("full_globe",           -95.0,   25.0,      0,     -90,  22_000_000),
    ("dateline",             179.0,   35.0,      0,     -45,  14_000_000),
    ("regional",             -97.0,   38.0,      0,     -55,   2_400_000),
]

# One view cannot be expressed as lookAt, because it is defined relative to the
# SUN rather than to a place: stand off the night side, look straight down the
# sun vector, then slide sideways until the star clears the limb. It is the
# only geometry in which the lens flare is supposed to fire, so without it the
# gate added to lensFlareWanted() would be untested in the direction that
# matters -- a feature that can never switch on looks exactly like a fixed bug.
SUNWARD_VIEW = ("sunward_limb", """() => {
  const v = window.__graticule_viewer;
  const [lat, lon] = subsolarLatLon(Cesium.JulianDate.toDate(v.clock.currentTime));
  const u = Cesium.Cartesian3.normalize(
    Cesium.Cartesian3.fromDegrees(lon, lat, 0), new Cesium.Cartesian3());
  const side = Cesium.Cartesian3.normalize(
    Cesium.Cartesian3.cross(u, Cesium.Cartesian3.UNIT_Z, new Cesium.Cartesian3()),
    new Cesium.Cartesian3());
  // 22,000 km back along the sun vector puts the Earth at ~17° across; 9,000 km
  // of lateral offset moves the star clear of that disc but keeps both in frame.
  const pos = Cesium.Cartesian3.add(
    Cesium.Cartesian3.multiplyByScalar(u, -22_000_000, new Cesium.Cartesian3()),
    Cesium.Cartesian3.multiplyByScalar(side, 9_000_000, new Cesium.Cartesian3()),
    new Cesium.Cartesian3());
  v.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
  v.camera.setView({ destination: pos, orientation: { direction: u, up: Cesium.Cartesian3.UNIT_Z } });
  return sunIsInFrame();
}""")

# Magenta. Chosen because it cannot occur in satellite imagery, in the sea-ice
# tone of the polar caps, or in the star field.
SENTINEL = (255, 0, 255)
SENTINEL_TOL = 60          # per-channel; generous, the gap is unmistakable
# Antialiasing along the limb can leave a thin fringe. 0.02% of a 700x425
# frame is 60 pixels; the polar gap was tens of thousands.
SENTINEL_MAX_FRAC = 0.0002

# Golden comparison. SwiftShader is not bit-exact across driver updates, so a
# per-pixel delta under 12/255 is treated as the same picture.
GOLDEN_TOL = 12
GOLDEN_MAX_FRAC = 0.015

results = []


def check(name, ok, detail=""):
    results.append((name, ok, detail))
    print(f"  {'PASS' if ok else 'FAIL'}  {name}" + (f"   {detail}" if detail else ""),
          flush=True)


# --------------------------------------------------------------------------
# Page-side setup. Everything here removes a source of run-to-run variation.
# --------------------------------------------------------------------------

DETERMINISTIC = """() => {
  const v = window.__graticule_viewer;

  // The North America lock is a feature. In a harness it flies the camera
  // home between captures and every view after the first becomes NA.
  settings.lockNorthAmerica = false;
  applyNorthAmericaLock(false);
  settings.idleRotateSec = 0;

  // The sun is driven off the clock, and the clock is real time. Stop it.
  // Solstice, so the north cap is inspected in full polar DAY and the south
  // cap in full polar NIGHT -- the case that made MODIS paint a black disc.
  v.clock.shouldAnimate = false;
  v.clock.currentTime = Cesium.JulianDate.fromIso8601('2026-06-21T18:00:00Z');

  // Live data moves between runs; the subject here is the globe itself.
  let off = 0;
  document.querySelectorAll('input[data-layer]').forEach(cb => {
    if (cb.checked && !cb.disabled) {
      cb.checked = false;
      cb.dispatchEvent(new Event('change', { bubbles: true }));
      off++;
    }
  });

  v.scene.requestRender();
  return { off, scenery: window.__graticule_scenery || null };
}"""

# Pass A. Sun shading multiplies the surface colour, so on the night side a
# magenta gap renders near-black and the sentinel misses it. Flat light is the
# only condition under which the detector reads true at both poles.
SENTINEL_PASS = f"""() => {{
  const v = window.__graticule_viewer;
  settings.sunLighting = false;
  applySunLighting(false);
  // The flare paints mirrored rainbow ghosts, and a rainbow contains magenta.
  // Leaving it on would let it forge the very colour this pass is counting.
  applyLensFlare(false);
  v.scene.globe.baseColor =
    Cesium.Color.fromBytes({SENTINEL[0]}, {SENTINEL[1]}, {SENTINEL[2]}, 255);
  v.scene.requestRender();
}}"""

# Pass B. What a person actually sees. This is the frame that gets looked at
# and the frame the golden is built from.
APPEARANCE_PASS = """() => {
  const v = window.__graticule_viewer;
  v.scene.globe.baseColor = Cesium.Color.fromBytes(0, 0, 128, 255);
  settings.sunLighting = true;
  applySunLighting(true);
  syncLensFlare();
  v.scene.requestRender();
}"""

# The defect Don found, reintroduced on purpose: hide the polar backstop and
# the caps are bare base colour again. A suite that has never been seen to
# fail is a suite that proves nothing.
INJECT_DEFECT = """() => {
  if (!polarBackstopLayers.length) return 0;
  for (const l of polarBackstopLayers) l.show = false;
  window.__graticule_viewer.scene.requestRender();
  return polarBackstopLayers.length;
}"""

LOOK_AT = """([lon, lat, hd, pt, rng]) => {
  const v = window.__graticule_viewer;
  v.camera.lookAt(
    Cesium.Cartesian3.fromDegrees(lon, lat, 0),
    new Cesium.HeadingPitchRange(Cesium.Math.toRadians(hd),
                                 Cesium.Math.toRadians(pt), rng));
  // Release the reference frame, or every later lookAt is relative to this
  // one and the views drift.
  v.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
}"""

# Cesium reports tilesLoaded true for a frame mid-stream, so require it to
# hold. A snapshot taken one frame early is a grey rectangle.
SETTLE = """async (timeoutMs) => {
  const v = window.__graticule_viewer;
  const started = performance.now();
  let streak = 0;
  while (performance.now() - started < timeoutMs) {
    v.scene.requestRender();
    await new Promise(r => setTimeout(r, 350));
    streak = v.scene.globe.tilesLoaded ? streak + 1 : 0;
    if (streak >= 4) break;
  }
  // A few more frames so the last texture upload lands.
  for (let i = 0; i < 3; i++) {
    v.scene.requestRender();
    await new Promise(r => setTimeout(r, 250));
  }
  return { settled: streak >= 4, ms: Math.round(performance.now() - started) };
}"""

GRAB = """() => window.__graticule_viewer.canvas.toDataURL('image/png')"""


# --------------------------------------------------------------------------
# Image analysis
# --------------------------------------------------------------------------

def sentinel_fraction(img):
    """Fraction of pixels showing the base colour, i.e. no imagery drawn."""
    px = img.convert("RGB").load()
    w, h = img.size
    hits = 0
    for y in range(h):
        for x in range(w):
            r, g, b = px[x, y]
            if (abs(r - SENTINEL[0]) <= SENTINEL_TOL
                    and abs(g - SENTINEL[1]) <= SENTINEL_TOL
                    and abs(b - SENTINEL[2]) <= SENTINEL_TOL):
                hits += 1
    return hits / float(w * h), hits


def golden_fraction(img, ref):
    """Fraction of pixels differing from the reference by more than GOLDEN_TOL."""
    a = img.convert("RGB")
    b = ref.convert("RGB")
    if a.size != b.size:
        return 1.0, None
    diff = ImageChops.difference(a, b)
    # Max of the three channel deltas per pixel.
    r, g, bl = diff.split()
    worst = ImageChops.lighter(ImageChops.lighter(r, g), bl)
    hist = worst.histogram()
    over = sum(hist[GOLDEN_TOL + 1:])
    return over / float(a.size[0] * a.size[1]), diff


def variety(img):
    """Distinct quantised colours. A blank or single-tone frame is broken."""
    b = img.convert("RGB").resize((160, 100)).tobytes()
    return len({(b[i] >> 4, b[i + 1] >> 4, b[i + 2] >> 4)
                for i in range(0, len(b), 3)})


# --------------------------------------------------------------------------

async def run(port, update, selftest, terrain):
    OUTDIR.mkdir(exist_ok=True)
    REFDIR.mkdir(exist_ok=True)
    qs = "" if terrain else "?terrain=off"
    url = f"http://127.0.0.1:{port}/{qs}"
    print(f"globe visual test -> {url}"
          + ("   [UPDATING GOLDENS]" if update else "")
          + ("   [SELFTEST: defect injected]" if selftest else ""), flush=True)

    errors = []
    async with async_playwright() as p:
        br = await p.chromium.launch(args=[
            "--use-gl=angle", "--use-angle=swiftshader",
            "--enable-unsafe-swiftshader", "--disable-dev-shm-usage",
        ])
        pg = await br.new_page(viewport={"width": SHOT[0], "height": SHOT[1]})
        pg.on("pageerror", lambda e: errors.append(str(e)))
        await pg.goto(url, wait_until="load")
        await pg.wait_for_function(
            "() => window.__graticule_viewer && window.__graticule_viewer.scene",
            timeout=90_000)
        await asyncio.sleep(25)          # boot: imagery, terrain, first feeds

        det = await pg.evaluate(DETERMINISTIC)
        print(f"  deterministic: {det['off']} data layers off, clock frozen at "
              f"2026-06-21T18:00Z", flush=True)

        # The polar backstop shipped once as an undeclared constant that threw
        # into a swallowed console.warn. One cheap state read closes that hole
        # permanently; the pixel checks below close it independently.
        sc = det.get("scenery") or {}
        check("polar backstop installed", sc.get("polarCaps") == 2,
              f"{sc.get('polarCaps')} caps, source={sc.get('polarSource')}")

        if selftest:
            hidden = await pg.evaluate(INJECT_DEFECT)
            print(f"  selftest: hid {hidden} polar backstop layers", flush=True)

        async def capture(tag):
            settle = await pg.evaluate(SETTLE, 45_000)
            data = await pg.evaluate(GRAB)
            raw = base64.b64decode(data.split(",", 1)[1])
            (OUTDIR / f"{tag}.png").write_bytes(raw)
            return Image.open(io.BytesIO(raw)).convert("RGB").resize(CMP), settle

        plan = [(n, LOOK_AT, [lon, lat, hd, pt, rng])
                for n, lon, lat, hd, pt, rng in VIEWS]
        plan.append((SUNWARD_VIEW[0], SUNWARD_VIEW[1], None))

        for name, positioner, arg in plan:
            aimed = (await pg.evaluate(positioner, arg) if arg is not None
                     else await pg.evaluate(positioner))
            if name == SUNWARD_VIEW[0]:
                check("lens flare can still fire", aimed is True,
                      f"sunIsInFrame()={aimed} with the star aimed at")

            # Pass A: flat light, magenta base. Is any imagery missing?
            await pg.evaluate(SENTINEL_PASS)
            probe, settle = await capture(f"{name}.sentinel")
            print(f"\n[{name}] tiles settled={settle['settled']} "
                  f"in {settle['ms']}ms", flush=True)
            frac, hits = sentinel_fraction(probe)
            check(f"{name}: no imagery gap", frac <= SENTINEL_MAX_FRAC,
                  f"{hits} base-colour px ({frac * 100:.4f}%, "
                  f"limit {SENTINEL_MAX_FRAC * 100:.4f}%)")

            # Pass B: lit like the product. Does it still look like itself?
            await pg.evaluate(APPEARANCE_PASS)
            img, _ = await capture(name)

            v = variety(img)
            check(f"{name}: frame has content", v >= 12, f"{v} distinct tones")

            refpath = REFDIR / f"{name}.png"
            if update:
                img.save(refpath)
                print(f"  wrote golden {refpath.name}", flush=True)
            elif not refpath.exists():
                check(f"{name}: golden exists", False, "run with --update")
            else:
                ref = Image.open(refpath)
                gfrac, diff = golden_fraction(img, ref)
                ok = gfrac <= GOLDEN_MAX_FRAC
                if not ok and diff is not None:
                    diff.save(OUTDIR / f"{name}.diff.png")
                check(f"{name}: matches golden", ok,
                      f"{gfrac * 100:.3f}% of pixels differ "
                      f"(limit {GOLDEN_MAX_FRAC * 100:.3f}%)")

        await br.close()

    check("no JS errors during sweep", not errors, "; ".join(errors[:3]))

    passed = sum(1 for _, ok, _ in results if ok)
    failed = len(results) - passed
    print(f"\n{'=' * 62}\n{passed} passed, {failed} failed", flush=True)
    print(f"frames: {OUTDIR}", flush=True)

    if selftest:
        # Inverted: with the defect injected the polar views MUST fail.
        polar = [ok for n, ok, _ in results
                 if n.startswith(("north_pole", "south_pole")) and "gap" in n]
        if polar and not all(polar):
            print("SELFTEST OK: the injected polar gap was detected.", flush=True)
            return 0
        print("SELFTEST FAILED: the suite did not notice a hole in the "
              "planet. It cannot be trusted.", flush=True)
        return 1

    return 1 if failed else 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("port", nargs="?", default="8743")
    ap.add_argument("--update", action="store_true",
                    help="rewrite the committed reference frames")
    ap.add_argument("--selftest", action="store_true",
                    help="inject the polar gap and require the suite to catch it")
    ap.add_argument("--terrain", action="store_true",
                    help="render with real elevation (slower under SwiftShader)")
    a = ap.parse_args()
    sys.exit(asyncio.run(run(a.port, a.update, a.selftest, a.terrain)))


if __name__ == "__main__":
    main()
