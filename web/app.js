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
  radar: 'weather', aurora: 'weather', nightlights: 'weather', terminator: 'weather',
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
};

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

const FEEDS = [
  { id: 'planes',     label: 'ADS-B' },
  { id: 'ships',      label: 'AIS' },
  { id: 'satellites', label: 'TLE' },
  { id: 'airports',   label: 'AIRPORTS' },
  { id: 'tfrs',       label: 'TFR' },
  { id: 'quakes',     label: 'USGS' },
  { id: 'hurricanes', label: 'NHC' },
  { id: 'volcanoes',  label: 'GVP' },
  { id: 'fires',      label: 'FIRMS' },
  { id: 'tsunamis',   label: 'NWS' },
  { id: 'severe',     label: 'NWS-WX' },
  { id: 'launches',   label: 'LL2' },
  { id: 'news',       label: 'EONET' },
  { id: 'cables',     label: 'CABLES', meta: true },
  { id: 'radar',      label: 'RADAR',  meta: true },
  { id: 'aurora',     label: 'AURORA', meta: true },
  { id: 'space_weather', label: 'SWPC', meta: true, hideFromChips: false },
];

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
const settings = Object.assign(
  { units: 'us', view: 'globe', hoverDelayMs: 500 },
  loadSettings()
);
function loadSettings() {
  try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'); }
  catch { return {}; }
}
function saveSettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch {}
}

