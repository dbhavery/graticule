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
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
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


def main() -> None:
    app_js = read(WEB / "app.js")
    index = read(WEB / "index.html")
    priv = read(WEB / "privacy.html")
    supp = read(WEB / "support.html")

    # ---- the privacy policy's claims -------------------------------------
    print("\n== the privacy policy still describes this program ==")

    named = set(re.findall(r"<code>(graticule\.[a-z0-9.]+)</code>", priv))
    actual = set(re.findall(
        r"localStorage\.(?:get|set|remove)Item\(\s*'([^']+)'", app_js))
    chk(named == actual,
        f"the policy names exactly the localStorage keys app.js uses "
        f"({len(named)}); missing from policy: {sorted(actual - named) or 'none'}; "
        f"named but unused: {sorted(named - actual) or 'none'}")

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

    print(f"\n{len(ok)} passed, {len(bad)} failed")
    for m in bad:
        print("  FAILED:", m)
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
