"""Cupola — pywebview launcher.

Boots the FastAPI backend in a daemon thread, opens a single dark window
pointed at it. Closing the window kills the process group.
"""
from __future__ import annotations

import threading
import time

import webview
from dotenv import load_dotenv

from cupola.server import run_server

PORT = 8731  # arbitrary, local-only

if __name__ == "__main__":
    load_dotenv()

    server_thread = threading.Thread(
        target=run_server, args=(PORT,), daemon=True, name="cupola-server"
    )
    server_thread.start()
    time.sleep(0.4)  # let uvicorn bind before the webview hits it

    webview.create_window(
        title="Cupola",
        url=f"http://127.0.0.1:{PORT}/",
        width=1600,
        height=1000,
        background_color="#000000",
        confirm_close=False,
    )
    webview.start()
