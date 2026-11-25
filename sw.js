// à la jam's service worker (docs/PWA.md). build.mjs (tools/pwa-build.mjs) writes it to dist/sw.js with the build's
// version and the pages to keep. It lives next to the page, so its scope is the page's folder (/a-la_jam/ on GitHub).
//   the page      network first (a new version arrives as soon as there is one), the kept copy when offline
//   samples       stale-while-revalidate: played from the jar at once, refreshed behind it; every sample you've heard
//                 once plays offline
//   fonts         the Google fonts, the same way (so the lettering stays when offline)
//   never         the visit counter (gc.zgo.at, goatcounter), Oura and anything else that isn't ours: not cached, not
//                 even touched (no respondWith, the browser fetches them itself)
const VERSION = "f1e637c7c5";
const PAGES = ["./","index.html","manifest.webmanifest","mobile.webmanifest","icons/icon-192.png","icons/icon-512.png","icons/apple-touch-icon.png","icons/favicon-32.png","icons/phone-touch-icon.png","icons/phone-192.png"];                       // e.g. ['./', 'index.html', 'manifest.webmanifest', 'icons/icon-192.png', …]
const PAGE_CACHE = 'alajam-page-' + VERSION;  // a new build, a new jar: the old one is thrown away on activate
const SAMPLE_CACHE = 'alajam-samples-1';       // kept across builds (stale-while-revalidate keeps it fresh)
const FONT_CACHE = 'alajam-fonts-1';
const KEEP = [PAGE_CACHE, SAMPLE_CACHE, FONT_CACHE];
const FONT_HOSTS = /^(fonts\.googleapis\.com|fonts\.gstatic\.com)$/;
const NEVER = /(^|\.)(zgo\.at|goatcounter\.com|ouraring\.com)$/i;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(PAGE_CACHE).then(c => Promise.all(PAGES.map(u => c.add(new Request(u, { cache: 'reload' })).catch(() => null)))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('alajam-') && !KEEP.includes(k)).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('message', e => { if (e.data === 'version' && e.source) e.source.postMessage({ sw: VERSION }); });

self.addEventListener('fetch', e => {
  const q = e.request; if (q.method !== 'GET' || q.headers.has('range')) return;
  let u; try { u = new URL(q.url); } catch (err) { return; }
  if (NEVER.test(u.hostname)) return;
  if (u.origin !== self.location.origin) { if (FONT_HOSTS.test(u.hostname)) e.respondWith(swr(e, FONT_CACHE)); return; }
  const scope = new URL(self.registration.scope).pathname;
  if (!u.pathname.startsWith(scope)) return;
  const rel = u.pathname.slice(scope.length);
  if (/(^|\/)api\//.test(rel) || /oura/i.test(rel)) return;
  if (rel.startsWith('samples/')) { e.respondWith(swr(e, SAMPLE_CACHE)); return; }
  if (q.mode === 'navigate' || rel === '' || /\.html$/.test(rel)) { e.respondWith(networkFirst(e)); return; }
  if (rel === 'manifest.webmanifest' || /\.webmanifest$/.test(rel) || rel.startsWith('icons/')) e.respondWith(swr(e, PAGE_CACHE));
});

// the network, with a short wait; the kept copy (any query string) when it's slow or gone
async function networkFirst(e) {
  const q = e.request, c = await caches.open(PAGE_CACHE);
  try {
    const r = await Promise.race([fetch(q.url, { cache: 'no-cache', credentials: 'same-origin' }),   // (no-cache: past the browser's own HTTP cache too, so a new build is never missed)
      new Promise((_, no) => setTimeout(() => no(new Error('slow')), 6000))]);
    if (r && r.ok && r.type === 'basic') e.waitUntil(c.put(q.url.split('?')[0].split('#')[0], r.clone()).catch(() => null));
    return r;
  } catch (err) {
    const hit = await c.match(q, { ignoreSearch: true }) || (q.mode === 'navigate' ? await c.match('index.html', { ignoreSearch: true }) || await c.match('./') : null);
    if (hit) return hit;
    throw err;
  }
}
// from the jar at once; fetched again behind it (or from the network when it isn't in the jar yet)
async function swr(e, name) {
  const q = e.request, c = await caches.open(name), hit = await c.match(q);
  const fresh = fetch(q).then(async r => { if (r && (r.ok || r.type === 'opaque')) await c.put(q, r.clone()).catch(() => null); return r; });
  if (hit) { e.waitUntil(fresh.catch(() => null)); return hit; }
  return fresh;
}
