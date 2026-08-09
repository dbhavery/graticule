"""Does boot block the main thread, and are the borders in the right place?

Issue 51: at phone size the app froze for about eight seconds while it turned
9 MB of border GeoJSON into something drawable. Issue 50 is probably the same
bug wearing a different hat -- a main thread that is busy for four seconds is
a hardware back press that nobody is listening for. Issue 52 is why this file
exists at all: all five existing suites pass with both defects present,
because every one of them measures layout, state or pixels and none of them
measures TIME.

Two things are checked here, and they fail for different reasons.

1. The stall. A `longtask` PerformanceObserver, injected by this harness
   before any application script runs, over a fixed window from navigation.
   Injected rather than read out of the app on purpose: the same instrument
   then works on any build, including one from before the app carried an
   observer of its own, so a before/after is a real comparison instead of two
   different measurements with the same name.

2. The border math. border-worker.js converts degrees to ECEF itself rather
   than dragging 4 MB of Cesium into a worker, which means there are now two
   implementations of the one formula that decides where every border on the
   globe lands. This asserts they agree to sub-millimetre, and it carries a
   CONTROL -- a spherical-earth conversion, which is what you get if the
   eccentricity term is dropped -- that must fail the same assertion by
   kilometres. Without the control a passing agreement check proves only that
   the comparison ran.

    py -V:3.13 scripts/border_perf_test.py [port] [--control]

`--control` loads `?borderworker=off`, which forces the inline main-thread
parse. That is the honest A/B for the WORKER half of the fix: the same build,
the same measurement, one flag. It does not control for the primitive or the
lazy labels -- for those, measure this script against an older commit.
"""
from __future__ import annotations

import asyncio
import json
import statistics
import sys

from playwright.async_api import async_playwright

PORT = "8744"
CONTROL = False
for a in sys.argv[1:]:
    if a == "--control":
        CONTROL = True
    else:
        PORT = a

BASE = f"http://127.0.0.1:{PORT}/"
URL = BASE + ("?borderworker=off" if CONTROL else "")

# A Pixel 8 viewport. This is not a phone -- see issue 52, and section 6 of the
# Android handoff -- but main-thread JS time is the one thing a desktop browser
# at this size does measure honestly, because parsing and object allocation do
# not care what is drawing the frame.
DEVICE = {"width": 412, "height": 915}

# How long to watch. Boot has to be finished inside this or the numbers are a
# measurement of the timeout. Both builds finish their border work well inside
# 50 s on SwiftShader; the script prints when they actually did.
WINDOW_S = 50

# The gate. These are what a phone needs, not a description of what the app
# currently does: Android's input-dispatch ANR is 5 s, a back press that waits
# a second already feels broken, and the whole point of issue 51 is that the
# app must be able to answer a key while it boots.
MAX_SINGLE_TASK_MS = 1000
MAX_TOTAL_BLOCKING_MS = 2500

# Sub-millimetre. The GeoJSON is rounded to 5 decimal places (1.1 m), so a
# formula that agrees this closely cannot be what moves a border.
MAX_ECEF_ERROR_M = 1e-3

ok: list[str] = []
bad: list[str] = []


def chk(cond: bool, msg: str) -> None:
    (ok if cond else bad).append(msg)
    print(("  PASS  " if cond else "  FAIL  ") + msg)


# Installed before the first application script. `buffered: true` catches the
# long tasks that land before this line runs on a slow boot.
OBSERVER = """
window.__perf_longtasks = [];
try {
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) {
      if (window.__perf_longtasks.length < 500) {
        window.__perf_longtasks.push({t: Math.round(e.startTime), ms: Math.round(e.duration)});
      }
    }
  }).observe({entryTypes: ['longtask'], buffered: true});
} catch (e) { window.__perf_observer_failed = String(e); }
"""

# Blocking time, the way Lighthouse counts it: everything a task costs beyond
# the 50 ms that makes it "long" in the first place. Total task time flatters
# a build that blocks in many medium chunks; blocking time does not.
READ = """() => {
  const lt = window.__perf_longtasks || [];
  const sorted = lt.map(e => e.ms).sort((a, b) => b - a);
  return {
    observerFailed: window.__perf_observer_failed || null,
    count: lt.length,
    totalTaskMs: lt.reduce((a, e) => a + e.ms, 0),
    blockingMs: lt.reduce((a, e) => a + Math.max(0, e.ms - 50), 0),
    worstMs: sorted[0] || 0,
    top5: lt.slice().sort((a, b) => b.ms - a.ms).slice(0, 5),
    lastTaskEndMs: lt.reduce((a, e) => Math.max(a, e.t + e.ms), 0),
  };
}"""

