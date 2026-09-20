"""Build the public static site: the two pages the Play listing has to name.

Google Play requires a privacy policy URL and a support URL, and both have to
resolve for as long as the listing exists. Serving them from the app's backend
would tie a compliance requirement to a running process: if the backend is
down or moves host, the listing's URLs 404, which is a listing problem and not
just an outage.

So they go on static hosting instead, which costs nothing and has nothing to
fall over. The files are COPIED FROM `web/` rather than written again here,
because `legal_pages_test.py` asserts the policy's claims against the source
and a second hand-maintained copy would drift away from the thing that is
tested.

    py -V:3.13 scripts/build_site.py
    cd site-dist && vercel deploy --prod --yes

The landing page exists because both legal pages link to `/`, and a root that
404s on a page Google is about to crawl is a bad look for no reason.
"""
from __future__ import annotations

import json
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "web"
OUT = ROOT / "site-dist"

# Staged at the app root rather than under /static, because a service worker
# can only control the scope it is served from. Same list as android_build.py.
ROOT_FILES = ["index.html", "sw.js", "manifest.webmanifest",
              "offline.html", "favicon.ico"]

BG = "#0b0e13"
INK = "#e9f0f7"
DIM = "#a8b3c2"
ACCENT = "#5cd6ff"

INDEX = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Graticule</title>
<meta name="description" content="Live weather, sky and sea on a 3D globe.">
<link rel="icon" href="/favicon.ico">
<style>
  :root {{ color-scheme: dark; }}
  * {{ box-sizing: border-box; }}
  body {{
    margin: 0; min-height: 100vh; background: {BG}; color: {INK};
    font: 16px/1.6 "Segoe UI", system-ui, -apple-system, sans-serif;
    display: flex; align-items: center; justify-content: center; padding: 24px;
  }}
  main {{ max-width: 34rem; }}
  .mark {{ width: 96px; height: 96px; margin-bottom: 28px; display: block; }}
  h1 {{ font-size: 2rem; margin: 0 0 4px; letter-spacing: .01em; }}
  .rule {{ width: 64px; height: 3px; background: {ACCENT}; margin: 0 0 22px; }}
  p {{ color: {DIM}; margin: 0 0 18px; }}
  ul {{ color: {DIM}; padding-left: 1.1rem; margin: 0 0 22px; }}
  li {{ margin-bottom: 6px; }}
  nav {{ margin-top: 28px; display: flex; gap: 20px; flex-wrap: wrap; }}
  a {{ color: {ACCENT}; text-decoration: none; }}
  a:hover {{ text-decoration: underline; }}
  footer {{ margin-top: 36px; color: #6b7787; font-size: .85rem; }}
</style>
</head>
<body>
<main>
  <img class="mark" src="/icon.png" alt="">
  <div class="rule"></div>
  <h1>Graticule</h1>
  <p>Live weather, sky and sea on a 3D globe. Radar, storm warnings, aircraft,
     ships, earthquakes, wildfires and more, drawn on a real globe you can spin
     and zoom.</p>
  <ul>
    <li>National radar with a 30 minute nowcast</li>
    <li>Active weather warnings, tropical storms and earthquakes</li>
    <li>Aircraft and vessel positions from open feeds</li>
    <li>Thirty eight layers you switch on and off</li>
  </ul>
  <p>Your location never leaves your device. The
     <a href="/privacy">privacy policy</a> says exactly what that means and
     what is and is not collected.</p>
  <nav>
    <a href="/privacy">Privacy Policy</a>
    <a href="/support">Support</a>
    <a href="mailto:dbhavery@gmail.com">dbhavery@gmail.com</a>
  </nav>
  <footer>Donald B. Havery</footer>
</main>
</body>
</html>
"""

# cleanUrls so /privacy serves privacy.html, which is what both pages link to
# and what the Play listing will name. Without it every link on these two pages
# is broken on the static host and works on the backend, which is the worst
# kind of difference.
VERCEL = {
    "cleanUrls": True,
    "trailingSlash": False,
    # index.html is byte-identical between the web, native and desktop builds,
    # and that is a property worth keeping: it is why a bug can never be "it
    # works on the web but not in the app" for a reason hidden in two copies
    # of the page. It asks for `/static/...` and `/sw.js` at the ROOT, so
    # serving the app from a subdirectory needs the host to map those back,
    # rather than the page to be rewritten for one deployment.
    "rewrites": [
        {"source": "/static/(.*)", "destination": "/app/static/$1"},
        {"source": "/sw.js", "destination": "/app/sw.js"},
        {"source": "/manifest.webmanifest", "destination": "/app/manifest.webmanifest"},
        {"source": "/offline.html", "destination": "/app/offline.html"},
    ],
    "headers": [{
        "source": "/(.*)",
        "headers": [
            {"key": "X-Content-Type-Options", "value": "nosniff"},
            {"key": "Referrer-Policy", "value": "no-referrer"},
        ],
    }],
}


def main() -> None:
    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir(parents=True)

    copied = []
    for name in ("privacy.html", "support.html"):
        src = WEB / name
        if not src.exists():
            raise SystemExit(f"missing {src}; the site cannot ship without it")
        shutil.copy2(src, OUT / name)
        copied.append(name)

    shutil.copy2(WEB / "favicon.ico", OUT / "favicon.ico")
    shutil.copy2(WEB / "icons" / "icon-192.png", OUT / "icon.png")
    (OUT / "index.html").write_text(INDEX, encoding="utf-8", newline="\n")
    (OUT / "vercel.json").write_text(json.dumps(VERCEL, indent=2) + "\n",
                                     encoding="utf-8", newline="\n")

    # ---- the app itself -----------------------------------------------------
    #
    # This site used to be two legal pages, because the app needed a long-lived
    # backend and static hosting cannot run one. It does not need one any more:
    # the feeds run in the page, so the whole app is static files plus one
    # stateless relay for the providers that refuse a browser.
    #
    # `/app` rather than `/`, because the root is the page Google crawls for
    # the listing and a 3D globe is not what belongs there.
    app = OUT / "app"
    shutil.copytree(WEB, app / "static", dirs_exist_ok=True)
    for name in ROOT_FILES:
        src = WEB / name
        if not src.exists():
            raise SystemExit(f"missing {src} -- the app shell would 404 on /{name}")
        shutil.copy2(src, app / name)

    # The one server-side file left. Vercel routes api/<name>.js to /api/<name>
    # from the deployment root, so it goes at the top rather than under /app.
    fn = OUT / "api"
    fn.mkdir()
    shutil.copy2(ROOT / "api" / "proxy.js", fn / "proxy.js")

    # The web build talks to its own origin for the relay, so the app's copy of
    # api-config.js must stay EMPTY. Writing a base here would send the page
    # looking for a backend that no longer exists.
    (app / "static" / "api-config.js").write_text(
        "/* GENERATED by scripts/build_site.py -- do not edit.\n"
        " * Empty on purpose: the feeds run in the page and the only\n"
        " * server-side thing left is /api/proxy, which is same origin. */\n"
        'window.GRATICULE_API_BASE = "";\n',
        encoding="utf-8", newline="\n")

    # The links these pages make to each other are the whole point of the
    # site, so check them here rather than discovering a 404 after the listing
    # names the URL.
    wanted = {"/privacy": "privacy.html", "/support": "support.html",
              "/": "index.html"}
    for page in [*copied, "index.html"]:
        text = (OUT / page).read_text(encoding="utf-8")
        for link, target in wanted.items():
            if f'href="{link}"' in text and not (OUT / target).exists():
                raise SystemExit(f"{page} links to {link} but {target} is missing")

    n = sum(1 for f in OUT.rglob("*") if f.is_file())
    mb = sum(f.stat().st_size for f in OUT.rglob("*") if f.is_file()) / 1_048_576
    for p in sorted(OUT.iterdir()):
        if p.is_dir():
            sub = sum(1 for f in p.rglob("*") if f.is_file())
            print(f"  {p.name + '/':<16} {sub:>8,} files")
        else:
            print(f"  {p.name:<16} {p.stat().st_size:>8,} bytes")
    print(f"\n  {n:,} files, {mb:.1f} MB")
    print(f"\nsite -> {OUT}")
    print("deploy:  cd site-dist && vercel deploy --prod --yes")
    print("  /           the listing page Google crawls")
    print("  /privacy    and /support, the two URLs Play requires")
    print("  /app        the whole application, with no backend")
    print("  /api/proxy  one stateless relay, allowlisted")


if __name__ == "__main__":
    main()
