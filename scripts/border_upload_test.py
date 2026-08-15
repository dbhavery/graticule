"""How many bytes do the border layers hand to the GPU?

issues.md 67 measured 346 MB of vertex and index uploads per boot on the
device, and the useful property of that number is that it was IDENTICAL on
every boot. Timings on this project vary by 1.9x between runs of the same
build; bytes do not vary at all, because they are a property of the geometry
rather than of the host. So bytes are what a border change should be ranked on.

Bytes are also the same in any browser, which is why this runs in desktop
Chromium under SwiftShader instead of on the emulator: it needs no device, no
GPU lease, and it gives the same answer.

    py -V:3.13 scripts/border_upload_test.py [port]
    py -V:3.13 scripts/border_upload_test.py [port] --ab

`--ab` loads the same build twice, once with `?scene3donly=off`, which is
Cesium's default and makes every Primitive compute and upload a second copy of
its geometry projected for 2D.

CONTROL: after the page has settled this uploads a buffer of a size it chose
itself and fails unless the counter rises by exactly that many bytes. A wrapper
that failed to install reports a tidy zero and a wrapper that double-counts
reports a tidy lie, and neither is distinguishable from a real result without
this.
"""
from __future__ import annotations

import asyncio
import sys

from playwright.async_api import async_playwright

PORT = "8744"
AB = False
for a in sys.argv[1:]:
    if a == "--ab":
        AB = True
    else:
        PORT = a

BASE = f"http://127.0.0.1:{PORT}/"
DEVICE = {"width": 412, "height": 915}

# Long enough for the border build AND the async geometry that follows it. The
# uploads land seconds after the lines are counted, because combineGeometry runs
# in Cesium's workers and Primitive.update only fires when it hands back.
SETTLE_QUIET_S = 6.0
MAX_WAIT_S = 90.0

ok: list[str] = []
bad: list[str] = []


def chk(cond: bool, msg: str) -> None:
    (ok if cond else bad).append(msg)
    print(("  PASS  " if cond else "  FAIL  ") + msg)


# Installed before any application script, so the context is wrapped before
# Cesium ever asks for it. Methods are replaced on the INSTANCE; if an
# assignment does not take, `wrapped` stays low and the report says so rather
# than printing zeroes.
WRAP = r"""
window.__up = { bytes: 0, calls: 0, sizes: {}, wrapped: 0, ctx: null };
(function () {
  var U = window.__up;
  var real = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, attrs) {
    var ctx = attrs === undefined ? real.call(this, type) : real.call(this, type, attrs);
    if (!ctx || ctx.__up_wrapped) return ctx;
    if (type === 'webgl2' || type === 'webgl' || type === 'experimental-webgl') {
      ['bufferData'].forEach(function (name) {
        var fn = ctx[name];
        if (typeof fn !== 'function') return;
        ctx[name] = function () {
          var a = arguments;
          var n = typeof a[1] === 'number' ? a[1] : ((a[1] && a[1].byteLength) || 0);
          U.bytes += n; U.calls += 1;
          if (n >= 1048576) {
            var kb = Math.round(n / 1024);
            U.sizes[kb] = (U.sizes[kb] || 0) + 1;
          }
          return fn.apply(ctx, a);
        };
        if (ctx[name] !== fn) U.wrapped += 1;
      });
      U.ctx = ctx;
      ctx.__up_wrapped = true;
    }
    return ctx;
  };
})();
"""

READ = "() => ({...window.__up, sizes: undefined, ctx: undefined, " \
       "big: Object.entries(window.__up.sizes).map(([k, v]) => [+k, v])" \
       ".sort((a, b) => b[0] - a[0])})"


async def settle(pg) -> dict:
    """Wait until the upload counter stops moving."""
    last, quiet, waited = -1, 0.0, 0.0
    while waited < MAX_WAIT_S:
        await pg.wait_for_timeout(1000)
        waited += 1.0
        cur = await pg.evaluate("() => window.__up.bytes")
        if cur == last:
            quiet += 1.0
            if quiet >= SETTLE_QUIET_S:
                break
        else:
            quiet = 0.0
            last = cur
    return await pg.evaluate(READ)


