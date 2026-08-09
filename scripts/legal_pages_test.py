"""The two pages a store listing has to link, and the claims they make.

Google Play will not accept a listing without a privacy policy URL and a
support URL, and both are checked once by a reviewer and then quoted at users
forever. So the first half of this is boring and necessary: do the routes
resolve, do they render, do they cross-link, is there a contact address.

The second half is the part worth having. A privacy policy is a set of factual
claims about a program, and a claim nobody rechecks rots the moment the program
changes. Two of Graticule's claims are machine-checkable against the source, so
they are checked here rather than believed:

  * "no analytics, no crash reporting, no tracking SDK"  ->  grep the shipped
    bundle for every such host and SDK name.
  * "four keys, on your device only"  ->  the four keys named in the policy
    must be EXACTLY the localStorage keys app.js uses. Add a fifth key to the
    app and this test fails, because at that moment the policy became false.

  * "this page contacts no third party"  ->  load it and watch every request.

That last one carries the control. A detector that reports "0 external
requests" is indistinguishable from a detector that is broken, so the same
detector is pointed at the app itself, which is known to load Cesium and
fonts from CDNs. If the app also reads 0, nothing above means anything.

    py -V:3.13 scripts/legal_pages_test.py [backend_port]
"""
from __future__ import annotations

import asyncio
import pathlib
import re
import sys

from playwright.async_api import async_playwright

PORT = sys.argv[1] if len(sys.argv) > 1 else "8744"
BASE = f"http://127.0.0.1:{PORT}"
ROOT = pathlib.Path(__file__).resolve().parent.parent
WEB = ROOT / "web"

ok: list[str] = []
bad: list[str] = []


def chk(cond: bool, msg: str) -> None:
    (ok if cond else bad).append(msg)
    print(("  PASS  " if cond else "  FAIL  ") + msg)


# Hosts and SDK names that would make "no analytics, no tracking" false.
TRACKERS = [
    "google-analytics", "googletagmanager", "gtag(", "mixpanel", "segment.io",
    "sentry.io", "@sentry", "posthog", "amplitude", "firebase", "crashlytics",
    "bugsnag", "datadoghq", "fullstory", "hotjar", "doubleclick",
    "facebook.net", "appsflyer", "adjust.com", "branch.io",
]

# An em dash is banned in anything published under Don's name.
EM = "—"


def em_dashes(text: str) -> int:
    return text.count(EM) + text.lower().count("&mdash;")


def storage_keys(js: str) -> set[str]:
    """Every localStorage key app.js actually touches."""
    return set(re.findall(r"localStorage\.(?:get|set|remove)Item\(\s*'([^']+)'", js))


def external(urls: list[str]) -> list[str]:
    out = []
    for u in urls:
        if u.startswith(BASE) or u.startswith("data:") or u.startswith("blob:"):
            continue
        if u.startswith("about:"):
            continue
        out.append(u)
    return out


async def load(ctx, path: str, wait_ms: int = 1500):
    """Open a page and return it with every URL it requested."""
    pg = await ctx.new_page()
    seen: list[str] = []
    pg.on("request", lambda r: seen.append(r.url))
    await pg.goto(BASE + path, wait_until="load", timeout=30_000)
    await asyncio.sleep(wait_ms / 1000)
    return pg, seen


