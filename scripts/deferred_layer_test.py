"""A layer the boot snapshot only counted must still draw when switched on.

The snapshot stopped carrying rows for big layers (issues.md 63). That is only
correct if switching one on still fills the globe, and only honest if the
switch already showed how many rows the feed has before anybody touched it.
Both are asserted here, on a real browser against a real server.

    py -V:3.13 scripts/deferred_layer_test.py [port]

CONTROL: the layer's entity count is asserted to be ZERO before the click. A
test that only checks "entities exist afterwards" would pass just as happily
against a build that shipped every row in the snapshot and built them all at
boot, which is the thing being removed.
"""
from __future__ import annotations

import sys

from playwright.sync_api import sync_playwright

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8744
URL = f"http://127.0.0.1:{PORT}/"
# Airports: deferred (5,272 rows), static, and small enough to build quickly.
# Fires is the layer that motivated all this, but building 145,000 entities in
# a headless software renderer measures the harness, not the app.
LAYER = "airports"

passed = failed = 0


def chk(ok: bool, label: str) -> None:
    global passed, failed
    print(f"  {'PASS' if ok else 'FAIL'}  {label}")
    if ok:
        passed += 1
    else:
        failed += 1


ENTITY_COUNT = """(layer) => {
  const v = window.__graticule_viewer;
  if (!v) return -1;
  for (let i = 0; i < v.dataSources.length; i++) {
    const ds = v.dataSources.get(i);
    if (ds.name === layer) return ds.entities.values.length;
  }
  return -1;
}"""


def main() -> None:
    with sync_playwright() as p:
        b = p.chromium.launch(headless=True)
        page = b.new_page(viewport={"width": 1280, "height": 900})
        errors: list[str] = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(URL, wait_until="commit")

        # The snapshot has landed once the switch is showing a count.
        page.wait_for_function(
            f"() => {{ const el = document.getElementById('count-{LAYER}');"
            f" return el && parseInt(el.textContent || '0', 10) > 0; }}",
            timeout=180_000)
        counted = int(page.evaluate(
            f"document.getElementById('count-{LAYER}').textContent"))
        chk(counted > 1000, f"the switch reports {counted} rows before any click")

        before = page.evaluate(ENTITY_COUNT, LAYER)
        chk(before == 0,
            f"CONTROL: nothing is drawn yet ({before} entities), so this test "
            f"can tell a deferred layer from one that shipped in the snapshot")

        # The switch is a styled label over a visually hidden checkbox, and the
        # category it lives in may be collapsed, so a real click needs the rail
        # driven open first. This test is about the data path, so it sets the
        # checkbox and fires the same `change` event the handler listens for.
        page.evaluate(f"""() => {{
          const el = document.querySelector('input[data-layer="{LAYER}"]');
          el.checked = true;
          el.dispatchEvent(new Event('change', {{ bubbles: true }}));
        }}""")
        try:
            page.wait_for_function(
                f"() => {{ const v = window.__graticule_viewer; if (!v) return false;"
                f" for (let i = 0; i < v.dataSources.length; i++) {{"
                f"  const ds = v.dataSources.get(i);"
                f"  if (ds.name === '{LAYER}') return ds.entities.values.length > 0;"
                f" }} return false; }}",
                timeout=120_000)
        except Exception:
            pass
        after = page.evaluate(ENTITY_COUNT, LAYER)
        chk(after > 0, f"switching it on fetched and drew it ({after} entities)")
        chk(abs(after - counted) <= max(50, counted * 0.05),
            f"what was drawn matches what was counted ({after} vs {counted})")

        fatal = [e for e in errors if "ResizeObserver" not in e]
        chk(not fatal, f"no page errors ({len(fatal)})")
        for e in fatal[:5]:
            print("     ", e)
        b.close()

    print(f"\n{passed} passed, {failed} failed")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
