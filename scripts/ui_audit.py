"""Hard numbers on the UI, not opinions.

Walks every visible text node and control, resolves the effective background by
compositing every ancestor's background-color (the app is layers of rgba over a
dark page, so a naive read gives 'transparent'), and computes the WCAG 2.1
contrast ratio. Also collects the font sizes actually in use, the alignment of
every control row, and the size of every interactive target.
"""
import asyncio
import sys
from collections import Counter
from playwright.async_api import async_playwright

# Port was hardcoded to 8731, so a port passed on the command line was
# silently ignored and this measured whatever server was already up.
# ?terrain=off: this suite measures type, contrast and target size, not the globe, and under
# SwiftShader the displaced terrain mesh is expensive enough to stall a
# full-page screenshot.
PORT = sys.argv[1] if len(sys.argv) > 1 else "8731"
URL = f"http://127.0.0.1:{PORT}/?terrain=off"


JS = r"""
() => {
  const parse = (c) => {
    const m = String(c).match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/);
    if (!m) return null;
    return [ +m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4] ];
  };
  const over = (fg, bg) => {
    const a = fg[3];
    return [ fg[0]*a + bg[0]*(1-a), fg[1]*a + bg[1]*(1-a), fg[2]*a + bg[2]*(1-a), 1 ];
  };
  const PAGE = [0, 0, 0, 1];
  const effBg = (el) => {
    const stack = [];
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const c = parse(getComputedStyle(n).backgroundColor);
      if (c && c[3] > 0) stack.push(c);
    }
    let bg = PAGE.slice();
    for (let i = stack.length - 1; i >= 0; i--) bg = over(stack[i], bg);
    return bg;
  };
  const lum = (c) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4); };
    return 0.2126*f(c[0]) + 0.7152*f(c[1]) + 0.0722*f(c[2]);
  };
  const ratio = (a, b) => {
    const la = lum(a), lb = lum(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  };

  const out = { text: [], sizes: {}, rows: [], targets: [] };
  const scope = '#hud *, #topbar *, #dashboard *, #settings-overlay *, #palette *, '
              + '#timeline *, #legend *, #feedstrip *, #alerts-panel *';
  for (const el of document.querySelectorAll(scope)) {
    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden' || +s.opacity === 0) continue;
    // checkVisibility walks ancestors: the alerts panel hides itself with
    // opacity 0 on a PARENT, and without this every string inside it came back
    // at contrast 1.00 and swamped the real failures.
    if (el.checkVisibility && !el.checkVisibility({ opacityProperty: true,
        visibilityProperty: true, contentVisibilityAuto: true })) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue;

    const own = [...el.childNodes].filter(n => n.nodeType === 3)
                  .map(n => n.textContent.trim()).join(' ').trim();
    const px = parseFloat(s.fontSize);
    if (own) {
      out.sizes[px] = (out.sizes[px] || 0) + 1;
      const fg0 = parse(s.color);
      if (fg0) {
        const bg = effBg(el);
        let op = 1;
        for (let n = el; n && n.nodeType === 1; n = n.parentElement) op *= +getComputedStyle(n).opacity;
        const fg = over([fg0[0], fg0[1], fg0[2], fg0[3] * op], bg);
        const cr = ratio(fg, bg);
        const bold = (parseInt(s.fontWeight, 10) || 400) >= 700;
        const large = px >= 24 || (px >= 18.66 && bold);
        const floor = large ? 3.0 : 4.5;
        out.text.push({ text: own.slice(0, 44), cls: String(el.className).slice(0, 34),
                        px, weight: s.fontWeight, cr: +cr.toFixed(2), floor,
                        pass: cr >= floor, fg: s.color,
                        bgc: 'rgb(' + bg.slice(0,3).map(v => Math.round(v)).join(',') + ')' });
      }
    }
    if (el.matches('button, a, input, select, summary, label.sw, .chip, .wf-item, .rs-chip')) {
      // The TARGET is what you can click, which for a checkbox or radio inside
      // a <label> is the whole label -- a 16px box in a 400x33 row is not a
      // 16px target. Measuring the input alone reported four false failures in
      // the settings modal, and an audit that cries wolf stops being read.
      let box = r;
      const lab = el.closest('label');
      if (lab && (el.type === 'checkbox' || el.type === 'radio')) {
        const lr = lab.getBoundingClientRect();
        if (lr.width >= r.width && lr.height >= r.height) box = lr;
      }
      out.targets.push({ tag: el.tagName.toLowerCase(), cls: String(el.className).slice(0, 30),
                         w: Math.round(box.width), h: Math.round(box.height),
                         label: (el.innerText || el.getAttribute('aria-label') || '').slice(0, 28) });
    }
  }
  for (const sel of ['.wf-row', '.ctl', '.sw']) {
    for (const el of document.querySelectorAll('#hud ' + sel)) {
      const s = getComputedStyle(el);
      if (s.display === 'none') continue;
      const r = el.getBoundingClientRect();
      if (r.width < 1) continue;
      const kids = [...el.children].map(k => {
        const kr = k.getBoundingClientRect();
        return { cls: String(k.className).slice(0, 20) || k.tagName.toLowerCase(),
                 l: Math.round(kr.left), r: Math.round(kr.right),
                 cy: Math.round(kr.top + kr.height / 2), h: Math.round(kr.height) };
      });
      const body = el.closest('[data-mode-body]');
      const pane = el.closest('[data-pane]');
      out.rows.push({ sel, pane: (body && body.dataset.modeBody) || (pane && pane.dataset.pane) || '?',
                      l: Math.round(r.left), r: Math.round(r.right),
                      cy: Math.round(r.top + r.height / 2), h: Math.round(r.height), kids });
    }
  }
  return out;
}
"""


