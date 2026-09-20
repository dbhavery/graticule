/* The feeds, running on the device instead of on a server.
 *
 * WHY THIS EXISTS
 *
 * `graticule/server.py` runs sixteen feed loops, holds the merged picture in
 * memory with no database, and pushes it to clients over a WebSocket. That
 * design is the only reason this app needs hosting at all: the state is in
 * memory, so a free tier that sleeps after fifteen idle minutes wipes it and
 * the app opens empty.
 *
 * Every provider it polls is public and keyless -- `keyless_test.py` proves
 * the app runs with no API keys at all. So unlike God's Eye View, whose
 * server exists to hold the user's keys and which therefore refuses to be
 * exposed at all (its SECURITY.md is explicit), this server is an aggregator
 * with nothing to hide. An aggregator can run on the phone.
 *
 * WHAT THIS REPLACES, AND THE SEAM IT USES
 *
 * `handleMessage()` in app.js is the single entry point for every piece of
 * live data, and it accepts four shapes:
 *
 *     {type: 'snapshot',      data: {layers, meta, counts, deferred}}
 *     {type: '<layer>:batch', data: {id: row}}
 *     {type: '<layer>:reset', data: {id: row}}
 *     {type: 'meta', key, data}
 *
 * This module speaks exactly those, so nothing downstream of handleMessage
 * knows or cares where the rows came from. The renderers, the alert ranking,
 * the counts and the detail panels are untouched.
 *
 * WHAT IS DELIBERATELY DIFFERENT FROM THE SERVER
 *
 * The server polls every feed for everybody, forever. A phone should not.
 * Feeds are split into ALWAYS, which are small and feed the opening ticker
 * and the alert ranking, and ON_DEMAND, which run only while their layer is
 * switched on. Fires is 15 MB and 175,000 rows (issues.md 31); airports is
 * 10 MB; cables and aurora are multi-megabyte. None of that should be fetched
 * to draw a globe nobody has asked to put fires on.
 *
 * TRANSPORT
 *
 * Ten of the seventeen providers send `Access-Control-Allow-Origin`, so a
 * browser may call them. The other seven do not, and CORS is a browser rule:
 * Capacitor's native HTTP makes the request in Java, outside the WebView,
 * where there is no origin to check. `gfetch` below picks whichever is
 * available and falls back to a proxy on the web build.
 *
 * The `User-Agent` headers the Python feeds set are NOT settable from a page
 * and attempting them turns a simple request into a preflight, which these
 * providers will not answer. They are dropped everywhere.
 */

'use strict';

(function () {

// ---------- what the store holds -------------------------------------------

// Mirrors EXPIRE_SEC in graticule/state.py. Layers absent from this table
// never expire: volcanoes, satellites and airports are reference data.
const EXPIRE_SEC = {
  planes: 300, ships: 900, quakes: 7 * 86400, hurricanes: 21600,
  tsunamis: 3600, fires: 4 * 86400, launches: 7200, news: 7200,
  severe: 3600, tfrs: 3600,
};

const LAYER_NAMES = [
  'planes', 'ships', 'quakes', 'hurricanes', 'tsunamis', 'fires', 'volcanoes',
  'satellites', 'launches', 'news', 'severe', 'airports', 'tfrs',
];

// ---------- the store -------------------------------------------------------

/* Same contract as graticule/state.py, minus the subscriber set: there is one
 * consumer and it is in this process, so a "broadcast" is a function call.
 *
 * flush() still batches. The server batched because one websocket frame per
 * aircraft cost 1,244 frames at boot and 2.1 s of ws.onmessage (issues.md).
 * Calling handleMessage 1,244 times in a row costs the same thing for the
 * same reason -- it runs updateCategoryCounts() and refreshAlerts() every
 * time -- so the coalescing is not a network optimisation and has to stay.
 */
const store = {
  layers: Object.fromEntries(LAYER_NAMES.map((n) => [n, {}])),
  meta: {},
  _pending: {},

  upsert(layer, id, data) {
    if (!this.layers[layer]) this.layers[layer] = {};
    data.ts = Date.now() / 1000;
    this.layers[layer][id] = data;
    (this._pending[layer] || (this._pending[layer] = {}))[id] = data;
  },

  replaceLayer(layer, entries) {
    const now = Date.now() / 1000;
    for (const v of Object.values(entries)) if (v.ts === undefined) v.ts = now;
    this.layers[layer] = entries;
    // A reset is the whole truth about a layer, so a delta flushed afterwards
    // would resurrect a row the reset just removed.
    delete this._pending[layer];
    emit({ type: `${layer}:reset`, data: entries });
  },

  flush() {
    const pending = this._pending;
    this._pending = {};
    for (const [layer, entries] of Object.entries(pending)) {
      if (Object.keys(entries).length) {
        emit({ type: `${layer}:batch`, data: entries });
      }
    }
  },

  setMeta(key, value) {
    this.meta[key] = value;
    emit({ type: 'meta', key, data: value });
  },

  expire() {
    const now = Date.now() / 1000;
    for (const [layer, rows] of Object.entries(this.layers)) {
      const limit = EXPIRE_SEC[layer];
      if (!limit) continue;
      for (const [id, v] of Object.entries(rows)) {
        if (now - (v.ts || 0) > limit) delete rows[id];
      }
    }
  },
};

function emit(msg) {
  try {
    window.handleMessage(msg);
  } catch (e) {
    console.warn('[feeds] handleMessage threw', msg && msg.type, e);
  }
}

// ---------- transport -------------------------------------------------------

/* Hosts known not to send Access-Control-Allow-Origin, measured 2026-09-20
 * with `Origin: https://localhost`, which is the origin Capacitor serves from.
 *
 * On Android none of this matters: CapacitorHttp performs the request in
 * native code where no origin exists. It matters on the web build, where
 * these have to go through a proxy or the layer cannot draw.
 *
 * THIS LIST IS A HEAD START, NOT THE AUTHORITY. It was measured per host, and
 * CORS is per RESPONSE: services.swpc.noaa.gov sends the header under /json/
 * and not under /products/, so a host-level list got it wrong the first time
 * it was tried. `gfetch` therefore learns -- a direct request that fails is
 * retried once through the proxy, and the host is remembered so the next call
 * skips the wasted attempt.
 */
const NEEDS_PROXY = new Set([
  'api.adsb.lol', 'opendata.adsb.fi', 'api.airplanes.live',
  'www.nhc.noaa.gov', 'webservices.volcano.si.edu', 'tfr.faa.gov',
  'www.submarinecablemap.com', 'firms.modaps.eosdis.nasa.gov',
  'services.swpc.noaa.gov',
]);

// The web build's proxy. Same origin, so the browser never sees a cross-origin
// request at all. Empty on native, where nothing needs it.
const PROXY = '/api/proxy?url=';

const nativeHttp = (() => {
  const C = window.Capacitor;
  if (!C || !C.isNativePlatform || !C.isNativePlatform()) return null;
  const p = (C.Plugins && C.Plugins.CapacitorHttp) || C.CapacitorHttp;
  return p && typeof p.request === 'function' ? p : null;
})();

function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch (e) {
    return '';
  }
}

/* One door for every outbound request.
 *
 * `as` is 'json' or 'text'. Returns the parsed body, or throws. Callers are
 * feed functions and a throw is caught by the scheduler, logged, and retried
 * on the next tick; a feed that fails must never take the others down.
 */
async function gfetch(url, { as = 'json', timeout = 30000 } = {}) {
  if (nativeHttp) {
    // No CORS, no preflight, no origin. `responseType: 'text'` for everything
    // keeps the parse here rather than trusting the bridge's content sniffing,
    // which turns a JSON error page into an object and hides the failure.
    const res = await nativeHttp.request({
      url, method: 'GET', readTimeout: timeout, connectTimeout: timeout,
      responseType: 'text',
    });
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`${res.status} ${url}`);
    }
    const body = typeof res.data === 'string' ? res.data : String(res.data ?? '');
    return as === 'json' ? JSON.parse(body) : body;
  }

  const host = hostOf(url);

  const once = async (target) => {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeout);
    try {
      const r = await fetch(target, { signal: ctl.signal });
      if (!r.ok) throw new Error(`${r.status} ${url}`);
      return as === 'json' ? await r.json() : await r.text();
    } finally {
      clearTimeout(t);
    }
  };

  if (NEEDS_PROXY.has(host)) return once(PROXY + encodeURIComponent(url));

  try {
    return await once(url);
  } catch (e) {
    // A CORS refusal is indistinguishable from an outage here -- the browser
    // hands the page a TypeError with no detail either way, deliberately. So
    // try the proxy once before believing the feed is down, and remember the
    // host either way so the next call does not pay for the same discovery.
    NEEDS_PROXY.add(host);
    return once(PROXY + encodeURIComponent(url));
  }
}

