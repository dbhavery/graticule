# Vantage — Data Source & 3D Content Research

> Compiled 2026-04-30. Catalog of every free public data source and 3D
> content API evaluated for Vantage. Status field tracks what shipped
> versus what's available but not yet wired.

Status legend:
- ✅ shipped — wired and active
- 🔌 ready — code path present, gated on a free user-provided key
- 🛠 next — high-value, queued for upcoming work
- 📚 evaluated — researched, not yet picked up
- ❌ rejected — tried, broken, or fundamentally fragile

---

## A. Position / movement feeds (per-entity, polled or streamed)

| Layer | Source | Endpoint | Cadence | Auth | Status | Notes |
|---|---|---|---|---|---|---|
| Planes | OpenSky Network | `https://opensky-network.org/api/states/all` | 15s poll | Anonymous (rate-limited) | ✅ | Anonymous capped ~5–10/min. 429 → 60s backoff. ~7000 global state vectors. |
| Planes (richer) | OpenSky tracks | `…/api/tracks/all?icao24=…` | on-demand | Account | 📚 | Per-aircraft historical track. Need login. |
| Aircraft DB | OpenSky aircraft DB | `https://opensky-network.org/datasets/metadata/` | one-shot CSV | None | 🛠 | Map ICAO24 → registration / model / operator → enables type-aware icons (airliner vs fighter vs helicopter). |
| Aircraft DB (US) | FAA Releasable Aircraft DB | `https://registry.faa.gov/database/...` | quarterly CSV | None | 📚 | US-registered tail numbers only. |
| Ships | AISStream | `wss://stream.aisstream.io/v0/stream` | streaming | Free key | 🔌 | `AISSTREAM_KEY` in `.env` enables. ~50–100 msg/sec global firehose. |
| Ships (alt) | aishub.net | `http://data.aishub.net/ws.php` | poll | Account | 📚 | Alternative AIS provider. |
| Vessel registry | MarineTraffic / vesselfinder | scraping or paid API | — | Paid | ❌ | Not free. |
| Satellites | Celestrak GP | `https://celestrak.org/NORAD/elements/gp.php?GROUP=…` | 6h refresh | None | ✅ | TLE → satellite-js client-side propagation. 7 groups, ~1400 sats (Starlink capped). |
| Satellites (alt) | space-track.org | various | various | Free account | 📚 | Authoritative US catalog. Requires login. |
| ISS pass | open-notify.org | `https://api.open-notify.org/iss-now.json` | 5s | None | 📚 | ISS already in Celestrak `stations` group. |
| Spaceports | curated | hand-list / Wikipedia | static | None | 📚 | Subsumed by `launches.pad`. |

## B. Hazard / event feeds (point geometry)

| Layer | Source | Endpoint | Cadence | Auth | Status |
|---|---|---|---|---|---|
| Earthquakes | USGS Earthquake Hazards | `…/feed/v1.0/summary/all_day.geojson` | 60s | None | ✅ |
| Significant quakes | USGS | `…/significant_month.geojson` | 5m | None | 📚 (M4.5+ subset of all_day) |
| Hurricanes | NOAA NHC | `https://www.nhc.noaa.gov/CurrentStorms.json` | 5m | None | ✅ |
| Hurricane history | IBTrACS | `https://www.ncei.noaa.gov/data/international-best-track-archive…` | static | None | 📚 |
| Tsunamis | NWS Public Alerts | `https://api.weather.gov/alerts/active?event=Tsunami…` | 2m | None (UA req) | ✅ |
| Wildfires | NASA FIRMS | `…/api/area/csv/{KEY}/VIIRS_NOAA20_NRT/world/1` | 30m | Free MAP_KEY | 🔌 |
| Volcanoes (catalog) | Smithsonian GVP WFS | `…/geoserver/GVP-VOTW/ows?…Holocene_Volcanoes…` | 24h refresh | None | ✅ (~1215) |
| Volcanic activity (current) | Smithsonian GVP weekly | `https://volcano.si.edu/news/WeeklyVolcanoRSS.xml` | hourly | None | 📚 (RSS/XML; current eruption status) |
| Volcanic ash advisories | VAACs (Tokyo, Anchorage, etc.) | per-VAAC sites | varies | None | 📚 (XML/HTML; per-region) |
| Tornadoes / severe weather | NWS Public Alerts | `…/alerts/active` | 2m | None | 📚 (US-only, easy add) |
| Floods (US) | NWS / USGS Water | `https://waterservices.usgs.gov/...` | 15m | None | 📚 |
| Avalanches (US) | avalanche.org | `https://api.avalanche.org/v2/...` | hourly | None | 📚 |
| Drought | US Drought Monitor | `https://droughtmonitor.unl.edu/...` | weekly | None | 📚 |
| Disaster events (curated) | NASA EONET v3 | `https://eonet.gsfc.nasa.gov/api/v3/events?status=open` | 15m | None | ✅ (200 active events) |
| Humanitarian disasters | ReliefWeb v1 | `https://api.reliefweb.int/v1/disasters` | — | — | ❌ (HTTP 410 retired) |
| News (geocoded) | GDELT 2.0 GEO | `https://api.gdeltproject.org/api/v2/geo/geo` | — | — | ❌ (HTTP 404, endpoint flaky) |
| News (alt) | GDELT DOC | `…/api/v2/doc/doc?mode=ArtList` | 10m | None | 📚 (article list, not geocoded points; would need post-geocoding) |

