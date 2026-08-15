"""boot_attrib.py, on the real thing.

border_perf_test.py gates the main thread against Android's input-dispatch
budget and then measures desktop Chromium under SwiftShader. Those two are not
the same quantity, and the desktop numbers are not close: a fixed 512x512
readPixels control measured 3 ms with the card doing the work and up to 12,000
ms with SwiftShader doing it, in the same script on the same machine.

So this runs the SAME instrument -- imported, not copied, so it cannot drift --
inside the APK's own WebView, which is the browser and the GPU path the
thresholds are actually about.

    py -V:3.13 scripts/apk_boot_attrib.py [--seconds 45] [--cold] [--runs 2]

--cold wipes the app's data first, which throws away Chromium's compiled-shader
cache along with it. That is the difference between a first launch after
install and every launch after that, and on the desktop it was the difference
between 5,550 ms of blocking and 478 ms. Whether the phone behaves the same way
is the entire question this script exists to answer, so it is measured, not
assumed.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import time

from apk_probe import APP_ID, adb, attach, page_target
from boot_attrib import INSTR, READ, report, stats

# The WebView's devtools server dies mid-run about one run in six (issues.md
# 67), so the buckets are pulled every few seconds and merged rather than read
# once at the end. A run that loses its only read looks exactly like a run that
# measured nothing.
DRAIN = """(() => {
  const G = window.__attr || {};
  const out = {err: G.err || null, wrapped: G.wrapped || 0,
               glWrapped: G.glWrapped || 0, ctxs: G.ctxs || 0,
               cesiumAt: G.cesiumAt || null, calls: {}};
  out.longtasks = (G.longtasks || []).map(e => [e.t, e.ms]);
  G.longtasks = [];
  out.programs = G.programs || [];
  G.programs = [];
  for (const [k, v] of Object.entries(G.calls || {})) {
    out.calls[k] = {n: v.n, ms: v.ms, worst: v.worst, spans: v.spans};
    v.spans = [];
  }
  out.borders = window.__graticule_borders || null;
  return JSON.stringify(out);
})()"""


def merge(into: dict, part: dict) -> None:
    """Counters REPLACE, lists APPEND.

    `calls[k].ms` is cumulative in the page, so it replaces; `spans` is drained
    on read, so it accumulates here. Getting that backwards double counts every
    millisecond in the report and the totals quietly pass 100%.
    """
    for k in ("err", "wrapped", "glWrapped", "ctxs", "cesiumAt", "borders"):
        v = part.get(k)
        if v or k not in into:
            into[k] = v
    for k in ("longtasks", "programs"):
        into.setdefault(k, []).extend(part.get(k) or [])
    calls = into.setdefault("calls", {})
    for name, v in (part.get("calls") or {}).items():
        cur = calls.setdefault(name, {"n": 0, "ms": 0, "worst": 0, "spans": []})
        cur["n"] = v["n"]                      # cumulative in the page
        cur["ms"] = v["ms"]
        cur["worst"] = max(cur["worst"], v["worst"])
        cur["spans"].extend(v["spans"])        # drained in the page


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


async def watch(ws_url: str, seconds: int, drain_every: float) -> dict:
    import websockets

    # No keepalive of any kind: the WebView's devtools server closes the
    # connection on a Ping frame, and this run sits silent through frames that
    # block the main thread for seconds at a time.
    async with websockets.connect(ws_url, max_size=256 * 1024 * 1024,
                                  ping_interval=None) as ws:
        c = Cdp(ws)
        await c.call("Page.enable")
        await c.call("Runtime.enable")
        await c.call("Page.addScriptToEvaluateOnNewDocument", {"source": INSTR})
        await c.call("Page.reload", {"ignoreCache": True})
        print(f"  instrument installed, reloaded; watching {seconds}s, "
              f"draining every {drain_every:.0f}s")

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
            except Exception as e:                      # noqa: BLE001 - any
                merged["endedEarly"] = (                # transport failure is
                    f"the WebView stopped answering after {watched:.0f}s "
                    f"of a {seconds}s run ({type(e).__name__})")
                return merged
        merged["endedEarly"] = None
        return merged


def one_run(args, cold: bool) -> dict:
    if cold:
        # pm clear takes the WebView's data directory with it, and the
        # compiled-shader cache lives in there.
        adb("shell", "pm", "clear", APP_ID)
        time.sleep(1.0)
    adb("shell", "am", "force-stop", APP_ID)
    time.sleep(1.5)
    adb("shell", "am", "start", "-n", f"{APP_ID}/.MainActivity")
    time.sleep(args.settle)
    # A forward from a previous launch survives force-stop and points at a dead
    # pid's socket, which fails at handshake rather than at connect.
    adb("forward", "--remove-all")
    attach()
    res = asyncio.run(watch(page_target(), args.seconds, args.drain))
    res["cond"] = ("cold shader cache" if cold else "warm shader cache")
    res["console"] = []
    res["control"] = None
    res["renderer"] = "Android WebView (device GL)"
    return res


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--seconds", type=int, default=45)
    ap.add_argument("--settle", type=float, default=6.0)
    ap.add_argument("--drain", type=float, default=5.0)
    ap.add_argument("--runs", type=int, default=1)
    ap.add_argument("--cold", action="store_true",
                    help="wipe app data before EVERY run, so every run pays "
                         "first-launch shader compilation")
    args = ap.parse_args()

    rows = []
    for r in range(args.runs):
        # First run cold when --cold is off too: the point of the pair is the
        # difference, and a warm number with nothing to compare it to says
        # nothing about what a user's first launch costs.
        cold = args.cold or r == 0
        print(f"\n===== device run {r + 1}/{args.runs}  "
              f"{'cold' if cold else 'warm'} =====")
        res = one_run(args, cold)
        if res.get("endedEarly"):
            print(f"  INCOMPLETE RUN: {res['endedEarly']}")
        report(res)
        rows.append((cold, stats(res["longtasks"])))

    print("\n===== device summary =====")
    print(f"   {'cache':<8}{'blocking':>10}{'worst':>8}{'tasks':>7}{'lastEnd':>9}")
    for cold, s in rows:
        print(f"   {'cold' if cold else 'warm':<8}{s['blockingMs']:>10}"
              f"{s['worstMs']:>8}{s['count']:>7}{s['lastEndMs']:>9}")


if __name__ == "__main__":
    main()
