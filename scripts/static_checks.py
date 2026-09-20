"""Checks that need no browser, no network and no backend, so CI can run them.

WHY

`.github/workflows/ci.yml` installed the package and ran
`python -c "import graticule"`. That was the whole job. It was green on every
push and would have stayed green through every defect this project has ever
had, including both of the ones fixed this week. A check that cannot fail
proves nothing, and a green badge that proves nothing is worse than no badge,
because it gets trusted.

The five real suites need a live backend, a browser and the actual internet, so
they cannot run in Actions without being flaky. Everything below is a genuine
invariant of the repository that a plain file read can settle.

Each group ends with a CONTROL where the detector could otherwise report a
clean zero while being broken.

    py -V:3.13 scripts/static_checks.py
"""
from __future__ import annotations

import json
import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
HERE = pathlib.Path(__file__).resolve().parent
WEB = ROOT / "web"

ok: list[str] = []
bad: list[str] = []


def chk(cond: bool, msg: str) -> None:
    (ok if cond else bad).append(msg)
    print(("  PASS  " if cond else "  FAIL  ") + msg)


def read(p: pathlib.Path) -> str:
    return p.read_text(encoding="utf-8", errors="replace")


TRACKERS = [
    "google-analytics", "googletagmanager", "gtag(", "mixpanel", "segment.io",
    "sentry.io", "@sentry", "posthog", "amplitude", "firebase", "crashlytics",
    "bugsnag", "datadoghq", "fullstory", "hotjar", "doubleclick",
    "facebook.net", "appsflyer", "adjust.com", "branch.io",
]

EM = "—"


def em_dashes(text: str) -> int:
    return text.count(EM) + text.lower().count("&mdash;")


# index.html uses a bare em dash 48 times as the "no value yet" glyph in count
# and readout slots. That is a typographic placeholder, not prose, and banning
# it outright would either fail forever or push someone into replacing a UI
# convention to satisfy a rule about sentences.
#
# So: flag an em dash only when it shares a text node with a word, which is
# what a sentence looks like and what `>—<` never is.
PROSE_EM = re.compile(r"\w[^<>]*" + EM + r"|" + EM + r"[^<>]*\w")


def storage_keys(js: str) -> set[str]:
    """Every localStorage key app.js actually touches.

    THIS USED TO MATCH ONLY STRING LITERALS, and a key written through a
    constant was invisible to it. Three keys had been live and undeclared for
    months behind that blind spot -- graticule.presets.v1 (saved camera
    positions), graticule.scenes.v1 (scene decks) and the units-flip flag --
    because each is referenced as `localStorage.setItem(PRESETS_KEY, ...)`.

    The check reported "the policy names exactly the keys app.js uses" the
    whole time, comparing the policy against a list that could not grow the
    way this codebase actually adds keys. A pass meant nothing. Resolve the
    constants too.
    """
    keys = set(re.findall(
        r"localStorage\.(?:get|set|remove)Item\(\s*'([^']+)'", js))
    for name, value in re.findall(
            r"const\s+([A-Z_][A-Z0-9_]*)\s*=\s*'(graticule\.[^']+)'", js):
        if re.search(r"localStorage\.(?:get|set|remove)Item\(\s*"
                     + name + r"\b", js):
            keys.add(value)
    return keys


def prose_em_dashes(text: str) -> list[str]:
    return PROSE_EM.findall(text) + re.findall(r".{0,20}&mdash;.{0,20}",
                                               text, re.IGNORECASE)


