"""The rail pane and the full board are the same app, so they say the same
thing. Measured at the same instant, they used to be 24,024,187 people apart.

Every number here is checked against a second, independent derivation, because
a counter that is merely self-consistent can still be self-consistently wrong.
"""
import asyncio, sys
from playwright.async_api import async_playwright

# Port was hardcoded to 8731, so a port passed on the command line was
# silently ignored and this measured whatever server was already up.
# ?terrain=off: this suite measures world population numbers, not the globe, and under
# SwiftShader the displaced terrain mesh is expensive enough to stall a
# full-page screenshot.
PORT = sys.argv[1] if len(sys.argv) > 1 else "8731"
URL = f"http://127.0.0.1:{PORT}/?terrain=off"

ok, bad = [], []
def chk(c, msg):
    (ok if c else bad).append(msg)
    print(("  PASS  " if c else "  FAIL  ") + msg)

YEAR_S = 31_556_952


async def main():
    async with async_playwright() as p:
        br = await p.chromium.launch(args=["--use-gl=angle", "--use-angle=swiftshader",
                                           "--enable-unsafe-swiftshader", "--disable-dev-shm-usage"])
        pg = await br.new_page(viewport={"width": 1600, "height": 950})
        await pg.goto(URL, wait_until="load")
        await pg.wait_for_function("()=>typeof viewer!=='undefined'&&viewer&&viewer.scene", timeout=60000)
        await asyncio.sleep(25)

        await pg.click('#wx-modes .chip[data-mode="world"]')
        await asyncio.sleep(3)

        print("== The pane is on the real dataset, not the fallback ==")
        loaded = await pg.evaluate("()=>!!(WD.data && WD.data.countries && WD.data.countries.length)")
        chk(loaded, "world_population.json is loaded without opening the board")
        note = await pg.evaluate("()=>document.getElementById('wp-src').textContent")
        chk("World Bank" in note, f"and the pane cites the source it is using: {note[:52]}...")

        print("== Pane and board agree on the headline number ==")
        await pg.click('#wd-open')
        await asyncio.sleep(3)
        r = await pg.evaluate("""() => {
          const n = s => Number(String(s).replace(/[^0-9]/g, ''));
          return { rail: n(document.getElementById('wp-total').textContent),
                   board: n(document.getElementById('wd-total').textContent) };
        }""")
        # Both tick independently (1Hz vs 10Hz) off the same projection, so they
        # can be a fraction of a second apart. World growth is ~2.2 people/sec,
        # so anything past a handful of people is a real disagreement.
        chk(abs(r["rail"] - r["board"]) < 60,
            f"rail {r['rail']:,} vs board {r['board']:,} -> {abs(r['rail']-r['board']):,} apart")

        print("== And on the continent rows ==")
        rows = await pg.evaluate("""() => {
          const n = s => Number(String(s).replace(/[^0-9]/g, ''));
          const rail = {};
          for (const li of document.querySelectorAll('#wp-continents li'))
            rail[li.querySelector('.r-n').textContent.trim()] = n(li.querySelector('.r-v').textContent);
          const board = {};
          for (const row of document.querySelectorAll('#wd-continents .wd-r')) {
            const nm = row.querySelector('.wd-r-name');
            const v  = row.querySelector('.wd-r-val');
            if (nm && v) board[nm.textContent.trim()] = n(v.textContent);
          }
          return { rail, board };
        }""")
        chk(len(rows["rail"]) >= 5, f"the pane lists {len(rows['rail'])} continents")
        if rows["board"]:
            worst, name = 0, ""
            for k, v in rows["rail"].items():
                if k in rows["board"]:
                    d = abs(v - rows["board"][k])
                    if d > worst: worst, name = d, k
            chk(len(rows["board"]) >= 5, f"the board lists {len(rows['board'])} continents")
            chk(worst < 5000, f"largest continent disagreement: {name} {worst:,}")
        else:
            chk(False, "board continent rows not found -- the selector is wrong, "
                       "so this comparison was silently skipping")

        print("== The pane does not contradict itself ==")
        v = await pg.evaluate("""() => {
          const n = s => Number(String(s).replace(/[^0-9]/g, ''));
          const d = new Date();
          return { births: n(document.getElementById('wp-births').textContent),
                   deaths: n(document.getElementById('wp-deaths').textContent),
                   growth: n(document.getElementById('wp-growth').textContent),
                   daySec: d.getUTCHours()*3600 + d.getUTCMinutes()*60 + d.getUTCSeconds() };
        }""")
        chk(abs((v["births"] - v["deaths"]) - v["growth"]) <= 2,
            f"growth today == births - deaths ({v['growth']:,} vs {v['births']-v['deaths']:,})")

        # The defect that started this: the odometer grew at one rate while the
        # panel under it implied another. Both must describe the same world.
        implied = v["growth"] / max(v["daySec"], 1) * YEAR_S
        odo = await pg.evaluate("""async () => {
          const n = s => Number(String(s).replace(/[^0-9]/g, ''));
          const a = n(document.getElementById('wd-total').textContent);
          await new Promise(r => setTimeout(r, 6000));
          return n(document.getElementById('wd-total').textContent) - a;
        }""")
        measured = odo / 6 * YEAR_S
        chk(abs(implied - measured) / max(implied, 1) < 0.12,
            f"growth panel implies {implied/1e6:.1f}M/yr, the odometer actually "
            f"grows {measured/1e6:.1f}M/yr")
        chk(60e6 < implied < 80e6, f"and that is a believable world figure ({implied/1e6:.1f}M/yr)")

        print("== Deaths match the published rate, not the old constant ==")
        dr = v["deaths"] / max(v["daySec"], 1) * YEAR_S
        chk(abs(dr - 62e6) / 62e6 < 0.05,
            f"deaths project to {dr/1e6:.1f}M/yr against UN WPP 62M (was 79.2M)")

        print("== The board fits the screen it is designed to fill ==")
        fit = await pg.evaluate("""() => {
          const b = document.getElementById('worlddash');
          const rest = document.getElementById('wd-rest');
          const src  = document.getElementById('wd-src');
          const rr = rest.getBoundingClientRect(), sr = src.getBoundingClientRect();
          return { over: b.scrollHeight - b.clientHeight,
                   restBottom: Math.round(rr.bottom), srcTop: Math.round(sr.top),
                   vh: innerHeight };
        }""")
        chk(fit["over"] <= 0, f"no vertical overflow (was 27px, now {fit['over']}px)")
        chk(fit["restBottom"] <= fit["srcTop"],
            f"the last country row ends at {fit['restBottom']} above the source line at {fit['srcTop']}")
        chk(fit["restBottom"] <= fit["vh"], "and inside the viewport")

        print("== Every ranking is ranked by the number it shows ==")
        order = await pg.evaluate("""() => {
          const n = s => Number(String(s).replace(/[^0-9]/g, ''));
          const read = (sel) => [...document.querySelectorAll(sel)].map(r => ({
            rank: n(r.querySelector('.wd-c-n').textContent),
            name: r.querySelector('.wd-c-name').textContent.trim(),
            val:  n(r.querySelector('.wd-c-val').textContent) }));
          return { top: read('#wd-top15 .wd-c'), rest: read('#wd-rest .wd-c') };
        }""")
        for key in ("top", "rest"):
            rows = sorted(order[key], key=lambda r: r["rank"])
            bad_pairs = [(a, b) for a, b in zip(rows, rows[1:]) if a["val"] < b["val"]]
            chk(len(rows) > 0, f"{key}: read {len(rows)} rows")
            chk(not bad_pairs,
                f"{key}: rank order matches value order"
                + ("" if not bad_pairs else
                   f" -- #{bad_pairs[0][0]['rank']} {bad_pairs[0][0]['name']} {bad_pairs[0][0]['val']:,}"
                   f" ranked above #{bad_pairs[0][1]['rank']} {bad_pairs[0][1]['name']} {bad_pairs[0][1]['val']:,}"))

        await pg.keyboard.press("Escape")
        await br.close()

    print("\n%d passed, %d failed" % (len(ok), len(bad)))
    for m in bad:
        print("  FAILED:", m)
    sys.exit(1 if bad else 0)

asyncio.run(main())
