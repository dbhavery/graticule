"""Does boot block the main thread, and are the borders in the right place?

Issue 51: at phone size the app froze for about eight seconds while it turned
9 MB of border GeoJSON into something drawable. Issue 50 is probably the same
bug wearing a different hat -- a main thread that is busy for four seconds is
a hardware back press that nobody is listening for.

    py -V:3.13 scripts/border_perf_test.py [port] [--swiftshader] [--control]

---- What this file got wrong for three sessions, and what changed -----------

The blocking half of this test used to run under SwiftShader and gate the
result against Android's input-dispatch budget. Those are not the same
quantity, and the gap is not small. Measured by scripts/boot_attrib.py, same
build, same 412x915 viewport, same instrument:

                             blocking    worst   what dominated it
    SwiftShader                  4,893    1,891  the software rasteriser
    real GPU, cold shaders       4,276    1,638  shader linking, 80-95%
    real GPU, warm shaders         478      316  nothing in particular
    emulator, cold              20,453    1,968  spread across everything

A fixed 512x512 `readPixels` control measured 3 ms on the card and up to
12,000 ms under SwiftShader in the same script on the same machine. One chunk
of twelve labels measured 196 ms on the card and 6,228 ms under SwiftShader.
Those are the numbers this gate was reading as app behaviour.

The 2026-08-08 handoff already caught one instance of this (a 4,754 ms
`getImageData` that was SwiftShader initialising its canvas backend) and
concluded that this file "survives because it does measure JS-only work
honestly". That conclusion was wrong, and it is why last session's real work
-- border GPU upload cut from 372.5 MB to 120.0 MB -- moved this test by
nothing. With every border file aborted at the network layer, the no-borders
FLOOR on the real GPU is 3,715-4,472 ms of blocking against the full build's
4,276-6,231. Borders were never what this gate was measuring.

So the milliseconds are now gated where they can be measured:

  * on the real GPU, on the WARM boot -- the one a user gets on every launch
    after the first. It passes today, which is the point: a gate that cannot
    pass is not a gate, and this one had been permanently red for reasons no
    change to this repo could move.
  * the COLD boot and the full attribution are printed, not gated. Cold is
    first-launch-after-install, and it is dominated by Cesium linking ~27
    shader programs. CesiumJS has never supported KHR_parallel_shader_compile
    -- not in 1.121, not on main at 1.145 -- so every one of them blocks the
    frame that first needs it. That is not fixable here.
  * under --swiftshader the millisecond gates are SKIPPED, loudly, because the
    control in this file demonstrates they would be measuring the rasteriser.

  * the number of shader programs linked IS gated, on any rasteriser, because
    it is deterministic and the app controls it: it is how a new imagery layer
    or a grade that toggles a shader flag mid-boot would show up.

The device answer -- the one the 1,000 ms threshold is actually about -- comes
from scripts/apk_boot_attrib.py, which runs this same instrument inside the
APK's WebView. It is worse than anything here: 20,453 ms of blocking, and only
12% of it is shaders. See issues.md 69.

---- The border math ---------------------------------------------------------

border-worker.js converts degrees to ECEF itself rather than dragging 4 MB of
Cesium into a worker, which means there are two implementations of the one
formula that decides where every border on the globe lands. This asserts they
agree to sub-millimetre, and it carries a CONTROL -- a spherical-earth
conversion, which is what you get if the eccentricity term is dropped -- that
must fail the same assertion by kilometres. Without the control a passing
agreement check proves only that the comparison ran.

`--control` loads `?borderworker=off`, which forces the inline main-thread
parse, as the A/B for the worker half of the fix.
"""
from __future__ import annotations

import asyncio
import json
import sys

from playwright.async_api import async_playwright

# Imported, not copied. The desktop gate, the diagnostic and the device script
# must run the SAME instrument or their numbers are three vocabularies rather
# than one comparison.
from boot_attrib import GPU_ARGS, INSTR, READ, SWIFT_ARGS, attribute, inside, stats

PORT = "8744"
CONTROL = False
FORCE_SWIFT = False
for a in sys.argv[1:]:
    if a == "--control":
        CONTROL = True
    elif a == "--swiftshader":
        FORCE_SWIFT = True
    else:
        PORT = a