// ---------- small helpers, ported from the Python ---------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
};

const int = (v) => {
  const n = num(v);
  return n === null ? null : Math.trunc(n);
};

const str = (v) => {
  const s = (v === null || v === undefined) ? '' : String(v).trim();
  return s || null;
};

/* Arithmetic mean of every vertex, holes included.
 *
 * Deliberately NOT an area centroid: graticule/feeds/tsunamis.py:109 does
 * exactly this and the value is a pick target and a panel anchor, not a
 * cartographic quantity. Returns [lon, lat] to match the Python's tuple order.
 */
function meanCentroid(geom) {
  if (!geom) return null;
  if (geom.type === 'Point') {
    const c = geom.coordinates || [];
    return c.length >= 2 ? [num(c[0]), num(c[1])] : null;
  }
  let rings;
  if (geom.type === 'Polygon') rings = geom.coordinates || [];
  else if (geom.type === 'MultiPolygon') {
    rings = [];
    for (const poly of geom.coordinates || []) rings.push(...poly);
  } else return null;

  let sx = 0, sy = 0, n = 0;
  for (const ring of rings) {
    for (const pt of ring) {
      const x = num(pt[0]), y = num(pt[1]);
      if (x === null || y === null) continue;
      sx += x; sy += y; n += 1;
    }
  }
  return n ? [sx / n, sy / n] : null;
}

// ---------- the feeds -------------------------------------------------------

/* Each entry is {name, every, layer?, onDemand?, run}.
 *
 *   every     seconds between runs, matching the Python loop's sleep
 *   layer     the layer switch that gates an on-demand feed
 *   onDemand  true  -> runs only while `layer` is switched on
 *             false -> runs from boot, because the alert ranking and the
 *                      opening ticker read it
 *   run       async; throwing is fine, the scheduler logs and retries
 */
const FEEDS = [];

// ---- earthquakes. USGS sends Access-Control-Allow-Origin: * ----------------
FEEDS.push({
  name: 'quakes', every: 60, onDemand: false,
  async run() {
    const d = await gfetch(
      'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_week.geojson');
    // The feed is a week; the app shows 72 hours. Filtering here rather than
    // in the renderer keeps the layer count honest.
    const cutoff = (Date.now() / 1000 - 72 * 3600) * 1000;
    const out = {};
    for (const f of d.features || []) {
      const p = f.properties || {};
      const c = (f.geometry || {}).coordinates || [];
      if (c.length < 2 || !f.id) continue;
      if (!(num(p.time) >= cutoff)) continue;
      out[f.id] = {
        lat: num(c[1]), lon: num(c[0]), depth_km: num(c[2]),
        mag: p.mag, place: p.place, time: p.time, url: p.url,
        tsunami: !!p.tsunami, felt: p.felt, alert: p.alert, type: p.type,
      };
    }
    store.replaceLayer('quakes', out);
  },
});

// ---- NWS active alerts, which fill TWO layers ------------------------------

const TSUNAMI_EVENTS = new Set([
  'Tsunami Warning', 'Tsunami Watch', 'Tsunami Advisory',
  'Tsunami Information Statement',
]);

const SEVERE_EVENTS = new Set([
  'Tornado Warning', 'Tornado Watch', 'Severe Thunderstorm Warning',
  'Severe Thunderstorm Watch', 'Flash Flood Warning', 'Flash Flood Watch',
  'Flood Warning', 'Hurricane Warning', 'Hurricane Watch',
  'Tropical Storm Warning', 'Tropical Storm Watch', 'Winter Storm Warning',
  'Winter Storm Watch', 'Blizzard Warning', 'Ice Storm Warning',
  'Fire Weather Watch', 'Red Flag Warning', 'Extreme Heat Warning',
  'Extreme Cold Warning', 'High Wind Warning', 'Dust Storm Warning',
  'Avalanche Warning',
]);

FEEDS.push({
  name: 'nws-alerts', every: 120, onDemand: false,
  async run() {
    const d = await gfetch('https://api.weather.gov/alerts/active?status=actual');
    const tsu = {}, sev = {};
    for (const f of d.features || []) {
      const p = f.properties || {};
      const event = p.event;
      const bucket = TSUNAMI_EVENTS.has(event) ? tsu
                   : SEVERE_EVENTS.has(event) ? sev : null;
      if (!bucket) continue;
      const c = meanCentroid(f.geometry);
      if (!c) continue;
      const id = String(f.id || p.id || '');
      if (!id) continue;
      bucket[id] = {
        lat: c[1], lon: c[0],
        event, severity: p.severity, urgency: p.urgency,
        headline: p.headline,
        description: (p.description || '').slice(0, 600),
        area: p.areaDesc, sent: p.sent, expires: p.expires,
      };
    }
    store.replaceLayer('tsunamis', tsu);
    store.replaceLayer('severe', sev);
  },
});

// ---- tropical cyclones -----------------------------------------------------
FEEDS.push({
  name: 'hurricanes', every: 300, onDemand: false,
  async run() {
    const d = await gfetch('https://www.nhc.noaa.gov/CurrentStorms.json');
    const storms = d.activeStorms || d.storms || [];
    const out = {};
    for (const s of storms) {
      // latitudeNumeric before latitude: the plain fields are strings like
      // "25.3N" and parseFloat would silently drop the hemisphere.
      const lat = num(s.latitudeNumeric !== undefined ? s.latitudeNumeric : s.latitude);
      const lon = num(s.longitudeNumeric !== undefined ? s.longitudeNumeric : s.longitude);
      if (lat === null || lon === null) continue;
      const id = String(s.id || s.binNumber || s.name || '');
      if (!id) continue;
      const adv = s.publicAdvisory, trk = s.forecastTrack;
      out[id] = {
        lat, lon, name: s.name, classification: s.classification,
        intensity: s.intensity, pressure: s.pressure, movement: s.movement,
        basin: s.basin,
        advisory_url: adv && typeof adv === 'object' ? adv.url : null,
        track_url: trk && typeof trk === 'object' ? trk.kmzFile : null,
        last_update: s.lastUpdate,
      };
    }
    store.replaceLayer('hurricanes', out);
  },
});

