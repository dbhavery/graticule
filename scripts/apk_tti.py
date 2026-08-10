"""How long would a tap have waited, at every moment from launch?

apk_longtasks.py answers "how much did the main thread block in total". That is
the right number for a budget and the wrong number for a person. A user does not
experience a sum. They experience one question: I touched the screen, did
anything happen. Two builds can block for the same 13 s and feel completely
different depending on WHERE that time sits -- 13 s in one slab before the globe
responds is a broken app, and the same 13 s spread behind an already-usable map
is a map that fills in.

So this measures the thing directly. A 50 ms self-rescheduling timer is
installed before any application script; every tick records how late it actually
ran. A tick that is 3,000 ms late means a tap arriving at that instant would
have waited about 3,000 ms to be handled, because it is the same queue.

    interactive_at   the first moment after which the app STAYS responsive
                     (every tick under LAG_OK for QUIET_MS continuously)
    worst_lag        the longest a tap could have waited
    idle_lag         what the probe reads once boot is over -- the noise floor
                     this instrument can even see, printed so the threshold is
                     grounded in what the app achieves rather than assumed

`interactive_at` is the number to move. It is a TIMING result, so it inherits
the sampling problem from [[one-device-boot-is-a-sample-not-a-measurement]]:
use --repeat and read the median, and ignore any difference smaller than the
spread.

CONTROL: --selftest blocks the main thread for a known 4 s and fails unless the
probe reports it. A responsiveness probe that cannot see a deliberate freeze
would report every build as perfect, and "PASS" from an instrument that cannot
fail is worth nothing.

    py -V:3.13 scripts/apk_tti.py --selftest      # prove the probe works
    py -V:3.13 scripts/apk_tti.py
    py -V:3.13 scripts/apk_tti.py --repeat 3
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
import time

from apk_probe import APP_ID, adb, attach, page_target

# A tap handled within 200 ms reads as instant; RAIL puts the response budget at
# 100 ms, and a 50 ms timer plus one frame of the emulator's own jitter already
# spends part of that. So 200 ms is the honest floor for THIS instrument, not a
# claim that 200 ms is a good target. idle_lag in the output says what the app
# actually achieves when it has nothing to do -- if that ever approaches LAG_OK,
# the threshold is measuring the probe rather than the app.
LAG_OK = 200

# How long it has to stay quiet before "interactive" is believed. Cesium renders
# on demand, so a boot has natural gaps between slabs of work; call it
# interactive on the first gap and you measure the gap, not the boot.
QUIET_MS = 2000

# What a person would call unusable rather than slow.
STUCK_MS = 1000

PROBE = """
window.__tti = { ticks: [], lt: [] };
(function tick() {
  const asked = performance.now();
  setTimeout(function () {
    const ran = performance.now();
    if (window.__tti.ticks.length < 20000) {
      // Subtract the delay we asked for: what is left is queue wait, which is
      // what a tap arriving at `asked` would also have sat through.
      window.__tti.ticks.push([Math.round(asked), Math.round(ran - asked - 50)]);
    }
    tick();
  }, 50);
})();
try {
  new PerformanceObserver(function (l) {
    for (const e of l.getEntries()) {
      if (window.__tti.lt.length < 2000) {
        window.__tti.lt.push([Math.round(e.startTime), Math.round(e.duration)]);
      }
    }
  }).observe({ entryTypes: ['longtask'], buffered: true });
} catch (e) { window.__tti_lt_failed = String(e); }
"""

# Fired from the harness, not injected at document start: it has to land in the
# middle of a run so the probe has to notice it the same way it would notice the
# app's own work.
SELFTEST_BLOCK = """(() => {
  const end = performance.now() + 4000;
  while (performance.now() < end) { /* deliberately blocking */ }
  return Math.round(performance.now());
})()"""


class Cdp:
    def __init__(self, ws):
        self.ws = ws
        self.n = 0

    async def call(self, method: str, params: dict | None = None):
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


async def run(ws_url: str, seconds: int, selftest_at: float | None) -> dict:
    import websockets
    async with websockets.connect(ws_url, max_size=256 * 1024 * 1024) as ws:
        c = Cdp(ws)
        await c.call("Page.enable")
        await c.call("Runtime.enable")
        await c.call("Page.addScriptToEvaluateOnNewDocument", {"source": PROBE})
        await c.call("Page.reload", {"ignoreCache": True})
        print(f"  reloaded with the probe installed; watching {seconds}s ...")

        if selftest_at is not None:
            await asyncio.sleep(selftest_at)
            print(f"  self-test: blocking the main thread for 4 s at "
                  f"~{selftest_at:.0f}s ...")
            await c.call("Runtime.evaluate",
                         {"expression": SELFTEST_BLOCK, "returnByValue": True})
            await asyncio.sleep(max(0, seconds - selftest_at))
        else:
            await asyncio.sleep(seconds)

        res = await c.call("Runtime.evaluate", {
            "expression": """(() => JSON.stringify({
                ticks: (window.__tti || {}).ticks || [],
                lt: (window.__tti || {}).lt || [],
                ltFailed: window.__tti_lt_failed || null,
                built: !!window.__graticule_viewer,
            }))()""",
            "returnByValue": True})
        return json.loads(res["result"]["value"])


def interactive_at(ticks: list[list[int]], lag_ok: int, quiet_ms: int) -> int | None:
    """First tick time after which no tick exceeds lag_ok for quiet_ms.

    Walk backwards: the answer is the start of the final quiet stretch, so the
    last busy tick decides it. Requires quiet_ms of observed run time after the
    candidate, or a run that simply ended early would read as interactive.
    """
    if not ticks:
        return None
    end = ticks[-1][0]
    last_bad = None
    for t, lag in ticks:
        if lag > lag_ok:
            last_bad = t
    if last_bad is None:
        return ticks[0][0]
    if end - last_bad < quiet_ms:
        return None  # never settled inside the window we watched
    return last_bad


def one_run(args, selftest: bool = False) -> dict:
    if not args.attach:
        adb("shell", "am", "force-stop", APP_ID)
        time.sleep(1.5)
        adb("shell", "am", "start", "-n", f"{APP_ID}/.MainActivity")
        time.sleep(args.settle)

    # A forward from a previous launch survives force-stop and points at a dead
    # pid's socket, which fails at handshake rather than at connect.
    adb("forward", "--remove-all")
    attach()
    data = asyncio.run(run(page_target(), args.seconds,
                           args.selftest_at if selftest else None))

    ticks = data["ticks"]
    if not ticks:
        raise SystemExit("the probe recorded nothing -- suspect the injection, "
                         "not the app")
    lags = [lag for _, lag in ticks]
    tail = [lag for t, lag in ticks if t > ticks[-1][0] - 5000]
    return {
        "ticks": ticks,
        "lt": data["lt"],
        "built": data["built"],
        "worst": max(lags),
        "stuck": sum(1 for l in lags if l > STUCK_MS),
        "idle": max(tail) if tail else 0,
        "tti": interactive_at(ticks, LAG_OK, QUIET_MS),
    }


def median(xs: list[int]) -> int:
    s = sorted(xs)
    n = len(s)
    return s[n // 2] if n % 2 else (s[n // 2 - 1] + s[n // 2]) // 2


def selftest(args) -> None:
    print("CONTROL: can this probe see a main thread that is deliberately stuck?")
    r = one_run(args, selftest=True)
    at = args.selftest_at * 1000
    window = [(t, lag) for t, lag in r["ticks"] if at - 2000 <= t <= at + 6000]
    seen = max((lag for _, lag in window), default=0)
    print(f"  blocked for 4,000 ms; the worst lag near that moment was {seen} ms")
    if seen < 3000:
        print("\n  FAIL  the probe did not see a 4 s freeze. Every number this")
        print("        instrument produces is meaningless until that is fixed.")
        sys.exit(1)
    print("  PASS  the probe reports a freeze it was told to expect, so a PASS "
          "on a real\n        build means something.")


def report(r: dict) -> None:
    ticks = r["ticks"]
    print(f"\n  ticks recorded    {len(ticks)}")
    print(f"  worst tap wait    {r['worst']} ms")
    print(f"  ticks over {STUCK_MS} ms  {r['stuck']}  "
          f"({r['stuck'] * 50 / 1000:.1f}s of the run was unusable)")
    print(f"  idle lag (tail)   {r['idle']} ms   "
          f"<- the floor this instrument can see")
    if r["tti"] is None:
        print(f"  interactive at    NEVER inside the run "
              f"(no {QUIET_MS} ms quiet stretch)")
    else:
        print(f"  interactive at    {r['tti']} ms after reload   "
              f"(then {QUIET_MS} ms under {LAG_OK} ms)")
    print(f"  viewer built      {r['built']}")

    # Where the wait sits in time. This is the whole point: two builds with the
    # same total feel different depending on which row is heavy.
    print("\n  worst tap wait by window:")
    edges = [0, 3000, 6000, 10000, 15000, 25000, 10 ** 9]
    for lo, hi in zip(edges, edges[1:]):
        w = [lag for t, lag in ticks if lo <= t < hi]
        if not w:
            continue
        name = f"{lo // 1000}-{hi // 1000}s" if hi < 10 ** 9 else f"{lo // 1000}s+"
        bar = "#" * min(40, max(w) // 100)
        print(f"    {name:>8}  worst {max(w):5} ms  {bar}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--seconds", type=int, default=45)
    ap.add_argument("--settle", type=float, default=3.0)
    ap.add_argument("--attach", action="store_true")
    ap.add_argument("--repeat", type=int, default=1,
                    help="boots to compare; 3 or more before ranking two builds")
    ap.add_argument("--selftest", action="store_true",
                    help="prove the probe can see a deliberate 4 s freeze")
    ap.add_argument("--selftest-at", type=float, default=25.0,
                    help="seconds after reload to inject the block")
    args = ap.parse_args()

    if args.selftest:
        selftest(args)
        return

    runs = []
    for i in range(args.repeat):
        if args.repeat > 1:
            print(f"\n--- boot {i + 1} of {args.repeat} ---")
        runs.append(one_run(args))

    if args.repeat > 1:
        print("\n  boot   interactive_at   worst   stuck")
        for i, r in enumerate(runs, 1):
            tti = "never" if r["tti"] is None else str(r["tti"])
            print(f"  {i:<5}  {tti:>14}   {r['worst']:5}   {r['stuck']:5}")
        # A run that never settled is not a small number and must not be
        # averaged as one. Rank it as the worst thing that could have happened.
        ttis = [r["tti"] if r["tti"] is not None else args.seconds * 1000
                for r in runs]
        worsts = [r["worst"] for r in runs]
        spread = max(ttis) / max(1, min(ttis))
        print(f"\n  median interactive_at  {median(ttis)} ms   "
              f"(range {min(ttis)}-{max(ttis)})")
        print(f"  median worst wait      {median(worsts)} ms")
        print(f"  spread                 {spread:.2f}x")
        if spread > 1.3:
            print("\n  ** Wider spread than most fixes are worth. This run can")
            print("     confirm a large change and nothing finer. **")
        print("\n  detail below is the LAST boot only:")

    report(runs[-1])

    g_tti = median([r["tti"] if r["tti"] is not None else args.seconds * 1000
                    for r in runs])
    print()
    if g_tti > 2500:
        print(f"  FAIL  the app is not reliably responsive until {g_tti} ms")
        sys.exit(1)
    print(f"  PASS  responsive from {g_tti} ms")


if __name__ == "__main__":
    main()