BASE = f"http://127.0.0.1:{PORT}/"
URL = BASE + ("?borderworker=off" if CONTROL else "")

# A Pixel 8 viewport.
DEVICE = {"width": 412, "height": 915}

# How long to watch. Boot has to be finished inside this or the numbers are a
# measurement of the timeout; the script prints when the last task actually
# landed, which is ~8 s on the real GPU and ~39 s on the emulator.
WINDOW_S = 50

# The gate, unchanged since issue 51: Android's input-dispatch ANR is 5 s, a
# back press that waits a second already feels broken, and the app must be able
# to answer a key while it boots. What changed is WHERE these are applied.
MAX_SINGLE_TASK_MS = 1000
MAX_TOTAL_BLOCKING_MS = 2500

# Cesium links one program per distinct shader variant, and the app controls
# how many variants exist: every imagery layer, and every flag that toggles
# mid-boot, multiplies them. Observed 21-29 across both rasterisers and the
# device. 34 leaves room for tile-count drift and still fails if a change adds
# a handful of new variants.
MAX_SHADER_PROGRAMS = 34
# And a floor, because `len([]) <= 34` is true and an instrument that failed to
# install produces exactly that.
MIN_SHADER_PROGRAMS = 12

# Sub-millimetre. The GeoJSON is rounded to 5 decimal places (1.1 m), so a
# formula that agrees this closely cannot be what moves a border.
MAX_ECEF_ERROR_M = 1e-3

ok: list[str] = []
bad: list[str] = []
skipped: list[str] = []


def chk(cond: bool, msg: str) -> None:
    (ok if cond else bad).append(msg)
    print(("  PASS  " if cond else "  FAIL  ") + msg)


def skip(msg: str, why: str) -> None:
    skipped.append(msg)
    print(f"  SKIP  {msg}\n         {why}")


ECEF = """async (workerSrc) => {
  const g = (0, eval)(workerSrc + ';window.__toEcef = toEcef;');
  const pts = [];
  for (let lat = -85; lat <= 85; lat += 5) {
    for (let lon = -180; lon < 180; lon += 15) pts.push([lon, lat]);
  }
  // The places a formula breaks: poles, dateline, prime meridian, equator.
  pts.push([0, 0], [180, 0], [-180, 0], [0, 90], [0, -90], [179.99999, 89.99999]);

  const out = new Float64Array(3);
  let maxErr = 0, maxAt = null, maxSphere = 0;
  const A = 6378137.0;
  for (const [lon, lat] of pts) {
    const want = Cesium.Cartesian3.fromDegrees(lon, lat, 0);
    window.__toEcef(lon, lat, out, 0);
    const err = Math.hypot(out[0] - want.x, out[1] - want.y, out[2] - want.z);
    if (err > maxErr) { maxErr = err; maxAt = [lon, lat]; }

    // CONTROL: a sphere of radius a, which is the same code with the
    // eccentricity term dropped. If this does NOT blow the threshold, the
    // comparison above is not sensitive enough to catch a wrong formula.
    const la = lat * Math.PI / 180, lo = lon * Math.PI / 180;
    const sx = A * Math.cos(la) * Math.cos(lo);
    const sy = A * Math.cos(la) * Math.sin(lo);
    const sz = A * Math.sin(la);
    maxSphere = Math.max(maxSphere, Math.hypot(sx - want.x, sy - want.y, sz - want.z));
  }
  return {points: pts.length, maxErr, maxAt, maxSphere};
}"""

# A stall the instrument must see, and the evidence for the SwiftShader skip
# above. A 1 MB readback is a hard pipeline flush: microseconds of work and
# whatever the driver owes.
RASTERISER_CONTROL = """() => {
  const gl = window.__graticule_viewer.scene.context._gl;
  const t0 = performance.now();
  const px = new Uint8Array(4 * 512 * 512);
  gl.readPixels(0, 0, 512, 512, gl.RGBA, gl.UNSIGNED_BYTE, px);
  return Math.round(performance.now() - t0);
}"""

