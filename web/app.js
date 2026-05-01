/* Vantage — front-end. Cesium globe + WebSocket-driven entity collections. */

const PLANE_COLOR = Cesium.Color.fromCssColorString('#ffd14a');
const SHIP_COLOR  = Cesium.Color.fromCssColorString('#4dd2ff');

let viewer;
let planeCollection;
let shipCollection;
const planeEntities = new Map();  // icao24 -> Entity
const shipEntities  = new Map();  // mmsi   -> Entity
let currentSelection = null;

// ---------- Bootstrap --------------------------------------------------------

(async function main() {
  await initViewer();
  bindUI();
  connectWebSocket();
})();

async function initViewer() {
  // Pull config (may include a Cesium ion token; otherwise use ESRI).
  const cfg = await fetch('/api/config').then(r => r.json()).catch(() => ({}));
  if (cfg.cesium_ion_token) {
    Cesium.Ion.defaultAccessToken = cfg.cesium_ion_token;
  } else {
    Cesium.Ion.defaultAccessToken = '';  // suppress default-token nag
  }

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
    creditContainer: document.createElement('div'),  // hide credits
  });

  // Replace default imagery with ESRI World Imagery (no token required).
  viewer.imageryLayers.removeAll();
  viewer.imageryLayers.addImageryProvider(new Cesium.UrlTemplateImageryProvider({
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    maximumLevel: 19,
    credit: 'Tiles © Esri',
  }));

  // Dark space + atmosphere tweaks
  viewer.scene.backgroundColor = Cesium.Color.BLACK;
  viewer.scene.globe.enableLighting = true;
  viewer.scene.skyAtmosphere.show = true;

  // Fly to a sensible default view
  viewer.camera.setView({
    destination: Cesium.Cartesian3.fromDegrees(-98.0, 38.0, 22000000),
  });

  planeCollection = new Cesium.CustomDataSource('planes');
  shipCollection  = new Cesium.CustomDataSource('ships');
  viewer.dataSources.add(planeCollection);
  viewer.dataSources.add(shipCollection);

  // Click → panel
  const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
  handler.setInputAction((click) => {
    const picked = viewer.scene.pick(click.position);
    if (Cesium.defined(picked) && picked.id) {
      showPanel(picked.id);
    }
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
}

function bindUI() {
  document.getElementById('layer-planes').addEventListener('change', (e) => {
    planeCollection.show = e.target.checked;
  });
  document.getElementById('layer-ships').addEventListener('change', (e) => {
    shipCollection.show = e.target.checked;
  });
  document.getElementById('panel-close').addEventListener('click', hidePanel);
}

// ---------- WebSocket --------------------------------------------------------

function connectWebSocket() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(`${proto}//${location.host}/ws`);

  ws.onopen = () => setStatus('ok', 'live');
  ws.onclose = () => {
    setStatus('bad', 'disconnected');
    setTimeout(connectWebSocket, 2000);
  };
  ws.onerror = () => setStatus('bad', 'error');
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === 'snapshot') {
      Object.entries(msg.data.planes || {}).forEach(([id, d]) => upsertPlane(id, d));
      Object.entries(msg.data.ships  || {}).forEach(([id, d]) => upsertShip(id, d));
      updateCounts();
    } else if (msg.type === 'plane') {
      upsertPlane(msg.id, msg.data);
      updateCounts();
    } else if (msg.type === 'ship') {
      upsertShip(msg.id, msg.data);
      updateCounts();
    }
  };
}

// ---------- Entity rendering -------------------------------------------------

function upsertPlane(icao24, d) {
  if (d.lat == null || d.lon == null) return;
  const pos = Cesium.Cartesian3.fromDegrees(d.lon, d.lat, (d.alt || 10000));
  const heading = (d.heading != null) ? Cesium.Math.toRadians(d.heading) : undefined;

  let ent = planeEntities.get(icao24);
  if (!ent) {
    ent = planeCollection.entities.add({
      id: `plane:${icao24}`,
      position: pos,
      point: {
        pixelSize: 6,
        color: PLANE_COLOR,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 1,
      },
      properties: { kind: 'plane', icao24, ...d },
    });
    planeEntities.set(icao24, ent);
  } else {
    ent.position = pos;
    Object.assign(ent.properties, d);
  }
}

function upsertShip(mmsi, d) {
  if (d.lat == null || d.lon == null) return;
  const pos = Cesium.Cartesian3.fromDegrees(d.lon, d.lat, 0);

  let ent = shipEntities.get(mmsi);
  if (!ent) {
    ent = shipCollection.entities.add({
      id: `ship:${mmsi}`,
      position: pos,
      point: {
        pixelSize: 5,
        color: SHIP_COLOR,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 1,
      },
      properties: { kind: 'ship', mmsi, ...d },
    });
    shipEntities.set(mmsi, ent);
  } else {
    ent.position = pos;
    Object.assign(ent.properties, d);
  }
}

function updateCounts() {
  document.getElementById('count-planes').textContent = planeEntities.size;
  document.getElementById('count-ships').textContent  = shipEntities.size;
}

// ---------- HUD --------------------------------------------------------------

function setStatus(klass, text) {
  document.getElementById('status-dot').className = klass;
  document.getElementById('status-text').textContent = text;
}

function showPanel(entity) {
  currentSelection = entity;
  const props = entity.properties.getValue ? entity.properties.getValue() : entity.properties;
  const kind = props.kind;

  let title, subtitle;
  if (kind === 'plane') {
    title = props.callsign || props.icao24;
    subtitle = props.country || 'Aircraft';
  } else if (kind === 'ship') {
    title = props.name || `MMSI ${props.mmsi}`;
    subtitle = props.destination ? `→ ${props.destination}` : 'Vessel';
  } else {
    title = entity.id;
    subtitle = '';
  }
  document.getElementById('panel-title').textContent = title;
  document.getElementById('panel-subtitle').textContent = subtitle;

  // Render full payload as readable JSON
  const display = { ...props };
  delete display.kind;
  if (display.ts) display.last_seen = new Date(display.ts * 1000).toISOString();
  document.getElementById('panel-body').textContent = JSON.stringify(display, null, 2);

  document.getElementById('panel').classList.remove('hidden');
}

function hidePanel() {
  currentSelection = null;
  document.getElementById('panel').classList.add('hidden');
}