// ---- rocket launches -------------------------------------------------------
FEEDS.push({
  name: 'launches', every: 1800, onDemand: false,
  async run() {
    const [up, prev] = await Promise.all([
      gfetch('https://ll.thespacedevs.com/2.2.0/launch/upcoming/?limit=10'),
      gfetch('https://ll.thespacedevs.com/2.2.0/launch/previous/?limit=10'),
    ]);
    const cutoff = Date.now() - 72 * 3600 * 1000;
    const rows = [...(up.results || [])];
    for (const L of prev.results || []) {
      const t = Date.parse(String(L.net || '').replace('Z', '+00:00'));
      if (Number.isFinite(t) && t >= cutoff) rows.push(L);
    }
    const out = {};
    for (const L of rows) {
      const pad = L.pad || {};
      // LL2 sends pad coordinates as STRINGS.
      const lat = num(pad.latitude), lon = num(pad.longitude);
      if (lat === null || lon === null) continue;
      const id = String(L.id || L.slug || '');
      if (!id) continue;
      const config = (L.rocket || {}).configuration || {};
      const mission = L.mission || {};
      out[id] = {
        lat, lon, name: L.name, net: L.net,
        window_start: L.window_start, window_end: L.window_end,
        status: (L.status || {}).name,
        vehicle: config.name || config.full_name,
        agency: (L.launch_service_provider || {}).name,
        pad_name: pad.name,
        pad_location: (pad.location || {}).name,
        mission_name: mission.name, mission_type: mission.type,
        mission_orbit: (mission.orbit || {}).name,
        url: L.url,
      };
    }
    store.replaceLayer('launches', out);
  },
});

// ---- NASA EONET. The layer is called `news` for historical reasons; the
//      function that filled it was called gdelt_loop and has not fetched
//      GDELT for a long time.
FEEDS.push({
  name: 'eonet', every: 900, onDemand: false,
  async run() {
    const d = await gfetch('https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=200');
    const out = {};
    for (const e of d.events || []) {
      const geoms = e.geometry || [];
      // The LAST geometry, which for a moving event is where it is now.
      const g = geoms[geoms.length - 1];
      if (!g || g.type !== 'Point') continue;
      const c = g.coordinates || [];
      if (c.length < 2 || !e.id) continue;
      out[String(e.id)] = {
        lat: num(c[1]), lon: num(c[0]), name: e.title,
        categories: (e.categories || []).map((x) => x.title).filter(Boolean),
        date: g.date,
        magnitude_value: g.magnitudeValue, magnitude_unit: g.magnitudeUnit,
        sources: (e.sources || []).map((s) => s.url).filter(Boolean),
        link: e.link,
      };
    }
    store.replaceLayer('news', out);
  },
});

// ---- the radar tile manifest ----------------------------------------------
FEEDS.push({
  name: 'radar', every: 300, onDemand: false,
  async run() {
    const d = await gfetch('https://api.rainviewer.com/public/weather-maps.json');
    store.setMeta('radar', {
      host: d.host,
      past: (d.radar || {}).past || [],
      nowcast: (d.radar || {}).nowcast || [],
      satellite: (d.satellite || {}).infrared || [],
    });
  },
});

// ---- space weather. Three endpoints, each allowed to fail on its own -------
FEEDS.push({
  name: 'space-weather', every: 300, onDemand: false,
  async run() {
    const blob = { kp: null, solar_wind: null, xray: null };

    try {
      const rows = await gfetch(
        'https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json');
      // Walk backwards for the most recent parseable row. SWPC sends a header
      // row whose value is the string "Kp", and num() rejecting it is what
      // makes the reverse walk skip it.
      for (let i = rows.length - 1; i >= 0; i--) {
        const r = rows[i];
        const v = Array.isArray(r) ? num(r[1]) : num(r.Kp);
        if (v === null) continue;
        blob.kp = { value: v, time: Array.isArray(r) ? r[0] : r.time_tag };
        break;
      }
    } catch (e) { /* leave kp null; the blob is still written */ }

    try {
      const rows = await gfetch(
        'https://services.swpc.noaa.gov/products/solar-wind/plasma-2-hour.json');
      // rows[0] is the header: time_tag, density, speed, temperature.
      for (let i = rows.length - 1; i >= 1; i--) {
        const r = rows[i];
        const speed = num(r[2]);
        if (speed === null) continue;
        blob.solar_wind = {
          speed_kms: speed, density_cm3: num(r[1]),
          temp_k: num(r[3]), time: r[0],
        };
        break;
      }
    } catch (e) { /* leave solar_wind null */ }

    try {
      const d = await gfetch(
        'https://services.swpc.noaa.gov/json/goes/primary/xray-flares-latest.json');
      const f = Array.isArray(d) && d.length ? d[0] : null;
      if (f) {
        blob.xray = {
          class: f.max_class, peak: f.max_time,
          begin: f.begin_time, end: f.end_time,
        };
      }
    } catch (e) { /* leave xray null */ }

    store.setMeta('space_weather', blob);
  },
});

// ---- aircraft. ON DEMAND: fourteen requests a sweep is not something to do
//      for a layer nobody switched on.

const ADSB_PROVIDERS = [
  (lat, lon, r) => `https://opendata.adsb.fi/api/v2/lat/${lat}/lon/${lon}/dist/${r}`,
  (lat, lon, r) => `https://api.airplanes.live/v2/point/${lat}/${lon}/${r}`,
  (lat, lon, r) => `https://api.adsb.lol/v2/point/${lat}/${lon}/${r}`,
];
const ADSB_RADIUS_NM = 250;
const ADSB_GRID = [
  [30, -120], [30, -108], [30, -96], [30, -84],
  [38, -120], [38, -108], [38, -96], [38, -84],
  [46, -120], [46, -108], [46, -96], [46, -84],
  [61.2, -149.9],   // Anchorage
  [21.3, -157.9],   // Honolulu
];
const SQUAWK_EMERGENCY = {
  7500: 'hijack', 7600: 'radio failure', 7700: 'general emergency',
};
// Provider order is sticky: whichever answered last time is tried first.
let adsbOrder = [0, 1, 2];

function adsbRows(payload) {
  if (Array.isArray(payload.ac)) return payload.ac;
  if (Array.isArray(payload.aircraft)) return payload.aircraft;
  return [];
}

function adsbAltFt(ac) {
  // alt_baro is the STRING "ground" on the tarmac, so a type check is the
  // whole of the logic here.
  const b = ac.alt_baro;
  if (typeof b === 'number') return b;
  const g = ac.alt_geom;
  return typeof g === 'number' ? g : null;
}

function adsbEmergency(ac) {
  const e = String(ac.emergency || '').trim().toLowerCase();
  if (e && e !== 'none') return e;
  return SQUAWK_EMERGENCY[parseInt(ac.squawk, 10)] || null;
}

FEEDS.push({
  name: 'planes', every: 30, onDemand: true, layer: 'planes',
  async run() {
    for (const [lat, lon] of ADSB_GRID) {
      let rows = [];
      for (let k = 0; k < adsbOrder.length; k++) {
        const idx = adsbOrder[k];
        try {
          const d = await gfetch(ADSB_PROVIDERS[idx](lat, lon, ADSB_RADIUS_NM),
                                 { timeout: 25000 });
          rows = adsbRows(d);
          if (rows.length) {
            // Promote whatever answered, so the next disc starts with it.
            adsbOrder.splice(k, 1);
            adsbOrder.unshift(idx);
            break;
          }
        } catch (e) { /* try the next provider for this disc */ }
      }
      for (const ac of rows) {
        const hex = String(ac.hex || '').trim();
        const la = num(ac.lat), lo = num(ac.lon);
        if (!hex || la === null || lo === null) continue;
        const ft = adsbAltFt(ac);
        const gs = num(ac.gs);
        store.upsert('planes', hex, {
          callsign: str(ac.flight),
          country: null,                 // these feeds do not carry it
          lat: la, lon: lo,
          alt: ft === null ? null : ft * 0.3048,        // feet -> metres
          heading: ac.track !== undefined ? ac.track : ac.dir,
          velocity: gs === null ? null : gs * 0.514444, // knots -> m/s
          on_ground: ac.alt_baro === 'ground',
          registration: str(ac.r), type: str(ac.t), desc: str(ac.desc),
          squawk: str(ac.squawk), emergency: adsbEmergency(ac),
        });
      }
      // These are donated volunteer receivers. Keep the spacing.
      await sleep(1000);
    }
  },
});

