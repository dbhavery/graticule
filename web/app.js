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
};

const CATEGORY = {
  planes: 'air', satellites: 'air',
  ships: 'sea', hurricanes: 'sea',
  quakes: 'earth', volcanoes: 'earth', fires: 'earth',
  radar: 'weather', aurora: 'weather',
  launches: 'space',
  tsunamis: 'alerts', news: 'alerts',
};

const KIND_LABEL = {
  planes: 'AIRCRAFT', ships: 'VESSEL', satellites: 'SATELLITE',
  quakes: 'EARTHQUAKE', hurricanes: 'TROPICAL CYCLONE',
  volcanoes: 'VOLCANO', fires: 'FIRE DETECTION',
  tsunamis: 'TSUNAMI ALERT', launches: 'LAUNCH', news: 'NATURAL EVENT',
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
  { id: 'launches',   label: 'LL2' },
  { id: 'news',       label: 'EONET' },
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

  viewer.camera.setView({
    destination: Cesium.Cartesian3.fromDegrees(-98.0, 38.0, 22000000),
  });

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
  for (const layer of ['planes','ships','satellites','quakes','volcanoes','fires','hurricanes','tsunamis','launches','news']) {
    const ds = new Cesium.CustomDataSource(layer);
    viewer.dataSources.add(ds);
    dataSources[layer] = ds;
    entitiesByLayer[layer] = new Map();
  }
}

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
      if (layer === 'radar')        toggleRadar(on);
      else if (layer === 'aurora')  toggleAurora(on);
      else if (dataSources[layer])  dataSources[layer].show = on;
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

  // Push notable events into the ticker on bulk reset (newest first)
  if (layer === 'quakes')    addToTickerFromQuakes(entries);
  if (layer === 'launches')  addToTickerFromLaunches(entries);
  if (layer === 'tsunamis')  addToTickerFromTsunamis(entries);
  if (layer === 'hurricanes')addToTickerFromHurricanes(entries);
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

function graphicsFor(layer, d) {
  switch (layer) {
    case 'planes':
      return { point: { pixelSize: 6, color: COLORS.planes,
                        outlineColor: Cesium.Color.BLACK, outlineWidth: 1 } };
    case 'ships':
      return { point: { pixelSize: 5, color: COLORS.ships,
                        outlineColor: Cesium.Color.BLACK, outlineWidth: 1 } };
    case 'quakes': {
      const mag = (typeof d.mag === 'number') ? d.mag : 1;
      const size = Math.max(4, Math.min(28, 4 + mag * 3));
      const alpha = mag >= 5 ? 1.0 : (mag >= 3 ? 0.85 : 0.55);
      return { point: { pixelSize: size, color: COLORS.quakes.withAlpha(alpha),
                        outlineColor: Cesium.Color.BLACK, outlineWidth: 1 } };
    }
    case 'hurricanes':
      return {
        point: { pixelSize: 14, color: COLORS.hurricanes,
                 outlineColor: Cesium.Color.BLACK, outlineWidth: 2 },
        label: { text: d.name || '', font: '11px Inter, sans-serif',
                 fillColor: COLORS.hurricanes,
                 outlineColor: Cesium.Color.BLACK, outlineWidth: 2,
                 style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                 pixelOffset: new Cesium.Cartesian2(0, -18),
                 distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 1.5e7) },
      };
    case 'volcanoes':
      return { point: { pixelSize: 4, color: COLORS.volcanoes.withAlpha(0.7),
                        outlineColor: Cesium.Color.BLACK, outlineWidth: 1 } };
    case 'fires': {
      const frp = (typeof d.frp === 'number') ? d.frp : 0;
      const size = Math.max(3, Math.min(10, 3 + Math.log10(1 + frp) * 2));
      return { point: { pixelSize: size, color: COLORS.fires.withAlpha(0.85),
                        outlineColor: Cesium.Color.BLACK, outlineWidth: 0.5 } };
    }
    case 'tsunamis':
      return { point: { pixelSize: 12, color: COLORS.tsunamis,
                        outlineColor: Cesium.Color.BLACK, outlineWidth: 2 } };
    case 'launches':
      // Pulsing yellow ring drawn via ellipse on the surface
      return {
        point: { pixelSize: 9, color: COLORS.launches,
                 outlineColor: Cesium.Color.BLACK, outlineWidth: 1.5 },
        ellipse: { semiMajorAxis: 60000, semiMinorAxis: 60000,
                   material: COLORS.launches.withAlpha(0.18),
                   outline: true, outlineColor: COLORS.launches.withAlpha(0.9),
                   height: 0 },
        label: { text: countdownText(d.net), font: '10px JetBrains Mono, monospace',
                 fillColor: COLORS.launches,
                 outlineColor: Cesium.Color.BLACK, outlineWidth: 2,
                 style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                 pixelOffset: new Cesium.Cartesian2(0, -16),
                 distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 1.5e7) },
      };
    case 'news':
      return { point: { pixelSize: 4, color: COLORS.news.withAlpha(0.8),
                        outlineColor: Cesium.Color.BLACK, outlineWidth: 0.5 } };
    default:
      return { point: { pixelSize: 4, color: Cesium.Color.WHITE } };
  }
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

function addToTickerFromQuakes(entries) {
  // Top 3 by magnitude in last 6h
  const now = Date.now();
  const list = Object.values(entries)
    .filter(q => q.time && (now - q.time) < 6 * 3600 * 1000 && typeof q.mag === 'number')
    .sort((a, b) => b.mag - a.mag)
    .slice(0, 3);
  for (const q of list) {
    pushEvent('QUAKE', `M${q.mag.toFixed(1)} — ${q.place || 'unknown'}`, q.time || now);
  }
}

function addToTickerFromLaunches(entries) {
  // Next 2 upcoming
  const list = Object.values(entries)
    .filter(L => L.net)
    .sort((a, b) => new Date(a.net) - new Date(b.net))
    .slice(0, 2);
  for (const L of list) {
    pushEvent('LAUNCH', `${L.name || L.vehicle} — ${L.pad_location || ''}`, new Date(L.net).getTime());
  }
  startCountdownTicker();
}

function addToTickerFromTsunamis(entries) {
  const now = Date.now();
  for (const t of Object.values(entries).slice(0, 2)) {
    pushEvent('TSUNAMI', t.headline || t.event || 'alert', now);
  }
}

function addToTickerFromHurricanes(entries) {
  const now = Date.now();
  for (const h of Object.values(entries).slice(0, 2)) {
    pushEvent('STORM', `${h.classification || ''} ${h.name || ''} ${h.intensity ? '— '+h.intensity+' kt' : ''}`.trim(), now);
  }
}

// ---------- HUD --------------------------------------------------------------

function setStatus(klass, text) {
  document.getElementById('status-dot').className = klass;
  document.getElementById('status-text').textContent = text.toUpperCase();
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
