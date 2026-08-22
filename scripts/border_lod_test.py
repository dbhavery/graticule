"""Does the app really draw the overview at orbit and the real borders up close?

The whole point of splitting the border data in two is that boot never pays for
the detail. That is only true if two separate things hold, and a bug in either
one is silent:

  * at orbit the DETAIL FILE IS NOT FETCHED at all, and
  * coming down actually swaps to it, rather than leaving a 500 m-smoothed
    border on screen at city zoom, which is the accuracy defect this whole
    change exists to remove.

A test that only checked "borders exist" passes with the swap completely
broken in either direction, which is why both are asserted against the
expected position counts rather than against zero.

    py -V:3.13 scripts/border_lod_test.py [port]
"""
from __future__ import annotations

import asyncio
import sys

from playwright.async_api import async_playwright

PORT = sys.argv[1] if len(sys.argv) > 1 else "8744"
BASE = f"http://127.0.0.1:{PORT}/"
DEVICE = {"width": 412, "height": 915}

# Boot draws RASTER TILES and no geometry at all, so the honest boot assertion
# is that positions is exactly zero and two tile layers are up. Descending
# swaps to the full-detail vectors.
DETAIL_POS = 428_427
TOL = 0.03

ok: list[str] = []
bad: list[str] = []


def chk(cond: bool, msg: str) -> None:
    (ok if cond else bad).append(msg)
    print(("  PASS  " if cond else "  FAIL  ") + msg)


def near(got: int, want: int) -> bool:
    return abs(got - want) <= want * TOL


async def borders(pg) -> dict:
    return await pg.evaluate("() => window.__graticule_borders || {}")


async def wait_positions(pg, want: int, timeout_s: float = 60.0) -> int:
    got = 0
    for _ in range(int(timeout_s)):
        await pg.wait_for_timeout(1000)
        got = (await borders(pg)).get("positions", 0)
        if near(got, want):
            return got
    return got


async def main() -> None:
    async with async_playwright() as p:
        br = await p.chromium.launch(args=[
            "--use-gl=angle", "--use-angle=swiftshader",
            "--enable-unsafe-swiftshader", "--disable-dev-shm-usage",
        ])
        ctx = await br.new_context(viewport=DEVICE, device_scale_factor=3,
                                   is_mobile=True, has_touch=True)
        pg = await ctx.new_page()

        fetched: list[str] = []
        pg.on("request", lambda r: fetched.append(r.url)
              if ("borders" in r.url or "border_tiles" in r.url) else None)

        print(f"== boot at orbit ==\n   {BASE}")
        await pg.goto(BASE, wait_until="load")
        # Wait on the RASTER layers being up, not on a position count: at orbit
        # the honest number of border vertices is zero.
        b = {}
        for _ in range(60):
            await pg.wait_for_timeout(1000)
            b = await borders(pg)
            if b.get("raster") == 2:
                break
        got = b.get("positions", -1)

        def hit(sub: str) -> int:
            return sum(1 for u in fetched if sub in u)

        print(f"   positions {got:,}   lines {b.get('lines')}")
        print("   border files fetched: "
              + ", ".join(sorted({u.rsplit('/', 1)[-1] for u in fetched})))

        chk(b.get("mode") == "raster" and b.get("raster") == 2,
            f"boot draws RASTER tiles, both layers up "
            f"(mode={b.get('mode')}, layers={b.get('raster')})")
        chk(got == 0,
            f"and uploads NO border geometry at all ({got:,} positions) -- this is "
            f"the ~120 MB and 2,147 ms of Primitive.update the change exists to "
            f"remove")
        chk(hit("border_tiles.manifest.json") >= 1 and hit("border_tiles/") >= 4,
            f"the manifest and real tiles were fetched "
            f"({hit('border_tiles/')} tiles), so 0 positions means 'raster is "
            f"drawing' and not 'nothing is drawing'")
        chk(hit("ne_state_borders.geojson") == 0
            and hit("ne_country_borders.geojson") == 0,
            "and neither DETAIL file was fetched at all, which is the 300 MB of "
            "upload this split exists to skip")

        alt = await pg.evaluate("() => borderDetailAltM ? borderDetailAltM() : null")
        print(f"\n== fly down past the swap altitude ({alt and round(alt):,} m) ==")
        await pg.evaluate("""() => new Promise((done) => {
            window.__graticule_viewer.camera.flyTo({
              destination: Cesium.Cartesian3.fromDegrees(-96.7, 39.1, 60000),
              duration: 1.0, complete: done, cancel: done,
            });
          })""")
        got2 = await wait_positions(pg, DETAIL_POS)
        b2 = await borders(pg)
        print(f"   positions {got2:,}   lines {b2.get('lines')}")

        chk(near(got2, DETAIL_POS),
            f"coming down swaps to the REAL borders ({got2:,} positions, "
            f"expected ~{DETAIL_POS:,})")
        chk(hit("ne_state_borders.geojson") >= 1,
            f"the detail file was fetched, once it was needed "
            f"({hit('ne_state_borders.geojson')})")
        chk(got2 > got,
            f"which is more geometry than the raster carried ({got2:,} vs {got:,})")
        chk(b2.get("mode") == "vector",
            f"and the app says it switched paths (mode={b2.get('mode')})")

        await br.close()

    print(f"\n{len(ok)} passed, {len(bad)} failed")
    for m in bad:
        print("  FAILED:", m)
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    asyncio.run(main())
