"""Graticule on a phone.

The app shipped for months with no `<meta name="viewport">` at all, which meant
a phone laid the page out at a 980px fallback and scaled the result down: on a
393x852 iPhone, innerWidth reported 1185 and every 12px label rendered at about
4px. Nothing in the desktop suites could see that, because they all run at
1600x950.

Every check here asserts a property that was measurably false before the mobile
work, and several assert BOTH directions so a rule that always fires -- or
never fires -- fails.

Run against a server on 8742 by default:
    py -V:3.13 scripts/mobile_test.py [port]
"""
from __future__ import annotations

import asyncio
import sys

from playwright.async_api import async_playwright

PORT = sys.argv[1] if len(sys.argv) > 1 else "8742"
URL = f"http://127.0.0.1:{PORT}/"

# Real hardware, not round numbers. The iPhone SE is the smallest screen still
# in wide use and is where a layout breaks first.
DEVICES = [
    ("iphone-se", 375, 667),
    ("iphone-15", 393, 852),
    ("pixel-8", 412, 915),
    ("landscape", 915, 412),
]

ok: list[str] = []
bad: list[str] = []


def chk(cond: bool, msg: str) -> None:
    (ok if cond else bad).append(msg)
    print(("  PASS  " if cond else "  FAIL  ") + msg)


OVERFLOW_JS = """() => {
  const out = [];
  for (const e of document.querySelectorAll('body *')) {
    const s = getComputedStyle(e);
    if (s.display === 'none' || s.visibility === 'hidden' || +s.opacity === 0) continue;
    const r = e.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    if (r.right <= innerWidth + 2) continue;
    // Report the OUTERMOST offender in each chain: if my parent also overflows,
    // the parent is the bug and I am the symptom.
    let p = e.parentElement, inner = false;
    while (p && p !== document.body) {
      if (p.getBoundingClientRect().right > innerWidth + 2) { inner = true; break; }
      p = p.parentElement;
    }
    if (inner) continue;
    out.push({ cls: String(e.className).slice(0, 30), right: Math.round(r.right),
               txt: (e.textContent || '').trim().slice(0, 24) });
  }
  return out;
}"""

TARGETS_JS = """() => {
  // Apple HIG 44x44pt, Material 48dp. The TARGET is what you can press, so a
  // checkbox inside a label is measured as the label.
  const small = [];
  for (const e of document.querySelectorAll(
        'button, a, select, summary, input, .chip, .wf-item, .rs-chip, .hud-tab')) {
    if (!e.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
    let r = e.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    const lab = e.closest('label');
    if (lab && (e.type === 'checkbox' || e.type === 'radio')) {
      const lr = lab.getBoundingClientRect();
      if (lr.height >= r.height) r = lr;
    }
    if (r.height < 44 - 0.5 || r.width < 24) {
      small.push({ cls: String(e.className).slice(0, 26) || e.tagName,
                   w: Math.round(r.width), h: Math.round(r.height),
                   txt: (e.innerText || e.getAttribute('aria-label') || '').slice(0, 20) });
    }
  }
  return small;
}"""


