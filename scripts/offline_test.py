"""Does the globe still draw with no signal?

The Play listing answers say, in Don's words:

    "Boundary and coastline data ships inside the app, so the globe still
     draws with no signal. The live feeds need a connection."

That was false for as long as index.html loaded the engine from cesium.com.
Blocking that one host produced `Cesium is not defined`, no canvas, and the
chrome sitting over a blank page with every counter showing a dash -- which
looks like a working app with no data rather than a broken one. Nothing could
see it: the claim is about behaviour with the network gone, and no check in
this repo had ever taken the network away.

WHAT COUNTS AS OFFLINE HERE, AND WHY THE FIRST VERSION WAS WRONG

The first version of this file blocked every remote host and let the app's own
origin through. It passed, and the screenshot showed satellite imagery, live
radar, 494 alerts and 1,721 aircraft. Of course it did: on a desktop the app's
origin IS the backend, and the backend still had a network. The browser was
offline and nothing else was.

The APK is not shaped like that. `android_build.py` stages exactly ROOT_FILES
plus the whole of web/ under /static, Capacitor serves those from inside the
APK, and everything else -- /api, the tile servers, the feeds -- is remote. So
offline for the APK means: the staged files and nothing else.

That is what this blocks. Only `/` and `/static/*` are allowed through; the
origin's own /api is refused along with every remote host. The live feeds are
gone, which is the listing's second sentence and not a defect.

WHAT THIS ASSERTS

With the app reduced to its bundled files:

  * the engine is defined and a WebGL canvas exists,
  * THE CANVAS HAS A GLOBE ON IT. A canvas element proves nothing -- an
    unpainted one is still an element -- so this reads pixels back and
    requires both a lit body and a dark background, which is what "a sphere on
    space" looks like and what a blank or single-colour canvas does not,
  * nothing was fetched from cesium.com,
  * no page error mentions Cesium.

THREE CONTROLS, BECAUSE THIS TEST LIED TWICE BEFORE IT WORKED

A gate that cannot fail proves nothing, and this one found three separate ways
to pass without measuring anything. Each has a control in the output:

  1. The app's own backend has to have been refused. The first version let the
     origin through, and on a desktop the origin IS the backend, so it
     photographed live radar and 1,721 aircraft and called it offline.
  2. No live feed may have reached the page. The feed is a WebSocket, which
     page.route does not intercept, so a run with every HTTP request blocked
     still showed 494 alerts and 1,332 aircraft. The tell is a COUNT, since
     the word "aircraft" appears in the offline fallback sentence too.
  3. The same checks run again with the LOCAL engine blocked, and that run is
     required to FAIL. If it passes, the pixel rule is true of any page at all
     and nothing above it means anything.

A fourth thing had to be turned off rather than controlled: the service
worker. Playwright does not intercept what a worker fetches on the page's
behalf, and this app's worker is network-first with a cache fallback, so it
walked around the block entirely. `service_workers="block"` is what makes the
block real, and it matches a first launch, which has no warmed cache anyway.

    py -V:3.13 scripts/offline_test.py [port]

The server has to be running. The live feeds are blocked along with everything
else, so this says nothing about them; that is the point of the listing's
second sentence.
"""
from __future__ import annotations

import asyncio
import re
import sys

from playwright.async_api import async_playwright

PORT = sys.argv[1] if len(sys.argv) > 1 else "8731"
ORIGIN = f"http://127.0.0.1:{PORT}"

# Copied in meaning from android_build.py's ROOT_FILES: the files staged at
# the root of the APK bundle rather than under /static.
ROOT_FILES = frozenset([
    "/index.html", "/sw.js", "/manifest.webmanifest", "/offline.html",
    "/favicon.ico",
])

ok: list[str] = []
bad: list[str] = []


def chk(cond: bool, msg: str) -> None:
    (ok if cond else bad).append(msg)
    print(("  PASS  " if cond else "  FAIL  ") + msg)


# Reads the rendered globe back off the GPU. A canvas that was never painted
# comes back uniform; a globe is a lit disc on a dark field, so the test is
# that BOTH exist. Sampling a grid rather than a point because the earlier
# screenshot work in this repo was misled twice by a single pixel.
PIXELS = """() => {
  const cv = document.querySelector('#cesiumContainer canvas');
  if (!cv) return { canvas: false };
  const w = cv.width, h = cv.height;
  const gl = cv.getContext('webgl2', { preserveDrawingBuffer: true })
          || cv.getContext('webgl', { preserveDrawingBuffer: true });
  if (!gl) return { canvas: true, gl: false };
  const px = new Uint8Array(w * h * 4);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
  let lit = 0, dark = 0, seen = 0;
  const step = 16;
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      const i = (y * w + x) * 4;
      const v = (px[i] + px[i + 1] + px[i + 2]) / 3;
      seen += 1;
      if (v > 40) lit += 1; else dark += 1;
    }
  }
  return { canvas: true, gl: true, w, h, seen, lit, dark,
           litPct: Math.round(lit / seen * 100) };
}"""


