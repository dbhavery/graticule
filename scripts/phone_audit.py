"""Look at the phone build. Pixels, not properties.

Every other suite in this repo asserts a property. This one exists to put a
picture in front of a person, because the defects that survived every passing
check -- a name overprinted by a role line, a hole through the planet -- were
all things a screenshot would have caught in one second.

It captures the app at real phone sizes, in each sheet detent and each
division, and it also measures the two numbers that decide whether a map app
feels fast on a phone: time to first globe frame, and frame cost while the
camera is actually moving.

    py -V:3.13 scripts/phone_audit.py [port]
"""
from __future__ import annotations

import asyncio
import json
import pathlib
import sys

from playwright.async_api import async_playwright

PORT = sys.argv[1] if len(sys.argv) > 1 else "8744"
BASE = f"http://127.0.0.1:{PORT}/"
OUT = pathlib.Path(__file__).resolve().parent / "_phone_out"
OUT.mkdir(exist_ok=True)

# A Pixel 8 is the reference Android device and 3x is its real DPR. Rendering
# at dpr 1 hides exactly the class of defect this script exists to find: text
# that is legible at 1x and mush at 3x, and a canvas that is cheap at 412x915
# and four times the cost at the pixel size the GPU is actually filling.
DEVICE = {"width": 412, "height": 915}
DPR = 3


async def shot(pg, name: str) -> None:
    await pg.screenshot(path=str(OUT / f"{name}.png"), timeout=90_000)
    print(f"  shot  {name}.png")


async def main() -> None:
    async with async_playwright() as p:
        br = await p.chromium.launch(args=[
            "--use-gl=angle", "--use-angle=swiftshader",
            "--enable-unsafe-swiftshader", "--disable-dev-shm-usage",
        ])
        ctx = await br.new_context(
            viewport=DEVICE, device_scale_factor=DPR, is_mobile=True,
            has_touch=True,
            user_agent="Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36"
                       " (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
        )
        pg = await ctx.new_page()
        errors: list[str] = []
        pg.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        pg.on("pageerror", lambda e: errors.append(f"PAGEERROR {e}"))

        # ?terrain=off for the LAYOUT captures only. SwiftShader cannot fill a
        # displaced mesh at 1236x2745 inside a screenshot timeout, and what is
        # under test in these frames is chrome, not ground.
        await pg.goto(BASE + "?terrain=off", wait_until="load")
        await pg.wait_for_function(
            "()=>window.__graticule_viewer && window.__graticule_viewer.scene", timeout=90_000)
        await asyncio.sleep(18)

        print("== detents ==")
        await shot(pg, "01_peek")
        await pg.evaluate("()=>document.body.classList.add('sheet-half')")
        await asyncio.sleep(1.0)
        await shot(pg, "02_half")
        await pg.evaluate("()=>{document.body.classList.remove('sheet-half');"
                          "document.body.classList.add('sheet-full')}")
        await asyncio.sleep(1.0)
        await shot(pg, "03_full")

        print("== divisions ==")
        for mode in ("radar", "satellite", "world", "space"):
            hit = await pg.evaluate(
                "(m)=>{const c=document.querySelector(`#wx-modes .chip[data-mode=\"${m}\"]`);"
                "if(!c) return false; c.click(); return true;}", mode)
            if not hit:
                print(f"  MISS  no division chip for {mode}")
                continue
            await asyncio.sleep(1.6)
            await shot(pg, f"04_{mode}")

        # ---- The numbers ----
        print("== measurements ==")
        # Reachability: on a 915px-tall screen with the sheet at half, what
        # fraction of the interactive controls can a thumb actually reach
        # without a second hand? Anything in the top third of a phone screen is
        # a two-hand control, which is the wrong answer for a weather app you
        # check while walking.
        reach = await pg.evaluate("""() => {
          const els = [...document.querySelectorAll(
            'button, input, select, a[href], [role="button"], .chip, .sw-t, .wf-item')];
          let total = 0, low = 0, small = 0;
          const seen = [];
          for (const e of els) {
            if (!e.checkVisibility || !e.checkVisibility({opacityProperty:true, visibilityProperty:true})) continue;
            const r = e.getBoundingClientRect();
            if (r.width < 1 || r.height < 1) continue;
            if (r.bottom < 0 || r.top > innerHeight) continue;
            total++;
            if (r.top > innerHeight * 0.33) low++;
            if (r.width < 44 || r.height < 44) {
              small++;
              if (seen.length < 12) seen.push({
                cls: String(e.className).slice(0, 34) || e.tagName,
                w: Math.round(r.width), h: Math.round(r.height)});
            }
          }
          return {total, low, small, seen};
        }""")
        print("  reach:", json.dumps(reach, indent=2)[:1400])

        # Frame cost with the camera moving, on the real default view WITH
        # terrain, because a still frame in requestRenderMode measures nothing.
        pg2 = await ctx.new_page()
        await pg2.goto(BASE, wait_until="load")
        await pg2.wait_for_function(
            "()=>window.__graticule_viewer && window.__graticule_viewer.scene", timeout=90_000)
        await asyncio.sleep(20)
        perf = await pg2.evaluate("""async () => {
          const v = window.__graticule_viewer;
          v.scene.requestRenderMode = false;
          const d = [];
          let last = performance.now();
          const spin = () => { v.camera.rotate(v.camera.up, -0.0015); };
          await new Promise(res => {
            const tick = (t) => { d.push(t - last); last = t; spin();
              if (d.length < 90) requestAnimationFrame(tick); else res(); };
            requestAnimationFrame(tick);
          });
          const s = d.slice(10).sort((a,b)=>a-b);
          return {median: +s[s.length>>1].toFixed(1), p90: +s[Math.floor(s.length*0.9)].toFixed(1)};
        }""")
        print("  moving-frame ms:", perf)

        boot = await pg2.evaluate("""() => {
          const n = performance.getEntriesByType('navigation')[0] || {};
          const paint = performance.getEntriesByType('paint')
            .find(p => p.name === 'first-contentful-paint');
          const res = performance.getEntriesByType('resource');
          const big = res.filter(r => r.transferSize > 200000)
            .map(r => ({u: r.name.split('/').pop().slice(0,44),
                        kb: Math.round(r.transferSize/1024),
                        ms: Math.round(r.duration)}))
            .sort((a,b)=>b.kb-a.kb).slice(0,10);
          return {
            fcp: paint ? Math.round(paint.startTime) : null,
            domContentLoaded: Math.round(n.domContentLoadedEventEnd || 0),
            load: Math.round(n.loadEventEnd || 0),
            requests: res.length,
            transferredKB: Math.round(res.reduce((a,r)=>a+(r.transferSize||0),0)/1024),
            heaviest: big,
          };
        }""")
        print("  boot:", json.dumps(boot, indent=2))

        if errors:
            print(f"\n== {len(errors)} console errors ==")
            for e in errors[:20]:
                print("  ERR ", e[:200])
        else:
            print("\n  no console errors")

        await br.close()
    print(f"\nimages: {OUT}")


asyncio.run(main())
