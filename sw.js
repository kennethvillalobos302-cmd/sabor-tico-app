/* =====================================================================
   Service Worker — Sabor Tico App
   Permite que la app ABRA SIN INTERNET y muestre lo último cargado
   (clave para zonas sin señal: cocina, bodega, sótano).
   Estrategia:
   - Archivos propios (index.html, app.js, config.js, etc.): network-first
     (online siempre trae lo último; sin señal cae a la copia en caché).
   - Scripts de Firebase (gstatic, versionados): cache-first.
   - NO intercepta la base en tiempo real (firebaseio/googleapis) ni /api/:
     se dejan pasar para que Firebase maneje su propia conexión/cola offline.
   ===================================================================== */
const CACHE = 'sabor-tico-v4';
// Solo cacheamos archivos PROPIOS. Los scripts de Firebase (gstatic) NO se interceptan:
// se cargan directo con <script> (lo permite script-src). Si el SW los pidiera con fetch(),
// la CSP (connect-src) los bloquea y el SDK de Firebase no carga -> se rompe la nube.
const SHELL = [ './', './index.html', './app.js', './config.js', './manifest.json', './icon.svg' ];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await Promise.allSettled(SHELL.map(u => c.add(u)));   // si alguno falla, no aborta la instalación
    self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));   // limpiar versiones viejas
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  let url; try { url = new URL(req.url); } catch (_) { return; }
  if (url.origin !== self.location.origin) return;       // TODO lo de afuera (Firebase, gstatic, googleapis): NO tocar
  if (url.pathname.startsWith('/api/')) return;           // función serverless: no tocar

  // Archivos propios (shell): SIEMPRE lo último cuando hay señal (no-store evita caché HTTP rancia);
  // solo cae a la copia guardada cuando no hay conexión.
  e.respondWith((async () => {
    try {
      const res = await fetch(req.url, { cache: 'no-store' });
      if (res && res.ok) { const c = await caches.open(CACHE); c.put(req, res.clone()); }
      return res;
    } catch (_) {
      const cached = await caches.match(req) || await caches.match('./index.html') || await caches.match('./');
      return cached || Response.error();
    }
  })());
});
