"""What is the app DOING during each part of the boot?

apk_tti.py says WHEN a tap would have waited (10-25 s is this app's collapse).
apk_profile.py --window says which JS frames burn CPU in that slice. Neither
answers the next question, and for a WebGL app the profiler tends not to: the
heaviest frame of the whole boot profiled as `(program)`, which is V8 and the
GL driver, and no amount of resampling turns that into a cause.

So this records what Cesium and the network were doing, on the same page clock
apk_tti.py reports in, and buckets it into the same windows:

    tile queue      Globe.tileLoadProgressEvent, the depth of the load queue
    frames          scene preRender -> postRender, the cost of a rendered frame
    requests        Resource Timing, split by initiator (img = imagery tiles,
                    xhr/fetch = terrain and the app's own data)
    primitives      scene.primitives.length, which is where border geometry
                    lands, and every new primitive is a GPU upload and possibly
                    a shader compile

Co-occurrence is not attribution, so this does not claim a cause on its own. It
narrows the candidates to the ones actually present in the window, and then a
condition run (`?terrain=off`, `?clamp=off`) has to move the tap-wait number
before anything is believed.

CONTROL: --control repeats the run with `?borderworker=off` and fails unless
the app-data request count moves. Border GeoJSON is fetched inside
border-worker.js, and a worker has its own Resource Timing buffer, so those
fetches are invisible to the page; forcing the inline path moves them onto
this timeline. A recorder that reports the same thing either way is not
reading what it says it is reading.

`?terrain=off` is the wrong control for this app at boot: it opens on North
America from orbit and syncTerrainForView() does not attach terrain until the
camera comes down, so there is nothing for the flag to remove.

    py -V:3.13 scripts/apk_boot_timeline.py
    py -V:3.13 scripts/apk_boot_timeline.py --control
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
import time

from apk_probe import APP_ID, adb, attach, page_target

# Cesium renders on demand, so a frame budget is not the right lens: what
# matters is whether a single frame is long enough to eat a tap.
SLOW_FRAME_MS = 100

RECORDER = """
window.__bt = { tileq: [], frames: [], marks: {}, prims: [], ws: [],
                attached: false };
try { performance.setResourceTimingBufferSize(3000); } catch (e) {}

/* Resource Timing does not cover websocket frames, and this app's whole
   opening state arrives as one: a `snapshot` message carrying every layer's
   rows, which the server assembles from ~20 upstreams. If that lands late,
   it lands in the middle of the window being investigated and nothing else
   here would show it. Wrapping the constructor catches it whoever opens the
   socket, and a listener registered here runs before the app's onmessage, so
   the stamp is arrival rather than arrival plus handling. */
(function () {
  const Native = window.WebSocket;
  function Wrapped(url, protocols) {
    const s = protocols === undefined ? new Native(url) : new Native(url, protocols);
    const t0 = performance.now();
    s.addEventListener('open', function () {
      window.__bt.marks.wsOpen = Math.round(performance.now());
      window.__bt.marks.wsConnectMs = Math.round(performance.now() - t0);
    });
    s.addEventListener('message', function (e) {
      const bt = window.__bt;
      if (bt.ws.length >= 4000) return;
      const raw = typeof e.data === 'string' ? e.data : '';
      let type = '?';
      // Read the type without parsing 8 MB: the server writes it near the
      // front of the frame, and a full JSON.parse here would add the very
      // cost this is trying to attribute.
      const m = /"type"\\s*:\\s*"([^"]{0,40})"/.exec(raw.slice(0, 200));
      if (m) type = m[1];
      bt.ws.push([Math.round(performance.now()), raw.length, type]);
    });
    return s;
  }
  Wrapped.prototype = Native.prototype;
  for (const k of ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED']) Wrapped[k] = Native[k];
  window.WebSocket = Wrapped;
})();

