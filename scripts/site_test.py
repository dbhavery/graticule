"""The built site, served the way Vercel serves it, with the app in it.

site-dist used to be two legal pages, because the app needed a long-lived
backend and static hosting cannot run one. It does not need one now, so the
whole application ships here too: static files, plus one stateless relay for
the providers that refuse a browser.

That is a claim about a deployment, and the way it fails is a path. index.html
is byte-identical across the web, native and desktop builds on purpose, so it
asks for `/static/...` at the ROOT while the app is staged under `/app`. The
mapping lives in vercel.json, which means nothing in the repo runs it and a
typo there is invisible until the deploy is live.

So this reads vercel.json and serves site-dist THROUGH it -- the same
rewrites, the same cleanUrls -- then boots the app from that server and checks
it filled itself. `/api/proxy` is forwarded to a running backend, standing in
for the serverless function, which is the one piece a static server cannot be.

    py -V:3.13 scripts/site_test.py [backend_port]

Run scripts/build_site.py first.
"""
from __future__ import annotations

import asyncio
import functools
import http.server
import json
import pathlib
import re
import sys
import threading
import urllib.error
import urllib.request

from playwright.async_api import async_playwright

BACKEND = sys.argv[1] if len(sys.argv) > 1 else "8731"
PORT = 8767
ROOT = pathlib.Path(__file__).resolve().parent.parent
SITE = ROOT / "site-dist"

ok: list[str] = []
bad: list[str] = []


def chk(cond: bool, msg: str) -> None:
    (ok if cond else bad).append(msg)
    print(("  PASS  " if cond else "  FAIL  ") + msg)


def load_rules() -> tuple[list[tuple[re.Pattern, str]], bool]:
    cfg = json.loads((SITE / "vercel.json").read_text(encoding="utf-8"))
    rules = []
    for r in cfg.get("rewrites", []):
        # Vercel's ":path*" and "(.*)" both mean "the rest"; only the second
        # is used here, so the translation is one substitution.
        pat = "^" + r["source"].replace("(.*)", "(?P<rest>.*)") + "$"
        rules.append((re.compile(pat), r["destination"]))
    return rules, bool(cfg.get("cleanUrls"))


RULES, CLEAN = load_rules()


class SiteHandler(http.server.SimpleHTTPRequestHandler):
    """site-dist, with vercel.json's rewrites applied before the filesystem."""

    def do_GET(self) -> None:                                # noqa: N802
        path = self.path.split("?", 1)[0]
        if path.startswith("/api/proxy"):
            self.relay()
            return
        for pat, dest in RULES:
            m = pat.match(path)
            if m:
                self.path = dest.replace("$1", m.groupdict().get("rest", ""))
                break
        else:
            if CLEAN and not pathlib.Path(path).suffix and path != "/":
                if (SITE / (path.lstrip("/") + ".html")).exists():
                    self.path = path + ".html"
        super().do_GET()

    def relay(self) -> None:
        url = f"http://127.0.0.1:{BACKEND}{self.path}"
        try:
            with urllib.request.urlopen(url, timeout=120) as r:
                body, ct, code = r.read(), r.headers.get("content-type",
                                                         "application/json"), r.status
        except urllib.error.HTTPError as e:
            body, ct, code = e.read(), "application/json", e.code
        except Exception as e:                               # noqa: BLE001
            body, ct, code = f'{{"error":"{type(e).__name__}"}}'.encode(), \
                "application/json", 502
        self.send_response(code)
        self.send_header("content-type", ct)
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *a) -> None:  # noqa: D102 - quiet
        pass


