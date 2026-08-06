# Graticule handoff, 2026-08-05

Branch `dev`, synced with `origin/dev`, working tree clean, HEAD `d54c3cd`.

Read this top to bottom before touching anything. Section 8 is the part that
will save you the most time: it is the list of things that were measured and
turned out to be false.

---

## 1. Standing instructions (these outrank everything below)

Verbatim from the session, still in force:

* **"Do not call the AgentTool unless the user requested it"**
* **"Do not use workflows or deep-research unless the user requested it"**

Don's directives on this app, in the order he gave them:

1. *"keep improving"*
2. *"keep perfecting until this is a top-100 android and IOS store rated app."*
3. *"find the info from other free sources that do not ned API"*
4. Then, looking at a screenshot: *"why a black spot at the pole? is the globe
   rotateable? Is this a top 100 app?"*

Inherited and still governing: two YouTube videos are the feature spec
(StormCat5 radar-app review `W4Qg0_vxKiE`, LiveStream07 population dashboard
`D1GZq1qiVHU`). A completely realistic Earth centred on North America.
Everything toggled in tabs. Deeper secondary pages and dashboards. Optimise
for low lag.

Repo rules that bit during this session: never commit to `main` (use `dev`),
never commit secrets, never delete files without permission (move to
`_deprecated/<date>/`), log unrelated breakage in `issues.md` rather than
fixing it, and Don does not read `.md` files, so anything for him is HTML or
chat.

---

## 2. What is running right now

| Port | PID | What it is | Notes |
|---|---|---|---|
| 8731 | 50380 | **Don's instance** | **Needs a restart.** Serves current `web/` (read per request) but is running the Python from before this session, so it still has the old OpenSky feed, the keyed FIRMS path, and no `/sw.js`, `/manifest.webmanifest`, `/offline.html`, `/favicon.ico` routes. |
| 8742 | 708132 | stale test server from the mobile session | safe to kill |
| 8743 | 644616 | keyless test server (`scripts/run_keyless.py`) | what every suite was run against |
| 8791, 8793 | various | **not this project** | leave alone |

Do not kill 8731 without asking. Do not assume a background server started:
see section 8, item 1.

---

## 3. Two arcs shipped this session

### 3a. `70fa7b2` Every layer runs with no API key

The app needed five signups before the map filled in (FIRMS, AISStream,
OpenSky OAuth, Cesium ion, Google). A fresh clone got dark layers. Seventeen
candidate endpoints were probed with real requests before anything was
designed, and that step is what made it work.

Measured, keyless, 2026-08-05:

| Layer | Source | Result |
|---|---|---|
| Aircraft | adsb.fi, then airplanes.live, then adsb.lol | 4,106 tracked, with registration, airframe type, squawk, emergency |
| Wildfires | NASA FIRMS public archive | 174,628 detections |
| Terrain | Esri world elevation (LERC) | new capability; Everest samples 8,341 m |
| Ships | Digitraffic | 1,377 vessels, **Baltic and Finnish waters only** |

Old code for comparison: OpenSky anonymous returned `429`, keyed FIRMS was
179,107 rows in 1877 ms against the keyless 174,628 in 807 ms.

Files: `graticule/feeds/adsb.py` (rewritten, still exports `opensky_loop` so
`server.py` did not move), `graticule/feeds/fires.py` (rewritten),
`graticule/feeds/ais.py` (Digitraffic fallback plus a silence watchdog),
`graticule/server.py` (`/api/config`), `web/app.js` (terrain, plane subtitles,
ships coverage note), `web/index.html` (terrain checkbox), `.env.example`,
`README.md`.

### 3b. `d54c3cd` The black disc at the poles, and the lock that made the globe feel stuck

Both found by Don looking at the screen. **Nothing in any suite could see
either one**, because every check in this repo reads state and both defects
are pixels.

Pole: Web Mercator is undefined at the poles so EPSG:3857 stops at ±85.0511°.
Every basemap is Mercator, so above that latitude nothing drew and the globe's
navy `baseColor` showed through. Both caps now carry a flat ice tone from a
69-byte inline PNG, clipped to the two polar rectangles and graded with the
base map.

