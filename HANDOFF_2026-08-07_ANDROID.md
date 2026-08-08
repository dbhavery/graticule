# Graticule — Android handoff, 2026-08-07

Branch `dev`, synced with `origin/dev`, tree clean, HEAD `537f326`.
Supersedes `HANDOFF_2026-08-06_STORE-PLAN.md` for everything native. That file
is still correct about hosting, licensing and the store accounts; this one
replaces its "no native shell exists" section, because one exists now.

---

## 0. Standing instructions — verbatim, these outrank anything below

From the session prompt:

> **Do not call the AgentTool unless the user requested it**
> **Do not use workflows or deep-research unless the user requested it**

From `CLAUDE.md` (project) and `~/.claude/CLAUDE.md` (global):

- Never guess, never assume, never hallucinate. If a file, function or fact
  might not exist, check.
- **You don't know it works unless you ran it.** Verify on the real path.
- **A check that cannot fail proves nothing.** Every new check needs a control.
- Fix the root cause. No band-aids. Root-cause depth, not scope creep.
- Never commit to `main`. `dev` or a feature branch.
- Never commit secrets. `.env` stays gitignored.
- Never delete files without permission — move to `_deprecated/<date>/`.
- Unrelated breakage goes in `issues.md`; do not fix it unless Don says to.
- **Don does not read `.md`.** Deliver prose as HTML or in chat.
- Every path/URL Don might open must be a bare ctrl+click-able link:
  `file:///C:/...` with forward slashes, no backticks, no markdown link syntax.
- No em dashes in anything outbound under Don's name.
- Don is on Max — do not spend metered API tokens on your own reasoning.
- **Share the GPU.** `py -V:3.13 C:/Users/dbhav/Projects/scripts/gpu_guard.py status`,
  take a lease before GPU work, release it after. Never kill another session's
  render. The emulator with `-gpu host` counts: take a lease.
- Work autonomously. Finish the arc, then report. Stop only for money above an
  authorized cap, contracts, API keys tied to Don's identity, destructive or
  irreversible actions, or a genuine spec fork.

Don's directives on this app, in order given:

1. Two YouTube videos are the feature spec: StormCat5 radar review `W4Qg0_vxKiE`,
   LiveStream07 population dashboard `D1GZq1qiVHU`.
2. Completely realistic Earth, centred on North America. **Superseded 08-06 —
   see directive 8.**
3. Everything toggled in tabs; deeper secondary pages and dashboards.
4. Optimise for low lag. Find free/keyless data sources.
5. "keep perfecting until this is a top-100 android and IOS store rated app."
6. "make it android ready. must be fast and intuative"
7. "location permissions to default/start on device location"
8. "why are the state and country borders not accurate when zoomed in? That has
   to be fixed."

---

## 1. Machine map — ports, interpreters, paths

| What | Value |
|---|---|
| Repo | `C:/Users/dbhav/Projects/graticule` |
| Backend (server) interpreter | `.venv/Scripts/python.exe` |
| Test/tooling interpreter | `py -V:3.13` (Playwright and `websockets` live here, NOT in .venv) |
| Don's own instance | port **8731**, was running pre-08-05 code; not running now |
| This session's test server | port **8744**, `run_server(8744, '0.0.0.0')`; **not running now** |
| Static-only shell used by native_origin_test | port 8751, started by the test itself |
| Android SDK | `C:/Users/dbhav/AppData/Local/Android/Sdk` |
| JDK for Gradle | `C:/Program Files/Android/Android Studio/jbr` (21) — **the JDK on PATH is 17 and fails** |
| Emulator AVD | `Medium_Phone_API_36.1` |
| App id | `dev.dbhavery.graticule` |
| Debug APK | `android/app/build/outputs/apk/debug/app-debug.apk`, 23.7 MB |

Start the backend:

```bash
cd C:/Users/dbhav/Projects/graticule
.venv/Scripts/python.exe -c "from graticule.server import run_server; run_server(8744, '0.0.0.0')"
```

`0.0.0.0` is required for the emulator to reach it. The default is `127.0.0.1`
on purpose and should stay that way.

**Windows gotcha that cost time:** a process bound to `127.0.0.1:8744` and one
bound to `0.0.0.0:8744` can BOTH listen, and the loopback-specific one wins for
local requests. If a change to `server.py` seems not to apply, check
`netstat -ano | grep 8744` for two PIDs and `taskkill //PID <n> //F` the old one.
`cmd.exe /c` does not work from this shell; use `taskkill` directly with `//`.

---

## 2. Verify — commands and the numbers they should print

