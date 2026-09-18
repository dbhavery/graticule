---
name: Graticule
description: A live earth-observation globe where the weather is the brightest thing on screen and the chrome never is.
colors:
  bg: "#000"
  panel: "rgba(14, 17, 23, 0.90)"
  panel-bg: "rgba(10, 13, 18, 0.78)"
  panel-bg-strong: "rgba(10, 13, 18, 0.94)"
  rail-bg: "#0b0e13"
  hairline: "rgba(255, 255, 255, 0.09)"
  hairline-hi: "rgba(255, 255, 255, 0.16)"
  control: "rgba(255, 255, 255, 0.05)"
  control-hi: "rgba(255, 255, 255, 0.085)"
  text: "#e6ecf3"
  text-dim: "#a8b3c2"
  text-mute: "#8892a3"
  accent: "#5cd6ff"
  accent-ink: "#04141c"
  accent-wash: "rgba(92, 214, 255, 0.14)"
  accent-edge: "rgba(92, 214, 255, 0.46)"
  ok: "#22cc66"
  warn: "#d6802b"
  bad: "#cc3322"
typography:
  display:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, Segoe UI, system-ui, sans-serif"
    fontSize: "28px"
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: "0.2px"
  title:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, Segoe UI, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "0.2px"
  body:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, Segoe UI, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 450
    lineHeight: 1.5
    letterSpacing: "normal"
  label:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, Segoe UI, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 550
    lineHeight: 1.35
    letterSpacing: "0.9px"
  readout:
    fontFamily: "JetBrains Mono, ui-monospace, Consolas, monospace"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: "normal"
  tick:
    fontFamily: "JetBrains Mono, ui-monospace, Consolas, monospace"
    fontSize: "10px"
    fontWeight: 400
    lineHeight: 1.3
    letterSpacing: "normal"
rounded:
  sm: "4px"
  md: "8px"
  card: "16px"
  tile: "14px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
components:
  card:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.text}"
    rounded: "{rounded.card}"
    padding: "11px 14px 10px"
  tile:
    backgroundColor: "{colors.control}"
    textColor: "{colors.text-dim}"
    rounded: "{rounded.tile}"
    padding: "11px 6px 10px"
    height: "72px"
  tile-on:
    backgroundColor: "{colors.accent-wash}"
    textColor: "{colors.accent}"
    rounded: "{rounded.tile}"
  chip:
    backgroundColor: "{colors.control}"
    textColor: "{colors.text-dim}"
    rounded: "{rounded.sm}"
    padding: "7px 14px"
  chip-active:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-ink}"
    rounded: "{rounded.sm}"
  unit-pill:
    backgroundColor: "{colors.control-hi}"
    textColor: "{colors.text-dim}"
    rounded: "{rounded.pill}"
    padding: "1px 7px"
---

# Design System: Graticule

## Overview

Graticule is a live earth-observation globe carrying 38 data layers, shipping
as an Android APK over a vanilla-JS web app. The design is the **category
standard executed at full fidelity** — dark glass cards, generous radius,
hairline borders, one accent — chosen deliberately over three more expressive
alternatives on 2026-09-18.

It refuses the one habit the category never breaks. Weather apps ship control
surfaces and never explain the data: a screen full of buttons that never tells
you what the colours mean. Graticule adds an **information layer** — the
reflectivity ramp with its numerals, the field name, the frame's valid time,
the attribution — so the screen decodes itself.

Two rules govern everything below.

**The data is the hero; the chrome is the instrument case.** The globe is
full-bleed and the chrome floats over it in discrete cards that never span the
full width uninterrupted. If a design choice competes with radar for attention,
it loses.

**A phone in one hand is the judging surface.** Desktop is the secondary case.
Audience is everyone, not specialists, so the interface must be
instrument-grade without requiring instrument literacy.

## Colors

### Primary

`accent` `#5cd6ff` marks the single active thing: the selected division, an
enabled layer, a focus ring. `accent-wash` and `accent-edge` are its
low-emphasis pair for filled states.

**Open question, deliberately unresolved:** the reflectivity ramp's low end is
cyan and blue (roughly 5–25 dBZ), so the chrome accent and light rain are drawn
from the same region of the spectrum. Cyan `#5cd6ff`, blue `#3b82f6` and a
neutral `#e8edf3` were rendered against the live app for comparison. Until this
is decided, **no filled accent block may be the brightest element in the
frame.**

### Neutral

A near-black ground (`bg` `#000`, the globe itself) with translucent panels
above it. Panels are never opaque: `rgba(14, 17, 23, 0.90)` over
`backdrop-filter: blur(20px)`, so the map stays faintly legible through the
chrome and the chrome never reads as a separate application.

Text descends `text` → `text-dim` → `text-mute`. Borders are always
`rgba(255,255,255,0.09)`, lifting to `0.16` on hover.

### Named Rules

- **Hue belongs to data.** 31 per-layer colour tokens (`--c-radar`,
  `--c-planes`, …) encode layer identity. Chrome does not borrow from them.
- **State is never carried by colour alone.** An enabled tile changes fill,
  border and text colour together.
- **Severity owns its own channel.** `ok` / `warn` / `bad` drive the warning
  card's accent and progress bar via `--gfx-accent`, set per alert.

## Typography

Two families, both loaded from Google Fonts. `Inter` for everything readable;
`JetBrains Mono` for anything a person compares digit by digit — timestamps,
counts, coordinates, scale ticks.

