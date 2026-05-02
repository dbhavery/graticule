# Overwatch

Personal situational-awareness globe. Spin the Earth, watch live planes and
ships, click for details, toggle layers. Local-first, dark UI, single window.

## Quick start

```bash
cd C:/Users/dbhav/Projects/vantage
uv sync
uv run python main.py
```

The window opens with planes streaming in from OpenSky immediately. No keys
required for the default load.

## Add ships (free, ~30 seconds)

1. Register at https://aisstream.io
2. `cp .env.example .env` and paste your key into `AISSTREAM_KEY=`
3. Restart — global ship positions stream in alongside the planes

## Optional: Cesium ion (better imagery)

Set `CESIUM_ION_TOKEN` in `.env` to a free token from https://ion.cesium.com.
Without it, Overwatch falls back to ESRI World Imagery (still looks great).

## Architecture

See `PLAN.md`. tl;dr: pywebview shell → CesiumJS globe → FastAPI backend on
`127.0.0.1:8731` → async feed loops (OpenSky polling, AISStream WebSocket) →
in-memory state → WebSocket fan-out to the UI.

## Phase status

- [x] Phase 1 — Globe + planes
- [ ] Phase 1.1 — Ships (waiting on `AISSTREAM_KEY`)
- [ ] Phase 2 — Satellites, weather, fires, quakes, lightning
- [ ] Phase 3 — Time scrubber, saved presets, lock-camera-to-target
- [ ] Phase 4 — Personal awareness (Home Assistant, Frigate)
- [ ] Phase 5 — Cross-project hooks (Aether, Morning Intel, Vault)
