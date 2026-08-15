"""What is actually inside the long tasks that border_perf_test fails on?

border_perf_test.py counts main-thread stalls over the first 50 s and gates
them. It has never said WHAT is stalling, so every attempt to fix it has been
aimed at the borders because of the file it lives in. This names the time.

Two instruments, both installed before the first application script:

  * Cesium's own update path (Scene.render, Primitive.update, the collections)
    and the WebGL calls that can block, each charged SELF time -- the child's
    duration is subtracted from its parent, so the buckets sum to the whole
    instead of counting the same milliseconds three times.
  * The same longtask observer border_perf_test uses, so the two agree on what
    a stall is.

Then every span is matched back into the long task it landed in, and whatever
is left over is printed as unattributed. A wrapper that silently failed to
install reads as a tidy zero, so `wrap()` asserts the assignment took and the
run reports how many landed.

    py -V:3.13 scripts/boot_attrib.py [port] [--ab A,B] [--runs N]

Conditions for --ab, interleaved (A,B,A,B) rather than run back to back,
because this host drifts over minutes and a block design puts all of that
drift on the second condition:

    full        as shipped
    noborders   both border files aborted at the network layer, so the app
                boots with no border geometry at all. This is the FLOOR: no
                change to border code can go below it.
    noterrain   ?terrain=off
    bare        borders aborted AND terrain off
"""
from __future__ import annotations

import asyncio
import json
import re
import statistics
import sys

from playwright.async_api import async_playwright

PORT = "8744"
CONDS = ["full"]
RUNS = 1
GPU = False
WARM = False


def parse_args(argv: list[str]) -> None:
    """Module-level so scripts/apk_boot_attrib.py can import INSTR and READ.

    The device harness MUST run the same instrument as this one, or the two
    sets of numbers are not a comparison, they are two measurements that
    happen to share a vocabulary.
    """
    global PORT, CONDS, RUNS, GPU, WARM
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == "--ab":
            i += 1
            CONDS = argv[i].split(",")
        elif a == "--runs":
            i += 1
            RUNS = int(argv[i])
        elif a == "--warm":
            # Reuse one browser across runs, so runs after the first get an
            # already-compiled shader cache. The A/B for "how much of boot is
            # shader compilation".
            WARM = True
        elif a == "--gpu":
            # The real card instead of SwiftShader. border_perf_test runs on
            # SwiftShader, so this is the control for the question "is the
            # stall the app, or is it the software rasteriser?"
            GPU = True
        else:
            PORT = a
        i += 1

SWIFT_ARGS = ["--use-gl=angle", "--use-angle=swiftshader",
              "--enable-unsafe-swiftshader", "--disable-dev-shm-usage"]
GPU_ARGS = ["--use-gl=angle", "--use-angle=d3d11",
            "--ignore-gpu-blocklist", "--enable-gpu-rasterization",
            "--disable-dev-shm-usage"]

# Identical to border_perf_test.py on purpose: a different viewport or a
# different flag makes this a measurement of something else.
DEVICE = {"width": 412, "height": 915}
WINDOW_S = 50

BORDER_URLS = ("ne_state_borders", "ne_country_borders")