(function waitForViewer() {
  const v = window.__graticule_viewer;
  if (!v || !v.scene) { setTimeout(waitForViewer, 30); return; }
  const bt = window.__bt;
  bt.marks.viewer = Math.round(performance.now());
  bt.attached = true;

  const scene = v.scene, globe = scene.globe;

  // Queue depth, stamped by the event rather than by a poll: an interval does
  // not run while the thread is blocked, which is exactly when this matters.
  globe.tileLoadProgressEvent.addEventListener(function (n) {
    if (bt.tileq.length < 6000) {
      bt.tileq.push([Math.round(performance.now()), n]);
    }
    if (n === 0 && bt.marks.tilesLoaded === undefined) {
      bt.marks.tilesLoaded = Math.round(performance.now());
    }
  });

  let frameStart = 0;
  scene.preRender.addEventListener(function () { frameStart = performance.now(); });
  scene.postRender.addEventListener(function () {
    const now = performance.now();
    if (bt.frames.length < 20000) {
      bt.frames.push([Math.round(frameStart), Math.round(now - frameStart)]);
    }
    // Primitive and entity counts are cheap to sample here and only here: this
    // runs once per rendered frame, which is when an upload would have landed.
    // Entities matter because the websocket feed delivers 8,381 of them in
    // batches, and that work shows up inside Cesium rather than in the app's
    // own onmessage frame, which is where a CPU profile stops being able to
    // see it.
    const p = scene.primitives.length, ent = v.entities.values.length;
    const last = bt.prims.length ? bt.prims[bt.prims.length - 1] : null;
    if ((!last || last[1] !== p || last[2] !== ent) && bt.prims.length < 8000) {
      bt.prims.push([Math.round(now), p, ent]);
    }
  });
})();
"""

DUMP = """(() => {
  const bt = window.__bt || {};
  const res = performance.getEntriesByType('resource').map(function (e) {
    return [Math.round(e.startTime), Math.round(e.duration),
            e.initiatorType || '?', e.name, e.transferSize || 0];
  });
  return JSON.stringify({
    tileq: bt.tileq || [], frames: bt.frames || [], prims: bt.prims || [],
    ws: bt.ws || [],
    marks: bt.marks || {}, attached: !!bt.attached, res: res,
    entities: (window.__graticule_viewer &&
               window.__graticule_viewer.entities.values.length) || 0,
  });
})()"""

EDGES = [0, 3000, 6000, 10000, 15000, 25000, 10 ** 9]


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


async def run(ws_url: str, seconds: int, query: str) -> dict:
    import websockets
    async with websockets.connect(ws_url, max_size=256 * 1024 * 1024) as ws:
        c = Cdp(ws)
        await c.call("Page.enable")
        await c.call("Runtime.enable")
        await c.call("Page.addScriptToEvaluateOnNewDocument", {"source": RECORDER})

        if query:
            url = (await c.call("Runtime.evaluate",
                                {"expression": "location.origin + location.pathname",
                                 "returnByValue": True}))["result"]["value"]
            await c.call("Page.navigate", {"url": url + query})
            print(f"  navigated to ...{query} with the recorder installed; "
                  f"watching {seconds}s ...")
        else:
            await c.call("Page.reload", {"ignoreCache": True})
            print(f"  reloaded with the recorder installed; watching {seconds}s ...")

        await asyncio.sleep(seconds)
        res = await c.call("Runtime.evaluate",
                           {"expression": DUMP, "returnByValue": True})
        return json.loads(res["result"]["value"])


def bucket(lo: int, hi: int) -> str:
    return f"{lo // 1000}-{hi // 1000}s" if hi < 10 ** 9 else f"{lo // 1000}s+"


def classify(name: str, initiator: str) -> str:
    """Coarse groups, because 900 tile URLs is not a finding."""
    n = name.lower()
    if "terrain" in n or "cesiumterrain" in n or n.endswith(".terrain"):
        return "terrain"
    if initiator == "img":
        return "imagery"
    if "/data/" in n or n.endswith(".geojson") or n.endswith(".json"):
        return "app data"
    if n.endswith(".js") or initiator == "script":
        return "script"
    if n.endswith(".css") or initiator in ("link", "css"):
        return "style"
    return initiator or "other"


def report(d: dict) -> dict:
    if not d["attached"]:
        raise SystemExit("the recorder never saw a viewer -- suspect the "
                         "injection, not the app")
    print(f"\n  viewer built at   {d['marks'].get('viewer')} ms")
    tl = d["marks"].get("tilesLoaded")
    print(f"  tiles first idle  {tl if tl is not None else 'never inside the run'}")
    print(f"  entities at end   {d['entities']}")
    print(f"  frames rendered   {len(d['frames'])}")

    kinds: dict[str, int] = {}
    print(f"\n  {'window':>8}  {'frames':>6} {'worst':>7} {'render':>7}  "
          f"{'tileq':>6}  {'prims':>6}  {'entities':>8}  requests")
    for lo, hi in zip(EDGES, EDGES[1:]):
        fr = [ms for t, ms in d["frames"] if lo <= t < hi]
        tq = [n for t, n in d["tileq"] if lo <= t < hi]
        pr = [p for t, p, _e in d["prims"] if lo <= t < hi]
        en = [e for t, _p, e in d["prims"] if lo <= t < hi]
        # A request is counted in the window it FINISHED in: that is when its
        # bytes were decoded on this thread.
        req: dict[str, int] = {}
        for start, dur, init, name, _size in d["res"]:
            if lo <= start + dur < hi:
                k = classify(name, init)
                req[k] = req.get(k, 0) + 1
                kinds[k] = kinds.get(k, 0) + 1
        if not (fr or tq or pr or req):
            continue
        top = ", ".join(f"{k} {v}" for k, v in
                        sorted(req.items(), key=lambda x: -x[1])[:4]) or "-"
        print(f"  {bucket(lo, hi):>8}  {len(fr):>6} {max(fr, default=0):>6} ms "
              f"{sum(fr):>6} ms  {max(tq, default=0):>6}  "
              f"{max(pr, default=0):>6}  {max(en, default=0):>8}  {top}")

    # The websocket frames, biggest first: one late snapshot explains more of a
    # bad window than a hundred small deltas do.
    ws = d.get("ws", [])
    if ws:
        print(f"\n  websocket: opened at {d['marks'].get('wsOpen')} ms, "
              f"{len(ws)} frames, {sum(n for _t, n, _k in ws) / 1e6:.1f} MB")
        for t, n, kind in sorted(ws, key=lambda x: -x[1])[:6]:
            print(f"    at {t:>6} ms   {n / 1000:>8.0f} KB   {kind}")

    slow = [(t, ms) for t, ms in d["frames"] if ms >= SLOW_FRAME_MS]
    print(f"\n  frames over {SLOW_FRAME_MS} ms: {len(slow)}")
    for t, ms in sorted(slow, key=lambda x: -x[1])[:8]:
        print(f"    at {t:>6} ms   {ms:>5} ms")
    return kinds


def one_run(args, query: str = "") -> dict:
    adb("shell", "am", "force-stop", APP_ID)
    time.sleep(1.5)
    adb("shell", "am", "start", "-n", f"{APP_ID}/.MainActivity")
    time.sleep(args.settle)
    # A forward from a previous launch survives force-stop and points at a dead
    # pid's socket, which fails at handshake rather than at connect.
    adb("forward", "--remove-all")
    attach()
    return asyncio.run(run(page_target(), args.seconds, query))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--seconds", type=int, default=45)
    ap.add_argument("--settle", type=float, default=3.0)
    ap.add_argument("--control", action="store_true",
                    help="also run ?borderworker=off and prove the counts move")
    ap.add_argument("--json", help="write the raw timeline here")
    args = ap.parse_args()

    print("--- normal boot ---")
    d = one_run(args)
    if args.json:
        with open(args.json, "w") as f:
            json.dump(d, f)
        print(f"raw timeline -> {args.json}")
    kinds = report(d)

    if not args.control:
        return

    print("\n--- CONTROL: the same recorder with ?borderworker=off ---")
    kinds_off = report(one_run(args, "?borderworker=off"))
    total = sum(kinds.values())
    on, off = kinds.get("app data", 0), kinds_off.get("app data", 0)
    print(f"\n  requests counted, normal run   {total}")
    print(f"  app-data requests   worker on {on}   worker off {off}")
    if total < 20:
        print("\n  FAIL  the normal run counted almost nothing. A control cannot")
        print("        tell a working recorder from a dead one against a run")
        print("        that recorded nothing, so nothing above is readable yet.")
        sys.exit(1)
    if off - on < 2:
        print("\n  FAIL  moving the border parse onto the main thread did not")
        print("        change what this timeline saw. It is not reading the")
        print("        page's requests.")
        sys.exit(1)
    print("  PASS  the count follows the flag, so the rows above are measuring "
          "the app.")


if __name__ == "__main__":
    main()
