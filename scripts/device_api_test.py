"""Every /api endpoint, answered by the page instead of by a server.

web/feeds.js now answers the ten on-demand endpoints the backend used to
serve, from the same upstream providers. Each one returned a specific JSON
SHAPE that a panel in app.js parses, and a renamed field breaks that panel
silently -- the request succeeds, the panel just shows nothing.

So this asks for each endpoint in device mode, against the real providers,
and checks the shape rather than only the status. A 200 carrying `{}` passes
any check that only looks at the status code.

    py -V:3.13 scripts/device_api_test.py [port]

The server has to be running, because the web build proxies the providers
that send no Access-Control-Allow-Origin. Nothing here reads the server's own
feeds: every call is answered in the page.
"""
from __future__ import annotations

import asyncio
import sys

from playwright.async_api import async_playwright

PORT = sys.argv[1] if len(sys.argv) > 1 else "8731"
ORIGIN = f"http://127.0.0.1:{PORT}"

ok: list[str] = []
bad: list[str] = []


def chk(cond: bool, msg: str) -> None:
    (ok if cond else bad).append(msg)
    print(("  PASS  " if cond else "  FAIL  ") + msg)


CALL = """async (path) => {
  const r = await window.GraticuleFeeds.api(path);
  const body = await r.json();
  return { status: r.status, body };
}"""

# path -> what a correct answer has to contain. `keys` are top-level keys that
# must exist; `feature` names a properties field every feature must carry.
WANT = [
    ("/api/config", {"keys": ["fires_enabled", "ships_enabled", "ships_global"]}),
    ("/api/nws/alerts", {"keys": ["features"], "min": 1,
                         "props": ["event", "severity", "areaDesc"]}),
    ("/api/spc/outlook?day=1", {"keys": ["features"]}),
    ("/api/lsr?hours=6", {"keys": ["features", "_hours"]}),
    ("/api/metar", {"list": True, "min": 50,
                    "fields": ["id", "lat", "lon", "obsTime"]}),
    ("/api/rivers", {"keys": ["features", "flooding", "credit"], "min": 100,
                     "props": ["kind", "flood_rank", "flood_category"]}),
    ("/api/tides", {"keys": ["features", "credit"], "min": 100,
                    "props": ["kind", "id", "great_lakes", "storm_surge"]}),
    ("/api/buoys", {"keys": ["features", "credit"], "min": 50,
                    "props": ["kind", "id", "obs_time"]}),
    ("/api/spotters", {"keys": ["features", "credit"]}),
    ("/api/cameras", {"keys": ["features", "networks", "credit"], "min": 100,
                      "props": ["kind", "network", "image"]}),
]


async def main() -> None:
    async with async_playwright() as p:
        br = await p.chromium.launch(args=["--disable-dev-shm-usage",
                                           "--hide-scrollbars"])
        ctx = await br.new_context(viewport={"width": 412, "height": 915},
                                   service_workers="block")
        pg = await ctx.new_page()
        await pg.goto(ORIGIN + "/", wait_until="load", timeout=120_000)
        await pg.wait_for_timeout(8000)

        print("=== the endpoints the backend used to serve ===")
        chk(await pg.evaluate("() => window.__graticule_data_source") == "device",
            "CONTROL: the page is in device mode, so nothing below reached a "
            "backend feed")

        station = None
        for path, want in WANT:
            try:
                r = await pg.evaluate(CALL, path)
            except Exception as e:                       # noqa: BLE001
                chk(False, f"{path} raised {type(e).__name__}")
                continue
            body = r["body"]
            if r["status"] != 200:
                chk(False, f"{path} -> {r['status']} {str(body)[:90]}")
                continue

            if want.get("list"):
                n = len(body) if isinstance(body, list) else -1
                chk(n >= want.get("min", 1),
                    f"{path} -> {n} rows")
                if n > 0:
                    missing = [f for f in want.get("fields", []) if f not in body[0]]
                    chk(not missing, f"  and each row carries {want['fields']} "
                                     f"(missing: {missing or 'none'})")
                continue

            missing = [k for k in want["keys"] if k not in body]
            feats = body.get("features") if isinstance(body, dict) else None
            n = len(feats) if isinstance(feats, list) else 0
            chk(not missing and n >= want.get("min", 0),
                f"{path} -> {n} features, keys {want['keys']} "
                f"(missing: {missing or 'none'})")

            if want.get("props") and n:
                props = (feats[0] or {}).get("properties", {})
                gone = [k for k in want["props"] if k not in props]
                chk(not gone,
                    f"  and its properties carry {want['props']} "
                    f"(missing: {gone or 'none'})")

            if path == "/api/tides" and n:
                station = (feats[0] or {}).get("properties", {}).get("id")

        # The per-click endpoint, using a station the list actually returned
        # rather than one written down here that may be decommissioned.
        if station:
            r = await pg.evaluate(CALL, f"/api/tide/{station}")
            b = r["body"]
            chk(r["status"] == 200 and b.get("station") == station,
                f"/api/tide/{station} -> station echoed back")
            chk("level" in b or "level_error" in b or "predictions" in b,
                f"  and it carries a reading, a prediction set or a stated "
                f"reason ({sorted(b.keys())})")
        else:
            chk(False, "no tide station id came back, so /api/tide/<id> was "
                       "not exercised")

        # CONTROL: the route table has to MISS something, or "every path
        # answered" is also what a catch-all returning 200 would say.
        r = await pg.evaluate(CALL, "/api/definitely-not-a-route")
        chk(r["status"] == 501,
            f"CONTROL: an unknown path is refused, not answered "
            f"({r['status']})")

        await br.close()

    print(f"\n{len(ok)} passed, {len(bad)} failed")
    for m in bad:
        print("  FAILED:", m)
    sys.exit(1 if bad else 0)


asyncio.run(main())
