"""Capture the Play listing screenshots from the running app.

WHY THIS EXISTS AS A SCRIPT

The shipped set was captured by hand on 2026-08-13 and went stale the moment
the interface was redesigned: they show the cyan accent, a five-tile quick
row, and a sheet that introduces the app as a radar viewer. A store listing
whose pictures are of a different app is worse than one with fewer pictures,
and "retake the screenshots" is not a task anybody should have to remember
after a visual change.

WHAT IT CAPTURES, AND WHY THESE SCENES

Don, 2026-09-18: "this app is like a swiss army knife and has a ton of
different uses, not just weather." The August set was radar, a flood warning,
and two layer panes, which is a weather app's listing. Three of the six scenes
here are deliberately not weather.

Native size is 1080x2400, which is 2.22:1. Play wants 16:9 or taller and
accepts this, but the old set also carried a 1080x1920 crop because some
surfaces letterbox a 2.22 image badly. Both are written, as before.

    py -V:3.13 scripts/store_shots.py [port]

The backend has to be running, with real feeds, because a listing screenshot
showing zero aircraft is a screenshot of a broken app.
"""
from __future__ import annotations

import asyncio
import pathlib
import sys
import time

from playwright.async_api import async_playwright

PORT = sys.argv[1] if len(sys.argv) > 1 else "8731"
BASE = f"http://127.0.0.1:{PORT}/"
OUT = pathlib.Path(__file__).resolve().parent.parent / "docs" / "store" / "screenshots"
WIDE = OUT / "9x16"

# 360 CSS px at DPR 3 is 1080 device px, which is what a Galaxy S23 reports.
# Capturing at 1080 CSS px instead would lay the page out as a tablet and
# every phone-only rule in the stylesheet would be the wrong one.
DEVICE = {"width": 360, "height": 800}
DPR = 3

# Vancouver, WA. A real place with real weather, so the distance ranking and
# the forecast have something true to say.
HOME = (45.6387, -122.6615)

# Set by warning_card(), enforced by shot(). None means "do not care".
WANT_CARD = None

UA = ("Mozilla/5.0 (Linux; Android 14; SM-S911U) AppleWebKit/537.36"
      " (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36")


async def layers(pg, on: list[str], off: list[str] = ()) -> None:
    """Drive the real checkboxes, so a scene cannot show a state the app
    cannot actually reach."""
    await pg.evaluate("""(sets) => {
      const set = (key, want) => {
        const cb = document.querySelector(`input[data-layer="${key}"]`);
        if (!cb || cb.disabled) return;
        if (cb.checked !== want) { cb.checked = want; cb.dispatchEvent(new Event('change')); }
      };
      sets.on.forEach((k) => set(k, true));
      sets.off.forEach((k) => set(k, false));
    }""", {"on": list(on), "off": list(off)})


async def warning_card(pg, on: bool) -> None:
    """Show or hide the hero alert card.

    It is correct for that card to be about YOUR area rather than about
    wherever the camera happens to point: a warning does not stop mattering
    because you spun the globe. It is also why the breadth scenes have to turn
    it off. The first capture of the Pacific rim carried "FLOOD WARNING /
    MOWER, MN / 1455 mi AWAY" across a view of Japan, which is the app
    behaving correctly and a screenshot saying something false.
    """
    global WANT_CARD
    WANT_CARD = on
    await pg.evaluate("(v) => gfxSetCfg('warning', { on: v })", on)
    await pg.wait_for_timeout(900)
    # Enforcement happens in shot(), not here. Setting the config and checking
    # it immediately passed, and the scene still photographed the card: the
    # scene does twenty more seconds of work after this call, and whatever
    # turned it back on did so in that gap. The only moment worth asserting is
    # the moment the shutter opens.


async def camera(pg, lat: float, lon: float, alt: float) -> None:
    await pg.evaluate("""(v) => {
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(v.lon, v.lat, v.alt),
        duration: 0,
      });
      viewer.scene.requestRender();
    }""", {"lat": lat, "lon": lon, "alt": alt})


