# Cupola — Session Handoff (2026-05-02)

> **Session:** 2026-05-01 → 2026-05-02 (overnight)
> **Repo state:** branch `dev` clean, working tree clean.
> **Tip:** `2448a4a rename: Overwatch → Cupola`
> **Branches:**
>   - `master` — `9577dd9` (Phase 1 init only — never merged from dev)
>   - `dev` — `2448a4a` (current)
>   - `feat/phase2-layers` — already merged to dev, safe to delete (local only)
> **GitHub remote:** https://github.com/dbhavery/cupola — **PUBLIC**, default branch `dev`
> **Local working dir:** still `C:/Users/dbhav/Projects/vantage/` on disk (outer rename deferred)
> **Window status:** **NOT running** as of writeup time. Bring up with `uv run python main.py`.

For the next agent: read this top-to-bottom, then file:///C:/Users/dbhav/Projects/vantage/RESEARCH.md
(60+ public APIs catalog) and file:///C:/Users/dbhav/Projects/vantage/PLAN.md (original phased plan)
only as needed. The "Starting prompt" at the bottom is what Don will paste to boot you.

---

## TL;DR — What this session shipped

**11 commits on `dev` between `79c9645` (Phase-2 tip from yesterday) and `2448a4a` (now):**

```
2448a4a  rename: Overwatch → Cupola                                  ← current
95c20e4  fix: UTC clock no-jump + compass top-right + bigger settings gear
66c7243  feat: OpenSky OAuth2 (client_credentials) — replaces USER/PASS
c9ba78f  docs: README rewrite for public repo install + feature catalog
17f4b7f  fix: contrasting cursor + ion imagery + OpenSky auth + LOD/CPU trim
c1363fa  feat: 17-item polish bundle + glTF plane model at close zoom
d9834b4  ui: header monitoring toggles + lengthen sidebar + drop view picker
5dee328  rename: Vantage → Overwatch                                ← interim rename
d78a70d  feat: defaults off + 500ms hover + monitoring sidebar + settings modal
409fca8  feat: three-tier LOD — clustering + importance gating + near-zoom fade
0ebc13a  feat: Parcels layer (LAND category) — nationwide tiles + WA viewport vector
e0b245f  feat: cursor hover tooltip + Alerts/Warnings window with toggleable filters
```

Project went from **Vantage → Overwatch → Cupola** in one session. Final name: **Cupola**
(after the ISS Earth-observation module). Repo is **public**, `dev` is default branch.

---

## Major feature additions (chronological)

### 1. Cursor hover popup (`e0b245f`)
- `MOUSE_MOVE` → `viewer.scene.pick(endPosition)` → if entity, show floating tip
- 500 ms dwell delay before tip appears (configurable in Settings 0–2000 ms)
- Per-kind summarizers in `summarizeEntity()` — planes show alt/speed/heading,
  ships show SOG/COG/type, quakes show age + depth, launches show countdown,
  volcanoes flag ACTIVE, parcels show address + assessed value, etc.
- Viewport-clamped position so the tip never clips off-edge
- Hover scale: dot grows 1.7× while tip is up, restored on leave

### 2. Alerts & Warnings panel (`e0b245f`, refined in `d9834b4`, `d78a70d`)
- **Original**: floating draggable modal anchored top-center
- **Refactored to docked panel** at bottom-center, `#alerts-panel`, no drag/collapse
- Eight filter chips (Tsunami / Severe Wx / Storms / TFRs / Quakes M4+ /
  Volcanoes / Launches T±3h / EONET) with per-kind live counts
- Severity-bordered scrollable list capped at 60 rows
- Click row → flyTo + open detail panel
- **Toggled via header ALERTS pill** (final architecture)
- Recomputes on snapshot/reset and every 30 s for time-windowed items

### 3. Parcels layer — new LAND category (`0ebc13a`)
- **Nationwide US** (`parcels_us`): Regrid public tile cache as Cesium imagery
  overlay (z=14–17 only), no key, no rate limit. URL:
  `https://tiles.arcgis.com/tiles/KzeiCaQsMoeCfoCq/arcgis/rest/services/Regrid_Nationwide_Parcel_Boundaries_v1/MapServer/tile/{z}/{y}/{x}`
- **WA detailed** (`parcels_wa`): WA statewide FeatureServer queried client-side
  from camera viewport. Only fetches when alt < 4 km, drops at > 6 km.
  URL: `https://services.arcgis.com/jsIt88o09Q0r1j8h/arcgis/rest/services/Current_Parcels/FeatureServer/0/query`
