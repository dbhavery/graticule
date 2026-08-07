"""Ask the APK's own WebView what it sees.

Nothing else in this repo can. Every suite here drives desktop Chromium, and
the whole point of the Android build is that it is a DIFFERENT browser, a
different GPU path and a different origin. A defect that only exists inside the
shell is invisible to all of them, and "it built" is not "it works".

Playwright cannot drive an Android WebView -- connect_over_cdp fails on
`Browser.setDownloadBehavior: Browser context management is not supported`,
because a WebView has no browser-level context to manage. So this speaks the
DevTools protocol to the page target directly, which is all that is needed to
evaluate an expression and read a screenshot back.

    py -V:3.13 scripts/apk_probe.py                 # the standard state dump
    py -V:3.13 scripts/apk_probe.py --eval "1+1"    # anything else
    py -V:3.13 scripts/apk_probe.py --shot out.png
"""
from __future__ import annotations

import argparse
import asyncio
import base64
import json
import os
import re
import subprocess
import sys
import urllib.request

APP_ID = "dev.dbhavery.graticule"
PORT = 9222

ADB = os.path.join(os.environ.get("LOCALAPPDATA", ""), "Android", "Sdk",
                   "platform-tools", "adb.exe")


def adb(*args: str) -> str:
    out = subprocess.run([ADB, *args], capture_output=True, text=True)
    return (out.stdout or "").strip()


def attach() -> None:
    """Point tcp:9222 at the app's WebView debugger socket.

    The socket name carries the app's pid, so this has to be re-resolved every
    launch -- a stale forward from a previous run silently connects to nothing.
    """
    pid = adb("shell", "pidof", APP_ID).strip()
    if not pid:
        raise SystemExit(f"{APP_ID} is not running. Launch it first:\n"
                         f"  adb shell am start -n {APP_ID}/.MainActivity")
    adb("forward", "--remove", f"tcp:{PORT}")
    adb("forward", f"tcp:{PORT}", f"localabstract:webview_devtools_remote_{pid}")


def page_target() -> str:
    with urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json", timeout=10) as r:
        targets = json.load(r)
    for t in targets:
        # The service worker and Cesium's blob workers are also 'page'-ish
        # targets here. The document is the one whose URL is the app root.
        if t.get("type") == "page" and re.match(r"^https?://localhost/?($|\?)", t.get("url", "")):
            return t["webSocketDebuggerUrl"]
    raise SystemExit("no app page target found; is the WebView still alive?")


STATE = r"""(() => {
  const v = window.__graticule_viewer;
  if (!v) return { fatal: 'no viewer on window' };
  const s = v.scene, g = s.globe;
  const gl = s.context && s.context._gl;
  let feats = 0;
  for (let i = 0; i < v.dataSources.length; i++) feats += v.dataSources.get(i).entities.values.length;
  const layers = [];
  for (let i = 0; i < v.imageryLayers.length; i++) {
    const L = v.imageryLayers.get(i);
    layers.push({ show: L.show, alpha: +(L.alpha ?? 1).toFixed(2),
                  ready: !!(L.imageryProvider && L.imageryProvider.ready !== false),
                  brightness: +(L.brightness ?? 1).toFixed(2) });
  }
  return {
    apiBase: window.__graticule_api_base,
    renderer: gl ? gl.getParameter(gl.RENDERER) : 'NO WEBGL CONTEXT',
    vendor: gl ? gl.getParameter(gl.VENDOR) : '',
    maxTextureSize: gl ? gl.getParameter(gl.MAX_TEXTURE_SIZE) : 0,
    canvasPx: [v.canvas.width, v.canvas.height],
    canvasCss: [v.canvas.clientWidth, v.canvas.clientHeight],
    resolutionScale: v.resolutionScale,
    globeShow: g.show,
    tilesLoaded: g.tilesLoaded,
    imageryLayers: layers,
    features: feats,
    camera: {
      lat: +Cesium.Math.toDegrees(v.camera.positionCartographic.latitude).toFixed(2),
      lon: +Cesium.Math.toDegrees(v.camera.positionCartographic.longitude).toFixed(2),
      heightKm: Math.round(v.camera.positionCartographic.height / 1000),
    },
    alertsBadge: (document.getElementById('hdr-n-alerts') || {}).textContent,
    scenery: window.__graticule_scenery || null,
  };
})()"""

# Reading the canvas is the only check that cannot be fooled by healthy-looking
# state. A globe that is "shown", with "ready" layers and loaded tiles, still
# renders black if the GPU path is broken.
LUMA = r"""(async () => {
  const v = window.__graticule_viewer;
  v.scene.requestRender();
  await new Promise(r => setTimeout(r, 1200));
  const t = document.createElement('canvas');
  t.width = 64; t.height = 64;
  const x = t.getContext('2d');
  try { x.drawImage(v.canvas, 0, 0, 64, 64); }
  catch (e) { return { error: String(e) }; }
  const d = x.getImageData(0, 0, 64, 64).data;
  let sum = 0, max = 0, lit = 0;
  for (let i = 0; i < d.length; i += 4) {
    const l = (d[i] + d[i + 1] + d[i + 2]) / 3;
    sum += l; if (l > max) max = l; if (l > 8) lit++;
  }
  return { meanLuma: +(sum / 4096).toFixed(2), maxLuma: max,
           litFraction: +(lit / 4096).toFixed(3) };
})()"""


async def cdp(ws_url: str, expr: str, *, await_promise: bool = True):
    import websockets
    async with websockets.connect(ws_url, max_size=64 * 1024 * 1024) as ws:
        await ws.send(json.dumps({
            "id": 1, "method": "Runtime.evaluate",
            "params": {"expression": expr, "returnByValue": True,
                       "awaitPromise": await_promise},
        }))
        while True:
            msg = json.loads(await ws.recv())
            if msg.get("id") == 1:
                res = msg.get("result", {})
                if "exceptionDetails" in res:
                    return {"exception": res["exceptionDetails"].get("text"),
                            "detail": str(res["exceptionDetails"])[:400]}
                return res.get("result", {}).get("value")


async def screenshot(ws_url: str, path: str) -> None:
    import websockets
    async with websockets.connect(ws_url, max_size=256 * 1024 * 1024) as ws:
        await ws.send(json.dumps({"id": 1, "method": "Page.captureScreenshot",
                                  "params": {"format": "png"}}))
        while True:
            msg = json.loads(await ws.recv())
            if msg.get("id") == 1:
                data = msg["result"]["data"]
                with open(path, "wb") as f:
                    f.write(base64.b64decode(data))
                print(f"wrote {path}")
                return


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--eval", help="evaluate an arbitrary expression instead")
    ap.add_argument("--shot", help="write a PNG of the WebView")
    args = ap.parse_args()

    attach()
    ws_url = page_target()

    if args.shot:
        asyncio.run(screenshot(ws_url, args.shot))
        return
    if args.eval:
        print(json.dumps(asyncio.run(cdp(ws_url, args.eval)), indent=2))
        return

    state = asyncio.run(cdp(ws_url, STATE, await_promise=False))
    print(json.dumps(state, indent=2))
    print("\ncanvas:", json.dumps(asyncio.run(cdp(ws_url, LUMA))))


if __name__ == "__main__":
    main()
