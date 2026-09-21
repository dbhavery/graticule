"""The APK, running on an Android device, measured through its own WebView.

WHY THIS EXISTS. Every other suite in this repo runs the app's code in desktop
Chromium, and two things are different there in ways that are not cosmetic:

  1. There is no CapacitorHttp. Chromium takes the `fetch` branch of gfetch,
     so the native branch -- the whole reason the providers that send no CORS
     header can be reached at all -- was never executed by any gate.
  2. Chromium sends its own User-Agent and will not let a page change it.
     The native branch sends whatever it sets, and OkHttp's default is
     `Dalvik/2.1.0 (Linux; U; Android ...)`.

Both of those hid a real defect, found 2026-09-20 the first time the APK was
attached to instead of reasoned about:

  * `responseType: 'text'` is a request, not a guarantee. The bridge parses
    anything it sees as application/json and hands back an object, so the
    old `String(res.data)` produced the literal "[object Object]" and every
    JSON feed died on JSON.parse. Six of seven always-on layers were empty.
  * api.weather.gov answers the Dalvik UA with 403 Access Denied. Alerts,
    the single most important layer in a weather app, could not load.

Desktop suites were green through all of it. So this one talks to the device.

    py -V:3.13 scripts/device_webview_test.py [seconds_to_let_feeds_run]

It needs an emulator or phone on adb with the app installed, and it does the
port-forwarding itself. Build and install first:

    py -V:3.13 scripts/android_build.py --api-base ""
    adb install -r -t android/app/build/outputs/apk/debug/app-debug.apk
"""
from __future__ import annotations

import asyncio
import json
import os
import pathlib
import re
import subprocess
import sys
import time

from playwright.async_api import async_playwright

APP_ID = "dev.dbhavery.graticule"
PORT = 9333
SETTLE = int(sys.argv[1]) if len(sys.argv) > 1 else 120

# Mirrors NEEDS_PROXY in web/feeds.js. On native that set can only ever be the
# preset, because the branch that grows it is the browser one.
PRESET_PROXY_HOSTS = {
    "api.adsb.lol", "opendata.adsb.fi", "api.airplanes.live",
    "www.nhc.noaa.gov", "webservices.volcano.si.edu", "tfr.faa.gov",
    "www.submarinecablemap.com", "firms.modaps.eosdis.nasa.gov",
    "services.swpc.noaa.gov",
}

ok: list[str] = []
bad: list[str] = []


def chk(cond: bool, msg: str) -> None:
    (ok if cond else bad).append(msg)
    print(("  PASS  " if cond else "  FAIL  ") + msg, flush=True)


def adb_path() -> str:
    local = os.environ.get("LOCALAPPDATA", "")
    cand = pathlib.Path(local) / "Android" / "Sdk" / "platform-tools" / "adb.exe"
    return str(cand) if cand.exists() else "adb"


ADB = adb_path()


def adb(*args: str, timeout: int = 120) -> str:
    r = subprocess.run([ADB, *args], capture_output=True, text=True,
                       timeout=timeout)
    return (r.stdout or "") + (r.stderr or "")


def attach() -> None:
    """Start the app and point PORT at its WebView debugging socket."""
    if "device" not in adb("devices"):
        raise SystemExit("no device on adb. Start an emulator or plug a phone "
                         "in with USB debugging on.")
    adb("shell", "am", "force-stop", APP_ID)
    # Granting location up front keeps Android's runtime permission dialog off
    # the screen. It is not what this suite measures and it blocks the WebView.
    for perm in ("ACCESS_FINE_LOCATION", "ACCESS_COARSE_LOCATION"):
        adb("shell", "pm", "grant", APP_ID, f"android.permission.{perm}")
    adb("shell", "monkey", "-p", APP_ID, "-c",
        "android.intent.category.LAUNCHER", "1")

    sock = ""
    for _ in range(40):
        time.sleep(3)
        m = re.search(r"webview_devtools_remote_\d+", adb("shell", "cat",
                                                          "/proc/net/unix"))
        if m:
            sock = m.group(0)
            break
    if not sock:
        raise SystemExit(
            "the app never opened a WebView debugging socket. Either it did "
            "not start, or this is a release build (debugging is off there).")
    adb("forward", "--remove-all")
    adb("forward", f"tcp:{PORT}", f"localabstract:{sock}")
    print(f"attached to {sock} through tcp:{PORT}\n", flush=True)


