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
};

const CATEGORY = {
  planes: 'air', satellites: 'air', airports: 'air', tfrs: 'air',
  ships: 'sea', hurricanes: 'sea',
  quakes: 'earth', volcanoes: 'earth', fires: 'earth',
  radar: 'weather', aurora: 'weather', clouds: 'weather', terminator: 'weather',
  launches: 'space',
  tsunamis: 'alerts', severe: 'alerts', news: 'alerts',
  cables: 'reference',
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
  spc: 'SPC OUTLOOK', model: 'MODEL FIELD', aqi: 'AIR QUALITY',
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

let viewer;
const dataSources = {};
const entitiesByLayer = {};
const satelliteRecords = new Map();
let satelliteTickHandle = null;
let countdownTickHandle = null;
let radarLayer = null, auroraLayer = null, cloudsLayer = null;
let radarMeta = null, auroraMeta = null;
let countriesDS = null, statesDS = null, airspaceDS = null, citiesDS = null;
let countriesBuilt = false, statesBuilt = false, airspaceBuilt = false, citiesBuilt = false;
const feedActivity = {};   // layer -> last update timestamp (ms)
const recentEvents = [];   // ticker entries (newest first)
const TICKER_MAX = 6;

// ---------- Bootstrap --------------------------------------------------------

(async function main() {
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
  document.querySelectorAll('input[data-layer]').forEach((cb) => {
    if (cb.disabled) return;
    cb.dispatchEvent(new Event('change'));
  });
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
    geocoder: false, homeButton: false, sceneModePicker: false,
    timeline: false, animation: false, fullscreenButton: false,
    navigationHelpButton: false, selectionIndicator: false, infoBox: false,
    creditContainer: document.createElement('div'),
  });

  // Test-only handle so Playwright (and the dev console) can drive the camera
  // and inspect data sources during self-test without re-plumbing the closure.
  window.__graticule_viewer = viewer;

  viewer.imageryLayers.removeAll();
  // Imagery base is settings-driven now (Satellite / Streets / Topo / Night).
  // applyImageryBase honors settings.imageryBase, falls back to satellite, and
  // tracks the layer so the picker can swap it later.
  await applyImageryBase(settings.imageryBase || 'satellite');
  // Allow Cesium to over-zoom past native level (interpolated, lossy but the
  // user sees something instead of a black tile).
  viewer.scene.maximumScreenSpaceError = 1.5;

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

  viewer.camera.setView({
    destination: Cesium.Cartesian3.fromDegrees(NA_HOME.lon, NA_HOME.lat, NA_HOME.alt),
  });
  // Allow the camera to descend into the surface band where 3D buildings live
  viewer.scene.screenSpaceCameraController.minimumZoomDistance = 50;

  // Click → panel + ripple + history push
  const click = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
  click.setInputAction((c) => {
    const picked = viewer.scene.pick(c.position);
    if (Cesium.defined(picked) && picked.id) {
      showPanel(picked.id);
      pushHistory(picked.id);
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
      else if (layer === 'terminator') toggleTerminator(on);
      else if (layer === 'parcels_us') toggleParcelsUS(on);
      else if (layer === 'parcels_wa') toggleParcelsWA(on);
      else if (layer === 'countries')  toggleCountries(on);
      else if (layer === 'states')     toggleStates(on);
      else if (layer === 'cities')     toggleCities(on);
      else if (layer === 'airspace')   toggleAirspace(on);
      else if (dataSources[layer])     fadeDataSource(dataSources[layer], on ? 'in' : 'out');
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

function collectAlerts() {
  // Returns array of {kind, id, tag, text, meta, sev, sortKey, entity}
  const out = [];
  const now = Date.now();

  const layers = ['tsunamis','severe','hurricanes','tfrs','volcanoes','news'];
  for (const layer of layers) {
    const ents = entitiesByLayer[layer]; if (!ents) continue;
    for (const ent of ents.values()) {
      const p = ent.properties.getValue ? ent.properties.getValue() : ent.properties;
      if (!p) continue;
      if (layer === 'volcanoes' && p.active !== true) continue;
      out.push(buildAlertRow(layer, p, ent, now));
    }
  }

  // Quakes: only M >= 4 within 24h
  const qents = entitiesByLayer.quakes;
  if (qents) for (const ent of qents.values()) {
    const p = ent.properties.getValue ? ent.properties.getValue() : ent.properties;
    if (!p || typeof p.mag !== 'number' || p.mag < 4) continue;
    const ageH = p.time ? ((now - p.time) / 3.6e6) : 999;
    if (ageH > 24) continue;
    out.push(buildAlertRow('quakes', p, ent, now));
  }

  // Launches: within ±3h of NET
  const lents = entitiesByLayer.launches;
  if (lents) for (const ent of lents.values()) {
    const p = ent.properties.getValue ? ent.properties.getValue() : ent.properties;
    if (!p || !p.net) continue;
    const dt = (Date.parse(p.net) - now) / 3.6e6;
    if (!isFinite(dt) || Math.abs(dt) > 3) continue;
    out.push(buildAlertRow('launches', p, ent, now));
  }

  return out;
}

function buildAlertRow(kind, p, ent, now) {
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
  return { kind, id: p.id, tag, text, meta, sev, sortKey, entity: ent };
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
    li.addEventListener('click', () => {
      flyToEntity(a.entity);
      showPanel(a.entity);
    });
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

function refreshFeedChips() {
  const now = Date.now();
  document.querySelectorAll('.chip').forEach((el) => {
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
  const chip = document.querySelector(`.chip[data-feed="${layer}"]`);
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
  const totals = { air: 0, sea: 0, earth: 0, weather: 0, space: 0, alerts: 0, reference: 0, land: 0 };
  for (const [layer, cat] of Object.entries(CATEGORY)) {
    const cb = document.querySelector(`input[data-layer="${layer}"]`);
    if (!cb || !cb.checked) continue;
    if (layer === 'satellites')                  totals[cat] += satelliteRecords.size;
    else if (entitiesByLayer[layer])             totals[cat] += entitiesByLayer[layer].size;
    else if (layer === 'radar' && radarLayer)    totals[cat] += 1;
    else if (layer === 'aurora' && auroraLayer)  totals[cat] += 1;
    else if (layer === 'parcels_us' && parcelsUSLayer) totals[cat] += 1;
    else if (layer === 'parcels_wa' && parcelsWADS)    totals[cat] += parcelsWADS.entities.values.length;
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
  if (layer === 'satellites') {
    rebuildSatellites(entries);
    setCount('satellites', satelliteRecords.size);
    return;
  }
  const ds = dataSources[layer];
  if (!ds) return;
  ds.entities.removeAll();
  entitiesByLayer[layer].clear();
  for (const [id, data] of Object.entries(entries)) upsertEntity(layer, id, data);
  setCount(layer, entitiesByLayer[layer].size);

  // Live ticker — only push entries that are NEW since last reset (delta-aware).
  pushDeltasToTicker(layer, entries);
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

function upsertEntity(layer, id, data) {
  if (data.lat == null || data.lon == null) return;
  const ds = dataSources[layer];
  if (!ds) return;
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
  fadeDataSource(citiesDS, on ? 'in' : 'out');
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
          // Hide when very close (< 200 km) and very far (> 18 Mm)
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(2e5, 1.8e7),
          // Soft fade-in over 500 km → 1.2 Mm
          translucencyByDistance: new Cesium.NearFarScalar(5e5, 0.0, 1.2e6, 1.0),
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

    cityRecords = [];
    let added = 0;
    for (const f of feats) {
      const c = f.geometry?.coordinates;
      if (!c) continue;
      if (!Number.isFinite(c[0]) || !Number.isFinite(c[1])) continue;
      const p = f.properties || {};
      const sr = p.scalerank ?? 6;
      const farM = _cityMaxDist(sr);
      // Lower rank = larger label; cap range to keep things readable
      const fontPx = sr <= 1 ? 12 : sr <= 3 ? 11 : sr <= 6 ? 10 : 9;
      // Dot size scales gently with rank too
      const dotPx = sr <= 1 ? 4.5 : sr <= 4 ? 3.5 : 2.5;
      // Fade-in distance: the city is fully opaque once the camera is inside
      // ~35% of its visibility range and fades to nothing by ~60%.
      //
      // NearFarScalar requires far > near. These were previously passed as
      // (0.6·farM → 0, 0.35·farM → 1), i.e. far < near, which Cesium cannot
      // interpolate: it yields a non-finite translucency, corrupts the frustum
      // computation, and kills the whole scene with "Invalid array length"
      // from createPotentiallyVisibleSet. Enabling Cities alone was enough to
      // stop rendering.
      const fadeFull  = Math.min(farM, farM * 0.35);   // nearer  → opaque
      const fadeStart = Math.min(farM, farM * 0.6);    // further → transparent
      citiesDS.entities.add({
        position: Cesium.Cartesian3.fromDegrees(c[0], c[1], 0),
        point: {
          pixelSize: dotPx,
          color: dotColor,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 0.5,
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, farM),
          translucencyByDistance: new Cesium.NearFarScalar(fadeFull, 1.0, fadeStart, 0.0),
        },
        label: {
          // Text is assigned by relabelCities(); leaving it empty here keeps
          // the glyph atlas within its limit.
          text: '',
          font: `500 ${fontPx}px "Inter", system-ui, sans-serif`,
          fillColor: labelFill,
          outlineColor: labelOutline,
          outlineWidth: 2.5,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          horizontalOrigin: Cesium.HorizontalOrigin.LEFT,
          verticalOrigin: Cesium.VerticalOrigin.CENTER,
          pixelOffset: new Cesium.Cartesian2(6, 0),
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, farM),
          translucencyByDistance: new Cesium.NearFarScalar(fadeFull, 1.0, fadeStart, 0.0),
          // Depth-test ON so cities on the far side of the globe are occluded.
        },
        properties: { kind: 'city_label', ...p },
      });
      cityRecords.push({
        entity: citiesDS.entities.values[citiesDS.entities.values.length - 1],
        name: p.name || '', farM,
      });
      added++;
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
    setCount('cities', added);
    updateCategoryCounts();
    console.log(`Built ${added} city points (labels capped at ${CITY_LABEL_CAP})`);
  } catch (e) {
    console.warn('Cities failed to load:', e);
    citiesBuilt = false;
  }
}

// Assign label text to the most important cities that are in range at the
// current camera altitude, and clear the rest. Keeps the live label count
// under the glyph-atlas ceiling while still revealing smaller towns as you
// zoom in — which is what the per-entity distanceDisplayCondition implies but
// cannot deliver on its own.
const CITY_LABEL_CAP = 900;
let cityRecords = [];

function relabelCities() {
  if (!citiesDS || !cityRecords.length) return;
  let camHeight = Infinity;
  try {
    const carto = Cesium.Cartographic.fromCartesian(viewer.camera.position);
    if (carto) camHeight = carto.height;
  } catch { /* keep Infinity: falls back to the highest-rank cities only */ }

  let shown = 0;
  for (const rec of cityRecords) {
    const inRange = camHeight <= rec.farM;
    const want = inRange && shown < CITY_LABEL_CAP ? rec.name : '';
    if (want) shown++;
    // Only touch Cesium when the value actually changes; assigning text is
    // what triggers glyph work.
    if (rec.entity.label.text !== want) rec.entity.label.text = want;
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
  else if (kind === 'metar')      { title = props.id || 'Station'; subtitle = props.name || 'Surface observation'; }
  else if (kind === 'lsr')        { title = `${props.type}${props.magnitude ? ` ${props.magnitude}` : ''}`; subtitle = `${props.city || ''}${props.state ? `, ${props.state}` : ''}`; }
  else if (kind === 'warning')    { title = props.event || 'Alert'; subtitle = (props.areaDesc || '').split(';').slice(0, 3).join(', '); }
  else if (kind === 'spc')        { title = `SPC ${props.label || 'Outlook'}`; subtitle = SPC_RISK_LABEL[props.label] || 'Convective outlook'; }
  else if (kind === 'model')      { title = `${props.value}${props.unit || ''}`; subtitle = FIELD_DEFS[props.field] ? FIELD_DEFS[props.field].label : 'Model field'; }
  else if (kind === 'aqi')        { title = `AQI ${props.value}`; subtitle = aqiCategory(props.value); }
  else                            { title = entity.id; subtitle = ''; }

  document.getElementById('panel-kind').textContent = KIND_LABEL[kind] || (kind || '').toUpperCase();
  document.getElementById('panel-title').textContent = title;
  document.getElementById('panel-subtitle').textContent = subtitle;

  const display = { ...props };
  delete display.kind;
  if (display.ts) display.last_seen = new Date(display.ts * 1000).toISOString();
  document.getElementById('panel-body').textContent = JSON.stringify(display, null, 2);
  document.getElementById('panel').classList.remove('hidden');
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
  checkbox('lens-flare',      'lensFlare',      applyLensFlare);
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

  applyLensFlare(settings.lensFlare);

  // 2. Night lights ride on the same lighting model.
  toggleNightLights(!!settings.nightLights);

  // Keep the header's sun/moon readout honest — recompute on a slow tick
  // rather than per-frame; the subsolar point moves 0.25°/minute.
  setInterval(updateCelestialReadout, 30_000);
  updateCelestialReadout();
}

let _lensFlareStage = null;
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
function gradeBaseImagery() {
  if (!baseImageryLayer) return;
  const photographic = settings.imageryBase !== 'streets' && settings.imageryBase !== 'topo';
  baseImageryLayer.contrast   = photographic ? 1.40 : 1.0;
  baseImageryLayer.saturation = photographic ? 1.25 : 1.0;
  baseImageryLayer.gamma      = photographic ? 0.95 : 1.0;
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

function applyPerfPreset(preset) {
  if (!viewer) return;
  // Tunes Cesium globe SSE + cluster pixelRange. Layer-specific entity caps
  // would require backend cooperation — for now we tune just the renderer.
  if (preset === 'low') {
    viewer.scene.maximumScreenSpaceError = 4;
  } else if (preset === 'balanced') {
    viewer.scene.maximumScreenSpaceError = 2.5;
  } else {
    viewer.scene.maximumScreenSpaceError = 1.5;
  }
  viewer.scene.requestRender();
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
      // The timeline only makes sense against an animatable imagery layer.
      syncTimelineVisibility();
    });
  });

  // Restore last tab.
  let saved = null;
  try { saved = localStorage.getItem('graticule.tab'); } catch {}
  if (saved) {
    const t = tabs.find((x) => x.dataset.tab === saved);
    if (t) t.click();
  }

  // Mode chips inside the weather tab.
  const chips  = Array.from(document.querySelectorAll('#wx-modes .chip'));
  const bodies = Array.from(document.querySelectorAll('[data-mode-body]'));
  chips.forEach((chip) => {
    chip.addEventListener('click', () => {
      chips.forEach((c) => c.classList.toggle('is-active', c === chip));
      bodies.forEach((b) => b.classList.toggle('is-active', b.dataset.modeBody === chip.dataset.mode));
      applyLegendFor(chip.dataset.mode);
    });
  });
}

// ---------- Radar / satellite timeline --------------------------------------
//
// RainViewer publishes both a past series and a nowcast series in one meta
// blob. The survey singled out weather.com for making past-vs-future
// ambiguous, so we keep them on one track with an explicit NOW marker and
// label every frame with a relative offset.

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
}

function syncTimelineVisibility() {
  const tl = document.getElementById('timeline');
  const fs = document.getElementById('frame-stamp');
  const on = isLayerOn('radar') && TL.frames.length > 1;
  if (tl) tl.classList.toggle('hidden', !on);
  if (fs) fs.classList.toggle('hidden', !on);
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
    for (const [idx, l] of TL.layers) l.alpha = idx === TL.index ? Number(settings.opRadar) : 0;
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
  const fsT = document.getElementById('fs-time');
  const fsK = document.getElementById('fs-kind');
  if (fsT) fsT.textContent = `${hh}:${mm} UTC`;
  if (fsK) fsK.textContent = frame.kind === 'forecast' ? 'RADAR · FORECAST' : 'RADAR · OBSERVED';

  viewer.scene.requestRender();
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
function syncControlAvailability() {
  document.querySelectorAll('.ctl[data-requires]').forEach((row) => {
    const cb = document.querySelector(`input[data-layer="${row.dataset.requires}"]`);
    const live = !!(cb && cb.checked);
    row.classList.toggle('is-off', !live);
    row.querySelectorAll('select, input').forEach((el) => { el.disabled = !live; });
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
  document.getElementById('lg-bar').style.background =
    `linear-gradient(90deg, ${scale.stops.join(', ')})`;
  document.getElementById('lg-ticks').innerHTML =
    scale.ticks.map((t) => `<span>${t}</span>`).join('');
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

// Vital rates, UN WPP 2024: ~4.2 births and ~2.5 deaths per second worldwide.
const BIRTHS_PER_SEC = 4.24;
const DEATHS_PER_SEC = 2.51;

// Compound the annual rate over elapsed years since the epoch.
function project(base, rate, nowSec) {
  const years = (nowSec - WPP_EPOCH) / 31_556_952;   // mean tropical year
  return base * Math.pow(1 + rate, years);
}

function fmtInt(n) { return Math.floor(n).toLocaleString('en-US'); }

function secondsIntoUtcDay(d) {
  return d.getUTCHours() * 3600 + d.getUTCMinutes() * 60 + d.getUTCSeconds();
}

let _worldTimer = null;
function initWorldPane() {
  renderWorldStatic();
  if (_worldTimer) clearInterval(_worldTimer);
  _worldTimer = setInterval(updateWorldPane, 1000);
  updateWorldPane();
}

function renderWorldStatic() {
  const src = document.getElementById('wp-src');
  if (src) {
    src.textContent =
      'Projected from UN World Population Prospects 2024 (medium variant), ' +
      'mid-2025 baseline. Counters interpolate the published growth rate — ' +
      'a projection, not a live census.';
  }
}

function updateWorldPane() {
  // Only compute while the pane is on screen; this ticks every second.
  const pane = document.querySelector('.hud-pane[data-pane="world"]');
  if (!pane || !pane.classList.contains('is-active')) return;

  const now = Date.now() / 1000;
  const d   = new Date();
  const dayS = secondsIntoUtcDay(d);

  const total = project(WORLD_BASE.pop, WORLD_BASE.rate, now);
  setText('wp-total', fmtInt(total));

  const births = dayS * BIRTHS_PER_SEC;
  const deaths = dayS * DEATHS_PER_SEC;
  setText('wp-births', fmtInt(births));
  setText('wp-deaths', fmtInt(deaths));
  setText('wp-growth', fmtInt(births - deaths));

  renderRank('wp-continents', CONTINENTS, now);
  renderRank('wp-countries',  COUNTRIES,  now);
  renderMilestone(total);
}

function setText(id, txt) {
  const el = document.getElementById(id);
  if (el && el.textContent !== txt) el.textContent = txt;
}

function renderRank(containerId, rows, nowSec) {
  const el = document.getElementById(containerId);
  if (!el) return;
  const html = rows.map((r, i) => {
    const [name, base, rate] = r;
    const v = project(base, rate, nowSec);
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

// Iowa State Mesonet serves per-site NEXRAD as public XYZ tiles — no key, and
// separate layers for reflectivity (N0Q) and velocity (N0U).
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
  const kind = (prod && prod.value) === 'velocity' ? 'N0U' : 'N0Q';

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

  const stamp = document.getElementById('fs-kind');
  if (stamp && isLayerOn('radar_site')) {
    stamp.textContent = `${site} · ${kind === 'N0U' ? 'VELOCITY' : 'REFLECTIVITY'}`;
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
  if (!modelDS || !modelDS.show || _modelBusy) return;
  _modelBusy = true;
  const noteEl = document.getElementById('model-note');
  try {
    const modelKey = valueOf('model-name', 'gfs');
    const fieldKey = valueOf('model-field', 'temperature_2m');
    const def = FIELD_DEFS[fieldKey];
    const pts = viewGrid();
    const lat = pts.map((p) => p[0]).join(',');
    const lon = pts.map((p) => p[1]).join(',');

    const params = new URLSearchParams({
      latitude: lat, longitude: lon,
      current: fieldKey,
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

    modelDS.entities.removeAll();
    let shown = 0;
    for (const d of data) {
      const v = d && d.current ? d.current[fieldKey] : null;
      if (v == null) continue;
      // Open-Meteo can return an error object without coordinates for a point
      // it rejects. fromDegrees(undefined, undefined) yields a NaN position,
      // which corrupts Cesium's frustum maths and kills the whole scene with
      // "Invalid array length" out of createPotentiallyVisibleSet.
      if (!Number.isFinite(d.longitude) || !Number.isFinite(d.latitude)) continue;
      modelDS.entities.add({
        position: Cesium.Cartesian3.fromDegrees(d.longitude, d.latitude),
        point: {
          pixelSize: 16,
          color: rampColor(def.stops, v).withAlpha(0.55),
          outlineWidth: 0,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: {
          text: fieldKey === 'precipitation' ? v.toFixed(2) : String(Math.round(v)),
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
      noteEl.textContent =
        `${def.label} · ${modelKey.toUpperCase()} · ${shown} points. Re-samples on view change.`;
    }
    viewer.scene.requestRender();
  } catch (err) {
    if (noteEl) noteEl.textContent = `Model field unavailable: ${err.message}`;
  } finally {
    _modelBusy = false;
  }
}

function applyLegendForField(def) {
  const el = document.getElementById('legend');
  if (!el || !def) return;
  el.classList.remove('hidden');
  document.getElementById('lg-title').textContent = def.legend;
  document.getElementById('lg-unit').textContent  = def.unit;
  document.getElementById('lg-bar').style.background =
    `linear-gradient(90deg, ${def.stops.map((s) => s[1]).join(', ')})`;
  document.getElementById('lg-ticks').innerHTML =
    def.ticks.map((t) => `<span>${t}</span>`).join('');
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

const WARN_STYLE = {
  'Tornado Warning':            { c: '#ef4444', p: 100 },
  'Severe Thunderstorm Warning':{ c: '#f59e0b', p: 90 },
  'Flash Flood Warning':        { c: '#22c55e', p: 85 },
  'Flood Warning':              { c: '#16a34a', p: 70 },
  'Winter Storm Warning':       { c: '#60a5fa', p: 65 },
  'Blizzard Warning':           { c: '#a78bfa', p: 66 },
  'High Wind Warning':          { c: '#fbbf24', p: 60 },
  'Special Marine Warning':     { c: '#f0abfc', p: 55 },
  'Tornado Watch':              { c: '#dc2626', p: 50 },
  'Severe Thunderstorm Watch':  { c: '#fb923c', p: 45 },
};

function warnStyle(evt) {
  if (WARN_STYLE[evt]) return WARN_STYLE[evt];
  if (/Warning/i.test(evt))  return { c: '#f87171', p: 40 };
  if (/Watch/i.test(evt))    return { c: '#facc15', p: 30 };
  if (/Advisory/i.test(evt)) return { c: '#94a3b8', p: 20 };
  return { c: '#64748b', p: 10 };
}

function toggleWarnings(on) {
  if (!warnDS) {
    warnDS = new Cesium.CustomDataSource('warnings');
    viewer.dataSources.add(warnDS);
  }
  warnDS.show = !!on;
  if (on) refreshWarnings();
}

async function refreshWarnings() {
  if (!warnDS || !warnDS.show) return;
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
    return;
  }

  warnFeatures.sort((a, b) =>
    warnStyle(b.properties.event).p - warnStyle(a.properties.event).p);

  warnDS.entities.removeAll();
  for (const f of warnFeatures) {
    if (!f.geometry) continue;               // zone-only alert: card, no polygon
    addWarnGeometry(f, warnStyle(f.properties.event).c);
  }
  renderWarningCards();
  noteFeed('nws');
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

  list.innerHTML = warnFeatures.slice(0, 120).map((f, i) => {
    const p = f.properties;
    const st = warnStyle(p.event);
    const par = p.parameters || {};
    const bits = [];
    if (par.hailSize)          bits.push(`Hail ${par.hailSize[0]}"`);
    if (par.maxWindGust)       bits.push(`Wind ${par.maxWindGust[0]}`);
    if (par.tornadoDetection)  bits.push(`Tornado ${par.tornadoDetection[0]}`);
    if (par.flashFloodDetection) bits.push(String(par.flashFloodDetection[0]));
    const area = (p.areaDesc || '').split(';').slice(0, 3).join(',').trim();
    const mappable = !!f.geometry;
    return `<li class="warn-card${mappable ? '' : ' is-zone'}" data-warn="${i}" style="--wc:${st.c}"
      title="${mappable ? 'Click to zoom to the warning polygon' : 'Zone-based alert — no polygon issued'}">
      <div class="wc-top"><span class="wc-evt">${p.event || 'Alert'}</span>
      <span class="wc-exp">${fmtExpiry(p.expires)}</span></div>
      <div class="wc-area">${area}</div>
      ${bits.length ? `<div class="wc-bits">${bits.join(' · ')}</div>` : ''}
    </li>`;
  }).join('');

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
}
