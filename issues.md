# Graticule — known issues

Log of problems found but deliberately not fixed, per the Projects rule:
discovered breakage unrelated to the current task gets logged, not fixed.

---

## 1. Parcels layer hangs the app when many layers are on (PRE-EXISTING, **FIXED** 2026-08-02)

**Found:** 2026-08-02, during the full-layer regression for the weather rework.
**Severity:** High — the UI becomes unresponsive for ~45 s and Playwright can
neither click nor screenshot. Not a crash; it recovers.

**Reproduction**

Toggle on the pre-existing layer set (planes, satellites, airports, tfrs,
airspace, ships, quakes, volcanoes, hurricanes, aurora, terminator, cables,
countries, states, cities, **parcels_us, parcels_wa**, launches, tsunamis,
severe, news) at the default global camera, wait ~16 s, then evaluate any
trivial JS.

**Measured**

| Layer set                            | `page.evaluate("()=>1")` |
|--------------------------------------|--------------------------|
| The 9 new weather layers only        | 4 ms                     |
| Legacy set **minus** parcels         | 3 ms                     |
| parcels_us + parcels_wa alone        | 55 ms                    |
| Full legacy set **including** parcels| **45,780 ms**            |

Individually every layer is fast — including cities at 7,342 entities. The
stall only appears when parcels run alongside a loaded scene.

**Likely root cause**

`toggleParcelsUS` (web/app.js) attaches a `UrlTemplateImageryProvider` with
`minimumLevel: 14`. Cesium honours that floor while the camera is at globe
scale, so it tries to cover the whole visible globe with level-14 tiles — a
combinatorial explosion of tile requests. It only becomes fatal once other
layers slow the frame enough for the tile queue to run away.

**Suggested fix (not applied)**

Attach the parcels imagery only when the camera is below its usable altitude
and detach on zoom-out, the way `parcels_wa` already gates itself with
`initParcelsWACameraHook`. Roughly a camera `moveEnd` guard around the
add/remove, plus a note in the layer label that parcels are near-zoom only.

**Root cause (deeper than the theory above).** It is not just a tile-request
explosion. Adding an imagery layer runs Cesium's `_onLayerAdded`, which walks
every loaded quadtree tile and builds imagery skeletons for the new layer.
`minimumLevel: 14` floors the level for coarse tiles too, so a single level-0
root tile asks for 16384 x 8192 skeletons. Measured on HEAD: 37,351 ms of
synchronous main-thread block, then `RangeError: Too many properties to
enumerate` thrown from inside `addImageryProvider`, then the renderer process
dies. Root tiles stay loaded at every zoom, so **gating on camera altitude
alone does not fix it** — the layer also needs a bounding `rectangle`, which
clips the skeleton range.

**Fix applied.** Altitude gate (<= 12 km) plus a box around the camera's ground
point, rebuilt only when the view leaves that box; `addImageryProvider` wrapped
in try/catch so a provider can never take the scene down. Also verified the
level floor was wrong: z14 returns 404, z15 returns real geometry.

**Measured after** (in-page, so the number is not CDP latency): 0.7 ms at globe
scale (not attached, 0 tiles), 8.9 ms at 3 km, 28.2 ms at the 12 km ceiling, 0
render errors. Parcel boundaries confirmed by eye over Seattle.

**Note on the measurements in the table above:** `page.evaluate` round-trip
time is not a usable instrument on this machine — the same code measured 3.8 ms
and 41.7 s on consecutive runs with ~47 Chrome processes alive. Attribution
came from a contiguous three-case run (parcels alone 3.4 ms, legacy without
977 ms, legacy with 1,015 ms) and from in-page timing.

---

## 2. Cities layer killed the renderer (PRE-EXISTING, **FIXED** 2026-08-02)

**Symptom:** enabling Cities alone stopped the scene with
`RangeError: Failed to set the 'length' property on 'Array': Invalid array
length` thrown from `createPotentiallyVisibleSet`. Cesium catches this into
its own error panel, so it never reached `window.onerror` — automated checks
watching `pageerror` reported "no errors" while the app was dead on screen.
Detection now hooks `viewer.scene.renderError`.

**Root cause:** Cesium builds a single glyph texture atlas per LabelCollection
and allocates eagerly, ignoring `distanceDisplayCondition`. All 7,342
populated places were created with label text, overflowing the atlas.
Measured threshold: 1,000 labels fine, 3,000 crash.

Ruled out along the way: coordinates (all 7,342 finite and in range), empty
label strings, `distanceDisplayCondition`, and `translucencyByDistance`.

**Fix:** every city keeps a point; labels exist as objects on all of them but
carry text only for a working set of up to `CITY_LABEL_CAP` (900), chosen by
scalerank then population and filtered to those in range at the current camera
altitude. `relabelCities()` re-runs debounced on `camera.moveEnd`, so smaller
towns still appear as you zoom in. Verified: 41 labels at globe view, 900 at
regional, no render errors at any zoom.

**Also corrected nearby:** the city fade used
`NearFarScalar(0.6·farM → 0, 0.35·farM → 1)`, i.e. `far < near`, which the
class does not accept. Reordered. This was a genuine bug but was *not* the
crash cause — worth recording so nobody re-derives that dead end.

---

## 3. `applyPerfPreset` does not implement the entity caps it advertises (OPEN)

**Found:** 2026-08-02.
**Severity:** Low, but it is a UI that lies.

Settings → Performance offers "Low — 2k ships · 2k planes", but
`applyPerfPreset` only adjusts `scene.maximumScreenSpaceError`; the code
comment concedes "layer-specific entity caps would require backend
cooperation". Either implement client-side caps when building the entity sets,
or reword the preset hints to describe what actually changes.

---

## 4. Cesium ion 401 on boot (EXPECTED, not a bug)

`api.cesium.com/v1/assets/2` returns 401 when `CESIUM_ION_TOKEN` is unset. The
app falls back to ESRI World Imagery and works fine. Only worth setting a
token if ion-hosted terrain or OSM Buildings are wanted.

---

## 5. `#layers` selectors missed for months (PRE-EXISTING, **FIXED** 2026-08-04)

**Found:** 2026-08-04, while restyling the rail to the Weatherfront shape.

Eleven CSS rules were written against `#layers`. The containers have been
`#layers-earth` and `#layers-sky` since the rail was split into tabs, so every
one of those selectors matched nothing and each layer row in the EARTH and SKY
panes rendered as an unstyled browser checkbox with its label and count run
together on one line. Confirmed pre-existing against `HEAD` before the fix.

Fixed by scoping to a `.layer-list` class on both containers and converting the
rows to the same `.sw` switch the rest of the rail uses.

---

## 6. Feed-health chips dimmed the division pills (PRE-EXISTING, **FIXED** 2026-08-04)

**Found:** 2026-08-04, measuring why the selected division read as disabled.

`refreshFeedChips()` ran `document.querySelectorAll('.chip')` and wrote
`data-state` on every match. The rail's division pills carry the same class, so
each one picked up `data-state="off"` and with it `.chip[data-state=off] {
opacity: 0.45 }`. Measured: the selected pill rendered at rgb(41,103,125)
instead of the accent rgb(77,210,255) — the accent at 0.435 alpha.

Fixed by scoping both the census and the flicker to `#feedstrip-chips`.

---

## 7. NEXRAD tilt needs a Level II decoder (OPEN, by design for now)

**Found:** 2026-08-04, adding the Weatherfront radar division.

Weatherfront's radar division has a TILT row (0.5° / 0.9° / 1.3° / 1.8° /
2.4° / 3.1°). Graticule's does not, and the division says why.

IEM's RIDGE tile cache publishes the lowest elevation cut only. Measured
against a working control, three times at three sites:

| Product | KTLX | KDMX | KMPX | KFWS |
|---------|------|------|------|------|
| N0Q (0.5° reflectivity) | 200 | 200 | 200 | 200 |
| N1Q / N2Q / N3Q (1.5° / 2.4° / 3.4°) | 503 | — | — | — |
| N0U / N0S / N0Z / N0B / NET | 200 | 200 | 200 | 200 |
| N0R, DVL, DAA, NTP, N0X, N0C, N0K, N0H, EET | 503 | — | — | — |

