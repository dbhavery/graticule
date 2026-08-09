"""How long does the APK block its main thread, on the device, for any build?

Issue 52: the five desktop suites pass with issues 50 and 51 both present,
because a phone-shaped viewport is not a phone. This is the device-side
number they were missing.

The observer is injected through `Page.addScriptToEvaluateOnNewDocument` and
the page is then reloaded, so it is installed before the first application
script on a build that carries no observer of its own. That matters more than
it sounds: it is the only way a before/after across commits is ONE instrument
measuring two builds, instead of two instruments with the same name. The
desktop equivalent is border_perf_test.py, whose numbers do not transfer --
SwiftShader spends about 4.7 s in its first canvas readback, which the device
does not do at all, and the device blocks for far longer than the desktop
harness ever showed.

    py -V:3.13 scripts/apk_longtasks.py               # relaunch, reload, watch
    py -V:3.13 scripts/apk_longtasks.py --seconds 90
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
import time

from apk_probe import APP_ID, adb, attach, page_target

OBSERVER = """
window.__lt = [];
try {
  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) {
      if (window.__lt.length < 2000) {
        window.__lt.push({t: Math.round(e.startTime), ms: Math.round(e.duration)});
      }
    }
  }).observe({entryTypes: ['longtask'], buffered: true});
} catch (e) { window.__lt_failed = String(e); }
"""

# What a phone needs, not what this app currently does. Android's
# input-dispatch ANR is 5 s; a back press that waits a second already reads as
# broken to a store reviewer, who presses it first.
MAX_SINGLE_TASK_MS = 1000
MAX_TOTAL_BLOCKING_MS = 2500


async def run(ws_url: str, seconds: int) -> dict:
    import websockets
    async with websockets.connect(ws_url, max_size=256 * 1024 * 1024) as ws:
        n = 0

        async def call(method: str, params: dict | None = None):
            nonlocal n
            n += 1
            mine = n
            await ws.send(json.dumps({"id": mine, "method": method,
                                      "params": params or {}}))
            while True:
                msg = json.loads(await ws.recv())
                if msg.get("id") == mine:
                    if "error" in msg:
                        raise SystemExit(f"{method}: {msg['error']}")
                    return msg.get("result", {})

        await call("Page.enable")
        await call("Runtime.enable")
        await call("Page.addScriptToEvaluateOnNewDocument", {"source": OBSERVER})
        await call("Page.reload", {"ignoreCache": True})
        print(f"reloaded with the observer installed; watching {seconds}s ...")
        await asyncio.sleep(seconds)

        res = await call("Runtime.evaluate", {
            "expression": """(() => {
              const lt = window.__lt || [];
              return JSON.stringify({
                failed: window.__lt_failed || null,
                lt,
                borders: window.__graticule_borders || null,
                built: !!window.__graticule_viewer,
              });
            })()""",
            "returnByValue": True})
        return json.loads(res["result"]["value"])


def one_run(args) -> dict:
    """Boot the app once and return the metrics for that boot."""
    if not args.attach:
        adb("shell", "am", "force-stop", APP_ID)
        time.sleep(1.5)
        adb("shell", "am", "start", "-n", f"{APP_ID}/.MainActivity")
        time.sleep(args.settle)

    attach()
    data = asyncio.run(run(page_target(), args.seconds))

    lt = data["lt"]
    if data["failed"]:
        raise SystemExit(f"the observer did not attach: {data['failed']}")
    if not lt:
        raise SystemExit("no long tasks recorded at all -- suspect the "
                         "injection, not the app; nothing boots this cleanly")
    return {
        "lt": lt,
        "borders": data["borders"],
        "tasks": len(lt),
        "total": sum(e["ms"] for e in lt),
        "blocking": sum(max(0, e["ms"] - 50) for e in lt),
        "worst": max(e["ms"] for e in lt),
    }


def median(xs: list[int]) -> int:
    s = sorted(xs)
    n = len(s)
    return s[n // 2] if n % 2 else (s[n // 2 - 1] + s[n // 2]) // 2


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--seconds", type=int, default=90)
    ap.add_argument("--settle", type=float, default=3.0)
    ap.add_argument("--attach", action="store_true",
                    help="do not relaunch the app first")
    # One 90 s sample is not a measurement on a shared machine.
    #
    # Measured 2026-08-08: three boots of the SAME build read 14,787, 11,240
    # and 12,225 ms of blocking, and their worst tasks read 3,465, 2,464 and
    # 1,842 ms. That is a 1.9x spread on the worst task with nothing changed,
    # which is larger than most fixes worth making. The host was 50-74% busy
    # with other work at the time, and this emulator gets whatever is left.
    #
    # So: repeat, report the median, and print the spread. The spread is the
    # part that matters. If it is wide, the run cannot rank two builds and the
    # honest output is "inconclusive", not the prettier of two numbers.
    ap.add_argument("--repeat", type=int, default=1,
                    help="boots to average over; 3 or more to compare builds")
    args = ap.parse_args()

    runs = []
    for i in range(args.repeat):
        if args.repeat > 1:
            print(f"\n--- boot {i + 1} of {args.repeat} ---")
        runs.append(one_run(args))

    if args.repeat > 1:
        print("\n  boot    tasks   blocking   worst")
        for i, r in enumerate(runs, 1):
            print(f"  {i:<6}  {r['tasks']:5}   {r['blocking']:8}   {r['worst']:5}")
        blockings = [r["blocking"] for r in runs]
        worsts = [r["worst"] for r in runs]
        spread = max(blockings) / max(1, min(blockings))
        print(f"\n  median blocking  {median(blockings)} ms"
              f"   (range {min(blockings)}-{max(blockings)})")
        print(f"  median worst     {median(worsts)} ms"
              f"   (range {min(worsts)}-{max(worsts)})")
        print(f"  spread           {spread:.2f}x")
        if spread > 1.3:
            print("\n  ** The spread is wider than most fixes are. This run can")
            print("     confirm a large regression and NOTHING ELSE. Do not")
            print("     compare two builds with it until the host is quiet. **")

    # The detailed breakdown describes the last boot, and says so.
    data = runs[-1]
    lt = data["lt"]
    total, blocking, worst = data["total"], data["blocking"], data["worst"]
    last = max(e["t"] + e["ms"] for e in lt)
    if args.repeat > 1:
        print("\n  detail below is the LAST boot only:")

    print(f"\n  long tasks     {len(lt)}")
    print(f"  total task ms  {total}")
    print(f"  blocking ms    {blocking}   (task time over 50 ms)")
    print(f"  worst task ms  {worst}")
    print(f"  last task at   {last} ms after reload")
    print(f"  borders        {data['borders']}")
    print("  top 6          " + json.dumps(sorted(lt, key=lambda e: -e["ms"])[:6]))

    # Where the blocking sits in time. A build that is quiet after boot is a
    # different problem from one that never settles, and the totals hide it.
    print("\n  blocking by window:")
    edges = [0, 15000, 30000, 45000, 60000, 10**9]
    for lo, hi in zip(edges, edges[1:]):
        w = [e for e in lt if lo <= e["t"] < hi]
        name = f"{lo//1000}-{hi//1000}s" if hi < 10**9 else f"{lo//1000}s+"
        print(f"    {name:>9}  {len(w):4} tasks  {sum(max(0, e['ms']-50) for e in w):6} ms")

    # Gate on the median, not on the last boot, or the verdict is whichever
    # sample happened to run while the host was busy.
    g_worst = median([r["worst"] for r in runs])
    g_block = median([r["blocking"] for r in runs])
    label = f"median of {len(runs)}" if len(runs) > 1 else "this boot"

    bad = []
    if g_worst > MAX_SINGLE_TASK_MS:
        bad.append(f"worst single task {g_worst} ms > {MAX_SINGLE_TASK_MS} ms ({label})")
    if g_block > MAX_TOTAL_BLOCKING_MS:
        bad.append(f"total blocking {g_block} ms > {MAX_TOTAL_BLOCKING_MS} ms ({label})")
    print()
    for b in bad:
        print("  FAIL  " + b)
    if not bad:
        print("  PASS  the main thread stays responsive through boot")
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