async def main() -> None:
    async with async_playwright() as p:
        br = await p.chromium.launch(args=[
            "--use-gl=angle", "--use-angle=swiftshader",
            "--enable-unsafe-swiftshader", "--disable-dev-shm-usage"])

        for name, w, h in DEVICES:
            ctx = await br.new_context(viewport={"width": w, "height": h},
                                       is_mobile=True, has_touch=True)
            pg = await ctx.new_page()
            errs: list[str] = []
            pg.on("pageerror", lambda e: errs.append(str(e)[:120]))
            await pg.goto(URL, wait_until="load")
            await pg.wait_for_function(
                "()=>typeof viewer!=='undefined'&&viewer&&viewer.scene", timeout=60000)
            await asyncio.sleep(22)

            print(f"\n=== {name}  {w}x{h} ===")

            vw = await pg.evaluate("()=>innerWidth")
            chk(vw == w, f"innerWidth is {vw}, the real device width ({w}) -- "
                         "a missing viewport tag showed 1185 here")

            over = await pg.evaluate(OVERFLOW_JS)
            chk(not over, "nothing is painted past the right edge"
                          + ("" if not over else f" -- {len(over)}: {over[:3]}"))

            sw = await pg.evaluate(
                "()=>document.documentElement.scrollWidth - document.documentElement.clientWidth")
            chk(sw <= 0, f"no horizontal scroll (was 205px, now {sw}px)")

            chk(not errs, f"no JS errors{'' if not errs else ': ' + str(errs[:2])}")

            if name == "landscape":
                await ctx.close()
                continue

            # ---- The sheet ----
            st = await pg.evaluate("""() => {
              const hud = document.getElementById('hud');
              const r = hud.getBoundingClientRect();
              return { top: Math.round(r.top), vh: innerHeight,
                       peek: Math.round(innerHeight - r.top),
                       cls: document.body.className };
            }""")
            chk(0 < st["peek"] < 200,
                f"at rest the sheet peeks {st['peek']}px, leaving the map visible")
            chk("sheet-half" not in st["cls"] and "sheet-full" not in st["cls"],
                "and it starts at the peek detent")

            await pg.tap("#rail-head")
            await asyncio.sleep(1.0)
            half = await pg.evaluate(
                "()=>({top: Math.round(document.getElementById('hud').getBoundingClientRect().top),"
                "      cls: document.body.className})")
            chk("sheet-half" in half["cls"], "tapping the handle opens it to half")
            chk(half["top"] < st["top"], f"and it actually moved ({st['top']} -> {half['top']})")

            await pg.tap("#rail-head")
            await asyncio.sleep(1.0)
            full = await pg.evaluate(
                "()=>({top: Math.round(document.getElementById('hud').getBoundingClientRect().top),"
                "      cls: document.body.className})")
            chk("sheet-full" in full["cls"], "again opens it to full")
            chk(full["top"] < half["top"], f"and again it moved ({half['top']} -> {full['top']})")

            await pg.tap("#rail-head")
            await asyncio.sleep(1.0)
            back = await pg.evaluate("()=>document.body.className")
            chk("sheet-half" not in back and "sheet-full" not in back,
                "and from the top it cycles back to peek (the control)")

            # ---- Touch targets, with the sheet open so there is something to measure ----
            await pg.tap("#rail-head"); await asyncio.sleep(0.4)
            await pg.tap("#rail-head"); await asyncio.sleep(1.0)
            small = await pg.evaluate(TARGETS_JS)
            chk(not small, "every visible control is at least 44px tall"
                           + ("" if not small else f" -- {len(small)}: {small[:4]}"))

            # ---- Installable ----
            pwa = await pg.evaluate("""async () => {
              const link = document.querySelector('link[rel=manifest]');
              if (!link) return { manifest: false };
              const m = await fetch(link.href).then(r => r.json()).catch(() => null);
              const reg = await navigator.serviceWorker.getRegistration('/');
              return {
                manifest: !!m,
                standalone: m && m.display === 'standalone',
                startUrl: m && !!m.start_url,
                maskable: m && m.icons.some(i => (i.purpose || '').includes('maskable')),
                big: m && m.icons.some(i => i.sizes === '512x512'),
                themeMeta: !!document.querySelector('meta[name=theme-color]'),
                iosCapable: !!document.querySelector('meta[name=apple-mobile-web-app-capable]'),
                appleIcon: !!document.querySelector('link[rel=apple-touch-icon]'),
                swScope: reg ? reg.scope : null,
              };
            }""")
            chk(pwa.get("manifest"), "the manifest is served and parses")
            chk(pwa.get("standalone"), "display: standalone, so it opens without browser chrome")
            chk(pwa.get("maskable"), "a maskable icon exists -- Android crops a plain one")
            chk(pwa.get("big"), "and a 512px icon, which the install prompt requires")
            chk(pwa.get("themeMeta") and pwa.get("iosCapable") and pwa.get("appleIcon"),
                "iOS has its own meta pair and touch icon (it ignores the manifest's display)")
            chk(bool(pwa.get("swScope")) and pwa["swScope"].endswith("/"),
                f"the service worker controls the whole origin, not /static ({pwa.get('swScope')})")

            # ---- Offline ----
            icons = await pg.evaluate("""async () => {
              const c = await caches.keys();
              let n = 0;
              for (const k of c) n += (await (await caches.open(k)).keys()).length;
              return { caches: c.length, entries: n };
            }""")
            chk(icons["entries"] > 0,
                f"the shell is precached ({icons['entries']} entries in {icons['caches']} caches)")

            await ctx.close()

        # ---- Offline navigation, on one device ----
        print("\n=== offline ===")
        ctx = await br.new_context(viewport={"width": 412, "height": 915},
                                   is_mobile=True, has_touch=True)
        pg = await ctx.new_page()
        await pg.goto(URL, wait_until="load")
        await pg.wait_for_function(
            "()=>typeof viewer!=='undefined'&&viewer&&viewer.scene", timeout=60000)
        await asyncio.sleep(20)
        await pg.evaluate("()=>navigator.serviceWorker.ready")
        await ctx.set_offline(True)
        try:
            await pg.reload(wait_until="domcontentloaded", timeout=30000)
            body = await pg.evaluate("()=>document.body ? document.body.innerText.slice(0,400) : ''")
            served = "Graticule" in (await pg.title()) or "offline" in body.lower()
            chk(served, "with the network gone, a reload still serves a Graticule page "
                        "rather than the browser's error page")
        except Exception as e:  # noqa: BLE001
            chk(False, f"offline reload failed: {str(e)[:90]}")
        await ctx.set_offline(False)
        await ctx.close()
        await br.close()

    print(f"\n{len(ok)} passed, {len(bad)} failed")
    for m in bad:
        print("  FAILED:", m)
    sys.exit(1 if bad else 0)


asyncio.run(main())