Rotation: the globe always rotated. "Stay centred on North America" reset its
idle timer on `mousedown`, `wheel`, `keydown`, `touchstart` and `pointerdown`
but **not `mousemove`**, so "idle" meant "sent no click", which is what a
person does while reading. Drag to a storm near Japan, stop touching anything,
and twelve seconds later the camera flew home. Now `mousemove` and `touchmove`
count, and the grace period is 90 s instead of 12.

---

## 4. How to verify, and the numbers to expect

Playwright lives in the **3.13 interpreter**, not the venv. The server runs
from the venv. This matters:

    # server (venv)
    .venv/Scripts/python.exe scripts/run_keyless.py 8743

    # suites (3.13)
    py -V:3.13 scripts/keyless_test.py 8743           -> 23 passed, 0 failed
    py -V:3.13 scripts/ui_scroll_test.py 8743         -> 27 passed, 0 failed
    py -V:3.13 scripts/world_consistency_test.py 8743 -> 17 passed, 0 failed
    py -V:3.13 scripts/mobile_test.py 8743            -> 62 passed, 0 failed
    py -V:3.13 scripts/ui_audit.py 8743               -> 0 of 468 contrast failures,
                                                         0 small targets,
                                                         0 off-centre controls

`scripts/run_keyless.py` blanks all eight key variables, asserts none leaked
back from `.env`, and refuses to start if the port is already taken.

`mobile_test.py` takes over ten minutes. Run it in the background.

The UI suites pass `?terrain=off` because under SwiftShader the displaced
terrain mesh made `page.screenshot()` miss a 60 s timeout. They measure
layout, not the globe.

**Control run.** `git stash` the source files and rerun `keyless_test.py`:
18 of 21 checks failed on the old code, with 0 aircraft, 0 fires, 0 ships.
That is the only reason the suite means anything. Do this again after any
significant change to it.

---

## 5. Open items, highest value first

1. **No visual regression harness.** This is the top item. Both of today's
   defects were found by a human looking at pixels while every automated check
   passed. The next step I recommended to Don: render the globe from a fixed
   set of camera angles and compare pixels, so the next hole is caught before
   he sees it. A working sweep harness already exists in the scratchpad at
   `globe_sweep.py` (see section 7) and should be promoted into `scripts/`.