// ---- ships. The keyless path only: AISStream needs a key, and a key in a
//      page is a published key. Digitraffic is Baltic and Finnish waters,
//      which is what the source note in the UI already says.
let dtTick = 0;
let dtVessels = {};

FEEDS.push({
  name: 'ships', every: 60, onDemand: true, layer: 'ships',
  async run() {
    if (dtTick % 15 === 0) {
      // ~400 KB, so every fifteenth cycle rather than every one.
      try {
        const v = await gfetch('https://meri.digitraffic.fi/api/ais/v1/vessels',
                               { timeout: 60000 });
        dtVessels = {};
        for (const row of Array.isArray(v) ? v : []) {
          if (row && row.mmsi !== undefined) dtVessels[String(row.mmsi)] = row;
        }
      } catch (e) { /* keep the previous names */ }
    }
    dtTick += 1;

    const d = await gfetch('https://meri.digitraffic.fi/api/ais/v1/locations',
                           { timeout: 60000 });
    for (const f of d.features || []) {
      const props = f.properties || {};
      const mmsi = String(f.mmsi !== undefined ? f.mmsi : (props.mmsi || ''));
      if (!mmsi) continue;
      const c = (f.geometry || {}).coordinates || [];
      const lon = num(c[0]), lat = num(c[1]);
      if (lat === null || lon === null) continue;
      const m = dtVessels[mmsi] || {};
      store.upsert('ships', mmsi, {
        lat, lon,
        heading: props.heading, course: props.cog, speed: props.sog,
        name: str(m.name), type: m.shipType, destination: str(m.destination),
        source: 'Digitraffic (Baltic)',
      });
    }
  },
});

// ---- satellites. TLEs only; the propagation already runs client-side at 1 Hz,
//      so this was always a client-shaped feed sitting on a server.

const SAT_GROUPS = [
  ['stations', 'Stations', '#ffd14a', null],
  ['visual', 'Brightest', '#ffeb99', null],
  ['geo', 'Geostationary', '#a78bfa', null],
  ['gps-ops', 'GPS', '#34d399', null],
  ['galileo', 'Galileo', '#60a5fa', null],
  ['science', 'Science', '#fbbf24', null],
  ['starlink', 'Starlink', '#f472b6', 500],
];

function parseTle(text) {
  const lines = text.split('\n').map((l) => l.replace(/\s+$/, ''))
    .filter((l) => l.trim());
  const out = [];
  let i = 0;
  while (i + 2 < lines.length + 1) {
    const [name, l1, l2] = [lines[i], lines[i + 1], lines[i + 2]];
    if (l1 && l2 && l1.startsWith('1 ') && l2.startsWith('2 ')) {
      out.push([name.trim(), l1, l2]);
      i += 3;
    } else {
      i += 1;
    }
  }
  return out;
}

FEEDS.push({
  name: 'satellites', every: 6 * 3600, onDemand: true, layer: 'satellites',
  async run() {
    const entries = {};
    for (const [group, label, color, cap] of SAT_GROUPS) {
      try {
        const text = await gfetch(
          `https://celestrak.org/NORAD/elements/gp.php?GROUP=${group}&FORMAT=tle`,
          { as: 'text' });
        let rows = parseTle(text);
        if (cap) rows = rows.slice(0, cap);
        for (const [name, l1, l2] of rows) {
          const id = String(parseInt(l1.slice(2, 7).trim(), 10));
          if (id === 'NaN') continue;
          // First group wins, so the ISS stays a Station rather than being
          // relabelled Brightest on the next pass.
          if (entries[id]) continue;
          entries[id] = { name, tle1: l1, tle2: l2, group, group_label: label, color };
        }
      } catch (e) {
        console.warn('[feeds] celestrak group failed:', group, e.message);
      }
      // Celestrak rate-limits and bans aggressive callers.
      await sleep(2000);
    }
    // A cycle where every group failed must not wipe the layer.
    if (Object.keys(entries).length) store.replaceLayer('satellites', entries);
  },
});

// ---- volcanoes. Reference data, refreshed daily. --------------------------
FEEDS.push({
  name: 'volcanoes', every: 86400, onDemand: true, layer: 'volcanoes',
  async run() {
    const url = 'https://webservices.volcano.si.edu/geoserver/GVP-VOTW/ows'
      + '?service=WFS&version=2.0.0&request=GetFeature'
      + '&typeName=' + encodeURIComponent('GVP-VOTW:Smithsonian_VOTW_Holocene_Volcanoes')
      + '&outputFormat=' + encodeURIComponent('application/json')
      + '&srsName=' + encodeURIComponent('EPSG:4326');
    const d = await gfetch(url, { timeout: 60000 });
    const thisYear = new Date().getUTCFullYear();
    const out = {};
    for (const f of d.features || []) {
      const p = f.properties || {};
      const c = (f.geometry || {}).coordinates || [];
      if (c.length < 2) continue;
      const id = String(p.Volcano_Number || f.id || '');
      if (!id) continue;
      // BCE years and "Unknown" both fail isdigit in the Python and both
      // become null here, which is what makes `active` false for them.
      const raw = String(p.Last_Eruption_Year ?? '').trim();
      const lastYear = /^\d+$/.test(raw) ? parseInt(raw, 10) : null;
      out[id] = {
        lat: num(c[1]), lon: num(c[0]),
        name: p.Volcano_Name, country: p.Country, region: p.Region,
        type: p.Primary_Volcano_Type, elevation_m: p.Elevation,
        last_eruption: lastYear,
        active: lastYear !== null && lastYear >= thisYear - 10,
      };
    }
    store.replaceLayer('volcanoes', out);
  },
});

// ---- the aurora probability grid, ~64,800 triples --------------------------
FEEDS.push({
  name: 'aurora', every: 300, onDemand: true, layer: 'aurora',
  async run() {
    const d = await gfetch(
      'https://services.swpc.noaa.gov/json/ovation_aurora_latest.json',
      { timeout: 60000 });
    // Stored verbatim: the renderer reads "Observation Time" and
    // "coordinates" straight off the upstream shape.
    store.setMeta('aurora', d);
  },
});

// ---- submarine cables, courtesy of TeleGeography ---------------------------
FEEDS.push({
  name: 'cables', every: 86400, onDemand: true, layer: 'cables',
  async run() {
    const d = await gfetch(
      'https://www.submarinecablemap.com/api/v3/cable/cable-geo.json',
      { timeout: 60000 });
    store.setMeta('cables', { count: (d.features || []).length, geojson: d });
  },
});

// ---- two CSV feeds, and why they get different parsers ---------------------

/* OurAirports quotes fields and embeds commas inside `name` and
 * `municipality`, so splitting on commas corrupts rows. This is the RFC 4180
 * rules that actually matter: quoted fields, and a doubled quote inside one.
 */
function parseCsvQuoted(text) {
  const rows = [];
  let row = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQ = false;
      } else field += c;
      continue;
    }
    if (c === '"') inQ = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function csvObjects(text, split) {
  const rows = split(text);
  if (!rows.length) return [];
  const head = rows[0].map((h) => h.trim());
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (r.length < 2) continue;
    const o = {};
    for (let j = 0; j < head.length; j++) o[head[j]] = r[j];
    out.push(o);
  }
  return out;
}

const AIRPORT_TYPES = new Set(['large_airport', 'medium_airport']);

FEEDS.push({
  name: 'airports', every: 7 * 86400, onDemand: true, layer: 'airports',
  async run() {
    const text = await gfetch(
      'https://davidmegginson.github.io/ourairports-data/airports.csv',
      { as: 'text', timeout: 120000 });
    const out = {};
    for (const row of csvObjects(text, parseCsvQuoted)) {
      if (!AIRPORT_TYPES.has(row.type)) continue;
      const lat = num(row.latitude_deg), lon = num(row.longitude_deg);
      if (lat === null || lon === null) continue;
      const id = row.ident || row.id;
      if (!id) continue;
      out[id] = {
        lat, lon, name: row.name, iata: row.iata_code, icao: row.ident,
        type: row.type, elevation_ft: int(row.elevation_ft),
        country: row.iso_country, region: row.iso_region,
        municipality: row.municipality,
        scheduled_service: row.scheduled_service === 'yes',
      };
    }
    store.replaceLayer('airports', out);
  },
});