## C. Imagery overlay layers (raster tiles)

| Layer | Source | Endpoint | Cadence | Auth | Status |
|---|---|---|---|---|---|
| Base imagery | ESRI World Imagery | `https://server.arcgisonline.com/.../World_Imagery/...` | static | None | ✅ |
| Base imagery HD | Cesium ion | via ion | static | Free token | 🔌 (`CESIUM_ION_TOKEN`) |
| Weather radar | RainViewer | `https://api.rainviewer.com/public/weather-maps.json` → `{host}/v2/radar/{path}/...` | 5m | None | ✅ |
| Satellite (IR) | RainViewer | same manifest, `satellite.infrared` | 5m | None | 📚 (in radar payload, not yet rendered) |
| Aurora | NOAA SWPC Ovation | `…/json/ovation_aurora_latest.json` | 5m | None | ✅ (canvas-painted overlay) |
| Aurora 3-day forecast | NOAA SWPC | `…/json/ovation_aurora_forecast.json` | hourly | None | 📚 |
| Cloud cover | NOAA / GOES | `https://services.swpc.noaa.gov/.../satellite-images/` | 10m | None | 📚 |
| Light pollution | unihedron.com / dark-sky maps | tile servers | static | varies | 📚 |
| Sea surface temperature | NOAA Coral Reef Watch | various | daily | None | 📚 |
| Sea ice | NSIDC | `https://nsidc.org/data/...` | daily | None | 📚 |
| Lightning (alt to Blitzortung) | Saratoga free tier | — | — | — | 📚 (free tier limited) |
| Lightning (raw) | Blitzortung | `wss://ws*.blitzortung.org/` | streaming | None | ❌ (community-reverse-engineered protocol; tos forbids 3rd-party clients) |

## D. Ambient / always-on telemetry

| Signal | Source | Endpoint | Cadence | Auth | Status |
|---|---|---|---|---|---|
| Kp planetary index | NOAA SWPC | `…/products/noaa-planetary-k-index.json` | 5m | None | ✅ |
| Solar wind plasma | NOAA SWPC DSCOVR | `…/products/solar-wind/plasma-2-hour.json` | 5m | None | ✅ |
| GOES X-ray flares | NOAA SWPC | `…/json/goes/primary/xray-flares-latest.json` | 5m | None | ✅ |
| Solar wind mag (Bz) | NOAA SWPC DSCOVR | `…/products/solar-wind/mag-2-hour.json` | 5m | None | 📚 (Bz crucial for storm strength) |
| ENLIL (CME) | NASA DONKI | `https://api.nasa.gov/DONKI/CME` | hourly | NASA API key (free, optional) | 📚 |
| Solar flares (CME, GST, RBE) | NASA DONKI | `…/DONKI/{type}` | hourly | optional | 📚 |
| Atomic clock / leap-seconds | NIST / IETF | various | static | None | 📚 (cosmetic) |
| Subsolar point | computed client-side | astronomy formulae | per-tick | None | 🛠 (cool sun marker on globe) |
| Day/night terminator | computed client-side | derived from subsolar | per-tick | None | 🛠 (Cesium has built-in lighting; explicit terminator polyline is +clarity) |

