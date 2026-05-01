# Vantage — Session Handoff

> **Session date:** 2026-04-30 (PT)
> **Repo state:** branch `dev` checked out, working tree clean, init commit `9577dd9` on `master`.
> **Live status:** Phase 1 MVP shipped + visually verified. Window currently running on monitor 0 at (200, 150).
> **For the next agent:** read this top-to-bottom before touching anything. The "Starting prompt" at the bottom is what Don will paste to boot you.

---

## TL;DR — Where things stand

- **Vantage** is a brand-new project (Don's personal situational-awareness globe). Phase 1 = "globe + live planes" is shipped, runs in a pywebview window, ~7000 plane dots animated via OpenSky's anonymous ADS-B feed.
- **Two unresolved threads carry over from this session** (both on Don's other projects, NOT Vantage):
  1. **QuickGrid window-clipping** on his secondary monitor (1280×800) — the MAX USAGE row Don wanted to see is rendered but pushed off-screen because the QuickGrid window is 1081px tall and his configured monitor is only 800px tall. Options surfaced, no decision made. See "Open threads" below.
  2. **Personal Palantir research brief** at file:///C:/Users/dbhav/Projects/.research/palantir-style-personal-platform.md — Don pivoted away from building it ("cool globe" is what he actually wanted). Brief is preserved for future reference but is not the active build path.
- The "Personal Palantir / federated MCP / typed contracts" architecture I sketched mid-conversation is **not the active project**. Don rejected it in favor of the visual globe. Don't drift back to that unless he explicitly resurfaces it.

---

## What shipped this session (Vantage Phase 1)

### Architecture (one-pager)

```
┌─────────────────────────────────────────┐
│ pywebview window (Vantage)              │
│ ┌─────────────────────────────────────┐ │
│ │ CesiumJS globe + dark HUD overlay   │ │
│ │  ↑ WebSocket /ws (live deltas)      │ │
│ └─────────────────────────────────────┘ │
└──────────────────│──────────────────────┘
                   │ HTTP + WS
┌──────────────────┴──────────────────────┐
│ FastAPI server (127.0.0.1:8731)         │
│  - StateStore (in-memory dict + fan-out)│
│  - /api/snapshot, /api/config, /ws      │
└──────────────────│──────────────────────┘
                   │ async tasks
       ┌───────────┼───────────┐
       │           │           │
   ┌───┴───┐   ┌───┴────┐  ┌───┴────┐
   │OpenSky│   │AISStrm │  │_expire │
   │ poll  │   │  WS    │  │ loop   │
   │ 15s   │   │(needs  │  │ 60s    │
   │       │   │ key)   │  │        │
   └───────┘   └────────┘  └────────┘
```

### Key decisions (and *why*, so you can revise intelligently)

| Decision | Rationale |
|---|---|
| **pywebview shell, not Tauri** | Don's locked feedback rule: HTML/CSS/JS via pywebview is the default for new UI. Tauri stays reserved for Aether's existing Rust toolchain. |
| **CesiumJS via CDN, not npm** | No build step. Single HTML file + JS file. Easy to iterate on. |
| **ESRI World Imagery, not Cesium ion** | No token required to ship the MVP. Looks great. `CESIUM_ION_TOKEN` in `.env` upgrades to ion if Don ever wants higher-res terrain. |
| **OpenSky anonymous, 15s poll** | Free, no signup, polite cadence. Anonymous endpoint is rate-limited but fine for personal use. |
| **AISStream WebSocket for ships** | Free, instant signup, real-time global AIS firehose. Whole-world bounding box configured. |
| **In-memory StateStore, no DB** | Phase 1 has no persistence requirement. State is ephemeral. If Don wants history/replay (Phase 3 — time scrubber), add SQLite then. |
| **Python 3.13, NOT 3.14** | pywebview's WinForms backend depends on `pythonnet`, which fails to initialize `Python.Runtime.dll` on Python 3.14. Pinned via file:///C:/Users/dbhav/Projects/vantage/.python-version. Revisit when pythonnet ships 3.14 wheels that load cleanly. |
| **Single-process app** | Server runs in a daemon thread inside `main.py`. Closing the window kills everything. Simple. |
| **ESRI `UrlTemplateImageryProvider`, not `ArcGisMapServerImageryProvider`** | The newer provider needed an async factory (`fromProviderAsync`) which complicated bootstrap; the URL template variant is one-line and works. |

### File map

| Path | Purpose |
|---|---|
| file:///C:/Users/dbhav/Projects/vantage/PLAN.md | Phased build plan (1 → 5). Phase 4 = personal awareness (Home Assistant + Frigate). Phase 5 = Aether/Vault/Morning Intel hooks. |
| file:///C:/Users/dbhav/Projects/vantage/README.md | User-facing quick-start |
| file:///C:/Users/dbhav/Projects/vantage/HANDOFF.md | This file |
| file:///C:/Users/dbhav/Projects/vantage/pyproject.toml | uv project, deps pinned to Python 3.13 |
| file:///C:/Users/dbhav/Projects/vantage/.python-version | `3.13` |
| file:///C:/Users/dbhav/Projects/vantage/.env.example | `AISSTREAM_KEY=`, `CESIUM_ION_TOKEN=` |
| file:///C:/Users/dbhav/Projects/vantage/main.py | pywebview launcher; spawns server thread, opens window |
| file:///C:/Users/dbhav/Projects/vantage/vantage/server.py | FastAPI app: `/`, `/api/snapshot`, `/api/config`, `/ws`, `/static/*` |
| file:///C:/Users/dbhav/Projects/vantage/vantage/state.py | `StateStore`: dicts of planes/ships, broadcast fan-out, 5-min expiry |
| file:///C:/Users/dbhav/Projects/vantage/vantage/feeds/adsb.py | OpenSky polling loop (15s, anonymous) |
| file:///C:/Users/dbhav/Projects/vantage/vantage/feeds/ais.py | AISStream WebSocket consumer (skips with warning if no key) |
| file:///C:/Users/dbhav/Projects/vantage/web/index.html | Cesium + HUD layout |
| file:///C:/Users/dbhav/Projects/vantage/web/style.css | Dark theme, glass-card HUD, side panel |
| file:///C:/Users/dbhav/Projects/vantage/web/app.js | Globe init, WebSocket handling, entity collections, click → panel |

### Commands cheat sheet

```bash
# From C:/Users/dbhav/Projects/vantage/

# Run normally (window opens, daemon thread serves backend)
uv run python main.py

# Smoke-test server only (no window) — useful when iterating on backend
.venv/Scripts/python.exe -c "
import threading, time, urllib.request, json
from vantage.server import run_server
threading.Thread(target=run_server, args=(8732,), daemon=True).start()
time.sleep(2)
print(json.loads(urllib.request.urlopen('http://127.0.0.1:8732/api/snapshot').read()))
"

# Re-sync deps after pyproject changes
uv sync

# Find the running window (for screenshots / focus)
python -c "
import win32gui
def cb(h, l):
    if win32gui.IsWindowVisible(h) and win32gui.GetWindowText(h) == 'Vantage':
        l.append((h, win32gui.GetWindowRect(h)))
hs = []; win32gui.EnumWindows(cb, hs); print(hs)
"
```

---

## Open threads (priority order)

### 1. **QuickGrid window-clipping** (CARRIES OVER FROM THIS SESSION — UNRESOLVED)

**Don explicitly raised this and we left it without a decision.**

- **Symptom:** Don can't see the MAX USAGE tiles in QuickGrid even after the daemon fix landed. Daemon JSON is fresh; widget code renders correctly when the window has room.
- **Root cause:** QuickGrid window is 848×1081 logical pixels (header 100 + grid ~600 + resource monitor ~200 + FiveHourWidget 160 + spacing). Don's configured monitor (`window.monitor: 2` in file:///C:/Users/dbhav/Projects/QuickGrid/config.yaml) is only 1280×800. Bottom ~280px (resource monitor lower row + entire MAX USAGE row) clip off the bottom edge.
- **Has been clipping since 2026-04-21** when the FiveHourWidget was added (commit `577f4b9` on QuickGrid master). Don may not have noticed because the bottom row simply wasn't rendered visibly.
- **Three options surfaced, awaiting Don's pick:**
  1. **Quick:** flip `window.monitor: 2 → 1` in config.yaml. Moves QuickGrid to the big screen.
  2. **Medium:** drop grid rows from 5 to 3 in QuickGrid (most are empty `Add` slots anyway), recovers ~250px.
  3. **Full:** restructure layout so resource monitor + MAX USAGE collapse into a compact mode on small monitors.
- **Don's preference unknown.** Ask before touching QuickGrid code.
- **Daemon side is fully fixed and committed**: file:///C:/Users/dbhav/.claude/hooks/claude_usage_daemon.py, commit `057afd0` on `main` of file:///C:/Users/dbhav/.claude/. JSON at file:///C:/Users/dbhav/.claude/claude-ai-usage.json is fresh, `stale: false`.

### 2. **Vantage Phase 1.1 — add ships (waiting on Don's manual step)**

- Don needs to register at https://aisstream.io (free, instant)
- Copy `AISSTREAM_KEY=…` into file:///C:/Users/dbhav/Projects/vantage/.env (file does not yet exist; Don creates from `.env.example`)
- Relaunch — global ship positions stream in via existing `aisstream_loop` in file:///C:/Users/dbhav/Projects/vantage/vantage/feeds/ais.py
- **No code change required**; the consumer is already wired and dormant.

### 3. **Vantage Phase 2 — more public layers**

Spec is in file:///C:/Users/dbhav/Projects/vantage/PLAN.md. In rough order of impact / ease:

| Layer | Source | Effort | Notes |
|---|---|---|---|
| Earthquakes | USGS GeoJSON (https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson) | 1h | Simple poll, magnitude → dot size |
| Wildfires | NASA FIRMS (https://firms.modaps.eosdis.nasa.gov/api/) | 1-2h | Needs free MAP_KEY, CSV poll |
| Weather radar | RainViewer (https://api.rainviewer.com/public/weather-maps.json) | 1-2h | Cesium imagery layer overlay |
| Lightning | Blitzortung WebSocket | 2-3h | Live pulse animation |
| Satellites | Celestrak TLEs + satellite-js client-side propagation | 3-4h | Coolest visual, most code |

Each is a new file under `vantage/feeds/`, registered as an asyncio task in `server.py`'s `lifespan`, plus a render path in `app.js` and a layer toggle in `index.html`.

**Suggested order if going next:** earthquakes (cheapest, immediately satisfying) → wildfires → satellites (the visual showpiece).

### 4. **Vantage UX polish backlog**

Things noticed but not fixed in Phase 1:
- Click handler currently uses raw `pick()` — works for points, may miss when zoomed out and entities are tiny. May want a small click radius.
- No "follow this entity" mode (camera locks to a moving plane)
- Panel doesn't show photos / external links (e.g., flightaware.com/live/flight/{callsign})
- No keyboard shortcuts (esc to close panel, l to toggle layers, etc.)
- Cesium credits hidden via `creditContainer` div trick — verify this is allowed by ESRI's tile ToS before any wider release. For personal use, fine.
- Window position not persisted; opens at default 1600×1000 each launch.

### 5. **Personal Palantir research brief — DEFERRED**

- Brief at file:///C:/Users/dbhav/Projects/.research/palantir-style-personal-platform.md
- Don pivoted away from building this. **Do NOT volunteer it.** It exists for reference if Don revisits.
- The recommended weekend MVP in the brief (Postgres+AGE+pgvector + 3 object resolvers + 1 Aether tool) is genuinely good if Don ever wants the data-fabric layer — but it's a different project from Vantage.

### 6. **`~/.claude` repo has uncommitted noise**

- file:///C:/Users/dbhav/.claude/ has many staged-but-not-committed changes (deleted `commands/gsd/*` files etc) unrelated to this session.
- I committed ONLY the daemon fix (`057afd0`) and intentionally left the rest alone.
- If Don asks "is the .claude repo clean?" — answer is no, but the noise predates this session.

---

## Gotchas the next agent will hit

1. **Pythonnet on 3.14** — if the venv accidentally rebuilds with 3.14, pywebview crashes with `RuntimeError: Failed to initialize Python.Runtime.dll`. The `.python-version` file pins 3.13. Don has both Pythons installed.
2. **Window appears behind other apps** — pywebview launches the window but doesn't always raise it to the foreground. Use `win32gui.SetWindowPos(h, HWND_TOPMOST, ...)` + `HWND_NOTOPMOST` flicker trick if you need to screenshot it. See file:///C:/Users/dbhav/Projects/vantage/HANDOFF.md commands cheat sheet.
3. **Multi-monitor screenshot** — Don has two monitors: monitor 0 = 5120×1440 (top), monitor 1 = 1280×800 (bottom, virtual coords (1178, 1440) → (2458, 2240)). `pyautogui.screenshot` only sees the primary virtual desktop unless you pass `all_screens=True` to `PIL.ImageGrab.grab(bbox=..., all_screens=True)`. The windows-app-pilot tool's per-window screenshot returns BLACK for windows on non-primary screens — use the PIL ImageGrab pattern instead.
4. **Cesium 1.121 imagery API** — newer Cesium versions deprecate the `Cesium.Viewer({imageryProvider: ...})` constructor option. Use `viewer.imageryLayers.removeAll()` then `viewer.imageryLayers.addImageryProvider(...)`.
5. **`Cesium.Ion.defaultAccessToken = ''`** suppresses the default-token nag. Required when not using ion at all.
6. **OpenSky anonymous limits** — the endpoint is rate-limited to ~5-10 requests/min per IP. 15s poll cadence is safe. If you back off (HTTP 429), the loop already sleeps 60s before retrying. Don't burst.
7. **AISStream firehose volume** — global bounding box returns ~50-100 messages/sec. The current implementation upserts every position into `state.ships` (dict), which is fine for ~50K vessels. If memory grows, narrow the bounding box.
8. **WebSocket fan-out is fire-and-forget via `asyncio.create_task`** — works because state mutations happen inside async loops with a running event loop. If you ever upsert from a sync context, this will silently drop.
9. **CRLF line ending warnings** in git — Windows default. Harmless.
10. **The repo's main branch is `master`** (git init default at the time), not `main`. Future work happens on `dev`. Merge to `master` for releases.

---

## Don's preferences relevant here

(From file:///C:/Users/dbhav/.claude/CLAUDE.md, file:///C:/Users/dbhav/Projects/CLAUDE.md, and locked feedback memory entries — read those first.)

- **Direct, no fluff.** State what changed, what broke, what's next.
- **Don't ask — just execute** for tactical work he's already authorized. Ask for genuinely ambiguous decisions (e.g., the QuickGrid layout fix has 3 options, those need his input).
- **Self-test before showing him.** Visual artifacts get a multimodal screenshot self-test. Frontend changes get used-as-user. Diff/unit tests are not sufficient. (This rule was burned in earlier this session when I claimed visual verification but had screenshot a different position than his real config.)
- **Clickable file links** — every path Don might want to click MUST be `file:///C:/...` with forward slashes, no backticks, no markdown wrapping, no quotes. The Windows Terminal only auto-linkifies bare URLs.
- **HTML/CSS/JS via pywebview** for new visual UI. NEVER Tkinter or Qt for UI. (Why Vantage is pywebview, not PySide6.)
- **Local-first.** No data leaves the machine. No accounts. No cloud sync.
- **Dark theme, minimal, clean.** No clutter.
- **Open files in VS Code with `code <path>`** when editing/creating (skipped this for the bulk Write phase; the next agent can `code C:/Users/dbhav/Projects/vantage` to open the workspace).
- **Don is on Pacific time.** Max plan peak hours are 5–11am PT weekdays.

---

## Verification trail (proof Phase 1 is real)

1. `uv sync` succeeded with Python 3.13 (Python 3.14 attempt failed due to pythonnet — pinned to 3.13 via `.python-version`).
2. Backend smoke test: `/api/config`, `/api/snapshot`, `/` all returned 200 with sensible payloads.
3. App launched via `start "" .venv/Scripts/pythonw.exe main.py`. Window enumeration found `Vantage` at hwnd `150671172`, rect (104, 104) → (1704, 1104).
4. Window was behind the terminal; brought to top via `SetWindowPos(HWND_TOPMOST)` + `HWND_NOTOPMOST` flicker.
5. Screenshot captured via `PIL.ImageGrab.grab(bbox=(104,104,1704,1104), all_screens=True)`. Result showed: dark Earth-at-night globe, ~7000 yellow plane dots clustered over land, HUD top-left with VANTAGE title + layer toggles + counts.
6. OpenSky loop logged successful polls (`ADS-B: poll returned 7195 states, 7100 positioned, 7100 tracked` — counts will vary).
7. AIS loop logged the expected skip: `AISSTREAM_KEY not set — AIS feed disabled`.
8. Initial commit `9577dd9` landed on `master`; `dev` branch created and checked out.
9. Window repositioned to (200, 150) on monitor 0 for Don to view.
10. Test screenshots cleaned from `.pilot/`.

---

## Starting prompt for next session

Paste this into a fresh Claude Code session under file:///C:/Users/dbhav/Projects/vantage/ (or root):

```
Read file:///C:/Users/dbhav/Projects/vantage/HANDOFF.md top to bottom before
doing anything else. Then read file:///C:/Users/dbhav/Projects/vantage/PLAN.md.

Current state: Vantage Phase 1 is shipped on dev (init commit 9577dd9 on
master). Globe + OpenSky planes work; AIS ships are wired but waiting on
AISSTREAM_KEY in .env.

Two unresolved threads from the prior session:
  1. QuickGrid window-clipping on monitor 2 — bottom ~280px of QuickGrid
     (including the MAX USAGE row whose daemon fix just landed) is rendered
     off-screen. Three options surfaced; Don has not picked. See HANDOFF.md
     "Open threads → 1".
  2. Don may have registered an AISSTREAM_KEY since last session. Check
     file:///C:/Users/dbhav/Projects/vantage/.env. If present, the next launch
     will show ships automatically — no code change needed.

Before suggesting next steps, ask Don:
  - "What do you want to tackle first: the QuickGrid clipping issue, AIS
    ships verification, or Vantage Phase 2 (satellites / earthquakes /
    wildfires / weather)?"
  - DO NOT auto-pick. DO NOT volunteer the personal-Palantir brief unless he
    raises it himself.

Confirm Vantage still launches before changing anything:
  cd C:/Users/dbhav/Projects/vantage
  uv run python main.py
  # Window appears, planes visible within ~20s. Close to terminate.

Don's locked rules (load only those that apply, do not preload):
  - file:///C:/Users/dbhav/Projects/CLAUDE.md (cross-project)
  - file:///C:/Users/dbhav/.claude/CLAUDE.md (global, includes clickable-link rule)
  - file:///C:/Users/dbhav/.claude/projects/C--Users-dbhav-Projects/memory/MEMORY.md
    (project memory index — pull project-specific files as needed)

Effort: medium by default. Don will say /effort if he wants to change.
```

---

## Memory entries to update at session end

If the next session ships meaningful work on Vantage, add a one-line update to file:///C:/Users/dbhav/.claude/projects/C--Users-dbhav-Projects/memory/MEMORY.md under "Active Projects" and a fuller note in file:///C:/Users/dbhav/.claude/projects/C--Users-dbhav-Projects/memory/project_vantage.md (created this session — see "Memory entries created" below).

### Memory entries created this session

- file:///C:/Users/dbhav/.claude/projects/C--Users-dbhav-Projects/memory/project_vantage.md — project state, architecture, gotchas
- Updated file:///C:/Users/dbhav/.claude/projects/C--Users-dbhav-Projects/memory/MEMORY.md — Active Projects index now lists Vantage with link to project memory + this handoff
- Updated file:///C:/Users/dbhav/.claude/projects/C--Users-dbhav-Projects/memory/project_claude_usage_daemon.md — auth section rewritten for the new `.credentials.json` source + 2026-04-29 token-store migration note