The size scale is fully tokenised: exactly one raw pixel `font-size` exists in
5,000 lines of CSS.

### Hierarchy

`display` 28px/600 for hero numerals · `title` 16px/600 for card headings ·
`body` 14px/450 · `label` 12px/550 with 0.9px tracking, uppercase, for section
headings · `readout` 12px mono · `tick` 10px mono for scale numerals only.

### Named Rules

- **Anything compared digit by digit is mono and `tabular-nums`.** A timestamp
  that shifts width as it ticks cannot be read at a glance.
- **Tracking widens as size drops.** Uppercase labels at 12px carry 0.9px;
  hero text at 28px carries 0.2px.
- **A measurement never appears without its unit.** `dBZ` rides in a pill
  beside the field name, not in the numerals.

## Layout

Full-bleed globe under everything. Chrome insets itself; the map does not.

**The bottom stack is the load-bearing structure.** One flex column pinned
above the sheet peek, in reading order: transport, colour-scale legend,
attribution. A hidden child collapses and the rest close up.

Elements that float *above* the stack — the warning card, the locate button,
the toast — clear it by **measured** custom properties (`--botstack-h`,
`--gfxwarn-h`), published by a `ResizeObserver` with a 400ms polling backstop.

> **Never position a member of the bottom stack with a hand-picked offset.**
> Seven elements once did, each constant a claim about how tall the other six
> were, and the credit strip — which Cesium fills at runtime, so it measured
> zero — printed its text through the severe-weather card. A constant cannot
> reserve space for content that does not exist when the constant is written.

Breakpoint is `(max-width: 780px), (max-height: 500px)` — width and height
separately, because a phone in landscape is 915×412 and sails past a
width-only test. Above it the wrapper is `display: contents` and desktop
positions itself exactly as it did before the stack existed.

Touch targets are 44px on mobile and on any coarse pointer. Every flex and grid
child that can hold long text carries `min-width: 0`.

## Elevation & Depth

Depth is blur plus a hairline, never a heavy drop shadow.

### Shadow Vocabulary

- **Floating card:** `0 10px 30px -12px rgba(0,0,0,0.85)` with
  `backdrop-filter: blur(20px)` and a 1px hairline.
- **Sheet:** `0 -8px 32px rgba(0,0,0,0.6)`, shadow cast upward.
- **Inset control:** no shadow; a translucent fill and a hairline.

### Named Rules

- **Every floating surface blurs what is behind it.** A solid panel over a live
  map reads as a hole in the map.
- **Shadow direction follows the surface's origin.** The sheet rises from the
  bottom, so its shadow casts up.

## Shapes

`card` 16px for anything floating over the map · `tile` 14px for the quick
layer grid · `md` 8px for surfaces inside the rail · `sm` 4px for controls ·
`pill` for units and status chips.

The warning card is `overflow: hidden` so its accent bar and progress fill clip
to the radius rather than squaring off the corners.

## Components

### Cards (bottom stack)

Translucent, blurred, 16px radius, hairline border, inset 10px from each edge
so nothing spans the full width uninterrupted. Members are laid out by the
column, never by their own offsets.

### Quick layer tiles

Six 3-across tiles, 72px minimum, icon over label. **They hold no state.** Each
drives the existing `input[data-layer]` checkbox and reads its appearance back
off it, so a layer has exactly one source of truth. A tile whose layer is
absent from the DOM hides itself rather than sitting there looking live.

Icons are 22–24px, 1.6 stroke, `currentColor`, drawn for this app.

### The colour-scale legend

The information layer, and the component that carries the product's argument.
Field name, unit pill, frame valid time, then the ramp with its numerals.

JS publishes the stops as `--lg-stops`; **CSS owns the direction** — 0deg
vertical on desktop with `column-reverse` ticks, 90deg horizontal on the phone.
A forecast frame's time is suffixed `fcst`. A mode with no frame loop renders
nothing rather than a dash.

### Chips

The nine division chips are the navigation axis; the quick tiles are the layer
axis. They are visually distinct and separated by section headings, because an
early build put a chip and a tile both labelled "Radar" eight lines apart
meaning two different things.

## Do's and Don'ts

**Do** measure anything another element must clear, and publish it as a custom
property. **Don't** write an offset that describes today's layout.

**Do** reset `transform` when repositioning an element across breakpoints. A
transform survives `position: static` and `inset: auto` — it is paint-time, not
layout — and a correct layout will still paint in the wrong place.

**Don't** add a transition to anything that gates visibility or state.
Cesium renders on the main thread and its animation clock stalls: a measured
260ms sheet transition was 60% incomplete 1.5 seconds later. Four separate
defects in this app trace to exactly this. If the clock can stall, nothing a
user is waiting on goes behind it.

**Don't** write placement inline from JavaScript on the phone. No stylesheet
can beat it without `!important`, and reaching for that only moves a stale
constant into CSS.

**Do** treat the Cesium credit strip as a licence condition. It must be legible
and its expander reachable.

**Don't** add a second `input[data-layer]` for a layer that already has one.
Every layer binding resolves by `querySelector` on that attribute and takes the
first match. Proxy to the existing control instead.

**Do** verify at a pinned layout viewport. `--window-size` alone is not enough:
Chromium widens the layout viewport to fit overflow, so a broken 412px layout
reports 500px and an empty overflow list at the same time.