INSTR = r"""
(() => {
  const G = (window.__attr = {
    longtasks: [], calls: {}, wrapped: 0, glWrapped: 0, err: null, ctxs: 0,
  });
  const now = () => performance.now();

  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        if (G.longtasks.length < 2000) {
          G.longtasks.push({t: e.startTime, ms: e.duration});
        }
      }
    }).observe({entryTypes: ['longtask'], buffered: true});
  } catch (e) { G.err = String(e); }

  function bucket(name) {
    let b = G.calls[name];
    if (!b) b = G.calls[name] = {n: 0, ms: 0, worst: 0, spans: []};
    return b;
  }

  // Self time. Scene.render calls Primitive.update calls bufferData, so a
  // naive sum counts the same millisecond three times and lands over 100%.
  // Each frame reports its total to its parent, and the parent subtracts it.
  let depth = 0;
  const childMs = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

  function charge(label, t0, total) {
    const b = bucket(label);
    b.n += 1;
    if (total > b.worst) b.worst = total;
    return b;
  }

  // A bucket name alone does not say WHICH collection stalled: there is one
  // LabelCollection per data source, and "labels are slow" is not an
  // actionable sentence. tagFn reads something off the receiver, so the span
  // carries the size of the thing that was updated.
  let serial = 0;
  function wrap(obj, name, label, tagFn) {
    if (!obj) return false;
    const fn = obj[name];
    if (typeof fn !== 'function') return false;
    obj[name] = function () {
      const t0 = now();
      if (tagFn && this && this.__attrId === undefined) this.__attrId = ++serial;
      const before = tagFn ? tagFn(this) : null;
      depth += 1;
      if (depth < childMs.length) childMs[depth] = 0;
      try {
        return fn.apply(this, arguments);
      } finally {
        const total = now() - t0;
        const kids = depth < childMs.length ? childMs[depth] : 0;
        depth -= 1;
        if (depth >= 0 && depth < childMs.length) childMs[depth] += total;
        const self = total - kids;
        const b = charge(label, t0, total);
        b.ms += self;
        // Only spans worth naming, and only while there is room, so a busy
        // page cannot turn the instrument itself into the stall.
        if (self >= 8 && b.spans.length < 600) {
          b.spans.push([t0, total, self,
                        tagFn ? `#${this.__attrId} ${before}->${tagFn(this)}` : null]);
        }
      }
    };
    // A wrapper that did not take reads as a tidy zero, which is worse than
    // no instrument at all.
    if (obj[name] === fn) return false;
    return true;
  }

  // ---- Cesium ------------------------------------------------------------
  // Cesium.js is a UMD that reads `this.Cesium` before it assigns it, so a
  // defineProperty setter fires while the namespace is still empty. Poll
  // instead, and patch the moment the classes exist. app.js only DEFINES
  // things at module scope, so this always lands before the first render.
  const CESIUM = [
    ['Scene', 'render', 'Scene.render'],
    ['Primitive', 'update', 'Primitive.update'],
    ['GroundPolylinePrimitive', 'update', 'GroundPolylinePrimitive.update'],
    ['PrimitiveCollection', 'update', 'PrimitiveCollection.update'],
    ['PolylineCollection', 'update', 'PolylineCollection.update'],
    ['LabelCollection', 'update', 'LabelCollection.update'],
    ['BillboardCollection', 'update', 'BillboardCollection.update'],
    ['PointPrimitiveCollection', 'update', 'PointPrimitiveCollection.update'],
    ['Globe', 'render', 'Globe.render'],
    ['Globe', 'beginFrame', 'Globe.beginFrame'],
    ['Globe', 'endFrame', 'Globe.endFrame'],
    ['GroundPrimitive', 'update', 'GroundPrimitive.update'],
    ['SkyBox', 'update', 'SkyBox.update'],
    ['SkyAtmosphere', 'update', 'SkyAtmosphere.update'],
    ['Moon', 'update', 'Moon.update'],
    ['Sun', 'update', 'Sun.update'],
  ];
  const LEN = (o) => (o && o.length !== undefined ? o.length : '?');
  const TAGGED = {
    'LabelCollection.update': LEN,
    'BillboardCollection.update': LEN,
    'PointPrimitiveCollection.update': LEN,
    'PolylineCollection.update': LEN,
    'Primitive.update': (o) => (o && o.geometryInstances
      ? (o.geometryInstances.length || 1) : '?'),
  };
  const cesiumTimer = setInterval(() => {
    const C = window.Cesium;
    if (!C || !C.Primitive || !C.Scene) return;
    clearInterval(cesiumTimer);
    for (const [cls, method, label] of CESIUM) {
      if (C[cls] && C[cls].prototype
          && wrap(C[cls].prototype, method, label, TAGGED[label])) {
        G.wrapped += 1;
      }
    }
    if (C.DataSourceDisplay
        && wrap(C.DataSourceDisplay.prototype, 'update', 'DataSourceDisplay.update')) {
      G.wrapped += 1;
    }
    G.cesiumAt = now();
  }, 1);

  // ---- WebGL -------------------------------------------------------------
  // The calls that can block: uploads, draws, shader link, and the readbacks
  // that force a flush. Timing every GL call would make the instrument the
  // cost. Names are prefixed so they sort together in the report.
  const WATCH = [
    'texImage2D', 'texSubImage2D', 'compressedTexImage2D', 'texStorage2D',
    'bufferData', 'bufferSubData',
    'drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced',
    'readPixels', 'finish', 'flush', 'getError', 'clientWaitSync',
    'compileShader', 'linkProgram', 'getProgramParameter', 'getShaderParameter',
    'useProgram', 'generateMipmap', 'copyTexImage2D', 'copyTexSubImage2D',
  ];
  const realGetContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type) {
    const ctx = realGetContext.apply(this, arguments);
    if (ctx && /webgl/i.test(String(type)) && !ctx.__attrWrapped) {
      ctx.__attrWrapped = true;
      G.ctxs += 1;
      for (const name of WATCH) {
        if (wrap(ctx, name, 'gl.' + name)) G.glWrapped += 1;
      }
      // Sits OUTSIDE the timing wrapper so the fingerprint read is not
      // charged to linkProgram itself.
      const timedLink = ctx.linkProgram;
      if (typeof timedLink === 'function') {
        ctx.linkProgram = function (program) {
          const t0 = now();
          const r = timedLink.apply(this, arguments);
          window.__attrNoteLink(this, program, t0);
          return r;
        };
      }
    }
    return ctx;
  };

  // ---- Which shaders, not just how many ----------------------------------
  // Cesium 1.121 links every program synchronously: compileShader x2,
  // linkProgram, then getProgramParameter(LINK_STATUS), which blocks until
  // the driver is done. "84 programs" is not actionable; knowing WHICH
  // feature flags generated them is. Cesium stamps its variants as #define
  // lines, so the define set names the variant.
  G.programs = [];
  function fingerprint(gl, program) {
    try {
      const defs = [];
      for (const sh of (gl.getAttachedShaders(program) || [])) {
        const src = gl.getShaderSource(sh) || '';
        for (const m of src.matchAll(/^\s*#define\s+([A-Za-z0-9_]+)/gm)) {
          defs.push(m[1]);
        }
      }
      return defs.sort().join(',') || '(no defines)';
    } catch (e) { return '(unreadable)'; }
  }
  // The LINK_STATUS query is forced HERE rather than left for Cesium, which
  // asks for it on the very next line anyway. Same work, same task, same
  // frame -- but now the milliseconds arrive attached to the program that
  // caused them instead of in an anonymous pile of 81 calls.
  const noteLink = (gl, program, t0) => {
    const q0 = now();
    let okLink = null;
    try { okLink = gl.getProgramParameter(program, gl.LINK_STATUS); } catch (e) {}
    const linkMs = now() - q0;
    if (G.programs.length < 400) {
      G.programs.push({t: t0, ms: linkMs, ok: okLink, defs: fingerprint(gl, program),
                       layers: layerState()});
    }
  };

  // Cesium keys its globe shader on the IMAGERY LAYER FLAGS, so a variant is
  // caused by whatever the layer stack looked like at the moment it linked.
  // "10 globe shaders" is a fact; "the night-lights fade turns APPLY_ALPHA on
  // and then off again" is a fix. This records the cause with the cost.
  function layerState() {
    try {
      const v = window.__graticule_viewer;
      if (!v || !v.imageryLayers) return null;
      const L = v.imageryLayers, out = [];
      for (let i = 0; i < L.length; i++) {
        const l = L.get(i);
        const f = [];
        if (l.alpha !== 1) f.push('A' + l.alpha.toFixed(2));
        if (l.brightness !== 1) f.push('B');
        if (l.contrast !== 1) f.push('C');
        if (l.hue !== 0) f.push('H');
        if (l.saturation !== 1) f.push('S');
        if (l.gamma !== 1) f.push('G');
        if (l.dayAlpha !== 1 || l.nightAlpha !== 1) f.push('DN');
        if (!l.show) f.push('hidden');
        // Which layer, not just which flags: "a fifth layer appeared" is not
        // a cause, "the radar mosaic appeared" is.
        const p = l.imageryProvider || {};
        const who = String(p.url || p._url || p.credit || p.constructor.name || '?')
          .replace(/^https?:\/\//, '').split(/[?{]/)[0].slice(-22);
        out.push(who + '[' + (f.join('') || '-') + ']');
      }
      return out.join(' | ');
    } catch (e) { return null; }
  }
  window.__attrNoteLink = noteLink;

  // ---- The main thread's own share --------------------------------------
  wrap(JSON, 'parse', 'JSON.parse');
  wrap(JSON, 'stringify', 'JSON.stringify');
})();
"""