## E. Future events / scheduled

| Layer | Source | Endpoint | Cadence | Auth | Status |
|---|---|---|---|---|---|
| Launches | The Space Devs LL2 | `https://ll.thespacedevs.com/2.2.0/launch/upcoming/` | 30m | None (anon ~15/h) | ✅ |
| Spacewalks | SpaceX / NASA | scattered | — | various | 📚 |
| Astronomical events | Heavens-Above | scrape | — | None | 📚 |
| Eclipses | NASA Eclipse | static catalog | — | None | 📚 |
| Meteor showers | AMS | `https://www.amsmeteors.org/...` | annual | None | 📚 |
| Conjunctions (sat collision risk) | space-track.org CDM | requires account | — | account | 📚 |

## F. Static / reference geo layers

| Layer | Source | Cadence | Auth | Status | Notes |
|---|---|---|---|---|---|
| Airports | OurAirports CSV | one-shot | None | 📚 | ~75K worldwide, with runways. |
| Submarine cables | TeleGeography Submarine Cable Map | one-shot GeoJSON | Permission | 📚 | Free for non-commercial; needs attribution. |
| Internet exchange points | PeeringDB | API | Account | 📚 | |
| Power plants | WRI Global Power Plant DB | one-shot CSV | None | 📚 | ~30K plants worldwide, type + capacity. |
| Cell towers | OpenCelliD | CSV | Free key | 📚 | Massive (30M+); needs sampling. |
| Hospitals / schools | OpenStreetMap Overpass | per-bbox query | None | 📚 | Use only when zoomed in. |
| Country borders | Natural Earth | static GeoJSON | None | 📚 | Already implicit in basemap; could add visible polylines toggle. |
| Time zones | Natural Earth / IANA | static GeoJSON | None | 📚 | |
| Antarctic stations | Wikipedia | static | None | 📚 | |
| Spaceports | LL2 (subset) | derived | None | ✅ (via launches) | |
| ISS visibility for observer | N2YO | API | Free key | 📚 | "When can I see the ISS from my address" |
| Geocoded photo locations (Wikimedia) | Wikipedia API | bbox query | None | 📚 | Cool when zoomed in. |
| Live webcams | windy.com webcams | API | Free key | 📚 | Click area → see live cam. |

## G. Air quality / environmental

| Layer | Source | Endpoint | Cadence | Auth | Status |
|---|---|---|---|---|---|
| Air quality (PM2.5/AQI) | OpenAQ v3 | `https://api.openaq.org/v3/locations` | hourly | Free key (optional for read) | 🛠 |
| Air quality (alt) | World Air Quality Index | aqicn.org API | 1h | Free key | 📚 |
| METAR weather | aviationweather.gov | `…/data/api/data?dataSource=metars&format=json` | 30m | None | 📚 |
| Tides (US) | NOAA CO-OPS | `…/api/datagetter` | 10m | None | 📚 |
| River gauges (US) | USGS Water Services | `https://waterservices.usgs.gov/nwis/iv` | 15m | None | 📚 |
| Buoys / wave height | NDBC | text feeds | 1h | None | 📚 |
| Whale / fish migration | OBIS / GBIF | API | various | None | 📚 |
| eBird sightings | eBird | API | — | Free key | 📚 |

## H. 3D content (Cesium-compatible)