async def main():
    surfaces = []
    async with async_playwright() as p:
        br = await p.chromium.launch(args=["--use-gl=angle", "--use-angle=swiftshader",
                                           "--enable-unsafe-swiftshader", "--disable-dev-shm-usage"])
        pg = await br.new_page(viewport={"width": 1600, "height": 950})
        await pg.goto(URL, wait_until="load")
        await pg.wait_for_function("()=>typeof viewer!=='undefined'&&viewer&&viewer.scene", timeout=60000)
        await asyncio.sleep(24)

        async def grab(name):
            surfaces.append((name, await pg.evaluate(JS)))

        await grab("radar")
        for d in ["model", "satellite", "obs", "outlooks", "mapping", "earth", "sky", "world"]:
            await pg.click('#wx-modes .chip[data-mode="%s"]' % d)
            await asyncio.sleep(0.7)
            await grab(d)
        await pg.click('.hud-tab[data-tab="alerts"]'); await asyncio.sleep(2.5); await grab("alerts")
        await pg.click('.hud-tab[data-tab="broadcast"]'); await asyncio.sleep(1.0); await grab("broadcast")
        await pg.click('.hud-tab[data-tab="alerts"]'); await asyncio.sleep(1.5)
        await pg.click('[data-pane="alerts"] [data-dash="storm"]'); await asyncio.sleep(6); await grab("dash-storm")
        await pg.keyboard.press("Escape"); await asyncio.sleep(1)
        await pg.click("#settings-btn"); await asyncio.sleep(1.2); await grab("settings")
        await pg.keyboard.press("Escape"); await asyncio.sleep(0.6)
        await pg.keyboard.press("Control+k"); await asyncio.sleep(0.8); await grab("palette")
        await br.close()

    fails, sizes, rows, targets = [], Counter(), [], []
    seen = set()
    total_text = 0
    for name, s in surfaces:
        for t in s["text"]:
            k = (t["text"], t["cls"], t["px"])
            if k in seen:
                continue
            seen.add(k)
            total_text += 1
            if not t["pass"]:
                fails.append((name, t))
        for px, n in s["sizes"].items():
            sizes[float(px)] += n
        rows += [dict(r, surface=name) for r in s["rows"]]
        targets += [dict(t, surface=name) for t in s["targets"]]

    print("=== CONTRAST: %d of %d distinct text elements fail WCAG AA ===" % (len(fails), total_text))
    for name, t in sorted(fails, key=lambda x: x[1]["cr"])[:45]:
        print("  %5.2f (need %.1f) %5.1fpx  %-11s %-36s .%s"
              % (t["cr"], t["floor"], t["px"], name, t["text"][:36], t["cls"][:26]))

    print("\n=== FONT SIZES IN USE: %d distinct ===" % len(sizes))
    for px in sorted(sizes):
        print("  %5.1fpx  x%d" % (px, sizes[px]))

    print("\n=== ROW EDGES (label left / value right, per pane) ===")
    by_pane = {}
    for r in rows:
        by_pane.setdefault((r["surface"], r["sel"]), []).append(r)
    for (surface, sel), rs in sorted(by_pane.items()):
        if len(rs) < 2:
            continue
        # Compare like with like. The last child of a row that carries a count
        # is the count; the last child of a row without one is the label, and
        # those two ending at different x is correct, not ragged. What has to
        # line up is each ROLE's column.
        lefts = Counter(r["kids"][0]["l"] for r in rs if r["kids"])
        vals = Counter()
        for r in rs:
            for k in r["kids"]:
                if any(c in k["cls"] for c in ("count", "sw-n", "ctl-v", "row-v")):
                    vals[k["r"]] += 1
        if len(lefts) > 1 or len(vals) > 1:
            print("  %-11s %-8s n=%-3d label-left=%s value-right=%s"
                  % (surface, sel, len(rs), dict(lefts), dict(vals)))

    print("\n=== OFF-CENTRE CONTROLS (child centre vs row centre, >=2px) ===")
    bad = []
    for r in rows:
        for k in r["kids"]:
            d = k["cy"] - r["cy"]
            if abs(d) >= 2:
                bad.append((abs(d), r["surface"], r["sel"], k["cls"], d, r["h"], k["h"]))
    uniq = {}
    for d, surface, sel, cls, off, rh, kh in bad:
        uniq.setdefault((sel, cls, off, rh, kh), surface)
    for (sel, cls, off, rh, kh), surface in sorted(uniq.items(), key=lambda x: -abs(x[0][2]))[:25]:
        print("  %+3dpx  %-11s %-8s .%-22s row h=%d child h=%d" % (off, surface, sel, cls, rh, kh))
    if not uniq:
        print("  none")

    print("\n=== SMALL TARGETS (<24px in either axis) ===")
    small = {}
    for t in targets:
        if t["w"] < 24 or t["h"] < 24:
            small[(t["cls"], t["w"], t["h"])] = t["label"]
    for (cls, w, h), label in sorted(small.items())[:30]:
        print("  %3dx%-3d .%-32s %s" % (w, h, cls, label))
    print("  (%d distinct small targets)" % len(small))


asyncio.run(main())
