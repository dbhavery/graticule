"""Which call is inside the 2-9 second boot frame?

issue 64 narrowed the worst blocking event of the boot to ONE rendered frame,
between Cesium's `preRender` and `postRender`, with no network, no tile loading,
no new primitives and no entities. A windowed CPU profile of the same window put
41% of the time in `(program)`, which is native code the sampler cannot give a
stack to, so it named nothing. That is where a CPU profiler stops.

A CPU profiler cannot see inside the GL driver. This can, because it does not
sample: it puts a timestamp on both sides of the GL calls that are able to
block, and buckets them by the animation-frame tick they ran in.

    tick        a wrapped requestAnimationFrame callback, start to return
    render      Cesium preRender -> postRender inside that tick
    gl          the wrapped calls, by name, with counts
    unattributed  tick - gl, i.e. how much of the frame is NOT in a GL call

That last row is the one that matters. If a 9-second frame carries 8 s of
`drawElements`, the answer is the rasterizer. If it carries 200 ms of GL, the
answer was never in the driver and `(program)` was pointing somewhere else.

Only calls that can BLOCK are wrapped. Wrapping every GL entry point would cost
more than it measures: Cesium issues thousands of uniform and bind calls per
frame, and two `performance.now()` calls on each of those would change the
thing being measured.

CONTROL: `--control` arms a deliberate burn -- repeated full-canvas
`readPixels`, which is a hard pipeline stall -- inside one tick at a known page
time, and FAILS unless this instrument attributes it to `readPixels` in a frame
starting at that time. A wrapper that silently failed to install still reports a
tidy table of zeroes, and a run that recorded nothing looks exactly like a run
that found nothing. The normal run's `readPixels` total is printed next to it,
so the burn has to stand out from what Cesium does on its own.

    py -V:3.13 scripts/apk_gl_frame.py
    py -V:3.13 scripts/apk_gl_frame.py --control
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
import time

from apk_probe import APP_ID, adb, attach, page_target

# A frame is worth breaking down when it is long enough to eat a tap. apk_tti.py
# uses 200 ms for that; half of it here, so a frame that is merely bad still
# appears next to the one that is catastrophic.
SLOW_TICK_MS = 100

RECORDER = r"""
window.__gl = {
  info: null, totals: {}, worst: [], frames: [], marks: {},
  cur: null, ticks: 0, ctxs: [], wrapped: 0, longtasks: [],
  burnAt: __BURN_AT__, burnDone: null,
  big: [], progq: [], state: [], stacks: [], nstacks: 0,
};