async def shot(pg, name: str) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    WIDE.mkdir(parents=True, exist_ok=True)
    path = OUT / f"{name}.png"
    # Say which scene is being captured BEFORE the capture. A screenshot
    # timeout with no progress line tells you a run failed and nothing about
    # where, and this run failed three times before it printed anything.
    print(f"  ...   {name}", flush=True)
    if WANT_CARD is not None:
        for attempt in (1, 2):
            state = await pg.evaluate(
                "() => { const el = document.querySelector('#gfx .gfx-warning');"
                " return !el || el.classList.contains('hidden')"
                "        || getComputedStyle(el).display === 'none'; }")
            if state != WANT_CARD:
                break
            print(f"        card is {'on' if state is False else 'off'}, "
                  f"wanted the opposite; re-applying ({attempt})", flush=True)
            await pg.evaluate("(v) => gfxSetCfg('warning', { on: v })", WANT_CARD)
            await pg.wait_for_timeout(1200)
        else:
            raise SystemExit(f"{name}: warning card would not stay "
                             f"{'on' if WANT_CARD else 'off'}")
    t0 = time.time()
    await pg.screenshot(path=str(path), timeout=180_000)
    print(f"        captured in {time.time() - t0:.1f}s", flush=True)
    # The 16:9 crop takes the TOP of the frame, not the centre: the globe and
    # whatever card is over it are the subject, and the bottom of a 2.22 frame
    # is the sheet, which repeats across every scene.
    try:
        from PIL import Image
        im = Image.open(path)
        w, _ = im.size
        im.crop((0, 0, w, int(w * 16 / 9))).save(WIDE / f"{name}.png")
    except ImportError:
        print("  (Pillow missing: 9x16 crop skipped)")
    print(f"  shot  {name}.png")


