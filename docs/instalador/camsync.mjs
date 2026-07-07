/* =====================================================================
   CAMSYNC — conecta las cámaras a Sabor Tico App SOLO (sin pasos manuales)
   Corre junto al puente (docker). Cada minuto:
   1. Lee la dirección pública de los túneles de Cloudflare (gratis).
   2. Lee la lista de cámaras del puente.
   3. Escribe todo en la nube de la app (Firebase) → la sección Cámaras
      de sabortico.app se actualiza sola, aunque el túnel cambie de URL.
   ===================================================================== */
const FB_KEY   = process.env.FB_API_KEY;
const FB_DB    = process.env.FB_DB_URL;
const BRIDGE   = process.env.BRIDGE_URL || 'http://wyze-bridge:5080';
const TUN_CAMS = process.env.TUN_CAMS || 'http://cloudflared-cams:2000';
const TUN_REC  = process.env.TUN_REC  || 'http://cloudflared-rec:2000';

let lastSig = '', token = null, tokenAt = 0;

async function j(url, opts) {
  const r = await fetch(url, opts);
  if (!r.ok) throw new Error(url.split('?')[0] + ' -> ' + r.status);
  return r.json();
}

// sesión anónima en Firebase (las reglas de la app piden auth != null)
async function getToken() {
  if (token && Date.now() - tokenAt < 45 * 60e3) return token;
  const d = await j('https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=' + FB_KEY,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  token = d.idToken; tokenAt = Date.now();
  return token;
}

async function tunnelHost(base) {
  try { const d = await j(base + '/quicktunnel'); return d && d.hostname ? d.hostname : ''; }
  catch (_) { return ''; }
}

// no publicar una dirección hasta que YA resuelva en los DNS públicos
// (si no, el celular pregunta antes de tiempo, cachea el "no existe" y ve error)
async function dnsListo(host) {
  if (!host) return false;
  const check = async (base) => {
    try {
      const d = await j(base + '?name=' + host + '&type=A', { headers: { accept: 'application/dns-json' } });
      return Array.isArray(d.Answer) && d.Answer.length > 0;
    } catch (_) { return false; }
  };
  const [cf, gg] = await Promise.all([check('https://cloudflare-dns.com/dns-query'), check('https://dns.google/resolve')]);
  return cf && gg;
}

async function tick() {
  try {
    const [hCams, hRec] = await Promise.all([tunnelHost(TUN_CAMS), tunnelHost(TUN_REC)]);
    if (!hCams) { console.log(ts(), 'esperando el túnel de cámaras...'); return; }
    if (!(await dnsListo(hCams))) { console.log(ts(), 'esperando que el DNS del túnel se propague...'); return; }
    const recOk = hRec ? await dnsListo(hRec) : false;
    const cams = await j(BRIDGE + '/api/cameras');
    if (!Array.isArray(cams) || !cams.length) { console.log(ts(), 'esperando cámaras del puente...'); return; }

    const now = Date.now();
    const arr = cams.map((c, i) => ({
      id: 'cam_' + c.name,
      name: c.nickname || c.name,
      url: 'https://' + hCams + '/stream.html?src=' + c.name,
      ord: i,
      updatedAt: now,
    }));
    if (recOk) arr.push({ id: 'cam_rec', type: 'rec', name: 'Grabaciones', url: 'https://' + hRec, updatedAt: now });

    const sig = JSON.stringify(arr.map(a => [a.id, a.url, a.name]));
    const t = await getToken();

    // comparar contra lo que hay EN LA NUBE (si una pestaña vieja lo pisó, se restaura)
    let cloudSig = '';
    try {
      const cur = await j(FB_DB + '/state/data/camaras.json?auth=' + t);
      if (Array.isArray(cur)) cloudSig = JSON.stringify(cur.filter(Boolean).map(a => [a.id, a.url, a.name]));
    } catch (_) {}
    if (cloudSig === sig) { lastSig = sig; return; }

    // escritura atómica: las cámaras + un sello de cliente distinto, para que TODAS
    // las pestañas abiertas reciban el cambio (ninguna lo ignora como "propio")
    const res = await fetch(FB_DB + '/state.json?auth=' + t, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client: 'camsync', 'data/camaras': arr }),
    });
    if (!res.ok) throw new Error('firebase -> ' + res.status);

    lastSig = sig;
    console.log(ts(), 'CÁMARAS SINCRONIZADAS CON LA APP:', cams.length, 'cámara(s)', hRec ? '+ grabaciones' : '', '->', hCams);
  } catch (e) {
    console.log(ts(), 'aún no listo:', e.message);
  }
}
function ts() { return new Date().toISOString().slice(11, 19); }

console.log('camsync: las cámaras se conectan solas a Sabor Tico App');
tick();
setInterval(tick, 60 * 1000);