(function () {
  var G = window.__gl;
  var now = function () { return performance.now(); };

  /* Calls that can block for a long time. Uploads move bytes to the GPU,
     draws are where a deferred shader compile actually lands, and the sync
     points stall the pipeline until the driver catches up. Everything else
     Cesium calls per frame is a state change that returns immediately. */
  var WATCH = [
    'texImage2D', 'texSubImage2D', 'compressedTexImage2D',
    'compressedTexSubImage2D', 'texStorage2D', 'generateMipmap',
    'bufferData', 'bufferSubData', 'getBufferSubData',
    'drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced',
    'drawArraysInstancedANGLE', 'drawElementsInstancedANGLE', 'drawRangeElements',
    'readPixels', 'finish', 'flush', 'getError', 'clientWaitSync',
    'compileShader', 'linkProgram', 'getShaderParameter', 'getProgramParameter',
    'getShaderInfoLog', 'getProgramInfoLog', 'useProgram', 'validateProgram',
    'renderbufferStorage', 'renderbufferStorageMultisample',
    'framebufferTexture2D', 'checkFramebufferStatus', 'blitFramebuffer',
    'copyTexImage2D', 'copyTexSubImage2D', 'getParameter',
  ];

  var WATCH_2D = ['getImageData', 'putImageData', 'drawImage', 'measureText'];

  function detail(name, a) {
    try {
      if (name === 'texImage2D' || name === 'texSubImage2D' ||
          name === 'compressedTexImage2D' || name === 'compressedTexSubImage2D') {
        if (a.length >= 8 && typeof a[3] === 'number' && typeof a[4] === 'number')
          return a[3] + 'x' + a[4];
        var s = a[a.length - 1];
        if (s && s.width) return s.width + 'x' + s.height;
        return '';
      }
      if (name === 'texStorage2D') return a[3] + 'x' + a[4];
      if (name === 'bufferData' || name === 'bufferSubData') {
        var d = name === 'bufferData' ? a[1] : a[2];
        if (typeof d === 'number') return Math.round(d / 1024) + 'KB';
        if (d && d.byteLength) return Math.round(d.byteLength / 1024) + 'KB';
        return '';
      }
      if (name.indexOf('drawElements') === 0 || name === 'drawRangeElements')
        return String(a[1]);
      if (name.indexOf('drawArrays') === 0) return String(a[2]);
      if (name === 'readPixels') return a[2] + 'x' + a[3];
      if (name === 'renderbufferStorage') return a[2] + 'x' + a[3];
      if (name === 'getImageData') return a[2] + 'x' + a[3];
    } catch (e) {}
    return '';
  }

  function charge(name, t0, dur, a) {
    var t = G.totals[name] || (G.totals[name] = [0, 0]);
    t[0] += 1; t[1] += dur;
    if (G.cur) {
      var c = G.cur.gl[name] || (G.cur.gl[name] = [0, 0]);
      c[0] += 1; c[1] += dur;
      G.cur.glMs += dur;
      /* Where the NON-GL time in this frame sits. "58% unattributed" is
         ambiguous between one long block of JS and a thousand small ones
         between uploads, and those are different causes. The largest single
         stretch with no wrapped GL call in it settles which. */
      var gap = t0 - G.cur.lastEnd;
      if (gap > G.cur.maxGap) { G.cur.maxGap = gap; G.cur.maxGapAt = G.cur.lastEnd - G.cur.t0; }
      G.cur.lastEnd = t0 + dur;
    }
    /* The single slowest calls of the whole run, kept sorted so this stays
       O(1) memory. One 4-second call and four thousand 1 ms calls are
       different findings and the totals table cannot tell them apart. */
    if (dur >= 8 && G.worst.length < 400) {
      G.worst.push([Math.round(t0), Math.round(dur), name, detail(name, a)]);
    }

    /* Every large upload, cheap ones included. The totals table cannot tell
       "one 15 MB buffer" from "the same 15 MB buffer twelve times", and those
       are different defects with different fixes. */
    if (name === 'bufferData') {
      var d = typeof a[1] === 'number' ? a[1] : (a[1] && a[1].byteLength) || 0;
      if (d >= 1048576 && G.big.length < 400) {
        G.big.push([Math.round(t0), Math.round(d / 1024), Math.round(dur)]);
        /* A stack for the first few only: building one is not free, and four
           is enough to say whether they all come from the same call site.
           Counted separately from the array, because draining empties the
           array and a length test would then collect four more every time. */
        if (G.nstacks < 4) {
          G.nstacks += 1;
          try {
            G.stacks.push([Math.round(d / 1024),
                           String(new Error().stack).split('\n').slice(1, 7)
                             .map(function (s) { return s.trim().slice(0, 120); })]);
          } catch (e) {}
        }
      }
    }
    /* getProgramParameter(LINK_STATUS) blocks until the driver has finished
       linking, which is where a deferred shader compile actually gets paid
       for. Recording the pname separates that from a harmless query. */
    if (name === 'getProgramParameter' && dur >= 4 && G.progq.length < 300) {
      G.progq.push([Math.round(t0), Math.round(dur), a[1]]);
    }
  }

  function wrapOne(ctx, name) {
    var fn = ctx[name];
    if (typeof fn !== 'function') return false;
    ctx[name] = function () {
      var t0 = now();
      var r = fn.apply(ctx, arguments);
      charge(name, t0, now() - t0, arguments);
      return r;
    };
    /* An own property that will not take is a silent hole in the table. */
    if (ctx[name] === fn) return false;
    G.wrapped += 1;
    return true;
  }

  function wrapCtx(ctx, kind, names) {
    var n = 0;
    for (var i = 0; i < names.length; i++) if (wrapOne(ctx, names[i])) n += 1;
    G.ctxs.push([kind, n, names.length]);
    return n;
  }

  var realGet = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, attrs) {
    var ctx = attrs === undefined ? realGet.call(this, type)
                                  : realGet.call(this, type, attrs);
    if (!ctx || ctx.__gl_wrapped) return ctx;
    try {
      if (type === 'webgl2' || type === 'webgl' || type === 'experimental-webgl') {
        wrapCtx(ctx, type, WATCH);
        if (!G.info) {
          var un = null;
          try {
            var ext = ctx.getExtension('WEBGL_debug_renderer_info');
            if (ext) un = [ctx.getParameter(ext.UNMASKED_VENDOR_WEBGL),
                           ctx.getParameter(ext.UNMASKED_RENDERER_WEBGL)];
          } catch (e) {}
          G.info = {
            type: type,
            renderer: ctx.getParameter(ctx.RENDERER),
            vendor: ctx.getParameter(ctx.VENDOR),
            version: ctx.getParameter(ctx.VERSION),
            unmasked: un,
            maxTexture: ctx.getParameter(ctx.MAX_TEXTURE_SIZE),
            at: Math.round(now()),
          };
          G.glctx = ctx;
        }
      } else if (type === '2d') {
        wrapCtx(ctx, '2d', WATCH_2D);
      }
      ctx.__gl_wrapped = true;
    } catch (e) { G.marks.wrapError = String(e); }
    return ctx;
  };

  /* Bucket by animation-frame tick rather than by Cesium's own events: the
     tick is the whole task the browser could not interrupt, and Cesium's
     render is a span INSIDE it. Recording both says whether the cost is the
     render or the rest of the tick. */
  var realRaf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = function (cb) {
    return realRaf(function (ts) {
      var t0 = now();
      G.cur = { t0: t0, gl: {}, glMs: 0, marks: [], lastEnd: t0,
                maxGap: 0, maxGapAt: 0 };
      G.ticks += 1;
      try {
        maybeBurn(t0);
        return cb(ts);
      } finally {
        var cur = G.cur, dur = now() - t0;
        G.cur = null;
        if (dur >= __SLOW_MS__ && G.frames.length < 200) {
          var top = [];
          for (var k in cur.gl) top.push([k, cur.gl[k][0], Math.round(cur.gl[k][1])]);
          top.sort(function (a, b) { return b[2] - a[2]; });
          G.frames.push({ t0: Math.round(t0), dur: Math.round(dur),
                          glMs: Math.round(cur.glMs), gl: top.slice(0, 8),
                          marks: cur.marks, app: appState(),
                          maxGap: Math.round(cur.maxGap),
                          maxGapAt: Math.round(cur.maxGapAt),
                          tailGap: Math.round(now() - cur.lastEnd) });
        }
      }
    });
  };

  /* What the app thought it was doing when a frame went long. `primitives` is
     the count Cesium draws from; `borders` is what the app itself published
     about the border build, which is the only way to tell a first build from a
     terrain re-drape from an opacity rebuild. */
  function appState() {
    try {
      var v = window.__graticule_viewer;
      if (!v) return null;
      var b = window.__graticule_borders || {};
      return { prims: v.scene.primitives.length,
               ents: v.entities.values.length,
               lines: b.lines || 0, draped: !!b.draped };
    } catch (e) { return null; }
  }

  /* readPixels on the whole canvas is a hard pipeline stall: the driver has to
     finish every queued command before it can hand back the bytes. That makes
     it a burn this instrument must be able to see, and one Cesium barely does
     at boot because nothing has been tapped. */
  function maybeBurn(t0) {
    if (G.burnAt === null || G.burnDone !== null || t0 < G.burnAt) return;
    var gl = G.glctx;
    if (!gl) { G.burnDone = { error: 'no wrapped webgl context to burn in' }; return; }
    var w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
    var buf = new Uint8Array(w * h * 4);
    var s = now(), n = 0;
    try {
      while (now() - s < 1500 && n < 200) {
        gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
        n += 1;
      }
      G.burnDone = { at: Math.round(t0), calls: n, wallMs: Math.round(now() - s),
                     size: w + 'x' + h };
    } catch (e) {
      G.burnDone = { error: String(e), calls: n };
    }
  }

  /* Authoritative task boundaries, independent of the rAF wrapper. If the two
     disagree about where the long block was, the rAF bucketing is wrong. */
  try {
    new PerformanceObserver(function (list) {
      var es = list.getEntries();
      for (var i = 0; i < es.length; i++) {
        if (G.longtasks.length < 300) {
          G.longtasks.push([Math.round(es[i].startTime), Math.round(es[i].duration),
                            es[i].name]);
        }
      }
    }).observe({ entryTypes: ['longtask'] });
  } catch (e) { G.marks.longtaskError = String(e); }

  (function waitForViewer() {
    var v = window.__graticule_viewer;
    if (!v || !v.scene) { setTimeout(waitForViewer, 30); return; }
    G.marks.viewer = Math.round(now());
    var scene = v.scene;
    /* Cesium's event order inside one render is not assumed here. All four are
       stamped and the marks are printed in the order they fired. */
    ['preUpdate', 'postUpdate', 'preRender', 'postRender'].forEach(function (name) {
      if (!scene[name] || !scene[name].addEventListener) return;
      scene[name].addEventListener(function () {
        if (G.cur) G.cur.marks.push([name, Math.round(now() - G.cur.t0)]);
      });
    });
  })();
})();
"""

# Read the record out in pieces and CLEAR what has been read, rather than once
# at the end. The WebView does not always survive a 45 s boot on a 2 GB
# emulator -- issue 64 saw the same thing under the CPU profiler -- and a single
# dump at the end means a process that dies at 44 s costs the whole run. This
# way it costs the tail, and the report says so instead of looking complete.
DRAIN = r"""(() => {
  const G = window.__gl || {};
  const take = (k) => { const v = G[k] || []; G[k] = []; return v; };
  return JSON.stringify({
    info: G.info || null, totals: G.totals || {}, marks: G.marks || {},
    ticks: G.ticks || 0, ctxs: G.ctxs || [], wrapped: G.wrapped || 0,
    burnDone: G.burnDone === undefined ? null : G.burnDone,
    worst: take('worst'), frames: take('frames'), longtasks: take('longtasks'),
    big: take('big'), progq: take('progq'), stacks: take('stacks'),
    canvas: (window.__graticule_viewer &&
             [window.__graticule_viewer.canvas.width,
              window.__graticule_viewer.canvas.height]) || null,
  });
})()"""

APPEND = ("worst", "frames", "longtasks", "big", "progq", "stacks")
REPLACE = ("info", "totals", "marks", "ticks", "ctxs", "wrapped", "burnDone",
           "canvas")


def merge(into: dict, part: dict) -> None:
    for k in APPEND:
        into.setdefault(k, []).extend(part.get(k) or [])
    for k in REPLACE:
        v = part.get(k)
        if v or k not in into:
            into[k] = v


class Cdp:
    def __init__(self, ws):
        self.ws = ws
        self.n = 0

    async def call(self, method: str, params: dict | None = None) -> dict:
        self.n += 1
        mine = self.n
        await self.ws.send(json.dumps({"id": mine, "method": method,
                                       "params": params or {}}))
        while True:
            msg = json.loads(await self.ws.recv())
            if msg.get("id") == mine:
                if "error" in msg:
                    raise SystemExit(f"{method}: {msg['error']}")
                return msg.get("result", {})


def summarise(d: dict) -> dict:
    """The few numbers an A/B can actually be argued from."""
    ticks = d.get("frames") or []
    big = d.get("big") or []
    tot = d.get("totals") or {}
    return {
        "worst": max((f["dur"] for f in ticks), default=0),
        "blocking": sum(f["dur"] for f in ticks),
        "slowTicks": len(ticks),
        "uploadMB": round(sum(kb for _t, kb, _ms in big) / 1024),
        "uploadCalls": len(big),
        "bufferDataMs": round(tot.get("bufferData", [0, 0])[1]),
        "shaderStallMs": round(tot.get("getProgramParameter", [0, 0])[1]),
        "cut": bool(d.get("endedEarly")),
    }


SUMMARY_COLS = ("worst", "blocking", "slowTicks", "uploadMB", "uploadCalls",
                "bufferDataMs", "shaderStallMs")


def print_summaries(label: str, rows: list[dict]) -> None:
    print(f"\n  {label}")
    print("    " + "".join(f"{c:>14}" for c in SUMMARY_COLS) + "   cut")
    for r in rows:
        print("    " + "".join(f"{r[c]:>14}" for c in SUMMARY_COLS)
              + f"   {'YES' if r['cut'] else '-'}")
    if len(rows) > 1:
        med = {c: sorted(r[c] for r in rows)[len(rows) // 2] for c in SUMMARY_COLS}
        print("    " + "".join(f"{med[c]:>14}" for c in SUMMARY_COLS) + "   median")


async def run(ws_url: str, seconds: int, burn_at: int | None,
              drain_every: float = 5.0, query: str = "") -> dict:
    import websockets
    source = (RECORDER
              .replace("__BURN_AT__", "null" if burn_at is None else str(burn_at))
              .replace("__SLOW_MS__", str(SLOW_TICK_MS)))
    # ping_interval=None, and no keepalive of any kind: the WebView's devtools
    # server closes the connection on a Ping frame (issue 64), and this run
    # watches in silence through frames that block the main thread for seconds.
    async with websockets.connect(ws_url, max_size=256 * 1024 * 1024,
                                  ping_interval=None) as ws:
        c = Cdp(ws)
        await c.call("Page.enable")
        await c.call("Runtime.enable")
        await c.call("Page.addScriptToEvaluateOnNewDocument", {"source": source})
        if query:
            base = (await c.call("Runtime.evaluate",
                                 {"expression": "location.origin + location.pathname",
                                  "returnByValue": True}))["result"]["value"]
            await c.call("Page.navigate", {"url": base + query})
            print(f"  navigated to ...{query} with the GL recorder installed; "
                  f"watching {seconds}s and draining every {drain_every:.0f}s ...")
        else:
            await c.call("Page.reload", {"ignoreCache": True})
            print(f"  reloaded with the GL recorder installed; watching {seconds}s "
                  f"and draining every {drain_every:.0f}s ...")

        merged: dict = {}
        start = time.monotonic()
        watched = 0.0
        while True:
            left = seconds - (time.monotonic() - start)
            if left <= 0:
                break
            await asyncio.sleep(min(drain_every, left))
            try:
                res = await c.call("Runtime.evaluate",
                                   {"expression": DRAIN, "returnByValue": True})
                if "exceptionDetails" in res:
                    raise SystemExit(f"drain failed: {res['exceptionDetails']}")
                merge(merged, json.loads(res["result"]["value"]))
                watched = time.monotonic() - start
            except SystemExit:
                raise
            except Exception as e:                       # noqa: BLE001 - any
                merged["endedEarly"] = (                 # transport failure is
                    f"the WebView stopped answering after "               # the
                    f"{watched:.0f}s of a {seconds}s run ({type(e).__name__})")
                return merged
        merged["endedEarly"] = None
        return merged


def one_run(args, burn_at: int | None = None, query: str = "") -> dict:
    adb("shell", "am", "force-stop", APP_ID)
    time.sleep(1.5)
    adb("shell", "am", "start", "-n", f"{APP_ID}/.MainActivity")
    time.sleep(args.settle)
    # A forward from a previous launch survives force-stop and points at a dead
    # pid's socket, which fails at handshake rather than at connect.
    adb("forward", "--remove-all")
    attach()
    return asyncio.run(run(page_target(), args.seconds, burn_at, args.drain,
                           query or args.query))


def report(d: dict) -> dict:
    if d.get("endedEarly"):
        print(f"\n  INCOMPLETE RUN: {d['endedEarly']}. Everything below is what "
              f"had been drained by then, not a whole boot.")
    info = d.get("info")
    if not info:
        raise SystemExit("no WebGL context was ever created through the wrapped "
                         "getContext -- suspect the injection, not the app")
    print(f"\n  renderer     {info['renderer']}")
    print(f"  vendor       {info['vendor']}")
    if info.get("unmasked"):
        print(f"  unmasked     {info['unmasked'][0]} / {info['unmasked'][1]}")
    print(f"  context      {info['type']}, created at {info['at']} ms")
    print(f"  canvas       {d.get('canvas')}")
    print(f"  viewer at    {d['marks'].get('viewer')} ms")
    print(f"  wrapped      {d['wrapped']} methods across "
          f"{len(d['ctxs'])} contexts {d['ctxs']}")
    print(f"  rAF ticks    {d['ticks']}")

    tot = d["totals"]
    ranked = sorted(tot.items(), key=lambda kv: -kv[1][1])
    gl_total = sum(v[1] for v in tot.values())
    print(f"\n  every blocking GL call of the run, {gl_total:.0f} ms in total")
    print(f"    {'ms':>8}  {'calls':>7}  {'ms/call':>8}  name")
    for name, (n, ms) in ranked[:14]:
        if ms < 1:
            break
        print(f"    {ms:>8.0f}  {n:>7}  {ms / max(n, 1):>8.2f}  {name}")

    frames = sorted(d["frames"], key=lambda f: -f["dur"])
    print(f"\n  animation-frame ticks over {SLOW_TICK_MS} ms: {len(d['frames'])}")
    for f in frames[:6]:
        un = f["dur"] - f["glMs"]
        print(f"\n    tick at {f['t0']:>6} ms   {f['dur']:>6} ms total   "
              f"{f['glMs']:>6} ms in GL   {un:>6} ms unattributed "
              f"({100 * un / max(f['dur'], 1):.0f}%)")
        if f["marks"]:
            print("      cesium: " + ", ".join(f"{n}+{ms}" for n, ms in f["marks"][:8]))
        if f.get("maxGap"):
            print(f"      longest stretch with no GL call at all: {f['maxGap']} ms, "
                  f"starting {f['maxGapAt']} ms into the frame "
                  f"(and {f.get('tailGap', 0)} ms after the last one)")
        if f.get("app"):
            a = f["app"]
            print(f"      app: {a['prims']} primitives, {a['ents']} entities, "
                  f"{a['lines']} border lines, draped={a['draped']}")
        for name, n, ms in f["gl"][:5]:
            if ms:
                print(f"      {ms:>6} ms  {n:>6} x  {name}")

    big = d.get("big", [])
    if big:
        mb = sum(kb for _t, kb, _ms in big) / 1024
        print(f"\n  uploads over 1 MB: {len(big)} calls, {mb:.0f} MB, "
              f"{sum(ms for *_x, ms in big)} ms")
        for t, kb, ms in big:
            print(f"    at {t:>6} ms   {kb:>7} KB   {ms:>5} ms")
        by_size: dict[int, list[int]] = {}
        for _t, kb, ms in big:
            by_size.setdefault(kb, [0, 0])
            by_size[kb][0] += 1
            by_size[kb][1] += ms
        rep = {k: v for k, v in by_size.items() if v[0] > 1}
        if rep:
            print("    the same size, more than once:")
            for kb, (n, ms) in sorted(rep.items(), key=lambda x: -x[1][1]):
                print(f"      {kb:>7} KB  x{n:<3} {ms:>6} ms   "
                      f"{n * kb / 1024:.0f} MB uploaded in total")

    pq = d.get("progq", [])
    if pq:
        print(f"\n  blocking getProgramParameter: {len(pq)} calls over 4 ms, "
              f"{sum(ms for _t, ms, _p in pq)} ms")
        for t, ms, pname in sorted(pq, key=lambda x: -x[1])[:6]:
            # 0x8B82 is LINK_STATUS, 0x8B81 COMPILE_STATUS.
            print(f"    at {t:>6} ms   {ms:>5} ms   pname 0x{pname:04X}")

    for kb, stack in d.get("stacks", []):
        print(f"\n  call site of a {kb} KB upload:")
        for line in stack:
            print(f"    {line}")

    lt = sorted(d["longtasks"], key=lambda x: -x[1])
    if lt:
        print(f"\n  long tasks (PerformanceObserver, independent of the rAF hook)")
        for start, dur, name in lt[:5]:
            print(f"    at {start:>6} ms   {dur:>6} ms   {name}")

    worst = sorted(d["worst"], key=lambda x: -x[1])
    if worst:
        print(f"\n  slowest single GL calls")
        for t, ms, name, det in worst[:8]:
            print(f"    at {t:>6} ms   {ms:>6} ms   {name} {det}")
    return tot


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--seconds", type=int, default=45)
    ap.add_argument("--settle", type=float, default=3.0)
    ap.add_argument("--drain", type=float, default=5.0,
                    help="seconds between incremental reads of the record")
    ap.add_argument("--burn-at", type=int, default=12000,
                    help="page time the --control burn is armed for")
    ap.add_argument("--control", action="store_true",
                    help="also run with a deliberate readPixels stall and prove "
                         "this instrument attributes it")
    ap.add_argument("--json", help="write the raw record here")
    ap.add_argument("--query", default="",
                    help="load with this query string, e.g. ?borderprims=split")
    ap.add_argument("--ab", type=int, metavar="N",
                    help="N boots of the shipped build against N of "
                         "?borderprims=split, INTERLEAVED")
    args = ap.parse_args()

    if args.ab:
        # Interleaved, not two blocks. The 2026-08-08 attempt at this A/B ran
        # back to back on a host that was 50-74% busy with other work, so any
        # drift over those minutes landed entirely on the second condition.
        # A,B,A,B cannot do that.
        a_rows, b_rows = [], []
        for i in range(args.ab):
            print(f"\n--- pair {i + 1} of {args.ab}: shipped ---")
            a = summarise(one_run(args, query=""))
            print(f"    {a}")
            a_rows.append(a)
            print(f"\n--- pair {i + 1} of {args.ab}: ?borderprims=split ---")
            b = summarise(one_run(args, query="?borderprims=split"))
            print(f"    {b}")
            b_rows.append(b)
        print_summaries("shipped (one primitive per layer)", a_rows)
        print_summaries("?borderprims=split (batches of 1000 lines)", b_rows)
        cut = sum(r["cut"] for r in a_rows + b_rows)
        if cut:
            print(f"\n  {cut} of {len(a_rows) + len(b_rows)} runs were cut short "
                  f"by the WebView dying. Those rows are lower bounds, so the "
                  f"comparison is only readable if the cuts fall on both sides.")
        return

    print("--- normal boot ---")
    d = one_run(args)
    if args.json:
        with open(args.json, "w") as f:
            json.dump(d, f)
        print(f"raw record -> {args.json}")
    tot = report(d)
    base_rp = tot.get("readPixels", [0, 0])[1]

    if not args.control:
        return

    print(f"\n--- CONTROL: the same recorder, with a readPixels stall armed at "
          f"{args.burn_at} ms ---")
    d2 = one_run(args, burn_at=args.burn_at)
    tot2 = report(d2)
    burn = d2.get("burnDone")
    print(f"\n  the burn reported: {burn}")

    seen = tot2.get("readPixels", [0, 0])
    print(f"  readPixels attributed   normal {base_rp:.0f} ms   "
          f"control {seen[1]:.0f} ms in {seen[0]} calls")

    if not burn or burn.get("error"):
        print("\n  FAIL  the burn did not run, so this proves nothing about the "
              "instrument.")
        sys.exit(1)
    if d2["wrapped"] < 10:
        print("\n  FAIL  almost nothing was wrapped, so the tables above are "
              "empty for a reason that has nothing to do with the app.")
        sys.exit(1)
    if seen[1] < 400:
        print("\n  FAIL  a deliberate multi-hundred-millisecond stall was run "
              "inside a frame and this instrument did not charge it to "
              "readPixels. It is not reading the GL calls it claims to.")
        sys.exit(1)
    if seen[1] - base_rp < 300:
        print("\n  FAIL  the control run's readPixels total is not meaningfully "
              "above the normal run's, so the number is not following the burn.")
        sys.exit(1)
    hit = [f for f in d2["frames"] if abs(f["t0"] - burn["at"]) <= 50]
    if not hit:
        print("\n  FAIL  no slow tick was recorded at the time the burn ran, so "
              "the per-frame bucketing is not tracking real frames.")
        sys.exit(1)
    print(f"  PASS  the stall shows up as {seen[1]:.0f} ms of readPixels inside "
          f"the tick at {hit[0]['t0']} ms, so the attribution above is reading "
          f"the driver.")


if __name__ == "__main__":
    main()
