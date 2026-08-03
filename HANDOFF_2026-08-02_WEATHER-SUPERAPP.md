# Graticule — Session Handoff (2026-08-02)

> **Session:** 2026-08-02, single session.
> **Repo state:** branch `dev`, working tree **clean**.
> **Tip:** `5458c60 [FIX] Cities layer crashed the renderer; guard NaN positions; cluster colour`
> **Pushed:** yes — `origin/dev` = `5458c60` at github.com/dbhavery/graticule
> **Base this session branched from:** `da2d4fc [repo] add LICENSE, CI, fix em-dash in description`
> **Server:** was running on port 8731 at writeup time. Kill with the port recipe below.
>
> **Read order for the next agent:** this file top-to-bottom, then
> file:///C:/Users/dbhav/Projects/graticule/issues.md (two open defects, one
> with a fix sketch). `HANDOFF.md` and `HANDOFF_2026-05-02_GRATICULE.md` are
> **HISTORICAL** — they predate the rename from Cupola and describe a UI that
> no longer exists. Do not trust them for current state.

---

## TL;DR

Don asked for three things, sourced from two YouTube videos he supplied:

1. Make the Earth **completely realistic** — real-time sun and moon, day/night,
   toggleable weather clouds. He called this "the main part of the app".
2. **Stay centred on North America** with the sunlight and darkness rotating in
   real time around it.
3. **Everything toggled in tabs**, and rework the UI to look like high-end
   weather apps. Verbatim: *"Graticule looks too cheap and amateurish. We need
   to step this up to pro level."*

Plus: "add every option in these videos that we do not already have."

Six commits, +2,850/−109 lines across 6 files. All three delivered. Four
pre-existing bugs found and fixed along the way, including one that meant
**radar imagery had never rendered in this app** and one that **crashed the
renderer outright**.

```
5458c60  [FIX] Cities layer crashed the renderer; guard NaN positions; cluster colour
f27d195  [WX]  Fix single-site radar URL, dedupe layer toggles, detail panels
da9c901  [WX]  Local storm reports, drawing tools, map theme picker
7595d96  [WX]  Real weather data: models, obs, AQI, NWS warning cards, GOES
a92f205  [UI]  Tabbed pro rework + radar timeline, legend, SPC outlooks, WORLD tab
ebe6be0  [EARTH] Realistic Earth: real-time sun, moon, night lights, NA lock
```

---

## The source material

Both videos were watched in full. Transcripts and frames are in the session
scratchpad (ephemeral); the durable extraction is below.

### Video 1 — StormCat5, "I Tested Every Major Weather Radar App to Find the Best One" (25 min)

https://www.youtube.com/watch?v=W4Qg0_vxKiE

Scores out of 10: **Weatherfront 9.25 · WeatherWise 9 · RadarScope 8 · Radar
Omega 8 · MyRadar 7 · GR Earth/Analyst 7 · Weather Channel 5.**

His comparison chart (23:44) is the canonical capability list — eight rows:

| Row | Graticule status after this session |
|---|---|
| National Radar | **done** (now actually renders; see Bug 1) |
| Local Hi-Res Radar | **done** — 30 NEXRAD sites, reflectivity + velocity |
| Satellite | **done** — GOES-East/West vis/IR/WV + global true colour |
| Warnings | **done** — RadarScope-style cards + polygons |
| Storm Chaser Feeds | **not possible** — requires per-chaser partnerships |
| Weather Models | **done** — GFS/HRRR/NAM/ECMWF/ICON via Open-Meteo |
| Webcams | **key-gated** — Windy needs `WINDY_WEBCAM_KEY` |
| Custom Graphics | **not started** — see Open Items |

Layer lists pulled from the app UIs in the video, used to drive scope:

- **MyRadar:** Winds, Temperatures, Clouds, Weather Alerts, Outlooks, Hurricane
  Tracker, Fronts, Road Weather, Air Quality, Aviation, Orbital Tracking,
  Storm Chasers/Live Cameras, Earthquakes, Wildfires, Power Outages. Each row
  is a toggle **plus a gear** for per-layer settings.
- **GR Earth:** globe view, layer checkboxes (SPC/Watch/GOES/Meso/Radar/METAR/
  Lightning/Warning/Watch/Spotters), radar products (BR QC, CR QC, HSR, MEHS,
  ROT, QPE 1hr/12hr, LTNG 30m), METAR selectors, and a large mesoanalysis grid
  (SBCAPE/MUCAPE/MLCAPE/CIN/LCL/LFC/EBWD/SRH/ESRH/SCP/STP/2mT/850T/700VV/500RV).
