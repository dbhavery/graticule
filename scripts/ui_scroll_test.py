"""The rail says whether there is more to see -- and stops saying it when
there is not. Every check asserts BOTH directions, so a rule that always shows
the cue, or never shows it, fails here.
"""
import asyncio, sys
from playwright.async_api import async_playwright

# The port was hardcoded to 8731 here, so passing one on the command line did
# nothing and the suite quietly measured whatever server happened to be running
# -- not the one under test.
#
# ?terrain=off because this measures RAIL LAYOUT, not the globe. Under
# SwiftShader the displaced terrain mesh costs enough that page.screenshot()
# could not complete inside its 60 s timeout.
PORT = sys.argv[1] if len(sys.argv) > 1 else "8731"
URL = f"http://127.0.0.1:{PORT}/?terrain=off"

ok, bad = [], []
def chk(c, msg):
    (ok if c else bad).append(msg)
    print(("  PASS  " if c else "  FAIL  ") + msg)


async def main():
    async with async_playwright() as p:
        br = await p.chromium.launch(args=["--use-gl=angle", "--use-angle=swiftshader",
                                           "--enable-unsafe-swiftshader", "--disable-dev-shm-usage"])
        pg = await br.new_page(viewport={"width": 1600, "height": 950})
        await pg.goto(URL, wait_until="load")
        await pg.wait_for_function("()=>typeof viewer!=='undefined'&&viewer&&viewer.scene", timeout=60000)
        await asyncio.sleep(25)

        state = """() => {
          const w = document.getElementById('hud-scroll');
          const b = document.getElementById('hud-panes');
          const bot = document.getElementById('hud-fade-bot');
          const vis = (el) => !!el && el.checkVisibility({opacityProperty:true, visibilityProperty:true});
          return { up: w.classList.contains('can-up'), down: w.classList.contains('can-down'),
                   hidden: b.scrollHeight - b.clientHeight, top: Math.round(b.scrollTop),
                   botPainted: vis(bot) };
        }"""

        print("== A division with more content than fits ==")
        await pg.click('#wx-modes .chip[data-mode="world"]'); await asyncio.sleep(1.5)
        s = await pg.evaluate(state)
        chk(s["hidden"] > 100, f"world overflows its box (hidden={s['hidden']}px)")
        chk(s["down"], "and the 'more below' edge is on")
        chk(s["botPainted"], "and that edge is actually painted, not just classed")
        chk(not s["up"], "with no 'more above' edge at scrollTop 0")

        # The invariant, checked on the same snapshot that produced the numbers.
        # Asserting a fixed expectation here was flaky and the app was right:
        # World's rank list rotates rows on a timer, so "scrolled to the end"
        # stops being true a beat after you scroll there, and can-down correctly
        # comes back on. Radar is static, so it carries the hard end-state check.
        chk(s["down"] == (s["top"] < s["hidden"] - 4) and s["up"] == (s["top"] > 4),
            "edges match scroll position exactly, on a division that is ticking")

        print("== Scrolled to the bottom of a division that does not tick ==")
        await pg.click('#wx-modes .chip[data-mode="radar"]'); await asyncio.sleep(1.5)
        # Shorten the window rather than relying on Radar being long enough.
        # It used to overflow by a few hundred pixels because it carried six
        # inert product buttons and two paragraphs of engineering apology; when
        # those came out, this fixture stopped overflowing and three checks
        # failed on a pane that had got BETTER. What is under test is the
        # scroll affordance, not how much content a pane happens to hold, so
        # the fixture now guarantees overflow by making the viewport short.
        await pg.set_viewport_size({"width": 1600, "height": 620})
        await asyncio.sleep(1.0)
        s = await pg.evaluate(state)
        chk(s["hidden"] > 20, f"radar overflows too (hidden={s['hidden']}px)")
        chk(s["down"] and not s["up"], "at the top: 'more below' only")
        await pg.evaluate("()=>{const b=document.getElementById('hud-panes');b.scrollTop=b.scrollHeight;}")
        await asyncio.sleep(0.6)
        s = await pg.evaluate(state)
        chk(s["up"], "'more above' turns on")
        chk(not s["down"], "'more below' turns OFF at the end (the control)")
        chk(not s["botPainted"], "and stops being painted")

        # Back to full height, or the next section's "this one FITS" fixture is
        # measured in a window deliberately made too short for anything to fit.
        await pg.set_viewport_size({"width": 1600, "height": 950})
        await asyncio.sleep(1.0)

        print("== A division that fits ==")
        await pg.click('#wx-modes .chip[data-mode="satellite"]'); await asyncio.sleep(1.5)
        s = await pg.evaluate(state)
        chk(s["hidden"] <= 4, f"satellite fits its box (hidden={s['hidden']}px)")
        chk(not s["down"] and not s["up"],
            "so NEITHER edge shows -- including after arriving from a scrolled division")

        print("== The scrollbar thumb is actually visible ==")
        thumb = await pg.evaluate("""() => {
          for (const s of document.styleSheets) {
            let rules; try { rules = s.cssRules } catch { continue }
            for (const r of rules) {
              if (r.selectorText && r.selectorText.includes('#hud-panes::-webkit-scrollbar-thumb')
                  && !r.selectorText.includes(':hover'))
                return r.style.background;
            }
          }
          return null;
        }""")
        # WCAG 1.4.11: a non-text UI component needs 3:1 against what is behind it.
        import re
        m = re.search(r"rgba\(255,\s*255,\s*255,\s*([\d.]+)\)", thumb or "")
        chk(bool(m), f"thumb colour found: {thumb}")
        if m:
            a = float(m.group(1))
            bg = (11, 14, 19)                      # --rail-bg #0b0e13
            fg = [a * 255 + (1 - a) * c for c in bg]
            def lum(c):
                f = lambda v: (v / 255 / 12.92) if v / 255 <= 0.03928 else (((v / 255) + 0.055) / 1.055) ** 2.4
                return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2])
            cr = (lum(fg) + 0.05) / (lum(bg) + 0.05)
            chk(cr >= 3.0, f"thumb contrast {cr:.2f}:1 vs the 3:1 floor for a UI component")

        print("== The world dashboard opener is reachable without scrolling ==")
        await pg.click('#wx-modes .chip[data-mode="world"]'); await asyncio.sleep(1.2)
        r = await pg.evaluate("""() => {
          const b = document.getElementById('wd-open');
          const box = document.getElementById('hud-panes');
          if (!b) return null;
          const br = b.getBoundingClientRect(), pr = box.getBoundingClientRect();
          const hit = document.elementFromPoint(br.left + br.width/2, br.top + br.height/2);
          return { inView: br.top >= pr.top - 1 && br.bottom <= pr.bottom + 1,
                   onTop: !!hit && (hit === b || b.contains(hit)),
                   scrollTop: box.scrollTop };
        }""")
        chk(r is not None, "the opener exists")
        chk(r and r["scrollTop"] == 0, "the rail has not been scrolled")
        chk(r and r["inView"], "and the opener is inside the visible rail box")
        chk(r and r["onTop"], "and nothing is covering it")

        print("== It opens the board ==")
        await pg.click("#wd-open"); await asyncio.sleep(2.5)
        vis = await pg.evaluate("""()=>{const e=document.getElementById('worlddash');
          return e && !e.classList.contains('hidden')
              && e.checkVisibility({opacityProperty:true,visibilityProperty:true});}""")
        chk(bool(vis), "world population board is on screen")
        await pg.screenshot(path=r"C:\Users\dbhav\AppData\Local\Temp\claude\C--Users-dbhav-Projects\1c129daf-7a32-41ca-b2ff-3a484cdf0078\scratchpad\sw_09_worldboard.png", timeout=60000)
        await pg.keyboard.press("Escape"); await asyncio.sleep(0.8)
        gone = await pg.evaluate("()=>document.getElementById('worlddash').classList.contains('hidden')")
        chk(gone, "and Escape closes it (the control)")

        print("== Radar products are dead while their layer is off ==")
        await pg.click('#wx-modes .chip[data-mode="radar"]'); await asyncio.sleep(1.2)
        s = await pg.evaluate("""() => {
          const site = document.querySelector('input[data-layer="radar_site"]');
          const grps = [...document.querySelectorAll('[data-requires="radar_site"]')];
          const grp = grps.find(g => g.querySelector('.wf-item[data-product]'));
          const btns = [...grp.querySelectorAll('.wf-item[data-product]')];
          const act = grp.querySelector('.wf-item.is-active');
          return { on: site.checked, groups: grps.length, n: btns.length,
                   off: grp.classList.contains('is-off'),
                   allOff: grps.every(g => g.classList.contains('is-off')),
                   disabled: btns.length > 0 && btns.every(b => b.disabled),
                   activeBg: act ? getComputedStyle(act).backgroundColor : null };
        }""")
        chk(not s["on"], "Local Hi-Res Site is off at boot")
        chk(s["n"] == 6, f"the product group really holds the 6 buttons (n={s['n']}, "
                         f"{s['groups']} groups require radar_site)")
        chk(s["allOff"], "every group gated on that layer is marked is-off")
        chk(s["disabled"], "and all 6 product buttons are disabled")
        offBg = s["activeBg"]

        await pg.click('input[data-layer="radar_site"] + .sw-t'); await asyncio.sleep(1.5)
        s2 = await pg.evaluate("""() => {
          const grps = [...document.querySelectorAll('[data-requires="radar_site"]')];
          const grp = grps.find(g => g.querySelector('.wf-item[data-product]'));
          const btns = [...grp.querySelectorAll('.wf-item[data-product]')];
          const act = grp.querySelector('.wf-item.is-active');
          return { off: grp.classList.contains('is-off'), n: btns.length,
                   anyOff: grps.some(g => g.classList.contains('is-off')),
                   anyDisabled: btns.some(b => b.disabled),
                   activeBg: act ? getComputedStyle(act).backgroundColor : null };
        }""")
        chk(not s2["anyOff"], "switching the layer ON clears is-off everywhere (the control)")
        chk(s2["n"] == 6 and not s2["anyDisabled"], "and re-enables all 6 product buttons")
        chk(offBg != s2["activeBg"],
            f"the selected product looks different on vs off ({offBg} vs {s2['activeBg']})")

        await br.close()

    print("\n%d passed, %d failed" % (len(ok), len(bad)))
    for m in bad:
        print("  FAILED:", m)
    sys.exit(1 if bad else 0)

asyncio.run(main())
