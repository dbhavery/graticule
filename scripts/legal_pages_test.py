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
  * "eight keys, on your device only"  ->  the keys named in the policy must be
    EXACTLY the localStorage keys app.js uses. Add one to the app and this test
    fails, because at that moment the policy became false. It resolves module
    CONSTANTS as well as string literals, which it did not until 2026-09-19:
    three keys had been live and undeclared for months behind that gap.

  * "this page contacts no third party"  ->  load it and watch every request.

  * attribution is displayed  ->  read the rendered credit strip, not the
    source. A count of `onScreenCredit(` call sites in app.js passed while the
    strip held nothing but Cesium's logo and a link to their pricing page,
    because the branch holding those call sites was not the branch that ran.

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
    """Every localStorage key app.js actually touches.

    THIS USED TO MATCH ONLY STRING LITERALS, and a key written through a
    constant was invisible to it. Three keys had been live and undeclared for
    months behind that blind spot -- graticule.presets.v1 (saved camera
    positions), graticule.scenes.v1 (scene decks) and the units-flip flag --
    because each is referenced as `localStorage.setItem(PRESETS_KEY, ...)`.

    The check reported "the policy names exactly the keys app.js uses" the
    whole time. It was comparing the policy against a list that could not grow
    the way this codebase actually adds keys, so a passing result meant
    nothing. Resolve the constants too.
    """
    keys = set(re.findall(
        r"localStorage\.(?:get|set|remove)Item\(\s*'([^']+)'", js))
    for name, value in re.findall(
            r"const\s+([A-Z_][A-Z0-9_]*)\s*=\s*'(graticule\.[^']+)'", js):
        if re.search(r"localStorage\.(?:get|set|remove)Item\(\s*"
                     + name + r"\b", js):
            keys.add(value)
    return keys


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
        # which reaches the data providers directly. If this reads zero too,
        # the detector is broken and this whole file is theatre.
        #
        # THIS USED TO ASSERT IT SAW THE CESIUM CDN. It did, for as long as
        # index.html loaded the engine from cesium.com, and then it stopped:
        # the engine is vendored into the APK now, so the app contacts that
        # host zero times. The old assertion failing was the change working.
        # It is replaced with the providers the app genuinely does reach, which
        # are the ones the policy names.
        print("\n== the control: the same detector, pointed at the app ==")
        pg, seen = await load(ctx, "/?terrain=off", wait_ms=6000)
        ext = external(seen)
        hosts = sorted({u.split("/")[2] for u in ext})
        chk(len(ext) > 0,
            f"the app DOES reach {len(ext)} external requests across "
            f"{len(hosts)} hosts, so a zero above is a real zero")
        # Any one of these is enough; which of them answers first is a race.
        providers = ("weather.gov", "usgs.gov", "rainviewer.com", "nasa.gov",
                     "arcgisonline.com", "openstreetmap.org", "gstatic.com")
        chk(any(any(p in h for p in providers) for h in hosts),
            f"and they are data providers, which is what the policy names "
            f"({', '.join(hosts[:4])})")
        chk(not any("cesium.com" in h for h in hosts),
            f"and the engine is NOT among them any more ({', '.join(hosts)})")

        # ---- attribution, read off the SCREEN --------------------------------
        #
        # static_checks.py counts `onScreenCredit(` call sites in app.js. That
        # count has never dropped and it proved nothing: measured 2026-09-19,
        # the on-screen strip in a default session contained Cesium's logo and
        # a link to their pricing page, and no data attribution whatsoever.
        #
        # The satellite base prefers Cesium ion when a token is configured, and
        # one is. That branch returns ion asset 2, which is Bing Maps Aerial
        # and carries a credit ion built, not marked for the screen. The app's
        # own `onScreenCredit('Tiles (c) Esri')` sits in the branch that never
        # executes. A COUNT OF CALL SITES CANNOT SEE THAT THE CALL SITE DOES
        # NOT RUN. Issue 66 all over again, one level down.
        #
        # So this reads the rendered strip. Cesium separates its logo
        # container from the text container; the text container is the row a
        # person actually reads.
        # ---- the policy's host list against the hosts it actually reaches --
        #
        # The policy used to say the app "routes almost all of its weather data
        # through a single backend ... so those agencies never see your device
        # at all". That was true until the feeds moved into the app, and then
        # it was the opposite of true, with nothing able to notice: the claim
        # is about which hosts a running app contacts, and every check here
        # read the policy's own text.
        #
        # So this reads the running app. Every third-party host it reaches has
        # to be one the policy accounts for. The match is on the registrable
        # part, because the policy names organisations and the app reaches
        # api.weather.gov, and a policy written at hostname precision would be
        # unreadable and would churn on every subdomain.
        print("\n== the policy accounts for the hosts the app really reaches ==")

        # Hostname -> the words the policy uses for whoever owns it. Written
        # down rather than matched fuzzily, because the two do not resemble
        # each other often enough: the policy says "Google Fonts" and the
        # request goes to fonts.gstatic.com, it says "Esri ArcGIS" and the
        # request goes to server.arcgisonline.com.
        #
        # This makes the check bite from both ends. A host with no entry is a
        # third party nobody wrote down, and an entry whose words are missing
        # from the policy is a party quietly dropped from the table.
        HOST_PARTY = {
            "api.weather.gov": "national weather service",
            "earthquake.usgs.gov": "usgs",
            "www.nhc.noaa.gov": "national hurricane center",
            "services.swpc.noaa.gov": "swpc",
            "api.tidesandcurrents.noaa.gov": "co-ops",
            "api.water.noaa.gov": "nwps",
            "www.ndbc.noaa.gov": "ndbc",
            "aviationweather.gov": "aviation weather center",
            "mesonet.agron.iastate.edu": "iowa state mesonet",
            "www.spc.noaa.gov": "national weather service",
            "www.spotternetwork.org": "spotter network",
            "eonet.gsfc.nasa.gov": "nasa eonet",
            "firms.modaps.eosdis.nasa.gov": "nasa firms",
            "gibs.earthdata.nasa.gov": "nasa gibs",
            "webservices.volcano.si.edu": "smithsonian gvp",
            "tfr.faa.gov": "faa",
            "opendata.adsb.fi": "adsb.fi",
            "api.airplanes.live": "airplanes.live",
            "api.adsb.lol": "adsb.lol",
            "meri.digitraffic.fi": "digitraffic",
            "celestrak.org": "celestrak",
            "ll.thespacedevs.com": "the space devs",
            "api.open-meteo.com": "open-meteo",
            "api.rainviewer.com": "rainviewer",
            "tilecache.rainviewer.com": "rainviewer",
            "server.arcgisonline.com": "esri arcgis",
            "www.submarinecablemap.com": "telegeography",
            "davidmegginson.github.io": "github",
            "flagcdn.com": "flagcdn",
            "fonts.googleapis.com": "google fonts",
            "fonts.gstatic.com": "google fonts",
            "cameras.alertcalifornia.org": "alertcalifornia",
            "cwwp2.dot.ca.gov": "caltrans",
            "webcams.nyctmc.org": "nyc dot",
        }

        priv_html = (WEB / "privacy.html").read_text(encoding="utf-8")
        low = re.sub(r"<[^>]+>", " ", priv_html).lower()
        low = re.sub(r"\s+", " ", low)

        # Everything the app talked to during the control load above.
        reached = sorted({u.split("/")[2] for u in ext})
        unmapped = [h for h in reached if h not in HOST_PARTY]
        chk(not unmapped,
            f"every host the app reached is one this test knows the owner of "
            f"({len(reached)} reached; unmapped: {unmapped or 'none'})")

        missing = sorted({HOST_PARTY[h] for h in reached if h in HOST_PARTY
                          and HOST_PARTY[h] not in low})
        chk(not missing,
            f"and the policy names every one of those owners "
            f"(missing: {missing or 'none'})")

        chk("never see your device at all" not in low,
            "the superseded 'those agencies never see your device' claim is gone")
        chk("fetches from those agencies itself" in low
            or "fetches from those agencies" in low,
            "and the policy says the device fetches from them itself")

        # CONTROL: both arms above report an absence, so prove each fires.
        # One unknown host, and one known host whose owner is not in the text.
        # The second arm uses a host that is reached on EVERY run rather than
        # one that depends on which layers happened to be on, so the control
        # demonstrates rather than passing on a technicality.
        anchor = "api.weather.gov"
        probe_reached = reached + ["tracker.example-analytics.net"]
        probe_unmapped = [h for h in probe_reached if h not in HOST_PARTY]
        probe_low = low.replace(HOST_PARTY[anchor], "")
        probe_missing = sorted({HOST_PARTY[h] for h in probe_reached
                                if h in HOST_PARTY and HOST_PARTY[h] not in probe_low})
        chk(anchor in reached
            and probe_unmapped == ["tracker.example-analytics.net"]
            and HOST_PARTY[anchor] in probe_missing,
            "CONTROL: an unknown host is reported, and so is a named party "
            f"removed from the policy ({probe_unmapped}, {probe_missing})")

        print("\n== attribution is on the screen, not behind the expander ==")
        await pg.wait_for_timeout(9000)   # the base map has to draw first
        strip = await pg.evaluate(
            "()=>{const t=document.querySelector"
            "('#credits .cesium-credit-textContainer');"
            "return t?t.textContent.trim():'';}")
        print(f"     strip reads: {strip[:120]!r}")

        # Whoever is serving the base map has to be named. Which one it is
        # depends on whether an ion token is configured, so accept either
        # rather than pinning the test to this machine's .env.
        BASES = ("Microsoft", "Esri", "OpenStreetMap", "OpenTopoMap", "NASA")
        chk(any(b in strip for b in BASES),
            f"the base map's source is named on screen "
            f"({[b for b in BASES if b in strip] or 'NONE'})")
        chk("RainViewer" in strip,
            "and the radar layer's, which its terms require")
        # CONTROL: "we found the words" from a strip that is empty looks the
        # same as from one that is broken. Assert it is not empty and that the
        # detector is reading a real element.
        chk(len(strip) > 20,
            f"CONTROL: the strip has content at all ({len(strip)} chars), so a "
            f"match above is a real match")

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

    # The underscore matters: `graticule.settings.units_default_flipped`
    # exists and this pattern could not match it, so this suite read 7
    # keys while static_checks.py read 8 from the same two files. Two
    # surfaces disagreeing about the same number, again.
    named = set(re.findall(r"<code>(graticule\.[a-z0-9._]+)</code>", priv))
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