- **RadarScope Pro:** left warnings list with rich cards (type, "expires in
  18m", counties, `Hail: <.75"`, `Wind: 60 mph`, `Tornado: Possible`), product
  header `KRAX — Raleigh-Durham, NC / VCP 212`, tilt selector, dBZ bar across
  the bottom, single/dual/quad pane buttons, drawing.
- **Radar Omega:** "Single Site" dropdown, `VCP 212: Precip Mode` badge,
  `19 ALERTS` chip, camera popups with live sensor readouts and trend charts,
  weather models, drawing, elevation/tilt.
- **Weatherfront (winner):** left panel with Data | NWS Alerts tabs, chip row
  (Radar/Model/Satellite/Observations/Outlooks/Mapping), dropdowns
  (`SATELLITE: GOES-East`, `VIEW: Full Disk`), collapsible groups (ABI
  Channels, RGB Products → Color Composites / Atmospheric / Fire), model panel
  with `MODEL`/`INIT TIME`/`FORECAST HOUR` plus Single | Compare Runs | Compare
  Models, timeline scrubber with forecast-hour ticks, timestamp chip top-left,
  colour bar right. Broadcast build adds presentation mode, custom map styles,
  county selection and area darkening.

**The UI shape adopted for Graticule comes from Weatherfront**, because it
scored highest and its layout generalises: tabs → mode chips → contextual
controls, with a transport timeline and a persistent colour scale.

### Video 2 — LiveStream07, "World Population Reaches 8.3 Billion People!" (8.7 min)

https://www.youtube.com/watch?v=D1GZq1qiVHU

**Music only — no narration.** Every frame is the same static dashboard; only
the numbers tick. All information is visual, extracted from frames.

Content: giant rolling world-population odometer with a pulsing `LIVE` badge;
TODAY panel (births/deaths/growth); THIS YEAR panel; CONTINENT ranks; BIG
RELIGION ranks; POPULATION NEXT MILESTONE with 30s/1m/2m/5m/10m/20m columns and
`ACHIEVED` states; TOP 15 COUNTRIES and REST OF COUNTRIES with up/down delta
arrows and flags; UTC timestamp footer.

> **★ Process note.** I used `AskUserQuestion` to check whether a silent video
> was really in scope. Don's reply: *"I know the world population does not have
> narration, but it has visuals, it has data. It has things I want you to
> include in the app. That's why I told you to watch them."*
> Media Don hands over is in scope because of **what is on screen**. Do not ask.
> Captured as memory `feedback-shared-media-is-in-scope-for-its-visuals`.

---

## What shipped

### 1. Realistic Earth — `ebe6be0`

**Why it looked cheap:** `viewer.clock` was never animated, so Cesium's sun
vector never moved, and `globe.enableLighting` defaulted to `false`. The result
was a uniformly lit plastic sphere. The old "Day/Night" layer was a **dashed
polyline drawn on top of that** — a cosmetic annotation, not real shading.

**Now,** in `initRealisticEarth()` (web/app.js):

- `clock.clockStep = SYSTEM_CLOCK`, `shouldAnimate = true` → terminator sweeps
  at a true 15°/hour, matching real UTC to the second.
- `globe.enableLighting`, `dynamicAtmosphereLighting`,
  `dynamicAtmosphereLightingFromSun`, widened `atmosphereBrightnessShift` for a
  realistic dusk band rather than Cesium's hard ~1px cut.
- VIIRS city lights via `dayAlpha = 0 / nightAlpha = 1` — glow on the night
  hemisphere only.
- `scene.moon` with true ephemeris position and phase, `skyBox` stars,
  `highDynamicRange`, lens-flare post-process stage.
- Telemetry bar gained **SUN** (subsolar lat/lon) and **MOON** (phase glyph,
  name, % illuminated). Sun position comes from the same ephemeris that drives
  the lighting, so the readout and the shading cannot disagree.
- All of it defaults **on** — realism is not an opt-in buried in Settings.

**North America lock** — `applyNorthAmericaLock()`. This works only because
Cesium renders in an earth-fixed frame: continents are nailed to the globe and
the *sun* moves, so holding the camera costs nothing. Guards: re-centres only
after 12 s of no interaction, only above 3 Mm altitude, only past 12° drift.
`idleRotateSec` now defaults to `0` — auto-rotate and the NA lock fight
otherwise.

### 2. Tabbed pro UI — `a92f205`

- Left rail is tabbed **WEATHER / EARTH / SKY / WORLD** (`initTabs()`),
  replacing a flat 12-category accordion. Selected tab persists to
  `localStorage['graticule.tab']`.
- Weather tab has mode chips: Radar / Satellite / Model / Observations /
  Outlooks, each swapping a `.mode-body`.
- New primitives in `style.css`: `.hud-tab`, `.chip`, `.sw` toggle switches,
  `.ctl` labelled control rows, `#timeline`, `#legend`, `#frame-stamp`,
  `#drawbar`, `.warn-card`, `.wp-*` world panel.
- Range inputs restyled — the UA default was rendering **bright red**.

### 3. Radar as a frame series — `a92f205`

`TL` object owns the loop. One `ImageryLayer` per frame, cross-faded by alpha
(add/remove per tick caused a visible black flash). Past frames and RainViewer
nowcast frames sit on one track with an explicit **NOW** marker, because the
video singles out weather.com for making past-vs-future ambiguous. Frame stamp
reads `RADAR · OBSERVED` or `RADAR · FORECAST`.

### 4. Real weather data — `7595d96`, `da9c901`

All keyless. Backend proxies exist only where CORS forces it.

| Feature | Source | Where |
|---|---|---|
| Model fields | Open-Meteo `/v1/forecast` | `refreshModelField()` |
| Air quality | Open-Meteo `/v1/air-quality` | `refreshAirQuality()` |
| METAR | aviationweather.gov | proxy `/api/metar` |
| NWS warnings | api.weather.gov | proxy `/api/nws/alerts` |
| SPC outlooks | spc.noaa.gov | proxy `/api/spc/outlook?day=N` |
| Storm reports | IEM `/geojson/lsr.py` | proxy `/api/lsr?hours=N` |
| GOES | IEM `goes-{east,west}-*` | `rebuildCloudsLayer()` |
| Single-site radar | IEM `ridge::<SITE>-<PROD>-0` | `rebuildRadarSiteLayer()` |

Model and AQI sample a grid over the **current view** (`viewGrid()`), filtered
to the visible hemisphere by `isFrontFacing()`, and re-sample debounced on
`camera.moveEnd`. Open-Meteo takes comma-separated coordinate lists, so a whole
field is one request.

Warning cards carry event, expiry countdown, counties, and detection details
(hail size, gust, tornado/flash-flood detection), colour-coded by event type,
click-to-zoom. **All** active alerts are listed; only the ~10% carrying a
polygon are drawn, and zone-only cards are marked `.is-zone` and inert.

### 5. WORLD tab — `a92f205`

Video 2's dashboard. `WORLD_BASE`, `CONTINENTS`, `COUNTRIES` seeded from **UN
World Population Prospects 2024 (medium variant), mid-2025**, with published
growth rates; `project()` compounds from a fixed epoch (`WPP_EPOCH`).
`BIRTHS_PER_SEC = 4.24`, `DEATHS_PER_SEC = 2.51`.

There is **no public real-time population feed** — the dashboards that appear
to have one are extrapolating a projection, and so is this. The pane says so in
`renderWorldStatic()`. Cross-checked against the video at the same timestamp:
India 1,478,101,547 (video 1,478,077,472), China 1,412,551,550 (video
1,412,691,390), US 349,343,925 (video 349,381,176) — within ~0.01%.

### 6. Drawing, themes, storm reports — `da9c901`

Free-hand annotation clamped to the globe with undo/clear/colour-cycle. Camera
control yields while drawing or a stroke drags the globe underneath it; finished
strokes are frozen out of their `CallbackProperty` rather than re-evaluating
forever. Map theme picker (SAT/MAP/TOPO/NIGHT) surfaced on the map, synced with
the existing `imageryBase` setting. Compass moved to `top: 112px` to clear the
new toolbar.

---

## Bugs found and fixed — all pre-existing

### Bug 1 — radar imagery had never rendered

RainViewer's `path` field **already contains** `/v2/radar/<id>`. The code built
`${host}/v2/radar/${path}/…`, producing `/v2/radar//v2/radar/<id>/…`. Every
radar tile 404'd, silently, forever. Same fault on the satellite path. Fixed to
`${host}${path}`. Verified 32/32 tiles load. **This means no screenshot or
handoff before today showing "radar working" was accurate.**

### Bug 2 — Cities layer crashed the renderer

Enabling Cities alone threw `RangeError: Failed to set the 'length' property on
'Array': Invalid array length` from `createPotentiallyVisibleSet`, and Cesium
**stopped rendering**.

Root cause: Cesium builds one glyph texture atlas per `LabelCollection` and
allocates **eagerly, ignoring `distanceDisplayCondition`**. All 7,342 populated
places were created with label text and overflowed it. Measured threshold:
1,000 labels fine, 3,000 crash.

Ruled out first, so nobody re-walks these: coordinates (all 7,342 finite and in
range), empty label strings, `distanceDisplayCondition`, `translucencyByDistance`.

Fix: every city keeps a point; labels exist on all of them but carry text only
for a working set of `CITY_LABEL_CAP = 900`, ranked by scalerank then
population and filtered to those in range at the current camera altitude, via
`relabelCities()` debounced on `camera.moveEnd`. Verified 41 labels at globe
view, 900 at regional, clean at every zoom.

> **★ Detection lesson.** Cesium catches render exceptions into its own
> `.cesium-widget-errorPanel` and they never reach `window.onerror`. My
> automated regression printed `ERRORS: none` across 27 layers **while the app
> was frozen on screen**; only the screenshot caught it. Any Graticule test
> must hook `viewer.scene.renderError` and check for the panel. Captured as
> memory `reference-cesium-render-errors-are-invisible`.

### Bug 3 — duplicate layer toggles

`hurricanes` and `airspace` each had two checkboxes in different panes, and
airspace shipped a duplicate `id="count-airspace"`. The two copies could
disagree about state. Tropical now lives in Outlooks, airspace in SKY.

### Bug 4 — `configureClustering` colour contract (mine)

It accepted only a `Cesium.Color`; passing a CSS string (as my new METAR layer
did) threw from inside the cluster event and likewise stopped rendering. Now
accepts either. Also added `Number.isFinite` guards before every
`fromDegrees()` on external data — Open-Meteo can return a point object with no
lat/lon, and a NaN position corrupts the same frustum computation.

---

## Upstream traps — every one cost real time

- **`VIIRS_Black_Marble` is not a served GIBS layer.** 400s on every tile. The
  night-lights product is `VIIRS_CityLights_2012`, date segment `2012-01-01`.
- **GIBS EPSG:4326 `500m` is not a power-of-two grid** (levels are 2, 3, 5,
  10 … tiles wide) so it *cannot* be addressed with `GeographicTilingScheme`.
  Use EPSG:3857 `GoogleMapsCompatible` + `WebMercatorTilingScheme`.
- **RainViewer caps at z7** — set `maximumLevel: 7`.
- **IEM per-site radar is `ridge::KTLX-N0Q-0`**, not `KTLX-N0Q`. N0Q/N0U/N0B
  return 200; N0G returns 503. Bound the layer to a rectangle around the site
  (~5°) or Cesium requests it worldwide and everything outside the ~460 km
  range 404s.
- **aviationweather.gov bbox is `lat0,lon0,lat1,lon1`.** Lon-first returns
  **204 No Content**, which then fails JSON decoding rather than erroring
  usefully.
- **api.weather.gov rejects `limit`** as unrecognised. Needs a `User-Agent`.
- **`Cesium.Color.lerp` is a static**, not an instance method.
- **`computeViewRectangle` spans more than the visible hemisphere** at globe
  scale — grid samples need a front-facing test or they float past the limb.
- **No free source exists** for lightning (Vaisala/Blitzortung are commercial),
  webcams (Windy needs a key), road weather, power outages, or SPC
  mesoanalysis rasters. Don't hunt.

---

## File map

```
web/app.js          5,383 lines  (+1,970 this session)
web/index.html        650 lines  (+312)
web/style.css       1,487 lines  (+345)
graticule/server.py   297 lines  (+164)
issues.md              99 lines  (new)
```

**app.js regions**, in file order:
`KIND_LABEL` + `SPC_RISK_LABEL` + `aqiCategory` (top) · `NA_HOME` const ·
`initViewer` (clock + `initRealisticEarth`) · `configureClustering` ·
`summarizeEntity` (hover) · night lights · terminator · parcels ·
`relabelCities` + `buildCities` · `showPanel` · settings binding ·
`applyNorthAmericaLock` · `initTabs` / timeline `TL` / legend / WORLD pane /
`initSkyMirrors` · weather controls + SPC · model/AQI/METAR/warnings +
`initViewResampling` · LSR / drawing / map theme (end of file).

**Backend endpoints:** `/api/snapshot`, `/api/config`, `/api/spc/outlook`,
`/api/metar`, `/api/nws/alerts`, `/api/lsr`. Each new one caches with a TTL and
**serves stale on upstream failure** rather than blanking the map mid-event.

---

## How to run and verify

```bash
cd C:/Users/dbhav/Projects/graticule
uv run python main.py                      # pywebview window

# browser-testable server (what all verification used):
uv run python -c "from graticule.server import run_server; run_server(8731)"
```

Kill a stuck server (pkill does not catch `uv run python -c`):

```bash
netstat -ano | grep ":8731" | grep LISTENING | awk '{print $5}' | sort -u \
  | while read pid; do powershell -Command "Stop-Process -Id $pid -Force"; done
```

Endpoint smoke test — all should be 200:

```bash
for ep in "/" "/api/metar" "/api/nws/alerts" "/api/spc/outlook?day=1" "/api/lsr?hours=12"; do
  printf "%-26s " "$ep"; curl -s -o /dev/null -w "%{http_code}\n" "http://127.0.0.1:8731$ep"; done
```

**Crash detection harness** — the important one. Hooks `scene.renderError`,
because `pageerror` alone gives false confidence:

```js
viewer.scene.renderError.addEventListener((s, e) => window.__renderErrors.push(String(e)));
document.querySelector('.cesium-widget-errorPanel')   // non-null => dead scene
```

**Last full regression (at tip `5458c60`):** 27 layers on simultaneously
(everything except the two parcels layers), all four tabs cycled, all five
weather modes, all satellite channels, all model fields, all obs fields, SPC
days 1-3, all four themes, timeline play/pause/step, settings modal.
Result: **0 render errors, 0 JS errors**, only the documented Cesium-ion 401.

There is **no automated test suite** in this repo. Verification was
Playwright-driven and ad-hoc. Building a persistent one is a good next job.

---

## Open items

### In `issues.md` (read it — it has measurements and a fix sketch)

1. **Parcels layer stalls the UI ~45 s** when run alongside a loaded scene.
   `toggleParcelsUS` sets `minimumLevel: 14`; Cesium honours that floor at
   globe zoom and tries to tile the whole visible globe at level 14. Measured:
   legacy set minus parcels = 3 ms; with parcels = **45,780 ms**. Fix sketch:
   attach/detach on camera altitude the way `parcels_wa` already does via
   `initParcelsWACameraHook`. **Logged, not fixed — pre-existing and unrelated
   to this task, per the Projects rule. Don has not yet said to fix it.**
2. `applyPerfPreset` advertises entity caps ("Low — 2k ships · 2k planes") that
   it never implements; it only tunes `maximumScreenSpaceError`.

### Video features not built

- **Custom Graphics** (the only row Weatherfront had): presentation mode,
  custom map styles, **county area-darkening and county selection**. The county
  geometry is already in the repo — `ne_10m_admin_2_counties.zip`.
- **Dual / quad pane** (RadarScope). Needs a second Cesium viewer; non-trivial.
- **Compare Runs / Compare Models** (Weatherfront). Open-Meteo supports both
  via `models=` lists and `past_days`, so this is the cheapest remaining win.
- **Mesoanalysis grid** (GR Earth). CAPE is already available through the model
  field; the full SPC parameter set has no keyless raster source.
- **Fronts.** No usable free geojson found. WPC coded surface bulletin is text.
- **Per-layer gear settings** (MyRadar pattern) — currently only radar, clouds
  and boundaries have opacity controls.

### Gated on Don

- **Webcams** need `WINDY_WEBCAM_KEY` in `.env`, following the existing
  `FIRMS_MAP_KEY` / `AISSTREAM_KEY` pattern. UI says so.
- **Storm chaser feeds** require per-chaser agreements. Not buildable.
- Setting `CESIUM_ION_TOKEN` would remove the boot 401 and enable ion terrain
  and OSM Buildings (both currently disabled in the 3D pane).

---

## Memory written this session

In `C:/Users/dbhav/.claude/projects/C--Users-dbhav-Projects/memory/`:

- `project-graticule-weather-superapp-2026-08-02.md` — project state, indexed
  from `MEMORY.md`
- `reference-graticule-free-weather-data-sources.md` — every verified endpoint
  and URL trap above
- `reference-cesium-render-errors-are-invisible.md` — the swallowed-render-error
  lesson and the two Cesium faults that only surface that way
- `feedback-shared-media-is-in-scope-for-its-visuals.md` — indexed from
  `MEMORY_FEEDBACK.md`

---

## Starting prompt for the next session

> Graticule (`Projects/graticule`, branch `dev`, tip `5458c60`, pushed).
> Read `HANDOFF_2026-08-02_WEATHER-SUPERAPP.md` first, then `issues.md`.
> `HANDOFF.md` and `HANDOFF_2026-05-02_GRATICULE.md` are historical and
> describe a UI that no longer exists.
> Start the browser-testable server with
> `uv run python -c "from graticule.server import run_server; run_server(8731)"`.
> Any UI verification must hook `viewer.scene.renderError` — Cesium hides
> render crashes from `pageerror` and a passing console check means nothing.