- Hover/click shows situs address, city, combined assessed value (land + bldg)
- **Owner names not available** — WA statewide redacts owner per state policy.
  Regrid keeps owner data behind paid API (~$500/mo).

### 4. Three-tier LOD — clustering + DDC + stationary fade (`409fca8`, perf-trimmed in `17f4b7f`)
- **Clustering** via Cesium `EntityCluster` on planes/ships/fires/airports/satellites/quakes
- **Importance gating** via `DistanceDisplayCondition` per attribute:
  - Quakes: M5+ always; M4+ to 15 Mm; M3+ to 5 Mm; tiny only at <500 km
  - Fires: FRP≥100 to 15 Mm; ≥30 to 5 Mm; ≥10 to 1.5 Mm; tiny at <500 km
  - Airports: large always; medium to 5 Mm; small to 1.5 Mm
  - Volcanoes: active always; non-active to 5 Mm
  - Sats: stations/visual/science always; bulk constellations to 30 Mm
- **Near-zoom stationary fade**: airports/volcanoes/cables/TFRs/hurricanes hidden
  when distance < 10 km so parcels can own the close view

### 5. Defaults all off (`d78a70d`)
- Every layer checkbox starts unchecked. Categories stay `<details open>`.
- `applyInitialLayerState()` runs at boot to align Cesium `CustomDataSource.show`
  (which defaults to `true`) with the unchecked UI by dispatching synthetic
  `change` events on each checkbox.
- Solar-wind chip removed from telemetry header. KP and X-RAY remain.
- Layer toggle fade-in animation deliberately deferred (touched too many call
  sites for safe inclusion).

### 6. Settings modal (`d78a70d`, refined `d9834b4`, `c1363fa`)
- Gear button in top telemetry bar (36×32 px after `95c20e4`).
- Sections:
  - **UNITS**: Metric / US Customary radio. `formatAltitude()` switches header
    between km/Mm and ft/mi/k mi. Header label flips to "ALT (US)".
  - **VIEW** section was added then dropped (`d9834b4`) — only Globe in scope.
  - **HOVER**: tooltip-delay slider (0–2000 ms).
  - **SOUND**: optional WebAudio beep on new tsunami / active launch.
  - **CAMERA PRESETS**: list with click-to-fly + delete.
- Persisted to `localStorage` key `cupola.settings.v1`.

### 7. Header monitoring pills (`d9834b4`)
- Two new buttons in top telemetry bar: **ALERTS** and **FEED**
- ALERTS pill shows live unfiltered total in a red chip
- `aria-pressed` drives on/off state and tinted accent ring when active
- Removed sidebar MONITORING category and settings-modal mirror — header
  is now the single source of truth

### 8. 17-item polish bundle (`c1363fa`, perf-trimmed in `17f4b7f`)
| # | Feature | Status |
|---|---|---|
| 1 | Pulse on critical alerts | ✓ tsunamis / M5+ fresh quakes / active launches / tornado-flash-flood (capped at 12, volcanoes excluded for perf) |
| 2 | Layer toggle fade-in | deferred |
| 3 | Chip flicker on fresh data | ✓ green pulse on noteFeed() |
| 4 | Hover scale | ✓ pixelSize ×1.7 |
| 5 | Click ripple on globe | ✓ ground-clamped expanding outline |
| 6 | Compass + tilt | ✓ SVG, top-right after `95c20e4` |
| 7 | Crosshair cursor | ✓ white-stroke + black halo (`17f4b7f`) |
| 8 | Vignette parallax | ✓ rAF-batched (`17f4b7f`) |
| 9 | Boot reveal | ✓ letter-spacing reveal + globe fade |
| 10 | Camera presets | ✓ in Settings |
| 11 | Recent-clicked history strip | ✓ bottom-center, capped at 5 |
| 12 | Right-click center | ✓ context menu with lat/lon |
| 13 | Telemetry digit roll | ✓ altitude only; UTC removed (`95c20e4` — was jumping every second) |
| 14 | Sound effects | ✓ WebAudio, off by default |
| 15 | glTF plane model swap | ✓ Cesium_Air.glb under 50 km |
| 16 | Terminator ground glow | replaced by atmosphereLightIntensity bump |
| 17 | Atmospheric scattering | ✓ hue/sat/brightness shifts, ground atmosphere |

### 9. CPU/LOD perf trim (`17f4b7f`)
- Compass moved off `scene.preRender` (60 fps DOM writes) onto `camera.changed`
  (fires only on actual movement). `camera.percentageChanged = 0.001`.
- Vignette parallax mousemove → `requestAnimationFrame`-batched (was DOM-write
  per move event).
