"""Graticule with no API keys at all.

The app used to need five signups before the map filled in: FIRMS for fires,
AISStream for ships, OpenSky OAuth for aircraft, Cesium ion for terrain and
Google for photoreal 3D. Anyone who cloned it and ran it got dark layers.

Every check here asserts something that was measurably FALSE before the keyless
work, and the suite is meant to be run against a server booted with every key
blanked (scripts/run_keyless.py). Several checks assert both directions so a
rule that always fires, or never fires, shows up as a failure.

    py -V:3.13 scripts/keyless_test.py [port]
"""
from __future__ import annotations

import asyncio
import sys

import httpx
from playwright.async_api import async_playwright

PORT = sys.argv[1] if len(sys.argv) > 1 else "8743"
BASE = f"http://127.0.0.1:{PORT}"

ok: list[str] = []
bad: list[str] = []


def chk(cond: bool, msg: str) -> None:
    (ok if cond else bad).append(msg)
    print(("  PASS  " if cond else "  FAIL  ") + msg)


async def main() -> None:
    # ---- server side: is it really running without keys? --------------------
    print("=== server ===")
    async with httpx.AsyncClient(timeout=60) as c:
        cfg = (await c.get(f"{BASE}/api/config")).json()

    # The control for this whole suite. If a token leaked in from .env then
    # every check below passes for the wrong reason.
    chk(cfg.get("cesium_ion_token") == "" and cfg.get("google_maps_api_key") == "",
        "CONTROL: the server really is running with no tokens "
        f"(ion={cfg.get('cesium_ion_token')!r}, google={cfg.get('google_maps_api_key')!r})")
    chk(cfg.get("fires_enabled") is True,
        "wildfires are enabled with no FIRMS_MAP_KEY (was False -> layer greyed out)")
    chk(cfg.get("ships_enabled") is True,
        "ships are enabled with no AISSTREAM_KEY (was False -> layer greyed out)")
    chk(cfg.get("ships_global") is False,
        "and ships_global is honestly False, so the UI can say which waters")

    # ---- client side --------------------------------------------------------
    async with async_playwright() as p:
        br = await p.chromium.launch(args=[
            "--use-gl=angle", "--use-angle=swiftshader",
            "--enable-unsafe-swiftshader", "--disable-dev-shm-usage"])
        ctx = await br.new_context(viewport={"width": 1600, "height": 950})
        pg = await ctx.new_page()
        errs: list[str] = []
        bad_status: list[str] = []
        pg.on("pageerror", lambda e: errs.append(str(e)[:160]))
        pg.on("response", lambda r: bad_status.append(f"{r.status} {r.url[:90]}")
              if r.status >= 400 else None)

        await pg.goto(f"{BASE}/", wait_until="load")
        await pg.wait_for_function(
            "()=>typeof viewer!=='undefined'&&viewer&&viewer.scene", timeout=90000)
        # Feeds land at their own pace; the ADS-B sweep alone takes ~14s.
        await asyncio.sleep(55)

        print("\n=== terrain ===")
        # instanceof, not constructor.name: Cesium ships minified, so the class
        # name is mangled at runtime. The first draft of this test compared the
        # name and reported the provider as "Ly".
        IS_ARCGIS = ("()=>window.__graticule_viewer.terrainProvider instanceof "
                     "Cesium.ArcGISTiledElevationTerrainProvider")
        IS_ELLIPSOID = ("()=>window.__graticule_viewer.terrainProvider instanceof "
                        "Cesium.EllipsoidTerrainProvider")

        # Terrain is no longer attached at boot, and that is deliberate. The
        # app opens on North America from ~9,000 km, where a 4 km mountain is
        # under a pixel and real terrain is pure cost -- it was the single
        # biggest frame-time item measured (6137 ms -> 569 ms median with the
        # camera moving). It is also what punched a hole through the poles,
        # because the elevation service is Web Mercator and a terrain provider's
        # tiling scheme defines the whole globe quadtree.
        #
        # So the check is no longer "is a provider set at boot". It is "does
        # descending to where relief is visible actually attach real elevation",
        # which is the thing a user gets.
        chk(await pg.evaluate(IS_ELLIPSOID),
            "boot is on the ellipsoid: no terrain paid for at orbital altitude")

        await pg.evaluate("""()=>{
          const v = window.__graticule_viewer;
          settings.lockNorthAmerica = false; applyNorthAmericaLock(false);
          v.camera.lookAt(Cesium.Cartesian3.fromDegrees(-106.5, 39.1, 0),
            new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-40), 260_000));
          v.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
          v.camera.moveEnd.raiseEvent();
        }""")
        await asyncio.sleep(12)
        chk(await pg.evaluate(IS_ARCGIS),
            "real elevation attaches on descent with no ion token "
            "-- the globe was a smooth ellipsoid before this")

        # Both directions: turning it off must genuinely go back to the sphere,
        # otherwise the check above proves only that SOMETHING is set.
        #
        # Guarded, because a control run against pre-change code has no
        # applyTerrain at all and a bare evaluate() throws ReferenceError,
        # aborting the suite. A control run has to REPORT failures, not crash
        # on the first one -- otherwise it cannot tell me how many checks the
        # old code actually fails.
        has_toggle = await pg.evaluate("()=>typeof applyTerrain === 'function'")
        chk(has_toggle, "the terrain toggle exists")
        if has_toggle:
            # Drive the SWITCH, not applyTerrain() directly. applyTerrain is now
            # the internal mechanism and the view owns it: calling it directly
            # while settings.terrain is still true just gets overridden on the
            # next camera event, which is what this check started reporting.
            # Unchecking the box is what a user actually does.
            TOGGLE = """(on)=>{
              const cb = document.getElementById('show-terrain');
              if (!cb) return false;
              if (cb.checked !== on) { cb.checked = on;
                cb.dispatchEvent(new Event('change', {bubbles:true})); }
              return true;
            }"""
            chk(await pg.evaluate(TOGGLE, False), "the terrain switch is wired up")
            await asyncio.sleep(2.0)
            chk(await pg.evaluate(IS_ELLIPSOID),
                "CONTROL: switching terrain off returns to the ellipsoid")
            await pg.evaluate(TOGGLE, True)
            await asyncio.sleep(6.0)
            chk(await pg.evaluate(IS_ARCGIS), "and back on again")
        else:
            chk(False, "the terrain switch is wired up (no toggle)")
            chk(False, "CONTROL: switching terrain off returns to the ellipsoid (no toggle)")
            chk(False, "and back on again (no toggle)")

        # A provider object is not elevation. Sample real ground heights and
        # demand they vary -- on the ellipsoid every one of these is 0.
        # sampleTerrainMostDetailed throws outright on an EllipsoidTerrainProvider
        # (it has no availability to query), which is exactly the pre-change
        # state a control run sits in. Catch it so that reads as a failed check.
        heights = await pg.evaluate("""async () => {
          try {
            const t = window.__graticule_viewer.terrainProvider;
            const pts = [[39.10,-120.15],[36.06,-112.14],[27.99,86.93],[4.0,-52.0]]
              .map(([la,lo]) => Cesium.Cartographic.fromDegrees(lo, la));
            const out = await Cesium.sampleTerrainMostDetailed(t, pts);
            return out.map(c => Math.round(c.height));
          } catch (e) { return null; }
        }""")
        chk(bool(heights) and any(h > 500 for h in heights),
            f"and it returns real ground elevation, not zeros: {heights} m "
            "(Tahoe, Grand Canyon, Everest, Atlantic)")
        chk(bool(heights) and abs(heights[-1]) < 200,
            f"CONTROL: the open-Atlantic sample is near sea level "
            f"({heights[-1] if heights else None} m), so these are heights and not noise")

        print("\n=== keyless feeds ===")
        # The boot snapshot no longer carries rows for big layers, it counts
        # them and the client fetches on demand (issues.md 63). So load the
        # deferred ones first and then count, which is what the app itself does
        # when the layer is switched on. Counting `layerData` cold would read
        # whatever handful of rows happened to arrive as live deltas: planes
        # would still pass, for entirely the wrong reason, and fires would read
        # zero because FIRMS does not push deltas that fast.
        counts = await pg.evaluate("""async () => {
          const load = (k) => (typeof fetchDeferredLayer === 'function'
            ? (fetchDeferredLayer(k) || Promise.resolve()) : Promise.resolve());
          await Promise.all(['planes', 'ships', 'fires'].map(load));
          const L = (typeof layerData !== 'undefined' ? layerData : {});
          const n = (k) => Object.keys(L[k] || {}).length;
          return { planes: n('planes'), ships: n('ships'), fires: n('fires') };
        }""")
        chk(counts["planes"] > 500,
            f"aircraft arrive with no OpenSky account: {counts['planes']:,} tracked "
            "(anonymous OpenSky returned 429)")
        chk(counts["fires"] > 10000,
            f"wildfires arrive with no FIRMS key: {counts['fires']:,} detections")
        chk(counts["ships"] > 100,
            f"ships arrive with no AISStream key: {counts['ships']:,} vessels")

        # The richer fields are the reason the swap is an upgrade, so prove
        # they are actually populated rather than present-and-empty.
        rich = await pg.evaluate("""() => {
          const P = Object.values((typeof layerData !== 'undefined' ? layerData : {}).planes || {});
          const has = (f) => P.filter(p => p[f]).length;
          return { total: P.length, reg: has('registration'),
                   type: has('type'), desc: has('desc'),
                   emerg: has('emergency') };
        }""")
        chk(rich["reg"] > rich["total"] * 0.5,
            f"most aircraft carry a registration ({rich['reg']}/{rich['total']}) "
            "-- OpenSky never sent one")
        chk(rich["desc"] > rich["total"] * 0.5,
            f"and a readable airframe type ({rich['desc']}/{rich['total']})")
        chk(rich["emerg"] < rich["total"] * 0.05,
            f"CONTROL: 'emergency' is rare, not stamped on everything "
            f"({rich['emerg']}/{rich['total']}) -- the feed sends the string 'none'")

        print("\n=== the layers are usable, not just populated ===")
        gated = await pg.evaluate("""() => {
          const out = {};
          for (const k of ['fires', 'ships']) {
            const cb = document.querySelector(`input[data-layer="${k}"]`);
            out[k] = cb ? { disabled: cb.disabled, title: cb.title } : null;
          }
          return out;
        }""")
        chk(gated["fires"] and not gated["fires"]["disabled"],
            "the wildfires checkbox is live, not greyed out with 'no FIRMS_MAP_KEY'")
        chk(gated["ships"] and not gated["ships"]["disabled"],
            "the ships checkbox is live, not greyed out with 'no AISSTREAM_KEY'")
        chk(bool(gated["ships"] and "Baltic" in (gated["ships"]["title"] or "")),
            "and ships says which waters it covers rather than implying the world: "
            f"{(gated['ships'] or {}).get('title', '')[:60]!r}")

        # The note must come from the FEED, not from whether a key exists.
        # aisstream.io was measured accepting the key and then sending nothing,
        # so key-presence is not evidence of coverage.
        snap = await pg.evaluate("""async () => {
          const r = await fetch('/api/snapshot');
          const d = await r.json();
          return (d.meta || {}).ships_source || null;
        }""")
        chk(bool(snap) and snap.get("name") == "Digitraffic",
            f"the running feed announces itself rather than being inferred: {snap}")
        chk(bool(snap) and snap.get("global") is False,
            "and reports global=False, which is what drives the label")

        print("\n=== nothing broke ===")
        chk(not errs, f"no JS errors{'' if not errs else ': ' + str(errs[:3])}")
        ion = [s for s in bad_status if "ion.cesium" in s or "assets.cesium" in s]
        chk(not ion, f"no failed Cesium ion requests{'' if not ion else ': ' + str(ion[:3])}")

        await ctx.close()
        await br.close()

    print(f"\n{len(ok)} passed, {len(bad)} failed")
    for m in bad:
        print("  FAILED:", m)
    sys.exit(1 if bad else 0)


asyncio.run(main())