All against a server on 8744.

```bash
py -V:3.13 scripts/keyless_test.py 8744            # 25 passed, 0 failed
py -V:3.13 scripts/ui_scroll_test.py 8744          # 27 passed, 0 failed
py -V:3.13 scripts/world_consistency_test.py 8744  # 17 passed, 0 failed
py -V:3.13 scripts/native_origin_test.py 8744      # 11 passed, 0 failed
py -V:3.13 scripts/globe_visual_test.py 8744       # 29 passed, 0 failed
```

109 checks. All five were green at `537f326`. **Read section 6 before trusting
that number.**

Android, in order:

```bash
# 1. lease the GPU first if using -gpu host
py -V:3.13 C:/Users/dbhav/Projects/scripts/gpu_guard.py acquire --need 1500 --minutes 45 --purpose "graticule emulator"

# 2. boot the emulator
"$LOCALAPPDATA/Android/Sdk/emulator/emulator.exe" -avd Medium_Phone_API_36.1 -no-snapshot-load -gpu host -no-boot-anim &

# 3. build + install
py -V:3.13 scripts/android_build.py --api-base http://10.0.2.2:8744
"$LOCALAPPDATA/Android/Sdk/platform-tools/adb.exe" install -r android/app/build/outputs/apk/debug/app-debug.apk
"$LOCALAPPDATA/Android/Sdk/platform-tools/adb.exe" shell am start -n dev.dbhavery.graticule/.MainActivity

# 4. look inside it
py -V:3.13 scripts/apk_probe.py                       # state dump
py -V:3.13 scripts/apk_probe.py --eval "<expression>"
py -V:3.13 scripts/apk_frame.py out.png --control     # the ONLY honest picture

# 5. release the lease
py -V:3.13 C:/Users/dbhav/Projects/scripts/gpu_guard.py release
```

`android_build.py --release` refuses any `--api-base` that is not `https://`.
That guard is deliberate; see section 5.

---

## 3. What shipped today — four commits

**`0261b2b` [NATIVE] Every backend call resolves against a configurable base.**
`apiUrl()` / `wsUrl()` are the only door. 12 direct fetch sites plus `dbFetch`
go through them. Resolution order: `?api=` on the URL, then
`window.GRATICULE_API_BASE` from `web/api-config.js`, then same origin.
`api-config.js` is the ONLY file the Android build rewrites, so `index.html`
and `app.js` are byte-identical across web and native. CORS added on the
FastAPI side for the Capacitor origins plus a private-address regex. The
service worker learns the API origin from its own registration URL, because it
tested `url.origin === self.location.origin` and that is false for every API
call in a shell.

**`cf7ddcf` [ANDROID] A real APK that runs.** Capacitor 7. `scripts/android_build.py`
stages `dist/` to match the server's URL space exactly, so there is no second
layout to keep in sync. `web/data` ships inside the APK, so borders and
coastlines are on disk at first paint instead of 13 MB over mobile. Plus the
two instruments in section 6.

**`bcfd51b` [BORDERS] Two reasons the lines were wrong, both mine.** See
section 4.

**`537f326` [ANDROID] Wait for the back-button plugin.** `initHardwareBack`
read `window.Capacitor.Plugins.App` once at init and returned silently when
absent. On a device it IS absent then. Now retries for 6 s. **Still does not
work — issue 50.**

Verified working on the emulator, by measurement not inspection:

- APK installs, launches, renders the globe correctly (`apk_frame.py`).
- Backend reached across the origin boundary: 495-498 live NWS alerts.
- Opens on the device location: fed the emulator Seattle, app flew to
  47.61/-122.33, dropped the marker, released the North America lock.
- Geolocation end to end: 47.606/-122.332, accuracy 5 m.

---

## 4. The border fix, and why it took two changes

Don: *"why are the state and country borders not accurate when zoomed in?"*
Two causes, both introduced by me.

**Decimation.** `slim_boundaries.py` ran Douglas-Peucker at 0.002 degrees and
the docstring defended it as "sub-pixel until the camera is below roughly
200 km". True and irrelevant, because people zoom in. What was never measured
is what it bought:

| tolerance | max error | country verts | state verts | total MB |
|---|---|---|---|---|
| 0.002 | 223 m | 74.4% | 82.6% | 6.8 |
| 0.0 | — | 100% | 100% | 8.3 |

1.5 MB for 223 m of accuracy, on a map. `TOLERANCE = 0.0` now. Coordinates are
still rounded to 5 decimals, which is 1.1 m. **Re-run `py -V:3.13
scripts/slim_boundaries.py` if the `.full.geojson` sources ever change.**

