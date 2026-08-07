/* Where the backend lives.
 *
 * Empty string means "the origin that served this file", which is correct for
 * the web build and for `python -m graticule` on a desktop.
 *
 * The Android build rewrites THIS FILE and nothing else, so index.html and
 * app.js stay byte-identical between the web and native builds and a bug can
 * never be "it works on the web but not in the app" for a reason hidden in
 * two diverging copies of the page.
 *
 * scripts/android_build.py writes the value from --api-base.
 * A `?api=https://host` query parameter overrides whatever is here.
 */
window.GRATICULE_API_BASE = '';
