# Overwatch

Personal situational-awareness globe. Live planes, ships, satellites, quakes,
fires, weather, alerts, parcels — all on a single dark Cesium-driven Earth.
Local-first, single window, no cloud sync.

## What's on the globe

- **AIR** — planes (OpenSky ADS-B), satellites (Celestrak TLE, propagated client-side), airports, TFRs
- **SEA** — ships (AISStream), hurricanes (NOAA NHC)
- **EARTH** — earthquakes (USGS), volcanoes (Smithsonian GVP), wildfires (NASA FIRMS)
- **WEATHER** — radar (RainViewer), aurora (NOAA SWPC), city-lights overlay (NASA GIBS), day/night terminator
- **REFERENCE** — submarine cables (TeleGeography)
- **LAND** — parcel boundaries (Regrid US-wide tiles + WA statewide vector)
- **3D** — OSM buildings + Google Photorealistic 3D Tiles (key-gated)
- **SPACE** — rocket launches (Launch Library 2)
- **ALERTS** — tsunami, severe weather, EONET natural events

Plus a top telemetry bar (UTC, cursor, altitude, Kp, X-ray, tracked total),
a docked alerts panel, optional live-feed ticker, compass + tilt indicator,
camera presets, and a settings modal.

## Quick start

```bash
git clone https://github.com/<you>/overwatch.git
cd overwatch
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

This is a personal project. "Overwatch" is unaffiliated with the Blizzard
Entertainment trademark. Do not redistribute under that name.

Cesium World Imagery © Cesium / Microsoft. Parcel data © Regrid (US tiles)
and Washington State DOR (vector). Other feeds credited per their public
APIs (OpenSky, USGS, NASA, NOAA, NHC, FAA, Smithsonian GVP, etc.).
