# Graticule — Session Handoff (2026-05-02 night)

> **Session:** 2026-05-02 evening + late-night patch round (six waves + four patches)
> **Repo state:** branch `dev` clean, working tree clean.
> **Tip:** `3b8f329 feat: near-zoom ship/sat icons + dot scaling + Windows shortcut installer`
> **Branches:**
>   - `master` — `9577dd9` (Phase 1 init, never merged from dev)
>   - `dev` — `3b8f329`
> **GitHub remote:** https://github.com/dbhavery/graticule — PUBLIC, default branch `dev`. Old `cupola` URL 301-redirects.
> **Local working dir:** still `C:/Users/dbhav/Projects/vantage/` on disk (outer rename **DEFERRED — WinError 32 sharing violation**)
> **Window status:** Running as PID 67480 from final relaunch. Shortcut installed in Start Menu + Desktop.
> **Shortcut**: file:///C:/Users/dbhav/Desktop/Graticule.lnk and Start Menu → "Graticule".

---

## TL;DR — six waves + four patch rounds shipped

| Tip | Wave / Patch | What |
|---|---|---|
| `3b6d54b` | A | Rename Cupola → Graticule (inner package, GitHub repo, brand, localStorage migration) |
| `692788f` | E | Layer toggle fade-in / fade-out animation (350 ms cubic) |
| `f77dd01` | B + C | BOUNDARIES category — countries + states + airspace (NE 10m + OpenAIP) |
| `2fe1704` | D | TFR boundary polygons via FAA GeoServer WFS |
| `cd403e5` | F | Settings modal + alerts panel + sidebar entry/hover transitions |
| `8dcefcf` | docs | Original handoff |
| `6368dd7` | Patch 1 | Cache headers + remove City Lights + label depth-test + Cities layer + boundary fidelity (250 pts/ring) |
| `3e7961f` | Patch 2 | Default units flipped to US Customary (with one-shot localStorage migration) |
| `0ac0df4` | Wave G | Clouds layer (RainViewer satellite IR) + radar verified |
| `1a32582` | Wave H | Settings overhaul — 14 new controls (clock format, imagery picker, opacity sliders, graticule overlay, performance preset, diagnostics, ambient sound, reset button…) |
| `64c49ca` | Patch 3 | Feed-chip thresholds + sun-lighting default off + auto-rotate guards (≥5 Mm only, 1.5°/s) |
| `3b8f329` | Patch 4 | Near-zoom ship/sat SVG billboards + dot scaleByDistance + Windows shortcut installer |

**Deferred:** outer folder rename `Projects/vantage/` → `Projects/graticule/` — Windows WinError 32 (sharing violation) blocked it across multiple attempts including cmd.exe `move`, robocopy `/MOVE`, PowerShell `Rename-Item`, Python `os.rename`. Likely held by Windows search indexer, Defender, or the running bash session itself.

---

## What landed (per wave)

### Wave A — Rename Cupola → Graticule everywhere

- Inner package `cupola/` → `graticule/` (git mv, history preserved)
- `pyproject.toml` name + wheel target → graticule
- `main.py`: window title "Graticule", thread name `graticule-server`
- `web/index.html`: `<title>` + brand-name → Graticule / GRATICULE
- `web/style.css` header comment
- `web/app.js`: `SETTINGS_KEY = 'graticule.settings.v1'`, `PRESETS_KEY`, `window.__graticule_cfg`. **Plus a one-time IIFE migration that copies `cupola.settings.v1` / `cupola.presets.v1` → graticule.* and deletes the old keys** so existing camera presets and unit choice carry over.
- All 16 feed `User-Agent` strings: `cupola/0.1` → `graticule/0.1`
- README: title, install commands, license & names paragraph (the old Blizzard-Overwatch disclaimer was removed; Graticule is unambiguous)
- `.gitignore`: excluded `us_*.json/.geojson/.cupx` (OpenAIP CC-BY-NC-SA), `ne_*.zip` (commit derived geojson instead), `web/data/airspace.json` (CC-BY-NC-SA derived)
- `uv.lock` refreshed via `uv sync` — package renamed cleanly
- GitHub repo renamed via `gh repo rename graticule -R dbhavery/cupola --yes`. Local remote updated.

### Wave E — Layer toggle fade-in animation

`fadeDataSource(ds, dir, ms, onDone)` walks entities once at fade start, captures each entity's billboard / point / polyline (Color or Dash) / polygon material + outlineColor / label fillColor + outlineColor, then lerps alpha each rAF tick (cubic-out), restores baselines at end. Cancels any in-flight fade on the same source so rapid toggles don't fight. Skips empty sources (just flips `show`).

`fadeImageryLayer(layer, fromA, toA, ms)` — radar / aurora / nightlights / parcels-US.

