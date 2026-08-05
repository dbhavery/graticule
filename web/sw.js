/* Graticule service worker.
 *
 * An installed weather app that shows a browser error page when the train goes
 * into a tunnel is not an installed app. This gives the shell an offline
 * existence and, more importantly, is honest about what it cannot do: radar
 * from four minutes ago is useful and labelled; radar from four hours ago
 * presented as current is worse than no radar at all.
 *
 * Three strategies, chosen per request by what the thing actually is:
 *
 *   shell      cache-first, precached at install. app.js, style.css, the
 *              document, icons. Versioned, so a deploy replaces it wholesale.
 *   tiles      stale-while-revalidate with a cap. Map tiles are immutable for
 *              a given z/x/y and expensive to fetch twice.
 *   live data  network-first with a short timeout, falling back to cache and
 *              stamping the response so the app can say how old it is.
 *
 * Nothing here caches a POST, an opaque cross-origin response, or anything
 * from /api/ that came back an error.
 */

const VERSION = 'graticule-v3';
const SHELL = `${VERSION}-shell`;
const TILES = `${VERSION}-tiles`;
const DATA  = `${VERSION}-data`;

const TILE_CAP = 600;          // roughly a few full screens at two zoom levels
const DATA_TIMEOUT_MS = 4500;  // past this, whatever we have beats a spinner

const SHELL_URLS = [
  '/',
  '/static/app.js',
  '/static/style.css',
  '/manifest.webmanifest',
  '/static/icons/icon-192.png',
  '/static/icons/icon-512.png',
  '/static/icons/maskable-192.png',
  '/static/icons/maskable-512.png',
  '/offline.html',
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(SHELL);
    // addAll is all-or-nothing: one 404 and the whole install fails, leaving no
    // worker at all. Each is added on its own so a missing optional asset
    // cannot take the shell down with it.
    await Promise.all(SHELL_URLS.map((u) =>
      c.add(new Request(u, { cache: 'reload' })).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keep = new Set([SHELL, TILES, DATA]);
    for (const k of await caches.keys()) if (!keep.has(k)) await caches.delete(k);
    await self.clients.claim();
  })());
});

/* Oldest-first eviction. A cache with no bound will grow until the browser
   evicts the whole origin, which takes the shell with it. */
async function trim(cacheName, cap) {
  const c = await caches.open(cacheName);
  const keys = await c.keys();
  for (let i = 0; i < keys.length - cap; i++) await c.delete(keys[i]);
}

function isTile(url) {
  return /\/tile\/|\/tiles\/|\{z\}|\/wmts\/|tilecache|\.(png|jpe?g|webp)(\?|$)/i.test(url.pathname)
      && !url.pathname.startsWith('/static/icons/');
}

/* The timeout only applies when there is something to fall back TO.
 *
 * The first version aborted every /api/ request at 4.5s unconditionally, and
 * that took a working app and broke it: /api/nws/alerts returns in about a
 * second on its own, but at boot it competes with a dozen other calls, went
 * past the deadline, and the worker turned a slow SUCCESS into a hard 503 the
 * app had no cached copy to replace. Two console errors that did not exist
 * before the worker was added.
 *
 * Aborting is only ever worth it as "prefer the copy I already have over
 * waiting" -- which requires having a copy. With an empty cache the right
 * behaviour is to wait as long as the network wants, exactly as it did before
 * any of this existed. A service worker that makes the online case worse has
 * no business being installed. */
async function networkFirst(req) {
  const c = await caches.open(DATA);
  const cached = await c.match(req);
  let timer = null;
  try {
    let opts;
    if (cached) {
      const ctl = new AbortController();
      timer = setTimeout(() => ctl.abort(), DATA_TIMEOUT_MS);
      opts = { signal: ctl.signal };
    }
    const res = await fetch(req, opts);
    if (res.ok) {
      // Stamp when we stored it. The app reads this header to say "4 min old"
      // rather than presenting stale radar as current.
      const body = await res.clone().blob();
      const h = new Headers(res.headers);
      h.set('X-Graticule-Cached-At', new Date().toUTCString());
      c.put(req, new Response(body, { status: res.status, headers: h }));
    }
    return res;
  } catch {
    if (cached) return cached;
    throw new Error('offline and nothing cached');
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function staleWhileRevalidate(req, cacheName, cap) {
  const c = await caches.open(cacheName);
  const hit = await c.match(req);
  const net = fetch(req).then((res) => {
    if (res.ok && res.type !== 'opaque') {
      c.put(req, res.clone()).then(() => trim(cacheName, cap));
    }
    return res;
  }).catch(() => null);
  return hit || net || fetch(req);
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // A navigation must never be the thing that shows a browser error page, and
  // it must never hang either. A dead network does not always reject: on a
  // captive portal, a dropped mobile connection, or Playwright's offline
  // emulation, the fetch simply never settles, and an unraced await here means
  // the app does not open at all. Measured: a reload with the network cut sat
  // for the full 30s test timeout before this race existed.
  //
  // 3s, because this only costs anything when the network is already broken --
  // a working connection resolves long before it and the cache is never
  // consulted.
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      const shell = async () =>
        (await caches.match('/')) || (await caches.match('/offline.html'))
        || new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/html' } });
      try {
        const res = await Promise.race([
          fetch(req),
          new Promise((_, rej) => setTimeout(() => rej(new Error('slow')), 3000)),
        ]);
        return res;
      } catch {
        return shell();
      }
    })());
    return;
  }

  if (url.origin === self.location.origin && url.pathname.startsWith('/api/')) {
    e.respondWith(networkFirst(req).catch(() =>
      new Response(JSON.stringify({ error: 'offline', offline: true }),
                   { status: 503, headers: { 'Content-Type': 'application/json' } })));
    return;
  }

  if (isTile(url)) {
    e.respondWith(staleWhileRevalidate(req, TILES, TILE_CAP));
    return;
  }

  if (url.origin === self.location.origin) {
    e.respondWith(staleWhileRevalidate(req, SHELL, 120));
  }
  // Everything else -- Cesium's CDN, fonts -- is left to the browser cache.
  // Precaching a 4MB third-party bundle we do not version is how a stale
  // library outlives the app that shipped it.
});
