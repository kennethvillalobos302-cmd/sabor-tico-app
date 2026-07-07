/* =====================================================================
   FUNCIÓN SERVERLESS (Vercel) — Acceso a las REUNIONES (Jitsi as a Service)
   Firma un "pase" (JWT) para entrar a la reunión incrustada SIN el límite de
   5 minutos del Jitsi público. La CLAVE PRIVADA vive solo acá (variables de
   entorno), nunca en el navegador.

   Variables de entorno requeridas en Vercel (ver docs/CONECTAR-REUNIONES.md):
     JAAS_KID          = el "Key ID" del par de llaves (ej: vpaas-magic-cookie-abc123/d4e5f6)
     JAAS_PRIVATE_KEY  = el contenido de la clave privada (PEM, con -----BEGIN/END PRIVATE KEY-----)
   El AppID se deduce del JAAS_KID (la parte antes de la "/").
   ===================================================================== */
import crypto from 'node:crypto';

// Throttle best-effort por IP (en memoria; se reinicia en cada arranque en frío).
const HITS = new Map();
const WINDOW_MS = 10 * 60 * 1000;
const MAX_HITS = 60;
function rateLimited(ip) {
  const t = Date.now();
  const arr = (HITS.get(ip) || []).filter(ts => t - ts < WINDOW_MS);
  arr.push(t);
  HITS.set(ip, arr);
  if (HITS.size > 5000) HITS.clear();
  return arr.length > MAX_HITS;
}
// Solo desde la propia app (defensa en profundidad).
function sameOriginOrAbsent(req) {
  const host = req.headers.host;
  const src = req.headers.origin || req.headers.referer;
  if (!src || !host) return true;
  try { return new URL(src).host === host; } catch (_) { return false; }
}
function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.status(405).json({ error: 'Método no permitido' });
    return;
  }
  if (!sameOriginOrAbsent(req)) {
    res.status(403).json({ error: 'Origen no permitido' });
    return;
  }
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'desconocida';
  if (rateLimited(ip)) {
    res.status(429).json({ error: 'Demasiadas solicitudes. Probá en unos minutos.' });
    return;
  }

  const rawKid = process.env.JAAS_KID;
  let pk = process.env.JAAS_PRIVATE_KEY;
  if (!rawKid || !pk) {
    res.status(500).json({ error: 'Las reuniones no están configuradas (falta la cuenta JaaS).' });
    return;
  }
  pk = pk.replace(/\\n/g, '\n'); // por si la clave quedó con \n literales
  // El AppID puede venir en su propia variable (JAAS_APP_ID) o ya incluido en el kid (AppID/IDdeLlave).
  const appId = (process.env.JAAS_APP_ID || String(rawKid).split('/')[0] || '').trim();
  // El "kid" del JWT DEBE ser "AppID/IDdeLlave". Si en JAAS_KID quedó solo el ID de la llave, lo armamos.
  let kid = String(rawKid).trim();
  if (kid.indexOf('/') === -1) kid = appId + '/' + kid;

  // datos del usuario que llegan del cliente: NO confiables, se limpian
  const q = req.method === 'GET'
    ? (req.query || {})
    : (typeof req.body === 'string' ? (() => { try { return JSON.parse(req.body || '{}'); } catch (_) { return {}; } })() : (req.body || {}));
  const name = String(q.name || 'Invitado').slice(0, 60);
  const uid = String(q.uid || 'user').slice(0, 64).replace(/[^A-Za-z0-9_-]/g, '') || 'user';

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', kid, typ: 'JWT' };
  const payload = {
    aud: 'jitsi',
    iss: 'chat',
    sub: appId,
    room: '*',
    iat: now,
    nbf: now - 10,
    exp: now + 3 * 60 * 60, // 3 horas
    context: {
      user: { name, id: uid, avatar: '', email: '', moderator: 'true' },
      features: { livestreaming: 'false', recording: 'false', transcription: 'false', 'outbound-call': 'false' }
    }
  };

  try {
    const data = b64url(JSON.stringify(header)) + '.' + b64url(JSON.stringify(payload));
    const sig = crypto.createSign('RSA-SHA256').update(data).sign(pk);
    const jwt = data + '.' + b64url(sig);
    res.status(200).json({ jwt, appId });
  } catch (e) {
    console.error('meet-token', (e && e.message) || e); // detalle solo en logs del servidor
    res.status(500).json({ error: 'No se pudo generar el acceso a la reunión.' });
  }
}