**Terrain parallax.** I unclamped the border polylines for performance on 08-06
and wrote in the code that it cost nothing to look at, because
`depthTestAgainstTerrain` is false so a flat line draws on top exactly like a
draped one. **That is true about occlusion and false about position.** A line
at ellipsoid height 0, under ground displaced upward by h, lands on a different
pixel as soon as the camera is off nadir. Measured at Four Corners, 1,477 m:

| pitch | offset |
|---|---|
| -90 | 0.0 px |
| -60 | 9.4 px |
| -45 | 13.2 px |
| -30 | 16.1 px |

Perfect overhead, which is exactly why every check passed.

**The fix follows the terrain gate, because that is what the A/B says.** One
run, same viewport, same camera, 1200x800 under SwiftShader:

| | orbit (terrain off) | zoomed to 39 km (terrain on) |
|---|---|---|
| clamped | 1517 ms | 4367 ms |
| flat | 617 ms | 4517 ms |

Draping costs 2.5x at orbit and nothing when zoomed in. The error runs exactly
the other way: 0 px at orbit, 16 px zoomed. So the lines are built flat while
terrain is off and rebuilt draped when terrain attaches, from cached GeoJSON so
a transition does not re-fetch 9 MB. Verified: orbit holds 600 ms, descending
re-draped 11,378 lines.

`?clamp=off` pins them flat for one load. **This trade has now been argued in
both directions from bad measurements. A/B it in one run before changing it.**

---

## 5. Traps that are measured, not assumed

- **Mixed content is decided by the PAGE's scheme**, before any socket opens.
  Capacitor serves from `https://localhost`, so a plain-http backend is refused
  and no `network-security-config` can help. `capacitor.config.js` derives
  `androidScheme` from the backend's scheme; a release against non-https is
  refused outright.
- **`network-security-config` takes hostnames and IP literals, not CIDR.** A
  `192.168.1.0` entry looks like a home-network rule and permits one address
  nobody uses. Use `adb reverse tcp:8744 tcp:8744` for a real phone.
- **The emulator reaches its host at the fixed alias `10.0.2.2`.**
- **Capacitor 7 needs JDK 21.** JDK 17 fails with `error: invalid source
  release: 21`, which names neither Capacitor nor the requirement.
- **`ANDROID_HOME` on this machine is the literal `:LOCALAPPDATA\Android\Sdk`** —
  an unexpanded variable pointing nowhere. `android/local.properties` carries
  the real path; `android_build.py` drops the broken env var.
- **XML comments cannot contain `--`.** Cost one Gradle failure.
- **`camera.setView` with a pitch aims FROM an altitude, not AT a target.** It
  voided one measurement today and one on 08-05. Use
  `camera.lookAt(target, HeadingPitchRange)` then
  `lookAtTransform(Matrix4.IDENTITY)`.
- **`requestRenderMode: true` makes `scene.render()` a no-op**, so idle frame
  timing reads 0.0 ms and means nothing. Set it false and spin the camera.
- **`viewer.entities` is EMPTY on a healthy boot** — every layer is a
  DataSource. A check on `viewer.entities.values.length` reads 0 whether the
  app worked or not.
- **Boundary features load from `/static` identically with or without a
  backend**, so they are never evidence that the API was reached. The alert
  badge (`#hdr-n-alerts`, hard-coded 0 in markup) is.
- Cesium ships minified: `constructor.name` is mangled (`CV`, `Ly`, `$u`). Use
  `instanceof`.

---

## 6. Instrument mistakes — read this before debugging anything visual

Three today, all the same shape: **the measurement was wrong and the code was
fine.**

**Two capture paths lied about the same frame, in opposite directions.**
`adb exec-out screencap` returned the globe region at mean luma 0.64 — pure
black. DevTools `Page.captureScreenshot` returned a white ellipse of evenly
spaced horizontal scanlines. Neither is what the app drew. SurfaceFlinger
cannot read back the WebView's hardware WebGL layer, and the DevTools
compositor resamples it into garbage. **`gl.readPixels` on Cesium's own context
straight after `scene.render()` is the only ground truth**, and it showed Earth
at night with coastlines, radar and city lights, correct the whole time. Nearly
three hours went into bisecting a shader that was never broken.
Instrument: `scripts/apk_frame.py`, `--control` hides the globe and requires
`colourFraction` to collapse (0.076 → 0.010).

