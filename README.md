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

## The opening frame

It opens on North America with the national radar mosaic running, boundaries
drawn and the colour scale up. The frame is a `Rectangle` destination rather
than a fixed altitude, so Cesium solves for the height that fits whatever
viewport it is given and the composition survives the rail, presentation mode
and any window size.

While a field is drawn over it, the base map is graded down — brightness 0.58,
saturation 0.34 — because ESRI imagery over CONUS is bright green and tan and
20 dBZ blue on it is close to unreadable. Switchable in Mapping. With nothing
over it the base keeps the contrast-forward grade the realistic globe wants.

## The rail

A docked, full-height panel on the left that the map starts to the right of.
Top to bottom: the division you are driving, three mode tabs, tool icons, then
the division grid, the controls for whichever division is selected, and a
pinned footer listing every layer currently drawing with the health of the
feeds behind them. It collapses with `\`.

**DATA** — nine divisions in a 3-across grid

- *Radar* — national mosaic as a scrubable, playable frame loop over past and
  nowcast frames, with both ends of the window labelled and a marker on the
  newest observed frame that reads NOW when a nowcast follows it and LATEST
  when RainViewer is not publishing one; local hi-res single-site NEXRAD
  (30 sites) with six products: super-res and legacy reflectivity, base and
  storm-relative velocity, long-range reflectivity, echo tops. No tilt
  selector — the keyless tile service publishes the lowest elevation cut only
  and every higher tilt answers 503, so selecting 1.5° or 2.4° would need a
  server-side Level II decoder.
- *Model* — GFS / HRRR / NAM / ECMWF / ICON fields for 2 m temperature,
  precipitation, 10 m wind, CAPE, MSLP and the mesoanalysis set, sampled over
  the current view; a 48-hour forecast-hour scrubber that re-renders off a
  cached series rather than refetching, so dragging it costs nothing; single,
  compare-runs and compare-models
- *Satellite* — GOES-East / GOES-West visible, infrared and water vapour, plus
  a global true-colour composite
- *Observations* — METAR station plots, US AQI, Local Storm Reports, live
  public cameras, spotter reports
- *Outlooks* — SPC convective outlooks (days 1-3), tropical, aurora
- *Mapping* — base imagery, reference lines, parcels, subsea cables, and the
  area-darkening scope that limits the frame to a set of counties
- *Earth* — quakes (USGS), volcanoes (GVP), wildfires (FIRMS), ships
  (AISStream), river gauges, tide stations, marine buoys
- *Sky* — planes (OpenSky), airports, TFRs, airspace, satellites (Celestrak
  TLE propagated client-side), launches, and the celestial realism switches
- *World* — live world-population telemetry: running total, today's
  births/deaths/growth, per-continent and top-15 country ranks, next-milestone
  tracker. Projected from UN WPP 2024, and the pane says so.

**NWS ALERTS** — everything in effect right now, coloured with the National
Weather Service's own published table (111 events, taken verbatim from
weather.gov/help-map) and ranked by that table's order, which is the
service's own display priority. Counted by product type at
the top and listed as cards underneath, scopeable to the current view or to
warnings only. Reads the feed, so it is current with the polygon layer off.

**BROADCAST** — the graphics that stay up in presentation mode (data readout,
warning banner, colour scale, station bug) and the scene deck.

## Dashboards

Full-frame boards, opened from their division, each re-reading its source on
open and every 30 s. They read the feed rather than the scene, so a board is
complete with every layer switched off.

- **Severe weather** — what is in effect by type and by state, the impact
  products with their hazard parameters and expiry, the SPC Day 1 outlook,
  and storm reports from the past 12 hours
- **Tropical** — active NHC systems with intensity, pressure and category,
  the Saffir-Simpson scale, marine and coastal products, tropical products in
  effect
- **Water** — river gauges by flood category with the worst gauges named,
  buoy sea state ranked by significant wave height, tide-station census
- **Geophysical** — quake census by magnitude band, largest quakes with depth
  and age, hottest fire detections, volcano and EONET counts
- **Space weather** — planetary Kp against the NOAA G-scale, X-ray flux class,
  orbital population, the launch window from T−1 h onward
- **World population** — the full-frame board behind the World division

Plus a telemetry bar (UTC, cursor, altitude, subsolar point, moon phase, Kp,
X-ray, tracked total), a bottom transport, a standing colour scale on the
right edge of the map, an alerts panel, live-feed ticker, compass, camera
presets and a settings modal.

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
want from the left rail.

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

- **`Ctrl` + `K`** → command palette over everything reachable by name: tabs,
  divisions, dashboards, every layer, radar products, radar sites, base maps,
  saved views and the actions. Subsequence matching, so `srv` reaches Storm
  Relative Velocity. The index is rebuilt from the live DOM on each open, so it
  cannot offer a control that is not there.
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