async def one(ctx, url: str, label: str) -> dict:
    pg = await ctx.new_page()
    errors: list[str] = []
    pg.on("pageerror", lambda e: errors.append(f"PAGEERROR {e}"))
    print(f"\n== {label} ==\n   {url}")
    await pg.goto(url, wait_until="load")
    d = await settle(pg)
    borders = await pg.evaluate("() => window.__graticule_borders || null")
    d["borders"] = borders
    d["errors"] = errors[:3]

    # CONTROL, on the live context this run just measured.
    probe = 4 * 1024 * 1024
    moved = await pg.evaluate(
        """(n) => {
             const U = window.__up, gl = U.ctx;
             if (!gl) return null;
             const before = U.bytes;
             const b = gl.createBuffer();
             gl.bindBuffer(gl.ARRAY_BUFFER, b);
             gl.bufferData(gl.ARRAY_BUFFER, new Uint8Array(n), gl.STATIC_DRAW);
             gl.deleteBuffer(b);
             return U.bytes - before;
           }""", probe)
    d["control"] = {"asked": probe, "counted": moved}
    await pg.close()

    print(f"   uploaded {d['bytes'] / 1e6:>9,.1f} MB in {d['calls']:,} calls "
          f"({d['wrapped']} methods wrapped)")
    if borders:
        print(f"   borders: {borders.get('lines')} lines, draped={borders.get('draped')}")
    for kb, n in d["big"][:6]:
        print(f"     {kb:>7,} KB  x{n}")
    if errors:
        print(f"   page errors: {errors[:2]}")
    return d


async def main() -> None:
    async with async_playwright() as p:
        br = await p.chromium.launch(args=[
            "--use-gl=angle", "--use-angle=swiftshader",
            "--enable-unsafe-swiftshader", "--disable-dev-shm-usage",
        ])
        ctx = await br.new_context(viewport=DEVICE, device_scale_factor=3,
                                   is_mobile=True, has_touch=True)
        await ctx.add_init_script(WRAP)

        shipped = await one(ctx, BASE, "as shipped")

        print("\n== checks ==")
        c = shipped["control"]
        chk(shipped["wrapped"] >= 1, f"bufferData was wrapped ({shipped['wrapped']})")
        chk(c["counted"] == c["asked"],
            f"CONTROL: a {c['asked'] / 1e6:.0f} MB buffer uploaded after the run "
            f"moved the counter by exactly that ({c['counted']})")
        chk(shipped["bytes"] > 5e6,
            f"the run recorded real uploads ({shipped['bytes'] / 1e6:.1f} MB), so a "
            f"zero elsewhere would mean something")
        chk((shipped.get("borders") or {}).get("lines", 0) > 0,
            f"the borders actually built ({(shipped.get('borders') or {}).get('lines')} lines)")
        chk(not shipped["errors"], f"no page errors ({shipped['errors']})")

        if AB:
            other = await one(ctx, BASE + "?scene3donly=off",
                              "?scene3donly=off (Cesium's default)")
            a, b = shipped["bytes"], other["bytes"]
            print(f"\n  scene3DOnly true  {a / 1e6:>9,.1f} MB")
            print(f"  scene3DOnly false {b / 1e6:>9,.1f} MB")
            if b:
                print(f"  3D only uploads {100 * (b - a) / b:.0f}% less "
                      f"({(b - a) / 1e6:,.1f} MB saved)")
            chk(b > a, "the 2D geometry Cesium adds by default is real and costs "
                       "more than not having it")

        await br.close()

    print(f"\n{len(ok)} passed, {len(bad)} failed")
    for m in bad:
        print("  FAILED:", m)
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    asyncio.run(main())