/* FIRMS ships ~175,000 unquoted rows, so the quoted parser's per-character
 * loop is the wrong tool: a plain split is several times faster and the
 * format has no embedded commas. issues.md 31 is about what happens after
 * this, when the renderer is handed the result.
 */
function parseCsvPlain(text) {
  return text.split('\n').map((l) => l.split(','));
}

const FIRE_CONFIDENCE = { l: 'low', n: 'nominal', h: 'high' };
const FIRMS_ARCHIVES = [
  'https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-20-viirs-c2/csv/J1_VIIRS_C2_Global_24h.csv',
  'https://firms.modaps.eosdis.nasa.gov/data/active_fire/suomi-npp-viirs-c2/csv/SUOMI_VIIRS_C2_Global_24h.csv',
];

FEEDS.push({
  name: 'fires', every: 1800, onDemand: true, layer: 'fires',
  async run() {
    let out = null;
    for (const url of FIRMS_ARCHIVES) {
      try {
        const text = await gfetch(url, { as: 'text', timeout: 180000 });
        const rows = csvObjects(text, parseCsvPlain);
        const acc = {};
        for (const row of rows) {
          const lat = num(row.latitude), lon = num(row.longitude);
          if (lat === null || lon === null) continue;
          const conf = String(row.confidence || '').trim();
          acc[`${row.acq_date || '?'}T${row.acq_time || '?'}_`
              + `${lat.toFixed(4)}_${lon.toFixed(4)}`] = {
            lat, lon,
            brightness: num(row.bright_ti4), frp: num(row.frp),
            confidence: FIRE_CONFIDENCE[conf.toLowerCase()] || conf || null,
            daynight: row.daynight, satellite: row.satellite,
            acq_date: row.acq_date, acq_time: row.acq_time,
          };
        }
        if (Object.keys(acc).length) { out = acc; break; }
      } catch (e) {
        console.warn('[feeds] FIRMS archive failed, trying the next', e.message);
      }
    }
    if (out) store.replaceLayer('fires', out);
  },
});

// ---- temporary flight restrictions ----------------------------------------

// (lat, lon), unlike the ring centroid below which is (lon, lat). Getting the
// two orders confused puts every fallback TFR in the wrong hemisphere.
const STATE_CENTROIDS = {
  AL: [32.8, -86.8], AK: [64.0, -152.0], AZ: [34.3, -111.7], AR: [34.9, -92.4],
  CA: [37.2, -119.5], CO: [39.0, -105.5], CT: [41.6, -72.7], DE: [39.0, -75.5],
  FL: [28.6, -82.4], GA: [32.6, -83.4], HI: [20.8, -156.3], ID: [44.4, -114.6],
  IL: [40.0, -89.2], IN: [39.9, -86.3], IA: [42.1, -93.5], KS: [38.5, -98.4],
  KY: [37.5, -85.3], LA: [31.0, -92.0], ME: [45.4, -69.2], MD: [39.0, -76.8],
  MA: [42.3, -71.8], MI: [44.3, -85.4], MN: [46.3, -94.3], MS: [32.7, -89.7],
  MO: [38.4, -92.5], MT: [47.0, -109.6], NE: [41.5, -99.8], NV: [39.3, -116.6],
  NH: [43.7, -71.6], NJ: [40.2, -74.7], NM: [34.4, -106.1], NY: [42.9, -75.5],
  NC: [35.5, -79.4], ND: [47.4, -100.5], OH: [40.3, -82.8], OK: [35.6, -97.5],
  OR: [43.9, -120.6], PA: [40.9, -77.8], RI: [41.7, -71.6], SC: [33.9, -80.9],
  SD: [44.4, -100.2], TN: [35.9, -86.4], TX: [31.5, -99.3], UT: [39.3, -111.7],
  VT: [44.1, -72.7], VA: [37.5, -78.9], WA: [47.4, -120.5], WV: [38.6, -80.6],
  WI: [44.6, -89.7], WY: [43.0, -107.6], DC: [38.9, -77.0], PR: [18.2, -66.5],
  VI: [18.3, -64.9], GU: [13.4, 144.8], AS: [-14.3, -170.7], MP: [15.2, 145.7],
};

function ringFromGeom(geom) {
  if (!geom) return null;
  if (geom.type === 'Polygon') return (geom.coordinates || [])[0] || null;
  if (geom.type === 'MultiPolygon') {
    let best = null;
    for (const poly of geom.coordinates || []) {
      const r = poly && poly[0];
      if (r && (!best || r.length > best.length)) best = r;
    }
    return best;
  }
  return null;
}

// Mean of the ring's vertices, returned (lon, lat). Not a geometric centroid;
// it is where the pick target and the panel anchor go.
function ringCentre(ring) {
  let sx = 0, sy = 0, n = 0;
  for (const pt of ring || []) {
    const x = num(pt[0]), y = num(pt[1]);
    if (x === null || y === null) continue;
    sx += x; sy += y; n += 1;
  }
  return n ? [sx / n, sy / n] : null;
}

FEEDS.push({
  name: 'tfrs', every: 900, onDemand: true, layer: 'tfrs',
  async run() {
    const wfsUrl = 'https://tfr.faa.gov/geoserver/TFR/ows'
      + '?service=WFS&version=2.0.0&request=GetFeature'
      + '&typeNames=' + encodeURIComponent('TFR:V_TFR_LOC')
      + '&outputFormat=' + encodeURIComponent('application/json')
      + '&srsName=' + encodeURIComponent('EPSG:4326');

    // The Python fetches the list endpoint twice. Once is enough.
    const [wfs, list] = await Promise.all([
      gfetch(wfsUrl).catch(() => null),
      gfetch('https://tfr.faa.gov/tfrapi/exportTfrList').catch(() => null),
    ]);

    const meta = {};
    for (const t of Array.isArray(list) ? list : []) {
      const nid = String(t.notam_id || '').trim();
      if (nid) {
        meta[nid] = {
          type: t.type, facility: t.facility,
          description: t.description, created: t.creation_date,
          state: String(t.state || '').toUpperCase(),
        };
      }
    }

    const out = {};
    for (const f of (wfs && wfs.features) || []) {
      const p = f.properties || {};
      const key = String(p.NOTAM_KEY || '');
      const nid = key.split('-', 1)[0].trim();
      if (!nid) continue;
      const ring = ringFromGeom(f.geometry);
      if (!ring) continue;
      const c = ringCentre(ring);
      if (!c) continue;
      const m = meta[nid] || {};
      out[nid] = {
        lat: c[1], lon: c[0], polygon: ring,
        name: nid, notam_id: nid,
        state: String(p.STATE || '').trim().toUpperCase(),
        legal: p.LEGAL, title: p.TITLE,
        description: m.description || p.TITLE,
        type: m.type, facility: m.facility, created: m.created,
        modified: p.LAST_MODIFICATION_DATETIME,
      };
    }

    // Anything the list knows about that has no polygon gets a stub at the
    // centre of its state. No polygon key at all on these, which the renderer
    // has to tolerate.
    for (const [nid, m] of Object.entries(meta)) {
      if (out[nid]) continue;
      const sc = STATE_CENTROIDS[m.state];
      if (!sc) continue;
      out[nid] = {
        lat: sc[0], lon: sc[1], name: nid, notam_id: nid,
        type: m.type, facility: m.facility, state: m.state,
        description: m.description, created: m.created,
      };
    }
    store.replaceLayer('tfrs', out);
  },
});

