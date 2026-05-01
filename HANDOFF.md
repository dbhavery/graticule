# Vantage — Session Handoff (2026-05-01)

> **Session date:** 2026-04-30 → 2026-05-01 (overnight, PT)
> **Repo state:** branch `dev` checked out, working tree clean.
> **Tip:** `79c9645 feat: active-events filter + airports + TFRs + age-based color fade`
> **Branches:**
>   - `master` — `9577dd9` (Phase 1 init only — never merged from dev)
>   - `dev` — `79c9645` (current; all Phase 2 work)
>   - `feat/phase2-layers` — `2f67f37` (already merged into dev; safe to delete)
> **Live status:** Vantage window running on monitor 0 at (200,150), 1600×1000.
>                 14 toggleable layers + 4 imagery overlays + 4 telemetry signals.
> **Nothing pushed to remote** (no remote configured, per Don's discipline).

For the next agent: read this top to bottom, then file:///C:/Users/dbhav/Projects/vantage/RESEARCH.md (60+ public APIs catalogued), then
file:///C:/Users/dbhav/Projects/vantage/PLAN.md (original phased plan).
The "Starting prompt" at the bottom is what Don will paste to boot you.

---

## TL;DR

**Phase 1 (init commit 9577dd9):** Cesium globe in pywebview window, OpenSky planes only.

**Phase 2 (this session — dev tip 79c9645):**
- **14 toggleable point/polyline layers** across 6 categories
- **4 imagery-overlay toggles** (Radar / Aurora / City Lights / Day-Night terminator)
- **2 3D-tileset toggles** (OSM Buildings / Google Photoreal 3D — auto-enabled by free keys)
- **Always-on telemetry header**: UTC clock · cursor lat/lon · camera altitude ·
  Kp index · solar wind speed · X-ray flare class · tracked-entity total
- **Live event ticker** bottom-left, **feed-health chip strip** bottom-right,
  **detail panel** right side, **vignette + scanline** overlay
- **All 4 free-tier keys live** in `.env`: AISSTREAM_KEY, FIRMS_MAP_KEY,
  CESIUM_ION_TOKEN, GOOGLE_MAPS_API_KEY → unlocks ships, wildfires, OSM
  Buildings, Google Photoreal 3D
- **Active-events filter**: events show within a ±72h window (upcoming or
  recent), with age-based color fade and active-state coloring
- **Time-windowed feeds**: Quakes 7d→72h client filter, Wildfires 3d, Launches
  T-72h to T+72h, Volcanoes tagged active=last-10y-erupted
- **Aviation**: Airports (5,277) and TFRs (~70, state-centroid plotted)

**Window is currently running. Safe to close before working.**

---

## What shipped this session — 4 commits on dev

```
79c9645  feat: active-events filter + airports + TFRs + age-based color fade
864f0de  fix: drop SVG silhouettes — back to constant-size tiny dots everywhere
31f1c95  fix: invert LOD scale curve so icons SHRINK when zoomed in close
7c9f8a4  feat: Phase 2.2 — terminator, night lights, severe weather, subsea cables
c276432  feat: LOD billboards + 3D buildings + delta-aware live ticker + RESEARCH.md
b6f4323  Merge feat/phase2-layers — 12 layers across 6 categories + telemetry HUD
2f67f37  feat: telemetry HUD + 3 more feeds (launches, EONET, space weather)
66cab5e  feat: Phase 2 — 10 layers across 5 toggleable categories
756395d  docs: add HANDOFF.md for next-session continuity   ← this file (was)
9577dd9  Initial commit: Vantage MVP                         ← Phase 1
```

---

## Architecture (current)

```
┌─────────────────────────────────────────────────────────┐
│ pywebview window (Vantage)                              │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ CesiumJS 1.121 + satellite-js 5.0                   │ │
│ │ ─ ESRI World Imagery base (or Cesium ion if token)  │ │
│ │ ─ Optional: Black Marble (night side), Radar,       │ │
│ │             Aurora canvas, OSM Buildings, Google 3D │ │
│ │ ─ 13 entity data sources (point dots + lines)       │ │
│ │ ─ 1 cables-polyline data source                     │ │
│ │ ─ 1 terminator/sun data source                      │ │
│ │ ─ HUD: top telemetry / left layers / right detail   │ │
│ │       / bottom-left ticker / bottom-right chips     │ │
│ └─────────────────────────────────────────────────────┘ │
│  ↑ HTTP fetch + WebSocket /ws live deltas               │
└──────────────────────│──────────────────────────────────┘
                       │
┌──────────────────────┴──────────────────────────────────┐
│ FastAPI server (127.0.0.1:8731)                         │
│ ─ StateStore: layer dicts + meta blob + WS subscribers  │
│ ─ /api/snapshot, /api/config, /ws                       │
└──────────────────────│──────────────────────────────────┘
                       │ async tasks (lifespan-managed)
   ┌──────┬──────┬─────┴─────┬──────┬──────┬──────┐
   │ ADS-B│ AIS  │ TLE       │ NWS  │ NHC  │ SWPC │
   │ USGS │ FIRMS│ GVP       │ LL2  │ NASA │ EONET│
   │ NASA │ Tele │ OurAirpts │ FAA  │      │      │
   │ GIBS │ Geo  │           │ TFR  │      │      │
   └──────┴──────┴───────────┴──────┴──────┴──────┘
```

---

## Layer catalog (14 entity layers + 4 overlays)

| Category | Layer | Source | Cadence | Auth | Behavior |
|---|---|---|---|---|---|
| **AIR** | Planes | OpenSky `/api/states/all` | 15s poll | Anonymous (rate-limited) | Constant tiny dot. 429 → 60s backoff. |
| AIR | Satellites | Celestrak GP TLE × 7 groups | 6h refresh | None | Client-side propagation via satellite-js, 1 Hz tick. ~855 sats. Starlink capped at 500; their server 403s often. |
| AIR | Airports | OurAirports CSV | weekly | None | 5,277 large+medium worldwide. Static, no activity yet. |
| AIR | TFRs | FAA `tfrapi/exportTfrList` | 15m | None | ~70 active US restrictions, plotted at state centroid (boundary polys not exposed publicly). |
| **SEA** | Ships | AISStream `wss://stream.aisstream.io/v0/stream` | streaming | Free key ✅ | ~6,000 vessels live. Type-coded (cargo / tanker / passenger / fishing / other). |
| SEA | Hurricanes | NOAA NHC `CurrentStorms.json` | 5m | None | Off-season today (0). Name label visible when zoomed. |
| **EARTH** | Earthquakes | USGS `all_week.geojson` | 60s | None | 7-day fetch, server 72h cutoff. Client fades alpha by age — last 1h M3+ glows white-hot. |
| EARTH | Volcanoes | Smithsonian GVP WFS Holocene | 24h | None | 1,215 catalogued. `active=true` if last_eruption ≥ now-10y → bright red. Rest dim. |
| EARTH | Wildfires | NASA FIRMS `world/3` (3-day) | 30m | Free MAP_KEY ✅ | ~87,000 detections. Client fades by acq_date+acq_time. |
| **WEATHER** | Radar | RainViewer `weather-maps.json` | 5m | None | Imagery overlay. Latest past frame, alpha 0.7. |
| WEATHER | Aurora | NOAA SWPC `ovation_aurora_latest.json` | 5m | None | 1°×1° grid → canvas → SingleTileImageryProvider. Green glow over poles. |
| WEATHER | City Lights | NASA GIBS `VIIRS_Black_Marble` | static | None | Imagery layer with `nightAlpha=1.0 / dayAlpha=0` — visible only on night side. |
| WEATHER | Day/Night | computed client-side | 30s tick | None | Solar terminator polyline + ☀ subsolar marker. |
| **REFERENCE** | Subsea Cables | TeleGeography `cable-geo.json` | 24h | None | 711 cables as ground-clamped polylines. Attribution required. |
| **3D** | Buildings (OSM) | Cesium ion `createOsmBuildingsAsync` | streaming | Free token ✅ | Auto-attach when CESIUM_ION_TOKEN set. Hidden by default; user toggles. |
| 3D | Photoreal 3D | Google Maps Platform 3D Tiles | streaming | Free key ✅ | Auto-attach when GOOGLE_MAPS_API_KEY set. Full Google Earth mesh. |
| **SPACE** | Launches | LL2 `upcoming/` + `previous/` | 30m | Anonymous (~15/h) | T-72h to T+72h window. Lime green within ±1h of net (active), yellow upcoming, fading recent. Concentric ring + countdown label. |
| **ALERTS** | Tsunami | NWS `alerts/active?event=Tsunami…` | 2m | None | Active warnings/watches/advisories. |
| ALERTS | Severe Wx | NWS `alerts/active` (filtered) | 2m | None | Tornado / Severe Tstm / Flash Flood / Hurricane / Winter / Fire Wx etc. ~70 active. |
| ALERTS | Events | NASA EONET v3 `events?status=open` | 15m | None | 200 curated natural events. |

**Always-on telemetry header (no toggle):**
- UTC clock (1 Hz)
- Cursor lat/lon (mouse-move pick on globe)
- Camera altitude (carto height)
- Kp index (NOAA SWPC, color-tiered: quiet/active/storm)
- Solar wind speed (DSCOVR plasma)
- X-ray flare class (GOES, color-tiered: A/B/C/M/X)
- Tracked entity total

---

## File map (current)

```
C:/Users/dbhav/Projects/vantage/
├── HANDOFF.md                       ← this file
├── RESEARCH.md                      ← 60+ public API catalog (read second)
├── PLAN.md                          ← original phased plan
├── README.md                        ← user-facing quick-start
├── pyproject.toml                   ← uv project, Python 3.13
├── .python-version                  ← 3.13 (pythonnet doesn't load on 3.14)
├── .env                             ← gitignored; all 4 free-tier keys live
├── .env.example                     ← committed template (placeholders only)
├── main.py                          ← pywebview launcher
├── vantage/
│   ├── server.py                    ← FastAPI lifespan + 16 feeds
│   ├── state.py                     ← Generic StateStore (layers + meta)
│   └── feeds/
│       ├── adsb.py                  ← OpenSky
│       ├── ais.py                   ← AISStream
│       ├── airports.py              ← OurAirports
│       ├── aurora.py                ← NOAA SWPC Ovation
│       ├── cables.py                ← TeleGeography
│       ├── fires.py                 ← NASA FIRMS
│       ├── hurricanes.py            ← NOAA NHC
│       ├── launches.py              ← Launch Library 2
│       ├── news.py                  ← NASA EONET (function name `gdelt_loop` — kept for import compat after a feed-source pivot)
│       ├── quakes.py                ← USGS
│       ├── radar.py                 ← RainViewer
│       ├── satellites.py            ← Celestrak
│       ├── space_weather.py         ← NOAA SWPC Kp/plasma/x-ray
│       ├── tfrs.py                  ← FAA TFR
│       ├── tsunamis.py              ← NWS (splits into tsunamis + severe)
│       └── volcanoes.py             ← Smithsonian GVP
└── web/
    ├── index.html                   ← HUD layout, toggles, panels
    ├── style.css                    ← Vantor-inspired telemetry HUD
    └── app.js                       ← Cesium init, WS handler, layers, LOD
```

---

## Lessons learned (the why behind decisions)

### L1. **Don wants tiny constant-size dots until real model assets land.**
First attempt: SVG silhouettes (planes / ships / volcanoes / hurricanes / launches) with heading-rotated billboards and `scaleByDistance` LOD curves. Don rejected — "icons WAY too big when zoomed in," then "they should all be tiny dots, the same size when zoomed out AND when zoomed in… no need for special icons for most things." Reverted in commit `864f0de`.

**Rule going forward:** dots only, until we have actual type-specific glTF models (e.g., a real airliner / fighter / heli mesh, not a generic silhouette). The SVG scaffolding was deleted — when models land, build a separate billboard/model layer using DistanceDisplayCondition to swap between dot ↔ model at very-close zoom (<50 km). Don't reintroduce generic silhouettes.

### L2. **"Active events only" with ±72h windows + color shifts.**
Don's spec late in the session: "I only want to see active events… 72hrs before upcoming events, active events, and 72hrs after… Change color when actually happening."

Implementation:
- **Quakes** — USGS feed switched from `all_day` to `all_week`; server-side cutoff at 72h. Client computes `ageHours = (now - quake.time) / 3.6e6` and dims by `ageAlpha()` (white-hot at <1h M3+, fading to 25% by 72h).
- **Wildfires** — FIRMS extended from `world/1` to `world/3`. Client derives age from `acq_date + acq_time` ISO and applies same fade.
- **Launches** — pulls both `upcoming/` and `previous/` endpoints. Client colors by `dt = net - now`: `|dt|<1h → lime green` (active), `dt>0 → yellow` (upcoming), `dt<-1h → fading yellow` (recent).
- **Volcanoes** — kept the GVP Holocene catalog (1215) but tag each with `active = last_eruption_year ≥ now - 10`. Active ones bright red, rest dim grey. (We tried the GVP `E3WeeklyReport` WFS layer — it 400s, the typeName doesn't actually exist on the server.)

The `ageAlpha(ageH, windowH)` helper in `web/app.js` is the canonical fade — reuse it for any new time-windowed layer.

### L3. **Failed feed sources — already tried, don't retry.**
- **GDELT GEO endpoint** — 404 with any query. The geo subtree appears retired.
- **ReliefWeb v1 / v2** — 410 / 403. API permanently retired.
- **GVP WFS `E3WeeklyReport` typeName** — 400 Bad Request, the layer doesn't exist on the server despite docs.
- **FAA per-TFR XML detail (`save_pages/detail_*.xml`)** — 404 since FAA migrated to the `tfr3` Nuxt SPA. Boundary polygons aren't on a public endpoint we found.
- **Blitzortung lightning** — community-reverse-engineered WS protocol, ToS forbids 3rd-party clients. Saratoga free tier is too rate-limited to be worth it.

### L4. **TFR pragmatic compromise — state-centroid plotting.**
FAA's `exportTfrList` returns `notam_id / type / state / description / created` but no lat/lon. A hand-coded `STATE_CENTROIDS` lookup (50 + DC + 5 territories) gets each TFR onto the map at the right state. Description carries the actual location text — visible in the side panel on click. Future: scrape per-TFR XML from the FAA archive (the old URLs may still work for some IDs) or register for FAA NOTAM API key.

### L5. **NASA GIBS is gold for free imagery overlays.**
No key, no rate limit, dozens of layers. We use VIIRS Black Marble (`VIIRS_Black_Marble`) for the night-lights overlay. The Cesium imagery-layer tricks `nightAlpha=1.0 / dayAlpha=0` make it visible only on the dark side of the globe — beautiful. Future GIBS layers in queue: `MODIS_Aqua_Sea_Surface_Temp_L2`, `MODIS_Terra_Aerosol`, `AMSR2_Snow_Cover`, etc.

### L6. **3D content (Cesium ion, Google 3D Tiles) auto-attach on free keys.**
Both register their tilesets at viewer init and store `show=false`. The toggle just flips `tileset.show`. The toggle starts disabled in HTML; `enable3DLayer()` removes the disabled state once the tileset successfully attaches. This is the right pattern for any future key-gated layer.

### L7. **The Cesium ion JWT was pasted twice concatenated** — Don's editor or paste action appended the same JWT twice. The token is exactly 233 chars; if you see ~466 chars, slice it in half. Documented in `.env`.

### L8. **`.env` security incident protocol**: Don pasted real keys into `.env.example` (the committed template). I caught it before commit, moved them to `.env` (gitignored), and restored `.env.example` to placeholders. **Always check `.env.example` for non-empty values before any `git add`.**

### L9. **OpenSky anonymous rate-limit (~5–10/min) hits often.** 15s poll cadence is right; the loop already 60s-backs-off on 429. During testing the planes layer is often empty for the first few minutes — that's the rate limit, not a bug.

### L10. **Two pythonw processes can race for port 8731.** When relaunching, the old one sometimes outlives `WM_CLOSE` for a few seconds; the new pywebview window may then connect to the stale server with empty state. If you see the window with 0 entities for everything, check for stale pythonw processes (`tasklist | grep pythonw`). Solution: WM_CLOSE → wait 4s → relaunch.

### L11. **Constant-size dots use `point.pixelSize` (pixels) not size scaling.** Cesium screen-space points stay the same on-screen regardless of zoom — perfect for "always tiny dots." NearFarScalar / scaleByDistance is only relevant for billboards (which we're not using).

### L12. **State-store generic layer pattern is good infrastructure.**
Adding a new feed = (a) write `feeds/X.py` that calls `state.replace_layer("X", entries)`, (b) add `"X": {}` to `state.layers`, (c) add `"X": expire_sec` to `EXPIRE_SEC` if rolling, (d) import + register in `server.py` lifespan, (e) add toggle in `web/index.html`, (f) handle `case 'X':` in `web/app.js graphicsFor()`, (g) optionally add to `CATEGORY` and `KIND_LABEL`. ~10 minutes per new layer with this pattern.

---

## Open threads / next steps (priority order)

### Immediate next bundle (highest value, all on RESEARCH.md)

1. **Aviation airspace overlay** (incomplete from this session — Don asked, deferred). OpenAIP is the standard — free key from https://www.openaip.net/users/api → fetches GeoJSON of Class A/B/C/D + Special Use Airspace polygons. Render polygons with class-coded fills (Class B blue, Class D magenta, etc.). Toggle in AIR category. Falls back gracefully when no key.

2. **Hurricane forecast cones**. NHC publishes 5-day cone GeoJSON per active storm. Extend `feeds/hurricanes.py` to also fetch `https://www.nhc.noaa.gov/storm_graphics/api/{stormid}_5day_latest.kmz` (or the archive equivalent). Add a polygon entity per cone next to the position dot. Off-season today so this won't visually change much immediately.

3. **NASA DONKI space-weather events**. CME / GST / RBE pulses from `https://api.nasa.gov/DONKI/{type}` (DEMO_KEY works for low rate; better with a free api.nasa.gov key). Render as transient pulsing rings on the sun-facing side. Pairs with the Kp/aurora/X-ray header chips already in the HUD.

### Aviation completion (the asked-for "aviation overlay")

4. **Per-TFR boundary polygons**. Try `https://tfr.faa.gov/save_pages/detail_{notam_id_with_underscore}.xml` — it 404s for some IDs but may work for older ones. Fallback: register for the FAA NOTAM API and pull formal NOTAMs that include polygon coordinates.

5. **Airport activity** derived from existing ADS-B data. For each airport in the airports layer, count planes within ~50 km; color/size dots by plane density. Update once per ADS-B refresh (15s).

6. **METAR weather**. Aviationweather.gov free API gives current weather observations at thousands of airports — `https://aviationweather.gov/data/api/?dataSource=metars&format=json`. Could either go in WEATHER category or as a per-airport popup attribute.

### Active-event coloring polish

7. **Subtle pulse animation** for events within ±1h of "active" status. Cesium `CallbackProperty` on `point.pixelSize` for size pulse, or `point.color` alpha for glow pulse. Currently active launches just static-render lime green — a 1-2 Hz pulse would make them pop.

8. **Volcanic activity status** from GVP weekly bulletin (RSS-only). Right now `active` flag is "erupted in last 10 years" — would be more accurate to use the actual weekly volcanic activity report. Tradeoff: RSS parsing vs the existing JSON catalog.

### Oceanic suite

9. **Sea surface temperature** — NASA GIBS `MODIS_Aqua_Sea_Surface_Temp_L2`. Same pattern as Black Marble (UrlTemplateImageryProvider). Beautiful color overlay.

10. **Ocean currents** — NASA OSCAR (https://podaac.jpl.nasa.gov/dataset/OSCAR_L4_OC_FINAL_V2.0) vector field. Heavier than imagery — need to sample to a manageable grid, render as Cesium polylines or a particle simulation.

11. **Global Fishing Watch** (https://globalfishingwatch.org/our-apis/) — fishing-vessel positions + illegal-fishing flags. Free key, generous rate limit. Goes in SEA category alongside ships.

12. **NOAA NDBC buoys** — sea-state, wave height, sea temp at hundreds of US offshore buoys. Static positions + live readings. Free, no key.

### 3D models for very-close zoom (the "if you have specific model icons" carve-out from L1)

13. **glTF aircraft model** — Cesium's standard `Cesium_Air.glb` (free, bundled with Cesium examples). Add a `model: { uri: '...' }` graphics block, gated to render only when distance <50 km. Heading rotation via `orientation: HeadingPitchRoll`. Then layer in type-aware variants once we have the OpenSky aircraft DB enrichment.

14. **glTF ship variants** — sketchfab CC-licensed cargo / tanker / cruise / fishing / yacht meshes. Branch on AIS type code at very-close zoom.

15. **glTF ISS / satellite buses** — NASA 3D Resources publishes the ISS model. Other sats can use a generic bus + variable solar-panel geometry.

### Static reference data

16. **Power plants** — WRI Global Power Plant Database CSV. ~30K plants worldwide. Color by fuel type (coal/gas/nuclear/hydro/solar/wind).

17. **Time zones / country borders** as toggleable Natural Earth GeoJSON polylines. Subtle dashed lines, off by default.

18. **ACLED conflict events** — armed conflict + protest geo-data. Free for non-commercial use; needs an account but no API key.

### UX polish backlog

19. **Click radius too tight** — Cesium `pick()` currently misses small dots at low zoom. Add a small click tolerance via `viewer.scene.drillPick()` or expand the pickable area.
20. **No keyboard shortcuts** — esc to close panel, l to toggle layers, t to fly home, etc.
21. **Window position not persisted** — opens at default 1600×1000 each launch.
22. **Cesium credits hidden via creditContainer trick** — verify ToS for ESRI tiles before any wider release. Personal use is fine.
23. **No "follow this entity" mode** — camera lock to a moving plane / sat would be cinematic.
24. **Detail panel JSON is raw** — could format as a key-value table per layer kind.

### Phase 3+ (already in PLAN.md, not started)

- Time scrubber / replay history (Cesium has built-in clock)
- Saved camera presets ("Pacific traffic," "Europe weather," "PDX approach")
- Personal awareness: Home Assistant + Frigate (DEFERRED, intentional)
- Cross-project hooks: Aether-clicked-entity research, Vault saving geo points

---

## Key gotchas the next agent will hit

1. **Pythonnet on Python 3.14 doesn't load `Python.Runtime.dll`.** `.python-version` pins 3.13. Don't let `uv sync` rebuild on 3.14.

2. **OpenSky 429s for the first ~3 minutes after each launch.** Not a bug. Loop backs off 60s. Planes will eventually appear.

3. **Celestrak Starlink 403s intermittently.** Intentional rate-limiting on their end. Total satellite count drops by ~500 when this hits. Other groups (stations / visual / geo / GPS / Galileo / science) keep working.

4. **`master` branch is one commit (init) — never merged from dev.** All real work is on `dev`. Promote to `master` only when ready for "release."

5. **Window position persistence not implemented.** Opens at default 1600×1000 on whatever monitor pywebview picks. Use `win32gui.SetWindowPos` to relocate.

6. **Multi-monitor screenshots:** `pyautogui.screenshot()` only sees primary; use `PIL.ImageGrab.grab(bbox=..., all_screens=True)` for monitor-1 captures.

7. **Cesium 1.121 imagery API changed** — use `viewer.imageryLayers.removeAll()` + `addImageryProvider()`, NOT the deprecated `new Viewer({imageryProvider:...})`.

8. **WebSocket message types** are layer names directly for upserts, `<layer>:reset` for full replace, `meta` for singletons. See `state.py` — adding a new layer that uses replace_layer uses `<layer>:reset` automatically.

9. **`feeds/news.py` function is named `gdelt_loop`** for import-stability reasons even though it now uses NASA EONET. Don't rename without also updating `server.py` import.

10. **`.env` keys must not get committed.** `.env` is gitignored. `.env.example` is committed and must stay placeholders. **Verify before every `git add -A`** — system reminders showed Don pasting real keys into `.env.example` once already.

11. **Window-state vs server-state mismatch.** When a stale pythonw is still bound to 8731, a new launch fails to bind silently and the window connects to the OLD server with old/empty data. Always close all Vantage windows + give 4s before relaunching.

12. **The OpenSky aircraft-DB CSV (icao24 → registration / model)** for type-aware plane icons is at `https://opensky-network.org/datasets/metadata/aircraft-database-complete-2025-01.csv` (or similar). ~50 MB. Bundle locally; don't fetch every startup.

13. **Cesium ion token had been pasted twice concatenated** — same JWT (233 chars) repeated. Slice in half before storing.

---

## Don's locked rules in effect (relevant to this project)

- **HTML/CSS/JS via pywebview** for all new visual UI. Never Tkinter or Qt.
- **Clickable file links** — all paths in chat as `file:///C:/...` with forward slashes, no backticks.
- **Direct, no fluff** communication. State what changed, what broke, what's next.
- **Don directs, AI builds.** Don doesn't write code himself.
- **Self-test before showing him.** Visual artifacts get a multimodal-vision self-test screenshot. Frontend changes get used-as-user before reaching Don.
- **Local-first, no cloud sync, no accounts.**
- **Don't auto-pick when a decision is genuinely ambiguous.** Surface options + ask.
- **Don't refactor unless asked.** Fix what's broken, leave what works.
- **No personal data in committed files.** Keys live in `.env` (gitignored).
- **Never push to remote without explicit permission.** No remote configured for Vantage anyway.

---

## Verification trail

1. All 4 free-tier keys live in `.env`: AISSTREAM_KEY ✅, FIRMS_MAP_KEY ✅, CESIUM_ION_TOKEN ✅, GOOGLE_MAPS_API_KEY ✅.
2. Backend smoke test (port 8731): `airports 5277 / fires 87167 / launches 13 / news 200 / planes 0 (rate-limited) / quakes 958 / satellites 855 / severe 69 / ships 6126 / tfrs 71 / tsunamis 0 / volcanoes 1215`.
3. Visual screenshots saved at file:///C:/tmp/vantage_v3_full.png file:///C:/tmp/vantage_lod_far.png file:///C:/tmp/vantage_lod_mid.png file:///C:/tmp/vantage_full.png — all show working state at various points in the build.
4. Window currently running on monitor 0 at (200, 150), 1600×1000. WM_CLOSE works to dismiss; SetWindowPos to relocate.
5. All 16 feeds run as asyncio tasks under FastAPI lifespan; failures log + back off, don't crash.
6. `git status` clean. Tip 79c9645 on dev. master at 9577dd9 (Phase 1 init).

---

## Quick commands

```bash
# Run the app (window opens, ~30-60s to populate)
cd C:/Users/dbhav/Projects/vantage
uv run python main.py

# Re-sync deps (after pyproject changes)
uv sync

# Smoke-test backend only (no window) — useful when iterating on feeds
.venv/Scripts/python.exe -c "
import threading, time, urllib.request, json
from vantage.server import run_server
threading.Thread(target=run_server, args=(8732,), daemon=True).start()
time.sleep(60)
data = json.loads(urllib.request.urlopen('http://127.0.0.1:8732/api/snapshot', timeout=10).read())
for n, s in sorted((data.get('layers') or {}).items()):
    print(f'  {n:14s} {len(s):>5d}')
"

# Close all Vantage windows (no admin needed)
python -c "
import win32gui, win32con, time
def cb(h, l):
    if win32gui.IsWindowVisible(h) and win32gui.GetWindowText(h) == 'Vantage':
        l.append(h)
hs = []; win32gui.EnumWindows(cb, hs)
for h in hs: win32gui.PostMessage(h, win32con.WM_CLOSE, 0, 0)
time.sleep(4)
"

# Find + raise the running window for screenshots
python -c "
import win32gui, win32con, time
def cb(h, l):
    if win32gui.IsWindowVisible(h) and win32gui.GetWindowText(h) == 'Vantage':
        l.append((h, win32gui.GetWindowRect(h)))
hs = []; win32gui.EnumWindows(cb, hs); print(hs)
"
```

---

## Memory entries to update at session end (next session does this, not this one)

If meaningful work ships next session:
- one-line update in file:///C:/Users/dbhav/.claude/projects/C--Users-dbhav-Projects/memory/MEMORY.md (Active Projects → Vantage)
- fuller note in file:///C:/Users/dbhav/.claude/projects/C--Users-dbhav-Projects/memory/project_vantage.md

---

## Starting prompt for next session

Paste this into a fresh Claude Code session under file:///C:/Users/dbhav/Projects/vantage/ :

```
Read file:///C:/Users/dbhav/Projects/vantage/HANDOFF.md top to bottom before
doing anything else. Then read file:///C:/Users/dbhav/Projects/vantage/RESEARCH.md
(60+ public APIs catalogued with status flags). Then file:///C:/Users/dbhav/Projects/vantage/PLAN.md
for the original phased plan if relevant.

Current state: Vantage Phase 2 is shipped on dev (tip 79c9645). 14 toggleable
layers across 6 categories + 4 imagery overlays + 4 telemetry signals + Vantor-
inspired HUD chrome. All 4 free-tier keys live in .env. Master branch is still
at the Phase 1 init commit; promote to master only when you decide we're ready
to release. There is no remote configured; do not push without my explicit ok.

Don's locked rules to load only as relevant:
  - file:///C:/Users/dbhav/Projects/CLAUDE.md (cross-project)
  - file:///C:/Users/dbhav/.claude/CLAUDE.md (global, includes clickable-link rule)
  - file:///C:/Users/dbhav/.claude/projects/C--Users-dbhav-Projects/memory/MEMORY.md
    (project memory index — pull project files as needed)

Behavioral rules from this session that you must respect:
  - Tiny constant-size dots for every entity. NO generic SVG silhouettes,
    NO scaleByDistance icons. Real type-specific glTF models are okay at
    very-close zoom (<50km) once the assets exist; until then, dots only.
  - Active-events filter: 72h before / during / 72h after. Color shifts when
    actually happening (active = lime green for launches, white-hot for fresh
    quakes M3+, bright red for active volcanoes). Use the existing
    ageAlpha(ageH, windowH) helper in web/app.js.
  - Direct, terse communication. State what changed and what's next. No fluff.
  - Don't auto-pick on ambiguous decisions; surface options.
  - .env contains real keys (gitignored). .env.example is the committed
    template — placeholders only. Verify before every `git add`.

Before any work, confirm Vantage still launches:
  cd C:/Users/dbhav/Projects/vantage
  # close any existing Vantage windows first (see HANDOFF "Quick commands")
  uv run python main.py
  # ~30-60s to populate. ~7000 planes, ~6000 ships (when OpenSky isn't 429),
  # ~1200 volcanoes (~30 of them active red), ~70 TFRs, etc.

Ranked next-bundle queue (from HANDOFF "Open threads"):
  1. Aviation airspace polygons (OpenAIP, free key)
  2. Hurricane forecast cones (NHC GeoJSON)
  3. NASA DONKI space-weather events
  4. Per-TFR boundary polygons OR airport activity (derived from ADS-B)
  5. Sea surface temperature / ocean currents / Global Fishing Watch
  6. glTF 3D models for very-close zoom — first real-icon work allowed

Ask Don: "Which next? Or are you driving the running window first to shake
out the current build?" — DO NOT auto-pick.

Effort: medium by default. Don will say /effort if he wants to change.
```

---

*End of handoff. Window is currently running. Safe to close it before working.*
