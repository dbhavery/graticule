"""The boot snapshot has a size budget, and this fails when it is exceeded.

Before this existed the first websocket frame was 32.4 MB, and 28.1 MB of it
was rows for layers that ship switched off. `fires` alone was 107,665 rows and
73% of the frame. Nothing measured it, so nothing noticed. On the device that
frame cost about 2 to 3 seconds of main thread as well as the bytes, and on a
phone on cellular the bytes are the user's money. See issues.md 63 and 64.

    py -V:3.13 scripts/snapshot_budget_test.py [port]

CONTROL: /api/snapshot still returns everything, and this asserts that it is
much larger than the websocket frame. Without that check a server that had
simply stopped collecting data would pass every assertion here, and a budget
test that passes on an empty server is not a test.
"""
from __future__ import annotations

import asyncio
import json
import sys

import websockets

BUDGET_MB = 4.0
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8744
BASE = f"http://127.0.0.1:{PORT}"

passed = failed = 0


def chk(ok: bool, label: str) -> None:
    global passed, failed
    print(f"  {'PASS' if ok else 'FAIL'}  {label}")
    if ok:
        passed += 1
    else:
        failed += 1


async def first_snapshot() -> tuple[str, dict]:
    async with websockets.connect(f"ws://127.0.0.1:{PORT}/ws",
                                  max_size=256 * 1024 * 1024) as ws:
        while True:
            raw = await asyncio.wait_for(ws.recv(), timeout=180)
            msg = json.loads(raw)
            if msg.get("type") == "snapshot":
                return raw, msg["data"]


def get(path: str) -> dict:
    import urllib.request
    with urllib.request.urlopen(BASE + path, timeout=180) as r:
        return json.load(r)


def main() -> None:
    raw, data = asyncio.run(first_snapshot())
    mb = len(raw) / 1e6
    counts = data.get("counts", {})
    deferred = data.get("deferred", [])
    layers = data.get("layers", {})

    print(f"\nsnapshot {mb:.2f} MB, {len(layers)} layers inline, "
          f"{len(deferred)} deferred: {', '.join(deferred) or 'none'}")

    chk(mb < BUDGET_MB, f"the boot frame is under {BUDGET_MB} MB ({mb:.2f})")
    chk(bool(counts), "every layer is counted, drawn or not")

    # A deferred layer must be counted and must NOT carry its rows: those are
    # the two halves of the promise. Counted so the switch reads honestly,
    # absent so the frame stays small.
    for name in deferred:
        chk(name not in layers, f"{name}: rows are not in the frame")
        chk(counts.get(name, 0) > 0, f"{name}: still counted ({counts.get(name)})")

    # And the rows have to be reachable, or the layer is simply broken.
    for name in deferred:
        doc = get(f"/api/layer/{name}")
        n = len(doc.get("rows", {}))
        chk(n > 0, f"/api/layer/{name} returns {n} rows")
        chk(abs(n - counts.get(name, 0)) <= max(50, counts.get(name, 0) * 0.05),
            f"/api/layer/{name} count matches the snapshot "
            f"({n} vs {counts.get(name)})")

    # An unknown layer must 404 rather than answer with an empty layer, or a
    # typo in a layer name would look exactly like a feed that is down.
    import urllib.error
    import urllib.request
    try:
        urllib.request.urlopen(BASE + "/api/layer/not-a-real-layer", timeout=30)
        chk(False, "unknown layer name returns 404 (it returned 200)")
    except urllib.error.HTTPError as e:
        chk(e.code == 404, f"unknown layer name returns 404 (got {e.code})")

    # CONTROL. If the full snapshot is not much bigger, this server has no data
    # and every assertion above passed for the wrong reason.
    import urllib.request
    with urllib.request.urlopen(BASE + "/api/snapshot", timeout=180) as r:
        full_mb = len(r.read()) / 1e6
    print(f"\n  /api/snapshot (unbounded) is {full_mb:.2f} MB")
    chk(full_mb > mb * 3,
        f"CONTROL: the unbounded snapshot is far larger ({full_mb:.2f} MB vs "
        f"{mb:.2f} MB), so this budget was met by deferring and not by an "
        f"empty server")

    print(f"\n{passed} passed, {failed} failed")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
