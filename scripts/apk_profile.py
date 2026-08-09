"""Where does the APK's main thread actually go? A CPU profile from the device.

`scripts/border_perf_test.py` measures the stall on desktop Chromium and
`apk_probe.py --eval window.__graticule_longtasks` measures it on the device,
but neither says WHICH CODE is blocking. Guessing at that is how issue 51
acquired a 485-line fix that moved the number by nothing: the parse was moved
into a worker, the lines into a primitive and the labels into a lazy pool, and
total blocking went from 12.9 s to 13.3 s because none of those was the cost.

Desktop attribution is not good enough for this app. The one measured on
SwiftShader was dominated by a 4.7 second first `getImageData` -- a canvas
backend warming up, an artifact of the harness, absent on the device -- while
the device's own worst task is 9.8 s and is something else entirely. So this
speaks the DevTools Profiler domain to the WebView, the same raw socket
apk_probe.py uses, and aggregates self time per function.

It profiles from launch by default, because the tasks worth naming happen
during boot and are gone by the time a person can type.

    py -V:3.13 scripts/apk_profile.py                 # relaunch, profile boot
    py -V:3.13 scripts/apk_profile.py --attach        # profile it as it is now
    py -V:3.13 scripts/apk_profile.py --seconds 60
"""
from __future__ import annotations

import argparse
import asyncio
import collections
import json
import time

from apk_probe import APP_ID, adb, attach, page_target

# 200 us. Cesium is minified into functions with names like `hHe`, so the
# sample rate matters more than usual: a coarse profile lands everything in
# one anonymous frame and names nothing.
INTERVAL_US = 200


async def profile(ws_url: str, seconds: int) -> dict:
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
                    return msg.get("result", {})

        await call("Profiler.enable")
        await call("Profiler.setSamplingInterval", {"interval": INTERVAL_US})
        await call("Profiler.start")
        print(f"profiling {seconds}s ...")
        await asyncio.sleep(seconds)
        return (await call("Profiler.stop"))["profile"]


def report(prof: dict, top: int = 24) -> None:
    nodes = {x["id"]: x for x in prof["nodes"]}
    parent: dict[int, int] = {}
    for x in prof["nodes"]:
        for c in x.get("children", []):
            parent[c] = x["id"]

    self_us: collections.Counter = collections.Counter()
    samples, deltas = prof["samples"], prof["timeDeltas"]
    for i, nid in enumerate(samples):
        self_us[nid] += max(0, deltas[i] if i < len(deltas) else 0)

    def label(nid: int) -> str:
        cf = nodes[nid]["callFrame"]
        fn = cf.get("functionName") or "(anonymous)"
        url = (cf.get("url") or "").rsplit("/", 1)[-1] or "(native)"
        return f"{fn}  @{url}:{cf.get('lineNumber', -1) + 1}"

    total = sum(self_us.values()) or 1
    busy = sum(us for nid, us in self_us.items()
               if (nodes[nid]["callFrame"].get("functionName") or "") not in ("(idle)", "(program)"))
    print(f"\nsampled {total/1000:.0f} ms, of which {busy/1000:.0f} ms was not idle\n")

    print("== self time ==")
    for nid, us in self_us.most_common(top):
        print(f"  {us/1000:8.0f} ms {100*us/total:5.1f}%  {label(nid)}")

    # Inclusive time, then filtered to the app's own frames, because the
    # question a fix needs answered is which of OUR calls is on the stack when
    # Cesium is busy -- a minified Cesium frame alone names nothing to change.
    incl: collections.Counter = collections.Counter()
    for nid, us in self_us.items():
        seen, cur = set(), nid
        while cur is not None and cur not in seen:
            seen.add(cur)
            incl[cur] += us
            cur = parent.get(cur)

    print("\n== inclusive time, app frames only ==")
    shown = 0
    for nid, us in incl.most_common(600):
        url = nodes[nid]["callFrame"].get("url") or ""
        if "app.js" not in url and "border-worker" not in url:
            continue
        print(f"  {us/1000:8.0f} ms {100*us/total:5.1f}%  {label(nid)}")
        shown += 1
        if shown >= 20:
            break

    # The heaviest single stack, which is usually the whole story.
    worst = self_us.most_common(1)[0][0]
    chain, cur, guard = [], worst, 0
    while cur is not None and guard < 30:
        chain.append(label(cur))
        cur = parent.get(cur)
        guard += 1
    print("\n== stack of the heaviest frame (leaf first) ==")
    for f in chain:
        print("   ", f)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--attach", action="store_true",
                    help="profile the running app instead of relaunching it")
    ap.add_argument("--seconds", type=int, default=50)
    ap.add_argument("--settle", type=float, default=3.0,
                    help="seconds to wait after launch before attaching")
    ap.add_argument("--json", help="write the raw profile here")
    args = ap.parse_args()

    if not args.attach:
        adb("shell", "am", "force-stop", APP_ID)
        time.sleep(1.5)
        adb("shell", "am", "start", "-n", f"{APP_ID}/.MainActivity")
        # The WebView's debugger socket does not exist until the WebView does,
        # and its name carries the pid, so this cannot be forwarded in advance.
        time.sleep(args.settle)

    attach()
    ws = page_target()
    prof = asyncio.run(profile(ws, args.seconds))
    if args.json:
        with open(args.json, "w") as f:
            json.dump(prof, f)
        print(f"raw profile -> {args.json}")
    report(prof)


if __name__ == "__main__":
    main()
