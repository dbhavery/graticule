/* Graticule — front-end. Cesium globe + telemetry HUD + WebSocket-driven layers.
 *
 *  Categories (toggleable): AIR | SEA | EARTH | WEATHER | SPACE | ALERTS
 *  Always-on telemetry:     UTC clock, cursor lat/lon, camera altitude,
 *                            Kp index, solar wind speed, X-ray flare class.
 */

const COLORS = {
  planes:     Cesium.Color.fromCssColorString('#ffd14a'),
  ships:      Cesium.Color.fromCssColorString('#4dd2ff'),
  satellites: Cesium.Color.fromCssColorString('#c4b5fd'),
  quakes:     Cesium.Color.fromCssColorString('#f97373'),
  hurricanes: Cesium.Color.fromCssColorString('#f59e0b'),
  volcanoes:  Cesium.Color.fromCssColorString('#fb923c'),
  fires:      Cesium.Color.fromCssColorString('#ef4444'),
  tsunamis:   Cesium.Color.fromCssColorString('#f0abfc'),
  launches:   Cesium.Color.fromCssColorString('#fde047'),
  news:       Cesium.Color.fromCssColorString('#94a3b8'),
  severe:     Cesium.Color.fromCssColorString('#ec4899'),
  cables:     Cesium.Color.fromCssColorString('#fbbf24'),
  airports:   Cesium.Color.fromCssColorString('#60a5fa'),
  tfrs:       Cesium.Color.fromCssColorString('#f43f5e'),
  boundaries: Cesium.Color.fromCssColorString('#94a3b8'),  // cool slate — neutral over any base
  airspace:   Cesium.Color.fromCssColorString('#a78bfa'),  // soft violet for airspace classes
  cities:     Cesium.Color.fromCssColorString('#fcd34d'),  // amber for city dots
  rivers:     Cesium.Color.fromCssColorString('#38bdf8'),  // flooding gauges recolour per category
  tides:      Cesium.Color.fromCssColorString('#818cf8'),
  buoys:      Cesium.Color.fromCssColorString('#5eead4'),
};

const CATEGORY = {
  planes: 'air', satellites: 'air', airports: 'air', tfrs: 'air',
  ships: 'sea', hurricanes: 'sea',
  quakes: 'earth', volcanoes: 'earth', fires: 'earth',
  radar: 'weather', aurora: 'weather', clouds: 'weather', terminator: 'weather',
  launches: 'space',
  tsunamis: 'alerts', severe: 'alerts', news: 'alerts',
  cables: 'reference',
  rivers: 'water', tides: 'water', buoys: 'water',
  parcels_us: 'land', parcels_wa: 'land',
  countries: 'boundaries', states: 'boundaries', airspace: 'boundaries', cities: 'boundaries',
};

const KIND_LABEL = {
  planes: 'AIRCRAFT', ships: 'VESSEL', satellites: 'SATELLITE',
  quakes: 'EARTHQUAKE', hurricanes: 'TROPICAL CYCLONE',
  volcanoes: 'VOLCANO', fires: 'FIRE DETECTION',
  tsunamis: 'TSUNAMI ALERT', launches: 'LAUNCH', news: 'NATURAL EVENT',
  severe: 'SEVERE WX',
  airports: 'AIRPORT', tfrs: 'FLIGHT RESTRICTION',
  parcels_wa: 'PARCEL',
  metar: 'SURFACE OBS', lsr: 'STORM REPORT', warning: 'NWS ALERT',
  cameras: 'LIVE CAMERA', spotters: 'SPOTTER REPORT',
  spc: 'SPC OUTLOOK', model: 'MODEL FIELD', aqi: 'AIR QUALITY',
  rivers: 'RIVER GAUGE', tides: 'TIDE STATION', buoys: 'MARINE BUOY',
};

// SPC categorical risk names, for the outlook detail panel.
const SPC_RISK_LABEL = {
  TSTM: 'General Thunderstorms', MRGL: 'Marginal Risk (1/5)',
  SLGT: 'Slight Risk (2/5)',     ENH:  'Enhanced Risk (3/5)',
  MDT:  'Moderate Risk (4/5)',   HIGH: 'High Risk (5/5)',
};

// EPA AQI category bands.
function aqiCategory(v) {
  if (v == null) return 'Unknown';
  if (v <= 50)  return 'Good';
  if (v <= 100) return 'Moderate';
  if (v <= 150) return 'Unhealthy for sensitive groups';
  if (v <= 200) return 'Unhealthy';
  if (v <= 300) return 'Very unhealthy';
  return 'Hazardous';
}

// ─────────  LOD: distance-aware billboard icons  ─────────
// Top-down silhouette SVGs, north-up. Cesium rotates them by -toRadians(heading).
// Stored as data: URIs so Cesium loads them without a network round-trip.
const ICON_SVG = {
  plane: `<svg xmlns='http://www.w3.org/2000/svg' viewBox='-12 -12 24 24'>
    <path fill='%23ffd14a' stroke='black' stroke-width='0.6' stroke-linejoin='round'
      d='M0,-10 L1.6,-2 L10,-1 L10,1.2 L1.6,1.2 L1.6,7 L4,8.5 L4,9.6 L0,9.2 L-4,9.6 L-4,8.5 L-1.6,7 L-1.6,1.2 L-10,1.2 L-10,-1 L-1.6,-2 Z'/>
  </svg>`,
  ship: `<svg xmlns='http://www.w3.org/2000/svg' viewBox='-7 -12 14 24'>
    <path fill='%234dd2ff' stroke='black' stroke-width='0.6' stroke-linejoin='round'
      d='M0,-10 L4,-3 L4,7 L2.5,9.5 L-2.5,9.5 L-4,7 L-4,-3 Z'/>
    <rect x='-1.6' y='-1' width='3.2' height='3.5' fill='black' opacity='0.35'/>
  </svg>`,
  ship_cargo: `<svg xmlns='http://www.w3.org/2000/svg' viewBox='-7 -16 14 32'>
    <path fill='%234dd2ff' stroke='black' stroke-width='0.6' stroke-linejoin='round'
      d='M0,-14 L4,-8 L4,12 L2.5,14 L-2.5,14 L-4,12 L-4,-8 Z'/>
    <g fill='black' opacity='0.3'>
      <rect x='-3' y='-6' width='6' height='2'/>
      <rect x='-3' y='-3' width='6' height='2'/>
      <rect x='-3' y='0'  width='6' height='2'/>
      <rect x='-3' y='3'  width='6' height='2'/>
      <rect x='-3' y='6'  width='6' height='2'/>
    </g>
  </svg>`,
  ship_tanker: `<svg xmlns='http://www.w3.org/2000/svg' viewBox='-6 -16 12 32'>
    <path fill='%23a78bfa' stroke='black' stroke-width='0.6' stroke-linejoin='round'
      d='M0,-14 L3.5,-8 L3.5,11 L2,14 L-2,14 L-3.5,11 L-3.5,-8 Z'/>
    <circle cx='0' cy='-3' r='1.4' fill='black' opacity='0.35'/>
    <circle cx='0' cy='2'  r='1.4' fill='black' opacity='0.35'/>
    <circle cx='0' cy='7'  r='1.4' fill='black' opacity='0.35'/>
  </svg>`,
  ship_passenger: `<svg xmlns='http://www.w3.org/2000/svg' viewBox='-6 -14 12 28'>
    <path fill='%23f0abfc' stroke='black' stroke-width='0.6' stroke-linejoin='round'
      d='M0,-12 L3.5,-6 L3.5,10 L2,12 L-2,12 L-3.5,10 L-3.5,-6 Z'/>
    <rect x='-2.4' y='-4' width='4.8' height='12' fill='white' opacity='0.4' rx='0.5'/>
  </svg>`,
  ship_fishing: `<svg xmlns='http://www.w3.org/2000/svg' viewBox='-5 -10 10 20'>
    <path fill='%2334d399' stroke='black' stroke-width='0.6' stroke-linejoin='round'
      d='M0,-9 L3,-4 L3,6 L1.5,8.5 L-1.5,8.5 L-3,6 L-3,-4 Z'/>
  </svg>`,
  satellite: `<svg xmlns='http://www.w3.org/2000/svg' viewBox='-10 -10 20 20'>
    <rect x='-2' y='-2' width='4' height='4' fill='%23c4b5fd' stroke='black' stroke-width='0.4'/>
    <rect x='-9' y='-1.4' width='6' height='2.8' fill='%23c4b5fd' opacity='0.7' stroke='black' stroke-width='0.3'/>
    <rect x='3'  y='-1.4' width='6' height='2.8' fill='%23c4b5fd' opacity='0.7' stroke='black' stroke-width='0.3'/>
  </svg>`,
  iss: `<svg xmlns='http://www.w3.org/2000/svg' viewBox='-12 -8 24 16'>
    <rect x='-2.5' y='-2' width='5' height='4' fill='%23ffeb99' stroke='black' stroke-width='0.4'/>
    <rect x='-11' y='-1' width='8' height='2' fill='%23ffeb99' stroke='black' stroke-width='0.3'/>
    <rect x='3'   y='-1' width='8' height='2' fill='%23ffeb99' stroke='black' stroke-width='0.3'/>
    <line x1='-7' y1='-3.5' x2='-7' y2='3.5' stroke='black' stroke-width='0.3'/>
    <line x1='7'  y1='-3.5' x2='7'  y2='3.5' stroke='black' stroke-width='0.3'/>
  </svg>`,
  hurricane: `<svg xmlns='http://www.w3.org/2000/svg' viewBox='-15 -15 30 30'>
    <g fill='none' stroke='%23f59e0b' stroke-width='2' stroke-linecap='round'>
      <path d='M0,-12 C 8,-10 12,-4 8,2'/>
      <path d='M0,12 C -8,10 -12,4 -8,-2'/>
    </g>
    <circle cx='0' cy='0' r='2.2' fill='%23f59e0b'/>
  </svg>`,
  volcano: `<svg xmlns='http://www.w3.org/2000/svg' viewBox='-10 -12 20 24'>
    <path fill='%23fb923c' stroke='black' stroke-width='0.5' stroke-linejoin='round'
      d='M-9,10 L-3,-7 L-1.5,-8.5 L1.5,-8.5 L3,-7 L9,10 Z'/>
    <path fill='%23ef4444' d='M-1.5,-8.5 L-2.5,-11 L0,-11.5 L2.5,-11 L1.5,-8.5 Z'/>
  </svg>`,
  launch: `<svg xmlns='http://www.w3.org/2000/svg' viewBox='-14 -14 28 28'>
    <circle cx='0' cy='0' r='12' fill='none' stroke='%23fde047' stroke-width='0.8' opacity='0.45'/>
    <circle cx='0' cy='0' r='8'  fill='none' stroke='%23fde047' stroke-width='1.2' opacity='0.7'/>
    <path fill='%23fde047' stroke='black' stroke-width='0.4' stroke-linejoin='round'
      d='M0,-7 L2,-1 L2.5,3 L1,5 L-1,5 L-2.5,3 L-2,-1 Z'/>
  </svg>`,
};

// Convert SVG strings → data URIs once
const ICON_URI = Object.fromEntries(
  Object.entries(ICON_SVG).map(([k, svg]) => [k, 'data:image/svg+xml;utf8,' + svg.replace(/\n/g, '').replace(/\s{2,}/g, ' ')])
);

// AIS ship-type code → icon variant. ITU-R M.1371 type codes.
function shipIcon(typeCode) {
  if (typeCode == null) return ICON_URI.ship;
  const t = Number(typeCode);
  if (t >= 30 && t <= 39) return ICON_URI.ship_fishing;       // fishing/towing
  if (t >= 60 && t <= 69) return ICON_URI.ship_passenger;     // passenger
  if (t >= 70 && t <= 79) return ICON_URI.ship_cargo;         // cargo
  if (t >= 80 && t <= 89) return ICON_URI.ship_tanker;        // tanker
  return ICON_URI.ship;
}

// LOD distance bands (camera-to-entity distance in metres)
const LOD = {
  planes:     { far: 3_500_000, mid: 250_000 },
  ships:      { far: 1_500_000, mid: 100_000 },
  satellites: { far: 30_000_000, mid: 8_000_000 },  // sats live at high altitude
  hurricanes: { far: 12_000_000, mid: 3_000_000 },
  volcanoes: { far: 4_000_000, mid: 800_000 },
  launches:  { far: 15_000_000, mid: 2_000_000 },
};

// Per-feed staleness threshold in seconds — stays 'ok' (live green) while
// fresh, flips 'warn' (amber) when stale, 'bad' (red) when very stale.
// 'static' = loaded once at boot and never refreshed; chip stays 'ok' forever.
const FEEDS = [
  { id: 'planes',        label: 'ADS-B',     warn:    300, bad:   1200 },  //  6s poll → 5 min warn
  { id: 'ships',         label: 'AIS',       warn:    600, bad:   1800 },  //  WS, but quiet patches happen
  { id: 'satellites',    label: 'TLE',       warn:  21600, bad:  86400 },  //  6h refresh
  { id: 'airports',      label: 'AIRPORTS',  static: true },               //  CSV loaded once
  { id: 'tfrs',          label: 'TFR',       warn:   2700, bad:   7200 },  //  15 min poll
  { id: 'quakes',        label: 'USGS',      warn:    900, bad:   3600 },  //  60s poll
  { id: 'hurricanes',    label: 'NHC',       warn:   7200, bad:  21600 },  //  off-season idle
  { id: 'volcanoes',     label: 'GVP',       static: true },               //  catalog, refreshes daily
  { id: 'fires',         label: 'FIRMS',     warn:   7200, bad:  21600 },  //  3h poll
  { id: 'tsunamis',      label: 'NWS',       warn:   3600, bad:  10800 },  //  10 min poll, often empty
  { id: 'severe',        label: 'NWS-WX',    warn:   1800, bad:   5400 },  //  5 min poll
  { id: 'launches',      label: 'LL2',       warn:   3600, bad:  10800 },  //  15 min poll
  { id: 'news',          label: 'EONET',     warn:   7200, bad:  21600 },  //  30 min poll, can 500
  { id: 'cables',        label: 'CABLES',    meta: true, static: true },   //  TeleGeography GeoJSON, static
  { id: 'radar',         label: 'RADAR',     meta: true, warn:  900, bad:  3600 },  // 5 min poll
  { id: 'aurora',        label: 'AURORA',    meta: true, warn: 1800, bad:  5400 },  // 5 min poll
  { id: 'space_weather', label: 'SWPC',      meta: true, warn: 1800, bad:  5400, hideFromChips: false },
];

const FEED_BY_ID = Object.fromEntries(FEEDS.map(f => [f.id, f]));

// One-time migration from legacy cupola.* localStorage keys after the
// 2026-05-02 Cupola → Graticule rename. Read old, write new, delete old.
// Also flip 'metric' → 'us' on existing settings since the default changed
// from metric to US Customary on 2026-05-02 night per user request.
(function migrateLegacyKeys() {
  try {
    const pairs = [
      ['cupola.settings.v1', 'graticule.settings.v1'],
      ['cupola.presets.v1',  'graticule.presets.v1'],
    ];
    for (const [oldK, newK] of pairs) {
      const v = localStorage.getItem(oldK);
      if (v != null && localStorage.getItem(newK) == null) {
        localStorage.setItem(newK, v);
      }
      if (v != null) localStorage.removeItem(oldK);
    }
    // Flip legacy metric default to US Customary, but only for entries that
    // still match the literal old default — anyone who explicitly chose
    // metric will have other fields set too and we leave them alone if the
    // saved value already differs from 'metric'.
    const FLIP_FLAG = 'graticule.settings.units_default_flipped';
    if (!localStorage.getItem(FLIP_FLAG)) {
      const raw = localStorage.getItem('graticule.settings.v1');
      if (raw) {
        try {
          const obj = JSON.parse(raw);
          if (obj && obj.units === 'metric') {
            obj.units = 'us';
            localStorage.setItem('graticule.settings.v1', JSON.stringify(obj));
          }
        } catch {}
      }
      localStorage.setItem(FLIP_FLAG, '1');
    }
  } catch {}
})();

// User-tunable settings persisted in localStorage. Defaults reflect Don's
// preferences: nothing checked, US Customary units, globe view, 500 ms hover.
const SETTINGS_KEY = 'graticule.settings.v1';

// Anything stored before RENDER_EPOCH predates the globe re-grade. Those keys
// are visual defaults, not choices the user made deliberately, and leaving a
// stale copy in localStorage means an existing browser keeps rendering the
// washed-out planet no matter what ships. Drop just those keys and keep the
// rest of the user's settings intact.
//
// These must be declared ABOVE `settings` — loadSettings() runs inside its
// initializer, so a const declared below would still be in its temporal dead
// zone and throw before `let viewer` is ever reached.
const RENDER_EPOCH = 2;
const EPOCH_KEYS = ['hdr', 'atmosIntensity'];

const settings = Object.assign({
  units: 'us',
  view: 'globe',
  hoverDelayMs: 500,
  timeFormat: 'utc',                // 'utc' | 'local' | 'both'
  imageryBase: 'satellite',         // 'satellite' | 'streets' | 'topo' | 'night'
  dimBaseUnderData: true,           // mute the base while a field is drawn over it
  showGraticule: false,
  // ---- Realistic Earth (Wave 1) --------------------------------------------
  // Defaults ON: Don's brief is "I want the Earth completely realistic — real
  // time sun and moon, nighttime and daytime". A flat fully-lit globe was the
  // single biggest reason the app read as amateurish, so realism is no longer
  // an opt-in toggle buried in settings.
  sunLighting: true,                // real-time solar terminator shading
  nightLights: true,                // VIIRS Black Marble on the dark side only
  showMoon: true,                   // real-time lunar position + phase
  showStars: true,                  // celestial sphere
  hdr: false,                       // ACES tone curve; washes out terrain, see initRealisticEarth
  lensFlare: true,                  // sun glow when the star is in frame
  lockNorthAmerica: true,           // hold NA centred; let the sun sweep across
  atmosIntensity: 5,
  vignetteIntensity: 0.5,
  idleRotateSec: 0,                 // 0 = disabled (NA lock owns the camera)
  opCountries: 0.45,
  opStates: 0.30,
  opCities: 1.00,
  opRadar: 0.70,
  opClouds: 0.55,
  opAurora: 0.85,
  opParcels: 0.85,
  perfPreset: 'high',               // 'high' | 'balanced' | 'low'
  layerFadeMs: 350,
  diagnostics: false,
  ambientSound: false,
  soundAlerts: false,
  // ---- Area darkening ------------------------------------------------------
  areaDarkening: false,
  adOpacity: 0.6,                   // matches the reference app's default
  adFilterLabels: false,
  adCounties: [],                   // FIPS strings; drives a 2.8 MB lazy load
  presenting: false,                // broadcast framing; chrome hidden
  paneMode: 'single',               // 'single' | 'dual' | 'quad'
  paneProducts: ['live', 'satellite', 'warnings', 'model'],
  // ---- Broadcast graphics --------------------------------------------------
  // gfxModes holds only what the user changed. A mode that has never been
  // touched is not in here at all, so it keeps tracking whatever the built-in
  // look becomes; the moment a slider moves, that mode is theirs.
  gfxMode: 'Default',
  gfxModes: {},
  renderEpoch: 0,                   // bumped when visual defaults change
}, loadSettings());
function loadSettings() {
  let stored;
  try { stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'); }
  catch { return {}; }
  if ((stored.renderEpoch || 0) < RENDER_EPOCH) {
    for (const k of EPOCH_KEYS) delete stored[k];
    stored.renderEpoch = RENDER_EPOCH;
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(stored)); } catch {}
  }
  return stored;
}
function saveSettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch {}
}

// Camera home. Declared up here (not beside applyNorthAmericaLock) because
// initViewer's setView reads it during bootstrap, before the bottom of the
// module has evaluated.
// 14 Mm frames the planet at roughly 60% of viewport height. The old
// 22 Mm left it a small ball adrift in dead black.
const NA_HOME = { lon: -98.0, lat: 39.5, alt: 14_000_000 };

// The opening frame. A fixed altitude cannot compose: the rail takes 300px out
// of the width, so the same 14 Mm that framed the globe on a bare viewport left
// black margins on either side of it once the panel docked, and nothing on the
// screen was weather. A Rectangle destination makes Cesium solve for the
// altitude that fits the box in whatever viewport it is actually given, so the
// framing survives the rail, presentation mode and any window size.
// Box: the lower 48 plus enough Gulf, Atlantic and southern Canada to show a
// system approaching from any side.
/* One definition of "phone", shared with the stylesheet.
   Three places in this file asked `(max-width: 780px)` and the CSS asked
   `(max-width: 780px), (max-height: 500px)`, which meant a phone held sideways
   -- 915x412 -- got the mobile stylesheet while the JS still believed it was a
   desktop, so the boot frame, the graphic placement and the sheet all
   disagreed with the layout they were sitting in. Written once. */
const PHONE_MQ = '(max-width: 780px), (max-height: 500px)';
const isPhone = () => window.matchMedia(PHONE_MQ).matches;

const NA_FRAME = { west: -131, south: 20.5, east: -62, north: 53.5 };
/* CONUS is a landscape box, 69 degrees wide by 33 tall. Cesium solves for the
   altitude that fits the whole rectangle, so the CONSTRAINING dimension wins:
   in portrait that is the width, and the country spans the full width of the
   phone with extra latitude visible above and below. That is the right answer
   and needs no help.

   An earlier version of this padded the box out to the viewport's aspect,
   reasoning that a wide box in a tall frame would leave the country as a thin
   band. It does not, and the padding was catastrophic: at 412x915 the aspect
   is 0.45, so 69 degrees of longitude asked for 153 of latitude, clamped to
   the poles, and the phone booted looking at the entire planet from orbit.
   Measured, reverted. The lesson is the cheap one -- a fix for a problem
   nobody confirmed was real.

   On a phone the sheet covers the bottom ~96px at rest, so the frame is nudged
   south by half of that in degrees, which keeps the middle of the country in
   the middle of the VISIBLE map rather than behind the sheet. */
/* A portrait phone needs its own box, and this one was picked by rendering
   four candidates and looking at them rather than by reasoning about it.

   The desktop box asks Cesium to fit 69 degrees of longitude across 412px, and
   the altitude that takes -- 11,920 km, measured -- is far enough out that the
   vertical field of view runs past the horizon: the phone booted showing the
   whole planet against space, with the country a small patch in the middle.
   Pulling the box in to 36 x 22 degrees brings the camera to 6,478 km, which
   fills the screen edge to edge with the country readable and no space in
   frame. The tighter box does not lose the coasts, because the extra vertical
   room in a portrait viewport shows more longitude than the box asks for.

   Centred slightly east of the desktop frame: that is where the population and
   most of the convection is, and on a screen this size what you cannot fit
   should be the emptiest part of the map. */
const NA_FRAME_PHONE = { west: -112, south: 26, east: -76, north: 48 };

function naFrameDestination() {
  const phone = isPhone();
  let { west, south, east, north } = phone ? NA_FRAME_PHONE : NA_FRAME;

  // The sheet covers the bottom of the map at rest, so the frame is nudged
  // south by half of what it hides: that puts the middle of the country in the
  // middle of the VISIBLE map rather than behind the sheet.
  const el = document.getElementById('cesiumContainer');
  const h = el ? el.clientHeight : 0;
  if (phone && h > 0) {
    const shift = (north - south) * (96 / h) * 0.5;
    south -= shift;
    north -= shift;
  }
  return Cesium.Rectangle.fromDegrees(west, south, east, north);
}

let viewer;
const dataSources = {};
const entitiesByLayer = {};
const satelliteRecords = new Map();
let satelliteTickHandle = null;
let countdownTickHandle = null;
let radarLayer = null, auroraLayer = null, cloudsLayer = null;
let radarMeta = null, auroraMeta = null;
let countriesDS = null, statesDS = null, airspaceDS = null, citiesDS = null;
// Declared up here, not beside the water module at the bottom of the file.
// `let` at classic-script top level is script-scoped and stays in its temporal
// dead zone until its own line evaluates, so updateCategoryCounts reading them
// from a callback that fires early would throw rather than read null.
let riversDS = null, tidesDS = null, buoysDS = null;
// Broadcast-graphics state, hoisted here for the same reason. See the GRAPHICS
// section at the bottom of this file for what each field is for.
const GFX = {
  root: null,
  els: {},                 // key -> the graphic's outer element
  stamp: null,             // { kind, src, when } pushed by the radar timeline
  tick: null,
  warnTimer: null,
  dismissed: new Set(),    // alert ids the operator closed on air
  ready: false,            // gate: this module's consts evaluate at EOF
};
let countriesBuilt = false, statesBuilt = false, airspaceBuilt = false, citiesBuilt = false;
/* Raw feed rows per layer, id -> data, kept whether or not the layer is drawn.
   This is the store the scene is BUILT FROM, not a cache of it.

   Before it existed, every snapshot built a Cesium Entity for every row of
   every layer the moment the socket delivered it. Measured at boot with
   nothing switched on: 8,974 entities -- 5,272 airports, 1,352 satellites,
   1,196 volcanoes, 771 quakes -- all with show=false, costing 4.1 seconds of
   blocked main thread before the user had touched anything, plus a permanent
   place in every scene-graph traversal for as long as the tab was open.

   Entities are now built when a layer is switched on and thrown away when it
   is switched off; the counts and the alerts panel read this instead. */
const layerData = {};
const feedActivity = {};   // layer -> last update timestamp (ms)
const recentEvents = [];   // ticker entries (newest first)
const TICKER_MAX = 6;

// ---------- Installable ------------------------------------------------------
//
// Registered after load, not during it. A worker registration competes with the
// first paint for the same main thread, and on the boot this app already has --
// Cesium, terrain, four feeds -- that is the wrong thing to be doing at second
// zero. Nothing on screen depends on it, so it can wait for a quiet moment.
//
// Deliberately quiet on failure. A service worker is unavailable over plain
// HTTP on a non-localhost origin, in a private window, and behind some
// enterprise policies. None of those is an error the operator can act on, and
// the app works without it.
function initServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' })
      .then((reg) => {
        // A new worker takes over on the next navigation, which for an app
        // nobody reloads means never. Tell the operator instead of swapping
        // the code out from under a radar loop they are watching.
        reg.addEventListener('updatefound', () => {
          const w = reg.installing;
          if (!w) return;
          w.addEventListener('statechange', () => {
            if (w.state === 'installed' && navigator.serviceWorker.controller) {
              pushEvent('UPDATE', 'A new version is ready — reload to use it',
                        Date.now());
            }
          });
        });
      })
      .catch(() => { /* see above: not actionable */ });
  });
}

// ---------- Bootstrap --------------------------------------------------------

(async function main() {
  initServiceWorker();
  await initViewer();
  initDataSources();
  initFeedChips();
  await applyServerCapabilities();
  bindUI();
  initTabs();
  initTimeline();
  initWeatherControls();
  initDrawing();
  initMapTheme();
  initViewResampling();
  initSkyMirrors();
  initWorldPane();
  initWorldDash();
  initModelCompare();
  initModelHour();
  initAreaDarkening();
  initPresentation();
  initPanes();
  initGraphics();
  initScenes();
  initDynamicLod();
  initWeatherfrontShell();
  applyInitialLayerState();
  refreshLegend();
  syncControlAvailability();
  initContextMenu();
  renderPresetsList();
  startClocks();
  connectWebSocket();
})();

// Cesium CustomDataSource.show defaults to true regardless of checkbox state,
// so an unchecked layer would still render at boot. Walk every data-layer
// checkbox and force the matching dataSource / overlay to its declared state.
function applyInitialLayerState() {
  // Anything marked data-defer is attached after the first frames rather than
  // during them. The reference lines are 320k coordinates that Cesium compiles
  // into ground-clamped primitives; measured on SwiftShader that is a single
  // ~3.8 s stall, and taking it while the map is already up and drawing radar
  // is a different experience from taking it against a blank screen.
  const deferred = [];
  document.querySelectorAll('input[data-layer]').forEach((cb) => {
    if (cb.disabled) return;
    if (cb.dataset.defer !== undefined && cb.checked) { deferred.push(cb); return; }
    cb.dispatchEvent(new Event('change'));
  });
  if (deferred.length) {
    setTimeout(() => deferred.forEach((cb) => cb.dispatchEvent(new Event('change'))), 1200);
  }
  // Also align the terminator (its DS exists from initTerminator)
  const term = document.querySelector('input[data-layer="terminator"]');
  if (term && terminatorDS) terminatorDS.show = !!term.checked;
}

async function initViewer() {
  const cfg = await fetch('/api/config').then(r => r.json()).catch(() => ({}));
  Cesium.Ion.defaultAccessToken = cfg.cesium_ion_token || '';
  window.__graticule_cfg = cfg;

  viewer = new Cesium.Viewer('cesiumContainer', {
    baseLayerPicker: false,

    // Cesium's default base layer is Ion asset 2, requested from the
    // constructor before initMapTheme() ever runs. With no Ion token that is a
    // guaranteed 401 on every boot -- api.cesium.com/v1/assets/2/endpoint with
    // an empty access_token -- and a console error for a layer we then throw
    // away and replace. `false` means the viewer starts with no imagery at all
    // and initMapTheme() installs the real base, which is what was happening
    // anyway, minus the failed round trip.
    baseLayer: false,

    geocoder: false, homeButton: false, sceneModePicker: false,
    timeline: false, animation: false, fullscreenButton: false,
    navigationHelpButton: false, selectionIndicator: false, infoBox: false,
    creditContainer: document.createElement('div'),

    // Multi-pane snapshots read pixels back off this canvas with drawImage,
    // and they have to wait for the pane's imagery tiles to load first. That
    // wait crosses a task boundary, and the browser clears an unpreserved
    // drawing buffer at composite time, so without this every secondary pane
    // captures a blank frame.
    contextOptions: { webgl: { preserveDrawingBuffer: true } },

    // Explicit-render mode. Cesium's default is to redraw at display refresh
    // forever, even on a globe nobody is touching — that is a full GPU
    // rasterisation of the Earth 60 times a second to produce an identical
    // frame. The codebase was already written for this: ~20 requestRender()
    // calls sit in the layer, timeline and camera paths, they were just never
    // switched on, so every one of them was a no-op.
    //
    // Cesium re-renders on its own for camera motion, input, tile loads and
    // entity changes. maximumRenderTimeChange covers the one thing it cannot
    // infer: our clock runs in real time to drive the sun, so the scene must
    // still redraw as the terminator advances. 0.5s is well under the point
    // where terminator movement is visible and still cuts idle work by ~97%.
    requestRenderMode: true,
    maximumRenderTimeChange: 0.5,
  });

  // Test-only handle so Playwright (and the dev console) can drive the camera
  // and inspect data sources during self-test without re-plumbing the closure.
  window.__graticule_viewer = viewer;

  viewer.imageryLayers.removeAll();
  // Imagery base is settings-driven now (Satellite / Streets / Topo / Night).
  // applyImageryBase honors settings.imageryBase, falls back to satellite, and
  // tracks the layer so the picker can swap it later.
  await applyImageryBase(settings.imageryBase || 'satellite');
  // Level of detail. Owned by applyPerfPreset, which is called during bindUI
  // once the stored preset is known. The line that used to sit here set
  // `viewer.scene.maximumScreenSpaceError`, which Cesium does not define, and
  // its comment described over-zoom past native imagery level -- a different
  // mechanism entirely (that one is the provider's maximumLevel).
  viewer.scene.globe.maximumScreenSpaceError = SSE_PRESET.high;

  viewer.scene.backgroundColor = Cesium.Color.BLACK;

  // ---- Real-time celestial clock ------------------------------------------
  // The whole "sunlight rotating in real time" behaviour hangs off this. Cesium
  // defaults to a frozen clock, which is why the globe used to sit evenly lit:
  // with no time advancing, the sun vector never moved. SYSTEM_CLOCK slaves the
  // scene to the wall clock, so the terminator sweeps westward on its own and
  // matches real UTC to the second.
  viewer.clock.clockStep     = Cesium.ClockStep.SYSTEM_CLOCK;
  viewer.clock.shouldAnimate = true;
  viewer.clock.currentTime   = Cesium.JulianDate.now();

  initRealisticEarth();

  // 3D buildings — OSM Buildings (Cesium ion) and Google Photorealistic 3D Tiles
  // are both gated on user-supplied free keys. They auto-attach when present.
  await maybeAttachOsmBuildings(cfg);
  await maybeAttachGoogle3DTiles(cfg);

  viewer.camera.setView({ destination: naFrameDestination() });
  // Allow the camera to descend into the surface band where 3D buildings live
  viewer.scene.screenSpaceCameraController.minimumZoomDistance = 50;

  // Click → panel + ripple + history push
  const click = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
  click.setInputAction((c) => {
    const picked = viewer.scene.pick(c.position);
    if (Cesium.defined(picked) && picked.id) {
      showPanel(picked.id);
      pushHistory(picked.id);
    } else if (CMP.mode !== 'single') {
      // Empty globe click while a comparison mode is armed: read the ground
      // point and pull the run or model spread there.
      const ray = viewer.camera.getPickRay(c.position);
      const cart = ray && viewer.scene.globe.pick(ray, viewer.scene);
      if (cart) {
        const carto = Cesium.Cartographic.fromCartesian(cart);
        compareAtPoint(Cesium.Math.toDegrees(carto.latitude),
                       Cesium.Math.toDegrees(carto.longitude));
      }
    }
    spawnClickRipple(c.position);
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

  // Right-click → context menu (Center camera here / Save preset)
  click.setInputAction((c) => {
    const ray = viewer.camera.getPickRay(c.position);
    if (!ray) return;
    const cart = viewer.scene.globe.pick(ray, viewer.scene);
    if (!cart) return;
    const carto = Cesium.Cartographic.fromCartesian(cart);
    const lat = Cesium.Math.toDegrees(carto.latitude);
    const lon = Cesium.Math.toDegrees(carto.longitude);
    showContextMenu(c.position.x, c.position.y, { lat, lon });
  }, Cesium.ScreenSpaceEventType.RIGHT_CLICK);

  // Camera changed → drive compass rose + tilt indicator. camera.changed
  // fires only when the camera actually moves (configurable threshold), not
  // every frame, so this is cheap.
  viewer.camera.percentageChanged = 0.001;  // very sensitive
  viewer.camera.changed.addEventListener(updateCompass);
  // Initial draw
  updateCompass();

  // Mouse move → cursor lat/lon readout + hover tooltip + vignette parallax
  const move = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
  let parallaxRaf = 0, parallaxX = 0, parallaxY = 0;
  move.setInputAction((m) => {
    // Vignette parallax — store latest pos, schedule one DOM write per frame.
    const cv = viewer.scene.canvas;
    parallaxX = ((m.endPosition.x / cv.clientWidth)  * 2 - 1);
    parallaxY = ((m.endPosition.y / cv.clientHeight) * 2 - 1);
    if (!parallaxRaf) {
      parallaxRaf = requestAnimationFrame(() => {
        parallaxRaf = 0;
        document.documentElement.style.setProperty('--vx', parallaxX.toFixed(3));
        document.documentElement.style.setProperty('--vy', parallaxY.toFixed(3));
      });
    }

    const ray = viewer.camera.getPickRay(m.endPosition);
    const el = document.getElementById('tm-cursor');
    if (ray) {
      const cart = viewer.scene.globe.pick(ray, viewer.scene);
      if (cart) {
        const c = Cesium.Cartographic.fromCartesian(cart);
        const lat = Cesium.Math.toDegrees(c.latitude).toFixed(2);
        const lon = Cesium.Math.toDegrees(c.longitude).toFixed(2);
        el.textContent = `${lat.padStart(6)}  ${lon.padStart(7)}`;
      } else { el.textContent = '—'; }
    }

    // Hover tooltip pick — debounced by config.hoverDelayMs (default 500 ms).
    // We restart the timer on every move; only when the cursor lingers on the
    // same entity for the full delay does the tooltip appear.
    const picked = viewer.scene.pick(m.endPosition);
    const target = (Cesium.defined(picked) && picked.id && picked.id.properties) ? picked.id : null;
    scheduleHoverTip(target, m.endPosition);
  }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
}

function initDataSources() {
  for (const layer of ['planes','ships','satellites','airports','tfrs','quakes','volcanoes','fires','hurricanes','tsunamis','severe','launches','news']) {
    const ds = new Cesium.CustomDataSource(layer);
    viewer.dataSources.add(ds);
    dataSources[layer] = ds;
    entitiesByLayer[layer] = new Map();
  }
  // Cables — separate static-overlay data source for polylines
  cablesDS = new Cesium.CustomDataSource('cables');
  viewer.dataSources.add(cablesDS);
  cablesDS.show = false;
  // Boundaries — static, lazily populated on first toggle
  countriesDS = new Cesium.CustomDataSource('countries');
  viewer.dataSources.add(countriesDS); countriesDS.show = false;
  statesDS = new Cesium.CustomDataSource('states');
  viewer.dataSources.add(statesDS); statesDS.show = false;
  airspaceDS = new Cesium.CustomDataSource('airspace');
  viewer.dataSources.add(airspaceDS); airspaceDS.show = false;
  citiesDS = new Cesium.CustomDataSource('cities');
  viewer.dataSources.add(citiesDS); citiesDS.show = false;
  // Subsolar / terminator marker
  terminatorDS = new Cesium.CustomDataSource('terminator');
  viewer.dataSources.add(terminatorDS);
  initTerminator();

  // Cluster crowded layers so the world view renders one dot per cluster, then
  // breaks apart as the camera zooms in. Non-clustered layers (hurricanes,
  // launches, tsunamis, severe, news, volcanoes, tfrs) are sparse enough that
  // clustering hurts more than it helps.
  configureClustering(dataSources.planes,     { color: COLORS.planes,     pixelRange: 50, minSize: 4 });
  configureClustering(dataSources.ships,      { color: COLORS.ships,      pixelRange: 50, minSize: 4 });
  configureClustering(dataSources.fires,      { color: COLORS.fires,      pixelRange: 60, minSize: 5 });
  configureClustering(dataSources.airports,   { color: COLORS.airports,   pixelRange: 70, minSize: 4 });
  configureClustering(dataSources.satellites, { color: COLORS.satellites, pixelRange: 45, minSize: 6 });
  configureClustering(dataSources.quakes,     { color: COLORS.quakes,     pixelRange: 40, minSize: 4 });
}

// ---------- LOD / clustering helpers ----------------------------------------
//
// Three-tier policy (see HANDOFF):
//   FAR   (alt > ~5 Mm)     — only highest-priority items + clusters
//   MID   (alt 100 km–5 Mm) — most items, some clustering
//   NEAR  (alt < ~10 km)    — moving things only; stationary background fades
//                              out so parcels/buildings can take over.
//
// Cesium's DistanceDisplayCondition is camera-to-entity distance in metres,
// which approximates altitude near nadir. We use it for both the FAR cap
// (low-importance items hidden when distance > X) and the NEAR floor
// (stationary items hidden when distance < STATIONARY_HIDE_NEAR_M).

const STATIONARY_HIDE_NEAR_M = 10_000;       // 10 km — stationary background fades out
const ALWAYS_VISIBLE_FAR_M   = 5e7;          // 50 000 km — effectively always

function ddcQuake(mag) {
  const m = (typeof mag === 'number') ? mag : 0;
  if (m >= 5)   return new Cesium.DistanceDisplayCondition(0, ALWAYS_VISIBLE_FAR_M);
  if (m >= 4)   return new Cesium.DistanceDisplayCondition(0, 1.5e7);  // 15 Mm
  if (m >= 3)   return new Cesium.DistanceDisplayCondition(0, 5e6);    // 5 Mm
  if (m >= 2)   return new Cesium.DistanceDisplayCondition(0, 1.5e6);  // 1.5 Mm
  return        new Cesium.DistanceDisplayCondition(0, 5e5);            // 500 km
}

function ddcFire(frp) {
  const f = (typeof frp === 'number') ? frp : 0;
  if (f >= 100) return new Cesium.DistanceDisplayCondition(0, 1.5e7);
  if (f >= 30)  return new Cesium.DistanceDisplayCondition(0, 5e6);
  if (f >= 10)  return new Cesium.DistanceDisplayCondition(0, 1.5e6);
  return        new Cesium.DistanceDisplayCondition(0, 5e5);
}

function ddcAirport(type) {
  // Stationary — hide near zoom so parcels/buildings own the close view.
  if (type === 'large_airport')  return new Cesium.DistanceDisplayCondition(STATIONARY_HIDE_NEAR_M, ALWAYS_VISIBLE_FAR_M);
  if (type === 'medium_airport') return new Cesium.DistanceDisplayCondition(STATIONARY_HIDE_NEAR_M, 5e6);
  return                              new Cesium.DistanceDisplayCondition(STATIONARY_HIDE_NEAR_M, 1.5e6);
}

function ddcVolcano(active) {
  if (active) return new Cesium.DistanceDisplayCondition(STATIONARY_HIDE_NEAR_M, ALWAYS_VISIBLE_FAR_M);
  return       new Cesium.DistanceDisplayCondition(STATIONARY_HIDE_NEAR_M, 5e6);
}

function ddcStationaryAlways() {
  return new Cesium.DistanceDisplayCondition(STATIONARY_HIDE_NEAR_M, ALWAYS_VISIBLE_FAR_M);
}

function applyDDC(g, ddc) {
  if (!g || !ddc) return g;
  if (g.point)    g.point.distanceDisplayCondition    = ddc;
  if (g.label)    g.label.distanceDisplayCondition    = ddc;
  if (g.ellipse)  g.ellipse.distanceDisplayCondition  = ddc;
  if (g.polyline) g.polyline.distanceDisplayCondition = ddc;
  // Scale point graphics 1.0× at distance, up to 1.7× when very close,
  // so hover targets are easier to hit at street zoom.
  if (g.point && !g.point.scaleByDistance) {
    g.point.scaleByDistance = new Cesium.NearFarScalar(5_000, 1.7, 1_500_000, 1.0);
  }
  return g;
}

function configureClustering(ds, opts) {
  if (!ds || !ds.clustering) return;
  const c = ds.clustering;
  c.enabled = true;
  c.pixelRange = opts.pixelRange ?? 60;
  c.minimumClusterSize = opts.minSize ?? 4;
  // Accept either a Cesium.Color (as COLORS.* supplies) or a CSS string.
  // Passing a raw string used to throw "baseColor.withAlpha is not a function"
  // from inside the cluster event, which Cesium surfaces as a render error and
  // then stops rendering entirely.
  const baseColor = typeof opts.color === 'string'
    ? Cesium.Color.fromCssColorString(opts.color)
    : (opts.color || Cesium.Color.WHITE);
  c.clusterEvent.addEventListener((entities, cluster) => {
    cluster.billboard.show = false;
    cluster.point.show = true;
    cluster.point.pixelSize    = Math.min(22, 6 + Math.log2(entities.length) * 1.8);
    cluster.point.color        = baseColor.withAlpha(0.95);
    cluster.point.outlineColor = Cesium.Color.BLACK;
    cluster.point.outlineWidth = 0.6;
    cluster.label.show         = entities.length >= 8;
    cluster.label.text         = entities.length.toLocaleString();
    cluster.label.font         = '10px JetBrains Mono, monospace';
    cluster.label.fillColor    = Cesium.Color.WHITE;
    cluster.label.outlineColor = Cesium.Color.BLACK;
    cluster.label.outlineWidth = 2;
    cluster.label.style        = Cesium.LabelStyle.FILL_AND_OUTLINE;
    cluster.label.pixelOffset  = new Cesium.Cartesian2(0, 0);
  });
}

let cablesDS = null;
let cablesGeoJson = null;
let cablesBuilt = false;
let terminatorDS = null;
let sunEntity = null;
let terminatorEntity = null;
let nightLightsLayer = null;

function initFeedChips() {
  const host = document.getElementById('feedstrip-chips');
  host.innerHTML = '';
  for (const f of FEEDS) {
    if (f.hideFromChips) continue;
    const el = document.createElement('div');
    el.className = 'chip';
    el.dataset.feed = f.id;
    el.dataset.state = 'off';
    el.innerHTML = `<span class="chip-dot"></span>${f.label}`;
    host.appendChild(el);
  }

  // Collapsed by default. Fourteen chips reading ADS-B / TLE / LL2 / EONET /
  // SWPC is an operator's debug view, not something a user should have to
  // parse before they can look at the weather. The health summary stays
  // visible; the breakdown is one click away.
  const strip = document.getElementById('feedstrip');
  const head  = strip?.querySelector('.strip-head');
  if (!strip || !head) return;
  strip.classList.add('is-collapsed');
  head.setAttribute('role', 'button');
  head.setAttribute('tabindex', '0');
  head.setAttribute('aria-expanded', 'false');
  const toggle = () => {
    const open = strip.classList.toggle('is-collapsed') === false;
    head.setAttribute('aria-expanded', String(open));
  };
  head.addEventListener('click', toggle);
  // A MOVING SHEET MUST NOT HAND YOUR TAP TO WHATEVER SLID UNDER IT.
  //
  // A touch fires touchstart/touchend and then, milliseconds later, the browser
  // synthesises mousedown/mouseup/click at the same SCREEN coordinates for
  // pages written before touch existed. By the time that click is dispatched
  // the sheet has moved, so the point that was the drag handle is now over a
  // layer row. Traced with a spy on sheetGo: one tap logged `2` at t=36627 and
  // `1` at t=36634 from the change listener -- the phantom click had landed on
  // a switch, toggled a layer, and the sheet collapsed in response to a change
  // the operator never made. Tapping the handle was silently turning layers on,
  // which is far worse than the detent bug that led me to it.
  //
  // preventDefault on touchend was the obvious answer and it did not work: the
  // click still arrived. So this does not try to out-argue the platform about
  // which synthetic events it owes whom. It swallows clicks inside the sheet
  // for 350ms after the geometry changes, in the capture phase, before anything
  // downstream can act on them. A click aimed at coordinates that no longer
  // mean what the user thought is not a click worth delivering.
  document.getElementById('hud')?.addEventListener('click', (e) => {
    if (!sheetIsPhone()) return;
    if (performance.now() > (SHEET.guardUntil || 0)) return;
    if (e.target.closest('#rail-head')) return;      // the handle itself is fine
    e.preventDefault();
    e.stopPropagation();
  }, true);

  head.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
  });
}

async function applyServerCapabilities() {
  const cfg = window.__graticule_cfg || {};
  if (!cfg.ships_enabled) disableLayer('ships', 'no AISSTREAM_KEY');
  if (!cfg.fires_enabled) disableLayer('fires', 'no FIRMS_MAP_KEY');
}

function disableLayer(layer, reason) {
  const cb = document.querySelector(`input[data-layer="${layer}"]`);
  if (!cb) return;
  cb.checked = false;
  cb.disabled = true;
  cb.title = reason;
  const c = document.getElementById(`count-${layer}`); if (c) c.textContent = '—';
  if (dataSources[layer]) dataSources[layer].show = false;
}

// ---------- Layer fade helpers ----------------------------------------------
//
// Layers reveal and dismiss with a brief alpha fade (LAYER_FADE_MS) instead of
// snapping. For entity-based dataSources we walk entities once at fade start,
// capture their baseline color/material/label values, then lerp alpha each
// rAF tick. Imagery layers fade via ImageryLayer.alpha; 3D tilesets via a
// Cesium3DTileStyle color('white', a). When fading out, dataSource.show
// flips to false at the end so picks/clusters stop firing on invisible items.

// Reads from settings each call so the slider takes effect immediately.
const LAYER_FADE_MS_DEFAULT = 350;
function _layerFadeMs() {
  const v = Number(settings.layerFadeMs);
  return Number.isFinite(v) && v >= 0 ? v : LAYER_FADE_MS_DEFAULT;
}
const LAYER_FADE_MS = LAYER_FADE_MS_DEFAULT;  // legacy export, still used in some places
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

function fadeDataSource(ds, dir = 'in', durationMs = _layerFadeMs(), onDone) {
  if (!ds) { onDone?.(); return; }
  // Cancel any in-flight fade on this source so rapid toggles don't fight.
  if (ds._fadeAbort) ds._fadeAbort();
  // Empty source — flip show directly, skip the rAF loop.
  if (!ds.entities.values.length) {
    ds.show = (dir === 'in');
    onDone?.();
    return;
  }
  if (dir === 'in') ds.show = true;
  const entities = Array.from(ds.entities.values);
  const baseline = entities.map(captureEntityColors);
  let aborted = false;
  ds._fadeAbort = () => {
    aborted = true;
    for (let i = 0; i < entities.length; i++) restoreEntity(entities[i], baseline[i]);
    ds._fadeAbort = null;
  };
  const t0 = performance.now();
  function step(now) {
    if (aborted) return;
    const t = Math.min(1, (now - t0) / durationMs);
    const eased = easeOutCubic(t);
    const mul = (dir === 'in') ? eased : (1 - eased);
    for (let i = 0; i < entities.length; i++) {
      applyAlphaMul(entities[i], baseline[i], mul);
    }
    viewer.scene.requestRender();
    if (t < 1) requestAnimationFrame(step);
    else {
      for (let i = 0; i < entities.length; i++) restoreEntity(entities[i], baseline[i]);
      ds._fadeAbort = null;
      if (dir === 'out') ds.show = false;
      viewer.scene.requestRender();
      onDone?.();
    }
  }
  requestAnimationFrame(step);
}

function captureEntityColors(e) {
  const t = viewer.clock.currentTime;
  const cap = {};
  const get = (prop) => prop?.getValue ? prop.getValue(t) : null;
  if (e.billboard?.color)  { const v = get(e.billboard.color);  if (v) cap.billboard = v.clone(); }
  if (e.point?.color)      { const v = get(e.point.color);      if (v) cap.point     = v.clone(); }
  if (e.polyline?.material instanceof Cesium.ColorMaterialProperty) {
    const v = get(e.polyline.material.color); if (v) cap.polylineColor = v.clone();
  }
  if (e.polyline?.material instanceof Cesium.PolylineDashMaterialProperty) {
    const v = get(e.polyline.material.color); if (v) cap.polylineDashColor = v.clone();
    cap.polylineDashLength = e.polyline.material.dashLength?.getValue?.(t) ?? 16;
  }
  if (e.polygon?.material instanceof Cesium.ColorMaterialProperty) {
    const v = get(e.polygon.material.color); if (v) cap.polygonColor = v.clone();
  }
  if (e.polygon?.outlineColor) { const v = get(e.polygon.outlineColor); if (v) cap.polygonOutline = v.clone(); }
  if (e.label?.fillColor)      { const v = get(e.label.fillColor);      if (v) cap.labelFill    = v.clone(); }
  if (e.label?.outlineColor)   { const v = get(e.label.outlineColor);   if (v) cap.labelOutline = v.clone(); }
  return cap;
}

function applyAlphaMul(e, b, mul) {
  if (b.billboard && e.billboard) e.billboard.color = b.billboard.withAlpha(b.billboard.alpha * mul);
  if (b.point && e.point)         e.point.color     = b.point.withAlpha(b.point.alpha * mul);
  if (b.polylineColor && e.polyline) {
    e.polyline.material = new Cesium.ColorMaterialProperty(b.polylineColor.withAlpha(b.polylineColor.alpha * mul));
  }
  if (b.polylineDashColor && e.polyline) {
    e.polyline.material = new Cesium.PolylineDashMaterialProperty({
      color: b.polylineDashColor.withAlpha(b.polylineDashColor.alpha * mul),
      dashLength: b.polylineDashLength,
    });
  }
  if (b.polygonColor && e.polygon) {
    e.polygon.material = new Cesium.ColorMaterialProperty(b.polygonColor.withAlpha(b.polygonColor.alpha * mul));
  }
  if (b.polygonOutline && e.polygon) e.polygon.outlineColor = b.polygonOutline.withAlpha(b.polygonOutline.alpha * mul);
  if (b.labelFill && e.label)        e.label.fillColor      = b.labelFill.withAlpha(b.labelFill.alpha * mul);
  if (b.labelOutline && e.label)     e.label.outlineColor   = b.labelOutline.withAlpha(b.labelOutline.alpha * mul);
}

function restoreEntity(e, b) {
  if (b.billboard && e.billboard) e.billboard.color = b.billboard;
  if (b.point && e.point)         e.point.color     = b.point;
  if (b.polylineColor && e.polyline) e.polyline.material = new Cesium.ColorMaterialProperty(b.polylineColor);
  if (b.polylineDashColor && e.polyline) {
    e.polyline.material = new Cesium.PolylineDashMaterialProperty({ color: b.polylineDashColor, dashLength: b.polylineDashLength });
  }
  if (b.polygonColor && e.polygon) e.polygon.material = new Cesium.ColorMaterialProperty(b.polygonColor);
  if (b.polygonOutline && e.polygon) e.polygon.outlineColor = b.polygonOutline;
  if (b.labelFill && e.label)        e.label.fillColor      = b.labelFill;
  if (b.labelOutline && e.label)     e.label.outlineColor   = b.labelOutline;
}

function fadeImageryLayer(layer, fromA, toA, durationMs = _layerFadeMs(), onDone) {
  if (!layer) { onDone?.(); return; }
  const t0 = performance.now();
  layer.alpha = fromA;
  layer.show = true;
  function step(now) {
    const t = Math.min(1, (now - t0) / durationMs);
    layer.alpha = fromA + (toA - fromA) * easeOutCubic(t);
    viewer.scene.requestRender();
    if (t < 1) requestAnimationFrame(step);
    else {
      if (toA <= 0) layer.show = false;
      viewer.scene.requestRender();
      onDone?.();
    }
  }
  requestAnimationFrame(step);
}

function fadeTileset(tileset, fromA, toA, durationMs = _layerFadeMs(), onDone) {
  if (!tileset) { onDone?.(); return; }
  if (toA > 0) tileset.show = true;
  const t0 = performance.now();
  function step(now) {
    const t = Math.min(1, (now - t0) / durationMs);
    const a = fromA + (toA - fromA) * easeOutCubic(t);
    tileset.style = new Cesium.Cesium3DTileStyle({ color: `color('white', ${a})` });
    viewer.scene.requestRender();
    if (t < 1) requestAnimationFrame(step);
    else {
      if (toA <= 0) tileset.show = false;
      onDone?.();
    }
  }
  requestAnimationFrame(step);
}

function bindUI() {
  document.querySelectorAll('input[data-layer]').forEach((cb) => {
    cb.addEventListener('change', () => {
      const layer = cb.dataset.layer;
      const on = cb.checked;
      if (layer === 'radar')           toggleRadar(on);
      else if (layer === 'clouds')     toggleClouds(on);
      else if (layer === 'aurora')     toggleAurora(on);
      else if (layer === 'buildings')  toggleBuildings(on);
      else if (layer === 'photoreal3d')togglePhotoreal3D(on);
      else if (layer === 'cables')     toggleCables(on);
      else if (layer === 'nightlights')toggleNightLights(on);
      else if (layer === 'radar_site') toggleRadarSite(on);
      else if (layer === 'spc_outlook')toggleSpcOutlook(on);
      else if (layer === 'model')      toggleModelField(on);
      else if (layer === 'airquality') toggleAirQuality(on);
      else if (layer === 'metar')      toggleMetar(on);
      else if (layer === 'warnings')   toggleWarnings(on);
      else if (layer === 'lsr')        toggleLsr(on);
      else if (layer === 'cameras')    toggleCameras(on);
      else if (layer === 'spotters')   toggleSpotters(on);
      else if (layer === 'rivers')     toggleRivers(on);
      else if (layer === 'tides')      toggleTides(on);
      else if (layer === 'buoys')      toggleBuoys(on);
      else if (layer === 'terminator') toggleTerminator(on);
      else if (layer === 'parcels_us') toggleParcelsUS(on);
      else if (layer === 'parcels_wa') toggleParcelsWA(on);
      else if (layer === 'countries')  toggleCountries(on);
      else if (layer === 'states')     toggleStates(on);
      else if (layer === 'cities')     toggleCities(on);
      else if (layer === 'airspace')   toggleAirspace(on);
      else if (dataSources[layer]) {
        // Build on the way in, release on the way out. The fade still runs on
        // the data source either way, so the layer appears and leaves the same
        // as it always did; what changed is that nothing exists in between.
        if (on) {
          if (layer === 'satellites') {
            if (!satelliteRecords.size && layerData.satellites) {
              rebuildSatellites(layerData.satellites);
              setCount('satellites', satelliteRecords.size);
            }
          } else {
            materialiseLayer(layer);
          }
        }
        // Release AFTER the fade, through its completion callback. Tearing the
        // entities down straight away would make every layer snap off instead
        // of fading, which is the animation this call exists to run.
        fadeDataSource(dataSources[layer], on ? 'in' : 'out', undefined, on ? undefined : () => {
          // Re-check: a fast off/on leaves the second toggle's build in place,
          // and this callback must not delete it.
          if (isLayerOn(layer)) return;
          if (layer === 'satellites') releaseSatellites();
          else dematerialiseLayer(layer);
          updateCategoryCounts();
        });
      }
      updateCategoryCounts();
      refreshLegend();
      syncControlAvailability();
    });
  });
  document.getElementById('panel-close').addEventListener('click', hidePanel);

  // Alerts panel — filter toggles only (no drag/collapse anymore)
  document.querySelectorAll('input[data-alert]').forEach((cb) => {
    cb.addEventListener('change', refreshAlerts);
  });

  // Monitoring window toggles — header buttons
  document.querySelectorAll('button.hdr-toggle[data-monitor]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const on = btn.getAttribute('aria-pressed') !== 'true';
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      applyMonitor(btn.dataset.monitor, on);
    });
  });

  initSettings();
}

// ---------- Hover tooltip ---------------------------------------------------

let hoverTimer = null;
let hoverEntityId = null;
let hoverLastPos = null;

function scheduleHoverTip(entity, screenPos) {
  // Track the last cursor position so we can place the tip under wherever the
  // cursor lands when the timer fires.
  hoverLastPos = screenPos;

  if (!entity) {
    if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null; }
    hoverEntityId = null;
    hideHoverTip();
    return;
  }
  // Same entity as before? Keep the timer running but update the position
  // (the user is still hovering over the same dot).
  if (hoverEntityId === entity.id) return;

  // New entity — restart the dwell timer.
  hoverEntityId = entity.id;
  if (hoverTimer) clearTimeout(hoverTimer);
  hideHoverTip();
  const delay = Math.max(0, settings.hoverDelayMs | 0);
  hoverTimer = setTimeout(() => {
    hoverTimer = null;
    if (hoverEntityId !== entity.id || !hoverLastPos) return;
    showHoverTip(entity, hoverLastPos);
  }, delay);
}

// Hover-scale state — we restore the entity's original pixelSize on leave.
let hoverScaledEntity = null;
let hoverScaledOrig = null;

function applyHoverScale(entity) {
  // Restore previous if any
  if (hoverScaledEntity && hoverScaledEntity !== entity && hoverScaledOrig != null) {
    if (hoverScaledEntity.point) hoverScaledEntity.point.pixelSize = hoverScaledOrig;
  }
  hoverScaledEntity = null;
  hoverScaledOrig = null;
  if (!entity || !entity.point) return;
  const cur = entity.point.pixelSize;
  const v = (cur && cur.getValue) ? cur.getValue() : cur;
  if (typeof v !== 'number') return;
  hoverScaledOrig = v;
  hoverScaledEntity = entity;
  entity.point.pixelSize = Math.min(20, v * 1.7);
}

function clearHoverScale() {
  if (hoverScaledEntity && hoverScaledOrig != null && hoverScaledEntity.point) {
    hoverScaledEntity.point.pixelSize = hoverScaledOrig;
  }
  hoverScaledEntity = null;
  hoverScaledOrig = null;
}

function showHoverTip(entity, screenPos) {
  const props = entity.properties.getValue ? entity.properties.getValue() : entity.properties;
  if (!props || !props.kind) { hideHoverTip(); return; }
  applyHoverScale(entity);
  const tip = document.getElementById('hover-tip');
  const summary = summarizeEntity(props);
  document.getElementById('ht-kind').textContent  = KIND_LABEL[props.kind] || (props.kind || '').toUpperCase();
  document.getElementById('ht-title').textContent = summary.title || '—';
  document.getElementById('ht-sub').textContent   = summary.subtitle || '';
  document.getElementById('ht-meta').textContent  = summary.meta || '';
  document.getElementById('ht-sub').style.display  = summary.subtitle ? '' : 'none';
  document.getElementById('ht-meta').style.display = summary.meta     ? '' : 'none';

  // Position near cursor; clamp to viewport
  const pad = 14;
  let x = screenPos.x + pad;
  let y = screenPos.y + pad;
  const w = tip.offsetWidth || 220;
  const h = tip.offsetHeight || 60;
  if (x + w + 8 > window.innerWidth)  x = screenPos.x - w - pad;
  if (y + h + 8 > window.innerHeight) y = screenPos.y - h - pad;
  if (x < 4) x = 4;
  if (y < 4) y = 4;
  tip.style.left = `${x}px`;
  tip.style.top  = `${y}px`;
  tip.classList.remove('hidden');
}

function hideHoverTip() {
  const tip = document.getElementById('hover-tip');
  if (tip && !tip.classList.contains('hidden')) tip.classList.add('hidden');
  clearHoverScale();
}

function summarizeEntity(p) {
  const k = p.kind;
  if (k === 'metar') {
    const us = settings.units === 'us';
    const t = p.temp == null ? null : (us ? cToF(p.temp) : p.temp);
    const d = p.dewp == null ? null : (us ? cToF(p.dewp) : p.dewp);
    const bits = [];
    if (t != null) bits.push(`${Math.round(t)}°${us ? 'F' : 'C'}`);
    if (d != null) bits.push(`dew ${Math.round(d)}°`);
    if (p.wspd != null) bits.push(`${p.wdir ?? '--'}° ${p.wspd}kt${p.wgst ? `G${p.wgst}` : ''}`);
    if (p.visib != null) bits.push(`vis ${p.visib}`);
    return { title: p.id, subtitle: p.name || 'Surface observation', meta: bits.join(' · ') };
  }
  if (k === 'lsr') {
    const when = p.valid ? new Date(p.valid).toISOString().slice(11, 16) + 'Z' : '';
    return {
      title: `${p.type}${p.magnitude ? ` ${p.magnitude}` : ''}`,
      subtitle: `${p.city || ''}${p.state ? `, ${p.state}` : ''}`,
      meta: [when, p.source].filter(Boolean).join(' · '),
    };
  }
  if (k === 'warning') {
    return {
      title: p.event || 'Alert',
      subtitle: (p.areaDesc || '').split(';').slice(0, 2).join(', '),
      meta: p.expires ? `expires in ${fmtExpiry(p.expires)}` : '',
    };
  }
  if (k === 'spc') {
    return { title: SPC_RISK_LABEL[p.label] || p.label || 'Outlook',
             subtitle: 'SPC convective outlook', meta: '' };
  }
  if (k === 'model') {
    const def = FIELD_DEFS[p.field];
    return { title: `${p.value}${p.unit || ''}`,
             subtitle: def ? def.label : 'Model field', meta: '' };
  }
  if (k === 'aqi') {
    return { title: `AQI ${p.value}`, subtitle: aqiCategory(p.value), meta: '' };
  }
  if (k === 'planes') {
    const sub = p.country ? p.country : 'Aircraft';
    const bits = [];
    if (typeof p.alt === 'number')   bits.push(`${Math.round(p.alt)} m`);
    if (typeof p.speed === 'number') bits.push(`${Math.round(p.speed * 1.94384)} kt`);
    if (typeof p.heading === 'number') bits.push(`${Math.round(p.heading)}°`);
    return { title: p.callsign || p.id, subtitle: sub, meta: bits.join(' · ') };
  }
  if (k === 'ships') {
    const sub = p.destination ? `→ ${p.destination}` : 'Vessel';
    const bits = [];
    if (typeof p.sog === 'number') bits.push(`${p.sog.toFixed(1)} kt`);
    if (typeof p.cog === 'number') bits.push(`${Math.round(p.cog)}°`);
    if (p.type_label) bits.push(String(p.type_label));
    return { title: p.name || `MMSI ${p.id}`, subtitle: sub, meta: bits.join(' · ') };
  }
  if (k === 'satellites') {
    return { title: p.name || p.id, subtitle: p.group_label || 'Satellite', meta: '' };
  }
  if (k === 'quakes') {
    const ageH = p.time ? ((Date.now() - p.time) / 3.6e6) : null;
    const meta = (ageH != null) ? `${formatAge(ageH)} ago${p.depth != null ? ' · ' + Math.round(p.depth) + ' km' : ''}` : '';
    return { title: (p.mag != null ? `M${p.mag.toFixed(1)}` : 'Quake'), subtitle: p.place || '', meta };
  }
  if (k === 'hurricanes') {
    const bits = [];
    if (p.intensity) bits.push(`${p.intensity} kt`);
    if (p.pressure)  bits.push(`${p.pressure} mb`);
    return { title: p.name || 'Storm', subtitle: p.classification || 'Tropical cyclone', meta: bits.join(' · ') };
  }
  if (k === 'volcanoes') {
    const sub = (p.country || 'Volcano') + (p.active ? ' · ACTIVE' : '');
    const meta = p.last_eruption ? `Last erupted ${p.last_eruption}` : '';
    return { title: p.name || 'Volcano', subtitle: sub, meta };
  }
  if (k === 'fires') {
    const meta = (p.acq_date || '') + (p.acq_time ? ' ' + p.acq_time + ' UTC' : '');
    return { title: 'Fire detection', subtitle: `FRP ${p.frp ?? '?'} MW`, meta };
  }
  if (k === 'tsunamis' || k === 'severe') {
    return { title: p.event || p.headline || 'Alert', subtitle: p.area || p.headline || '', meta: p.severity || '' };
  }
  if (k === 'launches') {
    const dt = p.net ? (Date.parse(p.net) - Date.now()) / 3.6e6 : null;
    const cd = (dt != null) ? `T${dt >= 0 ? '−' : '+'}${formatAge(Math.abs(dt))}` : '';
    return { title: p.name || 'Launch', subtitle: p.vehicle || p.pad_location || '', meta: cd };
  }
  if (k === 'news') {
    return { title: p.name || 'Natural event', subtitle: (p.categories || []).join(' · '), meta: '' };
  }
  if (k === 'airports') {
    const meta = [p.iata, p.icao].filter(Boolean).join(' · ');
    return { title: p.name || p.id, subtitle: (p.type || '').replace('_', ' '), meta };
  }
  if (k === 'tfrs') {
    return { title: p.notam_id || 'TFR', subtitle: p.type || 'Restriction', meta: p.state || '' };
  }
  if (k === 'parcels_wa') {
    const total = (p.value_total || 0);
    const meta = total ? `Assessed $${total.toLocaleString()}` : '';
    return {
      title: p.address || `Parcel ${p.parcel_id || ''}`,
      subtitle: p.city || 'Washington',
      meta,
    };
  }
  return { title: p.name || p.id || 'Object', subtitle: '', meta: '' };
}

function formatAge(hours) {
  if (hours == null || !isFinite(hours)) return '—';
  if (hours < 1)  return `${Math.round(hours * 60)}m`;
  if (hours < 48) return `${hours.toFixed(1)}h`;
  return `${(hours / 24).toFixed(1)}d`;
}

// ---------- Alerts & warnings window ---------------------------------------

const ALERT_KINDS = ['tsunamis','severe','hurricanes','tfrs','quakes','volcanoes','launches','news'];

function isAlertOn(kind) {
  const cb = document.querySelector(`input[data-alert="${kind}"]`);
  return !!(cb && cb.checked);
}

/* Reads the FEED, not the scene.
   It used to walk entitiesByLayer, which quietly made the alerts panel depend
   on those layers having been built -- so the only way to be warned about a
   tsunami was to already have the tsunami layer switched on. Now the panel
   lists what the feeds are reporting whether or not any of it is drawn, and a
   row resolves to an entity when it is clicked. */
function collectAlerts() {
  // Returns array of {kind, id, tag, text, meta, sev, sortKey, ref}
  const out = [];
  const now = Date.now();
  const rows = (layer) => Object.entries(layerData[layer] || {});
  const row = (layer, id, data) =>
    buildAlertRow(layer, { kind: layer, id, ...data }, { layer, id }, now);

  for (const layer of ['tsunamis', 'severe', 'hurricanes', 'tfrs', 'volcanoes', 'news']) {
    for (const [id, p] of rows(layer)) {
      if (!p) continue;
      if (layer === 'volcanoes' && p.active !== true) continue;
      out.push(row(layer, id, p));
    }
  }

  // Quakes: only M >= 4 within 24h
  for (const [id, p] of rows('quakes')) {
    if (!p || typeof p.mag !== 'number' || p.mag < 4) continue;
    const ageH = p.time ? ((now - p.time) / 3.6e6) : 999;
    if (ageH > 24) continue;
    out.push(row('quakes', id, p));
  }

  // Launches: within ±3h of NET
  for (const [id, p] of rows('launches')) {
    if (!p || !p.net) continue;
    const dt = (Date.parse(p.net) - now) / 3.6e6;
    if (!isFinite(dt) || Math.abs(dt) > 3) continue;
    out.push(row('launches', id, p));
  }

  return out;
}

/* Fly to what an alert row is about. The layer may not be drawn -- that is the
   point of the panel -- so switching it on is part of the gesture, not a side
   effect: the user asked to be shown a thing they cannot currently see. */
function alertJumpTo(ref) {
  if (!ref) return;
  const cb = document.querySelector(`input[data-layer="${ref.layer}"]`);
  if (cb && !cb.checked && !cb.disabled) {
    cb.checked = true;
    cb.dispatchEvent(new Event('change', { bubbles: true }));
  }
  const ent = entitiesByLayer[ref.layer] && entitiesByLayer[ref.layer].get(ref.id);
  if (!ent) return;
  flyToEntity(ent);
  showPanel(ent);
}

function buildAlertRow(kind, p, ref, now) {
  let tag = (KIND_LABEL[kind] || kind).split(' ')[0].slice(0, 8);
  let text = '—', meta = '', sev = 'low', sortKey = 0;

  if (kind === 'tsunamis') {
    tag = 'TSUNAMI'; sev = 'high';
    text = p.event || p.headline || 'Tsunami alert';
    meta = p.area || '';
    sortKey = 1e15;  // top
  } else if (kind === 'severe') {
    tag = 'SEVERE';
    const ev = (p.event || '').toLowerCase();
    sev = (ev.includes('tornado') || ev.includes('hurricane') || ev.includes('flash flood')) ? 'high' : 'mid';
    text = p.event || p.headline || 'Severe weather';
    meta = p.area || '';
    sortKey = (sev === 'high' ? 9e14 : 8e14);
  } else if (kind === 'hurricanes') {
    tag = 'STORM'; sev = 'high';
    text = `${p.classification || ''} ${p.name || ''}`.trim() || 'Storm';
    if (p.intensity) meta = `${p.intensity} kt`;
    sortKey = 7e14 + (p.intensity || 0);
  } else if (kind === 'tfrs') {
    tag = 'TFR'; sev = 'mid';
    text = `${p.type || 'TFR'} · ${p.notam_id || ''}`.trim();
    meta = p.state || '';
    sortKey = 3e14;
  } else if (kind === 'quakes') {
    tag = 'QUAKE';
    const m = p.mag || 0;
    sev = m >= 6 ? 'high' : m >= 5 ? 'mid' : 'low';
    text = `M${m.toFixed(1)} — ${p.place || 'unknown'}`;
    if (p.time) meta = `${formatAge((now - p.time) / 3.6e6)} ago`;
    sortKey = 5e14 + m * 1e10 + (p.time || 0);
  } else if (kind === 'volcanoes') {
    tag = 'VOLCANO'; sev = 'mid';
    text = `${p.name || 'Volcano'} — ${p.country || ''}`.trim();
    meta = p.last_eruption ? `Last ${p.last_eruption}` : 'Active';
    sortKey = 4e14;
  } else if (kind === 'launches') {
    const dt = (Date.parse(p.net) - now) / 3.6e6;
    sev = (Math.abs(dt) < 1) ? 'active' : 'mid';
    tag = 'LAUNCH';
    text = `${p.name || 'Launch'}`;
    meta = `T${dt >= 0 ? '−' : '+'}${formatAge(Math.abs(dt))}`;
    sortKey = 6e14 - Math.abs(dt) * 1e9;
  } else if (kind === 'news') {
    tag = 'EVENT'; sev = 'low';
    text = p.name || 'Natural event';
    meta = (p.categories || []).join(' · ');
    sortKey = 2e14;
  }
  // `ref` is {layer, id}, not the entity: the layer may not be built yet.
  return { kind, id: p.id, tag, text, meta, sev, sortKey, ref };
}

let alertsRefreshScheduled = false;
function refreshAlerts() {
  // Coalesce bursts of upserts into a single update
  if (alertsRefreshScheduled) return;
  alertsRefreshScheduled = true;
  requestAnimationFrame(() => {
    alertsRefreshScheduled = false;
    doRefreshAlerts();
  });
}

function doRefreshAlerts() {
  const all = collectAlerts();
  // Per-kind counts (always show, regardless of toggle)
  const counts = Object.fromEntries(ALERT_KINDS.map(k => [k, 0]));
  for (const a of all) counts[a.kind] = (counts[a.kind] || 0) + 1;
  for (const k of ALERT_KINDS) {
    const el = document.getElementById(`apn-${k}`);
    if (el) el.textContent = counts[k] || 0;
  }

  const filtered = all.filter(a => isAlertOn(a.kind));
  filtered.sort((a, b) => b.sortKey - a.sortKey);
  const cap = 60;
  const shown = filtered.slice(0, cap);

  const list = document.getElementById('ap-list');
  list.innerHTML = '';
  for (const a of shown) {
    const li = document.createElement('li');
    li.dataset.sev = a.sev;
    li.innerHTML = `<span class="al-tag">${a.tag}</span><span class="al-text">${escapeHtml(a.text)}</span><span class="al-meta">${escapeHtml(a.meta || '')}</span>`;
    li.addEventListener('click', () => alertJumpTo(a.ref));
    list.appendChild(li);
  }

  document.getElementById('ap-empty').classList.toggle('hidden', shown.length > 0);
  const cEl = document.getElementById('ap-count');
  cEl.textContent = filtered.length;
  cEl.dataset.zero = (filtered.length === 0) ? 'true' : 'false';
  // Mirror unfiltered total into the header ALERTS chip
  const hdrN = document.getElementById('hdr-n-alerts');
  if (hdrN) {
    hdrN.textContent = all.length;
    hdrN.dataset.zero = (all.length === 0) ? 'true' : 'false';
  }
  // Pulse-attach any new critical alert markers
  attachPulseToAlertEntities();
  // Optional sound on genuinely new tsunamis / active launches
  if (window.__prevAlertSet) maybeBeepForNewAlerts(window.__prevAlertSet, all);
  window.__prevAlertSet = new Set(all.map(a => a.kind + ':' + a.id));
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}

function flyToEntity(entity) {
  if (!entity || !viewer) return;
  try {
    viewer.flyTo(entity, { duration: 1.2, offset: new Cesium.HeadingPitchRange(0, -Math.PI / 3, 800_000) });
  } catch (e) { /* ignore */ }
}

// Monitoring windows — header buttons toggle the docked alerts panel and the
// bottom-left live-feed ticker. Both default off.
function applyMonitor(name, on) {
  if (name === 'alerts_panel') {
    const ap = document.getElementById('alerts-panel');
    if (!ap) return;
    ap.classList.toggle('hidden', !on);
    if (on) refreshAlerts();
  } else if (name === 'live_feed') {
    const tk = document.getElementById('ticker');
    if (!tk) return;
    tk.classList.toggle('hidden', !on);
    document.body.classList.toggle('live-feed-on', on);
  }
  // Sync the matching header button if state was changed elsewhere
  const btn = document.querySelector(`button.hdr-toggle[data-monitor="${name}"]`);
  if (btn) btn.setAttribute('aria-pressed', on ? 'true' : 'false');
}

// ---------- Clocks / telemetry ticker ---------------------------------------

function startClocks() {
  setInterval(() => {
    // UTC ticks every second; animating it makes the whole header jump.
    // Just update text directly — no roll animation here.
    const utcEl = document.getElementById('tm-utc');
    if (utcEl) utcEl.textContent = formatClock();

    // Camera altitude (units-aware) — only roll on actual change
    const altEl = document.getElementById('tm-alt');
    if (viewer && viewer.camera) {
      const carto = Cesium.Cartographic.fromCartesian(viewer.camera.position);
      if (carto) {
        const txt = formatAltitude(carto.height);
        if (altEl.textContent !== txt) rollText(altEl, txt);
      }
    }

    // Feed-chip aging — chips that haven't updated in 5x their poll go warn
    refreshFeedChips();
    refreshPlaneStatus();
  }, 1000);

  // Recompute alerts every 30s so age-windowed items (quakes 24h, launches ±3h)
  // roll in and out without waiting for the next snapshot.
  setInterval(refreshAlerts, 30_000);
}

function formatClock() {
  const now = new Date();
  const utc = now.toISOString().slice(11, 19);
  if (settings.timeFormat === 'utc') return utc;
  const pad = (n) => String(n).padStart(2, '0');
  const local = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  if (settings.timeFormat === 'local') return local;
  // 'both' — UTC · LOCAL UTC±N
  const offsetMin = -now.getTimezoneOffset();              // +ve = ahead of UTC
  const sign = offsetMin >= 0 ? '+' : '-';
  const hh = Math.floor(Math.abs(offsetMin) / 60);
  const mm = Math.abs(offsetMin) % 60;
  const offsetTxt = mm === 0 ? `UTC${sign}${hh}` : `UTC${sign}${hh}:${pad(mm)}`;
  return `${utc} · ${local} ${offsetTxt}`;
}

function formatKm(meters) {
  if (meters == null || !isFinite(meters)) return '—';
  const km = meters / 1000;
  if (km > 999) return `${(km / 1000).toFixed(1)} Mm`;
  if (km > 9)   return `${km.toFixed(0)} km`;
  return `${km.toFixed(1)} km`;
}

// Altitude formatter that respects the active unit system.
//   metric → m / km / Mm
//   us     → ft / mi
function formatAltitude(meters) {
  if (meters == null || !isFinite(meters)) return '—';
  if (settings.units === 'us') {
    const feet = meters * 3.28084;
    if (feet < 1000)   return `${feet.toFixed(0)} ft`;
    const miles = meters / 1609.344;
    if (miles < 10)    return `${miles.toFixed(1)} mi`;
    if (miles < 1000)  return `${miles.toFixed(0)} mi`;
    return `${(miles / 1000).toFixed(1)} k mi`;
  }
  return formatKm(meters);
}

/* Scoped to the feed strip. It used to walk EVERY .chip in the document and
   stamp data-state on it -- and the division pills in the rail carry the same
   class, so each one picked up data-state="off" and with it the 0.45 opacity
   meant for a dead feed. That is why the selected division read as disabled. */
function refreshFeedChips() {
  const now = Date.now();
  document.querySelectorAll('#feedstrip-chips .chip').forEach((el) => {
    const f = el.dataset.feed;
    const last = feedActivity[f];
    const meta = FEED_BY_ID[f] || {};
    if (!last) { el.dataset.state = 'off'; return; }
    // Static feeds load once and stay green forever.
    if (meta.static) { el.dataset.state = 'ok'; return; }
    const ageSec = (now - last) / 1000;
    const warnAt = meta.warn ?? 600;
    const badAt  = meta.bad  ?? 3600;
    if      (ageSec < warnAt)  el.dataset.state = 'ok';
    else if (ageSec < badAt)   el.dataset.state = 'warn';
    else                       el.dataset.state = 'bad';
  });
}

function noteFeed(layer) {
  feedActivity[layer] = Date.now();
  refreshFeedChips();
  // Brief flicker on the matching chip to signal fresh data
  const chip = document.querySelector(`#feedstrip-chips .chip[data-feed="${layer}"]`);
  if (chip) {
    chip.classList.remove('flicker');
    void chip.offsetWidth;       // restart the keyframe
    chip.classList.add('flicker');
  }
}

// ---------- Counts / category roll-up --------------------------------------

function setCount(layer, n) {
  const el = document.getElementById(`count-${layer}`);
  if (el) el.textContent = String(n);
}

function updateCategoryCounts() {
  const totals = { air: 0, sea: 0, earth: 0, weather: 0, space: 0, alerts: 0,
                   reference: 0, land: 0, water: 0 };
  for (const [layer, cat] of Object.entries(CATEGORY)) {
    const cb = document.querySelector(`input[data-layer="${layer}"]`);
    if (!cb || !cb.checked) continue;
    if (layer === 'satellites')                  totals[cat] += satelliteRecords.size;
    else if (entitiesByLayer[layer])             totals[cat] += entitiesByLayer[layer].size;
    else if (layer === 'radar' && radarLayer)    totals[cat] += 1;
    else if (layer === 'aurora' && auroraLayer)  totals[cat] += 1;
    else if (layer === 'parcels_us' && parcelsUSLayer) totals[cat] += 1;
    else if (layer === 'parcels_wa' && parcelsWADS)    totals[cat] += parcelsWADS.entities.values.length;
    // The water layers own their own CustomDataSources rather than going
    // through entitiesByLayer, so they need their own branch or the WATER
    // category header would sit at zero with 11,534 gauges on the globe.
    else if (layer === 'rivers' && riversDS)     totals[cat] += riversDS.entities.values.length;
    else if (layer === 'tides'  && tidesDS)      totals[cat] += tidesDS.entities.values.length;
    else if (layer === 'buoys'  && buoysDS)      totals[cat] += buoysDS.entities.values.length;
  }
  let grand = 0;
  for (const cat of Object.keys(totals)) {
    const el = document.getElementById(`cat-count-${cat}`);
    if (el) el.textContent = totals[cat] || '';
    grand += totals[cat];
  }
  document.getElementById('tm-total').textContent = grand.toLocaleString();
}

// ---------- WebSocket -------------------------------------------------------

function connectWebSocket() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(`${proto}//${location.host}/ws`);
  ws.onopen    = () => setStatus('ok', 'live');
  ws.onclose   = () => { setStatus('bad', 'offline'); setTimeout(connectWebSocket, 2000); };
  ws.onerror   = () => setStatus('bad', 'error');
  ws.onmessage = (ev) => handleMessage(JSON.parse(ev.data));
}

function handleMessage(msg) {
  if (msg.type === 'snapshot') {
    const layers = msg.data.layers || {};
    for (const [layer, entries] of Object.entries(layers)) {
      resetLayer(layer, entries);
      if (Object.keys(entries).length) noteFeed(layer);
    }
    const meta = msg.data.meta || {};
    if (meta.radar)         { radarMeta = meta.radar;   noteFeed('radar');  if (isLayerOn('radar'))  toggleRadar(true); if (isLayerOn('clouds')) toggleClouds(true); }
    if (meta.aurora)        { auroraMeta = meta.aurora; noteFeed('aurora'); if (isLayerOn('aurora')) toggleAurora(true); }
    if (meta.space_weather) { applySpaceWeather(meta.space_weather); noteFeed('space_weather'); }
    if (meta.cables)        { cablesGeoJson = meta.cables.geojson; noteFeed('cables'); if (isLayerOn('cables')) toggleCables(true); }
  } else if (msg.type === 'planes' || msg.type === 'ships') {
    upsertEntity(msg.type, msg.id, msg.data);
    noteFeed(msg.type);
  } else if (msg.type && msg.type.endsWith(':reset')) {
    const layer = msg.type.slice(0, -':reset'.length);
    resetLayer(layer, msg.data || {});
    noteFeed(layer);
  } else if (msg.type === 'meta') {
    if      (msg.key === 'radar')         { radarMeta = msg.data;  noteFeed('radar');  if (isLayerOn('radar'))  toggleRadar(true);  if (isLayerOn('clouds')) toggleClouds(true); }
    else if (msg.key === 'aurora')        { auroraMeta = msg.data; noteFeed('aurora'); if (isLayerOn('aurora')) toggleAurora(true); }
    else if (msg.key === 'space_weather') { applySpaceWeather(msg.data); noteFeed('space_weather'); }
    else if (msg.key === 'cables')        { cablesGeoJson = msg.data.geojson; cablesBuilt = false; noteFeed('cables'); if (isLayerOn('cables')) toggleCables(true); }
  }
  updateCategoryCounts();
  refreshAlerts();
}

function isLayerOn(layer) {
  const cb = document.querySelector(`input[data-layer="${layer}"]`);
  return !!(cb && cb.checked && !cb.disabled);
}

// ---------- Generic layer rendering -----------------------------------------

function resetLayer(layer, entries) {
  layerData[layer] = entries;

  if (layer === 'satellites') {
    // Satellites propagate their own orbits on a 1 Hz tick, so building them
    // for a layer nobody is looking at buys a permanent timer as well as 1,352
    // entities.
    if (isLayerOn('satellites')) {
      rebuildSatellites(entries);
      setCount('satellites', satelliteRecords.size);
    } else {
      setCount('satellites', Object.keys(entries).length);
    }
    return;
  }
  const ds = dataSources[layer];
  if (!ds) return;
  ds.entities.removeAll();
  entitiesByLayer[layer].clear();
  // The check is hoisted out of the loop deliberately: isLayerOn() is a DOM
  // query, and inside a 5,272-row airports snapshot that is 5,272 of them.
  const draw = isLayerOn(layer);
  if (draw) {
    for (const [id, data] of Object.entries(entries)) upsertEntity(layer, id, data, true);
  }
  // Counts report what the FEED has, drawn or not. A layer showing 0 because
  // you have not switched it on is chrome lying about the data behind it.
  setCount(layer, Object.keys(entries).length);

  // Live ticker — only push entries that are NEW since last reset (delta-aware).
  pushDeltasToTicker(layer, entries);
}

/* Build the entities for a layer from the feed rows already in hand. Called
   when a layer is switched on; a no-op if the scene is already in step. */
function materialiseLayer(layer) {
  const ds = dataSources[layer];
  const entries = layerData[layer];
  if (!ds || !entries) return 0;
  const map = entitiesByLayer[layer];
  if (map.size) return 0;                       // already built
  for (const [id, data] of Object.entries(entries)) upsertEntity(layer, id, data, true);
  setCount(layer, Object.keys(entries).length);
  return map.size;
}

/* And give them back. A layer switched off used to keep every entity alive and
   merely invisible, which is the whole cost with none of the picture. */
function dematerialiseLayer(layer) {
  const ds = dataSources[layer];
  if (!ds || !entitiesByLayer[layer] || !entitiesByLayer[layer].size) return;
  ds.entities.removeAll();
  entitiesByLayer[layer].clear();
}

// Track the last-seen ID set per layer, so each refresh only emits truly new
// events (not the same top-N over and over).
const seenIds = {};
function pushDeltasToTicker(layer, entries) {
  const prev = seenIds[layer] || new Set();
  const next = new Set(Object.keys(entries));
  const added = [...next].filter(k => !prev.has(k));
  seenIds[layer] = next;

  if (layer === 'quakes') {
    // Quakes feed always lists last 24h — first call has all 270, push only top 5 by mag.
    // Subsequent calls push every new id with mag >= 3.
    const isFirst = prev.size === 0;
    let toPush = added.map(id => ({ id, q: entries[id] }));
    if (isFirst) {
      toPush = toPush
        .filter(x => typeof x.q.mag === 'number')
        .sort((a, b) => b.q.mag - a.q.mag)
        .slice(0, 5);
    } else {
      toPush = toPush.filter(x => typeof x.q.mag === 'number' && x.q.mag >= 3.0);
    }
    for (const { q } of toPush) {
      pushEvent('QUAKE', `M${q.mag.toFixed(1)} — ${q.place || 'unknown'}`, q.time || Date.now());
    }
  } else if (layer === 'launches') {
    // First call: push next 2 upcoming. Subsequent: push genuinely new.
    const isFirst = prev.size === 0;
    let toPush = added.map(id => ({ id, L: entries[id] })).filter(x => x.L.net);
    toPush.sort((a, b) => new Date(a.L.net) - new Date(b.L.net));
    if (isFirst) toPush = toPush.slice(0, 2);
    for (const { L } of toPush) {
      pushEvent('LAUNCH', `${L.name || L.vehicle} — ${L.pad_location || ''}`, new Date(L.net).getTime());
    }
    startCountdownTicker();
  } else if (layer === 'tsunamis') {
    for (const id of added) {
      const t = entries[id];
      pushEvent('TSUNAMI', t.headline || t.event || 'alert', Date.now());
    }
  } else if (layer === 'hurricanes') {
    for (const id of added) {
      const h = entries[id];
      pushEvent('STORM', `${h.classification || ''} ${h.name || ''} ${h.intensity ? '— '+h.intensity+' kt' : ''}`.trim(), Date.now());
    }
  } else if (layer === 'fires') {
    // Fires reset wholesale every 30m; first call only push top 3 by FRP.
    if (prev.size === 0) {
      const top = Object.values(entries)
        .filter(f => typeof f.frp === 'number')
        .sort((a, b) => b.frp - a.frp)
        .slice(0, 3);
      for (const f of top) pushEvent('FIRE', `FRP ${f.frp.toFixed(0)} MW`, Date.now());
    }
  } else if (layer === 'news') {
    // EONET — push top 3 newest categories on first call only
    if (prev.size === 0) {
      const items = Object.values(entries).slice(0, 3);
      for (const e of items) {
        pushEvent('EVENT', `${(e.categories || []).join(' · ')} — ${e.name || ''}`.trim(), Date.now());
      }
    } else if (added.length) {
      for (const id of added.slice(0, 3)) {
        const e = entries[id];
        pushEvent('EVENT', `${(e.categories || []).join(' · ')} — ${e.name || ''}`.trim(), Date.now());
      }
    }
  }
}

// Cesium's reference plane glTF — public sample asset hosted by CesiumGS on
// GitHub. Used at very-close zoom (<50 km) so dots become recognizable
// silhouettes when you fly down to a city. Falls back to dot if it fails.
const PLANE_MODEL_URL = 'https://raw.githubusercontent.com/CesiumGS/cesium/main/Apps/SampleData/models/CesiumAir/Cesium_Air.glb';
const MODEL_SWAP_DISTANCE_M = 50_000;          // planes: model below 50 km
const SHIP_ICON_DIST_M     = 200_000;          // ships: SVG icon below 200 km
const SAT_ICON_DIST_M      = 5_000_000;        // satellites: SVG icon below 5 Mm

// Inline SVG billboards for near-zoom ship + satellite representations.
// Encoded as data URLs so no extra network calls and no asset hosting.
function _svgDataUrl(svg) {
  return 'data:image/svg+xml;base64,' + btoa(svg);
}
const SHIP_ICON_URL = _svgDataUrl(`<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 64" width="32" height="64">
  <path d="M16 2 L26 22 L26 54 L20 62 L12 62 L6 54 L6 22 Z"
        fill="#4dd2ff" stroke="#001824" stroke-width="2" stroke-linejoin="round"/>
  <line x1="16" y1="14" x2="16" y2="58" stroke="#001824" stroke-width="1.5"/>
  <circle cx="16" cy="36" r="3" fill="#001824"/>
</svg>`);
const SAT_ICON_URL = _svgDataUrl(`<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 32" width="48" height="32">
  <rect x="20" y="11" width="8" height="10" fill="#c4b5fd" stroke="#1e1b3a" stroke-width="1.5"/>
  <rect x="2"  y="13" width="16" height="6"  fill="#a78bfa" stroke="#1e1b3a" stroke-width="1.5"/>
  <rect x="30" y="13" width="16" height="6"  fill="#a78bfa" stroke="#1e1b3a" stroke-width="1.5"/>
  <line x1="2" y1="16" x2="46" y2="16" stroke="#1e1b3a" stroke-width="0.6"/>
  <rect x="22" y="2"  width="4"  height="9"  fill="#fde68a" stroke="#1e1b3a" stroke-width="1"/>
</svg>`);

function planeOrientation(pos, headingDeg) {
  if (headingDeg == null || !isFinite(headingDeg)) return undefined;
  const hpr = new Cesium.HeadingPitchRoll(
    Cesium.Math.toRadians(headingDeg - 90),  // model nose along +X; subtract 90° to align with heading=0=N
    0, 0
  );
  return Cesium.Transforms.headingPitchRollQuaternion(pos, hpr);
}

/* `draw` is passed by resetLayer/materialiseLayer, which have already decided.
   A live plane or ship arriving on the socket while its layer is off records
   itself and stops there -- the row is kept so switching the layer on shows the
   world as it is now, without building a scene nobody asked for. */
function upsertEntity(layer, id, data, draw) {
  if (data.lat == null || data.lon == null) return;
  const ds = dataSources[layer];
  if (!ds) return;
  (layerData[layer] || (layerData[layer] = {}))[id] = data;
  if (draw === undefined ? !isLayerOn(layer) : !draw) return;
  const map = entitiesByLayer[layer];
  let ent = map.get(id);
  const pos = positionFor(layer, data);
  const props = { kind: layer, id, ...data };

  if (!ent) {
    const g = graphicsFor(layer, data);
    if (layer === 'planes') {
      // Far-zoom dot, near-zoom 3D model — DDCs are complementary so only one
      // shows at a time.
      g.model = {
        uri: PLANE_MODEL_URL,
        minimumPixelSize: 28,
        maximumScale: 80000,
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, MODEL_SWAP_DISTANCE_M),
        runAnimations: false,
      };
      if (g.point) g.point.distanceDisplayCondition = new Cesium.DistanceDisplayCondition(MODEL_SWAP_DISTANCE_M, ALWAYS_VISIBLE_FAR_M);
    } else if (layer === 'ships') {
      // Below 200 km, draw a top-down boat silhouette billboard rotated by COG.
      g.billboard = {
        image: SHIP_ICON_URL,
        width: 14, height: 26,
        scaleByDistance: new Cesium.NearFarScalar(5_000, 1.4, SHIP_ICON_DIST_M, 0.7),
        rotation: Cesium.Math.toRadians(-(Number(data.cog) || 0)),
        alignedAxis: Cesium.Cartesian3.UNIT_Z,
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, SHIP_ICON_DIST_M),
        verticalOrigin: Cesium.VerticalOrigin.CENTER,
      };
      if (g.point) g.point.distanceDisplayCondition = new Cesium.DistanceDisplayCondition(SHIP_ICON_DIST_M, ALWAYS_VISIBLE_FAR_M);
    } else if (layer === 'satellites') {
      // Below 5 Mm, draw a small box-with-solar-panels silhouette.
      g.billboard = {
        image: SAT_ICON_URL,
        width: 22, height: 14,
        scaleByDistance: new Cesium.NearFarScalar(50_000, 1.3, SAT_ICON_DIST_M, 0.7),
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, SAT_ICON_DIST_M),
      };
      if (g.point) g.point.distanceDisplayCondition = new Cesium.DistanceDisplayCondition(SAT_ICON_DIST_M, ALWAYS_VISIBLE_FAR_M);
    }
    const opts = {
      id: `${layer}:${id}`,
      position: pos,
      ...g,
      properties: props,
    };
    if (layer === 'planes') {
      const ori = planeOrientation(pos, data.heading);
      if (ori) opts.orientation = ori;
    }
    ent = ds.entities.add(opts);
    map.set(id, ent);
    setCount(layer, map.size);
    // Live: stream new planes/ships into the ticker as they appear
    if (layer === 'planes' && data.callsign) {
      pushEvent('FLIGHT', `${data.callsign} ${data.country ? '· ' + data.country : ''}`, Date.now());
    } else if (layer === 'ships' && data.name) {
      pushEvent('VESSEL', `${data.name} ${data.destination ? '→ ' + data.destination : ''}`, Date.now());
    }
  } else {
    ent.position = pos;
    Object.assign(ent.properties, props);
    if (layer === 'planes') {
      const ori = planeOrientation(pos, data.heading);
      if (ori) ent.orientation = ori;
    } else if (layer === 'ships' && ent.billboard && data.cog != null) {
      ent.billboard.rotation = Cesium.Math.toRadians(-Number(data.cog));
    }
    const g = graphicsFor(layer, data);
    if (g.point && ent.point) {
      ent.point.pixelSize = g.point.pixelSize;
      ent.point.color = g.point.color;
    }
  }
}

function positionFor(layer, d) {
  const alt = (layer === 'planes') ? (d.alt || 10000) : 0;
  return Cesium.Cartesian3.fromDegrees(d.lon, d.lat, alt);
}

// Tiny constant-size dots for everything — same pixel size regardless of zoom.
const DOT_PX = {
  planes:     4,
  ships:      3,
  satellites: 2,
  airports:   3,
  tfrs:       6,
  quakes:     4,   // base size; mag adds 0..4 px
  hurricanes: 6,
  volcanoes:  4,
  fires:      3,   // base; FRP adds 0..3 px
  tsunamis:   6,
  severe:     5,
  launches:   5,
  news:       3,
};

// Age-based fade so 72h-old events render dim while fresh events pop.
// Returns alpha 0.25..1.0 over the [0, windowH] window.
function ageAlpha(ageHours, windowH) {
  if (ageHours == null || !isFinite(ageHours)) return 0.85;
  if (ageHours < 0)              return 1.0;       // future event (e.g. upcoming launch)
  if (ageHours < 1)              return 1.0;       // just happened
  if (ageHours < 6)              return 0.92;
  if (ageHours < 24)             return 0.78;
  if (ageHours < windowH)        return 0.4 + 0.2 * (1 - (ageHours - 24) / Math.max(1, windowH - 24));
  return 0.25;
}

function graphicsFor(layer, d) {
  const px = DOT_PX[layer] || 3;

  // Mag- + age-driven for quakes. Last 1h of M3+ glows white-hot; older fades.
  if (layer === 'quakes') {
    const mag = (typeof d.mag === 'number') ? d.mag : 1;
    const size = Math.max(3, Math.min(8, px + Math.max(0, mag - 2) * 0.8));
    const ageH = (Date.now() - (d.time || Date.now())) / 3.6e6;
    let color = COLORS.quakes.withAlpha(ageAlpha(ageH, 72));
    if (ageH < 1 && mag >= 3) {
      // Active aftershock zone: shift toward warm white
      color = Cesium.Color.fromCssColorString('#fef3c7');
    }
    return applyDDC({
      point: { pixelSize: size, color,
               outlineColor: Cesium.Color.BLACK, outlineWidth: 0.5 },
    }, ddcQuake(mag));
  }
  // FRP + age for fires. Hot recent detections in bright orange-red, old ones fade.
  if (layer === 'fires') {
    const frp = (typeof d.frp === 'number') ? d.frp : 0;
    const size = Math.max(2, Math.min(6, px + Math.log10(1 + frp) * 1.2));
    // Best-effort age from acq_date + acq_time (e.g. "2026-04-30" + "1430")
    let ageH = null;
    if (d.acq_date && d.acq_time) {
      const t = String(d.acq_time).padStart(4, '0');
      const iso = `${d.acq_date}T${t.slice(0,2)}:${t.slice(2,4)}:00Z`;
      const ms = Date.parse(iso);
      if (isFinite(ms)) ageH = (Date.now() - ms) / 3.6e6;
    }
    return applyDDC({
      point: { pixelSize: size, color: COLORS.fires.withAlpha(ageAlpha(ageH, 72)),
               outlineColor: Cesium.Color.BLACK, outlineWidth: 0.5 },
    }, ddcFire(frp));
  }

  // Launches: status-aware coloring. Ring on the ground, label, dot.
  //   Active   (within ±1h of net): bright lime/green
  //   Upcoming (future): yellow
  //   Recent   (post-launch): faded gray-yellow
  if (layer === 'launches') {
    const netMs = d.net ? Date.parse(d.net) : null;
    const dt = (netMs != null) ? (netMs - Date.now()) / 3.6e6 : null;  // hours; +ve = future
    let color = COLORS.launches;
    let alpha = 1.0;
    if (dt != null) {
      if (Math.abs(dt) < 1)         { color = Cesium.Color.fromCssColorString('#84cc16'); alpha = 1.0; }   // active
      else if (dt > 0)              { color = COLORS.launches; alpha = 1.0; }                              // upcoming
      else                          { color = COLORS.launches; alpha = ageAlpha(-dt, 72); }                // recent
    }
    return {
      point: { pixelSize: px, color: color.withAlpha(alpha),
               outlineColor: Cesium.Color.BLACK, outlineWidth: 0.8 },
      ellipse: {
        semiMajorAxis: 60000, semiMinorAxis: 60000,
        material: color.withAlpha(0.14 * alpha),
        outline: true, outlineColor: color.withAlpha(0.7 * alpha),
        height: 0,
      },
      label: {
        text: countdownText(d.net),
        font: '10px JetBrains Mono, monospace',
        fillColor: color,
        outlineColor: Cesium.Color.BLACK, outlineWidth: 2,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(0, -14),
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 1.5e7),
      },
    };
  }

  // Volcanoes — bright orange when actively erupting (active=true), dim grey otherwise
  if (layer === 'volcanoes') {
    const active = d.active === true;
    return applyDDC({
      point: {
        pixelSize: active ? px + 1 : px,
        color: active
          ? Cesium.Color.fromCssColorString('#ef4444')
          : COLORS.volcanoes.withAlpha(0.55),
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 0.5,
      },
    }, ddcVolcano(active));
  }

  // TFRs — real polygon hierarchy when the FAA GeoServer feed gives us one,
  // a 5-nm fallback ellipse when only a state-centroid point is available.
  if (layer === 'tfrs') {
    const g = {
      point: { pixelSize: px, color: COLORS.tfrs,
               outlineColor: Cesium.Color.BLACK, outlineWidth: 1.5 },
    };
    if (Array.isArray(d.polygon) && d.polygon.length >= 3) {
      const positions = d.polygon
        .filter(c => typeof c[0] === 'number' && typeof c[1] === 'number')
        .map(([lon, lat]) => Cesium.Cartesian3.fromDegrees(lon, lat, 0));
      g.polygon = {
        hierarchy: new Cesium.PolygonHierarchy(positions),
        material: COLORS.tfrs.withAlpha(0.18),
        outline: true,
        outlineColor: COLORS.tfrs.withAlpha(0.85),
        outlineWidth: 1.5,
        height: 0,
      };
      // Hide the dot at close zoom — the polygon takes over
      g.point.distanceDisplayCondition = new Cesium.DistanceDisplayCondition(STATIONARY_HIDE_NEAR_M, ALWAYS_VISIBLE_FAR_M);
    } else {
      // No polygon — fall back to the historical ~5 nm ring
      g.ellipse = {
        semiMajorAxis: 9260, semiMinorAxis: 9260,
        material: COLORS.tfrs.withAlpha(0.10),
        outline: true, outlineColor: COLORS.tfrs.withAlpha(0.7),
        height: 0,
      };
    }
    return applyDDC(g, ddcStationaryAlways());
  }

  // Airports — small dot, scheduled service slightly brighter (stationary)
  if (layer === 'airports') {
    const isLarge = d.type === 'large_airport';
    return applyDDC({
      point: {
        pixelSize: isLarge ? px + 1 : px,
        color: COLORS.airports.withAlpha(isLarge ? 0.95 : 0.55),
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 0.5,
      },
    }, ddcAirport(d.type));
  }

  // Hurricanes keep a name label (text, not an icon). Stationary-ish — they
  // move slowly, but treat as background and fade out at very-near zoom.
  if (layer === 'hurricanes') {
    return applyDDC({
      point: { pixelSize: px, color: COLORS.hurricanes,
               outlineColor: Cesium.Color.BLACK, outlineWidth: 1 },
      label: {
        text: d.name || '',
        font: '11px Inter, sans-serif',
        fillColor: COLORS.hurricanes,
        outlineColor: Cesium.Color.BLACK, outlineWidth: 2,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(0, -14),
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 1.5e7),
      },
    }, ddcStationaryAlways());
  }

  // Default: a colored dot
  const alpha = (layer === 'volcanoes') ? 0.7 :
                (layer === 'news')      ? 0.8 :
                (layer === 'satellites')? 0.9 : 1.0;
  return {
    point: {
      pixelSize: px,
      color: (COLORS[layer] || Cesium.Color.WHITE).withAlpha(alpha),
      outlineColor: Cesium.Color.BLACK,
      outlineWidth: 0.5,
    },
  };
}

// ---------- Satellites (TLE → satellite-js) ---------------------------------

function rebuildSatellites(tles) {
  const ds = dataSources.satellites;
  ds.entities.removeAll();
  satelliteRecords.clear();

  for (const [id, t] of Object.entries(tles)) {
    if (!t.tle1 || !t.tle2 || !window.satellite) continue;
    let satrec;
    try { satrec = satellite.twoline2satrec(t.tle1, t.tle2); }
    catch (e) { continue; }
    if (!satrec || satrec.error) continue;
    const color = Cesium.Color.fromCssColorString(t.color || '#c4b5fd');
    // Importance gate: ISS / stations / visual always render; bulk
    // constellations (gps, galileo, starlink) hide when far so the world view
    // doesn't drown in dots.
    const grp = (t.group || '').toLowerCase();
    const alwaysOn = grp === 'stations' || grp === 'visual' || grp === 'science';
    const ddc = alwaysOn
      ? new Cesium.DistanceDisplayCondition(0, ALWAYS_VISIBLE_FAR_M)
      : new Cesium.DistanceDisplayCondition(0, 3e7);   // 30 Mm
    const ent = ds.entities.add({
      id: `satellites:${id}`,
      position: Cesium.Cartesian3.fromDegrees(0, 0, 400000),
      point: { pixelSize: 3, color: color.withAlpha(0.9),
               outlineColor: Cesium.Color.BLACK, outlineWidth: 0.5,
               distanceDisplayCondition: ddc },
      properties: { kind: 'satellites', id, name: t.name, group: t.group, group_label: t.group_label },
    });
    satelliteRecords.set(id, { satrec, entity: ent, name: t.name, group: t.group });
  }
  if (!satelliteTickHandle) {
    satelliteTickHandle = setInterval(tickSatellites, 1000);
    tickSatellites();
  }
}

/* Drop the constellation and stop propagating it. The 1 Hz orbit tick already
   returned early when the layer was off, but it was still scheduled forever
   and the 1,352 entities it steered were still in the scene graph. */
function releaseSatellites() {
  if (satelliteTickHandle) { clearInterval(satelliteTickHandle); satelliteTickHandle = null; }
  if (dataSources.satellites) dataSources.satellites.entities.removeAll();
  satelliteRecords.clear();
}

function tickSatellites() {
  if (!window.satellite || satelliteRecords.size === 0) return;
  if (!isLayerOn('satellites') || !dataSources.satellites.show) return;
  const now = new Date();
  const gmst = satellite.gstime(now);
  for (const rec of satelliteRecords.values()) {
    try {
      const pv = satellite.propagate(rec.satrec, now);
      if (!pv || !pv.position) continue;
      const geo = satellite.eciToGeodetic(pv.position, gmst);
      const lat = satellite.degreesLat(geo.latitude);
      const lon = satellite.degreesLong(geo.longitude);
      const alt = geo.height * 1000;
      if (!isFinite(lat) || !isFinite(lon) || !isFinite(alt)) continue;
      rec.entity.position = Cesium.Cartesian3.fromDegrees(lon, lat, alt);
    } catch (e) { /* skip */ }
  }
}

// ---------- Launches countdown labels ---------------------------------------

function countdownText(netIso) {
  if (!netIso) return '';
  const t = new Date(netIso).getTime();
  if (!isFinite(t)) return '';
  const now = Date.now();
  const dt = Math.round((t - now) / 1000);
  const sign = dt < 0 ? '+' : '−';
  const a = Math.abs(dt);
  const d = Math.floor(a / 86400);
  const h = Math.floor((a % 86400) / 3600);
  const m = Math.floor((a % 3600) / 60);
  const s = a % 60;
  if (d > 0) return `T${sign}${d}d ${pad(h)}:${pad(m)}`;
  return `T${sign}${pad(h)}:${pad(m)}:${pad(s)}`;
}
function pad(n) { return String(n).padStart(2, '0'); }

function startCountdownTicker() {
  if (countdownTickHandle) return;
  countdownTickHandle = setInterval(() => {
    const ents = entitiesByLayer.launches;
    if (!ents) return;
    for (const ent of ents.values()) {
      if (!ent.label) continue;
      const props = ent.properties.getValue ? ent.properties.getValue() : ent.properties;
      ent.label.text = countdownText(props.net);
    }
  }, 1000);
}

// ---------- Imagery overlays: radar + aurora --------------------------------

// Radar is a frame series, not a still. The timeline owns the imagery layers
// (one per frame, cross-faded by alpha) so the loop can be scrubbed and played
// past "now" into the nowcast frames.
function toggleRadar(on) {
  if (!on) {
    stopTimeline();
    clearFrameLayers();
    TL.frames = [];
    syncTimelineVisibility();
    return;
  }
  if (!radarMeta || !radarMeta.host) return;
  refreshTimeline();
}

function toggleClouds(on) {
  if (!on) {
    if (cloudsLayer) {
      const ref = cloudsLayer; cloudsLayer = null;
      fadeImageryLayer(ref, ref.alpha, 0, LAYER_FADE_MS, () => viewer.imageryLayers.remove(ref));
    }
    return;
  }
  // Which product gets built is owned by the Satellite mode selector
  // (infrared / true-colour / water vapour), so delegate rather than
  // hard-coding the IR composite here.
  rebuildCloudsLayer();
}

function toggleAurora(on) {
  if (!on) {
    if (auroraLayer) {
      const ref = auroraLayer; auroraLayer = null;
      fadeImageryLayer(ref, ref.alpha, 0, LAYER_FADE_MS, () => viewer.imageryLayers.remove(ref));
    }
    return;
  }
  if (!auroraMeta || !auroraMeta.coordinates) return;

  const grid = new Uint8Array(360 * 180);
  for (const triple of auroraMeta.coordinates) {
    const lon = triple[0], lat = triple[1], prob = triple[2];
    if (prob == null || prob <= 0) continue;
    const x = ((lon % 360) + 360) % 360;
    const y = lat + 90;
    if (x < 0 || x >= 360 || y < 0 || y >= 180) continue;
    grid[y * 360 + x] = Math.min(100, prob);
  }
  const cvs = document.createElement('canvas');
  cvs.width = 360; cvs.height = 180;
  const ctx = cvs.getContext('2d');
  const img = ctx.createImageData(360, 180);
  for (let y = 0; y < 180; y++) {
    for (let x = 0; x < 360; x++) {
      const p = grid[y * 360 + x];
      const dst = ((180 - 1 - y) * 360 + ((x + 180) % 360)) * 4;
      if (p === 0) { img.data[dst + 3] = 0; }
      else {
        const alpha = Math.min(220, p * 3 + 30);
        img.data[dst + 0] = 80;
        img.data[dst + 1] = 240;
        img.data[dst + 2] = 140;
        img.data[dst + 3] = alpha;
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  if (auroraLayer) viewer.imageryLayers.remove(auroraLayer);
  auroraLayer = viewer.imageryLayers.addImageryProvider(new Cesium.SingleTileImageryProvider({
    url: cvs.toDataURL('image/png'),
    rectangle: Cesium.Rectangle.fromDegrees(-180, -90, 180, 90),
    credit: 'Aurora © NOAA SWPC',
  }));
  fadeImageryLayer(auroraLayer, 0, 0.85);
}

// ---------- Space weather header chips --------------------------------------

function applySpaceWeather(blob) {
  if (!blob) return;
  SPACE_WX = blob;                 // the space-weather dashboard reads this
  const kpEl = document.getElementById('tm-kp');
  const xEl  = document.getElementById('tm-xray');

  if (blob.kp && blob.kp.value != null) {
    kpEl.textContent = blob.kp.value.toFixed(1);
    kpEl.className = 'tm-val mono ' + (blob.kp.value >= 6 ? 'kp-storm' : blob.kp.value >= 4 ? 'kp-active' : 'kp-quiet');
  } else { kpEl.textContent = '—'; kpEl.className = 'tm-val mono'; }

  if (blob.xray && blob.xray.class) {
    const cls = String(blob.xray.class);
    xEl.textContent = cls;
    xEl.className = 'tm-val mono flare-' + (cls[0] || '');
  } else { xEl.textContent = '—'; xEl.className = 'tm-val mono'; }
}

// ---------- Ticker (recent events) ------------------------------------------

function pushEvent(tag, text, sortKey) {
  recentEvents.push({ tag, text, sortKey });
  recentEvents.sort((a, b) => b.sortKey - a.sortKey);
  if (recentEvents.length > TICKER_MAX) recentEvents.length = TICKER_MAX;
  renderTicker();
}

function renderTicker() {
  const list = document.getElementById('ticker-list');
  list.innerHTML = '';
  for (const e of recentEvents) {
    const li = document.createElement('li');
    li.innerHTML = `<span class="tk-tag">${e.tag}</span><span class="tk-text">${e.text}</span>`;
    list.appendChild(li);
  }
}

// Legacy ticker helpers replaced by pushDeltasToTicker (delta-aware).

// ---------- HUD --------------------------------------------------------------

function setStatus(klass, text) {
  document.getElementById('status-dot').className = klass;
  document.getElementById('status-text').textContent = text.toUpperCase();
}

// ---------- 3D buildings / 3D tiles -----------------------------------------

let osmBuildingsTileset = null;
let googleTileset = null;

async function maybeAttachOsmBuildings(cfg) {
  if (!cfg.cesium_ion_token) return;
  try {
    osmBuildingsTileset = await Cesium.createOsmBuildingsAsync();
    osmBuildingsTileset.show = false;  // off by default; toggled in WEATHER/3D group
    viewer.scene.primitives.add(osmBuildingsTileset);
    console.log('OSM Buildings tileset attached');
    enable3DLayer('buildings');
  } catch (e) {
    console.warn('OSM Buildings unavailable:', e);
  }
}

async function maybeAttachGoogle3DTiles(cfg) {
  if (!cfg.google_maps_api_key) return;
  try {
    googleTileset = await Cesium.Cesium3DTileset.fromUrl(
      `https://tile.googleapis.com/v1/3dtiles/root.json?key=${cfg.google_maps_api_key}`,
      { showCreditsOnScreen: true }
    );
    googleTileset.show = false;
    viewer.scene.primitives.add(googleTileset);
    console.log('Google 3D Tiles tileset attached');
    enable3DLayer('photoreal3d');
  } catch (e) {
    console.warn('Google 3D Tiles unavailable:', e);
  }
}

function enable3DLayer(layer) {
  const cb = document.querySelector(`input[data-layer="${layer}"]`);
  if (!cb) return;
  cb.disabled = false;
  cb.title = '';
  const lbl = cb.closest('label');
  if (lbl) lbl.classList.remove('disabled-feature');
}

function toggleBuildings(on) {
  if (osmBuildingsTileset) fadeTileset(osmBuildingsTileset, on ? 0 : 1, on ? 1 : 0);
}
function togglePhotoreal3D(on) {
  if (googleTileset) fadeTileset(googleTileset, on ? 0 : 1, on ? 1 : 0);
}

// ---------- Night Lights (NASA Black Marble via GIBS) -----------------------

function toggleNightLights(on) {
  if (!on) {
    if (nightLightsLayer) {
      const ref = nightLightsLayer; nightLightsLayer = null;
      fadeImageryLayer(ref, ref.alpha, 0, LAYER_FADE_MS, () => viewer.imageryLayers.remove(ref));
    }
    return;
  }
  if (nightLightsLayer) return;
  // VIIRS city lights — free, keyless, no rate limit.
  //
  // Two traps here, both of which produced silent all-400 tile storms:
  //   1. "VIIRS_Black_Marble" is not a served GIBS layer id. The night-lights
  //      composite is published as VIIRS_CityLights_2012, and the date segment
  //      must be that product's year.
  //   2. GIBS's EPSG:4326 "500m" TileMatrixSet is NOT a power-of-two grid
  //      (its levels are 2,3,5,10,20… tiles wide), so it cannot be addressed
  //      with Cesium's GeographicTilingScheme — every request off the doubling
  //      grid 400s. The EPSG:3857 GoogleMapsCompatible set IS standard XYZ,
  //      so we use Web Mercator and let Cesium reproject onto the globe.
  //   3. The product stops at level 8 (~610 m/px). Left ungated it keeps
  //      drawing as you descend, upsampling into a flat yellow sheet that
  //      completely hides the satellite imagery at neighbourhood zoom.
  //      `maximumTerrainLevel` retires it once tiles refine past regional
  //      scale, which is the last point the pixels still carry information.
  // NB: `imageryLayers.add()` returns undefined, unlike `addImageryProvider`
  // — build the layer first and keep the reference, or every later property
  // set throws.
  nightLightsLayer = new Cesium.ImageryLayer(
    new Cesium.UrlTemplateImageryProvider({
      url: 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_CityLights_2012/default/2012-01-01/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpg',
      tilingScheme: new Cesium.WebMercatorTilingScheme(),
      maximumLevel: 8,
      credit: 'NASA Earthdata · VIIRS City Lights',
    }),
    { maximumTerrainLevel: 8 });
  // Scenery, not data. City lights are part of the realistic Earth: they paint
  // only the dark hemisphere and they are what the base map looks like at
  // night. baseHasOverlay() has to skip them or the globe is permanently in
  // "there is a field over me" mode -- which is exactly what happened, and it
  // held the base at brightness 0.58 and the lens flare suspended even with
  // every data layer switched off.
  nightLightsLayer.__scenery = true;
  viewer.imageryLayers.add(nightLightsLayer);
  // Show only on the night side using Cesium's day/night alpha — Cesium 1.98+
  // supports per-imagery dayAlpha/nightAlpha when the globe has lighting.
  nightLightsLayer.dayAlpha   = 0.0;
  nightLightsLayer.nightAlpha = 1.0;
  fadeImageryLayer(nightLightsLayer, 0, 1.0);
}

// ---------- Subsolar point + day/night terminator ---------------------------

function initTerminator() {
  // Persistent entities; we just move them in updateTerminator()
  sunEntity = terminatorDS.entities.add({
    id: 'sun-marker',
    position: Cesium.Cartesian3.fromDegrees(0, 0, 1000),
    point: {
      pixelSize: 16,
      color: Cesium.Color.fromCssColorString('#fde68a'),
      outlineColor: Cesium.Color.fromCssColorString('#f59e0b'),
      outlineWidth: 2,
    },
    label: {
      text: '☀',
      font: '18px sans-serif',
      fillColor: Cesium.Color.fromCssColorString('#fde047'),
      outlineColor: Cesium.Color.BLACK,
      outlineWidth: 2,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      pixelOffset: new Cesium.Cartesian2(0, 0),
    },
  });

  terminatorEntity = terminatorDS.entities.add({
    id: 'terminator-line',
    polyline: {
      positions: [],
      width: 1.6,
      material: new Cesium.PolylineDashMaterialProperty({
        color: Cesium.Color.fromCssColorString('#94a3b8').withAlpha(0.6),
        dashLength: 12,
      }),
      clampToGround: true,
    },
  });

  setInterval(updateTerminator, 30_000);
  updateTerminator();
}

function toggleTerminator(on) {
  if (terminatorDS) fadeDataSource(terminatorDS, on ? 'in' : 'out');
}

// Subsolar point (lat, lon) for given Date — simple low-precision algorithm.
// Equation-of-time + declination good to ~1° which is fine for a dashed line.
function subsolarLatLon(d) {
  const dayOfYear = Math.floor((d - new Date(Date.UTC(d.getUTCFullYear(), 0, 0))) / 86400000);
  const decl = 23.44 * Math.sin(2 * Math.PI * (dayOfYear - 81) / 365); // °
  const utc_h = d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600;
  const lon = -(utc_h - 12) * 15; // °, +east
  const lat = decl;
  return [lat, ((lon + 540) % 360) - 180];
}

function updateTerminator() {
  if (!terminatorDS || !sunEntity || !terminatorEntity) return;
  const now = new Date();
  const [lat, lon] = subsolarLatLon(now);
  // Move sun marker (~700 km up so it floats above the surface a little)
  sunEntity.position = Cesium.Cartesian3.fromDegrees(lon, lat, 700_000);

  // Build the terminator: great circle perpendicular to the sun direction.
  // Parameterise as a circle on the sphere centred at the antipode of the sun
  // direction with angular radius 90°. We march longitudes 0..360 sampling
  // the corresponding terminator latitude.
  const decl = lat * Math.PI / 180;
  const points = [];
  for (let i = 0; i <= 360; i += 2) {
    const az = i * Math.PI / 180; // angle around the great circle
    // Standard solar-terminator formula:
    //   tanφ = -cosH / tan(δ)   where H = sidereal hour angle from sun-meridian
    // We instead parameterise via spherical rotation for stability at poles.
    const sinPhi = -Math.cos(az) * Math.cos(decl);
    const cosPhi = Math.sqrt(Math.max(0, 1 - sinPhi * sinPhi));
    const phi = Math.asin(sinPhi);
    const dlon = Math.atan2(Math.sin(az), Math.cos(az) * Math.sin(decl));
    const sampleLon = ((lon * Math.PI / 180) + dlon + Math.PI * 3) % (2 * Math.PI) - Math.PI;
    points.push(Cesium.Cartesian3.fromDegrees(
      sampleLon * 180 / Math.PI,
      phi * 180 / Math.PI,
      0
    ));
    void cosPhi;
  }
  terminatorEntity.polyline.positions = points;
}

// ---------- Submarine cables -----------------------------------------------

function toggleCables(on) {
  if (!cablesDS) return;
  if (on && !cablesBuilt && cablesGeoJson) buildCables();
  fadeDataSource(cablesDS, on ? 'in' : 'out');
}

function buildCables() {
  if (!cablesGeoJson || cablesBuilt) return;
  const features = cablesGeoJson.features || [];
  const mat = COLORS.cables.withAlpha(0.55);
  for (const f of features) {
    const geom = f.geometry || {};
    const props = f.properties || {};
    const lines = [];
    if (geom.type === 'LineString') lines.push(geom.coordinates);
    else if (geom.type === 'MultiLineString') for (const c of geom.coordinates) lines.push(c);
    else continue;
    for (const coords of lines) {
      const positions = [];
      for (const [lon, lat] of coords) {
        if (typeof lon === 'number' && typeof lat === 'number') {
          positions.push(Cesium.Cartesian3.fromDegrees(lon, lat, 0));
        }
      }
      if (positions.length < 2) continue;
      cablesDS.entities.add({
        polyline: {
          positions,
          width: 1.0,
          material: mat,
          clampToGround: true,
          // Stationary background — fade out at near zoom so parcels can take over.
          distanceDisplayCondition: ddcStationaryAlways(),
        },
        properties: { kind: 'cable', name: props.name, slug: props.slug,
                      rfs: props.rfs, owners: props.owners, length: props.length },
      });
    }
  }
  cablesBuilt = true;
  setCount('cables', features.length);
  console.log(`Built ${features.length} submarine-cable polylines`);
}

// ---------- Boundaries (countries / states / airspace) ----------------------
//
// Countries and states are pre-built GeoJSON files (Natural Earth 10m, derived
// via scripts/build_boundaries.py). Airspace is OpenAIP raw-API JSON converted
// to a GeoJSON FeatureCollection at build time. All three are lazy-loaded on
// first toggle, kept resident, and shown/hidden via fadeDataSource.
//
// Visual rules:
//   - Country borders: 1 px hairline, ~22% alpha → present without dominating
//   - Country labels:  small slate caps, fade in from 1.2 Mm down to ~500 km,
//                      hide when very close so they don't fight ground detail
//   - State borders:   1 px hairline, ~14% alpha — quieter than countries
//   - State labels:    smaller font, fade in from 200 km down to 50 km,
//                      hide when above ~2 Mm so they don't crowd the world view
//   - Airspace polys:  ICAO-class-tinted fills with low alpha, outlined; only
//                      visible at regional zoom (DDC 0–800 km)

function toggleCountries(on) {
  if (!countriesDS) return;
  if (on && !countriesBuilt) buildCountries();
  fadeDataSource(countriesDS, on ? 'in' : 'out');
}

function toggleStates(on) {
  if (!statesDS) return;
  if (on && !statesBuilt) buildStates();
  fadeDataSource(statesDS, on ? 'in' : 'out');
}

function toggleAirspace(on) {
  if (!airspaceDS) return;
  if (on && !airspaceBuilt) buildAirspace();
  fadeDataSource(airspaceDS, on ? 'in' : 'out');
}

function toggleCities(on) {
  if (!citiesDS) return;
  if (on && !citiesBuilt) buildCities();
  else if (on) relabelCities();
  // Release after the fade, not before, or the layer snaps off instead of
  // fading. The rows stay in memory: the download is the expensive part, the
  // entities are what cost per frame.
  fadeDataSource(citiesDS, on ? 'in' : 'out', undefined, on ? undefined : () => {
    if (!isLayerOn('cities')) releaseCities();
  });
}

function releaseCities() {
  if (!cityLive.size) return;
  citiesDS.entities.suspendEvents();
  try {
    for (const row of cityLive) { row.entity = null; row.shown = ''; }
    cityLive.clear();
    citiesDS.entities.removeAll();
  } finally {
    citiesDS.entities.resumeEvents();
  }
}

async function buildCountries() {
  if (countriesBuilt) return;
  countriesBuilt = true;     // mark optimistically so concurrent toggles don't double-fetch
  try {
    const [bordersRes, labelsRes] = await Promise.all([
      fetch('/static/data/ne_country_borders.geojson'),
      fetch('/static/data/ne_country_labels.geojson'),
    ]);
    const borders = await bordersRes.json();
    const labels  = await labelsRes.json();

    // Lighter slate at moderate alpha — visible over satellite imagery without
    // shouting. Tuned by eye against ESRI World Imagery + Cesium ion Bing.
    const lineColor    = Cesium.Color.fromCssColorString('#cbd5e1').withAlpha(0.45);
    const lineMaterial = new Cesium.ColorMaterialProperty(lineColor);

    for (const f of (borders.features || [])) {
      const coords = f.geometry?.coordinates;
      if (!coords || coords.length < 2) continue;
      const positions = coords
        .filter(c => typeof c[0] === 'number' && typeof c[1] === 'number')
        .map(([lon, lat]) => Cesium.Cartesian3.fromDegrees(lon, lat, 0));
      if (positions.length < 2) continue;
      countriesDS.entities.add({
        polyline: {
          positions, width: 1.0, material: lineMaterial, clampToGround: true,
        },
        properties: { kind: 'country_border', ...f.properties },
      });
    }

    // Labels: tasteful — small caps, slate gray, distance-fade so they only
    // assert when zoomed close enough to be useful. Brighter fill + heavier
    // outline so they read against busy satellite imagery without shouting.
    const labelFill = Cesium.Color.fromCssColorString('#f1f5f9');
    const labelOutline = Cesium.Color.fromCssColorString('#000000').withAlpha(0.95);
    for (const f of (labels.features || [])) {
      const c = f.geometry?.coordinates;
      if (!c) continue;
      const p = f.properties || {};
      const labelrank = p.labelrank ?? 5;
      // Only render labels for top-tier countries (labelrank ≤ 7) so the globe
      // doesn't drown in micro-territory text. Higher rank = less prominent.
      if (labelrank > 7) continue;
      // Rank also decides how far out a name is allowed to draw. One flat
      // condition for all of them put BERMUDA, CURACAO, ST. VINCENT AND THE
      // GRENADINES and a dozen more into an unreadable pile over the Caribbean
      // at the default CONUS frame -- one of them was clipped in half by the
      // colour scale. Big countries stay visible from orbit; small ones have
      // to be worth the space you are looking at.
      const farM = labelrank <= 2 ? 1.8e7
                 : labelrank <= 4 ? 7.0e6
                 : labelrank <= 6 ? 3.0e6
                 : 1.6e6;
      countriesDS.entities.add({
        position: Cesium.Cartesian3.fromDegrees(c[0], c[1], 0),
        label: {
          text: (p.name || '').toUpperCase(),
          font: '600 12px "Inter", system-ui, sans-serif',
          fillColor: labelFill,
          outlineColor: labelOutline,
          outlineWidth: 3,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
          verticalOrigin: Cesium.VerticalOrigin.CENTER,
          // Near 200 km; far by rank, see above.
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(2e5, farM),
          // Fade out over the last fifth of the range rather than popping.
          translucencyByDistance: new Cesium.NearFarScalar(farM * 0.8, 1.0, farM, 0.0),
          // Slightly shrink at far zoom so labels don't crowd
          scaleByDistance: new Cesium.NearFarScalar(1e6, 1.0, 1.5e7, 0.7),
          // Depth-test ON so labels on the far side of the globe are occluded.
          // (Default behavior — leaving this here as documentation of intent.)
        },
        properties: { kind: 'country_label', ...p },
      });
    }
    setCount('countries', countriesDS.entities.values.length);
    updateCategoryCounts();
    console.log(`Built ${(borders.features||[]).length} country border lines + ${(labels.features||[]).length} labels`);
  } catch (e) {
    console.warn('Country boundaries failed to load:', e);
    countriesBuilt = false;
  }
}

async function buildStates() {
  if (statesBuilt) return;
  statesBuilt = true;
  try {
    const [bordersRes, labelsRes] = await Promise.all([
      fetch('/static/data/ne_state_borders.geojson'),
      fetch('/static/data/ne_state_labels.geojson'),
    ]);
    const borders = await bordersRes.json();
    const labels  = await labelsRes.json();

    // Quieter than country borders — half the alpha so they don't compete.
    const lineColor    = Cesium.Color.fromCssColorString('#cbd5e1').withAlpha(0.30);
    const lineMaterial = new Cesium.ColorMaterialProperty(lineColor);

    for (const f of (borders.features || [])) {
      const coords = f.geometry?.coordinates;
      if (!coords || coords.length < 2) continue;
      const positions = coords
        .filter(c => typeof c[0] === 'number' && typeof c[1] === 'number')
        .map(([lon, lat]) => Cesium.Cartesian3.fromDegrees(lon, lat, 0));
      if (positions.length < 2) continue;
      statesDS.entities.add({
        polyline: {
          positions, width: 1.0, material: lineMaterial, clampToGround: true,
          // States only readable at regional zoom — hide when very far
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 8e6),
        },
        properties: { kind: 'state_border', ...f.properties },
      });
    }

    const labelFill = Cesium.Color.fromCssColorString('#e2e8f0');
    const labelOutline = Cesium.Color.fromCssColorString('#000000').withAlpha(0.95);
    for (const f of (labels.features || [])) {
      const c = f.geometry?.coordinates;
      if (!c) continue;
      const p = f.properties || {};
      statesDS.entities.add({
        position: Cesium.Cartesian3.fromDegrees(c[0], c[1], 0),
        label: {
          text: p.name || '',
          font: '500 11px "Inter", system-ui, sans-serif',
          fillColor: labelFill,
          outlineColor: labelOutline,
          outlineWidth: 3,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
          verticalOrigin: Cesium.VerticalOrigin.CENTER,
          // Visible only at regional zoom (50 km – 2.5 Mm)
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(5e4, 2.5e6),
          translucencyByDistance: new Cesium.NearFarScalar(8e4, 0.0, 2e5, 1.0),
          scaleByDistance: new Cesium.NearFarScalar(2e5, 1.0, 2.5e6, 0.85),
          // Depth-test ON so far-side labels stay hidden behind the globe.
        },
        properties: { kind: 'state_label', ...p },
      });
    }
    setCount('states', statesDS.entities.values.length);
    updateCategoryCounts();
    console.log(`Built ${(borders.features||[]).length} state border lines + ${(labels.features||[]).length} labels`);
  } catch (e) {
    console.warn('State boundaries failed to load:', e);
    statesBuilt = false;
  }
}

// ICAO airspace class → fill color (low alpha) + outline color (higher alpha).
// OpenAIP icaoClass: 1=A, 2=B, 3=C, 4=D, 5=E, 6=F, 7=G, 8=other/unspecified.
const AIRSPACE_CLASS_COLOR = {
  1: '#f87171',  // A — red
  2: '#fb923c',  // B — orange
  3: '#fbbf24',  // C — amber
  4: '#a3e635',  // D — lime
  5: '#60a5fa',  // E — blue
  6: '#a78bfa',  // F — violet
  7: '#a78bfa',  // G — violet (rare in US)
  8: '#94a3b8',  // other — slate
};

async function buildAirspace() {
  if (airspaceBuilt) return;
  airspaceBuilt = true;
  try {
    const res = await fetch('/static/data/airspace.json');
    if (!res.ok) throw new Error(`/static/data/airspace.json → HTTP ${res.status}`);
    const records = await res.json();

    let added = 0;
    for (const a of records) {
      const geom = a.geometry || {};
      if (geom.type !== 'Polygon' || !Array.isArray(geom.coordinates)) continue;
      const ring = geom.coordinates[0];
      if (!ring || ring.length < 3) continue;
      const positions = ring
        .filter(p => typeof p[0] === 'number' && typeof p[1] === 'number')
        .map(([lon, lat]) => Cesium.Cartesian3.fromDegrees(lon, lat, 0));
      if (positions.length < 3) continue;

      const cls = a.icaoClass ?? 8;
      const css = AIRSPACE_CLASS_COLOR[cls] || AIRSPACE_CLASS_COLOR[8];
      const fill = Cesium.Color.fromCssColorString(css).withAlpha(0.10);
      const outline = Cesium.Color.fromCssColorString(css).withAlpha(0.55);

      airspaceDS.entities.add({
        polygon: {
          hierarchy: new Cesium.PolygonHierarchy(positions),
          material: new Cesium.ColorMaterialProperty(fill),
          outline: true,
          outlineColor: outline,
          outlineWidth: 1.0,
          // Only visible at regional zoom (≤ 800 km altitude)
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 8e5),
          height: 0,
        },
        properties: {
          kind: 'airspace',
          name: a.name || '',
          icaoClass: cls,
          type: a.type,
          upperLimit: a.upperLimit,
          lowerLimit: a.lowerLimit,
          hoursOfOperation: a.hoursOfOperation,
        },
      });
      added++;
    }
    setCount('airspace', added);
    updateCategoryCounts();
    console.log(`Built ${added} airspace polygons (${records.length} input records)`);
  } catch (e) {
    console.warn('Airspace failed to load:', e);
    airspaceBuilt = false;
  }
}

// SCALERANK → max camera distance at which the city is visible. Lower rank =
// bigger city, visible from farther out. Tuned so the world view shows ~30
// capitals, the regional view fills in mid-tier cities, and street-zoom adds
// small towns. Beyond `far`, the city is hidden via DistanceDisplayCondition.
function _cityMaxDist(scalerank) {
  const r = Math.max(0, Math.min(12, scalerank | 0));
  // Distances in metres
  const table = [
    5e7,    // 0 — capitals (always)
    2.5e7,  // 1
    1.5e7,  // 2
    8e6,    // 3
    4e6,    // 4
    2e6,    // 5
    9e5,    // 6
    4e5,    // 7
    2e5,    // 8
    1e5,    // 9
    6e4,    // 10
    4e4,    // 11
    3e4,    // 12+
  ];
  return table[r];
}

async function buildCities() {
  if (citiesBuilt) return;
  citiesBuilt = true;
  try {
    const res = await fetch('/static/data/ne_populated_places.geojson');
    if (!res.ok) throw new Error(`/static/data/ne_populated_places.geojson → HTTP ${res.status}`);
    const fc = await res.json();
    const labelFill = Cesium.Color.fromCssColorString('#f8fafc');
    const labelOutline = Cesium.Color.fromCssColorString('#000000').withAlpha(0.95);
    const dotColor = COLORS.cities.withAlpha(0.85);

    // Label LOD. Cesium builds one glyph atlas for the whole LabelCollection
    // and allocates eagerly, ignoring distanceDisplayCondition — so creating
    // 7,342 populated labels overflows the atlas and the resize computes an
    // invalid array length, killing the scene from createPotentiallyVisibleSet.
    // Measured threshold: 1,000 labels render, 3,000 crash.
    //
    // Every city still gets a point. Labels exist as objects on all of them but
    // carry text only for the current working set, so text can be swapped on
    // camera move without rebuilding entities. See relabelCities().
    const feats = (fc.features || []).filter((f) => f.geometry && f.geometry.coordinates);
    // Most important first: lower scalerank wins, then larger population.
    feats.sort((a, b) =>
      ((a.properties?.scalerank ?? 9) - (b.properties?.scalerank ?? 9)) ||
      ((b.properties?.pop_max ?? 0) - (a.properties?.pop_max ?? 0)));

    // Plain rows, no Cesium objects. Entities are minted from these by
    // relabelCities() for the cities that can actually be seen right now.
    CITY_STYLE.fill = labelFill;
    CITY_STYLE.outline = labelOutline;
    CITY_STYLE.dot = dotColor;
    cityRows = [];
    for (const f of feats) {
      const c = f.geometry?.coordinates;
      if (!c) continue;
      if (!Number.isFinite(c[0]) || !Number.isFinite(c[1])) continue;
      const p = f.properties || {};
      const sr = p.scalerank ?? 6;
      cityRows.push({
        name: p.name || '', lon: c[0], lat: c[1], sr,
        farM: _cityMaxDist(sr),
        // Lower rank = larger label and dot; cap the range to keep it readable.
        fontPx: sr <= 1 ? 12 : sr <= 3 ? 11 : sr <= 6 ? 10 : 9,
        dotPx:  sr <= 1 ? 4.5 : sr <= 4 ? 3.5 : 2.5,
        props: p,
        entity: null,
        shown: '',           // last text actually written to the label
      });
    }
    relabelCities();
    if (!buildCities._hooked) {
      buildCities._hooked = true;
      let t = null;
      viewer.camera.moveEnd.addEventListener(() => {
        clearTimeout(t);
        t = setTimeout(relabelCities, 250);
      });
    }
    setCount('cities', cityRows.length);
    updateCategoryCounts();
    console.log(`${cityRows.length} cities loaded; at most ${CITY_ENTITY_CAP} `
              + `drawn and ${CITY_LABEL_CAP} labelled at a time`);
  } catch (e) {
    console.warn('Cities failed to load:', e);
    citiesBuilt = false;
  }
}

/* Build one city entity. Split out of buildCities because entities are now
   minted and destroyed as the camera moves rather than once, up front. */
const CITY_STYLE = { fill: null, outline: null, dot: null };

function cityEntity(row) {
  const farM = row.farM;
  // Fade-in distance: opaque once the camera is inside ~35% of the city's
  // visibility range, gone by ~60%.
  //
  // NearFarScalar requires far > near. These were once passed the other way
  // round, which yields a non-finite translucency, corrupts the frustum
  // computation, and kills the scene from createPotentiallyVisibleSet.
  const fadeFull  = Math.min(farM, farM * 0.35);
  const fadeStart = Math.min(farM, farM * 0.6);
  const ddc = new Cesium.DistanceDisplayCondition(0, farM);
  const fade = new Cesium.NearFarScalar(fadeFull, 1.0, fadeStart, 0.0);
  return citiesDS.entities.add({
    position: Cesium.Cartesian3.fromDegrees(row.lon, row.lat, 0),
    point: {
      pixelSize: row.dotPx,
      color: CITY_STYLE.dot,
      outlineColor: Cesium.Color.BLACK,
      outlineWidth: 0.5,
      distanceDisplayCondition: ddc,
      translucencyByDistance: fade,
    },
    label: {
      // Text is assigned by relabelCities(); an empty label keeps the glyph
      // atlas within its limit.
      text: '',
      font: `500 ${row.fontPx}px "Inter", system-ui, sans-serif`,
      fillColor: CITY_STYLE.fill,
      outlineColor: CITY_STYLE.outline,
      outlineWidth: 2.5,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      horizontalOrigin: Cesium.HorizontalOrigin.LEFT,
      verticalOrigin: Cesium.VerticalOrigin.CENTER,
      pixelOffset: new Cesium.Cartesian2(6, 0),
      distanceDisplayCondition: ddc,
      translucencyByDistance: fade,
      // Depth-test ON so cities on the far side of the globe are occluded.
    },
    properties: { kind: 'city_label', ...row.props },
  });
}

/* Keep the drawn set of cities to the ones that can actually be seen.
 *
 * The old shape built an entity for all 7,342 populated places up front and
 * only swapped label TEXT as the camera moved. That made the scene graph carry
 * 7,342 point primitives and 7,342 label slots forever, to show a few hundred
 * of each: measured at 10.8 seconds of blocked main thread to switch the layer
 * on, and a permanent per-frame visit to every one of them thereafter.
 *
 * Two gates decide the working set, and BOTH are needed. Altitude alone is not
 * enough: zoomed into Houston, every town on Earth passes the distance test,
 * because distance-to-camera is not the same question as in-frame. The view
 * rectangle is what bounds it near the ground; the altitude tier is what bounds
 * it from orbit.
 */
const CITY_LABEL_CAP = 900;    // glyph-atlas ceiling; 1,000 render, 3,000 crash
const CITY_ENTITY_CAP = 1600;  // point primitives alive at once
let cityRows = [];             // every city, as plain data
const cityLive = new Set();    // the subset holding an entity right now

/* Padded view rectangle in degrees, or null when the camera sees so much of the
   planet that a box is meaningless (the altitude tier is doing the work then).
   The padding keeps a city that is about to scroll into frame from popping. */
function cityViewBox() {
  const rect = viewer.camera.computeViewRectangle(viewer.scene.globe.ellipsoid);
  if (!rect) return null;
  const w = Cesium.Math.toDegrees(rect.west),  e = Cesium.Math.toDegrees(rect.east);
  const s = Cesium.Math.toDegrees(rect.south), n = Cesium.Math.toDegrees(rect.north);
  let width = e - w;
  if (width < 0) width += 360;
  if (width > 150) return null;
  const padX = Math.max(1, width * 0.25);
  const padY = Math.max(1, (n - s) * 0.25);
  return { w: w - padX, e: e + padX, s: s - padY, n: n + padY };
}

function cityInBox(box, lon, lat) {
  if (lat < box.s || lat > box.n) return false;
  // Longitude compared as an offset from the west edge so a box straddling the
  // antimeridian is one range rather than two.
  const d = ((lon - box.w) % 360 + 360) % 360;
  return d <= ((box.e - box.w) % 360 + 360) % 360;
}

function relabelCities() {
  if (!citiesDS || !cityRows.length) return;
  // The camera-settle hook fires whether or not the layer is on, so without
  // this the working set would be rebuilt for a layer nobody is looking at.
  if (!isLayerOn('cities')) { releaseCities(); return; }
  let camHeight = Infinity;
  try {
    const carto = Cesium.Cartographic.fromCartesian(viewer.camera.position);
    if (carto) camHeight = carto.height;
  } catch { /* keep Infinity: falls back to the highest-rank cities only */ }

  // "Filter labels to area": with a county selection active, a label outside it
  // is describing the part of the map the darkening is trying to push back.
  const clip = typeof adLabelsFiltered === 'function' && adLabelsFiltered();
  const box = cityViewBox();

  // cityRows is pre-sorted by importance, so taking the first N that pass is
  // taking the N that matter.
  const want = new Set();
  for (const row of cityRows) {
    if (camHeight > row.farM) continue;
    if (box && !cityInBox(box, row.lon, row.lat)) continue;
    if (clip && !adInsideSelection(row.lon, row.lat)) continue;
    want.add(row);
    if (want.size >= CITY_ENTITY_CAP) break;
  }

  // One collection event for the whole delta rather than one per entity.
  citiesDS.entities.suspendEvents();
  try {
    for (const row of cityLive) {
      if (want.has(row)) continue;
      citiesDS.entities.remove(row.entity);
      row.entity = null;
      row.shown = '';
      cityLive.delete(row);
    }
    let labelled = 0;
    for (const row of want) {
      if (!row.entity) { row.entity = cityEntity(row); cityLive.add(row); }
      const text = labelled < CITY_LABEL_CAP ? row.name : '';
      if (text) labelled++;
      // Only touch Cesium when the value actually changes; assigning text is
      // what triggers glyph work.
      //
      // Compare against our own copy, not against entity.label.text. That is a
      // Cesium Property, never a string, so `!== text` was true on every record
      // of every call and this guard had never once skipped an assignment.
      if (row.shown !== text) {
        row.entity.label.text = text;
        row.shown = text;
      }
    }
  } finally {
    citiesDS.entities.resumeEvents();
  }
  viewer.scene.requestRender();
}

function showPanel(entity) {
  const props = entity.properties.getValue ? entity.properties.getValue() : entity.properties;
  const kind = props.kind;

  let title, subtitle;
  if      (kind === 'planes')     { title = props.callsign || props.id; subtitle = props.country || 'Aircraft'; }
  else if (kind === 'ships')      { title = props.name || `MMSI ${props.id}`; subtitle = props.destination ? `→ ${props.destination}` : 'Vessel'; }
  else if (kind === 'satellites') { title = props.name; subtitle = props.group_label || 'Satellite'; }
  else if (kind === 'quakes')     { title = (props.mag != null) ? `M${props.mag}` : 'Quake'; subtitle = props.place || 'Earthquake'; }
  else if (kind === 'hurricanes') { title = props.name || 'Storm'; subtitle = props.classification || 'Tropical cyclone'; }
  else if (kind === 'volcanoes')  { title = props.name || 'Volcano'; subtitle = props.country || 'Volcano'; }
  else if (kind === 'fires')      { title = `Fire detection`; subtitle = `FRP ${props.frp ?? '?'} MW`; }
  else if (kind === 'tsunamis')   { title = props.event || 'Tsunami'; subtitle = props.area || 'Alert'; }
  else if (kind === 'launches')   { title = props.name || 'Launch'; subtitle = `${props.vehicle || ''} · ${props.pad_location || ''}`; }
  else if (kind === 'news')       { title = props.name || 'Natural event'; subtitle = (props.categories && props.categories.join(' · ')) || ''; }
  else if (kind === 'parcels_wa') { title = props.address || `Parcel ${props.parcel_id || ''}`; subtitle = `${props.city || 'Washington'} · APN ${props.parcel_id || '—'}`; }
  else if (kind === 'cameras')    { title = props.name || props.id; subtitle = [props.place, props.state, props.network].filter(Boolean).join(' · '); }
  else if (kind === 'spotters')   { title = props.report || 'Spotter report'; subtitle = props.reporter ? `Reported by ${props.reporter}` : 'Spotter Network'; }
  else if (kind === 'metar')      { title = props.id || 'Station'; subtitle = props.name || 'Surface observation'; }
  else if (kind === 'lsr')        { title = `${props.type}${props.magnitude ? ` ${props.magnitude}` : ''}`; subtitle = `${props.city || ''}${props.state ? `, ${props.state}` : ''}`; }
  else if (kind === 'warning')    { title = props.event || 'Alert'; subtitle = (props.areaDesc || '').split(';').slice(0, 3).join(', '); }
  else if (kind === 'spc')        { title = `SPC ${props.label || 'Outlook'}`; subtitle = SPC_RISK_LABEL[props.label] || 'Convective outlook'; }
  else if (kind === 'model')      { title = `${props.value}${props.unit || ''}`; subtitle = FIELD_DEFS[props.field] ? FIELD_DEFS[props.field].label : 'Model field'; }
  else if (kind === 'aqi')        { title = `AQI ${props.value}`; subtitle = aqiCategory(props.value); }
  else if (kind === 'rivers')     { title = props.name || props.id; subtitle = [props.state, RIVER_STAGE_LABEL[props.flood_category]].filter(Boolean).join(' · '); }
  else if (kind === 'tides')      { title = props.name || props.id; subtitle = [props.state, props.great_lakes ? 'Great Lakes' : (props.tidal ? 'Tidal' : 'Water level'), props.affiliations].filter(Boolean).join(' · '); }
  else if (kind === 'buoys')      { title = `Buoy ${props.id}`; subtitle = props.wave_height != null ? `${waveText(props.wave_height)} seas` : 'NDBC station'; }
  else                            { title = entity.id; subtitle = ''; }

  document.getElementById('panel-kind').textContent = KIND_LABEL[kind] || (kind || '').toUpperCase();
  document.getElementById('panel-title').textContent = title;
  document.getElementById('panel-subtitle').textContent = subtitle;

  const display = { ...props };
  delete display.kind;
  if (display.ts) display.last_seen = new Date(display.ts * 1000).toISOString();
  renderDetail(kind, display);
  document.getElementById('panel').classList.remove('hidden');
}

/* ---------------------------------------------------------------------------
   Detail rendering
   ---------------------------------------------------------------------------
   This used to be `JSON.stringify(props, null, 2)` in a <pre>. Every one of
   the ~20 entity kinds produced the same wall of quoted keys and raw epochs,
   which is a debug view, not a way to read a storm.

   Three rules borrowed from how the NOAA iDSSe desktop and the point-popup
   pattern actually work:
     - one headline number per thing, at display size, with its unit;
     - everything else in a label/value grid, values monospace and
       right-aligned so digits line up by place value;
     - a value drawn from a fixed set becomes a chip, and its colour comes
       from the data (a red severity chip reads faster than the word).
   The raw object is still one click away, collapsed, for when a field is
   missing from the schema.

   FIELD_META is keyed on the field names the feeds in graticule/feeds/*.py
   actually emit — read off the source, not guessed. Anything not listed still
   renders, under a humanised label, so a new upstream field is never silently
   dropped. */

const CHIP_TONE = {
  // NWS / USGS severity vocabularies, plus the small enums our feeds emit.
  extreme: 'bad', severe: 'bad', red: 'bad', high: 'bad', immediate: 'bad',
  warning: 'bad', destructive: 'bad',
  moderate: 'warn', orange: 'warn', expected: 'warn', watch: 'warn',
  yellow: 'warn', possible: 'warn',
  minor: 'ok', green: 'ok', low: 'ok', past: 'ok', likely: 'ok',
  actual: 'ok', nominal: 'ok', success: 'ok', active: 'ok',
  day: 'ok', night: 'dim', unknown: 'dim', unlikely: 'dim',
};

const FIELD_META = {
  // shared
  lat:            { label: 'Latitude',    fmt: (v) => `${(+v).toFixed(4)}°` },
  lon:            { label: 'Longitude',   fmt: (v) => `${(+v).toFixed(4)}°` },
  name:           { label: 'Name' },
  country:        { label: 'Country' },
  region:         { label: 'Region' },
  status:         { label: 'Status',      chip: true },
  url:            { label: 'Source',      link: 'Open' },
  link:           { label: 'Source',      link: 'Open' },
  last_seen:      { label: 'Last seen',   time: true },
  // aircraft
  callsign:       { label: 'Callsign' },
  alt:            { label: 'Altitude',    unit: 'm',    num: true },
  velocity:       { label: 'Ground speed', unit: 'm/s', num: true },
  heading:        { label: 'Heading',     fmt: (v) => `${Math.round(v)}°` },
  on_ground:      { label: 'On ground',   chip: true },
  // vessels
  speed:          { label: 'Speed',       unit: 'kn',   num: true },
  course:         { label: 'Course',      fmt: (v) => `${Math.round(v)}°` },
  destination:    { label: 'Destination' },
  // quakes
  mag:            { label: 'Magnitude',   num: true },
  depth_km:       { label: 'Depth',       unit: 'km',   num: true },
  place:          { label: 'Location' },
  alert:          { label: 'PAGER alert', chip: true },
  felt:           { label: 'Felt reports', num: true },
  tsunami:        { label: 'Tsunami flag', chip: true },
  time:           { label: 'Origin time', time: true },
  // storms
  classification: { label: 'Classification' },
  basin:          { label: 'Basin' },
  intensity:      { label: 'Max wind',    unit: 'kt',   num: true },
  pressure:       { label: 'Min pressure', unit: 'hPa', num: true },
  movement:       { label: 'Movement' },
  last_update:    { label: 'Updated',     time: true },
  advisory_url:   { label: 'Advisory',    link: 'Read' },
  track_url:      { label: 'Track',       link: 'Open' },
  // fires
  frp:            { label: 'Radiative power', unit: 'MW', num: true },
  brightness:     { label: 'Brightness',  unit: 'K',    num: true },
  confidence:     { label: 'Confidence',  chip: true },
  daynight:       { label: 'Overpass',    chip: true },
  satellite:      { label: 'Satellite' },
  acq_date:       { label: 'Acquired' },
  acq_time:       { label: 'Acq. time' },
  // volcanoes
  elevation_m:    { label: 'Summit',      unit: 'm',    num: true },
  last_eruption:  { label: 'Last eruption' },
  active:         { label: 'Active',      chip: true },
  // launches
  vehicle:        { label: 'Vehicle' },
  mission_name:   { label: 'Mission' },
  mission_type:   { label: 'Mission type' },
  mission_orbit:  { label: 'Target orbit' },
  agency:         { label: 'Provider' },
  pad_name:       { label: 'Pad' },
  pad_location:   { label: 'Site' },
  net:            { label: 'T-0 (NET)',   time: true },
  window_start:   { label: 'Window opens', time: true },
  window_end:     { label: 'Window closes', time: true },
  // alerts / tsunami / warnings
  event:          { label: 'Event' },
  headline:       { label: 'Headline' },
  severity:       { label: 'Severity',    chip: true },
  urgency:        { label: 'Urgency',     chip: true },
  certainty:      { label: 'Certainty',   chip: true },
  area:           { label: 'Area' },
  areaDesc:       { label: 'Area' },
  sent:           { label: 'Issued',      time: true },
  expires:        { label: 'Expires',     time: true },
  description:    { label: 'Details',     wide: true },
  instruction:    { label: 'Instruction', wide: true },
  // airports / satellites / misc
  iata:           { label: 'IATA' },
  icao:           { label: 'ICAO' },
  municipality:   { label: 'City' },
  elevation_ft:   { label: 'Elevation',   unit: 'ft',   num: true },
  group_label:    { label: 'Constellation' },
  categories:     { label: 'Categories',  fmt: (v) => Array.isArray(v) ? v.join(' · ') : v },
  sources:        { label: 'Sources',     fmt: (v) => Array.isArray(v) ? v.length + ' linked' : v },
  magnitude:      { label: 'Magnitude' },
  magnitude_value: { label: 'Magnitude',  num: true },
  magnitude_unit: { label: 'Unit' },
  // cameras
  network:        { label: 'Network' },
  place:          { label: 'Place' },
  route:          { label: 'Route' },
  direction:      { label: 'Facing' },
  in_service:     { label: 'In service', chip: true, goodWhenTrue: true },
  stream:         { label: 'Live video', link: 'Open HLS' },
  county:         { label: 'County' },
  sponsor:        { label: 'Sponsor' },
  az_current:     { label: 'Azimuth',    fmt: (v) => `${Number(v).toFixed(1)}°` },
  tilt_current:   { label: 'Tilt',       fmt: (v) => `${Number(v).toFixed(1)}°` },
  last_frame_ts:  { label: 'Frame age',  time: true },
  // spotter reports
  reporter:       { label: 'Reported by' },
  report:         { label: 'Report' },
  notes:          { label: 'Notes',      wide: true },
  // river gauges (NWPS)
  flood_category: { label: 'Flood stage', chip: true, fmt: (v) => RIVER_STAGE_LABEL[v] || v },
  stage:          { label: 'Stage',       num: true },
  stage_unit:     { label: 'Stage unit' },
  observed_at:    { label: 'Observed',    time: true },
  flow:           { label: 'Flow',        num: true },
  flow_unit:      { label: 'Flow unit' },
  forecast_stage: { label: 'Forecast crest', num: true },
  forecast_at:    { label: 'Forecast for', time: true },
  wfo:            { label: 'Forecast office' },
  rfc:            { label: 'River centre' },
  // tide stations (NOAA CO-OPS)
  tidal:          { label: 'Tidal',       chip: true, goodWhenTrue: true, trueOnly: true },
  great_lakes:    { label: 'Great Lakes', chip: true, goodWhenTrue: true, trueOnly: true },
  storm_surge:    { label: 'Surge station', chip: true, goodWhenTrue: true, trueOnly: true },
  affiliations:   { label: 'Network' },
  // marine buoys (NDBC)
  wave_height:    { label: 'Wave height', unit: 'm',   num: true, us: true },
  dom_period:     { label: 'Dominant period', unit: 's', num: true },
  avg_period:     { label: 'Average period', unit: 's', num: true },
  wave_dir:       { label: 'Wave from',   fmt: (v) => `${Math.round(v)}°` },
  wind_speed:     { label: 'Wind',        unit: 'm/s', num: true, us: true },
  gust:           { label: 'Gust',        unit: 'm/s', num: true, us: true },
  wind_dir:       { label: 'Wind from',   fmt: (v) => `${Math.round(v)}°` },
  pressure:       { label: 'Pressure',    unit: 'hPa', num: true, us: true },
  pressure_tend:  { label: 'Pressure tendency', unit: 'hPa', num: true },
  air_temp:       { label: 'Air temp',    unit: '°C',  num: true, us: true },
  water_temp:     { label: 'Water temp',  unit: '°C',  num: true, us: true },
  dew_point:      { label: 'Dew point',   unit: '°C',  num: true, us: true },
  visibility:     { label: 'Visibility',  unit: 'nmi', num: true },
  tide:           { label: 'Tide',        unit: 'ft',  num: true },
  obs_time:       { label: 'Observed',    time: true },
};

/* Headline = the one number you actually came for. Kinds absent from this map
   simply get no headline block rather than a fabricated one. */
// `from` names the property the headline consumed, so the grid below can drop
// that row outright. The older dedup compares display strings, which stopped
// working the moment a value could be converted: a headline reading 13.5 ft
// no longer matches the 4.1 the grid row holds.
const KIND_HEADLINE = {
  quakes:     (p) => p.mag       != null && { from: 'mag', value: `M${p.mag}`, note: p.depth_km != null ? `${p.depth_km} km deep` : '' },
  fires:      (p) => p.frp       != null && { from: 'frp', value: p.frp, unit: 'MW', note: 'fire radiative power' },
  hurricanes: (p) => p.intensity != null && { from: 'intensity', value: p.intensity, unit: 'kt', note: p.pressure ? `${p.pressure} hPa` : 'max sustained' },
  model:      (p) => p.value     != null && { from: 'value', value: p.value, unit: p.unit || '', note: FIELD_DEFS[p.field] ? FIELD_DEFS[p.field].label : '' },
  aqi:        (p) => p.value     != null && { from: 'value', value: p.value, note: aqiCategory(p.value) },
  planes:     (p) => p.alt       != null && { from: 'alt', value: Math.round(p.alt), unit: 'm', note: p.velocity != null ? `${Math.round(p.velocity)} m/s` : 'altitude' },
  ships:      (p) => p.speed     != null && { from: 'speed', value: p.speed, unit: 'kn', note: 'speed over ground' },
  volcanoes:  (p) => p.elevation_m != null && { from: 'elevation_m', value: p.elevation_m, unit: 'm', note: 'summit elevation' },
  airports:   (p) => p.elevation_ft != null && { from: 'elevation_ft', value: p.elevation_ft, unit: 'ft', note: p.iata || 'field elevation' },
  rivers:     (p) => p.stage != null && { from: 'stage', value: p.stage, unit: p.stage_unit || 'ft', note: p.flow != null ? `${p.flow} ${p.flow_unit || ''} flow`.trim() : 'observed stage' },
  buoys:      (p) => p.wave_height != null
                       ? { from: 'wave_height', ...waveNum(p.wave_height), note: p.dom_period != null ? `${p.dom_period} s dominant period` : 'significant wave height' }
                       : (p.wind_speed != null && { from: 'wind_speed', ...windNum(p.wind_speed), note: 'wind speed' }),
};

/* NWPS flood categories in the words a forecaster uses. The raw enum
   ("fcst_not_current") is machine vocabulary and belongs in the raw record. */
const RIVER_STAGE_LABEL = {
  major: 'Major flooding',
  moderate: 'Moderate flooding',
  minor: 'Minor flooding',
  action: 'Action stage',
  no_flooding: 'No flooding',
  low_threshold: 'Below low-water threshold',
  out_of_service: 'Gauge out of service',
  obs_not_current: 'Observation not current',
  fcst_not_current: 'Forecast not current',
  not_defined: 'No flood stage defined',
};

function humanise(key) {
  return key.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

/* Relative first, absolute in the tooltip. A raw epoch in a panel is a fact
   the reader has to do arithmetic on. */
function relTime(v) {
  const d = typeof v === 'number' ? new Date(v > 1e11 ? v : v * 1000) : new Date(v);
  if (Number.isNaN(d.getTime())) return { text: String(v), title: '' };
  const secs = (Date.now() - d.getTime()) / 1000;
  const abs = Math.abs(secs);
  const ahead = secs < 0;
  let text;
  if (abs < 45)          text = 'just now';
  else if (abs < 5400)   text = `${Math.round(abs / 60)} min`;
  else if (abs < 172800) text = `${Math.round(abs / 3600)} h`;
  else                   text = `${Math.round(abs / 86400)} d`;
  if (text !== 'just now') text = ahead ? `in ${text}` : `${text} ago`;
  return { text, title: d.toISOString().replace('T', ' ').replace('.000Z', ' UTC') };
}

/* Settings offers "US Customary — mi · ft · °F" and, until the marine feeds
   arrived, only the altitude readout honoured it. NDBC publishes metres and
   Celsius, so a US-customary user opening a buoy was reading 4.1 m seas and a
   13.5 °C sea surface.

   Conversion is declared per field rather than per unit string, because the
   same "ft" means two different things: a river stage in feet is already what
   a US reader wants, while a wave height in metres is not. A field with no
   `us` entry is left exactly as the feed sent it. */
// `dp` is the precision the converted figure is rounded to. Without it the
// arithmetic invents accuracy the feed never had: NDBC reports 24.7 degrees C
// to one decimal, and a straight conversion prints 76.46 F.
const US_CONVERT = {
  m:     { unit: 'ft',   dp: 1, fn: (v) => v * 3.280839895 },
  'm/s': { unit: 'mph',  dp: 1, fn: (v) => v * 2.236936292 },
  C:     { unit: '°F',   dp: 1, fn: (v) => v * 9 / 5 + 32 },
  '°C':  { unit: '°F',   dp: 1, fn: (v) => v * 9 / 5 + 32 },
  hPa:   { unit: 'inHg', dp: 2, fn: (v) => v * 0.02952998751 },
};

/* Returns dp alongside the value because rounding is not formatting. 27.8 °C
   converts to 82.04 °F, toFixed(1) gives "82.0", and Number("82.0") is 82 --
   so a table of sea-surface temperatures printed 82.1, 82, 82.3 and lost a
   digit of real NDBC precision on every tenth reading. dp === null means no
   conversion happened and the caller should not impose one. */
function convertUnit(value, meta) {
  const n = Number(value);
  const unit = meta.unit || '';
  if (!Number.isFinite(n) || settings.units !== 'us' || !meta.us) return { n, unit, dp: null };
  const c = US_CONVERT[unit];
  if (!c) return { n, unit, dp: null };
  return { n: Number(c.fn(n).toFixed(c.dp)), unit: c.unit, dp: c.dp };
}

function detailRow(key, value) {
  const meta = FIELD_META[key] || {};
  const row = document.createElement('div');
  row.className = meta.wide ? 'dt-row is-wide' : 'dt-row';

  const k = document.createElement('span');
  k.className = 'dt-key';
  k.textContent = meta.label || humanise(key);
  row.appendChild(k);

  if (meta.link && typeof value === 'string' && /^https?:/.test(value)) {
    const a = document.createElement('a');
    a.className = 'dt-val dt-link';
    a.href = value; a.target = '_blank'; a.rel = 'noopener noreferrer';
    a.textContent = meta.link;
    row.appendChild(a);
    return row;
  }

  const v = document.createElement('span');
  v.className = 'dt-val';

  if (meta.chip) {
    const chip = document.createElement('span');
    // Booleans read as YES/NO. "TSUNAMI FLAG: FALSE" is a database value, not
    // an answer to the question the reader is asking.
    const raw = typeof value === 'boolean' ? (value ? 'yes' : 'no') : String(value);
    // Booleans are not universally alarming: "tsunami: yes" is bad news,
    // "in service: yes" is good news. The field declares which way it reads.
    const tone = typeof value === 'boolean'
      ? (meta.goodWhenTrue ? (value ? 'ok' : 'bad') : (value ? 'bad' : 'dim'))
      : (CHIP_TONE[raw.toLowerCase()] || 'dim');
    chip.className = `dt-chip is-${tone}`;
    chip.textContent = raw.toUpperCase();
    v.appendChild(chip);
  } else if (meta.time) {
    const { text, title } = relTime(value);
    v.textContent = text;
    if (title) v.title = title;
    v.classList.add('is-num');
  } else if (meta.fmt) {
    v.textContent = meta.fmt(value);
    v.classList.add('is-num');
  } else if (meta.num || typeof value === 'number') {
    const { n, unit, dp } = convertUnit(value, meta);
    const opts = dp == null
      ? { maximumFractionDigits: 2 }
      : { minimumFractionDigits: dp, maximumFractionDigits: dp };
    v.textContent = Number.isFinite(n)
      ? n.toLocaleString('en-US', opts) + (unit ? ` ${unit}` : '')
      : String(value);
    v.classList.add('is-num');
  } else {
    v.textContent = String(value);
  }
  row.appendChild(v);
  return row;
}

/* Fields that exist only to feed a derived row. `ts` is the epoch behind
   `last_seen`; printing both means printing 1785739069.89 next to "just now". */
// `image` is an internal proxy path and the frame it points at is already
// rendered above the grid; `icon` is a placefile sprite index.
// stage_unit and flow_unit carry the unit for another field. They are already
// printed next to the number they belong to; on their own they are a row
// reading "Stage unit: ft".
const DETAIL_SKIP = new Set(['ts', 'image', 'icon', 'stage_unit', 'flow_unit']);

function renderDetail(kind, props) {
  const body = document.getElementById('panel-body');
  body.textContent = '';

  // The head block above already carries these two strings. Repeating them in
  // the grid is how the quake panel ended up saying "M0.31" twice and printing
  // its own subtitle back at itself.
  const said = new Set([
    document.getElementById('panel-title').textContent.trim(),
    document.getElementById('panel-subtitle').textContent.trim(),
    document.getElementById('panel-kind').textContent.trim().toLowerCase(),
  ].filter(Boolean));

  /* A camera's whole point is the picture. Cache-bust so reopening the panel
     fetches the current frame rather than the one from ten minutes ago, and
     drop the element entirely if the camera is down rather than leaving a
     broken-image glyph in the panel. */
  if (kind === 'cameras' && props.image) {
    const shot = document.createElement('img');
    shot.className = 'dt-shot';
    shot.alt = `Current frame from ${props.name || props.id}`;
    shot.loading = 'lazy';
    shot.src = `${props.image}?t=${Math.floor(Date.now() / 60000)}`;
    shot.addEventListener('error', () => shot.remove(), { once: true });
    body.appendChild(shot);
  }

  /* A tide station's marker carries no level; the level and today's highs and
     lows are one request away and land in this slot. The station id is stamped
     on it so a reply that arrives after the user has clicked something else is
     discarded rather than painted into the wrong panel. */
  if (kind === 'tides' && props.id) {
    const slot = document.createElement('div');
    slot.className = 'td-slot';
    slot.dataset.station = String(props.id);
    slot.textContent = 'Reading water level…';
    body.appendChild(slot);
    loadTideDetail(String(props.id), slot);
  }

  const headlineFn = KIND_HEADLINE[kind];
  let head = headlineFn ? headlineFn(props) : null;
  if (head && said.has(String(head.value).trim())) head = null;
  if (head) {
    const wrap = document.createElement('div');
    wrap.className = 'dt-headline';
    const big = document.createElement('span');
    big.className = 'dt-big';
    big.textContent = typeof head.value === 'number'
      ? head.value.toLocaleString('en-US', { maximumFractionDigits: 2 })
      : head.value;
    wrap.appendChild(big);
    if (head.unit) {
      const u = document.createElement('span');
      u.className = 'dt-unit';
      u.textContent = head.unit;
      wrap.appendChild(u);
    }
    if (head.note) {
      const n = document.createElement('span');
      n.className = 'dt-note';
      n.textContent = head.note;
      wrap.appendChild(n);
    }
    body.appendChild(wrap);
    // The headline is the number the reader came for. Printing it again three
    // rows down as "Stage 7.27" under a headline reading "7.27 ft" is the same
    // duplication the title/subtitle dedup already fixed, one block lower.
    said.add(String(head.value).trim());
  }

  // Known fields in schema order first, then anything the feed added that we
  // have no metadata for — never dropped, just demoted.
  const known = Object.keys(FIELD_META).filter((k) => k in props);
  const rest = Object.keys(props).filter((k) => !(k in FIELD_META));
  const grid = document.createElement('div');
  grid.className = 'dt-grid';
  let shown = 0;
  for (const key of [...known, ...rest]) {
    const value = props[key];
    if (DETAIL_SKIP.has(key)) continue;
    if (value == null || value === '' ||
        (Array.isArray(value) && value.length === 0)) continue;
    if (typeof value === 'object' && !Array.isArray(value)) continue;
    if (head && head.from === key) continue;
    if (said.has(String(value).trim())) continue;
    // Classification flags only carry information when set. A tide station
    // that is not on the Great Lakes does not need a row saying so, and the
    // chip renders a bare false as an alarm-red NO.
    if ((FIELD_META[key] || {}).trueOnly && value === false) continue;
    grid.appendChild(detailRow(key, value));
    shown++;
  }
  if (shown) body.appendChild(grid);

  // Progressive disclosure: the debug view survives, one click down.
  const det = document.createElement('details');
  det.className = 'dt-raw';
  const sum = document.createElement('summary');
  sum.textContent = 'Raw feed record';
  const pre = document.createElement('pre');
  pre.textContent = JSON.stringify(props, null, 2);
  det.appendChild(sum);
  det.appendChild(pre);
  body.appendChild(det);
}

function hidePanel() { document.getElementById('panel').classList.add('hidden'); }

// ---------- Parcels (LAND category) -----------------------------------------
//
// Two layers, both deliberately LOD-bounded so the globe stays readable when
// zoomed out:
//
//   parcels_us — Regrid's free public nationwide parcel-boundary tile cache.
//                Pre-rendered raster tiles only return content at z≈15+, which
//                is exactly the LOD we want. No owner data (Regrid keeps that
//                behind their paid API). Free, no key.
//                The provider carries `minimumLevel: 14`, and Cesium honours
//                that floor no matter where the camera is — at globe scale it
//                will happily try to blanket the visible hemisphere in
//                level-14 tiles, which is millions of requests and locks the
//                UI for ~45 s. So the imagery is ATTACHED AND DETACHED on
//                camera altitude rather than left on the stack; see
//                `syncParcelsUS`.
//
//   parcels_wa — WA statewide tax-parcel FeatureServer (DOR / WA Geoservices).
//                Vector polygons fetched ON-DEMAND for the current viewport,
//                only when the camera is below ~5 km altitude. Hover/click
//                shows situs address, city, land + building assessed value.
//                Owner names are redacted at the WA-state level (state policy)
//                so they aren't shown — getting owner names would require
//                county-by-county integrations or a paid Regrid API key.
//
// The WA layer auto-refetches when the camera stops moving. Polygons outside
// the new viewport are dropped to keep the entity count bounded (~1500 max).

const PARCELS_US_URL = 'https://tiles.arcgis.com/tiles/KzeiCaQsMoeCfoCq/arcgis/rest/services/Regrid_Nationwide_Parcel_Boundaries_v1/MapServer/tile/{z}/{y}/{x}';
const PARCELS_WA_QUERY = 'https://services.arcgis.com/jsIt88o09Q0r1j8h/arcgis/rest/services/Current_Parcels/FeatureServer/0/query';
// Attach ceiling for the US raster layer, and the half-width of the rectangle
// it is bounded to. A level-15 tile is ~600 m across, so the 0.32°-wide box
// this yields at the 12 km ceiling is a few thousand tiles of coverage —
// bounded work, versus the whole planet. Both numbers matter; see
// `syncParcelsUS` for why the rectangle is not optional.
const PARCELS_US_MAX_ALT_M = 12000;
const PARCELS_US_BOX_FACTOR = 1.5;    // rectangle half-width ≈ 1.5 × altitude
const PARCELS_US_BOX_MIN_DEG = 0.02;
const PARCELS_US_BOX_MAX_DEG = 0.20;
const PARCELS_WA_MAX_ALT_M = 6000;       // start fetching at < 6 km
const PARCELS_WA_FETCH_MAX_ALT_M = 4000; // stricter limit to actually issue queries
const PARCELS_WA_MAX_FEATURES = 1500;    // entity cap
const PARCELS_WA_PAGE_SIZE = 500;        // ArcGIS hard cap is 2000

let parcelsUSLayer = null;
let parcelsUSEnabled = false;
let parcelsUSHooked = false;
let parcelsUSRect = null;           // Cesium.Rectangle the current layer covers
let parcelsWADS = null;
let parcelsWAEnabled = false;
let parcelsWADebounce = null;
let parcelsWAInflight = null;       // AbortController of current fetch
let parcelsWALastBbox = null;       // [w, s, e, n] of last successful fetch

function toggleParcelsUS(on) {
  parcelsUSEnabled = on;
  if (!parcelsUSHooked) {
    // moveEnd fires once the camera comes to rest, so the layer is attached
    // and detached at most once per gesture rather than every frame.
    viewer.camera.moveEnd.addEventListener(syncParcelsUS);
    parcelsUSHooked = true;
  }
  syncParcelsUS();
}

// A box around the camera's ground point, sized from altitude. Deliberately
// NOT `camera.computeViewRectangle` — a tilted camera near the ground sees to
// the horizon, which would hand back a rectangle hundreds of km wide.
function parcelsUSBox() {
  const carto = Cesium.Cartographic.fromCartesian(viewer.camera.position);
  if (!carto) return null;
  const lon = Cesium.Math.toDegrees(carto.longitude);
  const lat = Cesium.Math.toDegrees(carto.latitude);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;

  const half = Math.min(PARCELS_US_BOX_MAX_DEG,
               Math.max(PARCELS_US_BOX_MIN_DEG,
                        (carto.height * PARCELS_US_BOX_FACTOR) / 111320));
  const halfLon = Math.min(PARCELS_US_BOX_MAX_DEG,
                           half / Math.max(0.15, Math.cos(carto.latitude)));
  return Cesium.Rectangle.fromDegrees(
    Math.max(-180, lon - halfLon), Math.max(-90, lat - half),
    Math.min(180, lon + halfLon), Math.min(90, lat + half));
}

function detachParcelsUS() {
  if (!parcelsUSLayer) return;
  const ref = parcelsUSLayer;
  parcelsUSLayer = null;
  parcelsUSRect = null;
  fadeImageryLayer(ref, ref.alpha, 0, LAYER_FADE_MS, () => viewer.imageryLayers.remove(ref));
}

// Reconcile the Regrid imagery with (enabled, altitude, position). Safe to
// call at any time.
//
// Two guards, and BOTH are load-bearing:
//
//   1. Altitude. Attaching at globe scale used to lock the UI for ~45 s.
//   2. A bounding `rectangle`. Cesium's `_onLayerAdded` walks every loaded
//      quadtree tile and builds imagery skeletons for the new layer. Because
//      the provider floors at level 14, a level-0 root tile alone asks for
//      16384 × 8192 of them, and Cesium throws `RangeError: Too many
//      properties to enumerate` from inside `addImageryProvider` — which
//      kills the scene, since moveEnd is raised during render. Root tiles
//      stay loaded at every zoom, so the altitude guard does not cover this.
//      The rectangle clips the skeleton range to a few hundred tiles.
function syncParcelsUS() {
  if (!parcelsUSEnabled || cameraAltitudeMeters() > PARCELS_US_MAX_ALT_M) {
    detachParcelsUS();
    setCount('parcels_us', parcelsUSEnabled ? 'zoom in' : '—');
    updateCategoryCounts();
    return;
  }

  const box = parcelsUSBox();
  if (!box) { detachParcelsUS(); setCount('parcels_us', 'zoom in'); return; }

  // Still inside the box we already cover? Leave the layer alone so panning
  // within a neighbourhood doesn't rebuild (and re-fade) the imagery.
  if (parcelsUSLayer && parcelsUSRect &&
      Cesium.Rectangle.contains(parcelsUSRect, Cesium.Rectangle.center(box, new Cesium.Cartographic())) &&
      Cesium.Rectangle.intersection(parcelsUSRect, box, new Cesium.Rectangle())?.width >= box.width * 0.9) {
    return;
  }

  detachParcelsUS();
  try {
    parcelsUSLayer = viewer.imageryLayers.addImageryProvider(new Cesium.UrlTemplateImageryProvider({
      url: PARCELS_US_URL,
      rectangle: box,          // see note above — not optional
      minimumLevel: 15,        // verified: z14 404s, z15 returns real geometry
      maximumLevel: 17,        // and stops here
      credit: 'Parcels © Regrid',
    }));
  } catch (err) {
    // Never let a provider take the scene down with it.
    console.warn('parcels_us attach failed:', err);
    parcelsUSLayer = null;
    setCount('parcels_us', 'error');
    return;
  }
  parcelsUSRect = box;
  fadeImageryLayer(parcelsUSLayer, 0, settings.opParcels ?? 0.85);
  setCount('parcels_us', 'tiles');
  updateCategoryCounts();
}

function toggleParcelsWA(on) {
  parcelsWAEnabled = on;
  if (!parcelsWADS) {
    parcelsWADS = new Cesium.CustomDataSource('parcels_wa');
    viewer.dataSources.add(parcelsWADS);
    initParcelsWACameraHook();
  }
  if (on) {
    fadeDataSource(parcelsWADS, 'in');
    requestParcelsWA();
  } else {
    fadeDataSource(parcelsWADS, 'out', LAYER_FADE_MS, () => {
      if (parcelsWAInflight) { parcelsWAInflight.abort(); parcelsWAInflight = null; }
      parcelsWADS.entities.removeAll();
      parcelsWALastBbox = null;
      setCount('parcels_wa', 0);
      updateCategoryCounts();
    });
  }
}

function initParcelsWACameraHook() {
  // moveEnd fires after the camera comes to rest — perfect debouncer for fetch
  viewer.camera.moveEnd.addEventListener(() => {
    if (parcelsWAEnabled) requestParcelsWA();
  });
}

function requestParcelsWA() {
  if (parcelsWADebounce) clearTimeout(parcelsWADebounce);
  parcelsWADebounce = setTimeout(fetchParcelsWA, 250);
}

function cameraAltitudeMeters() {
  if (!viewer || !viewer.camera) return Infinity;
  const carto = Cesium.Cartographic.fromCartesian(viewer.camera.position);
  return carto ? carto.height : Infinity;
}

async function fetchParcelsWA() {
  if (!parcelsWAEnabled || !parcelsWADS) return;

  const alt = cameraAltitudeMeters();
  if (alt > PARCELS_WA_MAX_ALT_M) {
    // Too zoomed out — drop everything we have and bail.
    if (parcelsWADS.entities.values.length) {
      parcelsWADS.entities.removeAll();
      parcelsWALastBbox = null;
      setCount('parcels_wa', 0);
      updateCategoryCounts();
    }
    return;
  }
  if (alt > PARCELS_WA_FETCH_MAX_ALT_M) {
    // In the soft band — keep what's drawn but don't issue new queries.
    return;
  }

  const rect = viewer.camera.computeViewRectangle();
  if (!rect) return;
  const w = Cesium.Math.toDegrees(rect.west);
  const s = Cesium.Math.toDegrees(rect.south);
  const e = Cesium.Math.toDegrees(rect.east);
  const n = Cesium.Math.toDegrees(rect.north);
  if (!isFinite(w) || !isFinite(e) || (e - w) > 0.4 || (n - s) > 0.4) {
    // Sanity guard — if the bbox is huge (cross-pole, etc.) skip.
    return;
  }

  // Skip refetch if the new bbox is within the previously fetched extent.
  if (parcelsWALastBbox) {
    const [pw, ps, pe, pn] = parcelsWALastBbox;
    if (w >= pw && e <= pe && s >= ps && n <= pn) return;
  }

  // Pad the request bbox a little so panning doesn't constantly re-query.
  const padX = (e - w) * 0.15, padY = (n - s) * 0.15;
  const qw = w - padX, qe = e + padX, qs = s - padY, qn = n + padY;

  if (parcelsWAInflight) parcelsWAInflight.abort();
  const ac = new AbortController();
  parcelsWAInflight = ac;

  try {
    const features = await queryParcelsWA(qw, qs, qe, qn, ac.signal);
    if (ac.signal.aborted) return;
    drawParcelsWA(features);
    parcelsWALastBbox = [qw, qs, qe, qn];
  } catch (err) {
    if (err.name !== 'AbortError') console.warn('parcels_wa fetch failed:', err);
  } finally {
    if (parcelsWAInflight === ac) parcelsWAInflight = null;
  }
}

async function queryParcelsWA(w, s, e, n, signal) {
  const out = [];
  let offset = 0;
  while (out.length < PARCELS_WA_MAX_FEATURES) {
    const params = new URLSearchParams({
      where: '1=1',
      geometry: `${w},${s},${e},${n}`,
      geometryType: 'esriGeometryEnvelope',
      inSR: '4326',
      outFields: 'COUNTY_NM,PARCEL_ID_NR,SITUS_ADDRESS,SITUS_CITY_NM,VALUE_LAND,VALUE_BLDG,LANDUSE_CD',
      outSR: '4326',
      f: 'geojson',
      resultRecordCount: String(PARCELS_WA_PAGE_SIZE),
      resultOffset: String(offset),
    });
    const res = await fetch(`${PARCELS_WA_QUERY}?${params}`, { signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const feats = data.features || [];
    out.push(...feats);
    if (feats.length < PARCELS_WA_PAGE_SIZE) break;
    offset += feats.length;
    if (out.length >= PARCELS_WA_MAX_FEATURES) break;
  }
  return out;
}

// ---------- Settings modal --------------------------------------------------

function initSettings() {
  // ----- helpers --------------------------------------------------------
  const radioGroup = (name, key, onChange) => {
    document.querySelectorAll(`input[name=${name}]`).forEach((r) => {
      r.checked = (r.value === settings[key]);
      r.addEventListener('change', () => {
        if (r.checked) { settings[key] = r.value; saveSettings(); onChange?.(settings[key]); }
      });
    });
  };
  const slider = (id, key, suffix, formatter, onChange) => {
    const el = document.getElementById(id);
    const lbl = document.getElementById(id + '-val');
    if (!el) return;
    el.value = String(settings[key]);
    if (lbl) lbl.textContent = formatter(settings[key]);
    el.addEventListener('input', () => {
      const v = el.type === 'range' ? Number(el.value) : el.value;
      settings[key] = v;
      if (lbl) lbl.textContent = formatter(v);
      saveSettings();
      onChange?.(v);
    });
  };
  const checkbox = (id, key, onChange) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.checked = !!settings[key];
    el.addEventListener('change', () => {
      settings[key] = el.checked;
      saveSettings();
      onChange?.(el.checked);
    });
  };

  // ----- bind controls --------------------------------------------------
  radioGroup('units', 'units', applyUnits);
  radioGroup('timeFormat', 'timeFormat');     // formatClock() reads settings.timeFormat each tick
  radioGroup('imageryBase', 'imageryBase', applyImageryBase);
  radioGroup('perfPreset', 'perfPreset', applyPerfPreset);
  radioGroup('view', 'view');

  slider('hover-delay',       'hoverDelayMs',     ' ms', (v) => `${v|0} ms`);
  slider('atmos-intensity',   'atmosIntensity',    '',  (v) => Number(v).toFixed(1), applyAtmosIntensity);
  slider('vignette-intensity','vignetteIntensity', '',  (v) => Number(v).toFixed(2), applyVignetteIntensity);
  slider('idle-rotate',       'idleRotateSec',    ' s', (v) => v == 0 ? 'off' : `${v|0} s`, applyIdleRotate);
  slider('op-countries',      'opCountries',       '',  (v) => Number(v).toFixed(2), () => applyBoundaryOpacity('countries'));
  slider('op-states',         'opStates',          '',  (v) => Number(v).toFixed(2), () => applyBoundaryOpacity('states'));
  slider('op-cities',         'opCities',          '',  (v) => Number(v).toFixed(2), () => applyBoundaryOpacity('cities'));
  slider('op-radar',          'opRadar',           '',  (v) => Number(v).toFixed(2), () => applyImageryOpacity('radar'));
  slider('op-clouds',         'opClouds',          '',  (v) => Number(v).toFixed(2), () => applyImageryOpacity('clouds'));
  slider('op-aurora',         'opAurora',          '',  (v) => Number(v).toFixed(2), () => applyImageryOpacity('aurora'));
  slider('op-parcels',        'opParcels',         '',  (v) => Number(v).toFixed(2), () => applyImageryOpacity('parcels'));
  slider('fade-ms',           'layerFadeMs',      ' ms', (v) => `${v|0} ms`);

  checkbox('show-graticule',  'showGraticule',  applyGraticule);
  checkbox('sun-lighting',    'sunLighting',    applySunLighting);
  checkbox('night-lights',    'nightLights',    toggleNightLights);
  checkbox('show-moon',       'showMoon',       applyMoon);
  checkbox('show-stars',      'showStars',      applyStars);
  checkbox('hdr',             'hdr',            applyHdr);
  checkbox('lens-flare',      'lensFlare',      syncLensFlare);
  checkbox('lock-na',         'lockNorthAmerica', applyNorthAmericaLock);
  checkbox('diagnostics',     'diagnostics',    applyDiagnostics);
  checkbox('ambient-sound',   'ambientSound',   applyAmbientSound);
  checkbox('sound-alerts',    'soundAlerts');

  // Reset all settings — clears localStorage and reloads.
  const resetBtn = document.getElementById('reset-settings');
  if (resetBtn) resetBtn.addEventListener('click', () => {
    if (!confirm('Reset all Graticule settings (units, presets, opacities, etc.) and reload?')) return;
    try {
      // Wipe all graticule.* keys
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (k && k.startsWith('graticule.')) localStorage.removeItem(k);
      }
    } catch {}
    location.reload();
  });

  // Open / close
  const overlay = document.getElementById('settings-overlay');
  const btn = document.getElementById('settings-btn');
  const close = document.getElementById('settings-close');
  if (btn) btn.addEventListener('click', () => overlay.classList.remove('hidden'));
  if (close) close.addEventListener('click', () => overlay.classList.add('hidden'));
  if (overlay) overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.classList.add('hidden');
  });
  // Escape closed the dashboard, the palette and presentation mode, but not
  // this. A modal with an X and a backdrop click and no Escape is the one that
  // traps you, and it is the only overlay that can end up UNDER another one:
  // pressing Ctrl+K over an open Settings put the palette behind it.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !overlay || overlay.classList.contains('hidden')) return;
    e.preventDefault();
    overlay.classList.add('hidden');
  });

  // Apply persisted state on boot so first paint matches.
  applyUnits();
  applyAtmosIntensity(settings.atmosIntensity);
  applyVignetteIntensity(settings.vignetteIntensity);
  applySunLighting(settings.sunLighting);
  applyGraticule(settings.showGraticule);
  applyImageryBase(settings.imageryBase);
  applyPerfPreset(settings.perfPreset);
  applyDiagnostics(settings.diagnostics);
  applyAmbientSound(settings.ambientSound);
  applyIdleRotate(settings.idleRotateSec);
  applyNorthAmericaLock(settings.lockNorthAmerica);
}

function applyUnits() {
  const lbl = document.getElementById('tm-alt-label');
  if (lbl) lbl.textContent = settings.units === 'us' ? 'ALT (US)' : 'ALT';
  // formatAltitude reads settings.units directly on every tick, so the header
  // value catches up within ~1s on its own.
}

// ---------- Realistic Earth -------------------------------------------------
//
// Everything that makes the globe read as a real planet rather than a lit
// sphere lives here. Four independent pieces, all driven by viewer.clock, which
// runs on SYSTEM_CLOCK (see initViewer):
//
//   1. Solar lighting  — globe.enableLighting shades the night hemisphere from
//                        the true sun vector. This is the terminator; the old
//                        dashed polyline was only ever a cosmetic annotation
//                        drawn on top of a uniformly-lit globe.
//   2. Night lights    — VIIRS Black Marble composited with nightAlpha=1 /
//                        dayAlpha=0 so cities glow only on the dark side.
//   3. Moon + stars    — real ephemeris position and phase from Cesium.
//   4. Atmosphere      — ground + sky scattering, HDR tone mapping, and a
//                        lens flare stage so the sun blooms when in frame.
//
function initRealisticEarth() {
  const scene = viewer.scene;
  const globe = scene.globe;

  // 1. Solar lighting. dynamicAtmosphereLighting ties the ground-atmosphere
  //    glow to the sun vector too, so the limb brightens on the day side and
  //    goes deep blue-black at the anti-solar point.
  globe.enableLighting                 = !!settings.sunLighting;
  globe.dynamicAtmosphereLighting      = true;
  globe.dynamicAtmosphereLightingFromSun = true;
  // Softens the day/night boundary. Cesium's default terminator is a hard
  // ~1px cut; real dusk is a wide band, so we widen the falloff.
  globe.atmosphereBrightnessShift = 0.05;

  // 4. Atmosphere — sky + ground scattering.
  //
  // These numbers were chosen by rendering the globe and looking at it, not
  // from the Cesium defaults, which are tuned for a stylised look. At the
  // stock scattering intensity of 2.0 the ground atmosphere floods the day
  // side: oceans go flat electric cyan and land loses nearly all its colour,
  // which is most of why the app read as cheap. Pulling scattering and light
  // intensity down lets ESRI's imagery show through — real bathymetry, green
  // forest, tan desert, snow on the Rockies.
  scene.skyAtmosphere.show             = true;
  scene.skyAtmosphere.hueShift         = -0.04;
  scene.skyAtmosphere.saturationShift  = -0.05;
  scene.skyAtmosphere.brightnessShift  = -0.15;
  globe.showGroundAtmosphere           = true;
  globe.atmosphereScatteringIntensity  = 0.6;
  globe.atmosphereLightIntensity       = Number(settings.atmosIntensity) || 5.0;

  // HDR's ACES tone curve desaturates the midtones, which is exactly where
  // terrain colour lives. Compared side by side it washed the planet out
  // rather than protecting the highlights. Off by default; still a toggle.
  scene.highDynamicRange = !!settings.hdr;

  // Grade the base imagery itself. Satellite basemaps are shot flat on
  // purpose so they can be styled; without this the globe stays hazy.
  gradeBaseImagery();

  // 3. Sun, moon, stars. Cesium computes all three from viewer.clock, so the
  //    moon shows its true phase and libration for the current instant.
  scene.sun            = scene.sun || new Cesium.Sun();
  scene.sun.show       = true;
  scene.sun.glowFactor = 1.4;
  scene.moon           = new Cesium.Moon({ onlySunLighting: true });
  scene.moon.show      = !!settings.showMoon;
  scene.skyBox.show    = !!settings.showStars;

  syncLensFlare();

  // 2. Night lights ride on the same lighting model.
  toggleNightLights(!!settings.nightLights);

  // Keep the header's sun/moon readout honest — recompute on a slow tick
  // rather than per-frame; the subsolar point moves 0.25°/minute.
  setInterval(updateCelestialReadout, 30_000);
  updateCelestialReadout();
}

let _lensFlareStage = null;

/* The flare is for the Earth, not for the data.
   Cesium's lens-flare stage takes the brightest pixels in frame and paints
   mirrored copies of them back through the screen centre -- which is what a
   real lens does, and is fine over a globe from space. Once the base map is
   graded down under a field, the brightest things in frame become the white
   boundary labels and the radar returns, and the stage started drawing
   upside-down ghosts of UNITED STATES OF AMERICA across Texas along with
   coloured smears of the reflectivity. Confirmed by A/B: identical scene, the
   ghosts present with the stage attached and gone with it removed, and absent
   from the pre-grade build because the bright terrain used to swamp them.

   So it follows the same condition as the grade: suspended while anything is
   drawn over the base, restored when the globe is the picture again. The
   Settings switch still decides whether it is wanted at all. */
function lensFlareWanted() {
  return settings.lensFlare !== false && !baseHasOverlay();
}

function syncLensFlare() { applyLensFlare(lensFlareWanted()); }

function applyLensFlare(on) {
  if (!viewer) return;
  const stages = viewer.scene.postProcessStages;
  if (on && !_lensFlareStage) {
    try {
      _lensFlareStage = stages.add(Cesium.PostProcessStageLibrary.createLensFlareStage());
      _lensFlareStage.uniforms.intensity  = 2.2;
      _lensFlareStage.uniforms.distortion = 10.0;
      _lensFlareStage.uniforms.dirtAmount = 0.02;
    } catch { _lensFlareStage = null; }
  } else if (!on && _lensFlareStage) {
    stages.remove(_lensFlareStage);
    _lensFlareStage = null;
  }
  viewer.scene.requestRender();
}

function applyMoon(on) {
  if (!viewer || !viewer.scene.moon) return;
  viewer.scene.moon.show = !!on;
  viewer.scene.requestRender();
}

function applyStars(on) {
  if (!viewer || !viewer.scene.skyBox) return;
  viewer.scene.skyBox.show = !!on;
  viewer.scene.requestRender();
}

function applyHdr(on) {
  if (!viewer) return;
  viewer.scene.highDynamicRange = !!on;
  viewer.scene.requestRender();
}

// Subsolar + sublunar readout for the telemetry bar. Sun position comes from
// the same Cesium ephemeris that drives the lighting, so the number in the
// header and the shading on the globe can never disagree.
function updateCelestialReadout() {
  if (!viewer) return;
  const t = viewer.clock.currentTime;
  const set = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };

  // Subsolar point. computeIcrfToFixedMatrix needs EOP data that Cesium loads
  // lazily and returns undefined until it arrives, so fall back to the closed
  // -form solar position rather than showing a dash forever. The two agree to
  // well under a degree, which is far finer than this readout displays.
  let lat = null, lon = null;
  try {
    const inertial = Cesium.Simon1994PlanetaryPositions
      .computeSunPositionInEarthInertialFrame(t, new Cesium.Cartesian3());
    const icrfToFixed = Cesium.Transforms.computeIcrfToFixedMatrix(t);
    if (icrfToFixed) {
      const fixed = Cesium.Matrix3.multiplyByVector(icrfToFixed, inertial, new Cesium.Cartesian3());
      const c = Cesium.Cartographic.fromCartesian(fixed);
      if (c) {
        lat = Cesium.Math.toDegrees(c.latitude);
        lon = Cesium.Math.toDegrees(c.longitude);
      }
    }
  } catch {}
  if (lat === null) [lat, lon] = subsolarLatLon(Cesium.JulianDate.toDate(t));

  set('tm-sun', `${lat >= 0 ? 'N' : 'S'}${Math.abs(lat).toFixed(1)}° ${lon >= 0 ? 'E' : 'W'}${Math.abs(lon).toFixed(1)}°`);
  set('tm-moon', moonPhaseLabel(Cesium.JulianDate.toDate(t)));
}

// Illuminated fraction + name from the synodic month. Good to ~0.5 day, which
// is well inside the resolution of the 8 phase names.
function moonPhaseLabel(d) {
  const SYNODIC = 29.530588853;
  // 2000-01-06 18:14 UTC — a known new moon.
  const KNOWN_NEW = Date.UTC(2000, 0, 6, 18, 14) / 86400000;
  const age = (((d.getTime() / 86400000 - KNOWN_NEW) % SYNODIC) + SYNODIC) % SYNODIC;
  const frac = (1 - Math.cos(2 * Math.PI * age / SYNODIC)) / 2;   // 0=new 1=full
  const names = ['New', 'Waxing Cres', 'First Qtr', 'Waxing Gib',
                 'Full', 'Waning Gib', 'Last Qtr', 'Waning Cres'];
  const glyphs = ['●', '◖', '◑', '◗',
                  '○', '◖', '◐', '◗'];
  const i = Math.floor((age / SYNODIC) * 8 + 0.5) % 8;
  return `${glyphs[i]} ${names[i]} ${(frac * 100).toFixed(0)}%`;
}

// ---------- Atmosphere / vignette / sun lighting ----------------------------

function applyAtmosIntensity(v) {
  if (!viewer) return;
  viewer.scene.globe.atmosphereLightIntensity = Number(v) || 0;
  viewer.scene.requestRender();
}

function applyVignetteIntensity(v) {
  const el = document.getElementById('overlay-vignette');
  if (el) el.style.opacity = String(Math.max(0, Math.min(1, Number(v) || 0)));
}

function applySunLighting(on) {
  if (!viewer) return;
  viewer.scene.globe.enableLighting = !!on;
  viewer.scene.requestRender();
}

// ---------- Graticule overlay (meridian / parallel grid) -------------------

let graticuleDS = null;
function applyGraticule(on) {
  if (!viewer) return;
  if (!graticuleDS) {
    graticuleDS = new Cesium.CustomDataSource('graticule');
    viewer.dataSources.add(graticuleDS);
    buildGraticule(graticuleDS);
  }
  graticuleDS.show = !!on;
  viewer.scene.requestRender();
}

function buildGraticule(ds) {
  const lineColor = Cesium.Color.fromCssColorString('#94a3b8').withAlpha(0.20);
  const equatorColor = Cesium.Color.fromCssColorString('#94a3b8').withAlpha(0.45);
  const labelFill = Cesium.Color.fromCssColorString('#cbd5e1');
  const labelOutline = Cesium.Color.fromCssColorString('#000000').withAlpha(0.85);
  const labelStyle = {
    font: '500 9px "Inter", system-ui, sans-serif',
    fillColor: labelFill,
    outlineColor: labelOutline,
    outlineWidth: 2,
    style: Cesium.LabelStyle.FILL_AND_OUTLINE,
    horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
    verticalOrigin: Cesium.VerticalOrigin.CENTER,
    distanceDisplayCondition: new Cesium.DistanceDisplayCondition(2e5, 5e7),
  };
  // Parallels every 15° (12 pieces of pie). Equator is bolder.
  for (let lat = -75; lat <= 75; lat += 15) {
    const positions = [];
    for (let lon = -180; lon <= 180; lon += 2) {
      positions.push(Cesium.Cartesian3.fromDegrees(lon, lat, 0));
    }
    ds.entities.add({
      polyline: {
        positions, width: 1.0,
        material: lat === 0 ? equatorColor : lineColor,
        clampToGround: true,
      },
    });
    if (lat !== 0) {
      ds.entities.add({
        position: Cesium.Cartesian3.fromDegrees(0, lat, 0),
        label: { ...labelStyle, text: `${lat > 0 ? '+' : ''}${lat}°` },
      });
    }
  }
  // Meridians every 30°. Prime meridian is bolder.
  for (let lon = -180; lon < 180; lon += 30) {
    const positions = [];
    for (let lat = -85; lat <= 85; lat += 2) {
      positions.push(Cesium.Cartesian3.fromDegrees(lon, lat, 0));
    }
    ds.entities.add({
      polyline: {
        positions, width: 1.0,
        material: lon === 0 ? equatorColor : lineColor,
        clampToGround: true,
      },
    });
    ds.entities.add({
      position: Cesium.Cartesian3.fromDegrees(lon, 0, 0),
      label: { ...labelStyle, text: `${lon > 0 ? '+' : ''}${lon}°` },
    });
  }
  ds.show = false;
}

// ---------- Imagery base picker ---------------------------------------------

let baseImageryLayer = null;
async function applyImageryBase(kind) {
  if (!viewer) return;
  // Remove the previous base, then add the new one as the bottom-most layer.
  if (baseImageryLayer) {
    try { viewer.imageryLayers.remove(baseImageryLayer); } catch {}
    baseImageryLayer = null;
  }
  const cfg = window.__graticule_cfg || {};
  let provider;
  try {
    if (kind === 'streets') {
      provider = new Cesium.UrlTemplateImageryProvider({
        url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
        maximumLevel: 19,
        credit: 'Tiles © OpenStreetMap contributors',
      });
    } else if (kind === 'topo') {
      provider = new Cesium.UrlTemplateImageryProvider({
        url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
        subdomains: ['a', 'b', 'c'],
        maximumLevel: 17,
        credit: 'Tiles © OpenTopoMap (CC-BY-SA)',
      });
    } else if (kind === 'night') {
      // Same two GIBS traps as the night-lights overlay: VIIRS_Black_Marble is
      // not a served layer id, and the EPSG:4326 "500m" set is not a
      // power-of-two grid. Every tile here used to 400.
      provider = new Cesium.UrlTemplateImageryProvider({
        url: 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_CityLights_2012/default/2012-01-01/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpg',
        tilingScheme: new Cesium.WebMercatorTilingScheme(),
        maximumLevel: 8,
        credit: 'NASA Earthdata · VIIRS City Lights',
      });
    } else {
      // Satellite: prefer Cesium ion when token is present, else ESRI.
      if (cfg.cesium_ion_token) {
        try {
          provider = await Cesium.IonImageryProvider.fromAssetId(2);
        } catch {
          provider = new Cesium.UrlTemplateImageryProvider({
            url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
            maximumLevel: 19,
            credit: 'Tiles © Esri',
          });
        }
      } else {
        provider = new Cesium.UrlTemplateImageryProvider({
          url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
          maximumLevel: 19,
          credit: 'Tiles © Esri',
        });
      }
    }
    baseImageryLayer = viewer.imageryLayers.addImageryProvider(provider);
    gradeBaseImagery();
    // Keep it on the bottom; other overlays (radar, clouds, parcels) ride on top
    while (viewer.imageryLayers.indexOf(baseImageryLayer) > 0) {
      viewer.imageryLayers.lower(baseImageryLayer);
    }
  } catch (e) {
    console.warn('Imagery base swap failed:', e);
  }
}

// Colour grade for the bottom-most imagery layer. Re-applied on every basemap
// swap, since a new provider means a new ImageryLayer with default values.
// Streets and topo basemaps are already styled artwork — grading them just
// makes them garish, so only the photographic bases get it.
/* True when a DATA FIELD is drawing on top of the base map. Read off the
   imagery stack itself rather than off a list of layer names, so a new overlay
   is counted the day it is added instead of the day someone remembers to add
   it here.

   Two exclusions, both deliberate:
   * Entities -- boundaries, quakes, planes. Line work over the map, not a
     field competing with it.
   * Anything flagged `__scenery`. City lights are an imagery layer over the
     base, but they ARE the base at night. Counting them meant this returned
     true from boot with nothing switched on, which held the map at the muted
     grade permanently and kept the lens flare suspended for good. */
function baseHasOverlay() {
  if (!viewer || !baseImageryLayer) return false;
  const L = viewer.imageryLayers;
  for (let i = 0; i < L.length; i++) {
    const l = L.get(i);
    if (l === baseImageryLayer || l.__scenery) continue;
    if (l.show && l.alpha > 0.02) return true;
  }
  return false;
}

/* Two grades, because the base map has two jobs and they pull opposite ways.
   With nothing on it, it IS the picture and wants contrast and saturation --
   that is the grade Don signed off for the realistic globe. With reflectivity
   painted over it, it is context, and the same grade fights the data: ESRI's
   imagery over CONUS is bright green and tan, and 20 dBZ blue sitting on it is
   almost unreadable. Every broadcast radar app mutes its base for exactly this
   reason. Switchable, and the switch says what it does. */
function gradeBaseImagery() {
  if (!baseImageryLayer) return;
  const photographic = settings.imageryBase !== 'streets' && settings.imageryBase !== 'topo';
  const muted = settings.dimBaseUnderData !== false && baseHasOverlay();
  if (muted) {
    baseImageryLayer.brightness = 0.58;
    baseImageryLayer.contrast   = photographic ? 1.18 : 1.02;
    baseImageryLayer.saturation = photographic ? 0.34 : 0.42;
    baseImageryLayer.gamma      = 1.08;
  } else {
    baseImageryLayer.brightness = 1.0;
    baseImageryLayer.contrast   = photographic ? 1.40 : 1.0;
    baseImageryLayer.saturation = photographic ? 1.25 : 1.0;
    baseImageryLayer.gamma      = photographic ? 0.95 : 1.0;
  }
  syncLensFlare();
  viewer?.scene.requestRender();
}

// ---------- Boundary / imagery opacity sliders -----------------------------

function applyBoundaryOpacity(which) {
  if (!viewer) return;
  const map = { countries: countriesDS, states: statesDS, cities: citiesDS };
  const ds = map[which];
  if (!ds) return;
  const targetAlpha = which === 'countries' ? settings.opCountries
                    : which === 'states'    ? settings.opStates
                    : settings.opCities;
  const t = viewer.clock.currentTime;
  for (const e of ds.entities.values) {
    if (e.polyline?.material instanceof Cesium.ColorMaterialProperty) {
      const c = e.polyline.material.color.getValue(t);
      if (c) e.polyline.material = new Cesium.ColorMaterialProperty(c.withAlpha(targetAlpha));
    }
    if (e.label?.fillColor) {
      // Cities slider scales the label fill alpha; country/state labels keep
      // their own fade-by-distance behaviour. We treat opCities as a master.
      if (which === 'cities') {
        const c = e.label.fillColor.getValue(t);
        if (c) e.label.fillColor = c.withAlpha(targetAlpha);
      }
    }
    if (e.point?.color && which === 'cities') {
      const c = e.point.color.getValue(t);
      if (c) e.point.color = c.withAlpha(Math.min(1, targetAlpha + 0.15));
    }
  }
  viewer.scene.requestRender();
}

function applyImageryOpacity(which) {
  if (!viewer) return;
  const v = which === 'radar'   ? settings.opRadar
          : which === 'clouds'  ? settings.opClouds
          : which === 'aurora'  ? settings.opAurora
          : which === 'parcels' ? settings.opParcels
          : 1.0;
  // Radar is a stack of per-frame layers owned by the timeline; only the
  // frame currently on screen should carry the opacity, the rest stay at 0.
  if (which === 'radar') {
    for (const [idx, l] of TL.layers) l.alpha = idx === TL.index ? v : 0;
    viewer.scene.requestRender();
    return;
  }
  const layer = which === 'clouds'  ? cloudsLayer
              : which === 'aurora'  ? auroraLayer
              : which === 'parcels' ? parcelsUSLayer
              : null;
  if (layer) layer.alpha = v;
  viewer.scene.requestRender();
}

// ---------- Performance preset ---------------------------------------------

/* Level-of-detail tolerance: how much screen-space error a terrain tile may
   carry before it is subdivided. Lower = more tiles = sharper and slower.

   ★ This used to write `viewer.scene.maximumScreenSpaceError`, which is not a
   Cesium property. Scene has no such member, so the assignment created an
   expando that nothing reads and the globe sat at Cesium's default of 2 no
   matter which preset was selected. Proved by setting the Scene property to 4
   and reading the globe's, which stayed at 2. High, Balanced and Low were the
   same picture at the same cost for the life of the app.

   High is therefore 2, not the 1.5 the old code asked for: 2 is what the globe
   has actually been rendering at, it is what the look was graded against, and
   dropping to 1.5 now would be a 12-39% tile increase presented as a fix.
   Measured tiles at 1.5 / 2 / 3 / 4 over four camera heights:
     hemisphere 18 / 11 / 11 /  5
     CONUS      42 / 37 / 23 / 18
     metro      28 / 28 / 12 / 12 */
const SSE_PRESET = { high: 2.0, balanced: 3.0, low: 4.0 };

// While the camera is moving there is nothing to see in the extra subdivision,
// and moving is exactly when the frame budget is tight. Cesium ships this idea
// for 3D Tiles as dynamicScreenSpaceError; the globe has no equivalent, so it
// is done here.
const SSE_WHILE_MOVING = 6.0;
const SSE_SETTLE_MS = 220;
let _sseSettle = null;

function restingSSE() {
  return SSE_PRESET[settings.perfPreset] || SSE_PRESET.high;
}

function applyPerfPreset(preset) {
  if (!viewer) return;
  settings.perfPreset = SSE_PRESET[preset] ? preset : 'high';
  viewer.scene.globe.maximumScreenSpaceError = restingSSE();
  viewer.scene.requestRender();
}

function initDynamicLod() {
  const coarsen = () => {
    if (viewer.scene.globe.maximumScreenSpaceError !== SSE_WHILE_MOVING) {
      viewer.scene.globe.maximumScreenSpaceError = SSE_WHILE_MOVING;
    }
    clearTimeout(_sseSettle);
    _sseSettle = setTimeout(() => {
      viewer.scene.globe.maximumScreenSpaceError = restingSSE();
      viewer.scene.requestRender();
    }, SSE_SETTLE_MS);
  };
  // moveStart/moveEnd alone are too coarse: a continuous drag fires moveStart
  // once and the settle timer would restore full detail mid-gesture.
  viewer.camera.changed.addEventListener(coarsen);
  viewer.camera.moveStart.addEventListener(coarsen);
  viewer.camera.percentageChanged = 0.02;
}

// ---------- North America lock ---------------------------------------------
//
// Don's brief: "I want it to stay centered on North America ... with the
// sunlight and darkness rotating in real time around the Earth."
//
// Those two requirements only coexist because Cesium renders in an
// earth-fixed frame: the continents are nailed to the globe, and the *sun*
// is what moves. So holding the camera over NA costs nothing and the
// terminator still sweeps across at the true 15°/hour. The lock exists to
// stop idle-rotate and stray inertia from drifting off-continent; it
// re-centres only after the user has stopped interacting, so panning and
// zooming still feel free.
let _naLockHandle = null;

function applyNorthAmericaLock(on) {
  if (_naLockHandle) { clearInterval(_naLockHandle); _naLockHandle = null; }
  if (!on || !viewer) return;

  // Any interaction defers the re-centre so we never fight the user's hand.
  if (!applyNorthAmericaLock._installed) {
    applyNorthAmericaLock._installed = true;
    const reset = () => { _lastInteractionAt = performance.now(); };
    ['mousedown','wheel','keydown','touchstart','pointerdown'].forEach(ev => {
      document.addEventListener(ev, reset, { passive: true });
    });
    reset();
  }

  const SETTLE_MS   = 12_000;   // hands-off grace period before re-centring
  const DRIFT_DEG   = 12;       // only correct once we're this far off centre
  const MIN_ALT_M   = 3_000_000; // zoomed in? leave the user where they are

  _naLockHandle = setInterval(() => {
    if (!viewer || !viewer.camera) return;
    if (performance.now() - _lastInteractionAt < SETTLE_MS) return;
    let carto;
    try { carto = Cesium.Cartographic.fromCartesian(viewer.camera.position); } catch { return; }
    if (!carto || carto.height < MIN_ALT_M) return;

    const lon = Cesium.Math.toDegrees(carto.longitude);
    const lat = Cesium.Math.toDegrees(carto.latitude);
    const dLon = Math.abs(((lon - NA_HOME.lon + 540) % 360) - 180);
    const dLat = Math.abs(lat - NA_HOME.lat);
    if (dLon < DRIFT_DEG && dLat < DRIFT_DEG) return;   // close enough

    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(NA_HOME.lon, NA_HOME.lat, carto.height),
      duration: 2.2,
      easingFunction: Cesium.EasingFunction.QUADRATIC_IN_OUT,
    });
  }, 4000);
}

// ---------- Auto-rotate when idle ------------------------------------------

let _idleHandle = null;
let _idleStart = 0;
let _lastInteractionAt = 0;
function applyIdleRotate(seconds) {
  const sec = Number(seconds) | 0;
  if (_idleHandle) { cancelAnimationFrame(_idleHandle); _idleHandle = null; }
  if (sec <= 0) return;  // disabled
  // Reset on any user interaction
  if (!applyIdleRotate._installed) {
    applyIdleRotate._installed = true;
    const reset = () => { _lastInteractionAt = performance.now(); };
    ['mousedown','wheel','keydown','touchstart','pointerdown'].forEach(ev => {
      document.addEventListener(ev, reset, { passive: true });
    });
    reset();
  }
  // Only rotate when the camera is at or above this altitude — zoomed-in views
  // shouldn't drift away from whatever the user was looking at.
  const ROTATE_MIN_ALT_M = 5_000_000;          // 5 Mm
  // Slow, contemplative spin — ~1.5°/s gives a full revolution in ~4 minutes.
  const ROTATE_DEG_PER_SEC = 1.5;

  let lastFrameAt = performance.now();
  function tick() {
    const now = performance.now();
    const dt = (now - lastFrameAt) / 1000;
    lastFrameAt = now;
    const idleMs = now - _lastInteractionAt;
    if (idleMs > sec * 1000 && viewer && viewer.camera) {
      try {
        const carto = Cesium.Cartographic.fromCartesian(viewer.camera.position);
        if (carto && carto.height >= ROTATE_MIN_ALT_M) {
          viewer.camera.rotateRight(Cesium.Math.toRadians(ROTATE_DEG_PER_SEC) * dt);
          viewer.scene.requestRender();
        }
      } catch {}
    }
    _idleHandle = requestAnimationFrame(tick);
  }
  _idleHandle = requestAnimationFrame(tick);
}

// ---------- Diagnostics overlay ---------------------------------------------

let _diagHandle = null;
let _diagFrames = 0;
let _diagLastTick = 0;
function applyDiagnostics(on) {
  const el = document.getElementById('diagnostics-overlay');
  if (!el) return;
  if (!on) {
    el.classList.add('hidden');
    if (_diagHandle) { cancelAnimationFrame(_diagHandle); _diagHandle = null; }
    return;
  }
  el.classList.remove('hidden');
  _diagFrames = 0;
  _diagLastTick = performance.now();
  const fpsEl = document.getElementById('diag-fps');
  const msEl  = document.getElementById('diag-ms');
  const entEl = document.getElementById('diag-ent');
  function tick() {
    _diagFrames++;
    const now = performance.now();
    if (now - _diagLastTick >= 500) {
      const fps = (_diagFrames * 1000) / (now - _diagLastTick);
      const ms = (now - _diagLastTick) / _diagFrames;
      if (fpsEl) fpsEl.textContent = fps.toFixed(0);
      if (msEl)  msEl.textContent  = ms.toFixed(1);
      let total = 0;
      if (viewer) {
        for (let i = 0; i < viewer.dataSources.length; i++) {
          total += viewer.dataSources.get(i).entities.values.length;
        }
      }
      if (entEl) entEl.textContent = total.toLocaleString();
      _diagFrames = 0;
      _diagLastTick = now;
    }
    _diagHandle = requestAnimationFrame(tick);
  }
  _diagHandle = requestAnimationFrame(tick);
}

// ---------- Ambient sound ---------------------------------------------------

let _ambientCtx = null;
let _ambientNodes = null;
function applyAmbientSound(on) {
  if (!on) {
    if (_ambientNodes) {
      try {
        _ambientNodes.osc1.stop();
        _ambientNodes.osc2.stop();
      } catch {}
      _ambientNodes = null;
    }
    return;
  }
  try {
    if (!_ambientCtx) _ambientCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (_ambientCtx.state === 'suspended') _ambientCtx.resume();
    // Two slightly-detuned sine drones + a low-pass filter. Quiet by design.
    const ctx = _ambientCtx;
    const out = ctx.createGain();
    out.gain.value = 0.03;
    out.connect(ctx.destination);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 200;
    lp.connect(out);
    const osc1 = ctx.createOscillator(); osc1.type = 'sine'; osc1.frequency.value = 65;
    const osc2 = ctx.createOscillator(); osc2.type = 'sine'; osc2.frequency.value = 73;
    osc1.connect(lp); osc2.connect(lp);
    osc1.start(); osc2.start();
    _ambientNodes = { osc1, osc2, gain: out };
  } catch (e) {
    console.warn('Ambient sound init failed:', e);
  }
}

function drawParcelsWA(features) {
  const ds = parcelsWADS;
  ds.entities.removeAll();

  const stroke   = Cesium.Color.fromCssColorString('#fcd34d').withAlpha(0.92);
  const fill     = Cesium.Color.fromCssColorString('#fde68a').withAlpha(0.05);
  const fillHi   = Cesium.Color.fromCssColorString('#fde68a').withAlpha(0.18);

  for (const f of features) {
    const g = f.geometry;
    if (!g) continue;
    const props = f.properties || {};
    const rings = (g.type === 'Polygon')      ? [g.coordinates]
                : (g.type === 'MultiPolygon') ?  g.coordinates
                : null;
    if (!rings) continue;
    for (const poly of rings) {
      const outer = (poly && poly[0]) || [];
      if (outer.length < 3) continue;
      const flat = [];
      for (const [lon, lat] of outer) {
        if (typeof lon === 'number' && typeof lat === 'number') flat.push(lon, lat);
      }
      if (flat.length < 6) continue;
      const positions = Cesium.Cartesian3.fromDegreesArray(flat);
      const pid = props.PARCEL_ID_NR || '';
      ds.entities.add({
        id: `parcels_wa:${pid}:${flat[0].toFixed(5)},${flat[1].toFixed(5)}`,
        polygon: {
          hierarchy: positions,
          material: fill,
          outline: false,            // we draw the outline as a separate polyline so it stays crisp
          height: 0,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        },
        polyline: {
          positions,
          width: 1.2,
          material: stroke,
          clampToGround: true,
        },
        properties: {
          kind: 'parcels_wa',
          id: pid,
          parcel_id: pid,
          address: props.SITUS_ADDRESS || '',
          city: props.SITUS_CITY_NM || '',
          county_fips: props.COUNTY_NM || '',
          value_land: props.VALUE_LAND,
          value_bldg: props.VALUE_BLDG,
          value_total: (props.VALUE_LAND || 0) + (props.VALUE_BLDG || 0),
          landuse_cd: props.LANDUSE_CD,
        },
      });
      void fillHi;  // reserved for hover-state styling
    }
  }
  setCount('parcels_wa', features.length);
  updateCategoryCounts();
}

// ---------- Compass + tilt indicator ----------------------------------------

function updateCompass() {
  const rose = document.getElementById('cmp-rose');
  const tilt = document.getElementById('cmp-tilt');
  if (!rose || !tilt || !viewer) return;
  const headingDeg = -Cesium.Math.toDegrees(viewer.camera.heading);
  const pitchDeg   =  Cesium.Math.toDegrees(viewer.camera.pitch);
  rose.style.transform = `rotate(${headingDeg}deg)`;
  // Pitch: -90 (looking straight down) → tilt line is flat;
  //          0 (looking at horizon)   → tilt line rotates fully
  const tiltAngle = (pitchDeg + 90);  // 0..90 typically
  tilt.style.transform = `rotate(${(tiltAngle * 0.4).toFixed(1)}deg)`;
}

// ---------- Click ripple ----------------------------------------------------
//
// On every left-click, plant a ground-clamped ring at the picked position and
// animate its radius outward + alpha down over ~900 ms, then remove it.

let rippleDS = null;
function spawnClickRipple(screenPos) {
  if (!rippleDS) {
    rippleDS = new Cesium.CustomDataSource('ripple');
    viewer.dataSources.add(rippleDS);
  }
  const ray = viewer.camera.getPickRay(screenPos);
  if (!ray) return;
  const cart = viewer.scene.globe.pick(ray, viewer.scene);
  if (!cart) return;

  const start = Date.now();
  const DUR = 900;
  const camDist = Cesium.Cartesian3.distance(viewer.camera.position, cart);
  const peakRadius = Math.min(2_000_000, Math.max(2000, camDist * 0.04));

  const radiusProp = new Cesium.CallbackProperty(() => {
    const t = Math.min(1, (Date.now() - start) / DUR);
    return peakRadius * (0.2 + 0.8 * t);
  }, false);
  const colorProp = new Cesium.CallbackProperty(() => {
    const t = Math.min(1, (Date.now() - start) / DUR);
    return Cesium.Color.fromCssColorString('#4dd2ff').withAlpha(0.7 * (1 - t));
  }, false);

  const ent = rippleDS.entities.add({
    position: cart,
    ellipse: {
      semiMajorAxis: radiusProp,
      semiMinorAxis: radiusProp,
      material: Cesium.Color.TRANSPARENT,
      outline: true,
      outlineColor: colorProp,
      outlineWidth: 2.0,
      height: 0,
    },
  });
  setTimeout(() => { try { rippleDS.entities.remove(ent); } catch {} }, DUR + 60);
}

// ---------- Pulse animation on critical alert markers -----------------------
//
// Cesium can't keyframe directly, but a CallbackProperty re-evaluated each
// frame gives us a sine-driven pulse. We walk the active alert markers each
// time alerts refresh and (re)wire their pixelSize to a pulsing function.

// Pulse the highest-priority alert markers only — capped at PULSE_CAP entities
// total so we never have hundreds of CallbackProperties driving the render
// loop. Volcanoes are intentionally excluded: there can be 100+ "active in
// last 10 years" and pulsing them all is expensive and visually noisy.
const PULSE_ATTACHED = new WeakSet();
const PULSE_CAP = 12;

function attachPulseToAlertEntities() {
  const candidates = [];

  // Tsunamis (rare, always pulse)
  if (entitiesByLayer.tsunamis) for (const e of entitiesByLayer.tsunamis.values()) {
    candidates.push({ e, prio: 100 });
  }
  // Active launches within ±1 h
  if (entitiesByLayer.launches) for (const e of entitiesByLayer.launches.values()) {
    const p = e.properties.getValue ? e.properties.getValue() : e.properties;
    const dt = p.net ? (Date.parse(p.net) - Date.now()) / 3.6e6 : null;
    if (dt != null && Math.abs(dt) < 1) candidates.push({ e, prio: 90 });
  }
  // Fresh M5+ quakes only — drop M4+ to keep the count down
  if (entitiesByLayer.quakes) for (const e of entitiesByLayer.quakes.values()) {
    const p = e.properties.getValue ? e.properties.getValue() : e.properties;
    if (typeof p.mag === 'number' && p.mag >= 5) candidates.push({ e, prio: 80 + p.mag });
  }
  // Severe Wx — only the highest-tier types
  if (entitiesByLayer.severe) for (const e of entitiesByLayer.severe.values()) {
    const p = e.properties.getValue ? e.properties.getValue() : e.properties;
    const ev = (p.event || '').toLowerCase();
    if (ev.includes('tornado') || ev.includes('flash flood')) candidates.push({ e, prio: 70 });
  }

  candidates.sort((a, b) => b.prio - a.prio);
  const want = candidates.slice(0, PULSE_CAP);

  for (const { e: ent } of want) {
    if (PULSE_ATTACHED.has(ent) || !ent.point) continue;
    const orig = (ent.point.pixelSize && ent.point.pixelSize.getValue)
                 ? ent.point.pixelSize.getValue() : ent.point.pixelSize;
    if (typeof orig !== 'number') continue;
    ent.point.pixelSize = new Cesium.CallbackProperty(() => {
      const t = Date.now() / 1000;
      return orig + Math.sin(t * 4.4) * orig * 0.30;
    }, false);
    PULSE_ATTACHED.add(ent);
  }
}

// ---------- Right-click context menu ----------------------------------------

let ctxLatLon = null;
function showContextMenu(x, y, latLon) {
  const m = document.getElementById('ctx-menu');
  if (!m) return;
  ctxLatLon = latLon;
  document.getElementById('ctx-coord').textContent =
    `${latLon.lat.toFixed(2)}, ${latLon.lon.toFixed(2)}`;
  m.style.left = `${x + 4}px`;
  m.style.top  = `${y + 4}px`;
  m.classList.remove('hidden');
}
function hideContextMenu() {
  const m = document.getElementById('ctx-menu');
  if (m) m.classList.add('hidden');
  ctxLatLon = null;
}
function initContextMenu() {
  const m = document.getElementById('ctx-menu');
  if (!m) return;
  m.addEventListener('click', (e) => {
    const it = e.target.closest('.ctx-item');
    if (!it) return;
    const act = it.dataset.act;
    if (act === 'center' && ctxLatLon) {
      const carto = Cesium.Cartographic.fromCartesian(viewer.camera.position);
      const alt = carto ? carto.height : 1.5e6;
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(ctxLatLon.lon, ctxLatLon.lat, alt),
        duration: 1.0,
      });
    } else if (act === 'preset' && ctxLatLon) {
      const name = prompt('Preset name?');
      if (name) saveCameraPreset(name);
    }
    hideContextMenu();
  });
  // Click anywhere else closes
  document.addEventListener('mousedown', (e) => {
    if (!m.contains(e.target)) hideContextMenu();
  });
}

// ---------- Camera presets --------------------------------------------------

const PRESETS_KEY = 'graticule.presets.v1';

function loadPresets() {
  try { return JSON.parse(localStorage.getItem(PRESETS_KEY) || '[]'); } catch { return []; }
}
function persistPresets(list) {
  try { localStorage.setItem(PRESETS_KEY, JSON.stringify(list)); } catch {}
}

function saveCameraPreset(name) {
  const c = viewer.camera;
  const carto = Cesium.Cartographic.fromCartesian(c.position);
  if (!carto) return;
  const list = loadPresets();
  list.push({
    name,
    lat: Cesium.Math.toDegrees(carto.latitude),
    lon: Cesium.Math.toDegrees(carto.longitude),
    alt: carto.height,
    heading: c.heading,
    pitch: c.pitch,
    roll: c.roll,
  });
  persistPresets(list);
  renderPresetsList();
}

function flyToPreset(p) {
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(p.lon, p.lat, p.alt),
    orientation: { heading: p.heading, pitch: p.pitch, roll: p.roll },
    duration: 1.4,
  });
}

function renderPresetsList() {
  const host = document.getElementById('presets-list');
  const empty = document.getElementById('presets-empty');
  if (!host || !empty) return;
  const list = loadPresets();
  host.innerHTML = '';
  empty.style.display = list.length ? 'none' : '';
  list.forEach((p, i) => {
    const row = document.createElement('div');
    row.className = 'preset-row';
    row.innerHTML = `<span class="preset-name">${escapeHtml(p.name)}</span>
      <span class="ctx-meta">${p.lat.toFixed(1)}, ${p.lon.toFixed(1)}</span>
      <button class="preset-del" aria-label="Delete">×</button>`;
    row.querySelector('.preset-name').addEventListener('click', () => flyToPreset(p));
    row.querySelector('.preset-del').addEventListener('click', () => {
      const cur = loadPresets();
      cur.splice(i, 1);
      persistPresets(cur);
      renderPresetsList();
    });
    host.appendChild(row);
  });
}

// ---------- Recent-clicked history strip -----------------------------------

const HISTORY_MAX = 5;
const history = [];

function pushHistory(entity) {
  const props = entity.properties.getValue ? entity.properties.getValue() : entity.properties;
  if (!props || !props.kind) return;
  const summary = summarizeEntity(props);
  const item = {
    eid: entity.id,
    label: summary.title || props.id || 'Object',
    kind: props.kind,
    pos: entity.position && entity.position.getValue ? entity.position.getValue(Cesium.JulianDate.now()) : null,
  };
  // Dedup by entity id
  const existing = history.findIndex(h => h.eid === item.eid);
  if (existing >= 0) history.splice(existing, 1);
  history.unshift(item);
  if (history.length > HISTORY_MAX) history.length = HISTORY_MAX;
  renderHistoryStrip();
}

function renderHistoryStrip() {
  const host = document.getElementById('history-strip');
  if (!host) return;
  host.innerHTML = '';
  for (const h of history) {
    const el = document.createElement('div');
    el.className = 'hist-item';
    el.innerHTML = `<span class="hist-dot" style="background:${dotColorFor(h.kind)}"></span><span>${escapeHtml(h.label)}</span>`;
    el.title = `${h.kind} · ${h.label}`;
    el.addEventListener('click', () => {
      if (!h.pos) return;
      viewer.camera.flyTo({
        destination: h.pos,
        duration: 1.0,
        offset: new Cesium.HeadingPitchRange(0, -Math.PI / 3, 800_000),
      });
      // Try to re-open the panel for that entity
      const ds = dataSources[h.kind];
      if (ds) {
        const matches = ds.entities.values.filter(e => e.id === h.eid);
        if (matches[0]) showPanel(matches[0]);
      }
    });
    host.appendChild(el);
  }
}

function dotColorFor(kind) {
  const v = (COLORS[kind] && COLORS[kind].toCssColorString) ? COLORS[kind].toCssColorString() : '#94a3b8';
  return v;
}

// ---------- Sound effects ---------------------------------------------------

let audioCtx = null;
function ensureAudio() {
  if (audioCtx) return audioCtx;
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  } catch { audioCtx = null; }
  return audioCtx;
}

function beep({ freq = 660, dur = 0.18, gain = 0.08 } = {}) {
  if (!soundOn()) return;
  const ctx = ensureAudio(); if (!ctx) return;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = 'sine';
  o.frequency.value = freq;
  g.gain.value = 0;
  o.connect(g); g.connect(ctx.destination);
  const now = ctx.currentTime;
  g.gain.linearRampToValueAtTime(gain, now + 0.01);
  g.gain.linearRampToValueAtTime(0,    now + dur);
  o.start(now);
  o.stop(now + dur);
}

function soundOn() {
  const cb = document.getElementById('sound-alerts');
  return !!(cb && cb.checked);
}

function maybeBeepForNewAlerts(prevSet, newAlerts) {
  if (!soundOn()) return;
  for (const a of newAlerts) {
    if (prevSet.has(a.kind + ':' + a.id)) continue;
    if (a.kind === 'tsunamis') beep({ freq: 880, dur: 0.32, gain: 0.10 });
    else if (a.kind === 'launches' && a.sev === 'active') beep({ freq: 990, dur: 0.18 });
  }
}

// ---------- Telemetry digit-roll on text change -----------------------------

function rollText(el, newText) {
  if (!el) return;
  if (el.textContent === newText) return;
  el.textContent = newText;
  el.classList.remove('rolling'); void el.offsetWidth; el.classList.add('rolling');
}

// ---------- Plane feed status surfacing ------------------------------------
// (OpenSky anonymous tier 429s often. Acknowledge in the layer label so Don
// can tell at a glance whether it's a feed problem vs nothing-there.)

function refreshPlaneStatus() {
  const layer = document.querySelector('input[data-layer="planes"]');
  if (!layer) return;
  const last = feedActivity['planes'];
  const ageSec = last ? (Date.now() - last) / 1000 : null;
  const lbl = layer.parentElement.querySelector('.lbl');
  if (!lbl) return;
  if (ageSec == null)         lbl.textContent = 'Planes';
  else if (ageSec > 90)       lbl.textContent = 'Planes (rate-limited)';
  else                        lbl.textContent = 'Planes';
}

// ═══════════════════════════════════════════════════════════════════════════
// PRO REWORK — tabs, mode chips, radar timeline, colour legend, WORLD pane
//
// Shape borrowed from the apps that scored highest in the 2026 radar-app
// survey: a tabbed left rail, mode chips inside the weather tab, a transport
// timeline for animating frames, and an always-visible colour scale.
// ═══════════════════════════════════════════════════════════════════════════

// ---------- Tabs + mode chips ----------------------------------------------

// Where the operator is, in two words. The rail head prints this instead of a
// second copy of the wordmark, so the panel has a title.
let RAIL_TAB = 'data';
let RAIL_DIV = 'radar';
const DIVISION_TITLE = {
  radar: 'RADAR', model: 'MODEL', satellite: 'SATELLITE',
  obs: 'OBSERVATIONS', outlooks: 'OUTLOOKS', mapping: 'MAPPING',
  earth: 'EARTH', sky: 'SKY', world: 'WORLD',
};

/* One plain line under the title saying what is in here. Nine division names
   on their own tell you nothing about which one holds the thing you want, and
   "I'm not even sure what to click" is what that costs. Written as the answer
   to a question somebody would actually ask, not as a restatement of the
   name -- "Outlooks: where severe weather is expected later today" is useful;
   "Outlooks: outlook products" is not. */
const DIVISION_SUB = {
  radar:     'Where it is raining, now and 30 minutes out',
  model:     'What the forecast models expect, up to 24 hours ahead',
  satellite: 'Cloud tops from GOES, visible and infrared',
  obs:       'What stations, cameras and spotters are reporting on the ground',
  outlooks:  'Where severe weather, tropical systems and aurora are expected',
  mapping:   'The base map, boundaries and what the frame covers',
  earth:     'Quakes, volcanoes, fires, ships and water levels',
  sky:       'Aircraft, airspace, satellites and launches',
  world:     'Live world population, births, deaths and country ranks',
};
const TAB_SUB = {
  alerts:    'Every NWS product in effect right now',
  broadcast: 'The graphics that stay on screen in presentation mode',
};

function syncRailTitle() {
  const el = document.getElementById('rail-title');
  const sub = document.getElementById('rail-sub');
  if (!el) return;
  el.textContent = RAIL_TAB === 'alerts'    ? 'NWS ALERTS'
                 : RAIL_TAB === 'broadcast' ? 'BROADCAST'
                 : (DIVISION_TITLE[RAIL_DIV] || 'DATA');
  if (sub) {
    sub.textContent = TAB_SUB[RAIL_TAB] || DIVISION_SUB[RAIL_DIV] || '';
  }
}

function initTabs() {
  const tabs  = Array.from(document.querySelectorAll('.hud-tab'));
  const panes = Array.from(document.querySelectorAll('.hud-pane'));
  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const name = tab.dataset.tab;
      tabs.forEach((t) => {
        const on = t === tab;
        t.classList.toggle('is-active', on);
        t.setAttribute('aria-selected', String(on));
      });
      panes.forEach((p) => p.classList.toggle('is-active', p.dataset.pane === name));
      try { localStorage.setItem('graticule.tab', name); } catch {}
      RAIL_TAB = name;
      syncRailTitle();
      // The timeline only makes sense against an animatable imagery layer.
      syncTimelineVisibility();
      syncRailScrollEdges();      // same reason as the division switch below
    });
  });

  // Restore last tab. The rail used to have five tabs (WEATHER / EARTH / SKY /
  // WORLD / GFX); four of those are divisions inside Data now, so a stored
  // name from before the change is translated rather than ignored -- otherwise
  // anyone whose last session ended on EARTH gets a rail that looks reset.
  const TAB_ALIAS = {
    weather: 'data', earth: 'data', sky: 'data', world: 'data', graphics: 'broadcast',
  };
  const DIVISION_FROM_TAB = { earth: 'earth', sky: 'sky', world: 'world' };
  let saved = null;
  try { saved = localStorage.getItem('graticule.tab'); } catch {}
  if (saved) {
    const t = tabs.find((x) => x.dataset.tab === (TAB_ALIAS[saved] || saved));
    if (t) t.click();
  }

  // Divisions inside the Data tab.
  const chips  = Array.from(document.querySelectorAll('#wx-modes .chip'));
  const bodies = Array.from(document.querySelectorAll('[data-mode-body]'));
  const selectDivision = (name) => {
    const chip = chips.find((c) => c.dataset.mode === name);
    if (!chip) return false;
    chips.forEach((c) => c.classList.toggle('is-active', c === chip));
    bodies.forEach((b) => b.classList.toggle('is-active', b.dataset.modeBody === name));
    applyLegendFor(name);
    try { localStorage.setItem('graticule.division', name); } catch {}
    RAIL_DIV = name;
    syncRailTitle();
    railStatusRender();
    // Swapping divisions replaces the whole content of the scrolling box, and
    // neither of the events that normally drive the scroll edges is reliable
    // here: the browser clamps scrollTop silently rather than dispatching a
    // scroll, and the ResizeObserver was measured landing 450-600ms late. For
    // that window the rail claimed there was more above a division that fits
    // in one screen. A division switch is an explicit action with a handler,
    // so it says so directly instead of waiting to be noticed.
    syncRailScrollEdges();
    return true;
  };
  chips.forEach((chip) => {
    chip.addEventListener('click', () => selectDivision(chip.dataset.mode));
  });

  // Restore the division too, preferring the one implied by an old tab name.
  let div = null;
  try { div = localStorage.getItem('graticule.division'); } catch {}
  selectDivision(DIVISION_FROM_TAB[saved] || div || 'radar');
}

// ---------- Radar / satellite timeline --------------------------------------
//
// RainViewer publishes both a past series and a nowcast series in one meta
// blob. The survey singled out weather.com for making past-vs-future
// ambiguous, so we keep them on one track with an explicit NOW marker and
// label every frame with a relative offset.

// How many frames either side of the current one stay visible to the renderer.
// 1 buys a full frame interval of tile-fetch lead time at a cost of 3 imagery
// layers compositing instead of 13. See showFrame.
const RADAR_PREFETCH = 1;

const TL = {
  frames: [],        // [{ time:<epoch s>, path, kind:'past'|'forecast' }]
  index: 0,
  playing: false,
  timer: null,
  speedMs: 600,
  layers: new Map(), // frame index -> Cesium ImageryLayer (lazily built)
};

function buildRadarFrames() {
  if (!radarMeta || !radarMeta.host) return [];
  const past = (radarMeta.past || []).map((f) => ({ ...f, kind: 'past' }));
  const fut  = (radarMeta.nowcast || []).map((f) => ({ ...f, kind: 'forecast' }));
  return past.concat(fut);
}

function initTimeline() {
  const range = document.getElementById('tl-range');
  const play  = document.getElementById('tl-play');
  const prev  = document.getElementById('tl-prev');
  const next  = document.getElementById('tl-next');
  const speed = document.getElementById('tl-speed');
  if (!range) return;

  range.addEventListener('input', () => { stopTimeline(); showFrame(Number(range.value)); });
  play.addEventListener('click', () => (TL.playing ? stopTimeline() : startTimeline()));
  prev.addEventListener('click', () => { stopTimeline(); showFrame(TL.index - 1); });
  next.addEventListener('click', () => { stopTimeline(); showFrame(TL.index + 1); });
  speed.addEventListener('change', () => {
    TL.speedMs = Number(speed.value) || 600;
    if (TL.playing) { stopTimeline(); startTimeline(); }
  });

  // The end labels are relative to now, so they go stale between frame
  // updates: RainViewer publishes roughly every ten minutes, and the track was
  // still claiming "-2h 05m" when the oldest frame was two and a quarter hours
  // old. Caught by tl_test comparing the label against the frames a minute
  // after they were drawn.
  setInterval(labelTimelineEnds, 30_000);
}

function refreshTimeline() {
  TL.frames = buildRadarFrames();
  const range = document.getElementById('tl-range');
  if (!range || !TL.frames.length) return;
  range.max = String(TL.frames.length - 1);
  // Default to the newest observed frame, not the furthest forecast.
  const lastPast = TL.frames.map((f) => f.kind).lastIndexOf('past');
  TL.index = lastPast >= 0 ? lastPast : TL.frames.length - 1;
  range.value = String(TL.index);
  positionNowMarker();
  showFrame(TL.index);
  syncTimelineVisibility();
}

function positionNowMarker() {
  const el = document.getElementById('tl-now');
  if (!el || !TL.frames.length) return;
  const lastPast = TL.frames.map((f) => f.kind).lastIndexOf('past');
  const pct = TL.frames.length > 1 ? (lastPast / (TL.frames.length - 1)) * 100 : 100;
  el.style.left = `${pct}%`;
  // The marker sits on the newest OBSERVED frame, which is the boundary
  // between what happened and what is predicted. With a nowcast behind it that
  // boundary is effectively now and "NOW" is the broadcast convention. With
  // no nowcast -- and RainViewer's is often empty, measured at 12 frames all
  // past, the newest 7 minutes old -- the same marker sat at 100% of the track
  // calling a seven-minute-old frame "now".
  const hasForecast = lastPast >= 0 && lastPast < TL.frames.length - 1;
  el.dataset.label = hasForecast ? 'NOW' : 'LATEST';
  el.title = hasForecast ? 'now: observed to the left, nowcast to the right'
                         : 'the newest observed frame; no nowcast is published right now';
  labelTimelineEnds();
}

/* How far back the loop reaches and how far the nowcast runs, written on the
   ends of the track. RainViewer's window is not fixed -- the past series is
   whatever it has cached and the nowcast is whatever it has produced -- so
   these are read off the frames rather than stated as a constant. */
function labelTimelineEnds() {
  const from = document.getElementById('tl-from');
  const to   = document.getElementById('tl-to');
  if (!from || !to || !TL.frames.length) return;
  const now = Date.now();
  const mins = (f) => Math.round((f.time * 1000 - now) / 60000);
  const span = (m) => {
    const a = Math.abs(m);
    if (a < 60) return `${a}m`;
    return `${Math.floor(a / 60)}h ${String(a % 60).padStart(2, '0')}m`;
  };
  const first = mins(TL.frames[0]);
  const last  = mins(TL.frames[TL.frames.length - 1]);
  from.textContent = first < 0 ? `-${span(first)}` : span(first);
  to.textContent   = last > 0 ? `+${span(last)}` : (last === 0 ? 'now' : `-${span(last)}`);
  // With no nowcast the end of the track IS the LATEST marker, and a second
  // label there lands under the marker and the frame chip both. The right end
  // only earns a label when there is forecast beyond the marker to measure.
  to.hidden = !TL.frames.some((f) => f.kind === 'forecast');
}

function syncTimelineVisibility() {
  const tl = document.getElementById('timeline');
  const on = isLayerOn('radar') && TL.frames.length > 1;
  if (tl) tl.classList.toggle('hidden', !on);
  // The frame stamp used to be hidden alongside the transport. It is now the
  // Data Readout graphic, which names whatever product is on the globe, so it
  // has no business disappearing because radar happens to be off.
  if (!on) GFX.stamp = null;
  gfxRender();
}

// Frames are swapped by alpha rather than add/remove: rebuilding an imagery
// provider per tick caused a visible black flash between frames.
function showFrame(i) {
  if (!TL.frames.length) return;
  const n = TL.frames.length;
  TL.index = ((i % n) + n) % n;
  const frame = TL.frames[TL.index];

  const layer = ensureFrameLayer(TL.index);
  if (layer) {
    // alpha AND show, but show over a WINDOW rather than just the current
    // frame.
    //
    // alpha 0 hides a layer from the eye and not from the renderer: Cesium
    // composites every imagery layer whose `show` is true into every rendered
    // globe tile, so a 13-frame loop had each tile blending 15 layers to
    // display 3. Measured after one pass: 15 imagery layers, 15 shown, 12 of
    // them at alpha 0.
    //
    // ★ Hiding all the others is not free, and the first attempt broke the
    // loop: Cesium does not request tiles for a hidden imagery layer, so every
    // frame's tiles were fetched in one burst at the instant it became current.
    // At 600 ms a frame RainViewer answered that burst with 125 CORS-less error
    // responses -- zero before the change. The window is a prefetch: a frame is
    // shown one step before it is needed, which is a whole frame interval of
    // lead time, and the tiles are already in the cache when it is displayed.
    for (const [idx, l] of TL.layers) {
      const current = idx === TL.index;
      // Distance measured around the loop, because playback wraps.
      const n = TL.frames.length;
      const d = Math.min((idx - TL.index + n) % n, (TL.index - idx + n) % n);
      const on = d <= RADAR_PREFETCH;
      l.alpha = current ? Number(settings.opRadar) : 0;
      if (l.show !== on) l.show = on;
    }
  }

  const range = document.getElementById('tl-range');
  if (range) range.value = String(TL.index);
  const fill = document.getElementById('tl-fill');
  if (fill) fill.style.width = `${(TL.index / Math.max(1, n - 1)) * 100}%`;

  const when = new Date(frame.time * 1000);
  const rel  = Math.round((frame.time * 1000 - Date.now()) / 60000);
  const relTxt = rel === 0 ? 'now' : rel > 0 ? `+${rel}m` : `${rel}m`;
  const hh = String(when.getUTCHours()).padStart(2, '0');
  const mm = String(when.getUTCMinutes()).padStart(2, '0');

  const lbl = document.getElementById('tl-label');
  if (lbl) lbl.textContent = `${hh}:${mm}Z ${relTxt}`;
  // Product over source on the left, time over date on the right.
  setStamp(frame.kind === 'forecast' ? 'RADAR FORECAST' : 'BASE REFLECTIVITY',
           frame.kind === 'forecast' ? 'RainViewer nowcast' : 'RainViewer composite',
           when);

  viewer.scene.requestRender();
}

/* Hand the loaded frame's identity to the Data Readout graphic. `when` is the
   frame's VALID time, not the wall clock: an animating loop that stamps "now"
   on a frame from 40 minutes ago is the exact ambiguity the readout exists to
   remove. The graphic decides how to draw it. */
function setStamp(product, source, when) {
  GFX.stamp = { kind: product, src: source, when };
  gfxRender();
}

function ensureFrameLayer(i) {
  if (TL.layers.has(i)) return TL.layers.get(i);
  const frame = TL.frames[i];
  if (!frame || !radarMeta || !radarMeta.host) return null;
  // NOTE: frame.path already carries the "/v2/radar/<id>" prefix straight from
  // RainViewer's index, so it must be concatenated onto the host as-is.
  // Re-adding "/v2/radar/" here yields ".../v2/radar//v2/radar/<id>/..." and
  // every tile 404s — which is exactly what the layer was silently doing.
  const layer = viewer.imageryLayers.addImageryProvider(new Cesium.UrlTemplateImageryProvider({
    url: `${radarMeta.host}${frame.path}/256/{z}/{x}/{y}/4/1_1.png`,
    credit: 'Radar © RainViewer',
    // RainViewer's radar cache stops at z7; without the cap Cesium requests
    // deeper tiles as you zoom in and those 404 too.
    minimumLevel: 0, maximumLevel: 7,
  }));
  layer.alpha = 0;
  // Born hidden: until it is inside showFrame's prefetch window it must not
  // cost a composite on every rendered tile.
  layer.show = false;
  TL.layers.set(i, layer);
  return layer;
}

function clearFrameLayers() {
  for (const l of TL.layers.values()) {
    try { viewer.imageryLayers.remove(l); } catch {}
  }
  TL.layers.clear();
}

function startTimeline() {
  if (!TL.frames.length) return;
  TL.playing = true;
  const btn = document.getElementById('tl-play');
  if (btn) btn.textContent = '❚❚';
  TL.timer = setInterval(() => showFrame(TL.index + 1), TL.speedMs);
}

function stopTimeline() {
  TL.playing = false;
  const btn = document.getElementById('tl-play');
  if (btn) btn.textContent = '▶';
  if (TL.timer) { clearInterval(TL.timer); TL.timer = null; }
}

// ---------- Colour scale legend ---------------------------------------------
//
// NWS reflectivity ramp. Having the scale on screen is table stakes for every
// app in the survey; without it the radar colours are unreadable.
const SCALES = {
  radar: {
    title: 'REFLECTIVITY', unit: 'dBZ',
    stops: ['#04e9e7', '#019ff4', '#0300f4', '#02fd02', '#01c501', '#008e00',
            '#fdf802', '#e5bc00', '#fd9500', '#fd0000', '#d40000', '#bc0000',
            '#f800fd', '#9854c6'],
    ticks: ['5', '20', '35', '50', '65', '75'],
  },
  satellite: {
    title: 'CLOUD TOP', unit: '°C',
    stops: ['#000000', '#3b3b3b', '#7a7a7a', '#c8c8c8', '#ffffff',
            '#00ffff', '#0080ff', '#00ff00', '#ffff00', '#ff0000'],
    ticks: ['+40', '+10', '-20', '-50', '-80'],
  },
};

// Controls that only act on a layer are dead weight while that layer is off,
// and a live-looking control that does nothing is the thing that makes an app
// feel unfinished. Each is tagged data-requires="<layer>" in the markup.
// The selector used to be `.ctl[data-requires]`, which is narrower than the
// markup and let the exact thing this function exists to prevent through the
// gap: the radar product list is a plain `<div data-requires="radar_site">`
// with no `.ctl` class, so with Local Hi-Res Site switched OFF the rail still
// showed six product buttons with "Super-Res Reflectivity" highlighted as the
// live selection, while the readout above the map said BASE REFLECTIVITY /
// RAINVIEWER COMPOSITE. Two surfaces disagreeing about what is on screen, and
// the one you can click is the one that is wrong.
//
// Buttons are disabled alongside selects and inputs for the same reason -- a
// `<select>` was the only control type the old loop knew about.
function syncControlAvailability() {
  document.querySelectorAll('[data-requires]').forEach((row) => {
    const cb = document.querySelector(`input[data-layer="${row.dataset.requires}"]`);
    const live = !!(cb && cb.checked);
    row.classList.toggle('is-off', !live);
    row.querySelectorAll('select, input, button').forEach((el) => { el.disabled = !live; });
  });
}

// A legend describes what is on the globe, not which tab happens to be open.
// Showing a dBZ ramp over a globe with no radar on it is worse than showing
// nothing: it implies the colours out there mean something.
const LEGEND_LAYERS = {
  radar: ['radar', 'radar_site'],
  satellite: ['clouds'],
};

function legendModeIsLive(mode) {
  const layers = LEGEND_LAYERS[mode];
  if (!layers) return true;
  return layers.some((l) => {
    const cb = document.querySelector(`input[data-layer="${l}"]`);
    return cb && cb.checked;
  });
}

function refreshLegend() {
  if (document.querySelector('input[data-layer="model"]')?.checked) return;
  applyLegendFor(currentWxMode());
}

function applyLegendFor(mode) {
  const el = document.getElementById('legend');
  if (!el) return;
  const scale = SCALES[mode];
  if (!scale || !legendModeIsLive(mode)) { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  document.getElementById('lg-title').textContent = scale.title;
  document.getElementById('lg-unit').textContent  = scale.unit;
  // Vertical, pinned to the right edge of the map, the way every broadcast
  // radar app draws a colour scale. 0deg runs bottom-to-top, so the stops keep
  // their low-to-high order and the tick column is reversed to match.
  document.getElementById('lg-bar').style.background =
    `linear-gradient(0deg, ${scale.stops.join(', ')})`;
  document.getElementById('lg-ticks').innerHTML =
    scale.ticks.slice().reverse().map((t) => `<span>${t}</span>`).join('');
}

// ---------- WORLD pane -------------------------------------------------------
//
// Live world-population telemetry, matching the reference dashboard: a running
// total, today's births/deaths/growth, per-continent and per-country ranks, and
// a next-milestone tracker.
//
// Provenance matters here. There is no public real-time population feed — the
// dashboards that show one are all extrapolating a demographic projection
// forward at a constant rate, and so are we. Baselines below are UN World
// Population Prospects 2024 (medium variant) mid-2025 estimates with their
// published annual rates; the counters interpolate from a fixed epoch. That
// makes the running digits an honest projection, not a measurement, which is
// why the pane labels its source.

const WPP_EPOCH = Date.UTC(2025, 6, 1) / 1000;   // 2025-07-01, UN reference date

// [name, mid-2025 population, annual growth rate]
const WORLD_BASE = { pop: 8_231_613_070, rate: 0.0085 };

const CONTINENTS = [
  ['Asia',          4_827_100_000, 0.0060],
  ['Africa',        1_549_700_000, 0.0230],
  ['Europe',          744_800_000, -0.0009],
  ['Latin America',   669_600_000, 0.0069],
  ['North America',   388_500_000, 0.0056],
  ['Oceania',          46_600_000, 0.0113],
];

const COUNTRIES = [
  ['India',        1_463_900_000, 0.0089],
  ['China',        1_416_100_000, -0.0023],
  ['United States',  347_300_000, 0.0054],
  ['Indonesia',      285_700_000, 0.0079],
  ['Pakistan',       255_200_000, 0.0157],
  ['Nigeria',        237_500_000, 0.0241],
  ['Brazil',         212_800_000, 0.0041],
  ['Bangladesh',     175_700_000, 0.0111],
  ['Russia',         143_997_000, -0.0043],
  ['Ethiopia',       135_500_000, 0.0255],
  ['Mexico',         131_900_000, 0.0084],
  ['Japan',          123_100_000, -0.0051],
  ['Egypt',          118_400_000, 0.0154],
  ['Philippines',    116_800_000, 0.0139],
  ['DR Congo',       112_800_000, 0.0321],
];

// Vital rates. These were 4.24 and 2.51 per second, and they were wrong in a
// way the pane displayed against itself: 2.51 deaths/s is 79.2M a year against
// the UN's ~62M, and births-minus-deaths came to 54.6M a year while the
// odometer directly above it grew at WORLD_BASE.rate, 70.0M a year. The same
// panel disagreed with itself by 22%.
//
// That is the exact defect the world board's header calls out in the source it
// replicates -- "the board's TODAY panel and its THIS YEAR panel disagree with
// each other" -- and we had shipped our own copy of it one screen away. Both
// surfaces now derive from the single pair below, so births - deaths is 70.0M
// a year and matches the growth the total is actually accumulating.
// Declared here, not next to the board, because `const` has no hoisting: the
// board's copies are 1,600 lines further down and reading them from here would
// throw on load.
const WORLD_YEAR_S = 31_556_952;              // mean tropical year, seconds
const WORLD_BIRTHS_PER_YEAR = 132_000_000;    // UN WPP 2024
const WORLD_DEATHS_PER_YEAR = 62_000_000;     // UN WPP 2024
const BIRTHS_PER_SEC = WORLD_BIRTHS_PER_YEAR / WORLD_YEAR_S;
const DEATHS_PER_SEC = WORLD_DEATHS_PER_YEAR / WORLD_YEAR_S;

/* The rate the world odometer climbs at, and it is deliberately NOT the sum of
   the dataset's per-country rates.

   world_population.json is 217 World Bank rows whose population-weighted rate
   is 0.970%/yr, and projecting each country separately compounds that to about
   84M a year. Measured against the panel directly underneath, which says
   births minus deaths is 70M a year, that is the same defect this file already
   fixed once: a counter disagreeing with the breakdown printed below it.

   One of the two has to be wrong and it is the summed rate. 132M births and
   62M deaths is a coherent demographic system that the UN publishes as such;
   0.970% is an aggregate of country rates that each carry their own net
   migration and was never meant to be summed into a world figure. No pair of
   credible birth and death numbers produces it -- holding the UN's births
   would require 48M deaths, holding its deaths would require 146M births, and
   both are far outside the published range.

   So the headline total keeps the real country data as its BASE, because that
   is what every row on the board adds up to, and grows at the rate the vitals
   describe. Country and continent rows still project at their own rates, since
   a ranking needs each country's actual growth; they therefore drift from the
   headline by about 0.12%/yr, roughly 10M after a full year, until the data is
   rebaked. That is a real and stated limitation rather than a number nobody
   can reconcile. */
const WORLD_GROWTH_RATE =
  (WORLD_BIRTHS_PER_YEAR - WORLD_DEATHS_PER_YEAR) / 8_231_613_070;

// Compound the annual rate over elapsed years since the epoch.
function project(base, rate, nowSec) {
  const years = (nowSec - WPP_EPOCH) / 31_556_952;   // mean tropical year
  return base * Math.pow(1 + rate, years);
}

function fmtInt(n) { return Math.floor(n).toLocaleString('en-US'); }

function secondsIntoUtcDay(d) {
  return d.getUTCHours() * 3600 + d.getUTCMinutes() * 60 + d.getUTCSeconds();
}

/* The rail pane and the full board, on one dataset.

   `WD.data` is world_population.json, loaded by loadWorldData(). The rows are
   aggregated once and cached, because only the projection moves between ticks;
   the total is re-summed each tick since that is what the board's odometer
   does and the two have to track each other exactly.

   Returns null until the file has loaded, and the caller falls back to the UN
   constants -- a pane that shows nothing for a second is worse than a pane
   that shows a slightly different number for a second. */
const WORLD_SRC = { key: null, continents: [], countries: [], base: 0 };

/* The one place the world total is computed. Both the rail odometer and the
   full board call this, so there is no second answer to drift from the first. */
function worldTotalNow() {
  if (!WORLD_SRC.base) return project(WORLD_BASE.pop, WORLD_BASE.rate, Date.now() / 1000);
  return wdProject(WORLD_SRC.base, WORLD_GROWTH_RATE, Date.now() / 1000, WD.epoch);
}

function worldPaneSource() {
  const data = WD.data;
  if (!data || !Array.isArray(data.countries) || !data.countries.length) return null;

  if (WORLD_SRC.key !== data.year) {
    // Continent base is the sum of its countries; its rate is their
    // population-weighted mean, which is the same aggregation the board's
    // static build does. Anything else and the continent rows would not add
    // up to the total sitting above them.
    const agg = new Map();
    for (const c of data.countries) {
      const t = agg.get(c.continent) || { pop: 0, w: 0 };
      t.pop += c.pop;
      t.w += c.pop * c.rate;
      agg.set(c.continent, t);
    }
    WORLD_SRC.continents = [...agg.entries()]
      .map(([name, t]) => [name, t.pop, t.pop ? t.w / t.pop : 0])
      .sort((a, b) => b[1] - a[1]);
    WORLD_SRC.countries = (WD.ranked || data.countries).slice(0, 15)
      .map((c) => [c.name, c.pop, c.rate]);
    WORLD_SRC.base = data.countries.reduce((s, c) => s + c.pop, 0);
    WORLD_SRC.key = data.year;
  }

  return { total: worldTotalNow(), epoch: WD.epoch,
           continents: WORLD_SRC.continents, countries: WORLD_SRC.countries };
}

let _worldTimer = null;
function initWorldPane() {
  renderWorldStatic();
  // The pane needs the same file the board does, and until now only opening
  // the board fetched it -- so the rail ran on the fallback constants for the
  // whole session unless you happened to click through. 40KB, once.
  loadWorldData().catch((err) => console.warn('world population data:', err.message));
  if (_worldTimer) clearInterval(_worldTimer);
  _worldTimer = setInterval(updateWorldPane, 1000);
  updateWorldPane();
}

/* The note has to name the source actually on screen. It said UN WPP
   unconditionally, which stopped being true the moment the pane started
   reading world_population.json -- and a citation that names the wrong source
   is worse than none. */
function renderWorldStatic(live) {
  const src = document.getElementById('wp-src');
  if (!src) return;
  const txt = live
    ? `Projected from World Bank Open Data (SP.POP.TOTL, SP.POP.GROW), ` +
      `mid-${WD.data.year} baseline. Vital rates UN WPP 2024. Counters ` +
      `interpolate the published growth rate — a projection, not a live census.`
    : 'Projected from UN World Population Prospects 2024 (medium variant), ' +
      'mid-2025 baseline. Counters interpolate the published growth rate — ' +
      'a projection, not a live census.';
  if (src.textContent !== txt) src.textContent = txt;
}

function updateWorldPane() {
  // Only compute while the division is on screen; this ticks every second.
  // World stopped being a top-level tab when the rail moved to Weatherfront's
  // shape -- it is a division inside Data now, so the gate is the mode body.
  const pane = document.querySelector('[data-mode-body="world"]');
  if (!pane || !pane.classList.contains('is-active')) return;
  const tab = document.querySelector('.hud-pane[data-pane="data"]');
  if (!tab || !tab.classList.contains('is-active')) return;

  const now = Date.now() / 1000;
  const d   = new Date();
  const dayS = secondsIntoUtcDay(d);

  // Prefer the dataset the full board runs on. Measured at the same instant,
  // the pane said 8,308,414,237 and the board said 8,284,390,050 -- twenty-four
  // million people apart, on the headline number of the feature, on a board you
  // reach by clicking a button in the pane. The continent rows disagreed too
  // (Asia by 18M, Europe by 2.4M), because these were two entirely parallel
  // datasets: UN WPP constants baked into this file against World Bank figures
  // in world_population.json.
  //
  // The board's is the one that has to win. Its total is the sum of its own
  // country rows, so every number on it adds up; the constant here was a
  // standalone figure that agreed with nothing else on screen.
  const live = worldPaneSource();
  const total = live ? live.total
                     : project(WORLD_BASE.pop, WORLD_BASE.rate, now);
  setText('wp-total', fmtInt(total));

  const births = dayS * BIRTHS_PER_SEC;
  const deaths = dayS * DEATHS_PER_SEC;
  setText('wp-births', fmtInt(births));
  setText('wp-deaths', fmtInt(deaths));
  setText('wp-growth', fmtInt(births - deaths));

  const epoch = live ? live.epoch : WPP_EPOCH;
  renderRank('wp-continents', live ? live.continents : CONTINENTS, now, epoch);
  renderRank('wp-countries',  live ? live.countries  : COUNTRIES,  now, epoch);
  renderWorldStatic(live);
  renderMilestone(total);
}

function setText(id, txt) {
  const el = document.getElementById(id);
  if (el && el.textContent !== txt) el.textContent = txt;
}

/* `epochSec` matters as much as the figures do. The UN constants are a mid-2025
   baseline and world_population.json is mid-2024, so projecting World Bank rows
   from the UN epoch would compound a year of growth that has already happened
   and put the rail back out of step with the board it feeds. */
function renderRank(containerId, rows, nowSec, epochSec = WPP_EPOCH) {
  const el = document.getElementById(containerId);
  if (!el) return;
  const html = rows.map((r, i) => {
    const [name, base, rate] = r;
    const v = wdProject(base, rate, nowSec, epochSec);
    const dir = rate >= 0 ? 'up' : 'down';
    const arrow = rate >= 0 ? '▲' : '▼';
    return `<li><span class="r-i">${i + 1}</span>` +
           `<span class="r-n">${name}</span>` +
           `<span class="r-v">${fmtInt(v)}</span>` +
           `<span class="r-d ${dir}">${arrow}</span></li>`;
  }).join('');
  if (el.innerHTML !== html) el.innerHTML = html;
}

// Next round-billion milestone, with time-to-arrival from the current rate.
function renderMilestone(total) {
  const el = document.getElementById('wp-milestone');
  if (!el) return;
  const next = (Math.floor(total / 1e8) + 1) * 1e8;      // next 100 M step
  const perSec = total * WORLD_BASE.rate / 31_556_952;
  const etaSec = perSec > 0 ? (next - total) / perSec : 0;
  const days = etaSec / 86400;
  const prevStep = next - 1e8;
  const pct = Math.max(0, Math.min(100, ((total - prevStep) / 1e8) * 100));
  const eta = days >= 1 ? `${days.toFixed(1)} d` : `${(days * 24).toFixed(1)} h`;
  el.innerHTML =
    `<div class="wp-ms-row"><span class="wp-ms-name">${fmtInt(next)}</span>` +
    `<span class="wp-ms-val">ETA ${eta}</span></div>` +
    `<div class="wp-ms-bar"><div class="wp-ms-fill" style="width:${pct.toFixed(2)}%"></div></div>`;
}

// ---------- SKY tab celestial mirrors ---------------------------------------
// The realism switches live in Settings but are also surfaced on the SKY tab,
// so bind both to the same handlers and keep them in sync.
function initSkyMirrors() {
  const pairs = [
    ['sky-moon',        'showMoon',      applyMoon],
    ['sky-stars',       'showStars',     applyStars],
    ['sky-nightlights', 'nightLights',   toggleNightLights],
    ['sky-sunlighting', 'sunLighting',   applySunLighting],
  ];
  for (const [id, key, fn] of pairs) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.checked = !!settings[key];
    el.addEventListener('change', () => {
      settings[key] = el.checked;
      saveSettings();
      fn(el.checked);
      const twin = document.getElementById(
        { showMoon: 'show-moon', showStars: 'show-stars',
          nightLights: 'night-lights', sunLighting: 'sun-lighting' }[key]);
      if (twin) twin.checked = el.checked;
    });
  }
}

// ---------- Weather-tab control wiring --------------------------------------

// A handful of NEXRAD sites covering the CONUS + Alaska/Hawaii/PR. The survey
// treats "Local Hi-Res Radar" as a separate capability from national mosaic
// because the single-site product is higher resolution and lower latency.
const NEXRAD_SITES = [
  ['KTLX', 'Oklahoma City, OK',   35.333, -97.278],
  ['KFWS', 'Dallas/Fort Worth, TX', 32.573, -97.303],
  ['KHGX', 'Houston, TX',         29.472, -95.079],
  ['KLCH', 'Lake Charles, LA',    30.125, -93.216],
  ['KLIX', 'New Orleans, LA',     30.337, -89.826],
  ['KRAX', 'Raleigh-Durham, NC',  35.666, -78.490],
  ['KLWX', 'Washington, DC',      38.975, -77.478],
  ['KOKX', 'New York, NY',        40.866, -72.864],
  ['KBOX', 'Boston, MA',          41.956, -71.137],
  ['KCLE', 'Cleveland, OH',       41.413, -81.860],
  ['KLOT', 'Chicago, IL',         41.605, -88.085],
  ['KMPX', 'Minneapolis, MN',     44.849, -93.565],
  ['KDMX', 'Des Moines, IA',      41.731, -93.723],
  ['KEAX', 'Kansas City, MO',     38.810, -94.264],
  ['KFTG', 'Denver, CO',          39.787, -104.546],
  ['KABX', 'Albuquerque, NM',     35.150, -106.824],
  ['KIWA', 'Phoenix, AZ',         33.289, -111.670],
  ['KVTX', 'Los Angeles, CA',     34.412, -119.179],
  ['KMUX', 'San Francisco, CA',   37.155, -121.898],
  ['KATX', 'Seattle, WA',         48.195, -122.496],
  ['KRTX', 'Portland, OR',        45.715, -122.965],
  ['KMLB', 'Melbourne, FL',       28.113, -80.654],
  ['KAMX', 'Miami, FL',           25.611, -80.413],
  ['KTBW', 'Tampa, FL',           27.706, -82.402],
  ['KFFC', 'Atlanta, GA',         33.364, -84.566],
  ['KOHX', 'Nashville, TN',       36.247, -86.563],
  ['KSHV', 'Shreveport, LA',      32.451, -93.841],
  ['PHKI', 'Kauai, HI',           21.894, -159.552],
  ['PAHG', 'Anchorage, AK',       60.726, -151.351],
  ['TJUA', 'San Juan, PR',        18.116, -66.078],
];

let radarSiteLayer = null;

function populateRadarSites() {
  const sel = document.getElementById('radar-site');
  if (!sel || sel.dataset.filled) return;
  sel.dataset.filled = '1';
  for (const [id, name] of NEXRAD_SITES) {
    const o = document.createElement('option');
    o.value = id;
    o.textContent = `${id} — ${name}`;
    sel.appendChild(o);
  }
}

// Nearest site to the current camera centre, so "— nearest —" does something
// sensible instead of defaulting to an arbitrary station.
function nearestRadarSite() {
  try {
    const c = Cesium.Cartographic.fromCartesian(viewer.camera.position);
    const lat = Cesium.Math.toDegrees(c.latitude);
    const lon = Cesium.Math.toDegrees(c.longitude);
    let best = NEXRAD_SITES[0], bestD = Infinity;
    for (const s of NEXRAD_SITES) {
      const d = (s[2] - lat) ** 2 + (s[3] - lon) ** 2;
      if (d < bestD) { bestD = d; best = s; }
    }
    return best[0];
  } catch { return 'KTLX'; }
}

// IEM RIDGE product codes, every one of them verified 200 at KDMX, KMPX and
// KFWS before it was listed. The ones NOT here were checked too and answer
// 503: N0R, DVL, DAA, NTP and the whole dual-pol set (N0X/N0C/N0K/N0H), plus
// every higher tilt (N1Q, N2Q, N3Q and their velocity twins) — which is why
// the division carries no tilt selector.
const RIDGE_PRODUCT = {
  reflectivity:        'N0B',   // super-res base reflectivity, 0.5°
  reflectivity_legacy: 'N0Q',   // legacy base reflectivity, 0.5°
  velocity:            'N0U',   // base velocity
  srv:                 'N0S',   // storm relative velocity
  longrange:           'N0Z',   // long-range reflectivity
  echotops:            'NET',   // echo tops
};

// Iowa State Mesonet serves per-site NEXRAD as public XYZ tiles — no key.
function toggleRadarSite(on) {
  if (!on) {
    if (radarSiteLayer) {
      const ref = radarSiteLayer; radarSiteLayer = null;
      fadeImageryLayer(ref, ref.alpha, 0, LAYER_FADE_MS, () => viewer.imageryLayers.remove(ref));
    }
    return;
  }
  rebuildRadarSiteLayer();
}

function rebuildRadarSiteLayer() {
  if (!viewer) return;
  if (radarSiteLayer) {
    try { viewer.imageryLayers.remove(radarSiteLayer); } catch {}
    radarSiteLayer = null;
  }
  const sel  = document.getElementById('radar-site');
  const prod = document.getElementById('radar-product');
  const site = (sel && sel.value) || nearestRadarSite();
  const kind = RIDGE_PRODUCT[(prod && prod.value)] || 'N0B';

  // A single-site product only exists inside that radar's ~460 km range.
  // Without a bounding rectangle Cesium requests tiles for the whole globe and
  // every one outside coverage 404s. 5 degrees is a comfortable envelope.
  const meta = NEXRAD_SITES.find((s) => s[0] === site);
  const rect = meta
    ? Cesium.Rectangle.fromDegrees(meta[3] - 5, meta[2] - 5, meta[3] + 5, meta[2] + 5)
    : undefined;

  // IEM's per-site RIDGE caches are named "ridge::<SITE>-<PRODUCT>-<tilt>".
  // A bare "<SITE>-<PRODUCT>" 404s on every tile — verified against the live
  // service, not assumed.
  radarSiteLayer = viewer.imageryLayers.addImageryProvider(new Cesium.UrlTemplateImageryProvider({
    url: `https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/ridge::${site}-${kind}-0/{z}/{x}/{y}.png`,
    credit: 'NEXRAD © Iowa State Mesonet',
    rectangle: rect,
    minimumLevel: 4,
    maximumLevel: 9,
  }));
  fadeImageryLayer(radarSiteLayer, 0, Number(settings.opRadar) || 0.7);

  // RadarScope's header: the product on top, the station and its city under
  // it. NEXRAD_SITES already carries the city, so the stamp can name the
  // station properly instead of showing a bare four-letter ICAO id.
  if (isLayerOn('radar_site')) {
    const entry = NEXRAD_SITES.find((s) => s[0] === site);
    setStamp(kind === 'N0U' ? 'BASE VELOCITY' : 'SUPER-RES REFLECTIVITY',
             entry ? `${site} · ${entry[1]}` : site,
             new Date());
  }
}

// Satellite product switch. RainViewer carries infrared; NOAA GIBS carries the
// true-colour composite, so the selector spans both providers.
function rebuildCloudsLayer() {
  const sel = document.getElementById('sat-product');
  const product = (sel && sel.value) || 'ir';
  if (cloudsLayer) {
    try { viewer.imageryLayers.remove(cloudsLayer); } catch {}
    cloudsLayer = null;
  }
  const source = valueOf('sat-source', 'goes-east');
  let provider;

  // Live GOES imagery from Iowa State Mesonet — near-real-time visible,
  // infrared and water-vapour channels off the operational satellites, which
  // is what the desktop apps put behind their GOES-East / GOES-West selector.
  const GOES = {
    'goes-east': { vis: 'goes-east-vis-1km', ir: 'goes-east-ir-4km', wv: 'goes-east-wv-4km' },
    'goes-west': { vis: 'goes-west-vis-1km', ir: 'goes-west-ir-4km', wv: 'goes-west-wv-4km' },
  };

  if (source !== 'global' && GOES[source] && GOES[source][product]) {
    provider = new Cesium.UrlTemplateImageryProvider({
      url: `https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/${GOES[source][product]}/{z}/{x}/{y}.png`,
      credit: 'GOES © Iowa State Mesonet / NOAA',
      maximumLevel: 9,
    });
  } else if (product === 'truecolor') {
    // Global daily true-colour composite for the whole-Earth view, where the
    // GOES products only cover their own hemisphere.
    const day = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    provider = new Cesium.UrlTemplateImageryProvider({
      url: `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_CorrectedReflectance_TrueColor/default/${day}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`,
      tilingScheme: new Cesium.WebMercatorTilingScheme(),
      maximumLevel: 9,
      credit: 'NASA GIBS · MODIS True Color',
    });
  } else {
    if (!radarMeta || !radarMeta.host) return;
    const sat = radarMeta.satellite || [];
    if (!sat.length) return;
    const latest = sat[sat.length - 1];
    // Same as radar: latest.path already includes the "/v2/satellite/<id>"
    // prefix, so concatenate it onto the host rather than rebuilding it.
    provider = new Cesium.UrlTemplateImageryProvider({
      url: `${radarMeta.host}${latest.path}/256/{z}/{x}/{y}/0/0_0.png`,
      credit: 'Clouds © RainViewer',
      minimumLevel: 0, maximumLevel: 7,
    });
  }
  cloudsLayer = viewer.imageryLayers.addImageryProvider(provider);
  fadeImageryLayer(cloudsLayer, 0, Number(settings.opClouds) || 0.55);
}

function initWeatherControls() {
  populateRadarSites();

  const bind = (id, fn) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', fn);
  };
  bind('radar-site',    () => { if (isLayerOn('radar_site')) rebuildRadarSiteLayer(); });
  bind('radar-product', () => { if (isLayerOn('radar_site')) rebuildRadarSiteLayer(); });
  bind('sat-product',   () => { if (isLayerOn('clouds'))     rebuildCloudsLayer(); });
  bind('sat-source',    () => { if (isLayerOn('clouds'))     rebuildCloudsLayer(); });
  bind('spc-day',       () => { if (isLayerOn('spc_outlook')) rebuildSpcOutlook(); });
  bind('model-name',    () => refreshModelField());
  bind('model-field',   () => refreshModelField());
  bind('obs-field',     () => renderMetar());
  bind('lsr-hours',     () => { if (isLayerOn('lsr')) refreshLsr(); });

  // Opacity sliders in the weather tab mirror the ones in Settings; both write
  // the same setting so the two panels can never disagree.
  const mirror = (id, key, twinId, apply) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.value = String(settings[key]);
    const out = document.getElementById(`${id}-val`);
    if (out) out.textContent = Number(settings[key]).toFixed(2);
    el.addEventListener('input', () => {
      settings[key] = Number(el.value);
      saveSettings();
      if (out) out.textContent = Number(el.value).toFixed(2);
      const twin = document.getElementById(twinId);
      if (twin) {
        twin.value = el.value;
        const tOut = document.getElementById(`${twinId}-val`);
        if (tOut) tOut.textContent = Number(el.value).toFixed(2);
      }
      apply();
    });
  };
  mirror('op-radar-2',  'opRadar',  'op-radar',  () => {
    applyImageryOpacity('radar');
    if (radarSiteLayer) radarSiteLayer.alpha = Number(settings.opRadar);
  });
  mirror('op-clouds-2', 'opClouds', 'op-clouds', () => applyImageryOpacity('clouds'));
}

// ---------- SPC convective outlook ------------------------------------------
//
// Served through our own backend rather than fetched straight from spc.noaa.gov
// because SPC does not send CORS headers, so a direct browser fetch is blocked.

let spcDS = null;

const SPC_COLORS = {
  TSTM: '#c1e9c1', MRGL: '#66a366', SLGT: '#ffe066',
  ENH:  '#e6a23c', MDT:  '#e06666', HIGH: '#ee82ee',
};

function toggleSpcOutlook(on) {
  if (!spcDS) {
    spcDS = new Cesium.CustomDataSource('spc_outlook');
    viewer.dataSources.add(spcDS);
  }
  if (!on) { spcDS.show = false; return; }
  spcDS.show = true;
  rebuildSpcOutlook();
}

async function rebuildSpcOutlook() {
  if (!spcDS) return;
  const daySel = document.getElementById('spc-day');
  const day = (daySel && daySel.value) || '1';
  spcDS.entities.removeAll();
  let gj;
  try {
    const r = await fetch(`/api/spc/outlook?day=${encodeURIComponent(day)}`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    gj = await r.json();
  } catch (err) {
    pushEvent('SPC', `Outlook day ${day} unavailable (${err.message})`, Date.now());
    return;
  }
  for (const f of (gj.features || [])) {
    const label = (f.properties && (f.properties.LABEL || f.properties.label)) || '';
    const color = SPC_COLORS[label] || '#8899aa';
    addSpcGeometry(f.geometry, color, label);
  }
  viewer.scene.requestRender();
}

function addSpcGeometry(geom, color, label) {
  if (!geom) return;
  const rings = geom.type === 'Polygon' ? [geom.coordinates]
              : geom.type === 'MultiPolygon' ? geom.coordinates
              : [];
  for (const poly of rings) {
    const outer = poly[0];
    if (!outer || outer.length < 3) continue;
    spcDS.entities.add({
      polygon: {
        hierarchy: new Cesium.PolygonHierarchy(
          Cesium.Cartesian3.fromDegreesArray(outer.flatMap(([x, y]) => [x, y]))
        ),
        material: Cesium.Color.fromCssColorString(color).withAlpha(0.28),
        outline: true,
        outlineColor: Cesium.Color.fromCssColorString(color).withAlpha(0.9),
        height: 0,
      },
      properties: { kind: 'spc', label },
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// WAVE 3 — real weather data: model fields, air quality, surface obs,
// NWS warning cards, and GOES satellite products.
// ═══════════════════════════════════════════════════════════════════════════

// ---------- Shared colour ramp helper ---------------------------------------

// Piecewise-linear lookup across [stop, '#rrggbb'] pairs.
function rampColor(stops, v) {
  if (v == null || Number.isNaN(v)) return Cesium.Color.GRAY;
  if (v <= stops[0][0]) return Cesium.Color.fromCssColorString(stops[0][1]);
  const last = stops[stops.length - 1];
  if (v >= last[0]) return Cesium.Color.fromCssColorString(last[1]);
  for (let i = 0; i < stops.length - 1; i++) {
    const [a, ca] = stops[i], [b, cb] = stops[i + 1];
    if (v >= a && v <= b) {
      const t = (v - a) / (b - a || 1);
      // Color.lerp is a static on Cesium.Color, not an instance method.
      return Cesium.Color.lerp(
        Cesium.Color.fromCssColorString(ca),
        Cesium.Color.fromCssColorString(cb),
        t, new Cesium.Color());
    }
  }
  return Cesium.Color.GRAY;
}

const FIELD_DEFS = {
  temperature_2m: {
    label: '2 m Temperature', unit: '°F', legend: 'TEMPERATURE',
    stops: [[-20,'#7c3aed'],[0,'#3b82f6'],[32,'#22d3ee'],[50,'#22c55e'],
            [70,'#facc15'],[85,'#f97316'],[100,'#dc2626'],[115,'#7f1d1d']],
    ticks: ['0','32','50','70','85','100'],
  },
  precipitation: {
    label: 'Precipitation', unit: 'in', legend: 'PRECIP',
    stops: [[0,'#0f172a'],[0.01,'#0ea5e9'],[0.1,'#22c55e'],[0.25,'#facc15'],
            [0.5,'#f97316'],[1,'#dc2626'],[2,'#a21caf']],
    ticks: ['0','0.1','0.25','0.5','1','2'],
  },
  wind_speed_10m: {
    label: '10 m Wind', unit: 'mph', legend: 'WIND',
    stops: [[0,'#0f172a'],[5,'#0ea5e9'],[15,'#22c55e'],[25,'#facc15'],
            [40,'#f97316'],[60,'#dc2626'],[80,'#a21caf']],
    ticks: ['0','15','25','40','60','80'],
  },
  cape: {
    label: 'CAPE', unit: 'J/kg', legend: 'CAPE',
    stops: [[0,'#0f172a'],[250,'#0ea5e9'],[1000,'#22c55e'],[2000,'#facc15'],
            [3000,'#f97316'],[4000,'#dc2626'],[6000,'#a21caf']],
    ticks: ['0','1000','2000','3000','4000','6000'],
  },
  pressure_msl: {
    label: 'MSLP', unit: 'hPa', legend: 'PRESSURE',
    stops: [[960,'#7c3aed'],[990,'#3b82f6'],[1005,'#22c55e'],
            [1013,'#facc15'],[1025,'#f97316'],[1040,'#dc2626']],
    ticks: ['980','1000','1013','1025','1040'],
  },

  /* ---- Mesoanalysis -------------------------------------------------------
     The parameters a severe-weather forecaster reads together with CAPE. Two
     of them are not variables Open-Meteo serves, they are derived here; both
     say so in their `note`, because a derived approximation presented as a
     model output is the kind of thing that gets believed.

     SRH, SCP and STP are deliberately absent. All three need a storm motion
     vector, which needs a wind profile Open-Meteo's free tier does not
     expose. Inventing one would produce numbers that look like the SPC
     mesoanalysis and are not. */
  convective_inhibition: {
    label: 'CIN', unit: 'J/kg', legend: 'CIN',
    // Read backwards from the others: high CIN is a LID, so the alarming end
    // of this ramp is the calm end of CAPE's.
    stops: [[0,'#7f1d1d'],[25,'#dc2626'],[50,'#f97316'],[100,'#facc15'],
            [200,'#22c55e'],[400,'#0ea5e9'],[800,'#0f172a']],
    ticks: ['0','50','100','200','400','800'],
  },
  lifted_index: {
    label: 'Lifted Index', unit: '°C', legend: 'LIFTED INDEX', dp: 1,
    stops: [[-10,'#a21caf'],[-8,'#dc2626'],[-5,'#f97316'],[-2,'#facc15'],
            [0,'#22c55e'],[4,'#0ea5e9'],[10,'#0f172a']],
    ticks: ['-8','-5','-2','0','4','10'],
  },
  dew_point_2m: {
    label: '2 m Dewpoint', unit: '°F', legend: 'DEWPOINT',
    stops: [[0,'#7c3aed'],[20,'#3b82f6'],[40,'#22d3ee'],[55,'#22c55e'],
            [65,'#facc15'],[72,'#f97316'],[80,'#dc2626']],
    ticks: ['20','40','55','65','72','80'],
  },
  bulk_shear: {
    label: 'Deep-layer shear', unit: 'mph', legend: 'BULK SHEAR',
    vars: ['wind_speed_10m', 'wind_direction_10m',
           'wind_speed_500hPa', 'wind_direction_500hPa'],
    // Vector difference between the 500 hPa and 10 m winds. 500 hPa sits near
    // 5.5 km, so this stands in for 0-6 km bulk shear; it is not the same
    // quantity and the panel note says so.
    derive: (c, _u) => {
      const rad = Math.PI / 180;
      // Meteorological direction is where the wind comes FROM.
      const u0 = -c.wind_speed_10m * Math.sin(c.wind_direction_10m * rad);
      const v0 = -c.wind_speed_10m * Math.cos(c.wind_direction_10m * rad);
      const u5 = -c.wind_speed_500hPa * Math.sin(c.wind_direction_500hPa * rad);
      const v5 = -c.wind_speed_500hPa * Math.cos(c.wind_direction_500hPa * rad);
      return Math.hypot(u5 - u0, v5 - v0);
    },
    note: 'derived: 500 hPa minus 10 m wind vector, a stand-in for 0-6 km shear',
    stops: [[0,'#0f172a'],[20,'#0ea5e9'],[35,'#22c55e'],[50,'#facc15'],
            [65,'#f97316'],[80,'#dc2626'],[100,'#a21caf']],
    ticks: ['0','20','35','50','65','80'],
  },
  freezing_level_height: {
    label: 'Freezing level', unit: 'kft', legend: 'FREEZING LEVEL', dp: 1,
    vars: ['freezing_level_height'],
    /* Hail forecasting is done in thousands of feet. The conversion reads the
       unit off the response rather than assuming one, because Open-Meteo
       silently switches THIS field to feet when precipitation_unit=inch is
       set -- a parameter about rainfall depth changing the unit of a height.
       Assuming metres put the freezing level at 46-58 kft, above the
       tropopause, which is the only reason it was caught. */
    derive: (c, u) => (u && u.freezing_level_height === 'm')
      ? c.freezing_level_height / 304.8
      : c.freezing_level_height / 1000,
    stops: [[0,'#7c3aed'],[5,'#3b82f6'],[9,'#22d3ee'],[12,'#22c55e'],
            [15,'#facc15'],[18,'#f97316'],[22,'#dc2626']],
    ticks: ['0','5','9','12','15','18'],
  },
};

const AQI_STOPS = [[0,'#22c55e'],[50,'#facc15'],[100,'#f97316'],
                   [150,'#dc2626'],[200,'#7c3aed'],[300,'#7f1d1d']];

// Open-Meteo model ids. "seamless" blends the run sequence, which is what the
// desktop apps show by default for a plain model pick.
const OM_MODELS = {
  gfs:   'gfs_seamless',
  hrrr:  'gfs_hrrr',
  nam:   'ncep_nam_conus',
  ecmwf: 'ecmwf_ifs025',
  icon:  'icon_seamless',
};

// ---------- Grid sampling ----------------------------------------------------
//
// Open-Meteo accepts comma-separated coordinate lists and returns one object
// per point, so an entire field is a single request. The grid is built over
// the current view so zooming in genuinely increases resolution instead of
// just magnifying coarse points.

function viewGrid(stepsX = 14, stepsY = 10) {
  const rect = viewer.camera.computeViewRectangle(viewer.scene.globe.ellipsoid);
  let w, s, e, n;
  if (rect) {
    w = Cesium.Math.toDegrees(rect.west);  e = Cesium.Math.toDegrees(rect.east);
    s = Cesium.Math.toDegrees(rect.south); n = Cesium.Math.toDegrees(rect.north);
  } else {
    w = -125; e = -66; s = 24; n = 50;
  }
  // Guard the antimeridian and absurd global extents; clamp to something the
  // API will answer quickly.
  if (e < w) e += 360;
  if (e - w > 170) { const c = (w + e) / 2; w = c - 85; e = c + 85; }
  if (n - s > 110) { const c = (s + n) / 2; s = c - 55; n = c + 55; }
  s = Math.max(-84, s); n = Math.min(84, n);

  const pts = [];
  for (let iy = 0; iy < stepsY; iy++) {
    for (let ix = 0; ix < stepsX; ix++) {
      const lat = s + ((n - s) * (iy + 0.5)) / stepsY;
      let lon = w + ((e - w) * (ix + 0.5)) / stepsX;
      lon = ((lon + 540) % 360) - 180;
      // Drop points on the far side of the planet. At globe scale the view
      // rectangle spans more than the visible hemisphere, and the plotted
      // points are drawn without depth-testing, so back-face samples would
      // otherwise float in space beyond the limb.
      if (!isFrontFacing(lon, lat)) continue;
      pts.push([Number(lat.toFixed(3)), Number(lon.toFixed(3))]);
    }
  }
  return pts;
}

// True when the surface point faces the camera, i.e. the angle between the
// camera's view direction and the outward surface normal exceeds 90 degrees.
function isFrontFacing(lon, lat) {
  try {
    const surface = Cesium.Cartesian3.fromDegrees(lon, lat);
    const toCamera = Cesium.Cartesian3.subtract(
      viewer.camera.positionWC, surface, new Cesium.Cartesian3());
    const normal = viewer.scene.globe.ellipsoid.geodeticSurfaceNormal(
      surface, new Cesium.Cartesian3());
    return Cesium.Cartesian3.dot(normal, toCamera) > 0;
  } catch {
    return true;
  }
}

// ---------- Model field ------------------------------------------------------

let modelDS = null;
let _modelBusy = false;
// A field change while a fetch is in flight used to return early and never
// re-run, so the select showed CIN while the map still showed temperature:
// chrome lying about state. The request is coalesced instead -- at most one
// re-run is queued, because the user only ever wants the field they landed on.
let _modelPending = false;

/* The sampled field used to be `current=` only, so the model division could
   answer "what is it now" and nothing else -- which is the one question a
   model is not for. It fetches `hourly=` instead and keeps the whole series
   per point, so scrubbing the forecast hour is a re-render off memory rather
   than a refetch. That matters twice over: Open-Meteo rate-limits by request,
   and a scrubber that costs a round trip per step is not a scrubber.

   The window is an explicit start_hour/end_hour of now to now+24, not a day
   count. `forecast_days=2` returns from 00:00 UTC today, so roughly half of
   what came back was already in the past and paid for -- and Open-Meteo prices
   a request by variables x locations x hours, which is why the shear and
   lifted-index fields (four variables over 140 points) are the ones that trip
   its minutely limit first. Verified against the API before relying on it:
   start_hour=...T18:00 & end_hour=...T18:00 returns exactly 25 hours. */
const MODEL_FCST = {
  times: [],      // ISO strings, UTC, starting at the current hour
  series: [],     // one { lon, lat, vars: { name: number[] } } per point
  idx: 0,         // index into times
  now: 0,         // index of the hour containing "now" -- always 0 now
  units: {},
};
/* Open-Meteo prices a request by variables x locations x hours, so a field
   that needs four variables to derive one number costs four times a plain one
   over the same window. Measured: with a flat 24-hour window, five of the six
   mesoanalysis fields sampled 140 points cleanly and `bulk_shear` -- the only
   four-variable field -- answered 429, while the field requested AFTER it
   succeeded. That rules out a cumulative minute quota and points at the single
   request's own weight. The window shortens as the variable count rises, which
   holds the cost roughly flat; six hours still covers the convective window
   that deep-layer shear is read over. */
function modelFcstHours(def) {
  const n = (def && def.vars ? def.vars.length : 1) || 1;
  return Math.max(6, Math.round(24 / n));
}

/* "2026-08-04T18:00", which is the shape Open-Meteo's hour window takes. */
function omHour(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`
       + `T${p(d.getUTCHours())}:00`;
}

function toggleModelField(on) {
  if (!modelDS) {
    modelDS = new Cesium.CustomDataSource('model');
    viewer.dataSources.add(modelDS);
  }
  modelDS.show = !!on;
  if (on) refreshModelField();
  else applyLegendFor(currentWxMode());
}

async function refreshModelField() {
  if (!modelDS || !modelDS.show) return;
  if (_modelBusy) { _modelPending = true; return; }
  _modelBusy = true;
  const noteEl = document.getElementById('model-note');
  try {
    const modelKey = valueOf('model-name', 'gfs');
    const fieldKey = valueOf('model-field', 'temperature_2m');
    const def = FIELD_DEFS[fieldKey];
    const pts = viewGrid();
    const lat = pts.map((p) => p[0]).join(',');
    const lon = pts.map((p) => p[1]).join(',');

    // A derived field needs several variables; a plain one needs itself.
    const wanted = (def.vars || [fieldKey]).join(',');
    const params = new URLSearchParams({
      latitude: lat, longitude: lon,
      hourly: wanted,
      start_hour: omHour(new Date()),
      end_hour: omHour(new Date(Date.now() + modelFcstHours(def) * 3600_000)),
      timezone: 'UTC',
      models: OM_MODELS[modelKey] || 'gfs_seamless',
      temperature_unit: 'fahrenheit',
      wind_speed_unit: 'mph',
      precipitation_unit: 'inch',
    });
    if (noteEl) noteEl.textContent = `Loading ${def.label} from ${modelKey.toUpperCase()}…`;

    const r = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    let data = await r.json();
    if (!Array.isArray(data)) data = [data];

    // Cache the series, then let the renderer draw whichever hour is selected.
    const wantedVars = def.vars || [fieldKey];
    MODEL_FCST.times = (data.find((d) => d && d.hourly && d.hourly.time) || {}).hourly?.time || [];
    MODEL_FCST.units = (data[0] || {}).hourly_units || {};
    MODEL_FCST.series = data
      .filter((d) => Number.isFinite(d?.longitude) && Number.isFinite(d?.latitude) && d.hourly)
      .map((d) => ({
        lon: d.longitude, lat: d.latitude,
        vars: Object.fromEntries(wantedVars.map((v) => [v, d.hourly[v] || []])),
      }));

    // The window is requested from the current hour, so index 0 is t+0. Found
    // rather than assumed, because a service that quietly widens the window
    // would otherwise silently relabel every hour.
    const nowIso = new Date().toISOString().slice(0, 13);
    const found = MODEL_FCST.times.findIndex((t) => String(t).slice(0, 13) === nowIso);
    MODEL_FCST.now = found >= 0 ? found : 0;
    if (MODEL_FCST.idx < MODEL_FCST.now || MODEL_FCST.idx >= MODEL_FCST.times.length) {
      MODEL_FCST.idx = MODEL_FCST.now;
    }
    syncModelHourControl();
    renderModelField();
  } catch (err) {
    if (noteEl) noteEl.textContent = `Model field unavailable: ${err.message}`;
  } finally {
    _modelBusy = false;
    if (_modelPending) {
      _modelPending = false;
      refreshModelField();
    }
  }
}

/* Draw the selected hour out of the cached series. Split from the fetch so
   the scrubber is instant and so a view change and an hour change do not both
   have to go to the network. */
function renderModelField() {
  if (!modelDS || !modelDS.show) return;
  const noteEl = document.getElementById('model-note');
  const modelKey = valueOf('model-name', 'gfs');
  const fieldKey = valueOf('model-field', 'temperature_2m');
  const def = FIELD_DEFS[fieldKey];
  if (!def) return;
  const i = MODEL_FCST.idx;

  modelDS.entities.removeAll();
  let shown = 0;
  {
    for (const d of MODEL_FCST.series) {
      const at = Object.fromEntries(
        Object.entries(d.vars).map(([k, arr]) => [k, arr[i]]));
      let v = def.derive ? def.derive(at, MODEL_FCST.units) : at[fieldKey];
      // A derive() over a missing variable yields NaN, and NaN paints as
      // the bottom of the ramp rather than as absent.
      if (!Number.isFinite(v)) v = null;
      if (v == null) continue;
      // Open-Meteo can return an error object without coordinates for a point
      // it rejects. fromDegrees(undefined, undefined) yields a NaN position,
      // which corrupts Cesium's frustum maths and kills the whole scene with
      // "Invalid array length" out of createPotentiallyVisibleSet.
      if (!Number.isFinite(d.lon) || !Number.isFinite(d.lat)) continue;
      modelDS.entities.add({
        position: Cesium.Cartesian3.fromDegrees(d.lon, d.lat),
        point: {
          pixelSize: 16,
          color: rampColor(def.stops, v).withAlpha(0.55),
          outlineWidth: 0,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: {
          text: v.toFixed(def.dp != null ? def.dp
                          : (fieldKey === 'precipitation' ? 2 : 0)),
          font: '600 11px Inter, sans-serif',
          fillColor: Cesium.Color.WHITE,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 3,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        properties: { kind: 'model', field: fieldKey, value: v, unit: def.unit },
      });
      shown++;
    }
    applyLegendForField(def);
    if (noteEl) {
      const when = modelHourLabel(MODEL_FCST.idx);
      noteEl.textContent = def.note
        ? `${def.label} · ${modelKey.toUpperCase()} · ${when} · ${shown} points · ${def.note}`
        : `${def.label} · ${modelKey.toUpperCase()} · ${when} · ${shown} points. Re-samples on view change.`;
    }
    // The broadcast readout takes its title and its clock from whatever is on
    // the globe, so it has to be redrawn when the forecast hour moves.
    gfxRender();
    viewer.scene.requestRender();
  }
}

/* "+18 h · Wed 09 UTC". The offset is what a forecaster asks for; the valid
   time is what they have to put on air, so the row carries both. */
function modelHourLabel(i) {
  const t = MODEL_FCST.times[i];
  if (!t) return 'now';
  const off = i - MODEL_FCST.now;
  const d = new Date(`${t}Z`);
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()];
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const stamp = `${day} ${hh} UTC`;
  return off === 0 ? `now · ${stamp}` : `+${off} h · ${stamp}`;
}

/* The scrubber only exists once a series has been fetched: a slider with
   nothing behind it invites a drag that does nothing. */
function syncModelHourControl() {
  const row = document.getElementById('model-hour-row');
  const sl  = document.getElementById('model-hour');
  const val = document.getElementById('model-hour-val');
  if (!row || !sl || !val) return;
  const have = MODEL_FCST.times.length > MODEL_FCST.now + 1;
  row.hidden = !have;
  if (!have) return;
  sl.min = String(MODEL_FCST.now);
  sl.max = String(MODEL_FCST.times.length - 1);
  sl.value = String(MODEL_FCST.idx);
  val.textContent = modelHourLabel(MODEL_FCST.idx);
}

function initModelHour() {
  const sl = document.getElementById('model-hour');
  if (!sl) return;
  sl.addEventListener('input', () => {
    MODEL_FCST.idx = Number(sl.value);
    const val = document.getElementById('model-hour-val');
    if (val) val.textContent = modelHourLabel(MODEL_FCST.idx);
    renderModelField();
  });
  document.getElementById('model-hour-now')?.addEventListener('click', () => {
    MODEL_FCST.idx = MODEL_FCST.now;
    syncModelHourControl();
    renderModelField();
  });
}

function applyLegendForField(def) {
  const el = document.getElementById('legend');
  if (!el || !def) return;
  el.classList.remove('hidden');
  document.getElementById('lg-title').textContent = def.legend;
  document.getElementById('lg-unit').textContent  = def.unit;
  document.getElementById('lg-bar').style.background =
    `linear-gradient(0deg, ${def.stops.map((s) => s[1]).join(', ')})`;
  document.getElementById('lg-ticks').innerHTML =
    def.ticks.slice().reverse().map((t) => `<span>${t}</span>`).join('');
}

// ---------- Air quality ------------------------------------------------------

let aqiDS = null;
let _aqiBusy = false;

function toggleAirQuality(on) {
  if (!aqiDS) {
    aqiDS = new Cesium.CustomDataSource('airquality');
    viewer.dataSources.add(aqiDS);
  }
  aqiDS.show = !!on;
  if (on) refreshAirQuality();
}

async function refreshAirQuality() {
  if (!aqiDS || !aqiDS.show || _aqiBusy) return;
  _aqiBusy = true;
  try {
    const pts = viewGrid(12, 9);
    const params = new URLSearchParams({
      latitude:  pts.map((p) => p[0]).join(','),
      longitude: pts.map((p) => p[1]).join(','),
      current: 'us_aqi',
    });
    const r = await fetch(`https://air-quality-api.open-meteo.com/v1/air-quality?${params}`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    let data = await r.json();
    if (!Array.isArray(data)) data = [data];

    aqiDS.entities.removeAll();
    for (const d of data) {
      const v = d && d.current ? d.current.us_aqi : null;
      if (v == null) continue;
      if (!Number.isFinite(d.longitude) || !Number.isFinite(d.latitude)) continue;
      aqiDS.entities.add({
        position: Cesium.Cartesian3.fromDegrees(d.longitude, d.latitude),
        point: {
          pixelSize: 14,
          color: rampColor(AQI_STOPS, v).withAlpha(0.6),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: {
          text: String(Math.round(v)),
          font: '600 10px Inter, sans-serif',
          fillColor: Cesium.Color.WHITE,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 3,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        properties: { kind: 'aqi', value: v },
      });
    }
    viewer.scene.requestRender();
  } catch { /* transient network — the next view change retries */ }
  finally { _aqiBusy = false; }
}

// ---------- Surface observations (METAR) -------------------------------------

let metarDS = null;
let metarRaw = [];

function toggleMetar(on) {
  if (!metarDS) {
    metarDS = new Cesium.CustomDataSource('metar');
    viewer.dataSources.add(metarDS);
    configureClustering(metarDS, { color: '#7dd3fc', pixelRange: 34, minSize: 3 });
  }
  metarDS.show = !!on;
  if (on) refreshMetar();
}

async function refreshMetar() {
  if (!metarDS || !metarDS.show) return;
  try {
    const r = await fetch('/api/metar');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    metarRaw = await r.json();
    if (!Array.isArray(metarRaw)) metarRaw = [];
  } catch (err) {
    pushEvent('METAR', `Surface obs unavailable (${err.message})`, Date.now());
    return;
  }
  renderMetar();
  noteFeed('metar');
}

const METAR_TEMP_STOPS = FIELD_DEFS.temperature_2m.stops;

function renderMetar() {
  if (!metarDS) return;
  const field = valueOf('obs-field', 'temp');
  metarDS.entities.removeAll();

  for (const ob of metarRaw) {
    const txt = metarPlotText(ob, field);
    if (txt == null) continue;
    if (!Number.isFinite(ob.lon) || !Number.isFinite(ob.lat)) continue;
    const tint = field === 'temp' || field === 'dewpoint'
      ? rampColor(METAR_TEMP_STOPS, cToF(field === 'temp' ? ob.temp : ob.dewp))
      : Cesium.Color.fromCssColorString('#7dd3fc');
    metarDS.entities.add({
      id: `metar-${ob.id}`,
      position: Cesium.Cartesian3.fromDegrees(ob.lon, ob.lat),
      point: {
        pixelSize: 5,
        color: tint.withAlpha(0.95),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      label: {
        text: txt,
        font: '600 11px "JetBrains Mono", monospace',
        fillColor: tint,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 3,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(0, -12),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        // Station plots only make sense once you are close enough to read
        // them; at globe scale they would be an unreadable smear.
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 4_000_000),
      },
      properties: { kind: 'metar', ...ob },
    });
  }
  viewer.scene.requestRender();
}

function cToF(c) { return c == null ? null : c * 9 / 5 + 32; }

function metarPlotText(ob, field) {
  const us = settings.units === 'us';
  switch (field) {
    case 'temp': {
      if (ob.temp == null) return null;
      return us ? `${Math.round(cToF(ob.temp))}` : `${Math.round(ob.temp)}`;
    }
    case 'dewpoint': {
      if (ob.dewp == null) return null;
      return us ? `${Math.round(cToF(ob.dewp))}` : `${Math.round(ob.dewp)}`;
    }
    case 'wind': {
      if (ob.wspd == null) return null;
      const dir = ob.wdir == null ? '' : `${String(ob.wdir).padStart(3, '0')}°`;
      return `${dir}${ob.wspd}kt`;
    }
    case 'gust':
      return ob.wgst == null ? null : `G${ob.wgst}`;
    case 'visibility':
      return ob.visib == null ? null : `${ob.visib}`;
    default:
      return null;
  }
}

// ---------- NWS warnings — rich cards + polygons ------------------------------
//
// The desktop apps present warnings as a scannable list of cards carrying the
// details a spotter actually needs (hail size, wind, tornado flag, expiry),
// with the polygon drawn on the map. This mirrors that.

let warnDS = null;
let warnFeatures = [];

/* The National Weather Service's own watch/warning/advisory display list,
   verbatim from weather.gov/help-map. Two things come out of it and both were
   hand-rolled before: the colour, and the ORDER.

   The colour, because it is the one every viewer and every meteorologist has
   already learned. A hand-picked palette meant Graticule drew a Tornado
   Warning in #ef4444 while NWS, RadarScope, Weatherfront and the local station
   all drew it in pure #ff0000, and a Flood Warning green that was nobody's
   green. Ten events were styled by name and everything else fell through four
   regexes onto three colours -- measured on a live feed, ten alert types in
   effect rendered in three colours, two of which were near-identical slate.

   The order, because this list IS the NWS display priority: what overlaps what
   on a map, and what leads a bulletin. Deriving priority from position means
   the app cannot disagree with the service about which of two alerts matters
   more. Index 0 is highest.

   111 events. Anything the service adds later still resolves, through the
   Warning/Watch/Advisory fallbacks at the bottom. */
const NWS_EVENT_ORDER = [
  ['Tsunami Warning', '#fd6347'],
  ['Tornado Warning', '#ff0000'],
  ['Extreme Wind Warning', '#ff8c00'],
  ['Severe Thunderstorm Warning', '#ffa500'],
  ['Flash Flood Warning', '#8b0000'],
  ['Flash Flood Statement', '#8b0000'],
  ['Severe Weather Statement', '#00ffff'],
  ['Shelter In Place Warning', '#fa8072'],
  ['Evacuation Immediate', '#7fff00'],
  ['Civil Danger Warning', '#ffb6c1'],
  ['Nuclear Power Plant Warning', '#4b0082'],
  ['Radiological Hazard Warning', '#4b0082'],
  ['Hazardous Materials Warning', '#4b0082'],
  ['Fire Warning', '#a0522d'],
  ['Civil Emergency Message', '#ffb6c1'],
  ['Law Enforcement Warning', '#c0c0c0'],
  ['Storm Surge Warning', '#b524f7'],
  ['Hurricane Force Wind Warning', '#cd5c5c'],
  ['Hurricane Warning', '#dc143c'],
  ['Typhoon Warning', '#dc143c'],
  ['Special Marine Warning', '#ffa500'],
  ['Blizzard Warning', '#ff4500'],
  ['Snow Squall Warning', '#c71585'],
  ['Ice Storm Warning', '#8b008b'],
  ['Heavy Freezing Spray Warning', '#00bfff'],
  ['Winter Storm Warning', '#ff69b4'],
  ['Lake Effect Snow Warning', '#008b8b'],
  ['Dust Storm Warning', '#ffe4c4'],
  ['Blowing Dust Warning', '#ffe4c4'],
  ['High Wind Warning', '#daa520'],
  ['Tropical Storm Warning', '#b22222'],
  ['Storm Warning', '#9400d3'],
  ['Tsunami Advisory', '#d2691e'],
  ['Tsunami Watch', '#ff00ff'],
  ['Avalanche Warning', '#1e90ff'],
  ['Earthquake Warning', '#8b4513'],
  ['Volcano Warning', '#2f4f4f'],
  ['Ashfall Warning', '#a9a9a9'],
  ['Flood Warning', '#00ff00'],
  ['Coastal Flood Warning', '#228b22'],
  ['Lakeshore Flood Warning', '#228b22'],
  ['Ashfall Advisory', '#696969'],
  ['High Surf Warning', '#228b22'],
  ['Extreme Heat Warning', '#c71585'],
  ['Tornado Watch', '#ffff00'],
  ['Severe Thunderstorm Watch', '#db7093'],
  ['Flash Flood Watch', '#2e8b57'],
  ['Gale Warning', '#dda0dd'],
  ['Flood Statement', '#00ff00'],
  ['Extreme Cold Warning', '#0000ff'],
  ['Freeze Warning', '#483d8b'],
  ['Red Flag Warning', '#ff1493'],
  ['Storm Surge Watch', '#db7ff7'],
  ['Hurricane Watch', '#ff00ff'],
  ['Hurricane Force Wind Watch', '#9932cc'],
  ['Typhoon Watch', '#ff00ff'],
  ['Tropical Storm Watch', '#f08080'],
  ['Storm Watch', '#ffe4b5'],
  ['Tropical Cyclone Local Statement', '#ffe4b5'],
  ['Winter Weather Advisory', '#7b68ee'],
  ['Avalanche Advisory', '#cd853f'],
  ['Cold Weather Advisory', '#afeeee'],
  ['Heat Advisory', '#ff7f50'],
  ['Flood Advisory', '#00ff7f'],
  ['Coastal Flood Advisory', '#7cfc00'],
  ['Lakeshore Flood Advisory', '#7cfc00'],
  ['High Surf Advisory', '#ba55d3'],
  ['Dense Fog Advisory', '#708090'],
  ['Dense Smoke Advisory', '#f0e68c'],
  ['Small Craft Advisory', '#d8bfd8'],
  ['Brisk Wind Advisory', '#d8bfd8'],
  ['Hazardous Seas Warning', '#d8bfd8'],
  ['Dust Advisory', '#bdb76b'],
  ['Blowing Dust Advisory', '#bdb76b'],
  ['Lake Wind Advisory', '#d2b48c'],
  ['Wind Advisory', '#d2b48c'],
  ['Frost Advisory', '#6495ed'],
  ['Freezing Fog Advisory', '#008080'],
  ['Freezing Spray Advisory', '#00bfff'],
  ['Low Water Advisory', '#a52a2a'],
  ['Local Area Emergency', '#c0c0c0'],
  ['Winter Storm Watch', '#4682b4'],
  ['Rip Current Statement', '#40e0d0'],
  ['Beach Hazards Statement', '#40e0d0'],
  ['Gale Watch', '#ffc0cb'],
  ['Avalanche Watch', '#f4a460'],
  ['Hazardous Seas Watch', '#483d8b'],
  ['Heavy Freezing Spray Watch', '#bc8f8f'],
  ['Flood Watch', '#2e8b57'],
  ['Coastal Flood Watch', '#66cdaa'],
  ['Lakeshore Flood Watch', '#66cdaa'],
  ['High Wind Watch', '#b8860b'],
  ['Extreme Heat Watch', '#800000'],
  ['Extreme Cold Watch', '#5f9ea0'],
  ['Freeze Watch', '#00ffff'],
  ['Fire Weather Watch', '#ffdead'],
  ['Extreme Fire Danger', '#e9967a'],
  ['911 Telephone Outage', '#c0c0c0'],
  ['Coastal Flood Statement', '#6b8e23'],
  ['Lakeshore Flood Statement', '#6b8e23'],
  ['Special Weather Statement', '#ffe4b5'],
  ['Marine Weather Statement', '#ffdab9'],
  ['Air Quality Alert', '#808080'],
  ['Air Stagnation Advisory', '#808080'],
  ['Hazardous Weather Outlook', '#eee8aa'],
  ['Hydrologic Outlook', '#90ee90'],
  ['Short Term Forecast', '#98fb98'],
  ['Administrative Message', '#c0c0c0'],
  ['Test', '#f0ffff'],
  ['Child Abduction Emergency', '#ffffff'],
  ['Blue Alert', '#ffffff'],
];

const WARN_STYLE = Object.fromEntries(NWS_EVENT_ORDER.map(
  ([name, c], i) => [name, { c, p: NWS_EVENT_ORDER.length - i }]));

/* The NWS palette is designed to be printed on a LIGHT map. Seven of its 111
   colours are dark enough that, used as text on this app's near-black panels,
   they are unreadable: Flash Flood Warning #8b0000 measured 1.80:1 against the
   alert card, where AA wants 4.5.

   So the published colour still owns the swatch and the card's left bar --
   that is the identity a forecaster recognises -- and the WORDS get a lifted
   version of the same hue, raised in value only until it clears the floor.
   Same colour, legible weight of it. */
const WARN_INK_CACHE = new Map();
function warnInk(hex, bg = [18, 21, 26]) {
  if (WARN_INK_CACHE.has(hex)) return WARN_INK_CACHE.get(hex);
  const h = String(hex).replace('#', '');
  let r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  if (![r, g, b].every(Number.isFinite)) return hex;
  const chan = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const lum = (c) => 0.2126 * chan(c[0]) + 0.7152 * chan(c[1]) + 0.0722 * chan(c[2]);
  const cr = (c) => {
    const a = lum(c), z = lum(bg);
    return (Math.max(a, z) + 0.05) / (Math.min(a, z) + 0.05);
  };
  // Lift toward white in small steps, which keeps the hue and only raises the
  // value. Bounded so a colour that can never pass simply ends up white.
  let out = [r, g, b];
  for (let i = 0; i < 24 && cr(out) < 4.5; i++) {
    out = out.map((v) => Math.min(255, Math.round(v + (255 - v) * 0.14)));
  }
  const css = '#' + out.map((v) => v.toString(16).padStart(2, '0')).join('');
  WARN_INK_CACHE.set(hex, css);
  return css;
}

function warnStyle(evt) {
  if (WARN_STYLE[evt]) return WARN_STYLE[evt];
  // Not on the published list. Rank below everything that is, and take the
  // class colour so an unrecognised product still reads as what it is.
  if (/Warning/i.test(evt))   return { c: '#ff0000', p: 4 };
  if (/Watch/i.test(evt))     return { c: '#ffff00', p: 3 };
  if (/Advisory/i.test(evt))  return { c: '#d8bfd8', p: 2 };
  return { c: '#c0c0c0', p: 1 };
}

function toggleWarnings(on) {
  if (!warnDS) {
    warnDS = new Cesium.CustomDataSource('warnings');
    viewer.dataSources.add(warnDS);
  }
  warnDS.show = !!on;
  if (on) refreshWarnings();
}

/* Pull the active alert list and leave it sorted by severity. Split out of
   refreshWarnings because the broadcast warning banner needs the same list
   while the polygon layer is switched off -- a presenter who does not want the
   shapes on the map still wants the headline, and the old shape made the list
   a side effect of drawing. Returns whether it succeeded. */
async function fetchWarnFeatures() {
  try {
    const r = await fetch('/api/nws/alerts');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const gj = await r.json();
    // Keep every active alert for the card list. Most NWS alerts are issued
    // against forecast zones and carry no polygon, so filtering on geometry
    // would silently hide ~90% of what is actually in effect; only the
    // polygon-bearing subset gets drawn on the globe.
    warnFeatures = gj.features || [];
  } catch (err) {
    pushEvent('NWS', `Warnings unavailable (${err.message})`, Date.now());
    return false;
  }
  warnFeatures.sort((a, b) =>
    warnStyle(b.properties.event).p - warnStyle(a.properties.event).p);
  return true;
}

async function refreshWarnings() {
  if (!warnDS || !warnDS.show) return;
  if (!(await fetchWarnFeatures())) return;

  warnDS.entities.removeAll();
  for (const f of warnFeatures) {
    if (!f.geometry) continue;               // zone-only alert: card, no polygon
    addWarnGeometry(f, warnStyle(f.properties.event).c);
  }
  renderWarningCards();
  noteFeed('nws');
  gfxRender();
  viewer.scene.requestRender();
}

function addWarnGeometry(f, color) {
  const g = f.geometry;
  const polys = g.type === 'Polygon' ? [g.coordinates]
              : g.type === 'MultiPolygon' ? g.coordinates : [];
  for (const poly of polys) {
    const ring = poly[0];
    if (!ring || ring.length < 3) continue;
    warnDS.entities.add({
      polygon: {
        hierarchy: new Cesium.PolygonHierarchy(
          Cesium.Cartesian3.fromDegreesArray(ring.flatMap(([x, y]) => [x, y]))),
        material: Cesium.Color.fromCssColorString(color).withAlpha(0.22),
        outline: true,
        outlineColor: Cesium.Color.fromCssColorString(color),
        outlineWidth: 2,
        height: 0,
      },
      properties: { kind: 'warning', ...f.properties },
    });
  }
}

function fmtExpiry(iso) {
  if (!iso) return '';
  const ms = new Date(iso).getTime() - Date.now();
  if (Number.isNaN(ms)) return '';
  if (ms <= 0) return 'expired';
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function renderWarningCards() {
  const list = document.getElementById('warn-list');
  const count = document.getElementById('warn-count');
  if (!list) return;
  if (count) count.textContent = String(warnFeatures.length);

  if (!warnFeatures.length) {
    list.innerHTML = '<li class="warn-empty">No active NWS alerts.</li>';
    return;
  }

  list.textContent = '';
  warnFeatures.slice(0, 120).forEach((f, i) => list.appendChild(warnCard(f, i)));

  // Click a card to fly to that warning's polygon.
  list.querySelectorAll('.warn-card').forEach((el) => {
    el.addEventListener('click', () => {
      const f = warnFeatures[Number(el.dataset.warn)];
      if (f && f.geometry) flyToGeometry(f.geometry);
    });
  });
}

function flyToGeometry(g) {
  const polys = g.type === 'Polygon' ? [g.coordinates]
              : g.type === 'MultiPolygon' ? g.coordinates : [];
  const flat = [];
  for (const poly of polys) for (const [x, y] of (poly[0] || [])) flat.push(x, y);
  if (flat.length < 4) return;
  // Any camera move counts as interaction so the NA lock doesn't yank us back.
  _lastInteractionAt = performance.now();
  viewer.camera.flyTo({
    destination: Cesium.Rectangle.fromDegrees(
      Math.min(...flat.filter((_, i) => i % 2 === 0)) - 0.6,
      Math.min(...flat.filter((_, i) => i % 2 === 1)) - 0.6,
      Math.max(...flat.filter((_, i) => i % 2 === 0)) + 0.6,
      Math.max(...flat.filter((_, i) => i % 2 === 1)) + 0.6),
    duration: 1.6,
  });
}

// ---------- View-change resampling -------------------------------------------
//
// Grid layers are sampled over the current view, so they need to re-fetch when
// the camera settles. Debounced so a drag doesn't fire dozens of requests.

let _viewSampleTimer = null;
function initViewResampling() {
  viewer.camera.moveEnd.addEventListener(() => {
    clearTimeout(_viewSampleTimer);
    _viewSampleTimer = setTimeout(() => {
      if (modelDS && modelDS.show) refreshModelField();
      if (aqiDS && aqiDS.show)     refreshAirQuality();
    }, 700);
  });

  // Obs and warnings are national feeds, so poll on a timer instead.
  setInterval(() => { if (metarDS && metarDS.show) refreshMetar(); }, 5 * 60_000);
  setInterval(() => { if (warnDS && warnDS.show) refreshWarnings(); }, 60_000);
}

function currentWxMode() {
  const el = document.querySelector('#wx-modes .chip.is-active');
  return el ? el.dataset.mode : 'radar';
}

function valueOf(id, dflt) {
  const el = document.getElementById(id);
  return (el && el.value) || dflt;
}

// ═══════════════════════════════════════════════════════════════════════════
// WAVE 4 — local storm reports, drawing tools, map themes
// ═══════════════════════════════════════════════════════════════════════════

// ---------- Local Storm Reports ---------------------------------------------
//
// Ground truth reported by spotters and offices: hail size, measured gusts,
// tornado sightings, flooding. Every desktop app in the survey carries these
// alongside radar because they are what verifies what the radar suggested.

let lsrDS = null;

const LSR_TYPES = {
  T: { label: 'Tornado',    color: '#ef4444', glyph: '🌪' },
  H: { label: 'Hail',       color: '#38bdf8', glyph: '⬤' },
  G: { label: 'Wind Gust',  color: '#fbbf24', glyph: '➤' },
  D: { label: 'Wind Damage',color: '#f97316', glyph: '✖' },
  F: { label: 'Flood',      color: '#22c55e', glyph: '≈' },
  M: { label: 'Marine',     color: '#a78bfa', glyph: '⚓' },
  S: { label: 'Snow',       color: '#e2e8f0', glyph: '❄' },
  R: { label: 'Rain',       color: '#60a5fa', glyph: '☂' },
};

function lsrStyle(t) {
  return LSR_TYPES[t] || { label: 'Report', color: '#94a3b8', glyph: '•' };
}

function toggleLsr(on) {
  if (!lsrDS) {
    lsrDS = new Cesium.CustomDataSource('lsr');
    viewer.dataSources.add(lsrDS);
  }
  lsrDS.show = !!on;
  if (on) refreshLsr();
}

async function refreshLsr() {
  if (!lsrDS || !lsrDS.show) return;
  const hours = Number(valueOf('lsr-hours', '12'));
  let gj;
  try {
    const r = await fetch(`/api/lsr?hours=${hours}`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    gj = await r.json();
  } catch (err) {
    pushEvent('LSR', `Storm reports unavailable (${err.message})`, Date.now());
    return;
  }

  lsrDS.entities.removeAll();
  const feats = gj.features || [];
  for (const f of feats) {
    const g = f.geometry;
    if (!g || g.type !== 'Point') continue;
    if (!Number.isFinite(g.coordinates[0]) || !Number.isFinite(g.coordinates[1])) continue;
    const p = f.properties || {};
    const st = lsrStyle(p.type);
    const mag = p.magnitude ? ` ${p.magnitude}` : '';
    lsrDS.entities.add({
      position: Cesium.Cartesian3.fromDegrees(g.coordinates[0], g.coordinates[1]),
      point: {
        pixelSize: 8,
        color: Cesium.Color.fromCssColorString(st.color),
        outlineColor: Cesium.Color.BLACK.withAlpha(0.7),
        outlineWidth: 1,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      label: {
        text: `${st.label}${mag}`,
        font: '600 10px Inter, sans-serif',
        fillColor: Cesium.Color.fromCssColorString(st.color),
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 3,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(0, -13),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 3_000_000),
      },
      properties: {
        kind: 'lsr', type: st.label, magnitude: p.magnitude,
        city: p.city, state: p.st, valid: p.valid, remark: p.remark,
        source: p.source,
      },
    });
  }
  const n = document.getElementById('lsr-count');
  if (n) n.textContent = String(feats.length);
  viewer.scene.requestRender();
}

// ---------- Drawing tools -----------------------------------------------------
//
// Free-hand annotation over the globe. Present in RadarScope, Radar Omega and
// WeatherWise; used on stream to circle a feature while talking about it.

const DRAW = {
  active: false,
  colorIdx: 0,
  ds: null,
  current: null,
  positions: [],
  handler: null,
  strokes: [],
};

const DRAW_COLORS = ['#38bdf8', '#ef4444', '#fbbf24', '#22c55e', '#f0abfc', '#ffffff'];

function initDrawing() {
  DRAW.ds = new Cesium.CustomDataSource('drawing');
  viewer.dataSources.add(DRAW.ds);

  const btn   = document.getElementById('draw-toggle');
  const clear = document.getElementById('draw-clear');
  const undo  = document.getElementById('draw-undo');
  const swatch= document.getElementById('draw-color');
  if (!btn) return;

  btn.addEventListener('click', () => setDrawing(!DRAW.active));
  clear.addEventListener('click', () => {
    DRAW.ds.entities.removeAll();
    DRAW.strokes = [];
    viewer.scene.requestRender();
  });
  undo.addEventListener('click', () => {
    const last = DRAW.strokes.pop();
    if (last) { DRAW.ds.entities.remove(last); viewer.scene.requestRender(); }
  });
  swatch.addEventListener('click', () => {
    DRAW.colorIdx = (DRAW.colorIdx + 1) % DRAW_COLORS.length;
    swatch.style.background = DRAW_COLORS[DRAW.colorIdx];
  });
  swatch.style.background = DRAW_COLORS[0];
}

function setDrawing(on) {
  DRAW.active = !!on;
  const btn = document.getElementById('draw-toggle');
  const bar = document.getElementById('drawbar');
  if (btn) {
    btn.classList.toggle('is-active', DRAW.active);
    // The class is a paint job; aria-pressed is what a screen reader reads.
    btn.setAttribute('aria-pressed', String(DRAW.active));
  }
  if (bar) bar.classList.toggle('is-drawing', DRAW.active);

  // Camera control has to yield while drawing, otherwise a stroke drags the
  // globe underneath it.
  const c = viewer.scene.screenSpaceCameraController;
  c.enableRotate = c.enableTranslate = c.enableZoom = c.enableTilt = c.enableLook = !DRAW.active;

  if (DRAW.active && !DRAW.handler) {
    DRAW.handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    DRAW.handler.setInputAction((e) => beginStroke(e.position), Cesium.ScreenSpaceEventType.LEFT_DOWN);
    DRAW.handler.setInputAction((e) => extendStroke(e.endPosition), Cesium.ScreenSpaceEventType.MOUSE_MOVE);
    DRAW.handler.setInputAction(() => endStroke(), Cesium.ScreenSpaceEventType.LEFT_UP);
  } else if (!DRAW.active && DRAW.handler) {
    DRAW.handler.destroy();
    DRAW.handler = null;
  }
}

function pickGlobe(screenPos) {
  const ray = viewer.camera.getPickRay(screenPos);
  if (!ray) return null;
  return viewer.scene.globe.pick(ray, viewer.scene) || null;
}

function beginStroke(screenPos) {
  const p = pickGlobe(screenPos);
  if (!p) return;
  DRAW.positions = [p];
  const color = Cesium.Color.fromCssColorString(DRAW_COLORS[DRAW.colorIdx]);
  DRAW.current = DRAW.ds.entities.add({
    polyline: {
      // CallbackProperty keeps the line live while the pointer moves without
      // rebuilding the entity on every sample.
      positions: new Cesium.CallbackProperty(() => DRAW.positions, false),
      width: 3,
      material: color,
      clampToGround: true,
    },
  });
}

function extendStroke(screenPos) {
  if (!DRAW.current) return;
  const p = pickGlobe(screenPos);
  if (!p) return;
  const last = DRAW.positions[DRAW.positions.length - 1];
  // Thin the samples so a slow drag doesn't push thousands of vertices.
  if (last && Cesium.Cartesian3.distance(last, p) < 6000) return;
  DRAW.positions.push(p);
  viewer.scene.requestRender();
}

function endStroke() {
  if (!DRAW.current) return;
  // Freeze the finished stroke into a static array; a live CallbackProperty
  // per stroke would keep re-evaluating for the life of the session.
  const frozen = DRAW.positions.slice();
  DRAW.current.polyline.positions = frozen;
  DRAW.strokes.push(DRAW.current);
  DRAW.current = null;
  DRAW.positions = [];
  viewer.scene.requestRender();
}

// ---------- Map theme ---------------------------------------------------------
// Light / dark / satellite base, matching the theme picker in the consumer
// apps. Wraps the existing imagery-base setting so both stay in sync.

function initMapTheme() {
  const wrap = document.getElementById('theme-picker');
  if (!wrap) return;
  const markActive = (active) => {
    wrap.querySelectorAll('.theme-btn').forEach((x) => {
      const on = x === active;
      x.classList.toggle('is-active', on);
      x.setAttribute('aria-pressed', String(on));
    });
  };
  markActive(wrap.querySelector(`.theme-btn[data-theme="${settings.imageryBase}"]`));
  wrap.querySelectorAll('.theme-btn').forEach((b) => {
    b.addEventListener('click', () => {
      settings.imageryBase = b.dataset.theme;
      saveSettings();
      markActive(b);
      applyImageryBase(settings.imageryBase);
      const radio = document.querySelector(`input[name="imageryBase"][value="${settings.imageryBase}"]`);
      if (radio) radio.checked = true;
    });
  });

  const dim = document.getElementById('dim-base');
  if (dim) {
    dim.checked = settings.dimBaseUnderData !== false;
    dim.addEventListener('change', () => {
      settings.dimBaseUnderData = dim.checked;
      saveSettings();
      gradeBaseImagery();
    });
  }

  // Re-grade when the imagery stack itself changes, not when a switch is
  // clicked. Measured: hooking the switch left the base ungraded at boot
  // (brightness 1.0, saturation 1.25 with radar already drawing) because the
  // radar overlay attaches after a fetch, several hundred ms behind the change
  // event. layerAdded / layerRemoved fire at the moment the stack is true.
  if (viewer) {
    const regrade = (l) => { if (l !== baseImageryLayer) gradeBaseImagery(); };
    viewer.imageryLayers.layerAdded.addEventListener(regrade);
    viewer.imageryLayers.layerRemoved.addEventListener(regrade);
    viewer.imageryLayers.layerShownOrHidden.addEventListener(regrade);
    gradeBaseImagery();
  }
}

/* ===========================================================================
   WORLD POPULATION DASHBOARD
   ===========================================================================
   A replica of the LiveStream07 board, built from a 1920x1080 frame of it.

   Data, all free and keyless:
     countries   World Bank SP.POP.TOTL + SP.POP.GROW, baked to
                 web/data/world_population.json by scripts/build_world_population.py.
                 Baked rather than fetched live because this ticks at 10Hz and
                 must not wait on an API.
     flags       flagcdn.com/w40/<iso2>.png — free, no key, no attribution rule
     religion    Pew Research Center, Global Religious Landscape. Pew publishes
                 a size and a projected growth rate per group; there is no live
                 feed for religion and there cannot be one, so these are the
                 published figures projected forward the same way the countries
                 are. Sourced in RELIGIONS below.
     vitals      UN WPP 2024 crude rates.

   ★ One deliberate departure from the source. The board's TODAY panel and its
   THIS YEAR panel disagree with each other: at 14:35:57 UTC it showed 131,918
   births today, which is ~217k/day, while its own "Birth 2026" of 77,514,185
   over 214 elapsed days implies ~362k/day. The second figure is the correct
   one (UN WPP puts world births near 132M/year). Reproducing the layout is the
   goal; reproducing an arithmetic bug is not, so both panels here derive from
   the same rate and agree.
   ------------------------------------------------------------------------- */

const WD = {
  open: false,
  timer: null,
  data: null,          // { countries: [...] } from world_population.json
  rest: [],            // countries ranked 16+, rotated through
  restAt: 0,
  restTurn: 0,
  msAt: 0,             // which country the milestone strip is tracking
  msStarted: 0,
  prev: new Map(),     // element id -> last rendered string, for tick flashes
};

// One set of vital rates for the whole app. These used to be a second literal
// copy, and the rail's pair differed from them -- 79.2M deaths a year against
// 62M -- so the pane and the board it opens disagreed about how many people
// died today. Aliased rather than re-declared so there is nowhere for a third
// answer to appear.
const WD_YEAR_S = WORLD_YEAR_S;
const WD_BIRTHS_PER_S = BIRTHS_PER_SEC;
const WD_DEATHS_PER_S = DEATHS_PER_SEC;

const WD_CONTINENT_ICON = {
  'Asia': '🌏', 'Africa': '🌍', 'Europe': '🌍',
  'Latin America': '🌎', 'North America': '🌎', 'Oceania': '🌏',
};

/* Pew Research Center, Global Religious Landscape (2020 baseline, published
   2025) with Pew's projected annual growth to 2050. Epoch is 2020-01-01. */
const WD_RELIGION_EPOCH = Date.UTC(2020, 0, 1) / 1000;
const RELIGIONS = [
  ['Christian', '✝',  2_300_000_000, 0.0104],
  ['Muslim',    '☪',  2_000_000_000, 0.0176],
  ['Hindu',     '🕉',  1_200_000_000, 0.0100],
  ['Buddhist',  '☸',    324_000_000, -0.0005],
  ['Sikh',      '🪯',    28_000_000, 0.0103],
  ['Jews',      '✡',     14_800_000, 0.0072],
];

const WD_HORIZONS = [
  ['30 Seconds', 30], ['1 Minute', 60], ['2 Minutes', 120],
  ['5 Minutes', 300], ['10 Minutes', 600], ['20 Minutes', 1200],
];

function wdFlag(iso2) { return `https://flagcdn.com/w40/${iso2}.png`; }

/* Compound an annual rate from the dataset's epoch (1 July of the data year,
   the World Bank's mid-year reference) to now. */
function wdProject(base, rate, nowSec, epochSec) {
  return base * Math.pow(1 + rate, (nowSec - epochSec) / WD_YEAR_S);
}

/* Write text and flash the element green if it actually changed. This is the
   source board's only motion besides the LIVE dot, and it is what makes a wall
   of numbers read as live rather than as a screenshot. */
function wdSet(el, txt) {
  if (!el) return;
  const id = el.dataset.wdk || el.id;
  if (WD.prev.get(id) === txt) return;
  WD.prev.set(id, txt);
  el.textContent = txt;
  el.classList.remove('wd-tick');
  void el.offsetWidth;          // restart the transition
  el.classList.add('wd-tick');
  setTimeout(() => el.classList.remove('wd-tick'), 480);
}

async function initWorldDash() {
  const openBtn = document.getElementById('wd-open');
  const closeBtn = document.getElementById('wd-close');
  if (!openBtn) return;
  openBtn.addEventListener('click', openWorldDash);
  closeBtn.addEventListener('click', closeWorldDash);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && WD.open) closeWorldDash();
  });
}

/* A ranking has to be ranked by the number it is showing.

   world_population.json is sorted by the World Bank's baseline population, and
   every value on the board is that baseline projected forward at each
   country's own rate. Faster-growing countries therefore overtake slower ones
   between the bake and now, and the board printed the result: "136 Armenia
   3,182,120" three rows above "139 Qatar 3,314,227". A board whose rank column
   disagrees with its value column is telling you one of the two is wrong.

   Re-sorted on the projected figures, so position and value always agree. The
   ordering only changes on the scale of months, so this runs when the rest
   window turns over rather than every tick. */
function wdRankedCountries(nowSec) {
  return WD.data.countries
    .map((c) => ({ c, v: wdProject(c.pop, c.rate, nowSec, WD.epoch) }))
    .sort((a, b) => b.v - a.v)
    .map((x) => x.c);
}

async function loadWorldData() {
  if (WD.data) return WD.data;
  // StaticFiles is mounted at /static, not at the document root — a bare
  // 'data/...' resolves to /data/... and 404s.
  const res = await fetch('/static/data/world_population.json');
  if (!res.ok) throw new Error(`world_population.json: HTTP ${res.status}`);
  WD.data = await res.json();
  // World Bank figures are mid-year estimates for the data year.
  WD.epoch = Date.UTC(WD.data.year, 6, 1) / 1000;
  // Rank on the projected figures, not the baked baseline -- see
  // wdRankedCountries(). Everything downstream reads WD.ranked, so the top-15
  // table, the tail window and the rail pane cannot disagree about who is
  // where.
  WD.ranked = wdRankedCountries(Date.now() / 1000);
  WD.rest = WD.ranked.slice(15);
  buildWorldDashStatic();
  return WD.data;
}

async function openWorldDash() {
  const el = document.getElementById('worlddash');
  try {
    await loadWorldData();
  } catch (err) {
    console.warn('world dashboard data failed:', err);
    document.getElementById('wd-src').textContent =
      'Population data unavailable — run scripts/build_world_population.py';
    return;
  }
  WD.open = true;
  WD.msStarted = Date.now() / 1000;
  el.classList.remove('hidden');
  tickWorldDash();
  // 10Hz. Fast enough that the odometer reads as continuous, slow enough that
  // it is nowhere near a frame budget — and the globe behind it is in
  // explicit-render mode, so this costs no GPU work at all.
  WD.timer = setInterval(tickWorldDash, 100);
}

function closeWorldDash() {
  WD.open = false;
  document.getElementById('worlddash').classList.add('hidden');
  if (WD.timer) { clearInterval(WD.timer); WD.timer = null; }
}

/* Rows that never change are built once. Only their values are touched on
   each tick, so a 10Hz loop never rebuilds a node. */
function buildWorldDashStatic() {
  const conts = {};
  for (const c of WD.data.countries) {
    const t = conts[c.continent] || (conts[c.continent] = { pop: 0, w: 0 });
    t.pop += c.pop;
    t.w += c.pop * c.rate;
  }
  WD.continents = Object.entries(conts)
    .map(([name, t]) => ({ name, pop: t.pop, rate: t.w / t.pop }))
    .sort((a, b) => b.pop - a.pop);

  const cEl = document.getElementById('wd-continents');
  cEl.textContent = '';
  WD.continents.forEach((c, i) => {
    cEl.appendChild(wdRankRow(i + 1, WD_CONTINENT_ICON[c.name] || '🌐',
                              c.name, `wd-cont-${i}`));
  });

  const rEl = document.getElementById('wd-religions');
  rEl.textContent = '';
  RELIGIONS.forEach(([name, icon], i) => {
    rEl.appendChild(wdRankRow(i + 1, icon, name, `wd-rel-${i}`));
  });

  const tEl = document.getElementById('wd-top15');
  tEl.textContent = '';
  (WD.ranked || WD.data.countries).slice(0, 15).forEach((c, i) => {
    tEl.appendChild(wdCountryRow(i + 1, c, `wd-top-${i}`));
  });

  const msEl = document.getElementById('wd-ms-cols');
  msEl.textContent = '';
  WD_HORIZONS.forEach(([label], i) => {
    const col = document.createElement('div');
    col.className = 'wd-ms-col';
    const h = document.createElement('span');
    h.className = 'wd-ms-hz'; h.textContent = label;
    const v = document.createElement('span');
    v.className = 'wd-ms-proj'; v.id = `wd-ms-proj-${i}`;
    const bar = document.createElement('div');
    bar.className = 'wd-ms-bar';
    const fill = document.createElement('div');
    fill.className = 'wd-ms-fill'; fill.id = `wd-ms-fill-${i}`;
    bar.appendChild(fill);
    const done = document.createElement('span');
    done.className = 'wd-ms-done'; done.id = `wd-ms-done-${i}`;
    col.append(h, v, bar, done);
    msEl.appendChild(col);
  });

  document.getElementById('wd-src').textContent =
    `Population: World Bank ${WD.data.year} · Religion: Pew Research Center · Vitals: UN WPP`;
  const y = new Date().getUTCFullYear();
  document.getElementById('wd-year-h').textContent = 'THIS YEAR';
  document.getElementById('wd-birth-yk').textContent = `Birth ${y}`;
  document.getElementById('wd-death-yk').textContent = `Death ${y}`;
  document.getElementById('wd-growth-yk').textContent = `Growth ${y}`;
}

function wdRankRow(n, icon, name, valId) {
  const row = document.createElement('div');
  row.className = 'wd-r';
  const nEl = document.createElement('span');
  nEl.className = 'wd-r-n'; nEl.textContent = String(n);
  const iEl = document.createElement('span');
  iEl.className = 'wd-r-ico'; iEl.textContent = icon;
  const box = document.createElement('div');
  const nm = document.createElement('span');
  nm.className = 'wd-r-name'; nm.textContent = name;
  const v = document.createElement('span');
  v.className = 'wd-r-val'; v.id = valId;
  box.append(nm, v);
  row.append(nEl, iEl, box);
  return row;
}

function wdCountryRow(rank, c, valId) {
  const row = document.createElement('div');
  row.className = 'wd-c';
  const n = document.createElement('span');
  n.className = 'wd-c-n'; n.textContent = String(rank);
  const f = document.createElement('img');
  f.className = 'wd-flag'; f.src = wdFlag(c.iso2); f.alt = '';
  f.loading = 'lazy'; f.decoding = 'async';
  // flagcdn has no tile for a few World Bank entries that are not ISO-3166
  // countries (Channel Islands, Kosovo). Fall back to the empty plate rather
  // than a broken-image glyph.
  f.addEventListener('error', () => { f.removeAttribute('src'); }, { once: true });
  const nm = document.createElement('span');
  nm.className = 'wd-c-name'; nm.textContent = c.name;
  const v = document.createElement('span');
  v.className = 'wd-c-val'; v.id = valId;
  const a = document.createElement('span');
  a.className = `wd-c-arw is-${c.rate >= 0 ? 'up' : 'down'}`;
  a.textContent = c.rate >= 0 ? '↑' : '↓';
  a.title = `${(c.rate * 100).toFixed(2)}% per year`;
  row.append(n, f, nm, v, a);
  return row;
}

function tickWorldDash() {
  if (!WD.open || !WD.data) return;
  const now = Date.now() / 1000;
  const d = new Date();

  // One source for the headline, shared with the rail pane. This used to sum
  // 217 per-country projections here and the rail projected a separate UN
  // constant, so the two screens were 24,024,187 people apart at the same
  // instant. `worldW`, the population-weighted rate, was accumulated in that
  // loop and never read by anything.
  wdSet(document.getElementById('wd-total'), fmtInt(worldTotalNow()));

  // Elapsed seconds since 00:00 UTC today, and since 1 Jan UTC this year.
  const dayS = (d.getTime() - Date.UTC(d.getUTCFullYear(), d.getUTCMonth(),
                                       d.getUTCDate())) / 1000;
  const yearS = (d.getTime() - Date.UTC(d.getUTCFullYear(), 0, 1)) / 1000;
  const vitals = (secs, ids) => {
    const b = secs * WD_BIRTHS_PER_S, dd = secs * WD_DEATHS_PER_S;
    wdSet(document.getElementById(ids[0]), fmtInt(b));
    wdSet(document.getElementById(ids[1]), fmtInt(dd));
    wdSet(document.getElementById(ids[2]), fmtInt(b - dd));
  };
  vitals(dayS,  ['wd-birth-day', 'wd-death-day', 'wd-growth-day']);
  vitals(yearS, ['wd-birth-year', 'wd-death-year', 'wd-growth-year']);

  WD.continents.forEach((c, i) => {
    wdSet(document.getElementById(`wd-cont-${i}`),
          fmtInt(wdProject(c.pop, c.rate, now, WD.epoch)));
  });
  RELIGIONS.forEach(([, , base, rate], i) => {
    wdSet(document.getElementById(`wd-rel-${i}`),
          fmtInt(wdProject(base, rate, now, WD_RELIGION_EPOCH)));
  });
  WD.data.countries.slice(0, 15).forEach((c, i) => {
    wdSet(document.getElementById(`wd-top-${i}`),
          fmtInt(wdProject(c.pop, c.rate, now, WD.epoch)));
  });

  tickWorldRest(now);
  tickWorldMilestone(now);

  wdSet(document.getElementById('wd-clock'),
        `${d.toISOString().slice(0, 10)} | ${d.toISOString().slice(11, 19)} UTC`);
}

/* REST OF COUNTRIES cycles a window of five through the tail of the ranking,
   the way the source board does. Rebuild only when the window moves.

   The span is a single constant used by both loops. They were two separate
   literal 5s, so changing one would have left the other updating rows that no
   longer existed. Five is safe to hard-code because the board's grid now
   compresses its rows to fit rather than overflowing the viewport -- see the
   min-height note in the stylesheet. */
const WD_REST_SPAN = 5;

function tickWorldRest(now) {
  const turn = Math.floor(now / 12);           // a new window every 12s
  const el = document.getElementById('wd-rest');
  if (!el) return;
  if (turn !== WD.restTurn || !el.childElementCount) {
    WD.restTurn = turn;
    const windows = Math.max(1, Math.ceil(WD.rest.length / WD_REST_SPAN));
    WD.restAt = (turn % windows) * WD_REST_SPAN;
    el.textContent = '';
    WD.rest.slice(WD.restAt, WD.restAt + WD_REST_SPAN).forEach((c, i) => {
      el.appendChild(wdCountryRow(16 + WD.restAt + i, c, `wd-rest-${i}`));
    });
  }
  WD.rest.slice(WD.restAt, WD.restAt + WD_REST_SPAN).forEach((c, i) => {
    wdSet(document.getElementById(`wd-rest-${i}`),
          fmtInt(wdProject(c.pop, c.rate, now, WD.epoch)));
  });
}

/* The milestone strip tracks one country and projects it at +30s, +1m, +2m,
   +5m, +10m and +20m. Each column's bar fills as real time reaches that
   horizon, then flips to ACHIEVED. When all six are achieved it advances to
   the next country — which is what NEXT names. */
function tickWorldMilestone(now) {
  const list = WD.data.countries;
  let elapsed = now - WD.msStarted;
  if (elapsed > WD_HORIZONS[WD_HORIZONS.length - 1][1]) {
    WD.msAt = (WD.msAt + 1) % list.length;
    WD.msStarted = now;
    elapsed = 0;
  }
  const c = list[WD.msAt];
  const next = list[(WD.msAt + 1) % list.length];

  const flag = document.getElementById('wd-ms-flag');
  if (flag.dataset.iso !== c.iso2) {
    flag.dataset.iso = c.iso2; flag.src = wdFlag(c.iso2);
    document.getElementById('wd-ms-name').textContent = c.name;
  }
  const nf = document.getElementById('wd-ms-nextflag');
  if (nf.dataset.iso !== next.iso2) {
    nf.dataset.iso = next.iso2; nf.src = wdFlag(next.iso2);
    document.getElementById('wd-ms-nextname').textContent = next.name;
  }
  wdSet(document.getElementById('wd-ms-val'),
        fmtInt(wdProject(c.pop, c.rate, now, WD.epoch)));

  WD_HORIZONS.forEach(([, secs], i) => {
    wdSet(document.getElementById(`wd-ms-proj-${i}`),
          fmtInt(wdProject(c.pop, c.rate, now + secs, WD.epoch)));
    const pct = Math.min(100, (elapsed / secs) * 100);
    document.getElementById(`wd-ms-fill-${i}`).style.width = `${pct.toFixed(1)}%`;
    const done = document.getElementById(`wd-ms-done-${i}`);
    const txt = pct >= 100 ? '✓ ACHIEVED' : '';
    if (done.textContent !== txt) done.textContent = txt;
  });
}

/* ---------------------------------------------------------------------------
   NWS warning card, RadarScope Pro shape
   ---------------------------------------------------------------------------
   From a frame of the app: coloured event name, "Expires in 20m" under it,
   then the state, then the counties, then one label:value line per hazard
   parameter with the label dim and the value bold —

       Severe Thunderstorm
       Expires in 20m
       North Carolina
       Cumberland & Sampson
       Hail:    <.75", Radar Indicated
       Wind:    60 mph, Radar Indicated
       Tornado: Possible

   Every one of those parameters is already in the payload /api/nws/alerts
   returns; nothing new is fetched. Two bugs fixed on the way:

     - the old code read `parameters.hailSize`. NWS sends `maxHailSize`, so
       hail size never once rendered.
     - the old code built this with innerHTML out of feed strings. Alert text
       is attacker-influenced in principle and goes straight into the
       document; this builds with DOM APIs and textContent instead. */

const WARN_PARAMS = [
  ['Tornado',  (q) => q.tornadoDetection?.[0]],
  ['Damage',   (q) => q.thunderstormDamageThreat?.[0] || q.tornadoDamageThreat?.[0]],
  ['Hail',     (q) => (q.maxHailSize?.[0] ? `${q.maxHailSize[0]}"` : null)],
  ['Wind',     (q) => q.maxWindGust?.[0]],
  ['Flooding', (q) => q.flashFloodDetection?.[0]],
  ['Damage threat', (q) => q.flashFloodDamageThreat?.[0]],
  ['Waterspout', (q) => q.waterspoutDetection?.[0]],
  ['Motion',   (q) => motionText(q.eventMotionDescription?.[0])],
];

/* NWS ships storm motion as one packed string:

     2026-08-04T15:19:00-00:00...storm...278DEG...8KT...29.75,-86.15

   which the card printed verbatim, wrapped over two lines, next to the word
   "Motion". Nobody reads a bearing out of that. Verified against the live feed
   before parsing it -- both strings in effect at the time matched this shape.

   Anything that does not match falls through unchanged rather than being
   dropped: an unparsed string is ugly, a silently missing one is a lie. */
function motionText(raw) {
  if (!raw) return null;
  const m = String(raw).match(/\.\.\.(\w+)\.\.\.(\d{1,3})DEG\.\.\.(\d{1,3})KT/i);
  if (!m) return raw;
  const [, kind, deg, kt] = m;
  const bearing = Number(deg);
  // NWS gives the direction the cell is moving TOWARD.
  const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
                'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  const card = dirs[Math.round((bearing % 360) / 22.5) % 16];
  const mph = Math.round(Number(kt) * 1.15078);
  const speed = settings.units === 'si'
    ? `${Math.round(Number(kt) * 1.852)} km/h`
    : `${mph} mph`;
  return `${kind} toward ${card} (${bearing}°) at ${speed}`;
}

/* NWS areaDesc is "Cumberland, NC; Sampson, NC" — one "county, ST" per
   segment. Split it so the state can head the card the way RadarScope does
   instead of being repeated after every county. */
function splitAreaDesc(areaDesc) {
  const segs = (areaDesc || '').split(';').map((s) => s.trim()).filter(Boolean);
  const states = new Set();
  const places = [];
  for (const seg of segs) {
    const m = seg.match(/^(.*),\s*([A-Z]{2})$/);
    if (m) { places.push(m[1]); states.add(m[2]); }
    else places.push(seg);
  }
  return { states: [...states], places };
}

function warnRow(cls, text) {
  const el = document.createElement('div');
  el.className = cls;
  el.textContent = text;
  return el;
}

function warnCard(feature, index) {
  const p = feature.properties || {};
  const st = warnStyle(p.event);
  const par = p.parameters || {};
  const mappable = !!feature.geometry;

  const li = document.createElement('li');
  li.className = mappable ? 'warn-card' : 'warn-card is-zone';
  li.dataset.warn = String(index);
  li.style.setProperty('--wc', st.c);          // the bar: the published colour
  li.style.setProperty('--wc-ink', warnInk(st.c));  // the words: legible on dark
  li.title = mappable
    ? 'Click to zoom to the warning polygon'
    : 'Zone-based alert — no polygon issued';

  const top = document.createElement('div');
  top.className = 'wc-top';
  top.appendChild(warnRow('wc-evt', p.event || 'Alert'));
  top.appendChild(warnRow('wc-exp', fmtExpiry(p.expires)));
  li.appendChild(top);

  const { states, places } = splitAreaDesc(p.areaDesc);
  if (states.length) li.appendChild(warnRow('wc-state', states.join(', ')));
  if (places.length) {
    const shown = places.slice(0, 4).join(', ');
    const row = warnRow('wc-area',
      places.length > 4 ? `${shown} +${places.length - 4} more` : shown);
    if (places.length > 4) row.title = places.join(', ');
    li.appendChild(row);
  }

  for (const [label, pick] of WARN_PARAMS) {
    const value = pick(par);
    if (!value) continue;
    const row = document.createElement('div');
    row.className = 'wc-par';
    const k = document.createElement('span');
    k.className = 'wc-par-k';
    k.textContent = `${label}:`;
    const v = document.createElement('span');
    v.className = 'wc-par-v';
    v.textContent = String(value);
    row.append(k, v);
    li.appendChild(row);
  }
  return li;
}

/* ---------------------------------------------------------------------------
   MODEL COMPARISON  —  Single | Compare Runs | Compare Models
   ---------------------------------------------------------------------------
   Weatherfront's segmented control, and the chart shape from the NOAA iDSSe
   desktop: one field, several series, one shared axis, so what you read is the
   spread between them.

   Not a second map pane. Graticule's model field is a point grid on a globe;
   side-by-side maps would mean a second WebGL context, which is the expensive
   item on the list and not what makes model comparison useful anyway. The
   question a forecaster asks is "do the models agree at this point", and that
   is a chart.

   Both axes come from Open-Meteo, free and keyless:
     models  api.open-meteo.com/v1/forecast?...&models=a,b,c
             -> hourly.<field>_<model> per model, one request
     runs    previous-runs-api.open-meteo.com/v1/forecast
             -> hourly.<field>_previous_dayN, the forecast for the same valid
                time made by the run N days ago. Spread here is run-to-run
                consistency, which is a different question from model spread.
   ------------------------------------------------------------------------- */

const CMP = { mode: 'single', abort: null };

// Open-Meteo model ids, with the short labels the survey's apps use.
const CMP_MODELS = [
  ['gfs_seamless',   'GFS',   '#4dd2ff'],
  ['ecmwf_ifs025',   'ECMWF', '#f0abfc'],
  ['icon_seamless',  'ICON',  '#4ade80'],
  ['gem_seamless',   'GEM',   '#fbbf24'],
];
const CMP_RUN_COLORS = ['#4dd2ff', '#8ab4f8', '#a78bfa', '#f0abfc', '#f97373'];
const CMP_RUNS = 4;   // current run plus 3 older ones

function initModelCompare() {
  const seg = document.getElementById('model-mode');
  if (!seg) return;
  seg.querySelectorAll('.seg-b').forEach((b) => {
    b.addEventListener('click', () => {
      CMP.mode = b.dataset.cmp;
      seg.querySelectorAll('.seg-b').forEach((x) => {
        const on = x === b;
        x.classList.toggle('is-active', on);
        x.setAttribute('aria-pressed', String(on));
      });
      const note = document.getElementById('model-note');
      if (note) {
        note.textContent = CMP.mode === 'single'
          ? 'Point sounding: click anywhere on the globe.'
          : CMP.mode === 'runs'
            ? 'Click the globe to compare the last 4 runs of this model.'
            : 'Click the globe to compare GFS, ECMWF, ICON and GEM.';
      }
      if (CMP.mode === 'single') closeCompare();
    });
  });
  document.getElementById('mc-close').addEventListener('click', closeCompare);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && CMP.mode !== 'single') closeCompare();
  });
}

function closeCompare() {
  document.getElementById('modelcompare').classList.add('hidden');
  if (CMP.abort) { CMP.abort.abort(); CMP.abort = null; }
}

/* Called from the globe click handler when a comparison mode is active.
   Returns true if it handled the click. */
async function compareAtPoint(lat, lon) {
  if (CMP.mode === 'single') return false;
  const field = document.getElementById('model-field').value;
  const def = FIELD_DEFS[field] || { label: field, unit: '' };

  const panel = document.getElementById('modelcompare');
  panel.classList.remove('hidden');
  document.getElementById('mc-title').textContent =
    `${def.label} — ${CMP.mode === 'runs' ? 'run spread' : 'model spread'}`;
  document.getElementById('mc-sub').textContent =
    `${lat.toFixed(3)}°, ${lon.toFixed(3)}°  ·  loading…`;

  if (CMP.abort) CMP.abort.abort();
  CMP.abort = new AbortController();

  try {
    const series = CMP.mode === 'runs'
      ? await fetchRunSpread(lat, lon, field, CMP.abort.signal)
      : await fetchModelSpread(lat, lon, field, CMP.abort.signal);
    if (!series.length) throw new Error('no series returned');
    drawCompareChart(series, def);
    document.getElementById('mc-sub').textContent =
      `${lat.toFixed(3)}°, ${lon.toFixed(3)}°  ·  ${series.length} series  ·  Open-Meteo`;
  } catch (err) {
    if (err.name === 'AbortError') return true;
    console.warn('model comparison failed:', err);
    document.getElementById('mc-sub').textContent =
      `${lat.toFixed(3)}°, ${lon.toFixed(3)}°  ·  unavailable`;
    document.getElementById('mc-svg').textContent = '';
    document.getElementById('mc-legend').textContent = '';
  }
  return true;
}

async function fetchModelSpread(lat, lon, field, signal) {
  const ids = CMP_MODELS.map((m) => m[0]).join(',');
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}`
    + `&longitude=${lon.toFixed(4)}&hourly=${field}&models=${ids}`
    + `&forecast_days=5&timezone=UTC&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch`;
  const r = await fetch(url, { signal });
  if (!r.ok) throw new Error(`open-meteo ${r.status}`);
  const d = await r.json();
  const t = d.hourly?.time || [];
  return CMP_MODELS.map(([id, label, colour]) => ({
    label, colour, time: t, values: d.hourly?.[`${field}_${id}`] || [],
  })).filter((s) => s.values.some((v) => v != null));
}

async function fetchRunSpread(lat, lon, field, signal) {
  const vars = [field];
  for (let i = 1; i < CMP_RUNS; i++) vars.push(`${field}_previous_day${i}`);
  const url = `https://previous-runs-api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}`
    + `&longitude=${lon.toFixed(4)}&hourly=${vars.join(',')}`
    + `&forecast_days=5&timezone=UTC&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch`;
  const r = await fetch(url, { signal });
  if (!r.ok) throw new Error(`open-meteo previous-runs ${r.status}`);
  const d = await r.json();
  const t = d.hourly?.time || [];
  return vars.map((v, i) => ({
    label: i === 0 ? 'Latest run' : `${i}d older`,
    colour: CMP_RUN_COLORS[i % CMP_RUN_COLORS.length],
    time: t, values: d.hourly?.[v] || [],
  })).filter((s) => s.values.some((x) => x != null));
}

/* Hand-drawn SVG rather than a chart library: four polylines and an axis do
   not justify a dependency, and this keeps the payload and the parse cost at
   zero. */
function drawCompareChart(series, def) {
  const svg = document.getElementById('mc-svg');
  const NS = 'http://www.w3.org/2000/svg';
  const W = 1000, H = 260, PAD_L = 46, PAD_R = 10, PAD_T = 10, PAD_B = 24;
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.textContent = '';

  const all = series.flatMap((s) => s.values).filter((v) => v != null);
  let lo = Math.min(...all), hi = Math.max(...all);
  if (hi === lo) { hi += 1; lo -= 1; }
  const pad = (hi - lo) * 0.08;
  lo -= pad; hi += pad;
  const n = Math.max(...series.map((s) => s.values.length));
  const x = (i) => PAD_L + (i / Math.max(1, n - 1)) * (W - PAD_L - PAD_R);
  const y = (v) => PAD_T + (1 - (v - lo) / (hi - lo)) * (H - PAD_T - PAD_B);

  const add = (tag, attrs, text) => {
    const el = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    if (text != null) el.textContent = text;
    svg.appendChild(el);
    return el;
  };

  // Horizontal gridlines with value labels.
  for (let g = 0; g <= 4; g++) {
    const v = lo + (hi - lo) * (g / 4);
    add('line', { x1: PAD_L, x2: W - PAD_R, y1: y(v), y2: y(v),
                  stroke: 'rgba(255,255,255,0.07)', 'stroke-width': 1 });
    add('text', { x: PAD_L - 6, y: y(v) + 3, fill: '#5a6373', 'font-size': 10,
                  'text-anchor': 'end', 'font-family': 'monospace' },
        v.toFixed(Math.abs(hi - lo) < 5 ? 1 : 0));
  }

  // A day tick wherever the hour rolls past 00Z.
  const t0 = series[0].time;
  for (let i = 0; i < n; i++) {
    if (!t0[i] || !t0[i].endsWith('T00:00')) continue;
    add('line', { x1: x(i), x2: x(i), y1: PAD_T, y2: H - PAD_B,
                  stroke: 'rgba(255,255,255,0.10)', 'stroke-width': 1 });
    add('text', { x: x(i) + 4, y: H - PAD_B + 14, fill: '#5a6373',
                  'font-size': 10, 'font-family': 'monospace' }, t0[i].slice(5, 10));
  }

  for (const s of series) {
    const pts = [];
    s.values.forEach((v, i) => { if (v != null) pts.push(`${x(i)},${y(v)}`); });
    if (pts.length < 2) continue;
    add('polyline', { points: pts.join(' '), fill: 'none', stroke: s.colour,
                      'stroke-width': 1.8, 'stroke-linejoin': 'round' });
  }

  const leg = document.getElementById('mc-legend');
  leg.textContent = '';
  /* In run mode the last value is the wrong number to show. Open-Meteo
     back-fills the tail of an older run with the latest run's values — the
     final six hours are byte-identical across all four — so a "last value"
     legend prints four identical figures and the feature looks broken when
     the runs actually differ by up to 10°F earlier in the window. Report the
     largest departure from the latest run instead, which is the question run
     comparison exists to answer. */
  const base = series[0].values;
  series.forEach((s, i) => {
    const item = document.createElement('span');
    item.className = 'mc-leg';
    const dot = document.createElement('i');
    dot.style.background = s.colour;
    const lab = document.createElement('span');
    const last = [...s.values].reverse().find((v) => v != null);
    let text = last != null ? `${s.label} · ${last}${def.unit || ''}` : s.label;
    if (CMP.mode === 'runs' && i > 0) {
      let worst = 0;
      s.values.forEach((v, k) => {
        if (v != null && base[k] != null) worst = Math.max(worst, Math.abs(v - base[k]));
      });
      text = `${s.label} · max Δ ${worst.toFixed(1)}${def.unit || ''}`;
    }
    lab.textContent = text;
    item.append(dot, lab);
    leg.appendChild(item);
  });
}


/* ---------------------------------------------------------------------------
   WILDFIRE CAMERAS and SPOTTER REPORTS
   ---------------------------------------------------------------------------
   Two rows of StormCat5's capability chart that this app had written off.

   "Webcams" was marked key-gated because Windy's webcam API needs a key.
   ALERTCalifornia / UC San Diego publish ~1,280 geolocated wildfire cameras
   and their current frames with no key at all, and they pair with the FIRMS
   fire-detection layer already here: a hotspot plus a camera pointed at it is
   a far better answer than either alone.

   "Storm Chaser Feeds" was marked not possible without per-chaser
   partnerships. That was wrong. Spotter Network publishes a public GRLevelX
   placefile of live spotter reports — the same ground truth the desktop radar
   apps plot — and it needs no account. Reports, not raw chaser positions,
   which is the part that genuinely does need a partnership.

   Both are proxied through the server: the upstream hosts set no CORS
   headers, the placefile needs parsing, and ~900 of the camera records carry
   null coordinates that would become NaN positions and corrupt Cesium's
   frustum computation. */

/* Three fleets that answer different questions, so they read differently:
   wildfire lookouts, highway CCTV, city intersections. */
const CAMERA_TONE = {
  'ALERTCalifornia': '#fb923c',
  'Caltrans': '#67e8f9',
  'NYC DOT': '#a78bfa',
};

let camerasDS = null;
let spottersDS = null;

function toggleCameras(on) {
  if (!camerasDS) {
    camerasDS = new Cesium.CustomDataSource('cameras');
    viewer.dataSources.add(camerasDS);
  }
  camerasDS.show = !!on;
  if (on && camerasDS.entities.values.length === 0) refreshCameras();
  viewer.scene.requestRender();
}

async function refreshCameras() {
  if (!camerasDS || !camerasDS.show) return;
  let gj;
  try {
    const r = await fetch('/api/cameras');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    gj = await r.json();
  } catch (err) {
    pushEvent('CAM', `Wildfire cameras unavailable (${err.message})`, Date.now());
    setCount('cameras', 'error');
    return;
  }

  camerasDS.entities.removeAll();
  const feats = gj.features || [];
  for (const f of feats) {
    const [lon, lat] = f.geometry.coordinates;
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    const p = f.properties;
    const tone = CAMERA_TONE[p.network] || '#67e8f9';
    camerasDS.entities.add({
      position: Cesium.Cartesian3.fromDegrees(lon, lat),
      point: {
        pixelSize: p.in_service === false ? 4 : 6,
        color: Cesium.Color.fromCssColorString(tone)
          .withAlpha(p.in_service === false ? 0.45 : 1.0),
        outlineColor: Cesium.Color.BLACK.withAlpha(0.7),
        outlineWidth: 1,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      /* 1,281 label glyphs would blow the atlas Cesium allocates per
         LabelCollection, so names appear only inside ~120km. */
      label: {
        text: p.name || p.id,
        font: '600 10px Inter, sans-serif',
        fillColor: Cesium.Color.fromCssColorString(tone),
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 3,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(0, -12),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 120_000),
      },
      properties: { ...p },
    });
  }
  setCount('cameras', feats.length);
  updateCategoryCounts();
  viewer.scene.requestRender();
}

const SPOTTER_TONE = {
  tornado: '#f0abfc', funnel: '#f0abfc', 'wall cloud': '#e879f9',
  hail: '#4dd2ff', wind: '#fbbf24', flood: '#4ade80',
};

function spotterColour(report) {
  const r = (report || '').toLowerCase();
  for (const [k, c] of Object.entries(SPOTTER_TONE)) if (r.includes(k)) return c;
  return '#f97373';
}

function toggleSpotters(on) {
  if (!spottersDS) {
    spottersDS = new Cesium.CustomDataSource('spotters');
    viewer.dataSources.add(spottersDS);
  }
  spottersDS.show = !!on;
  if (on) refreshSpotters();
  viewer.scene.requestRender();
}

async function refreshSpotters() {
  if (!spottersDS || !spottersDS.show) return;
  let gj;
  try {
    const r = await fetch('/api/spotters');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    gj = await r.json();
  } catch (err) {
    pushEvent('SPOT', `Spotter reports unavailable (${err.message})`, Date.now());
    setCount('spotters', 'error');
    return;
  }

  spottersDS.entities.removeAll();
  const feats = gj.features || [];
  for (const f of feats) {
    const [lon, lat] = f.geometry.coordinates;
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    const p = f.properties;
    const colour = spotterColour(p.report);
    spottersDS.entities.add({
      position: Cesium.Cartesian3.fromDegrees(lon, lat),
      point: {
        pixelSize: 9,
        color: Cesium.Color.fromCssColorString(colour),
        outlineColor: Cesium.Color.BLACK.withAlpha(0.75),
        outlineWidth: 1,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      label: {
        text: p.report || 'Report',
        font: '600 10px Inter, sans-serif',
        fillColor: Cesium.Color.fromCssColorString(colour),
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 3,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(0, -14),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 4_000_000),
      },
      properties: { ...p },
    });
  }
  setCount('spotters', feats.length);
  updateCategoryCounts();
  viewer.scene.requestRender();
}

// ═══════════════════════════════════════════════════════════════════════════
//  AREA DARKENING  —  county selection + inverse mask
//  Weatherfront 2, Settings > Maps > Area Darkening. Pick counties on the map,
//  everything outside them dims to a set opacity, and labels can be clipped to
//  the same area. It is a framing tool: a frame that says "this is the part of
//  the map I am talking about" without the viewer having to hunt for it.
// ═══════════════════════════════════════════════════════════════════════════

const AD = {
  counties: [],           // records straight out of ne_counties.json
  byFips: new Map(),
  selected: new Set(),    // FIPS strings
  loading: null,          // in-flight load promise, so two callers share one fetch
  loaded: false,
  arming: false,          // selection mode engaged
  handler: null,
  ds: null,
  mask: null,
  outlines: [],
  hoverFips: null,
  hoverSelected: false,
  hoverEnt: null,
  dragging: false,
  dragMoved: false,
  dragTouched: null,      // counties already handled during this drag
  downFips: null,         // county under the press that started this gesture
  downWasSelected: false,
  rebuildTimer: null,
  camSaved: null,
};

// The mask cannot simply be the whole globe: a polygon wider than 180 degrees
// of longitude has no unambiguous interior and Cesium's triangulator will pick
// the wrong one. Every county except the Aleutian rings that cross the
// antimeridian lives inside this box, which is 128 degrees wide.
const AD_BOX = { w: -180, s: 5, e: -52, n: 78 };
const AD_COUNTIES_URL = '/static/data/ne_counties.json';
const AD_ACCENT = '#4dd2ff';
// Rebuilding the mask is the expensive half of a selection change. Outlines
// repaint immediately so a drag still feels direct; the mask catches up once
// the pointer settles.
const AD_REBUILD_DEBOUNCE_MS = 140;

async function adLoad() {
  if (AD.loaded) return true;
  if (AD.loading) return AD.loading;
  AD.loading = (async () => {
    try {
      const r = await fetch(AD_COUNTIES_URL);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      AD.counties = data.counties || [];
      AD.byFips = new Map(AD.counties.map((c) => [c.f, c]));
      AD.loaded = AD.counties.length > 0;
      if (!AD.loaded) throw new Error('file parsed but held no counties');
      console.log(`Counties: ${AD.counties.length} loaded`);
      return true;
    } catch (err) {
      // 2.8 MB of geometry that never arrived is not something to fail
      // silently on: every downstream symptom (nothing highlights, nothing
      // darkens) looks like a bug in the selection code instead.
      console.warn('Counties failed to load:', err);
      pushEvent('AREA', `County data unavailable (${err.message})`, Date.now());
      AD.loading = null;
      return false;
    }
  })();
  return AD.loading;
}

// ---------- hit test --------------------------------------------------------

// Even-odd ray cast. Mirrored by _point_in_rings() in scripts/build_counties.py,
// which runs it over all 3,223 label points as a build-time control.
function adPointInRings(rings, x, y) {
  let hit = false;
  for (const flat of rings) {
    const n = flat.length / 2;
    let j = n - 1;
    for (let i = 0; i < n; i++) {
      const xi = flat[2 * i], yi = flat[2 * i + 1];
      const xj = flat[2 * j], yj = flat[2 * j + 1];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
      j = i;
    }
  }
  return hit;
}

function adHitTest(lon, lat) {
  for (const c of AD.counties) {
    const b = c.b;
    if (lon < b[0] || lon > b[2] || lat < b[1] || lat > b[3]) continue;
    if (adPointInRings(c.r, lon, lat)) return c;
  }
  return null;
}

function adPickLatLon(screenPos) {
  const cart = pickGlobe(screenPos);
  if (!cart) return null;
  const carto = Cesium.Cartographic.fromCartesian(cart);
  return {
    lon: Cesium.Math.toDegrees(carto.longitude),
    lat: Cesium.Math.toDegrees(carto.latitude),
  };
}

// ---------- geometry --------------------------------------------------------

function adEnsureDS() {
  if (!AD.ds) {
    AD.ds = new Cesium.CustomDataSource('area-darkening');
    viewer.dataSources.add(AD.ds);
  }
  return AD.ds;
}

function adRingPositions(flat) {
  return Cesium.Cartesian3.fromDegreesArray(flat);
}

// True when every vertex sits inside AD_BOX. The one county that fails this is
// Aleutians West, whose western rings sit past the antimeridian; a hole outside
// its own outer ring is undefined, so those rings stay out of the mask. The
// county still selects, highlights and hit-tests normally.
function adRingInBox(flat) {
  for (let i = 0; i < flat.length; i += 2) {
    if (flat[i] < AD_BOX.w || flat[i] > AD_BOX.e) return false;
    if (flat[i + 1] < AD_BOX.s || flat[i + 1] > AD_BOX.n) return false;
  }
  return true;
}

function adBoxRing() {
  // Densified along parallels and meridians. A four-corner ring gets
  // triangulated across great circles and bows away from the box edges by
  // hundreds of kilometres at these spans.
  const step = 4, out = [];
  for (let lon = AD_BOX.w; lon < AD_BOX.e; lon += step) out.push(lon, AD_BOX.s);
  for (let lat = AD_BOX.s; lat < AD_BOX.n; lat += step) out.push(AD_BOX.e, lat);
  for (let lon = AD_BOX.e; lon > AD_BOX.w; lon -= step) out.push(lon, AD_BOX.n);
  for (let lat = AD_BOX.n; lat > AD_BOX.s; lat -= step) out.push(AD_BOX.w, lat);
  return out;
}

function adMaskColor() {
  return Cesium.Color.BLACK.withAlpha(Number(settings.adOpacity) || 0.6);
}

function adRebuildMask() {
  const ds = adEnsureDS();
  if (AD.mask) { ds.entities.remove(AD.mask); AD.mask = null; }

  if (!settings.areaDarkening || AD.selected.size === 0) {
    viewer.scene.requestRender();
    return;
  }

  const holes = [];
  for (const fips of AD.selected) {
    const c = AD.byFips.get(fips);
    if (!c) continue;
    for (const flat of c.r) {
      if (!adRingInBox(flat)) continue;
      holes.push(new Cesium.PolygonHierarchy(adRingPositions(flat)));
    }
  }
  AD.mask = ds.entities.add({
    polygon: {
      hierarchy: new Cesium.PolygonHierarchy(adRingPositions(adBoxRing()), holes),
      material: adMaskColor(),
      // No height, so this drapes on the globe as a ground primitive rather
      // than floating as a shell above it.
      arcType: Cesium.ArcType.RHUMB,
      classificationType: Cesium.ClassificationType.TERRAIN,
    },
  });
  viewer.scene.requestRender();
}

function adRebuildOutlines() {
  const ds = adEnsureDS();
  for (const e of AD.outlines) ds.entities.remove(e);
  AD.outlines = [];
  if (!AD.selected.size) { viewer.scene.requestRender(); return; }
  const colour = Cesium.Color.fromCssColorString(AD_ACCENT).withAlpha(0.9);
  for (const fips of AD.selected) {
    const c = AD.byFips.get(fips);
    if (!c) continue;
    for (const flat of c.r) {
      const pos = adRingPositions(flat);
      if (pos.length < 2) continue;
      AD.outlines.push(ds.entities.add({
        polyline: {
          positions: pos.concat([pos[0]]),
          width: 1.5,
          material: colour,
          clampToGround: true,
        },
      }));
    }
  }
  viewer.scene.requestRender();
}

function adScheduleRebuild() {
  adRebuildOutlines();
  adSyncUI();
  clearTimeout(AD.rebuildTimer);
  AD.rebuildTimer = setTimeout(() => {
    adRebuildMask();
    if (settings.adFilterLabels) relabelCities();
  }, AD_REBUILD_DEBOUNCE_MS);
}

function adSetHover(county) {
  const fips = county ? county.f : null;
  const sel = county ? AD.selected.has(fips) : false;
  // The selected-state is part of the identity, not just the paint. Comparing
  // FIPS alone left the strong "would add" wash sitting on a county the press
  // had just added, so the county read as still unselected.
  if (fips === AD.hoverFips && sel === AD.hoverSelected) return;
  AD.hoverFips = fips;
  AD.hoverSelected = sel;
  const ds = adEnsureDS();
  if (AD.hoverEnt) { ds.entities.remove(AD.hoverEnt); AD.hoverEnt = null; }
  if (county) {
    AD.hoverEnt = ds.entities.add({
      polygon: {
        hierarchy: new Cesium.PolygonHierarchy(adRingPositions(county.r[0])),
        material: Cesium.Color.fromCssColorString(AD_ACCENT).withAlpha(sel ? 0.08 : 0.18),
        arcType: Cesium.ArcType.RHUMB,
        classificationType: Cesium.ClassificationType.TERRAIN,
      },
    });
  }
  const el = document.getElementById('cb-hover');
  if (el) el.textContent = county ? `${county.n}, ${county.s}` : '—';
  viewer.scene.requestRender();
}

// ---------- selection -------------------------------------------------------

function adPersist() {
  settings.adCounties = [...AD.selected];
  saveSettings();
}

function adClear() {
  if (!AD.selected.size) return;
  AD.selected.clear();
  adPersist();
  adScheduleRebuild();
}

// ---------- pointer mode ----------------------------------------------------

async function adSetSelecting(on) {
  on = !!on;
  if (on && !(await adLoad())) return;
  AD.arming = on;

  document.getElementById('countybar')?.classList.toggle('hidden', !on);
  // The county bar and the scene transport share the bottom-centre lane. The
  // class is on <body> so anything else that lands there can stand down too.
  document.body.classList.toggle('is-selecting-counties', on);
  const btn = document.getElementById('ad-select');
  if (btn) btn.textContent = on ? 'Selecting on globe' : 'Select on globe';

  // Left-drag has to paint counties, so the camera cannot also own it. Zoom
  // stays live: a selection spanning two states is unreachable otherwise.
  const c = viewer.scene.screenSpaceCameraController;
  if (on) {
    if (!AD.camSaved) {
      AD.camSaved = {
        rotate: c.enableRotate, translate: c.enableTranslate,
        tilt: c.enableTilt, look: c.enableLook,
      };
    }
    c.enableRotate = c.enableTranslate = c.enableTilt = c.enableLook = false;
  } else if (AD.camSaved) {
    c.enableRotate = AD.camSaved.rotate;
    c.enableTranslate = AD.camSaved.translate;
    c.enableTilt = AD.camSaved.tilt;
    c.enableLook = AD.camSaved.look;
    AD.camSaved = null;
  }

  if (on && !AD.handler) {
    AD.handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    AD.handler.setInputAction((e) => adPointerDown(e.position),
      Cesium.ScreenSpaceEventType.LEFT_DOWN);
    AD.handler.setInputAction((e) => adPointerMove(e.endPosition),
      Cesium.ScreenSpaceEventType.MOUSE_MOVE);
    AD.handler.setInputAction(() => adPointerUp(),
      Cesium.ScreenSpaceEventType.LEFT_UP);
  } else if (!on && AD.handler) {
    AD.handler.destroy();
    AD.handler = null;
    adSetHover(null);
  }

  // Arming selection with darkening switched off shows nothing at all, which
  // reads as a broken button. Turn it on rather than making the user find it.
  if (on && !settings.areaDarkening) {
    settings.areaDarkening = true;
    saveSettings();
    const cb = document.getElementById('ad-enabled');
    if (cb) cb.checked = true;
    adScheduleRebuild();
  }
  adSyncUI();
}

function adPointerDown(screenPos) {
  const ll = adPickLatLon(screenPos);
  AD.dragging = true;
  AD.dragMoved = false;
  AD.dragTouched = new Set();
  AD.downFips = null;
  AD.downWasSelected = false;
  if (!ll) return;
  const c = adHitTest(ll.lon, ll.lat);
  if (!c) return;
  AD.downFips = c.f;
  AD.downWasSelected = AD.selected.has(c.f);
  AD.dragTouched.add(c.f);
  // A press on an unselected county starts an add-drag straight away. Removal
  // is resolved on mouse-up instead, because a drag that began on a selected
  // county is far more likely to be someone extending the selection.
  if (!AD.downWasSelected) {
    AD.selected.add(c.f);
    adPersist();
    adScheduleRebuild();
  }
  adSetHover(c);
}

function adPointerMove(screenPos) {
  const ll = adPickLatLon(screenPos);
  if (!ll) { adSetHover(null); return; }
  const c = adHitTest(ll.lon, ll.lat);
  if (AD.dragging) {
    AD.dragMoved = true;
    if (c && !AD.dragTouched.has(c.f)) {
      AD.dragTouched.add(c.f);
      if (!AD.selected.has(c.f)) {
        AD.selected.add(c.f);
        adPersist();
        adScheduleRebuild();
      }
    }
  }
  // Last, and during the drag as well. Setting hover first painted the strong
  // "would add" wash over a county this same event had just selected; freezing
  // it during a drag left it stuck wherever the gesture started.
  adSetHover(c);
}

function adPointerUp() {
  if (!AD.dragging) return;
  const wasClick = !AD.dragMoved;
  AD.dragging = false;
  AD.dragMoved = false;
  AD.dragTouched = null;
  // A click on a county that was already selected before this gesture means
  // remove. Anything else was handled on the way down or during the drag.
  if (wasClick && AD.downFips && AD.downWasSelected) {
    AD.selected.delete(AD.downFips);
    adPersist();
    adScheduleRebuild();
  }
  AD.downFips = null;
  AD.downWasSelected = false;
}

function adSyncUI() {
  const n = AD.selected.size;
  const clear = document.getElementById('ad-clear');
  if (clear) { clear.textContent = `Clear (${n})`; clear.disabled = n === 0; }
  const count = document.getElementById('cb-count');
  if (count) count.textContent = `${n} selected`;
  const cbClear = document.getElementById('cb-clear');
  if (cbClear) cbClear.disabled = n === 0;
}

// True when city labels should be clipped to the selection. Read by
// relabelCities() on every camera settle.
function adLabelsFiltered() {
  return !!(settings.adFilterLabels && settings.areaDarkening && AD.selected.size);
}

function adInsideSelection(lon, lat) {
  for (const fips of AD.selected) {
    const c = AD.byFips.get(fips);
    if (!c) continue;
    const b = c.b;
    if (lon < b[0] || lon > b[2] || lat < b[1] || lat > b[3]) continue;
    if (adPointInRings(c.r, lon, lat)) return true;
  }
  return false;
}

// ---------- boot ------------------------------------------------------------

function initAreaDarkening() {
  const enabled = document.getElementById('ad-enabled');
  if (enabled) {
    enabled.checked = !!settings.areaDarkening;
    enabled.addEventListener('change', async () => {
      settings.areaDarkening = enabled.checked;
      saveSettings();
      if (enabled.checked && !(await adLoad())) return;
      adRebuildMask();
      adRebuildOutlines();
      relabelCities();
    });
  }

  const opacity = document.getElementById('ad-opacity');
  const opacityVal = document.getElementById('ad-opacity-val');
  if (opacity) {
    opacity.value = String(settings.adOpacity);
    if (opacityVal) opacityVal.textContent = Number(settings.adOpacity).toFixed(2);
    opacity.addEventListener('input', () => {
      settings.adOpacity = Number(opacity.value);
      if (opacityVal) opacityVal.textContent = settings.adOpacity.toFixed(2);
      saveSettings();
      // Recolour in place. Rebuilding the hierarchy to change an alpha would
      // re-triangulate every hole on every step of the slider.
      if (AD.mask) AD.mask.polygon.material = adMaskColor();
      viewer.scene.requestRender();
    });
  }

  const filter = document.getElementById('ad-filter-labels');
  if (filter) {
    filter.checked = !!settings.adFilterLabels;
    filter.addEventListener('change', () => {
      settings.adFilterLabels = filter.checked;
      saveSettings();
      relabelCities();
    });
  }

  document.getElementById('ad-select')?.addEventListener('click', () => {
    document.getElementById('settings-overlay')?.classList.add('hidden');
    adSetSelecting(true);
  });
  document.getElementById('ad-clear')?.addEventListener('click', adClear);
  document.getElementById('cb-clear')?.addEventListener('click', adClear);
  document.getElementById('cb-done')?.addEventListener('click', () => adSetSelecting(false));

  // Cesium's ScreenSpaceEventHandler has no leave event, so the last hover
  // highlight would stay lit on the globe the whole time the pointer is over
  // the bar or the HUD.
  viewer.scene.canvas.addEventListener('mouseleave', () => {
    if (AD.arming) adSetHover(null);
  });

  // Escape leaves selection mode. Without it the camera stays locked and the
  // globe reads as frozen.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && AD.arming) adSetSelecting(false);
  });

  // Restore a persisted selection. Only pay the 2.8 MB when there is something
  // to draw with it.
  const saved = Array.isArray(settings.adCounties) ? settings.adCounties : [];
  if (saved.length) {
    adLoad().then((ok) => {
      if (!ok) return;
      for (const f of saved) if (AD.byFips.has(f)) AD.selected.add(f);
      adRebuildOutlines();
      adRebuildMask();
      adSyncUI();
      if (settings.adFilterLabels) relabelCities();
    });
  }
  adSyncUI();
}

// ═══════════════════════════════════════════════════════════════════════════
//  WATER  —  river gauges, tide stations, marine buoys
//  The part of a storm picture radar cannot show: what the rain did after it
//  landed, what the surge is doing at the coast, what the sea state is
//  offshore. All three feeds are keyless federal sources; see the endpoint
//  comments in graticule/server.py for why each one was chosen.
// ═══════════════════════════════════════════════════════════════════════════

/* Flood category drives the colour, because the category is the finding and
   the stage in feet is only evidence for it. A gauge reading 51 ft means
   nothing on its own; "major" means evacuate. Ordered least to most severe. */
const RIVER_TONE = {
  major:    '#f0abfc',
  moderate: '#ef4444',
  minor:    '#fb923c',
  action:   '#facc15',
};
const RIVER_BASE = '#38bdf8';

/* 11,534 gauges is more dots than the globe can say anything with at range.
   Ones at or above action stage stay visible from orbit; the rest appear as
   you come down. Same shape as ddcQuake/ddcFire. */
const RIVER_FAR_FLOODING = 2.4e7;
const RIVER_FAR_NORMAL = 1_600_000;
/* Labels go ONLY to flooding gauges. Cesium allocates one glyph atlas per
   LabelCollection eagerly, ignoring distanceDisplayCondition, and 11k labels
   is how the Cities layer took the renderer down (issues.md #2). */
const RIVER_LABEL_FAR = 900_000;

/* Sea state in whichever units the reader chose. The dot-size thresholds in
   buoyStyle stay in metres because they are Douglas-scale boundaries, not a
   display choice. */
function waveNum(metres) {
  const c = convertUnit(metres, { unit: 'm', us: true });
  return { value: Number(c.n.toFixed(1)), unit: c.unit };
}
/* Always one decimal. Same reason as convertUnit: a map label reading "3 ft"
   next to one reading "3.3 ft" looks like two different measurements. */
function waveText(metres) {
  const w = waveNum(metres);
  return `${w.value.toFixed(1)} ${w.unit}`;
}
function windNum(mps) {
  const c = convertUnit(mps, { unit: 'm/s', us: true });
  return { value: Number(c.n.toFixed(1)), unit: c.unit };
}

function riverTone(p) {
  return RIVER_TONE[p.flood_category] || RIVER_BASE;
}

function toggleRivers(on) {
  if (!riversDS) {
    riversDS = new Cesium.CustomDataSource('rivers');
    viewer.dataSources.add(riversDS);
  }
  riversDS.show = !!on;
  if (on && riversDS.entities.values.length === 0) refreshRivers();
  viewer.scene.requestRender();
}

async function refreshRivers() {
  if (!riversDS || !riversDS.show) return;
  let gj;
  try {
    // The first uncached call walks four NWPS tiles and takes ~19 s.
    const r = await fetch('/api/rivers');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    gj = await r.json();
  } catch (err) {
    pushEvent('RIVER', `River gauges unavailable (${err.message})`, Date.now());
    setCount('rivers', 'error');
    return;
  }

  riversDS.entities.removeAll();
  const feats = gj.features || [];
  for (const f of feats) {
    const [lon, lat] = f.geometry.coordinates;
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    const p = f.properties;
    const flooding = (p.flood_rank || 0) >= 1;
    const tone = Cesium.Color.fromCssColorString(riverTone(p));
    const far = flooding ? RIVER_FAR_FLOODING : RIVER_FAR_NORMAL;

    // renderDetail skips nested objects, so the readings are flattened here
    // rather than handed over as { value, unit, valid }.
    const obs = p.observed || null;
    const fcst = p.forecast || null;
    const flat = {
      kind: 'rivers',
      id: p.id, name: p.name, state: p.state,
      flood_category: p.flood_category,
      wfo: p.wfo, rfc: p.rfc,
      stage: obs ? obs.value : null,
      stage_unit: obs ? obs.unit : '',
      observed_at: obs ? obs.valid : '',
      flow: obs && obs.flow != null ? obs.flow : null,
      flow_unit: obs ? (obs.flow_unit || '') : '',
      forecast_stage: fcst ? fcst.value : null,
      forecast_at: fcst ? fcst.valid : '',
    };

    const ent = {
      position: Cesium.Cartesian3.fromDegrees(lon, lat),
      point: {
        pixelSize: flooding ? 9 : 5,
        color: tone,
        outlineColor: Cesium.Color.BLACK.withAlpha(0.75),
        outlineWidth: flooding ? 1.5 : 1,
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, far),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      properties: flat,
    };
    if (flooding) {
      ent.label = {
        text: p.name || p.id,
        font: '600 10px Inter, sans-serif',
        fillColor: tone,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 3,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(0, -13),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, RIVER_LABEL_FAR),
      };
    }
    riversDS.entities.add(ent);
  }
  setCount('rivers', feats.length);
  if (gj.flooding) {
    pushEvent('RIVER', `${gj.flooding} river gauges at or above action stage`, Date.now());
  }
  noteFeed('rivers');
  updateCategoryCounts();
  viewer.scene.requestRender();
}

function toggleTides(on) {
  if (!tidesDS) {
    tidesDS = new Cesium.CustomDataSource('tides');
    viewer.dataSources.add(tidesDS);
  }
  tidesDS.show = !!on;
  if (on && tidesDS.entities.values.length === 0) refreshTides();
  viewer.scene.requestRender();
}

async function refreshTides() {
  if (!tidesDS || !tidesDS.show) return;
  let gj;
  try {
    const r = await fetch('/api/tides');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    gj = await r.json();
  } catch (err) {
    pushEvent('TIDE', `Tide stations unavailable (${err.message})`, Date.now());
    setCount('tides', 'error');
    return;
  }

  tidesDS.entities.removeAll();
  // Indigo, not the cyan it started as. Tide stations and buoys both
  // crowd the coastline, and two teals a shade apart are one layer to
  // the eye. Buoys keep the teal because their palette runs warm with
  // wave height and needs the cool end to itself.
  const tone = Cesium.Color.fromCssColorString('#818cf8');
  for (const f of gj.features || []) {
    const [lon, lat] = f.geometry.coordinates;
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    const p = f.properties;
    tidesDS.entities.add({
      position: Cesium.Cartesian3.fromDegrees(lon, lat),
      point: {
        pixelSize: 7,
        color: tone,
        outlineColor: Cesium.Color.BLACK.withAlpha(0.75),
        outlineWidth: 1,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      label: {
        text: p.name || p.id,
        font: '600 10px Inter, sans-serif',
        fillColor: tone,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 3,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(0, -12),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 1_200_000),
      },
      properties: { ...p },
    });
  }
  setCount('tides', (gj.features || []).length);
  noteFeed('tides');
  updateCategoryCounts();
  viewer.scene.requestRender();
}

function toggleBuoys(on) {
  if (!buoysDS) {
    buoysDS = new Cesium.CustomDataSource('buoys');
    viewer.dataSources.add(buoysDS);
  }
  buoysDS.show = !!on;
  if (on && buoysDS.entities.values.length === 0) refreshBuoys();
  viewer.scene.requestRender();
}

/* Sea state is the thing a buoy is for, so the dot grows with wave height
   rather than sitting at a constant size next to a number nobody reads at
   range. Stops are the Douglas scale boundaries: slight, moderate, rough,
   very rough, high. */
function buoyStyle(p) {
  const h = p.wave_height;
  if (h == null) return { size: 5, tone: '#5eead4' };
  if (h >= 6) return { size: 13, tone: '#f0abfc' };
  if (h >= 4) return { size: 11, tone: '#ef4444' };
  if (h >= 2.5) return { size: 9, tone: '#fb923c' };
  if (h >= 1.25) return { size: 7, tone: '#facc15' };
  return { size: 6, tone: '#5eead4' };
}

async function refreshBuoys() {
  if (!buoysDS || !buoysDS.show) return;
  let gj;
  try {
    const r = await fetch('/api/buoys');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    gj = await r.json();
  } catch (err) {
    pushEvent('BUOY', `Marine buoys unavailable (${err.message})`, Date.now());
    setCount('buoys', 'error');
    return;
  }

  buoysDS.entities.removeAll();
  for (const f of gj.features || []) {
    const [lon, lat] = f.geometry.coordinates;
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    const p = f.properties;
    const st = buoyStyle(p);
    buoysDS.entities.add({
      position: Cesium.Cartesian3.fromDegrees(lon, lat),
      point: {
        pixelSize: st.size,
        color: Cesium.Color.fromCssColorString(st.tone),
        outlineColor: Cesium.Color.BLACK.withAlpha(0.75),
        outlineWidth: 1,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      label: {
        text: p.wave_height != null ? waveText(p.wave_height) : p.id,
        font: '600 10px "JetBrains Mono", monospace',
        fillColor: Cesium.Color.fromCssColorString(st.tone),
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 3,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(0, -12),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 2_500_000),
      },
      properties: { ...p },
    });
  }
  setCount('buoys', (gj.features || []).length);
  noteFeed('buoys');
  updateCategoryCounts();
  viewer.scene.requestRender();
}

/* Tide drill-down. The station layer carries no water level: filling 301
   markers would be 602 CO-OPS requests to populate a panel showing one. The
   level and today's highs and lows are fetched when the station is opened,
   and rendered into a slot renderDetail leaves behind. */
async function loadTideDetail(stationId, slot) {
  let d;
  try {
    const r = await fetch(`/api/tide/${encodeURIComponent(stationId)}`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    d = await r.json();
  } catch (err) {
    slot.textContent = `Water level unavailable (${err.message})`;
    slot.classList.add('td-err');
    return;
  }
  // The panel may have moved on to another entity while this was in flight.
  if (slot.dataset.station !== stationId || !slot.isConnected) return;

  slot.textContent = '';
  if (d.level) {
    const head = document.createElement('div');
    head.className = 'dt-headline';
    const big = document.createElement('span');
    big.className = 'dt-big';
    big.textContent = Number(d.level.v).toFixed(2);
    const unit = document.createElement('span');
    unit.className = 'dt-unit';
    unit.textContent = 'ft';
    const note = document.createElement('span');
    note.className = 'dt-note';
    note.textContent = `observed ${d.level.t} UTC · MLLW`;
    head.append(big, unit, note);
    slot.appendChild(head);
  } else {
    const none = document.createElement('div');
    none.className = 'td-err';
    none.textContent = d.level_error || 'No water level reported at this station.';
    slot.appendChild(none);
  }

  const preds = d.predictions || [];
  if (preds.length) {
    const cap = document.createElement('div');
    cap.className = 'td-cap';
    cap.textContent = 'TODAY · PREDICTED HIGHS AND LOWS';
    slot.appendChild(cap);
    const row = document.createElement('div');
    row.className = 'td-hilo';
    for (const p of preds) {
      const cell = document.createElement('div');
      cell.className = p.type === 'H' ? 'td-cell is-high' : 'td-cell is-low';
      const t = document.createElement('span');
      t.className = 'td-t mono';
      t.textContent = (p.t || '').split(' ')[1] || '';
      const v = document.createElement('span');
      v.className = 'td-v mono';
      v.textContent = `${Number(p.v).toFixed(1)} ft`;
      const k = document.createElement('span');
      k.className = 'td-k';
      k.textContent = p.type === 'H' ? 'HIGH' : 'LOW';
      cell.append(k, v, t);
      row.appendChild(cell);
    }
    slot.appendChild(row);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  PRESENTATION MODE
//  Weatherfront's broadcast framing. Strips the app down to the map, the
//  valid time, the colour scale and the timeline: everything that exists to
//  CONFIGURE the view goes away, because on air it is chrome the audience has
//  to look past.
// ═══════════════════════════════════════════════════════════════════════════

let _presentIdle = null;

function applyPresenting(on) {
  on = !!on;
  settings.presenting = on;
  saveSettings();

  document.body.classList.toggle('is-presenting', on);
  document.getElementById('present-exit')?.classList.toggle('hidden', !on);
  const btn = document.getElementById('present-btn');
  if (btn) {
    btn.setAttribute('aria-pressed', String(on));
    btn.classList.toggle('is-active', on);
  }

  // Selection mode locks the camera and its bar is one of the things hidden,
  // so entering presentation while armed would strand the globe.
  if (on && typeof AD !== 'undefined' && AD.arming) adSetSelecting(false);

  // The broadcast graphics stay up, but their safe area tightens once the
  // telemetry bar is gone -- a readout still sitting 58px down has a band of
  // dead globe above it in every shot.
  gfxRender();

  // Cesium sizes its canvas to the container, which does not change here, but
  // the vignette opacity and the hidden overlays both want a repaint.
  viewer.scene.requestRender();
}

/* The exit chip fades out on its own so it stays out of the frame, then comes
   back on any pointer movement. Without the timer it either sits at full
   opacity in every shot or is invisible when someone needs it. */
function initPresentation() {
  const btn = document.getElementById('present-btn');
  if (btn) btn.addEventListener('click', () => applyPresenting(!settings.presenting));
  document.getElementById('present-exit-btn')
    ?.addEventListener('click', () => applyPresenting(false));

  document.addEventListener('keydown', (e) => {
    // Ignore the shortcut while typing, or a station search would toggle the
    // whole UI away on the letter p.
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (e.key === 'p' || e.key === 'P') {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      applyPresenting(!settings.presenting);
    } else if (e.key === 'Escape' && settings.presenting) {
      applyPresenting(false);
    }
  });

  document.addEventListener('pointermove', () => {
    if (!settings.presenting) return;
    document.body.classList.add('is-pointing');
    clearTimeout(_presentIdle);
    _presentIdle = setTimeout(() => document.body.classList.remove('is-pointing'), 2200);
  });

  if (settings.presenting) applyPresenting(true);
}

// ═══════════════════════════════════════════════════════════════════════════
//  SINGLE / DUAL / QUAD PANE
//  RadarScope's pane control: one location, several products at once, so a
//  storm can be read across reflectivity, satellite and the warning polygons
//  without switching back and forth and holding the last frame in your head.
//
//  ★ This does NOT create a WebGL context per pane. An earlier plan assumed it
//  had to, and that was wrong. There is one Cesium scene; pane 1 IS that live
//  scene, and every other pane is a snapshot of it taken with a different set
//  of overlays showing and blitted into a 2D canvas. Same camera, same
//  geometry, one context, and the secondary panes cost nothing between
//  updates because they are still images until something changes.
// ═══════════════════════════════════════════════════════════════════════════

const PANES = {
  mode: 'single',            // 'single' | 'dual' | 'quad'
  products: ['live', 'satellite', 'warnings', 'model'],
  canvases: [],
  busy: false,
  queued: false,
  // Completed refreshes. A pane is only meaningful after one has finished,
  // and nothing else on the object distinguishes 'not started' from 'done'.
  refreshes: 0,
  settle: null,
};

/* Each product declares which of the controlled overlays it wants ON. Anything
   in the controlled set that a product does not name is hidden for that pane,
   which is what makes a pane a single product rather than a copy of whatever
   the HUD happens to have switched on.

   'live' is the exception and only ever belongs to pane 1: it means "whatever
   the user has configured", so the interactive pane never fights the HUD. */
const PANE_PRODUCTS = {
  live:      { label: 'LIVE' },
  radar:     { label: 'RADAR',       want: { radar: true },              needs: ['radar'] },
  satellite: { label: 'SATELLITE',   want: { clouds: true },             needs: ['clouds'] },
  warnings:  { label: 'WARNINGS',    want: { warn: true, radar: true },  needs: ['warnings', 'radar'] },
  model:     { label: 'MODEL FIELD', want: { model: true },              needs: ['model'] },
  outlooks:  { label: 'SPC OUTLOOK', want: { spc: true },                needs: ['spc_outlook'] },
  obs:       { label: 'SURFACE OBS', want: { metar: true },              needs: ['metar'] },
  reports:   { label: 'STORM REPORTS', want: { lsr: true, radar: true }, needs: ['lsr', 'radar'] },
  base:      { label: 'BASE MAP',    want: {},                           needs: [] },
};

/* Toggling `.show` on a layer that was never switched on shows nothing: the
   ImageryLayer does not exist yet and the DataSource is empty. The first
   attempt at this produced four byte-identical panes for exactly that reason,
   and every one of them looked like a working screenshot.

   So assigning a product switches its layer on for real, through the same HUD
   checkbox a user would click. That does mean the live pane picks the layer up
   too, which is correct rather than a compromise: pane 1 is defined as
   "whatever the HUD says", and a product silently loading behind the user's
   back with no checkbox to show for it would be the chrome lying about state
   again. */
async function paneEnsure(product) {
  const needs = (PANE_PRODUCTS[product] || {}).needs || [];
  let waited = false;
  for (const layer of needs) {
    const cb = document.querySelector(`input[data-layer="${layer}"]`);
    if (!cb || cb.disabled || cb.checked) continue;
    cb.checked = true;
    cb.dispatchEvent(new Event('change', { bubbles: true }));
    waited = true;
  }
  // Feeds fetch on toggle. Nothing here exposes a completion promise, so this
  // is a fixed grace period rather than a real await; a pane that misses it
  // fills in on the next refresh.
  if (waited) await new Promise((r) => setTimeout(r, 2600));
}

const PANE_COUNT = { single: 1, dual: 2, quad: 4 };

/* The overlays a pane can turn on and off. Read through accessors because
   every one of them is null until its layer is first enabled, and several are
   replaced wholesale when their product selector changes. */
const PANE_OVERLAYS = {
  radar:  () => radarLayer,
  clouds: () => cloudsLayer,
  aurora: () => auroraLayer,
  model:  () => modelDS,
  warn:   () => warnDS,
  spc:    () => spcDS,
  lsr:    () => lsrDS,
  metar:  () => metarDS,
};

/* The animated radar loop does NOT draw through radarLayer. Once the timeline
   is running, every frame is its own ImageryLayer in TL.layers and radarLayer
   is null, so a pane controller that only knew about radarLayer left radar
   burned into all four panes while reporting that it had switched it off. */
function paneFrameLayers() {
  return TL && TL.layers ? [...TL.layers.values()] : [];
}

function paneCaptureState() {
  const out = {};
  for (const [key, get] of Object.entries(PANE_OVERLAYS)) {
    const o = get();
    if (o) out[key] = o.show;
  }
  const frames = paneFrameLayers();
  if (frames.length) out.frames = frames.map((l) => l.show);
  return out;
}

function paneApplyState(state) {
  for (const [key, get] of Object.entries(PANE_OVERLAYS)) {
    const o = get();
    if (o && key in state) o.show = state[key];
  }
  const frames = paneFrameLayers();
  if (Array.isArray(state.frames)) {
    frames.forEach((l, i) => { if (i < state.frames.length) l.show = state.frames[i]; });
  } else if (typeof state.frames === 'boolean') {
    // A want-state carries one flag for the whole loop: the pane either has
    // radar or it does not.
    frames.forEach((l) => { l.show = state.frames; });
  }
}

function paneWantState(product) {
  const want = (PANE_PRODUCTS[product] || {}).want || {};
  const out = {};
  for (const key of Object.keys(PANE_OVERLAYS)) out[key] = !!want[key];
  out.frames = !!want.radar;
  return out;
}

/* Tiles for a newly-shown imagery layer are not in memory yet, so a snapshot
   taken immediately captures the pane mid-load. Waiting on tilesLoaded costs a
   few frames and is the difference between a pane and a grey rectangle. */
function paneWaitForTiles(timeoutMs = 2500) {
  return new Promise((resolve) => {
    const started = performance.now();
    const tick = () => {
      if (viewer.scene.globe.tilesLoaded || performance.now() - started > timeoutMs) {
        resolve();
        return;
      }
      viewer.scene.requestRender();
      requestAnimationFrame(tick);
    };
    tick();
  });
}

async function paneRefresh() {
  if (PANES.mode === 'single') return;
  // One refresh at a time. A camera drag fires moveEnd repeatedly and each
  // refresh mutates global layer visibility, so overlapping runs would restore
  // each other's saved state and leave the live view showing a pane's product.
  if (PANES.busy) { PANES.queued = true; return; }
  PANES.busy = true;

  const saved = paneCaptureState();
  try {
    const n = PANE_COUNT[PANES.mode];
    for (let i = 1; i < n; i++) {
      const cv = PANES.canvases[i];
      if (!cv || !cv.width) continue;
      paneApplyState(paneWantState(PANES.products[i]));
      viewer.scene.requestRender();
      viewer.render();
      await paneWaitForTiles();
      viewer.scene.requestRender();
      viewer.render();
      const ctx = cv.getContext('2d');
      ctx.clearRect(0, 0, cv.width, cv.height);
      // The Cesium canvas is the pane's own size in this mode, so this is a
      // 1:1 blit rather than a rescale.
      ctx.drawImage(viewer.canvas, 0, 0, cv.width, cv.height);
    }
  } finally {
    paneApplyState(saved);
    viewer.scene.requestRender();
    viewer.render();
    PANES.busy = false;
    PANES.refreshes++;
    if (PANES.queued) { PANES.queued = false; paneRefresh(); }
  }
}

function paneSizeCanvases() {
  const grid = document.getElementById('panegrid');
  if (!grid) return;
  for (let i = 1; i < PANES.canvases.length; i++) {
    const cv = PANES.canvases[i];
    if (!cv) continue;
    const r = cv.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width));
    const h = Math.max(1, Math.round(r.height));
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  }
}

function paneBuild() {
  const grid = document.getElementById('panegrid');
  if (!grid) return;
  grid.textContent = '';
  PANES.canvases = [null];

  const n = PANE_COUNT[PANES.mode];
  // Cell 0 is left empty: the live Cesium canvas shows through it.
  for (let i = 0; i < n; i++) {
    const cell = document.createElement('div');
    cell.className = 'pane-cell';
    if (i === 0) cell.classList.add('is-live');

    if (i > 0) {
      const cv = document.createElement('canvas');
      cv.className = 'pane-canvas';
      cell.appendChild(cv);
      PANES.canvases.push(cv);
    }

    const bar = document.createElement('div');
    bar.className = 'pane-bar';
    if (i === 0) {
      const tag = document.createElement('span');
      tag.className = 'pane-live';
      tag.textContent = 'LIVE';
      bar.appendChild(tag);
      const hint = document.createElement('span');
      hint.className = 'pane-hint';
      hint.textContent = 'the interactive view';
      bar.appendChild(hint);
    } else {
      const sel = document.createElement('select');
      sel.className = 'pane-sel';
      sel.setAttribute('aria-label', `Pane ${i + 1} product`);
      for (const [key, def] of Object.entries(PANE_PRODUCTS)) {
        if (key === 'live') continue;
        const opt = document.createElement('option');
        opt.value = key;
        opt.textContent = def.label;
        sel.appendChild(opt);
      }
      sel.value = PANES.products[i];
      sel.addEventListener('change', async () => {
        PANES.products[i] = sel.value;
        settings.paneProducts = PANES.products.slice();
        saveSettings();
        await paneEnsure(sel.value);
        paneRefresh();
      });
      bar.appendChild(sel);
    }
    cell.appendChild(bar);
    grid.appendChild(cell);
  }
}

function applyPaneMode(mode) {
  if (!PANE_COUNT[mode]) mode = 'single';
  PANES.mode = mode;
  settings.paneMode = mode;
  saveSettings();

  document.body.classList.remove('panes-dual', 'panes-quad');
  if (mode !== 'single') document.body.classList.add(`panes-${mode}`);
  document.getElementById('panegrid')?.classList.toggle('hidden', mode === 'single');

  document.querySelectorAll('#panebar .seg-b').forEach((b) => {
    const on = b.dataset.panes === mode;
    b.classList.toggle('is-active', on);
    b.setAttribute('aria-pressed', String(on));
  });

  if (mode === 'single') {
    PANES.canvases = [null];
    document.getElementById('panegrid').textContent = '';
  } else {
    paneBuild();
  }

  // The live canvas changes size with the layout, and Cesium only notices on
  // its own resize check. Force it, then let the panes size to the new cells.
  requestAnimationFrame(async () => {
    try { viewer.resize(); } catch {}
    viewer.scene.requestRender();
    paneSizeCanvases();
    if (mode !== 'single') {
      for (let i = 1; i < PANE_COUNT[mode]; i++) await paneEnsure(PANES.products[i]);
    }
    paneRefresh();
  });
}

function initPanes() {
  const saved = Array.isArray(settings.paneProducts) ? settings.paneProducts : null;
  if (saved && saved.length === 4) {
    PANES.products = saved.map((p, i) => (i === 0 ? 'live' : (PANE_PRODUCTS[p] ? p : 'base')));
  }

  document.querySelectorAll('#panebar .seg-b').forEach((b) => {
    b.addEventListener('click', () => applyPaneMode(b.dataset.panes));
  });

  // The panes are snapshots, so they go stale the moment the camera moves or
  // the radar loop advances. Refresh on settle rather than per frame.
  viewer.camera.moveEnd.addEventListener(() => {
    if (PANES.mode === 'single') return;
    clearTimeout(PANES.settle);
    PANES.settle = setTimeout(paneRefresh, 260);
  });
  window.addEventListener('resize', () => {
    if (PANES.mode === 'single') return;
    clearTimeout(PANES.settle);
    PANES.settle = setTimeout(() => { paneSizeCanvases(); paneRefresh(); }, 260);
  });

  applyPaneMode(settings.paneMode || 'single');
}

// ═══════════════════════════════════════════════════════════════════════════
//  BROADCAST GRAPHICS  ("Custom Graphics" — the last row of the StormCat5 chart)
//
//  The reference app's Overlays tab: a list of named graphics that draw over
//  the map, each with a style, a nine-point anchor, a scale and a pixel nudge,
//  and the whole set saved under a named MODE so a broadcaster can flip between
//  their own look and the built-in one.
//
//  Two things make this a feature rather than decoration:
//
//  1. Nothing here is typed in. The readout names whatever product is actually
//     on the globe and stamps the frame's valid time; the warning banner is the
//     highest-priority live NWS alert with a real countdown; the colour scale is
//     the ramp the pixels were painted with. A graphic that says TEMPERATURE
//     over a radar loop is worse than no graphic, so the text is derived, and
//     the override fields are blank by default.
//
//  2. They survive presentation mode. Everything else in the chrome hides; this
//     layer is the broadcast, so it stays.
// ═══════════════════════════════════════════════════════════════════════════

const GFX_POS = ['tl', 'tc', 'tr', 'ml', 'mc', 'mr', 'bl', 'bc', 'br'];

/* Safe area. Asymmetric on purpose while the chrome is up: "top left" has to
   mean the top left of the MAP, and the map starts at the right edge of the
   264px HUD rail. Anchoring to the true window corner would park the readout
   underneath the layer panel, which is where the old fixed frame-stamp's
   hardcoded left:296px came from. Presentation mode drops the rail, so the
   whole frame opens up.

   The bottom inset clears the transport in both, because the timeline is one
   of the few pieces of chrome that deliberately survives presenting. */
// #gfx is inset by the rail along with the canvas now, so its own left inset
// is a margin inside the map area rather than a hardcoded clearance for a
// panel floating on top of it.
const GFX_INSET = { top: 22, left: 22, right: 20, bottom: 66 };
const GFX_INSET_PRESENT = { top: 22, left: 22, right: 22, bottom: 66 };

const GFX_STYLE_NAMES = { 1: 'Rule', 2: 'Solid', 3: 'Bar' };

/* Each graphic: what it is, whether it takes a style, and which free-text
   overrides it accepts. The editor UI is generated from this, so a control can
   never drift from the config key it writes. */
const GFX_ITEMS = [
  {
    key: 'readout', label: 'Data Readout', accent: 'accent',
    hint: 'The product on the globe and the frame time',
    styles: true, fields: [['title', 'Title'], ['sub', 'Subtitle']],
  },
  {
    key: 'warning', label: 'Warning Banner', accent: 'live',
    hint: 'Highest-priority live NWS alert, with its countdown',
    styles: true, fields: [],
  },
  {
    key: 'scale', label: 'Colour Scale', accent: 'accent',
    hint: 'The ramp the pixels on screen were painted with',
    styles: false, fields: [],
  },
  {
    key: 'bug', label: 'Station Bug', accent: 'accent',
    hint: 'Your name, bottom corner, out of the way',
    styles: false, fields: [['text', 'Text']],
  },
];

function gfxDefaultConfig() {
  return {
    readout: { on: true,  style: 1, pos: 'tl', scale: 100, dx: 0, dy: 0, clock: true, title: '', sub: '' },
    warning: { on: true,  style: 1, pos: 'tr', scale: 100, dx: 0, dy: 0 },
    // On by default. The HUD legend is hidden on air, so leaving this off
    // would mean presenting a radar loop with no key to its colours; and it
    // draws nothing at all unless a live ramp is actually on the globe.
    scale:   { on: true,  style: 1, pos: 'mr', scale: 100, dx: 0, dy: 0 },
    bug:     { on: false, style: 1, pos: 'br', scale: 100, dx: 0, dy: 0, text: 'GRATICULE' },
  };
}

// GFX (the module's mutable state) is declared with the other hoisted state at
// the top of this file, not here: `const` at classic-script top level stays in
// its temporal dead zone until its own line evaluates, and syncTimelineVisibility
// touches GFX.stamp from a change event that can fire during bootstrap.

/* The built-in mode is generated from code, not persisted, and a stored copy
   only appears once the user edits it. Seeding localStorage with it at first
   run would freeze whatever the defaults were that day, so a later change to
   the built-in look would never reach anyone who had merely opened the app. */
function gfxModes() {
  const saved = settings.gfxModes && typeof settings.gfxModes === 'object' ? settings.gfxModes : {};
  return Object.assign({ Default: gfxDefaultConfig() }, saved);
}

function gfxCfg() {
  const all = gfxModes();
  const cfg = all[settings.gfxMode] || all.Default;
  // Fill in anything a mode saved before a key existed.
  const base = gfxDefaultConfig();
  const out = {};
  for (const k of Object.keys(base)) out[k] = Object.assign({}, base[k], cfg[k] || {});
  return out;
}

function gfxSetCfg(key, patch) {
  const name = settings.gfxMode || 'Default';
  const cfg = gfxCfg();
  Object.assign(cfg[key], patch);
  settings.gfxModes = Object.assign({}, settings.gfxModes, { [name]: cfg });
  saveSettings();
  gfxRender();
}

// ---------- What the graphics say --------------------------------------------

function gfxLayerOn(key) {
  const cb = document.querySelector(`input[data-layer="${key}"]`);
  return !!(cb && cb.checked);
}

/* Read the product off the globe, most specific first. Model field beats radar
   because turning it on is a deliberate act; radar is the app's resting state. */
function gfxProduct() {
  if (gfxLayerOn('model')) {
    const def = FIELD_DEFS[valueOf('model-field', 'temperature_2m')];
    const model = valueOf('model-name', 'gfs').toUpperCase();
    // The valid time, not the wall clock. A forecast graphic that stamps the
    // current time is worse than one with no time on it: on air, +24 h read
    // "16:50 UTC" while the map showed Wednesday.
    const valid = MODEL_FCST.times[MODEL_FCST.idx];
    const off = MODEL_FCST.times.length ? MODEL_FCST.idx - MODEL_FCST.now : 0;
    return {
      title: (def && (def.legend || def.label) || 'MODEL FIELD').toUpperCase(),
      sub: off > 0 ? `${model} · +${off} H FORECAST` : `${model} · ANALYSIS`,
      when: valid ? new Date(`${valid}Z`) : undefined,
    };
  }
  if (gfxLayerOn('radar') && GFX.stamp) {
    return { title: GFX.stamp.kind, sub: GFX.stamp.src, when: GFX.stamp.when };
  }
  if (gfxLayerOn('radar'))       return { title: 'RADAR',      sub: 'MRMS COMPOSITE' };
  if (gfxLayerOn('clouds'))      return { title: 'SATELLITE',  sub: 'GOES INFRARED' };
  if (gfxLayerOn('spc_outlook')) return { title: 'SPC OUTLOOK', sub: 'STORM PREDICTION CENTER' };
  if (gfxLayerOn('warnings'))    return { title: 'WATCHES & WARNINGS', sub: 'NATIONAL WEATHER SERVICE' };
  if (gfxLayerOn('metar'))       return { title: 'SURFACE OBS', sub: 'METAR' };
  return { title: 'GRATICULE', sub: 'SITUATIONAL AWARENESS' };
}

/* The clock block. A weather graphic that shows a wall clock in an unstated
   zone is ambiguous, so the zone is always on the label. When a radar frame is
   loaded its valid time is what matters, not the current time. */
function gfxTimeBlock(cfg) {
  // Whatever product is driving the graphic decides the clock, so a scrubbed
  // forecast hour and a replayed radar frame both stamp their own valid time.
  const p = gfxProduct().when || new Date();
  const p2 = (n) => String(n).padStart(2, '0');
  if (settings.timeFormat === 'local') {
    const h = p.getHours(), ap = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return {
      big: `${h12}:${p2(p.getMinutes())} ${ap}`,
      sub: `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][p.getDay()]} `
         + `${p2(p.getMonth() + 1)}/${p2(p.getDate())}/${String(p.getFullYear()).slice(2)}`,
    };
  }
  return {
    big: `${p2(p.getUTCHours())}:${p2(p.getUTCMinutes())} UTC`,
    sub: `${p2(p.getUTCMonth() + 1)}/${p2(p.getUTCDate())}/${String(p.getUTCFullYear()).slice(2)}`,
  };
}

/* The alert the banner is about: highest priority, still in force, not
   dismissed. warnFeatures is already sorted by warnStyle().p. */
function gfxTopAlert() {
  const now = Date.now();
  for (const f of warnFeatures) {
    const p = f.properties || {};
    if (GFX.dismissed.has(p.id || p['@id'])) continue;
    const exp = Date.parse(p.expires || p.ends || '');
    if (Number.isFinite(exp) && exp <= now) continue;
    return f;
  }
  return null;
}

function gfxCountdown(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '';
  const m = Math.floor(ms / 60000);
  const h = Math.floor(m / 60);
  return h > 0 ? `${h}H ${m % 60}M` : `${m}M`;
}

/* "Maricopa, AZ; Pinal, AZ" -> "MARICOPA · PINAL". The state suffix repeats on
   every entry and eats the width the county names need.

   Marine and fire zones are not counties and do not follow that shape: a
   Special Marine Warning's areaDesc is a prose description of the water body,
   and one of them measured 1,156px of banner across a 1,600px frame. So the
   budget is characters, not entries -- names are taken until the line is full
   and the rest become a count. */
const GFX_AREA_CHARS = 38;

/* Whether the areas an alert names are counties. The third character of an NWS
   UGC code is 'C' for a county/parish and 'Z' for a forecast or marine zone --
   ANZ533 is a stretch of the Chesapeake, not a county, and labelling it
   COUNTIES on air is a caption that is simply false. Derived, not assumed. */
function gfxAreaLabel(p) {
  const ugc = (p && p.geocode && p.geocode.UGC) || [];
  if (!ugc.length) return 'AREA';
  return ugc.every((u) => String(u)[2] === 'C') ? 'COUNTIES' : 'AREA';
}

function gfxCounties(areaDesc) {
  if (!areaDesc) return '';
  const parts = String(areaDesc).split(';')
    .map((s) => s.split(',')[0].trim()).filter(Boolean);
  const kept = [];
  let used = 0;
  for (const p of parts) {
    if (kept.length && used + p.length > GFX_AREA_CHARS) break;
    kept.push(p.length > GFX_AREA_CHARS ? `${p.slice(0, GFX_AREA_CHARS - 1)}…` : p);
    used += p.length + 3;
  }
  const head = kept.join(' · ').toUpperCase();
  return parts.length > kept.length ? `${head} +${parts.length - kept.length}` : head;
}

/* The ramp on screen, whichever layer painted it. Returns the same shape the
   HUD legend uses so one source of truth feeds both. */
function gfxScaleData() {
  if (gfxLayerOn('model')) {
    const def = FIELD_DEFS[valueOf('model-field', 'temperature_2m')];
    if (!def) return null;
    return {
      title: (def.legend || def.label).toUpperCase(), unit: def.unit,
      stops: def.stops.map((s) => s[1]), ticks: def.ticks || [],
    };
  }
  const mode = currentWxMode();
  const s = SCALES[mode];
  if (!s || !legendModeIsLive(mode)) return null;
  return { title: s.title, unit: s.unit, stops: s.stops, ticks: s.ticks };
}

// ---------- Rendering ---------------------------------------------------------

function gfxEnsureRoot() {
  if (GFX.root) return GFX.root;
  GFX.root = document.getElementById('gfx');
  return GFX.root;
}

function gfxEl(key) {
  const root = gfxEnsureRoot();
  if (!root) return null;
  if (GFX.els[key] && GFX.els[key].isConnected) return GFX.els[key];
  const el = document.createElement('div');
  el.className = `gfx gfx-${key}`;
  root.appendChild(el);
  GFX.els[key] = el;
  return el;
}

/* Anchor + scale + nudge in one transform. Anchoring by left/top with a
   translate keeps the element's own size out of the maths, so a graphic that
   grows (a longer warning name) stays pinned to the corner it was placed in
   instead of drifting. */
function gfxPlace(el, cfg) {
  const inset = settings.presenting ? GFX_INSET_PRESENT : GFX_INSET;
  const v = cfg.pos[0], h = cfg.pos[1];
  const s = Math.max(0.5, Math.min(2.5, (cfg.scale || 100) / 100));

  el.style.left = el.style.right = el.style.top = el.style.bottom = '';

  // A phone gets one placement and it is not negotiable. These graphics are
  // drag-positioned and the anchor, scale and nudge are written here as INLINE
  // styles, which no stylesheet can override without !important -- so the
  // mobile rules were being ignored and the alert banner sat at a saved
  // desktop corner, 29px past the right edge of a 412px screen. That was the
  // last thing widening the layout viewport to 422.
  //
  // A saved position from a 1600px monitor means nothing on a phone anyway,
  // and neither does a 2.5x scale on a screen where the graphic is already
  // full width.
  if (isPhone()) {
    el.style.left = '8px';
    el.style.right = '8px';
    el.style.bottom = `${settings.presenting ? 12 : 112}px`;
    el.style.width = 'auto';
    el.style.transform = 'none';
    el.style.transformOrigin = 'bottom left';
    return;
  }
  el.style.width = '';
  // '0px', not '0'. calc() cannot add a unitless zero to a length, and an
  // invalid value in a transform drops the WHOLE declaration silently -- which
  // is exactly what happened: the anchor still worked, because that is
  // left/top, while scale and the pixel nudge did nothing at all.
  let tx = '0px', ty = '0px', origin = 'top left';

  if (h === 'l') { el.style.left = `${inset.left}px`; }
  else if (h === 'r') { el.style.right = `${inset.right}px`; origin = 'top right'; }
  else { el.style.left = '50%'; tx = '-50%'; origin = 'top center'; }

  if (v === 't') { el.style.top = `${inset.top}px`; }
  else if (v === 'b') {
    el.style.bottom = `${inset.bottom}px`;
    origin = origin.replace('top', 'bottom');
  } else { el.style.top = '50%'; ty = '-50%'; origin = origin.replace('top', 'center'); }

  el.style.transformOrigin = origin;
  el.style.transform =
    `translate(calc(${tx} + ${cfg.dx || 0}px), calc(${ty} + ${cfg.dy || 0}px)) scale(${s})`;
}

function gfxRender() {
  // Layer checkboxes fire change events during bootstrap, before this module's
  // top-level consts have evaluated. Reading GFX_INSET from gfxPlace() then
  // throws on the temporal dead zone, so nothing paints until initGraphics()
  // has run and set this.
  if (!GFX.ready) return;
  const root = gfxEnsureRoot();
  if (!root) return;
  const cfg = gfxCfg();

  gfxRenderReadout(cfg.readout);
  gfxRenderWarning(cfg.warning);
  gfxRenderScale(cfg.scale);
  gfxRenderBug(cfg.bug);
}

function gfxShell(key, cfg, on) {
  const el = gfxEl(key);
  if (!el) return null;
  if (!on) { el.classList.add('hidden'); return null; }
  el.classList.remove('hidden');
  el.dataset.style = String(cfg.style || 1);
  gfxPlace(el, cfg);
  return el;
}

function gfxRenderReadout(cfg) {
  const el = gfxShell('readout', cfg, cfg.on);
  if (!el) return;
  const p = gfxProduct();
  const title = (cfg.title || p.title || '').toUpperCase();
  const sub = (cfg.sub || p.sub || '').toUpperCase();
  const t = cfg.clock ? gfxTimeBlock(cfg) : null;

  el.innerHTML = '';
  el.appendChild(gfxAccentBar());
  const cols = document.createElement('div');
  cols.className = 'gfx-cols';
  cols.appendChild(gfxCol(title, sub, 'gfx-head'));
  if (t) {
    const rule = document.createElement('div');
    rule.className = 'gfx-rule';
    cols.appendChild(rule);
    cols.appendChild(gfxCol(t.big, t.sub, 'gfx-time mono'));
  }
  el.appendChild(cols);
}

function gfxRenderWarning(cfg) {
  const f = cfg.on ? gfxTopAlert() : null;
  const el = gfxShell('warning', cfg, !!f);
  if (!el) return;
  const p = f.properties || {};
  const tone = warnStyle(p.event).c;
  el.style.setProperty('--gfx-accent', tone);

  const now = Date.now();
  const exp = Date.parse(p.expires || p.ends || '');
  const start = Date.parse(p.onset || p.effective || p.sent || '');
  const left = gfxCountdown(exp - now);
  const expTxt = Number.isFinite(exp)
    ? `EXPIRES ${new Date(exp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
    : 'IN EFFECT';

  el.innerHTML = '';
  el.appendChild(gfxAccentBar());
  const body = document.createElement('div');
  body.className = 'gfx-cols';
  body.appendChild(gfxCol(
    String(p.event || 'ALERT').toUpperCase(),
    left ? `${expTxt} (${left})` : expTxt,
    'gfx-head gfx-alarm'));
  const counties = gfxCounties(p.areaDesc);
  if (counties) {
    const rule = document.createElement('div');
    rule.className = 'gfx-rule';
    body.appendChild(rule);
    body.appendChild(gfxCol(counties, gfxAreaLabel(p), 'gfx-area'));
  }
  el.appendChild(body);

  // The bar is the share of the alert's own lifetime that is left, not a
  // fixed window: a 6-hour flood warning and a 30-minute tornado warning both
  // read as "how much of this is still ahead of you".
  if (Number.isFinite(exp) && Number.isFinite(start) && exp > start) {
    const pct = Math.max(0, Math.min(1, (exp - now) / (exp - start)));
    const track = document.createElement('div');
    track.className = 'gfx-prog';
    const fill = document.createElement('div');
    fill.className = 'gfx-prog-fill';
    fill.style.width = `${(pct * 100).toFixed(1)}%`;
    track.appendChild(fill);
    el.appendChild(track);
  }

  // Dismiss. The only interactive thing in this layer, so it opts back into
  // pointer events on its own.
  const x = document.createElement('button');
  x.className = 'gfx-x';
  x.textContent = '×';
  x.title = 'Dismiss this alert graphic';
  x.setAttribute('aria-label', `Dismiss ${p.event || 'alert'} graphic`);
  x.addEventListener('click', () => {
    GFX.dismissed.add(p.id || p['@id']);
    gfxRender();
  });
  el.appendChild(x);
}

function gfxRenderScale(cfg) {
  const d = cfg.on ? gfxScaleData() : null;
  // Two ramps on screen describing the same pixels is one too many, and the
  // broadcast one wins because it is the one that stays up on air.
  document.getElementById('legend')?.classList.toggle('gfx-superseded', !!d);
  const el = gfxShell('scale', cfg, !!d);
  if (!el) return;
  el.innerHTML = '';
  el.appendChild(gfxAccentBar());
  const head = document.createElement('div');
  head.className = 'gfx-scale-head';
  head.innerHTML = `<span>${d.title}</span><span class="mono">${d.unit}</span>`;
  // Orientation follows the anchor. Parked in the middle of an edge -- where
  // the reference app puts its colour bar -- it stands up; anywhere else it
  // lies down, which is what a graphic in a corner has room to do. Deriving it
  // means an operator who already moved this graphic keeps the layout they
  // chose instead of finding it rotated after an update.
  const vertical = cfg.pos === 'ml' || cfg.pos === 'mr';
  el.classList.toggle('is-vertical', vertical);
  const bar = document.createElement('div');
  bar.className = 'gfx-scale-bar';
  bar.style.background = vertical
    ? `linear-gradient(0deg, ${d.stops.join(', ')})`
    : `linear-gradient(90deg, ${d.stops.join(', ')})`;
  const ticks = document.createElement('div');
  ticks.className = 'gfx-scale-ticks mono';
  const order = vertical ? d.ticks.slice().reverse() : d.ticks;
  ticks.innerHTML = order.map((t) => `<span>${t}</span>`).join('');
  // Bar and ticks share a box so the labels can sit beside the ramp when it is
  // standing and under it when it is lying down. Absolutely positioning them
  // against the graphic would have measured against the caption too.
  const body = document.createElement('div');
  body.className = 'gfx-scale-body';
  body.append(bar, ticks);
  el.append(head, body);
}

function gfxRenderBug(cfg) {
  const txt = (cfg.text || '').trim();
  const el = gfxShell('bug', cfg, cfg.on && !!txt);
  if (!el) return;
  el.textContent = txt.toUpperCase();
}

function gfxAccentBar() {
  const d = document.createElement('div');
  d.className = 'gfx-accent';
  return d;
}

function gfxCol(big, sub, cls) {
  const col = document.createElement('div');
  col.className = `gfx-col ${cls || ''}`;
  const b = document.createElement('span');
  b.className = 'gfx-big';
  b.textContent = big;
  const s = document.createElement('span');
  s.className = 'gfx-sub';
  s.textContent = sub;
  col.append(b, s);
  return col;
}

// ---------- The editor panel --------------------------------------------------

function gfxBuildPanel() {
  const host = document.getElementById('gfx-items');
  if (!host) return;
  host.textContent = '';
  const cfg = gfxCfg();

  for (const item of GFX_ITEMS) {
    const c = cfg[item.key];
    const box = document.createElement('details');
    box.className = 'gfx-item';
    box.open = item.key === 'readout';

    const sum = document.createElement('summary');
    sum.innerHTML = `<span class="gfx-item-name">${item.label}</span>`
                  + `<span class="gfx-item-hint">${item.hint}</span>`;

    // The rail's own pill switch, not a bare checkbox: every other on/off in
    // this panel is a `.sw`, and a stock checkbox next to them is the exact
    // kind of mixed idiom that reads as unfinished.
    const swl = document.createElement('label');
    swl.className = 'sw gfx-item-on';
    const tog = document.createElement('input');
    tog.type = 'checkbox';
    tog.checked = !!c.on;
    tog.setAttribute('aria-label', `${item.label} on`);
    const knob = document.createElement('span');
    knob.className = 'sw-t';
    swl.append(tog, knob);
    // Inside a <summary>, a click on the control also toggles the disclosure,
    // which reads as the panel fighting the user.
    swl.addEventListener('click', (e) => e.stopPropagation());
    tog.addEventListener('change', () => gfxSetCfg(item.key, { on: tog.checked }));
    sum.appendChild(swl);
    box.appendChild(sum);

    const body = document.createElement('div');
    body.className = 'gfx-item-body';

    if (item.styles) {
      body.appendChild(gfxRowSelect('Style', [1, 2, 3].map((n) => [n, `Style ${n} · ${GFX_STYLE_NAMES[n]}`]),
        c.style, (v) => gfxSetCfg(item.key, { style: Number(v) })));
    }
    body.appendChild(gfxRowAnchor(c.pos, (v) => gfxSetCfg(item.key, { pos: v })));
    body.appendChild(gfxRowRange('Scale', 50, 250, 5, c.scale, '%',
      (v) => gfxSetCfg(item.key, { scale: v })));
    body.appendChild(gfxRowRange('Shift X', -400, 400, 2, c.dx, 'px',
      (v) => gfxSetCfg(item.key, { dx: v })));
    body.appendChild(gfxRowRange('Shift Y', -400, 400, 2, c.dy, 'px',
      (v) => gfxSetCfg(item.key, { dy: v })));

    if (item.key === 'readout') {
      body.appendChild(gfxRowCheck('Show the clock', c.clock,
        (v) => gfxSetCfg(item.key, { clock: v })));
    }
    for (const [field, label] of item.fields) {
      body.appendChild(gfxRowText(label, c[field] || '',
        item.key === 'bug' ? 'Your name' : 'Auto',
        (v) => gfxSetCfg(item.key, { [field]: v })));
    }

    box.appendChild(body);
    host.appendChild(box);
  }
}

/* Rows reuse the HUD's own `.ctl` furniture rather than the settings modal's.
   Two control idioms inside one 264px rail is exactly the inconsistency that
   reads as unfinished. */
function gfxRow(label) {
  const row = document.createElement('div');
  row.className = 'ctl';
  const l = document.createElement('span');
  l.className = 'ctl-l';
  l.textContent = label;
  row.appendChild(l);
  return row;
}

function gfxRowSelect(label, opts, value, onChange) {
  const row = gfxRow(label);
  const sel = document.createElement('select');
  sel.className = 'gfx-sel';
  for (const [v, t] of opts) {
    const o = document.createElement('option');
    o.value = String(v); o.textContent = t;
    sel.appendChild(o);
  }
  sel.value = String(value);
  sel.addEventListener('change', () => onChange(sel.value));
  row.appendChild(sel);
  return row;
}

function gfxRowRange(label, min, max, step, value, unit, onChange) {
  const row = gfxRow(label);
  const r = document.createElement('input');
  r.type = 'range'; r.min = min; r.max = max; r.step = step; r.value = value;
  const out = document.createElement('span');
  out.className = 'ctl-v mono';
  out.textContent = `${value}${unit}`;
  r.addEventListener('input', () => {
    out.textContent = `${r.value}${unit}`;
    onChange(Number(r.value));
  });
  row.append(r, out);
  return row;
}

function gfxRowCheck(label, value, onChange) {
  const l = document.createElement('label');
  l.className = 'sw gfx-sw';
  const cb = document.createElement('input');
  cb.type = 'checkbox'; cb.checked = !!value;
  cb.addEventListener('change', () => onChange(cb.checked));
  const t = document.createElement('span');
  t.className = 'sw-t';
  const s = document.createElement('span');
  s.className = 'sw-l';
  s.textContent = label;
  l.append(cb, t, s);
  return l;
}

function gfxRowText(label, value, placeholder, onChange) {
  const row = gfxRow(label);
  const i = document.createElement('input');
  i.type = 'text'; i.value = value; i.placeholder = placeholder; i.maxLength = 42;
  i.className = 'gfx-text';
  i.addEventListener('input', () => onChange(i.value));
  row.appendChild(i);
  return row;
}

/* The nine-point anchor, laid out as the 3x3 it represents. A dropdown of
   "top left / top centre / ..." is the same information in a form you have to
   read instead of point at. */
function gfxRowAnchor(value, onChange) {
  const row = gfxRow('Position');
  const grid = document.createElement('div');
  grid.className = 'gfx-anchor';
  for (const p of GFX_POS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'gfx-anchor-b';
    b.dataset.pos = p;
    b.setAttribute('aria-label', p);
    b.setAttribute('aria-pressed', String(p === value));
    b.classList.toggle('is-active', p === value);
    b.addEventListener('click', () => {
      grid.querySelectorAll('.gfx-anchor-b').forEach((o) => {
        const on = o.dataset.pos === p;
        o.classList.toggle('is-active', on);
        o.setAttribute('aria-pressed', String(on));
      });
      onChange(p);
    });
    grid.appendChild(b);
  }
  row.appendChild(grid);
  return row;
}

function gfxRenderModes() {
  const host = document.getElementById('gfx-modes');
  if (!host) return;
  host.textContent = '';
  const all = gfxModes();
  for (const name of Object.keys(all)) {
    const row = document.createElement('div');
    row.className = 'gfx-mode';
    row.classList.toggle('is-active', name === (settings.gfxMode || 'Default'));

    const pick = document.createElement('button');
    pick.type = 'button';
    pick.className = 'gfx-mode-pick';
    pick.innerHTML = `<span>${name}</span>`
      + (name === 'Default' ? '<span class="gfx-mode-tag">BUILT IN</span>' : '');
    pick.addEventListener('click', () => {
      settings.gfxMode = name;
      saveSettings();
      gfxRenderModes();
      gfxBuildPanel();
      gfxRender();
    });
    row.appendChild(pick);

    if (name !== 'Default') {
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'gfx-mode-del';
      del.textContent = '×';
      del.title = `Delete the ${name} mode`;
      del.setAttribute('aria-label', `Delete the ${name} mode`);
      del.addEventListener('click', () => {
        const modes = Object.assign({}, settings.gfxModes);
        delete modes[name];
        settings.gfxModes = modes;
        if (settings.gfxMode === name) settings.gfxMode = 'Default';
        saveSettings();
        gfxRenderModes();
        gfxBuildPanel();
        gfxRender();
      });
      row.appendChild(del);
    }
    host.appendChild(row);
  }
}

function gfxSaveModeAs() {
  const input = document.getElementById('gfx-mode-name');
  const name = (input.value || '').trim().slice(0, 28);
  if (!name || name === 'Default') return;
  settings.gfxModes = Object.assign({}, settings.gfxModes, { [name]: gfxCfg() });
  settings.gfxMode = name;
  saveSettings();
  input.value = '';
  gfxRenderModes();
  gfxBuildPanel();
  gfxRender();
}

// ---------- Wiring ------------------------------------------------------------

function initGraphics() {
  GFX.ready = true;
  gfxEnsureRoot();
  gfxRenderModes();
  gfxBuildPanel();

  document.getElementById('gfx-mode-add')?.addEventListener('click', gfxSaveModeAs);
  document.getElementById('gfx-mode-name')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') gfxSaveModeAs();
  });

  // A graphic is only honest if it repaints when what it describes changes.
  // Layer checkboxes, the model selectors and the wx mode chips are the three
  // places a product swap can originate.
  document.querySelectorAll('input[data-layer]').forEach((cb) =>
    cb.addEventListener('change', () => gfxRender()));
  for (const id of ['model-field', 'model-name']) {
    document.getElementById(id)?.addEventListener('change', () => gfxRender());
  }
  document.querySelectorAll('#wx-modes .chip').forEach((c) =>
    c.addEventListener('click', () => setTimeout(gfxRender, 0)));

  // One second is the coarsest tick that still lets a countdown read as live.
  GFX.tick = setInterval(() => {
    const cfg = gfxCfg();
    if (cfg.readout.on && cfg.readout.clock) gfxRenderReadout(cfg.readout);
    if (cfg.warning.on) gfxRenderWarning(cfg.warning);
  }, 1000);

  // The banner has to work with the warning POLYGONS switched off -- a
  // broadcaster who does not want the shapes on the map still wants the
  // headline. So it keeps its own copy of the alert list current.
  const pollWarnings = () => {
    if (!gfxCfg().warning.on) return;
    if (warnDS && warnDS.show) return;         // the layer is already polling
    fetchWarnFeatures().then(() => gfxRender());
  };
  pollWarnings();
  GFX.warnTimer = setInterval(pollWarnings, 120000);

  gfxRender();
}

// ═══════════════════════════════════════════════════════════════════════════
//  SCENES  ("a PowerPoint presentation, but within a radar app")
//
//  The other half of the reference app's broadcast tab. A scene is not a
//  screenshot: it is the camera, the layer set, the model field and the pane
//  layout, so recalling it puts the LIVE globe back where it was. Frame 1311
//  of v1.mp4 is explicit about this -- "these aren't just static images, this
//  is the actual radar" -- and it is the whole point. A deck of stills is a
//  deck of stills; a deck of camera states is a weather show whose data is
//  still updating while you talk over it.
//
//  Image slides exist too, for the one-off graphic that is genuinely a
//  picture, and they are stored separately from `settings` because a couple of
//  photographs would blow the 5 MB localStorage budget the rest of the app's
//  preferences live in.
// ═══════════════════════════════════════════════════════════════════════════

const SCENES_KEY = 'graticule.scenes.v1';

// A 16:9 thumb at the rail's content width. Big enough to recognise a scene
// by its shape, small enough that twenty of them are ~90 KB of storage.
const SCENE_THUMB_W = 236;
const SCENE_THUMB_H = 133;

/* Uploaded stills are re-encoded before they are stored. A phone screenshot is
   2-4 MB and there is no reason to keep more than the broadcast frame needs.

   Dimensions alone are not a budget: 1600x900 of fine detail encodes to 800 KB
   at q0.72 while a typical photograph of the same size lands near 200 KB, and
   three of the former fill the whole 5 MB localStorage allowance. So quality
   steps down until the slide fits the budget, and the last step is taken even
   if it does not -- an over-budget slide is the operator's problem to see,
   which scenesSave() reports, rather than something to refuse silently. */
const SCENE_IMAGE_MAX = 1600;
const SCENE_IMAGE_QS = [0.72, 0.6, 0.5, 0.42];
const SCENE_IMAGE_BUDGET = 460_000;   // chars of data URL, ~340 KB of bytes

// Layers a scene captures. Restoring drives the HUD checkbox rather than the
// data source, because the checkbox is what LOADS a layer that has never been
// switched on -- setting .show on a null data source is a no-op that looks
// like a working restore.
const SCENE_LAYERS = [
  'radar', 'radar_site', 'clouds', 'warnings', 'spc_outlook', 'lsr', 'metar',
  'model', 'rivers', 'tides', 'buoys', 'cities', 'states', 'countries',
  'quakes', 'fires', 'hurricanes', 'cameras', 'spotters',
];

const SCENES = {
  list: [],
  index: -1,
  playing: false,
  timer: null,
  dwellMs: 9000,
  restoring: false,
};

function scenesLoad() {
  try {
    const raw = JSON.parse(localStorage.getItem(SCENES_KEY) || '{}');
    SCENES.list = Array.isArray(raw.list) ? raw.list : [];
    SCENES.dwellMs = Number(raw.dwellMs) || 9000;
  } catch { SCENES.list = []; }
}

/* Returns an error string rather than throwing. A deck that silently fails to
   save is worse than one that refuses to add the slide that broke it, and the
   thing that breaks it is always an image. */
function scenesSave() {
  try {
    localStorage.setItem(SCENES_KEY,
      JSON.stringify({ list: SCENES.list, dwellMs: SCENES.dwellMs }));
    return null;
  } catch (err) {
    return err && err.name === 'QuotaExceededError'
      ? 'Out of local storage. Delete an image slide.'
      : `Could not save: ${err.message}`;
  }
}

// ---------- Capture -----------------------------------------------------------

function sceneCaptureState() {
  const layers = {};
  for (const key of SCENE_LAYERS) {
    const cb = document.querySelector(`input[data-layer="${key}"]`);
    if (cb && !cb.disabled) layers[key] = cb.checked;
  }
  const c = viewer.camera;
  return {
    cam: {
      pos: [c.positionWC.x, c.positionWC.y, c.positionWC.z],
      hpr: [c.heading, c.pitch, c.roll],
    },
    layers,
    wx: currentWxMode(),
    model: { name: valueOf('model-name', 'gfs'), field: valueOf('model-field', 'temperature_2m') },
    panes: PANES.mode,
    // The north-America lock owns the camera. A scene recalled while it is on
    // would be dragged back to the home view a frame later, so the lock's
    // state is part of the scene.
    lock: !!settings.lockNorthAmerica,
  };
}

/* Grab the current frame as a thumbnail. Cesium clears its drawing buffer
   after every render unless preserveDrawingBuffer is set, which it is (the
   pane snapshots need it too), so this has to render immediately before
   reading rather than trusting whatever is in the buffer. */
function sceneThumb() {
  try {
    viewer.scene.requestRender();
    viewer.render();
    const cv = document.createElement('canvas');
    cv.width = SCENE_THUMB_W;
    cv.height = SCENE_THUMB_H;
    const ctx = cv.getContext('2d');
    const src = viewer.canvas;
    // Cover, not stretch: a squashed globe in the strip is unreadable.
    const scale = Math.max(SCENE_THUMB_W / src.width, SCENE_THUMB_H / src.height);
    const w = src.width * scale, h = src.height * scale;
    ctx.drawImage(src, (SCENE_THUMB_W - w) / 2, (SCENE_THUMB_H - h) / 2, w, h);
    return cv.toDataURL('image/jpeg', 0.62);
  } catch (err) {
    // Cross-origin imagery can taint the canvas, and toDataURL throws on a
    // tainted one. A missing thumbnail is survivable; a thrown exception
    // mid-capture would lose the slide.
    console.warn('scene thumbnail unavailable:', err.message);
    return '';
  }
}

function sceneAddMap() {
  const s = Object.assign({
    id: `s${Date.now().toString(36)}${SCENES.list.length}`,
    kind: 'map',
    name: `Slide ${SCENES.list.length + 1}`,
    thumb: sceneThumb(),
  }, sceneCaptureState());
  SCENES.list.push(s);
  SCENES.index = SCENES.list.length - 1;
  sceneAfterChange();
}

async function sceneAddImage(file) {
  const url = await new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result);
    fr.onerror = () => rej(new Error('could not read the file'));
    fr.readAsDataURL(file);
  });
  const img = await new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => rej(new Error('not an image this browser can decode'));
    i.src = url;
  });

  const scale = Math.min(1, SCENE_IMAGE_MAX / Math.max(img.width, img.height));
  const cv = document.createElement('canvas');
  cv.width = Math.round(img.width * scale);
  cv.height = Math.round(img.height * scale);
  cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);

  const tc = document.createElement('canvas');
  tc.width = SCENE_THUMB_W; tc.height = SCENE_THUMB_H;
  const tctx = tc.getContext('2d');
  const ts = Math.max(SCENE_THUMB_W / img.width, SCENE_THUMB_H / img.height);
  const tw = img.width * ts, th = img.height * ts;
  tctx.drawImage(img, (SCENE_THUMB_W - tw) / 2, (SCENE_THUMB_H - th) / 2, tw, th);

  let data = '';
  for (const q of SCENE_IMAGE_QS) {
    data = cv.toDataURL('image/jpeg', q);
    if (data.length <= SCENE_IMAGE_BUDGET) break;
  }

  SCENES.list.push({
    id: `s${Date.now().toString(36)}i`,
    kind: 'image',
    name: file.name.replace(/\.[^.]+$/, '').slice(0, 30) || 'Image',
    image: data,
    thumb: tc.toDataURL('image/jpeg', 0.62),
  });
  SCENES.index = SCENES.list.length - 1;
  sceneAfterChange();
}

function sceneAfterChange() {
  const err = scenesSave();
  sceneRenderList();
  sceneApplyIndex();
  const note = document.getElementById('scene-note');
  if (note) note.textContent = err || '';
  if (note) note.classList.toggle('is-bad', !!err);
}

// ---------- Recall ------------------------------------------------------------

function sceneApplyIndex() {
  const s = SCENES.list[SCENES.index];
  const still = document.getElementById('scene-still');
  if (still) {
    const show = !!(s && s.kind === 'image');
    still.classList.toggle('hidden', !show);
    still.style.backgroundImage = show ? `url(${s.image})` : '';
  }
  sceneRenderBar();
}

async function sceneGo(i) {
  if (!SCENES.list.length) return;
  const n = SCENES.list.length;
  SCENES.index = ((i % n) + n) % n;
  const s = SCENES.list[SCENES.index];

  if (s.kind === 'map') {
    SCENES.restoring = true;
    try {
      // The lock first: it steers the camera, so restoring the view before
      // releasing it means flying to a position that is immediately overridden.
      if (s.lock !== undefined && s.lock !== settings.lockNorthAmerica) {
        settings.lockNorthAmerica = s.lock;
        saveSettings();
        const cb = document.getElementById('lock-na');
        if (cb) cb.checked = s.lock;
        // Takes the state as an argument; calling it bare turns the lock OFF.
        applyNorthAmericaLock(s.lock);
      }

      for (const [key, want] of Object.entries(s.layers || {})) {
        const cb = document.querySelector(`input[data-layer="${key}"]`);
        if (!cb || cb.disabled || cb.checked === want) continue;
        cb.checked = want;
        cb.dispatchEvent(new Event('change', { bubbles: true }));
      }
      if (s.model) {
        for (const [id, v] of [['model-name', s.model.name], ['model-field', s.model.field]]) {
          const el = document.getElementById(id);
          if (el && v && el.value !== v) {
            el.value = v;
            el.dispatchEvent(new Event('change', { bubbles: true }));
          }
        }
      }
      if (s.panes && s.panes !== PANES.mode) applyPaneMode(s.panes);

      if (s.cam) {
        viewer.camera.flyTo({
          destination: new Cesium.Cartesian3(s.cam.pos[0], s.cam.pos[1], s.cam.pos[2]),
          orientation: { heading: s.cam.hpr[0], pitch: s.cam.hpr[1], roll: s.cam.hpr[2] },
          duration: 1.4,
        });
      }
    } finally {
      SCENES.restoring = false;
    }
  }

  sceneApplyIndex();
  sceneRenderList();
  gfxRender();
}

function sceneNext() { sceneGo(SCENES.index + 1); }
function scenePrev() { sceneGo(SCENES.index - 1); }

function scenePlay(on) {
  SCENES.playing = !!on && SCENES.list.length > 1;
  if (SCENES.timer) { clearInterval(SCENES.timer); SCENES.timer = null; }
  if (SCENES.playing) SCENES.timer = setInterval(sceneNext, SCENES.dwellMs);
  sceneRenderBar();
}

function sceneDelete(id) {
  const i = SCENES.list.findIndex((s) => s.id === id);
  if (i < 0) return;
  SCENES.list.splice(i, 1);
  if (SCENES.index >= SCENES.list.length) SCENES.index = SCENES.list.length - 1;
  if (!SCENES.list.length) { SCENES.index = -1; scenePlay(false); }
  sceneAfterChange();
}

function sceneMove(id, delta) {
  const i = SCENES.list.findIndex((s) => s.id === id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= SCENES.list.length) return;
  const [s] = SCENES.list.splice(i, 1);
  SCENES.list.splice(j, 0, s);
  if (SCENES.index === i) SCENES.index = j;
  sceneAfterChange();
}

/* Re-shoot a slide against the current globe. The alternative is deleting and
   re-adding, which loses the slide's place in the running order. */
function sceneUpdate(id) {
  const s = SCENES.list.find((x) => x.id === id);
  if (!s || s.kind !== 'map') return;
  Object.assign(s, sceneCaptureState(), { thumb: sceneThumb() });
  sceneAfterChange();
}

// ---------- The strip ---------------------------------------------------------

/* One line under the title saying what the slide will put back. Without it a
   deck of thumbnails of the same continent is unreadable, which is why the
   reference app prints "Radar · KLCH · N0B" under each of its own. */
function sceneSummary(s) {
  if (s.kind === 'image') return 'Still image';
  const on = Object.entries(s.layers || {}).filter(([, v]) => v).map(([k]) => k);
  const parts = [];
  if (on.includes('radar')) parts.push('Radar');
  if (on.includes('clouds')) parts.push('Satellite');
  if (on.includes('warnings')) parts.push('Warnings');
  if (on.includes('model')) {
    const def = FIELD_DEFS[s.model && s.model.field];
    parts.push(def ? (def.legend || def.label) : 'Model');
  }
  if (!parts.length) parts.push('Base map');
  if (s.panes && s.panes !== 'single') parts.push(`${s.panes} pane`);
  return parts.join(' · ');
}

function sceneRenderList() {
  const host = document.getElementById('scene-list');
  if (!host) return;
  host.textContent = '';

  if (!SCENES.list.length) {
    const p = document.createElement('p');
    p.className = 'pane-note';
    p.textContent = 'No slides yet. Frame the globe, then Add slide: the camera, '
                  + 'the layers and the model field come back live, not as a picture.';
    host.appendChild(p);
    sceneRenderBar();
    return;
  }

  SCENES.list.forEach((s, i) => {
    const card = document.createElement('div');
    card.className = 'scene-card';
    card.classList.toggle('is-active', i === SCENES.index);

    const head = document.createElement('div');
    head.className = 'scene-head';

    const num = document.createElement('span');
    num.className = 'scene-n mono';
    num.textContent = String(i + 1);

    const name = document.createElement('input');
    name.className = 'scene-name';
    name.value = s.name;
    name.maxLength = 30;
    name.setAttribute('aria-label', `Slide ${i + 1} name`);
    name.addEventListener('change', () => { s.name = name.value; scenesSave(); });
    name.addEventListener('click', (e) => e.stopPropagation());

    head.append(num, name);
    for (const [txt, title, fn] of [
      ['↑', 'Move earlier', () => sceneMove(s.id, -1)],
      ['↓', 'Move later', () => sceneMove(s.id, 1)],
      ['⟳', 'Re-shoot from the current globe', () => sceneUpdate(s.id)],
      ['×', 'Delete this slide', () => sceneDelete(s.id)],
    ]) {
      if (txt === '⟳' && s.kind !== 'map') continue;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'scene-act';
      b.textContent = txt;
      b.title = title;
      b.setAttribute('aria-label', `${title}, slide ${i + 1}`);
      b.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
      head.appendChild(b);
    }
    card.appendChild(head);

    const sub = document.createElement('div');
    sub.className = 'scene-sub';
    sub.textContent = sceneSummary(s);
    card.appendChild(sub);

    if (s.thumb) {
      const im = document.createElement('img');
      im.className = 'scene-thumb';
      im.src = s.thumb;
      im.alt = '';
      card.appendChild(im);
    }

    card.addEventListener('click', () => sceneGo(i));
    host.appendChild(card);
  });
  sceneRenderBar();
}

function sceneRenderBar() {
  const bar = document.getElementById('scenebar');
  if (!bar) return;
  const n = SCENES.list.length;
  bar.classList.toggle('hidden', n === 0);
  const pos = document.getElementById('sb-pos');
  if (pos) pos.textContent = n ? `${SCENES.index + 1} / ${n}` : '0 / 0';
  const play = document.getElementById('sb-play');
  if (play) {
    play.textContent = SCENES.playing ? '❚❚' : '▶';
    play.setAttribute('aria-pressed', String(SCENES.playing));
  }
  const name = document.getElementById('sb-name');
  if (name) name.textContent = SCENES.list[SCENES.index]?.name || '';
}

// ---------- Wiring ------------------------------------------------------------

function initScenes() {
  scenesLoad();
  sceneRenderList();

  document.getElementById('scene-add')?.addEventListener('click', sceneAddMap);

  const file = document.getElementById('scene-file');
  document.getElementById('scene-image')?.addEventListener('click', () => file?.click());
  file?.addEventListener('change', async () => {
    const f = file.files && file.files[0];
    if (!f) return;
    const note = document.getElementById('scene-note');
    try {
      await sceneAddImage(f);
    } catch (err) {
      if (note) { note.textContent = err.message; note.classList.add('is-bad'); }
    }
    file.value = '';
  });

  const dwell = document.getElementById('scene-dwell');
  const dwellVal = document.getElementById('scene-dwell-val');
  if (dwell) {
    dwell.value = String(Math.round(SCENES.dwellMs / 1000));
    if (dwellVal) dwellVal.textContent = `${dwell.value}s`;
    dwell.addEventListener('input', () => {
      SCENES.dwellMs = Number(dwell.value) * 1000;
      if (dwellVal) dwellVal.textContent = `${dwell.value}s`;
      scenesSave();
      if (SCENES.playing) scenePlay(true);   // restart on the new interval
    });
  }

  document.getElementById('sb-prev')?.addEventListener('click', scenePrev);
  document.getElementById('sb-next')?.addEventListener('click', sceneNext);
  document.getElementById('sb-play')?.addEventListener('click', () => scenePlay(!SCENES.playing));

  // Arrow keys drive the deck, the same way they drive every other presenter.
  // Only once a deck exists, so they keep their default meaning otherwise.
  document.addEventListener('keydown', (e) => {
    if (!SCENES.list.length) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); sceneNext(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); scenePrev(); }
  });

  sceneApplyIndex();
}

// ═══════════════════════════════════════════════════════════════════════════
//  WEATHERFRONT SHELL
//
//  The rail behaviours that came with docking it, the product list that
//  replaced a two-item dropdown, the NWS Alerts tab, and the division
//  dashboards.
//
//  One rule runs through all of it, and it is the same rule that fixed the
//  alerts panel: a view reads the FEED, not the scene. Every dashboard here
//  fetches or reads the raw records, so opening the tropical board does not
//  require the hurricane layer to be switched on first, and a board is honest
//  about an empty feed instead of rendering a blank card.
// ═══════════════════════════════════════════════════════════════════════════

// ---------- Rail: collapse ---------------------------------------------------

function railSetCollapsed(on) {
  document.body.classList.toggle('rail-collapsed', !!on);
  try { localStorage.setItem('graticule.rail', on ? 'closed' : 'open'); } catch {}
  // The canvas is sized by its container, and the container just changed width
  // without the window resizing -- Cesium only re-reads that on its own resize
  // event, so without this the globe keeps rendering at the old width and the
  // picking maths goes with it.
  const settle = () => { if (viewer) { viewer.resize(); viewer.scene.requestRender(); } };
  settle();
  setTimeout(settle, 200);   // again after the width transition finishes
}

function initRailShell() {
  document.getElementById('rail-collapse')?.addEventListener('click', () => railSetCollapsed(true));
  document.getElementById('rail-open')?.addEventListener('click', () => railSetCollapsed(false));

  let saved = null;
  try { saved = localStorage.getItem('graticule.rail'); } catch {}
  if (saved === 'closed') railSetCollapsed(true);

  document.addEventListener('keydown', (e) => {
    if (e.key !== '\\' || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    e.preventDefault();
    railSetCollapsed(!document.body.classList.contains('rail-collapsed'));
  });

  // Presentation mode collapses the rail to zero width via CSS. The canvas
  // needs the same nudge it gets from a manual collapse.
  const btn = document.getElementById('present-btn');
  if (btn) btn.addEventListener('click', () => {
    setTimeout(() => { if (viewer) { viewer.resize(); viewer.scene.requestRender(); } }, 220);
  });
}

// ---------- Radar: product list ---------------------------------------------
//
// The reference app lists radar products as plain rows under group headings
// instead of hiding them in a select. The select survives as the state holder
// so rebuildRadarSiteLayer() still has exactly one input to read.

function initRadarProductList() {
  const sel = document.getElementById('radar-product');
  const items = Array.from(document.querySelectorAll('.wf-item[data-product]'));
  if (!sel || !items.length) return;
  items.forEach((it) => {
    it.addEventListener('click', () => {
      items.forEach((x) => x.classList.toggle('is-active', x === it));
      sel.value = it.dataset.product;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
  });
  // Reflect whatever the select already holds, so the two never disagree.
  const active = items.find((x) => x.dataset.product === sel.value) || items[0];
  items.forEach((x) => x.classList.toggle('is-active', x === active));
  sel.value = active.dataset.product;
}

// ---------- Mapping division: mirrors of two Settings controls ---------------
//
// Area darkening is scoped mid-broadcast, so its switch belongs in the rail.
// The Settings copies stay -- these two write through to them rather than
// keeping a second copy of the state.

function initMappingMirrors() {
  const src = document.getElementById('ad-enabled');
  const mirror = document.getElementById('ad-enabled-2');
  if (src && mirror) {
    mirror.checked = src.checked;
    mirror.addEventListener('change', () => {
      if (src.checked === mirror.checked) return;
      src.checked = mirror.checked;
      src.dispatchEvent(new Event('change', { bubbles: true }));
    });
    src.addEventListener('change', () => { mirror.checked = src.checked; });
  }
  document.getElementById('ad-select-2')?.addEventListener('click', () => {
    document.getElementById('ad-select')?.click();
  });
}

// ---------- NWS Alerts tab ---------------------------------------------------
//
// Weatherfront's second rail tab: a census of what is in effect by type, then
// the products themselves. Both halves read warnFeatures, which is kept fresh
// whether or not the polygon layer is drawing.

function alScope() {
  const el = document.getElementById('al-scope');
  return (el && el.value) || 'all';
}

/* Alerts that pass the current scope. "In view" uses the camera rectangle so
   the census answers "what is in effect where I am looking", which is the
   question a presenter is actually asking. */
function alFiltered() {
  const list = warnFeatures || [];
  const scope = alScope();
  if (scope === 'warnings') {
    return list.filter((f) => /warning/i.test(f.properties?.event || ''));
  }
  if (scope === 'view') {
    const rect = viewer && viewer.camera.computeViewRectangle(viewer.scene.globe.ellipsoid);
    if (!rect) return list;
    const w = Cesium.Math.toDegrees(rect.west),  e = Cesium.Math.toDegrees(rect.east);
    const s = Cesium.Math.toDegrees(rect.south), n = Cesium.Math.toDegrees(rect.north);
    return list.filter((f) => {
      const g = f.geometry;
      if (!g) return false;                      // zone-only alert: no position to test
      const polys = g.type === 'Polygon' ? [g.coordinates]
                  : g.type === 'MultiPolygon' ? g.coordinates : [];
      for (const poly of polys) {
        for (const [x, y] of (poly[0] || [])) {
          if (y >= s && y <= n && x >= Math.min(w, e) && x <= Math.max(w, e)) return true;
        }
      }
      return false;
    });
  }
  return list;
}

function renderAlertTypes() {
  const host = document.getElementById('al-types');
  if (!host) return;
  const list = alFiltered();

  const counts = new Map();
  for (const f of list) {
    const ev = f.properties?.event || 'Unknown';
    counts.set(ev, (counts.get(ev) || 0) + 1);
  }
  const rows = [...counts.entries()].sort((a, b) => {
    const pa = warnStyle(a[0]).p, pb = warnStyle(b[0]).p;
    return pb - pa || b[1] - a[1];
  });

  setText('al-type-n', String(rows.length));
  setText('al-prod-n', String(list.length));
  setText('al-prod-n2', String(list.length));
  const scope = alScope();
  setText('al-scope-l', scope === 'view' ? 'in this view'
                      : scope === 'warnings' ? 'warnings only'
                      : 'nationwide');

  if (!rows.length) {
    host.innerHTML = '<div class="al-empty">Nothing in effect for this scope.</div>';
    return;
  }
  host.innerHTML = rows.map(([ev, n]) =>
    `<button class="al-type" data-event="${escapeHtml(ev)}" style="--ad:${warnStyle(ev).c}">` +
    `<span class="al-dot"></span><span class="al-name">${escapeHtml(ev)}</span>` +
    `<span class="al-n">${n}</span></button>`).join('');

  // Clicking a type flies to the first alert of that type that has a shape.
  host.querySelectorAll('.al-type').forEach((btn) => {
    btn.addEventListener('click', () => {
      const f = list.find((x) => (x.properties?.event || '') === btn.dataset.event && x.geometry);
      if (f) flyToGeometry(f.geometry);
    });
  });
}

function initAlertsTab() {
  document.getElementById('al-scope')?.addEventListener('change', () => {
    renderAlertTypes();
    renderWarningCards();
  });

  // Keep the tab current with the warning LAYER off. The GFX banner already
  // polled for its own copy but only while the banner was switched on, so the
  // tab would have inherited a list that goes stale the moment a presenter
  // turns the banner off.
  const poll = async () => {
    if (warnDS && warnDS.show) return;           // refreshWarnings() owns it
    if (await fetchWarnFeatures()) {
      renderWarningCards();
      renderAlertTypes();
    }
  };
  poll();
  setInterval(poll, 60_000);
}

// ---------- Dashboards -------------------------------------------------------
//
// Full-frame boards, one per division, opened from the rail. Every one of them
// re-reads its source on open and every 30 s while it is up, and every one
// says so when a feed is genuinely empty rather than drawing an empty card.

const DASH = { id: null, timer: null };

// The space-weather blob arrives on the websocket and used to be written
// straight into the header chips and dropped. The space board needs the same
// numbers, so applySpaceWeather() keeps a reference here.
let SPACE_WX = null;

function dashEl() {
  let el = document.getElementById('dashboard');
  if (el) return el;
  el = document.createElement('div');
  el.id = 'dashboard';
  el.className = 'hidden';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.innerHTML =
    '<header class="db-head">' +
      '<span class="db-mark"></span>' +
      '<div class="db-id"><h1 id="db-title">—</h1><p id="db-sub">—</p></div>' +
      '<span class="db-live"><i></i>LIVE</span>' +
      '<span id="db-clock" class="mono">—</span>' +
      '<button id="db-close" aria-label="Close dashboard">&times;</button>' +
    '</header>' +
    '<div id="db-body" class="db-body"></div>';
  document.body.appendChild(el);
  el.querySelector('#db-close').addEventListener('click', dashClose);
  return el;
}

function dashClose() {
  DASH.id = null;
  clearInterval(DASH.timer);
  DASH.timer = null;
  dashEl().classList.add('hidden');
}

async function dashOpen(id) {
  const def = DASHBOARDS[id];
  if (!def) return;
  const el = dashEl();
  DASH.id = id;
  el.classList.remove('hidden');
  setText('db-title', def.title);
  setText('db-sub', def.sub);
  document.getElementById('db-body').innerHTML =
    '<p class="db-loading">Reading the feed…</p>';
  await dashRefresh();
  clearInterval(DASH.timer);
  DASH.timer = setInterval(dashRefresh, 30_000);
}

async function dashRefresh() {
  const def = DASHBOARDS[DASH.id];
  const body = document.getElementById('db-body');
  if (!def || !body) return;
  const clock = document.getElementById('db-clock');
  if (clock) clock.textContent = new Date().toUTCString().slice(17, 25) + ' UTC';
  try {
    const data = await def.load();
    if (DASH.id !== def.id) return;              // closed or switched mid-fetch
    body.innerHTML = def.render(data);
    body.querySelectorAll('[data-fly]').forEach((n) => {
      n.addEventListener('click', () => {
        const [lon, lat] = n.dataset.fly.split(',').map(Number);
        if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;
        dashClose();
        _lastInteractionAt = performance.now();
        viewer.camera.flyTo({
          destination: Cesium.Cartesian3.fromDegrees(lon, lat, 600_000),
          duration: 1.8,
        });
      });
    });
  } catch (err) {
    body.innerHTML = `<p class="db-loading">Feed unavailable: ${escapeHtml(err.message)}</p>`;
  }
}

function initDashboards() {
  // The full-frame board is the biggest thing a division can do, and its
  // button sat at the BOTTOM of the pane -- below a scroll, in several cases
  // off-screen entirely. One dominant action per surface, at the top, where
  // the eye lands. Moved here rather than in the markup so a division's
  // controls stay in their authored order and nothing else has to change.
  // Each opener rises to the top of ITS OWN division, found by walking up from
  // the button rather than down from a container. Sweeping `.hud-pane` for
  // descendants instead hoisted all five of them into the shared Data pane, so
  // every division opened with five dashboard buttons stacked above its own
  // navigation. `closest` on the union stops at the division body when there
  // is one and at the pane when there is not.
  // Promotion keys on the CLASS, not on `data-dash`. The World division's
  // opener has no `data-dash` -- the population board runs a 10Hz odometer
  // rather than the registry's fetch-and-render, so it is wired separately in
  // initWorldDash() -- and keying on the attribute left the single most
  // elaborate screen in the app sitting under 688px of unscrolled rail, which
  // is the exact defect this loop was written to fix for the other five.
  document.querySelectorAll('.dash-open').forEach((b) => {
    const host = b.closest('[data-mode-body], .hud-pane');
    if (host && host.firstElementChild !== b) host.prepend(b);
  });
  document.querySelectorAll('[data-dash]').forEach((b) =>
    b.addEventListener('click', () => dashOpen(b.dataset.dash)));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && DASH.id) dashClose();
  });
}

// ---- Dashboard building blocks ----

const dbNum = (v, dp = 0) =>
  (v == null || !Number.isFinite(Number(v))) ? '—'
    : Number(v).toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp });

/* A card claims extra columns for the content it holds, so an empty one gives
   them back. The severe board asked for the full width for "Impact products"
   whether it held a four-column table or the one sentence saying nothing is in
   effect -- and on a quiet day that sentence sat alone across 1,550 px while
   the storm-reports card below it started a fresh row a third of the way
   across. Off-season is the normal state for half these boards, so the quiet
   layout is the one that has to look composed. */
function dbCard(title, inner, cls = '') {
  const empty = /class="db-empty"/.test(inner);
  const width = empty ? '' : cls;
  return `<section class="db-card ${width}"><h2 class="db-card-h">${escapeHtml(title)}</h2>${inner}</section>`;
}

/* A zero is not an alarm. "0" printed in warning-red under "Tornado warnings"
   reads at a glance as the opposite of what it says -- the eye takes the
   colour before it takes the digit. Colour is reserved for a count that is
   actually non-zero; a zero goes quiet. */
function dbStats(items) {
  return '<div class="db-stats">' + items.map((s) => {
    const zero = /^0$|^—$/.test(String(s.value).trim());
    const tint = s.color && !zero ? `color:${s.color}` : '';
    return `<div class="db-stat${zero ? ' is-zero' : ''}">` +
      `<span class="db-stat-v mono" style="${tint}">${s.value}</span>` +
      `<span class="db-stat-k">${escapeHtml(s.label)}</span></div>`;
  }).join('') + '</div>';
}

/* A ranked bar chart, scaled to the largest row. Rows with a zero count are
   kept: "no tornado warnings" is a reading, not an absence of one. */
function dbBars(rows) {
  if (!rows.length) return '<p class="db-empty">Nothing to rank.</p>';
  const max = Math.max(...rows.map((r) => r.n), 1);
  return '<div class="db-bars">' + rows.map((r) =>
    `<div class="db-bar-row"${r.fly ? ` data-fly="${r.fly}"` : ''}>` +
      `<span class="db-bar-k">${escapeHtml(r.label)}</span>` +
      `<span class="db-bar-t"><i style="width:${(100 * r.n / max).toFixed(1)}%;background:${r.color || 'var(--accent)'}"></i></span>` +
      `<span class="db-bar-n mono">${dbNum(r.n)}</span>` +
    '</div>').join('') + '</div>';
}

function dbTable(head, rows) {
  if (!rows.length) return '<p class="db-empty">No rows.</p>';
  return '<table class="db-table"><thead><tr>' +
    head.map((h) => `<th>${escapeHtml(h)}</th>`).join('') + '</tr></thead><tbody>' +
    rows.map((r) => `<tr${r.fly ? ` data-fly="${r.fly}" class="is-clickable"` : ''}>` +
      r.cells.map((c) => `<td>${c}</td>`).join('') + '</tr>').join('') +
    '</tbody></table>';
}

const dbEmpty = (why) => `<p class="db-empty">${escapeHtml(why)}</p>`;

// A small fetch cache so four cards on one board do not pull the same feed
// four times, and a 30 s refresh does not re-pull a 4 MB river payload it
// already has.
const _dbCache = new Map();
async function dbFetch(url, ttlMs = 25_000) {
  const hit = _dbCache.get(url);
  if (hit && Date.now() - hit.at < ttlMs) return hit.data;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} → HTTP ${r.status}`);
  const data = await r.json();
  _dbCache.set(url, { at: Date.now(), data });
  return data;
}

// ---- 1. Severe weather ------------------------------------------------------

// NWS marine and offshore zones use the same two-letter UGC slot as a state,
// and none of them is one. Naming them keeps a row reading "PK 6" -- which
// means nothing to anybody -- off a board that is meant to be read at a
// glance. https://www.weather.gov/nwr/marine_zones
const MARINE_ZONE = {
  AM: 'Caribbean waters', AN: 'Atlantic coastal', GM: 'Gulf waters',
  LC: 'Lake St. Clair',   LE: 'Lake Erie',        LH: 'Lake Huron',
  LM: 'Lake Michigan',    LO: 'Lake Ontario',     LS: 'Lake Superior',
  PH: 'Hawaii waters',    PK: 'Alaska waters',    PM: 'Marianas waters',
  PS: 'Samoa waters',     PZ: 'Pacific coastal',  SL: 'St. Lawrence R.',
};

/* Which states an alert covers.
   `areaDesc` reads "County, ST; County, ST" for county-based products and
   plain prose for zone-based ones -- "Rio Grande Valley of Eastern Hudspeth
   County", "Kiska to Attu Pacific Side". Parsing the trailing two characters
   therefore worked on the county products and silently dropped the rest: on a
   live pull of 63 active alerts it attributed 30 of them and found four
   states, while California had an Extreme Heat Warning printed across the top
   of the map. A card that authoritative should not be missing half the
   country.
   `geocode.UGC` is the service's own answer and was on 62 of the 63. Its first
   two characters are the state or marine prefix by definition, so it goes
   first and the prose regex stays as the fallback for the rare alert with no
   UGC at all. Same pull, after: 62 alerts attributed across 22 areas. */
const STATE_OF = (arg) => {
  const props = (arg && typeof arg === 'object') ? arg : null;
  const areaDesc = props ? props.areaDesc : arg;
  const out = new Set();
  for (const ugc of (props?.geocode?.UGC) || []) {
    const m = String(ugc).match(/^([A-Z]{2})[CZ]\d{3}$/);
    if (m) out.add(m[1]);
  }
  if (out.size) return [...out];
  for (const seg of String(areaDesc || '').split(';')) {
    const m = seg.trim().match(/,\s*([A-Z]{2})$/);
    if (m) out.add(m[1]);
  }
  return [...out];
};

const DASH_STORM = {
  id: 'storm',
  title: 'SEVERE WEATHER',
  sub: 'Active NWS products · SPC convective outlook · local storm reports',
  async load() {
    const [alerts, lsr, spc] = await Promise.all([
      dbFetch('/api/nws/alerts'),
      dbFetch('/api/lsr?hours=12').catch(() => ({ features: [] })),
      dbFetch('/api/spc/outlook?day=1', 300_000).catch(() => ({ features: [] })),
    ]);
    return { alerts: alerts.features || [], lsr: lsr.features || [], spc: spc.features || [] };
  },
  render({ alerts, lsr, spc }) {
    const count = (re) => alerts.filter((f) => re.test(f.properties?.event || '')).length;

    const hero = dbStats([
      { label: 'Active products', value: dbNum(alerts.length) },
      { label: 'Tornado warnings', value: dbNum(count(/^Tornado Warning/i)), color: '#f43f5e' },
      { label: 'Severe t-storm', value: dbNum(count(/^Severe Thunderstorm Warning/i)), color: '#f59e0b' },
      { label: 'Flash flood', value: dbNum(count(/^Flash Flood Warning/i)), color: '#4ade80' },
      { label: 'Warnings', value: dbNum(count(/warning/i)) },
      { label: 'Watches', value: dbNum(count(/watch/i)) },
    ]);

    const byType = new Map();
    for (const f of alerts) {
      const ev = f.properties?.event || 'Unknown';
      byType.set(ev, (byType.get(ev) || 0) + 1);
    }
    const typeRows = [...byType.entries()]
      .sort((a, b) => b[1] - a[1]).slice(0, 14)
      .map(([label, n]) => ({ label, n, color: warnStyle(label).c }));

    const byState = new Map();
    for (const f of alerts) {
      for (const st of STATE_OF(f.properties)) {
        byState.set(st, (byState.get(st) || 0) + 1);
      }
    }
    const stateRows = [...byState.entries()]
      .sort((a, b) => b[1] - a[1]).slice(0, 12)
      .map(([code, n]) => ({ label: MARINE_ZONE[code] || code, n }));

    // Impact-bearing products first: the hazard parameters NWS attaches are
    // what separates a routine advisory from something worth a slide.
    const impact = alerts
      .filter((f) => /tornado|severe thunderstorm|flash flood|hurricane|tsunami/i.test(f.properties?.event || ''))
      .sort((a, b) => warnStyle(b.properties.event).p - warnStyle(a.properties.event).p)
      .slice(0, 12)
      .map((f) => {
        const p = f.properties || {}, par = p.parameters || {};
        const first = (k) => (Array.isArray(par[k]) ? par[k][0] : par[k]) || '';
        const bits = [first('hailSize') && `${first('hailSize')}" hail`,
                      first('maxWindGust'),
                      first('tornadoDetection') && `tornado ${first('tornadoDetection')}`,
                      first('thunderstormDamageThreat') || first('flashFloodDamageThreat')]
                     .filter(Boolean);
        let fly = '';
        const g = f.geometry;
        if (g) {
          const ring = (g.type === 'Polygon' ? g.coordinates[0] : (g.coordinates[0] || [])[0]) || [];
          if (ring.length) {
            const lon = ring.reduce((a, c) => a + c[0], 0) / ring.length;
            const lat = ring.reduce((a, c) => a + c[1], 0) / ring.length;
            fly = `${lon.toFixed(3)},${lat.toFixed(3)}`;
          }
        }
        return { fly, cells: [
          `<span style="color:${warnInk(warnStyle(p.event).c)};font-weight:600">${escapeHtml(p.event || '—')}</span>`,
          escapeHtml(String(p.areaDesc || '').split(';').slice(0, 2).join(';') || '—'),
          `<span class="mono">${escapeHtml(fmtExpiry(p.expires) || '—')}</span>`,
          escapeHtml(bits.join(' · ') || '—'),
        ] };
      });

    // typetext, not type: `type` is IEM's single-character code, so ranking on
    // it produced a chart labelled N / M / R / G / D.
    const lsrTypes = new Map();
    for (const f of lsr) {
      const t = f.properties?.typetext || f.properties?.type || 'Report';
      lsrTypes.set(t, (lsrTypes.get(t) || 0) + 1);
    }
    const lsrRows = [...lsrTypes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)
      .map(([label, n]) => ({ label, n, color: '#fbbf24' }));

    // SPC ships one polygon per risk category, ordered from general
    // thunderstorms upward, so the highest category present is the headline.
    const SPC_ORDER = ['TSTM', 'MRGL', 'SLGT', 'ENH', 'MDT', 'HIGH'];
    const spcRows = spc
      .map((f) => f.properties || {})
      .sort((a, b) => SPC_ORDER.indexOf(b.LABEL) - SPC_ORDER.indexOf(a.LABEL))
      .map((p) => `<div class="db-scale-r"><i style="background:${p.stroke || '#64748b'}"></i>` +
        `<span>${escapeHtml(p.LABEL2 || p.LABEL || '—')}</span>` +
        `<span class="mono">${escapeHtml(p.LABEL || '')}</span></div>`).join('');
    const spcIssue = spc.length ? (spc[0].properties || {}) : null;
    const spcCard = spc.length
      ? `<div class="db-scale">${spcRows}</div>` +
        `<p class="db-note" style="margin-top:10px">Day 1, issued ` +
        `${escapeHtml(String(spcIssue.ISSUE_ISO || '').slice(0, 16).replace('T', ' '))} UTC` +
        `${spcIssue.FORECASTER ? ' by ' + escapeHtml(spcIssue.FORECASTER) : ''}.</p>`
      : dbEmpty('The Storm Prediction Center has no Day 1 convective areas drawn.');

    return '<div class="db-grid">' +
      dbCard('In effect right now', hero, 'db-w3') +
      dbCard('By product type', typeRows.length ? dbBars(typeRows) : dbEmpty('No active NWS products.')) +
      dbCard('By state & marine zone',
             stateRows.length ? dbBars(stateRows)
                              : dbEmpty('No product carries a zone code.')) +
      dbCard('SPC Day 1 convective outlook', spcCard) +
      dbCard('Impact products',
        impact.length
          ? dbTable(['Product', 'Area', 'Expires', 'Hazard'], impact)
          : dbEmpty('No tornado, severe thunderstorm, flash flood, hurricane or tsunami product is in effect.'),
        'db-w3') +
      dbCard('Storm reports, past 12 h',
        lsrRows.length ? dbBars(lsrRows) : dbEmpty('No local storm reports in the past 12 hours.')) +
      '</div>';
  },
};

// ---- 2. Tropical ------------------------------------------------------------

const SAFFIR = [
  { min: 137, name: 'Category 5', color: '#f43f5e' },
  { min: 113, name: 'Category 4', color: '#fb7185' },
  { min:  96, name: 'Category 3', color: '#fb923c' },
  { min:  83, name: 'Category 2', color: '#fbbf24' },
  { min:  64, name: 'Category 1', color: '#facc15' },
  { min:  34, name: 'Tropical Storm', color: '#4ade80' },
  { min:   0, name: 'Tropical Depression', color: '#38bdf8' },
];
const saffir = (kt) => SAFFIR.find((s) => (kt || 0) >= s.min) || SAFFIR[SAFFIR.length - 1];

// NWS marine and coastal product names, so the tropical board has something
// to say in the ~10 months a year with no named system on the map.
const MARINE_EVENT =
  /small craft|gale|storm warning|hurricane force wind|hazardous seas|marine|high surf|rip current|coastal flood|beach hazards|surge/i;

const DASH_TROPICAL = {
  id: 'tropical',
  title: 'TROPICAL',
  sub: 'Active systems from the National Hurricane Center · tropical products in effect',
  async load() {
    const alerts = await dbFetch('/api/nws/alerts').catch(() => ({ features: [] }));
    // Storms come off the websocket snapshot, so they are read from the feed
    // cache rather than re-fetched -- the layer does not have to be on.
    const all = alerts.features || [];
    return {
      storms: Object.entries(layerData.hurricanes || {}).map(([id, p]) => ({ id, ...p })),
      alerts: all.filter((f) => /tropical|hurricane|storm surge/i.test(f.properties?.event || '')),
      marine: all.filter((f) => MARINE_EVENT.test(f.properties?.event || '')),
    };
  },
  render({ storms, alerts, marine }) {
    const active = storms.filter((s) => s && s.lat != null);
    const cards = active
      .sort((a, b) => (b.intensity || 0) - (a.intensity || 0))
      .map((s) => {
        const kt = Number(s.intensity) || 0;
        const cat = saffir(kt);
        return `<div class="db-storm" data-fly="${Number(s.lon).toFixed(3)},${Number(s.lat).toFixed(3)}" style="--sc:${cat.color}">` +
          `<div class="db-storm-h"><span class="db-storm-n">${escapeHtml(s.name || 'Unnamed')}</span>` +
          `<span class="db-storm-c">${escapeHtml(cat.name)}</span></div>` +
          '<div class="db-storm-g">' +
            `<span><b class="mono">${dbNum(kt)}</b>kt</span>` +
            `<span><b class="mono">${dbNum(Math.round(kt * 1.15078))}</b>mph</span>` +
            `<span><b class="mono">${s.pressure ? dbNum(s.pressure) : '—'}</b>mb</span>` +
            `<span><b class="mono">${Number(s.lat).toFixed(1)}°, ${Number(s.lon).toFixed(1)}°</b></span>` +
          '</div>' +
          `<div class="db-storm-s">${escapeHtml(s.classification || '')}${s.movement ? ' · moving ' + escapeHtml(s.movement) : ''}</div>` +
        '</div>';
      }).join('');

    const scale = '<div class="db-scale">' + SAFFIR.map((s) =>
      `<div class="db-scale-r"><i style="background:${s.color}"></i>` +
      `<span>${escapeHtml(s.name)}</span><span class="mono">${s.min ? s.min + '+ kt' : '&lt; 34 kt'}</span></div>`).join('') + '</div>';

    const prod = alerts.slice(0, 14).map((f) => {
      const p = f.properties || {};
      return { cells: [
        `<span style="color:${warnInk(warnStyle(p.event).c)};font-weight:600">${escapeHtml(p.event || '—')}</span>`,
        escapeHtml(String(p.areaDesc || '').split(';').slice(0, 2).join(';') || '—'),
        `<span class="mono">${escapeHtml(fmtExpiry(p.expires) || '—')}</span>`,
      ] };
    });

    // Marine products, which are in effect somewhere on the US coast almost
    // every day. Without them this board is blank for most of the year, and a
    // blank board reads as broken rather than as quiet.
    const marineCounts = new Map();
    for (const f of marine) {
      const ev = f.properties?.event || 'Unknown';
      marineCounts.set(ev, (marineCounts.get(ev) || 0) + 1);
    }
    const marineRows = [...marineCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)
      .map(([label, n]) => ({ label, n, color: warnStyle(label).c }));

    return '<div class="db-grid">' +
      dbCard('Active systems',
        active.length
          ? `<div class="db-storms">${cards}</div>`
          : dbEmpty('The National Hurricane Center has no active systems on the board. ' +
                    'This is the normal state outside an active basin period, not a feed failure.'),
        'db-w2') +
      dbCard('Saffir-Simpson', scale) +
      dbCard('Marine and coastal products',
        marineRows.length ? dbBars(marineRows)
                          : dbEmpty('No marine or coastal product is in effect.'),
        'db-w2') +
      dbCard('Tropical products in effect',
        prod.length ? dbTable(['Product', 'Area', 'Expires'], prod)
                    : dbEmpty('No tropical, hurricane or storm surge product is in effect.')) +
      '</div>';
  },
};

// ---- 3. Water ---------------------------------------------------------------

const FLOOD_CAT = [
  ['major',    'Major flood',    '#f43f5e'],
  ['moderate', 'Moderate flood', '#fb923c'],
  ['minor',    'Minor flood',    '#facc15'],
  ['action',   'Action stage',   '#a3e635'],
];

const DASH_WATER = {
  id: 'water',
  title: 'WATER',
  sub: 'River gauges · tide stations · marine buoys, all NOAA, all keyless',
  async load() {
    const [rivers, buoys, tides] = await Promise.all([
      dbFetch('/api/rivers', 120_000).catch(() => ({ features: [] })),
      dbFetch('/api/buoys').catch(() => ({ features: [] })),
      dbFetch('/api/tides', 300_000).catch(() => ({ features: [] })),
    ]);
    return {
      rivers: rivers.features || [],
      flooding: rivers.flooding,
      buoys:  buoys.features  || [],
      tides:  tides.features  || [],
    };
  },
  render({ rivers, flooding, buoys, tides }) {
    const catOf = (f) => String(f.properties?.flood_category || 'no_flooding');
    // flood_rank, not "anything that is not no_flooding". The category field
    // also carries out_of_service / obs_not_current / low_threshold, and
    // counting those as flooding put 268 in the headline over a bar chart
    // that summed to 37.
    const inFlood = rivers.filter((f) => (f.properties?.flood_rank || 0) > 0);
    const dark = rivers.filter((f) =>
      ['out_of_service', 'obs_not_current', 'not_defined'].includes(catOf(f)));

    const hero = dbStats([
      { label: 'Gauges in the network', value: dbNum(rivers.length) },
      { label: 'At or above action stage',
        value: dbNum(flooding != null ? flooding : inFlood.length), color: '#facc15' },
      { label: 'No current stage', value: dbNum(dark.length) },
      { label: 'Buoys reporting', value: dbNum(buoys.length) },
      { label: 'Tide stations', value: dbNum(tides.length) },
    ]);

    const catRows = FLOOD_CAT.map(([key, label, color]) => ({
      label, color,
      n: rivers.filter((f) => catOf(f) === key).length,
    }));

    const worst = rivers
      .slice()
      .sort((a, b) => (b.properties?.flood_rank || 0) - (a.properties?.flood_rank || 0))
      .filter((f) => (f.properties?.flood_rank || 0) > 0)
      .slice(0, 14)
      .map((f) => {
        const p = f.properties, obs = p.observed || {};
        const cat = FLOOD_CAT.find((c) => c[0] === catOf(f));
        return { fly: f.geometry ? f.geometry.coordinates.map((n) => n.toFixed(3)).join(',') : '',
          cells: [
            escapeHtml(p.name || p.id || '—'),
            escapeHtml(p.state || '—'),
            `<span style="color:${cat ? cat[2] : 'var(--text-dim)'};font-weight:600">${escapeHtml(cat ? cat[1] : catOf(f))}</span>`,
            `<span class="mono">${obs.value != null ? dbNum(obs.value, 1) + ' ' + escapeHtml(obs.unit || '') : '—'}</span>`,
          ] };
      });

    const waves = buoys
      .filter((f) => f.properties?.wave_height != null)
      .sort((a, b) => b.properties.wave_height - a.properties.wave_height)
      .slice(0, 12)
      .map((f) => {
        const p = f.properties;
        return { fly: f.geometry ? f.geometry.coordinates.map((n) => n.toFixed(3)).join(',') : '',
          cells: [
            escapeHtml(p.id || '—'),
            `<span class="mono">${dbNum(p.wave_height, 1)} m</span>`,
            `<span class="mono">${p.dom_period != null ? dbNum(p.dom_period, 1) + ' s' : '—'}</span>`,
            `<span class="mono">${p.wind_speed != null ? dbNum(p.wind_speed, 1) + ' m/s' : '—'}</span>`,
          ] };
      });

    return '<div class="db-grid">' +
      dbCard('Water, right now', hero, 'db-w3') +
      dbCard('Gauges by flood category', dbBars(catRows)) +
      dbCard('Buoy sea state',
        waves.length
          ? dbTable(['Buoy', 'Sig. wave', 'Period', 'Wind'], waves)
          : dbEmpty(`None of the ${dbNum(buoys.length)} reporting buoys is sending a wave height right now.`),
        'db-w2') +
      dbCard('Gauges at or above action stage',
        worst.length
          ? dbTable(['Gauge', 'State', 'Category', 'Observed'], worst)
          : dbEmpty('Every reporting gauge is below action stage.'),
        'db-w3') +
      '</div>';
  },
};

// ---- 4. Geophysical ---------------------------------------------------------

const DASH_EARTH = {
  id: 'earth',
  title: 'GEOPHYSICAL',
  sub: 'Earthquakes (USGS) · volcanoes (GVP) · wildfires (FIRMS) · natural events (EONET)',
  async load() {
    return {
      quakes:    Object.entries(layerData.quakes    || {}).map(([id, p]) => ({ id, ...p })),
      volcanoes: Object.entries(layerData.volcanoes || {}).map(([id, p]) => ({ id, ...p })),
      fires:     Object.entries(layerData.fires     || {}).map(([id, p]) => ({ id, ...p })),
      news:      Object.entries(layerData.news      || {}).map(([id, p]) => ({ id, ...p })),
    };
  },
  render({ quakes, volcanoes, fires, news }) {
    const now = Date.now();
    const day = quakes.filter((q) => q.time && now - q.time < 864e5);
    const biggest = day.reduce((a, q) => (a && a.mag > (q.mag || 0) ? a : q), null);

    const hero = dbStats([
      { label: 'Quakes, past 24 h', value: dbNum(day.length) },
      { label: 'Largest, past 24 h', value: biggest ? 'M' + Number(biggest.mag).toFixed(1) : '—',
        color: biggest && biggest.mag >= 6 ? '#f43f5e' : undefined },
      { label: 'M4+ past 24 h', value: dbNum(day.filter((q) => (q.mag || 0) >= 4).length) },
      { label: 'Volcanoes active', value: dbNum(volcanoes.filter((v) => v.active === true).length) },
      { label: 'Fire detections', value: dbNum(fires.length) },
      { label: 'EONET events', value: dbNum(news.length) },
    ]);

    // The bottom band is open-ended downward so the rows sum to the headline
    // count. Stopping at M2 left 151 of 230 quakes off a chart that looked
    // like a complete census.
    const bands = [[7, '#f43f5e'], [6, '#fb7185'], [5, '#fb923c'], [4, '#facc15'], [3, '#a3e635'], [2, '#38bdf8']];
    const bandRows = bands.map(([m, color], i) => ({
      label: i === 0 ? `M${m}+` : `M${m}–${bands[i - 1][0]}`,
      color,
      n: day.filter((q) => (q.mag || 0) >= m && (i === 0 || (q.mag || 0) < bands[i - 1][0])).length,
    }));
    bandRows.push({
      label: 'Below M2', color: '#475569',
      n: day.filter((q) => (q.mag || 0) < 2).length,
    });

    const top = day.slice().sort((a, b) => (b.mag || 0) - (a.mag || 0)).slice(0, 14).map((q) => ({
      fly: `${Number(q.lon).toFixed(3)},${Number(q.lat).toFixed(3)}`,
      cells: [
        `<span class="mono" style="font-weight:600">M${Number(q.mag || 0).toFixed(1)}</span>`,
        escapeHtml(q.place || '—'),
        `<span class="mono">${dbNum(q.depth_km, 1)} km</span>`,
        `<span class="mono">${escapeHtml(formatAge((now - q.time) / 3.6e6))} ago</span>`,
      ],
    }));

    const hotFires = fires.slice().sort((a, b) => (b.frp || 0) - (a.frp || 0)).slice(0, 10).map((f) => ({
      fly: `${Number(f.lon).toFixed(3)},${Number(f.lat).toFixed(3)}`,
      cells: [
        `<span class="mono">${dbNum(f.frp, 1)} MW</span>`,
        `<span class="mono">${Number(f.lat).toFixed(2)}°, ${Number(f.lon).toFixed(2)}°</span>`,
        escapeHtml(f.confidence != null ? String(f.confidence) : '—'),
      ],
    }));

    return '<div class="db-grid">' +
      dbCard('The planet, past 24 hours', hero, 'db-w3') +
      dbCard('Quakes by magnitude band', dbBars(bandRows)) +
      dbCard('Hottest fire detections',
        hotFires.length
          ? dbTable(['Radiative power', 'Position', 'Confidence'], hotFires)
          : dbEmpty((window.__graticule_cfg || {}).fires_enabled === false
              ? 'FIRMS needs a NASA map key, and this install has none, so the fire feed is off. ' +
                'Everything else on this board is keyless and live.'
              : 'The FIRMS feed is reporting no detections. Switch Wildfires on in the Earth division to pull it.'),
        'db-w2') +
      dbCard('Largest earthquakes, past 24 hours',
        top.length ? dbTable(['Magnitude', 'Place', 'Depth', 'When'], top)
                   : dbEmpty('No earthquakes in the past 24 hours in the loaded catalogue.'),
        'db-w3') +
      '</div>';
  },
};

// ---- 5. Space weather -------------------------------------------------------

const DASH_SPACE = {
  id: 'space',
  title: 'SPACE WEATHER',
  sub: 'NOAA SWPC geomagnetic and X-ray conditions · orbital population · launch window',
  async load() {
    return {
      sw: SPACE_WX || {},
      launches: Object.entries(layerData.launches || {}).map(([id, p]) => ({ id, ...p })),
      sats: Object.keys(layerData.satellites || {}).length,
    };
  },
  render({ sw, launches, sats }) {
    const kp = sw.kp && sw.kp.value != null ? Number(sw.kp.value) : null;
    const kpColor = kp == null ? undefined : kp >= 6 ? '#f43f5e' : kp >= 4 ? '#fbbf24' : '#4ade80';
    const cls = sw.xray && sw.xray.class ? String(sw.xray.class) : null;
    const clsColor = !cls ? undefined
      : cls[0] === 'X' ? '#f43f5e' : cls[0] === 'M' ? '#fbbf24' : cls[0] === 'C' ? '#4ade80' : undefined;

    // NOAA's G-scale, which is what a Kp number actually means to a viewer.
    const G = kp == null ? '—'
      : kp >= 9 ? 'G5 Extreme' : kp >= 8 ? 'G4 Severe' : kp >= 7 ? 'G3 Strong'
      : kp >= 6 ? 'G2 Moderate' : kp >= 5 ? 'G1 Minor' : 'Below storm level';

    const hero = dbStats([
      { label: 'Planetary Kp', value: kp == null ? '—' : kp.toFixed(1), color: kpColor },
      { label: 'Geomagnetic storm', value: escapeHtml(G), color: kpColor },
      { label: 'X-ray flux class', value: cls ? escapeHtml(cls) : '—', color: clsColor },
      { label: 'Satellites tracked', value: dbNum(sats) },
    ]);

    const now = Date.now();
    const up = launches
      .filter((l) => l.net && Date.parse(l.net) > now - 3.6e6)
      .sort((a, b) => Date.parse(a.net) - Date.parse(b.net))
      .slice(0, 12)
      .map((l) => {
        const dt = (Date.parse(l.net) - now) / 3.6e6;
        return { fly: l.lat != null ? `${Number(l.lon).toFixed(3)},${Number(l.lat).toFixed(3)}` : '',
          cells: [
            escapeHtml(l.name || '—'),
            `<span class="mono">T${dt >= 0 ? '−' : '+'}${escapeHtml(formatAge(Math.abs(dt)))}</span>`,
            escapeHtml(l.status || l.pad || '—'),
          ] };
      });

    // Half-open bands, so exactly one row lights up. The first version tested
    // `kp >= k && kp < k + 1`, which left the bottom row (threshold 0) dark
    // for every quiet reading -- the case it exists to describe.
    const kpScale = [
      ['G5', 9, Infinity, '#f43f5e', 'Extreme'],
      ['G4', 8, 9,        '#fb7185', 'Severe'],
      ['G3', 7, 8,        '#fb923c', 'Strong'],
      ['G2', 6, 7,        '#fbbf24', 'Moderate'],
      ['G1', 5, 6,        '#facc15', 'Minor'],
      ['—',  0, 5,        '#4ade80', 'Quiet to unsettled'],
    ];
    const scale = '<div class="db-scale">' + kpScale.map(([g, lo, hi, c, name]) =>
      `<div class="db-scale-r${kp != null && kp >= lo && kp < hi ? ' is-now' : ''}">` +
      `<i style="background:${c}"></i><span>${escapeHtml(g)} ${escapeHtml(name)}</span>` +
      `<span class="mono">Kp ${lo ? lo + '+' : '&lt; 5'}</span></div>`).join('') + '</div>';

    return '<div class="db-grid">' +
      dbCard('Conditions now', hero, 'db-w3') +
      dbCard('NOAA G-scale', scale) +
      dbCard('Launch window, T−1 h onward',
        up.length ? dbTable(['Vehicle / payload', 'Countdown', 'Status'], up)
                  : dbEmpty('No launch inside the window the feed carries.'),
        'db-w2') +
      dbCard('Source',
        '<p class="db-note">Kp and X-ray flux come from NOAA SWPC and refresh on the ' +
        'websocket, so this board is current with every layer switched off. ' +
        'The aurora oval itself is an imagery layer — switch Aurora Forecast on ' +
        'in the Outlooks division to see it on the globe.</p>', 'db-w3') +
      '</div>';
  },
};

const DASHBOARDS = {
  storm:    DASH_STORM,
  tropical: DASH_TROPICAL,
  water:    DASH_WATER,
  earth:    DASH_EARTH,
  space:    DASH_SPACE,
};

// ---------- Rail footer: what is on, and whether it is arriving --------------
//
// Two questions the app could not answer from anywhere: which layers are
// drawing right now (they are scattered across nine divisions, so a layer
// switched on in Sky is invisible from Radar), and whether the feeds behind
// them are still delivering. Both live in the strip pinned to the bottom of
// the rail, which is also the space most divisions were leaving empty.

/* Every enabled layer switch, with the label the operator actually read when
   they turned it on. Reads the DOM rather than a parallel registry so it can
   never drift from the switches themselves. */
function railActiveLayers() {
  return Array.from(document.querySelectorAll('input[data-layer]'))
    .filter((cb) => cb.checked && !cb.disabled)
    .map((cb) => ({
      key: cb.dataset.layer,
      label: (cb.closest('.sw')?.querySelector('.sw-l')?.textContent || cb.dataset.layer).trim(),
      cb,
    }));
}

/* Health from the same feedActivity clock the feed strip uses, so the two can
   never disagree. "Idle" is the honest word before anything has reported --
   green with nothing behind it would be a lie at boot. */
function railFeedHealth() {
  const chips = Array.from(document.querySelectorAll('#feedstrip-chips .chip'));
  let ok = 0, stale = 0;
  for (const el of chips) {
    if (el.dataset.state === 'ok') ok++;
    else if (el.dataset.state === 'warn' || el.dataset.state === 'bad') stale++;
  }
  const times = Object.values(feedActivity || {}).filter(Boolean);
  const newest = times.length ? Math.max(...times) : 0;
  return { ok, stale, reporting: ok + stale, newest };
}

function railStatusRender() {
  const host = document.getElementById('rs-chips');
  if (!host) return;
  const active = railActiveLayers();

  setText('rs-count', String(active.length));
  const clear = document.getElementById('rs-clear');
  if (clear) clear.disabled = active.length === 0;

  host.innerHTML = active.length
    ? active.map((l) =>
        `<button class="rs-chip" data-key="${escapeHtml(l.key)}" ` +
        `title="Switch off ${escapeHtml(l.label)}">` +
        `<span class="rs-chip-t">${escapeHtml(l.label)}</span>` +
        `<span class="rs-chip-x">&times;</span></button>`).join('')
    : '<div class="rs-none">Nothing drawing. Switch a layer on above.</div>';

  host.querySelectorAll('.rs-chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      const cb = document.querySelector(`input[data-layer="${btn.dataset.key}"]`);
      if (!cb) return;
      cb.checked = false;
      cb.dispatchEvent(new Event('change', { bubbles: true }));
    });
  });

  railStatusTick();
}

/* Split from the render so the age can count up once a second without
   rebuilding the chip list under the operator's cursor. */
function railStatusTick() {
  const h = railFeedHealth();
  const dot = document.getElementById('rs-dot');
  const txt = document.getElementById('rs-feed-t');
  const age = document.getElementById('rs-age');
  if (!dot || !txt || !age) return;

  if (!h.reporting) {
    dot.dataset.state = 'idle';
    txt.textContent = 'feeds idle';
    age.textContent = '';
    return;
  }
  dot.dataset.state = h.stale === 0 ? 'ok' : (h.stale > h.ok ? 'bad' : 'warn');
  txt.textContent = h.stale === 0
    ? `${h.ok} feeds live`
    : `${h.ok} live · ${h.stale} stale`;
  age.textContent = h.newest ? relAge(Date.now() - h.newest) : '';
}

/* Short relative age. Kept local rather than reusing the alert formatters,
   which pad to a fixed width for a column this strip does not have. */
function relAge(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.round(m / 60)}h`;
}

function initRailStatus() {
  document.getElementById('rs-clear')?.addEventListener('click', () => {
    for (const l of railActiveLayers()) {
      l.cb.checked = false;
      l.cb.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });
  // One delegated listener rather than 39 -- layers are also toggled from the
  // command palette, the alert cards and applyInitialLayerState(), and every
  // one of those paths dispatches change on the input.
  document.addEventListener('change', (e) => {
    if (!(e.target instanceof HTMLInputElement) || !e.target.dataset.layer) return;
    railStatusRender();
    // Chrome that describes a product has to stop describing it when the
    // product goes away. Both of these already knew how to hide themselves and
    // neither was being asked: switching every layer off left a REFLECTIVITY
    // colour scale and a radar transport on screen over a bare globe. The
    // rail's clear-all is what made that easy to hit.
    gfxRender();
    syncTimelineVisibility();
  });
  setInterval(railStatusTick, 1000);
  railStatusRender();
}

// ---------- "There is more below this" ---------------------------------------
//
// The rail scrolls. Nothing said so. Measured on the World division, 688px of
// content sat below the fold with the last visible row -- a country in the
// population rank -- sliced through the middle, and a screenshot found every
// pixel of the 16px scrollbar gutter at exactly the panel's own value. The bar
// was not faint, it was not painted: overlay scrollbars stay invisible until
// you are already scrolling, which is no use to someone who does not know
// there is anywhere to scroll to.
//
// So the app draws its own edges and does not rely on the browser's. Toggled
// from scroll position, not hover, so the answer is true whether or not a bar
// happens to be on screen. A ResizeObserver on the scrolling box catches the
// case that matters most: switching division swaps 1,260px of content for
// 400px and no scroll event fires.
function syncRailScrollEdges() {
  const wrap = document.getElementById('hud-scroll');
  const box = document.getElementById('hud-panes');
  if (!wrap || !box) return;
  // A sub-pixel remainder is not "more content". One row of the tightest list
  // in the rail is 28px, so 4px of slack keeps a rounding error from promising
  // something that is not there.
  const room = box.scrollHeight - box.clientHeight;
  // `room` gates BOTH edges, and it has to. Reading scrollTop on its own left a
  // stale "more above" behind: scroll World to the end, switch to a division
  // that fits, and the observation that fires as the content shrinks can still
  // see the old scrollTop while scrollHeight is already small. Nothing scrolls
  // after that, so nothing clears it, and a division with 572px of content in a
  // 572px box claimed there was more above it. If there is no room to scroll
  // there is no edge, whatever scrollTop happens to say at that instant.
  const scrollable = room > 4;
  wrap.classList.toggle('can-up', scrollable && box.scrollTop > 4);
  wrap.classList.toggle('can-down', scrollable && box.scrollTop < room - 4);
}

function initRailScrollEdges() {
  const box = document.getElementById('hud-panes');
  if (!box) return;
  box.addEventListener('scroll', syncRailScrollEdges, { passive: true });
  // The content's height changes without a scroll event on every division
  // switch, every <details> toggle, and every feed that lands a new row.
  if (window.ResizeObserver) {
    const ro = new ResizeObserver(syncRailScrollEdges);
    ro.observe(box);
    for (const p of box.children) ro.observe(p);
  }
  window.addEventListener('resize', syncRailScrollEdges);

  // Backstop, and it is not belt-and-braces -- it is the third time this app
  // has been caught by the same thing. A CSS transition that gated visibility
  // never advanced; a ResizeObserver landed 450-600ms late; and the scroll
  // event above was measured arriving after more than a second, or not at all,
  // on a busy frame. Each time the symptom was chrome asserting something that
  // was no longer true, which is the failure Don described as the app not being
  // readable. Two integer reads and two class toggles, 2.5 times a second, on a
  // globe that is in explicit-render mode and otherwise idle: the cost is
  // nothing next to being wrong for a second at a time.
  setInterval(syncRailScrollEdges, 400);
  syncRailScrollEdges();
}

// ---------- The bottom sheet -------------------------------------------------
//
// On a phone the rail is a sheet over the map, at one of three detents. The
// detent is a class on <body>, so CSS owns the geometry and this owns nothing
// but which of three states we are in -- there is no continuously tracked
// offset to get stuck at a wrong value, and no transition anywhere that gates
// whether a control exists.
//
// Drag is deliberately thin: a pointerdown on the handle, a total dy at
// pointerup, and a threshold. Following the finger pixel-for-pixel would mean
// writing transform on every pointermove, which is the frame budget the globe
// is already using, and it would put the sheet's position back under an
// animation clock this app has watched stall three times.

const SHEET = { detents: ['peek', 'half', 'full'], at: 0, y0: 0, t0: 0,
                dragging: false, lastUp: 0 };

function sheetIsPhone() {
  return isPhone();
}

function sheetGo(i) {
  SHEET.at = Math.max(0, Math.min(SHEET.detents.length - 1, i));
  // See the capture listener in initSheet(): the sheet has just moved several
  // hundred pixels, and any click still in flight was aimed at where things
  // used to be.
  SHEET.guardUntil = performance.now() + 350;
  const name = SHEET.detents[SHEET.at];
  document.body.classList.toggle('sheet-half', name === 'half');
  document.body.classList.toggle('sheet-full', name === 'full');
  const head = document.getElementById('rail-head');
  if (head) head.setAttribute('aria-expanded', String(name !== 'peek'));
  // The sheet covers a different amount of map at each detent, and the scroll
  // edges are computed from a box whose height just changed.
  syncRailScrollEdges();
}

function initSheet() {
  const head = document.getElementById('rail-head');
  if (!head) return;

  head.setAttribute('role', 'button');
  head.setAttribute('tabindex', '0');
  head.setAttribute('aria-controls', 'hud-panes');
  head.setAttribute('aria-label', 'Expand or collapse the panel');

  // Tap the handle to step up, and from the top back down to peek. A single
  // affordance that cycles beats two arrows nobody can hit on a phone.
  const step = () => sheetGo(SHEET.at >= SHEET.detents.length - 1 ? 0 : SHEET.at + 1);

  head.addEventListener('pointerdown', (e) => {
    if (!sheetIsPhone()) return;
    // The icon buttons in the head are their own targets, not sheet handles.
    if (e.target.closest('button, a, input')) return;
    SHEET.dragging = true;
    SHEET.y0 = e.clientY;
    SHEET.t0 = e.timeStamp;
    head.setPointerCapture?.(e.pointerId);
  });

  head.addEventListener('pointerup', (e) => {
    if (!SHEET.dragging) return;
    SHEET.dragging = false;
    head.releasePointerCapture?.(e.pointerId);

    // One tap, one gesture. A touch on a phone fires the pointer pair TWICE --
    // once for the touch itself, then again from the compatibility mouse events
    // the browser synthesises for pages that only listen for mouse. Traced with
    // a spy on sheetGo, a single tap logged `2` and then `1`: the sheet opened
    // to full and the phantom second gesture immediately dragged it back to
    // half, so it looked as though it simply refused to open all the way.
    //
    // Guarding on pointerType is not enough on its own, because the synthetic
    // events report `mouse` on some engines and `touch` on others. A time gate
    // is what the two have in common: they arrive in the same few
    // milliseconds, and no human taps a sheet handle twice in 400ms meaning it.
    if (e.timeStamp - (SHEET.lastUp || 0) < 400) return;
    SHEET.lastUp = e.timeStamp;

    const dy = e.clientY - SHEET.y0;
    const dt = Math.max(1, e.timeStamp - SHEET.t0);
    // A flick is a short gesture with speed; a drag is distance. Either can
    // move one detent, so a fast small swipe works and so does a slow long one.
    const flick = Math.abs(dy) / dt > 0.5 && Math.abs(dy) > 12;
    if (flick || Math.abs(dy) > 40) sheetGo(SHEET.at + (dy < 0 ? 1 : -1));
    else step();
  });

  head.addEventListener('keydown', (e) => {
    if (!sheetIsPhone()) return;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); step(); }
    else if (e.key === 'ArrowUp')   { e.preventDefault(); sheetGo(SHEET.at + 1); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); sheetGo(SHEET.at - 1); }
  });

  // There was an auto-collapse here: switch a layer on and the sheet dropped to
  // half to show you the map. It read well and it caused two separate bugs --
  // synthetic change events from feeds yanking the sheet shut under the finger
  // that had just opened it, and then the phantom click above toggling a layer
  // and collapsing the sheet in one gesture. Both were fixable, and it was
  // still the wrong feature: a panel that moves when you did not move it is
  // exactly the kind of thing that makes an app feel like it is fighting you.
  // The sheet moves when the operator moves it, and not otherwise.

  // Rotating the phone changes which layout applies and how tall the sheet is.
  window.addEventListener('resize', () => {
    if (!sheetIsPhone() && SHEET.at !== 0) sheetGo(0);
    syncRailScrollEdges();
  });

  sheetGo(0);
}

// ---------- Command palette --------------------------------------------------
//
// Everything in this app is two to four clicks deep: pick a tab, pick a
// division, find the switch. That is fine when you know where a thing lives
// and useless when you only know its name. Ctrl+K searches every reachable
// control by name and runs it.
//
// The index is rebuilt from the live DOM on every open rather than kept as a
// parallel list. A hard-coded index would drift the first time a layer moved
// division, and the palette would then offer a control that is not there --
// the exact failure the `#layers` selectors already cost us once.

const PAL = { open: false, items: [], view: [], sel: 0 };

function palBuild() {
  const items = [];
  const add = (kind, label, hint, run, extra = {}) =>
    items.push({ kind, label, hint, run, ...extra });

  // Tabs and divisions.
  document.querySelectorAll('.hud-tab').forEach((t) => {
    if (t.dataset.tab === 'data') return;          // reached via its divisions
    add('Go to', t.textContent.trim(), 'tab', () => t.click());
  });
  document.querySelectorAll('#wx-modes .chip').forEach((c) => {
    add('Go to', c.textContent.trim(), 'division', () => {
      document.querySelector('.hud-tab[data-tab="data"]')?.click();
      c.click();
    });
  });

  // Dashboards. The world board predates the dashboard shell and opens through
  // its own function, so it is listed explicitly rather than silently missing.
  document.querySelectorAll('[data-dash]').forEach((b) => {
    const name = b.textContent.replace(/^Open\s+/i, '').replace(/\s+dashboard$/i, '').trim();
    if (items.some((i) => i.hint === 'dashboard' && i.label.toLowerCase() === name.toLowerCase())) return;
    add('Open', name, 'dashboard', () => dashOpen(b.dataset.dash));
  });
  add('Open', 'world population', 'dashboard', () => openWorldDash());

  // Layers. The verb reflects the current state, so the row reads as the thing
  // it will do rather than as a name you have to reason about.
  document.querySelectorAll('input[data-layer]').forEach((cb) => {
    if (cb.disabled) return;
    const label = (cb.closest('.sw')?.querySelector('.sw-l')?.textContent || cb.dataset.layer).trim();
    add(cb.checked ? 'Switch off' : 'Switch on', label, 'layer', () => {
      cb.checked = !cb.checked;
      cb.dispatchEvent(new Event('change', { bubbles: true }));
    }, { on: cb.checked });
  });

  // Radar products. These are buttons, not layers, so the layer sweep above
  // misses them -- and "storm relative velocity" is exactly the sort of name
  // someone reaches for by typing rather than by hunting.
  document.querySelectorAll('.wf-item[data-product]').forEach((b) => {
    add('Product', b.textContent.trim(), 'radar', () => {
      document.querySelector('.hud-tab[data-tab="data"]')?.click();
      document.querySelector('#wx-modes .chip[data-mode="radar"]')?.click();
      b.click();
    });
  });

  // Base maps.
  document.querySelectorAll('.theme-btn[data-theme]').forEach((b) => {
    add('Base map', b.title || b.dataset.theme, b.dataset.theme, () => b.click());
  });

  // Radar sites, read from the select the site layer already drives.
  document.querySelectorAll('#radar-site option').forEach((o) => {
    if (!o.value) return;
    add('Radar site', o.textContent.trim(), o.value, () => {
      const sel = document.getElementById('radar-site');
      const site = document.querySelector('input[data-layer="radar_site"]');
      if (site && !site.checked) {
        site.checked = true;
        site.dispatchEvent(new Event('change', { bubbles: true }));
      }
      if (sel) { sel.value = o.value; sel.dispatchEvent(new Event('change', { bubbles: true })); }
    });
  });

  // Saved camera presets.
  for (const p of loadPresets()) {
    add('Fly to', p.name, 'saved view', () => flyToPreset(p));
  }

  // Actions.
  add('Do', 'presentation mode', 'hide the chrome',
      () => document.getElementById('present-btn')?.click());
  add('Do', 'collapse the panel', 'rail',
      () => document.getElementById('rail-collapse')?.click());
  add('Do', 'settings', 'modal',
      () => document.getElementById('settings-btn')?.click());
  document.querySelectorAll('#panebar .seg-b').forEach((b) => {
    add('Do', `${b.dataset.panes} pane`, 'layout', () => b.click());
  });
  add('Do', 'clear every layer', 'switch it all off',
      () => document.getElementById('rs-clear')?.click());
  add('Fly to', 'North America', 'home view', () => {
    _lastInteractionAt = performance.now();
    viewer?.camera.flyTo({ destination: naFrameDestination(), duration: 1.6 });
  });

  return items;
}

/* Subsequence match, the same rule a file finder uses: "srv" reaches "Storm
   Relative Velocity". Scored so a prefix beats a word start beats a scattered
   hit, otherwise "on" would rank forty layers above the one you typed. */
function palScore(item, q) {
  if (!q) return 1;
  const lbl = item.label.toLowerCase();
  if (lbl.startsWith(q)) return 1000 - lbl.length;
  // A hit in the name beats a hit in the category. Without the split, typing
  // "re" ranked "presentation mode / hide the chrome" above "Base Reflectivity"
  // because the match landed in the trailing hint text.
  const inLabel = lbl.indexOf(q);
  if (inLabel >= 0) return 700 - inLabel;
  const at = String(item.hint || '').toLowerCase().indexOf(q);
  if (at >= 0) return 500 - at;
  // Subsequence over the label's word initials, then over the label itself.
  const initials = lbl.split(/[\s/(-]+/).map((w) => w[0] || '').join('');
  if (initials.includes(q)) return 400;
  let i = 0;
  for (const ch of lbl) if (ch === q[i]) i++;
  return i === q.length ? 100 : 0;
}

function palRender() {
  const q = (document.getElementById('pal-q')?.value || '').trim().toLowerCase();
  PAL.view = PAL.items
    .map((it) => ({ it, s: palScore(it, q) }))
    .filter((r) => r.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, 40)
    .map((r) => r.it);

  if (PAL.sel >= PAL.view.length) PAL.sel = Math.max(0, PAL.view.length - 1);

  const list = document.getElementById('pal-list');
  if (!list) return;
  list.innerHTML = PAL.view.length
    ? PAL.view.map((it, i) =>
        `<li class="pal-row${i === PAL.sel ? ' is-sel' : ''}" role="option" data-i="${i}"` +
        `${i === PAL.sel ? ' aria-selected="true"' : ''}>` +
        `<span class="pal-kind">${escapeHtml(it.kind)}</span>` +
        `<span class="pal-label">${escapeHtml(it.label)}</span>` +
        `<span class="pal-hint">${escapeHtml(it.hint || '')}</span></li>`).join('')
    : '<li class="pal-empty">Nothing matches that.</li>';
  setText('pal-n', PAL.view.length ? `${PAL.view.length}` : '');

  list.querySelectorAll('.pal-row').forEach((row) => {
    row.addEventListener('mousemove', () => {
      const i = Number(row.dataset.i);
      if (i !== PAL.sel) { PAL.sel = i; palRender(); }
    });
    row.addEventListener('click', () => palRun(Number(row.dataset.i)));
  });
  list.querySelector('.is-sel')?.scrollIntoView({ block: 'nearest' });
}

function palOpen() {
  const el = document.getElementById('palette');
  if (!el) return;
  // The palette is the way OUT of anywhere, so it takes the screen. Opening it
  // over Settings previously left it rendering behind the modal.
  document.getElementById('settings-overlay')?.classList.add('hidden');
  PAL.items = palBuild();
  PAL.sel = 0;
  PAL.open = true;
  el.classList.remove('hidden');
  const q = document.getElementById('pal-q');
  if (q) { q.value = ''; q.focus(); }
  palRender();
}

function palClose() {
  PAL.open = false;
  document.getElementById('palette')?.classList.add('hidden');
}

function palRun(i) {
  const it = PAL.view[i];
  if (!it) return;
  palClose();
  try { it.run(); } catch (err) { console.warn('palette action failed:', err); }
}

function initCommandPalette() {
  const el = document.getElementById('palette');
  if (!el) return;

  document.getElementById('palette-btn')?.addEventListener('click', palOpen);
  document.getElementById('topbar-search')?.addEventListener('click', palOpen);
  el.addEventListener('mousedown', (e) => { if (e.target === el) palClose(); });

  document.getElementById('pal-q')?.addEventListener('input', () => { PAL.sel = 0; palRender(); });

  document.addEventListener('keydown', (e) => {
    // Open. Ctrl+K is the near-universal binding; Cmd+K for anyone on a Mac.
    if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault();
      PAL.open ? palClose() : palOpen();
      return;
    }
    if (!PAL.open) return;
    // Capture + stopPropagation, because Escape is already spoken for by the
    // dashboard and by presentation mode. Without it, closing the palette over
    // an open dashboard would close the dashboard too.
    const eat = () => { e.preventDefault(); e.stopPropagation(); };
    if (e.key === 'Escape')         { eat(); palClose(); }
    else if (e.key === 'ArrowDown') { eat(); PAL.sel = Math.min(PAL.sel + 1, PAL.view.length - 1); palRender(); }
    else if (e.key === 'ArrowUp')   { eat(); PAL.sel = Math.max(PAL.sel - 1, 0); palRender(); }
    else if (e.key === 'Enter')     { eat(); palRun(PAL.sel); }
  }, true);
}

// ---------- boot -------------------------------------------------------------

function initWeatherfrontShell() {
  initRailShell();
  initRadarProductList();
  initMappingMirrors();
  initAlertsTab();
  initDashboards();
  initRailStatus();
  initRailScrollEdges();
  initSheet();
  initCommandPalette();
  syncRailTitle();
}
