"""Install Graticule shortcuts in the Windows Start Menu and on the Desktop.

What it does:
  1. Generates a simple Graticule.ico (a dark globe with a meridian line)
     and writes it to <project>/web/graticule.ico.
  2. Creates Start Menu shortcut at:
        %APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs\\Graticule.lnk
  3. Creates Desktop shortcut at:
        %USERPROFILE%\\Desktop\\Graticule.lnk

Both shortcuts launch:
        <project>\\.venv\\Scripts\\pythonw.exe <project>\\main.py
with the project as the working directory.

To pin to taskbar (Windows 11 doesn't allow programmatic pinning):
  - Open the Start menu
  - Right-click the Graticule entry
  - Choose "Pin to taskbar"

Run:
  uv run python scripts/install_shortcut.py
"""
from __future__ import annotations

import os
from pathlib import Path

try:
    import win32com.client  # type: ignore
except ImportError:
    raise SystemExit("pywin32 not installed. Run: uv pip install pywin32")

try:
    from PIL import Image, ImageDraw  # type: ignore
except ImportError:
    raise SystemExit("Pillow not installed. Run: uv pip install pillow")


PROJECT = Path(__file__).resolve().parent.parent
ICON_PATH = PROJECT / "web" / "graticule.ico"
PYTHONW = PROJECT / ".venv" / "Scripts" / "pythonw.exe"
MAIN = PROJECT / "main.py"


def make_icon() -> Path:
    """Render a multi-resolution Graticule icon — dark sphere + meridian /
    parallel cross — and save as .ico."""
    sizes = [(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)]
    images = []
    for w, h in sizes:
        img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        d = ImageDraw.Draw(img)
        cx, cy = w / 2, h / 2
        r = min(w, h) * 0.46
        # Disc
        d.ellipse((cx - r, cy - r, cx + r, cy + r),
                  fill=(8, 12, 20, 255),
                  outline=(80, 180, 220, 255),
                  width=max(2, w // 64))
        # Equator
        d.line((cx - r, cy, cx + r, cy), fill=(120, 170, 200, 220), width=max(1, w // 96))
        # Prime meridian (bowed slightly to suggest a sphere)
        d.line((cx, cy - r, cx, cy + r), fill=(120, 170, 200, 220), width=max(1, w // 96))
        # Two cool slate parallels above and below the equator
        ph = r * 0.55
        for sign in (-1, 1):
            d.arc((cx - r, cy - r, cx + r, cy + r),
                  start=180 if sign == -1 else 0,
                  end=360 if sign == -1 else 180,
                  fill=(0, 0, 0, 0))
            # stylised flat parallels (true ellipses are heavier; flat lines read fine at small sizes)
            d.line((cx - r * 0.85, cy + sign * ph, cx + r * 0.85, cy + sign * ph),
                   fill=(80, 130, 160, 180), width=max(1, w // 128))
        # Subtle accent dot at the centre
        dot = max(1, w // 48)
        d.ellipse((cx - dot, cy - dot, cx + dot, cy + dot), fill=(77, 210, 255, 255))
        images.append(img)
    images[0].save(ICON_PATH, format="ICO", sizes=[s for s in sizes])
    print(f"  wrote {ICON_PATH}")
    return ICON_PATH


def make_shortcut(path: Path, name: str = "Graticule") -> None:
    sh = win32com.client.Dispatch("WScript.Shell")
    lnk = sh.CreateShortcut(str(path))
    lnk.TargetPath = str(PYTHONW)
    lnk.Arguments = f'"{MAIN}"'
    lnk.WorkingDirectory = str(PROJECT)
    lnk.IconLocation = str(ICON_PATH)
    lnk.Description = "Graticule — situational-awareness globe"
    lnk.WindowStyle = 1
    lnk.Save()
    print(f"  wrote {path}")


def main() -> None:
    if not PYTHONW.exists():
        raise SystemExit(f"pythonw not found at {PYTHONW}. Run `uv sync` first.")
    if not MAIN.exists():
        raise SystemExit(f"main.py not found at {MAIN}.")

    print("rendering icon …")
    make_icon()

    appdata = Path(os.environ.get("APPDATA", ""))
    start_menu = appdata / "Microsoft" / "Windows" / "Start Menu" / "Programs"
    desktop = Path(os.environ.get("USERPROFILE", "")) / "Desktop"

    print("creating Start Menu shortcut …")
    start_menu.mkdir(parents=True, exist_ok=True)
    make_shortcut(start_menu / "Graticule.lnk")

    print("creating Desktop shortcut …")
    if desktop.exists():
        make_shortcut(desktop / "Graticule.lnk")
    else:
        print(f"  desktop not found at {desktop} — skipping")

    print()
    print("DONE.")
    print("  - Search 'Graticule' in the Start menu.")
    print("  - To pin to taskbar: right-click the Start menu entry → 'Pin to taskbar'.")


if __name__ == "__main__":
    main()
