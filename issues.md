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