async def boot(p, block_local: bool) -> dict:
    br = await p.chromium.launch(args=["--disable-dev-shm-usage",
                                       "--hide-scrollbars"])
    # service_workers="block" is not a detail. Playwright's page.route does
    # NOT see requests a service worker makes on the page's behalf, and this
    # app registers one that is network-first with a cache fallback. With the
    # worker running, a "block everything" run photographed live radar, 494
    # alerts and 4,324 aircraft: the worker had gone and fetched them outside
    # the intercept. Blocking it is what makes the block real, and it also
    # matches a first launch, where there is no warmed cache to fall back on.
    ctx = await br.new_context(viewport={"width": 412, "height": 915},
                               device_scale_factor=2, is_mobile=True,
                               has_touch=True, service_workers="block")
    pg = await ctx.new_page()

    remote: list[str] = []
    blocked_local: list[str] = []
    errors: list[str] = []
    pg.on("pageerror", lambda e: errors.append(str(e)[:200]))

    async def gate(route):
        url = route.request.url
        if url.startswith("data:") or url.startswith("blob:"):
            await route.continue_()
            return
        if not url.startswith(ORIGIN):
            remote.append(url)
            await route.abort()
            return
        # Same origin, but only what the APK actually carries. ROOT_FILES plus
        # /static is the whole of android_build.py's staging; /api is the
        # backend and is as far away as any other host.
        path = url[len(ORIGIN):].split("?", 1)[0] or "/"
        staged = path == "/" or path.startswith("/static/") or path in ROOT_FILES
        if not staged or (block_local and "/static/vendor/cesium/" in path):
            if not staged:
                blocked_local.append(path)
            await route.abort()
            return
        await route.continue_()

    # The live feed is a WebSocket, and page.route does not touch those. With
    # it open, a run with every HTTP request blocked still showed 494 alerts,
    # 1,332 aircraft, 379 ships and 787 quakes, because the socket had been
    # connected the whole time. That was the THIRD transport to walk around
    # this block -- after the backend being same-origin, and the service
    # worker fetching outside the intercept -- so the run now asserts what
    # offline looks like rather than only what it forbids.
    await pg.add_init_script(
        "window.WebSocket = class { constructor() {"
        " setTimeout(() => this.onerror && this.onerror(new Event('error')), 0);"
        " setTimeout(() => this.onclose && this.onclose(new Event('close')), 0); }"
        " send() {} close() {} addEventListener() {} removeEventListener() {} };")

    await pg.route("**/*", gate)

    try:
        await pg.goto(ORIGIN + "/", wait_until="load", timeout=120_000)
    except Exception as e:                                   # noqa: BLE001
        errors.append(f"navigation: {type(e).__name__}")
    # Long enough for the globe to have tiles and for the deferred layers to
    # have tried and failed, which is the state a real offline launch reaches.
    await pg.wait_for_timeout(20_000)

    px = await pg.evaluate(PIXELS)
    has_cesium = await pg.evaluate("() => typeof window.Cesium")
    rail = await pg.evaluate(
        "() => (document.getElementById('rail-sub')?.textContent || '').trim()")
    await br.close()
    return {"px": px, "cesium": has_cesium, "remote": remote, "rail": rail,
            "blockedLocal": blocked_local, "errors": errors}


async def main() -> None:
    async with async_playwright() as p:
        print("=== every remote host blocked ===")
        r = await boot(p, block_local=False)
        px = r["px"]

        # Proves the run was actually offline. The first version of this file
        # passed every check while the page showed live radar and 1,721
        # aircraft, because the backend it was talking to still had a network.
        api = [p for p in r["blockedLocal"] if p.startswith("/api")]
        chk(bool(api),
            "CONTROL: this run really was offline -- the app's own backend was "
            f"refused too ({len(api)} /api requests blocked, e.g. {api[0] if api else 'none'})")

        # The positive half of the same control. Offline, railOverviewLine()
        # has nothing to count and falls back to a plain sentence; a run that
        # reports aircraft and ships had a live feed and is not measuring an
        # offline launch, whatever it blocked.
        # The word "aircraft" is in the offline fallback sentence too, so the
        # tell is a COUNT, not a noun.
        counted = bool(re.search(r"\d[\d,]*\s+(aircraft|ships|quakes|in orbit)",
                                 r["rail"]))
        chk(not counted,
            "CONTROL: and no live feed reached it -- the rail reads "
            f"{r['rail']!r}")

        chk(r["cesium"] == "object",
            f"the engine is defined with no network (typeof Cesium = {r['cesium']!r})")
        chk(bool(px.get("canvas")), "a canvas exists")
        chk(bool(px.get("gl")), "and it is a WebGL canvas")
        lit = px.get("lit", 0)
        dark = px.get("dark", 0)
        chk(lit > 0 and dark > 0,
            "and it has a globe on it: both lit and dark pixels "
            f"({px.get('litPct', 0)}% lit of {px.get('seen', 0)} sampled)")
        # A fully lit or fully dark canvas is the shape a broken boot takes,
        # so the band matters as much as the counts.
        chk(2 <= px.get("litPct", 0) <= 98,
            "and it is neither a blank field nor a solid fill")

        cesium_com = [u for u in r["remote"] if "cesium.com" in u
                      and "api.cesium.com" not in u]
        chk(not cesium_com,
            "nothing was requested from cesium.com"
            + ("" if not cesium_com else f": {cesium_com[:3]}"))
        ces_err = [e for e in r["errors"] if "Cesium" in e]
        chk(not ces_err,
            "no page error names Cesium"
            + ("" if not ces_err else f": {ces_err[:2]}"))

        print("\n=== CONTROL: the same run with the LOCAL engine blocked too ===")
        c = await boot(p, block_local=True)
        cpx = c["px"]
        control_broke = (c["cesium"] != "object"
                         or not cpx.get("canvas")
                         or cpx.get("lit", 0) == 0
                         or cpx.get("dark", 0) == 0)
        chk(control_broke,
            "CONTROL: with /static/vendor/cesium blocked the checks above fail "
            f"(typeof Cesium = {c['cesium']!r}, canvas={cpx.get('canvas')}, "
            f"lit={cpx.get('lit')}, dark={cpx.get('dark')}) -- if this line "
            "says FAIL then the checks above prove nothing")

    print(f"\n{len(ok)} passed, {len(bad)} failed")
    for m in bad:
        print("  FAILED:", m)
    sys.exit(1 if bad else 0)


asyncio.run(main())
