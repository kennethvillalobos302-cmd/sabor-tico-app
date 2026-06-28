/* =====================================================================
   FUNCIÓN SERVERLESS (Vercel) — NOTIFICACIONES PUSH (Web Push / VAPID)
   Envía avisos al celular AUNQUE la app esté cerrada (tareas, mensajes).
   La CLAVE PRIVADA vive solo acá (variable de entorno), nunca en el navegador.

   Variables de entorno requeridas en Vercel:
     VAPID_PUBLIC_KEY   = la llave pública VAPID (también la usa el navegador)
     VAPID_PRIVATE_KEY  = la llave privada VAPID (SECRETA)
     VAPID_SUBJECT      = mailto:tu-correo@dominio.com  (contacto del remitente)
   Cómo generar las llaves (una sola vez):  npx web-push generate-vapid-keys

   Cómo funciona:
   - GET  /api/push?action=key      -> devuelve la llave pública (para suscribir)
   - POST /api/push  { token, to:[idsApp], title, body, url, tag }
       Usa el token de Firebase del REMITENTE para leer por REST las
       suscripciones de cada destinatario (push/<idApp>) y enviarles el aviso.
       Las suscripciones muertas (404/410) se borran solas.
   ===================================================================== */
import webpush from 'web-push';

const DB_URL = (process.env.FIREBASE_DB_URL || 'https://sabor-tico-app-default-rtdb.firebaseio.com').replace(/\/$/, '');
// La llave PÚBLICA no es secreta (el navegador la recibe igual): viene por defecto incrustada,
// así NO hay que configurarla en Vercel. Solo la PRIVADA (VAPID_PRIVATE_KEY) va en variables de entorno.
const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY || 'BAKaPV-0DcQFy9AqV75Zsbr4YMirfgZczA1rosU-LDqPvOfwMNgiEDOVPcRyGiXj0XtQngxvmzfoAi2sHmGlx_Y';
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:kennethvillalobos302@gmail.com';

// Throttle best-effort por IP
const HITS = new Map();
const WINDOW_MS = 60 * 1000;
const MAX_HITS = 120;
function rateLimited(ip) {
  const t = Date.now();
  const arr = (HITS.get(ip) || []).filter(ts => t - ts < WINDOW_MS);
  arr.push(t);
  HITS.set(ip, arr);
  if (HITS.size > 5000) HITS.clear();
  return arr.length > MAX_HITS;
}
function sameOriginOrAbsent(req) {
  const host = req.headers.host;
  const src = req.headers.origin || req.headers.referer;
  if (!src || !host) return true;
  try { return new URL(src).host === host; } catch (_) { return false; }
}
function vapidReady() {
  return !!(VAPID_PUBLIC && process.env.VAPID_PRIVATE_KEY);   // solo falta la privada por configurar
}
function setVapid() {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, process.env.VAPID_PRIVATE_KEY);
}

export default async function handler(req, res) {
  // Pedir la llave pública (sin auth): el navegador la necesita para suscribirse
  if (req.method === 'GET') {
    if ((req.query.action || '') === 'key') {
      res.status(200).json({ key: VAPID_PUBLIC, configured: vapidReady() });
      return;
    }
    res.status(400).json({ error: 'Falta action=key' });
    return;
  }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Método no permitido' }); return; }
  if (!sameOriginOrAbsent(req)) { res.status(403).json({ error: 'Origen no permitido' }); return; }
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'desconocida';
  if (rateLimited(ip)) { res.status(429).json({ error: 'Demasiadas solicitudes' }); return; }
  if (!vapidReady()) { res.status(500).json({ error: 'Las notificaciones no están configuradas (faltan llaves VAPID).' }); return; }

  const body = typeof req.body === 'string'
    ? (() => { try { return JSON.parse(req.body || '{}'); } catch (_) { return {}; } })()
    : (req.body || {});
  const token = String(body.token || '');
  const to = Array.isArray(body.to) ? body.to.filter(Boolean).map(String).slice(0, 200) : [];
  if (!token || !to.length) { res.status(400).json({ error: 'Faltan token o destinatarios' }); return; }

  const payload = JSON.stringify({
    title: String(body.title || 'Sabor Tico').slice(0, 80),
    body: String(body.body || '').slice(0, 240),
    url: String(body.url || './').slice(0, 300),
    tag: body.tag ? String(body.tag).slice(0, 60) : undefined
  });

  setVapid();
  let sent = 0, removed = 0, failed = 0;

  await Promise.all(to.map(async uid => {
    const enc = encodeURIComponent(uid);
    let subs;
    try {
      const r = await fetch(`${DB_URL}/push/${enc}.json?auth=${encodeURIComponent(token)}`);
      if (!r.ok) return;                 // token inválido o sin acceso -> no enviamos
      subs = await r.json();
    } catch (_) { return; }
    if (!subs || typeof subs !== 'object') return;

    await Promise.all(Object.keys(subs).map(async devId => {
      const sub = subs[devId] && subs[devId].sub ? subs[devId].sub : subs[devId];
      if (!sub || !sub.endpoint) return;
      try {
        await webpush.sendNotification(sub, payload);
        sent++;
      } catch (e) {
        failed++;
        const code = e && e.statusCode;
        if (code === 404 || code === 410) {   // suscripción muerta -> borrarla
          try { await fetch(`${DB_URL}/push/${enc}/${encodeURIComponent(devId)}.json?auth=${encodeURIComponent(token)}`, { method: 'DELETE' }); removed++; } catch (_) {}
        }
      }
    }));
  }));

  res.status(200).json({ ok: true, sent, removed, failed });
}
