# Graticule

Personal situational-awareness globe and weather workstation. A physically
real Earth — real-time sun, moon, day/night and city lights — carrying live
radar, satellite, models, observations, warnings, plus planes, ships,
satellites, quakes, fires and parcels. Local-first, single window, no cloud
sync.

## The Earth

The globe runs on the system clock, so the solar terminator sweeps westward at
a true 15°/hour and matches real UTC:

- Real-time sun lighting with a wide dusk falloff and dynamic ground/sky
  atmospheric scattering
- VIIRS city lights composited onto the night hemisphere only
- Moon at its true ephemeris position and phase; stars; HDR tone mapping;
  sun glow
- **Stay centred on North America** — the camera holds the continent while the
  sunlight rotates around it. Re-centres only after 12 s idle, above 3 Mm, and
  past 12° of drift, so panning and zooming stay free.

## Tabs

The left rail is tabbed: **WEATHER / EARTH / SKY / WORLD**.

**WEATHER** — mode chips for Radar, Satellite, Model, Observations and Outlooks

- *Radar* — national mosaic as a scrubable, playable frame loop over past and
  nowcast frames with an explicit NOW marker; local hi-res single-site NEXRAD
  (30 sites, reflectivity + velocity); dBZ legend and frame timestamp
- *Satellite* — GOES-East / GOES-West visible, infrared and water vapour, plus
  a global true-colour composite
- *Model* — GFS / HRRR / NAM / ECMWF / ICON fields for 2 m temperature,
  precipitation, 10 m wind, CAPE and MSLP, sampled over the current view
- *Observations* — METAR station plots, US AQI, Local Storm Reports
- *Outlooks* — NWS warning cards with polygons, SPC convective outlooks
  (days 1-3), tropical, aurora

**EARTH** — quakes (USGS), volcanoes (GVP), wildfires (FIRMS), ships
(AISStream), submarine cables, boundaries, cities, parcels, 3D buildings

**SKY** — planes (OpenSky), airports, TFRs, airspace, satellites (Celestrak
TLE propagated client-side), launches, and the celestial realism switches

**WORLD** — live world-population telemetry: running total, today's
births/deaths/growth, per-continent and top-15 country ranks, next-milestone
tracker. Projected from UN WPP 2024, and the pane says so.

Plus a telemetry bar (UTC, cursor, altitude, subsolar point, moon phase, Kp,
X-ray, tracked total), warning cards, drawing tools, a map theme picker,
alerts panel, live-feed ticker, compass, camera presets and a settings modal.

## Quick start

```bash
git clone https://github.com/<you>/graticule.git
cd graticule
cp .env.example .env       # see "API keys" below — most are optional
uv sync
uv run python main.py
```

**Requirements**

- Python 3.13 (3.14 doesn't load pythonnet on Windows; pinned in `.python-version`)
- [uv](https://docs.astral.sh/uv/) for dependency management
- Windows / macOS / Linux — pywebview-driven; tested on Windows 11

The window opens within ~30s. Layers default to off — toggle the ones you
want from the left sidebar.

## API keys (all optional, all free)

Copy `.env.example` to `.env` and fill in whichever you want:

| Key | What it unlocks | Where |
|---|---|---|
| `AISSTREAM_KEY` | Live ship positions (~6000 vessels) | https://aisstream.io |
| `FIRMS_MAP_KEY` | Wildfire detections (NASA FIRMS, ~80k/day) | https://firms.modaps.eosdis.nasa.gov/api/ |
| `CESIUM_ION_TOKEN` | High-res Bing-backed imagery + OSM Buildings 3D | https://ion.cesium.com |
| `GOOGLE_MAPS_API_KEY` | Google's Photorealistic 3D Tiles (full Earth mesh) | https://developers.google.com/maps/documentation/tile/3d-tiles-overview |
| `OPENSKY_USER` / `OPENSKY_PASS` | Smooth ADS-B polling (anon tier rate-limits hard) | https://opensky-network.org/ |

Without any keys, the globe still launches with quakes, satellites, volcanoes,
weather, alerts, and parcels working out of the box.

## Architecture

```
pywebview window
  └── CesiumJS 1.121 + satellite-js
       ↓ HTTP + WebSocket /ws
  FastAPI backend (127.0.0.1:8731)
       └── async feed loops → in-memory StateStore → WS fan-out
```

- 16 async feed loops (OpenSky polling, AISStream WebSocket, USGS, NOAA, NASA, etc.)
- Generic StateStore — `replace_layer(name, dict)` triggers `<name>:reset` over WS
- Frontend renders entities via `CustomDataSource`, with per-layer LOD via
  Cesium clustering and per-entity DistanceDisplayCondition

See `PLAN.md` and `RESEARCH.md` for the original phased plan and the 60+
public-API catalog.

## Controls

- **Hover** dot for ~500 ms → tooltip (delay configurable in Settings)
- **Click** → right-side detail panel
- **Right-click** anywhere → "Center camera here" / "Save as preset"
- **Header pills** (top-right) → toggle ALERTS panel and LIVE FEED
- **Gear icon** → Settings (units, hover delay, sound, camera presets)
- **Mouse wheel** → zoom; below 50 km the plane dot swaps to a 3D model

## Performance notes

- All crowded layers (planes / ships / fires / airports / satellites / quakes)
  are clustered via Cesium's `EntityCluster` so the world view stays readable.
- Importance-gated visibility per layer (M5+ quakes always show; M2 only at
  city zoom; large airports always; small airports only when close, etc.)
- Stationary background fades out under 10 km altitude so parcels and
  buildings own the close view.

## License & names

This is a personal project. "Graticule" refers to the network of meridians
and parallels drawn on a globe — apt for a situational-awareness Earth.

Cesium World Imagery © Cesium / Microsoft. Parcel data © Regrid (US tiles)
and Washington State DOR (vector). Other feeds credited per their public
APIs (OpenSky, USGS, NASA, NOAA, NHC, FAA, Smithsonian GVP, etc.).