# The two formulas, side by side, plus the control. `toEcef` is lifted out of
# the real worker file rather than copied here, so this cannot pass against a
# stale duplicate of the thing it is supposed to be guarding.
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


async def main() -> None:
    async with async_playwright() as p:
        br = await p.chromium.launch(args=[
            "--use-gl=angle", "--use-angle=swiftshader",
            "--enable-unsafe-swiftshader", "--disable-dev-shm-usage",
        ])
        ctx = await br.new_context(viewport=DEVICE, device_scale_factor=3,
                                   is_mobile=True, has_touch=True)
        await ctx.add_init_script(OBSERVER)
        pg = await ctx.new_page()

        # Both builds log one of these per boundary file, so it is a build
        # completion signal that does not depend on which build is loaded.
        built: list[str] = []
        errors: list[str] = []
        pg.on("console", lambda m: (
            built.append(m.text) if "border lines" in m.text else None,
            errors.append(m.text) if m.type == "error" else None))
        pg.on("pageerror", lambda e: errors.append(f"PAGEERROR {e}"))

        print(f"== boot, {DEVICE['width']}x{DEVICE['height']}, {WINDOW_S}s window ==")
        print(f"   {URL}")
        await pg.goto(URL, wait_until="load")
        await pg.wait_for_function(
            "()=>window.__graticule_viewer && window.__graticule_viewer.scene", timeout=90_000)
        await asyncio.sleep(WINDOW_S)

        lt = await pg.evaluate(READ)
        chk(lt["observerFailed"] is None,
            f"the longtask observer attached ({lt['observerFailed'] or 'ok'})")
        chk(len(built) >= 2,
            f"both boundary files finished inside the window ({len(built)}/2)")
        for line in built:
            print(f"         {line[:88]}")

        print(f"\n   long tasks     {lt['count']}")
        print(f"   total task ms  {lt['totalTaskMs']}")
        print(f"   blocking ms    {lt['blockingMs']}   (task time over 50 ms)")
        print(f"   worst task ms  {lt['worstMs']}")
        print(f"   last task at   {lt['lastTaskEndMs']} ms after navigation")
        print(f"   top 5          {json.dumps(lt['top5'])}")

        chk(lt["worstMs"] <= MAX_SINGLE_TASK_MS,
            f"no single task blocks longer than {MAX_SINGLE_TASK_MS} ms "
            f"(worst {lt['worstMs']} ms)")
        chk(lt["blockingMs"] <= MAX_TOTAL_BLOCKING_MS,
            f"total blocking stays under {MAX_TOTAL_BLOCKING_MS} ms "
            f"({lt['blockingMs']} ms)")

        # ---- The border math ----------------------------------------------
        # Read before the boot page closes, and before the second page opens:
        # same-origin pages share a renderer process, so a page left spinning
        # Cesium turns the responsiveness probe below into a measurement of
        # this page's stall on top of its own.
        print("\n== the worker's ECEF agrees with Cesium ==")
        src = await pg.evaluate(
            "async () => (await fetch('/static/border-worker.js')).text()")
        e = await pg.evaluate(ECEF, src)
        print(f"   {e['points']} points, worst error {e['maxErr']:.6f} m at {e['maxAt']}")
        print(f"   control (spherical earth) worst error {e['maxSphere']:.1f} m")
        chk(e["maxErr"] <= MAX_ECEF_ERROR_M,
            f"the worker's WGS84 conversion matches Cesium.Cartesian3.fromDegrees "
            f"to {MAX_ECEF_ERROR_M} m (worst {e['maxErr']:.2e} m over {e['points']} points)")
        chk(e["maxSphere"] > 1000,
            f"and the control fails it by {e['maxSphere']:.0f} m, so the check above "
            f"can actually catch a wrong formula")
        await pg.close()

        # ---- Responsiveness, which is the thing the numbers stand for -------
        # A stall only matters because it eats input. This asks the page a
        # question during boot and times the answer, which is as close to "can
        # it handle a back press" as a desktop browser gets.
        print("\n== can the page answer while it boots ==")
        pg2 = await ctx.new_page()
        await pg2.goto(URL, wait_until="load")
        probe = await pg2.evaluate("""async () => {
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
        chk(probe["worstLagMs"] <= MAX_SINGLE_TASK_MS,
            f"a timer scheduled during boot fires within {MAX_SINGLE_TASK_MS} ms of its due "
            f"time (worst {probe['worstLagMs']} ms) -- this is the back button's window")
        await pg2.close()

        chk(not errors, f"no console errors during boot ({len(errors)})")
        for m in errors[:10]:
            print("   ERR ", m[:200])

        await br.close()

    print(f"\n{len(ok)} passed, {len(bad)} failed")
    for m in bad:
        print("  FAILED:", m)
    sys.exit(1 if bad else 0)


asyncio.run(main())
