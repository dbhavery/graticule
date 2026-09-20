"""Copy the browser dependencies out of node_modules and into web/vendor/.

WHY THIS EXISTS

index.html used to load both of its libraries off other people's CDNs:

    https://cesium.com/downloads/cesiumjs/releases/1.121/Build/Cesium/Cesium.js
    https://cdn.jsdelivr.net/npm/satellite.js@5.0.0/dist/satellite.min.js

android_build.py copies web/ verbatim, so the APK did the same thing, which
made two third-party CDNs hard dependencies of a native app. Measured on a
45 second cold boot:

    720 requests to cesium.com, 21.3 MB
    14.8 MB of that was the SAME file fetched again -- Cesium resolves its
    worker chunks and approximateTerrainHeights.json against CESIUM_BASE_URL
    once per web worker, and there is one worker per core
    Cache-Control on the bundle is public, max-age=1800, so a launch thirty
    minutes after the last one paid all of it again

and with cesium.com unreachable, `Cesium is not defined`: no canvas, no globe,
just the chrome over a blank page. The Play listing says "Boundary and
coastline data ships inside the app, so the globe still draws with no signal."
That was not true. scripts/offline_test.py is the gate that now holds it.

The duplicate count scales with `navigator.hardwareConcurrency`, so a phone
pays less of it than the 24-core desktop this was measured on. The dependency
does not scale with anything.

WHY node_modules AND NOT A COMMITTED DOWNLOAD

Both are normal npm dependencies pinned in package.json, so their versions are
recorded where every other dependency's version is recorded and `npm ci`
reproduces them. What this script copies IS committed, for the same reason
web/data/airspace.json is committed and the Natural Earth zips are not: the
APK ships these bytes, and a build input that only exists on one machine is
not reproducible. Vercel and the Docker image both build from a checkout with
no npm step.

WHAT IS LEFT OUT

Cesium's `index.js` and `index.cjs` are the ES-module and CommonJS entry
points, 8 MB between them. index.html loads the classic `Cesium.js` IIFE
through a script tag and never touches either one.

    py -V:3.13 scripts/vendor_assets.py [--check]

--check verifies the copies match node_modules without writing, which is what
static_checks.py calls so a version bump cannot land in package.json while the
committed copy stays behind.
"""
from __future__ import annotations

import argparse
import filecmp
import json
import pathlib
import shutil
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
NM = ROOT / "node_modules"
VENDOR = ROOT / "web" / "vendor"

CESIUM_SRC = NM / "cesium" / "Build" / "Cesium"
CESIUM_DST = VENDOR / "cesium"

# Everything the IIFE build resolves at runtime. Assets carries the star map,
# the moon, the earth-orientation tables and approximateTerrainHeights.json;
# without it the skybox and the ground primitives fail.
CESIUM_WANTED = ["Cesium.js", "Assets", "ThirdParty", "Widgets", "Workers"]
CESIUM_SKIPPED = ["index.js", "index.cjs"]

# Single files, copied straight across. satellite.js is 22 KB and carries the
# SGP4 propagation the satellites layer runs on.
SINGLES = {
    NM / "satellite.js" / "dist" / "satellite.min.js":
        VENDOR / "satellite" / "satellite.min.js",
}

# package.json name -> the VERSION stamp written beside the copy.
STAMPED = {"cesium": CESIUM_DST, "satellite.js": VENDOR / "satellite"}


def installed(pkg: str) -> str:
    p = NM / pkg / "package.json"
    if not p.exists():
        raise SystemExit(f"node_modules/{pkg} is missing. Run: npm install")
    return json.loads(p.read_text(encoding="utf-8"))["version"]


def declared(pkg: str) -> str:
    j = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
    return j["dependencies"][pkg]


def tree(p: pathlib.Path) -> set[pathlib.Path]:
    return {f.relative_to(p) for f in p.rglob("*") if f.is_file()}


def check() -> int:
    bad = 0
    for pkg, dst in STAMPED.items():
        stamp = dst / "VERSION"
        have = stamp.read_text(encoding="utf-8").strip() if stamp.exists() else None
        want = installed(pkg)
        if have != want:
            print(f"FAIL  vendored {pkg} is {have!r}, node_modules has {want}")
            print("      run: py -V:3.13 scripts/vendor_assets.py")
            bad += 1

    for name in CESIUM_WANTED:
        s, d = CESIUM_SRC / name, CESIUM_DST / name
        if s.is_file():
            if not d.is_file() or not filecmp.cmp(s, d, shallow=False):
                print(f"FAIL  cesium/{name} differs from node_modules")
                bad += 1
            continue
        if not d.exists():
            print(f"FAIL  cesium/{name} is not vendored at all")
            bad += 1
            continue
        missing = tree(s) - tree(d)
        if missing:
            print(f"FAIL  cesium/{name}: {len(missing)} file(s) not vendored, "
                  f"e.g. {sorted(missing)[0]}")
            bad += 1

    for s, d in SINGLES.items():
        if not d.is_file() or not filecmp.cmp(s, d, shallow=False):
            print(f"FAIL  {d.relative_to(ROOT)} differs from node_modules")
            bad += 1

    if bad:
        return 1
    versions = ", ".join(f"{p} {installed(p)} (pinned {declared(p)})"
                         for p in STAMPED)
    print(f"OK    web/vendor matches node_modules: {versions}")
    return 0


def copy() -> int:
    if CESIUM_DST.exists():
        shutil.rmtree(CESIUM_DST)
    CESIUM_DST.mkdir(parents=True)
    for name in CESIUM_WANTED:
        s = CESIUM_SRC / name
        if not s.exists():
            raise SystemExit(f"missing {s} -- is node_modules/cesium intact?")
        shutil.copy2(s, CESIUM_DST / name) if s.is_file() \
            else shutil.copytree(s, CESIUM_DST / name)

    for s, d in SINGLES.items():
        if not s.exists():
            raise SystemExit(f"missing {s} -- run npm install")
        d.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(s, d)

    for pkg, dst in STAMPED.items():
        dst.mkdir(parents=True, exist_ok=True)
        (dst / "VERSION").write_text(installed(pkg) + "\n", encoding="utf-8")

    n = sum(1 for f in VENDOR.rglob("*") if f.is_file())
    mb = sum(f.stat().st_size for f in VENDOR.rglob("*") if f.is_file()) / 1_048_576
    print(f"vendored cesium {installed('cesium')} and "
          f"satellite.js {installed('satellite.js')} -> web/vendor")
    print(f"  {n} files, {mb:.1f} MB   "
          f"(skipped {', '.join(CESIUM_SKIPPED)})")
    return 0


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true",
                    help="verify the copies match node_modules, write nothing")
    args = ap.parse_args()
    sys.exit(check() if args.check else copy())


if __name__ == "__main__":
    main()