`fadeTileset(tileset, fromA, toA, ms)` — OSM Buildings + Google Photoreal 3D via `Cesium3DTileStyle color('white', a)`.

Wired into all toggles: generic dataSource path + radar / aurora / nightlights / buildings / photoreal3d / cables / terminator / parcels_us / parcels_wa.

### Wave B + C — BOUNDARIES category

New sidebar category, three layers:

**Countries** — 7785 polyline borders + 252 labels (top-tier `labelrank ≤ 7`) from Natural Earth 10m admin_0. 1 px line at 0.45 alpha (`#cbd5e1`). All-caps Inter labels with distance-fade (200 km hide → 1.2 Mm full → 18 Mm hide).

**States & Provinces** — 3593 polyline borders + 1468 labels from Natural Earth 10m admin_1 (scalerank ≤ 5; rings decimated to ≤ 80 pts via uniform sampling — 47 MB → 6.7 MB). 1 px line at 0.30 alpha. 11 px Inter labels visible only at 50 km – 2.5 Mm.

**Airspace (US)** — 3785 OpenAIP polygons coloured by ICAO class (A/B/C/D/E/other), 0.10 alpha fill + 0.55 outline. DDC-gated to ≤ 800 km altitude. Source data is gitignored (CC-BY-NC-SA).

Pipeline: `scripts/build_boundaries.py` reads the NE zips + OpenAIP `us_asp.json` and writes minimal GeoJSON / JSON to `web/data/`. NE outputs are committed (~11 MB total, public domain). Airspace JSON is gitignored — users supply their own `us_asp.json` from openaip.net and run the build.

### Wave D — TFR polygon boundaries

Replaced state-centroid plot with actual TFR polygons. Found while reverse-engineering the FAA tfr3 SPA: it talks to a public **GeoServer** at `https://tfr.faa.gov/geoserver/TFR/ows`. The `TFR:V_TFR_LOC` feature type returns one Polygon per active TFR with NOTAM_KEY / TITLE / STATE / LEGAL — no key, no auth.

`graticule/feeds/tfrs.py` fetches V_TFR_LOC + exportTfrList in parallel, joins on notam_id (NOTAM_KEY `6/6432-1-FDC-F` → notam_id `6/6432` by stripping after first dash). Stores `polygon: [[lon, lat], …]` plus bbox-centroid `lat/lon` for picking. Falls back to state-centroid stubs for any TFRs in the list that don't have a WFS polygon.

Frontend `graphicsFor('tfrs', d)`: when `d.polygon` is present, builds a `PolygonHierarchy` + filled+outlined polygon + dot-fade-out at close zoom. Without polygon, keeps the legacy 5 nm fallback ellipse.

Verified at 200 km altitude over Wilmington NC — HAZARDS TFR `6/6432` renders as a clean circular polygon with rose-tinted fill + outline.

### Wave F — Effects + style polish

- **Settings modal**: 220 ms cubic-out fade + slight upward slide (translateY 8 → 0 + scale .985 → 1). Overlay scrim fades in parallel.
- **Alerts panel**: same — slides up 8 px while fading in, reverses on hide. Pointer events disabled while transparent.
- **Sidebar layer rows**: subtle hover background + smooth color transition. Checked rows brighten to full text color.
- **Sidebar category headers**: matching hover affordance + subtle bg.

All transitions 140-220 ms cubic.

---

## File map (current)

```
C:/Users/dbhav/Projects/vantage/         ← outer folder still 'vantage' (deferred)
├── HANDOFF_2026-05-02_GRATICULE.md  ← this file
├── HANDOFF.md                       ← previous (Cupola tip 2448a4a) — historical record
├── RESEARCH.md                      ← original API catalog
├── PLAN.md                          ← original phased plan
├── README.md                        ← user-facing install + feature catalog (renamed)
├── pyproject.toml                   ← name = "graticule"
├── .python-version                  ← 3.13
├── .env                             ← gitignored
├── .env.example                     ← committed
├── .gitignore                       ← excludes us_*, ne_*.zip, web/data/airspace.json
├── main.py                          ← window title "Graticule"
├── scripts/
│   └── build_boundaries.py          ← NE zip → web/data/ne_*.geojson + OpenAIP → airspace.json
├── graticule/                       ← Python package (was cupola/)
│   ├── server.py
│   ├── state.py
│   └── feeds/
│       ├── adsb.py                  ← OpenSky OAuth2
│       ├── ais.py
│       ├── airports.py
│       ├── aurora.py
│       ├── cables.py
│       ├── fires.py
│       ├── hurricanes.py
│       ├── launches.py
│       ├── news.py                  ← function name `gdelt_loop` (legacy after EONET pivot)
│       ├── quakes.py
│       ├── radar.py
│       ├── satellites.py
│       ├── space_weather.py
│       ├── tfrs.py                  ← NEW: WFS polygons + state-centroid fallback
│       ├── tsunamis.py
│       └── volcanoes.py
└── web/
    ├── index.html                   ← + BOUNDARIES category in sidebar
    ├── style.css                    ← + entry/hover transitions
    ├── app.js                       ← + fade helpers + buildCountries/States/Airspace
    │                                  + window.__graticule_viewer test hook
    └── data/                        ← committed: NE GeoJSONs (4 files, ~11 MB)
                                       gitignored: airspace.json (~22 MB)

External:
C:/Users/dbhav/cupola-transfer/      ← rename to graticule-transfer/ when convenient
```