// ---------- the scheduler ---------------------------------------------------

/* One timer per feed rather than one loop over all of them.
 *
 * A single loop would make the slowest feed set everyone's cadence: the
 * aircraft sweep takes fourteen seconds by design, and quakes should not wait
 * for it. Each feed keeps its own schedule and its own failures.
 */
const running = new Map();     // name -> {timer, busy}

function layerIsOn(layer) {
  const cb = document.querySelector(`input[data-layer="${layer}"]`);
  return !!(cb && cb.checked && !cb.disabled);
}

async function runFeed(feed) {
  const st = running.get(feed.name);
  if (!st || st.busy) return;              // never overlap a feed with itself
  if (feed.onDemand && !layerIsOn(feed.layer)) return;
  st.busy = true;
  st.runs = (st.runs || 0) + 1;
  try {
    await feed.run();
    st.lastOk = Date.now();
    st.lastError = null;
  } catch (e) {
    // Recorded, not just logged. A feed that quietly stops is the failure
    // this whole design has to be able to answer for: with no server there is
    // no log to go and read, so the page has to be able to say what happened.
    st.lastError = (e && e.message ? e.message : String(e)).slice(0, 200);
    st.errors = (st.errors || 0) + 1;
    console.warn(`[feeds] ${feed.name}:`, st.lastError);
  } finally {
    st.busy = false;
  }
}

let started = false;
let flushTimer = null;
let expireTimer = null;

function start() {
  if (started) return;
  started = true;

  // The opening snapshot, so the app has the same shape it gets from a
  // server: empty layers, no counts, nothing deferred. Everything fills in
  // through :reset and :batch as the feeds answer.
  emit({
    type: 'snapshot',
    data: { layers: {}, meta: {}, counts: {}, deferred: [] },
  });

  // The keyless ships path is Baltic and Finnish waters only, and the UI
  // says so from this. Set before the feed runs so the label is never wrong.
  store.setMeta('ships_source', {
    name: 'Digitraffic',
    global: false,
    note: 'Baltic & Finnish waters only (keyless Digitraffic feed). '
        + 'A free aisstream.io key extends this worldwide.',
  });

  for (const feed of FEEDS) {
    running.set(feed.name, { busy: false, timer: null });
    const tick = () => { runFeed(feed); };
    // Stagger the first run so seventeen feeds do not all fire into the same
    // frame as the globe is still building its first tiles.
    const lead = feed.onDemand ? 1500 : 250 + FEEDS.indexOf(feed) * 400;
    setTimeout(() => {
      tick();
      running.get(feed.name).timer = setInterval(tick, feed.every * 1000);
    }, lead);
  }

  flushTimer = setInterval(() => store.flush(), 250);
  expireTimer = setInterval(() => store.expire(), 60000);
}

function stop() {
  for (const st of running.values()) if (st.timer) clearInterval(st.timer);
  running.clear();
  if (flushTimer) clearInterval(flushTimer);
  if (expireTimer) clearInterval(expireTimer);
  started = false;
}

/* Called when a layer switch changes, so an on-demand feed starts fetching
 * the moment somebody asks for it instead of up to six hours later.
 */
function wake(layer) {
  for (const feed of FEEDS) {
    if (feed.onDemand && feed.layer === layer && layerIsOn(layer)) {
      const rows = store.layers[layer];
      // Already have it and it has not expired? Leave it be.
      if (rows && Object.keys(rows).length) continue;
      runFeed(feed);
    }
  }
}

// ---------- the on-demand endpoints -----------------------------------------

/* The server also answered twelve plain GETs that the client calls when it
 * needs something, rather than being pushed: config, METAR, the SPC outlook,
 * river gauges, tide stations, webcams and so on. Those are not feeds and do
 * not belong in the scheduler; they are request/response, and in device mode
 * they are answered here.
 *
 * `api(path)` returns a real Response so every call site keeps working
 * unchanged -- they do `r.ok` and `await r.json()` and neither cares that the
 * bytes never crossed a network.
 */
function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status, headers: { 'content-type': 'application/json' },
  });
}

/* What /api/config said, minus everything that was a server-side secret.
 *
 * There is no server, so there is nowhere to keep a Cesium ion token or a
 * Google Maps key, and baking one into the page would publish it. Device mode
 * is therefore the keyless configuration: the satellite base falls back to
 * Esri, which the keyless work already supports and keyless_test.py already
 * covers. Fires and ships are TRUE because both have working keyless paths --
 * the FIRMS 24h archive and Digitraffic -- and the flags gate the switches.
 */
const DEVICE_CONFIG = {
  cesium_ion_token: '',
  google_maps_api_key: '',
  fires_enabled: true,
  ships_enabled: true,
  ships_global: false,
};

/* Cache with a TTL, and serve the stale copy when the fetch fails.
 *
 * The stale fallback is not a nicety: every one of these endpoints did it
 * server-side, so the client has never seen a hard failure while an old copy
 * existed, and a panel that blanks on one bad request would be a regression
 * introduced by moving the code rather than by anything upstream.
 */
const apiCache = new Map();      // key -> {at, data}

async function cached(key, ttlMs, build) {
  const hit = apiCache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.data;
  try {
    const data = await build();
    apiCache.set(key, { at: Date.now(), data });
    return data;
  } catch (e) {
    if (hit) return hit.data;
    throw e;
  }
}

const feature = (lon, lat, props) => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [lon, lat] },
  properties: props,
});

const inRange = (lat, lon) => lat !== null && lon !== null
  && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;

// NWPS writes -999 where it has no reading. Plotting it puts the gauge a
// thousand feet below its own riverbed.
const NWPS_MISSING = -999;
const FLOOD_RANK = {
  no_flooding: 0, not_defined: 0, obs_not_current: 0, fcst_not_current: 0,
  low_water_threshold: 0, action: 1, minor: 2, moderate: 3, major: 4,
};

function nwpsReading(node) {
  if (!node) return null;
  const v = num(node.primary);
  if (v === null || v === NWPS_MISSING) return null;
  const out = {
    value: v, unit: node.primaryUnit || 'ft', valid: node.validTime || '',
  };
  const flow = num(node.secondary);
  if (flow !== null && flow !== NWPS_MISSING) {
    out.flow = flow;
    out.flow_unit = node.secondaryUnit || '';
  }
  return out;
}

// GRLevelX placefile. The quoted blob escapes its newlines as the two
// characters backslash and n, so it is split on that and not on a real one.
const SPOTTER_ICON = new RegExp(
  '^Icon:\\s*(-?\\d+(?:\\.\\d+)?),\\s*(-?\\d+(?:\\.\\d+)?),\\s*\\d+,\\s*\\d+,'
  + '\\s*(\\d+),\\s*"([\\s\\S]*?)"\\s*$', 'gm');

function parseSpotters(text) {
  const feats = [];
  SPOTTER_ICON.lastIndex = 0;
  let m;
  while ((m = SPOTTER_ICON.exec(text)) !== null) {
    const lat = num(m[1]), lon = num(m[2]);
    if (!inRange(lat, lon)) continue;
    const rec = { reporter: '', report: '', time: '', notes: '' };
    for (const line of String(m[4]).split('\\n')) {
      const s = line.trim();
      if (!s) continue;
      const low = s.toLowerCase();
      // split on the FIRST colon only: a time value carries more of them.
      const after = () => s.slice(s.indexOf(':') + 1).trim();
      if (low.startsWith('reported by:')) rec.reporter = after();
      else if (low.startsWith('time:')) rec.time = after();
      else if (low.startsWith('notes:')) rec.notes = after();
      else if (!rec.report) rec.report = s;
    }
    feats.push(feature(lon, lat, { kind: 'spotters', icon: parseInt(m[3], 10), ...rec }));
  }
  return feats;
}

