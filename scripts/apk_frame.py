"""Read the APK's real framebuffer, and prove the reader works.

Two capture paths lied about this WebView, in two different directions:

  * `adb exec-out screencap` returned a PURE BLACK globe region (mean luma
    0.64). SurfaceFlinger does not read back the WebView's hardware WebGL
    layer.
  * DevTools `Page.captureScreenshot` returned a WHITE ELLIPSE OF HORIZONTAL
    SCANLINES. The compositor resamples that same layer and produces garbage.

Either one on its own is convincing, and both are wrong. Three hours could go
into debugging a shader that renders correctly. So this bypasses the
compositor entirely: `gl.readPixels` on Cesium's own context, immediately
after `scene.render()`, is the actual output of the actual draw calls.

`--control` proves the reader can fail, by hiding the globe and showing the
numbers collapse. A capture that reports the same thing either way is not
evidence of anything.

    py -V:3.13 scripts/apk_frame.py out.png
    py -V:3.13 scripts/apk_frame.py out.png --control
"""
from __future__ import annotations

import argparse
import asyncio
import base64
import sys

sys.path.insert(0, __file__.rsplit("\\", 1)[0] if "\\" in __file__ else ".")
import apk_probe as P  # noqa: E402

# readPixels returns rows bottom-up; ImageData wants them top-down, hence the
# row flip. Without it the globe is upside down and looks like a second bug.
GRAB = r"""(() => {
  const v = window.__graticule_viewer, s = v.scene;
  const gl = s.context._gl;
  s.render();
  const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
  const px = new Uint8Array(w * h * 4);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);

  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    const src = (h - 1 - y) * w * 4, dst = y * w * 4;
    img.data.set(px.subarray(src, src + w * 4), dst);
  }
  ctx.putImageData(img, 0, 0);

  let lit = 0, colour = 0, tot = 0, maxSat = 0;
  for (let i = 0; i < px.length; i += 4 * 37) {
    const r = px[i], g = px[i+1], b = px[i+2];
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    tot++;
    if (mx > 10) lit++;
    if (mx - mn > 18) colour++;
    if (mx - mn > maxSat) maxSat = mx - mn;
  }
  return { png: c.toDataURL('image/png'), size: [w, h],
           litFraction: +(lit/tot).toFixed(3),
           colourFraction: +(colour/tot).toFixed(3),
           maxSaturation: maxSat };
})()"""

HIDE = "window.__graticule_viewer.scene.globe.show = false, 'hidden'"
SHOW = "window.__graticule_viewer.scene.globe.show = true, 'shown'"


async def grab(ws, path):
    r = await P.cdp(ws, GRAB, await_promise=False)
    if not isinstance(r, dict) or "png" not in r:
        raise SystemExit(f"grab failed: {r}")
    with open(path, "wb") as f:
        f.write(base64.b64decode(r["png"].split(",", 1)[1]))
    return r


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("out")
    ap.add_argument("--control", action="store_true",
                    help="also capture with the globe hidden, to prove the reader can fail")
    args = ap.parse_args()

    P.attach()
    ws = P.page_target()

    live = await grab(ws, args.out)
    print(f"globe visible  -> {args.out}  lit={live['litFraction']} "
          f"colour={live['colourFraction']} maxSat={live['maxSaturation']}")

    if args.control:
        await P.cdp(ws, HIDE, await_promise=False)
        await asyncio.sleep(2)
        ctrl_path = args.out.replace(".png", "_control.png")
        ctrl = await grab(ws, ctrl_path)
        await P.cdp(ws, SHOW, await_promise=False)
        print(f"globe hidden   -> {ctrl_path}  lit={ctrl['litFraction']} "
              f"colour={ctrl['colourFraction']} maxSat={ctrl['maxSaturation']}")
        if ctrl["colourFraction"] >= live["colourFraction"]:
            print("  FAIL: hiding the globe changed nothing. This reader proves nothing.")
            sys.exit(1)
        print("  the reader distinguishes a drawn globe from a hidden one.")


asyncio.run(main())
