/* Vantage — front-end. Cesium globe + WebSocket-driven entity collections.
 * Categories: AIR (planes, satellites), SEA (ships, hurricanes),
 *             EARTH (quakes, volcanoes, fires), WEATHER (radar, aurora),
 *             ALERTS (tsunamis).
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
};

const CATEGORY = {
  planes: 'air', satellites: 'air',
  ships: 'sea', hurricanes: 'sea',
  quakes: 'earth', volcanoes: 'earth', fires: 'earth',
  radar: 'weather', aurora: 'weather',
  tsunamis: 'alerts',
};

let viewer;
const dataSources = {};            // layer -> CustomDataSource
const entitiesByLayer = {};        // layer -> Map<id, Entity>
const satelliteRecords = new Map(); // norad -> { satrec, name, color, group, entity }
let satelliteTickHandle = null;
let radarLayer = null;
let auroraLayer = null;
let radarMeta = null;
let auroraMeta = null;

// ---------- Bootstrap --------------------------------------------------------

(async function main() {
  await initViewer();
  initDataSources();
  await applyServerCapabilities();
  bindUI();
  connectWebSocket();
})();

async function initViewer() {
  const cfg = await fetch('/api/config').then(r => r.json()).catch(() => ({}));
  Cesium.Ion.defaultAccessToken = cfg.cesium_ion_token || '';
  window.__vantage_cfg = cfg;

  viewer = new Cesium.Viewer('cesiumContainer', {
    baseLayerPicker: false,
    geocoder: false,
    homeButton: false,
    sceneModePicker: false,
    timeline: false,
    animation: false,
    fullscreenButton: false,
    navigationHelpButton: false,
    selectionIndicator: false,
    infoBox: false,
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
  const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
  handler.setInputAction((click) => {
    const picked = viewer.scene.pick(click.position);
    if (Cesium.defined(picked) && picked.id) {
      showPanel(picked.id);
    }
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
}

function initDataSources() {
  for (const layer of ['planes','ships','satellites','quakes','volcanoes','fires','hurricanes','tsunamis']) {
    const ds = new Cesium.CustomDataSource(layer);
    viewer.dataSources.add(ds);
    dataSources[layer] = ds;
    entitiesByLayer[layer] = new Map();
  }
}

async function applyServerCapabilities() {
  const cfg = window.__vantage_cfg || {};
  // Disable layers whose key isn't configured
  if (!cfg.ships_enabled) disableLayer('ships', 'no AISSTREAM_KEY');
  if (!cfg.fires_enabled) disableLayer('fires', 'no FIRMS_MAP_KEY');
}

function disableLayer(layer, reason) {
  const cb = document.querySelector(`input[data-layer="${layer}"]`);
  if (!cb) return;
  cb.checked = false;
  cb.disabled = true;
  cb.title = reason;
  const countEl = document.getElementById(`count-${layer}`);
  if (countEl) countEl.textContent = '—';
  if (dataSources[layer]) dataSources[layer].show = false;
}

// ---------- UI ---------------------------------------------------------------

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

function setCount(layer, n) {
  const el = document.getElementById(`count-${layer}`);
  if (el) el.textContent = String(n);
}

function updateCategoryCounts() {
  const totals = { air: 0, sea: 0, earth: 0, weather: 0, alerts: 0 };
  for (const [layer, cat] of Object.entries(CATEGORY)) {
    const cb = document.querySelector(`input[data-layer="${layer}"]`);
    if (!cb || !cb.checked) continue;
    if (layer === 'satellites') totals[cat] += satelliteRecords.size;
    else if (entitiesByLayer[layer]) totals[cat] += entitiesByLayer[layer].size;
    else if (layer === 'radar' && radarLayer) totals[cat] += 1;
    else if (layer === 'aurora' && auroraLayer) totals[cat] += 1;
  }
  for (const cat of Object.keys(totals)) {
    const el = document.getElementById(`cat-count-${cat}`);
    if (el) el.textContent = totals[cat] || '';
  }
}

// ---------- WebSocket --------------------------------------------------------

function connectWebSocket() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(`${proto}//${location.host}/ws`);
  ws.onopen = () => setStatus('ok', 'live');
  ws.onclose = () => { setStatus('bad', 'disconnected'); setTimeout(connectWebSocket, 2000); };
  ws.onerror = () => setStatus('bad', 'error');
  ws.onmessage = (ev) => handleMessage(JSON.parse(ev.data));
}

function handleMessage(msg) {
  if (msg.type === 'snapshot') {
    const layers = msg.data.layers || {};
    for (const [layer, entries] of Object.entries(layers)) {
      resetLayer(layer, entries);
    }
    const meta = msg.data.meta || {};
    if (meta.radar)  { radarMeta = meta.radar;  if (isLayerOn('radar'))  toggleRadar(true); }
    if (meta.aurora) { auroraMeta = meta.aurora; if (isLayerOn('aurora')) toggleAurora(true); }
  } else if (msg.type === 'planes' || msg.type === 'ships') {
    upsertEntity(msg.type, msg.id, msg.data);
  } else if (msg.type && msg.type.endsWith(':reset')) {
    const layer = msg.type.slice(0, -':reset'.length);
    resetLayer(layer, msg.data || {});
  } else if (msg.type === 'meta') {
    if (msg.key === 'radar')  { radarMeta = msg.data;  if (isLayerOn('radar'))  toggleRadar(true); }
    if (msg.key === 'aurora') { auroraMeta = msg.data; if (isLayerOn('aurora')) toggleAurora(true); }
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
  for (const [id, data] of Object.entries(entries)) {
    upsertEntity(layer, id, data);
  }
  setCount(layer, entitiesByLayer[layer].size);
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
    // Re-apply graphics that depend on data (e.g., quake mag → size)
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
      return {
        point: { pixelSize: 6, color: COLORS.planes,
                 outlineColor: Cesium.Color.BLACK, outlineWidth: 1 },
      };
    case 'ships':
      return {
        point: { pixelSize: 5, color: COLORS.ships,
                 outlineColor: Cesium.Color.BLACK, outlineWidth: 1 },
      };
    case 'quakes': {
      const mag = (typeof d.mag === 'number') ? d.mag : 1;
      const size = Math.max(4, Math.min(28, 4 + mag * 3));
      const alpha = mag >= 5 ? 1.0 : (mag >= 3 ? 0.85 : 0.55);
      return {
        point: {
          pixelSize: size,
          color: COLORS.quakes.withAlpha(alpha),
          outlineColor: Cesium.Color.BLACK, outlineWidth: 1,
        },
      };
    }
    case 'hurricanes':
      return {
        point: { pixelSize: 14, color: COLORS.hurricanes,
                 outlineColor: Cesium.Color.BLACK, outlineWidth: 2 },
        label: { text: d.name || '', font: '11px sans-serif',
                 fillColor: Cesium.Color.fromCssColorString('#f59e0b'),
                 outlineColor: Cesium.Color.BLACK, outlineWidth: 2,
                 style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                 pixelOffset: new Cesium.Cartesian2(0, -18),
                 distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 1.5e7) },
      };
    case 'volcanoes':
      return {
        point: { pixelSize: 4, color: COLORS.volcanoes.withAlpha(0.7),
                 outlineColor: Cesium.Color.BLACK, outlineWidth: 1 },
      };
    case 'fires': {
      const frp = (typeof d.frp === 'number') ? d.frp : 0;
      const size = Math.max(3, Math.min(10, 3 + Math.log10(1 + frp) * 2));
      return {
        point: { pixelSize: size, color: COLORS.fires.withAlpha(0.85),
                 outlineColor: Cesium.Color.BLACK, outlineWidth: 0.5 },
      };
    }
    case 'tsunamis':
      return {
        point: { pixelSize: 12, color: COLORS.tsunamis,
                 outlineColor: Cesium.Color.BLACK, outlineWidth: 2 },
      };
    default:
      return { point: { pixelSize: 4, color: Cesium.Color.WHITE } };
  }
}

// ---------- Satellites (TLE → satellite-js → animated positions) ------------

function rebuildSatellites(tles) {
  const ds = dataSources.satellites;
  ds.entities.removeAll();
  satelliteRecords.clear();

  for (const [id, t] of Object.entries(tles)) {
    if (!t.tle1 || !t.tle2 || !window.satellite) continue;
    let satrec;
    try {
      satrec = satellite.twoline2satrec(t.tle1, t.tle2);
    } catch (e) { continue; }
    if (!satrec || satrec.error) continue;
    const color = Cesium.Color.fromCssColorString(t.color || '#c4b5fd');
    const ent = ds.entities.add({
      id: `satellites:${id}`,
      position: Cesium.Cartesian3.fromDegrees(0, 0, 400000),  // initialized by tick
      point: { pixelSize: 3, color: color.withAlpha(0.9),
               outlineColor: Cesium.Color.BLACK, outlineWidth: 0.5 },
      properties: { kind: 'satellites', id, name: t.name, group: t.group, group_label: t.group_label },
    });
    satelliteRecords.set(id, { satrec, entity: ent, name: t.name, group: t.group });
  }

  if (!satelliteTickHandle) {
    satelliteTickHandle = setInterval(tickSatellites, 1000);
    tickSatellites();  // immediate first frame so dots aren't stuck at 0,0
  }
}

function tickSatellites() {
  if (!window.satellite || satelliteRecords.size === 0) return;
  const visible = isLayerOn('satellites') && dataSources.satellites.show;
  if (!visible) return;
  const now = new Date();
  const gmst = satellite.gstime(now);
  for (const rec of satelliteRecords.values()) {
    let pos;
    try {
      const pv = satellite.propagate(rec.satrec, now);
      if (!pv || !pv.position) continue;
      const geo = satellite.eciToGeodetic(pv.position, gmst);
      const lat = satellite.degreesLat(geo.latitude);
      const lon = satellite.degreesLong(geo.longitude);
      const alt = geo.height * 1000; // km → m
      if (!isFinite(lat) || !isFinite(lon) || !isFinite(alt)) continue;
      pos = Cesium.Cartesian3.fromDegrees(lon, lat, alt);
    } catch (e) { continue; }
    rec.entity.position = pos;
  }
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
  const latest = past[past.length - 1];          // most recent observation
  // RainViewer tile path: /v2/radar/{path}/{size}/{z}/{x}/{y}/{color}/{options}.png
  // size 256, color 4 (rainbow @ low alpha), options "1_1" (smooth+snow)
  const tpl = `${radarMeta.host}/v2/radar/${latest.path}/256/{z}/{x}/{y}/4/1_1.png`;
  if (radarLayer) viewer.imageryLayers.remove(radarLayer);
  radarLayer = viewer.imageryLayers.addImageryProvider(new Cesium.UrlTemplateImageryProvider({
    url: tpl,
    credit: 'Radar © RainViewer',
    minimumLevel: 0,
    maximumLevel: 7,
  }));
  radarLayer.alpha = 0.7;
}

function toggleAurora(on) {
  if (!on) {
    if (auroraLayer) { viewer.imageryLayers.remove(auroraLayer); auroraLayer = null; }
    return;
  }
  if (!auroraMeta || !auroraMeta.coordinates) return;

  // Render the 1°×1° probability grid into an offscreen canvas, expose as a
  // SingleTileImageryProvider covering -180..180 / -90..90.
  const grid = new Uint8Array(360 * 180);
  for (const triple of auroraMeta.coordinates) {
    const lon = triple[0], lat = triple[1], prob = triple[2];
    if (prob == null || prob <= 0) continue;
    // SWPC coords go 0..359 lon, -90..89 lat
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
      const dst = ((180 - 1 - y) * 360 + ((x + 180) % 360)) * 4;  // flip Y, shift to -180..180
      if (p === 0) {
        img.data[dst + 3] = 0;
      } else {
        // Green-glow ramp; aurora vibe
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

// ---------- HUD --------------------------------------------------------------

function setStatus(klass, text) {
  document.getElementById('status-dot').className = klass;
  document.getElementById('status-text').textContent = text;
}

function showPanel(entity) {
  const props = entity.properties.getValue ? entity.properties.getValue() : entity.properties;
  const kind = props.kind;

  let title, subtitle;
  if (kind === 'planes')         { title = props.callsign || props.id; subtitle = props.country || 'Aircraft'; }
  else if (kind === 'ships')     { title = props.name || `MMSI ${props.id}`; subtitle = props.destination ? `→ ${props.destination}` : 'Vessel'; }
  else if (kind === 'satellites'){ title = props.name; subtitle = props.group_label || 'Satellite'; }
  else if (kind === 'quakes')    { title = (props.mag != null) ? `M${props.mag}` : 'Quake'; subtitle = props.place || 'Earthquake'; }
  else if (kind === 'hurricanes'){ title = props.name || 'Storm'; subtitle = props.classification || 'Tropical cyclone'; }
  else if (kind === 'volcanoes') { title = props.name || 'Volcano'; subtitle = props.country || 'Volcano'; }
  else if (kind === 'fires')     { title = `Fire detection`; subtitle = `FRP ${props.frp ?? '?'} MW`; }
  else if (kind === 'tsunamis')  { title = props.event || 'Tsunami'; subtitle = props.area || 'Alert'; }
  else                           { title = entity.id; subtitle = ''; }

  document.getElementById('panel-title').textContent = title;
  document.getElementById('panel-subtitle').textContent = subtitle;

  const display = { ...props };
  delete display.kind;
  if (display.ts) display.last_seen = new Date(display.ts * 1000).toISOString();
  document.getElementById('panel-body').textContent = JSON.stringify(display, null, 2);
  document.getElementById('panel').classList.remove('hidden');
}

function hidePanel() {
  document.getElementById('panel').classList.add('hidden');
}