// NDBC latest_obs.txt: whitespace columns, "MM" meaning no reading.
const BUOY_COLS = [
  [8, 'wind_dir'], [9, 'wind_speed'], [10, 'gust'], [11, 'wave_height'],
  [12, 'dom_period'], [13, 'avg_period'], [14, 'wave_dir'], [15, 'pressure'],
  [16, 'pressure_tend'], [17, 'air_temp'], [18, 'water_temp'],
  [19, 'dew_point'], [20, 'visibility'], [21, 'tide'],
];

function parseBuoys(text) {
  const feats = [];
  for (const line of text.split('\n')) {
    const s = line.trim();
    if (!s || s.startsWith('#')) continue;
    const c = s.split(/\s+/);
    if (c.length < 22) continue;
    const lat = num(c[1]), lon = num(c[2]);
    if (!inRange(lat, lon)) continue;
    const rec = { id: c[0] };
    const p2 = (x) => String(parseInt(x, 10)).padStart(2, '0');
    try {
      rec.obs_time = `${c[3]}-${p2(c[4])}-${p2(c[5])}T${p2(c[6])}:${p2(c[7])}Z`;
    } catch (e) { rec.obs_time = ''; }
    for (const [i, key] of BUOY_COLS) {
      if (c[i] === 'MM') continue;
      const v = num(c[i]);
      if (v !== null) rec[key] = v;
    }
    // id and obs_time only is a dot with nothing in it.
    if (Object.keys(rec).length <= 2) continue;
    feats.push(feature(lon, lat, { kind: 'buoys', ...rec }));
  }
  return feats;
}

const RIVER_TILES = [
  [-180.0, 15.0, -125.0, 72.0],   // Alaska, Hawaii, Pacific
  [-125.0, 24.0, -100.0, 50.0],   // west
  [-100.0, 24.0, -85.0, 50.0],    // plains and midwest
  [-85.0, 15.0, -60.0, 50.0],     // east, Gulf, Puerto Rico
];

const CAM_FRAME = 'https://cameras.alertcalifornia.org/public-camera-data/'
  + '{cid}/latest-frame.jpg';

