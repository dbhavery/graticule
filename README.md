# Graticule

Live weather, warnings, earthquakes, fires, aircraft, ships and satellites on
one 3D globe, built on keyless public feeds that run on the device. It runs
on Android, in a browser and as a desktop window.

## The problem

Following the weather and other live events means keeping many sites open,
with radar in one tab, warnings in another and flight or ship trackers in
others. Most viewers that combine them need an account or an API key before
they show anything, and some need a paid server.

## How it solves it

Graticule draws every layer on a single 3D globe. Each feed is fetched by the
app itself, on a timer, from a public source that needs no key, so there is no
backend to host and no account to create. Small feeds such as quakes and NWS
alerts run from the start. Large layers, such
as wildfires and airports, are fetched only while their layer is switched on.

Some providers do not allow a browser to call them directly. The Android app
makes those requests in native code, where that rule does not apply. The web
build sends them through one stateless relay that accepts only https requests
to a fixed list of hostnames and refuses everything else.

## Who it helps

Weather hobbyists and storm spotters who want radar and warnings in one
place, people who follow aircraft, ships or satellites, and developers looking
for an example of a live-data app with no keys and no server to run.

## Technical details

### What it shows

- **Earth:** real-time sun lighting, day and night, city lights on the night
  side, moon position and phase, and terrain elevation from Esri's keyless
  elevation service (`?terrain=off` turns it off on a slow machine).
- **Radar:** the national mosaic as a playable frame loop, plus single-site
  NEXRAD products.
- **Models:** GFS, HRRR, NAM, ECMWF and ICON fields with a forecast-hour
  scrubber.
- **Satellite:** GOES-East and GOES-West visible, infrared and water vapor.
- **Observations and outlooks:** METAR stations, air quality, storm reports,
  public cameras, SPC outlooks, tropical systems and aurora.
- **Earth and sea:** USGS quakes, volcanoes, NASA FIRMS wildfires, river
  gauges, tide stations, buoys and ships.
- **Sky:** aircraft from community ADS-B networks, airports, TFRs, airspace,
  satellites propagated in the app from Celestrak TLEs, and launches.
- **NWS alerts:** everything in effect, colored and ranked with the table the
  National Weather Service publishes.
- **Dashboards:** full-screen boards for severe weather, tropical, water,
  geophysical events, space weather and world population.

Ships without a key cover Baltic and Finnish waters only (Digitraffic). There
is no keyless live AIS feed with worldwide coverage.

### Architecture

```
web/index.html + web/app.js      CesiumJS 1.121 globe, satellite.js, UI
web/feeds.js                     every feed, run in the page on a timer
        |
        |-- Android (Capacitor):  native HTTP, no relay needed
        |-- Web (Vercel):         api/proxy.js for providers that block browsers
        '-- Desktop (pywebview):  graticule/server.py serves web/ locally and
                                  carries the same proxy route
```

`web/feeds.js` produces the same messages the old server sent, so the
renderers in `web/app.js` do not need to know where the data came from.

`api/proxy.js` is the only server-side code the web build needs. It keeps no
state between calls and accepts only https URLs whose hostname is on its
allowlist. `graticule/server.py` carries the same list for the desktop build,
and `scripts/static_checks.py` fails if the two lists differ.

`graticule/server.py` still contains the older feed loops, which push a merged
snapshot over a WebSocket. The page uses them only when opened with
`?data=server`; the default, `?data=device`, runs the feeds in the page.

`deploy/_retired/` holds the Dockerfile, `fly.toml` and the deployment notes
for an always-on backend. They are not used, and no build or deploy step reads
them. `scripts/static_checks.py` still compares the Dockerfile's dependency
list with `pyproject.toml` so the file stays accurate if it is ever revived.

### Run the desktop app

Requires Python 3.13 (pinned in `.python-version`) and
[uv](https://docs.astral.sh/uv/).

```bash
git clone https://github.com/dbhavery/graticule.git
cd graticule
uv sync
uv run python main.py
```

`main.py` starts the local server on `127.0.0.1:8731` and opens a pywebview
window on it. No `.env` and no keys are needed. Layers start switched off;
turn them on from the left panel.

### Build the web version

```bash
py -V:3.13 scripts/build_site.py
cd site-dist
vercel deploy --prod --yes
```

`build_site.py` copies `web/` into `site-dist/app`, adds the privacy and
support pages, and places `api/proxy.js` at `/api/proxy`.

### Build the Android app

Requires Node.js and the Android SDK.

```bash
npm install
npm run android                                   # debug APK
py -V:3.13 scripts/android_build.py --release --aab   # Play bundle
```

`android_build.py` stages `web/` into `dist/`, runs `cap sync android` and
then Gradle. With no `--api-base`, the app runs its feeds on the device.

### Optional keys

`.env.example` lists optional keys (worldwide ships through AISStream, Cesium
ion buildings, Google 3D tiles, faster FIRMS fires). They are read only by the
Python server, so they apply only in `?data=server` mode. The default device
mode does not use them, so a key is never placed in the page.

### Checks

CI (`.github/workflows/ci.yml`) installs the package, imports it, compiles
every module under `graticule/` and `scripts/`, and runs
`scripts/static_checks.py`. That script checks things a file read can settle:
the relay allowlist matches between `api/proxy.js` and `graticule/server.py`,
the privacy policy, Android permissions, attribution credits and vendored
library versions. Several checks include a control that proves the check can
fail.

```bash
pip install .
python -m compileall -q graticule scripts
python scripts/static_checks.py
```

The other `scripts/*_test.py` suites need a running app, a browser and network
access, so CI does not run them.

### Controls

`Ctrl` + `K` opens a command palette that reaches tabs, layers, radar
products, base maps and saved views by name. Hovering a point shows a tooltip
and clicking it opens the detail panel. Right-clicking centers the camera or
saves a camera preset, and `\` collapses the left panel.

## License

MIT. See `LICENSE`. Map and data credits are shown in the app for each source
(Esri, NASA, NOAA, USGS, adsb.fi, Smithsonian GVP and others).