async def main() -> None:
    attach()
    async with async_playwright() as p:
        br = await p.chromium.connect_over_cdp(f"http://127.0.0.1:{PORT}")
        pg = next((q for q in br.contexts[0].pages
                   if q.url.startswith("https://localhost/")
                   and not q.url.endswith("sw.js")), None)
        if pg is None:
            raise SystemExit("the WebView has no app page")

        await pg.wait_for_function(
            "()=>window.GraticuleFeeds && window.__graticule_viewer",
            timeout=180_000)
        print(f"=== letting the feeds run for {SETTLE}s ===", flush=True)
        await asyncio.sleep(SETTLE)

        print("\n=== the shell ===", flush=True)
        origin = await pg.evaluate("()=>location.origin")
        chk(origin == "https://localhost",
            f"the page runs on the Capacitor origin ({origin})")
        base = await pg.evaluate("()=>window.GRATICULE_API_BASE")
        chk(not base, f"and names no backend ({base!r})")
        src = await pg.evaluate("()=>window.__graticule_data_source")
        chk(src == "device", f"so the feeds run on the device ({src!r})")

        print("\n=== the native transport ===", flush=True)
        plugin = await pg.evaluate("""()=>{
          const C = window.Capacitor;
          return {
            native: !!(C && C.isNativePlatform && C.isNativePlatform()),
            platform: C && C.getPlatform ? C.getPlatform() : null,
            http: !!(C && ((C.Plugins && C.Plugins.CapacitorHttp)
                            || C.CapacitorHttp)),
          };
        }""")
        chk(plugin.get("native") and plugin.get("http"),
            f"Capacitor reports a native platform with CapacitorHttp "
            f"({json.dumps(plugin)})")
        chk(await pg.evaluate("()=>window.GraticuleFeeds.native") is True,
            "and gfetch took the native branch")
        chk(await pg.evaluate("()=>window.GraticuleFeeds.nativeMissing()")
            is False,
            "so the missing-plugin guard stayed quiet")

        # The 403 that hid behind Chromium's own User-Agent. Asked of the
        # provider directly rather than inferred from the layer, so it names
        # the cause when it breaks again.
        ua = await pg.evaluate("""async ()=>{
          const H = window.Capacitor.Plugins.CapacitorHttp;
          const url = 'https://api.weather.gov/alerts/active?status=actual&area=OR';
          const out = {};
          for (const [k, h] of [['default', null], ['ours', {'User-Agent': 'graticule/1.0'}]]) {
            const req = {url, method: 'GET', responseType: 'text'};
            if (h) req.headers = h;
            try { out[k] = (await H.request(req)).status; }
            catch (e) { out[k] = String(e).slice(0, 80); }
          }
          return out;
        }""")
        chk(ua.get("ours") == 200,
            f"the UA gfetch sends is one NWS accepts ({json.dumps(ua)})")
        # CONTROL: if the bare request also succeeds, the check above is not
        # measuring the header, and a future build could drop it silently.
        chk(ua.get("default") == 403,
            f"CONTROL: without it NWS refuses ({ua.get('default')})")

        print("\n=== the engine, out of the APK ===", flush=True)
        chk(await pg.evaluate("()=>typeof window.Cesium") == "object",
            "Cesium loaded with no CDN")
        canvas = await pg.evaluate("""()=>{
          const v = window.__graticule_viewer;
          const c = v && v.scene && v.scene.canvas;
          return c ? {w: c.width, h: c.height} : null;
        }""")
        chk(bool(canvas and canvas["w"] > 100),
            f"and the viewer has a canvas ({canvas})")

        print("\n=== the feeds, with nothing to talk to but the providers ===",
              flush=True)
        counts = await pg.evaluate("()=>window.GraticuleFeeds.counts()")
        filled = {k: v for k, v in (counts or {}).items() if v}
        chk(len(filled) >= 4,
            f"{len(filled)} layers filled ("
            f"{dict(sorted(filled.items(), key=lambda kv: -kv[1])[:6])})")

        status = await pg.evaluate("()=>window.GraticuleFeeds.status()")
        chk(len([f for f in status if f.get("runs")]) >= 5,
            f"{len([f for f in status if f.get('runs')])} feeds ran")

        # A 429 a feed is already backing off from is the rate limit working,
        # not a defect. Everything else is one.
        failed = [f"{f['name']}: {f['lastError']}" for f in status
                  if f.get("lastError")
                  and not (f.get("heldUntil") and "429" in str(f["lastError"]))]
        held = [f["name"] for f in status if f.get("heldUntil")]
        chk(not failed,
            f"and none reported an error ({failed[:3] or 'none'}; "
            f"rate limited: {held or 'none'})")

        proxied = set(await pg.evaluate("()=>[...window.GraticuleFeeds.proxied()]"))
        chk(proxied == PRESET_PROXY_HOSTS,
            f"no host was learned as needing a relay, which native has none of "
            f"({sorted(proxied - PRESET_PROXY_HOSTS) or 'only the preset'})")

        print("\n=== the endpoints the app used to ask a server for ===",
              flush=True)
        for path in ("/api/config", "/api/nws/alerts", "/api/rivers",
                     "/api/metar", "/api/tides", "/api/buoys", "/api/lsr"):
            got = await pg.evaluate("""async (p)=>{
              try {
                const r = await window.GraticuleFeeds.api(p);
                const j = await r.json();
                return {status: r.status,
                        n: Array.isArray(j) ? j.length
                           : (j && typeof j === 'object'
                              ? Object.keys(j).length : 0)};
              } catch (e) { return {status: 0, err: String(e).slice(0, 90)}; }
            }""", path)
            chk(got.get("status") == 200 and got.get("n", 0) > 0,
                f"{path} answered on the device ({json.dumps(got)})")

        # CONTROL: the in-page router has to be able to refuse. Without this,
        # every check above would pass against a stub that answers anything.
        nope = await pg.evaluate(
            "async ()=>(await window.GraticuleFeeds.api('/api/not-a-real-route')).status")
        chk(nope == 501,
            f"CONTROL: a path that was never ported is refused ({nope})")

        await br.close()

    print(f"\n{len(ok)} passed, {len(bad)} failed")
    for m in bad:
        print("  FAILED:", m)
    sys.exit(1 if bad else 0)


asyncio.run(main())