The 503 body is IEM's own mapserver saying "Did not get image data back" for
`prod=N1Q`, so the product does not exist in that cache rather than being
throttled.

Unidata THREDDS serves NEXRAD Level II keylessly (verified HTTP 200) but as
binary radials, so a tilt selector needs a server-side decoder — materially
larger than anything shipped so far. Not started; Don has not chosen it.

---

## 8. Selection was animated, so it was only as fast as the render loop (**FIXED** 2026-08-04)

**Found:** 2026-08-04. Written off as a test artifact the day before; it was
not.

Eight of nine division pills read as unselected more than a second after being
clicked. `.is-active` was already on the element while `getComputedStyle`
still returned the unselected `rgba(255,255,255,0.055)`, with two running
animations on the node.

**Measured**

| Transitions | Result after a 1.2 s wait |
|-------------|---------------------------|
| default     | 8 of 9 pills `rgba(255,255,255,0.055)`, 2 running animations |
| `transition: none` injected | 9 of 9 `rgb(77,210,255)`, 0 animations |

On a busy frame the animation clock stops advancing, so a 140 ms transition on
a *selected* colour makes selection feedback only as fast as the render loop.

**Fix:** hover keeps its fade; selection does not transition, on the division
pills, the mode tabs or the radar product list.

---

## 9. Reference lines could not be defaulted on (**FIXED** 2026-08-04)

13.1 MB of state borders and 4.1 MB of country borders, 395,238 coordinates at
float64 repr, for lines drawn one pixel wide. Radar over an unlabelled globe
tells you a storm exists but not where it is, so this was blocking the boot
composition.