# The gate's own control. `--control` (the inline main-thread parse) moves the
# warm numbers 5x -- 241 ms of blocking to 1,281, worst 205 ms to 623 -- but on
# desktop hardware it does not cross a threshold sized for a phone, so it
# proves the gate is SENSITIVE and not that it can FAIL. This does: a
# deliberate stall, longer than the budget, which the gate must reject. If this
# passes, every green above is worthless.
BURN_MS = 1500
BURN = """
setTimeout(() => {
  const end = performance.now() + %d;
  while (performance.now() < end) { /* hold the main thread */ }
  window.__burnDone = true;
}, 3000);
""" % BURN_MS

RENDERER = """() => {
  const gl = window.__graticule_viewer.scene.context._gl;
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)
             : gl.getParameter(gl.RENDERER);
}"""


def note_console(m, errors: list[str], foreign: list[str], built: list[str]) -> None:
    """Split OUR errors from the tile servers'.

    This check exists to catch the classic native bug: a file the shell asks
    for that is not in dist/, which shows as a same-origin 404 and a white
    screen. It was also failing on a single unnamed 404 from ESRI or
    RainViewer roughly one run in three, and a gate that cries wolf is the
    disease this whole file is being treated for. Same-origin still fails.
    """
    if "border lines" in m.text:
        built.append(m.text)
    if m.type != "error":
        return
    loc = (m.location or {}).get("url") or ""
    entry = f"{m.text} [{loc[:120]}]" if loc else m.text
    # No URL means it came from app code, not the network stack, so it is ours.
    (foreign if loc and not loc.startswith(BASE) else errors).append(entry)


async def boot(br, errors: list[str], foreign: list[str], built: list[str]) -> tuple:
    """One full boot in a fresh context, watched for WINDOW_S.

    The BROWSER is reused by the caller, so the second call gets Chromium's
    on-disk compiled-shader cache already populated while still starting from
    an empty page cache and empty localStorage.
    """
    ctx = await br.new_context(viewport=DEVICE, device_scale_factor=3,
                              is_mobile=True, has_touch=True)
    await ctx.add_init_script(INSTR)
    pg = await ctx.new_page()
    pg.on("console", lambda m: note_console(m, errors, foreign, built))
    pg.on("pageerror", lambda e: errors.append(f"PAGEERROR {e}"))

    await pg.goto(URL, wait_until="load")
    await pg.wait_for_function(
        "()=>window.__graticule_viewer && window.__graticule_viewer.scene", timeout=90_000)
    await asyncio.sleep(WINDOW_S)
    res = await pg.evaluate(READ)
    return ctx, pg, res


def show(label: str, res: dict) -> dict:
    st = stats(res["longtasks"])
    print(f"\n== {label} ==")
    if res["err"]:
        print(f"   OBSERVER FAILED: {res['err']}")
    print(f"   long tasks     {st['count']}")
    print(f"   total task ms  {st['totalTaskMs']}")
    print(f"   blocking ms    {st['blockingMs']}   (task time over 50 ms)")
    print(f"   worst task ms  {st['worstMs']}")
    print(f"   last task at   {st['lastEndMs']} ms after navigation")

    progs = res.get("programs") or []
    link_ms = sum(p.get("ms", 0) for p in progs)
    print(f"   shader links   {len(progs)} programs, {link_ms:.0f} ms blocked "
          f"in getProgramParameter(LINK_STATUS)")

    rows = [r for r in attribute(res) if r[1] >= 25]
    print(f"   {'where it went':<34}{'self ms':>9}{'calls':>8}")
    for name, ms, n, _worst in rows[:8]:
        print(f"   {name:<34}{ms:>9.0f}{n:>8}")

    worst = sorted(res["longtasks"], key=lambda e: -e[1])[:3]
    for t, d in worst:
        parts = sorted(
            ((nm, inside(v["spans"], t, t + d)) for nm, v in res["calls"].items()),
            key=lambda p: -p[1])
        head = ", ".join(f"{n} {m:.0f}" for n, m in parts[:3] if m >= 15)
        print(f"     worst t={t:>7.0f} {d:>6.0f} ms   {head or 'nothing named'}")
    return st