async def main() -> None:
    async with async_playwright() as p:
        br = await p.chromium.launch(args=[
            "--use-gl=angle", "--use-angle=swiftshader",
            "--enable-unsafe-swiftshader", "--disable-dev-shm-usage",
            "--hide-scrollbars",
        ])
        ctx = await br.new_context(viewport=DEVICE, device_scale_factor=DPR,
                                   is_mobile=True, has_touch=True,
                                   user_agent=UA)
        pg = await ctx.new_page()
        # `?terrain=off`, and it costs this set NOTHING.
        #
        # The first attempt ran with terrain on and every screenshot timed out
        # at 120 s, on SwiftShader and again on the real GPU headed: a
        # displaced mesh at 1080x2400 is more than the compositor will finish
        # inside a capture.
        #
        # Turning it off is not a compromise here, because THE APP ITSELF
        # KEEPS TERRAIN OFF AT THESE ALTITUDES. `syncTerrainForView` only
        # attaches a terrain provider on the way down, on the argument that
        # relief is under a pixel from orbit and pure cost. Every scene below
        # sits between 3,400 and 11,000 km, so these frames are what a phone
        # actually draws there. A low-altitude scene would need the real
        # device, and there is no low-altitude scene in this set.
        await pg.goto(BASE + "?terrain=off", wait_until="load", timeout=180_000)
        await pg.wait_for_timeout(22_000)      # let the feeds actually arrive

        # THE CAMERA KEPT GOING HOME.
        #
        # Scene 5 asked for the Pacific rim and photographed North America.
        # `lockNorthAmerica` re-centres the globe after 90 seconds with no
        # sign of a person, which is a deliberate feature with a careful
        # mousemove guard on it. This script is not a person: it flies the
        # camera through evaluate() and then waits twelve seconds without
        # touching anything, which is exactly the state that feature exists
        # to catch. Turn it off for the session rather than faking input.
        await pg.evaluate("() => { settings.lockNorthAmerica = false;"
                          " applyNorthAmericaLock(false); }")

        # An area, so the alert card ranks by distance and the forecast has a
        # place name instead of a placeholder.
        await pg.evaluate(f"setHome({HOME[0]}, {HOME[1]}, {{ source: 'map' }})")
        await pg.wait_for_timeout(6000)

        # 1 · What the app is. Radar over North America, sheet closed, live
        #     counts in the head. This is the identity shot and it leads.
        await layers(pg, ["radar", "countries", "states"],
                     ["planes", "ships", "quakes", "fires", "satellites"])
        await camera(pg, 41.0, -97.0, 5_200_000)
        await pg.evaluate("sheetGo(0)")
        await pg.wait_for_timeout(9000)
        await shot(pg, "01-live-now")

        # 2 · Alerting. Warnings drawn, the hero card ranked from the saved
        #     area rather than nationwide.
        await layers(pg, ["radar", "warnings"], [])
        await camera(pg, 39.0, -95.0, 3_400_000)
        await pg.wait_for_timeout(9000)
        await shot(pg, "02-warnings")

        # 3 · The forecast, which is new and is the thing a weather app is
        #     expected to have.
        await pg.evaluate("sheetGo(2)")
        await pg.wait_for_timeout(1200)
        await pg.evaluate(
            "document.getElementById('fxcard')"
            "?.scrollIntoView({block:'start', behavior:'auto'})")
        await pg.wait_for_timeout(2500)
        await shot(pg, "03-forecast")

        # ORDER MATTERS, and it is not the numbering.
        #
        # The two breadth scenes need the hero card off, and turning it
        # back ON afterwards does not work: `gfxRenderWarning` asks
        # `gfxTopAlert()` for something to be about, and once the shell
        # has been stood down the scene will not reassemble itself from a
        # config flag alone. Rather than fight that, the card-off scenes
        # run LAST and nothing has to be restored. The files are still
        # numbered in listing order.

        await pg.evaluate("sheetGo(2)")
        await pg.evaluate("document.getElementById('hud-scroll').scrollTop = 0")
        await pg.wait_for_timeout(2500)
        await shot(pg, "06-layers")


        # 4 · Breadth, in the air. Aircraft and satellites, no weather layer
        #     drawn at all, because the listing has to show this is not a
        #     weather app.
        await pg.evaluate("sheetGo(0)")
        await warning_card(pg, False)
        await layers(pg, ["planes", "satellites", "countries"],
                     ["radar", "warnings"])
        await camera(pg, 45.0, -100.0, 6_000_000)
        await pg.wait_for_timeout(12_000)
        await shot(pg, "04-air-traffic")

        # 5 · Breadth, on the ground and at sea. Quakes, volcanoes and
        #     shipping over the Pacific rim, which is where all three are at
        #     once.
        #
        #     FIRES IS DELIBERATELY NOT IN THIS SCENE. With it on, the capture
        #     could not finish inside 180 s, every other scene having taken
        #     under five. That layer ships around 175,000 points (issues.md
        #     31, open), and this set is not the place to find out what that
        #     costs. A bisect to attribute it properly was inconclusive
        #     because the deferred layers had not finished loading when it
        #     measured, so no claim is made here beyond what was observed:
        #     the scene containing fires timed out and the same scene without
        #     it does not.
        await layers(pg, ["quakes", "volcanoes", "ships", "countries"],
                     ["planes", "satellites", "fires"])
        # Centred on the trench rather than on open ocean, and closer, so the
        # limb is not carrying a third of the frame in black.
        await camera(pg, 20.0, 140.0, 9_000_000)
        await pg.wait_for_timeout(12_000)
        await shot(pg, "05-earth")

        # 6 · The controls. Sheet open on Quick Layers, showing that reaching
        #     any of this is one tap.
        await br.close()

    print(f"\nwrote to {OUT}")
    print(f"and 16:9 crops to {WIDE}")


asyncio.run(main())
