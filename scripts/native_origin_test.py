"""The app, served from an origin that is not the backend.

This is the whole native story in one test. Capacitor hands the WebView the
page from `https://localhost` and the backend lives somewhere else, so every
`/api/...` and the WebSocket are cross-origin. Nothing in the existing suites
could see a break there, because all of them load the page FROM the backend and
same-origin hides the entire class of failure.

So this stands up a second server that serves the static bundle and the one
relay the web build has, and nothing else -- no /api/config, no /api/layer, no
/ws.

THREE runs, because the app now has two data paths:

  * WITH ?api=            the old arrangement. The app must reach the backend,
                          open the socket and take data across the origin
                          boundary, which is the bug this file was written for.
  * WITH ?data=server     and no API base: it must FAIL. If it succeeds the
                          shell is secretly serving an API and the run above
                          proves nothing. This used to need no flag, because
                          an app with no backend was a dead app.
  * WITH NOTHING          the way it ships. The feeds run in the page, so it
                          must fill itself, reach no backend at all, and ask
                          its own origin for nothing but the relay.

    py -V:3.13 scripts/native_origin_test.py [backend_port]
"""
from __future__ import annotations

import asyncio
import functools
import http.server
import pathlib
import sys
import threading
import urllib.error
import urllib.request

from playwright.async_api import async_playwright

BACKEND = sys.argv[1] if len(sys.argv) > 1 else "8744"
# 8751 sat inside a Windows excluded port range on this machine and bind
# failed with WinError 10013, which reads like a firewall problem and is not.
SHELL_PORT = 8762
WEB = pathlib.Path(__file__).resolve().parent.parent / "web"

ok: list[str] = []
bad: list[str] = []


def chk(cond: bool, msg: str) -> None:
    (ok if cond else bad).append(msg)
    print(("  PASS  " if cond else "  FAIL  ") + msg)


class ShellHandler(http.server.SimpleHTTPRequestHandler):
    """Serves web/ the way the APK does, plus the one relay the web build has.

    Two rules matter: `/` is index.html and `/static/x` is web/x. There is
    deliberately no /api/config, no /api/layer and no /ws, so a request for one
    404s rather than quietly working and making the test meaningless.

    `/api/proxy` IS served, by forwarding to the backend's copy of it. That is
    not a hole in the above: it is the shape the web build actually ships as,
    static files plus one stateless relay for the seven providers that refuse
    a browser. Leaving it out made this test a third configuration that nothing
    ships -- the APK does not need a relay, because Capacitor requests
    natively, and the deployed web build has one.
    """

    def do_GET(self) -> None:                                # noqa: N802
        if self.path.startswith("/api/proxy"):
            self.relay()
            return
        super().do_GET()

    def relay(self) -> None:
        url = f"http://127.0.0.1:{BACKEND}{self.path}"
        try:
            with urllib.request.urlopen(url, timeout=120) as r:
                body = r.read()
                ctype = r.headers.get("content-type", "application/octet-stream")
                code = r.status
        except urllib.error.HTTPError as e:
            body, ctype, code = e.read(), "application/json", e.code
        except Exception as e:                               # noqa: BLE001
            body = f'{{"error":"relay {type(e).__name__}"}}'.encode()
            ctype, code = "application/json", 502
        self.send_response(code)
        self.send_header("content-type", ctype)
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def translate_path(self, path: str) -> str:
        clean = path.split("?", 1)[0].split("#", 1)[0]
        if clean in ("/", "/index.html"):
            return str(WEB / "index.html")
        if clean.startswith("/static/"):
            return str(WEB / clean[len("/static/"):])
        return str(WEB / clean.lstrip("/"))

    def end_headers(self) -> None:
        # No caching, or run two of these back to back and the second measures
        # the first one's bytes.
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, *a) -> None:  # noqa: D102 - quiet
        pass


def serve_shell() -> http.server.ThreadingHTTPServer:
    srv = http.server.ThreadingHTTPServer(
        ("127.0.0.1", SHELL_PORT),
        functools.partial(ShellHandler, directory=str(WEB)))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