| Asset | Provider | Auth | Status | Notes |
|---|---|---|---|---|
| OSM Buildings | Cesium ion | Free token | 🔌 | `Cesium.createOsmBuildingsAsync()` — entire planet's OSM building footprints extruded. Auto-streams when camera is close. |
| Photorealistic 3D Tiles | Google Maps Platform | Free API key (rate-limited) | 🔌 | `https://tile.googleapis.com/v1/3dtiles/root.json?key=…` — full Google Earth photorealistic mesh, including buildings + terrain. The visual showpiece. |
| Bing Maps 3D | Microsoft / Cesium ion | Free token | 📚 | Older asset. |
| Terrain (real elevation) | Cesium World Terrain | Free token | 🔌 | `Cesium.createWorldTerrainAsync()`. We currently use ellipsoid (flat). |
| Sky box / stars | Cesium built-in | None | ✅ (via skyAtmosphere) | |
| glTF aircraft model | community / Cesium samples | None | 🛠 | Standard `Cesium_Air.glb` — drop in for per-plane 3D when zoomed below ~50 km. |
| glTF ship models | various (sketchfab CC) | None / attribution | 🛠 | Container ship / tanker / cruise / fishing variants. |
| glTF ISS model | NASA 3D Resources | None | 🛠 | Iconic for Stations group close-up. |
| glTF satellite models | NASA / community | None | 📚 | Generic LEO / GEO bus. |
| Volumetric clouds | Cesium / SkyBox | None | 📚 | Recently shipped in CesiumJS. |

## I. LOD strategy (this session's design work)

Visual LOD bands (camera distance from entity):

| Distance | Plane | Ship | Satellite | Hurricane | Volcano | Launch |
|---|---|---|---|---|---|---|
| > 5,000 km | dot | dot | dot | dot | dot | dot |
| 500 km – 5,000 km | rotated airplane SVG | rotated ship SVG | tiny sat icon | cyclone glyph | mountain glyph | concentric rings + countdown |
| < 500 km | larger SVG (heading-aware) | larger SVG | larger sat icon | cyclone glyph + label | mountain glyph + label | rings + label |
| < 50 km | (3D model — next session) | (3D model — next) | (3D ISS / sat — next) | — | — | — |

Heading-aware billboards rotate using `rotation: -toRadians(heading)` (Cesium screen-space CCW radians; nav heading is CW from north).

Ship icons branch on AIS type code (cargo/tanker/fishing/passenger/military/other) — already have `type` field in state.

## J. Rejected / blocked

- **Blitzortung lightning** — community-reverse-engineered WebSocket protocol, ToS forbids 3rd-party clients. Saratoga free tier has rate limits that make the experience worse than no layer.
- **GDELT GEO endpoint** — currently returning 404. Geocoded news will need to come from a different source or be derived (e.g., DOC API + post-geocoding via place-name extraction).
- **ReliefWeb v1/v2** — both 410/403; API retired. ReliefWeb migrated to a different system; no clean replacement found.
- **MarineTraffic / FlightAware vessel-detail APIs** — all gated behind paid plans. Free coverage stops at AIS / ADS-B raw.

## K. Known limits I am willingly accepting

- **OpenSky anonymous rate limit**: ~5–10/min. 15s poll is comfortable but bursts can 429. Loop already handles backoff. Authenticated account would lift this.
- **Celestrak Starlink rate limiting**: their server intermittently 403s the `GROUP=starlink` endpoint. Cap is 500 anyway; if it 403s we just don't get Starlink that cycle.
- **AIS firehose volume**: ~50–100 msg/sec global. Today a dict of ~50K vessels. If memory grows we narrow the bounding box.
- **NWS API (US-only alerts)**: Tsunami feed only carries US-issued tsunami advisories. Pacific Tsunami Warning Center has its own ATOM feed for international that we could add.

## L. Recommended next-session adds (priority order)

1. **3D buildings** via Cesium ion (`createOsmBuildingsAsync`). Auto-enables when `CESIUM_ION_TOKEN` is set. THIS ITERATION.
2. **Photorealistic 3D Tiles** (Google) — toggle in WEATHER/imagery section, gated on `GOOGLE_MAPS_API_KEY`. THIS ITERATION.
3. **glTF aircraft / ship / ISS models** at <50 km zoom. Requires bundling small `.glb` assets and licensing review.
4. **Aircraft type DB** (OpenSky CSV one-shot) → type-aware plane icons.
5. **Subsolar point + day/night terminator** (computed, no network).
6. **OpenAQ air quality** as new EARTH layer.
7. **Tornadoes / severe weather** via NWS active alerts (US).
8. **NASA DONKI** space-weather events (CME / GST / RBE) as ALERTS.
9. **Volcanic activity status** (GVP weekly bulletin) — color volcanoes by recent-activity flag.
10. **Submarine cables / power plants / airports** as static reference layers.