**Attribution** — in-page timing, because `page.evaluate` round-trips are not
a usable instrument on this machine (issue #1):

| Stage | ms |
|-------|-----|
| fetch (13.1 MB, gzipped to 4.6 MB) | 1,739 |
| `JSON.parse` | 79 |
| `Cartesian3.fromDegrees` x 320,146 | 79 |
| entity build, clamped | 84 |

The rest is Cesium's ground-polyline compile on later frames.

**Measured, boundaries on vs off (SwiftShader):**

| Build | Settled | Stalls |
|-------|---------|--------|
| before | 15 s | 5.6 s, 9.2 s |
| after `slim_boundaries.py` | 9 s | 3.8 s |
| control, boundaries off | 9 s | — |

**Fix:** `scripts/slim_boundaries.py` — Douglas-Peucker at 0.002° (220 m,
sub-pixel until the camera is under ~200 km) and 5-decimal coordinates (1.1 m,
under the source data's own accuracy). 17.2 MB → 8.2 MB. Plus `data-defer` on
the two switches, so the remaining compile lands 1.2 s behind first paint on a
map that is already drawing.

---

## 10. Three search buttons rendered as fallback boxes (**FIXED** 2026-08-04)

U+2332 has no coverage in JetBrains Mono or Inter, the only two faces the app
loads, so the topbar search chip, the rail-head palette button and the palette
input all drew a box. Replaced with inline SVG, which inherits `currentColor`.

---

## 11. RainViewer's nowcast is often empty (BY DESIGN, worth knowing)

Measured repeatedly on 2026-08-04: 12 frames, all `past`, the newest 7-10
minutes old, `nowcast: []`. The transport's marker sits on the newest observed
frame, so with no nowcast it sits at 100% of the track — it used to call a
ten-minute-old frame "NOW". It now reads LATEST in that state.

Any test of the marker's forecast branch has to inject synthetic forecast
frames; `tl_test.py` does, and asserts the marker moves off 100% and relabels.
A test that only ran against the live feed would pass while proving nothing
about half the behaviour.

---

## 12. Open-Meteo prices a request by variables x locations x hours (**FIXED** 2026-08-04)

**Found:** 2026-08-04, after the model division moved from `current=` to
`hourly=` for the forecast scrubber.

Two mistakes, both fixed:

**The window included the past.** `forecast_days=2` returns from 00:00 UTC
today, so roughly half of every response was hours that had already happened
and could never be scrubbed to. Replaced with an explicit
`start_hour` / `end_hour` from the current hour forward. Verified against the
API before relying on it: a 24-hour window returns exactly 25 hours.

**A four-variable field cost four times a plain one.** With a flat 24-hour
window, five of the six mesoanalysis fields sampled 140 points cleanly and
`bulk_shear` — the only field needing four variables to derive one number —
answered 429. The field requested *after* it succeeded, which rules out a
cumulative minute quota and points at that single request's weight.

The window now shortens as the variable count rises
(`max(6, round(24 / nvars))`), holding the cost roughly flat. Six hours still
covers the convective window deep-layer shear is read over. `meso_test` passes
on all six fields, with the shear value independently recomputed from a
separate API call: 21.51 mph both ways.

---

## 13. The lens flare was mirroring the map onto itself (**FIXED** 2026-08-04)

**Found:** 2026-08-04, by looking at a screenshot rather than at a metric.

Upside-down ghosts of "UNITED STATES OF AMERICA" across Texas and coloured
smears of the reflectivity across the lower half of the frame. Cesium's
lens-flare stage takes the brightest pixels in frame and paints mirrored
copies of them back through the screen centre — which is what a real lens does
and is fine over a globe from space. Once the base map is graded down under a
field, the brightest things in frame become the white boundary labels and the
radar returns.

**Measured, identical scene:** ghosts present with the stage attached, gone
with it removed, and absent from the pre-grade build because the bright
terrain used to swamp them.

**Fix:** the flare follows the same condition as the grade — suspended while a
field is drawn over the base, restored when the globe is the picture again.
The Settings switch still decides whether it is wanted at all.

---

## 14. `baseHasOverlay()` counted the city lights (**FIXED** 2026-08-04)

Found while writing the test for #13, and it invalidated the reasoning behind
the grade's own commit message. VIIRS night lights are an imagery layer over
the base, so `baseHasOverlay()` returned true from boot with every data layer
off. The map was held at the muted grade permanently and the lens flare was
suspended for good — the "conditional" grade was never conditional.

**Fix:** night lights carry `__scenery = true` and are skipped. They *are* the
base map at night, not a field competing with it. Measured after: radar on →
overlay true, brightness 0.58, flare off; radar off → overlay false,
brightness 1.0, flare on.

---

## 15. Two `display` rules outranked `.hidden` (**FIXED** 2026-08-04)

Both surfaced by the rail footer's new clear-all, which makes "switch
everything off" one click instead of nineteen.

`#timeline` sets `display: flex` at id specificity, so the plain `.hidden`
rule never beat it and `syncTimelineVisibility()` had no effect on screen: the
radar transport stayed up over a globe with no radar on it.

`.gfx-scale.is-vertical` sets `display: flex` at two classes and lands after
`.gfx.hidden`, so the standing colour scale ignored being hidden and left a
REFLECTIVITY ramp on air describing nothing.

Both had correct JavaScript. Neither had a visible effect. `chrome_test.py`
checks both directions — the chrome must be up with radar on and gone with
everything off — so a rule that simply hid it always would fail.

---

## 16. The whole UI was set below the readable floor (**FIXED** 2026-08-04)

**Found:** 2026-08-04, after Don said the app was "not very intuitive to a
human... extremely hard to understand what I want to click."

`scripts/ui_audit.py` walks every visible text node across all nine divisions,
three tabs, the dashboards, the settings modal and the palette, composites each
element's ancestor backgrounds into a real colour (the app is layers of rgba
over black, so a naive read returns "transparent") and computes WCAG contrast.

| | before | after |
|---|---|---|
| distinct strings failing AA | 178 of 486 | **0 of 439** |
| text elements below 12px | 1,116 of 1,480 | **0** |
| distinct font sizes | 7 (9/10/11/12 carried 96%) | 6 (12/13/14/16/20/28) |
| value-column x-edges per pane | 2 | 1 |
| controls off their row centre | 3 | 0 |
| pointer targets under 24px | 10 | 0 |

`--text-mute: #5a6373` was one declaration and most of the damage: 3.19:1 on
the rail, and the colour of nearly every label in the app.

The 2026-08-02 pass fixed the *number* of type steps and got the sizes wrong.
Seven steps is right; 9-10-11-12 is four weights of small.

---

## 17. Every fade-in could stall indefinitely (**FIXED** 2026-08-04)

**Found:** 2026-08-04, writing a test for whether Escape closes Settings.

Measured 1.2 s after clicking the gear, with no `hidden` class on the element
and its own rule saying `opacity: 1`, `#settings-overlay` computed to
**opacity 0**. Its 180ms fade had not advanced at all. `#palette` did the same:
`elementFromPoint` found it on top of the screen while it was still invisible.

Same root cause as issue #8 — on a busy frame the animation clock stops
ticking, so anything whose visibility is gated by a transition or a keyframe
can be arbitrarily late, or never arrive. It is the reason a click on the gear
could look like it did nothing.

**Fix:** nothing that gates visibility is animated. Transforms still animate —
a modal that arrives 8px low and settles is a cosmetic miss; a modal that never
becomes opaque is a broken button. `overlay_test.py` covers it, plus Escape on
every overlay and the palette always being the topmost one.

---

## 18. The rail scrolled and nothing said so (**FIXED** 2026-08-05)

**Found:** 2026-08-05, sampling pixel columns at the rail's right edge.

`#hud-panes` is `overflow-y: auto` and the World division put **688px of
content below the fold**, with the last visible row — a country in the
population rank — sliced through the middle. A pixel sample of the 16px
scrollbar gutter, x=323..338, returned **value 14 in every column**: identical
to the panel background. Not a faint bar, no bar.

Two separate causes:

* The styled thumb was `rgba(255,255,255,0.16)` inside a 3px transparent
  border — a 4px hairline at **1.60:1** against `--rail-bg`, under the 3:1
  WCAG 1.4.11 floor for a non-text UI component.
* Chromium's overlay scrollbars do not paint until the user is already
  scrolling, which is no use to someone who does not know there is anywhere to
  scroll to.

**Fix:** thumb to 0.38 white (**3.54:1**) in a drawn track, plus the app's own
top/bottom edges with a `▾ MORE` marker, toggled from scroll position rather
than hover so they are true whether or not a bar is painted.

---

## 19. Three async notifications, none of them reliable (**FIXED** 2026-08-05)

**Found:** 2026-08-05, while #18's test failed intermittently — 3 of 4 runs.

Traced over 2s at 150ms intervals. Each is measured, not inferred:

| Path | Behaviour |
|---|---|
| `scroll` event | after a programmatic scroll, arrived **>1050ms later or not at all**, run to run |
| `ResizeObserver` | on a division switch, fired **450–600ms** after the content had already changed |
| `scrollTop` alone | when content shrinks, the browser clamps silently, so a stale "more above" survived with nothing to clear it |

For that window the rail asserted there was more above a division that fits in
one screen. **Third instance of this pathology** — issue #8 (division pills)
and #17 (fade-ins) are the same failure: on a busy frame an async notification
is arbitrarily late or absent, and the symptom is chrome stating something no
longer true.

**Fix:** `room > 4` gates both edges so the clamp case cannot lie; division and
tab switches call the sync directly rather than waiting to be noticed; and a
400ms tick backs all of it up. Four consecutive clean runs of 27 checks after.

---

## 20. Half the country missing from the by-state board (**FIXED** 2026-08-05)

**Found:** 2026-08-05, reading the Severe Weather dashboard and noticing
California absent while the map printed a Ventura County heat warning.

`STATE_OF` parsed the trailing two characters of `areaDesc`. That is
`"County, ST; County, ST"` for county-based products and free prose for
zone-based ones — `"Kiska to Attu Pacific Side"`, `"Rio Grande Valley of
Eastern Hudspeth County"`. Measured on a live pull of 63 active alerts:

| | attributed | distinct areas |
|---|---|---|
| areaDesc regex | 30 of 63 | 4 |
| `geocode.UGC` | **62 of 63** | **22** |

States the regex had never once seen: AN AR AZ **CA** IA IL MO MS MT NC NV OK
PK PR TN TX VI WY.

**Fix:** `geocode.UGC` first (its first two characters are the state or marine
prefix by definition, and it was present on 62 of 63), regex as fallback. The
15 marine prefixes are named rather than left as `PK 6`, and the card title
says what it covers.

---

## 21. NDBC buoy count fails a fixed threshold (**OPEN — upstream, not the app**)

**Found:** 2026-08-05, running `water_test.py` after unrelated UI work.

`water_test` asserts `buoys >= 500` and got 390. Checked against the source
rather than assumed: `ndbc.noaa.gov/data/latest_obs/latest_obs.txt` was
publishing **344 lines** at the time, and `/api/buoys` returned **390
features** — the app is rendering everything the feed gave it.

The assertion measures how many stations reported to NOAA in the last hour,
not anything about this code, so it will fail on any quiet hour. Left alone
rather than moving the threshold: what the app's data-health bar should be is
Don's call, not a number I pick to make a test go green.

Related: the two failures logged previously in this suite were also upstream
(CO-OPS error body for one station; NWPS serving 329 of 11,602 gauges cold).

---

## 22. The World pane and the board it opens were 24 million people apart (**FIXED** 2026-08-05)

**Found:** 2026-08-05, reading both totals in one `page.evaluate` rather than
comparing two screenshots taken minutes apart.

| | reading |
|---|---|
| rail `#wp-total` | 8,308,414,237 |
| board `#wd-total` | 8,284,390,050 |
| **difference** | **24,024,187** |

Stable across repeated reads, so not a tick artefact. Continent rows disagreed
too — Asia by 18M, Europe by 2.4M.

Two parallel datasets: the rail projected UN WPP constants hard-coded in
`app.js` (15 countries); the board summed 217 World Bank rows from
`world_population.json`, a file that only loaded if you opened the board.

**Fix:** one dataset, loaded when the division initialises. `renderRank()` now
takes the epoch, because the baselines are a year apart.

### 22b. The pane contradicted itself

| | value | implies |
|---|---|---|
| `DEATHS_PER_SEC` 2.51 | — | 79.2M/yr vs UN's 62M |
| births − deaths | 1.73/s | 54.6M/yr |
| odometer `WORLD_BASE.rate` | 0.0085 | **70.0M/yr** |

A 22% disagreement between a counter and the breakdown printed directly under
it — the same defect the world board's header calls out in the source it
replicates. One pair of vital rates now, declared once (`const` does not hoist,
so they live at the rail and the board aliases them).

### 22c. And the dataset's own rate did not fit either

With the vitals fixed the odometer still grew at 84M/yr, because the file's
population-weighted rate is 0.970%/yr. No credible birth/death pair produces
it: holding the UN's births needs 48M deaths, holding its deaths needs 146M
births. `132M − 62M = 70M` is a coherent system. The total keeps the country
data as its **base** and grows at the rate the vitals describe; rows still
project individually and drift ~0.12%/yr from the headline until the data is
rebaked, which is stated in the code.

---

## 23. A ranking that did not rank by the number it showed (**FIXED** 2026-08-05)

`world_population.json` is sorted on the 2024 baseline; every displayed value
is that baseline projected forward at each country's own rate. Faster-growing
countries had overtaken, and the board printed it:

```
136  Armenia    3,182,120
139  Qatar      3,314,227
```

**Fix:** rank on the projected figures. `WD.ranked` feeds the top-15 table, the
tail window and the rail pane, so the three cannot disagree about who is where.

---

## 24. The full-screen board did not fit the screen (**FIXED** 2026-08-05)

`scrollHeight` 977 in a 950px viewport at 1600x950 — the last REST OF COUNTRIES
row ran to y=966 and was drawn straight across the source line in the footer.

Not the row count. **A `1fr` grid track carries an implicit `min-height: auto`
and will not shrink below its content**, and one auto minimum anywhere in the
chain is enough to push the whole board off the bottom. `.wd-bot` already had
`min-height: 0`; its `.wd-block` children and their `repeat(5, 1fr)` rows did
not.

**Fix:** release the floor at every level. Overflow 27px → 0, all five rows
kept. `#worlddash` also still faded `opacity: 0 → 1` over 200ms — the last
overlay in the app gating visibility on a transition (see #17). It does not
animate now.

---

## 25. Thirteen sliders the readability pass never reached (**FIXED** 2026-08-05)

That pass scoped to `.wf-row` and `.ctl`. The settings modal uses neither, so
all thirteen of its ranges — atmosphere, vignette, idle rotate, seven layer
opacities, alert opacity, fade, hover delay — were still the untouched 3px
hairline with no visible thumb, measured **201x3**. Same fix as the rail: 24px
hit area, 4px track, 14px thumb.

**Also a defect in the checker, not the app:** `ui_audit.py` measured the
`<input>` for a checkbox or radio rather than the `<label>` wrapping it. A 16px
box inside a 400x33 row is not a 16px target, and the audit was reporting four
false failures in settings. An audit that cries wolf stops being read.

---

## 26. No viewport tag, so a phone rendered the app at a third size (**FIXED** 2026-08-05)

**Found:** 2026-08-05, first time anything measured this app at phone size.

`<meta name="viewport">` was absent. Without one a phone lays the page out at a
980px fallback width and scales the result down.

| measured at 393x852 | |
|---|---|
| `innerWidth` reported | **1185** |
| effective size of a 12px label | ~4px |
| horizontal scroll | **205px** |
| manifest / service worker | none |

The entire readability pass (issue #18) was void on mobile, and no desktop
suite could see it — they all run at 1600x950.

**Fix:** viewport tag with `viewport-fit=cover`, a phone layout (bottom sheet,
44px targets, safe-area insets), and the PWA layer. `scripts/mobile_test.py`,
62 checks across four device sizes plus an offline reload.

### 26b. Four bugs I introduced doing it

| | measured |
|---|---|
| `--rail-w: 100vw` for the sheet | nine surfaces position off that token to clear the left rail; their containing block started at x=412, alert banner computed to `left: 420, width: 2` |
| aspect-padded boot frame | asked 69° of longitude to fit 153° of latitude; phone booted at **11,920 km**, looking at the whole planet |
| SW aborting `/api/` at 4.5s | `/api/nws/alerts` returns in ~1s alone, exceeded the deadline under boot concurrency → hard 503 with nothing cached to replace it. **Two console errors that did not exist before the worker.** |
| `.rt-when-drawing` on coarse pointers | "a finger cannot hover" applied to a control gated on *drawing*, not hover → three dead buttons on every touch device |

The boot frame is the cheap lesson: a fix for a problem nobody had confirmed
was real. The phone frame was picked by rendering four candidates and looking.

---

## 27. Tapping the sheet handle silently turned layers on (**FIXED** 2026-08-05)

**Found:** 2026-08-05, chasing a sheet that would not open past its half detent.

Traced with a spy on `sheetGo`: **one** tap logged

```
2   t=36627   from step()
1   t=36634   from the change listener
```

A touch fires touchstart/touchend, then the browser synthesises a click at the
same **screen** coordinates. By then the sheet has moved several hundred pixels,
so the point that was the drag handle is over a layer row. The phantom click
toggled a layer, and the sheet collapsed in response to a change the operator
never made.

The layer toggle is the real defect; the detent was the symptom that exposed it.
`preventDefault` on `touchend` is the documented remedy and **did not work** —
the click still arrived. So the sheet swallows clicks inside itself for 350ms
after its geometry changes, in the capture phase, rather than arguing with the
platform about which synthetic events it owes whom.

The auto-collapse-on-layer-change was removed rather than repaired. It caused
two bugs and was the wrong feature: a panel that moves when you did not move it
is what makes an app feel like it is fighting you.

---

## 28. The stalled animation clock, fourth instance (**FIXED** 2026-08-05)

I put a 260ms transform transition on the sheet and argued **in the comment**
that it was safe, because a stalled transform leaves the sheet in the wrong
place rather than invisible. Measured:

| after the class changed | computed `translateY` |
|---|---|
| expected at 260ms | 0px |
| **actual at 1,500ms** | **157px** (from 731px) |

Still 60% incomplete six times past its own duration. Cesium renders the globe
on the main thread and the clock barely advances.

A sheet stuck at peek is a tap that appears to do nothing — the exact complaint
this run of work started from. After #8 (division pills), #17 (fade-ins) and
#19 (scroll edges), the rule generalises: **if the clock can stall, nothing a
user is waiting on goes behind it.** The sheet snaps.

---

## 29. `/api/rivers` takes 31 seconds (**OPEN — pre-existing**)

Noticed while timing endpoints for #26b, unrelated to that work. Measured
directly against the server, not through the worker:

```
/api/nws/alerts    200  1.04s
/api/lsr?hours=12  200  0.95s
/api/buoys         200  0.69s
/api/rivers        200  31.22s
```

11,602 gauges. Not touched, since it is outside the mobile task and the fix is
likely a server-side cache or a bbox filter — Don's call on which.

---

## 30. SWPC solar-wind plasma endpoint 404s (**OPEN — pre-existing**)

Seen in the boot log on every start, unrelated to the keyless work:

```
SWPC plasma failed: Client error '404 Not Found' for url
'https://services.swpc.noaa.gov/products/solar-wind/plasma-2-hour.json'
```

The consequence is visible, not silent: the telemetry line prints
`solar_wind=? km/s` while Kp and X-ray next to it are fine, so one field of the
space-weather readout has been dead. NOAA appears to have moved or retired the
2-hour plasma product. Not fixed here — finding its replacement is its own
task, and this run was about API keys.

---

## 31. The fires layer ships ~175,000 points over the WebSocket (**OPEN — pre-existing**)

Not caused by the keyless swap, and not made worse by it — the keyed feed it
replaced pushed 179,107 rows where the keyless archive pushes 174,628. Both are
about 15 MB of CSV becoming a very large snapshot payload.

Left alone deliberately: cutting it would have meant changing coverage at the
same time as changing the source, and then neither change could be measured
against the other. The obvious fixes are a confidence floor (`low` is ~5% of
rows), a viewport filter, or serving fires over their own paged endpoint rather
than the snapshot. Don's call.

---

## 32. Two test suites ignored the port they were given (**FIXED**)

`ui_scroll_test.py`, `world_consistency_test.py` and `ui_audit.py` hardcoded
`http://127.0.0.1:8731/`, so passing a port did nothing and they silently
measured whichever server happened to already be running — usually Don's, not
the one under test. All three now take a port argument.

This is the same failure as #33 below and they happened within minutes of each
other: **a test that quietly measures the wrong process reports a pass that
means nothing.**

---

## 33. A second server bound nothing and its tests passed anyway (**FIXED**)

Launching a keyless server while an older one still held the port produced:

```
ERROR: [Errno 10048] error while attempting to bind on address ('127.0.0.1', 8743)
```

three lines deep in the log — and uvicorn carried on running the process's
FEED tasks. So two processes were polling live data while the OLD one answered
HTTP. Nineteen checks then passed against code that no longer existed on disk;
the discrepancy only surfaced because one control assertion ("`emergency` is
rare") disagreed with the source I had just written.

`scripts/run_keyless.py` now probes the port and refuses to start if it is
taken. Verified by running it twice: the second exits with
`REFUSING TO START: something is already listening on 8743.`

---

## 34. AISStream accepts the key and then sends nothing (**WORKED AROUND**)

Found while checking the keyed path still worked. Not caused by the keyless
change — Don's already-running instance, on the original `ais.py`, showed the
same thing.

```
AIS: connected                 <- 18:20:25
(no messages, ever)
ships in state: 0
```

Reproduced outside the app with a bare websocket client and the key from
`.env`: connected, subscribed, **not one message in 25 s**. Worldwide AIS is
thousands of messages a minute, so this is not a quiet ocean.

The old loop could not detect it: `async for raw in ws` waits forever, so a
silent socket and a working one look identical, and the ships layer had been
empty for as long as anyone had looked at it.

Now: 90 s of silence ends the connection, and two consecutive silent
connections retire the key and switch to keyless Digitraffic. Verified end to
end on the keyed server — after 180 s it logged the handover and the layer went
from **0 to 1,374 vessels**. The layer also stops claiming worldwide coverage,
because the feed itself now announces its source instead of the UI inferring
it from whether a key exists.

Still open for Don: whether the aisstream.io key is expired, over quota, or the
service is down. Worth checking before paying it any more attention.

---

## 35. Black disc at the poles (**FIXED**) — and four wrong diagnoses on the way

Don tilted north of Canada and saw a black ellipse through the planet. Nothing
in any suite could see it: every check reads state, and this was pixels.

**Cause.** Web Mercator is undefined at the poles, so EPSG:3857 stops at
±85.0511°. Every basemap — Esri, OSM, OpenTopoMap, VIIRS city lights — is
Mercator, so above that latitude nothing was drawn and the globe's navy
`baseColor` showed through.

**Four diagnoses that were wrong**, each killed by a measurement:

1. *"maximumLevel is wrong."* Guessed 8; the layer stops at 7 and level 8
   returns 400 with an XML body. Real bug, but the hole was unchanged.
2. *"The Mercator base is smearing its top texel row over the cap."* Clipped
   the base to `WebMercatorProjection.MaximumLatitude`. Rendering Esri alone
   over a magenta `baseColor` showed a clean magenta disc, so the cap was a
   genuine gap, not a smear.
3. *"Blue Marble fills it."* It did — with BATHYMETRY. The Arctic came back
   dark ocean, which against Esri's bright sea ice still read as a hole.
4. *"MODIS true colour tracks the season."* It does not: in polar night it
   returns BLACK PIXELS, not absent data, so it painted a black disc over
   Antarctica in August. Verified by rendering the south pole.

**Also found while doing it:** `ImageryLayerCollection.add()` returns nothing,
only `addImageryProvider()` returns the layer. Assigning from `add()` left
`baseImageryLayer` null, so the removal at the top of `applyImageryBase` never
fired and every basemap switch stacked another copy — three Esri layers deep
after two swaps.

**And the trap this repo already knew:** the GIBS EPSG:4326 tile matrix is not
a power-of-two pyramid (measured 2x1, 3x2, 5x3, 10x5 against Cesium's 2x1,
4x2, 8x4, 16x8). A comment on the night basemap says exactly this. I hit it
anyway.

**Fix.** Both caps are drawn with a flat ice tone from a 69-byte inline PNG,
clipped to the two polar rectangles, graded with the base map. Above 85° there
is sea ice or ice sheet all year, so it is the most truthful thing available,
it costs no network, and it cannot fail seasonally or on a tile matrix.

Residual, cosmetic: in polar night the south cap sits slightly brighter than
the shaded terrain around it — a soft disc, not a hole, at a pole the app
never opens on. Real polar imagery would need a projection Cesium cannot
consume for imagery (EPSG:3413/3031).

---

## 36. The globe felt un-rotatable (**FIXED**)

It always rotated — Cesium's default controls — but "Stay centred on North
America" reset its idle timer on `mousedown`, `wheel`, `keydown`,
`touchstart` and `pointerdown`, and **not on `mousemove`**. So "idle" meant
"sent no click", which is exactly what a person does while READING. Drag the
globe to a storm near Japan, stop touching anything to look at it, and twelve
seconds later the camera flew back to North America on its own.

Now: a moving cursor counts as a person, and the grace period is 90 s rather
than 12 — long enough to mean "walked away" instead of "paused to look".

---

## 37. The polar cap fix from #35 never installed (**FIXED**)

`initPolarBackstop()` shipped referencing `POLAR_MAX_LEVEL`, a constant that
is declared **nowhere in the file**. Both caps threw
`ReferenceError: POLAR_MAX_LEVEL is not defined`, the function's own
`try { } catch { console.warn }` turned that into a console warning, and the
app ran a full session with no polar backstop at all — while a handoff, a
memory file and issue #35 above all said it had one.

What actually filled the caps was Cesium upsampling the texels at the
Mercator edge: a **teal pinwheel** radiating from the north pole and a hard
**white ellipse** over Antarctica. Both were on screen the whole time.

Nothing could see it. Every check in the repo reads state, and there was no
state to read — `polarBackstopLayers.length` was 0 and nothing asserted on it.
Found by rendering the globe and looking at the picture.

**Fix.** Natural Earth II, the geographic raster Cesium already serves beside
its own build. Its `tilemapresource.xml` was read, not assumed: EPSG:4326,
bounds ±90, levels 0-2 at 0.703/0.352/0.176 °/px — a true power-of-two
pyramid, which is exactly what GIBS EPSG:4326 is not. Falls back to the flat
ice tone if unreachable, logs a `console.error` rather than a warning when a
cap is missing, and publishes the installed count on
`window.__graticule_scenery` so a test can assert on it. `#35`'s residual
south-cap complaint is gone with it: the cap is real imagery now.

## 38. The lens flare fired with the sun behind the camera (**FIXED**)

Cesium's lens-flare stage never asks where the sun is. Once attached it
mirrors the brightest pixels in frame back through screen centre every frame,
in frame or not. At the full-globe view on the solstice — sun almost directly
**behind** the camera, no part of it on screen — it wrapped the planet in a
rainbow halo and turned the Pacific neon cyan. It was the worst-looking frame
in the app and it was one zoom-out away.

Gated on the two conditions the Settings label already claimed: the sun is
inside the frustum, and the Earth is not in the way (`EllipsoidalOccluder`).
Re-evaluated on `camera.changed` and `camera.moveEnd`, plus the 30 s celestial
tick so a stationary camera still watches the sun set. Verified in both
directions — the halo is gone, and the flare still fires correctly when the
star is genuinely in frame.

## 39. The polar cap read as a disc pasted on the pole (**FIXED**)

Natural Earth II's Arctic ocean is brighter and bluer than the Esri imagery it
meets at 85.05°. Summed channel error across the seam: **130** ungraded,
**8.3** now, from a measured 24-cell brightness/hue sweep.

Worth recording because the reasoning was wrong twice before the measurement
settled it. Raising saturation to "pull it toward teal" **crushed** the green
channel, which was the one that had to rise. The first hue shift went the
wrong way and made it worse in all twelve cells it was tried in. Neither
mistake was visible without measuring across the boundary.

---

## 40. The white disc at the north pole was a hole through the planet (**FIXED**)

Reported as "still a black area at north pole". Rendered, it is a hard **white**
disc, and it is a different defect from #35/#37 despite sitting in the same
place.

It survived every globe-level toggle: caps hidden, base hidden, `baseColor`
set to magenta, lighting off, ground atmosphere off, skirts off. It vanished
only when **terrain** was switched off.

**Cause.** The keyless elevation service is Web Mercator, so it stops at
±85.0511°. For an imagery layer that means "nothing painted there". For a
**terrain** provider it means far more, because the provider's tiling scheme
defines the globe's entire quadtree: above 85.05° Cesium creates no surface
tiles at all. There is no geometry, nothing for the polar caps to paint on,
and what shows through the planet is the sky atmosphere on the far side.
Measured: `scene.globe.pick` straight down the pole returns `null` with real
terrain and a surface point without it.

No free elevation source is geographic — every one is Mercator — so no
provider swap fixes this. What does: real elevation buys nothing in a view
that can see a pole, so the ellipsoid takes over past ±84°.

**Why no test saw it.** `globe_visual_test.py` ran all eight views with
`?terrain=off`. The suite written to catch exactly this class was configured
into the one state where the defect cannot appear. It now loads with terrain
in its default state and asks the globe whether it has a surface at each pole.

## 41. Terrain and ground-clamped borders cost 10x the frame rate (**FIXED**)

"Super laggy." Measured with the camera moving, same instrument each time,
median frame:

| state | median |
|---|---|
| terrain on, borders on (**shipped**) | 6137 ms |
| terrain on, borders off | 2570 ms |
| terrain off, borders on | 1106 ms |
| terrain off, borders off | 964 ms |

Software rendering, so the ratios are the signal, not the milliseconds.

Two causes, and they multiply each other. Terrain dominates, and above
~1,500 km a 4 km mountain is under a pixel, so at the default orbital view it
is paid for nothing. And all **13,098** country and state boundary lines were
`clampToGround: true`, which drapes geometry against terrain tiles — note they
cost 3.5 s *with* terrain and 142 ms without. The draping bought nothing
visible either, because `depthTestAgainstTerrain` is false by deliberate
design, so a plain polyline at height 0 draws on top in exactly the same way.

Now: terrain loads on descent (hysteresis at 1,000 km so it does not re-tile
the globe while zooming), borders are not draped. Default view **6137 ms →
569 ms**, and real relief still appears on the way down, verified by eye over
the Rockies and the Alps.

## 42. applyTerrain could switch terrain back on by itself (**FIXED**)

`applyTerrain(true)` awaits its provider load. A load in flight would land
*after* a later `applyTerrain(false)` and re-attach terrain on its own. Latent
before, constant now that the view swaps terrain automatically. Each call takes
a generation ticket and a stale one discards its result. Found by the keyless
suite failing, not by reading the code.

---

## 43. Every reload was running the previous build (**FIXED**)

**This is why the pole was "still" broken.** Three sessions of fixes never
reached the browser.

`web/sw.js` routed every same-origin request, `app.js` included, through
`staleWhileRevalidate`: serve the cached copy **now**, fetch the new one into
the cache for next time. So a reload ran the **previous** build. Ship a fix,
reload, watch the old code run, see the defect still on screen.

Two things kept it hidden:

* The file's own header comment claimed the shell was versioned cache-first and
  "replaced wholesale on deploy". The fetch handler never implemented that, and
  `VERSION` had not moved off `v3`, so the cache simply persisted.
* `server.py` already sends `Cache-Control: no-store` on `/static/*`, which
  makes it look handled. **It is not. Cache Storage ignores HTTP cache
  headers** — a service worker sits above the HTTP cache, so nothing the server
  sends can reach it.

Code is now network-first with a 2.5 s timeout and cache fallback: current
whenever the server answers, still working offline. `VERSION` → `v4`.

`scripts/freshness_test.py` covers it: install the worker, change a file on
disk, reload once, ask the page what it **ran**. Two wrong instruments on the
way — a probe that re-fetched the file (passed even with the defect restored,
because the background revalidate had already replaced the cache entry), and a
control that hand-wrote a stale cache entry (unreachable under code-first).

## 44. The radar pane showed the operator our engineering problems (**FIXED**)

Two paragraphs explaining that the keyless NEXRAD service returns 503 above
the lowest cut and that lightning needs a commercial Vaisala/Blitzortung feed,
a permanently `disabled` Lightning switch, six inert product buttons, and a raw
`0.70`. All true, none of it the operator's business. See the commit for the
research this was judged against; the short version is that restraint is the
premium signal in this category and a control has to earn its space.

## 45. Two screen-capture paths both lied about the Android WebView (RESOLVED, instrument)
`adb exec-out screencap` returns the globe region PURE BLACK (mean luma 0.64);
DevTools `Page.captureScreenshot` returns a WHITE ELLIPSE OF HORIZONTAL
SCANLINES. Neither is what the app draws. SurfaceFlinger cannot read back the
WebView's hardware WebGL layer and the DevTools compositor resamples it into
garbage. `gl.readPixels` on Cesium's own context straight after `scene.render()`
shows the correct globe: Earth at night, coastlines, radar, city lights.
Nearly three hours went into bisecting a shader that was never broken.
Instrument: `scripts/apk_frame.py`, which carries a `--control` that hides the
globe and requires the numbers to collapse.

## 46. Playwright cannot drive an Android WebView (WORKAROUND)
`connect_over_cdp` fails with `Browser.setDownloadBehavior: Browser context
management is not supported` -- a WebView has no browser-level context.
`scripts/apk_probe.py` speaks raw DevTools protocol to the page target instead.

## 47. Capacitor 7 needs JDK 21; the JDK on PATH is 17 (RESOLVED)
Gradle fails with `error: invalid source release: 21`, which names neither
Capacitor nor the requirement. Android Studio's bundled JBR is 21;
`scripts/android_build.py` finds it and sets JAVA_HOME.

## 48. ANDROID_HOME on this machine is the literal string ':LOCALAPPDATA\Android\Sdk'
An unexpanded variable that points nowhere. `android/local.properties` carries
the real path and the build script drops the broken env var rather than let
Gradle prefer it. Not fixed globally -- that is Don's environment, not this repo.

## 49. A release APK must never point at a plain-http backend (GUARDED)
`https://localhost` cannot call `http://...`: mixed content is decided by the
PAGE's scheme before any socket opens, and no network-security-config can
change it. capacitor.config.js drops the page to `http://localhost` when the
backend is http, which is a DEVELOPMENT affordance only.
`android_build.py --release` refuses any base that is not https.

## 50. Hardware back exited the app instead of closing what was open (RESOLVED)
Store blocker; a reviewer presses it first. The cause was issue 51, exactly as
suspected here: `initHardwareBack` retries for the Capacitor App plugin, but on
a main thread blocked for nine seconds the retry chain does not get to run, so
no listener is attached when the key arrives and Capacitor's default -- exit --
is what runs. Nothing was wrong with the handler.
Fixed by the border work in `a0d4f69`, which cut the worst single task on the
device from 9,460 ms to 3,741 ms. Verified on the emulator, three cases with a
control, all passing: palette open -> back closes it and the app keeps focus;
nothing open -> back warns and the app keeps focus; back again -> the app
leaves. That third case is the control, because the first two also pass
against a back button that does nothing at all.
Regression test: `py -V:3.13 scripts/apk_back_test.py`, 8 checks, on device.
It reads the verdict from `dumpsys window`, not from the page: if the app
exits, the page is gone and a page probe just errors.

## 51. Boot blocks the main thread (OPEN, "fast" -- 67% better, not fixed)
On the device, measured by `scripts/apk_longtasks.py`:

  | build                  | tasks | blocking  | worst    |
  |------------------------|-------|-----------|----------|
  | 247d34f (before)       |  128  | 40,959 ms | 9,460 ms |
  | a0d4f69 borders        |  108  | 17,337 ms | 3,741 ms |
  | e474d9a hot paths      |   73  | 13,590 ms | 3,576 ms |

The app also settles now: blocking after the 60 s mark went 2,107 -> 717 ->
192 ms. Still fails the gate, which is 1,000 ms single / 2,500 ms total,
because Android's input-dispatch ANR is 5 s and a back press that waits a
second already reads as broken.
Three costs were removed by measuring instead of guessing. `doRefreshAlerts`
rebuilt 60 list items and 60 click listeners every frame into a panel that
ships hidden: 3.8 s -> 484 ms. `input[data-layer=...]` ran 27 times per
websocket message and planes arrive one per message: about 2.1 s of
querySelector, now a Map, gone from the profile. `noteFeed` forced a
synchronous layout per message via offsetWidth: 1,055 ms -> 79 ms.
What is left is not app code by name: `ws.onmessage` at 2.1 s inclusive,
`resetLayer` at 943 ms, `pushDeltasToTicker` at 857 ms, and a 3,576 ms task
that looks like Cesium combining the border primitive and compiling its
shaders (`getDerivedShaderProgram`, `bufferData`, `getProgramParameter` are
all in the profile around it). Getting under the gate probably means the
third option from the original list: a tiled vector source, so only what is
on screen ever becomes geometry.
Do NOT restore the 0.002-degree decimation: that is Don's directive 8 undone,
it buys 1.5 MB for 223 m of accuracy, and it was never the cost anyway.

## 52. The desktop suites could not see either of the above (PARTLY ADDRESSED)
All five suites passed, 109 checks, with both defects present, because they
measure layout, state and pixels on a machine with no back button and none of
them watches time. A phone-shaped viewport is not a phone.
There are now three instruments that run against the device: `apk_longtasks.py`
(main-thread blocking, for any build), `apk_profile.py` (CPU profile from
inside the WebView) and `apk_back_test.py` (the real key, checked against the
window manager). None of them is wired into a single command yet, and none
runs in CI, because there is no CI and no attached phone by default.

## 53. The desktop harness inverted the verdict on a correct fix (INSTRUMENT)
The worst mistake of the session, and it nearly threw away a working change.
Measured on desktop Chromium at 412x915, the border rewrite looked like it did
nothing at all: 12,937 ms of blocking before, 13,339 ms after, worst task
4,191 ms before and 7,562 ms after. On that evidence the honest call is to
revert it.
The harness was measuring itself. A CPU profile put 4,754 ms of that worst
task inside a single `getImageData` on a 131x144 canvas, with every later
readback of the same size costing 0-11 ms. It is SwiftShader initialising its
canvas backend once. The device does not do it, and it is larger than
everything the fix touches.
On the device the same change cuts blocking 58% and the worst task 60%.
**A desktop browser with a software rasteriser cannot rank main-thread costs
for a WebGL app.** It can still measure JS-only work, which is why
`border_perf_test.py` survives, but any perf claim about this app has to be
made on the device or it is not a claim.
The same trap as issue 45, where two capture paths both lied about a frame
that was correct the whole time: suspect the instrument first.

## 54. The store listing had no privacy policy and no support page (FIXED)
Both are mandatory fields in the Play Console, and neither existed. Fixed in
`f2c08b3`: `web/privacy.html` and `web/support.html`, served from the root at
`/privacy` and `/support` because those URLs get typed into a store console by
a human and then quoted back at users.

Writing the policy was mostly an audit, since a privacy policy is a set of
factual claims about a program and this one had never been checked. What the
code actually does:

* The location fix never leaves the device. `locateMe` hands it to the camera
  and to `showHere`, which draws the accuracy circle. Nothing else reads it.
* The live socket is receive-only. There is no `ws.send` in `app.js` at all.
* The backend fetches NWS, USGS, NOAA, FAA and the rest server-side, so those
  agencies never see a user's device. That is a real privacy property.
* `uvicorn` runs with `access_log=False`.
* There is no analytics, crash-reporting or advertising SDK in the bundle.
* One honest caveat, stated in the policy rather than omitted: the forecast
  layer sends the coordinates of the **map view** to Open-Meteo, so after you
  press locate, the area being requested is your area.

`scripts/legal_pages_test.py` (34 checks) exists because privacy.html cites
it, and after issue 53 a citation that has never been opened is a defect on
its own. Two of the policy's claims are checked against the source instead of
believed: the four `localStorage` keys the policy names must be **exactly**
the keys `app.js` uses, so adding a fifth key fails the test at the moment the
policy becomes false; and the tracker/SDK list is grepped out of the shipped
bundle.

The "these pages contact no third party" check carries the control, because
zero external requests and a broken detector look identical. The same detector
pointed at the app reads 876 requests across 7 hosts. It also caught a real
defect: the stacked mobile table kept `white-space: nowrap` on its first
column, so privacy.html scrolled sideways at 412px.

Settings > About now carries both links and the not-an-official-warning-source
line. The hrefs are written at runtime from `API_BASE`, because root-relative
would 404 inside the APK, where Capacitor serves the page from
`https://localhost` and the backend is elsewhere.

**Still outstanding for the listing:** store graphics, the content rating
questionnaire, and a Data Safety form, which must be filled in to match the
policy above rather than from memory.

## 55. A single device boot is not a measurement on this machine (INSTRUMENT)
Issue 53 established that a desktop harness cannot rank main-thread costs for
this app, and moved every perf claim onto the device. Today the device set the
next trap: **one 90 s boot is a sample, not a measurement.**

Three boots of the *same unchanged build*, minutes apart:

| boot | blocking | worst task |
|---|---|---|
| 1 | 14,787 ms | 3,465 ms |
| 2 | 11,240 ms | 2,464 ms |
| 3 | 12,225 ms | 1,842 ms |

A 1.9x spread on the worst task with nothing changed, which is larger than
most fixes are worth making. The host sat at 50-74% CPU from other sessions
throughout, and the emulator runs on what is left. Later sets were worse still,
one reading 37,757 ms.

This is what invalidated the border-primitive experiment (`c52d437`): its
worst task of 1,968 ms looked like a 43% win against the 3,465 ms boot, and
sits inside the unchanged baseline's own 1,842-3,465 ms range. There was no
result to report in either direction, so the change went in behind
`?borderprims=split`, default off, rather than being shipped or thrown away on
a coin flip.

`apk_longtasks.py --repeat N` is the fix. It boots N times, **gates on the
median** instead of on whichever sample ran while the host was busy, prints the
range, and prints a warning when the spread is wider than the effect being
judged. Use `--repeat 5` for any build-to-build comparison, and believe nothing
from a set whose spread warning fired.

Corollary worth keeping: `adb forward` survives a force-stop, so a stale
forward points at a dead PID's devtools socket and the run dies with
`ConnectionClosedError` at attach. `adb forward --remove-all` first.

## 56. keyless_test's terrain elevation checks are flaky (OPEN, low)
Three checks in `keyless_test.py` (`and back on again`, real ground elevation,
and the open-Atlantic control) failed once with `None m` for every sample, then
passed on two immediate re-runs of the identical build. The samples come from
`sampleTerrainMostDetailed` against the ArcGIS terrain service, so a slow or
dropped tile fetch reads as `None` rather than as a retry.

Not caused by the border-primitive work: it is terrain tile networking, and the
failing run was the first of four suites launched back to back. It should retry
the sample before failing, or the test will keep crying wolf.

## 57. The shipped airspace data was CC BY-NC-SA and uncredited (FIXED)
`web/data/airspace.json` was a 21.7 MB OpenAIP extract inside the APK with no
attribution anywhere in the app. OpenAIP is CC BY-NC-SA 4.0, so the BY term was
being broken every day the app ran, and NonCommercial is a live question for a
store listing. `.gitignore` even recorded the constraint ("same CC-BY-NC-SA
license constraint as the upstream") while the file shipped in the binary
regardless, which is the tell: the licence was known and routed around.

Fixed in `4557717` with FAA Class Airspace, a work of the US government under
17 U.S.C. 101. No attribution term, no share-alike, no NC, and it is the same
authority the app already defers to for alerts, METAR and TFRs.

Two things that would have gone wrong silently:

* **`exceededTransferLimit` lives under `properties` on this service**, not at
  the top level. Read from the top level it is `None`, the pagination loop stops
  after one page, and you ship 250 of 2,362 polygons with nothing to tell you.
* **`build_boundaries.py` still had an `airspace()` function** that rebuilt the
  file from `us_asp.json`. Left alone it would have overwritten the FAA data on
  the next run. Removed, with a note where it was.

The simplification is measured, not guessed: 22 m worst-case deviation buys
18.3 MB, and `fetch_faa_airspace.py` refuses to write if the sampled error
exceeds 60 m. This is not the border decimation Don rejected, which charged
223 m for 1.5 MB.

## 58. One websocket frame per entity (FIXED)
`state.upsert()` broadcast immediately, so ADS-B handing us aircraft one at a
time meant thousands of frames in a boot burst. The cost was not the network,
it was that **every branch of `handleMessage` falls through to
`updateCategoryCounts()` and `refreshAlerts()`**, so those ran once per
aircraft. That is the 2.1 s of `ws.onmessage` the device profile named, and
making them individually faster cannot fix being called 8,000 times.

Fixed in `4b7bd1e`: deltas queue into a pending map and a 250 ms loop flushes
one `<layer>:batch` frame per layer. Keyed by entity id, so an aircraft
reporting three times in a window is sent once. Measured on the wire over 45 s
of a live boot: **8,381 entities arrived in 23 frames**, zero single-entity
frames.

This is a counting result, not a timing one, which is why it stands despite
issue 55: the handler provably runs a couple of dozen times instead of 8,381,
and that does not need a stopwatch on a contended host.

## 59. CI could not fail (FIXED)
`.github/workflows/ci.yml` ran `pip install .` and `python -c "import
graticule"`. That was the whole job. It was green through every defect this
project has ever had, including the back button that exited the app and a
CC-BY-NC-SA file shipping in the binary.

Fixed in `c91d16e`. `scripts/static_checks.py` is 15 checks that need no
browser, no network and no backend, so they can actually run in Actions: the
privacy policy names exactly the localStorage keys `app.js` uses, no tracker
SDK is present, the socket is still receive-only, `airspace.json` is FAA-shaped
and carries no `icaoClass`, no live line references OpenAIP, every local asset
`index.html` names exists, and no em dashes. Every group that reports a zero
carries a control.

Proved it can fail rather than assuming: adding a fifth localStorage key turns
it red naming the key. `compileall` was added too, so a syntax error in a feed
that startup never imports is still caught.

## 60. There was no release signing, and no AAB (FIXED)
`android/app/build.gradle` had a `release` block with no `signingConfig`, so a
release build produced an unsigned artifact that Play rejects at upload, and
the build script only ever made an APK when the store takes an App Bundle.

Fixed in `596a106`. Signing reads `android/keystore.properties`, gitignored
along with the `.jks`. With no properties file the build is UNSIGNED and says
so loudly from both gradle and the build script, rather than falling back to
the debug key: a build signed with the wrong key fails at upload instead of on
this machine. `--aab` runs `bundleRelease`.

Verified both directions: with the keystore, `jar verified` signed by Don's
cert; without it, `no manifest`. The key is a 4096-bit RSA **upload** key, so
losing it is recoverable through Play support. The password is in KeePassXC and
in no file in this repository.

## 61. Eleven unused splash.png assets left in the Android res tree
`android/app/src/main/res/drawable{,-port-*,-land-*}/splash.png`, 124 KB total.
Capacitor's default splash. Unreferenced since `15e1b30` pointed the launch
theme at `@drawable/launch_splash`. Not deleted, per the no-delete rule. Move
to `_deprecated/` when Don confirms.

## 62. Boot baseline, measured the way a user feels it (2026-08-09)
`scripts/apk_tti.py --repeat 3`, emulator, debug build at `15e1b30`, backend on
:8744. Control passed first (`--selftest` saw a deliberate 4 s freeze).

    boot   interactive_at   worst tap wait
    1            19,393 ms         1,841 ms
    2            31,113 ms         5,584 ms
    3            29,790 ms         6,564 ms
    median       29,790 ms         5,584 ms      spread 1.60x
    idle lag          3 ms   (so the 200 ms threshold measures the app)

Worst tap wait by window, last boot:

    0-3s   404 ms      10-15s  2,618 ms
    3-6s   366 ms      15-25s  6,564 ms
    6-10s  529 ms        25s+  1,989 ms

**This refutes the plan in issue 51's follow-up.** The app is not worst at the
start. It is comparatively usable for the first ten seconds and then collapses,
and it does not settle for about thirty. Deferring boot work to "after the globe
is interactive" aims at the wrong window.

`apk_profile.py` on the same build: app JS is ~3% of the profile. `ws.onmessage`
is 631 ms inclusive, down from 2,100 ms before batching. The heaviest frame's
stack is `(program)` / `(root)`, so what remains is inside Cesium and the GL
driver, not in this codebase. `resetLayer` and `upsertEntity` already skip
layers that are switched off, so there is no cheap app-side win left.

Next: attribute the 10-25 s window specifically (terrain tiles, imagery decode,
border primitive upload are the candidates) before changing anything. The 1.60x
spread means only a large change can be ranked on this host.

## 63. The boot snapshot is a 32 MB websocket frame, and none of it is drawn
Measured server-side against the running backend, so this is a fact about the
server rather than about a renderer: connect to `/ws`, take the first
`snapshot` frame, and weigh it.

    snapshot frame        32.4 MB
    layers in the frame   13

    layer                 rows        MB   on at boot
    fires               107665     23.54
    planes                6149      1.69
    airports              5272      1.36
    satellites            1352      0.37
    volcanoes             1214      0.27
    quakes                 915      0.27
    ships                 1279      0.25
    tfrs                   134      0.16
    ... 5 more, 0.14 MB together

    layers total           28.1 MB
    meta total              1.5 MB
    for layers OFF at boot  28.1 MB   (100% of the layer payload)

Three switches ship checked: `radar`, `countries`, `states`. None of them is in
the layers payload. Radar arrives as `meta.radar`, and the two border layers are
GeoJSON fetched separately by `border-worker.js`. So **every one of the 28.1 MB
of rows in this frame is for a layer nobody has switched on**, and `fires` alone
is 23.5 MB of it, 73% of the whole frame.

What the client then does with it, all on the main thread:

1. `JSON.parse(ev.data)` over 32.4 MB in `ws.onmessage`
2. `resetLayer()` per layer, which stores `layerData[layer] = entries` whether
   or not the layer is drawn
3. `pushDeltasToTicker()` per layer, which builds a `Set` of every id and diffs
   it, so 107,665 keys for a layer that is off
4. `updateCategoryCounts()` + `refreshAlerts()`, once

`upsertEntity` and the drawing half of `resetLayer` do skip switched-off layers.
That was measured in issue 62 and is still true. It is the receiving, parsing
and bookkeeping that does not skip, and that is the part nobody had weighed.

Timing, desktop only and therefore not a ranking claim. The socket opened at
5,742 ms and the page did not see the frame until 18,520 ms. That gap is not
the server and not the wire:

    GET /api/snapshot   0.43 s / 0.41 s / 0.63 s   for 29.5 MB, three runs

The server produces and delivers the same payload in about half a second. So
the 12.8 s is the client, and specifically it is the main thread: the recorder
stamps the frame in a listener registered before the app's own `onmessage`, so
that stamp is when the event was finally DISPATCHED, which cannot happen while
the thread is busy.

Read carefully, that says the thread was already occupied from about 5.7 s by
something else, and the 32 MB parse then starts at 18.5 s on top of it. So this
frame is not established as the cause of the whole 10-25 s collapse. It is
established as a large cost that lands at the end of it and runs past it.
What holds the thread from 5.7 s to 18.5 s is still open.

`scripts/apk_boot_timeline.py` records websocket dispatch for exactly this
reason, since Resource Timing cannot see a websocket frame. It deliberately
does not enable the CDP Network domain to get true wire arrival:
`Network.webSocketFrameReceived` carries `payloadData`, so asking for it would
push 32 MB back through the debugger socket during the window being measured.

**Not yet confirmed on the device.** A software rasteriser cannot rank
main-thread costs, so the arrival time and the block it causes have to be read
on the emulator before any fix is chosen. The size and the row counts do not
need the device: they are counting results.

Fix candidates, in order of how much they address the cause:

* Send counts, not rows, for layers that are off, and deliver rows when a layer
  is switched on. Preserves the documented behaviour that counts report what the
  feed has rather than what is drawn.
* Split the snapshot into one frame per layer, so the main thread gets gaps
  instead of one 32 MB slab. Cheaper, and it does not reduce the bytes.
* Parse off the main thread. Fixes the parse, not the transfer.

Note for whoever takes this: the client telling the server which layers are on
would be the obvious protocol, and it is the one option to think twice about.
`/privacy` claims there is no `ws.send` anywhere and `legal_pages_test.py`
asserts it. That claim is worth more than the bytes it would save.
