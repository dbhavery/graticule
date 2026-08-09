/* Border loader worker.
 *
 * Why this exists: parsing the border GeoJSON on the main thread froze the
 * app. Measured at phone size, ne_state_borders.geojson (6.7 MB, 320,146
 * vertices as ~640k tiny arrays) cost seconds of solid main-thread time in
 * JSON.parse alone -- the boot trace showed single tasks of 4.3 s and 2.8 s
 * landing exactly when each border file was parsed and converted. A frozen
 * main thread is also a hardware back button that never gets handled, which
 * is how issue 51 causes issue 50.
 *
 * So the allocation-heavy work happens here: fetch, parse, and the
 * degrees->ECEF conversion for every vertex. What crosses back is one
 * transferable Float64Array of xyz triples plus offsets -- microseconds to
 * hand over, zero copies. The main thread only wraps views and makes
 * entities, in chunks that yield.
 *
 * The ECEF math is WGS84 at height 0, the same thing
 * Cesium.Cartesian3.fromDegrees produces. Duplicated here (10 lines) rather
 * than importing 4 MB of Cesium into a worker. scripts/border_perf_test.py
 * asserts the two agree to sub-millimetre, so a drift in either breaks a test
 * instead of quietly bending every border on the globe.
 */
'use strict';

const WGS84_A = 6378137.0;
const WGS84_E2 = 6.69437999014e-3;   // first eccentricity squared

function toEcef(lonDeg, latDeg, out, o) {
  const lon = lonDeg * (Math.PI / 180);
  const lat = latDeg * (Math.PI / 180);
  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  const n = WGS84_A / Math.sqrt(1 - WGS84_E2 * sinLat * sinLat);
  out[o]     = n * cosLat * Math.cos(lon);
  out[o + 1] = n * cosLat * Math.sin(lon);
  out[o + 2] = n * (1 - WGS84_E2) * sinLat;
}

self.onmessage = async (ev) => {
  const { url } = ev.data;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
    const doc = await res.json();

    // First pass: count vertices so the buffer is allocated once.
    const feats = doc.features || [];
    let total = 0;
    for (const f of feats) {
      const coords = f.geometry && f.geometry.coordinates;
      if (!coords || coords.length < 2) continue;
      for (const c of coords) if (typeof c[0] === 'number') total++;
    }

    const buf = new Float64Array(total * 3);
    // Pairs of [firstVertexIndex, vertexCount] per line.
    const offsets = [];
    const props = [];
    let v = 0;
    for (const f of feats) {
      const coords = f.geometry && f.geometry.coordinates;
      if (!coords || coords.length < 2) continue;
      const start = v;
      for (const c of coords) {
        // Same semantics as the old main-thread loop: only plain [lon, lat]
        // vertices count; nested arrays (MultiLineString parts) are dropped,
        // as they always were.
        if (typeof c[0] !== 'number' || typeof c[1] !== 'number') continue;
        toEcef(c[0], c[1], buf, v * 3);
        v++;
      }
      if (v - start < 2) { v = start; continue; }
      offsets.push(start, v - start);
      props.push(f.properties || {});
    }

    self.postMessage(
      { buf, offsets: new Uint32Array(offsets), props, vertices: v },
      [buf.buffer],
    );
  } catch (e) {
    self.postMessage({ error: String(e && e.message || e) });
  }
};
