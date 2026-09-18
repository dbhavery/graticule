# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

Distribution is an Android APK built with Capacitor 7, plus a pywebview desktop
window over the same `web/` directory. The design language is the product's own,
not Android's, so the platform record stays `web` per the wrapper rule. Every
layout decision is still judged on a phone first: that is where it ships.

## Stack

Existing codebase, no framework. Vanilla ES modules in `web/app.js` (14,020
lines), a single `web/style.css` (4,992 lines), `web/index.html` (1,261 lines).
CesiumJS renders the globe. A Python backend (`graticule/server.py`) proxies and
normalizes every feed. No build step for the front end.

## Users

Confirmed by Don, 2026-09-17: **global activity enthusiasts, and everyone.**
Not a specialist tool for storm spotters, pilots, or emergency managers. The
user is a person who wants to see what the planet is doing right now, at a
depth that rewards staying.

That breadth is a design constraint with teeth: the interface has to be
instrument-grade without requiring the literacy of an instrument's usual
operator. A person who cannot read a Skew-T must still get full value from the
radar.

Operating scene: a phone, one-handed, in whatever light the day supplies.

## Product Purpose

Put every live earth-observation and weather feed on one physically real globe,
so a person reads a situation whole instead of switching between apps.

The Earth is not a basemap. It runs on the system clock: the solar terminator
sweeps at a true 15 degrees per hour, VIIRS city lights composite onto the night
hemisphere only, the moon sits at its true ephemeris position and phase, and
terrain is real elevation from Esri's keyless world service.

Success is a person opening it to check one thing and staying.

## Positioning

Two claims a neighboring product cannot truthfully copy:

1. **Depth of weather on a 3D globe.** 38 layers including the national radar
   mosaic as a scrubable frame loop over past and nowcast frames, hi-res
   single-site NEXRAD across 30 sites with six products, model fields,
   satellite, observations, outlooks, and live NWS warnings.
2. **A physically real Earth rather than a styled one.** Real sun position,
   real terrain, real night side.

The nearest competitor, God's Eye View (MIT, ~37k stars), carries 15 layers,
10 of which overlap, and **has no weather at all** — though 31 of its open
issues and PRs ask for exactly Graticule's layers.

## Operating Context

Local-first. Single window. No cloud sync, no account.

Opens on North America with the national radar mosaic running, boundaries drawn
and the color scale up. The camera holds the continent while sunlight rotates
around it, returning home only after 90 seconds of genuine inactivity.

While a data field is drawn, the base map is graded down (brightness 0.58,
saturation 0.34) because 20 dBZ blue over bright ESRI imagery is unreadable.

## Capabilities and Constraints

**38 layers** reached through a five-level path: bottom sheet → three tabs
(Data / NWS Alerts / Broadcast) → nine division chips in two labelled groups
(Weather: Radar, Model, Satellite, Observations, Outlooks · Map & world:
Mapping, Earth, Sky, World) → in two of the nine, collapsible category headers
(SEA 1, EARTH 3, WATER 3, TERRAIN 2, ALERTS 3, AIR 4, SPACE 2, CELESTIAL 1) →
the toggle. Flattening this is an open design problem, confirmed in scope.

**Cesium renders on the main thread**, and its animation clock stalls during
load. Measured: a 260ms sheet transition was 60% incomplete 1.5 seconds later.
Six surfaces therefore carry a deliberate `transition: none` and must keep it.

**Device boot blocking is the app's own data feed, not the engine.** Measured
2026-09-17 on the emulator over 5 boots each: backend running, 9,768ms median
blocking; backend stopped, 414ms. Roughly 96% is paid processing what the
backend sends. The phone budget is 1,000ms worst task / 2,500ms total.

**Credits are a licence condition, not chrome.** Cesium injects nodes into an
empty `#credits`, and the expander must stay reachable or credits get
suppressed. `#credits` currently measures zero height and its text prints
through the alert card — a live defect in scope for this work.

**Licensing is undecided and must stay open** (Don, 2026-09-17). RainViewer is
personal/educational only; adsb.fi is non-commercial only; the Cesium ion
Community token reaches Google Photorealistic 3D Tiles but paints "Upgrade for
commercial use" on screen. A paid or published build needs the metered direct
Google key. Design must not bake in anything a commercial launch would undo.

**Nothing in the front end is off limits** for this redesign (Don, 2026-09-17),
including the Cesium engine and data pipeline.

## Brand Commitments

Name: **Graticule**. A graticule is the grid of meridians and parallels on a
map or an instrument's reticle — the product is named for a measuring grid.

Don's standing UI preference across projects: dark, minimal, clean, no clutter.
Design fresh per project; the `don-design-system` tokens are dead.

**Standing UI preference, confirmed by Don 2026-09-18 after seeing four
directions rendered side by side against the real globe.** He chose the
category standard, played straight: dark glass surfaces, rounded cards, a blue
accent, chips, a tile grid, a search pill, a FAB. Convention is the commitment.
It is executed at full fidelity, without irony and without smuggled quirk.

**With one addition, and it is the important half.** Don, verbatim: *"D has
only buttons. Some info graphics are needed to tell the user what they are
looking at. Like the colored severity bar."* The canon shell is all control and
no explanation. Graticule adds an information layer the category does not
ship: the reflectivity ramp with its dBZ numerals, what is currently drawing
and when it was observed, and the data credits — rendered as a legend, so the
screen decodes itself. **A person who cannot read radar must be able to learn
what the colors mean without leaving the map.**

**Craft bar, chosen by Don 2026-09-18:** Windy, RadarScope and MyRadar for how
they carry many layers, timelines and legends without becoming a control
panel; and Google Maps, onX and Gaia GPS for how chrome coexists with a live
map it must never obscure. Those are the finish levels to reach.

No logo, wordmark, or brand color has been established.

## Evidence on Hand

Real, in-repo, and usable as design material:

- 38 working live layers with real data. `web/data/` carries bundled geodata.
- A real NWS severe thunderstorm warning rendering over Seattle, verified on
  the emulator 2026-09-17.
- Photorealistic 3D Tiles working on device as of commit `2a0948e`.
- Measured performance numbers (above), from `scripts/apk_longtasks.py`.
- 77 existing design tokens, a full type scale, 31 per-layer colors.

Absent, and not to be fabricated: user counts, reviews, testimonials, press,
download numbers, revenue, or any store listing performance. Graticule has
never been published.

## Product Principles

1. **The data is the hero; the chrome is the instrument case.** If a design
   choice competes with radar for attention, it loses.
2. **Instrument-grade, public-legible.** Precision without requiring
   specialist literacy. The breadth of the audience is the hard constraint.
3. **The Earth is real, so render it honestly.** Physical truth over styling.
4. **A phone in one hand is the judging surface.** Desktop is the secondary
   case, not the design case.
5. **Never pay in main-thread time for decoration.** Cesium owns that thread;
   motion and effects must not compete with it.

## Accessibility & Inclusion

Touch targets are 44px on mobile and on any coarse pointer (`--hit`). Two
`prefers-reduced-motion: reduce` blocks exist. Safe-area insets are honored on
eight surfaces. The command palette is a proper `role="dialog" aria-modal`.

No formal standard has been established as binding.
