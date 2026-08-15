# The backend, for a host that runs one always-on process.
#
# NOT serverless, and the reason is structural rather than a preference. The
# feed loops are long-lived asyncio tasks that poll about twenty upstreams on
# their own schedules, and the state they build is in memory. A platform that
# scales to zero stops the feeds; a platform that scales to N multiplies the
# polling against volunteer ADS-B infrastructure, which is rude at best and
# gets the app blocked at worst. One machine, always up, is the correct shape.
#
# Deps are installed explicitly rather than with `pip install .` so that
# pywebview, which is a DESKTOP dependency and needs a GUI toolkit, never
# enters the image. Keep this list in step with pyproject.toml; there is no
# clever way to share it that is worth the indirection for six lines.
FROM python:3.13-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

RUN pip install --no-cache-dir \
      "fastapi>=0.115" \
      "uvicorn[standard]>=0.30" \
      "httpx>=0.27" \
      "websockets>=13" \
      "python-dotenv>=1.0" \
      "loguru>=0.7"

# The package and the web assets it serves. `WEB_DIR` resolves to the sibling
# of the package directory, so this layout has to be kept: /app/graticule and
# /app/web, not one inside the other.
COPY graticule/ /app/graticule/
COPY web/ /app/web/

# Fly routes to this. GRATICULE_HOST is the app's own opt-in for binding to
# something other than loopback, which is deliberate rather than default.
ENV GRATICULE_HOST=0.0.0.0 \
    GRATICULE_PORT=8080
EXPOSE 8080

# Run through run_server rather than uvicorn directly so the binding warning,
# the access-log-off decision and the port handling stay in one place.
CMD ["python", "-c", "import os; from graticule.server import run_server; run_server(int(os.environ.get('GRATICULE_PORT', 8080)), os.environ.get('GRATICULE_HOST', '0.0.0.0'))"]