**A cumulative bisect cannot attribute a cause.** Chasing those phantom
stripes I toggled MSAA, then lighting, then ground atmosphere, then sky, then
fog, then imagery, **without resetting between steps**, saw the metric drop at
`showGroundAtmosphere = false` and wrote it down as the culprit. Re-running with
a page reload before each condition showed none of them changed anything. Reset
to the control between conditions or you are measuring the stack.

**Two thresholds in `native_origin_test.py` were guesses and both were wrong.**
`viewer.entities` is empty on a healthy boot, and boundary features load from
`/static` either way. Measured a same-origin control and set the assertions
from it.

**Playwright cannot drive an Android WebView.** `connect_over_cdp` fails with
`Browser.setDownloadBehavior: Browser context management is not supported`.
`scripts/apk_probe.py` speaks raw DevTools protocol to the page target.

---

## 7. Open — this is where to start

**Issue 51 first, because it is probably the cause of issue 50.**

### 51. Boot blocks the main thread for ~8 seconds building borders

Measured at 412x915 with a longtask `PerformanceObserver`: 16-18 long tasks,
8.0-8.8 s total blocking, **worst single task 4.0-4.2 s**. Identical with
`?clamp=off`, so it is the 395,238 vertices, not the draping. Removing the
decimation raised the count 17-26%, so this got worse rather than being
introduced by it.

**Do not put the decimation back** — that is Don's directive 8 undone.
Candidates, cheapest first:

1. Build the entities in chunks across frames (`requestIdleCallback` or a
   simple index-slice loop that yields). Lowest risk, keeps everything else.
2. Build in a Worker and transfer positions.
3. Ship the borders as a tiled vector source so only what is on screen ever
   becomes entities. Correct long-term, largest change.

Measure the same way before and after, or the fix is unfalsifiable:

```js
new PerformanceObserver(l => { for (const e of l.getEntries()) window.__long.push(Math.round(e.duration)); })
  .observe({ entryTypes: ['longtask'] });
```

### 50. Hardware back exits the app instead of closing what is open

Store blocker. Reviewers press it first. `dismissTopLayer()` works when called
directly; the listener does not fire in time. Repro:

```bash
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
adb shell am start -n dev.dbhavery.graticule/.MainActivity
# wait 60 s, then
py -V:3.13 scripts/apk_probe.py --eval "document.getElementById('palette-btn').click(), 'opened'"
adb shell input keyevent KEYCODE_BACK
adb shell dumpsys window | grep mCurrentFocus     # must still be graticule
```

Note the probe itself times out in that window, which is the evidence pointing
at issue 51.

### 52. None of the five suites can see either defect

They pass, 109 checks, with both present. They run desktop Chromium on a
machine with no back button, and none watches main-thread blocking. **A
phone-shaped viewport is not a phone.** Whatever fixes 50 and 51 needs a check
that runs on the device.

### Still open from the store plan, unchanged

- **Phase 1, BLOCKED ON DON:** where the backend lives and who pays. $5-15/mo.
  Nothing signed, no card entered. Everything native stays a dev build until
  this is answered, because a release APK requires an https origin.
- **Phase 2:** OpenAIP airspace data is CC-BY-NC-SA and a store listing is
  distribution. Replace with FAA NASR (public domain, 28-day cycle). Doable
  without Don and it clears a legal blocker.
- **Phase 4, BLOCKED ON DON:** Apple $99/yr and **requires a Mac he does not
  have**. Google Play $25, no such requirement. Android ships first.
- `web/privacy.html` and a support page still do not exist. Both are mandatory
  listing fields. The honest answer (no accounts, no analytics, no tracking) is
  a selling point.
- Older perf items: `/api/rivers` at 31 s (#29), the 175,000-point fire payload
  (#31), AISStream key dead (#34), SWPC plasma 404 (#30).

---

## 8. Files worth knowing

| Path | Why |
|---|---|
| `scripts/android_build.py` | stage + sync + assemble. Finds JDK 21, fixes ANDROID_HOME, refuses insecure release |
| `scripts/apk_probe.py` | raw DevTools to the WebView; `--eval` anything |
| `scripts/apk_frame.py` | `gl.readPixels` capture with a control. The only honest picture |
| `scripts/native_origin_test.py` | serves the app from an origin that is NOT the backend |
| `scripts/phone_audit.py` | phone-size screenshots plus reach/boot measurements |
| `capacitor.config.js` | derives `androidScheme` from the backend scheme |
| `web/api-config.js` | the one file that differs between web and native builds |
| `android/app/src/main/res/xml/network_security_config.xml` | cleartext only for 10.0.2.2 / localhost |
| `issues.md` | 52 entries; 50, 51, 52 are today's open ones |