# `viewer.entities` is EMPTY on a healthy boot and always was -- every layer in
# this app is a DataSource, so a check on viewer.entities.values.length is a
# check that reads 0 whether the app worked or not. The border LINES are now a
# scene primitive (built in workers, issue 51), so entity counts shrank from
# ~13,000 to a few hundred: the count that proves /static loaded is the app's
# own __graticule_borders.lines, which is only written after the worker has
# fetched and parsed the boundary files.
PROBE = """() => {
  const v = window.__graticule_viewer;
  let feats = 0;
  for (let i = 0; i < v.dataSources.length; i++) {
    feats += v.dataSources.get(i).entities.values.length;
  }
  return {
    base: window.__graticule_api_base,
    statusText: (document.getElementById('rail-status') || {}).textContent || '',
    features: feats,
    borderLines: (window.__graticule_borders || {}).lines || 0,
    borderPositions: (window.__graticule_borders || {}).positions || 0,
    borderRaster: (window.__graticule_borders || {}).raster || 0,
    imagery: v.imageryLayers.length,
    // Starts at a hard-coded 0 in the markup and is only ever written by the
    // /api/nws/alerts handler, so a number here is proof the backend answered.
    // The boundary features are NOT proof: they come from /static, which the
    // shell server serves itself, so they load identically either way.
    alerts: +((document.getElementById('hdr-n-alerts') || {}).textContent || '0')
              .replace(/[^0-9]/g, '') || 0,
  };
}"""

# From the same control: /api/config and /api/nws/alerts are the only two that
# fire at boot. Everything else is behind a division or a dashboard.
MIN_API_PATHS = 2


async def boot(ctx, url: str, wait_s: float):
    pg = await ctx.new_page()
    seen: list[str] = []
    pg.on("request", lambda r: seen.append(r.url))
    await pg.goto(url, wait_until="load")
    await pg.wait_for_function(
        "()=>window.__graticule_viewer && window.__graticule_viewer.scene", timeout=90_000)
    await asyncio.sleep(wait_s)
    return pg, seen