def main() -> None:
    app_js = read(WEB / "app.js")
    index = read(WEB / "index.html")
    priv = read(WEB / "privacy.html")
    supp = read(WEB / "support.html")

    # ---- the privacy policy's claims -------------------------------------
    print("\n== the privacy policy still describes this program ==")

    named = set(re.findall(r"<code>(graticule\.[a-z0-9._]+)</code>", priv))
    actual = storage_keys(app_js)
    chk(named == actual,
        f"the policy names exactly the localStorage keys app.js uses "
        f"({len(named)}); missing from policy: {sorted(actual - named) or 'none'}; "
        f"named but unused: {sorted(named - actual) or 'none'}")

    # A KEY LIST CANNOT SEE A NEW FIELD INSIDE AN EXISTING KEY.
    #
    # The check above compares the key NAMES the policy prints against the ones
    # app.js touches, and it has passed every run. It went on passing when
    # `settings.home` started writing a precise latitude and longitude into
    # `graticule.settings.v1`, because the key count never moved -- while the
    # policy still said the coordinate was "not written to storage, and not
    # retained". The live page was false for a day and every gate was green.
    #
    # So: if the code persists a location, the policy has to say so, in the
    # section about local storage, and the app has to offer a way to erase it.
    persists_home = bool(re.search(r"settings\.home\s*=\s*\{", app_js))
    low = priv.lower()
    admits = ("local storage" in low
              and "coordinate for your area" in low
              and "never transmitted" in low)
    chk(not persists_home or admits,
        "the policy describes the one coordinate the app saves "
        f"(code persists it: {persists_home}; policy describes it: {admits})")

    # The exact sentence that became false. Whitespace-normalised, because it
    # wraps across lines in the source and a literal match would miss it.
    flat = re.sub(r"\s+", " ", priv)
    chk("not written to storage, and not retained" not in flat,
        "the superseded 'not written to storage' claim is gone")

    chk(not persists_home or 'id="home-clear"' in index,
        "Settings offers the Clear control the policy promises")

    # CONTROL: all three report an absence. Prove each fires on a copy that has
    # the defect, using the real superseded sentence rather than a stand-in.
    stale = "the coordinate is not written to storage, and not retained."
    chk("not written to storage, and not retained" in re.sub(r"\s+", " ", stale)
        and not ("coordinate for your area" in stale.lower())
        and bool(re.search(r"settings\.home\s*=\s*\{", "settings.home = { lat, lon };")),
        "CONTROL: the stale-claim, policy-silence and persistence detectors all fire")

    hits = [t for t in TRACKERS if t in app_js.lower()]
    chk(not hits, f"no analytics or crash-reporting SDK in app.js ({hits or 'none'})")
    hits = [t for t in TRACKERS if t in index.lower()]
    chk(not hits, f"nor in index.html ({hits or 'none'})")

    sends = re.findall(r"\bws\w*\.send\(|\bsocket\.send\(", app_js)
    chk(not sends,
        f"the live socket is still receive-only, as the policy says "
        f"({len(sends)} sends)")

    # CONTROL: all four above are "we found zero". Prove the detector sees one.
    probe = "localStorage.setItem('graticule.zzz', 1); sentry.io; ws.send(x)"
    chk(bool(re.findall(r"localStorage\.setItem\(\s*'([^']+)'", probe))
        and any(t in probe for t in TRACKERS)
        and bool(re.findall(r"\bws\w*\.send\(", probe)),
        "CONTROL: those three detectors all fire on a string that has one")

    # ---- the licence ------------------------------------------------------
    print("\n== the airspace data is the FAA's, not OpenAIP's ==")

    asp_path = WEB / "data" / "airspace.json"
    chk(asp_path.exists(), f"{asp_path.relative_to(ROOT)} is committed")
    if asp_path.exists():
        recs = json.loads(read(asp_path))
        chk(len(recs) > 2000, f"it holds {len(recs)} polygons")
        shaped = [r for r in recs
                  if isinstance(r, dict) and "class" in r
                  and (r.get("geometry") or {}).get("type") == "Polygon"]
        chk(len(shaped) == len(recs),
            f"every record has a class and a Polygon ({len(shaped)}/{len(recs)})")
        # The OpenAIP extract used integer icaoClass. If that key is back, so
        # is the licence problem.
        chk(not any("icaoClass" in r for r in recs[:500]),
            "no record carries OpenAIP's icaoClass")

    src = app_js + read(ROOT / "scripts" / "build_boundaries.py")
    live_openaip = [ln for ln in src.splitlines()
                    if "openaip" in ln.lower()
                    and not ln.lstrip().startswith(("#", "*", "//", "/*"))]
    chk(not live_openaip,
        f"no live code references OpenAIP ({len(live_openaip)} lines)")

    # ---- what the APK will actually serve ---------------------------------
    # The classic native failure: the page works in a browser and white-screens
    # in the shell because a URL resolved to nothing. Every local asset the
    # document names has to exist as a file.
    print("\n== every local asset index.html names exists ==")
    refs = set(re.findall(r'(?:src|href)="(/[^"#?]+)"', index))
    missing = []
    for r in sorted(refs):
        if r.startswith("/static/"):
            p = WEB / r[len("/static/"):]
        elif r in ("/privacy", "/support"):
            p = WEB / (r.lstrip("/") + ".html")
        else:
            p = WEB / r.lstrip("/")
        if not p.exists():
            missing.append(r)
    chk(not missing, f"{len(refs)} referenced, {len(missing)} missing "
                     f"{missing[:4] if missing else ''}")
    chk(len(refs) >= 3,
        f"CONTROL: the reference scan found {len(refs)} URLs, so it is reading "
        f"the document rather than matching nothing")

    # ---- house style ------------------------------------------------------
    print("\n== house style ==")
    for name, txt in (("privacy.html", priv), ("support.html", supp)):
        chk(em_dashes(txt) == 0, f"{name} has no em dash ({em_dashes(txt)})")
    chk(em_dashes(f"a {EM} b") == 1 and em_dashes("a &mdash; b") == 1,
        "CONTROL: the em-dash detector finds one when one is there")

    # The two files above were the only ones ever checked, and both of them are
    # documents nobody reads. The strings a user actually sees went unchecked:
    # the PWA install name and the offline page title each shipped an em dash.
    for name, txt in (("index.html", index),
                      ("offline.html", read(WEB / "offline.html")),
                      ("manifest.webmanifest", read(WEB / "manifest.webmanifest"))):
        hits = prose_em_dashes(txt)
        chk(not hits, f"{name} has no em dash in prose ({len(hits)} {hits[:2]})")
    chk(len(prose_em_dashes(f"<p>a {EM} b</p>")) == 1
        and not prose_em_dashes(f"<span>{EM}</span>"),
        f"CONTROL: prose scan flags 'a {EM} b' and spares the >{EM}< placeholder")

    # ---- attribution ----------------------------------------------------
    #
    # This shipped as `creditContainer: document.createElement('div')`, a node
    # that was never appended, so Cesium wrote fourteen credits into nothing
    # and the app displayed no attribution at all. Several of those credits are
    # licence conditions (OpenStreetMap is ODbL, OpenTopoMap is CC-BY-SA, Esri
    # requires it), which made a suppressed credit bar the same class of defect
    # as shipping a non-commercial dataset. issues.md 66.
    app = read(WEB / "app.js")
    css = read(WEB / "style.css")
    chk('id="credits"' in index,
        "index.html has a #credits element for Cesium to write into")
    chk("creditContainer: document.getElementById('credits')" in app,
        "the viewer's creditContainer is that element and not a detached div")
    chk("document.createElement('div')" not in
        app[app.index("creditContainer:"):app.index("creditContainer:") + 120],
        "CONTROL: the exact detached-div form that caused this is gone")
    chk(".cesium-credit-lightbox-overlay { display: none" not in css,
        "the attribution expander is not hidden by CSS")
    # adsb.fi's terms require citing them WITH a link, and aircraft arrive as
    # websocket entities so no imagery credit ever covered them.
    chk("adsb.fi" in app and 'href="https://adsb.fi/"' in app,
        "adsb.fi is credited with a link, which its terms require")
    chk(app.count("onScreenCredit(") >= 5,
        f"the base map's own credit is on screen, not behind the expander "
        f"({app.count('onScreenCredit(')} promoted)")

    # ---- the image installs what the package declares -------------------
    #
    # The Dockerfile lists its dependencies explicitly instead of running
    # `pip install .`, so that pywebview -- a DESKTOP dependency needing a GUI
    # toolkit -- never enters the image. Its own comment says "keep this list
    # in step with pyproject.toml", and a list two files have to agree on by
    # hand is a list that drifts. The failure would be a container that builds
    # and then dies on an ImportError at boot, on a host with no Docker here
    # to catch it first.
    print("\n== the container installs exactly what the package needs, minus the desktop ==")

    docker = read(ROOT / "Dockerfile")
    pyproj = read(ROOT / "pyproject.toml")

    block = re.search(r"^dependencies = \[(.*?)^\]", pyproj, re.S | re.M)
    declared = set(re.findall(r'"([^"]+)"', block.group(1))) if block else set()
    installed = set(re.findall(r'^\s+"([^"]+)"\s*\\?$', docker, re.M))

    # pywebview is excluded on purpose and is the one difference allowed.
    DESKTOP_ONLY = {d for d in declared if d.startswith("pywebview")}
    chk(bool(DESKTOP_ONLY), "pyproject still declares the desktop dependency")
    missing = sorted(declared - DESKTOP_ONLY - installed)
    extra = sorted(installed - declared)
    chk(not missing and not extra,
        f"the Dockerfile installs every runtime dependency and no others "
        f"(missing: {missing or 'none'}; unexpected: {extra or 'none'})")
    chk(not (installed & DESKTOP_ONLY),
        "and it does not drag the GUI toolkit into the image")

    # The CMD calls run_server(port, host). A signature change here is silent
    # until the container starts.
    server = read(ROOT / "graticule" / "server.py")
    chk("def run_server(port: int, host: str | None = None)" in server,
        "run_server still takes (port, host), which the Dockerfile CMD passes")
    # WEB_DIR is the sibling of the package dir, which is why the image copies
    # graticule/ and web/ side by side rather than nesting them.
    chk('WEB_DIR = Path(__file__).parent.parent / "web"' in server
        and "COPY graticule/ /app/graticule/" in docker
        and "COPY web/ /app/web/" in docker,
        "the image's layout matches how WEB_DIR resolves")

    # CONTROL: drop a dependency on a copy and confirm the comparison notices.
    probe = docker.replace('      "httpx>=0.27" \\\n', "")
    probe_installed = set(re.findall(r'^\s+"([^"]+)"\s*\\?$', probe, re.M))
    chk(bool(sorted(declared - DESKTOP_ONLY - probe_installed)),
        "CONTROL: removing httpx from the install list is reported as missing")

    # ---- the listing and the manifest name the same permissions ---------
    #
    # A store listing has to justify every permission, and the one nobody
    # wrote down is the one nobody reviewed. These drifted the moment the
    # notification plugin was added: the manifest gained POST_NOTIFICATIONS
    # and the listing still said "three are declared".
    #
    # This reads the SOURCE manifest, which is not the final word -- a plugin's
    # manifest merge adds permissions this file never mentions, which is
    # exactly how RECEIVE_BOOT_COMPLETED got in. Those are stripped with
    # tools:node="remove", and that is asserted separately below. The APK
    # itself is the authority and needs aapt2, so it is checked at build time,
    # not here.
    print("\n== the Play listing justifies every permission the manifest asks for ==")

    mf = read(ROOT / "android" / "app" / "src" / "main" / "AndroidManifest.xml")
    listing = read(ROOT / "docs" / "play-listing-answers.html")

    asked = set(re.findall(
        r'<uses-permission\s+android:name="android\.permission\.([A-Z_]+)"\s*/>', mf))
    removed = set(re.findall(
        r'<uses-permission\s+android:name="android\.permission\.([A-Z_]+)"\s*\n?\s*'
        r'tools:node="remove"\s*/>', mf))
    asked -= removed

    unjustified = sorted(p for p in asked if p not in listing)
    chk(not unjustified,
        f"every declared permission appears in the listing answers "
        f"({len(asked)} declared; missing: {unjustified or 'none'})")
    chk(bool(removed),
        f"the plugin permissions this app does not use are stripped ({sorted(removed)})")
    chk(all(p in listing for p in removed),
        "and the listing explains why they are stripped")

    # CONTROL: the detector has to find a permission that is NOT in the
    # listing, or "none missing" is what a broken regex also says.
    probe_mf = mf.replace(
        '<uses-permission android:name="android.permission.INTERNET" />',
        '<uses-permission android:name="android.permission.INTERNET" />\n'
        '    <uses-permission android:name="android.permission.CAMERA" />')
    probe_asked = set(re.findall(
        r'<uses-permission\s+android:name="android\.permission\.([A-Z_]+)"\s*/>',
        probe_mf))
    chk("CAMERA" in probe_asked and "CAMERA" not in listing,
        "CONTROL: an undeclared permission is seen and reported as unjustified")

    # ---- the switches and the code that answers them --------------------
    #
    # The layer set IS the product, and it lived in two places that nothing
    # compared: 38 `input[data-layer]` in the markup, and a 28-arm if/else in
    # `bindUI`. A `nightlights` arm sat in that chain long after its switch
    # moved to the sky group, unreachable and silent. issues.md 73.
    #
    # Two failure shapes, and they are not symmetric. A handler with no switch
    # is dead code. A switch with no handler is an inert control: it looks
    # live, it takes the click, and the user is the one who finds out.
    print("\n== every layer switch reaches code, and every handler has a switch ==")

    def dispatch(app_src: str, html_src: str) -> tuple[list[str], list[str]]:
        markup = set(re.findall(r'data-layer="([a-z0-9_]+)"', html_src))
        block = re.search(r"const LAYER_TOGGLES = \{(.*?)\n\};", app_src, re.S)
        toggles = set(re.findall(r"^\s{2}([a-z0-9_]+):", block.group(1), re.M)) \
            if block else set()
        cat = re.search(r"const CATEGORY = \{(.*?)\n\};", app_src, re.S)
        category = set(re.findall(r"([a-z0-9_]+):\s*'", cat.group(1))) if cat else set()
        return sorted(toggles - markup), sorted(markup - toggles - category)

    dead, inert = dispatch(app, index)
    chk(not dead, f"no handler without a switch ({dead or 'none'})")
    chk(not inert, f"no switch without a handler ({inert or 'none'})")
    chk("assertLayerDispatch()" in app,
        "bindUI runs the same check at boot, so a running build says so too")

    # CONTROL: both arms above report "we found zero". Reintroduce each defect
    # on a copy and prove the detector sees it -- the dead arm is the exact
    # line that was removed, not a stand-in.
    revived = app.replace(
        "  radar:       (on) => toggleRadar(on),",
        "  radar:       (on) => toggleRadar(on),\n"
        "  nightlights: (on) => toggleNightLights(on),")
    inerted = index.replace('data-layer="radar"', 'data-layer="lightning"', 1)
    chk(dispatch(revived, index)[0] == ["nightlights"]
        and dispatch(app, inerted)[1] == ["lightning"],
        "CONTROL: it reports the revived nightlights arm and an inert switch")

    # ---- the browser libraries are ours, not a CDN's ---------------------
    #
    # index.html used to load the engine from cesium.com and satellite.js from
    # cdn.jsdelivr.net, which made two third-party CDNs hard dependencies of a
    # native app: with cesium.com unreachable the page threw "Cesium is not
    # defined" and drew nothing, while the Play listing said the globe still
    # draws with no signal. A cold boot also pulled 21.3 MB across 720
    # requests from cesium.com, 14.8 MB of it the same files again.
    #
    # scripts/offline_test.py is the behavioural gate. This is the cheap half:
    # it catches a CDN URL creeping back into the markup, and a version bump in
    # package.json that leaves the committed copy behind.
    print("\n== the browser libraries ship with the app ==")

    cdn = re.findall(r'(?:src|href)="(https?://[^"]+)"', index)
    engine_cdn = [u for u in cdn if "cesium.com" in u or "jsdelivr" in u]
    chk(not engine_cdn,
        "no library is loaded from a CDN"
        + ("" if not engine_cdn else f": {engine_cdn}"))
    chk("window.CESIUM_BASE_URL = '/static/vendor/cesium/'" in index,
        "CESIUM_BASE_URL points at the vendored copy, so the workers and "
        "Assets resolve locally too")

    vendored = subprocess.run(
        [sys.executable, str(HERE / "vendor_assets.py"), "--check"],
        capture_output=True, text=True)
    chk(vendored.returncode == 0,
        "web/vendor matches node_modules: "
        + (vendored.stdout.strip().splitlines() or ["no output"])[-1])

    # CONTROL: the URL scan has to see a CDN when one is there, or "none" is
    # also what a regex that matches nothing says.
    probe_index = index.replace(
        '<script src="/static/vendor/satellite/satellite.min.js"></script>',
        '<script src="https://cdn.jsdelivr.net/npm/satellite.js@5.0.0/'
        'dist/satellite.min.js"></script>')
    probe = [u for u in re.findall(r'(?:src|href)="(https?://[^"]+)"', probe_index)
             if "cesium.com" in u or "jsdelivr" in u]
    chk(len(probe) == 1,
        f"CONTROL: the scan finds the jsdelivr tag when it is put back ({probe})")

    print(f"\n{len(ok)} passed, {len(bad)} failed")
    for m in bad:
        print("  FAILED:", m)
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
