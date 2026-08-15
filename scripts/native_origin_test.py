"""The app, served from an origin that is not the backend.

This is the whole native story in one test. Capacitor hands the WebView the
page from `https://localhost` and the backend lives somewhere else, so every
`/api/...` and the WebSocket are cross-origin. Nothing in the existing suites
could see a break there, because all of them load the page FROM the backend and
same-origin hides the entire class of failure.

So this stands up a second server that serves only the static bundle -- no API,
no /ws, nothing -- which is exactly what the APK's asset server is, and points
the app at the real backend with `?api=`.

Both directions are checked, and the second one is the point:

  * WITH ?api=  the app must reach the backend, open the socket and take data.
  * WITHOUT it  it must fail. If it succeeds, the static server is secretly
    proxying something and this test proves nothing at all.

    py -V:3.13 scripts/native_origin_test.py [backend_port]
"""
from __future__ import annotations

import asyncio
import functools
import http.server
import pathlib
import sys
import threading

from playwright.async_api import async_playwright

BACKEND = sys.argv[1] if len(sys.argv) > 1 else "8744"
SHELL_PORT = 8751
WEB = pathlib.Path(__file__).resolve().parent.parent / "web"

ok: list[str] = []
bad: list[str] = []


def chk(cond: bool, msg: str) -> None:
    (ok if cond else bad).append(msg)
    print(("  PASS  " if cond else "  FAIL  ") + msg)


class ShellHandler(http.server.SimpleHTTPRequestHandler):
    """Serves web/ the way the APK does, and serves NOTHING else.

    Two rules matter: `/` is index.html and `/static/x` is web/x. There is
    deliberately no /api and no /ws, so a request that lands here 404s rather
    than quietly working and making the test meaningless.
    """

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
            # Same page, same static server, no ?api=. If this ALSO reaches a
            # backend then the shell server is proxying and every check above is
            # measuring nothing.
            print("\n== the control: same page, no API base ==")
            pg2, seen2 = await boot(ctx, f"http://127.0.0.1:{SHELL_PORT}/?terrain=off", 16)
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
            chk(st2["borderPositions"] >= 300000,
                f"while /static still loaded normally ({st2['borderPositions']:,} border "
                f"positions) -- so the failure above is the BACKEND, not a dead page")
            await pg2.close()

            await br.close()
    finally:
        srv.shutdown()

    print(f"\n{len(ok)} passed, {len(bad)} failed")
    for m in bad:
        print("  FAILED:", m)
    sys.exit(1 if bad else 0)


asyncio.run(main())