async def main() -> None:
    if not (SITE / "vercel.json").exists():
        raise SystemExit("site-dist is not built. Run scripts/build_site.py")

    srv = http.server.ThreadingHTTPServer(
        ("127.0.0.1", PORT), functools.partial(SiteHandler, directory=str(SITE)))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{PORT}"
    print(f"site-dist on {base}, {len(RULES)} rewrites from vercel.json\n")

    try:
        print("=== the URLs the Play listing names ===")
        for path, must in (("/", "Graticule"), ("/privacy", "Privacy"),
                           ("/support", "Support")):
            try:
                with urllib.request.urlopen(base + path, timeout=30) as r:
                    text = r.read().decode("utf-8", "replace")
                    good = r.status == 200 and must.lower() in text.lower()
            except Exception as e:                           # noqa: BLE001
                good, text = False, str(e)
            chk(good, f"{path} resolves and says {must!r}")

        print("\n=== the app, from the same static bundle ===")
        async with async_playwright() as p:
            br = await p.chromium.launch(args=[
                "--use-gl=angle", "--use-angle=swiftshader",
                "--enable-unsafe-swiftshader", "--disable-dev-shm-usage"])
            ctx = await br.new_context(viewport={"width": 412, "height": 915},
                                       is_mobile=True, has_touch=True,
                                       service_workers="block")
            pg = await ctx.new_page()
            bad_status: list[str] = []
            pg.on("response", lambda r: bad_status.append(
                f"{r.status} {r.url[:90]}")
                if r.status >= 400 and r.url.startswith(base) else None)

            await pg.goto(base + "/app", wait_until="load", timeout=120_000)
            await pg.wait_for_function(
                "()=>window.__graticule_viewer && window.__graticule_viewer.scene",
                timeout=120_000)
            await asyncio.sleep(30)

            # The relay forwards whatever the provider said, so a 429 or a 502
            # on /api/proxy is an upstream answer and not a broken deployment.
            # Everything else -- a missing file, a rewrite that does not fire
            # -- is this bundle's problem and is what this check is for.
            served = [s for s in bad_status if "/api/proxy" not in s]
            upstream = [s for s in bad_status if "/api/proxy" in s]
            chk(not served,
                f"every file the page asked this host for was served "
                f"({served[:3] or 'no 4xx or 5xx'}; "
                f"{len(upstream)} upstream errors through the relay)")

            src = await pg.evaluate("()=>window.__graticule_data_source")
            chk(src == "device", f"it runs its own feeds ({src!r})")

            engine = await pg.evaluate("()=>typeof window.Cesium")
            chk(engine == "object",
                f"the engine loaded through the rewrite ({engine!r})")

            counts = await pg.evaluate(
                "()=>window.GraticuleFeeds ? window.GraticuleFeeds.counts() : {}")
            filled = {k: v for k, v in (counts or {}).items() if v}
            chk(len(filled) >= 4,
                f"and {len(filled)} layers filled from a static host "
                f"({dict(sorted(filled.items(), key=lambda kv: -kv[1])[:5])})")

            # A 429 that the scheduler is already holding off on is not a
            # broken feed, it is the rate limit working, and running this
            # suite repeatedly is what burns the allowance. Anything else is
            # a real failure.
            failed = await pg.evaluate("""()=>(window.GraticuleFeeds
              ? window.GraticuleFeeds.status() : [])
              .filter(f => f.lastError && !(f.heldUntil && f.lastError.indexOf('429') >= 0))
              .map(f => f.name + ': ' + f.lastError)""")
            held = await pg.evaluate("""()=>(window.GraticuleFeeds
              ? window.GraticuleFeeds.status() : [])
              .filter(f => f.heldUntil).map(f => f.name)""")
            chk(not failed,
                f"with no feed reporting an error "
                f"({failed[:2] or 'none'}; rate limited and backing off: "
                f"{held or 'none'})")

            # CONTROL: the rewrite is what makes /static resolve. Ask for a
            # path it does not cover and the server has to 404, or this is
            # measuring a directory listing rather than a mapping.
            with_bad = base + "/static/definitely-not-here.js"
            try:
                urllib.request.urlopen(with_bad, timeout=20)
                got = 200
            except urllib.error.HTTPError as e:
                got = e.code
            chk(got == 404,
                f"CONTROL: a path the rewrite cannot satisfy 404s ({got})")

            await br.close()
    finally:
        srv.shutdown()

    print(f"\n{len(ok)} passed, {len(bad)} failed")
    for m in bad:
        print("  FAILED:", m)
    sys.exit(1 if bad else 0)


asyncio.run(main())