- Pulse animations capped at 12 entities. Volcanoes dropped from pulse list
  entirely (was attaching CallbackProperties to all 141 active volcanoes).

### 10. Higher-res base imagery (`17f4b7f`)
- When `CESIUM_ION_TOKEN` is set, base layer switches from ESRI World Imagery
  (z=19 cap) to **Cesium ion World Imagery** (asset 2, Bing-backed, z=21+).
  Significantly sharper at city/block scale.
- `viewer.scene.maximumScreenSpaceError = 1.5` for denser tile fetches.
- ESRI remains the fallback when no token.

### 11. OpenSky OAuth2 migration (`66c7243`)
- OpenSky migrated /api/states/all to OAuth2 client_credentials in 2025;
  basic auth deprecating.
- `cupola/feeds/adsb.py` now reads **OPENSKY_CLIENT_ID / OPENSKY_CLIENT_SECRET**
  from env (preferred), falls back to OPENSKY_USER / OPENSKY_PASS for legacy.
- Token cached with `expires_in` window (default 1800 s), refreshes ~30 s
  before expiry. On 401, invalidates cached token and refetches.
- Token endpoint: `https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token`
- **Verified live**: 6 s cadence pulling ~5900 plane states per poll.

### 12. UTC no-jump + compass move + bigger settings (`95c20e4`)
- UTC clock was wrapped in `digit-roll` keyframe — animation fired every
  second by definition, jarring. Dropped roll for UTC, kept for altitude.
- Compass moved from bottom-right (overlapping feed strip + history strip)
  to top-right just below telemetry bar. Auto-hides via `:has()` when right
  detail panel opens.
- Settings gear bumped from 28×28 to 36×32 with filled background and
  accent-tinted hover.

### 13. Renames: Vantage → Overwatch → Cupola
- **Vantage → Overwatch** (`5dee328`): rename pass after Don decided. Trademark
  flag raised on Overwatch (Blizzard).
- **Overwatch → Cupola** (`2448a4a`): final name. Cupola = ISS Earth-observation
  module, on-theme, no software trademark collision.
- Each rename touched: Python package dir, all imports, pyproject.toml,
  hatch wheel target, window title, HUD brand text, httpx User-Agents,
  localStorage keys, README, .env.example.
- **Outer folder still `Projects/vantage/`** — never renamed. Memory pointers
  still reference that path. Move when convenient.

### 14. Public GitHub repo
- Created at `dbhavery/overwatch` (initially private).
- Made public per Don's "send to family member" need.
- Renamed to `dbhavery/cupola`. Old URL 301-redirects.
- Default branch is **`dev`** — fresh clones land on working code.
- `master` still at `9577dd9` Phase-1 init.

---

## Architecture (current)

