# Vantage — Build Plan

> Personal situational-awareness globe. Spin the Earth, watch ships and planes
> in real time, click for details, toggle layers. Inspired by the visual UX of
> systems like Maven Smart System — minus the targeting, just the awareness.

## Codename

`vantage` — single word, evokes "vantage point", no military overtones.
Rename anytime via folder + window title + repo name.

## Phase 1 — MVP (this session)

**Goal:** A dark globe in a desktop window that shows live planes the moment
you launch it. Click a plane → side panel with details. Layer toggle.

- pywebview shell, single window, dark
- CesiumJS via CDN — no Cesium ion token required (uses ESRI World Imagery)
- FastAPI backend on `127.0.0.1:8731`
  - `/` → static `web/index.html`
  - `/api/snapshot` → current state (planes, ships)
  - `/ws` → WebSocket pushing live updates
- One feed live on first launch:
  - **OpenSky Network** — anonymous REST poll every 15s for global ADS-B planes
- Stale entries (no update in 5 min) auto-expire.

## Phase 1.1 — Add ships

Ride free with an API key.

1. Register at https://aisstream.io (free, instant)
2. Drop `AISSTREAM_KEY=...` into `.env`
3. Restart — global ship positions stream in via WebSocket

## Phase 2 — More public layers

All free, all real-time. Add as separate feed modules, same WebSocket protocol.

| Layer | Source | Notes |
|---|---|---|
| Satellites | Celestrak TLE + satellite-js client-side | Computes orbit on the fly |
| Earthquakes | USGS GeoJSON | 1-min poll |
| Wildfires | NASA FIRMS | 5-min poll |
| Weather radar | RainViewer tile layer | Cesium imagery layer |
| Lightning | Blitzortung WebSocket | Real-time pulse animation |
| News pins | GDELT geocoded events | Optional |

## Phase 3 — Time + presets

- Cesium's built-in time scrubber → replay history
- Saved camera views ("Pacific traffic", "Europe weather", "PDX approach")
- Tracking mode: lock camera to a plane/ship

## Phase 4 — Personal awareness layer (deferred)

Switch from "watching the world" → "watching my world too".

- Home Assistant as broker (one WebSocket integrates ~3000 device types)
- Frigate for camera detections (person/car/package events)
- "Home" view preset zooms to address; indoor floor plan overlay
- Same pin/click/panel UX; new producer pointing at the same renderer

## Phase 5 — Cross-project hooks (further deferred)

- Click ship → Aether researches it
- Plane lands at PDX → Morning Intel adds the route to daily digest
- Save geo-points to Vault as notes

## Architecture

```
┌────────────────────────────────────────┐
│ pywebview window (Vantage)             │
│ ┌────────────────────────────────────┐ │
│ │ CesiumJS globe + HUD overlay       │ │
│ │  ↑ WebSocket /ws (live updates)    │ │
│ └────────────────────────────────────┘ │
└──────────────────│─────────────────────┘
                   │ HTTP + WS
┌──────────────────┴─────────────────────┐
│ FastAPI server (127.0.0.1:8731)        │
│  - StateStore (in-memory dict)         │
│  - /api/snapshot, /ws                  │
└──────────────────│─────────────────────┘
                   │ async tasks
       ┌───────────┼───────────┐
       │           │           │
   ┌───┴───┐   ┌───┴───┐   ┌───┴────┐
   │OpenSky│   │AISStrm│   │  …more │
   │ poll  │   │  WS   │   │ feeds  │
   └───────┘   └───────┘   └────────┘
```

## Constraints

- Local-first — no data leaves the machine
- Dark theme, minimal HUD
- HTML/CSS/JS via pywebview (Don's locked rule: no Tkinter/Qt for visual UI)
- Single `uv run python main.py` to launch
- Autostart-friendly (HKCU\...\Run) once stable

## Out of scope (do not build)

- Anything resembling targeting, fires, kill-chain, or weapons
- Surveillance of identified people without consent
- Cloud sync, multi-user, accounts
