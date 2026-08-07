# Graticule handoff, 2026-08-06 — the store plan

Branch `dev`, synced with origin, tree clean, HEAD `a27c723`.
Read this whole file before touching anything. It is the brief for shipping
Graticule to the App Store and Google Play, plus everything a fresh session
needs to not re-derive.

---

## 0. Standing instructions, verbatim, non-negotiable

From the session that produced this file:

- **"Do not call the AgentTool unless the user requested it"**
- **"Do not use workflows or deep-research unless the user requested it"**
- Never commit secrets. `.env` stays gitignored. Real keys go in the KeePassXC vault.
- Never commit directly to `main`. Use `dev` or a feature branch.
- Never delete files without explicit permission. Move to `_deprecated/<date>/`.
- Log unrelated breakage in `issues.md`; do not fix it unless Don says to.
- **Don does not read `.md` files.** Deliver prose as HTML or in chat.
- Every path/URL Don might open must be a bare ctrl+click-able link:
  `file:///C:/Users/dbhav/...`, forward slashes, no backticks, no markdown links.
- No em dashes in anything outbound under Don's name.
- Never guess. "You don't know it works unless you ran it." "A check that
  cannot fail proves nothing."
- Open every UI/visual change in Don's browser automatically.
- Don is on Max: do not spend metered API tokens on your own reasoning.
- **Share the GPU.** One 3090Ti. `scripts/gpu_guard.py status` and take a lease.
  Never kill another session's render.

Don's directives on this project, in order given:
1. Keep perfecting until this is a top-100 Android and iOS store rated app.
2. Completely realistic Earth, centred on North America.
3. Everything toggled in tabs; deeper secondary pages/dashboards.
4. Optimise for low lag.
5. Find data from free sources that need no API key.
6. **"do it all. get there."** (2026-08-06, authorising the store plan below.)

Feature spec is two YouTube videos: StormCat5 radar-app review `W4Qg0_vxKiE`,
LiveStream07 population dashboard `D1GZq1qiVHU`.

---

## 1. What is running right now

| Port | What | Note |
|---|---|---|
| 8731 | Don's instance, PID 50380 | **Stale Python.** Pre-2026-08-05 feeds. Needs a restart. |
| 8742 | older test instance | ignorable |
| 8743 | the current test server | everything below was verified here |

Start a clean keyless one with:

    py -V:3.13 scripts/run_keyless.py 8743

It refuses to start if the port is taken. That guard exists because a second
server once failed to bind, kept running its feed loops anyway, and 19 checks
passed against code that no longer existed on disk.

**Two interpreters.** The server runs from `.venv/Scripts/python.exe`.
Playwright only exists in `py -V:3.13`. Getting this backwards costs ten
confusing minutes.

---

## 2. Verify the current state

    py -V:3.13 scripts/globe_visual_test.py 8743      # 29 passed
    py -V:3.13 scripts/keyless_test.py 8743           # 25 passed
    py -V:3.13 scripts/ui_scroll_test.py 8743         # 27 passed
    py -V:3.13 scripts/world_consistency_test.py 8743 # 17 passed
    py -V:3.13 scripts/mobile_test.py 8743            # 62 passed
    py -V:3.13 scripts/freshness_test.py 8743         #  4 passed
    py -V:3.13 scripts/ui_audit.py 8743               # 0 contrast fails, 0 small targets

Each of the three newest suites has a control that proves it can fail:

    py -V:3.13 scripts/globe_visual_test.py 8743 --selftest
    py -V:3.13 scripts/freshness_test.py 8743 --selftest

`--selftest` runs are expected to FAIL specific checks. That is the pass
condition. Read the SELFTEST OK/FAILED line at the bottom, not the count.

Each suite takes 3 to 10 minutes under SwiftShader. Run them in the
background and poll; a foreground call will hit the 600 s tool timeout.

---

## 3. THE STORE PLAN