let viewer;
const dataSources = {};
const entitiesByLayer = {};
const satelliteRecords = new Map();
let satelliteTickHandle = null;
let countdownTickHandle = null;
let radarLayer = null, auroraLayer = null;
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
  applyInitialLayerState();
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
  // Prefer Cesium ion World Imagery (Bing-backed, 19+ levels) when a token is
  // configured — significantly higher detail at city/block scale. Fall back
  // to ESRI for token-less use.
  if (cfg.cesium_ion_token) {
    try {
      const layer = await Cesium.IonImageryProvider.fromAssetId(2);
      viewer.imageryLayers.addImageryProvider(layer);
    } catch (e) {
      console.warn('Cesium ion imagery failed, falling back to ESRI:', e);
      viewer.imageryLayers.addImageryProvider(new Cesium.UrlTemplateImageryProvider({
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        maximumLevel: 19,
        credit: 'Tiles © Esri',
      }));
    }
  } else {
    viewer.imageryLayers.addImageryProvider(new Cesium.UrlTemplateImageryProvider({
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      maximumLevel: 19,
      credit: 'Tiles © Esri',
    }));
  }
  // Allow Cesium to over-zoom past native level (interpolated, lossy but the
  // user sees something instead of a black tile).
  viewer.scene.maximumScreenSpaceError = 1.5;

  viewer.scene.backgroundColor = Cesium.Color.BLACK;
  viewer.scene.globe.enableLighting = true;
  viewer.scene.skyAtmosphere.show = true;
  // Richer atmospheric scattering — deepens the limb, cools the daylight band
  viewer.scene.skyAtmosphere.hueShift        = -0.04;
  viewer.scene.skyAtmosphere.saturationShift =  0.18;
  viewer.scene.skyAtmosphere.brightnessShift = -0.06;
  // Ground atmosphere too — softens day/night terminator with a warm bleed
  viewer.scene.globe.showGroundAtmosphere = true;
  viewer.scene.globe.atmosphereLightIntensity = 12.0;

  // 3D buildings — OSM Buildings (Cesium ion) and Google Photorealistic 3D Tiles
  // are both gated on user-supplied free keys. They auto-attach when present.
  await maybeAttachOsmBuildings(cfg);
  await maybeAttachGoogle3DTiles(cfg);

  viewer.camera.setView({
    destination: Cesium.Cartesian3.fromDegrees(-98.0, 38.0, 22000000),
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
  return g;
}

function configureClustering(ds, opts) {
  if (!ds || !ds.clustering) return;
  const c = ds.clustering;
  c.enabled = true;
  c.pixelRange = opts.pixelRange ?? 60;
  c.minimumClusterSize = opts.minSize ?? 4;
  const baseColor = opts.color || Cesium.Color.WHITE;
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

const LAYER_FADE_MS = 350;
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

function fadeDataSource(ds, dir = 'in', durationMs = LAYER_FADE_MS, onDone) {
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

function fadeImageryLayer(layer, fromA, toA, durationMs = LAYER_FADE_MS, onDone) {
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

function fadeTileset(tileset, fromA, toA, durationMs = LAYER_FADE_MS, onDone) {
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
      else if (layer === 'aurora')     toggleAurora(on);
      else if (layer === 'buildings')  toggleBuildings(on);
      else if (layer === 'photoreal3d')togglePhotoreal3D(on);
      else if (layer === 'cables')     toggleCables(on);
      else if (layer === 'nightlights')toggleNightLights(on);
      else if (layer === 'terminator') toggleTerminator(on);
      else if (layer === 'parcels_us') toggleParcelsUS(on);
      else if (layer === 'parcels_wa') toggleParcelsWA(on);
      else if (layer === 'countries')  toggleCountries(on);
      else if (layer === 'states')     toggleStates(on);
      else if (layer === 'cities')     toggleCities(on);
      else if (layer === 'airspace')   toggleAirspace(on);
      else if (dataSources[layer])     fadeDataSource(dataSources[layer], on ? 'in' : 'out');
      updateCategoryCounts();
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
    const now = new Date();
    document.getElementById('tm-utc').textContent = now.toISOString().slice(11, 19);

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
    if (!last) { el.dataset.state = 'off'; return; }
    const ageSec = (now - last) / 1000;
    if      (ageSec < 600)   el.dataset.state = 'ok';
    else if (ageSec < 3600)  el.dataset.state = 'warn';
    else                     el.dataset.state = 'bad';
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
    if (meta.radar)         { radarMeta = meta.radar;   noteFeed('radar');  if (isLayerOn('radar'))  toggleRadar(true); }
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
    if      (msg.key === 'radar')         { radarMeta = msg.data;  noteFeed('radar');  if (isLayerOn('radar'))  toggleRadar(true); }
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
const MODEL_SWAP_DISTANCE_M = 50_000;

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

function toggleRadar(on) {
  if (!on) {
    if (radarLayer) {
      const ref = radarLayer; radarLayer = null;
      fadeImageryLayer(ref, ref.alpha, 0, LAYER_FADE_MS, () => viewer.imageryLayers.remove(ref));
    }
    return;
  }
  if (!radarMeta || !radarMeta.host) return;
  const past = radarMeta.past || [];
  if (past.length === 0) return;
  const latest = past[past.length - 1];
  const tpl = `${radarMeta.host}/v2/radar/${latest.path}/256/{z}/{x}/{y}/4/1_1.png`;
  if (radarLayer) viewer.imageryLayers.remove(radarLayer);
  radarLayer = viewer.imageryLayers.addImageryProvider(new Cesium.UrlTemplateImageryProvider({
    url: tpl, credit: 'Radar © RainViewer',
    minimumLevel: 0, maximumLevel: 7,
  }));
  fadeImageryLayer(radarLayer, 0, 0.7);
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
  // VIIRS Black Marble — annual composite, free, no key, no rate limit.
  // GIBS WMTS in EPSG:4326 ("best/VIIRS_Black_Marble") with a baked-in date
  // because Black Marble is a yearly product.
  const url = 'https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/VIIRS_Black_Marble/default/2016-01-01/500m/{TileMatrix}/{TileRow}/{TileCol}.jpg';
  nightLightsLayer = viewer.imageryLayers.addImageryProvider(new Cesium.UrlTemplateImageryProvider({
    url: url
      .replace('{TileMatrix}', '{z}')
      .replace('{TileRow}', '{y}')
      .replace('{TileCol}', '{x}'),
    tilingScheme: new Cesium.GeographicTilingScheme(),
    maximumLevel: 8,
    credit: 'NASA Earthdata · VIIRS Black Marble',
  }));
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

    let added = 0;
    for (const f of (fc.features || [])) {
      const c = f.geometry?.coordinates;
      if (!c) continue;
      const p = f.properties || {};
      const sr = p.scalerank ?? 6;
      const farM = _cityMaxDist(sr);
      // Lower rank = larger label; cap range to keep things readable
      const fontPx = sr <= 1 ? 12 : sr <= 3 ? 11 : sr <= 6 ? 10 : 9;
      // Dot size scales gently with rank too
      const dotPx = sr <= 1 ? 4.5 : sr <= 4 ? 3.5 : 2.5;
      // Fade-in distance: a third of the visibility range so the city
      // softly appears as the camera approaches.
      const fadeStart = Math.min(farM, farM * 0.6);
      const fadeFull  = Math.min(farM, farM * 0.35);
      citiesDS.entities.add({
        position: Cesium.Cartesian3.fromDegrees(c[0], c[1], 0),
        point: {
          pixelSize: dotPx,
          color: dotColor,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 0.5,
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, farM),
          translucencyByDistance: new Cesium.NearFarScalar(fadeStart, 0.0, fadeFull, 1.0),
        },
        label: {
          text: p.name || '',
          font: `500 ${fontPx}px "Inter", system-ui, sans-serif`,
          fillColor: labelFill,
          outlineColor: labelOutline,
          outlineWidth: 2.5,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          horizontalOrigin: Cesium.HorizontalOrigin.LEFT,
          verticalOrigin: Cesium.VerticalOrigin.CENTER,
          pixelOffset: new Cesium.Cartesian2(6, 0),
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, farM),
          translucencyByDistance: new Cesium.NearFarScalar(fadeStart, 0.0, fadeFull, 1.0),
          // Depth-test ON so cities on the far side of the globe are occluded.
        },
        properties: { kind: 'city_label', ...p },
      });
      added++;
    }
    setCount('cities', added);
    updateCategoryCounts();
    console.log(`Built ${added} city/town labels`);
  } catch (e) {
    console.warn('Cities failed to load:', e);
    citiesBuilt = false;
  }
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
const PARCELS_WA_MAX_ALT_M = 6000;       // start fetching at < 6 km
const PARCELS_WA_FETCH_MAX_ALT_M = 4000; // stricter limit to actually issue queries
const PARCELS_WA_MAX_FEATURES = 1500;    // entity cap
const PARCELS_WA_PAGE_SIZE = 500;        // ArcGIS hard cap is 2000

let parcelsUSLayer = null;
let parcelsWADS = null;
let parcelsWAEnabled = false;
let parcelsWADebounce = null;
let parcelsWAInflight = null;       // AbortController of current fetch
let parcelsWALastBbox = null;       // [w, s, e, n] of last successful fetch

function toggleParcelsUS(on) {
  if (!on) {
    if (parcelsUSLayer) {
      const ref = parcelsUSLayer; parcelsUSLayer = null;
      fadeImageryLayer(ref, ref.alpha, 0, LAYER_FADE_MS, () => viewer.imageryLayers.remove(ref));
    }
    return;
  }
  if (parcelsUSLayer) return;
  parcelsUSLayer = viewer.imageryLayers.addImageryProvider(new Cesium.UrlTemplateImageryProvider({
    url: PARCELS_US_URL,
    minimumLevel: 14,        // tile cache is empty below this
    maximumLevel: 17,        // and stops here
    credit: 'Parcels © Regrid',
  }));
  fadeImageryLayer(parcelsUSLayer, 0, 0.85);
  setCount('parcels_us', 'tiles');
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
  // Reflect persisted settings into the modal controls
  document.querySelectorAll('input[name=units]').forEach((r) => { r.checked = (r.value === settings.units); });
  document.querySelectorAll('input[name=view]').forEach((r)  => { r.checked = (r.value === settings.view); });
  const hd = document.getElementById('hover-delay');
  const hdv = document.getElementById('hover-delay-val');
  if (hd && hdv) {
    hd.value = String(settings.hoverDelayMs);
    hdv.textContent = `${settings.hoverDelayMs} ms`;
    hd.addEventListener('input', () => {
      settings.hoverDelayMs = Number(hd.value) | 0;
      hdv.textContent = `${settings.hoverDelayMs} ms`;
      saveSettings();
    });
  }

  document.querySelectorAll('input[name=units]').forEach((r) => {
    r.addEventListener('change', () => {
      if (r.checked) { settings.units = r.value; saveSettings(); applyUnits(); }
    });
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

  // Apply on boot so first paint matches persisted state
  applyUnits();
}

function applyUnits() {
  const lbl = document.getElementById('tm-alt-label');
  if (lbl) lbl.textContent = settings.units === 'us' ? 'ALT (US)' : 'ALT';
  // formatAltitude reads settings.units directly on every tick, so the header
  // value catches up within ~1s on its own.
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
