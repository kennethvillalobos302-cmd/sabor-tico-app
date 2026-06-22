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
const CACHE = 'sabor-tico-v1';
const SHELL = [
  './', './index.html', './app.js', './config.js', './manifest.json', './icon.svg',
  'https://www.gstatic.com/firebasejs/10.12.5/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth-compat.js',
  'https://www.gstatic.com/firebasejs/10.12.5/firebase-database-compat.js'
];

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
  const sameOrigin = url.origin === self.location.origin;
  const isGstatic = url.origin === 'https://www.gstatic.com';
  if (!sameOrigin && !isGstatic) return;                 // Firebase DB / googleapis / otros: no tocar
  if (sameOrigin && url.pathname.startsWith('/api/')) return;  // función serverless: no tocar

  if (isGstatic) {                                        // SDK versionado e inmutable: cache-first
    e.respondWith((async () => {
      const cached = await caches.match(req);
      if (cached) return cached;
      try { const res = await fetch(req); if (res && (res.ok || res.type === 'opaque')) { const c = await caches.open(CACHE); c.put(req, res.clone()); } return res; }
      catch (_) { return cached || Response.error(); }
    })());
    return;
  }

  // Archivos propios (shell): network-first con respaldo a caché cuando no hay señal
  e.respondWith((async () => {
    try {
      const res = await fetch(req);
      if (res && res.ok && (req.mode === 'navigate' || url.pathname === '/' || /\.(js|css|json|svg|html|png|ico)$/.test(url.pathname))) {
        const c = await caches.open(CACHE); c.put(req, res.clone());
      }
      return res;
    } catch (_) {
      const cached = await caches.match(req) || await caches.match('./index.html') || await caches.match('./');
      return cached || Response.error();
    }
  })());
});
