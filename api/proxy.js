/* The only server-side code Graticule still needs.
 *
 * web/feeds.js runs every feed in the page. On Android that is the whole
 * story: Capacitor makes each request in native code, where there is no
 * origin and so no CORS check, and the APK talks to nobody else.
 *
 * A browser is different. Ten of the seventeen providers send
 * Access-Control-Allow-Origin and seven do not, so the web build needs
 * something same-origin to fetch on its behalf. That is all this is.
 *
 * It is STATELESS, which is the point. The old backend held the merged
 * picture in memory and polled sixteen feeds forever, so it had to stay
 * awake, so it needed a host that does not sleep, so it needed a card. This
 * holds nothing between calls, which means a free serverless tier is enough
 * and there is nothing to keep running.
 *
 * AN OPEN PROXY IS A LIABILITY, not a convenience. Anyone who can reach it
 * can make this function fetch anything, including addresses inside whatever
 * network it runs on. So the allowlist is exact hostnames, https only, and
 * anything else is refused before a socket is opened.
 *
 * graticule/server.py carries the same route for the desktop build and the
 * test suites. scripts/static_checks.py asserts the two host lists are
 * identical, so they cannot drift.
 */

const ALLOWED = new Set([
  'api.adsb.lol',
  'api.airplanes.live',
  'api.open-meteo.com',
  'api.rainviewer.com',
  'api.weather.gov',
  'celestrak.org',
  'davidmegginson.github.io',
  'earthquake.usgs.gov',
  'eonet.gsfc.nasa.gov',
  'firms.modaps.eosdis.nasa.gov',
  'll.thespacedevs.com',
  'meri.digitraffic.fi',
  'opendata.adsb.fi',
  'services.swpc.noaa.gov',
  'tfr.faa.gov',
  'webservices.volcano.si.edu',
  'www.nhc.noaa.gov',
  'www.submarinecablemap.com',
  // The ten on-demand endpoints web/feeds.js now answers itself.
  'api.tidesandcurrents.noaa.gov',
  'api.water.noaa.gov',
  'aviationweather.gov',
  'cameras.alertcalifornia.org',
  'cwwp2.dot.ca.gov',
  'mesonet.agron.iastate.edu',
  'webcams.nyctmc.org',
  'www.ndbc.noaa.gov',
  'www.spc.noaa.gov',
  'www.spotternetwork.org',
]);

export default async function handler(req, res) {
  const raw = req.query && req.query.url;
  if (!raw || typeof raw !== 'string') {
    res.status(400).json({ error: 'missing url' });
    return;
  }

  let target;
  try {
    target = new URL(raw);
  } catch (e) {
    res.status(400).json({ error: 'unparseable url' });
    return;
  }
  if (target.protocol !== 'https:') {
    res.status(400).json({ error: 'https only' });
    return;
  }
  if (!ALLOWED.has(target.hostname)) {
    res.status(403).json({ error: `host not allowed: ${target.hostname}` });
    return;
  }

  try {
    const upstream = await fetch(target.href, {
      headers: {
        'User-Agent': 'graticule/1.0',
        // Digitraffic refuses a request that does not advertise gzip, with a
        // 406 and a one-line explanation. Everything else ignores it.
        'Accept-Encoding': 'gzip',
      },
    });
    const body = Buffer.from(await upstream.arrayBuffer());
    res.status(upstream.status);
    res.setHeader('content-type',
      upstream.headers.get('content-type') || 'application/octet-stream');
    // The page and this function are the same origin, so no CORS header is
    // needed and none is sent. Adding one would only widen who can use it.
    res.send(body);
  } catch (e) {
    res.status(502).json({ error: `upstream ${e && e.name ? e.name : 'error'}` });
  }
}