Ordered by what blocks what. Nothing below Phase 1 can start until Phase 1 is
answered, because a phone app pointed at `127.0.0.1` is a blank screen.

### Phase 1 — Backend hosting. BLOCKED ON DON.

The app makes 11 distinct `/api/...` calls to `graticule/server.py`. Radar
index, alerts, ships, aircraft, fires, rivers, tides, buoys, quakes, model
fields, world data. All of it currently comes from Don's desktop.

**Decision Don has to make, because it is recurring money and his identity:**
where does it live and who pays. Options, cheapest first:

| Option | Rough cost | Notes |
|---|---|---|
| Fly.io / Railway small instance | ~$5-15/mo | Simplest port. FastAPI runs as-is. |
| A VPS (Hetzner, DO) | ~$6-12/mo | More control, more sysadmin. |
| Cloudflare Workers + a queue | more rework | Feeds are long-lived asyncio loops; poor fit. |

**Do not sign anything or enter a card.** Present the options, get his pick.

Work once picked:
- Extract the base URL to config so the client can point at a real origin.
  Right now it is same-origin relative paths, which is fine for a Capacitor
  shell using a remote origin, but must be deliberate, not accidental.
- CORS for the Capacitor origin (`capacitor://localhost`, `https://localhost`).
- The feed loops are per-process singletons. One instance is correct; do not
  autoscale to N or you multiply the polling on donated ADS-B infrastructure.
- Rate discipline: `feeds/adsb.py` issues 14 discs at 1 req/sec every 30 s
  against volunteer aggregators. That is polite for one user. Re-check it
  before it serves many.

### Phase 2 — Licensing. BLOCKED, AND THE ONE TO LOOK AT HARDEST.

`us_apt.json`, `us_asp.json`, `us_nav.*`, `us_obs.json`, `us_raa.*`, `us_rca.*`,
`us_hot.*` are OpenAIP exports, **CC-BY-NC-SA**. Non-commercial.
`.gitignore` already says "redistribution restricted" beside them, and
`web/data/airspace.json` is derived from `us_asp.json`.

A store listing is distribution. The NC clause bites whether or not the app is
free, because a store presence is arguably commercial and the SA clause forces
share-alike on derivatives.

Resolve before submission, not after:
- Drop the airspace/airport layers, or
- Replace with FAA public-domain sources (FAA 28-day NASR subscription is
  public domain: airports, navaids, airspace), or
- Get written permission from OpenAIP.

FAA NASR is the right answer and it is free and public domain. It is real
work: the format is fixed-width/CSV, not GeoJSON.

Audit every other source's terms the same way before shipping. Do not assume
"keyless" means "redistributable". Sources currently in use: RainViewer,
NASA GIBS, NASA FIRMS, NOAA/NWS, USGS, adsb.fi / airplanes.live / adsb.lol,
Digitraffic, Esri World Imagery, OpenTopoMap, Natural Earth, Cesium's
Natural Earth II asset.

**Esri World Imagery deserves specific attention.** It is the default basemap
and it is served from `server.arcgisonline.com` with no key. Free for
non-commercial use under Esri's terms; a store app needs checking.

### Phase 3 — The native shell.

No `android/`, no `ios/`, no Capacitor, Cordova or Tauri config exists. The
PWA manifest at `web/manifest.webmanifest` is genuinely complete (id, scope,
display, theme colours, all four icons including maskable), so Capacitor
wrapping the existing PWA is the honest shortest path.

    npm init -y && npm i @capacitor/core @capacitor/cli
    npx cap init Graticule com.dbhavery.graticule
    npx cap add android
    npx cap add ios          # macOS only

Real work inside that, none of it a checkbox:
- `server` config pointing at the hosted origin, with `androidScheme: 'https'`.
- Splash screens and adaptive icons at every density.
- Permission strings: `NSLocationWhenInUseUsageDescription` and the Android
  equivalents. The app uses geolocation for "nearest radar site".