async def main() -> None:
    srv = serve_shell()
    print(f"static shell on http://127.0.0.1:{SHELL_PORT}  (no API, no /ws)")
    try:
        async with async_playwright() as p:
            br = await p.chromium.launch(args=[
                "--use-gl=angle", "--use-angle=swiftshader",
                "--enable-unsafe-swiftshader", "--disable-dev-shm-usage",
            ])
            ctx = await br.new_context(viewport={"width": 412, "height": 915},
                                       is_mobile=True, has_touch=True)

            api = f"http://127.0.0.1:{BACKEND}"
            print("\n== served from one origin, backend on another ==")
            pg, seen = await boot(ctx, f"http://127.0.0.1:{SHELL_PORT}/?terrain=off&api={api}", 26)
            st = await pg.evaluate(PROBE)

            chk(st["base"] == api, f"the app resolved its API base to {st['base']!r}")

            to_backend = {u.split(api, 1)[1] for u in seen if u.startswith(api + "/api/")}
            to_shell = [u for u in seen if u.startswith(f"http://127.0.0.1:{SHELL_PORT}/api/")]
            chk(len(to_backend) >= MIN_API_PATHS,
                f"{len(to_backend)} distinct /api paths went to the BACKEND origin "
                f"({', '.join(sorted(to_backend))})")
            chk(not to_shell,
                f"and none went to the origin serving the page ({len(to_shell)})")

            # The socket is the part that had its own bug: it was built from
            # location.host, so it would have dialled the asset server.
            sock = await pg.evaluate("""async () => {
              const s = document.getElementById('rail-status');
              return s ? s.textContent : '';
            }""")
            chk("live" in sock.lower(),
                f"the WebSocket reached the backend and the rail says live ({sock.strip()[:60]!r})")

            chk(st["alerts"] > 0,
                f"live NWS data crossed the origin boundary "
                f"({st['alerts']} active alerts counted)")

            errs = await pg.evaluate("()=>window.__graticule_boot_errors || []")
            chk(not errs, f"no recorded boot errors ({len(errs)})")
            await pg.close()

            # ---- The control -------------------------------------------------
            # Same page, same static server, no API base, AND server mode
            # forced. If this ALSO reaches a backend then the shell server is
            # proxying and every check above is measuring nothing.
            #
            # `?data=server` is new and it is what keeps this control meaning
            # what it used to mean. Without it the app now runs its feeds on
            # the device and fills itself perfectly well with no backend, which
            # is the point of the whole change and would turn this control into
            # a check that always passes. Forcing the old path back on is the
            # only way to still ask "is the shell secretly serving an API".
            print("\n== the control: same page, no API base, server mode forced ==")
            pg2, seen2 = await boot(
                ctx, f"http://127.0.0.1:{SHELL_PORT}/?terrain=off&data=server", 16)
            st2 = await pg2.evaluate(PROBE)
            chk(st2["base"] == "", "the app resolved to same-origin")
            hit = [u for u in seen2 if u.startswith(api)]
            chk(not hit, f"nothing reached the backend by accident ({len(hit)})")
            chk("live" not in st2["statusText"].lower(),
                "and the rail does NOT say live, so the check above can fail")
            chk(st2["alerts"] == 0,
                f"and the alert count stayed at its markup 0 ({st2['alerts']}), "
                f"which is what makes the count above evidence")
            # POSITIONS, not lines. The build joins contiguous segments now,
            # so the same geometry reports 4,236 lines where it used to report
            # 11,378, and a threshold on line count would fail on a build that
            # lost nothing. Vertices are the thing that actually arrived.
            #
            # And now not positions either: this page never leaves orbit, where
            # the borders are RASTER TILES and the vector count is legitimately
            # zero (issues.md 70). Two tile layers up is the boot-time proof
            # that /static answered; a positions threshold here would fail on a
            # working app, which is exactly what it did when the overview was
            # removed.
            chk(st2["borderRaster"] == 2,
                f"while /static still loaded normally ({st2['borderRaster']} border "
                f"tile layers) -- so the failure above is the BACKEND, not a dead page")
            await pg2.close()

            # ---- and the way it actually ships -------------------------------
            # Same static shell, no API base, nothing forced. This is the APK:
            # Capacitor serves the bundle and there is no backend anywhere.
            # The feeds run in the page, so it has to fill itself.
            print("\n== the shipped path: no backend of any kind ==")
            pg3, seen3 = await boot(ctx, f"http://127.0.0.1:{SHELL_PORT}/?terrain=off", 30)
            st3 = await pg3.evaluate(PROBE)
            src = await pg3.evaluate("()=>window.__graticule_data_source")
            chk(src == "device",
                f"with no API base the app runs its own feeds ({src!r})")

            hit3 = [u for u in seen3 if u.startswith(api)]
            chk(not hit3,
                f"and it reached no backend at all ({len(hit3)})")
            # The relay is the ONLY thing it may ask its own origin for. A
            # request for /api/config or /api/layer here would mean the device
            # path had quietly fallen back to wanting a backend.
            shell_api = {u.split("/api/", 1)[1].split("?")[0] for u in seen3
                         if u.startswith(f"http://127.0.0.1:{SHELL_PORT}/api/")}
            chk(shell_api <= {"proxy"},
                f"and the only origin path it used is the relay ({shell_api or 'none'})")

            chk(st3["alerts"] > 0,
                f"and it still counted live NWS alerts ({st3['alerts']}), which "
                f"is the same evidence the backend run used")

            counts = await pg3.evaluate(
                "()=>window.GraticuleFeeds ? window.GraticuleFeeds.counts() : {}")
            filled = {k: v for k, v in (counts or {}).items() if v}
            chk(len(filled) >= 4,
                f"and the feeds filled {len(filled)} layers on their own "
                f"({dict(sorted(filled.items(), key=lambda kv: -kv[1])[:5])})")

            # A 429 the scheduler is already holding off on is the rate limit
            # working, not a broken feed, and running these suites repeatedly
            # is what burns the allowance. Anything else is a real failure.
            failed = await pg3.evaluate("""()=>(window.GraticuleFeeds
              ? window.GraticuleFeeds.status() : [])
              .filter(f => f.lastError && !(f.heldUntil && f.lastError.indexOf('429') >= 0))
              .map(f => f.name + ': ' + f.lastError)""")
            held = await pg3.evaluate("""()=>(window.GraticuleFeeds
              ? window.GraticuleFeeds.status() : [])
              .filter(f => f.heldUntil).map(f => f.name)""")
            chk(not failed,
                f"with no feed reporting an error ({failed[:2] or 'none'}; "
                f"rate limited and backing off: {held or 'none'})")
            await pg3.close()

            await br.close()
    finally:
        srv.shutdown()

    print(f"\n{len(ok)} passed, {len(bad)} failed")
    for m in bad:
        print("  FAILED:", m)
    sys.exit(1 if bad else 0)


asyncio.run(main())
