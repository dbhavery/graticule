"""The hardware back button, pressed on a device, checked against the window manager.

Issue 50 was the store blocker: back exited the app instead of closing what
was open, and a reviewer presses it first. Issue 52 is why it survived so
long -- all five desktop suites pass with it broken, because they drive
Chromium on a machine that has no back button.

So this presses the real key with `adb shell input keyevent` and reads the
verdict from `dumpsys window`, not from the page. Asking the page whether it
is still alive cannot detect the failure: if the app exits, the page is gone
and the probe just errors.

Three cases, and the third is the control:

  1. Something open  -> back closes it and the app KEEPS focus.
  2. Nothing open    -> back warns and the app KEEPS focus.
  3. Back again      -> the app LEAVES.

Without case 3 this passes just as well against a back button that does
nothing at all, which is its own bug and a worse one.

Note the dependency this test carries on issue 51: a blocked main thread is
a listener that has not attached yet, so back exits by Capacitor's default.
Give the app time to settle before pressing, and treat a failure here as a
possible performance regression rather than a back-handler regression.

    py -V:3.13 scripts/apk_back_test.py [--settle 70]
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
import time

from apk_probe import APP_ID, adb, attach, cdp, page_target

ok: list[str] = []
bad: list[str] = []


def chk(cond: bool, msg: str) -> None:
    (ok if cond else bad).append(msg)
    print(("  PASS  " if cond else "  FAIL  ") + msg)


def focused_app() -> str:
    """Which app owns the focused window, per the window manager."""
    out = adb("shell", "dumpsys", "window")
    for line in out.splitlines():
        if "mCurrentFocus" in line:
            return line.strip()
    return "(no mCurrentFocus line)"


def back() -> None:
    adb("shell", "input", "keyevent", "KEYCODE_BACK")


def probe(expr: str):
    attach()
    return asyncio.run(cdp(page_target(), expr, await_promise=False))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--settle", type=float, default=70,
                    help="seconds to let boot finish before pressing anything")
    args = ap.parse_args()

    adb("shell", "am", "force-stop", APP_ID)
    time.sleep(1.5)
    adb("shell", "am", "start", "-n", f"{APP_ID}/.MainActivity")
    print(f"launched; settling {args.settle:.0f}s "
          f"(a blocked main thread is an unattached listener -- see issue 51)")
    time.sleep(args.settle)

    state = json.loads(probe("""JSON.stringify({
      attached: !!window.__graticule_back,
      layers: (window.__graticule_back || {}).layers || [],
      native: !!(window.Capacitor && window.Capacitor.isNativePlatform
                 && window.Capacitor.isNativePlatform()),
    })"""))
    chk(state["native"], "the page knows it is running natively")
    chk(state["attached"],
        f"the back listener attached ({len(state['layers'])} layers registered)")

    # ---- 1. something open ------------------------------------------------
    print("\n== back with the command palette open ==")
    opened = json.loads(probe("""(() => {
      const b = document.getElementById('palette-btn');
      if (!b) return JSON.stringify({ok: false, why: 'no palette-btn'});
      b.click();
      const p = document.getElementById('palette');
      return JSON.stringify({ok: !!p && !p.classList.contains('hidden')});
    })()"""))
    chk(opened.get("ok"), f"the palette opened ({opened})")

    back()
    time.sleep(1.5)
    foc = focused_app()
    chk(APP_ID in foc, f"the app still has focus after one back press")
    closed = json.loads(probe("""JSON.stringify({
      hidden: (document.getElementById('palette') || {classList: {contains: () => false}})
                .classList.contains('hidden')})"""))
    chk(closed["hidden"], "and the palette is closed, so the press was HANDLED "
                          "rather than ignored")

    # ---- 2. nothing open --------------------------------------------------
    print("\n== back with nothing open ==")
    back()
    time.sleep(1.2)
    chk(APP_ID in focused_app(), "the app still has focus")
    warned = probe("""(() => {
      const t = document.querySelector('.toast, #toast');
      return t ? (t.textContent || '') : '';
    })()""")
    chk("back again" in (warned or "").lower(),
        f"and it warned instead of leaving ({(warned or '')[:52]!r})")

    # ---- 3. the control ---------------------------------------------------
    # If this does not exit, back is doing nothing at all and every check
    # above passes for the wrong reason.
    print("\n== the control: back again, which must leave ==")
    back()
    time.sleep(2.5)
    foc = focused_app()
    chk(APP_ID not in foc,
        f"the app exited when it was supposed to ({foc.split('u0 ')[-1][:60]})")

    print(f"\n{len(ok)} passed, {len(bad)} failed")
    for m in bad:
        print("  FAILED:", m)
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
