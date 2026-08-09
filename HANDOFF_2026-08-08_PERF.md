# Graticule: performance and the back button, 2026-08-08

Branch `dev`, synced with `origin/dev`, tree clean, HEAD `3b4826e`.

**Supersedes section 7 of `HANDOFF_2026-08-07_ANDROID.md` and nothing else.**
That file is still the reference for the machine map, the build commands, the
measured traps and the instrument mistakes. Read it first; this is the delta.

---

## What changed

Issue 50, the store blocker, is **closed**. Issue 51 is **67% better and still
open**. Issue 52 now has four device-side instruments where it had none.

| build | long tasks | blocking | worst task |
|---|---|---|---|
| `247d34f` before | 128 | 40,959 ms | 9,460 ms |
| `a0d4f69` borders off the main thread | 108 | 17,337 ms | 3,741 ms |
| `e474d9a` hot paths | 73 | 13,590 ms | 3,576 ms |

All on the emulator, one instrument, same device. The app also settles now:
blocking past the 60 s mark went 2,107 -> 717 -> 192 ms.

---

## The thing most likely to save you a day

**A desktop harness cannot rank main-thread costs for this app, and it will
tell you so with a straight face.**

The border rewrite measured on desktop Chromium at 412x915 as doing nothing:
12,937 ms of blocking before, 13,339 ms after, worst task 4,191 -> 7,562 ms.
On that evidence the right call is to revert it. It was correct, and on the
device it cut blocking 58%.

The harness was measuring itself. A CPU profile put 4,754 ms of that worst
task inside a single `getImageData` on a 131x144 canvas; every later readback
of the same size cost 0-11 ms. SwiftShader initialises its canvas backend once
and it costs more than everything the fix touches.

So: **no performance claim about this app counts unless it was measured on the
device.** `border_perf_test.py` survives because it does measure JS-only work
honestly (parse, allocation, DOM) and because it carries the ECEF correctness
check. Its blocking numbers are not comparable to the device's.

Second: **profile, do not read the code and form an opinion.** The previous
session reasoned its way to "it must be the borders" and shipped 485 lines
that moved the desktop number by nothing. The three wins in `e474d9a` all came
out of the profile and none of them is guessable:

- `doRefreshAlerts` rebuilt 60 `<li>` and 60 click listeners **every frame** in
  which any feed message arrived, into `#alerts-panel`, which ships hidden.
  3.8 s -> 484 ms.
- `input[data-layer="x"]` ran 27 times per websocket message, and planes and
  ships arrive **one message per entity**. ~2.1 s of raw `querySelector`, gone.
- `noteFeed` read `offsetWidth` right after a class change to restart a
  keyframe, which forces a **synchronous layout**, one per aircraft update.
  1,055 ms -> 79 ms.

---

## Instruments (all new today)

| Command | What it answers |
|---|---|
| `py -V:3.13 scripts/apk_longtasks.py --seconds 90` | main-thread blocking on the device, **for any build** |
| `py -V:3.13 scripts/apk_profile.py --seconds 45` | CPU profile from inside the WebView, self + inclusive |
| `py -V:3.13 scripts/apk_back_test.py --settle 70` | the real back key, checked against `dumpsys window`. 8 checks |
| `py -V:3.13 scripts/border_perf_test.py 8744` | desktop boot blocking + the worker's ECEF vs Cesium |

`apk_longtasks.py` injects its observer with CDP
`Page.addScriptToEvaluateOnNewDocument` and then reloads, which is why it works
on a build that carries no observer of its own. That is what makes a
before/after across commits one instrument instead of two with the same name.

`apk_back_test.py` reads the verdict from the window manager, not the page. If
the app exits, the page is gone and a page probe just errors. It cannot
detect the failure it exists to catch. Its third case is the control: back
again **must** leave, or the first two cases pass just as well against a back
button that does nothing.

`border_perf_test.py` **fails on purpose today.** It is the gate for issue 51
(1,000 ms single task, 2,500 ms total), not a description of the app.

---

## Where to go next

**Issue 51, the remaining 13,590 ms.** The profile no longer names app code as
the biggest cost. `ws.onmessage` is 2.1 s inclusive, `resetLayer` 943 ms,
`pushDeltasToTicker` 857 ms, and the single 3,576 ms task looks like Cesium
combining the border primitive and compiling its shaders:
`getDerivedShaderProgram`, `bufferData` and `getProgramParameter` are all in
the profile around it.

That points at option three from the original list: **ship the borders as a
tiled vector source** so only what is on screen ever becomes geometry. It is
the largest change of the three and it is now the one the evidence supports.

**Do not restore the 0.002-degree decimation.** It is Don's directive 8 undone,
it buys 1.5 MB for 223 m of accuracy on a map, and it was never the cost.

**Still blocked on Don, unchanged:** where the backend lives and who pays
($5-15/mo, nothing signed); Apple's $99/yr needs a Mac he does not have, so
Android ships first. `web/privacy.html` and a support page still do not exist
and are mandatory listing fields.

---

## Verify

```bash
.venv/Scripts/python.exe -c "from graticule.server import run_server; run_server(8744, '0.0.0.0')"

py -V:3.13 scripts/keyless_test.py 8744            # 25
py -V:3.13 scripts/ui_scroll_test.py 8744          # 27
py -V:3.13 scripts/world_consistency_test.py 8744  # 17
py -V:3.13 scripts/native_origin_test.py 8744      # 11
py -V:3.13 scripts/globe_visual_test.py 8744       # 29
```

109 checks, all green at `3b4826e`. They were also all green with both defects
present, which is the point of issue 52. Treat them as a regression net, not
as evidence that the app is fast or that its buttons work.

Android: take a GPU lease before using `-gpu host`, and release it after.
Another session held it for an hour today; wait, never kill it.
