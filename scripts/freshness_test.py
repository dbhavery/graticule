"""Does a reload actually run the code that is on disk?

For three sessions the answer was no, and nothing else in this repo could tell.
Every same-origin request went through the service worker's
stale-while-revalidate: serve the cached copy now, fetch the new one for next
time. So a reload ran the PREVIOUS build. Fixes shipped, the page was reloaded,
the old code ran, the defect was still on screen.

The server sends `Cache-Control: no-store` on /static/*, which makes the
problem look handled. It is not. **Cache Storage ignores HTTP cache headers** —
a service worker sits above the HTTP cache, so no header the server sends can
reach it.

This test installs the worker, changes a file on disk, reloads once, and asks
the page what it actually got. It restores the file whatever happens.

    py -V:3.13 scripts/freshness_test.py 8743
    py -V:3.13 scripts/freshness_test.py 8743 --selftest   # prove it can fail
"""

import argparse
import asyncio
import pathlib
import sys
import uuid

from playwright.async_api import async_playwright

HERE = pathlib.Path(__file__).resolve().parent
APP_JS = HERE.parent / "web" / "app.js"
SW_JS = HERE.parent / "web" / "sw.js"

# The control puts the OLD STRATEGY back, rather than faking its symptom. A
# first attempt just wrote a stale entry into Cache Storage by hand, and the
# test correctly refused to fail: code-first never reads that entry, so the fix
# made the injection unreachable. To prove a detector works you have to restore
# the defect, not an impression of it.
STALE_ROUTE = """  if (url.origin === self.location.origin && isCode(url)) {
    e.respondWith(codeFirst(req));
    return;
  }"""
STALE_ROUTE_OLD = """  if (url.origin === self.location.origin && isCode(url)) {
    e.respondWith(staleWhileRevalidate(req, SHELL, 120));
    return;
  }"""

results = []


def check(name, ok, detail=""):
    results.append((name, ok))
    print(f"  {'PASS' if ok else 'FAIL'}  {name}" + (f"   {detail}" if detail else ""),
          flush=True)


# Read through the service worker, not around it. A plain requests.get would
# talk to the server and always look fresh -- the whole defect lives between
# the server and the page.
READ_VIA_SW = """async (path) => {
  const res = await fetch(path, { cache: 'no-store' });
  return (await res.text()).length;
}"""

# Ask what the page EXECUTED, not what a later fetch returns.
#
# The first version of this probe re-fetched /static/app.js after load and
# compared the text. It passed even with stale-while-revalidate deliberately
# restored, because by the time it ran, the background revalidate had already
# replaced the cache entry -- so it measured the cache AFTER the fix it was
# supposed to catch, while the page was still running the old build. The token
# is a line of code now, and the only way to see it is for that code to have
# run.
FIND_TOKEN = """() => window.__graticule_freshness || null"""


async def run(port, selftest):
    url = f"http://127.0.0.1:{port}/"
    token = f"FRESHNESS_PROBE_{uuid.uuid4().hex[:12]}"
    original = APP_JS.read_text(encoding="utf-8")
    sw_original = SW_JS.read_text(encoding="utf-8")
    print(f"freshness test -> {url}"
          + ("   [SELFTEST: stale-while-revalidate restored]" if selftest else ""),
          flush=True)

    if selftest:
        if STALE_ROUTE not in sw_original:
            print("SELFTEST cannot run: the code-first route is not in sw.js "
                  "as written; update STALE_ROUTE.", flush=True)
            return 1
        SW_JS.write_text(sw_original.replace(STALE_ROUTE, STALE_ROUTE_OLD),
                         encoding="utf-8")

    try:
        async with async_playwright() as p:
            br = await p.chromium.launch(args=[
                "--use-gl=angle", "--use-angle=swiftshader",
                "--enable-unsafe-swiftshader", "--disable-dev-shm-usage"])
            # A persistent-ish context: the worker has to survive the reload,
            # exactly as it does in a real browser that has opened the app once.
            ctx = await br.new_context(viewport={"width": 1100, "height": 760})
            pg = await ctx.new_page()

            await pg.goto(url, wait_until="load")
            await pg.wait_for_function(
                "() => navigator.serviceWorker && navigator.serviceWorker.controller",
                timeout=60_000)
            check("service worker takes control on first load", True)

            # The deploy: change what is on disk, nothing else.
            APP_JS.write_text(
                original + f"\nwindow.__graticule_freshness = '{token}';\n",
                encoding="utf-8")
            await asyncio.sleep(1.0)

            await pg.reload(wait_until="load")
            await pg.wait_for_function(
                "() => navigator.serviceWorker && navigator.serviceWorker.controller",
                timeout=60_000)
            await asyncio.sleep(1.5)

            ran = await pg.evaluate(FIND_TOKEN)
            fresh = ran == token
            check("one reload RUNS the code that is on disk", fresh,
                  f"page executed {ran!r}, disk has {token!r} -- the page is "
                  f"running a build the server already replaced"
                  if not fresh else "")

            size = await pg.evaluate(READ_VIA_SW, "/static/app.js")
            check("app.js is a real file through the worker, not a stub",
                  size > 100_000, f"{size} bytes")

            # Offline still has to work, or the cure is worse than the disease.
            await ctx.set_offline(True)
            offline_ok = await pg.evaluate("""async () => {
              try {
                const r = await fetch('/static/app.js');
                return r.ok && (await r.text()).length > 100000;
              } catch { return false; }
            }""")
            check("with the network gone, cached code is still served", offline_ok)
            await ctx.set_offline(False)

            await br.close()
    finally:
        APP_JS.write_text(original, encoding="utf-8")
        SW_JS.write_text(sw_original, encoding="utf-8")
        print("  (app.js and sw.js restored)", flush=True)

    passed = sum(1 for _, ok in results if ok)
    failed = len(results) - passed
    print(f"\n{'=' * 58}\n{passed} passed, {failed} failed", flush=True)

    if selftest:
        stale = [n for n, ok in results
                 if n.startswith("one reload RUNS") and not ok]
        if stale:
            print("SELFTEST OK: a stale cached build was detected.", flush=True)
            return 0
        print("SELFTEST FAILED: a deliberately stale build was reported as "
              "fresh. This test cannot see the defect it exists for.", flush=True)
        return 1
    return 1 if failed else 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("port", nargs="?", default="8743")
    ap.add_argument("--selftest", action="store_true")
    a = ap.parse_args()
    sys.exit(asyncio.run(run(a.port, a.selftest)))


if __name__ == "__main__":
    main()