async def main() -> None:
    async with async_playwright() as p:
        br = await p.chromium.launch(
            args=SWIFT_ARGS if FORCE_SWIFT else GPU_ARGS, chromium_sandbox=False)
        errors: list[str] = []
        foreign: list[str] = []
        built: list[str] = []

        print(f"== boot, {DEVICE['width']}x{DEVICE['height']}, {WINDOW_S}s window ==")
        print(f"   {URL}")

        # ---- Boot 1: cold compiled-shader cache -----------------------------
        ctx1, pg1, cold = await boot(br, errors, foreign, built)
        renderer = await pg1.evaluate(RENDERER)
        rasteriser_ms = await pg1.evaluate(RASTERISER_CONTROL)
        # --gpu is a request, not a fact: ANGLE falls back silently, and every
        # millisecond below would then be a SwiftShader millisecond wearing a
        # GPU label.
        hardware = not FORCE_SWIFT and "swiftshader" not in renderer.lower() \
            and "software" not in renderer.lower()
        print(f"   renderer       {renderer}")
        print(f"   rasteriser control: a 512x512 readPixels cost {rasteriser_ms} ms")
        show("boot 1, COLD compiled-shader cache (first launch after install)", cold)
        chk(cold["err"] is None,
            f"the longtask observer attached ({cold['err'] or 'ok'})")
        chk(len(built) >= 2,
            f"both boundary files finished inside the window ({len(built)}/2)")
        for line in built:
            print(f"         {line[:88]}")
        await ctx1.close()

        # ---- Boot 2: warm ---------------------------------------------------
        built.clear()
        ctx2, pg2, warm = await boot(br, errors, foreign, built)
        st = show("boot 2, WARM compiled-shader cache (every launch after the "
                  "first) -- THIS is what is gated", warm)

        # The instrument first. Every number above and below is a count of
        # things a wrapper saw, so a wrapper that did not install reads as a
        # clean, passing zero -- including the shader budget, which an empty
        # list satisfies trivially.
        chk(warm["wrapped"] >= 15 and warm["glWrapped"] >= 15 and warm["ctxs"] >= 1,
            f"the instrument installed ({warm['wrapped']} cesium, "
            f"{warm['glWrapped']} gl, {warm['ctxs']} context) -- without this "
            f"the numbers below are zeroes, not measurements")

        progs = warm.get("programs") or []
        chk(MIN_SHADER_PROGRAMS <= len(progs) <= MAX_SHADER_PROGRAMS,
            f"boot links between {MIN_SHADER_PROGRAMS} and "
            f"{MAX_SHADER_PROGRAMS} shader programs ({len(progs)}) -- the app "
            f"controls this through its imagery layers and any flag that "
            f"toggles mid-boot, and a floor is here because an empty list "
            f"passes a ceiling for free")

        if hardware:
            chk(st["worstMs"] <= MAX_SINGLE_TASK_MS,
                f"no single task blocks longer than {MAX_SINGLE_TASK_MS} ms "
                f"(worst {st['worstMs']} ms)")
            chk(st["blockingMs"] <= MAX_TOTAL_BLOCKING_MS,
                f"total blocking stays under {MAX_TOTAL_BLOCKING_MS} ms "
                f"({st['blockingMs']} ms)")
        else:
            why = (f"this run is on {renderer}. The control above measured "
                   f"{rasteriser_ms} ms for a readback that costs 3 ms on the "
                   f"card, so these milliseconds are the rasteriser's, not the "
                   f"app's. Run without --swiftshader, or use "
                   f"scripts/apk_boot_attrib.py for the device.")
            skip(f"worst task under {MAX_SINGLE_TASK_MS} ms "
                 f"(measured {st['worstMs']} ms)", why)
            skip(f"total blocking under {MAX_TOTAL_BLOCKING_MS} ms "
                 f"(measured {st['blockingMs']} ms)", why)

        # ---- The border math ------------------------------------------------
        # Read before the boot pages close and before the probe page opens:
        # same-origin pages share a renderer process, so a page left spinning
        # Cesium turns the responsiveness probe into a measurement of that
        # page's stall on top of its own.
        print("\n== the worker's ECEF agrees with Cesium ==")
        src = await pg2.evaluate(
            "async () => (await fetch('/static/border-worker.js')).text()")
        e = await pg2.evaluate(ECEF, src)
        print(f"   {e['points']} points, worst error {e['maxErr']:.6f} m at {e['maxAt']}")
        print(f"   control (spherical earth) worst error {e['maxSphere']:.1f} m")
        chk(e["maxErr"] <= MAX_ECEF_ERROR_M,
            f"the worker's WGS84 conversion matches Cesium.Cartesian3.fromDegrees "
            f"to {MAX_ECEF_ERROR_M} m (worst {e['maxErr']:.2e} m over {e['points']} points)")
        chk(e["maxSphere"] > 1000,
            f"and the control fails it by {e['maxSphere']:.0f} m, so the check above "
            f"can actually catch a wrong formula")
        await ctx2.close()

        # ---- Responsiveness, which is the thing the numbers stand for -------
        # A stall only matters because it eats input. This asks the page a
        # question during boot and times the answer. It runs third, so the
        # shader cache is warm and it measures the same boot the gates above
        # do -- the old version opened a cold page here and reported first-ever
        # shader compilation as the back button's window.
        print("\n== can the page answer while it boots (warm) ==")
        ctx3 = await br.new_context(viewport=DEVICE, device_scale_factor=3,
                                    is_mobile=True, has_touch=True)
        pg3 = await ctx3.new_page()
        pg3.on("pageerror", lambda ev: errors.append(f"PAGEERROR {ev}"))
        await pg3.goto(URL, wait_until="load")
        probe = await pg3.evaluate("""async () => {
          const worst = [];
          for (let i = 0; i < 60; i++) {
            const t0 = performance.now();
            await new Promise(r => setTimeout(r, 100));
            worst.push(performance.now() - t0 - 100);
          }
          worst.sort((a, b) => b - a);
          return {worstLagMs: Math.round(worst[0]), p90LagMs: Math.round(worst[6])};
        }""")
        print(f"   worst callback lag {probe['worstLagMs']} ms, p90 {probe['p90LagMs']} ms")
        if hardware:
            chk(probe["worstLagMs"] <= MAX_SINGLE_TASK_MS,
                f"a timer scheduled during boot fires within {MAX_SINGLE_TASK_MS} ms of "
                f"its due time (worst {probe['worstLagMs']} ms) -- this is the back "
                f"button's window")
        else:
            skip(f"callback lag under {MAX_SINGLE_TASK_MS} ms "
                 f"(measured {probe['worstLagMs']} ms)",
                 "same reason: the rasteriser owns these milliseconds.")
        await ctx3.close()

        # ---- Does the gate above actually work? -----------------------------
        print(f"\n== control: a deliberate {BURN_MS} ms stall, which the gate "
              f"must reject ==")
        ctx4 = await br.new_context(viewport=DEVICE, device_scale_factor=3,
                                    is_mobile=True, has_touch=True)
        await ctx4.add_init_script(INSTR)
        await ctx4.add_init_script(BURN)
        pg4 = await ctx4.new_page()
        await pg4.goto(URL, wait_until="load")
        await asyncio.sleep(15)
        burn = await pg4.evaluate(READ)
        burned = await pg4.evaluate("() => !!window.__burnDone")
        bst = stats(burn["longtasks"])
        print(f"   burn ran: {burned}   worst task {bst['worstMs']} ms")
        chk(burned, "the deliberate stall actually ran")
        chk(bst["worstMs"] > MAX_SINGLE_TASK_MS,
            f"and the gate rejects it ({bst['worstMs']} ms > "
            f"{MAX_SINGLE_TASK_MS} ms), so a green above means something")
        await ctx4.close()

        chk(not errors, f"no console errors from this app during boot "
            f"({len(errors)})")
        for m in errors[:10]:
            print("   ERR ", m[:200])
        if foreign:
            print(f"   (plus {len(foreign)} error(s) from third-party servers, "
                  f"not gated:)")
            for m in foreign[:5]:
                print("   ext ", m[:160])

        await br.close()

    print(f"\n{len(ok)} passed, {len(bad)} failed, {len(skipped)} skipped")
    for m in bad:
        print("  FAILED:", m)
    for m in skipped:
        print("  SKIPPED:", m)
    print("\nThe device is the only place the 1,000 ms threshold means what it "
          "says:\n  py -V:3.13 scripts/apk_boot_attrib.py --runs 2")
    sys.exit(1 if bad else 0)


asyncio.run(main())