const API_ROUTES = [
  [/^\/api\/config$/, async () => jsonResponse(DEVICE_CONFIG)],

  // ---- storm products ----------------------------------------------------

  [/^\/api\/spc\/outlook$/, async (m, path) => {
    const day = new URLSearchParams(path.split('?')[1] || '').get('day') || '1';
    if (!['1', '2', '3'].includes(day)) {
      return jsonResponse({ error: 'day must be 1, 2 or 3' }, 400);
    }
    return jsonResponse(await cached(`spc:${day}`, 600000, () => gfetch(
      `https://www.spc.noaa.gov/products/outlook/day${day}otlk_cat.nolyr.geojson`,
      { timeout: 20000 })));
  }],

  [/^\/api\/nws\/alerts$/, async () => jsonResponse(
    await cached('nws', 60000, () => gfetch(
      'https://api.weather.gov/alerts/active?status=actual&message_type=alert',
      { timeout: 25000 })))],

  [/^\/api\/lsr$/, async (m, path) => {
    const raw = parseInt(
      new URLSearchParams(path.split('?')[1] || '').get('hours') || '12', 10);
    const hours = Math.max(1, Math.min(48, Number.isFinite(raw) ? raw : 12));
    return jsonResponse(await cached(`lsr:${hours}`, 180000, async () => {
      const d = await gfetch(
        `https://mesonet.agron.iastate.edu/geojson/lsr.py?hours=${hours}`,
        { timeout: 25000 });
      d._hours = hours;     // the client reads this back
      return d;
    }));
  }],

  [/^\/api\/metar$/, async () => jsonResponse(
    await cached('metar', 300000, async () => {
      // bbox is lat0,lon0,lat1,lon1. Lon first returns 204 and then fails to
      // parse, which looks like an outage and is not one.
      const raw = await gfetch('https://aviationweather.gov/api/data/metar'
        + '?format=json&taf=false&hours=2&bbox=15,-170,72,-60',
        { timeout: 25000 });
      const latest = {};
      for (const ob of Array.isArray(raw) ? raw : []) {
        const sid = ob.icaoId;
        if (!sid || ob.lat === null || ob.lon === null
            || ob.lat === undefined || ob.lon === undefined) continue;
        const prev = latest[sid];
        if (prev && !(ob.obsTime > prev.obsTime)) continue;
        latest[sid] = {
          id: sid, lat: ob.lat, lon: ob.lon,
          temp: ob.temp, dewp: ob.dewp, wdir: ob.wdir, wspd: ob.wspd,
          wgst: ob.wgst, visib: ob.visib, altim: ob.altim,
          name: ob.name, obsTime: ob.obsTime,
        };
      }
      return Object.values(latest);
    }))],

  // ---- water -------------------------------------------------------------

  [/^\/api\/rivers$/, async () => jsonResponse(
    await cached('rivers', 600000, async () => {
      const tiles = await Promise.all(RIVER_TILES.map(([a, b, c, d]) =>
        gfetch('https://api.water.noaa.gov/nwps/v1/gauges?srid=EPSG_4326'
          + `&bbox.xmin=${a}&bbox.ymin=${b}&bbox.xmax=${c}&bbox.ymax=${d}`,
          { timeout: 90000 }).catch(() => null)));
      if (tiles.every((t) => t === null)) throw new Error('river gauges unavailable');

      const seen = new Set();
      const feats = [];
      let flooding = 0;
      for (const t of tiles) {
        for (const g of (t && t.gauges) || []) {
          const lat = num(g.latitude), lon = num(g.longitude);
          if (!inRange(lat, lon)) continue;
          const id = g.lid || '';
          if (id && seen.has(id)) continue;
          if (id) seen.add(id);
          const status = g.status || {};
          const observed = nwpsReading(status.observed);
          const forecast = nwpsReading(status.forecast);
          // Forecast-only gauges are kept on purpose; a gauge with neither is
          // a dot with nothing to say.
          if (!observed && !forecast) continue;
          const cat = (status.observed || {}).floodCategory || 'not_defined';
          const rank = FLOOD_RANK[cat] || 0;
          if (rank >= 1) flooding += 1;
          feats.push(feature(lon, lat, {
            kind: 'rivers', id,
            name: g.name || 'River gauge',
            state: (g.state || {}).abbreviation || '',
            wfo: (g.wfo || {}).abbreviation || '',
            rfc: (g.rfc || {}).name || '',
            flood_category: cat, flood_rank: rank,
            observed, forecast,
          }));
        }
      }
      return {
        type: 'FeatureCollection', flooding,
        credit: 'NOAA National Water Prediction Service', features: feats,
      };
    }))],

  [/^\/api\/tides$/, async () => jsonResponse(
    await cached('tides', 86400000, async () => {
      const d = await gfetch('https://api.tidesandcurrents.noaa.gov/mdapi/prod/'
        + 'webapi/stations.json?type=waterlevels', { timeout: 45000 });
      const feats = [];
      for (const s of d.stations || []) {
        // Upstream calls longitude `lng`.
        const lat = num(s.lat), lon = num(s.lng);
        if (lat === null || lon === null) continue;
        feats.push(feature(lon, lat, {
          kind: 'tides', id: s.id || '', name: s.name || 'Tide station',
          state: s.state || '', tidal: !!s.tidal,
          great_lakes: !!s.greatlakes, storm_surge: !!s.stormsurge,
          affiliations: s.affiliations || '',
        }));
      }
      return { type: 'FeatureCollection', features: feats, credit: 'NOAA CO-OPS' };
    }))],

  [/^\/api\/tide\/([0-9A-Za-z]{3,12})$/, async (m) => {
    // No cache, as before: this is a per-click lookup.
    const station = m[1];
    const base = 'https://api.tidesandcurrents.noaa.gov/api/prod/datagetter'
      + `?station=${station}&datum=MLLW&units=english&format=json`
      + '&application=graticule';
    const [lvl, pred] = await Promise.all([
      // gmt for the observation and lst_ldt for the hi/lo predictions, which
      // is what makes the panel show a high tide at the local clock time.
      gfetch(`${base}&date=latest&product=water_level&time_zone=gmt`,
             { timeout: 25000 }).catch(() => null),
      gfetch(`${base}&date=today&product=predictions&interval=hilo&time_zone=lst_ldt`,
             { timeout: 25000 }).catch(() => null),
    ]);
    const out = { station };
    if (lvl) {
      const rows = lvl.data || [];
      if (rows.length) {
        out.level = { t: rows[rows.length - 1].t, v: rows[rows.length - 1].v };
        out.name = (lvl.metadata || {}).name;
      } else if (lvl.error) {
        // CO-OPS answers 200 with an error object for a station that carries
        // no water level, so r.ok is not the question.
        out.level_error = (lvl.error || {}).message || '';
      }
    }
    if (pred) {
      out.predictions = (pred.predictions || []).map(
        (p) => ({ t: p.t, v: p.v, type: p.type }));
    }
    return jsonResponse(out);
  }],

  [/^\/api\/buoys$/, async () => jsonResponse(
    await cached('buoys', 900000, async () => ({
      type: 'FeatureCollection',
      features: parseBuoys(await gfetch(
        'https://www.ndbc.noaa.gov/data/latest_obs/latest_obs.txt',
        { as: 'text', timeout: 30000 })),
      credit: 'NOAA National Data Buoy Center',
    })))],

  // ---- people and eyes ---------------------------------------------------

  [/^\/api\/spotters$/, async () => jsonResponse(
    await cached('spotters', 120000, async () => ({
      type: 'FeatureCollection',
      features: parseSpotters(await gfetch(
        'https://www.spotternetwork.org/feeds/reports.txt',
        { as: 'text', timeout: 25000 })),
      credit: 'Spotter Network',
    })))],

  [/^\/api\/cameras$/, async () => jsonResponse(
    await cached('cameras', 1800000, async () => {
      const jobs = [
        gfetch('https://cameras.alertcalifornia.org/public-camera-data/'
               + 'all_cameras-v3.json', { timeout: 45000 })
          .then((d) => ['alertca', d]).catch(() => null),
        gfetch('https://webcams.nyctmc.org/api/cameras', { timeout: 45000 })
          .then((d) => ['nyc', d]).catch(() => null),
      ];
      for (let d = 1; d <= 12; d++) {
        // `d` unpadded in the directory, zero-padded in the filename.
        const dd = String(d).padStart(2, '0');
        jobs.push(gfetch(`https://cwwp2.dot.ca.gov/data/d${d}/cctv/cctvStatusD${dd}.json`,
                         { timeout: 45000 })
          .then((x) => ['caltrans', x]).catch(() => null));
      }
      const got = (await Promise.all(jobs)).filter(Boolean);
      if (!got.length) throw new Error('all camera sources unavailable');

      const cams = [];
      const networks = {};
      const add = (net, lat, lon, props) => {
        if (!inRange(lat, lon) || (lat === 0 && lon === 0)) return;
        networks[net] = (networks[net] || 0) + 1;
        cams.push(feature(lon, lat, { kind: 'cameras', network: net, ...props }));
      };

      for (const [kind, d] of got) {
        if (kind === 'alertca') {
          for (const f of (d && d.features) || []) {
            const c = (f.geometry || {}).coordinates || [];
            // About 900 of 2,180 records carry a null coordinate, and a NaN
            // reaches Cesium's frustum computation and kills the scene.
            if (c.length < 2 || c[0] === null || c[1] === null) continue;
            const p = f.properties || {};
            const id = p.id || p.name;
            if (!id) continue;
            add('ALERTCalifornia', num(c[1]), num(c[0]), {
              id, name: p.name || id,
              place: String(p.county || '').replace(/\b\w/g, (x) => x.toUpperCase()),
              state: p.state || 'CA',
              image: CAM_FRAME.replace('{cid}', id),
              az_current: p.az_current, tilt_current: p.tilt_current,
              last_frame_ts: p.last_frame_ts,
            });
          }
        } else if (kind === 'nyc') {
          for (const c of Array.isArray(d) ? d : []) {
            add('NYC DOT', num(c.latitude), num(c.longitude), {
              id: c.id, name: c.name || 'NYC camera',
              place: c.area || 'New York City', state: 'NY',
              image: c.imageUrl,
              in_service: String(c.isOnline || '').toLowerCase() === 'true',
            });
          }
        } else {
          // {data: [{cctv: {index, location{...}, inService, imageData{...}}}]}
          // and every scalar in it is a STRING, latitude included.
          let li = -1;
          for (const loc of (d || {}).data || []) {
            li += 1;
            const L = loc.cctv || loc;
            const rec = L.location || {};
            const url = ((L.imageData || {}).static || {}).currentImageURL;
            if (!url) continue;
            add('Caltrans', num(rec.latitude), num(rec.longitude), {
              id: `ct-${rec.district || ''}-${li}-${L.index || 0}`,
              name: rec.locationName || rec.nearbyPlace || 'Caltrans CCTV',
              place: rec.county || rec.nearbyPlace || '',
              state: 'CA', route: rec.route, direction: rec.direction,
              image: url,
              stream: ((L.imageData || {}).streamingVideoURL) || '',
              in_service: String(L.inService || '').toLowerCase() === 'true',
            });
          }
        }
      }
      return {
        type: 'FeatureCollection', networks,
        credit: 'ALERTCalifornia / UC San Diego · Caltrans CWWP2 · NYC DOT',
        features: cams,
      };
    }))],

  [/^\/api\/snapshot$/, async () => jsonResponse({
    layers: store.layers, meta: store.meta,
    counts: Object.fromEntries(Object.entries(store.layers)
      .map(([k, v]) => [k, Object.keys(v).length])),
    deferred: [],
  })],

  [/^\/api\/layer\/([a-z0-9_]+)$/, async (m) => {
    const rows = store.layers[m[1]];
    if (!rows) return jsonResponse({ error: `no such layer: ${m[1]}` }, 404);
    return jsonResponse({ layer: m[1], rows });
  }],
];

async function api(path) {
  for (const [re, fn] of API_ROUTES) {
    const m = re.exec(path.split('?')[0]);
    if (m) {
      try {
        return await fn(m, path);
      } catch (e) {
        return jsonResponse({ error: String(e && e.message || e) }, 502);
      }
    }
  }
  // Deliberately a 501 and not a 404: 404 means "no such thing", and these
  // things exist, they are just not ported yet. A caller that logs the status
  // then says which.
  return jsonResponse({ error: `not implemented in device mode: ${path}` }, 501);
}

window.GraticuleFeeds = {
  start, stop, wake, api,
  rows: (layer) => store.layers[layer] || {},
  counts: () => Object.fromEntries(
    Object.entries(store.layers).map(([k, v]) => [k, Object.keys(v).length])),
  /* Per-feed health. There is no server log any more, so this is where the
   * answer to "why is that layer empty" lives. */
  status: () => FEEDS.map((f) => {
    const st = running.get(f.name) || {};
    return {
      name: f.name,
      onDemand: !!f.onDemand,
      on: f.onDemand ? layerIsOn(f.layer) : true,
      every: f.every,
      runs: st.runs || 0,
      errors: st.errors || 0,
      lastOk: st.lastOk || null,
      lastError: st.lastError || null,
      busy: !!st.busy,
    };
  }),
  proxied: () => [...NEEDS_PROXY],
  native: !!nativeHttp,
};

window.__graticuleFeedsInternals = { store, gfetch, meanCentroid, num, int, str, FEEDS };

})();