async def main() -> None:
    priv = (WEB / "privacy.html").read_text(encoding="utf-8")
    supp = (WEB / "support.html").read_text(encoding="utf-8")
    app_js = (WEB / "app.js").read_text(encoding="utf-8")

    async with async_playwright() as p:
        br = await p.chromium.launch(args=[
            "--use-gl=angle", "--use-angle=swiftshader",
            "--enable-unsafe-swiftshader", "--disable-dev-shm-usage",
        ])
        ctx = await br.new_context(viewport={"width": 412, "height": 915},
                                   is_mobile=True, has_touch=True)

        # ---- routes ----------------------------------------------------------
        print("\n== the URLs a store console will be given ==")
        for path in ("/privacy", "/privacy.html", "/support", "/support.html"):
            r = await ctx.request.get(BASE + path)
            ctype = r.headers.get("content-type", "")
            chk(r.status == 200 and "text/html" in ctype,
                f"{path} -> {r.status} {ctype.split(';')[0] or 'no type'}")

        # ---- they render -----------------------------------------------------
        print("\n== they render on a phone ==")
        for path, title in (("/privacy", "Privacy"), ("/support", "Support")):
            pg, seen = await load(ctx, path)
            box = await pg.evaluate(
                "()=>({t:document.title,h:document.body.scrollHeight,"
                "sw:document.documentElement.scrollWidth,"
                "cw:document.documentElement.clientWidth,"
                "txt:document.body.innerText.length})")
            chk(title.lower() in box["t"].lower(), f"{path} titled {box['t']!r}")
            chk(box["txt"] > 1200, f"{path} rendered {box['txt']} characters of text")
            # A legal page that scrolls sideways on a phone is a legal page
            # nobody reads. 412px is the device this ships to.
            chk(box["sw"] <= box["cw"] + 1,
                f"{path} has no horizontal overflow at 412px "
                f"({box['sw']} <= {box['cw']})")

            ext = external(seen)
            chk(not ext, f"{path} contacted nothing off this origin "
                         f"({len(ext)} external{': ' + ext[0] if ext else ''})")
            await pg.close()

        # ---- the control -----------------------------------------------------
        # The two checks above are the ones the policy's own text depends on,
        # and both are "we saw zero". Point the identical detector at the app,
        # which loads Cesium, satellite.js and Google Fonts from CDNs. If this
        # reads zero too, the detector is broken and this whole file is theatre.
        print("\n== the control: the same detector, pointed at the app ==")
        pg, seen = await load(ctx, "/?terrain=off", wait_ms=6000)
        ext = external(seen)
        hosts = sorted({u.split("/")[2] for u in ext})
        chk(len(ext) > 0,
            f"the app DOES reach {len(ext)} external requests across "
            f"{len(hosts)} hosts, so a zero above is a real zero")
        chk(any("cesium" in h for h in hosts),
            f"and one of them is the Cesium CDN ({', '.join(hosts[:4])})")

        # ---- the links inside the app ---------------------------------------
        # A policy reachable only from a store listing is a policy a user cannot
        # find. Settings > About carries both, and app.js rewrites the hrefs at
        # runtime because the APK serves this page from a different origin than
        # the backend. Resolved hrefs, then fetched, because an anchor that
        # exists and 404s looks identical in the DOM.
        print("\n== Settings > About ==")
        links = await pg.evaluate(
            "()=>['link-privacy','link-support'].map(id=>{"
            "const a=document.getElementById(id);"
            "return a?{id,href:a.href,text:a.textContent.trim(),"
            "blank:a.target==='_blank',rel:a.rel}:null;})")
        for got in links:
            chk(got is not None, "the About link exists")
            if not got:
                continue
            chk(got["href"].startswith(BASE),
                f"{got['id']} resolved to {got['href']}")
            chk(got["blank"] and "noopener" in got["rel"],
                f"{got['id']} opens out of the app safely (rel={got['rel']!r})")
            r = await ctx.request.get(got["href"])
            chk(r.status == 200, f"{got['id']} -> {r.status}")

        warn = await pg.evaluate(
            "()=>{const e=document.querySelector('.sm-about-warn');"
            "return e?e.textContent.trim():'';}")
        chk("official source of warnings" in warn.lower(),
            f"About states it is not an official warning source ({len(warn)} chars)")
        await pg.close()

        await br.close()

    # ---- claims that must stay true of the code --------------------------
    print("\n== the policy's claims, checked against the source ==")

    named = set(re.findall(r"<code>(graticule\.[a-z0-9.]+)</code>", priv))
    actual = storage_keys(app_js)
    chk(named == actual,
        f"the policy names exactly the localStorage keys app.js uses "
        f"({len(named)}); missing from policy: {sorted(actual - named) or 'none'}; "
        f"named but unused: {sorted(named - actual) or 'none'}")

    hits = [t for t in TRACKERS if t in app_js.lower()]
    chk(not hits, f"no analytics or crash-reporting SDK in app.js ({hits or 'none'})")

    idx = (WEB / "index.html").read_text(encoding="utf-8").lower()
    hits2 = [t for t in TRACKERS if t in idx]
    chk(not hits2, f"nor in index.html ({hits2 or 'none'})")

    # The policy says location never leaves the device. The socket being
    # receive-only is half of why that is true, so it is checked, not assumed.
    sends = re.findall(r"\bws\w*\.send\(|\bsocket\.send\(", app_js)
    chk(not sends, f"the live socket is still receive-only ({len(sends)} sends)")

    chk("dbhavery@gmail.com" in priv and "dbhavery@gmail.com" in supp,
        "both pages carry a contact address")
    chk('href="/support"' in priv and 'href="/privacy"' in supp,
        "the two pages link to each other")
    chk("/privacy" in supp and "privacy" in supp.lower(),
        "support points at the privacy policy")
    chk("weather.gov" in supp,
        "support names the authority for an actual warning")

    print("\n== house style ==")
    chk(em_dashes(priv) == 0, f"privacy.html has no em dash ({em_dashes(priv)})")
    chk(em_dashes(supp) == 0, f"support.html has no em dash ({em_dashes(supp)})")
    # ...and prove that detector can fail, because "0 found" from a broken
    # counter looks exactly like "0 found" from a clean file.
    chk(em_dashes(f"a {EM} b") == 1 and em_dashes("a &mdash; b") == 1,
        "and the em-dash detector finds one when one is there")

    print(f"\n{len(ok)} passed, {len(bad)} failed")
    for m in bad:
        print("  FAILED:", m)
    sys.exit(1 if bad else 0)


asyncio.run(main())
