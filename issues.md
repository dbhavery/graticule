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
