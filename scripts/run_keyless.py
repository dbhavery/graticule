"""Boot Graticule with every API key blanked.

This is what a fresh clone looks like: no .env, no signups, nothing. Used by
scripts/keyless_test.py, and useful on its own for checking that a change has
not quietly reintroduced a key requirement.

    py -V:3.13 scripts/run_keyless.py [port]

load_dotenv() does not overwrite variables that are already set, so exporting
these as empty strings is what stops a real .env from putting them back. That
assumption is the whole basis of the test, so it is asserted rather than
trusted -- if a key leaks through, this refuses to start instead of running a
suite that passes for the wrong reason.
"""
from __future__ import annotations

import os
import sys

KEYS = (
    "CESIUM_ION_TOKEN", "GOOGLE_MAPS_API_KEY", "FIRMS_MAP_KEY", "AISSTREAM_KEY",
    "OPENSKY_CLIENT_ID", "OPENSKY_CLIENT_SECRET", "OPENSKY_USER", "OPENSKY_PASS",
)

for k in KEYS:
    os.environ[k] = ""

from dotenv import load_dotenv  # noqa: E402

load_dotenv()

leaked = [k for k in KEYS if os.environ.get(k)]
if leaked:
    sys.exit(f"REFUSING TO START: {', '.join(leaked)} leaked back in from .env — "
             "any test run against this server would be meaningless.")

print(f"all {len(KEYS)} keys blank after load_dotenv()", flush=True)

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8743

# Refuse to start on a port someone else already owns.
#
# This is not hypothetical. On 2026-08-05 a second instance was launched over a
# first one, uvicorn logged "error while attempting to bind" three lines deep in
# the log and carried on running its FEED tasks, and the whole keyless suite
# then ran against the OLD process's HTTP server. Nineteen checks passed against
# code that no longer existed. Only a control assertion caught it.
#
# A background server that half-starts is worse than one that does not start.
import socket  # noqa: E402

with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
    if probe.connect_ex(("127.0.0.1", PORT)) == 0:
        sys.exit(f"REFUSING TO START: something is already listening on {PORT}. "
                 "Stop it first — otherwise this process runs its feeds while the "
                 "OLD server answers HTTP, and every test result is a lie.")

from graticule.server import run_server  # noqa: E402

run_server(PORT)