READ = """() => {
  const G = window.__attr || {};
  const out = {err: G.err || null, wrapped: G.wrapped || 0,
               glWrapped: G.glWrapped || 0, ctxs: G.ctxs || 0,
               cesiumAt: G.cesiumAt || null,
               longtasks: (G.longtasks || []).map(e => [e.t, e.ms]),
               calls: {}};
  for (const [k, v] of Object.entries(G.calls || {})) {
    out.calls[k] = {n: v.n, ms: v.ms, worst: v.worst, spans: v.spans};
  }
  out.borders = window.__graticule_borders || null;
  out.programs = G.programs || [];
  return out;
}"""

# A stall the instrument MUST see. Without it a clean attribution report is
# equally consistent with an instrument that measured nothing.
CONTROL = """() => {
  const gl = window.__graticule_viewer
    && window.__graticule_viewer.scene.context._gl;
  if (!gl) return null;
  const t0 = performance.now();
  const px = new Uint8Array(4 * 512 * 512);
  gl.readPixels(0, 0, 512, 512, gl.RGBA, gl.UNSIGNED_BYTE, px);
  return {wallMs: performance.now() - t0};
}"""


def stats(lts: list[list[float]]) -> dict:
    ms = [d for _, d in lts]
    return {
        "count": len(ms),
        "totalTaskMs": round(sum(ms)),
        "blockingMs": round(sum(max(0.0, m - 50.0) for m in ms)),
        "worstMs": round(max(ms)) if ms else 0,
        "lastEndMs": round(max((t + d for t, d in lts), default=0)),
    }