```
┌─────────────────────────────────────────────────────────┐
│ pywebview window (Cupola)                               │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ CesiumJS 1.121 + satellite-js 5.0                   │ │
│ │ ─ Base imagery: Cesium ion (Bing) or ESRI fallback  │ │
│ │ ─ Optional: Black Marble (night), Radar, Aurora     │ │
│ │   canvas, OSM Buildings, Google 3D Tiles, Regrid    │ │
│ │   parcel tiles                                      │ │
│ │ ─ 13 entity data sources (clustered where needed)   │ │
│ │ ─ Cables / Terminator / Parcels-WA data sources     │ │
│ │ ─ HUD: top telemetry+pills+gear / left layers /     │ │
│ │   right detail panel / bottom-center alerts panel + │ │
│ │   history strip / bottom-left ticker (gated) /      │ │
│ │   bottom-right feed-health / top-right compass      │ │
│ └─────────────────────────────────────────────────────┘ │
│  ↑ HTTP fetch + WebSocket /ws live deltas               │
└──────────────────────│──────────────────────────────────┘
                       │
┌──────────────────────┴──────────────────────────────────┐
│ FastAPI server (127.0.0.1:8731) — `cupola.server`        │
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

## Layer catalog (current)

Same 14 toggleable entity layers + 4 imagery overlays + 2 3D-tile overlays
as Phase 2, plus the new **LAND** category with parcels:

| Category | Layer | Default | Notes |
|---|---|---|---|
| AIR | Planes | off | OpenSky OAuth2; 6 s cadence; glTF model swap <50 km |
| AIR | Satellites | off | Celestrak TLE × 7 groups; client-side propagation |
| AIR | Airports | off | OurAirports CSV; 5277 records; type-gated DDC |
| AIR | TFRs | off | FAA exportTfrList; ~64 active; state-centroid plot |
| SEA | Ships | off | AISStream WebSocket; ~6000 vessels |
| SEA | Hurricanes | off | NOAA NHC; off-season today (0) |
| EARTH | Earthquakes | off | USGS 7d feed, server cuts at 72h, mag-gated DDC |
| EARTH | Volcanoes | off | GVP Holocene catalog; 1215 total / 141 active-last-10y |
| EARTH | Wildfires | off | NASA FIRMS world/3 (3-day); FRP-gated DDC; FREE FIRMS_MAP_KEY |
| WEATHER | Radar | off | RainViewer imagery overlay |
| WEATHER | Aurora | off | NOAA SWPC Ovation; canvas → SingleTileImageryProvider |
| WEATHER | City Lights | off | NASA GIBS Black Marble (yearly composite) |
| WEATHER | Day/Night | off | Computed terminator + sun marker |
| REFERENCE | Subsea Cables | off | TeleGeography GeoJSON; 711 cables |
| **LAND** | **Parcels (US)** | off | Regrid free public tile cache; z=14-17 |
| **LAND** | **Parcels (WA)** | off | WA statewide FeatureServer; viewport-fetch <4km |
| 3D | Buildings (OSM) | off | Cesium ion `createOsmBuildingsAsync()` |
| 3D | Photoreal 3D | off | Google 3D Tiles |
| SPACE | Launches | off | LL2 ±72h window |
| ALERTS | Tsunami | off | NWS active alerts |
| ALERTS | Severe Wx | off | NWS filtered |
| ALERTS | Events | off | EONET v3 (currently 500-erroring) |

**Always-on telemetry**: UTC clock · cursor lat/lon · camera altitude (units-aware) · Kp · X-ray flare class · tracked-entity total

**Header pills**: ALERTS (with live count) · FEED · ⚙ Settings

---

## File map (current)

```
C:/Users/dbhav/Projects/vantage/         ← outer folder still 'vantage' on disk
├── HANDOFF.md                       ← this file (rewritten 2026-05-02)
├── RESEARCH.md                      ← 60+ public APIs (read second)
├── PLAN.md                          ← original phased plan (historical)
├── README.md                        ← user-facing install + feature catalog
├── pyproject.toml                   ← name = "cupola"
├── .python-version                  ← 3.13 (pythonnet won't load on 3.14)
├── .env                             ← gitignored; all keys live (incl. OAuth)
├── .env.example                     ← committed template
├── main.py                          ← pywebview launcher; window title "Cupola"
├── cupola/                          ← Python package (was overwatch/, was vantage/)
│   ├── server.py                    ← FastAPI + 16 feeds + lifespan
│   ├── state.py                     ← StateStore (layers + meta)
│   └── feeds/
│       ├── adsb.py                  ← OpenSky OAuth2 (NEW)
│       ├── ais.py                   ← AISStream
│       ├── airports.py              ← OurAirports
│       ├── aurora.py                ← NOAA SWPC Ovation
│       ├── cables.py                ← TeleGeography
│       ├── fires.py                 ← NASA FIRMS
│       ├── hurricanes.py            ← NOAA NHC
│       ├── launches.py              ← Launch Library 2
│       ├── news.py                  ← NASA EONET (function name `gdelt_loop`)
│       ├── quakes.py                ← USGS
│       ├── radar.py                 ← RainViewer
│       ├── satellites.py            ← Celestrak (×7 groups)
│       ├── space_weather.py         ← NOAA SWPC Kp/plasma/x-ray
│       ├── tfrs.py                  ← FAA TFR
│       ├── tsunamis.py              ← NWS
│       └── volcanoes.py             ← Smithsonian GVP
└── web/
    ├── index.html                   ← HUD layout, toggles, panels, modal
    ├── style.css                    ← Vantor-inspired HUD + animations
    └── app.js                       ← Cesium init, WS, layers, LOD, alerts,
                                      parcels, settings, presets, ripple, etc.

External (NOT in repo):
C:/Users/dbhav/cupola-transfer/      ← .env + READ_THIS_FIRST for other PC
```

---

## Lessons learned this session (the why behind decisions)

### L13. **Don wants nothing showing on launch.**
"default to nothing checked/showing" — applied across all categories. The boot
loop dispatches synthetic `change` events on every checkbox so Cesium data
sources match the unchecked state (otherwise `CustomDataSource.show` defaults
true regardless of UI).

### L14. **Hover dwell, not instant.**
"hovering over dots for more than 500ms opens info popup" — `scheduleHoverTip`
holds a timer per entity; only fires `showHoverTip` if cursor still on the same
target when the timer elapses. Configurable 0–2000 ms.

### L15. **No solar wind in header.**
"we don't need solar winds" — chip removed from telemetry. KP and X-RAY remain.

### L16. **Settings has units, not view.**
View picker (Globe / Map / Columbus) was added then explicitly removed:
"Remove 'Map' and 'Columbus', I changed my mind." Only `morphTo3D` stays as
the default; settings now show UNITS, HOVER, SOUND, CAMERA PRESETS.

### L17. **Alerts/Feed live in the header, not the sidebar or settings.**
Three iterations:
- v1: floating modal
- v2: docked panel + sidebar MONITORING category + settings mirror
- v3 (final): docked panel toggled by **header pills** (ALERTS / FEED).
  Sidebar MONITORING category and settings mirror removed.

### L18. **Use Playwright, not the physical mouse.**
Locked feedback (`feedback_no_physical_mouse_hijack.md`): never SetCursorPos,
pyautogui, or any cursor-moving API. Use Playwright synthetic events for self-
testing. Capture via `PrintWindow` API for non-foreground screenshots.

### L19. **Compass on bottom-right collides with feed strip + history strip.**
Initial compass position was `right:16, bottom:92` — overlapped both the
feed-health strip and the recent-click history. Moved to top-right
(`right:16, top:56`) where there's empty real estate. `:has()` selector
hides it when the right detail panel opens (they share the column).

### L20. **UTC digit-roll animation is wrong for a once-per-second value.**
Don: "UTC clock jumps every second." Fix: drop the `rolling` class for UTC
specifically; just `textContent` it. Altitude keeps the roll because it
changes only when the camera actually moves.

### L21. **Cursor must be visible against any background.**
Don: "I cant see my cursor now." Cyan crosshair was invisible on cyan
ocean. Fix: 28×28 SVG with white inner stroke + black outer halo + center
dot. Reads against ocean, snow, ground, dark space alike.

### L22. **OpenSky migrated to OAuth2 in 2025.**
The new `credentials.json` from OpenSky is `clientId/clientSecret`, not
username/password. Use the OAuth2 client_credentials grant against
`https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token`,
cache the bearer with its `expires_in`, refresh 30 s before expiry. Verified
live: 6 s cadence, ~5900 planes per poll.

### L23. **Pulsing 141 volcanoes is the CPU hot spot.**
`CallbackProperty` re-evaluates every frame for every entity it's wired to.
141 active volcanoes pulsing at 60 fps was visible CPU drain. Cap at 12 total
entities, exclude volcanoes entirely (they're "active in last 10 years",
not actively erupting), prioritize tsunamis / active launches / fresh M5+
quakes / tornado-flash-flood.

### L24. **Compass on `preRender` is 60 fps DOM writes — use `camera.changed`.**
Same lesson: events that fire every frame should be moved to events that fire
only when the underlying state actually changes. `camera.percentageChanged =
0.001` makes it sensitive without being noisy.

### L25. **WA statewide parcels redact owner per state policy.**
Address, city, land value, building value all available. Owner names are
redacted at the state level. Owner-name coverage requires either Regrid paid
API (~$500/mo) or per-county direct integrations (variable; some counties
expose owner via their own ArcGIS, others gate behind reCAPTCHA — Clark
County's portal is reCAPTCHA-gated).

### L26. **Trademark exposure scales with public visibility.**
"Overwatch" is fine for personal use but a public GitHub repo under that
name is a Blizzard C&D risk. Renamed pre-release to **Cupola**. The ISS
Cupola module is a clean thematic match with no software-trademark
collision. Generic English/architecture term since 1500s.

### L27. **`.env` separation discipline pre-flight.**
Before publishing the repo, audited:
1. `.gitignore` includes `.env` — confirmed.
2. `git ls-files .env` returns empty — confirmed.
3. Full git history grep for `eyJ[A-Za-z0-9_-]{20,}` (JWT prefix), AIza
   (Google), and 32-hex (FIRMS) — all clean.
4. `.env.example` reviewed for any accidental real-key paste.
Standing rule: this audit before any push to public.

---

## Open threads / next steps (priority order)

### Immediate next bundle (highest value, all on RESEARCH.md)

1. **Layer toggle fade-in animation** — deferred from polish bundle. Per-entity
   `entryTime` + `CallbackProperty` on alpha. ~45 min.
2. **NASA DONKI space-weather events** — CME / solar flare / radiation belt
   events as transient pulsing rings. Free with any api.nasa.gov key. ~45 min.
3. **Sea surface temperature overlay** — NASA GIBS MODIS_Aqua_Sea_Surface_Temp_L2.
   Free, no key. Just a tile-imagery wire-up. ~30 min.
4. **Hurricane forecast cones** — NHC publishes 5-day cone GeoJSON per active
   storm. Off-season today (0 storms). ~45 min.
5. **OpenAIP airspace polygons** — Class A/B/C/D + special use airspace.
   Free key from openaip.net. ~1 hr.
6. **NDBC buoys** — sea state / wave height / sea temp at hundreds of US
   offshore buoys. Free, no key. ~30 min.

### Aviation completion

7. **Per-TFR boundary polygons** — try the FAA archive `save_pages/detail_*.xml`
   URLs that may still work for older NOTAMs. Otherwise register for the FAA
   NOTAM API.
8. **Airport activity heatmap** — for each airport, count planes within ~50 km
   from the existing ADS-B layer; size dot by plane density.
9. **METAR weather** — aviationweather.gov free API gives current weather at
   thousands of airports.

### Oceanic suite

10. **Ocean currents** — NASA OSCAR vector field. Heavier (~2 hr): sample to a
    grid, render as polylines or a particle system.
11. **Global Fishing Watch** — fishing-vessel positions. Free key.

### glTF models for very-close zoom

12. **Type-aware aircraft models** — currently every plane uses Cesium_Air.glb
    when <50 km. Branch on OpenSky aircraft-DB (download CSV: ~50 MB) to swap
    in airliner / fighter / heli meshes.
13. **glTF ship variants** — sketchfab CC-licensed cargo/tanker/cruise/fishing
    meshes. Branch on AIS type code.
14. **glTF ISS / satellite buses** — NASA 3D Resources publishes ISS model.

### Static reference

15. **Power plants** — WRI Global Power Plant Database CSV. ~30K plants.
16. **Country borders / time zones** — Natural Earth GeoJSON polylines.
17. **ACLED conflict events** — armed conflict + protest geo data.

### UX polish backlog

18. **Click radius too tight** — `viewer.scene.pick()` misses small dots at low
    zoom. Use `drillPick()` or expand pickable area.
19. **Keyboard shortcuts** — esc to close panel, l to toggle layers, t to fly home, etc.
20. **Window position persistence** — opens at default each launch.
21. **"Follow this entity" mode** — camera lock to a moving plane / sat.
22. **Detail panel — formatted key-value table per layer kind** instead of raw JSON.

### Phase 3+ (already in PLAN.md, not started)

- Time scrubber / replay history (Cesium has built-in clock)
- Cross-project hooks: Aether-clicked-entity research, Vault saving geo points

---

## Key gotchas (the next agent will hit)

1. **Pythonnet on Python 3.14 doesn't load.** `.python-version` pins 3.13.
   Don't let `uv sync` rebuild on 3.14.
2. **OpenSky now requires OAuth2.** USER/PASS basic auth deprecating. Use
   `OPENSKY_CLIENT_ID` / `OPENSKY_CLIENT_SECRET` from the OpenSky client
   credentials.json. The legacy fallback exists but new accounts won't have it.
3. **EONET HTTP 500** intermittently — backs off 30 min on failure. Currently
   degraded as of writeup; usually recovers within a day.
4. **Celestrak Starlink 403s intermittently.** Total sat count drops by ~500
   when this hits. Other groups keep working.
5. **`master` is one commit (init) — never merged from dev.** Promote only
   when ready for "release."
6. **Outer folder is `Projects/vantage/` on disk.** Inner package is `cupola`.
   Memory pointers still reference the old path. Move when convenient.
7. **`feeds/news.py` function is `gdelt_loop`** for import-stability after
   the EONET pivot. Don't rename without updating server.py.
8. **`.env` keys must not get committed.** Verify `.env.example` before every
   `git add -A`.
9. **Cesium ion token may have been pasted twice concatenated** — slice in
   half if you see ~466 chars (token is exactly 233).
10. **Two pythonw can race for port 8731.** WM_CLOSE → 4-7 s wait → relaunch.
    If stuck, `netstat -ano | grep :8731` to find the bound pid.
11. **`PrintWindow` for non-foreground screenshots.** `pyautogui.screenshot`
    only sees primary monitor; physical mouse is forbidden per locked feedback.
12. **Cesium CustomDataSource.show defaults true.** New layers must apply the
    initial unchecked state via `applyInitialLayerState()` (or set show=false
    in `initDataSources`).
13. **CallbackProperty re-evaluates every frame.** Cap any pulse/animation
    properties at low entity counts (12 max). Volcanoes (141) hit this.
14. **`camera.preRender` fires every frame; `camera.changed` only on movement.**
    Use the latter for compass-style updates.

---

## Don's locked rules in effect (project-relevant)

- **HTML/CSS/JS via pywebview** for visual UI. Never Tkinter or Qt.
- **Clickable file links** — paths in chat as `file:///C:/...` with forward slashes.
- **Direct, no fluff** communication. State what changed, what broke, what's next.
- **Don directs, AI builds.** Don doesn't write code himself.
- **Self-test before showing him.** Visual artifacts get multimodal-vision
  self-test screenshot. Frontend changes get used-as-user before reaching Don.
- **Local-first, no cloud sync, no accounts.**
- **Don't auto-pick when a decision is genuinely ambiguous.** Surface options + ask.
- **Don't refactor unless asked.** Fix what's broken, leave what works alone.
- **No personal data in committed files.** Keys live in `.env` (gitignored).
- **NEVER hijack Don's physical mouse.** Use Playwright synthetic events.
  Locked feedback `feedback_no_physical_mouse_hijack.md`.
- **GitHub repo is PUBLIC.** Audit `.env` and history before each push.

---

## Verification trail (this session)

1. **Repo public** at https://github.com/dbhavery/cupola; default branch `dev`.
   Old `overwatch` URL 301-redirects.
2. All keys in `.env` (gitignored): AISSTREAM_KEY, FIRMS_MAP_KEY, CESIUM_ION_TOKEN,
   GOOGLE_MAPS_API_KEY, OPENSKY_CLIENT_ID, OPENSKY_CLIENT_SECRET. Local & in transfer.
3. **OpenSky OAuth2 verified live**: 5895/5894/5897 plane states across three
   consecutive 6 s polls. Token expires_in 1800 s.
4. **Cesium ion token verified**: GET /v1/me returns dbhavery/dbhavery@gmail.com.
   Asset 2 (World Imagery) endpoint returns valid Bing-backed config.
5. **Google Maps API verified**: 67 KB tileset root with valid bounding volume
   from `https://tile.googleapis.com/v1/3dtiles/root.json?key=...`.
6. **FIRMS verified**: data_availability for VIIRS_NOAA20_NRT returns 2026-03-01
   to 2026-05-02 range.
7. **Cupola import OK**: `uv run python -c "from cupola.server import run_server"`
   succeeds after rename.
8. Window launches with title "Cupola", HUD reads "CUPOLA · SITUATIONAL AWARENESS".
9. `git status` clean. Tip 2448a4a on dev.

---

## Quick commands

```bash
# Run the app
cd C:/Users/dbhav/Projects/vantage
uv run python main.py

# Re-sync deps (after pyproject changes)
uv sync

# Smoke-test backend only (no window)
.venv/Scripts/python.exe -c "
import threading, time, urllib.request, json
from cupola.server import run_server
threading.Thread(target=run_server, args=(8732,), daemon=True).start()
time.sleep(60)
data = json.loads(urllib.request.urlopen('http://127.0.0.1:8732/api/snapshot', timeout=10).read())
for n, s in sorted((data.get('layers') or {}).items()):
    print(f'  {n:14s} {len(s):>5d}')
"

# Close all Cupola windows
python -c "
import win32gui, win32con, time
def cb(h, l):
    if win32gui.IsWindowVisible(h) and win32gui.GetWindowText(h) == 'Cupola':
        l.append(h)
hs = []; win32gui.EnumWindows(cb, hs)
for h in hs: win32gui.PostMessage(h, win32con.WM_CLOSE, 0, 0)
time.sleep(7)
"

# PrintWindow capture without focus-stealing (per locked feedback)
python -c "
import win32gui, win32ui, ctypes
from PIL import Image
def cb(h, l):
    if win32gui.IsWindowVisible(h) and win32gui.GetWindowText(h) == 'Cupola':
        l.append(h)
hs = []; win32gui.EnumWindows(cb, hs); h = hs[0]
client = win32gui.GetClientRect(h); w, ht = client[2]-client[0], client[3]-client[1]
hwndDC = win32gui.GetWindowDC(h); mfcDC = win32ui.CreateDCFromHandle(hwndDC); saveDC = mfcDC.CreateCompatibleDC()
bmp = win32ui.CreateBitmap(); bmp.CreateCompatibleBitmap(mfcDC, w, ht); saveDC.SelectObject(bmp)
ctypes.windll.user32.PrintWindow(h, saveDC.GetSafeHdc(), 3)
bmpinfo = bmp.GetInfo(); bmpstr = bmp.GetBitmapBits(True)
img = Image.frombuffer('RGB', (bmpinfo['bmWidth'], bmpinfo['bmHeight']), bmpstr, 'raw', 'BGRX', 0, 1)
img.save('C:/tmp/cupola.png')
"

# Public repo URLs
#   Browser:   https://github.com/dbhavery/cupola
#   Clone:     git clone https://github.com/dbhavery/cupola.git
#   Zip:       https://github.com/dbhavery/cupola/archive/refs/heads/dev.zip

# Other PC bootstrap (no GitHub auth needed, repo is public)
#   git clone https://github.com/dbhavery/cupola.git
#   cd cupola
#   cp <C:/Users/dbhav/cupola-transfer/.env> .
#   uv sync
#   uv run python main.py
```

---

## Memory entries to update at session end

If meaningful work ships next session:
- one-line update in file:///C:/Users/dbhav/.claude/projects/C--Users-dbhav-Projects/memory/MEMORY.md
  (Active Projects → Cupola)
- fuller note in file:///C:/Users/dbhav/.claude/projects/C--Users-dbhav-Projects/memory/project_cupola.md
  (consolidate from project_vantage.md if still present)

---

## Starting prompt for next session

Paste this into a fresh Claude Code session under file:///C:/Users/dbhav/Projects/vantage/ :

```
Read file:///C:/Users/dbhav/Projects/vantage/HANDOFF.md top to bottom before
doing anything else. Then file:///C:/Users/dbhav/Projects/vantage/RESEARCH.md
and file:///C:/Users/dbhav/Projects/vantage/PLAN.md as needed.

Current state: Cupola (renamed from Overwatch, originally Vantage). Tip
2448a4a on dev. Public GitHub at https://github.com/dbhavery/cupola.
14 toggleable entity layers + 4 imagery overlays + 2 3D overlays + LAND
parcels + telemetry HUD + alerts/feed header pills + settings modal +
camera presets + recent-click history + compass + crosshair + Cesium ion
World Imagery base + atmospheric scattering + glTF plane swap at <50 km.
All 5 free-tier keys + OpenSky OAuth2 in .env. Repo is public; verify
.env before any git add. master still at 9577dd9 init.

Don's locked rules to load only as relevant:
  - file:///C:/Users/dbhav/Projects/CLAUDE.md (cross-project)
  - file:///C:/Users/dbhav/.claude/CLAUDE.md (global, clickable-link rule)
  - file:///C:/Users/dbhav/.claude/projects/C--Users-dbhav-Projects/memory/MEMORY.md
  - feedback_no_physical_mouse_hijack.md — never SetCursorPos/pyautogui;
    use Playwright synthetic events; PrintWindow for screenshots.

Behavioral rules from this session:
  - Tiny constant-size dots only. No SVG silhouettes. glTF models OK at
    <50 km via DistanceDisplayCondition. Cesium_Air.glb already wired for
    planes; ships and sats still pending.
  - Active-events filter: 72h before/during/72h after; ageAlpha helper.
  - All layers default unchecked; categories <details open>; boot
    dispatches synthetic 'change' to align CesiumJS state.
  - Hover requires 500ms dwell; configurable in Settings.
  - Header pills (ALERTS / FEED) toggle the docked panels. No sidebar
    MONITORING category; no settings monitoring mirror.
  - UTC clock no animation. Altitude rolls only on actual change.
  - Solar wind chip removed.
  - Compass top-right (right:16 top:56), auto-hides when detail panel open.
  - Cursor: white-stroke + black halo + center dot.
  - CallbackProperty animations capped (12 entities max for pulse).
  - CPU-tight events (compass etc.) on camera.changed not preRender.

Before any work, confirm Cupola still launches:
  cd C:/Users/dbhav/Projects/vantage
  # close any existing Cupola windows first (see HANDOFF "Quick commands")
  uv run python main.py
  # ~30s to populate. Toggle layers in the sidebar to populate the globe.

Ranked next-bundle queue (from HANDOFF "Open threads"):
  1. Layer toggle fade-in animation (deferred from polish bundle)
  2. NASA DONKI space-weather pulses (CME / solar flares / RBE)
  3. NASA GIBS sea surface temperature overlay
  4. NHC hurricane forecast cones
  5. OpenAIP airspace polygons (Class A/B/C/D + SUA)
  6. NDBC buoy network
  7. Per-TFR boundary polygons OR airport-density heatmap
  8. glTF type-aware plane swap; ship glTF variants

Ask Don: "Which next? Or are you driving the running window first to
shake out the current build?" — DO NOT auto-pick on ambiguous decisions;
small UX polish where Don directed is OK to just execute.

Effort: medium by default. Don will say /effort if he wants to change.
```

---

*End of handoff. Tip 2448a4a on dev. Repo public at https://github.com/dbhavery/cupola.*
