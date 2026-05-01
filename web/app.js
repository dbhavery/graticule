/* Vantage — front-end. Cesium globe + telemetry HUD + WebSocket-driven layers.
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
};

const CATEGORY = {
  planes: 'air', satellites: 'air',
  ships: 'sea', hurricanes: 'sea',
  quakes: 'earth', volcanoes: 'earth', fires: 'earth',
  radar: 'weather', aurora: 'weather', nightlights: 'weather', terminator: 'weather',
  launches: 'space',
  tsunamis: 'alerts', severe: 'alerts', news: 'alerts',
  cables: 'reference',
};

const KIND_LABEL = {
  planes: 'AIRCRAFT', ships: 'VESSEL', satellites: 'SATELLITE',
  quakes: 'EARTHQUAKE', hurricanes: 'TROPICAL CYCLONE',
  volcanoes: 'VOLCANO', fires: 'FIRE DETECTION',
  tsunamis: 'TSUNAMI ALERT', launches: 'LAUNCH', news: 'NATURAL EVENT',
  severe: 'SEVERE WX',
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

let viewer;
const dataSources = {};
const entitiesByLayer = {};
const satelliteRecords = new Map();
let satelliteTickHandle = null;
let countdownTickHandle = null;
let radarLayer = null, auroraLayer = null;
let radarMeta = null, auroraMeta = null;
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
  startClocks();
  connectWebSocket();
})();

async function initViewer() {
  const cfg = await fetch('/api/config').then(r => r.json()).catch(() => ({}));
  Cesium.Ion.defaultAccessToken = cfg.cesium_ion_token || '';
  window.__vantage_cfg = cfg;

  viewer = new Cesium.Viewer('cesiumContainer', {
    baseLayerPicker: false,
    geocoder: false, homeButton: false, sceneModePicker: false,
    timeline: false, animation: false, fullscreenButton: false,
    navigationHelpButton: false, selectionIndicator: false, infoBox: false,
    creditContainer: document.createElement('div'),
  });

  viewer.imageryLayers.removeAll();
  viewer.imageryLayers.addImageryProvider(new Cesium.UrlTemplateImageryProvider({
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    maximumLevel: 19,
    credit: 'Tiles © Esri',
  }));

  viewer.scene.backgroundColor = Cesium.Color.BLACK;
  viewer.scene.globe.enableLighting = true;
  viewer.scene.skyAtmosphere.show = true;

  // 3D buildings — OSM Buildings (Cesium ion) and Google Photorealistic 3D Tiles
  // are both gated on user-supplied free keys. They auto-attach when present.
  await maybeAttachOsmBuildings(cfg);
  await maybeAttachGoogle3DTiles(cfg);

  viewer.camera.setView({
    destination: Cesium.Cartesian3.fromDegrees(-98.0, 38.0, 22000000),
  });
  // Allow the camera to descend into the surface band where 3D buildings live
  viewer.scene.screenSpaceCameraController.minimumZoomDistance = 50;

  // Click → panel
  const click = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
  click.setInputAction((c) => {
    const picked = viewer.scene.pick(c.position);
    if (Cesium.defined(picked) && picked.id) showPanel(picked.id);
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

  // Mouse move → cursor lat/lon readout
  const move = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
  move.setInputAction((m) => {
    const ray = viewer.camera.getPickRay(m.endPosition);
    if (!ray) return;
    const cart = viewer.scene.globe.pick(ray, viewer.scene);
    const el = document.getElementById('tm-cursor');
    if (!cart) { el.textContent = '—'; return; }
    const c = Cesium.Cartographic.fromCartesian(cart);
    const lat = Cesium.Math.toDegrees(c.latitude).toFixed(2);
    const lon = Cesium.Math.toDegrees(c.longitude).toFixed(2);
    el.textContent = `${lat.padStart(6)}  ${lon.padStart(7)}`;
  }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
}

function initDataSources() {
  for (const layer of ['planes','ships','satellites','quakes','volcanoes','fires','hurricanes','tsunamis','severe','launches','news']) {
    const ds = new Cesium.CustomDataSource(layer);
    viewer.dataSources.add(ds);
    dataSources[layer] = ds;
    entitiesByLayer[layer] = new Map();
  }
  // Cables — separate static-overlay data source for polylines
  cablesDS = new Cesium.CustomDataSource('cables');
  viewer.dataSources.add(cablesDS);
  cablesDS.show = false;
  // Subsolar / terminator marker
  terminatorDS = new Cesium.CustomDataSource('terminator');
  viewer.dataSources.add(terminatorDS);
  initTerminator();
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
  const cfg = window.__vantage_cfg || {};
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
      else if (dataSources[layer])     dataSources[layer].show = on;
      updateCategoryCounts();
    });
  });
  document.getElementById('panel-close').addEventListener('click', hidePanel);
}

// ---------- Clocks / telemetry ticker ---------------------------------------

function startClocks() {
  setInterval(() => {
    const now = new Date();
    const utc = now.toISOString().slice(11, 19);
    document.getElementById('tm-utc').textContent = utc;

    // Camera altitude
    const altEl = document.getElementById('tm-alt');
    if (viewer && viewer.camera) {
      const carto = Cesium.Cartographic.fromCartesian(viewer.camera.position);
      if (carto) altEl.textContent = formatKm(carto.height);
    }

    // Feed-chip aging — chips that haven't updated in 5x their poll go warn
    refreshFeedChips();
  }, 1000);
}

function formatKm(meters) {
  if (meters == null || !isFinite(meters)) return '—';
  const km = meters / 1000;
  if (km > 999) return `${(km / 1000).toFixed(1)} Mm`;
  if (km > 9)   return `${km.toFixed(0)} km`;
  return `${km.toFixed(1)} km`;
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
}

// ---------- Counts / category roll-up --------------------------------------

function setCount(layer, n) {
  const el = document.getElementById(`count-${layer}`);
  if (el) el.textContent = String(n);
}

function updateCategoryCounts() {
  const totals = { air: 0, sea: 0, earth: 0, weather: 0, space: 0, alerts: 0 };
  for (const [layer, cat] of Object.entries(CATEGORY)) {
    const cb = document.querySelector(`input[data-layer="${layer}"]`);
    if (!cb || !cb.checked) continue;
    if (layer === 'satellites')                  totals[cat] += satelliteRecords.size;
    else if (entitiesByLayer[layer])             totals[cat] += entitiesByLayer[layer].size;
    else if (layer === 'radar' && radarLayer)    totals[cat] += 1;
    else if (layer === 'aurora' && auroraLayer)  totals[cat] += 1;
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

function upsertEntity(layer, id, data) {
  if (data.lat == null || data.lon == null) return;
  const ds = dataSources[layer];
  if (!ds) return;
  const map = entitiesByLayer[layer];
  let ent = map.get(id);
  const pos = positionFor(layer, data);
  const props = { kind: layer, id, ...data };

  if (!ent) {
    ent = ds.entities.add({
      id: `${layer}:${id}`,
      position: pos,
      ...graphicsFor(layer, data),
      properties: props,
    });
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
// Per-layer pixelSize is the only differentiator. Magnitude/FRP can subtly
// nudge size for quakes/fires (data-driven, not zoom-driven). When real type-
// specific 3D models arrive (aircraft, ship classes, ISS), they'll replace
// dots conditionally — until then, dots only.
const DOT_PX = {
  planes:     4,
  ships:      3,
  satellites: 2,
  quakes:     4,   // base size; mag adds 0..4 px
  hurricanes: 6,
  volcanoes:  3,
  fires:      3,   // base; FRP adds 0..3 px
  tsunamis:   6,
  severe:     5,
  launches:   5,
  news:       3,
};

function graphicsFor(layer, d) {
  const px = DOT_PX[layer] || 3;

  // Mag-driven nudge for quakes (M2 = base 4, M7 = base 8). Tiny but visible.
  if (layer === 'quakes') {
    const mag = (typeof d.mag === 'number') ? d.mag : 1;
    const size = Math.max(3, Math.min(8, px + Math.max(0, mag - 2) * 0.8));
    const alpha = mag >= 5 ? 1.0 : (mag >= 3 ? 0.85 : 0.6);
    return { point: { pixelSize: size, color: COLORS.quakes.withAlpha(alpha),
                      outlineColor: Cesium.Color.BLACK, outlineWidth: 0.5 } };
  }
  // FRP nudge for fires (small fire = 3, megafire = 6).
  if (layer === 'fires') {
    const frp = (typeof d.frp === 'number') ? d.frp : 0;
    const size = Math.max(2, Math.min(6, px + Math.log10(1 + frp) * 1.2));
    return { point: { pixelSize: size, color: COLORS.fires.withAlpha(0.85),
                      outlineColor: Cesium.Color.BLACK, outlineWidth: 0.5 } };
  }

  // Launches keep the ground-rendered ring + countdown label (those are
  // map features, not icons — they're spatially meaningful).
  if (layer === 'launches') {
    return {
      point: { pixelSize: px, color: COLORS.launches,
               outlineColor: Cesium.Color.BLACK, outlineWidth: 0.8 },
      ellipse: {
        semiMajorAxis: 60000, semiMinorAxis: 60000,
        material: COLORS.launches.withAlpha(0.14),
        outline: true, outlineColor: COLORS.launches.withAlpha(0.7),
        height: 0,
      },
      label: {
        text: countdownText(d.net),
        font: '10px JetBrains Mono, monospace',
        fillColor: COLORS.launches,
        outlineColor: Cesium.Color.BLACK, outlineWidth: 2,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(0, -14),
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 1.5e7),
      },
    };
  }

  // Hurricanes keep a name label (text, not an icon)
  if (layer === 'hurricanes') {
    return {
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
    };
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
    const ent = ds.entities.add({
      id: `satellites:${id}`,
      position: Cesium.Cartesian3.fromDegrees(0, 0, 400000),
      point: { pixelSize: 3, color: color.withAlpha(0.9),
               outlineColor: Cesium.Color.BLACK, outlineWidth: 0.5 },
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
    if (radarLayer) { viewer.imageryLayers.remove(radarLayer); radarLayer = null; }
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
  radarLayer.alpha = 0.7;
}

function toggleAurora(on) {
  if (!on) {
    if (auroraLayer) { viewer.imageryLayers.remove(auroraLayer); auroraLayer = null; }
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
  auroraLayer.alpha = 0.85;
}

// ---------- Space weather header chips --------------------------------------

function applySpaceWeather(blob) {
  if (!blob) return;
  const kpEl = document.getElementById('tm-kp');
  const swEl = document.getElementById('tm-sw');
  const xEl  = document.getElementById('tm-xray');

  if (blob.kp && blob.kp.value != null) {
    kpEl.textContent = blob.kp.value.toFixed(1);
    kpEl.className = 'tm-val mono ' + (blob.kp.value >= 6 ? 'kp-storm' : blob.kp.value >= 4 ? 'kp-active' : 'kp-quiet');
  } else { kpEl.textContent = '—'; kpEl.className = 'tm-val mono'; }

  if (blob.solar_wind && blob.solar_wind.speed_kms != null) {
    swEl.textContent = `${Math.round(blob.solar_wind.speed_kms)} km/s`;
  } else { swEl.textContent = '—'; }

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
  if (osmBuildingsTileset) osmBuildingsTileset.show = on;
}
function togglePhotoreal3D(on) {
  if (googleTileset) googleTileset.show = on;
}

// ---------- Night Lights (NASA Black Marble via GIBS) -----------------------

function toggleNightLights(on) {
  if (!on) {
    if (nightLightsLayer) {
      viewer.imageryLayers.remove(nightLightsLayer);
      nightLightsLayer = null;
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
  nightLightsLayer.alpha      = 1.0;
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
  if (terminatorDS) terminatorDS.show = on;
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
  cablesDS.show = on;
  if (on && !cablesBuilt && cablesGeoJson) buildCables();
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