def attribute(res: dict) -> list[tuple[str, float, int, float]]:
    rows = []
    for name, v in res["calls"].items():
        rows.append((name, v["ms"], v["n"], v["worst"]))
    rows.sort(key=lambda r: -r[1])
    return rows


def inside(spans: list, t0: float, t1: float) -> float:
    """Self ms of spans whose START lands in [t0, t1).

    Start rather than overlap: a span that begins inside the task belongs to
    it, and one long GL call cannot be split across two tasks anyway.
    """
    return sum(s[2] for s in spans if t0 <= s[0] < t1)


async def one_run(br, cond: str) -> dict:
    url = (f"http://127.0.0.1:{PORT}/"
           + ("?terrain=off" if cond in ("noterrain", "bare") else ""))
    ctx = await br.new_context(viewport=DEVICE, device_scale_factor=3,
                              is_mobile=True, has_touch=True)
    await ctx.add_init_script(INSTR)

    # Registered on the CONTEXT and before the page exists, and it COUNTS what
    # it killed. The first version of this used a page-level glob and silently
    # matched nothing on one run, which reads exactly like a floor measurement
    # and is not one.
    # Seeded before the app reads it, so the condition is the app's own
    # setting rather than a harness override the app does not know about.
    if cond == "nodim":
        await ctx.add_init_script(
            "try { localStorage.setItem('graticule.settings.v1',"
            " JSON.stringify({dimBaseUnderData: false})); } catch (e) {}")

    aborted: list[str] = []
    if cond in ("noborders", "bare"):
        async def block(route):
            aborted.append(route.request.url)
            await route.abort()
        await ctx.route(re.compile(r"ne_(state|country)_borders"), block)

    pg = await ctx.new_page()
    console: list[str] = []
    pg.on("console", lambda m: console.append(m.text)
          if "border lines" in m.text else None)

    await pg.goto(url, wait_until="load")
    await pg.wait_for_function(
        "()=>window.__graticule_viewer && window.__graticule_viewer.scene",
        timeout=90_000)
    await asyncio.sleep(WINDOW_S)

    res = await pg.evaluate(READ)
    ctrl = await pg.evaluate(CONTROL)
    res["control"] = ctrl
    # Which rasteriser actually ran. --gpu is a request, not a fact: if ANGLE
    # falls back, every number below is a SwiftShader number wearing a GPU
    # label, and the whole comparison is void.
    res["renderer"] = await pg.evaluate("""() => {
      const gl = window.__graticule_viewer.scene.context._gl;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)
                 : gl.getParameter(gl.RENDERER);
    }""")
    res["console"] = console
    res["cond"] = cond
    res["aborted"] = aborted
    await ctx.close()
    if cond in ("noborders", "bare"):
        if not aborted:
            raise SystemExit(f"{cond}: nothing was aborted, so this is not a "
                             f"floor measurement. The route did not match.")
        if res.get("borders"):
            raise SystemExit(f"{cond}: borders drew anyway "
                             f"({res['borders'].get('positions')} positions) "
                             f"after aborting {len(aborted)} requests.")
    return res