---

## Open threads / next steps

### Immediate (one-off cleanups)

1. **Outer folder rename** — close all sessions / VS Code windows / terminals, then from a fresh shell:
   ```
   cd C:/Users/dbhav/Projects
   mv vantage graticule
   ```
   Or via Explorer right-click. Then rename `cupola-transfer/` → `graticule-transfer/` for symmetry.

2. **Update memory pointers** — MEMORY.md still lists the on-disk path as `Projects/vantage`. Update once outer rename completes.

### Next-bundle queue (from the existing roadmap)

3. NASA DONKI space-weather pulses (CME / solar flares / RBE) — free with any api.nasa.gov key
4. NASA GIBS sea surface temperature overlay — free, no key
5. NHC hurricane forecast cones — free GeoJSON per active storm (off-season today)
6. NDBC buoy network — free, no key
7. glTF type-aware plane swap (download OpenSky aircraft DB CSV ~50 MB; branch on aircraft type)
8. glTF ship variants (CC sketchfab cargo/tanker/cruise)
9. ACLED conflict events / WRI power plants / Natural Earth railroads + roads + urban areas (zips already in repo root, gitignored)

### UX polish backlog (unchanged from previous handoff)

- Click radius too tight at low zoom (use `drillPick` or expand pickable area)
- Keyboard shortcuts (esc to close panel, l to toggle layers, t to fly home)
- Window position persistence
- "Follow this entity" mode
- Detail panel — formatted key-value table per layer kind instead of raw JSON

---

## Key gotchas (still in effect)

1. **Outer folder still `Projects/vantage/`** on disk. Inner package is `graticule`. Memory pointers reference the old path. Move when convenient.
2. **`cupola-transfer/`** sibling folder has `.env` for the other PC — rename in sync with outer folder.
3. Pythonnet on Python 3.14 doesn't load. `.python-version` pins 3.13.
4. OpenSky requires OAuth2 (`OPENSKY_CLIENT_ID` / `OPENSKY_CLIENT_SECRET`).
5. EONET HTTP 500 intermittently — backs off 30 min on failure.
6. Celestrak Starlink 403s intermittently.
7. WA statewide parcels redact owner per state policy.
8. **`window.__graticule_viewer`** is a test hook (intentional) for Playwright self-test.
9. `feeds/news.py` function is `gdelt_loop` for import-stability after EONET pivot.
10. CallbackProperty re-evaluates every frame — pulse animations capped at 12.
11. **fadeDataSource on a layer with streaming entity additions** (planes, ships) may briefly show new entities at full alpha during the fade — acceptable trade-off at 350 ms.
12. **Airspace data CC-BY-NC-SA** — never commit `web/data/airspace.json` to public repo.

---

## Quick commands

```bash
# Run the app
cd C:/Users/dbhav/Projects/vantage
uv run python main.py

# Build derived data (after dropping new NE zips or new us_asp.json)
uv run python scripts/build_boundaries.py

# Backend smoke (no window)
.venv/Scripts/python.exe -c "
import threading, time, urllib.request, json
from graticule.server import run_server
threading.Thread(target=run_server, args=(8732,), daemon=True).start()
time.sleep(60)
data = json.loads(urllib.request.urlopen('http://127.0.0.1:8732/api/snapshot', timeout=10).read())
for n, s in sorted((data.get('layers') or {}).items()):
    print(f'  {n:14s} {len(s):>5d}')
"

# Public repo URLs
#   Browser:   https://github.com/dbhavery/graticule
#   Clone:     git clone https://github.com/dbhavery/graticule.git
```

---

## Don's locked rules in effect (project-relevant)

- HTML/CSS/JS via pywebview for visual UI.
- Clickable file links — paths in chat as `file:///C:/...` with forward slashes.
- Direct, no fluff communication.
- Don directs, AI builds.
- Self-test via Playwright synthetic events; never the physical mouse.
- Local-first, no cloud sync, no accounts.
- GitHub repo is PUBLIC — audit `.env` and history before each push.
- Tasteful = present without dominating. Tune by eye against satellite imagery.

---

*End of handoff. Tip cd403e5 on dev. Repo public at https://github.com/dbhavery/graticule.*