- Back-button handling on Android (currently a browser history push).
- Test on real hardware. Don has a Galaxy S24. SwiftShader tells you nothing
  about a real GPU.
- **The service worker and Capacitor interact.** `web/sw.js` is now
  network-first for code (see §4). Verify it still behaves inside the shell.

### Phase 4 — Store accounts and listing. BLOCKED ON DON.

- Apple Developer Program: $99/year, **requires a Mac to build and submit**,
  tied to Don's legal identity. Don does not currently have a Mac.
- Google Play Console: $25 one time.
- Both need: privacy policy URL, support URL, screenshots at multiple device
  sizes, age rating questionnaire, data-collection disclosure.

**Neither exists yet.** No `web/privacy.html`, no support page. Write them.
The data-collection answer is close to "none": no accounts, no analytics, no
tracking. That is a genuine selling point and should be said plainly.

### Phase 5 — Liability and policy.

The app renders NWS severe weather warnings and tells someone a tornado
warning is in effect. That carries exposure a desktop tool does not.
- A visible disclaimer: not an official source, do not use as sole basis for
  life-safety decisions, defer to NWS.
- Apple reviews weather apps with alerting carefully. Attribution to NOAA/NWS
  must be correct and visible.

### Phase 6 — The product work that is still open regardless.

These are quality items, not store blockers, but Don asked for them:
- **`/api/rivers` takes 31 seconds.** 11,602 gauges. Cache it or filter by
  bounding box. No store reviewer waits 31 seconds. (`issues.md` #29)
- **Wildfires push ~175,000 points over the socket.** Decimate by zoom or
  cluster server-side. (`issues.md` #31)
- AISStream key returns nothing; ships fall back to Baltic-only Digitraffic.
  (`issues.md` #34)
- SWPC plasma endpoint 404s, so the solar wind readout is dead. (#30)
- Radar tilt needs a server-side Level II decoder. (#7)
- `applyPerfPreset` advertises capabilities it does not implement. (#3)

---

## 4. What changed on 2026-08-06, and why it matters to you

Four commits. The first one is the one that explains the other three.

**`532089f` The service worker was serving stale code.** Every same-origin
request, `app.js` included, went through `staleWhileRevalidate`. Every reload
ran the PREVIOUS build. Three sessions of verified fixes never reached Don's
browser; he kept reporting the same defect and I kept re-diagnosing the globe.

Two things hid it. The file's own header comment claimed versioned cache-first
"replaced wholesale on deploy" and the fetch handler never implemented that,
with `VERSION` stuck on v3. And `server.py` sends `Cache-Control: no-store` on
`/static/*`, which makes it look handled: **it is not, because Cache Storage
ignores HTTP cache headers.** A service worker sits above the HTTP cache.

Now: code is network-first with a 2.5 s timeout and cache fallback. `VERSION`
is v4. `scripts/freshness_test.py` covers it.

★ **If Don says a verified fix does not work, question the delivery path
before the fix.**

**`901ac65` The white disc at the pole was a hole through the planet.** The
keyless elevation service is Web Mercator, stopping at ±85.0511°. A terrain
provider's tiling scheme defines the globe's ENTIRE quadtree, so above that
latitude Cesium creates no surface at all and you see the sky atmosphere on
the far side. Not missing imagery. Missing geometry. `scene.globe.pick` down
the pole returns `null` with real terrain and a point without it.

Fixed by handing the poles to the ellipsoid past ±84°.

Same commit: terrain was 10x the frame cost. Measured, camera moving:

| state | median frame |
|---|---|
| terrain on, borders on (**what shipped**) | 6137 ms |
| terrain on, borders off | 2570 ms |
| terrain off, borders on | 1106 ms |
| terrain off, borders off | 964 ms |

Software rendering, so read ratios not milliseconds. Terrain now loads on
descent (hysteresis 1000/1500 km). All 13,098 country and state borders were
`clampToGround`, draping geometry against terrain tiles, which bought nothing
because `depthTestAgainstTerrain` is false by design. Default view
**6137 ms → 569 ms**.

**`c9bc0b0` The radar pane was showing the operator our engineering problems.**
Two paragraphs about NEXRAD 503s and Vaisala feeds, a permanently disabled
Lightning switch (dead markup, nothing referenced it), six inert product
buttons, and a raw `0.70`. Researched against RadarScope/Windy: restraint is
the premium signal in this category.

---

## 5. Traps measured to be true. Do not re-derive these.

- **Cache Storage ignores HTTP cache headers.** A service worker sits above
  the HTTP cache.
- **A terrain provider's tiling scheme defines the whole globe quadtree.** No
  free elevation source is geographic; they are all Mercator.
- **`globe.tilesLoaded` is not "done".** Cesium keeps refining after it flips.
  One view captured coarse in one run and sharp the next, 14% of pixels apart.
  Capture until two consecutive frames agree.
- **`requestRenderMode: true` makes `scene.render()` a no-op when nothing
  asked for a frame.** Measuring it idle reports 0.0 ms and means nothing.
- **`ImageryLayerCollection.add()` returns nothing.** Only
  `addImageryProvider()` hands the layer back.
- **GIBS EPSG:4326 is not a power-of-two pyramid** (2x1, 3x2, 5x3, 10x5 against
  Cesium's 2x1, 4x2, 8x4, 16x8). Cesium's bundled Natural Earth II IS.
- **Cesium's lens flare stage never asks where the sun is.** It mirrors the
  brightest pixels through screen centre whenever attached.
- **`SceneTransforms.worldToWindowCoordinates` does no occlusion.**
- **`camera.setView` with a pitch aims FROM an altitude, not AT a target.**
  Use `camera.lookAt` then release with `lookAtTransform(Matrix4.IDENTITY)`.
- **Cesium ships minified**, so `constructor.name` is mangled. Use `instanceof`.
- **`page.screenshot()` cannot settle** on a continuously-rendering WebGL
  canvas under SwiftShader. Use `viewer.canvas.toDataURL()`.
- **Top-level `const` in a plain script** is global lexical scope but NOT on
  `window`.
- MODIS true colour returns BLACK PIXELS in polar night, not absent data.

## 6. Instrument mistakes I made. Same class, three times.

1. A probe that re-fetched `app.js` after load PASSED with the staleness
   defect deliberately restored, because the background revalidate had already
   replaced the cache entry. **Ask what EXECUTED, not what a later fetch
   returns.**
2. A control that hand-wrote a stale cache entry could not fail, because the
   fix bypasses that entry. **Restore the real defect, not an impression.**
3. A control that forced terrain then aimed the camera at a pole could not
   fail, because aiming fires `moveEnd` and the fix put the ellipsoid back.
   **Order the control so the fix cannot quietly undo the injection.**

And the big one: **a harness's SETUP is where the blind spot lives.**
`globe_visual_test.py` ran all eight views with `?terrain=off` and every data
layer off. The suite written to catch exactly this defect was configured into
the one state where it cannot appear.

---

## 7. Suggested first move for the next session

Do not start Capacitor. Phase 1 and Phase 2 are hard blockers and one of them
is legal.

1. Ask Don the hosting question with the three options and monthly costs.
   Do not spend anything.
2. While waiting, do Phase 6 work that needs no decision: `/api/rivers` at 31
   seconds and the 175k-point fire payload. Both are real, both are measurable,
   both are on the critical path for "top 100" regardless of store.
3. Also while waiting: write `web/privacy.html` and a support page. They are
   required, they cost nothing, and the honest answer (no accounts, no
   analytics, no tracking) is a selling point.
4. Then the FAA NASR replacement for the OpenAIP data, because it unblocks
   Phase 2 without needing Don.

Restart Don's server on 8731 when convenient; it is still running pre-08-05
Python.