def report(res: dict) -> None:
    st = stats(res["longtasks"])
    print(f"\n---- {res['cond']} ----")
    print(f"   renderer: {res.get('renderer')}")
    print(f"   wrappers {res['wrapped']} cesium + {res['glWrapped']} gl "
          f"on {res['ctxs']} context(s), patched at "
          f"{res['cesiumAt'] and round(res['cesiumAt'])} ms")
    if res["err"]:
        print(f"   OBSERVER FAILED: {res['err']}")
    for line in res["console"]:
        print(f"   {line[:88]}")
    print(f"   long tasks {st['count']}   total {st['totalTaskMs']} ms   "
          f"blocking {st['blockingMs']} ms   worst {st['worstMs']} ms   "
          f"last ends {st['lastEndMs']} ms")

    rows = attribute(res)
    named = sum(r[1] for r in rows)
    print(f"   {'bucket':<34}{'self ms':>9}{'calls':>8}{'worst':>8}")
    for name, ms, n, worst in rows:
        if ms < 1:
            continue
        print(f"   {name:<34}{ms:>9.0f}{n:>8}{worst:>8.0f}")
    print(f"   {'(named total)':<34}{named:>9.0f}")

    lts = sorted(res["longtasks"], key=lambda e: -e[1])[:5]
    print("   worst tasks, and what was running inside them:")
    for t, d in lts:
        parts = []
        for name, v in res["calls"].items():
            got = inside(v["spans"], t, t + d)
            if got >= 15:
                parts.append((name, got))
        parts.sort(key=lambda p: -p[1])
        acc = sum(p[1] for p in parts)
        head = ", ".join(f"{n} {m:.0f}" for n, m in parts[:5]) or "nothing named"
        print(f"     t={t:>7.0f}  {d:>6.0f} ms   {acc / d * 100:>5.1f}% named"
              f"   {head}")
        for name, v in res["calls"].items():
            for s in v["spans"]:
                if t <= s[0] < t + d and s[2] >= 100 and len(s) > 3 and s[3]:
                    print(f"          {name} {s[2]:.0f} ms  on {s[3]}")

    progs = res.get("programs") or []
    if progs:
        first = min(p["t"] for p in progs)
        last = max(p["t"] for p in progs)
        print(f"   {len(progs)} shader programs linked, "
              f"{first:.0f} ms to {last:.0f} ms after navigation")
        total_link = sum(p.get("ms", 0) for p in progs)
        print(f"   {total_link:.0f} ms of that was the blocking LINK_STATUS query")
        groups: dict[str, list[float]] = {}
        for p in progs:
            groups.setdefault(p["defs"], []).append(p.get("ms", 0))
        for defs, msl in sorted(groups.items(), key=lambda g: -sum(g[1]))[:12]:
            print(f"     x{len(msl):<3} {sum(msl):>7.0f} ms   {defs[:120]}")
        print("   every program, in the order it linked:")
        for p in sorted(progs, key=lambda p: p["t"]):
            globe = "GLOBE" if "APPLY_SATURATION" in p["defs"] else "     "
            print(f"     t={p['t']:>7.0f} {p.get('ms', 0):>7.1f} ms {globe}"
                  f"  layers[{p.get('layers')}]")

    c = res.get("control")
    if c:
        print(f"   CONTROL readPixels 512x512 wall {c['wallMs']:.0f} ms "
              f"(it must appear in gl.readPixels above)")
    b = res.get("borders")
    print(f"   borders on screen: {b and b.get('positions')} positions")


async def main() -> None:
    async with async_playwright() as p:
        by_cond: dict[str, list[dict]] = {c: [] for c in CONDS}
        # A browser per run unless --warm. chromium.launch() takes a fresh
        # temp profile, so every run starts with a COLD compiled-shader cache.
        # Reusing one browser made run 1 pay for shader compilation and run 2
        # not, which is a 15x difference on the real GPU and looked like the
        # condition under test.
        br = None
        if WARM:
            br = await p.chromium.launch(args=GPU_ARGS if GPU else SWIFT_ARGS,
                                         chromium_sandbox=False)
        for r in range(RUNS):
            for cond in CONDS:                     # interleaved, not blocked
                print(f"\n===== run {r + 1}/{RUNS}  {cond}"
                      f"  ({'warm' if WARM else 'cold'} shader cache) =====")
                own = br or await p.chromium.launch(
                    args=GPU_ARGS if GPU else SWIFT_ARGS, chromium_sandbox=False)
                try:
                    res = await one_run(own, cond)
                finally:
                    if not WARM:
                        await own.close()
                report(res)
                by_cond[cond].append(res)
        if br:
            await br.close()

    if RUNS > 1 or len(CONDS) > 1:
        print("\n===== medians =====")
        print(f"   {'cond':<12}{'blocking':>10}{'worst':>8}{'tasks':>7}{'lastEnd':>9}")
        for cond, runs in by_cond.items():
            s = [stats(r["longtasks"]) for r in runs]
            med = lambda k: round(statistics.median(x[k] for x in s))
            print(f"   {cond:<12}{med('blockingMs'):>10}{med('worstMs'):>8}"
                  f"{med('count'):>7}{med('lastEndMs'):>9}")
            print(f"                per run blocking "
                  f"{[x['blockingMs'] for x in s]}  worst {[x['worstMs'] for x in s]}")


if __name__ == "__main__":
    parse_args(sys.argv[1:])
    asyncio.run(main())
