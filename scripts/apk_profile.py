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

A profile of a whole boot says what the boot cost. It does not say what a
PARTICULAR PART of the boot cost, and those are different questions the moment
the boot is uneven. apk_tti.py measured this one as uneven: the first ten
seconds are comparatively usable and the collapse is at 10-25 s. Aggregating
across the whole run averages the good part into the bad one and names
whatever is merely biggest overall.

So `--window A:B` restricts the report to a slice of PAGE time -- the same
clock apk_tti.py reports in, `performance.now()` since navigation -- by mapping
each sample's profile timestamp onto it.

    py -V:3.13 scripts/apk_profile.py                     # relaunch, whole boot
    py -V:3.13 scripts/apk_profile.py --window 10:25      # only the collapse
    py -V:3.13 scripts/apk_profile.py --attach            # as it is now
    py -V:3.13 scripts/apk_profile.py --seconds 60

CONTROL: --selftest burns a named function for 4 s in the middle of the
requested window and fails unless the windowed report attributes it there AND
does not attribute it outside. Two clocks are being joined; a windowed profile
whose alignment is wrong still prints a confident table.

    py -V:3.13 scripts/apk_profile.py --window 10:25 --selftest
"""
from __future__ import annotations

import argparse
import asyncio
import collections
import json
import sys
import time

from apk_probe import APP_ID, adb, attach, page_target

# 200 us. Cesium is minified into functions with names like `hHe`, so the
# sample rate matters more than usual: a coarse profile lands everything in
# one anonymous frame and names nothing.
INTERVAL_US = 200


# The control's blocking function, named so it shows up in the profile as
# itself rather than as an anonymous frame. Armed at an absolute PAGE time, so
# the assertion is about the same clock the window is expressed in.
SELFTEST_ARM = """(() => {
  window.__profileSelftestBurn = function __profileSelftestBurn() {
    const end = performance.now() + 4000;
    while (performance.now() < end) { /* deliberately blocking */ }
  };
  const now = performance.now();
  setTimeout(window.__profileSelftestBurn, Math.max(0, %d - now));
  return Math.round(now);
})()"""


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


async def page_time_origin(c: Cdp) -> tuple[float, str]:
    """Profile-clock microseconds at the instant page time was 0.

    The profiler timestamps samples on the renderer's monotonic clock and
    `performance.now()` counts from navigation, so joining them needs one
    reading that exists in both. The Performance domain in the timeTicks domain
    publishes exactly that. There is no silent fallback on purpose: a windowed
    profile with a guessed origin still prints a confident table, and a wrong
    table is worse than no table.
    """
    await c.call("Performance.enable", {"timeDomain": "timeTicks"})
    m = {x["name"]: x["value"] for x in (await c.call("Performance.getMetrics"))["metrics"]}
    if "NavigationStart" in m:
        return m["NavigationStart"] * 1e6, "Performance.NavigationStart"

    # No NavigationStart on this build: pair a monotonic reading with a page
    # reading taken between two of them, and carry the bracket as the error.
    before = (await c.call("Performance.getMetrics"))["metrics"]
    page = (await c.call("Runtime.evaluate",
                         {"expression": "performance.now()",
                          "returnByValue": True}))["result"]["value"]
    after = (await c.call("Performance.getMetrics"))["metrics"]
    ts = [ {x["name"]: x["value"] for x in side}.get("Timestamp") for side in (before, after) ]
    if None in ts:
        raise SystemExit(
            "no NavigationStart and no Timestamp metric: this WebView cannot "
            "join the profiler clock to page time, so --window would be a guess")
    mid = (ts[0] + ts[1]) / 2
    return mid * 1e6 - page * 1000, f"Timestamp pairing (+/-{(ts[1]-ts[0])*500:.0f} ms)"


async def profile(ws_url: str, seconds: int, selftest_at_ms: int | None
                  ) -> tuple[dict, float, str]:
    import websockets
    # ping_interval=None because a profile run is deliberately silent for its
    # whole duration. The client's keepalive expects a pong within 20 s, and
    # this app blocks its main thread for nearly 6 s in one frame at boot, so
    # the default closes the debugger socket underneath the measurement and the
    # first call after the sleep fails with ConnectionClosedError.
    async with websockets.connect(ws_url, max_size=256 * 1024 * 1024,
                                  ping_interval=None) as ws:
        c = Cdp(ws)
        await c.call("Runtime.enable")
        await c.call("Profiler.enable")
        await c.call("Profiler.setSamplingInterval", {"interval": INTERVAL_US})
        await c.call("Profiler.start")
        print(f"profiling {seconds}s ...")

        if selftest_at_ms is not None:
            now = (await c.call("Runtime.evaluate",
                                {"expression": SELFTEST_ARM % selftest_at_ms,
                                 "returnByValue": True}))["result"]["value"]
            print(f"  self-test armed at page time {selftest_at_ms} ms "
                  f"(it is {now} ms now)")
            if now > selftest_at_ms:
                raise SystemExit(
                    f"page time is already {now} ms, past the {selftest_at_ms} ms "
                    "the control needed; lower --window or raise --settle")

        # Two things were tried here and neither is the answer, so neither is
        # left in the code pretending to be one. On a 2 GB emulator this
        # profiler kills the WebView often enough that a run ends with
        # ConnectionClosedError and `pidof` showing the app gone. A websocket
        # Ping frame makes it worse: the WebView's devtools server closes the
        # connection on one, which killed a run that had been surviving. A
        # keepalive Runtime.evaluate every 10 s did not help either. See
        # issues.md 64; retry the run, or profile a shorter window.
        await asyncio.sleep(seconds)

        # Read the origin before stopping: the page must still be the same
        # document the samples came from.
        origin_us, how = await page_time_origin(c)
        return (await c.call("Profiler.stop"))["profile"], origin_us, how


def sample_times_us(prof: dict) -> list[float]:
    """Absolute profile-clock time of every sample.

    timeDeltas[i] is the gap that ENDS at samples[i], so a running sum from
    startTime lands each sample at its own instant.
    """
    t = prof["startTime"]
    deltas = prof["timeDeltas"]
    out = []
    for i in range(len(prof["samples"])):
        t += deltas[i] if i < len(deltas) else 0
        out.append(t)
    return out


def slice_to_window(prof: dict, origin_us: float, lo_ms: float, hi_ms: float) -> dict:
    """The same profile with only the samples inside [lo, hi) of page time.

    A sample carries the interval that ended at it, so the first one kept is
    clamped to the part of its interval that is actually inside the window.
    Without that clamp the first sample absorbs the whole excluded stretch and
    whatever happened to be running at the boundary wins the report.
    """
    lo_us, hi_us = origin_us + lo_ms * 1000, origin_us + hi_ms * 1000
    times = sample_times_us(prof)
    deltas = prof["timeDeltas"]
    samples, kept = [], []
    for i, t in enumerate(times):
        if not (lo_us <= t < hi_us):
            continue
        d = deltas[i] if i < len(deltas) else 0
        if not samples:                      # first kept sample
            d = min(d, max(0.0, t - lo_us))
        samples.append(prof["samples"][i])
        kept.append(d)
    return {**prof, "samples": samples, "timeDeltas": kept}


def self_time_of(prof: dict, fn_name: str) -> float:
    """Milliseconds of self time attributed to a named function."""
    nodes = {x["id"]: x for x in prof["nodes"]}
    us = 0.0
    for i, nid in enumerate(prof["samples"]):
        if nodes[nid]["callFrame"].get("functionName") == fn_name:
            us += prof["timeDeltas"][i] if i < len(prof["timeDeltas"]) else 0
    return us / 1000


def report(prof: dict, top: int = 24) -> None:
    if not prof["samples"]:
        print("\n  no samples in this window -- the profiler was not running "
              "then, or the window is outside the run")
        return
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


def parse_window(text: str | None) -> tuple[float, float] | None:
    if not text:
        return None
    lo, _, hi = text.partition(":")
    if not _:
        raise SystemExit("--window wants SECONDS:SECONDS, e.g. --window 10:25")
    return float(lo) * 1000, float(hi) * 1000


def check_selftest(prof: dict, origin_us: float, win: tuple[float, float],
                   burn_at_ms: float) -> None:
    """The window must contain the deliberate 4 s burn, and only the window."""
    fn = "__profileSelftestBurn"
    inside = self_time_of(slice_to_window(prof, origin_us, *win), fn)
    before = self_time_of(slice_to_window(prof, origin_us, 0, win[0]), fn)
    print(f"\nCONTROL: a named function burned 4,000 ms at page time "
          f"{burn_at_ms:.0f} ms")
    # Two different failures wear the same 0 ms, and telling them apart is the
    # difference between fixing a clock and fixing an injection: either the
    # burn never ran, or it ran and the window is looking somewhere else.
    everywhere = self_time_of(prof, fn)
    times = sample_times_us(prof)
    print(f"  anywhere in the profile   {everywhere:7.0f} ms   "
          f"({'the burn ran' if everywhere > 500 else 'THE BURN NEVER RAN'})")
    if times:
        print(f"  profile covers page time  {(times[0]-origin_us)/1000:.0f} to "
              f"{(times[-1]-origin_us)/1000:.0f} ms")
        if everywhere > 500:
            at = [ (t - origin_us) / 1000 for t, nid in zip(times, prof["samples"])
                   if {x["id"]: x for x in prof["nodes"]}[nid]["callFrame"]
                   .get("functionName") == fn ]
            if at:
                print(f"  the burn sampled at       {min(at):.0f} to "
                      f"{max(at):.0f} ms of page time")
    print(f"  inside  {win[0]/1000:.0f}-{win[1]/1000:.0f}s   {inside:7.0f} ms  "
          f"(needs >= 3000)")
    print(f"  before  0-{win[0]/1000:.0f}s      {before:7.0f} ms  (needs <= 300)")
    if inside < 3000 or before > 300:
        print("\n  FAIL  the burn is not where it was put. The two clocks are")
        print("        joined wrongly, so every windowed number is fiction.")
        sys.exit(1)
    print("  PASS  the window holds what was put in it and nothing from outside,")
    print("        so a windowed report on a real boot means something.")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--attach", action="store_true",
                    help="profile the running app instead of relaunching it")
    ap.add_argument("--seconds", type=int, default=50)
    ap.add_argument("--settle", type=float, default=3.0,
                    help="seconds to wait after launch before attaching")
    ap.add_argument("--window", help="report only this slice of PAGE time, "
                                     "in seconds, e.g. 10:25")
    ap.add_argument("--selftest", action="store_true",
                    help="prove the window is where it claims to be")
    ap.add_argument("--json", help="write the raw profile here")
    args = ap.parse_args()

    win = parse_window(args.window)
    if args.selftest and not win:
        raise SystemExit("--selftest checks a --window; give it one")

    if not args.attach:
        adb("shell", "am", "force-stop", APP_ID)
        time.sleep(1.5)
        adb("shell", "am", "start", "-n", f"{APP_ID}/.MainActivity")
        # The WebView's debugger socket does not exist until the WebView does,
        # and its name carries the pid, so this cannot be forwarded in advance.
        time.sleep(args.settle)

    # A forward from a previous launch survives force-stop and points at a dead
    # pid's socket, which fails at handshake rather than at connect.
    adb("forward", "--remove-all")
    attach()
    ws = page_target()
    burn_at = (win[0] + win[1]) / 2 if (args.selftest and win) else None
    prof, origin_us, how = asyncio.run(
        profile(ws, args.seconds, int(burn_at) if burn_at else None))
    if args.json:
        with open(args.json, "w") as f:
            json.dump(prof, f)
        print(f"raw profile -> {args.json}")

    if not win:
        report(prof)
        return

    times = sample_times_us(prof)
    covered = ((times[0] - origin_us) / 1000, (times[-1] - origin_us) / 1000) \
        if times else (0, 0)
    print(f"\n== page time {win[0]/1000:.0f}-{win[1]/1000:.0f}s ==")
    print(f"   clock joined by {how}; the profile covers "
          f"{covered[0]:.0f}-{covered[1]:.0f}s of page time")
    if covered[0] > win[0]:
        print(f"   ** profiling started {covered[0]:.0f}s in, so the first "
              f"{covered[0] - win[0]/1000:.0f}s of this window is missing **")
    report(slice_to_window(prof, origin_us, *win))
    if args.selftest:
        check_selftest(prof, origin_us, win, burn_at)


if __name__ == "__main__":
    main()