2. **`/api/rivers` takes 31 seconds** (issues.md #29). 11,602 gauges. No store
   reviewer gets past this. Fix is a server-side cache or a bbox filter, and
   which one is Don's call.
3. **AISStream returns nothing** (issues.md #34). The key is accepted, the
   subscription is accepted, and not one message arrives in 25 s. Reproduced
   outside the app. The app now falls back to Digitraffic after two silent
   90 s windows, but whether the key is expired, over quota, or the service is
   down is unresolved.
4. **Fires ship ~175,000 points over the WebSocket** (issues.md #31).
   Pre-existing, not made worse. Options: a confidence floor, a viewport
   filter, or a paged endpoint.
5. **SWPC solar-wind plasma 404s** (issues.md #30). The telemetry line prints
   `solar_wind=? km/s` while Kp and X-ray beside it are fine.
6. **South polar cap is cosmetically bright in polar night** (issues.md #35).
   A soft disc, not a hole, at a pole the app never opens on. Real polar
   imagery needs EPSG:3413/3031, which Cesium cannot consume for imagery.
7. **Still not a store listing.** It is an installable PWA. iOS needs a
   Capacitor shell, Android a Trusted Web Activity, plus a developer account,
   signing, privacy labels and review. That is a decision, not a task.
8. Radar tilt needs a server-side NEXRAD Level II decoder (#7).
   `applyPerfPreset` advertises entity caps it never implements (#3).

---

## 6. What still needs a key, and why there is no alternative

| Key | Buys | Why keyless does not exist |
|---|---|---|
| `AISSTREAM_KEY` | worldwide ships | No free live AIS has global coverage. MarineTraffic, VesselFinder, AISHub and BarentsWatch all gate the stream. The US publishes no live public feed; NOAA's Marine Cadastre AIS is historical. |
| `CESIUM_ION_TOKEN` | OSM Buildings 3D | OSM Buildings closed its anonymous tile service on 2024-04-03 (`403 requires a registration`). |
| `GOOGLE_MAPS_API_KEY` | photorealistic 3D tiles | no free equivalent |
| `FIRMS_MAP_KEY` | slightly fresher fires | latency only, coverage is identical |

`OPENSKY_*` is no longer read at all.

---

## 7. Scratchpad tooling worth promoting

Session scratchpad:
`C:/Users/dbhav/AppData/Local/Temp/claude/C--Users-dbhav-Projects/1c129daf-7a32-41ca-b2ff-3a484cdf0078/scratchpad/`

* `globe_sweep.py` renders the globe from five camera angles and writes PNGs.
  This is the seed of the visual regression harness in item 1. It disables the
  North America lock first, because otherwise the camera flies home between
  captures and every later view becomes North America.
* `probe_keyless.py`, `probe2.py`, `probe3.py` are the endpoint probes. Rerun
  them before trusting any external source.

Screenshots are captured with `viewer.canvas.toDataURL()` rather than
Playwright's screenshot, because the canvas never stabilises under software
rendering and `page.screenshot()` times out.

---

## 8. Things that were measured and turned out to be false

This is the section that saves time. Every one of these cost real minutes.

1. **A second server can fail to bind and keep running its feeds.** Launching
   a keyless server over a live one logged `[Errno 10048] error while
   attempting to bind` three lines deep, and uvicorn carried on running that
   process's feed tasks. Two processes polled live data while the OLD one
   answered HTTP. **Nineteen checks passed against code that no longer existed
   on disk.** Only one control assertion caught it. `run_keyless.py` now
   refuses to start on a taken port; verified by running it twice.
2. **Three suites hardcoded port 8731 and ignored the port argument**, so they
   had been silently measuring Don's running instance. Fixed in
   `ui_scroll_test.py`, `world_consistency_test.py`, `ui_audit.py`.
3. **`ImageryLayerCollection.add()` returns nothing.** Only
   `addImageryProvider()` hands the layer back. Assigning from `add()` left
   `baseImageryLayer` null, the removal at the top of `applyImageryBase` never
   fired, and every basemap switch stacked another Esri layer.
4. **The GIBS EPSG:4326 tile matrix is not a power-of-two pyramid.** Measured
   2x1, 3x2, 5x3, 10x5 against Cesium's 2x1, 4x2, 8x4, 16x8. Only level 0
   aligns. A comment on the night basemap in `app.js` already said this and I
   hit it anyway.
5. **MODIS true colour returns BLACK PIXELS in polar night**, not absent data,
   so it painted a black disc over Antarctica in August.
6. **Blue Marble's Arctic is bathymetry**, so filling the cap with it produced
   dark ocean against Esri's bright sea ice: the same complaint one layer down.
7. **`Cesium.SceneTransforms.worldToWindowCoordinates` does not do occlusion.**
   It returns a screen position for points behind the globe, so a pixel probe
   at the pole was sampling empty space.
8. **`camera.setView` with a pitch aims the camera FROM an altitude**, not at
   a target. It put the globe entirely off screen. Use
   `camera.lookAt(target, HeadingPitchRange)` and then release the frame with
   `lookAtTransform(Matrix4.IDENTITY)` or later views drift.
9. **The animation clock stalls, four documented instances.** A 260 ms
   transform was still 60% incomplete 1.5 s later. Rule: if the clock can
   stall, nothing a user is waiting on goes behind it.
10. **A tap synthesises a click at the same screen coordinates milliseconds
    later**, by which time a moving panel has put a different control there.
    `preventDefault` on `touchend` did not work; a capture-phase click guard
    did.
11. **`emergency` comes back as the literal string `"none"`** from the ADS-B
    feeds. Passed through, every aircraft carries an "Emergency: none" chip.
12. **The two FIRMS files do not share a schema.** 13 columns against 14, and
    `confidence` is `low/nominal/high` in the archive where the API sends
    `l/n/h`.

---

## 9. Suggested next move

Promote `globe_sweep.py` into `scripts/globe_visual_test.py`: fixed camera
angles, canvas capture, committed reference images, and a pixel-difference
threshold. Then run it against `git stash` to prove it catches the polar hole,
exactly as `keyless_test.py` was proven against the old feeds.

That closes the actual gap this session exposed, which is not features. It is
that the app was never being looked at.
