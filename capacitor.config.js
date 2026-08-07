/* Capacitor config.
 *
 * A .js config rather than .json because ONE value has to be derived rather
 * than written down, and having two configs that can disagree is worse than
 * having one that computes.
 *
 * ---- androidScheme, and the bug that made this necessary -------------------
 *
 * Capacitor serves the app to the WebView over `https://localhost` by default.
 * That is the right default and should stay: it is a secure context, so
 * service workers, geolocation and the rest behave the way they do on the web.
 *
 * But a secure page may not call an insecure backend. The first APK built here
 * pointed at `http://10.0.2.2:8744` and every single request was refused:
 *
 *   Mixed Content: The page at 'https://localhost/' was loaded over HTTPS, but
 *   requested an insecure resource 'http://10.0.2.2:8744/api/config'.
 *
 * The WebView is right and the network security config cannot help: mixed
 * content is a rule about the PAGE's scheme, decided before any socket opens.
 *
 * So the page's scheme follows the backend's. An https backend, which is the
 * only thing a shipped build may ever point at, keeps `https`. A plain-http
 * backend on a developer's desk drops the page to `http`, which is still a
 * secure context on localhost by specification, so nothing else changes.
 *
 * scripts/android_build.py sets GRATICULE_API_BASE before `cap sync` and
 * REFUSES to build a release with anything but https.
 */
const base = process.env.GRATICULE_API_BASE || '';
const insecureBackend = base.startsWith('http://');

if (insecureBackend) {
  console.warn(
    `[capacitor.config] backend is ${base} (plain http), so the page is served\n` +
    '  over http://localhost to avoid mixed-content blocking. DEVELOPMENT ONLY.');
}

/** @type {import('@capacitor/cli').CapacitorConfig} */
module.exports = {
  appId: 'dev.dbhavery.graticule',
  appName: 'Graticule',
  webDir: 'dist',
  android: {
    // Never true. If a build needs it, the backend is on the wrong scheme and
    // the fix belongs there.
    allowMixedContent: false,
    backgroundColor: '#04070dff',
  },
  server: {
    androidScheme: insecureBackend ? 'http' : 'https',
  },
  plugins: {
    StatusBar: {
      overlaysWebView: true,
      style: 'DARK',
      backgroundColor: '#00000000',
    },
  },
};
