/* =====================================================================
   SABOR TICO APP  —  app.js
   Plataforma de gestión integral de restaurante (local, localStorage).
   ===================================================================== */

const DB_KEY = 'saborTico_v1';
const APP_VERSION = 'v127 · Privacidad de tareas: cada quien ve solo lo suyo';  // se muestra en el menú de cuenta para confirmar la versión
/* Versión de datos: al subir este número, la app hace una limpieza única
   (deja el equipo y las sucursales, borra los datos de ejemplo) en todos los
   dispositivos la próxima vez que abran. Subir solo cuando se quiera reiniciar. */
const DATA_VERSION = 2;
let _migrateReset = false;
const FB = (window.SABOR_CLOUD && window.SABOR_CLOUD.databaseURL) ? window.SABOR_CLOUD : null;
const CLIENT_ID = Math.random().toString(36).slice(2);
let fbdb=null, cloudOn=false, _applyingRemote=false, _saveTimer=null, _cloudFailed=false, _cloudConnected=false, _connDelay=null;
// Respaldo por HTTPS (REST): cuando el WebSocket en tiempo real está bloqueado (VPN, antivirus,
// proxys, redes restrictivas), la app sincroniza igual por HTTPS normal (que sí pasa).
let _restMode=false, _hbTimer=null, _restFails=0, _lastRemoteAt=0, _tok=null, _tokAt=0;

/* ---------------- Roles ---------------- */
const ROLES = {
  admin:       { label:'Administración / Gerencia', short:'Gerencia', color:'#8f2438' }, /* burgundy */
  chef:        { label:'Chef',            short:'Chef',         color:'#5b3a2e' }, /* café oscuro */
  jefe_salon:  { label:'Jefe de Salón',   short:'Jefe Salón',   color:'#8a5a3c' }, /* café medio */
  cocinero:    { label:'Cocina',          short:'Cocina',       color:'#a8475a' }, /* vino claro */
  salonero:    { label:'Salonero',        short:'Salonero',     color:'#4e5a63' }, /* gris azulado */
  proveeduria: { label:'Proveeduría',     short:'Proveeduría',  color:'#5c5650' }, /* gris cálido */
  contarh:     { label:'Contabilidad y Recursos', short:'Conta + RH', color:'#7a6a62' }, /* taupe */
  gerencia_exp:{ label:'Gerencia de Experiencia', short:'Ger. Experiencia', color:'#9a2f48' },
  gerencia_data:{ label:'Gerencia de Estadística y Diseño', short:'Ger. Estadística', color:'#6b4a3a' },
  bartender:   { label:'Bartender',       short:'Bartender',    color:'#514a44' },
};
const ROLE_KEYS = Object.keys(ROLES);
/* Orden por departamento para listar/personas: Gerencia y Administración · Salón · Cocina */
const DEPT_ORDER = [
  {label:'Gerencia y Administración', roles:['admin','gerencia_exp','gerencia_data','proveeduria','contarh']},
  {label:'Salón',          roles:['jefe_salon','salonero','bartender']},
  {label:'Cocina',         roles:['chef','cocinero']},
];
function deptRank(role){ for(let i=0;i<DEPT_ORDER.length;i++){ if(DEPT_ORDER[i].roles.includes(role)) return i; } return DEPT_ORDER.length; }
function deptLabel(role){ const i=deptRank(role); return (DEPT_ORDER[i]&&DEPT_ORDER[i].label)||'Otros'; }
function byDept(a,b){ return (deptRank(a.role)-deptRank(b.role)) || ((a.name||'').localeCompare(b.name||'')); }

/* Áreas de pedidos (a quién va dirigida una solicitud). Una misma persona
   (Melanie · contarh) atiende tanto Contabilidad como Recursos. */
const PED_AREAS = {
  proveeduria:  { label:'Proveeduría — insumos / productos', short:'Proveeduría', color:'#5c5650', roles:['proveeduria','contarh'] },
  contabilidad: { label:'Contabilidad — pagos / facturas',   short:'Contabilidad', color:'#7a6a62', roles:['contarh'] },
  rrhh:         { label:'Recursos — permisos / adelantos',   short:'Recursos',     color:'#3f3a3a', roles:['contarh'] },
};
function pedInfo(area){
  if(PED_AREAS[area]) return PED_AREAS[area];
  if(ROLES[area]) return {label:ROLES[area].label, short:ROLES[area].short, color:ROLES[area].color, roles:[area]};
  return {label:area, short:area, color:'#888', roles:[area]};
}
function pedAreaMine(area){ return (pedInfo(area).roles||[]).includes(me().role); }
const roleInfo = r => ROLES[r] || {label:r,short:r,color:'#777'};

/* ---------------- Helpers ---------------- */
const $ = s => document.querySelector(s);
function uid(){ try{ if(self.crypto && crypto.randomUUID) return crypto.randomUUID(); }catch(_){} return Date.now().toString(36)+Math.random().toString(36).slice(2,12); }
const now = () => Date.now();
// Carrera contra un tiempo límite: evita que el arranque se quede colgado sin internet
function withTimeout(p, ms){ let t; const to=new Promise((_,rej)=>{ t=setTimeout(()=>rej(new Error('timeout')), ms); }); return Promise.race([ Promise.resolve(p).finally(()=>clearTimeout(t)), to ]); }

/* ---- Captura global de errores: guarda los últimos para que Gerencia los pueda ver ---- */
const ERRLOG_KEY='saborTico_errlog';
function logError(kind, msg, extra){
  try{
    const arr=JSON.parse(localStorage.getItem(ERRLOG_KEY)||'[]');
    arr.unshift({ at:Date.now(), kind, msg:String(msg||'').slice(0,500), extra:String(extra||'').slice(0,300), view:(typeof SES!=='undefined'&&SES?SES.view:'') });
    localStorage.setItem(ERRLOG_KEY, JSON.stringify(arr.slice(0,40)));
  }catch(_){}
}
window.addEventListener('error', e=>{ logError('error', e&&e.message, e&&e.filename?(e.filename+':'+e.lineno):''); });
window.addEventListener('unhandledrejection', e=>{ const r=e&&e.reason; logError('promesa', r&&r.message?r.message:r, r&&r.stack?String(r.stack).split('\n').slice(0,3).join(' | '):''); });
// Escape para HTML. Incluye comilla simple y backtick: así también es seguro dentro de
// atributos con comilla simple y de los onclick="...('...')" que usa la app. (de() NO escapa: solo quita emojis)
const esc = s => (s==null?'':String(s)).replace(/[&<>"'`]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;','`':'&#96;'}[c]));
// Solo se permiten data: URIs reales de imagen/video (base64 limpio) dentro de src="".
// Bloquea inyección por atributo (p.ej. valores con comillas/onerror) en medios guardados en la DB.
const safeImg = s => (typeof s==='string' && /^data:image\/(png|jpe?g|gif|webp|bmp);base64,[A-Za-z0-9+/=\s]+$/i.test(s)) ? s : '';
const safeVid = s => (typeof s==='string' && /^data:video\/(mp4|webm|ogg|quicktime|x-matroska);base64,[A-Za-z0-9+/=\s]+$/i.test(s)) ? s : '';
const safeAud = s => (typeof s==='string' && /^data:audio\/[\w.+-]+(;[\w=-]+)*;base64,[A-Za-z0-9+/=\s]+$/i.test(s)) ? s : '';
// Recortar texto y acotar números: evita que un campo enorme infle el estado compartido (DoS) o se metan valores inválidos
const clip = (s,n=300) => String(s==null?'':s).trim().slice(0,n);
const numClamp = (v,min,max) => { let x=Number(v); if(!isFinite(x)) x=0; return Math.max(min, Math.min(max, x)); };
// Tope de tamaño para un archivo adjunto (en bytes)
function fileTooBig(f, mb){ if(f && f.size > mb*1024*1024){ toast('El archivo supera los '+mb+' MB','err'); return true; } return false; }
/* sin emojis: filtro global aplicado en vistas, modales, toasts y notificaciones */
const EMOJI_RE=/[⌀-➿☀-⛿⬀-⯿️‍]|[\u{1F000}-\u{1FAFF}]|[\u{1F1E6}-\u{1F1FF}]/gu;
const de = s => (s==null?'':String(s)).replace(EMOJI_RE,'');
const svgIcon=(k,cls='icon')=>`<svg class="${cls}" viewBox="0 0 24 24"><use href="#i-${k}"/></svg>`;

function fmtDate(ts){ if(!ts) return '—'; const d=new Date(ts); return d.toLocaleDateString('es-CR',{day:'2-digit',month:'short'}); }
function fmtDateTime(ts){ const d=new Date(ts); return d.toLocaleDateString('es-CR',{day:'2-digit',month:'short'})+' '+d.toLocaleTimeString('es-CR',{hour:'2-digit',minute:'2-digit'}); }
function timeAgo(ts){
  const s=Math.floor((now()-ts)/1000);
  if(s<60) return 'hace un momento';
  if(s<3600) return 'hace '+Math.floor(s/60)+' min';
  if(s<86400) return 'hace '+Math.floor(s/3600)+' h';
  return 'hace '+Math.floor(s/86400)+' d';
}
function initials(name){ return String(name||'?').trim().split(/\s+/).map(w=>w[0]||'').slice(0,2).join('').toUpperCase()||'?'; }
function avatarHTML(u, cls=''){
  if(!u) return `<div class="av ${cls}" style="background:#888">?</div>`;
  return `<div class="av ${cls}" style="background:${roleInfo(u.role).color}">${esc(initials(u.name))}</div>`;
}

/* ---------------- Estado ---------------- */
let DB = null;
let SES = { userId:null, view:'inicio', sucFilter:'all', activeChat:null };

function save(){
  if(!_applyingRemote){ try{ stampEdits(); }catch(_){} }   // sellar updatedAt en lo que cambió localmente
  try{ localStorage.setItem(DB_KEY, JSON.stringify(DB)); }catch(e){}
  if(cloudOn && !_applyingRemote){ clearTimeout(_saveTimer); _saveTimer=setTimeout(cloudPush, 400); }
}
function load(){
  const raw = localStorage.getItem(DB_KEY);
  if(raw){ try { DB = JSON.parse(raw); migrate(); rebuildEntSnap(); return; } catch(e){} }
  DB = seed();
  migrate();
  rebuildEntSnap();
  save();
}
/* ---- Sello automático de ediciones (para que CADA cambio sincronice) ----
   Cualquier objeto de RECON_COLLS que cambie localmente recibe updatedAt=now() al guardar.
   La reconciliación hace ganar "la edición más reciente", así un cambio (estado de tarea,
   stock, nombre, etc.) se propaga a todos y no lo revierte un equipo con datos viejos.
   No hay que marcar a mano cada función: se detecta solo comparando contra la última base. */
let _entSnap = Object.create(null);
// Sublistas que se reconcilian aparte por id (mensajes/comentarios): NO deben disparar el sello del padre,
// si no, un comentario nuevo "ganaría" y revertiría una edición real (estado, etc.). También evita
// reserializar historiales enormes en cada guardado.
const _SKIP_SER={updatedAt:1,comments:1,msgs:1,chat:1,log:1};
function _serEnt(e){ if(!e||typeof e!=='object') return ''; const c={}; Object.keys(e).filter(k=>!_SKIP_SER[k]).sort().forEach(k=>c[k]=e[k]); try{ return JSON.stringify(c); }catch(_){ return ''; } }
function stampEdits(){
  if(!DB) return;
  for(let i=0;i<RECON_COLLS.length;i++){ const arr=DB[RECON_COLLS[i]]; if(!Array.isArray(arr)) continue;
    for(let j=0;j<arr.length;j++){ const e=arr[j]; if(!e||!e.id) continue;
      const s=_serEnt(e), prev=_entSnap[e.id];
      if(prev===undefined){ _entSnap[e.id]=s; }                          // objeto nuevo (ya se propaga por id)
      else if(prev!==s){ e.updatedAt=now(); _entSnap[e.id]=_serEnt(e); }  // cambió localmente -> sellar
    }
  }
}
function rebuildEntSnap(){   // tras adoptar datos remotos / al cargar: esa es la nueva base
  _entSnap=Object.create(null);
  if(!DB) return;
  for(let i=0;i<RECON_COLLS.length;i++){ const arr=DB[RECON_COLLS[i]]; if(!Array.isArray(arr)) continue;
    for(let j=0;j<arr.length;j++){ const e=arr[j]; if(e&&e.id) _entSnap[e.id]=_serEnt(e); }
  }
}
/* ---------------- Sincronización en la nube (Firebase Realtime Database) ---------------- */
let _sizeWarned=false;
async function cloudPush(){
  if(!cloudOn || !fbdb) return;
  try{
    try{ stampEdits(); }catch(_){}   // por si se llamó cloudPush directo (no vía save)
    let at=Date.now(); if(at<=_lastRemoteAt) at=_lastRemoteAt+1;   // marca de tiempo siempre creciente
    _lastRemoteAt=at;
    const payload={ data:DB, client:CLIENT_ID, at };
    // Aviso suave: si el estado compartido crece demasiado (muchos adjuntos), conviene depurar
    if(!_sizeWarned){ try{ if(JSON.stringify(payload).length > 8*1024*1024){ _sizeWarned=true; if(typeof toast==='function') toast('Los datos están muy pesados (muchos adjuntos). Conviene depurar.','err'); } }catch(_){} }
    // ENTREGA CONFIABLE por HTTPS: llega a la nube aunque el WebSocket esté bloqueado o "zombie"
    // (conectado pero sin entregar). El PUT dispara igual los listeners en tiempo real de los demás.
    const ok = await restPush(payload);
    if(ok) return;
    // Sin HTTPS (realmente sin internet): usar el SDK, que encola y entrega al reconectar.
    try{ await fbdb.ref('state').set(payload); }catch(e){ console.warn('cloud push', e); }
  }
  catch(e){ console.warn('cloud push', e); }
}
/* ---- Sincronización por HTTPS (REST): funciona aunque el tiempo real esté bloqueado ---- */
function restBase(){ return String(FB.databaseURL||'').replace(/\/$/,'') + '/state.json'; }
function stateAtUrl(){ return String(FB.databaseURL||'').replace(/\/$/,'') + '/state/at.json'; }
async function cloudToken(){
  try{
    const u = firebase.auth && firebase.auth().currentUser; if(!u) return null;
    if(_tok && Date.now()-_tokAt < 50*60e3) return _tok;
    _tok = await u.getIdToken(); _tokAt=Date.now(); return _tok;
  }catch(_){ return null; }
}
// Adoptar un estado remoto (viene por WebSocket o por REST): mismo camino de reconciliación.
function applyRemoteState(v){
  if(!v || !v.data) return;
  if(v.at) _lastRemoteAt = Math.max(_lastRemoteAt, +v.at||0);
  if(v.client===CLIENT_ID) return;                       // eco de mi propio guardado
  if(!Array.isArray(v.data.users) || v.data.users.length===0){ console.warn('estado remoto inválido, ignorado'); return; }
  let needRepush=false; _applyingRemote=true;
  try{
    needRepush = reconcile(DB, v.data);
    DB=v.data; migrate(true); rebuildEntSnap();
    try{ localStorage.setItem(DB_KEY, JSON.stringify(DB)); }catch(e){}
    const modalOpen=$('#modalBg') && $('#modalBg').classList.contains('on');
    if(me()){ if(!modalOpen) render(); try{ checkNotifPops(); }catch(_){} } else { renderLogin(); }
  } finally { _applyingRemote=false; }
  if(needRepush) save();
}
async function restPull(){
  const t=await cloudToken(); if(!t){ _restFail(); return false; }
  try{
    const r=await fetch(restBase()+'?auth='+t, {cache:'no-store'});
    if(!r.ok){ _restFail(); return false; }
    const v=await r.json();
    if(v && v.data && (+v.at||0)!==_lastRemoteAt) applyRemoteState(v);
    _restOk(); return true;
  }catch(_){ _restFail(); return false; }
}
async function restPush(payload){
  const t=await cloudToken(); if(!t) return false;
  try{ const r=await fetch(restBase()+'?auth='+t, {method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload)}); return r.ok; }
  catch(_){ return false; }
}
/* RED DE SEGURIDAD PERMANENTE: cada pocos segundos lee SOLO la marca de tiempo 'at' (unos bytes);
   si cambió respecto a lo que ya aplicamos, baja el estado completo. Corre SIEMPRE (conectado o no),
   así los cambios (tareas, mensajes) llegan aunque el canal en tiempo real esté caído o zombie. */
async function syncCheck(){
  if(!cloudOn) return;
  const t=await cloudToken(); if(!t) return;
  try{
    const r=await fetch(stateAtUrl()+'?auth='+t, {cache:'no-store'});
    if(!r.ok){ if(_restMode) _restFail(); return; }
    const at=+(await r.json())||0;
    if(at>_lastRemoteAt){ await restPull(); }
    else if(_restMode){ _restOk(); }
  }catch(_){ if(_restMode) _restFail(); }
}
function startSyncHeartbeat(){
  if(_hbTimer) return;
  _hbTimer=setInterval(()=>{ if(!document.hidden) syncCheck(); }, 8000);   // 8s: cambios llegan pronto, costo mínimo
  document.addEventListener('visibilitychange', ()=>{ if(!document.hidden) syncCheck(); });
  window.addEventListener('online', ()=>{ try{ if(fbdb) fbdb.goOnline(); }catch(_){}; syncCheck(); });
}
function _cloudTag(txt, off){ const t=$('#cloudTag'); if(!t) return; t.textContent=txt; t.classList.toggle('off', !!off); }
function _restOk(){ _restFails=0; if(_restMode) _cloudTag('Sincronizado', false); }
function _restFail(){ _restFails++; if(_restMode && _restFails>=3) _cloudTag('Sin conexión', true); }
function startRest(){ if(_restMode) return; _restMode=true; _restFails=0; _cloudTag('Conectando…', true); syncCheck(); }
function stopRest(){ _restMode=false; _restFails=0; }
/* Reconciliar listas que SOLO CRECEN (mensajes de chat, chat de proyectos, comentarios):
   unir por id lo local + lo remoto, en vez de que un blob pise al otro. Así, si dos personas
   escriben casi al mismo tiempo, no se pierde ningún mensaje. Respeta el borrado (deleted) y
   "ocultar para mí" (hiddenFor). Devuelve true si lo local tenía algo que el remoto no tenía. */
// Un mensaje está borrado si su marca de borrado (delAt, o el boolean viejo) es más reciente que la de restauración
function msgDeleted(m){ if(!m) return false; const d=Math.max(m.delAt||0, m.deleted?1:0); return d>0 && !((m.revAt||0)>=d); }
function _unionMsgs(localArr, remoteArr, flags){
  localArr=Array.isArray(localArr)?localArr:[]; remoteArr=Array.isArray(remoteArr)?remoteArr:[];
  const byId={};
  remoteArr.forEach(m=>{ if(m&&m.id) byId[m.id]=m; });
  localArr.forEach(m=>{ if(!m||!m.id) return;
    const e=byId[m.id];
    if(e){
      if((m.delAt||0)>(e.delAt||0)){ e.delAt=m.delAt; if(flags) flags.added=true; }   // borrado (marca temporal, gana la más reciente)
      if((m.revAt||0)>(e.revAt||0)){ e.revAt=m.revAt; if(flags) flags.added=true; }   // restauración (Deshacer)
      if(m.deleted && !e.deleted){ e.deleted=true; if(flags) flags.added=true; }       // legado (boolean viejo)
      const before=(e.hiddenFor||[]).length;
      const hf=[...new Set([...(e.hiddenFor||[]),...(m.hiddenFor||[])])];
      if(hf.length){ e.hiddenFor=hf; if(hf.length>before && flags) flags.added=true; } // "ocultar para mí" local no propagado
    } else { byId[m.id]=m; if(flags) flags.added=true; }              // mensaje local que el remoto no tenía
  });
  return Object.keys(byId).map(k=>byId[k]).sort((a,b)=>((a.at||0)-(b.at||0)) || String(a.id).localeCompare(String(b.id)));
}
/* Unir las SESIONES de asistencia (entrada/salida) de un mismo día sin que un equipo pise al otro:
   se unen por id (clave de respaldo: la hora de entrada). Si la misma sesión está abierta en un equipo
   y cerrada en otro, gana la SALIDA más reciente. Así marcar entrada en un equipo y salida en otro
   conviven en vez de perderse. Acepta registros viejos {in,out} (se normalizan con attSessions). */
function _unionSessions(localArr, remoteArr, flags){
  const norm=arr=>(Array.isArray(arr)?arr:[]).filter(s=>s&&s.in).map(s=>({id:s.id||('s'+s.in), in:s.in, out:s.out||null, del:s.del||0}));
  const L=norm(localArr), R=norm(remoteArr); const byId={};
  R.forEach(s=>{ byId[s.id]=s; });
  L.forEach(s=>{ const e=byId[s.id];
    if(e){ if((s.out||0)>(e.out||0)){ e.out=s.out; if(flags) flags.added=true; }      // cerrar una sesión que el otro tenía abierta
           if((s.del||0)>(e.del||0)){ e.del=s.del; if(flags) flags.added=true; } }    // borrado de una marca (gana el más reciente)
    else { byId[s.id]=s; if(flags) flags.added=true; }                                 // sesión que el remoto no tenía
  });
  return Object.keys(byId).map(k=>byId[k]).sort((a,b)=>(a.in||0)-(b.in||0));
}
function mergeAppendOnly(localDB, remoteDB){
  if(!localDB||!remoteDB) return false;
  const flags={added:false};
  (remoteDB.chats||[]).forEach(rc=>{ const lc=(localDB.chats||[]).find(x=>x&&x.id===rc.id); if(lc) rc.msgs=_unionMsgs(lc.msgs, rc.msgs, flags); });
  (remoteDB.projects||[]).forEach(rp=>{ const lp=(localDB.projects||[]).find(x=>x&&x.id===rp.id); if(lp) rp.chat=_unionMsgs(lp.chat, rp.chat, flags); });
  (remoteDB.tasks||[]).forEach(rt=>{ const lt=(localDB.tasks||[]).find(x=>x&&x.id===rt.id); if(lt) rt.comments=_unionMsgs(lt.comments, rt.comments, flags); });
  (remoteDB.pedidos||[]).forEach(rp=>{ const lp=(localDB.pedidos||[]).find(x=>x&&x.id===rp.id); if(lp) rp.comments=_unionMsgs(lp.comments, rp.comments, flags); });
  (remoteDB.attendance||[]).forEach(ra=>{ const la=(localDB.attendance||[]).find(x=>x&&x.id===ra.id); if(la){ const u=_unionSessions(attSessions(la), attSessions(ra), flags); if(u.length){ ra.sessions=u; attSyncLegacy(ra); } } });
  return flags.added;
}
/* Reconciliación a nivel de OBJETO: une por id los objetos nuevos local+remoto (sin perder los que
   el otro aún no tenía), respetando los borrados con "tombstones". Para un objeto que existe en ambos
   lados, gana la EDICIÓN MÁS RECIENTE (por updatedAt), no "el último que sube"; así un cambio (p.ej.
   renombrar una sucursal) se propaga a todos y no lo revierte un dispositivo con datos viejos. */
const RECON_COLLS=['tasks','pedidos','chats','projects','reservations','clients','shifts','recipes','souvenirs','souvSales','users','attendance','inventory','sucursales','calEvents','bodegas','cajas','camaras'];
const _stamp=o=>(o&&(o.updatedAt||o.at||o.createdAt))||0;   // marca de tiempo para "edición más reciente gana"
// REGLA: cualquier BORRADO DURO de una colección de RECON_COLLS DEBE marcar tomb(id) antes de filtrar,
// o el borrado "revivirá" desde otro dispositivo. Usá delEntity(coll,id) para no olvidarlo nunca.
// Borrado = marca en _tomb; "Deshacer" = marca en _revive. Gana la marca MÁS RECIENTE (delete vs revive).
function tomb(id){ if(!id) return; DB._tomb=DB._tomb||{}; DB._tomb[id]=now(); }
function reviveId(id){ if(!id) return; DB._revive=DB._revive||{}; DB._revive[id]=now(); }
function _isDel(tombs, revs, id){ const t=tombs&&tombs[id]; if(!t) return false; const r=(revs&&revs[id])||0; return !(r>=t); }
function isDel(id){ return _isDel(DB._tomb, DB._revive, id); }
function delEntity(coll,id){ tomb(id); if(Array.isArray(DB[coll])) DB[coll]=DB[coll].filter(x=>!x||x.id!==id); }
function _mergeMax(remoteMap, localMap, flags){ const out=Object.assign({}, remoteMap||{}); const lm=localMap||{}; for(const k in lm){ if(!(k in out) || lm[k]>out[k]){ out[k]=lm[k]; if(flags) flags.a=true; } } return out; }
function reconcileEntities(localDB, remoteDB){
  const flags={a:false};
  const tombs=_mergeMax(remoteDB._tomb, localDB._tomb, flags);
  const revs=_mergeMax(remoteDB._revive, localDB._revive, flags);
  remoteDB._tomb=tombs; remoteDB._revive=revs;
  let added=flags.a;
  RECON_COLLS.forEach(coll=>{
    const rArr=Array.isArray(remoteDB[coll])?remoteDB[coll]:[];
    const lArr=Array.isArray(localDB[coll])?localDB[coll]:[];
    let out=rArr.filter(o=>!(o&&o.id&&_isDel(tombs,revs,o.id)));   // quitar borrados (salvo revividos)
    if(out.length!==rArr.length) added=true;
    lArr.forEach(o=>{
      if(!o||!o.id || _isDel(tombs,revs,o.id)) return;
      const idx=out.findIndex(x=>x&&x.id===o.id);
      if(idx<0){ out.push({...o}); added=true; }                              // objeto local nuevo: conservar
      else if(_stamp(o) > _stamp(out[idx])){                                  // edición local más reciente: gana
        const rem=out[idx], merged={...o};
        // preservar las sublistas remotas (mensajes/comentarios/sesiones) para que la unión posterior no las pierda
        if(Array.isArray(rem.comments)) merged.comments=rem.comments;
        if(Array.isArray(rem.msgs)) merged.msgs=rem.msgs;
        if(Array.isArray(rem.chat)) merged.chat=rem.chat;
        if(coll==='attendance'){ const u=_unionSessions(attSessions(merged), attSessions(rem)); if(u.length) merged.sessions=u; }   // unir marcas local+remoto (mergeAppendOnly lo reafirma; unión idempotente)
        out[idx]=merged; added=true;
      }
    });
    remoteDB[coll]=out;
  });
  return added;
}
function reconcile(localDB, remoteDB){
  if(!localDB||!remoteDB) return false;
  const a=reconcileEntities(localDB, remoteDB);
  const b=mergeAppendOnly(localDB, remoteDB);   // une mensajes/comentarios dentro de los objetos compartidos
  return a || b;
}
async function cloudInit(){
  if(!FB || !FB.databaseURL) return false;
  if(!window.firebase){ console.warn('SDK de Firebase no cargó'); return false; }
  try{ firebase.initializeApp(FB); }catch(e){ /* ya inicializado */ }
  // Iniciar sesión anónima ANTES de tocar la base: así las reglas seguras (auth != null)
  // dejan leer/escribir sin cambiar el login con PIN. Si la autenticación anónima aún no está
  // activada en Firebase, no bloqueamos: seguimos (compatibilidad mientras se publica el cambio).
  try{ if(firebase.auth){ await withTimeout(firebase.auth().signInAnonymously(), 6000); } }
  catch(e){ console.warn('auth anónima no disponible todavía', e && (e.code||e.message)); }
  fbdb = firebase.database();
  let val=null, getFailed=false;
  try{ const snap=await withTimeout(fbdb.ref('state').get(), 6000); val = snap && snap.exists() ? snap.val() : null; }
  catch(e){
    getFailed=true;
    console.warn('cloud load', e);
    // Permiso denegado = reglas cerradas pero falta activar el inicio anónimo en Firebase.
    if(e && (e.code==='PERMISSION_DENIED' || /permission/i.test(String(e.message||e)))){
      setTimeout(()=>{ try{ toast('Sin conexión a la nube: activá el inicio anónimo en Firebase (ver docs/SEGURIDAD.md).','err'); }catch(_){} }, 1500);
    }
  }
  // El WebSocket puede estar bloqueado (VPN/antivirus/proxy) pero HTTPS pasa: cargar por REST.
  // La auth anónima usa HTTPS, así que hay token aunque el tiempo real esté caído.
  if(getFailed){
    try{
      const t=await cloudToken();
      if(t){ const r=await withTimeout(fetch(restBase()+'?auth='+t,{cache:'no-store'}), 8000);
        if(r && r.ok){ const rv=await r.json(); if(rv && rv.data && Array.isArray(rv.data.users) && rv.data.users.length){ val=rv; getFailed=false; if(rv.at)_lastRemoteAt=+rv.at||0; } } }
    }catch(_){}
  }
  let _bootMerged=false;
  if(val && val.data){
    // unir mensajes locales (de una sesión offline) con el estado del servidor para no perderlos
    try{ const raw=localStorage.getItem(DB_KEY); if(raw){ const localDB=JSON.parse(raw); if(localDB && Array.isArray(localDB.users)) _bootMerged=reconcile(localDB, val.data); } }catch(_){}
    DB=val.data;
  }
  else {
    const raw=localStorage.getItem(DB_KEY);
    // Si NO se pudo leer la nube (sin conexión/auth/reglas) NO sembramos datos de ejemplo:
    // usamos lo local si hay, o una base VACÍA, y esperamos a conectar (evita duplicados/contaminación).
    if(raw){ try{ DB=JSON.parse(raw); }catch(_){ DB = getFailed?emptyDB():seed(); } }
    else { DB = getFailed ? emptyDB() : seed(); }
    if(getFailed) _cloudFailed=true;
  }
  migrate();
  rebuildEntSnap();   // base para detectar ediciones locales futuras
  try{ localStorage.setItem(DB_KEY, JSON.stringify(DB)); }catch(e){}
  cloudOn=true;
  // Subir solo si el servidor está REALMENTE vacío (lectura OK sin datos) o tras migración/merge.
  // NUNCA si la lectura falló/expiró (sin señal): así no se cuelga el arranque (set() offline nunca
  // resuelve) ni se pisan datos buenos del servidor que no pudimos leer. Fire-and-forget (sin await).
  if(!getFailed && (!(val && val.data) || _migrateReset || _bootMerged)){ cloudPush(); _migrateReset=false; }
  try{
    fbdb.ref('state').on('value', (snap)=>{ applyRemoteState(snap.val()); });
    // Indicador de conexión real: "Sincronizado" / "Conectando…" / "Sin conexión".
    // Si el WebSocket no conecta en 8s, arranca el respaldo por HTTPS (REST): la app
    // sigue sincronizando aunque el tiempo real esté bloqueado por VPN/antivirus/proxy.
    fbdb.ref('.info/connected').on('value', s=>{
      const on=!!(s&&s.val()); _cloudConnected=on;
      if(_connDelay){ clearTimeout(_connDelay); _connDelay=null; }
      if(on){ stopRest(); _cloudTag('Sincronizado', false); }
      else {
        _cloudTag('Conectando…', true);
        _connDelay=setTimeout(()=>{ if(!_cloudConnected) startRest(); }, 8000);
      }
    });
  }catch(e){ console.warn('cloud realtime', e); }
  startSyncHeartbeat();   // red de seguridad permanente por HTTPS (aunque el tiempo real esté OK)
  return true;
}
// Forzar reconexión a la nube (tocar la etiqueta de estado). Útil si el canal en vivo se quedó caído.
function cloudReconnect(){
  if(!fbdb){ toast('La nube no está inicializada','err'); return; }
  _cloudTag('Conectando…', true);
  try{ fbdb.goOffline(); }catch(_){}
  setTimeout(()=>{ try{ fbdb.goOnline(); }catch(_){} }, 600);
  // respaldo inmediato por HTTPS: aunque el WebSocket no vuelva, jala y empuja por REST
  restPull(); cloudPush();
  setTimeout(()=>{ if(!_cloudConnected) startRest(); }, 2500);
  toast('Reconectando a la nube…','ok');
}
window.cloudReconnect=cloudReconnect;

function seed(){
  const s1=uid(), s2=uid();
  // PIN temporal 1234 solo para el primer arranque: cada quien define el suyo al entrar (mustChangePin)
  const U = (name,role,suc,phone='',pin='1234')=>({id:uid(),name,role,pin,sucursalId:suc,phone,active:true,mustChangePin:true});
  const users = [
    U('Kenneth Villalobos','admin','all','8302-1145'),
    U('Marco Jiménez','chef',s1,'8711-2390'),
    U('Josué Soto','jefe_salon',s1,'8645-7782'),
    U('Lucía Ramírez','cocinero',s1,'7088-3321'),
    U('Jafet Mora','salonero',s1,'8902-5567'),
    U('Bryan Castro','salonero',s2,'8456-1209'),
    U('Diego Vargas','proveeduria','all','8533-9914'),
    U('Melanie','contarh','all',''),
    U('Carla Méndez','jefe_salon',s2,'8190-7763'),
    U('Andrés Quirós','bartender',s1,'8654-2210'),
    U('Valeria Campos','gerencia_exp','all','8443-9921'),
    U('Esteban Ruiz','gerencia_data','all','8112-3390'),
  ];
  const byRole = r => users.find(u=>u.role===r);
  const chef=byRole('chef'), coc=byRole('cocinero'), prov=byRole('proveeduria'), js=byRole('jefe_salon'), admin=byRole('admin');

  // Inicio en limpio para uso real: sin datos de ejemplo, solo el equipo, las sucursales
  // y dos grupos de chat listos (sin mensajes) para que el equipo se comunique de una.
  const db = {
    _dataVersion: DATA_VERSION,
    sucursales:[{id:s1,name:'Sabor Tico — Central'},{id:s2,name:'Sabor Tico — Norte'}],
    users,
    inventory:[],
    invCats:JSON.parse(JSON.stringify(DEFAULT_CATS)),
    invMoves:[],
    recipes:[],
    shifts:[],
    tasks:[],
    pedidos:[],
    projects:[],
    chats:[
      { id:uid(), type:'group', name:'Equipo Central', memberIds:users.filter(u=>u.sucursalId===s1||u.sucursalId==='all').map(u=>u.id), sucursalId:s1, createdById:admin.id, createdAt:now(), msgs:[] },
      { id:uid(), type:'group', name:'Equipo Norte', memberIds:users.filter(u=>u.sucursalId===s2||u.sucursalId==='all').map(u=>u.id), sucursalId:s2, createdById:admin.id, createdAt:now(), msgs:[] },
    ],
    notifs:[],
    audit:[],
    clients:[],
    reservations:[],
    souvenirs:[],
    souvSales:[],
  };
  return db;

  function task(title,desc,fromId,toIds,suc,prio,due,status){
    const t={id:uid(),title,desc,fromId,toIds,sucursalId:suc,prio,due,status,images:[],createdAt:now()-3600e3*6,comments:[],
      log:[{at:now()-3600e3*6,byId:fromId,text:'creó la tarea'}]};
    return t;
  }
  function pedido(item,desc,qty,fromId,area,suc,urgencia,status){
    return {id:uid(),item,desc,qty,fromId,area,assignedId:null,sucursalId:suc,urgencia,status,createdAt:now()-3600e3*5,comments:[],
      log:[{at:now()-3600e3*5,byId:fromId,text:'creó la solicitud'}]};
  }
  function card(text,byId){ return {id:uid(),type:'text',text,img:null,byId,at:now()-3600e3*10}; }
  function msg(byId,text){ return {id:uid(),byId,text,at:now()-3600e3*3}; }
}

// Base VACÍA (sin equipo ni datos de ejemplo): se usa cuando hay nube configurada pero NO se pudo
// leer (sin conexión / auth / reglas). Evita inventar datos de ejemplo que contaminen la base real.
function emptyDB(){ return { _dataVersion:DATA_VERSION, sucursales:[], users:[], inventory:[],
  invCats:JSON.parse(JSON.stringify(DEFAULT_CATS)), invMoves:[], recipes:[], shifts:[], tasks:[], pedidos:[],
  projects:[], chats:[], notifs:[], audit:[], clients:[], reservations:[], souvenirs:[], souvSales:[], attendance:[], calEvents:[], bodegas:[] }; }

/* ---------------- Generadores de datos (inventario / recetas / turnos) ---------------- */
const money = n => '₡'+Math.round(n||0).toLocaleString('es-CR');
const INV_CATS = ['Verduras','Carnes','Abarrotes','Bebidas','Desechables','Limpieza'];
const INV_UNITS = ['kg','lt','unid','paq','caja','docena','botella'];
const INV_AREA_LABEL = {cocina:'Cocina',bar:'Bar'};
const DEFAULT_CATS = {
  cocina:['Verduras','Carnes','Abarrotes','Bebidas','Desechables','Limpieza'],
  bar:['Licores','Cervezas','Gaseosas','Jugos','Garnish','Hielo','Desechables'],
};
function catsForArea(a){ return (DB.invCats && DB.invCats[a]) ? DB.invCats[a] : (DEFAULT_CATS[a]||[]); }
function catsVisible(){
  if(invArea!=='todas') return catsForArea(invArea);
  const set=new Set(); invAreasFor().forEach(a=>catsForArea(a).forEach(c=>set.add(c))); return [...set];
}

function seedInventory(s1,s2){
  const P=(name,cat,unit,stock,min,cost,sup,suc,area)=>({id:uid(),name,category:cat,unit,stock,minStock:min,cost,supplier:sup,sucursalId:suc,area:area||'cocina'});
  return [
    /* ---- Cocina (Central) ---- */
    P('Tomate','Verduras','kg',8,10,650,'Verdulería La Cosecha',s1,'cocina'),
    P('Cebolla','Verduras','kg',15,8,520,'Verdulería La Cosecha',s1,'cocina'),
    P('Lechuga','Verduras','unid',12,10,400,'Verdulería La Cosecha',s1,'cocina'),
    P('Pollo (pechuga)','Carnes','kg',20,12,3200,'Carnes del Valle',s1,'cocina'),
    P('Carne molida','Carnes','kg',9,10,3900,'Carnes del Valle',s1,'cocina'),
    P('Arroz','Abarrotes','kg',40,15,780,'Distribuidora Central',s1,'cocina'),
    P('Frijoles','Abarrotes','kg',25,12,950,'Distribuidora Central',s1,'cocina'),
    P('Aceite','Abarrotes','lt',18,8,1750,'Distribuidora Central',s1,'cocina'),
    P('Sal','Abarrotes','kg',10,4,350,'Distribuidora Central',s1,'cocina'),
    P('Café','Abarrotes','kg',7,5,4200,'Café Tarrazú',s1,'cocina'),
    P('Servilletas','Desechables','paq',6,10,1200,'Suplidora Limpia',s1,'cocina'),
    P('Jabón lavaplatos','Limpieza','lt',5,6,2100,'Suplidora Limpia',s1,'cocina'),
    /* ---- Bar (Central) ---- */
    P('Ron','Licores','botella',12,6,8500,'Licorera Nacional',s1,'bar'),
    P('Cerveza','Cervezas','unid',80,48,750,'Distribuidora Central',s1,'bar'),
    P('Coca-Cola 355ml','Gaseosas','unid',60,48,450,'Distribuidora Central',s1,'bar'),
    P('Limón','Garnish','kg',6,8,700,'Verdulería La Cosecha',s1,'bar'),
    P('Hielo','Hielo','paq',10,12,600,'Hielos del Valle',s1,'bar'),
    P('Vasos 12oz','Desechables','paq',14,8,1900,'Suplidora Limpia',s1,'bar'),
    /* ---- Norte ---- */
    P('Tomate','Verduras','kg',11,10,650,'Verdulería La Cosecha',s2,'cocina'),
    P('Pollo (pechuga)','Carnes','kg',16,12,3200,'Carnes del Valle',s2,'cocina'),
    P('Cerveza','Cervezas','unid',40,48,750,'Distribuidora Central',s2,'bar'),
  ];
}
function seedRecipes(inv,chefId){
  const find=n=>inv.find(p=>p.name===n);
  const R=(name,cat,price,ings)=>({id:uid(),name,category:cat,price,sucursalId:inv[0].sucursalId,
    ingredients:ings.map(([n,q])=>({productId:(find(n)||{}).id,qty:q})).filter(i=>i.productId),byId:chefId,at:now()});
  return [
    R('Casado con pollo','Platos fuertes',3500,[['Arroz',0.2],['Frijoles',0.15],['Pollo (pechuga)',0.25],['Tomate',0.05],['Lechuga',0.1]]),
    R('Gallo pinto','Desayunos',2200,[['Arroz',0.15],['Frijoles',0.15],['Cebolla',0.03],['Aceite',0.02]]),
    R('Hamburguesa','Platos fuertes',3800,[['Carne molida',0.18],['Tomate',0.04],['Lechuga',0.08]]),
  ];
}
function seedShifts(s1,s2,users){
  const byRole=r=>users.find(u=>u.role===r);
  const today=new Date(); const iso=d=>{const x=new Date(today);x.setDate(today.getDate()+d);return x.toISOString().slice(0,10);};
  const adm=byRole('admin').id;
  const S=(uId,suc,date,start,end,note,breaks)=>({id:uid(),userId:uId,sucursalId:suc,date,start,end,note:note||'',breaks:breaks||[],byId:adm,at:now()});
  return [
    S(byRole('salonero').id,s1,iso(0),'10:00','18:00','Almuerzo',[{start:'14:00',end:'15:00'}]),
    S(byRole('cocinero').id,s1,iso(0),'08:00','16:00','',[]),
    S(byRole('chef').id,s1,iso(0),'09:00','17:00','',[]),
    S(byRole('jefe_salon').id,s1,iso(1),'11:00','20:00','Cena',[]),
    S(byRole('salonero').id,s1,iso(1),'12:00','21:00','',[]),
  ];
}
function seedClients(){
  const C=(name,type,phone,visits,score)=>({id:uid(),name,type,phone,visits,score,notes:'',at:now()});
  return [
    C('María Fernández','cliente','8888-1212',4,5),
    C('Carlos Jiménez','cliente','8777-3434',1,4),
    C('Agencia Tours CR','agencia','2222-5050',7,5),
    C('Familia Soto','cliente','8654-9090',0,0),
  ];
}
function seedReservations(cli, suc, adminId){
  const t=new Date(); const iso=d=>{const x=new Date(t);x.setDate(t.getDate()+d);return x.toISOString().slice(0,10);};
  const reg=new Date(t.getTime()-3600e3*20);
  const R=(c,date,time,people,occ,status)=>({id:uid(),clientId:c.id,clientName:c.name,type:c.type,phone:c.phone,people,occasion:occ,
    resDate:date,resTime:time,regDate:reg.toISOString().slice(0,10),regTime:reg.toTimeString().slice(0,5),
    status,counted:status==='llego',byId:adminId,sucursalId:suc,at:now()});
  return [
    R(cli[0],iso(0),'13:00',4,'Cumpleaños','confirmada'),
    R(cli[2],iso(0),'20:00',12,'Tour grupal','pendiente'),
    R(cli[1],iso(1),'19:30',2,'Aniversario','pendiente'),
  ];
}
function seedSouvenirs(suc){
  const S=(name,stock,minStock,cost,price)=>({id:uid(),name,stock,minStock,cost,price,sucursalId:suc,at:now()});
  return [
    S('Taza Sabor Tico',24,6,1800,4500),
    S('Camiseta logo',15,5,4200,9500),
    S('Salsa picante de la casa',40,10,1200,3000),
    S('Llavero artesanal',60,15,500,1500),
    S('Café en grano 250g',18,6,2800,6000),
  ];
}

/* Garantiza que todas las colecciones existan como arreglos (defensa universal:
   se llama en cada render por si entran datos incompletos desde la nube). */
const DB_COLLECTIONS=['tasks','pedidos','projects','chats','notifs','audit','users','sucursales','inventory','invMoves','invoices','recipes','shifts','reservations','clients','souvenirs','souvSales','bodegas','taskLabels','cajas','camaras'];
function defaultTaskLabels(){ return [
  {id:uid(),name:'Urgente',color:'#e0533d'},
  {id:uid(),name:'Compras',color:'#5b8def'},
  {id:uid(),name:'Limpieza',color:'#0ea5b7'},
  {id:uid(),name:'Mantenimiento',color:'#e0a13d'},
]; }
function ensureCollections(){ if(!DB||typeof DB!=='object') return; DB_COLLECTIONS.forEach(k=>{ if(!Array.isArray(DB[k])) DB[k]=[]; }); if(!DB.invCats||typeof DB.invCats!=='object') DB.invCats=JSON.parse(JSON.stringify(DEFAULT_CATS)); }

/* ---------------- Migración de DBs existentes ---------------- */
function migrate(remote){
  let ch=false;
  // Limpieza única para empezar a usarlo en real. Importante: CONSERVA el equipo,
  // las sucursales y los chats reales que ya existan; solo borra los datos
  // operativos de ejemplo. Si no hay equipo aún (instalación nueva), siembra limpio.
  // NUNCA correr esta rama destructiva sobre datos ENTRANTES de la nube (remote=true):
  // un dispositivo viejo con _dataVersion<actual podría vaciar el estado de todos.
  if(!remote && (DB._dataVersion||0) < DATA_VERSION){
    if(!Array.isArray(DB.users) || DB.users.length===0){
      DB = seed(); // instalación nueva: datos limpios de fábrica
    } else {
      // se conserva: users, sucursales, chats (grupos y mensajes), invCats
      DB.tasks=[]; DB.pedidos=[]; DB.projects=[]; DB.reservations=[]; DB.clients=[];
      DB.souvenirs=[]; DB.souvSales=[]; DB.inventory=[]; DB.recipes=[]; DB.shifts=[];
      DB.invMoves=[]; DB.notifs=[]; DB.audit=[];
      // unir puestos viejos de Contabilidad y Recursos en el rol combinado
      (DB.users||[]).forEach(u=>{ if(u.role==='contabilidad'||u.role==='rrhh') u.role='contarh'; });
      DB._dataVersion = DATA_VERSION;
    }
    _migrateReset = true;
    // seguir con el resto del migrate para rellenar lo que falte
  }
  // unir puestos viejos de Contabilidad y Recursos en el rol combinado
  (DB.users||[]).forEach(u=>{ if(u.role==='contabilidad'||u.role==='rrhh'){ u.role='contarh'; ch=true; } });
  // asegurar que las colecciones base existan (datos sincronizados pueden venir incompletos)
  ['tasks','pedidos','projects','chats','notifs','audit','users','sucursales','inventory','invMoves','recipes','shifts','reservations','clients','souvenirs','souvSales','attendance','calEvents','bodegas'].forEach(k=>{ if(!Array.isArray(DB[k])){ DB[k]=[]; ch=true; } });
  const s=DB.sucursales||[]; const s1=s[0]?s[0].id:'all'; const s2=s[1]?s[1].id:s1;
  if(DB.inventory===undefined){ DB.inventory=seedInventory(s1,s2); ch=true; }
  if(DB.invMoves===undefined){ DB.invMoves=[]; ch=true; }
  if(DB.recipes===undefined){ const chef=DB.users.find(u=>u.role==='chef'); DB.recipes=seedRecipes(DB.inventory,chef?chef.id:DB.users[0].id); ch=true; }
  if(DB.shifts===undefined){ DB.shifts=seedShifts(s1,s2,DB.users); ch=true; }
  if(DB.taskLabels===undefined){ DB.taskLabels=defaultTaskLabels(); ch=true; }
  // Cámaras: purgar entradas corruptas (URL sin dominio real — p.ej. importes viejos con
  // "https:///stream.html..." — o nombres con doble codificación tipo "CÃ¡mara")
  if(Array.isArray(DB.camaras)){
    const okCam = c => c && typeof c.url==='string' && /^https:\/\/[^\/\s?#]+\.[^\/\s?#]+/i.test(c.url);
    const antes=DB.camaras.length;
    DB.camaras=DB.camaras.filter(okCam);
    DB.camaras.forEach(c=>{ if(typeof c.name==='string' && /Ã[¡©­³º]/.test(c.name)){ try{ c.name=decodeURIComponent(escape(c.name)); ch=true; }catch(_){} } });
    if(DB.camaras.length!==antes) ch=true;
  }
  (DB.users||[]).forEach(u=>{ if(u.phone===undefined){ u.phone=''; ch=true; } });
  (DB.pedidos||[]).forEach(p=>{ if(p.productId===undefined){ p.productId=null; ch=true; } });
  (DB.shifts||[]).forEach(sh=>{ if(sh.breaks===undefined){ sh.breaks=[]; ch=true; } });
  (DB.inventory||[]).forEach(p=>{ if(p.area===undefined){ p.area='cocina'; ch=true; } });
  if(DB.invCats===undefined){ DB.invCats=JSON.parse(JSON.stringify(DEFAULT_CATS)); ch=true; }
  if(!DB.invCats.cocina) { DB.invCats.cocina=DEFAULT_CATS.cocina.slice(); ch=true; }
  if(!DB.invCats.bar) { DB.invCats.bar=DEFAULT_CATS.bar.slice(); ch=true; }
  (DB.projects||[]).forEach(p=>{ if(p.chat===undefined){ p.chat=[]; ch=true; } (p.cards||[]).forEach((c,i)=>{ if(c.x===undefined){ c.x=40+(i%5)*250; c.y=40+Math.floor(i/5)*215; ch=true; } }); });
  if(DB._shiftNotif===undefined){ DB._shiftNotif={}; ch=true; }
  // reparar registros sincronizados que vengan sin campos esperados
  (DB.chats||[]).forEach(c=>{ if(!Array.isArray(c.msgs)){ c.msgs=[]; ch=true; } if(!Array.isArray(c.memberIds)){ c.memberIds=[]; ch=true; } });
  (DB.tasks||[]).forEach(t=>{ if(!Array.isArray(t.toIds)){ t.toIds=[]; ch=true; } if(!Array.isArray(t.log)) t.log=[]; if(!Array.isArray(t.comments)) t.comments=[]; if(!Array.isArray(t.labels)) t.labels=[]; if(!Array.isArray(t.subtasks)) t.subtasks=[]; });
  (DB.projects||[]).forEach(p=>{ if(!Array.isArray(p.cards)){ p.cards=[]; ch=true; } if(!Array.isArray(p.memberIds)){ p.memberIds=[]; ch=true; } });
  (DB.pedidos||[]).forEach(p=>{ if(!Array.isArray(p.log)) p.log=[]; if(!Array.isArray(p.comments)) p.comments=[]; });
  // Limitar historiales operativos (orden: más nuevo primero) para que el estado compartido no crezca sin fin.
  // No toca chat ni comentarios (esos se reconcilian por id).
  if((DB.audit||[]).length>2000){ DB.audit=DB.audit.slice(0,2000); ch=true; }
  if((DB.notifs||[]).length>400){ DB.notifs=DB.notifs.slice(0,400); ch=true; }
  if((DB.invMoves||[]).length>3000){ DB.invMoves=DB.invMoves.slice(0,3000); ch=true; }
  // Podar marcas de borrado/restauración viejas (>60 días): para entonces ya se sincronizaron en todos lados
  { const cut=now()-60*86400000;
    if(DB._tomb){ for(const k in DB._tomb){ if(DB._tomb[k]<cut){ delete DB._tomb[k]; ch=true; } } }
    if(DB._revive){ for(const k in DB._revive){ if(DB._revive[k]<cut){ delete DB._revive[k]; ch=true; } } } }
  if(ch) save();
}

/* ---------------- Sesión / usuario ---------------- */
const me = () => (DB.users||[]).find(u=>u.id===SES.userId);
const userById = id => (DB.users||[]).find(u=>u.id===id);
const isAdmin = () => me() && me().role==='admin';
const hasRole = (...rs) => me() && rs.includes(me().role);

/* ---------------- PIN seguro (hash con sal, nunca texto plano) ----------------
   El PIN ya no se guarda en texto: se guarda pinSalt + pinHash (SHA-256). Así, aunque
   alguien vea los datos, no obtiene el PIN. Compatible hacia atrás: si un usuario todavía
   tiene "pin" viejo en texto, el login funciona y lo actualiza a hash al entrar. */
function genSalt(){
  try{ const a=new Uint8Array(16); crypto.getRandomValues(a); return Array.from(a,b=>b.toString(16).padStart(2,'0')).join(''); }
  catch(_){ return Math.random().toString(36).slice(2)+Math.random().toString(36).slice(2); }
}
async function hashPin(pin, salt){
  try{
    if(self.crypto && crypto.subtle){
      const data=new TextEncoder().encode('saborTico|'+salt+'|'+String(pin));
      const buf=await crypto.subtle.digest('SHA-256', data);
      return Array.from(new Uint8Array(buf),b=>b.toString(16).padStart(2,'0')).join('');
    }
  }catch(_){}
  return null; // sin Web Crypto (contexto no seguro): se usa respaldo en texto
}
async function setUserPin(u, pin){
  const salt=genSalt(); const h=await hashPin(pin,salt);
  if(h){ u.pinSalt=salt; u.pinHash=h; delete u.pin; }
  else { u.pin=String(pin); delete u.pinHash; delete u.pinSalt; }
}
async function verifyPin(u, pin){
  if(!u) return false;
  if(u.pinHash && u.pinSalt){
    const h=await hashPin(pin,u.pinSalt);
    if(h===null){ toast('Este dispositivo no puede verificar el PIN de forma segura. Abrí la app por HTTPS.','err'); return false; }
    return h===u.pinHash;
  }
  return String(pin)===String(u.pin||''); // PIN viejo en texto (compatibilidad)
}
async function migratePins(){
  if(!Array.isArray(DB.users) || !(self.crypto && crypto.subtle)) return;
  let changed=false;
  for(const u of DB.users){ if(u && u.pin && !u.pinHash){ await setUserPin(u, u.pin); changed=true; } }
  if(changed){ try{ localStorage.setItem(DB_KEY, JSON.stringify(DB)); }catch(_){} if(cloudOn && !_applyingRemote) cloudPush(); }
}
/* Bloqueo tras varios intentos fallidos (por dispositivo) */
const LFK='saborTico_loginfail';
function loginFailState(){ try{ return JSON.parse(localStorage.getItem(LFK)||'{}'); }catch(_){ return {}; } }
function loginLockedUntil(){ return loginFailState().until||0; }
function registerLoginFail(){ const s=loginFailState(); s.n=(s.n||0)+1; if(s.n>=5){ s.until=now()+15*60*1000; s.n=0; } try{ localStorage.setItem(LFK,JSON.stringify(s)); }catch(_){} }
function clearLoginFails(){ try{ localStorage.removeItem(LFK); }catch(_){} }
// Inventario por área: Cocina (Proveeduría/Chef) y Bar (Bartender/Jefe de Salón)
function invAreasFor(){
  if(hasRole('admin','contarh','gerencia_data')) return ['cocina','bar'];
  if(hasRole('proveeduria','chef','cocinero')) return ['cocina'];
  if(hasRole('bartender','jefe_salon')) return ['bar'];
  return [];
}
function canInvEditArea(area){
  if(isAdmin()) return true;
  if(area==='cocina') return hasRole('proveeduria','chef','contarh');
  if(area==='bar') return hasRole('bartender','jefe_salon');
  return false;
}
const canInvView = () => invAreasFor().length>0;
const canInvEdit = () => invAreasFor().some(canInvEditArea);
const canRecipeEdit = () => hasRole('admin','chef');
const canRecipeView = () => hasRole('admin','chef','cocinero','bartender');
const canShiftManage = () => hasRole('admin','jefe_salon','contarh','gerencia_exp');
const canPersonal = () => hasRole('admin','contarh');
const canReservView = () => hasRole('admin','gerencia_exp','gerencia_data','jefe_salon','salonero','bartender','chef');
const canReservEdit = () => hasRole('admin','gerencia_exp','jefe_salon','salonero');
const canSouvView = () => hasRole('admin','gerencia_exp','gerencia_data','jefe_salon','salonero');
const canSouvMoney = () => hasRole('admin','gerencia_exp','gerencia_data'); // ve costo/precio/ganancia y administra
const canSouvSell = () => hasRole('admin','gerencia_exp','jefe_salon','salonero');
function sucName(id){ if(id==='all') return 'Todas'; const s=(DB.sucursales||[]).find(x=>x.id===id); return s?s.name:'—'; }
function lowStock(p){ return p.stock<=p.minStock; }
function invInScope(){ const a=invAreasFor(); return (DB.inventory||[]).filter(p=>p&&inScope(p.sucursalId) && a.includes(p.area||'cocina')); }

/* Sucursal visible para el usuario actual + filtro */
function visibleSuc(){
  // admin puede filtrar; otros ven su sucursal (y 'all' = global)
  if(isAdmin()) return SES.sucFilter; // 'all' o un id
  return me().sucursalId;
}
function inScope(sucId){
  const v = isAdmin() ? SES.sucFilter : me().sucursalId;
  if(v==='all') return true;            // ver todo
  if(sucId==='all') return true;        // elementos globales
  return sucId===v;
}

/* ---------------- Auditoría (anti-fraude, solo se agrega) ---------------- */
function audit(action, detail, sucId){
  DB.audit.unshift({id:uid(),byId:SES.userId,action,detail,sucursalId:sucId||(me()?me().sucursalId:'all'),at:now()});
  // Toda acción auditada es un cambio real de datos: persistir y sincronizar a la nube
  // (así lo creado por un perfil — tareas, pedidos, etc. — llega a los demás).
  save();
}

/* ---------------- Notificaciones ---------------- */
function notify(userIds, text, ico, link){
  const arr = Array.isArray(userIds)?userIds:[userIds];
  arr.forEach(uId=>{
    if(uId===SES.userId) return; // no me notifico a mí mismo
    DB.notifs.unshift({id:uid(),userId:uId,text,ico:ico||'🔔',link:link||null,at:now(),read:false});
  });
  try{ sendPush(arr, text, link); }catch(_){}   // aviso push al celular (aunque la app esté cerrada)
}
const myNotifs = () => (DB.notifs||[]).filter(n=>n&&n.userId===SES.userId);
const unreadCount = () => myNotifs().filter(n=>!n.read).length;

/* ---- Aviso de notificaciones que llegan (popup + sonido + vibración) ---- */
let _notifSeenAt = 0;            // marca de tiempo: solo avisamos lo que llega después
function notifBaseline(){        // al entrar, no avisar el historial viejo
  const mine = myNotifs();
  _notifSeenAt = mine.length ? Math.max.apply(null, mine.map(n=>n.at||0)) : now();
}
// AudioContext compartido; se "desbloquea" con el primer toque (requisito de celulares)
let _audioCtx=null;
function unlockAudio(){
  try{
    if(!_audioCtx){ const AC=window.AudioContext||window.webkitAudioContext; if(AC) _audioCtx=new AC(); }
    if(_audioCtx && _audioCtx.state==='suspended') _audioCtx.resume();
  }catch(_){}
}
function playNotifSound(){
  try{
    unlockAudio();
    if(!_audioCtx) return;
    const ctx=_audioCtx, t0=ctx.currentTime;
    [{f:784,t:0},{f:1175,t:0.12}].forEach(no=>{   // dos tonos: un "ding" agradable
      const o=ctx.createOscillator(), g=ctx.createGain(), s=t0+no.t;
      o.type='sine'; o.frequency.value=no.f;
      g.gain.setValueAtTime(0,s);
      g.gain.linearRampToValueAtTime(0.2,s+0.02);
      g.gain.exponentialRampToValueAtTime(0.0001,s+0.30);
      o.connect(g); g.connect(ctx.destination);
      o.start(s); o.stop(s+0.32);
    });
  }catch(_){}
}
function notifToast(n){
  const w=$('#toastWrap'); if(!w) return;
  const iv = ({tareas:'check',pedidos:'box',inventario:'chart',horarios:'calendar',chat:'message',proyectos:'clipboard',reportes:'trend'})[(n.link&&n.link.view)]||'bell';
  const t=document.createElement('div'); t.className='toast toast-notif';
  t.innerHTML=`<span class="tn-ico">${svgIcon(iv)}</span>`+
    `<div class="tn-body"><div class="tn-title">Nueva notificación</div><div class="tn-text">${esc(n.text)}</div></div>`+
    `<button class="tn-close" aria-label="Cerrar">✕</button>`;
  let gone=false;
  const dismiss=()=>{ if(gone)return; gone=true; t.classList.remove('show'); setTimeout(()=>t.remove(),300); };
  t.querySelector('.tn-close').onclick=e=>{ e.stopPropagation(); dismiss(); };
  t.onclick=()=>{ dismiss(); openNotif(n.id); };
  w.appendChild(t);
  requestAnimationFrame(()=>t.classList.add('show'));
  setTimeout(dismiss,6000);
}
function checkNotifPops(){
  if(!SES.userId) return;
  const fresh = myNotifs().filter(n=>n && (n.at||0) > _notifSeenAt);
  if(!fresh.length) return;
  _notifSeenAt = Math.max.apply(null,[_notifSeenAt].concat(fresh.map(n=>n.at||0)));
  fresh.sort((a,b)=>(a.at||0)-(b.at||0)).slice(-3).forEach(notifToast);  // máx. 3 popups, más nuevo arriba
  playNotifSound();
  if(navigator.vibrate){ try{ navigator.vibrate([45,60,45]); }catch(_){} }
}
// Desbloquear el audio en el primer gesto del usuario (móvil exige interacción)
['pointerdown','touchstart','keydown'].forEach(ev=>document.addEventListener(ev,unlockAudio,{passive:true}));
// Revisar recordatorios (calendario y turnos) cada minuto, aunque no se navegue
setInterval(()=>{ if(!SES.userId) return; try{ checkCalReminders(); }catch(_){} try{ checkShiftReminders(); }catch(_){} try{ checkNotifPops(); }catch(_){} }, 60000);

/* ---------------- Toasts ---------------- */
function toast(text, kind=''){
  const w=$('#toastWrap'); const t=document.createElement('div');
  t.className='toast '+kind; t.textContent=de(text); w.appendChild(t);
  requestAnimationFrame(()=>t.classList.add('show'));
  setTimeout(()=>{ t.classList.remove('show'); setTimeout(()=>t.remove(),300); },3000);
}
// Aviso "Eliminado · Deshacer" por unos segundos (red de seguridad al borrar)
function undoToast(text, onUndo){
  const w=$('#toastWrap'); if(!w) return;
  const t=document.createElement('div'); t.className='toast toast-notif';
  t.innerHTML=`<span class="tn-ico">${svgIcon('trash')}</span><div class="tn-body"><div class="tn-title">Eliminado</div><div class="tn-text">${esc(de(text))}</div></div><button class="tn-undo">Deshacer</button>`;
  let done=false; const dismiss=()=>{ if(done)return; done=true; t.classList.remove('show'); setTimeout(()=>t.remove(),300); };
  t.querySelector('.tn-undo').onclick=e=>{ e.stopPropagation(); dismiss(); try{ onUndo(); }catch(_){} };
  w.appendChild(t); requestAnimationFrame(()=>t.classList.add('show'));
  setTimeout(dismiss, 6000);
}
// Re-inserta un objeto borrado y le quita el tombstone (para el "Deshacer")
function undoDelete(coll, obj, label, after){
  undoToast(label, ()=>{
    reviveId(obj.id);   // marca de restauración (gana sobre el borrado en todos los dispositivos)
    DB[coll]=DB[coll]||[]; if(!DB[coll].some(x=>x&&x.id===obj.id)) DB[coll].push(obj);
    if(typeof after==='function'){ try{ after(); }catch(_){} }
    save(); render(); toast('Restaurado','ok');
  });
}

/* ---------------- Modal ---------------- */
function openModal(html, wide){
  $('#modal').className = 'modal'+(wide?' wide':'');
  $('#modal').innerHTML = de(html);
  $('#modalBg').classList.add('on');
}
function closeModal(){ $('#modalBg').classList.remove('on'); $('#modal').innerHTML=''; }
$('#modalBg').addEventListener('click', e=>{ if(e.target.id==='modalBg') closeModal(); });
// Escape: cerrar el modal abierto, o los paneles (notificaciones / menú de usuario)
document.addEventListener('keydown', e=>{
  // Ctrl/Cmd+Z: deshacer en la pizarra de Proyectos (si no estás escribiendo en un campo)
  if((e.ctrlKey||e.metaKey) && !e.shiftKey && (e.key==='z'||e.key==='Z')){
    const tg=e.target, tag=(tg&&tg.tagName)||'';
    if(SES.view==='proyectos' && !/^(INPUT|TEXTAREA|SELECT)$/.test(tag) && !(tg&&tg.isContentEditable)){
      e.preventDefault(); boardUndo(); return;
    }
  }
  if(e.key!=='Escape') return;
  if($('#modalBg') && $('#modalBg').classList.contains('on')){ closeModal(); return; }
  const np=$('#notifPanel'), um=$('#userMenu'), sw=$('#sucSwitch');
  if(np) np.classList.remove('on'); if(um) um.classList.remove('on'); if(sw) sw.classList.remove('open');
});

async function confirmDialog(body, {title='¿Seguro?',okText='Sí',variant='danger',icon='⚠️'}={}){
  return new Promise(res=>{
    openModal(`
      <div class="modal-head"><h3>${icon} ${esc(title)}</h3><button class="modal-close" onclick="closeModal()">×</button></div>
      <div class="modal-body"><p style="font-size:14px;line-height:1.6;color:var(--text-soft)">${esc(body)}</p></div>
      <div class="modal-foot">
        <button class="btn btn-ghost" id="cfgNo">Cancelar</button>
        <button class="btn ${variant==='danger'?'btn-danger':'btn-primary'}" id="cfgYes">${esc(okText)}</button>
      </div>`);
    $('#cfgNo').onclick=()=>{closeModal();res(false);};
    $('#cfgYes').onclick=()=>{closeModal();res(true);};
  });
}

/* =====================================================================
   IMÁGENES (base64)
   ===================================================================== */
function readImages(fileList){
  return Promise.all([...fileList].slice(0,4).map(f=>new Promise(r=>{
    const rd=new FileReader();
    rd.onload=()=>{ // comprimir un poco
      const img=new Image();
      img.onload=()=>{
        const max=900, sc=Math.min(1,max/Math.max(img.width,img.height));
        const c=document.createElement('canvas'); c.width=img.width*sc; c.height=img.height*sc;
        c.getContext('2d').drawImage(img,0,0,c.width,c.height);
        r(c.toDataURL('image/jpeg',0.7));
      };
      img.src=rd.result;
    };
    rd.readAsDataURL(f);
  })));
}
// Abre una imagen a pantalla completa leyendo el src ya validado del elemento (sin document.write ni datos en el onclick)
function showImgWindow(s){
  if(!s) return;
  const w=window.open('','_blank'); if(!w) return;
  try{ w.document.title='Imagen'; w.document.body.style.margin='0'; w.document.body.style.background='#000';
    const i=w.document.createElement('img'); i.src=s; i.style.maxWidth='100%'; i.style.display='block'; i.style.margin='0 auto';
    w.document.body.appendChild(i); }catch(_){}
}
function openImgFromEl(el){
  const s=safeImg(el && el.getAttribute && el.getAttribute('src'));
  if(s){ showImgWindow(s); return; }
  // aún no cargó (carga diferida): resolver por su id y abrir cuando llegue
  const mid = el && el.getAttribute && el.getAttribute('data-mid');
  if(mid){ toast('Cargando imagen…','ok'); fetchMediaData(mid).then(d=>{ const ss=safeImg(d); if(ss) showImgWindow(ss); else toast('No se pudo abrir la imagen','err'); }); }
}
window.openImgFromEl=openImgFromEl;

/* =====================================================================
   MEDIOS (fotos / PDF / video) en nodo aparte 'media/<id>'
   Los binarios NO viven dentro del blob 'state' (eso hacía que se
   re-descargara todo en cada cambio). En 'state' guardamos solo un id;
   el binario se carga bajo demanda desde media/<id> y se cachea.
   Compatibilidad: si el valor ya es un data: URI viejo, se usa directo.
   ===================================================================== */
const mediaCache = {};     // id -> dataURI (en memoria)
const mediaPending = {};   // id -> true mientras se carga
function isDataUri(s){ return typeof s==='string' && s.indexOf('data:')===0; }
const MEDIA_LS='stm_';     // prefijo en localStorage para modo local / respaldo
// Sube un binario (data: URI) a media/<id> y devuelve el id. Si ya es id/legado, lo devuelve igual.
// Si la subida a la nube falla (reglas sin publicar, sin red, archivo enorme), devuelve el data: URI
// inline como respaldo: así el adjunto SIGUE llegando a todos (más pesado) en vez de romperse para los demás.
let _mediaWarned=false;
async function putMedia(dataURI){
  if(!isDataUri(dataURI)) return dataURI||'';
  const id=uid();
  if(cloudOn && fbdb){
    try{ await fbdb.ref('media/'+id).set(dataURI); mediaCache[id]=dataURI; return id; }
    catch(e){
      console.warn('media put', e&&e.code);
      if(!_mediaWarned){ _mediaWarned=true; toast('No se pudo subir el adjunto a la nube (revisá las reglas/inicio anónimo). Por ahora viaja dentro de la base.','err'); }
      return dataURI; // respaldo inline: no se pierde para nadie
    }
  }
  // modo local: guardar en localStorage; si no cabe, dejarlo inline
  mediaCache[id]=dataURI;
  try{ localStorage.setItem(MEDIA_LS+id,dataURI); return id; }catch(_){ return dataURI; }
}
// Devuelve el dataURI si ya está disponible; si no, dispara la carga y devuelve undefined.
function mediaData(ref){
  if(isDataUri(ref)) return ref;            // legado inline
  if(!ref) return '';
  if(mediaCache[ref]!==undefined) return mediaCache[ref];
  loadMedia(ref); return undefined;          // aún no disponible
}
function loadMedia(id){
  if(!id || isDataUri(id) || mediaCache[id]!==undefined || mediaPending[id]) return;
  mediaPending[id]=true;
  const done=d=>{ mediaCache[id]=d||''; delete mediaPending[id]; applyMediaToDom(id); };
  let local=null; try{ local=localStorage.getItem(MEDIA_LS+id); }catch(_){}
  if(local!=null) return done(local);
  if(cloudOn && fbdb){ fbdb.ref('media/'+id).get().then(s=>done(s&&s.exists()?s.val():'')).catch(()=>done('')); }
  else done('');
}
/* Si una foto/video del chat crece al cargar, mantener la vista anclada al final
   (iOS no tiene anclaje de scroll: sin esto se ve todo "subiendo" al abrir el chat). */
function _chatMediaRepin(el){
  const m=document.getElementById('chatMsgs');
  if(!m || !m.contains(el)) return;
  // no re-anclar si el usuario está tocando/deslizando la lista (pelearía con el dedo)
  const pin=()=>{ if(!m._tch && m.scrollHeight-m.scrollTop-m.clientHeight < 120) m.scrollTop=m.scrollHeight; };
  pin();
  const ev = el.tagName==='VIDEO' ? 'loadedmetadata' : 'load';
  el.addEventListener(ev, pin, {once:true});
}
function applyMediaToDom(id){
  const d=mediaCache[id]||''; const safe=d.indexOf('data:video')===0?safeVid(d):d.indexOf('data:audio')===0?safeAud(d):safeImg(d);
  let sel; try{ sel='[data-mid="'+(window.CSS&&CSS.escape?CSS.escape(id):id)+'"]'; }catch(_){ sel='[data-mid="'+id+'"]'; }
  document.querySelectorAll(sel).forEach(el=>{
    if(safe){ el.src=safe; el.classList.remove('media-loading'); _chatMediaRepin(el); } else { el.classList.remove('media-loading'); el.classList.add('media-broken'); }
  });
}
// Construye <img>/<video> por referencia (id o data: legado). Si aún no cargó, deja data-mid y lo completa al llegar.
function mediaTag(ref, kind, attrs){
  attrs=attrs||''; const tag = kind==='video'?'video':'img';
  const d=mediaData(ref);
  if(d!==undefined){ const safe = kind==='video'?safeVid(d):safeImg(d); return safe?`<${tag} src="${safe}" ${attrs}></${tag}>`:''; }
  return `<${tag} data-mid="${esc(ref)}" class="media-loading" ${attrs}></${tag}>`;
}
// Para abrir/descargar: espera a tener el dataURI (resuelve id o legado).
async function fetchMediaData(ref){
  if(isDataUri(ref)) return ref;
  if(!ref) return '';
  if(mediaCache[ref]!==undefined) return mediaCache[ref];
  let local=null; try{ local=localStorage.getItem(MEDIA_LS+ref); }catch(_){}
  if(local!=null){ mediaCache[ref]=local; return local; }
  if(cloudOn && fbdb){ try{ const s=await fbdb.ref('media/'+ref).get(); const d=s&&s.exists()?s.val():''; mediaCache[ref]=d; return d; }catch(_){ return ''; } }
  return '';
}

/* =====================================================================
   NAVEGACIÓN
   ===================================================================== */
const NAV_DEF = {
  inicio:   { label:'Inicio',      ico:'home' },
  tareas:   { label:'Tareas',      ico:'check' },
  pedidos:  { label:'Pedidos',     ico:'box' },
  inventario:{label:'Inventario',  ico:'chart' },
  recetas:  { label:'Recetas',     ico:'utensils' },
  horarios: { label:'Horarios',    ico:'calendar' },
  calendario:{ label:'Calendario', ico:'calendar' },
  proyectos:{ label:'Proyectos',   ico:'clipboard' },
  chat:     { label:'Mensajes',    ico:'message' },
  reportes: { label:'Reportes',    ico:'trend' },
  reservas: { label:'Reservas',    ico:'reserva' },
  souvenir: { label:'Souvenirs',   ico:'gift' },
  caja:     { label:'Caja',        ico:'cash' },
  camaras:  { label:'Cámaras',     ico:'video' },
  equipo:   { label:'Equipo',      ico:'users' },
  auditoria:{ label:'Movimientos', ico:'shield' },
};
// Menú personalizado por puesto
const ROLE_NAV = {
  admin:       ['inicio','tareas','pedidos','reservas','souvenir','caja','inventario','recetas','horarios','proyectos','chat','reportes','camaras','equipo','auditoria'],
  chef:        ['inicio','tareas','pedidos','reservas','inventario','recetas','horarios','proyectos','chat'],
  cocinero:    ['inicio','tareas','pedidos','inventario','recetas','horarios','proyectos','chat'],
  jefe_salon:  ['inicio','tareas','pedidos','reservas','souvenir','caja','inventario','horarios','proyectos','chat'],
  salonero:    ['inicio','tareas','pedidos','reservas','souvenir','caja','horarios','proyectos','chat'],
  proveeduria: ['inicio','tareas','pedidos','inventario','horarios','proyectos','chat'],
  contarh:     ['inicio','tareas','pedidos','caja','inventario','equipo','horarios','reportes','proyectos','chat'],
  gerencia_exp:['inicio','tareas','pedidos','reservas','souvenir','horarios','equipo','proyectos','chat','reportes'],
  gerencia_data:['inicio','tareas','pedidos','reservas','souvenir','inventario','proyectos','chat','reportes'],
  bartender:   ['inicio','tareas','pedidos','reservas','inventario','recetas','horarios','proyectos','chat'],
};
// Calendario personal: disponible para todos los puestos (lo agregamos después de Horarios)
Object.keys(ROLE_NAV).forEach(r=>{ if(!ROLE_NAV[r].includes('calendario')){ const i=ROLE_NAV[r].indexOf('horarios'); if(i>=0) ROLE_NAV[r].splice(i+1,0,'calendario'); else ROLE_NAV[r].splice(1,0,'calendario'); } });
/* Secciones por persona: las del puesto + las EXTRA asignadas individualmente (u.navExtra)
   — p.ej. darle Reservas a alguien de Contabilidad sin cambiarle el puesto. */
function navAllowedIds(u){
  u=u||me(); if(!u) return [];
  const base=(ROLE_NAV[u.role]||['inicio','tareas','pedidos','proyectos','chat']).slice();
  (u.navExtra||[]).forEach(id=>{ if(NAV_DEF[id] && !base.includes(id)) base.push(id); });
  const off=new Set(u.navOff||[]);                          // secciones del puesto APAGADAS para esta persona
  return base.filter(id=> id==='inicio' || !off.has(id));   // Inicio nunca se puede apagar
}
/* Catálogo de permisos agrupado (para el editor de usuario) */
const PERM_GROUPS=[
  {label:'Trabajo diario',      ids:['tareas','pedidos','horarios','calendario','proyectos','chat']},
  {label:'Salón y ventas',      ids:['reservas','souvenir','caja']},
  {label:'Cocina y bodega',     ids:['recetas','inventario']},
  {label:'Control (gerencia)',  ids:['reportes','camaras','equipo','auditoria']},
];
const ADMIN_GROUP = ['reportes','camaras','equipo','auditoria'];
// Orden por importancia/uso diario (arriba lo más necesario; abajo lo ocasional)
const NAV_PRIORITY = ['inicio','tareas','pedidos','caja','inventario','reservas','horarios','chat','recetas','souvenir','calendario','proyectos','reportes','camaras','equipo','auditoria'];
function navItems(){
  const ids = navAllowedIds(me());
  const rank = id => { const i=NAV_PRIORITY.indexOf(id); return i<0?999:i; };
  return ids.slice().sort((a,b)=>rank(a)-rank(b)).map(id=>({id,...NAV_DEF[id]}));
}
// Barra inferior del celular: lo más usado a mano. Mensajes va junto a Tareas.
function bottomNavItems(){
  const ids = navAllowedIds(me());
  const want = ['inicio','tareas','chat','pedidos'];          // Inicio · Tareas · Mensajes · Pedidos
  const pick = want.filter(id=>ids.includes(id));
  ids.forEach(id=>{ if(pick.length<4 && pick.indexOf(id)<0) pick.push(id); });  // completar si al puesto le falta alguno
  return pick.slice(0,4).map(id=>({id,...NAV_DEF[id]}));
}

function pendingForMe(){
  const tasks=(DB.tasks||[]).filter(t=> (t.toIds||[]).includes(SES.userId) && (t.status==='pendiente'||t.status==='proceso'||t.status==='atrasada')).length;
  const subs=(DB.tasks||[]).reduce((n,t)=>{ if(!t||t.status==='hecha'||t.status==='rechazada') return n; return n+(t.subtasks||[]).filter(s=>s&&s.assigneeId===SES.userId&&!s.done).length; },0);
  return tasks+subs;
}
function pedidosForMe(){
  if(!me()) return 0;
  return (DB.pedidos||[]).filter(p=> (pedAreaMine(p.area)||isAdmin()) && (p.status==='pendiente'||p.status==='proceso') && inScope(p.sucursalId)).length;
}
function navBadge(id){
  try{
    if(id==='tareas') return pendingForMe();
    if(id==='pedidos') return pedidosForMe();
    if(id==='chat') return unreadChats();
    if(id==='inventario' && canInvEdit()) return invInScope().filter(lowStock).length;
  }catch(e){ console.warn('navBadge',id,e); }
  return 0;
}

function renderNav(){
  const items = navItems();
  const work = items.filter(n=>!ADMIN_GROUP.includes(n.id));
  const ctrl = items.filter(n=>ADMIN_GROUP.includes(n.id));
  $('#sidebar').innerHTML =
    `<div class="nav-sep">Trabajo</div>` + work.map(navBtn).join('') +
    (ctrl.length? `<div class="nav-sep">${isAdmin()?'Control total':'Gestión'}</div>`+ctrl.map(navBtn).join('') : '');
  // bottom nav: 4 principales (Inicio · Tareas · Mensajes · Pedidos) + "Más" con todo lo demás
  const bn = bottomNavItems();
  const bnIds = bn.map(n=>n.id);
  let moreBadge=0; items.forEach(n=>{ if(bnIds.indexOf(n.id)<0) moreBadge+=navBadge(n.id); });
  const moreActive = bnIds.indexOf(SES.view)<0;
  $('#bottomNav').innerHTML = bn.map(n=>{
    const b=navBadge(n.id);
    return `<button class="bn-item ${SES.view===n.id?'active':''}" onclick="go('${n.id}')">
      <span class="ico">${svgIcon(n.ico,'icon icon-lg')}</span>${n.label}${b?`<span class="ncount">${b}</span>`:''}</button>`;
  }).join('') +
    `<button class="bn-item ${moreActive?'active':''}" onclick="openNavSheet()"><span class="ico">${svgIcon('list','icon icon-lg')}</span>Más${moreBadge?`<span class="ncount">${moreBadge}</span>`:''}</button>`;
}
function toggleNav(){ const a=$('#app'); if(!a) return; const c=a.classList.toggle('nav-collapsed'); try{ localStorage.setItem('stNavCollapsed', c?'1':'0'); }catch(_){} }
window.toggleNav=toggleNav;
function openNavSheet(){
  const items=navItems();
  openModal(`<div class="modal-head"><h3>Menú</h3><button class="modal-close" onclick="closeModal()">${svgIcon('x','icon')}</button></div>
    <div class="modal-body" style="padding:10px 12px">
      ${items.map(n=>{const b=navBadge(n.id);return `<button class="nav-item ${SES.view===n.id?'active':''}" style="width:100%" onclick="closeModal();go('${n.id}')"><span class="ico">${svgIcon(n.ico)}</span><span>${n.label}</span>${b?`<span class="ncount">${b}</span>`:''}</button>`;}).join('')}
      <div class="nav-sep">Perfil</div>
      <button class="nav-item" style="width:100%" onclick="closeModal();toggleTheme()"><span class="ico">${svgIcon('theme')}</span><span>Cambiar tema</span></button>
      <button class="nav-item" style="width:100%" onclick="closeModal();exportData()"><span class="ico">${svgIcon('save')}</span><span>Respaldar datos</span></button>
      <button class="nav-item" style="width:100%;color:var(--danger)" onclick="closeModal();logout()"><span class="ico">${svgIcon('logout')}</span><span>Cerrar sesión</span></button>
    </div>`);
}
window.openNavSheet=openNavSheet;
function navBtn(n){
  const b=navBadge(n.id);
  return `<button class="nav-item ${SES.view===n.id?'active':''}" onclick="go('${n.id}')">
    <span class="ico">${svgIcon(n.ico)}</span><span>${n.label}</span>${b?`<span class="ncount">${b}</span>`:''}</button>`;
}

function go(view){ SES.view=view; SES.activeChat=null; render(); }
window.go = go;

/* =====================================================================
   RENDER PRINCIPAL
   ===================================================================== */
function render(){
  ensureCollections();
  if(!me()){ return; }
  try{
  checkShiftReminders();
  try{ checkReservReminders(); }catch(_){}
  try{ checkCalReminders(); }catch(_){}
  try{ checkNotifPops(); }catch(_){}   // avisar (popup+sonido) lo nuevo, p.ej. recordatorios de turno/calendario
  const ct=$('#cloudTag'); if(ct) ct.classList.toggle('hidden',!cloudOn);
  try{ const ap=$('#app'); if(ap) ap.classList.toggle('nav-collapsed', localStorage.getItem('stNavCollapsed')==='1'); }catch(_){}
  try{ pushRefreshOnce(); }catch(_){}   // re-asociar push al usuario actual + deep-link de notificación
  // topbar
  const tbAv=$('#tbAv'); if(tbAv){ tbAv.style.background=roleInfo(me().role).color; tbAv.textContent=initials(me().name); }
  if($('#tbName')) $('#tbName').textContent = me().name;
  if($('#tbRole')) $('#tbRole').textContent = roleInfo(me().role).label;
  // sucursal switch (solo admin puede cambiar; otros fijo)
  const sucBtn=$('#sucBtn'), sucLabel=$('#sucBtnLabel'), sucSwitch=$('#sucSwitch');
  if(sucBtn && sucLabel){
    const chev=sucSwitch?sucSwitch.querySelector('.suc-chev'):null;
    if(isAdmin()){
      sucBtn.disabled=false;
      sucLabel.textContent = SES.sucFilter==='all' ? 'Todas las sucursales' : sucName(SES.sucFilter);
      if(chev) chev.style.display='';
    } else {
      sucBtn.disabled=true;
      sucLabel.textContent = sucName(me().sucursalId);
      if(chev) chev.style.display='none';
      if(sucSwitch) sucSwitch.classList.remove('open');
    }
  }
  // badge
  const uc=unreadCount();
  const nb=$('#notifBadge');
  if(nb){ if(uc){ nb.textContent=uc; nb.classList.remove('hidden'); } else nb.classList.add('hidden'); }
  }catch(e){ console.error('topbar', e); }

  try{ renderNav(); }catch(e){ console.error('renderNav', e); $('#sidebar').innerHTML=''; }

  const v=$('#view');
  const map={ inicio:viewInicio, tareas:viewTareas, pedidos:viewPedidos, inventario:viewInventario,
    recetas:viewRecetas, horarios:viewHorarios, calendario:viewCalendario, personal:viewEquipo, proyectos:viewProyectos,
    chat:viewChat, reportes:viewReportes, reservas:viewReservas, souvenir:viewSouvenir, caja:viewCaja, camaras:viewCamaras, equipo:viewEquipo, auditoria:viewAuditoria };
  // si el puesto no tiene acceso a la vista actual, volver a inicio
  if(!navAllowedIds(me()).includes(SES.view)) SES.view='inicio';
  v.classList.toggle('view-wide', SES.view==='inventario');   // inventario usa todo el ancho de pantalla
  try{
    v.innerHTML = de((map[SES.view]||viewInicio)());
    if(SES.view==='chat') afterChatRender(); else document.body.classList.remove('chat-open');
    if(SES.view==='proyectos'){ const pc=$('#projChatMsgs'); if(pc) pc.scrollTop=pc.scrollHeight; applyZoom(); } else unwatchProjectCall();
  }catch(e){
    console.error('view '+SES.view, e);
    v.innerHTML=`<div class="card" style="max-width:560px;margin:30px auto;text-align:center">
      <div style="font-weight:700;font-size:16px;margin-bottom:8px">Esta sección tuvo un problema al cargar</div>
      <div class="page-sub" style="margin-bottom:14px">Probá con otra sección desde el menú. Si sigue, avisá a Gerencia.</div>
      <pre style="text-align:left;white-space:pre-wrap;word-break:break-word;background:var(--bg-soft);border:1px solid var(--border);border-radius:10px;padding:12px;font-size:12px;color:var(--danger);margin:0 0 14px;max-height:180px;overflow:auto">${esc('['+SES.view+'] '+(e&&e.message?e.message:String(e))+(e&&e.stack?'\n'+e.stack.split('\n').slice(0,4).join('\n'):''))}</pre>
      <button class="btn btn-primary" style="display:inline-block;width:auto;padding:10px 18px" onclick="go('inicio')">Ir a Inicio</button></div>`;
  }
  // Persistir solo en local; el envío a la nube lo hacen las mutaciones (save()).
  // Antes render() hacía save() completo → subía el blob en CADA navegación (tráfico innecesario para todos).
  try{ localStorage.setItem(DB_KEY, JSON.stringify(DB)); }catch(_){}
}
window.render = render;

/* =====================================================================
   VISTA: INICIO (dashboard por rol)
   ===================================================================== */
function viewInicio(){
  const u=me();
  const misTareas = (DB.tasks||[]).filter(t=>t&&(t.toIds||[]).includes(u.id) && inScope(t.sucursalId));
  const pend = misTareas.filter(t=>t.status==='pendiente'||t.status==='proceso').length;
  const atras = misTareas.filter(t=>t.status==='atrasada').length;
  const misPedidos = (DB.pedidos||[]).filter(p=>p&&(pedAreaMine(p.area)||isAdmin()) && (p.status==='pendiente'||p.status==='proceso') && inScope(p.sucursalId)).length;

  // Panel "quién no cumple" — tareas atrasadas/rechazadas agrupadas por responsable
  const fails = (DB.tasks||[]).filter(t=>t&&(t.status==='atrasada'||t.status==='rechazada') && inScope(t.sucursalId));
  const byResp={};
  fails.forEach(t=>(t.toIds||[]).forEach(id=>{ byResp[id]=(byResp[id]||0)+1; }));
  const failRows = Object.entries(byResp).sort((a,b)=>b[1]-a[1]).map(([id,n])=>{
    const usr=userById(id); if(!usr) return '';
    return `<div class="tk" style="cursor:default">${avatarHTML(usr)}<div class="tk-main">
      <div class="tk-title">${esc(usr.name)} <span class="pill rechazada">${n} sin cumplir</span></div>
      <div class="tk-meta">${roleInfo(usr.role).label} · ${esc(sucName(usr.sucursalId))}</div></div></div>`;
  }).join('');

  const greet = `${horaSaludo()}, ${(u.name||'').split(' ')[0]} 👋`;

  let html = `<div class="page-head"><div><div class="page-title">${esc(greet)}</div>
    <div class="page-sub">${roleInfo(u.role).label}${isAdmin()?' · viendo '+sucName(SES.sucFilter):' · '+sucName(u.sucursalId)}</div></div></div>`;

  html += todayShiftCard();
  html += attendanceCard();
  html += reservTodayCard();

  html += `<div class="kpi-row">
    <div class="kpi ${pend?'':'good'}"><div class="label">Mis tareas</div><div class="value">${pend}</div><div class="sub">pendientes o en proceso</div></div>
    <div class="kpi ${atras?'alert':'good'}"><div class="label">Atrasadas</div><div class="value">${atras}</div><div class="sub">necesitan atención</div></div>
    <div class="kpi ${misPedidos?'warn':'good'}"><div class="label">${isAdmin()?'Pedidos activos':'Pedidos a mi área'}</div><div class="value">${misPedidos}</div><div class="sub">por atender</div></div>
    <div class="kpi"><div class="label">Sin leer</div><div class="value">${unreadCount()}</div><div class="sub">notificaciones</div></div>
  </div>`;

  // panel personalizado por puesto
  html += rolePanel();

  // próximas tareas
  const next = misTareas.filter(t=>t.status!=='hecha').sort((a,b)=>(a.due||9e15)-(b.due||9e15)).slice(0,4);
  html += `<div class="page-head" style="margin:18px 0 10px"><div class="page-title" style="font-size:17px">Lo que sigue para vos</div>
    <div class="ph-spacer"></div><button class="btn btn-ghost" style="flex:0 0 auto;padding:8px 12px" onclick="go('tareas')">Ver todas</button></div>`;
  html += next.length ? next.map(taskRow).join('') : emptyState('🎉','Estás al día','No tenés tareas pendientes asignadas. Buen trabajo.');

  // control gerencia (solo Administración: muestra tareas de TODO el equipo)
  if(isAdmin()){
    html += `<div class="page-head" style="margin:22px 0 10px"><div class="page-title" style="font-size:17px">🛡️ Control · quién no cumple</div></div>`;
    html += `<div class="card" style="padding:12px">${failRows || emptyState('✅','Todo en orden','Nadie tiene tareas atrasadas ni rechazadas. Excelente.')}</div>`;
  }
  return html;
}
function horaSaludo(){ const h=new Date().getHours(); return h<12?'Buenos días':h<19?'Buenas tardes':'Buenas noches'; }

/* =====================================================================
   VISTA: TAREAS
   ===================================================================== */
let taskFilter='todas', taskSearch='', taskView='lista', _boardAddStatus=null, taskLabelFilter='';
window.setTaskView = v => { taskView=v; render(); };
window.setTaskLabelFilter = id => { taskLabelFilter = (taskLabelFilter===id?'':id); render(); };
/* ===== Etiquetas de tareas, subtareas y reordenar (estilo Asana) ===== */
const TASK_LABEL_COLORS=['#e0533d','#e0a13d','#5aa777','#5b8def','#8b5cf6','#c879a9','#0ea5b7','#64748b','#db2777','#0891b2'];
function allTaskLabels(){ return Array.isArray(DB.taskLabels)?DB.taskLabels:[]; }
function taskLabelById(id){ return allTaskLabels().find(l=>l&&l.id===id); }
function taskLabelChips(ids){ if(!ids||!ids.length) return ''; const chips=ids.map(id=>{const l=taskLabelById(id); return l?`<span class="tlabel" style="--lc:${l.color}">${esc(l.name)}</span>`:'';}).join(''); return chips?`<div class="tlabels">${chips}</div>`:''; }
let _taskFormLabels=[];
function taskLabelPickerHTML(){
  return `<div class="tlbl-pick" id="tlblPick">${allTaskLabels().map(l=>`<button type="button" class="tlbl-opt ${_taskFormLabels.includes(l.id)?'on':''}" style="--lc:${l.color}" onclick="taskLabelToggle('${l.id}')">${esc(l.name)}</button>`).join('')}<span class="tlbl-add"><input class="input" id="tlblNew" placeholder="+ nueva" autocomplete="off" onkeydown="if(event.key==='Enter'){event.preventDefault();taskLabelAdd();}"><button type="button" class="chip" onclick="taskLabelAdd()">Agregar</button></span></div>`;
}
function taskLabelToggle(id){ const i=_taskFormLabels.indexOf(id); if(i>=0)_taskFormLabels.splice(i,1); else _taskFormLabels.push(id); const el=$('#tlblPick'); if(el) el.outerHTML=taskLabelPickerHTML(); }
function taskLabelAdd(){
  const el=$('#tlblNew'); const v=el?el.value.trim():''; if(!v) return;
  const ex=allTaskLabels().find(l=>l.name.toLowerCase()===v.toLowerCase());
  if(ex){ if(!_taskFormLabels.includes(ex.id)) _taskFormLabels.push(ex.id); }
  else { const l={id:uid(),name:clip(v,24),color:TASK_LABEL_COLORS[allTaskLabels().length%TASK_LABEL_COLORS.length]}; DB.taskLabels=allTaskLabels(); DB.taskLabels.push(l); _taskFormLabels.push(l.id); save(); }
  const p=$('#tlblPick'); if(p) p.outerHTML=taskLabelPickerHTML();
}
window.taskLabelToggle=taskLabelToggle; window.taskLabelAdd=taskLabelAdd;
/* Subtareas */
function subProgress(t){ const ss=t&&t.subtasks||[]; if(!ss.length) return null; return {done:ss.filter(s=>s.done).length, total:ss.length}; }
function subAdd(taskId){ const t=DB.tasks.find(x=>x.id===taskId); if(!t||!taskCanManage(t)) return; const el=$('#subNew'); const v=el?el.value.trim():''; if(!v) return; t.subtasks=t.subtasks||[]; t.subtasks.push({id:uid(),title:clip(v,140),done:false}); t.updatedAt=now(); save(); taskDetail(taskId); render(); }
function subToggle(taskId,sid){ const t=DB.tasks.find(x=>x.id===taskId); if(!t||!taskCanManage(t)) return; const s=(t.subtasks||[]).find(x=>x.id===sid); if(!s) return; s.done=!s.done; t.updatedAt=now(); save(); taskDetail(taskId); render(); }
function subDel(taskId,sid){ const t=DB.tasks.find(x=>x.id===taskId); if(!t||!taskCanManage(t)) return; t.subtasks=(t.subtasks||[]).filter(x=>x.id!==sid); t.updatedAt=now(); save(); taskDetail(taskId); render(); }
function subEditModal(taskId,sid){
  const t=DB.tasks.find(x=>x.id===taskId); if(!t||!taskCanManage(t)) return;
  const s=(t.subtasks||[]).find(x=>x.id===sid); if(!s) return;
  const people=scopedPeople(false); const dueIso=s.due?isoLocal(new Date(s.due)):'';
  openModal(`<div class="modal-head"><h3>${svgIcon('check','icon')} Subtarea</h3><button class="modal-close" onclick="taskDetail('${taskId}')">${svgIcon('x','icon')}</button></div>
    <div class="modal-body">
      <div class="field"><label>Subtarea</label><input class="input" id="seTitle" value="${esc(s.title)}" autocomplete="off"></div>
      <div class="field"><label>Responsable</label><select class="select" id="seWho"><option value="">Sin asignar</option>${people.map(u=>`<option value="${u.id}" ${s.assigneeId===u.id?'selected':''}>${esc(u.name)} — ${roleInfo(u.role).short}</option>`).join('')}</select></div>
      <div class="field"><label>Fecha (opcional)</label><input class="input input-date" type="date" id="seDue" value="${dueIso}"></div>
    </div>
    <div class="modal-foot"><button class="btn btn-ghost danger" style="flex:0 0 auto" onclick="subDel('${taskId}','${sid}')">${svgIcon('trash','icon icon-sm')} Quitar</button><div style="flex:1"></div><button class="btn btn-ghost" onclick="taskDetail('${taskId}')">Cancelar</button><button class="btn btn-primary" onclick="subSave('${taskId}','${sid}')">Guardar</button></div>`);
}
function subSave(taskId,sid){
  const t=DB.tasks.find(x=>x.id===taskId); if(!t||!taskCanManage(t)) return;
  const s=(t.subtasks||[]).find(x=>x.id===sid); if(!s) return;
  const title=clip($('#seTitle')?$('#seTitle').value:'',140); if(!title){ toast('Ponele un texto a la subtarea','err'); return; }
  const who=$('#seWho')?$('#seWho').value:''; const dueV=$('#seDue')?$('#seDue').value:''; const prev=s.assigneeId;
  s.title=title; s.assigneeId=who||''; s.due = dueV? new Date(dueV+'T12:00').getTime() : null;
  t.updatedAt=now(); save();
  if(who && who!==prev && who!==SES.userId) notify([who], `${me().name.split(' ')[0]} te asignó una subtarea: "${title}" (en "${t.title}")`, '✅', {view:'tareas'});
  taskDetail(taskId); render();
}
window.subAdd=subAdd; window.subToggle=subToggle; window.subDel=subDel; window.subEditModal=subEditModal; window.subSave=subSave;
/* Reordenar tarjetas dentro/entre columnas del tablero */
function taskColKey(s){ return s==='proceso'?'proceso':s==='hecha'?'hecha':'porhacer'; }
function boardCardDrop(dragId, targetId){
  if(dragId===targetId) return;
  const t=DB.tasks.find(x=>x.id===dragId), tgt=DB.tasks.find(x=>x.id===targetId); if(!t||!tgt) return;
  if(!taskCanManage(t)){ toast('No podés mover esta tarea','err'); return; }
  const key=taskColKey(tgt.status);
  if(taskColKey(t.status)!==key){
    const ns = key==='proceso'?'proceso':key==='hecha'?'hecha':'pendiente';
    t.status=ns; t.updatedAt=now(); t.log=t.log||[];
    const lbl=ns==='hecha'?'marcó la tarea como HECHA':ns==='proceso'?'puso la tarea en proceso':'movió la tarea a Por hacer';
    t.log.push({at:now(),byId:SES.userId,text:lbl}); audit('tarea',`${lbl}: "${t.title}"`,t.sucursalId);
    if(ns==='hecha') notify([t.fromId], `${me().name.split(' ')[0]} completó "${t.title}"`, '✅', {view:'tareas'});
  }
  const col=DB.tasks.filter(x=>x&&taskColKey(x.status)===key).sort((a,b)=>((a.ord==null?1e9:a.ord)-(b.ord==null?1e9:b.ord))||((a.due||9e15)-(b.due||9e15)));
  const list=col.filter(x=>x.id!==dragId); const ti=list.findIndex(x=>x.id===targetId);
  list.splice(ti<0?list.length:ti,0,t); list.forEach((x,i)=>x.ord=i);
  save(); render();
}
function kbCardOver(e){ e.preventDefault(); e.stopPropagation(); try{e.dataTransfer.dropEffect='move';}catch(_){}; e.currentTarget.classList.add('kb-cardover'); }
function kbCardLeave(e){ e.currentTarget.classList.remove('kb-cardover'); }
function kbCardDrop(e,targetId){ e.preventDefault(); e.stopPropagation(); e.currentTarget.classList.remove('kb-cardover'); document.querySelectorAll('.kb-col.over').forEach(c=>c.classList.remove('over')); const id=_kbDrag||(e.dataTransfer&&e.dataTransfer.getData('text/plain')); _kbDrag=null; if(id) boardCardDrop(id,targetId); }
window.boardCardDrop=boardCardDrop; window.kbCardOver=kbCardOver; window.kbCardLeave=kbCardLeave; window.kbCardDrop=kbCardDrop;
function viewTareas(){
  const all = (DB.tasks||[]).filter(t=> t && visibleTask(t) && (inScope(t.sucursalId) || (t.toIds||[]).includes(SES.userId) || t.fromId===SES.userId));
  refreshOverdue();
  let list=[...all];
  if(taskFilter==='mias') list=list.filter(t=>(t.toIds||[]).includes(SES.userId)||iHaveSubtask(t));
  else if(taskFilter==='asignadas') list=list.filter(t=>t.fromId===SES.userId);
  else if(taskFilter!=='todas') list=list.filter(t=>t.status===taskFilter);
  list.sort((a,b)=>(a.due||9e15)-(b.due||9e15));

  const guide = sectionGuide('tareas','¿Para qué sirve Tareas?',`
    Acá <b>pedís y seguís el trabajo</b> entre todos los puestos. El chef le pone una tarea a la cocina, el jefe de salón a los saloneros, etc.
    <ul style="margin:8px 0 0 18px">
      <li>Asignás a una o varias personas, con fecha y prioridad.</li>
      <li>Podés <b>responder, comentar</b> y adjuntar notas e imágenes.</li>
      <li>Quien la asigna (o Administración) puede <b>editarla o eliminarla</b>.</li>
      <li>Cada cambio queda <b>registrado</b> en el historial.</li>
    </ul>`);

  if(taskSearch){ const q=taskSearch.toLowerCase(); list=list.filter(t=>(t.title||'').toLowerCase().includes(q)||(t.desc||'').toLowerCase().includes(q)); }
  if(taskLabelFilter && !taskLabelById(taskLabelFilter)) taskLabelFilter='';
  if(taskLabelFilter) list=list.filter(t=>(t.labels||[]).includes(taskLabelFilter));

  const mineActive=all.filter(t=>(t.toIds||[]).includes(SES.userId)&&(t.status==='pendiente'||t.status==='proceso'||t.status==='atrasada')).length;
  const procN=all.filter(t=>t.status==='proceso').length;
  const lateN=all.filter(t=>t.status==='atrasada').length;
  const doneN=all.filter(t=>t.status==='hecha').length;

  const chips = [['mias','Para mí'],['asignadas','Yo asigné'],['pendiente','Pendientes'],['proceso','En proceso'],['atrasada','Atrasadas'],['hecha','Hechas'],['todas','Todas']]
    .map(([k,l],i)=>`<button class="chip ${taskFilter===k?'on':''}" ${k==='todas'?'style="margin-left:auto"':''} onclick="setTaskFilter('${k}')">${l}</button>`).join('');

  let html = `<div class="page-head"><div><div class="page-title">Tareas</div><div class="page-sub">Asigná, seguí y controlá el trabajo</div></div>
    <div class="ph-spacer"></div><button class="btn btn-primary" style="flex:0 0 auto" onclick="newTaskModal()">${svgIcon('plus','icon icon-sm')} Nueva tarea</button></div>`;
  html += guide;
  html += `<div class="kpi-row">
    <div class="kpi" onclick="setTaskFilter('mias')" style="cursor:pointer"><div class="label">Para mí</div><div class="value">${mineActive}</div><div class="sub">pendientes</div></div>
    <div class="kpi" onclick="setTaskFilter('proceso')" style="cursor:pointer"><div class="label">En proceso</div><div class="value">${procN}</div><div class="sub">en curso</div></div>
    <div class="kpi ${lateN?'alert':''}" onclick="setTaskFilter('atrasada')" style="cursor:pointer"><div class="label">Atrasadas</div><div class="value">${lateN}</div><div class="sub">requieren atención</div></div>
    <div class="kpi ok" onclick="setTaskFilter('hecha')" style="cursor:pointer"><div class="label">Hechas</div><div class="value">${doneN}</div><div class="sub">completadas</div></div>
  </div>`;
  html += `<div class="toolbar">
    <div class="seg tk-viewseg"><button type="button" class="seg-b ${taskView==='lista'?'on':''}" onclick="setTaskView('lista')">${svgIcon('list','icon icon-sm')} Lista</button><button type="button" class="seg-b ${taskView==='tablero'?'on':''}" onclick="setTaskView('tablero')">${svgIcon('clipboard','icon icon-sm')} Tablero</button><button type="button" class="seg-b ${taskView==='cronograma'?'on':''}" onclick="setTaskView('cronograma')">${svgIcon('calendar','icon icon-sm')} Cronograma</button></div>
    <input class="input search" placeholder="Buscar tarea…" value="${esc(taskSearch)}" oninput="taskSearch=this.value;clearTimeout(window._ts);window._ts=setTimeout(render,250)"></div>`;
  if(allTaskLabels().length) html += `<div class="chipscroll tlbl-filter">${allTaskLabels().map(l=>`<button class="tlbl-fchip ${taskLabelFilter===l.id?'on':''}" style="--lc:${l.color}" onclick="setTaskLabelFilter('${l.id}')">${esc(l.name)}</button>`).join('')}</div>`;
  if(taskView==='tablero' || taskView==='cronograma'){
    const scopeTasks=all.filter(t=>{
      if(taskFilter==='mias' && !((t.toIds||[]).includes(SES.userId)||iHaveSubtask(t))) return false;
      if(taskFilter==='asignadas' && t.fromId!==SES.userId) return false;
      if(taskLabelFilter && !(t.labels||[]).includes(taskLabelFilter)) return false;
      if(taskSearch){ const q=taskSearch.toLowerCase(); if(!((t.title||'').toLowerCase().includes(q)||(t.desc||'').toLowerCase().includes(q))) return false; }
      return true;
    });
    const bchips=[['todas','Todas'],['mias','Para mí'],['asignadas','Yo asigné']].map(([k,l])=>`<button class="chip ${taskFilter===k?'on':''}" onclick="setTaskFilter('${k}')">${l}</button>`).join('');
    html += `<div class="chipscroll">${bchips}</div>`;
    html += taskView==='cronograma' ? taskTimeline(scopeTasks) : taskBoard(scopeTasks);
  } else {
    html += `<div class="chipscroll">${chips}</div>`;
    html += list.length ? list.map(taskRow).join('')
      : emptyState('📝','No hay tareas acá', taskSearch?'No hay tareas que coincidan con la búsqueda.':'Cuando alguien asigne una tarea, aparece en esta lista. Probá creando una.','+ Nueva tarea','newTaskModal()');
  }
  return html;
}
function iHaveSubtask(t){ return (t&&t.subtasks||[]).some(s=>s&&s.assigneeId===SES.userId); }
/* Privacidad de tareas: cada persona ve SOLO lo suyo — las que le asignaron, las que ella
   asignó (para darles seguimiento) y aquellas donde tiene una subtarea. Solo Gerencia
   (Administración) ve las tareas de todo el equipo. */
function visibleTask(t){
  if(isAdmin()) return true;
  return (t.toIds||[]).includes(SES.userId) || t.fromId===SES.userId || iHaveSubtask(t);
}
window.setTaskFilter = k => { taskFilter=k; render(); };

function refreshOverdue(){
  let changed=false;
  (DB.tasks||[]).forEach(t=>{
    if(!t) return;
    if((t.status==='pendiente'||t.status==='proceso') && t.due && t.due<now()){ t.status='atrasada'; changed=true; }
  });
  if(changed) save();
}

function prioMeta(p){ return p==='alta'?{label:'Alta',color:'var(--danger)'}:p==='baja'?{label:'Baja',color:'var(--text-dim)'}:{label:'Media',color:'var(--warn)'}; }
function taskRow(t){
  const overdue = t.status==='atrasada';
  const pr = prioMeta(t.prio);
  const assignees=(t.toIds||[]).map(i=>userById(i)).filter(Boolean);
  const avs = assignees.slice(0,4).map(u=>`<span class="tk-av">${avatarHTML(u)}</span>`).join('') + (assignees.length>4?`<span class="tk-av more">+${assignees.length-4}</span>`:'');
  return `<div class="tk tk-prio-${t.prio}${overdue?' tk-overdue':''}" onclick="taskDetail('${t.id}')">
    <div class="tk-bar"></div>
    <div class="tk-main">
      <div class="tk-row1"><div class="tk-title">${esc(t.title)} ${t.images&&t.images.length?svgIcon('clip','icon icon-sm'):''}</div><span class="pill ${t.status}">${statusLabel(t.status)}</span></div>
      <div class="tk-meta">
        <span class="tk-prio-chip"><span class="dot-prio" style="background:${pr.color}"></span>${pr.label}</span>
        <span class="${overdue?'tk-due-late':''}">${svgIcon('clock','icon icon-sm')} ${fmtDate(t.due)}</span>
        <span class="tk-avs">${avs||'—'}</span>
        <span>${svgIcon('pin','icon icon-sm')} ${esc(sucName(t.sucursalId))}</span>
        ${(()=>{const sp=subProgress(t); return sp?`<span>${svgIcon('check','icon icon-sm')} ${sp.done}/${sp.total}</span>`:'';})()}
      </div>
      ${taskLabelChips(t.labels)}
      ${t.desc?`<div class="tk-desc">${esc(t.desc).slice(0,110)}${t.desc.length>110?'…':''}</div>`:''}
    </div>
  </div>`;
}
function statusLabel(s){ return {pendiente:'Pendiente',proceso:'En proceso',hecha:'Hecha',rechazada:'Rechazada',atrasada:'Atrasada'}[s]||s||'—'; }
function cap(s){ s=(s==null?'':String(s)); return s? s.charAt(0).toUpperCase()+s.slice(1) : '—'; }

/* ----- Detalle de tarea ----- */
function taskDetail(id){
  const t=DB.tasks.find(x=>x.id===id); if(!t) return;
  if(!visibleTask(t)){ toast('Esa tarea no es tuya','err'); return; }   // candado: nadie abre tareas ajenas
  const from=userById(t.fromId);
  const assignees=t.toIds.map(i=>userById(i)).filter(Boolean);
  const amResp = t.toIds.includes(SES.userId);
  const canManage = amResp || t.fromId===SES.userId || isAdmin();

  const imgs = (t.images||[]).map(ref=>mediaTag(ref,'image','style="cursor:zoom-in" onclick="openImgFromEl(this)"')).join('');
  const logHtml = [...t.log].reverse().map(l=>{
    const u=userById(l.byId);
    return `<div class="log-item"><b>${u?esc((u.name||'').split(' ')[0]):'—'}</b> ${esc(l.text)} · ${timeAgo(l.at)}</div>`;
  }).join('');
  const comments = (t.comments||[]).filter(c=>c&&!c.deleted).map(c=>{
    const u=userById(c.byId);
    return `<div class="comment">${avatarHTML(u)}<div class="cbody"><div class="cname">${u?esc(u.name):'—'}</div>${c.text?`<div class="ctext">${esc(c.text)}</div>`:''}${c.mid?`<div class="cimg">${mediaTag(c.mid,'image','style="cursor:zoom-in" onclick="openImgFromEl(this)"')}</div>`:''}<div class="ctime">${timeAgo(c.at)}</div></div></div>`;
  }).join('');

  const canEdit = t.fromId===SES.userId || isAdmin();
  let actions='';
  if(canManage){
    if(t.status!=='hecha') actions+=`<button class="btn btn-primary" onclick="setTaskStatus('${t.id}','hecha')">${svgIcon('check','icon icon-sm')} Marcar hecha</button>`;
    if(t.status==='pendiente'||t.status==='atrasada') actions+=`<button class="btn btn-ghost" onclick="setTaskStatus('${t.id}','proceso')">${svgIcon('clock','icon icon-sm')} En proceso</button>`;
    if(amResp && t.status!=='rechazada' && t.status!=='hecha') actions+=`<button class="btn btn-ghost" onclick="rejectTask('${t.id}')">${svgIcon('x','icon icon-sm')} Rechazar</button>`;
  }
  if(canEdit){
    actions+=`<button class="btn btn-ghost" onclick="editTaskModal('${t.id}')">${svgIcon('edit','icon icon-sm')} Editar</button>`;
    actions+=`<button class="btn btn-danger" onclick="delTask('${t.id}')">${svgIcon('trash','icon icon-sm')} Eliminar</button>`;
  }
  const pr=prioMeta(t.prio); const overdue=t.status==='atrasada';
  const subs=t.subtasks||[]; const subDoneN=subs.filter(s=>s.done).length;
  const subHtml=`<div class="td-sec">Subtareas${subs.length?` <span class="td-subcount">${subDoneN}/${subs.length}</span>`:''}</div>
    <div class="td-subs">
      ${subs.map(s=>{const su=s.assigneeId?userById(s.assigneeId):null; const slate=s.due&&!s.done&&s.due<now(); return `<div class="td-sub ${s.done?'done':''} ${s.assigneeId===SES.userId?'mine':''}"><button class="sub-check ${s.done?'on':''}" ${canManage?`onclick="subToggle('${t.id}','${s.id}')"`:'disabled'}>${s.done?svgIcon('check','icon icon-sm'):''}</button><span class="sub-t" ${canManage?`onclick="subEditModal('${t.id}','${s.id}')" style="cursor:pointer"`:''}>${esc(s.title)}</span>${su?`<span class="sub-who" title="${esc(su.name)}">${avatarHTML(su)}</span>`:''}${s.due?`<span class="sub-due ${slate?'late':''}">${svgIcon('clock','icon icon-sm')} ${fmtDate(s.due)}</span>`:''}${canManage?`<button class="sub-del" title="Editar subtarea" onclick="subEditModal('${t.id}','${s.id}')">${svgIcon('edit','icon icon-sm')}</button>`:''}</div>`;}).join('')}
      ${canManage?`<div class="td-sub-add"><input class="input" id="subNew" placeholder="+ agregar subtarea" autocomplete="off" onkeydown="if(event.key==='Enter'){event.preventDefault();subAdd('${t.id}');}"><button class="chip" onclick="subAdd('${t.id}')">Agregar</button></div>`:(subs.length?'':'<div class="td-empty">Sin subtareas.</div>')}
    </div>`;

  openModal(`
    <div class="modal-head"><h3>${esc(t.title)}</h3><button class="modal-close" onclick="closeModal()">${svgIcon('x','icon')}</button></div>
    <div class="modal-body">
      <div class="td-top">
        <span class="pill ${t.status}">${statusLabel(t.status)}</span>
        <span class="td-badge"><span class="dot-prio" style="background:${pr.color}"></span>Prioridad ${pr.label}</span>
        <span class="td-badge ${overdue?'tk-due-late':''}">${svgIcon('clock','icon icon-sm')} ${fmtDateTime(t.due)}</span>
      </div>
      ${taskLabelChips(t.labels)}
      ${t.desc?`<div class="td-desc">${esc(t.desc)}</div>`:''}
      ${imgs?`<div class="img-prev">${imgs}</div>`:''}
      <div class="td-meta">
        <div class="td-mrow"><span class="td-ml">Asignada por</span><span class="td-mv">${from?esc(from.name):'—'}</span></div>
        <div class="td-mrow"><span class="td-ml">Responsables</span><span class="td-mv">${assignees.map(a=>esc(a.name.split(' ')[0])).join(', ')||'—'}</span></div>
        ${t.startDate&&t.due&&t.startDate<=t.due?`<div class="td-mrow"><span class="td-ml">Cronograma</span><span class="td-mv">${fmtDate(t.startDate)} → ${fmtDate(t.due)}</span></div>`:''}
        <div class="td-mrow"><span class="td-ml">Sucursal</span><span class="td-mv">${esc(sucName(t.sucursalId))}</span></div>
        <div class="td-mrow"><span class="td-ml">Creada</span><span class="td-mv">${fmtDate(t.createdAt)}</span></div>
      </div>
      ${actions?`<div class="td-actions">${actions}</div>`:''}
      ${subHtml}
      <div class="td-sec">Historial</div>
      <div class="log">${logHtml||'<div class="td-empty">Sin movimientos.</div>'}</div>
      <div class="td-sec">Respuestas y comentarios</div>
      <div class="td-comments">${comments||'<div class="td-empty">Sin respuestas todavía. Escribí la primera.</div>'}</div>
      <div class="tc-prev" id="tcPrev">${_tcPending?`<img src="${safeImg(_tcPending)}"><button type="button" class="tc-prev-x" title="Quitar" onclick="_tcPending=null;const p=document.getElementById('tcPrev');if(p)p.innerHTML=''">${svgIcon('x','icon icon-sm')}</button>`:''}</div>
      <div class="td-composer">
        <input type="file" id="tcFile" accept="image/*" style="display:none" onchange="tcPickImg(this)">
        <button class="chat-attach" title="Adjuntar imagen" onclick="document.getElementById('tcFile').click()">${svgIcon('clip')}</button>
        <input class="input" id="tcInput" placeholder="Escribí una respuesta…" autocomplete="off" onkeydown="if(event.key==='Enter')addTaskComment('${t.id}')">
        <button class="chat-send" title="Enviar" onclick="addTaskComment('${t.id}')">${svgIcon('send')}</button>
      </div>
    </div>`,true);
}
window.taskDetail=taskDetail;
async function delTask(id){
  const t=DB.tasks.find(x=>x.id===id); if(!t) return;
  if(!(t.fromId===SES.userId||isAdmin())){ toast('Solo quien la asignó o Administración puede eliminarla','err'); return; }
  if(!await confirmDialog(`Se elimina la tarea "${t.title}" con su historial y comentarios. No se puede deshacer.`,{title:'¿Eliminar tarea?',okText:'Sí, eliminar'})) return;
  tomb(id); DB.tasks=DB.tasks.filter(x=>x.id!==id);
  audit('tarea',`eliminó la tarea "${t.title}"`,t.sucursalId);
  closeModal(); save(); render(); undoDelete('tasks', t, t.title);
}
window.delTask=delTask;

function setTaskStatus(id,status){
  const t=DB.tasks.find(x=>x.id===id); if(!t) return;
  t.status=status;
  const lbl = status==='hecha'?'marcó la tarea como HECHA':status==='proceso'?'puso la tarea en proceso':'cambió el estado a '+status;
  t.log.push({at:now(),byId:SES.userId,text:lbl});
  audit('tarea',`${lbl}: "${t.title}"`,t.sucursalId);
  if(status==='hecha') notify([t.fromId], `${me().name.split(' ')[0]} completó "${t.title}"`, '✅', {view:'tareas'});
  toast(status==='hecha'?'Listo, tarea completada ✅':'Estado actualizado','ok');
  save(); taskDetail(id); render();
}
window.setTaskStatus=setTaskStatus;

/* ----- Tablero Kanban (estilo Asana): columnas por estado, arrastrar tarjetas ----- */
function taskCanManage(t){ return (t.toIds||[]).includes(SES.userId) || t.fromId===SES.userId || isAdmin(); }
function taskBoard(tasks){
  const cols=[
    {label:'Por hacer', statuses:['pendiente','atrasada'], target:'pendiente', dot:'var(--text-soft)'},
    {label:'En proceso', statuses:['proceso'], target:'proceso', dot:'var(--info)'},
    {label:'Hecho', statuses:['hecha'], target:'hecha', dot:'var(--success)'},
  ];
  return `<div class="kb-board">${cols.map(c=>{
    const items=tasks.filter(t=>c.statuses.includes(t.status)).sort((a,b)=>((a.ord==null?1e9:a.ord)-(b.ord==null?1e9:b.ord))||((a.due||9e15)-(b.due||9e15)));
    return `<div class="kb-col" ondragover="kbOver(event)" ondragleave="kbLeave(event)" ondrop="kbDrop(event,'${c.target}')">
      <div class="kb-col-head"><span class="kb-dot" style="background:${c.dot}"></span>${c.label}<span class="kb-count">${items.length}</span></div>
      <div class="kb-list">${items.map(taskCard).join('')||'<div class="kb-empty">Sin tareas</div>'}</div>
      <button class="kb-add" onclick="newTaskModal('${c.target}')">${svgIcon('plus','icon icon-sm')} Agregar tarea</button>
    </div>`;
  }).join('')}</div>`;
}
/* ----- Cronograma (línea de tiempo estilo Asana) ----- */
let tlCursor='';
function tlNav(d){ if(!tlCursor) tlCursor=isoLocal(horMondayOf(new Date())); const m=new Date(tlCursor+'T00:00:00'); m.setDate(m.getDate()+d*7); tlCursor=isoLocal(m); render(); }
function tlToday(){ tlCursor=isoLocal(horMondayOf(new Date())); render(); }
window.tlNav=tlNav; window.tlToday=tlToday;
function taskTimeline(tasks){
  const DAYW=42, DAYS=21;                       // ventana de 3 semanas
  if(!tlCursor) tlCursor=isoLocal(horMondayOf(new Date()));
  const start=new Date(tlCursor+'T00:00:00'); start.setHours(0,0,0,0);
  const winStart=start.getTime();
  const days=[...Array(DAYS)].map((_,i)=>{ const d=new Date(start); d.setDate(start.getDate()+i); return d; });
  const winEnd=(()=>{ const e=new Date(start); e.setDate(start.getDate()+DAYS); return e.getTime(); })();
  const dayIdx=ts=>{ const d=new Date(ts); d.setHours(0,0,0,0); return Math.round((d.getTime()-winStart)/864e5); };
  const todayIdx=(()=>{ const t=new Date(); t.setHours(0,0,0,0); return Math.round((t.getTime()-winStart)/864e5); })();
  const lastLbl=new Date(winEnd-864e5).toLocaleDateString('es-CR',{day:'numeric',month:'short'});
  const rangeLbl=start.toLocaleDateString('es-CR',{day:'numeric',month:'short'})+' – '+lastLbl;
  let html=`<div class="gantt-nav">
    <button class="icon-btn gantt-navb" onclick="tlNav(-1)">${svgIcon('back','icon icon-sm')}</button>
    <b class="gantt-lbl">${esc(rangeLbl)}</b>
    <button class="icon-btn gantt-navb" onclick="tlNav(1)"><svg class="icon icon-sm" viewBox="0 0 24 24" style="transform:scaleX(-1)"><use href="#i-back"/></svg></button>
    <button class="chip" onclick="tlToday()">Hoy</button></div>`;
  const rows=tasks.filter(t=>t.due).map(t=>{
      const s=(t.startDate && t.startDate<=t.due)?t.startDate:t.due;
      return {t, s, e:t.due, pt:!(t.startDate && t.startDate<=t.due)};
    }).filter(r=> dayIdx(r.e)>=0 && dayIdx(r.s)<DAYS )
    .sort((a,b)=> a.s-b.s || a.e-b.e);
  if(!rows.length){
    html+=emptyState('🗓️','Nada en este rango','Ponele <b>Inicio</b> y <b>entrega</b> a las tareas para verlas como barras en el cronograma. Movete con las flechas para ver otras semanas.','','');
    return html;
  }
  const dayHead=days.map((d,i)=>{ const wd=['L','M','X','J','V','S','D'][(d.getDay()+6)%7]; const we=(d.getDay()===0||d.getDay()===6); return `<div class="gantt-dh ${i===todayIdx?'today':''} ${we?'we':''}">${wd}<span>${d.getDate()}</span></div>`; }).join('');
  const body=rows.map(r=>{
    const t=r.t; const done=t.status==='hecha'; const late=t.status==='atrasada';
    const si=Math.max(0,dayIdx(r.s)), ei=Math.min(DAYS-1,dayIdx(r.e));
    const contL=dayIdx(r.s)<0, contR=dayIdx(r.e)>DAYS-1;
    const left=si*DAYW+3, width=Math.max(24,(ei-si+1)*DAYW-6);
    const col=done?'#8a8f98':late?'var(--danger)':prioMeta(t.prio).color;
    const u=(t.toIds||[]).map(i=>userById(i)).filter(Boolean)[0];
    const barTxt=r.pt?fmtDate(t.due):esc(t.title);
    return `<div class="gantt-row">
      <div class="gantt-name" onclick="taskDetail('${t.id}')">${u?avatarHTML(u):''}<span class="gantt-nt ${done?'done':''}">${esc(t.title)}</span></div>
      <div class="gantt-track" style="width:${DAYS*DAYW}px">
        ${todayIdx>=0&&todayIdx<DAYS?`<div class="gantt-today" style="left:${todayIdx*DAYW}px"></div>`:''}
        <div class="gantt-bar ${done?'done':''} ${late?'late':''} ${contL?'contl':''} ${contR?'contr':''}" style="left:${left}px;width:${width}px;--c:${col}" onclick="taskDetail('${t.id}')" title="${esc(t.title)}">${barTxt}</div>
      </div></div>`;
  }).join('');
  html+=`<div class="gantt-wrap"><div class="gantt" style="--namew:150px">
    <div class="gantt-head"><div class="gantt-hname">Tarea</div><div class="gantt-days" style="width:${DAYS*DAYW}px">${dayHead}</div></div>
    <div class="gantt-body">${body}</div>
  </div></div>`;
  return html;
}
function taskCard(t){
  const pr=prioMeta(t.prio); const overdue=t.status==='atrasada'; const done=t.status==='hecha';
  const canM=taskCanManage(t);
  const assignees=(t.toIds||[]).map(i=>userById(i)).filter(Boolean);
  const avs=assignees.slice(0,3).map(u=>`<span class="tk-av">${avatarHTML(u)}</span>`).join('')+(assignees.length>3?`<span class="tk-av more">+${assignees.length-3}</span>`:'');
  const check = canM
    ? `<button class="kb-check ${done?'on':''}" title="${done?'Marcar por hacer':'Marcar hecha'}" onclick="event.stopPropagation();boardMove('${t.id}','${done?'pendiente':'hecha'}')">${done?svgIcon('check','icon icon-sm'):''}</button>`
    : `<span class="kb-check ${done?'on':''}">${done?svgIcon('check','icon icon-sm'):''}</span>`;
  const sp=subProgress(t);
  return `<div class="kb-card ${done?'done':''} ${overdue?'late':''}" style="--pc:${pr.color}" draggable="${canM?'true':'false'}" ondragstart="kbDragStart(event,'${t.id}')" ondragend="kbDragEnd(event)" ondragover="kbCardOver(event)" ondragleave="kbCardLeave(event)" ondrop="kbCardDrop(event,'${t.id}')" onclick="taskDetail('${t.id}')">
    <div class="kb-card-top">${check}<div class="kb-title ${done?'done':''}">${esc(t.title)}${t.images&&t.images.length?' '+svgIcon('clip','icon icon-sm'):''}</div></div>
    ${taskLabelChips(t.labels)}
    <div class="kb-meta"><span class="kb-prio"><span class="dot-prio" style="background:${pr.color}"></span>${pr.label}</span><span class="${overdue?'tk-due-late':''}">${svgIcon('clock','icon icon-sm')} ${fmtDate(t.due)}</span>${sp?`<span class="kb-sub">${svgIcon('check','icon icon-sm')} ${sp.done}/${sp.total}</span>`:''}</div>
    <div class="kb-foot"><span class="tk-avs">${avs||''}</span><span class="kb-suc">${svgIcon('pin','icon icon-sm')} ${esc(sucName(t.sucursalId))}</span></div>
  </div>`;
}
function boardMove(id,status){
  const t=DB.tasks.find(x=>x.id===id); if(!t) return;
  if(!taskCanManage(t)){ toast('Solo quien la hace, quien la asignó o Gerencia puede moverla','err'); return; }
  if(t.status===status) return;
  t.status=status; t.updatedAt=now(); t.log=t.log||[];
  const lbl = status==='hecha'?'marcó la tarea como HECHA':status==='proceso'?'puso la tarea en proceso':'movió la tarea a Por hacer';
  t.log.push({at:now(),byId:SES.userId,text:lbl});
  audit('tarea',`${lbl}: "${t.title}"`,t.sucursalId);
  if(status==='hecha') notify([t.fromId], `${me().name.split(' ')[0]} completó "${t.title}"`, '✅', {view:'tareas'});
  save(); render();
}
let _kbDrag=null;
function kbDragStart(e,id){ _kbDrag=id; try{ e.dataTransfer.effectAllowed='move'; e.dataTransfer.setData('text/plain',id); }catch(_){}; try{ e.currentTarget.classList.add('dragging'); }catch(_){} }
function kbDragEnd(e){ _kbDrag=null; try{ e.currentTarget.classList.remove('dragging'); }catch(_){}; document.querySelectorAll('.kb-col.over').forEach(c=>c.classList.remove('over')); }
function kbOver(e){ e.preventDefault(); try{ e.dataTransfer.dropEffect='move'; }catch(_){}; e.currentTarget.classList.add('over'); }
function kbLeave(e){ if(e.currentTarget===e.target) e.currentTarget.classList.remove('over'); }
function kbDrop(e,status){ e.preventDefault(); e.currentTarget.classList.remove('over'); const id=_kbDrag||(e.dataTransfer&&e.dataTransfer.getData('text/plain')); _kbDrag=null; if(id) boardMove(id,status); }
window.boardMove=boardMove; window.kbDragStart=kbDragStart; window.kbDragEnd=kbDragEnd; window.kbOver=kbOver; window.kbLeave=kbLeave; window.kbDrop=kbDrop;

async function rejectTask(id){
  const t=DB.tasks.find(x=>x.id===id); if(!t) return;
  const reason = prompt('¿Por qué rechazás esta tarea? (queda registrado)');
  if(reason===null) return;
  t.status='rechazada';
  t.log.push({at:now(),byId:SES.userId,text:'RECHAZÓ la tarea'+(reason?': '+reason:'')});
  audit('tarea',`rechazó "${t.title}"${reason?': '+reason:''}`,t.sucursalId);
  notify([t.fromId], `${me().name.split(' ')[0]} rechazó "${t.title}"`, '✋', {view:'tareas'});
  toast('Tarea rechazada. Quedó registrado quién y por qué.');
  save(); taskDetail(id); render();
}
window.rejectTask=rejectTask;

let _tcPending=null;
async function tcPickImg(input){
  const f=input.files&&input.files[0]; if(!f) return;
  const arr=await readImages([f]); _tcPending=(arr&&arr[0])||null;
  const p=$('#tcPrev'); if(p&&_tcPending) p.innerHTML=`<img src="${safeImg(_tcPending)}"><button type="button" class="tc-prev-x" title="Quitar" onclick="_tcPending=null;const q=document.getElementById('tcPrev');if(q)q.innerHTML=''">${svgIcon('x','icon icon-sm')}</button>`;
}
window.tcPickImg=tcPickImg;
async function addTaskComment(id){
  const t=DB.tasks.find(x=>x.id===id); if(!t) return;
  const inp=$('#tcInput'); const txt=inp?inp.value.trim():''; if(!txt && !_tcPending) return;
  const c={id:uid(),byId:SES.userId,text:txt,at:now()};
  if(_tcPending){ try{ c.mid=await putMedia(_tcPending); }catch(_){}; _tcPending=null; }
  t.comments.push(c);
  t.log.push({at:now(),byId:SES.userId,text:'comentó'});
  notify(t.toIds.concat(t.fromId), `${me().name.split(' ')[0]} comentó en "${t.title}"`, '💬', {view:'tareas'});
  save(); taskDetail(id);
}
window.addTaskComment=addTaskComment;

/* ----- Nueva / editar tarea ----- */
let newImgs=[];
function toDatetimeLocal(ts){ const d=new Date(ts); d.setMinutes(d.getMinutes()-d.getTimezoneOffset()); return d.toISOString().slice(0,16); }
function sucOptionsSel(selId){ return DB.sucursales.map(s=>`<option value="${s.id}" ${s.id===selId?'selected':''}>${esc(s.name)}</option>`).join(''); }
function taskPrioSeg(sel){
  const opts=[['alta','Alta','var(--danger)'],['media','Media','var(--warn)'],['baja','Baja','var(--text-dim)']];
  return `<input type="hidden" id="ntPrio" value="${sel}"><div class="prio-seg">`+opts.map(([k,l,c])=>`<button type="button" class="prio-b ${sel===k?'on':''}" data-p="${k}" onclick="setNtPrio('${k}')"><span class="dot-prio" style="background:${c}"></span>${l}</button>`).join('')+`</div>`;
}
function setNtPrio(p){ const h=$('#ntPrio'); if(h)h.value=p; document.querySelectorAll('.prio-b').forEach(b=>b.classList.toggle('on',b.dataset.p===p)); }
function dueParts(ts){
  const d=new Date(ts);
  return { iso:`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`,
    hhmm:`${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}` };
}
function ntDuePreset(spec){
  const d=new Date();
  if(spec==='today'){ d.setHours(18,0,0,0); }
  else if(spec==='tomorrow'){ d.setDate(d.getDate()+1); d.setHours(12,0,0,0); }
  else if(spec==='3d'){ d.setDate(d.getDate()+3); d.setHours(12,0,0,0); }
  else if(spec==='week'){ d.setDate(d.getDate()+7); d.setHours(12,0,0,0); }
  const p=dueParts(d.getTime());
  pickDate(p.iso,'nt'); setTP('ntT',p.hhmm);
}
window.setNtPrio=setNtPrio; window.ntDuePreset=ntDuePreset;
function taskFormBody(t){
  const people=assignablePeople();
  const sel = t? (t.toIds||[]) : [];
  let dueTs;
  if(t&&t.due) dueTs=t.due;
  else { const b=new Date(now()+86400e3); b.setHours(12,0,0,0); dueTs=b.getTime(); }
  const dp=dueParts(dueTs);
  return `
    <div class="field"><label>Título</label><input class="input" id="ntTitle" value="${t?esc(t.title):''}" placeholder="Ej: Preparar salsas del día" autocomplete="off"></div>
    <div class="field"><label>Detalle / instrucciones</label><textarea class="textarea" id="ntDesc" placeholder="Explicá qué hay que hacer…">${t?esc(t.desc||''):''}</textarea></div>
    <div class="field"><label>Etiquetas</label>${taskLabelPickerHTML()}</div>
    <div class="ip-sec">${svgIcon('users','icon icon-sm')} ¿A quién se la asignás?</div>
    ${peoplePicker('ntPeople', people, sel)}
    <div class="ip-sec">${svgIcon('clock','icon icon-sm')} Prioridad y fecha</div>
    <div class="field"><label>Prioridad</label>${taskPrioSeg(t?t.prio:'media')}</div>
    <div class="field"><label>Inicio <span class="lbl-soft">(opcional · para el cronograma)</span></label><input class="input" type="date" id="ntStart" value="${t&&t.startDate?isoLocal(new Date(t.startDate)):''}"></div>
    <div class="field"><label>¿Para cuándo? <span class="lbl-soft">(entrega)</span></label>
      <div class="due-presets"><button type="button" class="chip" onclick="ntDuePreset('today')">Hoy</button><button type="button" class="chip" onclick="ntDuePreset('tomorrow')">Mañana</button><button type="button" class="chip" onclick="ntDuePreset('3d')">En 3 días</button><button type="button" class="chip" onclick="ntDuePreset('week')">En 1 semana</button></div>
    </div>
    <div class="row2 rv-when">
      <div class="field"><label>Fecha</label>${dateField(dp.iso,'nt')}</div>
      <div class="field"><label>Hora</label>${timePicker('ntT',dp.hhmm,'')}</div>
    </div>
    <div class="field"><label>Sucursal</label><select class="select" id="ntSuc">${t?sucOptionsSel(t.sucursalId):sucOptionsFor()}</select></div>`;
}
function newTaskModal(status){
  newImgs=[]; _taskFormLabels=[];
  _boardAddStatus = (status==='proceso'||status==='hecha') ? status : null;   // desde el tablero: crear directo en esa columna
  openModal(`
    <div class="modal-head"><h3>${svgIcon('check','icon')} Nueva tarea${_boardAddStatus?` <span class="pill ${_boardAddStatus}" style="font-size:11px">${statusLabel(_boardAddStatus)}</span>`:''}</h3><button class="modal-close" onclick="closeModal()">${svgIcon('x','icon')}</button></div>
    <div class="modal-body">
      ${taskFormBody(null)}
      <div class="field"><label>Fotos / notas (opcional)</label>
        <input type="file" id="ntImg" accept="image/*" multiple onchange="pickImgs(this)">
        <div class="img-prev" id="ntImgPrev"></div>
      </div>
    </div>
    <div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">Cancelar</button><button class="btn btn-primary" onclick="createTask()">${svgIcon('check','icon icon-sm')} Crear tarea</button></div>`, true);
}
window.newTaskModal=newTaskModal;
function editTaskModal(id){
  const t=DB.tasks.find(x=>x.id===id); if(!t) return;
  if(!(t.fromId===SES.userId||isAdmin())){ toast('Solo quien la asignó puede editarla','err'); return; }
  _taskFormLabels=[...(t.labels||[])];
  openModal(`
    <div class="modal-head"><h3>${svgIcon('edit','icon')} Editar tarea</h3><button class="modal-close" onclick="closeModal()">${svgIcon('x','icon')}</button></div>
    <div class="modal-body">${taskFormBody(t)}</div>
    <div class="modal-foot"><button class="btn btn-ghost" onclick="taskDetail('${t.id}')">Cancelar</button><button class="btn btn-primary" onclick="saveTaskEdit('${t.id}')">${svgIcon('check','icon icon-sm')} Guardar cambios</button></div>`, true);
}
window.editTaskModal=editTaskModal;

async function pickImgs(input){
  newImgs = await readImages(input.files);
  $('#ntImgPrev').innerHTML = newImgs.map(s=>`<img src="${safeImg(s)}">`).join('');
}
window.pickImgs=pickImgs;

function readTaskForm(){
  const title=$('#ntTitle').value.trim();
  if(!title){ toast('Ponele un título a la tarea','err'); return null; }
  const toIds=pickedIds('ntPeople');
  if(!toIds.length){ toast('Elegí al menos a una persona','err'); return null; }
  const dStr=$('#ntDate')?$('#ntDate').value:'';
  const tStr=$('#ntTH')?readTP('ntT'):'12:00';
  const due = dStr? new Date(dStr+'T'+(tStr||'12:00')).getTime() : null;
  const sStr=$('#ntStart')?$('#ntStart').value:'';
  let startDate = sStr? new Date(sStr+'T08:00').getTime() : null;
  if(startDate && due && startDate>due) startDate=null;   // inicio inválido (después de la entrega) → se ignora
  return { title, desc:$('#ntDesc').value.trim(), toIds, sucursalId:$('#ntSuc').value,
    prio:($('#ntPrio')?$('#ntPrio').value:'media'), due, startDate, labels:[..._taskFormLabels] };
}
async function createTask(){
  const d=readTaskForm(); if(!d) return;
  const images = await Promise.all((newImgs||[]).map(putMedia));   // subir fotos al nodo aparte, guardar solo ids
  const t={ id:uid(), ...d, fromId:SES.userId, status:'pendiente', images, createdAt:now(), comments:[],
    log:[{at:now(),byId:SES.userId,text:'creó la tarea'}] };
  if(_boardAddStatus){ t.status=_boardAddStatus; t.log.push({at:now(),byId:SES.userId,text:'creada en '+statusLabel(_boardAddStatus)}); _boardAddStatus=null; }
  DB.tasks.unshift(t);
  audit('tarea',`creó "${d.title}" → ${d.toIds.map(i=>userById(i)?.name.split(' ')[0]).join(', ')}`,t.sucursalId);
  notify(d.toIds, `${me().name.split(' ')[0]} te asignó: "${d.title}"`, '✅', {view:'tareas'});
  closeModal(); toast('Tarea creada y notificada ✅','ok'); save(); render();
}
window.createTask=createTask;
function saveTaskEdit(id){
  const t=DB.tasks.find(x=>x.id===id); if(!t) return;
  if(!(t.fromId===SES.userId||isAdmin())){ toast('Solo quien la asignó puede editarla','err'); return; }
  const d=readTaskForm(); if(!d) return;
  Object.assign(t, d);
  if(t.status==='atrasada' && t.due && t.due>now()) t.status='pendiente';
  t.log.push({at:now(),byId:SES.userId,text:'editó la tarea'});
  audit('tarea',`editó "${d.title}"`,t.sucursalId);
  notify(d.toIds.filter(i=>i!==SES.userId), `${me().name.split(' ')[0]} actualizó la tarea "${d.title}"`, 'check', {view:'tareas'});
  closeModal(); toast('Tarea actualizada','ok'); save(); render();
}
window.saveTaskEdit=saveTaskEdit;

/* helpers de asignación / sucursal */
/* Personas visibles según mi sucursal: si soy de una sede veo esa + los globales (de "ambos lados");
   si soy global/gerencia veo a todos; admin respeta el filtro de sucursal de arriba. */
function scopedPeople(excludeSelf){
  return DB.users.filter(u=> u.active && inScope(u.sucursalId) && (!excludeSelf || u.id!==SES.userId));
}
function assignablePeople(){ return scopedPeople(true); }
/* Selector de personas reutilizable (avatar · nombre · puesto · check + buscador).
   Se puede agrupar por DEPARTAMENTO (área) o por SUCURSAL, con un toggle arriba. */
const _ppStore={};   // gridId -> {people, opts}: para re-armar la grilla al cambiar de agrupación
function _ppCards(people, opts, mode, selected){
  opts=opts||{}; selected=selected||[];
  const sucRank = id => id==='all' ? -1 : (DB.sucursales.findIndex(s=>s.id===id)<0 ? 999 : DB.sucursales.findIndex(s=>s.id===id));
  const sorted = people.slice().sort(mode==='suc'
    ? (a,b)=> (sucRank(a.sucursalId)-sucRank(b.sucursalId)) || (deptRank(a.role)-deptRank(b.role)) || ((a.name||'').localeCompare(b.name||''))
    : byDept);
  let cards='', lastG=null;
  sorted.forEach(u=>{
    const gKey = mode==='suc' ? (u.sucursalId||'') : deptRank(u.role);
    if(gKey!==lastG){ lastG=gKey;
      const gLabel = mode==='suc' ? (u.sucursalId==='all'?'Todas las sucursales':sucName(u.sucursalId)) : deptLabel(u.role);
      cards+=`<div class="pp-group">${esc(gLabel)}</div>`;
    }
    const sd=esc((((u.name||'')+' '+(roleInfo(u.role).short||''))).toLowerCase());
    const on=(!opts.single && selected.includes(u.id))?' on':'';
    const click=opts.single?`${opts.single}('${u.id}')`:`this.classList.toggle('on')`;
    cards+=`<button type="button" class="pp${on}" data-id="${u.id}" data-s="${sd}" onclick="${click}">
      ${avatarHTML(u)}<span class="pp-tx"><span class="pp-nm">${esc(u.name||'')}</span><span class="pp-rl">${esc(roleInfo(u.role).short||'')}</span></span>${opts.single?svgIcon('chevron','icon icon-sm'):`<span class="pp-ck">${svgIcon('check','icon icon-sm')}</span>`}</button>`;
  });
  if(!sorted.length) cards='<div class="td-empty" style="grid-column:1/-1">No hay personas disponibles.</div>';
  return cards;
}
function peoplePicker(gridId, people, selected, opts){
  opts=opts||{}; selected=selected||[];
  _ppStore[gridId]={people, opts};
  const cards=_ppCards(people, opts, 'dept', selected);
  // ofrecé "por sucursal" si el equipo en alcance abarca 2+ sucursales (incluye "global"), aunque la lista actual excluya a alguien
  const showToggle = (DB.sucursales||[]).length>1 || new Set((DB.users||[]).filter(u=>u&&u.active&&inScope(u.sucursalId)).map(u=>u.sucursalId||'')).size>1;
  const toggle = showToggle ? `<div class="pp-modes">
      <button type="button" class="pp-mode on" data-m="dept" onclick="ppickGroup('${gridId}','dept')">Por área</button>
      <button type="button" class="pp-mode" data-m="suc" onclick="ppickGroup('${gridId}','suc')">Por sucursal</button>
    </div>` : '';
  return `<div class="ppick">
    ${toggle}
    <div class="ppick-search">${svgIcon('search','icon icon-sm')}<input type="text" placeholder="Buscar persona o puesto…" oninput="ppickFilter('${gridId}',this.value)" autocomplete="off"></div>
    <div class="ppick-grid" id="${gridId}">${cards}</div>
  </div>`;
}
function ppickGroup(gridId, mode){
  const st=_ppStore[gridId]; const grid=document.getElementById(gridId); if(!st||!grid) return;
  const sel=[...grid.querySelectorAll('.pp.on')].map(b=>b.dataset.id);   // conservar la selección actual
  grid.innerHTML=_ppCards(st.people, st.opts, mode, sel);
  const wrap=grid.closest('.ppick');
  if(wrap){ wrap.querySelectorAll('.pp-mode').forEach(b=>b.classList.toggle('on', b.dataset.m===mode));
    const inp=wrap.querySelector('.ppick-search input'); if(inp&&inp.value) ppickFilter(gridId, inp.value); }   // re-aplicar el buscador
}
window.ppickGroup=ppickGroup;
function ppickFilter(gridId,q){ q=(q||'').toLowerCase().trim();
  document.querySelectorAll('#'+gridId+' .pp').forEach(b=>{ b.style.display=(!q||(b.dataset.s||'').includes(q))?'':'none'; });
  document.querySelectorAll('#'+gridId+' .pp-group').forEach(h=>{ h.style.display=q?'none':''; });
}
function pickedIds(gridId){ return [...document.querySelectorAll('#'+gridId+' .pp.on')].map(b=>b.dataset.id); }
window.ppickFilter=ppickFilter;
function sucOptionsFor(){
  const mine = isAdmin()? (SES.sucFilter!=='all'?SES.sucFilter:DB.sucursales[0].id) : me().sucursalId;
  const base = me().sucursalId==='all'?mine:me().sucursalId;
  return DB.sucursales.map(s=>`<option value="${s.id}" ${s.id===base?'selected':''}>${esc(s.name)}</option>`).join('');
}

/* =====================================================================
   VISTA: PEDIDOS / PROVEEDURÍA
   ===================================================================== */
let pedFilter='activos', pedSearch='';
function viewPedidos(){
  const all=(DB.pedidos||[]).filter(p=> p && visiblePedido(p) && (inScope(p.sucursalId) || p.fromId===SES.userId || pedAreaMine(p.area)));
  let list=[...all];
  if(pedFilter==='activos') list=list.filter(p=>p.status==='pendiente'||p.status==='proceso');
  else if(pedFilter==='mios') list=list.filter(p=>p.fromId===SES.userId);
  else if(pedFilter==='ami') list=list.filter(p=>pedAreaMine(p.area));
  else if(pedFilter!=='todos') list=list.filter(p=>p.status===pedFilter);
  if(pedSearch){ const q=pedSearch.toLowerCase(); list=list.filter(p=>(p.item||'').toLowerCase().includes(q)||(p.desc||'').toLowerCase().includes(q)); }
  list.sort((a,b)=>b.createdAt-a.createdAt);

  const guide = sectionGuide('pedidos','¿Para qué sirve Pedidos?',`
    Es para <b>pedir cosas internamente</b> a un área: a Proveeduría (insumos), a Contabilidad (pagos/facturas) o a Recursos (permisos, adelantos).
    <ul style="margin:8px 0 0 18px">
      <li>El cocinero pide tomates a Proveeduría.</li>
      <li>Se ve el <b>proceso</b>: pendiente → en proceso → entregado.</li>
      <li>Quien pidió (o Administración) puede <b>editar o eliminar</b> el pedido.</li>
    </ul>`);

  const activos=all.filter(p=>p.status==='pendiente'||p.status==='proceso').length;
  const aMiArea=all.filter(p=>pedAreaMine(p.area)&&(p.status==='pendiente'||p.status==='proceso')).length;
  const entregados=all.filter(p=>p.status==='entregado').length;
  const mios=all.filter(p=>p.fromId===SES.userId).length;

  const chips=[['activos','Activos'],['mios','Yo pedí'],['ami','A mi área'],['entregado','Entregados'],['todos','Todos']]
    .map(([k,l])=>`<button class="chip ${pedFilter===k?'on':''}" onclick="setPedFilter('${k}')">${l}</button>`).join('');

  let html=`<div class="page-head"><div><div class="page-title">Pedidos</div><div class="page-sub">Solicitudes a Proveeduría, Contabilidad y Recursos</div></div>
    <div class="ph-spacer"></div><button class="btn btn-primary" style="flex:0 0 auto" onclick="newPedidoModal()">${svgIcon('plus','icon icon-sm')} Pedir algo</button></div>`;
  html+=guide;
  html+=`<div class="kpi-row">
    <div class="kpi" onclick="setPedFilter('activos')" style="cursor:pointer"><div class="label">Activos</div><div class="value">${activos}</div><div class="sub">en curso</div></div>
    <div class="kpi ${aMiArea?'warn':''}" onclick="setPedFilter('ami')" style="cursor:pointer"><div class="label">A mi área</div><div class="value">${aMiArea}</div><div class="sub">por atender</div></div>
    <div class="kpi" onclick="setPedFilter('mios')" style="cursor:pointer"><div class="label">Yo pedí</div><div class="value">${mios}</div><div class="sub">en total</div></div>
    <div class="kpi ok" onclick="setPedFilter('entregado')" style="cursor:pointer"><div class="label">Entregados</div><div class="value">${entregados}</div><div class="sub">completados</div></div>
  </div>`;
  html+=`<div class="toolbar"><input class="input search" placeholder="Buscar pedido…" value="${esc(pedSearch)}" oninput="pedSearch=this.value;clearTimeout(window._ps);window._ps=setTimeout(render,250)"></div><div class="chipscroll">${chips}</div>`;
  html+= list.length? list.map(pedidoRow).join('')
    : emptyState('📦','No hay pedidos', pedSearch?'No hay pedidos que coincidan con la búsqueda.':'Cuando pidás algo a un área aparece acá con su estado.','+ Pedir algo','newPedidoModal()');
  return html;
}
function visiblePedido(p){
  if(isAdmin()) return true;
  return p.fromId===SES.userId || pedAreaMine(p.area);
}
window.setPedFilter=k=>{pedFilter=k;render();};

function pedStatusCls(s){ return s==='entregado'?'hecha':s==='proceso'?'proceso':s==='rechazado'?'rechazada':'pendiente'; }
function pedStatusLabel(s){ return ({pendiente:'Pendiente',proceso:'En proceso',entregado:'Entregado',rechazado:'Rechazado'})[s]||s; }
function urgMeta(u){ return u==='alta'?{label:'Alta',color:'var(--danger)'}:u==='baja'?{label:'Baja',color:'var(--text-dim)'}:{label:'Media',color:'var(--warn)'}; }
function pedAreaIcon(area){ return area==='proveeduria'?'box':area==='contabilidad'?'clipboard':area==='rrhh'?'users':'box'; }
function pedidoRow(p){
  const from=userById(p.fromId);
  const info=pedInfo(p.area);
  const urg=urgMeta(p.urgencia);
  return `<div class="tk tk-prio-${p.urgencia}" onclick="pedidoDetail('${p.id}')">
    <div class="tk-bar"></div>
    <div class="tk-main">
      <div class="tk-row1"><div class="tk-title">${esc(p.item)} ${p.qty>1?`<span class="tk-qty">×${p.qty}</span>`:''}</div><span class="pill ${pedStatusCls(p.status)}">${pedStatusLabel(p.status)}</span></div>
      <div class="tk-meta">
        <span class="ped-area-chip">${svgIcon(pedAreaIcon(p.area),'icon icon-sm')} ${info.short}</span>
        <span><span class="dot-prio" style="background:${urg.color}"></span>${urg.label}</span>
        <span>${svgIcon('user','icon icon-sm')} ${from?esc(from.name.split(' ')[0]):'—'}</span>
        <span>${svgIcon('pin','icon icon-sm')} ${esc(sucName(p.sucursalId))}</span>
      </div>
      ${p.desc?`<div class="tk-desc">${esc(p.desc).slice(0,110)}${p.desc.length>110?'…':''}</div>`:''}
    </div>
  </div>`;
}

function pedidoDetail(id){
  const p=DB.pedidos.find(x=>x.id===id); if(!p) return;
  const from=userById(p.fromId);
  const info=pedInfo(p.area);
  const urg=urgMeta(p.urgencia);
  const canManage = pedAreaMine(p.area) || isAdmin();
  const canEditPed = p.fromId===SES.userId || isAdmin();
  const logHtml=[...p.log].reverse().map(l=>{const u=userById(l.byId);return `<div class="log-item"><b>${u?esc((u.name||'').split(' ')[0]):'—'}</b> ${esc(l.text)} · ${timeAgo(l.at)}</div>`;}).join('');
  const comments=(p.comments||[]).filter(c=>c&&!c.deleted).map(c=>{const u=userById(c.byId);return `<div class="comment">${avatarHTML(u)}<div class="cbody"><div class="cname">${u?esc(u.name):''}</div><div class="ctext">${esc(c.text)}</div><div class="ctime">${timeAgo(c.at)}</div></div></div>`;}).join('');
  const prodRow = p.productId?(()=>{const pr=DB.inventory.find(x=>x.id===p.productId);return `<div class="td-mrow"><span class="td-ml">Producto ligado</span><span class="td-mv">${pr?esc(pr.name)+' · '+pr.stock+' '+pr.unit:'(eliminado)'}</span></div>`;})():'';
  let actions='';
  if(canManage && p.status!=='entregado' && p.status!=='rechazado'){
    if(p.status==='pendiente') actions+=`<button class="btn btn-ghost" onclick="setPedStatus('${p.id}','proceso')">${svgIcon('clock','icon icon-sm')} Tomarlo</button>`;
    actions+=`<button class="btn btn-primary" onclick="setPedStatus('${p.id}','entregado')">${svgIcon('check','icon icon-sm')} Entregado</button>`;
    actions+=`<button class="btn btn-ghost" onclick="setPedStatus('${p.id}','rechazado')">${svgIcon('x','icon icon-sm')} No se puede</button>`;
  }
  if(canEditPed){
    if(p.status!=='entregado') actions+=`<button class="btn btn-ghost" onclick="editPedidoModal('${p.id}')">${svgIcon('edit','icon icon-sm')} Editar</button>`;
    actions+=`<button class="btn btn-danger" onclick="delPedido('${p.id}')">${svgIcon('trash','icon icon-sm')} Eliminar</button>`;
  }
  openModal(`
    <div class="modal-head"><h3>${esc(p.item)}${p.qty>1?` <span class="tk-qty">×${p.qty}</span>`:''}</h3><button class="modal-close" onclick="closeModal()">${svgIcon('x','icon')}</button></div>
    <div class="modal-body">
      <div class="td-top">
        <span class="pill ${pedStatusCls(p.status)}">${pedStatusLabel(p.status)}</span>
        <span class="td-badge"><span class="dot-prio" style="background:${urg.color}"></span>Urgencia ${urg.label}</span>
        <span class="td-badge">${svgIcon(pedAreaIcon(p.area),'icon icon-sm')} ${info.short}</span>
      </div>
      ${p.desc?`<div class="td-desc">${esc(p.desc)}</div>`:''}
      <div class="td-meta">
        <div class="td-mrow"><span class="td-ml">Cantidad</span><span class="td-mv">${p.qty}</span></div>
        <div class="td-mrow"><span class="td-ml">Área</span><span class="td-mv">${info.short}</span></div>
        <div class="td-mrow"><span class="td-ml">Pedido por</span><span class="td-mv">${from?esc(from.name):'—'}</span></div>
        <div class="td-mrow"><span class="td-ml">Sucursal</span><span class="td-mv">${esc(sucName(p.sucursalId))}</span></div>
        ${prodRow}
        <div class="td-mrow"><span class="td-ml">Creado</span><span class="td-mv">${fmtDateTime(p.createdAt)}</span></div>
      </div>
      ${actions?`<div class="td-actions">${actions}</div>`:''}
      <div class="td-sec">Historial</div>
      <div class="log">${logHtml||'<div class="td-empty">Sin movimientos.</div>'}</div>
      <div class="td-sec">Respuestas y comentarios</div>
      <div class="td-comments">${comments||'<div class="td-empty">Sin respuestas todavía.</div>'}</div>
      <div class="td-composer">
        <input class="input" id="pcInput" placeholder="Escribí una respuesta…" autocomplete="off" onkeydown="if(event.key==='Enter')addPedComment('${p.id}')">
        <button class="chat-send" title="Enviar" onclick="addPedComment('${p.id}')">${svgIcon('send')}</button>
      </div>
    </div>`,true);
}
window.pedidoDetail=pedidoDetail;

function setPedStatus(id,status){
  const p=DB.pedidos.find(x=>x.id===id); if(!p) return;
  p.status=status; p.assignedId=SES.userId;
  const lbl={proceso:'tomó el pedido (en proceso)',entregado:'marcó ENTREGADO',rechazado:'marcó que NO se puede'}[status];
  p.log.push({at:now(),byId:SES.userId,text:lbl});
  audit('pedido',`${lbl}: "${p.item}"`,p.sucursalId);
  let extra='';
  if(status==='entregado' && p.productId){
    const prod=DB.inventory.find(x=>x.id===p.productId);
    if(prod){
      prod.stock=Math.max(0, +(prod.stock-(p.qty||0)).toFixed(2));
      DB.invMoves.unshift({id:uid(),productId:prod.id,type:'salida',qty:p.qty||0,byId:SES.userId,at:now(),note:'Entrega de pedido: '+p.item,refId:p.id,sucursalId:prod.sucursalId});
      p.log.push({at:now(),byId:SES.userId,text:`descontó ${p.qty} ${prod.unit} de inventario (${prod.name})`});
      audit('inventario',`-${p.qty} ${prod.unit} de "${prod.name}" por entrega de pedido`,prod.sucursalId);
      extra=` · -${p.qty} ${prod.unit} de inventario`;
      if(lowStock(prod)) notify(DB.users.filter(u=>u.role==='proveeduria'||u.role==='admin').map(u=>u.id), `Inventario bajo: ${prod.name} (${prod.stock} ${prod.unit})`, '⚠️', {view:'inventario'});
    }
  }
  notify([p.fromId], `${me().name.split(' ')[0]} ${status==='entregado'?'entregó':status==='rechazado'?'rechazó':'está atendiendo'} "${p.item}"`, '📦', {view:'pedidos'});
  toast('Estado actualizado'+extra,'ok'); save(); pedidoDetail(id); render();
}
window.setPedStatus=setPedStatus;

function addPedComment(id){
  const p=DB.pedidos.find(x=>x.id===id); if(!p) return;
  const v=$('#pcInput').value.trim(); if(!v) return;
  p.comments.push({id:uid(),byId:SES.userId,text:v,at:now()});
  notify([p.fromId], `${me().name.split(' ')[0]} comentó tu pedido "${p.item}"`,'💬',{view:'pedidos'});
  save(); pedidoDetail(id);
}
window.addPedComment=addPedComment;

const PED_PICK=[
  ['proveeduria','Proveeduría','Insumos y productos','box'],
  ['contabilidad','Contabilidad','Pagos y facturas','clipboard'],
  ['rrhh','Recursos','Permisos y adelantos','users'],
];
function pedAreaPick(sel){
  return `<input type="hidden" id="npArea" value="${sel}"><div class="ped-area-pick">`+PED_PICK.map(([k,l,s,ic])=>`<button type="button" class="ped-area-b ${sel===k?'on':''}" data-a="${k}" onclick="setNpArea('${k}')"><span class="ped-area-ic">${svgIcon(ic,'icon icon-sm')}</span><span class="ped-area-tx"><span class="ped-area-n">${l}</span><span class="ped-area-s">${s}</span></span></button>`).join('')+`</div>`;
}
const PED_PH={
  proveeduria:{item:'Ej: Caja de tomates', desc:'¿Para qué y para cuándo lo necesitás?'},
  contabilidad:{item:'Ej: Pago a proveedor / reembolso', desc:'Monto, a quién y número de factura…'},
  rrhh:{item:'Ej: Permiso el viernes / adelanto', desc:'Fechas, motivo o monto…'},
};
function pedPh(area){ return PED_PH[area]||PED_PH.proveeduria; }
function setNpArea(a){
  const h=$('#npArea'); if(h)h.value=a;
  document.querySelectorAll('.ped-area-b').forEach(b=>b.classList.toggle('on',b.dataset.a===a));
  const w=$('#npProdWrap'); if(w) w.style.display = a==='proveeduria'?'':'none';
  const ph=pedPh(a);
  const it=$('#npItem'); if(it) it.placeholder=ph.item;
  const ds=$('#npDesc'); if(ds) ds.placeholder=ph.desc;
}
function pedUrgSeg(sel){
  const opts=[['alta','Alta','var(--danger)'],['media','Media','var(--warn)'],['baja','Baja','var(--text-dim)']];
  return `<input type="hidden" id="npUrg" value="${sel}"><div class="prio-seg">`+opts.map(([k,l,c])=>`<button type="button" class="prio-b ${sel===k?'on':''}" data-u="${k}" onclick="setNpUrg('${k}')"><span class="dot-prio" style="background:${c}"></span>${l}</button>`).join('')+`</div>`;
}
function setNpUrg(u){ const h=$('#npUrg'); if(h)h.value=u; document.querySelectorAll('.prio-b').forEach(b=>b.classList.toggle('on',b.dataset.u===u)); }
window.setNpArea=setNpArea; window.setNpUrg=setNpUrg;
function pedidoFormBody(p){
  const area = p? p.area : 'proveeduria';
  return `
    <div class="ip-sec">${svgIcon('box','icon icon-sm')} ¿A qué área se lo pedís?</div>
    ${pedAreaPick(area)}
    <div class="field"><label>¿Qué necesitás?</label><input class="input" id="npItem" value="${p?esc(p.item):''}" placeholder="${pedPh(area).item}" autocomplete="off"></div>
    <div class="field" id="npProdWrap" style="${area==='proveeduria'?'':'display:none'}"><label>Ligar a producto del inventario (opcional)</label>
      <select class="select" id="npProd" onchange="onPedProdPick()"><option value="">— Sin ligar —</option>
        ${invInScope().map(x=>`<option value="${x.id}" data-name="${esc(x.name)}" ${p&&p.productId===x.id?'selected':''}>${esc(x.name)} · ${esc(sucName(x.sucursalId))} · ${x.stock} ${x.unit}</option>`).join('')}
      </select>
      <div class="ped-hint">Si lo ligás, al marcar <b>Entregado</b> se descuenta solo del inventario.</div>
    </div>
    <div class="ip-sec">${svgIcon('clipboard','icon icon-sm')} Detalles</div>
    <div class="row2">
      <div class="field"><label>Cantidad</label><input class="input" id="npQty" type="number" min="1" step="any" value="${p?(p.qty||1):1}"></div>
      <div class="field"><label>Sucursal</label><select class="select" id="npSuc">${p?sucOptionsSel(p.sucursalId):sucOptionsFor()}</select></div>
    </div>
    <div class="field"><label>Urgencia</label>${pedUrgSeg(p?p.urgencia:'media')}</div>
    <div class="field"><label>Detalle</label><textarea class="textarea" id="npDesc" placeholder="${pedPh(area).desc}">${p?esc(p.desc||''):''}</textarea></div>`;
}
function newPedidoModal(){
  openModal(`
    <div class="modal-head"><h3>${svgIcon('box','icon')} Pedir algo</h3><button class="modal-close" onclick="closeModal()">${svgIcon('x','icon')}</button></div>
    <div class="modal-body">${pedidoFormBody(null)}</div>
    <div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">Cancelar</button><button class="btn btn-primary" onclick="createPedido()">${svgIcon('send','icon icon-sm')} Enviar pedido</button></div>`, true);
}
window.newPedidoModal=newPedidoModal;
function editPedidoModal(id){
  const p=DB.pedidos.find(x=>x.id===id); if(!p) return;
  if(!(p.fromId===SES.userId||isAdmin())){ toast('Solo quien pidió o Administración puede editarlo','err'); return; }
  openModal(`
    <div class="modal-head"><h3>${svgIcon('edit','icon')} Editar pedido</h3><button class="modal-close" onclick="closeModal()">${svgIcon('x','icon')}</button></div>
    <div class="modal-body">${pedidoFormBody(p)}</div>
    <div class="modal-foot"><button class="btn btn-ghost" onclick="pedidoDetail('${p.id}')">Cancelar</button><button class="btn btn-primary" onclick="savePedidoEdit('${p.id}')">${svgIcon('check','icon icon-sm')} Guardar cambios</button></div>`, true);
}
window.editPedidoModal=editPedidoModal;

function onPedProdPick(){
  const sel=$('#npProd'); const opt=sel.options[sel.selectedIndex];
  if(sel.value && opt.dataset.name && !$('#npItem').value.trim()) $('#npItem').value=opt.dataset.name;
}
window.onPedProdPick=onPedProdPick;

function readPedForm(){
  const item=$('#npItem').value.trim(); if(!item){ toast('Decí qué necesitás','err'); return null; }
  const area=$('#npArea').value;
  const prodEl=$('#npProd');
  return { item, desc:$('#npDesc').value.trim(), qty:+$('#npQty').value||1, area,
    productId:(area==='proveeduria'&&prodEl&&prodEl.value)||null,
    sucursalId:$('#npSuc').value, urgencia:($('#npUrg')?$('#npUrg').value:'media') };
}
function createPedido(){
  const d=readPedForm(); if(!d) return;
  const p={ id:uid(), ...d, fromId:SES.userId, assignedId:null, status:'pendiente', createdAt:now(), comments:[],
    log:[{at:now(),byId:SES.userId,text:'creó la solicitud'}] };
  DB.pedidos.unshift(p);
  const info=pedInfo(d.area);
  audit('pedido',`pidió "${d.item}" a ${info.short}`,p.sucursalId);
  const targets=DB.users.filter(u=>(info.roles||[]).includes(u.role)).map(u=>u.id);
  notify(targets, `${me().name.split(' ')[0]} pidió: "${d.item}" (${info.short})`, 'pedido', {view:'pedidos'});
  closeModal(); toast('Pedido enviado','ok'); save(); render();
}
window.createPedido=createPedido;
function savePedidoEdit(id){
  const p=DB.pedidos.find(x=>x.id===id); if(!p) return;
  if(!(p.fromId===SES.userId||isAdmin())){ toast('Solo quien pidió o Administración puede editarlo','err'); return; }
  const d=readPedForm(); if(!d) return;
  Object.assign(p, d);
  p.log.push({at:now(),byId:SES.userId,text:'editó la solicitud'});
  audit('pedido',`editó "${d.item}"`,p.sucursalId);
  closeModal(); toast('Pedido actualizado','ok'); save(); render();
}
window.savePedidoEdit=savePedidoEdit;
async function delPedido(id){
  const p=DB.pedidos.find(x=>x.id===id); if(!p) return;
  if(!(p.fromId===SES.userId||isAdmin())){ toast('Solo quien pidió o Administración puede eliminarlo','err'); return; }
  if(!await confirmDialog(`Se elimina el pedido "${p.item}" con su historial. No se puede deshacer.`,{title:'¿Eliminar pedido?',okText:'Sí, eliminar'})) return;
  tomb(id); DB.pedidos=DB.pedidos.filter(x=>x.id!==id);
  audit('pedido',`eliminó el pedido "${p.item}"`,p.sucursalId);
  closeModal(); save(); render(); undoDelete('pedidos', p, p.item);
}
window.delPedido=delPedido;

/* =====================================================================
   VISTA: PROYECTOS (pizarra)
   ===================================================================== */
let activeProj=null;
let projMobileView='board'; // 'board' | 'chat' — solo afecta celular
function projTab(which){
  projMobileView=which;
  const w=$('#projWork'); if(w) w.classList.toggle('pm-chat', which==='chat');
  const b=$('#pmtBoard'), c=$('#pmtChat');
  if(b) b.classList.toggle('on', which==='board');
  if(c) c.classList.toggle('on', which==='chat');
  if(which==='chat'){ const m=$('#projChatMsgs'); if(m) m.scrollTop=m.scrollHeight; }
}
window.projTab=projTab;
function viewProyectos(){
  const projs = DB.projects.filter(p=>inScope(p.sucursalId)).filter(p=>isAdmin()||p.memberIds.includes(SES.userId));
  if(activeProj && !projs.find(p=>p.id===activeProj)) activeProj=null;

  const guide=sectionGuide('proyectos','¿Para qué sirven los Proyectos?',`
    Un proyecto es un <b>espacio de trabajo</b> para algo grande: una remodelación, un evento, un menú nuevo.
    <ul style="margin:8px 0 0 18px">
      <li>Añadís a las personas que participan.</li>
      <li>Trabajan en una <b>pizarra</b> con notas, textos e imágenes.</li>
      <li>Todo queda guardado y a la vista del equipo.</li>
    </ul>
    <div class="tip"><b>Ejemplo:</b> "Remodelación" — Kenneth diseño, Josué jefe de salón, Jafet. Cada uno suma ideas, fotos y pendientes a la pizarra.</div>`);

  let html=`<div class="page-head"><div><div class="page-title">Proyectos</div><div class="page-sub">Trabajen juntos en una pizarra</div></div>
    <div class="ph-spacer"></div><button class="btn btn-primary" style="flex:0 0 auto" onclick="newProjectModal()">+ Nuevo proyecto</button></div>`;
  html+=guide;

  if(!projs.length) return html+emptyState('📋','Todavía no hay proyectos','Creá uno para juntar a tu equipo alrededor de una meta.','+ Nuevo proyecto','newProjectModal()');

  // tabs de proyectos
  html+=`<div class="proj-tab">${projs.map(p=>`<button class="chip ${activeProj===p.id?'on':''}" onclick="openProj('${p.id}')">${esc(p.name)}</button>`).join('')}</div>`;

  const proj = projs.find(p=>p.id===activeProj) || projs[0];
  activeProj=proj.id;
  const members=proj.memberIds.map(i=>userById(i)).filter(Boolean);
  const canEdit = isAdmin()||proj.memberIds.includes(SES.userId);

  html+=`<div class="card">
    <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
      <div><div style="font-weight:700;font-size:17px">${esc(proj.name)}</div><div style="color:var(--text-soft);font-size:13px">${esc(proj.desc||'')}</div></div>
      <div class="ph-spacer"></div>
      <div class="member-av">${members.map(m=>avatarHTML(m)).join('')}</div>
      ${isAdmin()?`<button class="btn btn-ghost" style="flex:0 0 auto;padding:8px 12px" onclick="manageMembers('${proj.id}')">👥 Miembros</button>`:''}
    </div>
  </div>`;

  html+=`<div class="board-tools">
    <div class="bt-group">
      <button class="bt-tool ${boardTool==='move'?'on':''}" data-t="move" onclick="setBoardTool('move')" title="Mover y seleccionar">${svgIcon('back','icon icon-sm')} Mover</button>
      ${canEdit?`<button class="bt-tool ${boardTool==='draw'?'on':''}" data-t="draw" onclick="setBoardTool('draw')" title="Dibujar a mano">${svgIcon('edit','icon icon-sm')} Dibujar</button>
      <button class="bt-tool ${boardTool==='erase'?'on':''}" data-t="erase" onclick="setBoardTool('erase')" title="Borrar trazos">${svgIcon('x','icon icon-sm')} Borrar</button>`:''}
    </div>
    ${canEdit?`<button class="bt-icon" id="btUndo" title="Deshacer (Ctrl+Z)" onclick="boardUndo()" ${_boardHist.length?'':'disabled'}>${svgIcon('back','icon icon-sm')}</button>`:''}
    ${canEdit?`<div class="bt-pens">${PEN_COLORS.map(c=>`<button class="pen-sw ${c===penColor?'on':''}" data-c="${c}" style="background:${c}" onclick="setPen('${c}')"></button>`).join('')}
      <span class="bt-widths">${[3,6,10].map(w=>`<button class="pen-w ${w===penWidth?'on':''}" data-w="${w}" onclick="setPenW(${w})"><span style="width:${Math.min(14,w+2)}px;height:${Math.min(14,w+2)}px"></span></button>`).join('')}</span>
    </div>`:''}
    <div class="ph-spacer"></div>
    ${canEdit?`<div class="bt-add">
      <button onclick="addCardModal('${proj.id}','title')" title="Agregar un título">${svgIcon('clipboard','icon icon-sm')} Título</button>
      <button onclick="addCardModal('${proj.id}','text')" title="Agregar una nota">${svgIcon('edit','icon icon-sm')} Nota</button>
      <button onclick="addCardModal('${proj.id}','image')" title="Agregar una imagen">${svgIcon('image','icon icon-sm')} Imagen</button>
      <button onclick="addFileCardModal('${proj.id}')" title="Subir un archivo o PDF">${svgIcon('clip','icon icon-sm')} Archivo</button>
    </div>
    <button class="bt-icon" onclick="clearDrawings('${proj.id}')" title="Borrar todos los trazos dibujados">${svgIcon('trash','icon icon-sm')}</button>`:''}
    <button class="bt-icon" onclick="toggleBoardFull()" title="Pantalla completa">${svgIcon('chart','icon icon-sm')}</button>
  </div>`;

  // En celular: alternar entre Pizarra y Chat (cada uno a pantalla completa)
  html+=`<div class="proj-mtabs mobile-only">
    <button class="pmt ${projMobileView==='chat'?'':'on'}" id="pmtBoard" onclick="projTab('board')">${svgIcon('clipboard','icon icon-sm')} Pizarra</button>
    <button class="pmt ${projMobileView==='chat'?'on':''}" id="pmtChat" onclick="projTab('chat')">${svgIcon('message','icon icon-sm')} Chat del grupo</button>
  </div>`;

  const cards=proj.cards;
  const {cw,chh}=boardDims(proj);
  const links=boardLinks(cards);
  const isEmpty=!cards.length && !(proj.drawings&&proj.drawings.length);
  const board = `<div class="canvas-wrap ${boardTool!=='move'?'drawing':''}" id="canvasWrap" onwheel="boardWheel(event)"><div class="canvas-zoom" id="canvasZoom" style="width:${cw*boardZoom}px;height:${chh*boardZoom}px"><div class="canvas" id="boardCanvas" style="width:${cw}px;height:${chh}px;transform:scale(${boardZoom});transform-origin:0 0" onpointerdown="canvasPanDown(event)"><svg class="canvas-links" width="${cw}" height="${chh}">${links}</svg><svg class="canvas-draw" id="boardDraw" width="${cw}" height="${chh}">${drawPaths(proj)}</svg>${cards.map(c=>boardCard(proj.id,c)).join('')}${isEmpty?`<div class="board-empty">${svgIcon('clipboard','icon')}<div>Pizarra vacía — agregá una nota, una imagen o empezá a <b>dibujar</b>.</div></div>`:''}</div></div></div>`;
  html+=`<div class="proj-work ${boardFull?'faux-full':''} ${projMobileView==='chat'?'pm-chat':''}" id="projWork">${boardFull?`<button class="btn btn-ghost board-exit" onclick="toggleBoardFull()">${svgIcon('x','icon icon-sm')} Salir de pantalla completa</button>`:''}${board}${projSide(proj)}</div>`;
  return html;
}
const PEN_COLORS=['#e0566f','#f4b740','#5aa777','#7fa9b8','#f4efed','#1a1413'];
let boardTool='move', penColor='#e0566f', penWidth=6, _draw=null;
function setBoardTool(t){ boardTool=t; const w=$('#canvasWrap'); if(w) w.classList.toggle('drawing', t!=='move'); document.querySelectorAll('.bt-tool').forEach(b=>b.classList.toggle('on',b.dataset.t===t)); }
function setPen(c){ penColor=c; if(boardTool!=='draw') setBoardTool('draw'); document.querySelectorAll('.pen-sw').forEach(s=>s.classList.toggle('on',s.dataset.c===c)); }
function setPenW(w){ penWidth=w; if(boardTool!=='draw') setBoardTool('draw'); document.querySelectorAll('.pen-w').forEach(b=>b.classList.toggle('on',+b.dataset.w===w)); }
window.setBoardTool=setBoardTool; window.setPen=setPen; window.setPenW=setPenW;
/* Deshacer de la pizarra (Ctrl+Z): pila local de acciones reversibles (no se sincroniza) */
let _boardHist=[];
function boardHistPush(undoFn){ _boardHist.push(undoFn); if(_boardHist.length>80) _boardHist.shift(); updateUndoBtn(); }
function updateUndoBtn(){ const b=document.getElementById('btUndo'); if(b) b.disabled=!_boardHist.length; }
function boardUndo(){
  if(SES.view!=='proyectos') return;
  const fn=_boardHist.pop();
  if(!fn){ toast('Nada para deshacer','ok'); return; }
  try{ fn(); }catch(_){}
  updateUndoBtn(); save(); render();
}
window.boardUndo=boardUndo;
function drawPaths(p){ return (p.drawings||[]).map(s=>{ if(!s.points||s.points.length<2) return ''; const d='M'+s.points.map(q=>`${q.x} ${q.y}`).join(' L'); return `<path d="${d}" stroke="${s.color}" stroke-width="${s.width||6}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`; }).join(''); }
function boardPoint(e){ const bc=$('#boardCanvas'); const r=bc.getBoundingClientRect(); return {x:Math.round((e.clientX-r.left)/boardZoom), y:Math.round((e.clientY-r.top)/boardZoom)}; }
function drawStart(e){
  const svg=$('#boardDraw'); if(!svg) return; e.preventDefault();
  const be=document.querySelector('.board-empty'); if(be) be.remove();   // quitar el aviso "Pizarra vacía" al empezar a dibujar
  const pt=boardPoint(e);
  const path=document.createElementNS('http://www.w3.org/2000/svg','path');
  path.setAttribute('stroke',penColor); path.setAttribute('stroke-width',penWidth); path.setAttribute('fill','none');
  path.setAttribute('stroke-linecap','round'); path.setAttribute('stroke-linejoin','round'); path.setAttribute('d',`M${pt.x} ${pt.y}`);
  svg.appendChild(path);
  _draw={points:[pt],path};
  document.addEventListener('pointermove',drawMove); document.addEventListener('pointerup',drawEnd);
}
function drawMove(e){ if(!_draw)return; const pt=boardPoint(e); _draw.points.push(pt); _draw.path.setAttribute('d',_draw.path.getAttribute('d')+` L${pt.x} ${pt.y}`); }
function drawEnd(){
  document.removeEventListener('pointermove',drawMove); document.removeEventListener('pointerup',drawEnd);
  if(!_draw)return; const pts=_draw.points; _draw=null; if(pts.length<2) return;
  const p=DB.projects.find(x=>x.id===activeProj); if(!p) return;
  p.drawings=p.drawings||[]; const st={id:uid(),color:penColor,width:penWidth,points:pts,byId:SES.userId,at:now()}; p.drawings.push(st);
  boardHistPush(()=>{ const pp=DB.projects.find(x=>x.id===activeProj); if(pp) pp.drawings=(pp.drawings||[]).filter(s=>s.id!==st.id); });
  save();
}
function eraseAt(e){
  const p=DB.projects.find(x=>x.id===activeProj); if(!p||!(p.drawings&&p.drawings.length)) return;
  const pt=boardPoint(e); let best=-1,bestD=16;
  p.drawings.forEach((s,idx)=>{ (s.points||[]).forEach(q=>{ const d=Math.hypot(q.x-pt.x,q.y-pt.y); if(d<bestD){bestD=d;best=idx;} }); });
  if(best>=0){ const removed=p.drawings[best]; p.drawings.splice(best,1); boardHistPush(()=>{ const pp=DB.projects.find(x=>x.id===activeProj); if(pp){ pp.drawings=pp.drawings||[]; pp.drawings.push(removed); } }); save(); const svg=$('#boardDraw'); if(svg) svg.innerHTML=drawPaths(p); }
}
async function clearDrawings(projId){
  const p=DB.projects.find(x=>x.id===projId); if(!p||!(p.drawings&&p.drawings.length)){ toast('No hay trazos para borrar','ok'); return; }
  if(!await confirmDialog('Se borran todos los trazos dibujados en la pizarra (las notas e imágenes se mantienen).',{title:'¿Borrar dibujos?',okText:'Sí, borrar'})) return;
  const prev=p.drawings.slice(); p.drawings=[];
  boardHistPush(()=>{ const pp=DB.projects.find(x=>x.id===projId); if(pp) pp.drawings=prev; });
  audit('proyecto',`borró los dibujos de "${p.name}"`,p.sucursalId); save(); render();
}
window.clearDrawings=clearDrawings;
/* ---- Archivos / PDF en proyectos (subir, abrir, descargar) ---- */
function fmtFileSize(b){ b=+b||0; return b>=1048576?(b/1048576).toFixed(1)+' MB':b>=1024?Math.round(b/1024)+' KB':b+' B'; }
function fileIconFor(mime,name){ const n=(name||'').toLowerCase(); if((mime||'').includes('pdf')||n.endsWith('.pdf'))return 'clipboard'; if((mime||'').startsWith('image'))return 'image'; return 'clip'; }
function blobUrlFromData(data,mime){ const b64=(data||'').split(',')[1]||''; const bin=atob(b64); const arr=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++)arr[i]=bin.charCodeAt(i); return URL.createObjectURL(new Blob([arr],{type:mime||'application/octet-stream'})); }
async function openFileData(f){ if(!f){ toast('Archivo no disponible','err'); return; } const data=await fetchMediaData(f.mid||f.data); if(!data){ toast('Archivo no disponible','err'); return; } try{ const url=blobUrlFromData(data,f.mime); window.open(url,'_blank'); setTimeout(()=>URL.revokeObjectURL(url),60000); }catch(e){ window.open(data,'_blank'); } }
async function downloadFileData(f){ if(!f){ toast('Archivo no disponible','err'); return; } const data=await fetchMediaData(f.mid||f.data); if(!data){ toast('Archivo no disponible','err'); return; } try{ const url=blobUrlFromData(data,f.mime); const a=document.createElement('a'); a.href=url; a.download=f.filename||'archivo'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),60000); }catch(e){ const a=document.createElement('a'); a.href=data; a.download=f.filename||'archivo'; a.click(); } }
function projCardFile(projId,cardId){ const p=DB.projects.find(x=>x.id===projId); const c=p&&p.cards.find(x=>x.id===cardId); return c?c.file:null; }
function openProjFile(projId,cardId){ openFileData(projCardFile(projId,cardId)); }
function downloadProjFile(projId,cardId){ downloadFileData(projCardFile(projId,cardId)); }
window.openProjFile=openProjFile; window.downloadProjFile=downloadProjFile;
let fileCardPending=null;
function addFileCardModal(projId){
  fileCardPending=null;
  openModal(`<div class="modal-head"><h3>${svgIcon('clip','icon')} Subir archivo / PDF</h3><button class="modal-close" onclick="closeModal()">${svgIcon('x','icon')}</button></div>
    <div class="modal-body">
      <div class="field"><label>Archivo (PDF, documento, hoja de cálculo, imagen…)</label>
        <input type="file" id="fcFile" accept=".pdf,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,image/*" onchange="pickFileCard(this)">
        <div id="fcInfo" style="margin-top:9px"></div>
        <div class="ped-hint">Hasta 8 MB. Queda en la pizarra para abrir o descargar cuando quieras.</div>
      </div>
      <div class="field"><label>Título (opcional)</label><input class="input" id="fcTitle" placeholder="Ej: Presupuesto remodelación" autocomplete="off"></div>
    </div>
    <div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">Cancelar</button><button class="btn btn-primary" onclick="addFileCard('${projId}')">${svgIcon('check','icon icon-sm')} Agregar a la pizarra</button></div>`);
}
async function pickFileCard(input){
  const f=input.files&&input.files[0]; if(!f) return;
  if(f.size>8*1024*1024){ toast('El archivo es muy grande (máx 8 MB)','err'); input.value=''; return; }
  const data=await fileToData(f);
  fileCardPending={data,filename:f.name,mime:f.type||'application/octet-stream',size:f.size};
  const info=$('#fcInfo'); if(info) info.innerHTML=`<div class="fc-chip">${svgIcon(fileIconFor(f.type,f.name),'icon icon-sm')} ${esc(f.name)} · ${fmtFileSize(f.size)}</div>`;
  const t=$('#fcTitle'); if(t && !t.value) t.value=f.name.replace(/\.[^.]+$/,'');
}
window.pickFileCard=pickFileCard;
async function addFileCard(projId){
  const p=DB.projects.find(x=>x.id===projId); if(!p) return;
  if(!fileCardPending){ toast('Elegí un archivo','err'); return; }
  const mid=await putMedia(fileCardPending.data);   // archivo al nodo aparte
  const file={mid,filename:fileCardPending.filename,mime:fileCardPending.mime,size:fileCardPending.size};
  const i=p.cards.length;
  const card={id:uid(),type:'file',text:($('#fcTitle')?$('#fcTitle').value.trim():'')||fileCardPending.filename,file,byId:SES.userId,at:now(),x:40+(i%5)*250,y:40+Math.floor(i/5)*215};
  p.cards.push(card);
  boardHistPush(()=>{ const pp=DB.projects.find(x=>x.id===projId); if(pp) pp.cards=pp.cards.filter(c=>c.id!==card.id); });
  audit('proyecto',`subió el archivo "${fileCardPending.filename}" a "${p.name}"`,p.sucursalId);
  notify(p.memberIds.filter(x=>x!==SES.userId), `${me().name.split(' ')[0]} subió un archivo a "${p.name}"`,'clipboard',{view:'proyectos'});
  fileCardPending=null; closeModal(); toast('Archivo agregado a la pizarra','ok'); save(); render();
}
window.addFileCardModal=addFileCardModal; window.addFileCard=addFileCard;
let boardZoom=1, boardFull=false;
function boardDims(p){ let maxX=1800,maxY=1100; p.cards.forEach(c=>{maxX=Math.max(maxX,(c.x||0)+260);maxY=Math.max(maxY,(c.y||0)+260);}); return {cw:maxX+900,chh:maxY+800}; }
function boardLinks(cards){ return cards.filter(c=>c.parentId&&cards.find(x=>x.id===c.parentId)).map(c=>{const par=cards.find(x=>x.id===c.parentId);return `<line x1="${(par.x||0)+115}" y1="${(par.y||0)+34}" x2="${(c.x||0)+115}" y2="${(c.y||0)+16}" stroke="var(--accent-line)" stroke-width="2" stroke-dasharray="5 4"/>`;}).join(''); }
function applyZoom(){
  const cz=$('#canvasZoom'), bc=$('#boardCanvas'); if(!cz||!bc) return;
  const p=DB.projects.find(x=>x.id===activeProj); if(!p) return;
  const {cw,chh}=boardDims(p);
  bc.style.transform=`scale(${boardZoom})`; cz.style.width=(cw*boardZoom)+'px'; cz.style.height=(chh*boardZoom)+'px';
}
function boardWheel(e){ if(!e.altKey) return; e.preventDefault(); boardZoom=Math.min(2,Math.max(.4,+(boardZoom+(e.deltaY<0?.1:-.1)).toFixed(2))); applyZoom(); }
window.boardWheel=boardWheel;
function refreshBoard(projId){
  const p=DB.projects.find(x=>x.id===projId); const bc=$('#boardCanvas'); if(!p||!bc){ render(); return; }
  const {cw,chh}=boardDims(p);
  bc.style.width=cw+'px'; bc.style.height=chh+'px';
  const cz=$('#canvasZoom'); if(cz){ cz.style.width=(cw*boardZoom)+'px'; cz.style.height=(chh*boardZoom)+'px'; }
  const svg=bc.querySelector('.canvas-links'); if(svg){ svg.setAttribute('width',cw); svg.setAttribute('height',chh); svg.innerHTML=boardLinks(p.cards); }
  const dsvg=bc.querySelector('.canvas-draw'); if(dsvg){ dsvg.setAttribute('width',cw); dsvg.setAttribute('height',chh); }
}
function toggleBoardFull(){
  boardFull=!boardFull;
  try{
    if(boardFull){ const el=document.documentElement; const r=el.requestFullscreen||el.webkitRequestFullscreen||el.msRequestFullscreen; if(r) r.call(el); }
    else if(document.fullscreenElement||document.webkitFullscreenElement){ (document.exitFullscreen||document.webkitExitFullscreen||function(){}).call(document); }
  }catch(e){}
  render();
}
document.addEventListener('fullscreenchange',()=>{ if(!document.fullscreenElement && boardFull){ boardFull=false; if(SES.userId&&SES.view==='proyectos') render(); } });
window.toggleBoardFull=toggleBoardFull;
function projSide(proj){
  const msgs=(proj.chat||[]).filter(m=>m&&!msgDeleted(m)).map(m=>{const u=userById(m.byId);const mine=m.byId===SES.userId;const canDel=mine||isAdmin();
    const media=m.media?(m.media.type==='video'?mediaTag(m.media.mid||m.media.data,'video','controls'):m.media.type==='image'?mediaTag(m.media.mid||m.media.data,'image'):m.media.type==='audio'?audioMsgHTML(m.media.mid||m.media.data,m.media.dur):`<div class="chat-file"><span class="chat-file-ic">${svgIcon(fileIconFor(m.media.mime,m.media.filename),'icon icon-sm')}</span><div class="chat-file-tx"><div class="chat-file-n">${esc(m.media.filename||'Archivo')}</div><div class="chat-file-s">${m.media.size?fmtFileSize(m.media.size):''}</div></div><button class="chat-file-b" title="Abrir" onclick="openProjChatFile('${proj.id}','${m.id}')">${svgIcon('search','icon icon-sm')}</button><button class="chat-file-b" title="Descargar" onclick="downloadProjChatFile('${proj.id}','${m.id}')">${svgIcon('save','icon icon-sm')}</button></div>`):'';
    return `<div class="msg ${mine?'mine':''}">${(!mine)?`<div class="mname">${u?esc((u.name||'').split(' ')[0]):''}</div>`:''}${m.text?esc(m.text):''}${media}<div class="mtime">${new Date(m.at).toLocaleTimeString('es-CR',{hour:'2-digit',minute:'2-digit'})}${canDel?` <button class="msg-del" title="Eliminar" onclick="delProjMsg('${proj.id}','${m.id}')">${svgIcon('trash','icon icon-sm')}</button>`:''}</div></div>`;}).join('');
  watchProjectCall(proj.id);                              // presencia EN VIVO desde signals/peers
  const others=(_projPeers[proj.id]||[]).filter(id=>id!==SES.userId);
  const meInCall=_call&&_call.projId===proj.id;
  const callBtns = meInCall
    ? `<button class="btn btn-primary" style="flex:0 0 auto;padding:7px 12px" onclick="startCall('${proj.id}',true)" title="Volver a la reunión">${svgIcon('video','icon icon-sm')} En reunión</button>`
    : `<button class="btn ${others.length?'btn-primary':'btn-ghost'}" style="flex:0 0 auto;padding:7px 12px" title="Iniciar o unirse a la reunión (voz y video)" onclick="startCall('${proj.id}',true)">${svgIcon('video','icon icon-sm')} ${others.length?('Unirse · '+others.length):'Reunión'}</button>`;
  return `<div class="proj-side">
    <div class="proj-side-head"><span style="font-weight:700;font-size:13px">Chat del grupo</span><div class="ph-spacer"></div>
      ${callBtns}</div>
    <div class="proj-chat" id="projChatMsgs">${msgs||'<div style="margin:auto;color:var(--text-soft);font-size:13px;text-align:center;padding:24px">Escribí acá para coordinar mientras trabajan la pizarra.</div>'}</div>
    ${projPending?`<div class="chat-pending">${projPending.type==='video'?`<video src="${safeVid(projPending.data)}"></video>`:projPending.type==='image'?`<img src="${safeImg(projPending.data)}">`:projPending.type==='audio'?vaPreviewHTML(projPending.data,projPending.dur):`<span class="chat-file-ic">${svgIcon(fileIconFor(projPending.mime,projPending.filename),'icon icon-sm')}</span>`}<span>${projPending.type==='file'?esc(projPending.filename):projPending.type==='audio'?'Nota de voz lista':(projPending.type==='video'?'Video':'Foto')+' listo'}</span><button class="btn btn-ghost" style="padding:5px 10px;margin-left:auto" onclick="projPending=null;render()">Quitar</button></div>`:''}
    ${vaRecording(proj.id)?`<div class="chat-input chat-rec">
      <button class="chat-attach rec-cancel" title="Cancelar" onclick="vaRecCancel()">${svgIcon('trash')}</button>
      <div class="rec-mid"><span class="rec-dot"></span><span id="vaRecTime">0:00</span> <span class="rec-lbl">Grabando…</span></div>
      <button class="chat-send" title="Listo" onclick="vaRecStop()">${svgIcon('check')}</button>
    </div>`:`<div class="chat-input chat-swap ${projPending?'has-text':''}">
      <input type="file" id="projFile" accept="image/*,video/*,.pdf,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv" style="display:none" onchange="projAttachPick('${proj.id}')">
      <button class="chat-attach" title="Adjuntar archivo" onclick="document.getElementById('projFile').click()">${svgIcon('plus')}</button>
      <div class="chat-field">
        <input id="projMsg" placeholder="Mensaje al grupo" oninput="chatTyping(this)" onkeydown="if(event.key==='Enter')sendProjMsg('${proj.id}')">
      </div>
      <button class="chat-send chat-mic" title="Grabar nota de voz" onclick="vaRecStart('${proj.id}',true)">${svgIcon('mic')}</button>
      <button class="chat-send chat-sendbtn" title="Enviar" onclick="sendProjMsg('${proj.id}')">${svgIcon('send')}</button>
    </div>`}
  </div>`;
}
window.openProj=id=>{ activeProj=id; _boardHist=[]; render(); };

const NOTE_COLORS=['var(--warn-bg)','rgba(184,58,82,.18)','rgba(90,167,119,.16)','rgba(127,169,184,.16)','var(--bg-soft)'];
let _bdrag=null;
function boardCard(projId,c){
  const u=userById(c.byId); const canEdit=(isAdmin()||c.byId===SES.userId);
  if(c.type==='title'){
    return `<div class="bcard title-card" style="left:${c.x||20}px;top:${c.y||20}px" onpointerdown="bcardDown(event,'${projId}','${c.id}')">
      ${canEdit?`<button class="bc-btn bc-del" title="Quitar" onclick="delCard('${projId}','${c.id}')">${svgIcon('x','icon icon-sm')}</button>`:''}
      <div class="bc-title">${esc(c.text||'Título')}</div></div>`;
  }
  if(c.type==='file'){
    const f=c.file||{}; const ic=fileIconFor(f.mime,f.filename);
    return `<div class="bcard file-card" style="left:${c.x||20}px;top:${c.y||20}px" onpointerdown="bcardDown(event,'${projId}','${c.id}')">
      ${canEdit?`<button class="bc-btn bc-del" title="Quitar" onclick="delCard('${projId}','${c.id}')">${svgIcon('x','icon icon-sm')}</button>`:''}
      <div class="fc-card-head"><span class="fc-card-ic">${svgIcon(ic,'icon')}</span><div class="fc-card-tx"><div class="fc-card-name">${esc(c.text||f.filename||'Archivo')}</div><div class="fc-card-sub">${esc(f.filename||'')}${f.size?' · '+fmtFileSize(f.size):''}</div></div></div>
      <div class="fc-card-actions">
        <button class="bc-btn fc-act" onclick="openProjFile('${projId}','${c.id}')">${svgIcon('search','icon icon-sm')} Abrir</button>
        <button class="bc-btn fc-act" onclick="downloadProjFile('${projId}','${c.id}')">${svgIcon('save','icon icon-sm')} Descargar</button>
      </div>
      <div class="bc-foot"><span class="bc-meta">${u?esc((u.name||'').split(' ')[0]):'—'} · ${timeAgo(c.at)}</span>
        <button class="bc-btn bc-reply" title="Responder con una nota" onclick="replyModal('${projId}','${c.id}')">${svgIcon('message','icon icon-sm')} Responder</button></div>
    </div>`;
  }
  return `<div class="bcard note${c.parentId?' reply':''}" style="left:${c.x||20}px;top:${c.y||20}px;${c.color?`background:${c.color}`:''}" onpointerdown="bcardDown(event,'${projId}','${c.id}')">
    ${canEdit?`<button class="bc-btn bc-del" title="Quitar" onclick="delCard('${projId}','${c.id}')">${svgIcon('x','icon icon-sm')}</button>`:''}
    ${c.parentId?'<div class="reply-tag">↳ respuesta</div>':''}
    ${c.img?mediaTag(c.img,'image','draggable="false"'):''}
    ${c.text?`<div class="bc-text">${esc(c.text)}</div>`:''}
    <div class="bc-foot"><span class="bc-meta">${u?esc((u.name||'').split(' ')[0]):'—'} · ${timeAgo(c.at)}</span>
      <button class="bc-btn bc-reply" title="Responder con una nota" onclick="replyModal('${projId}','${c.id}')">${svgIcon('message','icon icon-sm')} Responder</button></div>
  </div>`;
}
function bcardDown(e,projId,cardId){
  if(e.target.closest('.bc-btn')) return;
  const p=DB.projects.find(x=>x.id===projId); const c=p&&p.cards.find(x=>x.id===cardId); if(!c) return;
  const el=e.currentTarget;
  _bdrag={projId,cardId,el,sx:e.clientX,sy:e.clientY,ox:c.x||0,oy:c.y||0,moved:false};
  el.classList.add('dragging'); e.preventDefault();
  document.addEventListener('pointermove',bcardMove); document.addEventListener('pointerup',bcardUp);
}
function bcardMove(e){
  if(!_bdrag) return;
  const dx=e.clientX-_bdrag.sx, dy=e.clientY-_bdrag.sy;
  if(Math.abs(dx)>4||Math.abs(dy)>4) _bdrag.moved=true;
  _bdrag.el.style.left=Math.max(0,_bdrag.ox+dx/boardZoom)+'px';
  _bdrag.el.style.top=Math.max(0,_bdrag.oy+dy/boardZoom)+'px';
}
function bcardUp(){
  document.removeEventListener('pointermove',bcardMove); document.removeEventListener('pointerup',bcardUp);
  if(!_bdrag) return;
  const {projId,cardId,el,moved,ox,oy}=_bdrag; el.classList.remove('dragging'); _bdrag=null;
  const p=DB.projects.find(x=>x.id===projId); const c=p&&p.cards.find(x=>x.id===cardId); if(!c) return;
  if(moved){ c.x=parseInt(el.style.left)||0; c.y=parseInt(el.style.top)||0;
    boardHistPush(()=>{ const pp=DB.projects.find(x=>x.id===projId); const cc=pp&&pp.cards.find(x=>x.id===cardId); if(cc){ cc.x=ox; cc.y=oy; } });
    save(); refreshBoard(projId); }
  else { cardDetailModal(projId,cardId); }
}
window.bcardDown=bcardDown;
function cardDetailModal(projId,cardId){
  const p=DB.projects.find(x=>x.id===projId); const c=p&&p.cards.find(x=>x.id===cardId); if(!c) return;
  const u=userById(c.byId); const canEdit=(isAdmin()||c.byId===SES.userId);
  const kids=p.cards.filter(x=>x.parentId===cardId);
  const typeLabel=c.type==='title'?'Título':c.parentId?'Respuesta':c.type==='image'?'Imagen':c.type==='file'?'Archivo':'Nota';
  const f=c.file||{};
  openModal(`<div class="modal-head"><h3>${typeLabel}</h3><button class="modal-close" onclick="closeModal()">${svgIcon('x','icon')}</button></div>
    <div class="modal-body">
      ${c.type==='file'?`<div class="fc-detail"><span class="fc-card-ic">${svgIcon(fileIconFor(f.mime,f.filename),'icon')}</span><div class="fc-card-tx"><div class="fc-card-name">${esc(c.text||f.filename||'Archivo')}</div><div class="fc-card-sub">${esc(f.filename||'')}${f.size?' · '+fmtFileSize(f.size):''}</div></div></div>
        <div style="display:flex;gap:8px;margin-bottom:6px;flex-wrap:wrap"><button class="btn btn-primary" style="flex:1 1 140px" onclick="openProjFile('${projId}','${cardId}')">${svgIcon('search','icon icon-sm')} Abrir</button><button class="btn btn-ghost" style="flex:1 1 140px" onclick="downloadProjFile('${projId}','${cardId}')">${svgIcon('save','icon icon-sm')} Descargar</button></div>`:''}
      ${c.img?mediaTag(c.img,'image','style="width:100%;border-radius:var(--r-md);margin-bottom:12px"'):''}
      ${c.text&&c.type!=='file'?`<div style="font-size:${c.type==='title'?'20px;font-weight:800':'14px'};line-height:1.6;white-space:pre-wrap">${esc(c.text)}</div>`:''}
      <div class="page-sub" style="margin:10px 0 2px">${u?esc(u.name):'—'} · ${fmtDateTime(c.at)}${kids.length?' · '+kids.length+' respuesta(s)':''}</div>
      <div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap">
        <button class="btn btn-ghost" style="flex:0 0 auto" onclick="replyModal('${projId}','${cardId}')">${svgIcon('message','icon icon-sm')} Responder</button>
        ${canEdit?`${c.type!=='file'?`<button class="btn btn-ghost" style="flex:0 0 auto" onclick="editCard('${projId}','${cardId}')">${svgIcon('edit','icon icon-sm')} Editar</button>`:''}<button class="btn btn-ghost" style="flex:0 0 auto" onclick="delCard('${projId}','${cardId}')">${svgIcon('trash','icon icon-sm')} Quitar</button>`:''}
      </div>
    </div>`);
}
let replyColor=NOTE_COLORS[2];
function replyModal(projId,parentId){
  replyColor=NOTE_COLORS[2];
  openModal(`<div class="modal-head"><h3>Responder</h3><button class="modal-close" onclick="closeModal()">${svgIcon('x','icon')}</button></div>
    <div class="modal-body">
      <div class="page-sub" style="margin-bottom:10px">Tu respuesta se agrega como una nota enlazada debajo.</div>
      <div class="field"><label>Respuesta</label><textarea class="textarea" id="replyText" placeholder="Escribí tu respuesta…"></textarea></div>
      <div class="field"><label>Color</label><div class="swatch-row" id="replySwatch">${NOTE_COLORS.map((cc,i)=>`<div class="swatch ${i===2?'on':''}" style="background:${cc}" onclick="pickReplyColor(${i})"></div>`).join('')}</div></div>
    </div>
    <div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">Cancelar</button><button class="btn btn-primary" onclick="saveReply('${projId}','${parentId}')">Responder</button></div>`);
}
function pickReplyColor(i){ replyColor=NOTE_COLORS[i]; document.querySelectorAll('#replySwatch .swatch').forEach((s,idx)=>s.classList.toggle('on',idx===i)); }
function saveReply(projId,parentId){
  const p=DB.projects.find(x=>x.id===projId); const par=p&&p.cards.find(x=>x.id===parentId); if(!par) return;
  const v=$('#replyText').value.trim(); if(!v){ toast('Escribí una respuesta','err'); return; }
  const kids=p.cards.filter(c=>c.parentId===parentId).length;
  p.cards.push({id:uid(),type:'text',text:v,parentId,color:replyColor,byId:SES.userId,at:now(),x:(par.x||40)+kids*46,y:(par.y||40)+160+kids*130});
  notify(p.memberIds.filter(i=>i!==SES.userId), `${me().name.split(' ')[0]} respondió en "${p.name}"`,'clipboard',{view:'proyectos'});
  audit('proyecto',`respondió una nota en "${p.name}"`,p.sucursalId);
  closeModal(); toast('Respuesta agregada','ok'); render();
}
window.cardDetailModal=cardDetailModal; window.replyModal=replyModal; window.pickReplyColor=pickReplyColor; window.saveReply=saveReply;
let cardColor=NOTE_COLORS[0];
function pickColor(i){ cardColor=NOTE_COLORS[i]; document.querySelectorAll('#cardSwatch .swatch').forEach((s,idx)=>s.classList.toggle('on',idx===i)); }
window.pickColor=pickColor;
function editCard(projId,cardId){
  const p=DB.projects.find(x=>x.id===projId); if(!p) return;
  const c=p.cards.find(x=>x.id===cardId); if(!c) return;
  cardColor=c.color||NOTE_COLORS[0];
  const ci=Math.max(0,NOTE_COLORS.indexOf(cardColor));
  openModal(`<div class="modal-head"><h3>Editar nota</h3><button class="modal-close" onclick="closeModal()">${svgIcon('x','icon')}</button></div>
    <div class="modal-body">
      <div class="field"><label>Texto</label><textarea class="textarea" id="editCardText">${esc(c.text||'')}</textarea></div>
      <div class="field"><label>Color</label><div class="swatch-row" id="cardSwatch">${NOTE_COLORS.map((cc,i)=>`<div class="swatch ${i===ci?'on':''}" style="background:${cc}" onclick="pickColor(${i})"></div>`).join('')}</div></div>
    </div>
    <div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">Cancelar</button><button class="btn btn-primary" onclick="saveCardEdit('${projId}','${cardId}')">Guardar</button></div>`);
}
function saveCardEdit(projId,cardId){
  const p=DB.projects.find(x=>x.id===projId); const c=p&&p.cards.find(x=>x.id===cardId); if(!c) return;
  c.text=$('#editCardText').value.trim(); c.color=cardColor;
  audit('proyecto',`editó una tarjeta de "${p.name}"`,p.sucursalId);
  closeModal(); toast('Tarjeta actualizada','ok'); render();
}
window.editCard=editCard; window.saveCardEdit=saveCardEdit;
async function delCard(projId,cardId){
  const p=DB.projects.find(x=>x.id===projId); if(!p) return;
  if(!await confirmDialog('Se quita esta tarjeta de la pizarra.',{title:'¿Quitar tarjeta?',okText:'Sí, quitar'})) return;
  const card=p.cards.find(c=>c.id===cardId);
  p.cards=p.cards.filter(c=>c.id!==cardId);
  if(card) boardHistPush(()=>{ const pp=DB.projects.find(x=>x.id===projId); if(pp && !pp.cards.some(c=>c.id===card.id)) pp.cards.push(card); });
  audit('proyecto',`quitó una tarjeta de "${p.name}"`,p.sucursalId);
  save(); render();
}
window.delCard=delCard;

let cardImg=null;
function addCardModal(projId,type){
  cardImg=null; cardColor=NOTE_COLORS[0];
  const titles={title:'Nuevo título',text:'Nueva nota',image:'Nueva imagen'};
  openModal(`
    <div class="modal-head"><h3>${titles[type]||'Nueva tarjeta'}</h3><button class="modal-close" onclick="closeModal()">${svgIcon('x','icon')}</button></div>
    <div class="modal-body">
      ${type==='image'?`<div class="field"><label>Imagen</label><input type="file" accept="image/*" onchange="pickCardImg(this)"><div class="img-prev" id="cardImgPrev"></div></div>`:''}
      <div class="field"><label>${type==='title'?'Título':type==='text'?'Nota':'Descripción (opcional)'}</label><textarea class="textarea" id="cardText" placeholder="${type==='title'?'Ej: Ideas para el menú':type==='text'?'Escribí tu idea, pendiente o nota…':'Qué es esta imagen…'}"></textarea></div>
      ${type!=='title'?`<div class="field"><label>Color</label><div class="swatch-row" id="cardSwatch">${NOTE_COLORS.map((cc,i)=>`<div class="swatch ${i===0?'on':''}" style="background:${cc}" onclick="pickColor(${i})"></div>`).join('')}</div></div>`:''}
    </div>
    <div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">Cancelar</button><button class="btn btn-primary" onclick="addCard('${projId}','${type}')">Agregar a la pizarra</button></div>`);
}
window.addCardModal=addCardModal;
async function pickCardImg(input){ const a=await readImages(input.files); cardImg=a[0]||null; $('#cardImgPrev').innerHTML=cardImg?`<img src="${safeImg(cardImg)}">`:''; }
window.pickCardImg=pickCardImg;
async function addCard(projId,type){
  const p=DB.projects.find(x=>x.id===projId); if(!p) return;
  const text=$('#cardText').value.trim();
  if((type==='text'||type==='title')&&!text){ toast('Escribí algo','err'); return; }
  if(type==='image'&&!cardImg){ toast('Elegí una imagen','err'); return; }
  const img = type==='title'?null:(cardImg?await putMedia(cardImg):null);   // imagen al nodo aparte
  const i=p.cards.length;
  const card={id:uid(),type,text,img,color:type==='title'?null:cardColor,byId:SES.userId,at:now(),x:40+(i%5)*250,y:40+Math.floor(i/5)*215};
  p.cards.push(card);
  boardHistPush(()=>{ const pp=DB.projects.find(x=>x.id===projId); if(pp) pp.cards=pp.cards.filter(c=>c.id!==card.id); });
  audit('proyecto',`agregó ${type==='title'?'un título':type==='text'?'una nota':'una imagen'} a "${p.name}"`,p.sucursalId);
  notify(p.memberIds, `${me().name.split(' ')[0]} agregó algo a "${p.name}"`, 'clipboard', {view:'proyectos'});
  closeModal(); toast('Agregado a la pizarra','ok'); save(); render();
}
window.addCard=addCard;
/* chat del grupo (lateral) */
let projPending=null;
async function projAttachPick(projId){
  const inp=$('#projFile'); const f=inp&&inp.files[0]; if(!f) return;
  if(f.type.startsWith('video')){ if(f.size>6*1024*1024){ toast('El video es muy pesado (máx. 6 MB)','err'); return; } projPending={type:'video',data:await fileToData(f)}; }
  else if(f.type.startsWith('image')){ const arr=await readImages([f]); projPending={type:'image',data:arr[0]}; }
  else { if(f.size>8*1024*1024){ toast('El archivo es muy grande (máx. 8 MB)','err'); return; } projPending={type:'file',data:await fileToData(f),filename:f.name,mime:f.type||'application/octet-stream',size:f.size}; }
  render();
}
window.projAttachPick=projAttachPick;
function projChatFile(projId,msgId){ const p=DB.projects.find(x=>x.id===projId); const m=p&&(p.chat||[]).find(x=>x.id===msgId); return m?m.media:null; }
function openProjChatFile(projId,msgId){ openFileData(projChatFile(projId,msgId)); }
function downloadProjChatFile(projId,msgId){ downloadFileData(projChatFile(projId,msgId)); }
window.openProjChatFile=openProjChatFile; window.downloadProjChatFile=downloadProjChatFile;
async function sendProjMsg(projId){
  const p=DB.projects.find(x=>x.id===projId); if(!p) return;
  const inp=$('#projMsg'); const v=inp?inp.value.trim():'';
  if(!v && !projPending) return;
  const m={id:uid(),byId:SES.userId,text:v,at:now()};
  if(projPending){ const mid=await putMedia(projPending.data); m.media={type:projPending.type,mid};
    if(projPending.filename) m.media.filename=projPending.filename; if(projPending.mime) m.media.mime=projPending.mime; if(projPending.size!=null) m.media.size=projPending.size; if(projPending.dur!=null) m.media.dur=projPending.dur; }
  p.chat=p.chat||[]; p.chat.push(m);
  const prev=v?v.slice(0,40):(projPending?(projPending.type==='video'?'envió un video':projPending.type==='audio'?'envió una nota de voz':projPending.type==='file'?'envió un archivo':'envió una foto'):'');
  notify(p.memberIds.filter(i=>i!==SES.userId), `${me().name.split(' ')[0]} en "${p.name}": ${prev}`,'clipboard',{view:'proyectos'});
  projPending=null; save(); render();
}
window.sendProjMsg=sendProjMsg;
async function delProjMsg(projId,msgId){
  const p=DB.projects.find(x=>x.id===projId); if(!p) return;
  const m=(p.chat||[]).find(x=>x.id===msgId); if(!m) return;
  if(!(m.byId===SES.userId||isAdmin())) return;
  if(!await confirmDialog('Se elimina este mensaje del chat.',{title:'¿Eliminar mensaje?',okText:'Sí, eliminar'})) return;
  m.delAt=now(); audit('proyecto','eliminó un mensaje del chat',p.sucursalId); save(); render();   // borrado suave por marca temporal
  undoToast('Mensaje', ()=>{ m.revAt=now(); save(); render(); toast('Restaurado','ok'); });
}
window.delProjMsg=delProjMsg;
/* mover el lienzo arrastrando el fondo */
let _pan=null;
function canvasPanDown(e){
  if(e.target.closest('.bcard')) return;
  if(boardTool==='draw'){ drawStart(e); return; }
  if(boardTool==='erase'){ eraseAt(e); return; }
  const wrap=$('#canvasWrap'); if(!wrap) return;
  _pan={sx:e.clientX,sy:e.clientY,sl:wrap.scrollLeft,st:wrap.scrollTop}; wrap.classList.add('panning');
  document.addEventListener('pointermove',canvasPanMove); document.addEventListener('pointerup',canvasPanUp);
}
function canvasPanMove(e){ if(!_pan)return; const wrap=$('#canvasWrap'); if(!wrap)return; wrap.scrollLeft=_pan.sl-(e.clientX-_pan.sx); wrap.scrollTop=_pan.st-(e.clientY-_pan.sy); }
function canvasPanUp(){ document.removeEventListener('pointermove',canvasPanMove); document.removeEventListener('pointerup',canvasPanUp); const wrap=$('#canvasWrap'); if(wrap)wrap.classList.remove('panning'); _pan=null; }
window.canvasPanDown=canvasPanDown;
/* =====================================================================
   REUNIONES DEL PROYECTO (Jitsi / SFU — aguanta ~20 personas con video)
   - "Reunión" (audio) o con video; pantalla compartida; sin servidor propio.
   - Ventana flotante que vive FUERA del render: seguís trabajando sin cortar.
   - La presencia ("Unirse · N" / "En reunión") usa signals/peers en tu Firebase
     (se autolimpia con onDisconnect). El audio/video lo maneja Jitsi (meet.jit.si).
   ===================================================================== */
let _call=null;            // {projId, video, api, myId, base, refs} mientras estás en una reunión
let _callStarting=false;
let _jitsiLoading=null;
const MEET_MAX=24;         // tope de personas por reunión (margen para el plan gratis de JaaS)
let _projPeers={}, _ppWatchRef=null, _ppWatchId=null;   // presencia EN VIVO de la reunión (de signals/peers, se autolimpia)
function watchProjectCall(projId){
  if(_ppWatchId===projId) return;
  unwatchProjectCall();
  if(!cloudOn||!fbdb||!projId) return;
  _ppWatchId=projId; _ppWatchRef=fbdb.ref('signals/'+projId+'/peers');
  _ppWatchRef.on('value', s=>{ const v=s.val()||{}; const ids=Object.keys(v); const prev=(_projPeers[projId]||[]).join(','); _projPeers[projId]=ids; if(ids.join(',')!==prev && SES.userId && SES.view==='proyectos') render(); });
}
function unwatchProjectCall(){ if(_ppWatchRef){ try{ _ppWatchRef.off(); }catch(e){} } _ppWatchRef=null; _ppWatchId=null; }
function loadJitsi(appId){
  if(window.JitsiMeetExternalAPI) return Promise.resolve();
  if(_jitsiLoading) return _jitsiLoading;
  _jitsiLoading=new Promise((res,rej)=>{
    const s=document.createElement('script'); s.src='https://8x8.vc/'+appId+'/external_api.js'; s.async=true;
    s.onload=()=>res(); s.onerror=()=>{ _jitsiLoading=null; rej(new Error('jitsi')); };
    document.head.appendChild(s);
  });
  return _jitsiLoading;
}
function ensureCallDock(){
  let d=document.getElementById('callDock'); if(d) return d;
  d=document.createElement('div'); d.id='callDock'; d.className='call-dock hidden';
  d.innerHTML=`<div class="cd-head" id="cdHead" onpointerdown="cdDragStart(event)">
      <span class="cd-live" title="Reunión en curso"></span>
      <span class="cd-title">${svgIcon('video','icon icon-sm')} <span id="cdName"></span><span class="cd-count" id="cdCount" hidden></span></span>
      <div class="ph-spacer"></div>
      <button class="cd-btn" id="cdMinBtn" onclick="callDockToggleMin()" title="Minimizar / agrandar">${svgIcon('chevron','icon icon-sm')}</button>
      <button class="cd-btn danger" onclick="callHangup()" title="Salir de la reunión">${svgIcon('x','icon icon-sm')}</button>
    </div>
    <div class="cd-body" id="cdBody"></div>`;
  document.body.appendChild(d);
  return d;
}
async function startCall(projId, video){
  const m=me(); if(!m) return;
  if(!cloudOn || !fbdb){ toast('Necesitás conexión a la nube para la reunión','err'); return; }
  if(_call){ if(_call.projId===projId){ const d=ensureCallDock(); d.classList.remove('hidden','min'); return; } toast('Ya estás en otra reunión — salí de esa primero','err'); return; }
  if(_callStarting) return;
  const p=DB.projects.find(x=>x.id===projId); if(!p) return;
  _callStarting=true;
  const myId=SES.userId;
  _call={projId, video:!!video, api:null, myId, base:fbdb.ref('signals/'+projId), refs:null};
  const dock=ensureCallDock(); dock.classList.remove('hidden','min');
  $('#cdName').textContent='Reunión · '+p.name;
  const body=$('#cdBody'); body.innerHTML='<div class="cd-load">Entrando a la reunión…</div>';
  // tope de 24 personas: si la reunión ya está llena, no dejar entrar (cuenta presencia actual)
  try{
    const psnap=await _call.base.child('peers').get();
    const cnt=psnap.exists()? Object.keys(psnap.val()||{}).filter(k=>k!==myId).length : 0;
    if(cnt>=MEET_MAX){
      toast('La reunión está llena (máximo '+MEET_MAX+' personas). Esperá a que alguien salga.','err');
      _call=null; _callStarting=false;
      const dd=document.getElementById('callDock'); if(dd){ dd.classList.add('hidden'); const bb=document.getElementById('cdBody'); if(bb) bb.innerHTML=''; }
      return;
    }
  }catch(e){}
  // presencia para "Unirse · N" / "En reunión" (se autolimpia al cerrar/cortar)
  const myPeerRef=_call.base.child('peers').child(myId);
  try{ await myPeerRef.set({name:m.name||'', video:!!video, at:firebase.database.ServerValue.TIMESTAMP}); }
  catch(e){ console.warn('signals denied',e); }   // si faltan las reglas, igual entra a la reunión (solo se pierde el conteo "Unirse · N")
  try{ myPeerRef.onDisconnect().remove(); }catch(e){}
  _call.refs={myPeerRef};
  // contador EN VIVO de personas en la reunión (se ve en la ventana y en la píldora minimizada)
  try{
    const cntRef=_call.base.child('peers');
    const cntHandler=cntRef.on('value', s=>{ updateCallCount(s.exists()?Object.keys(s.val()||{}).length:0); });
    _call.refs.cntRef=cntRef; _call.refs.cntHandler=cntHandler;
  }catch(e){}
  audit('proyecto',`entró a la reunión de "${p.name}"`,p.sucursalId);   // audit() persiste/sincroniza
  notify(p.memberIds.filter(i=>i!==myId), `${m.name.split(' ')[0]} inició una reunión en "${p.name}"`,'video',{view:'proyectos'});
  // motor JaaS (Jitsi as a Service): SIN límite de tiempo, ~20 personas + pantalla compartida.
  // El "pase" (JWT) lo firma el servidor con la clave privada (api/meet-token).
  try{
    const r=await fetch('/api/meet-token?name='+encodeURIComponent(m.name||'')+'&uid='+encodeURIComponent(myId));
    if(!r.ok) throw new Error('token '+r.status);
    const tok=await r.json();
    if(!tok || !tok.jwt || !tok.appId) throw new Error('token vacío');
    if(!_call || _call.projId!==projId){ return; }   // colgó mientras cargaba
    await loadJitsi(tok.appId);
    if(!_call || _call.projId!==projId){ return; }
    body.innerHTML='';
    const api=new JitsiMeetExternalAPI('8x8.vc',{
      roomName: tok.appId+'/SaborTico-'+projId,   // sala única e impredecible (id de proyecto = UUID)
      jwt: tok.jwt,
      parentNode: body, width:'100%', height:'100%',
      configOverwrite:{ prejoinPageEnabled:false, disableDeepLinking:true, startWithAudioMuted:false, startWithVideoMuted:!video },
      interfaceConfigOverwrite:{ MOBILE_APP_PROMO:false, SHOW_JITSI_WATERMARK:false, SHOW_WATERMARK_FOR_GUESTS:false,
        TOOLBAR_BUTTONS:['microphone','camera','desktop','tileview','raisehand','chat','fullscreen','hangup','settings'] }
    });
    api.addEventListener('readyToClose', ()=>callHangup());
    _call.api=api;
    _callStarting=false;
    if(SES.userId) render();
  }catch(e){
    console.warn('meet', e);
    toast('Las reuniones aún no están configuradas (JaaS). Ver docs/CONECTAR-REUNIONES.md','err');
    endCall(true);
  }
}
function openCall(projId){ startCall(projId, false); }   // compatibilidad (voz)
function endCall(silent){
  if(!_call) return;
  const projId=_call.projId, myId=_call.myId, base=_call.base;
  try{ if(_call.api) _call.api.dispose(); }catch(e){}
  try{ if(_call.refs&&_call.refs.cntRef&&_call.refs.cntHandler){ _call.refs.cntRef.off('value', _call.refs.cntHandler); } }catch(e){}
  try{ if(_call.refs&&_call.refs.myPeerRef){ _call.refs.myPeerRef.onDisconnect().cancel(); } }catch(e){}
  try{ base.child('peers').child(myId).remove(); }catch(e){}
  _call=null; _callStarting=false;
  const d=document.getElementById('callDock'); if(d){ d.classList.add('hidden'); d.classList.remove('min'); d.style.left=d.style.top=d.style.right=d.style.bottom=''; const b=document.getElementById('cdBody'); if(b) b.innerHTML=''; }
  const p=projId&&DB.projects.find(x=>x.id===projId);
  if(p&&!silent) audit('proyecto',`salió de la reunión de "${p.name}"`,p.sucursalId);   // audit() persiste/sincroniza
  if(SES.userId) render();
}
window.addEventListener('pagehide', ()=>{ if(_call) endCall(true); });
function callHangup(){ endCall(false); }
function leaveCall(projId){ callHangup(); }   // compatibilidad
function updateCallCount(n){
  const el=document.getElementById('cdCount'); if(!el) return;
  if(n>0){ el.innerHTML=svgIcon('users','icon icon-sm')+' '+n; el.hidden=false; } else el.hidden=true;
}
function callDockToggleMin(){ const d=document.getElementById('callDock'); if(d) d.classList.toggle('min'); }
let _cdDrag=null;
function cdDragStart(e){
  if(e.target.closest('.cd-btn')) return;
  const d=document.getElementById('callDock'); if(!d) return;   // movible también minimizado
  const r=d.getBoundingClientRect(); _cdDrag={dx:e.clientX-r.left, dy:e.clientY-r.top};
  document.addEventListener('pointermove',cdDragMove); document.addEventListener('pointerup',cdDragEnd); e.preventDefault();
}
function cdDragMove(e){
  if(!_cdDrag) return; const d=document.getElementById('callDock'); const w=d.offsetWidth, h=d.offsetHeight;
  let x=Math.max(6,Math.min(window.innerWidth-w-6, e.clientX-_cdDrag.dx));
  let y=Math.max(6,Math.min(window.innerHeight-h-6, e.clientY-_cdDrag.dy));
  d.style.left=x+'px'; d.style.top=y+'px'; d.style.right='auto'; d.style.bottom='auto';
}
function cdDragEnd(){ document.removeEventListener('pointermove',cdDragMove); document.removeEventListener('pointerup',cdDragEnd); _cdDrag=null; }
window.startCall=startCall; window.openCall=openCall; window.callHangup=callHangup; window.leaveCall=leaveCall;
window.callDockToggleMin=callDockToggleMin; window.cdDragStart=cdDragStart;
window.addCard=addCard;

function newProjectModal(){
  const people=scopedPeople(false);
  openModal(`
    <div class="modal-head"><h3>Nuevo proyecto</h3><button class="modal-close" onclick="closeModal()">×</button></div>
    <div class="modal-body">
      <div class="field"><label>Nombre</label><input class="input" id="npName" placeholder="Ej: Remodelación del salón"></div>
      <div class="field"><label>Descripción</label><textarea class="textarea" id="npDescP" placeholder="¿De qué se trata?"></textarea></div>
      <div class="field"><label>¿Quiénes participan?</label>${peoplePicker('npMembers', people, [SES.userId])}</div>
      <div class="field"><label>Sucursal</label><select class="select" id="npSucP">${sucOptionsFor()}</select></div>
    </div>
    <div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">Cancelar</button><button class="btn btn-primary" onclick="createProject()">Crear proyecto</button></div>`);
}
window.newProjectModal=newProjectModal;
function createProject(){
  const name=$('#npName').value.trim(); if(!name){ toast('Ponele nombre','err'); return; }
  let members=pickedIds('npMembers');
  if(!members.includes(SES.userId)) members.push(SES.userId);
  const p={id:uid(),name,desc:$('#npDescP').value.trim(),memberIds:members,sucursalId:$('#npSucP').value,createdAt:now(),cards:[]};
  DB.projects.unshift(p); activeProj=p.id;
  audit('proyecto',`creó el proyecto "${name}"`,p.sucursalId);
  notify(members,`${me().name.split(' ')[0]} te agregó al proyecto "${name}"`,'📋',{view:'proyectos'});
  closeModal(); toast('Proyecto creado','ok'); render();
}
window.createProject=createProject;

function manageMembers(projId){
  const p=DB.projects.find(x=>x.id===projId); if(!p) return;
  const people=scopedPeople(false);
  openModal(`
    <div class="modal-head"><h3>Miembros · ${esc(p.name)}</h3><button class="modal-close" onclick="closeModal()">×</button></div>
    <div class="modal-body">${peoplePicker('mmPick', people, p.memberIds)}</div>
    <div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">Cancelar</button><button class="btn btn-primary" onclick="saveMembers('${projId}')">Guardar</button></div>`);
}
window.manageMembers=manageMembers;
function saveMembers(projId){
  const p=DB.projects.find(x=>x.id===projId); if(!p) return;
  const newM=pickedIds('mmPick');
  const added=newM.filter(i=>!p.memberIds.includes(i));
  p.memberIds=newM;
  if(added.length) notify(added,`${me().name.split(' ')[0]} te agregó al proyecto "${p.name}"`,'📋',{view:'proyectos'});
  audit('proyecto',`actualizó miembros de "${p.name}"`,p.sucursalId);
  closeModal(); toast('Miembros actualizados','ok'); render();
}
window.saveMembers=saveMembers;

/* =====================================================================
   VISTA: CHAT
   ===================================================================== */
function myChats(){
  return (DB.chats||[]).filter(c=> c && ((c.memberIds||[]).includes(SES.userId)||isAdmin()) )
    .sort((a,b)=>(lastMsgAt(b))-(lastMsgAt(a)));
}
function lastMsgAt(c){ const m=(c.msgs||[]).filter(x=>x&&!msgDeleted(x)); return m.length?m[m.length-1].at:(c.createdAt||0); }
function unreadChats(){
  let n=0; myChats().forEach(c=>{ if(chatUnread(c)>0) n++; }); return n;
}
function chatUnread(c){
  const seen=(DB._seen&&DB._seen[SES.userId]&&DB._seen[SES.userId][c.id])||0;
  return (c.msgs||[]).filter(m=>m && !msgDeleted(m) && m.byId!==SES.userId && m.at>seen).length;
}
function markSeen(c){
  DB._seen=DB._seen||{}; DB._seen[SES.userId]=DB._seen[SES.userId]||{};
  DB._seen[SES.userId][c.id]=now(); save();
}
/* ✓✓ leído: todos los demás miembros abrieron el chat después de este mensaje */
function msgReadByAll(c,m){
  const others=(c.memberIds||[]).filter(i=>i!==SES.userId);
  if(!others.length) return false;
  const seen=DB._seen||{};
  return others.every(uid=> ((seen[uid]||{})[c.id]||0) >= m.at);
}

function dayKey(ts){ const d=new Date(ts); return d.getFullYear()+'-'+d.getMonth()+'-'+d.getDate(); }
function dayLabel(ts){
  const d=new Date(ts), t=new Date(), y=new Date(); y.setDate(t.getDate()-1);
  if(d.toDateString()===t.toDateString()) return 'Hoy';
  if(d.toDateString()===y.toDateString()) return 'Ayer';
  return d.toLocaleDateString('es-CR', d.getFullYear()!==t.getFullYear()?{day:'2-digit',month:'short',year:'numeric'}:{day:'2-digit',month:'short'});
}
function viewChat(){
  const chats=myChats();
  const guide=sectionGuide('chat','¿Cómo funcionan los mensajes?',`
    Tenés <b>chats directos</b> con cualquier compañero y <b>grupos</b> de trabajo, como en WhatsApp.
    <ul style="margin:8px 0 0 18px">
      <li>Cualquiera puede <b>crear un grupo</b>; quien lo crea (o Administración) puede <b>editar el nombre, agregar/quitar miembros y eliminarlo</b>.</li>
      <li>Tocá el nombre del grupo arriba para ver su <b>info y miembros</b>, o <b>salir</b> del grupo.</li>
      <li>Podés <b>eliminar mensajes</b> (solo para vos o para todos).</li>
    </ul>`);

  let html=`<div class="page-head"><div><div class="page-title">Mensajes</div><div class="page-sub">${isAdmin()?'Vista total · Gerencia':'Tus chats y grupos'}</div></div>
    <div class="ph-spacer"></div>
    <button class="btn btn-ghost" style="flex:0 0 auto" onclick="newDMModal()">${svgIcon('message','icon icon-sm')} Nuevo chat</button>
    <button class="btn btn-primary" style="flex:0 0 auto" onclick="newGroupModal()">${svgIcon('users','icon icon-sm')} Nuevo grupo</button>
  </div>`;
  html+=guide;

  const mob = window.innerWidth<=780;
  let sel = SES.activeChat;
  if(!mob && !sel) sel = chats[0] && chats[0].id;   // en compu se abre el primero; en celular, lista primero (estilo WhatsApp)
  SES.activeChat = sel || null;
  const listHtml = chats.length? chats.map(c=>{
    const msgs=c.msgs||[]; const last=[...msgs].reverse().find(m=> m && !msgDeleted(m) && !((m.hiddenFor||[]).includes(SES.userId)));
    const mem=c.memberIds||[];
    const u=c.type==='group'?null:userById(mem.find(i=>i!==SES.userId));
    const name=c.type==='group'?c.name:(u?u.name:'Chat');
    const ur=chatUnread(c);
    const prevTxt = last
      ? ((c.type==='group' && last.byId!==SES.userId ? ((userById(last.byId)?.name||'').split(' ')[0]+': ') : (last.byId===SES.userId?'Vos: ':''))
         + (last.text || (last.media?(last.media.type==='video'?'🎬 Video':last.media.type==='audio'?'🎤 Nota de voz':'📷 Foto'):'')))
      : 'Sin mensajes';
    const lastT = last ? new Date(last.at).toLocaleTimeString('es-CR',{hour:'2-digit',minute:'2-digit'}) : '';
    return `<div class="chat-li ${sel===c.id?'sel':''} ${ur?'unread':''}" onclick="openChat('${c.id}')">
      ${c.type==='group'?`<div class="av" style="background:var(--accent)">${esc((c.name||'#')[0])}</div>`:avatarHTML(u)}
      <div class="cl-mid"><div class="cn">${esc(name)} ${c.type==='group'?'<span class="cl-grp">grupo</span>':''}</div>
      <div class="cp">${esc(prevTxt)}</div></div>
      <div class="cl-end">${lastT?`<span class="cl-time">${lastT}</span>`:''}${ur?`<span class="cbadge">${ur}</span>`:''}</div></div>`;
  }).join('') : `<div class="empty" style="padding:30px 14px"><div class="em-d">No hay chats. Creá uno.</div></div>`;

  const cur = chats.find(c=>c.id===sel);
  let paneHtml;
  if(cur){
    const curMem=cur.memberIds||[];
    const adminPeek = !curMem.includes(SES.userId) && isAdmin();
    const headName = cur.type==='group'?cur.name:(userById(curMem.find(i=>i!==SES.userId))?.name||'Chat');
    const visibleMsgs=(cur.msgs||[]).filter(m=> m && !msgDeleted(m) && !((m.hiddenFor||[]).includes(SES.userId)));
    let _lastDay='', _prevBy=null;
    const msgsHtml = visibleMsgs.map(m=>{
      const u=userById(m.byId); const mine=m.byId===SES.userId;
      const media = m.media ? (m.media.type==='video' ? mediaTag(m.media.mid||m.media.data,'video','controls') : m.media.type==='audio' ? audioMsgHTML(m.media.mid||m.media.data, m.media.dur) : mediaTag(m.media.mid||m.media.data,'image')) : '';
      let sep='';
      const dk=dayKey(m.at);
      if(dk!==_lastDay){ sep=`<div class="chat-day"><span>${esc(dayLabel(m.at))}</span></div>`; _lastDay=dk; _prevBy=null; }
      const grouped = _prevBy===m.byId; _prevBy=m.byId;
      const showName = !mine && cur.type==='group' && !grouped;
      const time = new Date(m.at).toLocaleTimeString('es-CR',{hour:'2-digit',minute:'2-digit'});
      const onlyMedia = media && !m.text && !(m.media&&m.media.type==='audio');
      const readAll = mine && msgReadByAll(cur,m);
      return sep + `<div class="msg ${mine?'mine':''} ${grouped?'grouped':''} ${onlyMedia?'media-only':''}" data-c="${cur.id}" data-m="${m.id}">${showName?`<div class="mname">${u?esc((u.name||'').split(' ')[0]):''}</div>`:''}${m.text?`<span class="mtext">${esc(m.text)}</span>`:''}${media}<div class="mtime">${time}${mine?svgIcon(readAll?'checks':'check','icon icon-sm'+(readAll?' read':'')):''}<button class="msg-del" title="Eliminar" onclick="delMsgMenu('${cur.id}','${m.id}')">${svgIcon('trash','icon icon-sm')}</button></div></div>`;
    }).join('');
    const other = cur.type!=='group' ? userById(curMem.find(i=>i!==SES.userId)) : null;
    const headSub = cur.type==='group' ? curMem.length+' miembros · tocá para ver info' : (other&&ROLES[other.role]?ROLES[other.role].label:'Chat directo');
    paneHtml=`<div class="chat-pane" id="chatPane">
      <div class="chat-head" ondblclick="screenDiag()">
        <button class="icon-btn mobile-only chat-back" title="Volver a chats" onclick="backChatList()">${svgIcon('back','icon')}</button>
        <div class="chat-head-main" ${cur.type==='group'?`onclick="groupInfoModal('${cur.id}')" style="cursor:pointer"`:''}>
          ${cur.type==='group'?`<div class="av" style="background:var(--grad-accent)">${esc((cur.name||'#')[0])}</div>`:avatarHTML(other)}
          <div style="min-width:0"><div class="chat-head-name">${esc(headName)}</div><div class="chat-head-sub">${esc(headSub)}</div></div>
        </div>
        <div class="ph-spacer"></div>
        ${adminPeek?`<span class="admin-eye">👁️ Gerencia</span>`:''}
        ${cur.type!=='group'?`<button class="icon-btn" style="width:38px;height:38px" title="Llamar por WhatsApp" onclick="waCall('${curMem.find(i=>i!==SES.userId)}')">${svgIcon('phone','icon icon-sm')}</button>`:''}
        ${cur.type==='group'?`<button class="icon-btn" style="width:38px;height:38px" title="Info del grupo" onclick="groupInfoModal('${cur.id}')">${svgIcon('info','icon icon-sm')}</button>`:''}
      </div>
      <div class="chat-msgs" id="chatMsgs">${msgsHtml||'<div style="margin:auto;color:var(--text-soft);font-size:13px">Escribí el primer mensaje 👋</div>'}</div>
      <button class="chat-jump" id="chatJump" title="Ir al final" onclick="chatJumpBottom()"><svg class="icon" viewBox="0 0 24 24" style="transform:rotate(-90deg)"><use href="#i-back"/></svg></button>
      ${curMem.includes(SES.userId)?`
        ${chatPending?`<div class="chat-pending">${chatPending.type==='video'?`<video src="${safeVid(chatPending.data)}"></video>`:chatPending.type==='audio'?vaPreviewHTML(chatPending.data,chatPending.dur):`<img src="${safeImg(chatPending.data)}">`}<span>${chatPending.type==='video'?'Video':chatPending.type==='audio'?'Nota de voz':'Foto'} lista para enviar</span><button class="btn btn-ghost" style="padding:5px 10px;margin-left:auto" onclick="chatPending=null;render()">Quitar</button></div>`:''}
        ${vaRecording(cur.id)?`<div class="chat-input chat-rec">
          <button class="chat-attach rec-cancel" title="Cancelar" onclick="vaRecCancel()">${svgIcon('trash')}</button>
          <div class="rec-mid"><span class="rec-dot"></span><span id="vaRecTime">0:00</span> <span class="rec-lbl">Grabando…</span></div>
          <button class="chat-send" title="Listo" onclick="vaRecStop()">${svgIcon('check')}</button>
        </div>`:`<div class="chat-input chat-swap ${chatPending?'has-text':''}">
          <input type="file" id="chatFile" accept="image/*,video/*" style="display:none" onchange="chatAttachPick('${cur.id}')">
          <button class="chat-attach" title="Adjuntar foto o video" onclick="document.getElementById('chatFile').click()">${svgIcon('plus')}</button>
          <div class="chat-field">
            <input id="chatField" placeholder="Mensaje" oninput="chatTyping(this)" onkeydown="if(event.key==='Enter')sendMsg('${cur.id}')">
          </div>
          <button class="chat-send chat-mic" title="Grabar nota de voz" onclick="vaRecStart('${cur.id}')">${svgIcon('mic')}</button>
          <button class="chat-send chat-sendbtn" title="Enviar" onclick="sendMsg('${cur.id}')">${svgIcon('send')}</button>
        </div>`}`
        :`<div class="chat-input" style="justify-content:center;color:var(--text-soft);font-size:12px">Solo lectura — no sos miembro de este chat</div>`}
    </div>`;
  } else {
    paneHtml=`<div class="chat-pane"><div class="empty" style="margin:auto"><div class="em-ico">💬</div><div class="em-t">Elegí un chat</div></div></div>`;
  }

  html+=`<div class="chat-wrap"><div class="chat-list" id="chatList">${listHtml}</div>${paneHtml}</div>`;
  return html;
}
function afterChatRender(){
  const m=$('#chatMsgs');
  if(m){
    // marcar cuándo el usuario está tocando/deslizando: los re-anclajes se pausan
    m._tch=false;
    m.addEventListener('touchstart',()=>{ m._tch=true; },{passive:true});
    m.addEventListener('touchend',()=>{ setTimeout(()=>{ m._tch=false; },600); },{passive:true});
    m.addEventListener('touchcancel',()=>{ m._tch=false; },{passive:true});
    // anclar al final SIN animación y re-anclar mientras cargan fotos/notas
    // (solo si el usuario sigue abajo y no está tocando, para no pelear con su dedo)
    m.scrollTop=m.scrollHeight;
    const pin=()=>{ if(!m._tch && m.scrollHeight-m.scrollTop-m.clientHeight < 120) m.scrollTop=m.scrollHeight; };
    requestAnimationFrame(()=>{ m.scrollTop=m.scrollHeight; });
    setTimeout(pin,120); setTimeout(pin,350); setTimeout(pin,900);
  }
  const cur=DB.chats.find(c=>c.id===SES.activeChat);
  if(cur) markSeen(cur);
  // celular: con chat abierto = pantalla completa (estilo WhatsApp); sin chat = lista
  if(window.innerWidth<=780){
    const list=$('#chatList'), pane=$('#chatPane');
    if(SES.activeChat && cur){ if(list)list.classList.add('hide-mobile'); if(pane)pane.classList.remove('hide-mobile'); document.body.classList.add('chat-open'); }
    else { if(list)list.classList.remove('hide-mobile'); if(pane)pane.classList.add('hide-mobile'); document.body.classList.remove('chat-open'); }
  } else { document.body.classList.remove('chat-open'); }
  // botón "bajar al final" cuando el usuario scrollea hacia arriba
  const jump=$('#chatJump');
  if(m && jump){
    const upd=()=>jump.classList.toggle('on', m.scrollHeight-m.scrollTop-m.clientHeight>350);
    m.onscroll=upd; upd();
  }
  // celular: mantener presionado un mensaje = menú de eliminar (como WhatsApp)
  if(m && !m._lpWired){
    m._lpWired=true;
    let lpT=null, lpMoved=false;
    m.addEventListener('touchstart',e=>{
      const b=e.target.closest('.msg'); if(!b) return;
      lpMoved=false;
      lpT=setTimeout(()=>{ if(!lpMoved){ const cid=b.getAttribute('data-c'), mid=b.getAttribute('data-m'); if(cid&&mid){ try{ if(navigator.vibrate) navigator.vibrate(12); }catch(_){}; delMsgMenu(cid,mid); } } },480);
    },{passive:true});
    m.addEventListener('touchmove',()=>{ lpMoved=true; clearTimeout(lpT); },{passive:true});
    m.addEventListener('touchend',()=>clearTimeout(lpT),{passive:true});
  }
}
function chatTyping(inp){ const w=inp.closest('.chat-input'); if(!w) return; const pend=(inp.id==='projMsg')?projPending:chatPending; w.classList.toggle('has-text', !!inp.value.trim() || !!pend); }
window.chatTyping=chatTyping;
/* Diagnóstico de pantalla: medidas reales del dispositivo para cazar problemas de encaje.
   Se abre desde el menú de usuario o con doble toque en el encabezado del chat. */
function screenDiag(){
  let txt='';
  try{
    const rect=sel=>{ const e=document.querySelector(sel); if(!e) return '—'; const b=e.getBoundingClientRect(); return `${Math.round(b.left)},${Math.round(b.top)} ${Math.round(b.width)}×${Math.round(b.height)}`; };
    const vv=window.visualViewport;
    const app=document.getElementById('app'); const cs=app?getComputedStyle(app):null;
    const rootCS=getComputedStyle(document.documentElement);
    const meta=document.querySelector('meta[name="viewport"]');
    txt=[
      APP_VERSION,
      `ventana: ${window.innerWidth}×${window.innerHeight}  dpr:${devicePixelRatio}`,
      `docEl: ${document.documentElement.clientWidth}×${document.documentElement.clientHeight}`,
      `pantalla: ${screen.width}×${screen.height}`,
      vv?`vv: ${Math.round(vv.width)}×${Math.round(vv.height)}  escala:${(+vv.scale).toFixed(3)}  off:${Math.round(vv.offsetLeft)},${Math.round(vv.offsetTop)}`:'vv: no disponible',
      `app: ${rect('#app')}  pos:${cs?cs.position:'—'} left:${cs?cs.left:'—'} w:${cs?cs.width:'—'}`,
      `main: ${rect('.main')}`,
      `view: ${rect('#view')}`,
      `chatwrap: ${rect('.chat-wrap')}  head: ${rect('.chat-head')}`,
      `body: ${document.body.className||'(sin clases)'}`,
      `media≤780: ${matchMedia('(max-width:780px)').matches}`,
      `--app-w:${rootCS.getPropertyValue('--app-w')||'—'}  --app-left:${rootCS.getPropertyValue('--app-left')||'—'}`,
      `--app-h:${rootCS.getPropertyValue('--app-h')||'—'}  --app-top:${rootCS.getPropertyValue('--app-top')||'—'}`,
      `meta: ${meta?meta.getAttribute('content'):'—'}`,
    ].join('\n');
  }catch(e){ txt='Error del diagnóstico: '+e.message; }
  try{
    openModal(`
      <div class="modal-head"><h3>${svgIcon('info','icon')} Diagnóstico de pantalla</h3><button class="modal-close" onclick="closeModal()">${svgIcon('x','icon')}</button></div>
      <div class="modal-body"><pre style="font-size:12px;line-height:1.8;white-space:pre-wrap;word-break:break-word;font-family:ui-monospace,Menlo,Consolas,monospace;margin:0">${esc(txt)}</pre>
      <div class="td-empty" style="margin-top:10px">Mandale una captura de esto a soporte para diagnosticar el encaje de pantalla.</div></div>`, false);
  }catch(e){ try{ alert(txt); }catch(_){} }
}
window.screenDiag=screenDiag;
window.chatJumpBottom=()=>{ const m=$('#chatMsgs'); if(m) m.scrollTo({top:m.scrollHeight,behavior:'smooth'}); };
window.openChat=id=>{ SES.activeChat=id; render(); };
window.backChatList=()=>{ SES.activeChat=null; document.body.classList.remove('chat-open'); render(); };

/* =================== NOTAS DE VOZ =================== */
function vaFmtDur(s){ s=Math.max(0,Math.round(+s||0)); return Math.floor(s/60)+':'+String(s%60).padStart(2,'0'); }
function audioMsgHTML(mid, dur){
  const d=mediaData(mid); const safe=(d!==undefined)?safeAud(d):'';
  return `<div class="va-player">
    <button type="button" class="va-play" onclick="vaToggle(this)">${svgIcon('play','icon icon-sm')}</button>
    <div class="va-bar" onclick="vaSeek(event,this)"><div class="va-fill"></div></div>
    <span class="va-time">${vaFmtDur(dur)}</span>
    <audio class="va-audio" data-mid="${esc(mid)}" ${safe?`src="${safe}"`:''} preload="metadata" ontimeupdate="vaTick(this)" onplay="vaState(this,1)" onpause="vaState(this,0)" onended="vaEnd(this)" onloadedmetadata="vaTick(this)"></audio>
  </div>`;
}
function vaPreviewHTML(data, dur){
  return `<div class="va-player"><button type="button" class="va-play" onclick="vaToggle(this)">${svgIcon('play','icon icon-sm')}</button><div class="va-bar" onclick="vaSeek(event,this)"><div class="va-fill"></div></div><span class="va-time">${vaFmtDur(dur)}</span><audio class="va-audio" src="${safeAud(data)}" preload="metadata" ontimeupdate="vaTick(this)" onplay="vaState(this,1)" onpause="vaState(this,0)" onended="vaEnd(this)" onloadedmetadata="vaTick(this)"></audio></div>`;
}
function vaToggle(btn){
  const p=btn.closest('.va-player'); const a=p&&p.querySelector('.va-audio'); if(!a) return;
  document.querySelectorAll('.va-audio').forEach(x=>{ if(x!==a && !x.paused) x.pause(); });
  if(a.paused){
    if(!a.getAttribute('src')){ const mid=a.getAttribute('data-mid'); fetchMediaData(mid).then(d=>{ const safe=safeAud(d); if(safe){ a.src=safe; a.play().catch(()=>{}); } else toast('No se pudo cargar la nota de voz','err'); }); return; }
    a.play().catch(()=>{});
  } else a.pause();
}
function vaTick(a){ const p=a.closest('.va-player'); if(!p) return; const f=p.querySelector('.va-fill'), t=p.querySelector('.va-time');
  const dur=(isFinite(a.duration)&&a.duration>0)?a.duration:0; const cur=a.currentTime||0;
  if(f) f.style.width=(dur?cur/dur*100:0)+'%';
  if(t) t.textContent=(a.paused&&cur===0)?vaFmtDur(dur):vaFmtDur(dur?dur-cur:cur);
}
function vaState(a,playing){ const p=a.closest('.va-player'); if(!p) return; const b=p.querySelector('.va-play'); if(b) b.innerHTML=svgIcon(playing?'pause':'play','icon icon-sm'); }
function vaEnd(a){ try{ a.currentTime=0; }catch(_){} vaState(a,0); const p=a.closest('.va-player'); const f=p&&p.querySelector('.va-fill'); if(f) f.style.width='0%'; vaTick(a); }
function vaSeek(ev,bar){ const a=bar.closest('.va-player').querySelector('.va-audio'); if(!a||!isFinite(a.duration)||!a.duration) return; const r=bar.getBoundingClientRect(); a.currentTime=Math.max(0,Math.min(1,(ev.clientX-r.left)/r.width))*a.duration; vaTick(a); }
window.vaToggle=vaToggle; window.vaTick=vaTick; window.vaState=vaState; window.vaEnd=vaEnd; window.vaSeek=vaSeek;
/* grabación */
let _vaRec=null;   // {mr, chunks, stream, chatId, t0, timer, cancel}
function vaRecording(chatId){ return _vaRec && _vaRec.chatId===chatId; }
async function vaRecStart(chatId, isProj){
  if(_vaRec) return;
  if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia||typeof MediaRecorder==='undefined'){ toast('Tu dispositivo no permite grabar audio','err'); return; }
  let stream; try{ stream=await navigator.mediaDevices.getUserMedia({audio:true}); }catch(e){ toast('No se pudo usar el micrófono','err'); return; }
  let mime=''; ['audio/webm;codecs=opus','audio/webm','audio/mp4','audio/ogg'].some(m=>{ try{ if(MediaRecorder.isTypeSupported(m)){ mime=m; return true; } }catch(_){} return false; });
  let mr; try{ mr=mime?new MediaRecorder(stream,{mimeType:mime}):new MediaRecorder(stream); }catch(_){ mr=new MediaRecorder(stream); }
  const chunks=[];
  mr.ondataavailable=e=>{ if(e.data&&e.data.size) chunks.push(e.data); };
  mr.onstop=()=>{ try{ stream.getTracks().forEach(t=>t.stop()); }catch(_){} vaRecFinish(); };
  _vaRec={mr, chunks, stream, chatId, isProj:!!isProj, t0:Date.now(), cancel:false, timer:null};
  try{ mr.start(); }catch(e){ try{stream.getTracks().forEach(t=>t.stop());}catch(_){}; _vaRec=null; toast('No se pudo iniciar la grabación','err'); return; }
  _vaRec.timer=setInterval(()=>{ const el=document.getElementById('vaRecTime'); if(el&&_vaRec) el.textContent=vaFmtDur((Date.now()-_vaRec.t0)/1000); }, 300);
  render();
}
function vaRecStop(){ if(!_vaRec) return; try{ _vaRec.mr.stop(); }catch(_){ vaRecFinish(); } }
function vaRecCancel(){ if(!_vaRec) return; _vaRec.cancel=true; try{ _vaRec.mr.stop(); }catch(_){ try{_vaRec.stream.getTracks().forEach(t=>t.stop());}catch(__){}; if(_vaRec&&_vaRec.timer)clearInterval(_vaRec.timer); _vaRec=null; render(); } }
function vaRecFinish(){
  const r=_vaRec; if(!r) return; if(r.timer) clearInterval(r.timer);
  if(r.cancel){ _vaRec=null; render(); return; }
  const dur=Math.round((Date.now()-r.t0)/1000); const isProj=r.isProj;
  const blob=new Blob(r.chunks, {type:(r.mr&&r.mr.mimeType)?r.mr.mimeType.split(';')[0]:'audio/webm'});
  _vaRec=null;
  if(!blob.size || dur<1){ toast('Grabación muy corta','err'); render(); return; }
  if(blob.size>6*1024*1024){ toast('La nota de voz es muy larga (máx ~6 MB)','err'); render(); return; }
  const rd=new FileReader(); rd.onload=()=>{ if(isProj) projPending={type:'audio', data:rd.result, dur}; else chatPending={type:'audio', data:rd.result, dur}; render(); }; rd.readAsDataURL(blob);
}
window.vaRecStart=vaRecStart; window.vaRecStop=vaRecStop; window.vaRecCancel=vaRecCancel;
let chatPending=null;
function fileToData(f){ return new Promise(r=>{const rd=new FileReader();rd.onload=()=>r(rd.result);rd.readAsDataURL(f);}); }
async function chatAttachPick(chatId){
  const inp=$('#chatFile'); const f=inp&&inp.files[0]; if(!f) return;
  if(f.type.startsWith('video')){
    if(f.size>6*1024*1024){ toast('El video es muy pesado (máx. 6 MB)','err'); return; }
    chatPending={type:'video',data:await fileToData(f)};
  } else if(f.type.startsWith('image')){
    const arr=await readImages([f]); chatPending={type:'image',data:arr[0]};
  } else { toast('Solo fotos o videos','err'); return; }
  render();
}
window.chatAttachPick=chatAttachPick;
async function sendMsg(chatId){
  const c=DB.chats.find(x=>x.id===chatId); if(!c) return;
  const f=$('#chatField'); const txt=f?f.value.trim():'';
  if(!txt && !chatPending) return;
  const m={id:uid(),byId:SES.userId,text:txt,at:now()};
  if(chatPending){ const mid=await putMedia(chatPending.data); m.media={type:chatPending.type,mid}; if(chatPending.dur!=null) m.media.dur=chatPending.dur; }
  c.msgs.push(m);
  const preview = txt? txt.slice(0,40) : (chatPending? (chatPending.type==='video'?'envió un video':chatPending.type==='audio'?'envió una nota de voz':'envió una foto') : '');
  notify(c.memberIds.filter(i=>i!==SES.userId), `${me().name.split(' ')[0]} (${c.type==='group'?c.name:'directo'}): ${preview}`, 'msg', {view:'chat',chatId});
  chatPending=null; markSeen(c); save(); render();
}
window.sendMsg=sendMsg;
function delMsgMenu(chatId,msgId){
  const c=DB.chats.find(x=>x.id===chatId); if(!c) return;
  const m=(c.msgs||[]).find(x=>x.id===msgId); if(!m) return;
  const forAll = (m.byId===SES.userId || isAdmin());
  openModal(`<div class="modal-head"><h3>Eliminar mensaje</h3><button class="modal-close" onclick="closeModal()">${svgIcon('x','icon')}</button></div>
  <div class="modal-body">
    <div style="display:flex;flex-direction:column;gap:10px">
      <button class="btn btn-ghost" style="justify-content:flex-start" onclick="delMsg('${chatId}','${msgId}','me')">${svgIcon('trash','icon icon-sm')} Eliminar solo para mí</button>
      ${forAll?`<button class="btn btn-danger" style="justify-content:flex-start" onclick="delMsg('${chatId}','${msgId}','all')">${svgIcon('trash','icon icon-sm')} Eliminar para todos</button>`:''}
    </div>
    <div style="font-size:12px;color:var(--text-soft);margin-top:12px">${forAll?'“Para todos” lo borra del chat de todas las personas, en todos los dispositivos.':'Solo podés borrar “para todos” tus propios mensajes. Este se ocultará únicamente para vos.'}</div>
  </div>`);
}
async function delMsg(chatId,msgId,scope){
  const c=DB.chats.find(x=>x.id===chatId); if(!c) return;
  const m=(c.msgs||[]).find(x=>x.id===msgId); if(!m) return;
  if(scope==='all'){
    if(!(m.byId===SES.userId || isAdmin())) return;
    m.delAt=now();   // borrado suave por marca temporal: sobrevive la reconciliación y permite Deshacer
    audit('chat','eliminó un mensaje para todos',c.sucursalId);
  } else {
    m.hiddenFor=m.hiddenFor||[]; if(!m.hiddenFor.includes(SES.userId)) m.hiddenFor.push(SES.userId);
  }
  closeModal(); save(); render();
  undoToast('Mensaje', ()=>{ if(scope==='all') m.revAt=now(); else m.hiddenFor=(m.hiddenFor||[]).filter(u=>u!==SES.userId); save(); render(); toast('Restaurado','ok'); });
}
window.delMsgMenu=delMsgMenu; window.delMsg=delMsg;

function newDMModal(){
  const people=scopedPeople(true);
  openModal(`
    <div class="modal-head"><h3>Nuevo chat directo</h3><button class="modal-close" onclick="closeModal()">×</button></div>
    <div class="modal-body"><div class="field"><label>¿Con quién?</label>
      ${peoplePicker('dmPick', people, [], {single:'startDM'})}</div></div>`);
}
window.newDMModal=newDMModal;
function startDM(otherId){
  let c=DB.chats.find(x=>x.type==='dm'&&x.memberIds.length===2&&x.memberIds.includes(SES.userId)&&x.memberIds.includes(otherId));
  if(!c){ c={id:uid(),type:'dm',name:'',memberIds:[SES.userId,otherId],sucursalId:me().sucursalId,createdById:SES.userId,createdAt:now(),msgs:[]}; DB.chats.unshift(c); save(); }
  closeModal(); SES.activeChat=c.id; SES.view='chat'; render();
}
window.startDM=startDM;
/* Llamar por WhatsApp al teléfono del perfil de la persona del chat directo */
function waNormalize(raw){
  let d=(raw||'').replace(/\D/g,'');            // dejar solo dígitos
  if(!d) return '';
  if(d.startsWith('00')) d=d.slice(2);          // 00 internacional -> quitar
  if(d.length===8) d='506'+d;                   // Costa Rica: 8 dígitos locales -> anteponer 506
  return d;
}
function waCall(userId){
  const u=userById(userId);
  if(!u){ toast('No se encontró la persona','err'); return; }
  const phone=waNormalize(u.phone);
  if(!phone){ toast('Esta persona no tiene teléfono en su perfil. Agregalo en Equipo → Editar.','err'); return; }
  window.open('https://wa.me/'+phone, '_blank');   // abre WhatsApp con ese contacto (ahí tocás llamar)
}
window.waCall=waCall;

function newGroupModal(){
  const people=scopedPeople(false);
  openModal(`
    <div class="modal-head"><h3>Nuevo grupo</h3><button class="modal-close" onclick="closeModal()">×</button></div>
    <div class="modal-body">
      <div class="field"><label>Nombre del grupo</label><input class="input" id="ngName" placeholder="Ej: Cocina Central"></div>
      <div class="field"><label>Miembros</label>${peoplePicker('ngMembers', people, [SES.userId])}</div>
      <div class="field"><label>Sucursal</label><select class="select" id="ngSuc">${sucOptionsFor()}</select></div>
    </div>
    <div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">Cancelar</button><button class="btn btn-primary" onclick="createGroup()">Crear grupo</button></div>`);
}
window.newGroupModal=newGroupModal;
function createGroup(){
  const name=$('#ngName').value.trim(); if(!name){ toast('Ponele nombre al grupo','err'); return; }
  let members=pickedIds('ngMembers');
  if(!members.includes(SES.userId)) members.push(SES.userId);
  const c={id:uid(),type:'group',name,memberIds:members,sucursalId:$('#ngSuc').value,createdById:SES.userId,createdAt:now(),msgs:[]};
  DB.chats.unshift(c);
  audit('chat',`creó el grupo "${name}"`,c.sucursalId);
  notify(members,`Te agregaron al grupo "${name}"`,'💬',{view:'chat',chatId:c.id});
  closeModal(); SES.activeChat=c.id; toast('Grupo creado','ok'); render();
}
window.createGroup=createGroup;

/* ---- Gestión de grupos (tipo WhatsApp) ---- */
function canManageGroup(c){ return !!c && (c.createdById===SES.userId || isAdmin()); }
function groupInfoModal(id){
  const c=DB.chats.find(x=>x.id===id); if(!c||c.type!=='group') return;
  const manage=canManageGroup(c);
  const isMember=(c.memberIds||[]).includes(SES.userId);
  const members=(c.memberIds||[]).map(i=>userById(i)).filter(Boolean);
  const rows=members.map(u=>{
    const isCreator=u.id===c.createdById, meu=u.id===SES.userId;
    return `<div class="gi-member">${avatarHTML(u)}
      <div class="gi-m-main"><div class="gi-m-name">${esc(u.name)}${meu?' <span class="pill proceso">vos</span>':''}</div><div class="gi-m-sub">${isCreator?'Creador del grupo':roleInfo(u.role).short}</div></div>
      ${(manage&&!isCreator)?`<button class="icon-btn" style="width:32px;height:32px;flex:0 0 auto" title="Quitar del grupo" onclick="groupRemoveMember('${c.id}','${u.id}')">${svgIcon('x','icon icon-sm')}</button>`:''}</div>`;
  }).join('');
  openModal(`<div class="modal-head"><h3>Info del grupo</h3><button class="modal-close" onclick="closeModal()">${svgIcon('x','icon')}</button></div>
    <div class="modal-body">
      <div class="gi-head"><div class="av gi-av" style="background:var(--grad-accent)">${esc((c.name||'#')[0])}</div>
        ${manage?`<input class="input gi-name" id="giName" value="${esc(c.name||'')}" placeholder="Nombre del grupo" autocomplete="off">`:`<div class="gi-title">${esc(c.name||'')}</div>`}
      </div>
      <div class="gi-sec"><span>Miembros · ${members.length}</span>${manage?`<button type="button" class="pe-link" onclick="groupAddMembersModal('${c.id}')">${svgIcon('plus','icon icon-sm')} Agregar</button>`:''}</div>
      <div class="gi-list">${rows||'<div style="color:var(--text-soft);font-size:13px;padding:8px 0">Sin miembros.</div>'}</div>
      <div class="gi-actions">
        ${isMember?`<button class="btn btn-ghost" onclick="leaveGroup('${c.id}')">${svgIcon('logout','icon icon-sm')} Salir del grupo</button>`:''}
        ${manage?`<button class="btn btn-danger" onclick="delGroup('${c.id}')">${svgIcon('trash','icon icon-sm')} Eliminar grupo</button>`:''}
      </div>
    </div>
    ${manage
      ? `<div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">Cerrar</button><button class="btn btn-primary" onclick="groupRename('${c.id}')">${svgIcon('check','icon icon-sm')} Guardar</button></div>`
      : `<div class="modal-foot"><button class="btn btn-primary" onclick="closeModal()">Cerrar</button></div>`}`, true);
}
function groupRename(id){
  const c=DB.chats.find(x=>x.id===id); if(!c||!canManageGroup(c)) return;
  const n=$('#giName'); const name=n?n.value.trim():''; if(!name){ toast('Ponele nombre al grupo','err'); return; }
  if(name!==c.name){ c.name=name; audit('chat',`renombró el grupo a "${name}"`,c.sucursalId); }
  closeModal(); toast('Grupo actualizado','ok'); save(); render();
}
function groupAddMembersModal(id){
  const c=DB.chats.find(x=>x.id===id); if(!c||!canManageGroup(c)) return;
  const avail=scopedPeople(false).filter(u=>!(c.memberIds||[]).includes(u.id));
  if(!avail.length){ toast('Ya están todos en el grupo','ok'); return; }
  openModal(`<div class="modal-head"><h3>Agregar miembros</h3><button class="modal-close" onclick="closeModal()">${svgIcon('x','icon')}</button></div>
    <div class="modal-body"><div class="field"><label>Elegí a quién agregar a "${esc(c.name)}"</label>${peoplePicker('gaMembers', avail, [])}</div></div>
    <div class="modal-foot"><button class="btn btn-ghost" onclick="groupInfoModal('${c.id}')">Volver</button><button class="btn btn-primary" onclick="groupAddMembers('${c.id}')">${svgIcon('plus','icon icon-sm')} Agregar</button></div>`);
}
function groupAddMembers(id){
  const c=DB.chats.find(x=>x.id===id); if(!c||!canManageGroup(c)) return;
  const add=pickedIds('gaMembers');
  if(!add.length){ toast('Elegí al menos una persona','err'); return; }
  add.forEach(uid=>{ if(!c.memberIds.includes(uid)) c.memberIds.push(uid); });
  audit('chat',`agregó ${add.length} miembro(s) al grupo "${c.name}"`,c.sucursalId);
  notify(add,`Te agregaron al grupo "${c.name}"`,'msg',{view:'chat',chatId:c.id});
  toast('Miembros agregados','ok'); save(); render(); groupInfoModal(id);
}
function groupRemoveMember(id,uid){
  const c=DB.chats.find(x=>x.id===id); if(!c||!canManageGroup(c)) return;
  if(uid===c.createdById){ toast('No se puede quitar al creador del grupo','err'); return; }
  c.memberIds=(c.memberIds||[]).filter(i=>i!==uid);
  const u=userById(uid);
  audit('chat',`quitó a ${u?u.name.split(' ')[0]:'alguien'} del grupo "${c.name}"`,c.sucursalId);
  save(); render(); groupInfoModal(id);
}
async function leaveGroup(id){
  const c=DB.chats.find(x=>x.id===id); if(!c) return;
  if(!await confirmDialog(`Vas a salir del grupo "${c.name}". Podés volver si te agregan de nuevo.`,{title:'¿Salir del grupo?',okText:'Sí, salir'})) return;
  c.memberIds=(c.memberIds||[]).filter(i=>i!==SES.userId);
  audit('chat',`salió del grupo "${c.name}"`,c.sucursalId);
  closeModal(); SES.activeChat=null; toast('Saliste del grupo','ok'); save(); render();
}
async function delGroup(id){
  const c=DB.chats.find(x=>x.id===id); if(!c||!canManageGroup(c)) return;
  if(!await confirmDialog(`Se elimina el grupo "${c.name}" y todos sus mensajes, para todos. No se puede deshacer.`,{title:'¿Eliminar grupo?',okText:'Sí, eliminar'})) return;
  tomb(id); DB.chats=DB.chats.filter(x=>x.id!==id);
  audit('chat',`eliminó el grupo "${c.name}"`,c.sucursalId);
  closeModal(); SES.activeChat=null; save(); render(); undoDelete('chats', c, 'Grupo '+c.name);
}
window.groupInfoModal=groupInfoModal; window.groupRename=groupRename; window.groupAddMembersModal=groupAddMembersModal;
window.groupAddMembers=groupAddMembers; window.groupRemoveMember=groupRemoveMember; window.leaveGroup=leaveGroup; window.delGroup=delGroup;

/* =====================================================================
   VISTA: EQUIPO (admin)
   ===================================================================== */
function viewEquipo(){
  const manage=isAdmin();                                                   // crear / editar / borrar
  const seeRRHH=hasRole('admin','contarh','gerencia_exp','gerencia_data');  // ver solicitudes a RRHH
  const cols=manage?5:3;
  const guide=sectionGuide('equipo','Equipo y Personal',`
    Directorio del equipo <b>por sucursal y departamento</b>${seeRRHH?', y las <b>solicitudes a RRHH</b> (permisos, adelantos, vacaciones)':''}.
    ${manage?'<div class="tip"><b>Administración:</b> creás, editás y eliminás usuarios y sucursales. El puesto define qué ve y hace cada quien — asignalo con criterio.</div>':'<div class="tip"><b>Tip:</b> es solo de consulta para tu rol. Para altas/cambios, escribile a Administración.</div>'}`);
  const peopleScope=DB.users.filter(u=>u.active && inScope(u.sucursalId));
  const sucScope=DB.sucursales.filter(s=>inScope(s.id));
  let html=`<div class="page-head"><div><div class="page-title">Equipo</div><div class="page-sub">${peopleScope.length} personas · ${sucScope.length} ${sucScope.length===1?'sucursal':'sucursales'}</div></div>
    <div class="ph-spacer"></div>
    ${manage?`<button class="btn btn-ghost" style="flex:0 0 auto" onclick="newSucModal()">+ Sucursal</button>
    <button class="btn btn-primary" style="flex:0 0 auto" onclick="newUserModal()">+ Persona</button>`:''}</div>`;
  html+=guide;
  const validIds=new Set(['all',...DB.sucursales.map(s=>s.id)]);
  const orphans=manage?DB.users.filter(u=>!validIds.has(u.sucursalId)).sort(byDept):[];
  const groups=[{id:'all',name:'Todas las sucursales (global)'},...sucScope];
  if(orphans.length) groups.push({id:'__orphan',name:'Sin sucursal (revisar / eliminar)'});
  groups.forEach(g=>{
    const people=g.id==='__orphan'?orphans:DB.users.filter(u=>u.sucursalId===g.id && (manage||u.active)).sort(byDept);
    if(g.id==='all' && !people.length) return;                              // no mostrar el grupo global vacío
    const editBtn=(manage&&g.id!=='all'&&g.id!=='__orphan')?`<button class="icon-btn" style="width:32px;height:32px" title="Renombrar sucursal" onclick="sucEditModal('${g.id}')">${svgIcon('edit','icon icon-sm')}</button><button class="icon-btn" style="width:32px;height:32px" title="Eliminar sucursal" onclick="delSuc('${g.id}')">${svgIcon('trash','icon icon-sm')}</button>`:'';
    html+=`<div class="page-head" style="margin:20px 0 10px;align-items:center"><div class="page-title" style="font-size:16px;display:flex;align-items:center;gap:8px">${svgIcon('pin','icon')} ${esc(g.name)}</div><div class="page-sub" style="margin:0 0 0 6px">· ${people.length} ${people.length===1?'persona':'personas'}</div><div class="ph-spacer"></div>${editBtn}</div>`;
    if(!people.length){ html+=`<div class="card" style="color:var(--text-soft);font-size:13px">Sin personas en esta sucursal.</div>`; return; }
    html+=`<div class="card"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Persona</th><th>Puesto</th><th>Teléfono</th>${manage?'<th>Estado</th><th></th>':''}</tr></thead><tbody>`;
    let lastD=-1;
    html+=people.map(u=>{
      const dr=deptRank(u.role); let head='';
      if(dr!==lastD){ lastD=dr; head=`<tr class="grp-row"><td colspan="${cols}">${esc(deptLabel(u.role))}</td></tr>`; }
      return head+`<tr>
      <td><div style="display:flex;align-items:center;gap:10px">${avatarHTML(u)}<div><div style="font-weight:600">${esc(u.name)}</div>${manage?`<div style="font-size:11px;color:var(--text-soft)">${u.mustChangePin?'PIN temporal · sin definir':'PIN ••••'}</div>`:''}</div></div></td>
      <td><span class="role-badge">${roleInfo(u.role).label}</span></td>
      <td>${esc(u.phone||'—')}</td>
      ${manage?`<td>${u.active?'<span class="pill hecha">Activo</span>':'<span class="pill rechazada">Inactivo</span>'}</td>
      <td style="text-align:right;white-space:nowrap"><button class="btn btn-ghost" style="padding:6px 10px" onclick="editUserModal('${u.id}')">Editar</button> <button class="icon-btn" style="width:30px;height:30px" title="Eliminar persona" onclick="delUser('${u.id}')">${svgIcon('trash','icon icon-sm')}</button></td>`:''}
    </tr>`;}).join('');
    html+=`</tbody></table></div></div>`;
  });
  if(seeRRHH){
    const sols=DB.pedidos.filter(p=>(p.area==='rrhh'||p.area==='contabilidad')&&inScope(p.sucursalId)).sort((a,b)=>b.createdAt-a.createdAt);
    html+=`<div class="page-head" style="margin:26px 0 10px"><div class="page-title" style="font-size:17px">Solicitudes a RRHH</div><div class="page-sub" style="margin:0 0 0 8px">· ${sols.filter(s=>s.status==='pendiente'||s.status==='proceso').length} activas</div></div>`;
    html+= sols.length? sols.map(pedidoRow).join('') : emptyState('👤','Sin solicitudes','Permisos, adelantos y vacaciones aparecen acá.');
  }
  return html;
}
function newUserModal(){
  openModal(userForm('Nuevo usuario',null));
}
window.newUserModal=newUserModal;
function editUserModal(id){ openModal(userForm('Editar usuario',userById(id))); }
window.editUserModal=editUserModal;
function userForm(title,u){
  return `<div class="modal-head"><h3>${title}</h3><button class="modal-close" onclick="closeModal()">×</button></div>
  <div class="modal-body">
    <div class="field"><label>Nombre completo</label><input class="input" id="uName" value="${u?esc(u.name):''}" placeholder="Nombre y apellido"></div>
    <div class="row2">
      <div class="field"><label>Puesto</label><select class="select" id="uRole" onchange="uPermsSync()">${ROLE_KEYS.map(r=>`<option value="${r}" ${u&&u.role===r?'selected':''}>${ROLES[r].label}</option>`).join('')}</select></div>
      <div class="field"><label>PIN (4 dígitos)</label><input class="input" id="uPin" type="password" inputmode="numeric" maxlength="4" value="" placeholder="${u?'Dejar en blanco = no cambiar':'4 dígitos'}"></div>
    </div>
    <div class="row2">
      <div class="field"><label>Sucursal</label><select class="select" id="uSuc"><option value="all" ${u&&u.sucursalId==='all'?'selected':''}>Todas (global)</option>${DB.sucursales.map(s=>`<option value="${s.id}" ${u&&u.sucursalId===s.id?'selected':''}>${esc(s.name)}</option>`).join('')}</select></div>
      <div class="field"><label>Teléfono</label><input class="input" id="uPhone" value="${u?esc(u.phone||''):''}" placeholder="Ej: 8888-8888"></div>
    </div>
    ${u?`<div class="field"><label>Estado</label><select class="select" id="uActive"><option value="1" ${u.active?'selected':''}>Activo</option><option value="0" ${!u.active?'selected':''}>Inactivo</option></select></div>`:''}
    ${isAdmin()?`<div class="field"><label>Permisos de secciones <span class="lbl-soft">(marcado = lo ve; solo para esta persona)</span></label>
      ${PERM_GROUPS.map(g=>`<div class="uperm-sec">${g.label}</div>
        <div class="uextra-grid">${g.ids.map(k=>{
          const eff = u ? navAllowedIds(u).includes(k) : (ROLE_NAV[ROLE_KEYS[0]]||[]).includes(k);
          const lock = u && u.role==='admin' && k==='equipo';   // gerencia no puede quedarse sin Equipo (candado anti-bloqueo)
          return `<label class="uextra ${lock?'lock':''}"><input type="checkbox" class="uperm" value="${k}" ${eff?'checked':''} ${lock?'checked disabled':''}> ${NAV_DEF[k].label}</label>`;
        }).join('')}</div>`).join('')}
      <div class="td-empty" style="margin-top:8px">Al cambiar el puesto, las casillas vuelven a lo típico de ese puesto — después ajustá lo fino.</div>
    </div>`:''}
  </div>
  <div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">Cancelar</button><button class="btn btn-primary" onclick="saveUser('${u?u.id:''}')">Guardar</button></div>`;
}
/* Al cambiar el puesto en el editor, las casillas vuelven a lo típico de ese puesto */
function uPermsSync(){
  const role=$('#uRole')?$('#uRole').value:''; if(!role) return;
  const base=new Set(ROLE_NAV[role]||[]);
  document.querySelectorAll('.uperm').forEach(b=>{ if(!b.disabled) b.checked=base.has(b.value); });
}
window.uPermsSync=uPermsSync;
/* Lee el grid de permisos → {navExtra, navOff} respecto al puesto elegido */
function _readPerms(role, prev){
  const boxes=[...document.querySelectorAll('.uperm')];
  if(!boxes.length) return { navExtra:(prev&&prev.navExtra)||[], navOff:(prev&&prev.navOff)||[] };   // sin grid: conservar
  const roleSet=new Set(ROLE_NAV[role]||[]);
  const navExtra=[], navOff=[];
  boxes.forEach(b=>{
    const k=b.value, on=b.checked||b.disabled;
    if(on && !roleSet.has(k)) navExtra.push(k);
    if(!on && roleSet.has(k)) navOff.push(k);
  });
  if(role==='admin'){ const i=navOff.indexOf('equipo'); if(i>=0) navOff.splice(i,1); }   // anti-bloqueo de gerencia
  return { navExtra, navOff };
}
async function saveUser(id){
  const name=$('#uName').value.trim(); if(!name){ toast('Ponele nombre','err'); return; }
  const role=$('#uRole').value, sucursalId=$('#uSuc').value, phone=($('#uPhone')?$('#uPhone').value.trim():'');
  const pinRaw=($('#uPin')?$('#uPin').value.trim():'');
  const perms=_readPerms(role, id?userById(id):null);
  const permTxt=(perms.navExtra.length||perms.navOff.length)?` (permisos: +${perms.navExtra.join(',')||'—'} · −${perms.navOff.join(',')||'—'})`:'';
  if(id){
    const u=userById(id); if(!u) return;
    u.name=name; u.role=role; u.sucursalId=sucursalId; u.phone=phone; u.active=$('#uActive').value==='1'; u.navExtra=perms.navExtra; u.navOff=perms.navOff; u.updatedAt=now();
    if(pinRaw){ if(!/^\d{4}$/.test(pinRaw)){ toast('El PIN debe ser de 4 dígitos','err'); return; } await setUserPin(u,pinRaw); u.mustChangePin=false; }
    audit('equipo',`editó al usuario ${name}${permTxt}`);
  } else {
    if(!/^\d{4}$/.test(pinRaw)){ toast('Poné un PIN de 4 dígitos para el nuevo usuario','err'); return; }
    const u={id:uid(),name,role,sucursalId,phone,navExtra:perms.navExtra,navOff:perms.navOff,active:true,mustChangePin:true,at:now(),updatedAt:now()};
    await setUserPin(u,pinRaw);
    DB.users.push(u);
    audit('equipo',`agregó al usuario ${name} (${roleInfo(role).short})${permTxt}`);
  }
  closeModal(); toast('Usuario guardado','ok'); render();
}
window.saveUser=saveUser;
function newSucModal(){ openModal(sucForm('Nueva sucursal',null)); }
function sucEditModal(id){ openModal(sucForm('Renombrar sucursal',DB.sucursales.find(s=>s.id===id))); }
function sucForm(title,s){
  return `<div class="modal-head"><h3>${title}</h3><button class="modal-close" onclick="closeModal()">${svgIcon('x','icon')}</button></div>
  <div class="modal-body"><div class="field"><label>Nombre de la sucursal</label><input class="input" id="sName" value="${s?esc(s.name):''}" placeholder="Ej: Sabor Tico — Sur"></div></div>
  <div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">Cancelar</button><button class="btn btn-primary" onclick="saveSuc('${s?s.id:''}')">${s?'Guardar':'Crear'}</button></div>`;
}
function saveSuc(id){ const n=$('#sName').value.trim(); if(!n){toast('Ponele nombre','err');return;}
  if(id){ const s=DB.sucursales.find(x=>x.id===id); if(s){ s.name=n; s.updatedAt=now(); audit('equipo',`renombró una sucursal a "${n}"`); } }
  else { DB.sucursales.push({id:uid(),name:n,at:now(),updatedAt:now()}); audit('equipo',`creó la sucursal ${n}`); }
  closeModal(); toast('Sucursal guardada','ok'); render(); }
async function delSuc(id){
  if(!isAdmin()) return;
  const s=DB.sucursales.find(x=>x.id===id); if(!s) return;
  const ppl=DB.users.filter(u=>u.sucursalId===id).length;
  if(!await confirmDialog(`Se elimina la sucursal "${s.name}".${ppl?` Las ${ppl} persona(s) de esta sucursal van a quedar "Sin sucursal" — reasignalas o borralas.`:''}`,{title:'¿Eliminar sucursal?',okText:'Sí, eliminar'})) return;
  tomb(id); DB.sucursales=DB.sucursales.filter(x=>x.id!==id);
  audit('equipo',`eliminó la sucursal "${s.name}"`); save(); render();
  undoDelete('sucursales', s, 'Sucursal '+s.name);
}
async function delUser(id){
  if(!isAdmin()) return;
  const u=userById(id); if(!u) return;
  if(id===SES.userId){ toast('No te podés eliminar a vos mismo','err'); return; }
  if(!await confirmDialog(`Se elimina a ${u.name} del equipo. (Lo que haya hecho queda en el historial; podés volver a crearla si hace falta.)`,{title:'¿Eliminar persona?',okText:'Sí, eliminar'})) return;
  tomb(id); DB.users=DB.users.filter(x=>x.id!==id);
  audit('equipo',`eliminó al usuario ${u.name}`); save(); render();
  undoDelete('users', u, u.name);
}
window.newSucModal=newSucModal; window.sucEditModal=sucEditModal; window.saveSuc=saveSuc; window.delSuc=delSuc; window.delUser=delUser;

/* =====================================================================
   CAJA — control cruzado del efectivo (una por día por sucursal, anti-fraude)
   Cruce "sistema vs conteo": el cajero declara ventas + cuenta el efectivo
   por denominación; el sistema calcula el efectivo esperado y marca el
   descuadre (faltante/sobrante). Gerencia/Contabilidad aprueban u observan.
   ===================================================================== */
const CAJA_DENOMS=[50000,20000,10000,5000,2000,1000,500,100,50,25,10,5];   // billetes y monedas de colones
const CAJA_MOV_TYPES={ gasto:{label:'Gasto / pago',sign:-1}, retiro:{label:'Retiro al fuerte',sign:-1}, ingreso:{label:'Ingreso extra',sign:1} };
let _cajaSuc='';
function cajaIsCashier(){ return ['admin','jefe_salon','salonero'].includes(me().role); }
function cajaIsVerifier(){ return ['admin','contarh'].includes(me().role); }
function cajaNeedsPicker(){ const my=me().sucursalId; return isAdmin() || cajaIsVerifier() || !my || my==='all'; }
function cajaSucId(){
  const list=(DB.sucursales||[]).filter(Boolean);
  const my=me().sucursalId;
  if(!cajaNeedsPicker() && my && my!=='all') return my;
  if(_cajaSuc && list.some(s=>s.id===_cajaSuc)) return _cajaSuc;
  if(SES.sucFilter && SES.sucFilter!=='all' && list.some(s=>s.id===SES.sucFilter)) return SES.sucFilter;
  return list.length?list[0].id:'all';
}
function setCajaSuc(id){ _cajaSuc=id; render(); }
function userFirst(id){ const u=userById(id); return u?(u.name||'').split(' ')[0]:'—'; }
function cajaDateLbl(iso){ if(!iso) return '—'; const d=new Date(iso+'T12:00:00'); return d.toLocaleDateString('es-CR',{weekday:'short',day:'numeric',month:'short'}); }
function cajaFind(id){ return (DB.cajas||[]).find(c=>c&&c.id===id); }
function cajaToday(sucId){ const d=todayISO(); return (DB.cajas||[]).find(c=>c&&c.sucursalId===sucId&&c.date===d); }
function cajaCashOut(c){ return (c.movs||[]).filter(m=>m.type==='gasto'||m.type==='retiro').reduce((s,m)=>s+(+m.amount||0),0); }
function cajaCashIn(c){ return (c.movs||[]).filter(m=>m.type==='ingreso').reduce((s,m)=>s+(+m.amount||0),0); }
function cajaDenomTotal(denom){ if(!denom) return 0; return CAJA_DENOMS.reduce((s,d)=>s+d*(+denom[d]||0),0); }
/* POS = la verdad (reporte Z). recv = lo realmente recibido/liquidado por método (no efectivo).
   Compatibilidad: cajas viejas (v102) usaban c.sales como ventas declaradas → se tratan como POS. */
function cajaPos(c){ return c.pos||c.sales||{}; }
function cajaRecv(c){ return c.recv||{}; }
function cajaExpected(c){ const posCash=+(cajaPos(c).efectivo)||0; return (+c.openFloat||0)+posCash+cajaCashIn(c)-cajaCashOut(c); }
function cajaSalesTotal(s){ s=s||{}; return (+s.efectivo||0)+(+s.tarjeta||0)+(+s.sinpe||0)+(+s.transfer||0); }
function cajaMethodCross(c){
  const pos=cajaPos(c), recv=cajaRecv(c);
  return [['tarjeta','Tarjeta'],['sinpe','SINPE'],['transfer','Transferencia']].map(([k,lbl])=>{
    const p=+pos[k]||0; const rv=recv[k]; const r=(rv==null||rv==='')?null:(+rv||0);
    return {k,lbl,pos:p,recv:r,diff:r==null?null:(r-p)};
  }).filter(m=>m.pos>0||m.recv!=null);
}
function cajaHasMethodMismatch(c){ return cajaMethodCross(c).some(m=>m.diff!=null&&m.diff!==0); }
function cajaDiffLabel(diff){ diff=+diff||0; if(diff===0) return {txt:'Cuadra exacto',cls:'ok'}; return diff<0?{txt:'Faltante '+money(-diff),cls:'bad'}:{txt:'Sobrante '+money(diff),cls:'warn'}; }
function cajaDiffShort(diff){ diff=+diff||0; if(diff===0) return {txt:'✓',cls:'ok'}; return diff<0?{txt:'−'+money(-diff),cls:'bad'}:{txt:'+'+money(diff),cls:'warn'}; }

/* ===== Facturas del día (estilo hoja de caja: una fila por factura, desglosada por método) =====
   Campos por factura: num · efectivo ₡/$ · tarjeta BAC ₡ / BN ₡ / BAC $ / BN $ ·
   SINPE ₡ · propina ₡/$. TC = tipo de cambio del día.
   El total de la fila (en colones, SIN propina) alimenta el cruce del cierre. */
const CAJA_FAC_NUM=['efCol','efDol','bacCol','bnCol','bacDol','bnDol','sinpe','propCol','propDol'];
function cajaTc(c){ return +(c&&c.tc)||520; }
function cajaFacTotal(f,tc){ f=f||{}; return (+f.efCol||0)+(+f.bacCol||0)+(+f.bnCol||0)+(+f.sinpe||0)+tc*((+f.efDol||0)+(+f.bacDol||0)+(+f.bnDol||0)); }
function cajaFacSums(c){
  const tc=cajaTc(c); const t={total:0,n:(c.facturas||[]).length};
  CAJA_FAC_NUM.forEach(k=>t[k]=0);
  (c.facturas||[]).forEach(f=>{ if(!f) return; CAJA_FAC_NUM.forEach(k=>t[k]+=(+f[k]||0)); t.total+=cajaFacTotal(f,tc); });
  t.efectivo=t.efCol+tc*t.efDol;                       // efectivo total en ₡ (para el cruce)
  t.tarjeta=t.bacCol+t.bnCol+tc*(t.bacDol+t.bnDol);    // tarjeta total en ₡
  t.propina=t.propCol+tc*t.propDol;
  return t;
}
function _fc(n){ return +n?money(n):''; }                                          // colones (vacío si 0, como la hoja)
function _fd(n){ return +n?('$'+(+n).toLocaleString('es-CR',{maximumFractionDigits:2})):''; }  // dólares
function cajaFacTable(c, editable){
  const tc=cajaTc(c); const t=cajaFacSums(c);
  const rows=(c.facturas||[]).map(f=>`<tr ${editable?`class="fct-r" onclick="cajaFacModal('${c.id}','${f.id}')"`:''}>
    <td class="fct-num">${esc(f.num||'—')}</td>
    <td>${_fc(f.efCol)}</td><td>${_fd(f.efDol)}</td>
    <td>${_fc(f.bacCol)}</td><td>${_fc(f.bnCol)}</td><td>${_fd(f.bacDol)}</td><td>${_fd(f.bnDol)}</td>
    <td>${_fc(f.sinpe)}</td>
    <td>${_fc(f.propCol)}</td><td>${_fd(f.propDol)}</td>
    <td class="fct-tot">${money(cajaFacTotal(f,tc))}</td>
  </tr>`).join('');
  return `<div class="fct-wrap"><table class="fct">
    <thead>
      <tr class="fct-g"><th rowspan="2" class="fct-num">Factura</th><th colspan="2" class="g-ef">Efectivo</th><th colspan="4" class="g-tj">Tarjeta</th><th rowspan="2" class="g-si">SINPE ₡</th><th colspan="2" class="g-pp">Propina</th><th rowspan="2" class="g-tot">Total ₡</th></tr>
      <tr class="fct-s"><th class="g-ef">₡</th><th class="g-ef">$</th><th class="g-tj">BAC ₡</th><th class="g-tj">BN ₡</th><th class="g-tj">BAC $</th><th class="g-tj">BN $</th><th class="g-pp">₡</th><th class="g-pp">$</th></tr>
    </thead>
    <tbody>${rows||`<tr><td colspan="11" class="fct-empty">Sin facturas todavía.${editable?' Tocá “Agregar factura”.':''}</td></tr>`}</tbody>
    <tfoot><tr class="fct-t">
      <td class="fct-num">TOTALES</td>
      <td>${_fc(t.efCol)}</td><td>${_fd(t.efDol)}</td>
      <td>${_fc(t.bacCol)}</td><td>${_fc(t.bnCol)}</td><td>${_fd(t.bacDol)}</td><td>${_fd(t.bnDol)}</td>
      <td>${_fc(t.sinpe)}</td>
      <td>${_fc(t.propCol)}</td><td>${_fd(t.propDol)}</td>
      <td class="fct-tot">${money(t.total)}</td>
    </tr></tfoot>
  </table></div>`;
}
function cajaFacSection(c, editable){
  const t=cajaFacSums(c);
  return `<div class="fct-head">
      <span class="td-sec" style="margin:0">Facturas del día <span class="fct-count">${t.n}</span></span>
      <div class="ph-spacer"></div>
      <label class="fct-tc">TC $1 = ₡<input type="number" min="1" step="any" inputmode="decimal" value="${cajaTc(c)}" ${editable?`onchange="cajaSetTc('${c.id}',this.value)"`:'disabled'}></label>
      ${editable?`<button class="btn btn-primary" style="padding:9px 14px" onclick="cajaFacModal('${c.id}')">${svgIcon('plus','icon icon-sm')} Agregar factura</button>`:''}
    </div>
    ${cajaFacTable(c, editable)}
    ${t.n?`<div class="fct-sum">Ventas: <b>${money(t.total)}</b> · Efectivo: <b>${money(t.efectivo)}</b> · Tarjeta: <b>${money(t.tarjeta)}</b> · Propinas: <b>${money(t.propina)}</b></div>`:''}`;
}
function cajaSetTc(id,v){
  const c=cajaFind(id); if(!c||c.status!=='abierta'||!cajaIsCashier()) return;
  c.tc=+v||520; c.updatedAt=now();
  c.log.push({at:now(),byId:SES.userId,text:'fijó el tipo de cambio en ₡'+c.tc});
  save(); render();
}
function cajaFacModal(cajaId, facId){
  const c=cajaFind(cajaId); if(!c) return;
  if(c.status!=='abierta'||!cajaIsCashier()){ if(facId) return; toast('La caja no está abierta','err'); return; }
  const f=facId?(c.facturas||[]).find(x=>x&&x.id===facId):null;
  if(facId&&!f) return;
  let sugNum='';
  if(!f){ const last=(c.facturas||[]).map(x=>parseInt(x&&x.num,10)).filter(n=>!isNaN(n)).sort((a,b)=>a-b).pop(); if(last) sugNum=String(last+1); }
  const V=k=>f&&+f[k]?f[k]:'';
  const NUM=(id,lbl,val)=>`<div class="field"><label>${lbl}</label><input class="input" id="${id}" type="number" min="0" step="any" inputmode="decimal" value="${val}" placeholder="0"></div>`;
  openModal(`
    <div class="modal-head"><h3>${svgIcon('cash','icon')} ${f?'Editar factura':'Nueva factura'}</h3><button class="modal-close" onclick="closeModal()">${svgIcon('x','icon')}</button></div>
    <div class="modal-body">
      <div class="field"><label>Número de factura</label><input class="input" id="fcNum" value="${f?esc(f.num||''):sugNum}" placeholder="Ej: 963" autocomplete="off"></div>
      <div class="ip-sec">Efectivo</div>
      <div class="row2">${NUM('fcEfC','Colones (₡)',V('efCol'))}${NUM('fcEfD','Dólares ($)',V('efDol'))}</div>
      <div class="ip-sec">Tarjeta</div>
      <div class="row2">${NUM('fcBacC','BAC colones (₡)',V('bacCol'))}${NUM('fcBnC','BN colones (₡)',V('bnCol'))}</div>
      <div class="row2">${NUM('fcBacD','BAC dólares ($)',V('bacDol'))}${NUM('fcBnD','BN dólares ($)',V('bnDol'))}</div>
      <div class="ip-sec">SINPE Móvil</div>
      ${NUM('fcSi','SINPE (₡)',V('sinpe'))}
      <div class="ip-sec">Propina</div>
      <div class="row2">${NUM('fcPpC','Colones (₡)',V('propCol'))}${NUM('fcPpD','Dólares ($)',V('propDol'))}</div>
    </div>
    <div class="modal-foot">
      ${f?`<button class="btn btn-danger" onclick="cajaFacDel('${c.id}','${f.id}')">${svgIcon('trash','icon icon-sm')} Quitar</button>`:''}
      <button class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary" onclick="cajaFacSave('${c.id}','${f?f.id:''}')">${svgIcon('check','icon icon-sm')} Guardar</button>
    </div>`, true);
}
function cajaFacSave(cajaId, facId){
  const c=cajaFind(cajaId); if(!c||c.status!=='abierta'||!cajaIsCashier()) return;
  const g=id=>+($('#'+id)?$('#'+id).value:0)||0;
  const num=($('#fcNum')?$('#fcNum').value.trim():'');
  const data={ num, efCol:g('fcEfC'), efDol:g('fcEfD'), bacCol:g('fcBacC'), bnCol:g('fcBnC'), bacDol:g('fcBacD'), bnDol:g('fcBnD'),
    sinpe:g('fcSi'), propCol:g('fcPpC'), propDol:g('fcPpD') };
  const monto=cajaFacTotal(data,cajaTc(c));
  if(!num && monto<=0){ toast('Poné el número de factura o algún monto','err'); return; }
  c.facturas=c.facturas||[];
  if(facId){
    const f=c.facturas.find(x=>x&&x.id===facId); if(!f) return;
    Object.assign(f,data); f.updatedAt=now();
    c.log.push({at:now(),byId:SES.userId,text:`editó la factura ${num||'—'} (${money(monto)})`});
    audit('caja',`editó factura ${num||'—'} de la caja (${sucName(c.sucursalId)})`,c.sucursalId);
  } else {
    c.facturas.push({id:uid(),...data,byId:SES.userId,at:now()});
    c.log.push({at:now(),byId:SES.userId,text:`registró la factura ${num||'—'} · ${money(monto)}`});
  }
  c.updatedAt=now();
  closeModal(); toast(facId?'Factura actualizada':'Factura registrada ✅','ok'); save(); render();
}
/* ===== CAJA BLINDADA: 4 candados que se refuerzan =====
   1) Candado de consecutivo: primera/última factura del día → los números faltantes cantan.
   2) Sello del día: hash SHA-256 de todo el día al cerrar → si alguien altera datos después, no coincide.
   3) Corte relámpago: conteo sorpresa a hora aleatoria → mata el "robo ahora, cuadro luego".
   4) Semáforo: veredicto automático 🟢🟡🔴 con motivos → gerencia revisa en 10 segundos. */
async function sha6(str){
  try{ const d=await crypto.subtle.digest('SHA-256', new TextEncoder().encode('saborTicoCaja|'+str));
    return [...new Uint8Array(d)].slice(0,3).map(b=>b.toString(16).padStart(2,'0')).join('').toUpperCase(); }
  catch(_){ return ''; }
}
function cajaSealPayload(c){
  const F=(c.facturas||[]).map(f=>f?[f.num,f.efCol,f.efDol,f.bacCol,f.bnCol,f.bacDol,f.bnDol,f.sinpe,f.propCol,f.propDol,f.at].join('~'):'').join(';');
  const M=(c.movs||[]).map(m=>m?[m.type,m.amount,m.at].join('~'):'').join(';');
  return [c.date,c.sucursalId,+c.openFloat||0,c.tc||'',c.firstNum||'',c.lastNum||'',F,M,+c.countedCash||0,+c.expectedCash||0].join('||');
}
async function cajaSealCheck(c){ if(!c.seal) return null; return (await sha6(cajaSealPayload(c)))===c.seal; }
function cajaPrevLastNum(c){
  const prev=(DB.cajas||[]).filter(x=>x&&x.sucursalId===c.sucursalId&&x.date<c.date).sort((a,b)=>(b.date||'').localeCompare(a.date||''))[0];
  if(!prev) return null;
  let pl=parseInt(prev.lastNum,10);
  if(isNaN(pl)){ const ns=(prev.facturas||[]).map(f=>parseInt(f&&f.num,10)).filter(n=>!isNaN(n)); pl=ns.length?Math.max(...ns):NaN; }
  return isNaN(pl)?null:pl;
}
function cajaSeqCheck(c){
  const nums=(c.facturas||[]).map(f=>parseInt(f&&f.num,10)).filter(n=>!isNaN(n)).sort((a,b)=>a-b);
  const res={n:nums.length,gaps:[],dups:[],expected:null,contPrev:null};
  for(let i=1;i<nums.length;i++) if(nums[i]===nums[i-1]&&!res.dups.includes(nums[i])) res.dups.push(nums[i]);
  const first=parseInt(c.firstNum,10), last=parseInt(c.lastNum,10);
  const lo=!isNaN(first)?first:(nums.length?nums[0]:NaN), hi=!isNaN(last)?last:(nums.length?nums[nums.length-1]:NaN);
  if(!isNaN(lo)&&!isNaN(hi)&&hi>=lo){ res.expected=hi-lo+1; const set=new Set(nums); for(let x=lo;x<=hi;x++) if(!set.has(x)) res.gaps.push(x); }
  const pl=cajaPrevLastNum(c);
  if(pl!=null&&!isNaN(lo)) res.contPrev={prevLast:pl, ok: lo===pl+1};
  return res;
}
function cajaBurst(c){
  const ts=(c.facturas||[]).map(f=>f&&f.at).filter(Boolean).sort((a,b)=>a-b);
  if(ts.length<5) return false;
  const win=15*60e3; let best=0;
  for(let i=0;i<ts.length;i++){ let j=i; while(j<ts.length&&ts[j]-ts[i]<=win) j++; best=Math.max(best,j-i); }
  return best/ts.length>=0.7;
}
function cajaScore(c){
  if(!c||c.status==='abierta') return null;
  const rs=[]; let level=0;
  const add=(lv,txt)=>{ rs.push({lv,txt}); level=Math.max(level,lv); };
  const d=+c.diff||0;
  if(d===0) add(0,'Efectivo cuadra exacto');
  else if(d<0) add(2,'Faltante de '+money(-d));
  else add(d>=5000?2:1,'Sobrante de '+money(d));
  cajaMethodCross(c).forEach(m=>{ if(m.diff!=null&&m.diff!==0) add(Math.abs(m.diff)>=5000?2:1, m.lbl+' no coincide ('+cajaDiffShort(m.diff).txt+')'); });
  const sq=cajaSeqCheck(c);
  if(sq.gaps.length) add(2,'FALTAN FACTURAS del consecutivo: '+sq.gaps.slice(0,8).join(', ')+(sq.gaps.length>8?` (+${sq.gaps.length-8} más)`:''));
  else if(sq.expected!=null) add(0,`Consecutivo completo (${sq.expected} facturas, de la ${c.firstNum||'—'} a la ${c.lastNum||'—'})`);
  if(sq.dups.length) add(1,'Facturas repetidas: '+sq.dups.join(', '));
  if(sq.contPrev){ if(sq.contPrev.ok) add(0,'Sigue el consecutivo del día anterior'); else add(1,`No sigue el consecutivo del día anterior (ayer terminó en ${sq.contPrev.prevLast})`); }
  if(cajaBurst(c)) add(1,'Facturas registradas en ráfaga (posible reconstrucción al cierre)');
  if(c.spot){
    if(c.spot.skipped) add(1,'Corte relámpago omitido');
    else if(Math.abs(+c.spot.diff||0)>2000) add(2,'Corte relámpago NO cuadró ('+cajaDiffShort(c.spot.diff).txt+')');
    else add(0,'Corte relámpago OK ('+new Date(c.spot.at).toLocaleTimeString('es-CR',{hour:'2-digit',minute:'2-digit'})+')');
  }
  return { level:['verde','amarillo','rojo'][level], reasons:rs };
}
function cajaScoreHTML(c){
  const s=cajaScore(c); if(!s) return '';
  const ico={verde:'🟢',amarillo:'🟡',rojo:'🔴'}[s.level];
  const lbl={verde:'Día limpio',amarillo:'Día con avisos',rojo:'Día con alertas'}[s.level];
  return `<div class="score score-${s.level}">
    <div class="score-head">${ico} <b>${lbl}</b><span class="lbl-soft" style="margin-left:auto">veredicto automático</span></div>
    <ul class="score-list">${s.reasons.map(r=>`<li class="sr-${r.lv}">${esc(r.txt)}</li>`).join('')}</ul>
  </div>`;
}
/* --- Corte relámpago --- */
function cajaSpotDue(c){ return c && c.status==='abierta' && c.spotAt && !c.spot && now()>c.spotAt; }
function cajaSpotModal(id){
  const c=cajaFind(id); if(!c||c.status!=='abierta'||!cajaIsCashier()) return;
  const tf=cajaFacSums(c);
  const expected=(+c.openFloat||0)+Math.round(tf.efectivo)+cajaCashIn(c)-cajaCashOut(c);
  openModal(`
    <div class="modal-head"><h3>⚡ Corte relámpago</h3><button class="modal-close" onclick="closeModal()">${svgIcon('x','icon')}</button></div>
    <div class="modal-body">
      <div class="td-empty" style="margin-bottom:10px">Conteo sorpresa: contá <b>todo el efectivo de la caja</b> ahora mismo (billetes + monedas, en colones) y ponelo acá. Toma 1 minuto y queda registrado con hora.</div>
      <div class="field"><label>Efectivo contado ahora (₡)</label><input class="input" id="spCount" type="number" min="0" step="any" inputmode="numeric" placeholder="0" autofocus></div>
    </div>
    <div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">Después</button><button class="btn btn-primary" onclick="cajaSpotSave('${id}',${expected})">${svgIcon('check','icon icon-sm')} Registrar corte</button></div>`, false);
}
function cajaSpotSave(id, expected){
  const c=cajaFind(id); if(!c||c.status!=='abierta'||!cajaIsCashier()) return;
  const counted=+($('#spCount')?$('#spCount').value:0)||0;
  if(counted<=0){ toast('Poné el efectivo contado','err'); return; }
  const diff=counted-expected;
  c.spot={at:now(),byId:SES.userId,counted,expected,diff}; c.updatedAt=now();
  const dl=cajaDiffLabel(diff);
  c.log.push({at:now(),byId:SES.userId,text:`corte relámpago: contado ${money(counted)} vs esperado ${money(expected)} · ${dl.txt}`});
  audit('caja',`corte relámpago (${sucName(c.sucursalId)}): ${dl.txt}`,c.sucursalId);
  if(Math.abs(diff)>2000){
    const verifiers=DB.users.filter(u=>u&&u.active&&['admin','contarh'].includes(u.role)).map(u=>u.id);
    notify(verifiers, `⚡ Corte relámpago en ${sucName(c.sucursalId)}: ${dl.txt}`, '⚠️', {view:'caja'});
  }
  closeModal(); toast(Math.abs(diff)<=2000?'Corte OK, todo en orden ✅':'Corte registrado · '+dl.txt, Math.abs(diff)<=2000?'ok':'err'); save(); render();
}
function cajaFacDel(cajaId, facId){
  const c=cajaFind(cajaId); if(!c||c.status!=='abierta'||!cajaIsCashier()) return;
  const f=(c.facturas||[]).find(x=>x&&x.id===facId); if(!f) return;
  if(!confirm(`¿Quitar la factura ${f.num||'—'}? Queda registrado en la bitácora.`)) return;
  c.facturas=c.facturas.filter(x=>x.id!==facId); c.updatedAt=now();
  c.log.push({at:now(),byId:SES.userId,text:`QUITÓ la factura ${f.num||'—'} (${money(cajaFacTotal(f,cajaTc(c)))})`});
  audit('caja',`quitó factura ${f.num||'—'} de la caja (${sucName(c.sucursalId)})`,c.sucursalId);
  closeModal(); toast('Factura quitada','ok'); save(); render();
}

function viewCaja(){
  const canCashier=cajaIsCashier(), canVerify=cajaIsVerifier();
  const sucId=cajaSucId();
  const suc=(DB.sucursales||[]).find(s=>s.id===sucId);
  const todayC=cajaToday(sucId);
  const scoped=(DB.cajas||[]).filter(c=>c&&inScope(c.sucursalId)).sort((a,b)=>(b.date||'').localeCompare(a.date||'')||(b.openAt||0)-(a.openAt||0));
  const ym=todayISO().slice(0,7);
  const monthCajas=scoped.filter(c=>c.date&&c.date.slice(0,7)===ym&&c.status!=='abierta');
  const monthDiff=monthCajas.reduce((s,c)=>s+(+c.diff||0),0);
  const faltantes=monthCajas.filter(c=>(+c.diff||0)<0);
  const porRevisar=scoped.filter(c=>c.status==='cerrada');

  let html=`<div class="page-head"><div><div class="page-title">Caja</div><div class="page-sub">Control cruzado del efectivo · una caja por día por sucursal</div></div><div class="ph-spacer"></div></div>`;
  html+=sectionGuide('caja','¿Cómo funciona el control de Caja?',`
    El <b>cajero</b> abre la caja con su fondo y va registrando <b>cada factura</b> del día con su
    desglose (efectivo ₡/$, tarjeta BAC/BN ₡/$, SINPE, propina), como en la hoja de caja.
    <ul style="margin:8px 0 0 18px">
      <li>Los <b>totales se calculan solos</b> (con el tipo de cambio del día para los dólares).</li>
      <li>Al cerrar, el sistema <b>cruza</b>: facturas registradas vs <b>conteo físico por denominación</b> → marca <b>faltante o sobrante</b>.</li>
      <li><b>Caja Blindada</b>: candado de <b>consecutivo</b> (los números de factura faltantes cantan), <b>corte relámpago</b> sorpresa (1 min), <b>sello del día</b> (si alguien altera datos después del cierre, se nota) y <b>semáforo 🟢🟡🔴</b> automático para la revisión.</li>
      <li>Los <b>gastos</b> exigen foto del comprobante.</li>
      <li><b>Gerencia y Contabilidad</b> revisan cada cierre: lo <b>aprueban</b> u <b>observan</b>.</li>
      <li>Cada día queda <b>guardado</b> con sus facturas (historial + CSV para reportes) en una <b>bitácora que no se puede borrar</b>.</li>
    </ul>`);
  if(cajaNeedsPicker() && (DB.sucursales||[]).length>1){
    html+=`<div class="toolbar"><div class="field" style="margin:0;min-width:200px"><label>Sucursal</label><select class="select" onchange="setCajaSuc(this.value)">${(DB.sucursales||[]).map(s=>`<option value="${s.id}" ${s.id===sucId?'selected':''}>${esc(s.name)}</option>`).join('')}</select></div></div>`;
  }
  html+=`<div class="kpi-row">
    <div class="kpi ${todayC?(todayC.status==='abierta'?'':'ok'):'alert'}"><div class="label">Caja de hoy</div><div class="value" style="font-size:17px">${todayC?(todayC.status==='abierta'?'Abierta':todayC.status==='cerrada'?'Por revisar':cap(todayC.status)):'Sin abrir'}</div><div class="sub">${esc(suc?suc.name:'—')}</div></div>
    <div class="kpi ${monthDiff<0?'alert':''}"><div class="label">Descuadre del mes</div><div class="value" style="font-size:17px;color:${monthDiff<0?'var(--danger)':monthDiff>0?'var(--warn)':'inherit'}">${monthDiff===0?money(0):(monthDiff<0?'−'+money(-monthDiff):'+'+money(monthDiff))}</div><div class="sub">${monthCajas.length} cierres</div></div>
    <div class="kpi ${faltantes.length?'alert':''}"><div class="label">Faltantes</div><div class="value">${faltantes.length}</div><div class="sub">este mes</div></div>
    <div class="kpi ${porRevisar.length?'alert':''}" ${canVerify?'':'style="opacity:.7"'}><div class="label">Por revisar</div><div class="value">${porRevisar.length}</div><div class="sub">esperan aprobación</div></div>
  </div>`;
  html+=cajaAlerts(scoped);
  html+=`<div class="td-sec">Caja de hoy · ${esc(suc?suc.name:'')} · ${cajaDateLbl(todayISO())}</div>`;
  html+=cajaTodayCard(todayC, sucId, canCashier, canVerify);
  if(canVerify && porRevisar.length){
    html+=`<div class="td-sec">Cierres por revisar (${porRevisar.length})</div>`;
    html+=porRevisar.map(c=>cajaRow(c)).join('');
  }
  html+=`<div class="td-sec">Historial de cajas</div>`;
  const hist=scoped.filter(c=>!(todayC&&c.id===todayC.id)).slice(0,40);
  html+= hist.length? hist.map(c=>cajaRow(c)).join('') : `<div class="td-empty">Sin cierres todavía.</div>`;
  html+=`<div style="margin-top:14px"><button class="btn btn-ghost" onclick="cajaReportModal()">${svgIcon('trend','icon icon-sm')} Reporte y exportar CSV</button></div>`;
  return html;
}
function cajaAlerts(scoped){
  const closed=scoped.filter(c=>c.status==='cerrada'||c.status==='aprobada'||c.status==='observada');
  const alerts=[];
  const bySuc={};
  closed.forEach(c=>{ (bySuc[c.sucursalId]=bySuc[c.sucursalId]||[]).push(c); });
  Object.keys(bySuc).forEach(sid=>{
    const arr=bySuc[sid].slice().sort((a,b)=>(b.date||'').localeCompare(a.date||'')).slice(0,7);
    const f=arr.filter(c=>(+c.diff||0)<0).length;
    if(f>=3) alerts.push({cls:'bad',txt:`${sucName(sid)}: ${f} faltantes en los últimos ${arr.length} cierres. Conviene revisar quién hace caja.`});
  });
  closed.filter(c=>c.status==='cerrada'&&Math.abs(+c.diff||0)>=5000).forEach(c=>alerts.push({cls:'warn',txt:`${cajaDateLbl(c.date)} · ${sucName(c.sucursalId)}: descuadre de efectivo de ${money(Math.abs(c.diff))} sin revisar.`}));
  closed.filter(c=>c.status==='cerrada'&&cajaHasMethodMismatch(c)).forEach(c=>{ const mm=cajaMethodCross(c).filter(m=>m.diff!=null&&m.diff!==0).map(m=>`${m.lbl} ${cajaDiffShort(m.diff).txt}`).join(', '); alerts.push({cls:'warn',txt:`${cajaDateLbl(c.date)} · ${sucName(c.sucursalId)}: POS no coincide con lo recibido (${mm}).`}); });
  if(!alerts.length) return '';
  return `<div class="caja-alerts">${alerts.slice(0,5).map(a=>`<div class="caja-alert ${a.cls}">${svgIcon('shield','icon icon-sm')} ${esc(a.txt)}</div>`).join('')}</div>`;
}
function cajaTodayCard(c, sucId, canCashier, canVerify){
  if(!c){
    return `<div class="caja-card">
      <div class="caja-empty">${svgIcon('cash','icon')}<div><b>La caja de hoy no está abierta.</b><div class="td-empty" style="padding:2px 0">${canCashier?'Abrila con el fondo inicial para empezar a registrar movimientos.':'Un cajero (salón o gerencia) debe abrirla.'}</div></div></div>
      ${canCashier?`<div class="caja-actions"><button class="btn btn-primary" onclick="cajaOpenModal('${sucId}')">${svgIcon('plus','icon icon-sm')} Abrir caja</button></div>`:''}
    </div>`;
  }
  if(c.status==='abierta'){
    const canManage=canCashier;
    const tf=cajaFacSums(c);
    const cashNow=(+c.openFloat||0)+tf.efectivo+cajaCashIn(c)-cajaCashOut(c);
    const spotBanner = cajaSpotDue(c) && canManage
      ? `<button class="spot-banner" onclick="cajaSpotModal('${c.id}')">⚡ <b>Corte relámpago:</b> contá el efectivo AHORA (1 minuto) — tocá acá</button>`
      : (c.spot&&!c.spot.skipped?`<div class="spot-done">⚡ Corte relámpago hecho a las ${new Date(c.spot.at).toLocaleTimeString('es-CR',{hour:'2-digit',minute:'2-digit'})} · ${cajaDiffLabel(c.spot.diff).txt}</div>`:'');
    return `<div class="caja-card">
      <div class="caja-head"><span class="pill proceso">Abierta</span>${c.firstNum?`<span class="td-badge">1.ª factura: ${esc(c.firstNum)}</span>`:''}<span class="caja-sub">Abrió ${esc(userFirst(c.openedBy))} · ${timeAgo(c.openAt)}</span></div>
      ${spotBanner}
      <div class="caja-grid">
        <div class="caja-stat"><span>Fondo de apertura</span><b>${money(c.openFloat)}</b></div>
        <div class="caja-stat"><span>Ventas del día (facturas)</span><b>${money(tf.total)}</b></div>
        <div class="caja-stat"><span>Ingresos extra</span><b>+${money(cajaCashIn(c))}</b></div>
        <div class="caja-stat"><span>Gastos y retiros</span><b>−${money(cajaCashOut(c))}</b></div>
        <div class="caja-stat"><span>Efectivo que debería haber</span><b>${money(cashNow)}</b></div>
      </div>
      ${cajaFacSection(c, canManage)}
      <div class="td-sec" style="margin-top:14px">Gastos, retiros e ingresos</div>
      ${cajaMovsList(c, canManage)}
      <div class="caja-actions">
        ${canManage?`<button class="btn btn-ghost" onclick="cajaMovModal('${c.id}','gasto')">${svgIcon('box','icon icon-sm')} Gasto</button>
        <button class="btn btn-ghost" onclick="cajaMovModal('${c.id}','retiro')">${svgIcon('shield','icon icon-sm')} Retiro</button>
        <button class="btn btn-ghost" onclick="cajaMovModal('${c.id}','ingreso')">${svgIcon('plus','icon icon-sm')} Ingreso</button>
        <button class="btn btn-primary" onclick="cajaCloseModal('${c.id}')">${svgIcon('check','icon icon-sm')} Cerrar caja</button>`:'<div class="td-empty">Solo un cajero puede cerrarla.</div>'}
      </div>
    </div>`;
  }
  return cajaClosedCard(c, canVerify);
}
function cajaMovsList(c, canManage){
  const movs=c.movs||[];
  if(!movs.length) return `<div class="td-empty" style="padding:6px 0">Sin movimientos todavía.</div>`;
  return `<div class="caja-movs">${movs.map(m=>{
    const mt=CAJA_MOV_TYPES[m.type]||{label:m.type,sign:-1};
    return `<div class="caja-mov"><span class="caja-mov-t">${esc(mt.label)}</span><span class="caja-mov-c">${esc(m.concept||'')}</span>${m.mid?mediaTag(m.mid,'image','style="width:30px;height:30px;object-fit:cover;border-radius:6px;cursor:zoom-in;flex:0 0 auto" onclick="openImgFromEl(this)"'):''}<span class="caja-mov-a ${mt.sign<0?'out':'in'}">${mt.sign<0?'−':'+'}${money(m.amount)}</span>${canManage?`<button class="caja-mov-x" title="Quitar" onclick="cajaDelMov('${c.id}','${m.id}')">${svgIcon('x','icon icon-sm')}</button>`:''}</div>`;
  }).join('')}</div>`;
}
function cajaMethodCrossHTML(c){
  const rows=cajaMethodCross(c);
  if(!rows.length) return '';
  return `<div class="caja-mcross">${rows.map(m=>{
    if(m.diff==null) return `<div class="caja-mrow"><span>${m.lbl}</span><b>POS ${money(m.pos)}</b><span class="caja-mrow-d">sin cruzar</span></div>`;
    const md=cajaDiffShort(m.diff);
    return `<div class="caja-mrow"><span>${m.lbl}</span><b>POS ${money(m.pos)} · rec. ${money(m.recv)}</b><span class="caja-mrow-d cjdiff-${md.cls}">${md.txt}</span></div>`;
  }).join('')}</div>`;
}
function cajaClosedCard(c, canVerify){
  const dl=cajaDiffLabel(c.diff); const p=cajaPos(c);
  const badge=c.status==='aprobada'?'<span class="pill hecha">Aprobada</span>':c.status==='observada'?'<span class="pill rechazada">Observada</span>':'<span class="pill pendiente">Cerrada · por revisar</span>';
  const canReview=canVerify&&c.status==='cerrada';
  const mism=cajaHasMethodMismatch(c);
  return `<div class="caja-card">
    <div class="caja-head">${badge}${mism?'<span class="pill rechazada">Difiere en medios</span>':''}<span class="caja-sub">Cerró ${esc(userFirst(c.closedBy))} · ${timeAgo(c.closedAt)}${c.seal?` · sello <b>${esc(c.seal)}</b>`:''}</span></div>
    ${cajaScoreHTML(c)}
    <div class="caja-cross">
      <div class="caja-cross-col"><span>Efectivo esperado (POS)</span><b>${money(c.expectedCash)}</b></div>
      <div class="caja-cross-col"><span>Contado (físico)</span><b>${money(c.countedCash)}</b></div>
      <div class="caja-cross-col diff ${dl.cls}"><span>Descuadre efectivo</span><b>${dl.txt}</b></div>
    </div>
    ${cajaMethodCrossHTML(c)}
    <div class="caja-grid">
      <div class="caja-stat"><span>Efectivo POS</span><b>${money(p.efectivo)}</b></div>
      <div class="caja-stat"><span>Tarjeta POS</span><b>${money(p.tarjeta)}</b></div>
      <div class="caja-stat"><span>SINPE POS</span><b>${money(p.sinpe)}</b></div>
      <div class="caja-stat"><span>Transferencia POS</span><b>${money(p.transfer)}</b></div>
      <div class="caja-stat"><span>Ventas POS totales</span><b>${money(cajaSalesTotal(p))}</b></div>
      <div class="caja-stat"><span>Fondo apertura</span><b>${money(c.openFloat)}</b></div>
      ${+p.descuentos?`<div class="caja-stat"><span>Descuentos/cortesías</span><b>${money(p.descuentos)}</b></div>`:''}
      ${+p.anulaciones?`<div class="caja-stat"><span>Anulaciones</span><b>${p.anulaciones}</b></div>`:''}
    </div>
    ${c.zmid?`<div class="caja-z"><span class="lbl-soft">Reporte Z:</span> ${mediaTag(c.zmid,'image','style="width:54px;height:54px;object-fit:cover;border-radius:8px;cursor:zoom-in;vertical-align:middle" onclick="openImgFromEl(this)"')}</div>`:''}
    ${c.closeNote?`<div class="caja-note">${svgIcon('message','icon icon-sm')} ${esc(c.closeNote)}</div>`:''}
    ${c.reviewNote?`<div class="caja-note"><b>Revisión:</b> ${esc(c.reviewNote)} — ${esc(userFirst(c.reviewedBy))}</div>`:''}
    <div class="caja-actions">
      <button class="btn btn-ghost" onclick="cajaDetail('${c.id}')">${svgIcon('list','icon icon-sm')} Ver detalle</button>
      ${canReview?`<button class="btn btn-primary" onclick="cajaReview('${c.id}','aprobada')">${svgIcon('check','icon icon-sm')} Aprobar</button>
      <button class="btn btn-danger" onclick="cajaReview('${c.id}','observada')">${svgIcon('x','icon icon-sm')} Observar</button>`:''}
    </div>
  </div>`;
}
function cajaRow(c){
  const dl=cajaDiffLabel(c.diff);
  const st=c.status==='abierta'?'<span class="pill proceso">Abierta</span>':c.status==='aprobada'?'<span class="pill hecha">Aprobada</span>':c.status==='observada'?'<span class="pill rechazada">Observada</span>':'<span class="pill pendiente">Por revisar</span>';
  const sc=cajaScore(c);
  return `<div class="caja-row" onclick="cajaDetail('${c.id}')">
    <div class="caja-row-main">
      <div class="caja-row-top">${sc?`<span class="score-dot sd-${sc.level}" title="Día ${sc.level}"></span>`:''}<b>${cajaDateLbl(c.date)}</b> ${st}</div>
      <div class="caja-row-sub">${esc(sucName(c.sucursalId))} · ${c.status==='abierta'?('Fondo '+money(c.openFloat)):('Ventas '+money(cajaSalesTotal(c.sales)))}</div>
    </div>
    ${c.status!=='abierta'?`<div class="caja-row-diff ${dl.cls}">${dl.txt}</div>`:''}
  </div>`;
}
function cajaOpenModal(sucId){
  if(!cajaIsCashier()){ toast('No tenés permiso para abrir caja','err'); return; }
  if(cajaToday(sucId)){ toast('La caja de hoy ya está abierta','err'); return; }
  const pl=cajaPrevLastNum({sucursalId:sucId, date:todayISO()});
  openModal(`
    <div class="modal-head"><h3>${svgIcon('cash','icon')} Abrir caja</h3><button class="modal-close" onclick="closeModal()">${svgIcon('x','icon')}</button></div>
    <div class="modal-body">
      <div class="td-empty" style="margin-bottom:8px">Sucursal: <b>${esc(sucName(sucId))}</b> · ${cajaDateLbl(todayISO())}</div>
      <div class="field"><label>Fondo de apertura <span class="lbl-soft">(efectivo con el que empieza la caja)</span></label><input class="input" id="cjFloat" type="number" min="0" step="any" inputmode="numeric" placeholder="Ej: 50000" value="0"></div>
      <div class="field"><label>Primera factura del día <span class="lbl-soft">(candado de consecutivo${pl!=null?` — ayer terminó en ${pl}`:''})</span></label><input class="input" id="cjFirst" type="number" min="0" step="1" inputmode="numeric" placeholder="Ej: 963" value="${pl!=null?pl+1:''}"></div>
      <div class="td-empty">Durante el día habrá <b>un corte relámpago</b> a una hora sorpresa: la app te avisará para contar el efectivo (1 minuto).</div>
    </div>
    <div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">Cancelar</button><button class="btn btn-primary" onclick="cajaOpen('${sucId}')">Abrir caja</button></div>`, false);
}
function cajaOpen(sucId){
  if(!cajaIsCashier()) return;
  if(cajaToday(sucId)){ toast('Ya está abierta','err'); return; }
  const openFloat=+($('#cjFloat').value)||0;
  const firstNum=($('#cjFirst')?$('#cjFirst').value.trim():'');
  const c={ id:uid(), sucursalId:sucId, date:todayISO(), status:'abierta',
    openFloat, firstNum, openedBy:SES.userId, openAt:now(), movs:[],
    spotAt: now() + Math.round((2 + Math.random()*5)*3600e3),   // corte sorpresa entre 2 y 7 horas después
    sales:null, denom:null, countedCash:0, expectedCash:0, diff:0,
    closedBy:null, closedAt:null, closeNote:'', reviewStatus:null, reviewedBy:null, reviewedAt:null, reviewNote:'',
    log:[{at:now(),byId:SES.userId,text:'abrió la caja con fondo '+money(openFloat)+(firstNum?` · primera factura ${firstNum}`:'')}], updatedAt:now() };
  DB.cajas=DB.cajas||[]; DB.cajas.unshift(c);
  audit('caja',`abrió caja (${sucName(sucId)}) con fondo ${money(openFloat)}`,sucId);
  closeModal(); toast('Caja abierta','ok'); save(); render();
}
let _cajaMovImg=null;
function cajaMovModal(id,type){
  const c=cajaFind(id); if(!c||c.status!=='abierta') return;
  if(!cajaIsCashier()){ toast('Sin permiso','err'); return; }
  _cajaMovImg=null;
  const mt=CAJA_MOV_TYPES[type]||{label:type};
  const needPhoto=(type==='gasto');
  openModal(`
    <div class="modal-head"><h3>${esc(mt.label)}</h3><button class="modal-close" onclick="closeModal()">${svgIcon('x','icon')}</button></div>
    <div class="modal-body">
      <div class="field"><label>Monto (₡)</label><input class="input" id="cmAmt" type="number" min="0" step="any" inputmode="numeric" placeholder="0"></div>
      <div class="field"><label>Concepto / detalle</label><input class="input" id="cmConcept" placeholder="${type==='gasto'?'Ej: compra de hielo':type==='retiro'?'Ej: retiro al fuerte':'Ej: fondo adicional'}" autocomplete="off"></div>
      <div class="field"><label>Comprobante ${needPhoto?'<span style="color:var(--danger)">(obligatorio)</span>':'<span class="lbl-soft">(opcional)</span>'}</label>
        <input type="file" id="cmFile" accept="image/*" onchange="cajaMovPick(this)">
        <div class="img-prev" id="cmPrev"></div>
      </div>
    </div>
    <div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">Cancelar</button><button class="btn btn-primary" onclick="cajaAddMov('${id}','${type}')">Registrar</button></div>`, false);
}
async function cajaMovPick(input){ const arr=await readImages(input.files); _cajaMovImg=(arr&&arr[0])||null; const p=$('#cmPrev'); if(p) p.innerHTML=_cajaMovImg?`<img src="${safeImg(_cajaMovImg)}">`:''; }
async function cajaAddMov(id,type){
  const c=cajaFind(id); if(!c||c.status!=='abierta') return;
  if(!cajaIsCashier()) return;
  const amount=+($('#cmAmt').value)||0;
  if(amount<=0){ toast('Poné un monto válido','err'); return; }
  const concept=$('#cmConcept').value.trim();
  if(type==='gasto' && !_cajaMovImg){ toast('El gasto necesita foto del comprobante','err'); return; }
  let mid=null; if(_cajaMovImg){ try{ mid=await putMedia(_cajaMovImg); }catch(_){} }
  c.movs=c.movs||[]; c.movs.push({id:uid(),type,amount,concept,mid,byId:SES.userId,at:now()});
  c.log.push({at:now(),byId:SES.userId,text:`${CAJA_MOV_TYPES[type].label}: ${money(amount)}${concept?' ('+concept+')':''}`});
  c.updatedAt=now();
  audit('caja',`${CAJA_MOV_TYPES[type].label} ${money(amount)} en caja (${sucName(c.sucursalId)})`,c.sucursalId);
  _cajaMovImg=null; closeModal(); toast('Movimiento registrado','ok'); save(); render();
}
function cajaDelMov(id,mid){
  const c=cajaFind(id); if(!c||c.status!=='abierta') return;
  if(!cajaIsCashier()) return;
  c.movs=(c.movs||[]).filter(m=>m.id!==mid); c.updatedAt=now();
  c.log.push({at:now(),byId:SES.userId,text:'quitó un movimiento'});
  save(); render();
}
let _cajaZImg=null;
function cajaCloseModal(id){
  const c=cajaFind(id); if(!c||c.status!=='abierta') return;
  if(!cajaIsCashier()){ toast('Sin permiso','err'); return; }
  _cajaZImg=null;
  const p=cajaPos(c), rv=cajaRecv(c);
  const tf=cajaFacSums(c);
  // pre-llenar el "sistema" con los totales de las facturas registradas en el día
  const pre = k => { if(p[k]!=null && +p[k]>0) return +p[k]; if(!tf.n) return ''; return Math.round(k==='efectivo'?tf.efectivo:k==='tarjeta'?tf.tarjeta:k==='sinpe'?tf.sinpe:0)||''; };
  const denomRows=CAJA_DENOMS.map(d=>`<div class="denom-row"><span class="denom-face">${money(d)}</span><span class="denom-x">×</span><input class="input denom-in" type="number" min="0" step="1" inputmode="numeric" data-d="${d}" value="" oninput="cajaCalc('${id}')"><span class="denom-sub" id="dsub-${d}">${money(0)}</span></div>`).join('');
  openModal(`
    <div class="modal-head"><h3>${svgIcon('check','icon')} Cerrar caja · control cruzado</h3><button class="modal-close" onclick="closeModal()">${svgIcon('x','icon')}</button></div>
    <div class="modal-body">
      <div class="caja-step">1 · Ventas del sistema <span class="lbl-soft">${tf.n?`(pre-llenado con las ${tf.n} facturas del día — ajustalo con el reporte Z)`:'(lo que dice el reporte Z del POS)'}</span></div>
      <div class="row2"><div class="field"><label>Efectivo (₡)</label><input class="input" id="cpEf" type="number" min="0" step="any" inputmode="numeric" value="${pre('efectivo')}" oninput="cajaCalc('${id}')"></div>
        <div class="field"><label>Tarjeta (₡)</label><input class="input" id="cpTa" type="number" min="0" step="any" inputmode="numeric" value="${pre('tarjeta')}" oninput="cajaCalc('${id}')"></div></div>
      <div class="row2"><div class="field"><label>SINPE (₡)</label><input class="input" id="cpSi" type="number" min="0" step="any" inputmode="numeric" value="${pre('sinpe')}" oninput="cajaCalc('${id}')"></div>
        <div class="field"><label>Transferencia (₡)</label><input class="input" id="cpTr" type="number" min="0" step="any" inputmode="numeric" value="${+p.transfer||''}" oninput="cajaCalc('${id}')"></div></div>
      <div class="field"><label>Última factura del día <span class="lbl-soft">(candado de consecutivo — la del talonario/POS)</span></label><input class="input" id="cpLast" type="number" min="0" step="1" inputmode="numeric" value="${(()=>{const ns=(c.facturas||[]).map(f=>parseInt(f&&f.num,10)).filter(n=>!isNaN(n));return ns.length?Math.max(...ns):'';})()}"></div>
      <div class="row2"><div class="field"><label>Descuentos/cortesías (₡) <span class="lbl-soft">opcional</span></label><input class="input" id="cpDesc" type="number" min="0" step="any" inputmode="numeric" value="${+p.descuentos||''}"></div>
        <div class="field"><label>Anulaciones (cantidad) <span class="lbl-soft">opcional</span></label><input class="input" id="cpAnul" type="number" min="0" step="1" inputmode="numeric" value="${+p.anulaciones||''}"></div></div>
      <div class="field"><label>Foto del reporte Z ${tf.n?'<span class="lbl-soft">(opcional — las facturas son la evidencia)</span>':'<span style="color:var(--danger)">(obligatoria — evidencia)</span>'}</label>
        <input type="file" id="cpZ" accept="image/*" onchange="cajaZPick(this)"><div class="img-prev" id="cpZPrev"></div></div>

      <div class="caja-step">2 · Conteo real <span class="lbl-soft">(lo que hay de verdad)</span></div>
      <div class="ip-sec">Efectivo contado (billetes y monedas)</div>
      <div class="denom-grid">${denomRows}</div>
      <div class="ip-sec">Otros medios recibidos <span class="lbl-soft">(datáfono, comprobantes — opcional)</span></div>
      <div class="row2"><div class="field"><label>Tarjeta recibida (₡)</label><input class="input" id="crTa" type="number" min="0" step="any" inputmode="numeric" value="${rv.tarjeta!=null?rv.tarjeta:''}" oninput="cajaCalc('${id}')"></div>
        <div class="field"><label>SINPE recibido (₡)</label><input class="input" id="crSi" type="number" min="0" step="any" inputmode="numeric" value="${rv.sinpe!=null?rv.sinpe:''}" oninput="cajaCalc('${id}')"></div></div>
      <div class="field"><label>Transferencia recibida (₡)</label><input class="input" id="crTr" type="number" min="0" step="any" inputmode="numeric" value="${rv.transfer!=null?rv.transfer:''}" oninput="cajaCalc('${id}')"></div>

      <div class="caja-step">3 · Cruce</div>
      <div class="caja-live">
        <div class="caja-live-row"><span>Efectivo esperado (POS)</span><b id="cjExpected">${money(cajaExpected(c))}</b></div>
        <div class="caja-live-row"><span>Efectivo contado</span><b id="cjCounted">${money(0)}</b></div>
        <div class="caja-live-row big"><span>Descuadre de efectivo</span><b id="cjDiff" class="cjdiff-ok">—</b></div>
        <div id="cjMethods"></div>
      </div>
      <div class="field"><label>Nota <span class="lbl-soft">(opcional — explicación del descuadre)</span></label><textarea class="textarea" id="cjNote" placeholder="Observaciones…"></textarea></div>
    </div>
    <div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">Cancelar</button><button class="btn btn-primary" onclick="cajaClose('${id}')">${svgIcon('check','icon icon-sm')} Cerrar y registrar</button></div>`, true);
  cajaCalc(id);
}
async function cajaZPick(input){ const arr=await readImages(input.files); _cajaZImg=(arr&&arr[0])||null; const el=$('#cpZPrev'); if(el) el.innerHTML=_cajaZImg?`<img src="${safeImg(_cajaZImg)}">`:''; }
function _cajaReadPos(){ return { efectivo:+($('#cpEf')?$('#cpEf').value:0)||0, tarjeta:+($('#cpTa')?$('#cpTa').value:0)||0, sinpe:+($('#cpSi')?$('#cpSi').value:0)||0, transfer:+($('#cpTr')?$('#cpTr').value:0)||0, descuentos:+($('#cpDesc')?$('#cpDesc').value:0)||0, anulaciones:+($('#cpAnul')?$('#cpAnul').value:0)||0 }; }
function _cajaReadRecv(){ const g=id=>{ const el=$('#'+id); return (el&&el.value!=='')?(+el.value||0):null; }; return { tarjeta:g('crTa'), sinpe:g('crSi'), transfer:g('crTr') }; }
function _cajaReadDenom(){ const denom={}; document.querySelectorAll('.denom-in').forEach(el=>{ denom[el.getAttribute('data-d')]=+el.value||0; }); return denom; }
function cajaCalc(id){
  const c=cajaFind(id); if(!c) return;
  const pos=_cajaReadPos(); const recv=_cajaReadRecv(); const denom=_cajaReadDenom();
  CAJA_DENOMS.forEach(d=>{ const el=$('#dsub-'+d); if(el) el.textContent=money(d*(+denom[d]||0)); });
  const counted=cajaDenomTotal(denom);
  const expected=(+c.openFloat||0)+(+pos.efectivo||0)+cajaCashIn(c)-cajaCashOut(c);
  const diff=counted-expected; const dl=cajaDiffLabel(diff);
  const ce=$('#cjCounted'); if(ce) ce.textContent=money(counted);
  const ex=$('#cjExpected'); if(ex) ex.textContent=money(expected);
  const dd=$('#cjDiff'); if(dd){ dd.textContent=dl.txt; dd.className='cjdiff-'+dl.cls; }
  const mm=$('#cjMethods');
  if(mm){
    const rows=[['tarjeta','Tarjeta'],['sinpe','SINPE'],['transfer','Transferencia']].map(([k,lbl])=>{
      const p=+pos[k]||0; const r=recv[k];
      if(r==null && p===0) return '';
      if(r==null) return `<div class="caja-live-row"><span>${lbl}: POS ${money(p)}</span><b class="cjdiff-ok">sin cruzar</b></div>`;
      const md=cajaDiffShort(r-p);
      return `<div class="caja-live-row"><span>${lbl}: POS ${money(p)} vs ${money(r)}</span><b class="cjdiff-${md.cls}">${md.txt}</b></div>`;
    }).join('');
    mm.innerHTML=rows;
  }
}
function cajaClose(id){
  const c=cajaFind(id); if(!c||c.status!=='abierta') return;
  if(!cajaIsCashier()){ toast('Sin permiso','err'); return; }
  const pos=_cajaReadPos(); const recv=_cajaReadRecv(); const denom=_cajaReadDenom();
  if(cajaSalesTotal(pos)<=0){ toast('Poné las ventas del sistema (facturas o reporte Z)','err'); return; }
  if(!_cajaZImg && !(c.facturas||[]).length){ toast('Falta la foto del reporte Z (o registrá las facturas del día)','err'); return; }
  const counted=cajaDenomTotal(denom);
  (async()=>{
    let zmid=null; try{ zmid=await putMedia(_cajaZImg); }catch(_){}
    c.pos=pos; c.recv=recv; c.sales=pos; c.denom=denom; c.countedCash=counted; c.zmid=zmid;
    c.lastNum=($('#cpLast')?$('#cpLast').value.trim():'');
    if(c.spotAt && !c.spot && now()>c.spotAt+45*60e3) c.spot={skipped:true,at:now()};   // corte sorpresa ignorado
    c.expectedCash=cajaExpected(c);
    c.diff=counted-c.expectedCash;
    c.status='cerrada'; c.closedBy=SES.userId; c.closedAt=now(); c.closeNote=($('#cjNote')?$('#cjNote').value.trim():''); c.updatedAt=now();
    c.seal=await sha6(cajaSealPayload(c));   // sello del día: cualquier alteración posterior lo rompe
    const dl=cajaDiffLabel(c.diff);
    const mism=cajaMethodCross(c).filter(m=>m.diff!=null&&m.diff!==0);
    const mismTxt=mism.length?(' · '+mism.map(m=>`${m.lbl} ${cajaDiffShort(m.diff).txt}`).join(', ')):'';
    _cajaZImg=null;
    const sc=cajaScore(c);
    c.log.push({at:now(),byId:SES.userId,text:`cerró la caja · efectivo ${dl.txt} (contado ${money(counted)} vs esperado ${money(c.expectedCash)})${mismTxt} · sello ${c.seal}`});
    audit('caja',`cerró caja (${sucName(c.sucursalId)}) · ${sc?('día '+sc.level+' · '):''}efectivo ${dl.txt}${mismTxt}`,c.sucursalId);
    if(sc && sc.level!=='verde'){
      const verifiers=DB.users.filter(u=>u&&u.active&&['admin','contarh'].includes(u.role)&&(u.sucursalId===c.sucursalId||u.sucursalId==='all'||!u.sucursalId)).map(u=>u.id);
      notify(verifiers, `${sc.level==='rojo'?'🔴':'🟡'} Caja ${sucName(c.sucursalId)}: ${sc.reasons.filter(r=>r.lv>0).map(r=>r.txt).slice(0,2).join(' · ')}`, '⚠️', {view:'caja'});
    }
    closeModal(); toast(sc&&sc.level==='verde'?'Caja cerrada · día limpio 🟢':'Caja cerrada · revisá el semáforo del día', sc&&sc.level==='verde'?'ok':'err'); save(); render();
  })();
}
function cajaReview(id,status){
  const c=cajaFind(id); if(!c||c.status!=='cerrada') return;
  if(!cajaIsVerifier()){ toast('Solo Gerencia o Contabilidad puede revisar','err'); return; }
  let note='';
  if(status==='observada'){ note=prompt('¿Qué observás en este cierre? (queda registrado)'); if(note===null) return; }
  c.status=status; c.reviewStatus=status; c.reviewedBy=SES.userId; c.reviewedAt=now(); c.reviewNote=(note||'').trim(); c.updatedAt=now();
  const lbl=status==='aprobada'?'aprobó':'observó';
  c.log.push({at:now(),byId:SES.userId,text:`${lbl} el cierre`+(note?`: ${note}`:'')});
  audit('caja',`${lbl} caja (${sucName(c.sucursalId)}) del ${cajaDateLbl(c.date)}`,c.sucursalId);
  notify([c.closedBy], `Tu cierre de caja (${sucName(c.sucursalId)}) fue ${status}`, status==='aprobada'?'✅':'⚠️', {view:'caja'});
  closeModal(); toast('Cierre '+status,'ok'); save(); render();
}
function cajaDetail(id){
  const c=cajaFind(id); if(!c) return;
  const canVerify=cajaIsVerifier();
  const dl=cajaDiffLabel(c.diff); const p=cajaPos(c);
  const denomHtml=c.denom? (CAJA_DENOMS.filter(d=>(+c.denom[d]||0)>0).map(d=>`<div class="denom-row"><span class="denom-face">${money(d)}</span><span class="denom-x">× ${(+c.denom[d]||0)}</span><span class="denom-sub">${money(d*(+c.denom[d]||0))}</span></div>`).join('')||'<div class="td-empty">Sin desglose.</div>') : '<div class="td-empty">Caja no cerrada.</div>';
  const movs=c.movs||[];
  const movHtml=movs.length?movs.map(m=>{const mt=CAJA_MOV_TYPES[m.type]||{label:m.type,sign:-1};return `<div class="caja-mov"><span class="caja-mov-t">${esc(mt.label)}</span><span class="caja-mov-c">${esc(m.concept||'')}</span>${m.mid?mediaTag(m.mid,'image','style="width:30px;height:30px;object-fit:cover;border-radius:6px;cursor:zoom-in;flex:0 0 auto" onclick="openImgFromEl(this)"'):''}<span class="caja-mov-a ${mt.sign<0?'out':'in'}">${mt.sign<0?'−':'+'}${money(m.amount)}</span></div>`;}).join(''):'<div class="td-empty">Sin movimientos.</div>';
  const logHtml=[...(c.log||[])].reverse().map(l=>`<div class="log-item"><b>${esc(userFirst(l.byId))}</b> ${esc(l.text)} · ${timeAgo(l.at)}</div>`).join('');
  const canReview=canVerify&&c.status==='cerrada';
  openModal(`
    <div class="modal-head"><h3>Caja · ${esc(sucName(c.sucursalId))}</h3><button class="modal-close" onclick="closeModal()">${svgIcon('x','icon')}</button></div>
    <div class="modal-body">
      <div class="td-top"><span class="pill ${c.status==='abierta'?'proceso':c.status==='aprobada'?'hecha':c.status==='observada'?'rechazada':'pendiente'}">${cap(c.status)}</span><span class="td-badge">${cajaDateLbl(c.date)}</span>${c.seal?`<span class="td-badge">Sello ${esc(c.seal)} <span id="sealChk">…</span></span>`:''}</div>
      ${cajaScoreHTML(c)}
      ${c.status!=='abierta'?`<div class="caja-cross">
        <div class="caja-cross-col"><span>Efectivo esperado (POS)</span><b>${money(c.expectedCash)}</b></div>
        <div class="caja-cross-col"><span>Contado</span><b>${money(c.countedCash)}</b></div>
        <div class="caja-cross-col diff ${dl.cls}"><span>Descuadre efectivo</span><b>${dl.txt}</b></div></div>
      ${cajaMethodCrossHTML(c)}`:''}
      <div class="td-meta">
        <div class="td-mrow"><span class="td-ml">Fondo apertura</span><span class="td-mv">${money(c.openFloat)}</span></div>
        <div class="td-mrow"><span class="td-ml">Abrió</span><span class="td-mv">${esc(userFirst(c.openedBy))} · ${fmtDateTime(c.openAt)}</span></div>
        ${c.closedBy?`<div class="td-mrow"><span class="td-ml">Cerró</span><span class="td-mv">${esc(userFirst(c.closedBy))} · ${fmtDateTime(c.closedAt)}</span></div>`:''}
        ${c.reviewedBy?`<div class="td-mrow"><span class="td-ml">Revisó</span><span class="td-mv">${esc(userFirst(c.reviewedBy))} · ${fmtDateTime(c.reviewedAt)}</span></div>`:''}
      </div>
      ${c.status!=='abierta'?`<div class="ip-sec">Ventas según el POS (reporte Z)</div>
      <div class="caja-grid">
        <div class="caja-stat"><span>Efectivo</span><b>${money(p.efectivo)}</b></div>
        <div class="caja-stat"><span>Tarjeta</span><b>${money(p.tarjeta)}</b></div>
        <div class="caja-stat"><span>SINPE</span><b>${money(p.sinpe)}</b></div>
        <div class="caja-stat"><span>Transferencia</span><b>${money(p.transfer)}</b></div>
        <div class="caja-stat"><span>Total ventas</span><b>${money(cajaSalesTotal(p))}</b></div>
        ${+p.descuentos?`<div class="caja-stat"><span>Descuentos/cortesías</span><b>${money(p.descuentos)}</b></div>`:''}
        ${+p.anulaciones?`<div class="caja-stat"><span>Anulaciones</span><b>${p.anulaciones}</b></div>`:''}
      </div>
      ${c.zmid?`<div class="caja-z"><span class="lbl-soft">Reporte Z (evidencia):</span><br>${mediaTag(c.zmid,'image','style="max-width:180px;max-height:180px;border-radius:10px;cursor:zoom-in;margin-top:6px" onclick="openImgFromEl(this)"')}</div>`:''}`:''}
      ${(c.facturas||[]).length?`<div class="ip-sec">Facturas del día (${(c.facturas||[]).length}) · TC ₡${cajaTc(c)}</div>${cajaFacTable(c, c.status==='abierta'&&cajaIsCashier())}`:''}
      <div class="ip-sec">Movimientos</div>${movHtml}
      ${c.status!=='abierta'?`<div class="ip-sec">Desglose de efectivo contado</div><div class="denom-grid">${denomHtml}</div>`:''}
      ${c.closeNote?`<div class="caja-note">${esc(c.closeNote)}</div>`:''}
      ${c.reviewNote?`<div class="caja-note"><b>Observación:</b> ${esc(c.reviewNote)}</div>`:''}
      <div class="ip-sec">Bitácora</div><div class="log">${logHtml||'<div class="td-empty">—</div>'}</div>
      ${canReview?`<div class="td-actions"><button class="btn btn-primary" onclick="cajaReview('${c.id}','aprobada')">${svgIcon('check','icon icon-sm')} Aprobar</button><button class="btn btn-danger" onclick="cajaReview('${c.id}','observada')">${svgIcon('x','icon icon-sm')} Observar</button></div>`:''}
    </div>`, true);
  // verificar el sello del día: si alguien alteró los datos después del cierre, no coincide
  if(c.seal){ cajaSealCheck(c).then(ok=>{ const el=document.getElementById('sealChk'); if(el){ el.textContent=ok?'✓ íntegro':'⚠ ALTERADO'; el.style.color=ok?'var(--success)':'var(--danger)'; if(!ok) el.style.fontWeight='800'; } }); }
}
function cajaReportModal(){
  const scoped=(DB.cajas||[]).filter(c=>c&&inScope(c.sucursalId)&&c.status!=='abierta');
  const ym=todayISO().slice(0,7);
  const month=scoped.filter(c=>c.date&&c.date.slice(0,7)===ym);
  const sumDiff=arr=>arr.reduce((s,c)=>s+(+c.diff||0),0);
  const sumSales=arr=>arr.reduce((s,c)=>s+cajaSalesTotal(c.sales),0);
  const faltMonth=month.filter(c=>(+c.diff||0)<0);
  openModal(`
    <div class="modal-head"><h3>${svgIcon('trend','icon')} Reporte de caja</h3><button class="modal-close" onclick="closeModal()">${svgIcon('x','icon')}</button></div>
    <div class="modal-body">
      <div class="ip-sec">Mes actual (${ym})</div>
      <div class="caja-grid">
        <div class="caja-stat"><span>Cierres</span><b>${month.length}</b></div>
        <div class="caja-stat"><span>Ventas totales</span><b>${money(sumSales(month))}</b></div>
        <div class="caja-stat"><span>Descuadre neto</span><b>${money(sumDiff(month))}</b></div>
        <div class="caja-stat"><span>Faltantes</span><b>${faltMonth.length}</b></div>
      </div>
      <div class="td-empty" style="margin-top:8px">Los CSV incluyen todo el historial visible (para Contabilidad): cierres día por día, y facturas una por una.</div>
    </div>
    <div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">Cerrar</button><button class="btn btn-ghost" onclick="cajaFacExportCSV()">${svgIcon('list','icon icon-sm')} CSV facturas</button><button class="btn btn-primary" onclick="cajaExportCSV()">${svgIcon('box','icon icon-sm')} CSV cierres</button></div>`, false);
}
function cajaFacExportCSV(){
  const scoped=(DB.cajas||[]).filter(c=>c&&inScope(c.sucursalId)&&(c.facturas||[]).length).sort((a,b)=>(a.date||'').localeCompare(b.date||''));
  const head=['Fecha','Sucursal','Factura','Efectivo ₡','Efectivo $','BAC ₡','BN ₡','BAC $','BN $','SINPE ₡','Propina ₡','Propina $','TC','Total ₡','Registró'];
  const lines=[head.map(csvCell).join(',')];
  scoped.forEach(c=>{ const tc=cajaTc(c); (c.facturas||[]).forEach(f=>{ if(!f) return;
    lines.push([c.date,sucName(c.sucursalId),f.num||'',+f.efCol||0,+f.efDol||0,+f.bacCol||0,+f.bnCol||0,+f.bacDol||0,+f.bnDol||0,+f.sinpe||0,+f.propCol||0,+f.propDol||0,tc,Math.round(cajaFacTotal(f,tc)),userFirst(f.byId)].map(csvCell).join(','));
  }); });
  downloadText('caja_facturas_'+todayISO()+'.csv', '﻿'+lines.join('\n'), 'text/csv');
  toast('CSV de facturas descargado','ok');
}
function cajaExportCSV(){
  const scoped=(DB.cajas||[]).filter(c=>c&&inScope(c.sucursalId)&&c.status!=='abierta').sort((a,b)=>(b.date||'').localeCompare(a.date||''));
  const head=['Fecha','Sucursal','Estado','Fondo','POS efectivo','POS tarjeta','POS SINPE','POS transf','POS total','Descuentos','Anulaciones','Gastos+retiros','Efectivo esperado','Efectivo contado','Descuadre efectivo','Tarjeta recibida','Dif tarjeta','SINPE recibido','Dif SINPE','Transf recibida','Dif transf','Cerró','Revisó'];
  const lines=[head.map(csvCell).join(',')];
  const md=(c,k)=>{ const m=cajaMethodCross(c).find(x=>x.k===k); return m||{recv:null,diff:null}; };
  scoped.forEach(c=>{ const p=cajaPos(c); const ta=md(c,'tarjeta'),si=md(c,'sinpe'),tr=md(c,'transfer');
    lines.push([c.date,sucName(c.sucursalId),c.status,c.openFloat,+p.efectivo||0,+p.tarjeta||0,+p.sinpe||0,+p.transfer||0,cajaSalesTotal(p),+p.descuentos||0,+p.anulaciones||0,cajaCashOut(c),c.expectedCash,c.countedCash,c.diff,ta.recv==null?'':ta.recv,ta.diff==null?'':ta.diff,si.recv==null?'':si.recv,si.diff==null?'':si.diff,tr.recv==null?'':tr.recv,tr.diff==null?'':tr.diff,userFirst(c.closedBy),c.reviewedBy?userFirst(c.reviewedBy):''].map(csvCell).join(',')); });
  downloadText('caja_'+todayISO()+'.csv', '﻿'+lines.join('\n'), 'text/csv');
  toast('Reporte CSV descargado','ok');
}
window.setCajaSuc=setCajaSuc; window.cajaOpenModal=cajaOpenModal; window.cajaOpen=cajaOpen;
window.cajaMovModal=cajaMovModal; window.cajaMovPick=cajaMovPick; window.cajaAddMov=cajaAddMov; window.cajaDelMov=cajaDelMov;
window.cajaCloseModal=cajaCloseModal; window.cajaCalc=cajaCalc; window.cajaClose=cajaClose; window.cajaZPick=cajaZPick;
window.cajaReview=cajaReview; window.cajaDetail=cajaDetail; window.cajaReportModal=cajaReportModal; window.cajaExportCSV=cajaExportCSV;
window.cajaSetTc=cajaSetTc; window.cajaFacModal=cajaFacModal; window.cajaFacSave=cajaFacSave; window.cajaFacDel=cajaFacDel; window.cajaFacExportCSV=cajaFacExportCSV;
window.cajaSpotModal=cajaSpotModal; window.cajaSpotSave=cajaSpotSave;

/* =====================================================================
   VISTA: CÁMARAS (gerencia) — sistema de seguridad 24/7 sin suscripción
   Muestra los streams del puente local (wyze-bridge + Frigate vía Tailscale).
   Guía completa: docs/GUIA-CAMARAS.md en el repositorio.
   ===================================================================== */
let camView='mosaico', camSel='', camTab='vivo', _camRescueAt=0;
function camList(){ return (DB.camaras||[]).filter(c=>c&&c.type!=='rec').sort((a,b)=>(a.ord||0)-(b.ord||0)); }
function camRec(){ return (DB.camaras||[]).find(c=>c&&c.type==='rec'); }
/* Rescate: si este dispositivo no tiene cámaras (arranque sin señal, carrera al iniciar,
   datos viejos purgados), pedirlas DIRECTO a la nube y adoptarlas. */
async function camCloudRescue(manual){
  if(!fbdb || !cloudOn){ if(manual) toast('Este dispositivo no está conectado a la nube todavía','err'); return; }
  try{
    const snap=await fbdb.ref('state/data/camaras').get();
    const arr=snap && snap.exists() ? snap.val() : null;
    const list=Array.isArray(arr)?arr.filter(Boolean):[];
    if(list.length){
      DB.camaras=list;
      migrate(true);                       // aplica validación/purga
      if((DB.camaras||[]).length){ save(); toast('Cámaras conectadas ✅','ok'); render(); return; }
    }
    if(manual) toast('La nube aún no tiene cámaras publicadas. Revisá que la compu de las cámaras esté encendida.','err');
  }catch(e){ if(manual) toast('No se pudo leer la nube: '+((e&&e.code)||'error'),'err'); }
}
window.camCloudRescue=camCloudRescue;
function camFull(id){ const el=document.getElementById('camtile-'+id); if(!el) return; try{ (el.requestFullscreen||el.webkitRequestFullscreen).call(el); }catch(_){ toast('Este navegador no permite pantalla completa','err'); } }
function camReload(id){ const f=document.getElementById('camfr-'+id); if(f){ const s=f.src; f.src='about:blank'; setTimeout(()=>{ f.src=s; },60); } }
function camFrame(c, big){
  return `<div class="cam-tile ${big?'big':''}" id="camtile-${c.id}">
    <iframe id="camfr-${c.id}" src="${esc(c.url)}" allow="autoplay; fullscreen" allowfullscreen loading="lazy" referrerpolicy="no-referrer"></iframe>
    <div class="cam-name">${esc(c.name)}</div>
    <div class="cam-btns">
      <button class="cam-ctl" title="Recargar señal" onclick="camReload('${c.id}')">↻</button>
      <button class="cam-ctl" title="Pantalla completa" onclick="camFull('${c.id}')"><svg class="icon icon-sm" viewBox="0 0 24 24" style="stroke:#fff"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg></button>
      ${big?'':`<button class="cam-ctl" title="Ver grande" onclick="camView='una';camSel='${c.id}';render()">${svgIcon('search','icon icon-sm')}</button>`}
    </div>
  </div>`;
}
function viewCamaras(){
  const cams=camList(); const rec=camRec();
  let html=`<div class="page-head"><div><div class="page-title">Cámaras</div><div class="page-sub">Seguridad 24/7 · sin suscripción · ${cams.length} cámara${cams.length===1?'':'s'}</div></div>
    <div class="ph-spacer"></div>
    ${isAdmin()?`<button class="btn btn-ghost" style="flex:0 0 auto" onclick="camConfigModal()">${svgIcon('edit','icon icon-sm')} Configurar</button>`:''}
  </div>`;
  html+=sectionGuide('camaras','¿Cómo funcionan las Cámaras?',`
    Tus cámaras del restaurante, <b>en vivo y grabadas 24/7</b>, sin pagar suscripción.
    <ul style="margin:8px 0 0 18px">
      <li><b>En vivo</b>: todas a la vez (mosaico) o una en grande, con pantalla completa.</li>
      <li><b>Grabaciones</b>: la línea de tiempo — retrocedé a cualquier momento de los últimos días; los movimientos de <b>personas</b> quedan marcados solos.</li>
      <li>Las cámaras <b>se conectan solas</b>: basta que la compu de las cámaras esté encendida. Se ven desde cualquier lugar, sin instalar nada en el celular.</li>
    </ul>`);
  if(!cams.length){
    // rescate automático: pedirlas directo a la nube (máx. 1 vez cada 30s)
    if(now()-_camRescueAt>30000){ _camRescueAt=now(); setTimeout(()=>camCloudRescue(false),50); }
    html+=`<div class="empty" style="padding:40px 20px"><div class="em-ico">📹</div><div class="em-t">Tu sistema de cámaras, gratis</div>
      <div class="em-d" style="max-width:480px;margin:0 auto">Con tus cámaras Wyze + una compu encendida en el restaurante tenés: <b>todo en vivo acá adentro</b>, grabación 24/7, retroceder a cualquier momento y detección de personas — <b>₡0 al mes</b>. Al instalar el sistema en esa compu, las cámaras <b>aparecen acá solas</b> en ~2 minutos.</div>
      ${_cloudConnected===false?'<div class="td-empty" style="margin-top:12px;color:var(--danger)">⚠️ Este dispositivo aparece SIN CONEXIÓN a la nube ahora mismo — las cámaras llegan por ahí. Revisá el internet de este aparato.</div>':''}
      <div style="margin-top:16px;display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
        <button class="btn btn-primary" onclick="camCloudRescue(true)">${svgIcon('video','icon icon-sm')} Buscar cámaras ahora</button>
        <button class="btn btn-ghost" onclick="camGuideModal()">${svgIcon('list','icon icon-sm')} Ver los pasos</button>
      </div></div>`;
    return html;
  }
  // Pestañas: En vivo · Grabaciones
  html+=`<div class="seg cam-tabs">
    <button type="button" class="seg-b ${camTab==='vivo'?'on':''}" onclick="camTab='vivo';render()">${svgIcon('video','icon icon-sm')} En vivo</button>
    <button type="button" class="seg-b ${camTab==='rec'?'on':''}" onclick="camTab='rec';render()">⏪ Grabaciones</button>
  </div>`;
  if(camTab==='rec'){
    if(rec){
      html+=`<div class="cam-rec-wrap"><iframe id="camfr-rec" src="${esc(rec.url)}" allow="fullscreen" allowfullscreen referrerpolicy="no-referrer"></iframe></div>
        <div class="td-empty" style="margin-top:10px">Arrastrá la línea de tiempo para retroceder · los cuadritos marcan <b>personas y movimiento</b> detectados. <button class="chip" onclick="camReload('rec')">↻ Recargar</button> <a class="chip" href="${esc(rec.url)}" target="_blank" rel="noopener">Abrir aparte ↗</a></div>`;
    } else {
      html+=`<div class="empty" style="padding:36px 20px"><div class="em-ico">⏪</div><div class="em-t">Grabaciones aún sin conectar</div>
        <div class="em-d" style="max-width:440px;margin:0 auto">Se conectan <b>solas</b> cuando el sistema está corriendo en la compu de las cámaras. Si en ~2 minutos no aparecen, revisá que esa compu esté <b>encendida y con internet</b>.</div>
      </div>`;
    }
    return html;
  }
  // En vivo
  html+=`<div class="toolbar" style="margin-bottom:10px">
    <div class="seg"><button type="button" class="seg-b ${camView==='mosaico'?'on':''}" onclick="camView='mosaico';render()">Mosaico</button><button type="button" class="seg-b ${camView==='una'?'on':''}" onclick="camView='una';render()">Una por una</button></div>
    <div class="ph-spacer"></div>
    <button class="btn btn-ghost" style="flex:0 0 auto;padding:9px 13px" onclick="render()" title="Recargar todas las señales">↻ Recargar</button>
  </div>`;
  if(camView==='una'){
    const cur=cams.find(c=>c.id===camSel)||cams[0];
    if(cams.length>1) html+=`<div class="chipscroll">${cams.map(c=>`<button class="chip ${cur&&c.id===cur.id?'on':''}" onclick="camSel='${c.id}';render()">${esc(c.name)}</button>`).join('')}</div>`;
    html+=cur?camFrame(cur,true):'';
  } else {
    html+=`<div class="cam-grid">${cams.map(c=>camFrame(c,false)).join('')}</div>`;
  }
  html+=`<div class="td-empty" style="margin-top:12px">¿No se ve? Revisá que la <b>compu de las cámaras esté encendida y con internet</b>, y tocá ↻ Recargar. Si esa compu se reinició, la conexión se renueva sola en ~1 minuto.</div>`;
  return html;
}
/* Panel de configuración (gerencia): lista de cámaras + acciones */
function camConfigModal(){
  if(!isAdmin()) return;
  const cams=camList(); const rec=camRec();
  openModal(`
    <div class="modal-head"><h3>${svgIcon('video','icon')} Configurar cámaras</h3><button class="modal-close" onclick="closeModal()">${svgIcon('x','icon')}</button></div>
    <div class="modal-body">
      ${cams.length?`<div class="ip-sec">Cámaras conectadas (${cams.length})</div>
      ${cams.map(c=>`<div class="camcfg-row"><b>${esc(c.name)}</b><span class="camcfg-url">${esc(c.url)}</span><button class="chip" onclick="camModal('${c.id}')">Editar</button></div>`).join('')}`:'<div class="td-empty">Sin cámaras conectadas todavía.</div>'}
      <div class="ip-sec">Grabaciones</div>
      <div class="camcfg-row">${rec?`<b>Conectadas</b><span class="camcfg-url">${esc(rec.url)}</span>`:'<span class="td-empty" style="padding:0">Sin conectar</span>'}<button class="chip" onclick="camModal()">${rec?'Cambiar':'Conectar'}</button></div>
      <div class="td-empty" style="margin-top:12px">Las cámaras se conectan y actualizan <b>solas</b> desde la compu del sistema (cada minuto). "Importar" y "Agregar" quedan solo para casos especiales.</div>
    </div>
    <div class="modal-foot">
      <button class="btn btn-ghost" onclick="camGuideModal()">${svgIcon('list','icon icon-sm')} Guía</button>
      <button class="btn btn-ghost" onclick="camImportModal()">${svgIcon('box','icon icon-sm')} Importar</button>
      <button class="btn btn-primary" onclick="camModal()">${svgIcon('plus','icon icon-sm')} Agregar cámara</button>
    </div>`, true);
}
function camModal(id){
  if(!isAdmin()) return;
  const c=id?(DB.camaras||[]).find(x=>x&&x.id===id):null;
  const rec=camRec();
  openModal(`
    <div class="modal-head"><h3>${svgIcon('video','icon')} ${c?'Editar cámara':'Agregar cámara'}</h3><button class="modal-close" onclick="closeModal()">${svgIcon('x','icon')}</button></div>
    <div class="modal-body">
      <div class="field"><label>Nombre</label><input class="input" id="cmName" value="${c?esc(c.name):''}" placeholder="Ej: Comedor" autocomplete="off"></div>
      <div class="field"><label>Dirección del video (del puente)</label><input class="input" id="cmUrl" value="${c?esc(c.url):''}" placeholder="https://tu-pc.tu-red.ts.net/comedor/" autocomplete="off" style="font-size:13px"></div>
      <div class="td-empty" style="margin-bottom:14px">Es la dirección que da el puente por cada cámara (Paso 6 de la guía).</div>
      <div class="ip-sec">Grabaciones (una sola vez)</div>
      <div class="field"><label>URL de grabaciones (Frigate) <span class="lbl-soft">(opcional)</span></label><input class="input" id="cmRec" value="${rec?esc(rec.url):''}" placeholder="https://tu-pc.tu-red.ts.net:8443" autocomplete="off" style="font-size:13px"></div>
    </div>
    <div class="modal-foot">
      ${c?`<button class="btn btn-danger" onclick="camDel('${c.id}')">${svgIcon('trash','icon icon-sm')} Quitar</button>`:''}
      <button class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary" onclick="camSave('${c?c.id:''}')">${svgIcon('check','icon icon-sm')} Guardar</button>
    </div>`, false);
}
function camSave(id){
  if(!isAdmin()) return;
  const name=$('#cmName').value.trim(), url=$('#cmUrl').value.trim(), recUrl=$('#cmRec').value.trim();
  if(name||url){
    if(!name||!url){ toast('Poné nombre y dirección','err'); return; }
    if(!/^https:\/\/[^\/\s?#]+\.[^\/\s?#]+/i.test(url)){ toast('La dirección debe ser https:// con dominio completo','err'); return; }
    DB.camaras=DB.camaras||[];
    if(id){ const c=DB.camaras.find(x=>x&&x.id===id); if(c){ c.name=name; c.url=url; c.updatedAt=now(); } }
    else DB.camaras.push({id:uid(),name,url,ord:camList().length,updatedAt:now()});
    audit('camaras',`${id?'editó':'agregó'} la cámara "${name}"`,'all');
  }
  // URL de grabaciones (registro único)
  const rec=camRec();
  if(recUrl){ if(rec){ rec.url=recUrl; rec.updatedAt=now(); } else DB.camaras.push({id:uid(),type:'rec',name:'Grabaciones',url:recUrl,updatedAt:now()}); }
  else if(rec){ DB.camaras=DB.camaras.filter(x=>x!==rec); tomb(rec.id); }
  closeModal(); toast('Guardado ✅','ok'); save(); render();
}
function camDel(id){
  if(!isAdmin()) return;
  const c=(DB.camaras||[]).find(x=>x&&x.id===id); if(!c) return;
  if(!confirm(`¿Quitar la cámara "${c.name}"?`)) return;
  DB.camaras=DB.camaras.filter(x=>x.id!==id); tomb(id);
  audit('camaras',`quitó la cámara "${c.name}"`,'all');
  closeModal(); toast('Cámara quitada','ok'); save(); render();
}
function camGuideModal(){
  openModal(`
    <div class="modal-head"><h3>📹 Montar el sistema de cámaras (una vez, ~40 min)</h3><button class="modal-close" onclick="closeModal()">${svgIcon('x','icon')}</button></div>
    <div class="modal-body" style="font-size:13.5px;line-height:1.7">
      <div class="ip-sec">Qué se ocupa</div>
      <ul style="margin:0 0 12px 18px"><li>Una <b>compu con Windows encendida 24/7</b> en el restaurante (una vieja sirve).</li><li>Un <b>disco de 1 TB</b> para grabaciones (~2–4 semanas, se recicla solo).</li><li>Recomendado: <b>microSD</b> en cada cámara (respaldo si apagan la compu).</li></ul>
      <div class="ip-sec">Los pasos (en la compu de las cámaras)</div>
      <ol style="margin:0 0 12px 18px">
        <li>Conseguí la carpeta <b>instalador</b> (está en el repositorio de la app: docs/instalador).</li>
        <li>Doble clic a <b>INSTALAR-TODO.bat</b> — hace todo solo: instala el motor, te pregunta tus datos de Wyze, encuentra las cámaras y deja grabando 24/7 con detección de personas.</li>
        <li>Energía de Windows en <b>"Suspender: Nunca"</b> (para que grabe siempre).</li>
        <li>Listo: en <b>~2 minutos las cámaras aparecen SOLAS acá</b> (en vivo y grabaciones), desde cualquier celular, <b>sin instalar nada</b>.</li>
      </ol>
      <div class="td-empty">Si la compu de las cámaras se apaga, al encenderla todo vuelve solo. La guía detallada está en el repositorio: <b>docs/GUIA-CAMARAS.md</b>.</div>
    </div>
    <div class="modal-foot"><button class="btn btn-primary" onclick="closeModal()">Entendido</button></div>`, true);
}
/* Importar cámaras: pegar el "código de conexión" que genera 3-CONECTAR-APP.bat
   (lo deja copiado en el portapapeles) y todas las cámaras quedan conectadas de una. */
function camImportModal(){
  if(!isAdmin()) return;
  openModal(`
    <div class="modal-head"><h3>${svgIcon('video','icon')} Importar cámaras</h3><button class="modal-close" onclick="closeModal()">${svgIcon('x','icon')}</button></div>
    <div class="modal-body">
      <div class="td-empty" style="margin-bottom:12px">En la compu de las cámaras corré <b>3-CONECTAR-APP.bat</b>: al final deja el <b>código de conexión</b> copiado en el portapapeles. Pegalo acá y listo — todas las cámaras se conectan de una.</div>
      <div class="field"><label>Código de conexión</label><textarea class="textarea" id="ciCode" style="min-height:130px;font-family:ui-monospace,Consolas,monospace;font-size:12px" placeholder='{"camaras":[{"name":"Comedor","url":"https://..."}],"grabaciones":"https://..."}'></textarea></div>
    </div>
    <div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">Cancelar</button><button class="btn btn-primary" onclick="camImportSave()">${svgIcon('check','icon icon-sm')} Conectar cámaras</button></div>`, true);
}
function camImportSave(){
  if(!isAdmin()) return;
  let data;
  try{ data=JSON.parse(($('#ciCode')?$('#ciCode').value:'').trim()); }
  catch(_){ toast('El código no se pudo leer — pegalo completo, tal cual','err'); return; }
  const list = Array.isArray(data) ? data : (data.camaras||[]);
  const rec = Array.isArray(data) ? '' : (data.grabaciones||'');
  DB.camaras=DB.camaras||[];
  let n=0;
  (list||[]).forEach(c=>{
    if(!c||!c.name||!c.url||!/^https:\/\/[^\/\s?#]+\.[^\/\s?#]+/i.test(String(c.url))) return;
    const ex=DB.camaras.find(x=>x&&x.type!=='rec'&&x.name===c.name);
    if(ex){ ex.url=String(c.url); ex.updatedAt=now(); }
    else DB.camaras.push({id:uid(),name:String(c.name),url:String(c.url),ord:camList().length+n,updatedAt:now()});
    n++;
  });
  if(rec && /^https:\/\//i.test(String(rec))){
    const r=camRec();
    if(r){ r.url=String(rec); r.updatedAt=now(); }
    else DB.camaras.push({id:uid(),type:'rec',name:'Grabaciones',url:String(rec),updatedAt:now()});
  }
  if(!n && !rec){ toast('El código no traía cámaras','err'); return; }
  audit('camaras',`importó ${n} cámara(s) con el código de conexión`,'all');
  closeModal(); toast(`${n} cámara(s) conectadas ✅`,'ok'); save(); render();
}
window.viewCamaras=viewCamaras; window.camModal=camModal; window.camSave=camSave; window.camDel=camDel; window.camGuideModal=camGuideModal;
window.camImportModal=camImportModal; window.camImportSave=camImportSave;
window.camConfigModal=camConfigModal; window.camFull=camFull; window.camReload=camReload;

/* =====================================================================
   VISTA: AUDITORÍA (admin) — movimientos, anti-fraude
   ===================================================================== */
let auditFilter='todos';
function viewAuditoria(){
  const guide=sectionGuide('auditoria','¿Qué son los Movimientos?',`
    Es el <b>registro de todo lo que pasa</b> en la app: quién creó, cambió o entregó algo, y cuándo.
    <ul style="margin:8px 0 0 18px">
      <li>Solo se agrega: las acciones quedan registradas con quién y cuándo.</li>
      <li>Sirve para saber <b>quién cumple y quién no</b>, y detectar movimientos raros.</li>
    </ul>
    <div class="tip"><b>Importante:</b> esta es tu herramienta de control total. Revisala seguido.</div>`);
  const types=[['todos','Todo'],['tarea','Tareas'],['pedido','Pedidos'],['proyecto','Proyectos'],['chat','Chats'],['equipo','Equipo']];
  const chips=types.map(([k,l])=>`<button class="chip ${auditFilter===k?'on':''}" onclick="setAuditFilter('${k}')">${l}</button>`).join('');
  let list=DB.audit.filter(a=>inScope(a.sucursalId));
  if(auditFilter!=='todos') list=list.filter(a=>a.action===auditFilter);

  let html=`<div class="page-head"><div><div class="page-title">Movimientos</div><div class="page-sub">Registro de control · ${DB.audit.length} eventos</div></div></div>`;
  html+=guide;
  html+=`<div class="toolbar">${chips}</div>`;
  html+=`<div class="card">`;
  html+= list.length? `<div class="log" style="border-left-color:var(--border)">`+list.slice(0,200).map(a=>{
    const u=userById(a.byId);
    return `<div class="log-item"><b>${u?esc(u.name):'—'}</b> ${esc(a.detail)} <span style="opacity:.7">· ${ROLES[u?u.role:'admin']?.short||''} · ${esc(sucName(a.sucursalId))} · ${fmtDateTime(a.at)}</span></div>`;
  }).join('')+`</div>` : emptyState('🛡️','Sin movimientos aún','Apenas el equipo empiece a trabajar, todo queda registrado acá.');
  html+=`</div>`;
  return html;
}
window.setAuditFilter=k=>{auditFilter=k;render();};

/* =====================================================================
   PANEL POR PUESTO (en Inicio)
   ===================================================================== */
const CAT_EMOJI={Verduras:'🥬',Carnes:'🥩',Abarrotes:'🛒',Bebidas:'🥤',Desechables:'🧻',Limpieza:'🧼'};
function bar(label,val,max,color){
  const pct=max?Math.round(val/max*100):0;
  return `<div style="margin-bottom:11px"><div style="display:flex;justify-content:space-between;font-size:12.5px;margin-bottom:5px"><span>${esc(label)}</span><span style="color:var(--text-soft);font-variant-numeric:tabular-nums">${val}</span></div>
    <div style="height:8px;background:var(--bg-soft);border-radius:5px;overflow:hidden"><div style="height:100%;width:${pct}%;background:${color||'var(--accent)'};border-radius:5px;transition:width .4s var(--ease-out)"></div></div></div>`;
}
function rolePanel(){
  const r=me().role;
  const wrap=(title,sub,btns)=>`<div class="card"><div style="font-weight:700;font-size:15px">${title}</div>${sub?`<div class="page-sub" style="margin:4px 0 12px">${sub}</div>`:'<div style="height:8px"></div>'}<div class="toolbar" style="margin:0;flex-wrap:wrap">${btns}</div></div>`;
  const b=(t,a)=>`<button class="btn btn-ghost" style="flex:0 0 auto" onclick="${a}">${t}</button>`;
  if(r==='proveeduria'){
    const low=invInScope().filter(lowStock).length, tot=invInScope().length;
    return wrap('📊 Tu puesto · Proveeduría', `${low} producto(s) bajo el mínimo · ${tot} en inventario`,
      b('Ver inventario',"go('inventario')")+b('+ Producto',"invNewModal()")+b('Pedidos a mi área',"go('pedidos')"));
  }
  if(r==='chef'){
    const dishes=DB.recipes.filter(x=>inScope(x.sucursalId)).length;
    return wrap('🍳 Tu puesto · Chef', `${dishes} receta(s) en el menú`,
      b('Asignar a cocina',"newTaskModal()")+b('Recetas / Menú',"go('recetas')")+b('Ver inventario',"go('inventario')")+b('Pedir insumos',"newPedidoModal()"));
  }
  if(r==='cocinero'){
    return wrap('🍳 Tu puesto · Cocina','Tus tareas, recetas e insumos',
      b('Recetas del día',"go('recetas')")+b('Ver inventario',"go('inventario')")+b('Pedir insumos',"newPedidoModal()"));
  }
  if(r==='jefe_salon'){
    return wrap('🍽️ Tu puesto · Jefe de Salón','Equipo de salón y turnos',
      b('Asignar a saloneros',"newTaskModal()")+b('Horarios',"go('horarios')")+b('Pedir al salón',"newPedidoModal()"));
  }
  if(r==='salonero'){
    return wrap('🍽️ Tu puesto · Salonero','Tus tareas y tu horario',
      b('Mi horario',"go('horarios')")+b('Pedir algo',"newPedidoModal()"));
  }
  if(r==='contarh'){
    const sol=(DB.pedidos||[]).filter(p=>(p.area==='rrhh'||p.area==='contabilidad')&&(p.status==='pendiente'||p.status==='proceso')&&inScope(p.sucursalId)).length;
    const val=invInScope().reduce((s,p)=>s+p.stock*p.cost,0);
    return wrap('Tu puesto · Contabilidad y Recursos', `${sol} solicitud(es) por atender · inventario ${money(val)}`,
      b('Solicitudes',"go('pedidos')")+b('Equipo',"go('equipo')")+b('Horarios',"go('horarios')")+b('Reportes',"go('reportes')"));
  }
  if(r==='gerencia_exp'){
    return wrap('Tu puesto · Gerencia de Experiencia','Calidad de servicio, equipo y turnos',
      b('Reportes',"go('reportes')")+b('Horarios',"go('horarios')")+b('Asignar tarea',"newTaskModal()"));
  }
  if(r==='gerencia_data'){
    return wrap('Tu puesto · Gerencia de Estadística y Diseño','Datos del negocio y proyectos de diseño',
      b('Reportes',"go('reportes')")+b('Proyectos',"go('proyectos')")+b('Inventario',"go('inventario')"));
  }
  if(r==='bartender'){
    return wrap('Tu puesto · Bartender','Tus tareas, recetas de barra e insumos',
      b('Recetas',"go('recetas')")+b('Ver inventario',"go('inventario')")+b('Pedir insumos',"newPedidoModal()"));
  }
  if(r==='admin'){
    const low=invInScope().filter(lowStock).length;
    return wrap('Gerencia · control total', `${low} alerta(s) de inventario · vista de ${sucName(SES.sucFilter)}`,
      b('Reportes',"go('reportes')")+b('Inventario',"go('inventario')")+b('Equipo',"go('equipo')")+b('Movimientos',"go('auditoria')"));
  }
  return '';
}

/* =====================================================================
   VISTA: INVENTARIO  (Proveeduría edita · otros consultan)
   ===================================================================== */
let invCat='todas', invLowOnly=false, invSearch='', invArea='todas', invBodega='todas', invSel=null, ipImgData=null, invSort='manual';
let invSelMode=false; const invPicks=new Set();   // modo "Organizar": mover varios productos de familia a la vez
let invMode='edit', invDragId=null;                // 'edit' (gerencia/admin) | 'count' (conteo diario, colaboradores)
/* Bodegas (lugares de almacenamiento, ej. Congelador 1) */
function bodegasFor(){ return (DB.bodegas||[]).filter(b=>b&&inScope(b.sucursalId)); }
function bodegaName(id){ if(!id) return 'Sin bodega'; const b=(DB.bodegas||[]).find(x=>x&&x.id===id); return b?b.name:'Sin bodega'; }
/* Color para la familia (puntito del menú izquierdo y borde de la tarjeta) */
const FAM_COLORS=['#22c55e','#f59e0b','#ea580c','#0ea5b7','#16a34a','#8b5cf6','#e11d48','#475569','#d97706','#0891b2','#db2777','#64748b'];
function famColor(name){ let h=0; const s=String(name||''); for(let i=0;i<s.length;i++) h=(h*31+s.charCodeAt(i))>>>0; return FAM_COLORS[h%FAM_COLORS.length]; }
const INV_SORT_LABEL={manual:'Orden manual',nombre:'Nombre A-Z',stockDesc:'Más cantidad',stockAsc:'Menos cantidad',valor:'Mayor valor',bajo:'Bajo mínimo primero'};
function setInvSort(v){ invSort=v; render(); }
window.setInvSort=setInvSort;
/* Adivinar la familia (categoría) por el nombre del producto — para autocompletar al cargar factura */
const FAMILY_KEYWORDS=[
  ['Verduras','tomate,cebolla,lechuga,papa,zanahoria,chile,culantro,ajo,limon,limón,aguacate,brocoli,brócoli,vegetal,verdura,banano,fruta,platano,plátano,repollo,pepino,apio,espinaca,yuca,camote'],
  ['Carnes','carne,res,pollo,cerdo,chuleta,lomo,pescado,atun,atún,jamon,jamón,salchicha,tocineta,bistec,molida,costilla,chorizo,mariscos,camaron,camarón'],
  ['Abarrotes','arroz,frijol,frijoles,aceite,sal,azucar,azúcar,harina,pasta,salsa,mayonesa,ketchup,mostaza,especias,condimento,enlatado,lata,vinagre,maiz,maíz,avena,cereal,café,cafe'],
  ['Bebidas','agua,gaseosa,refresco,jugo,te,té,leche,bebida'],
  ['Desechables','servilleta,vaso,plato,cuchara,tenedor,bolsa,desechable,papel,envase,contenedor,pajilla'],
  ['Limpieza','jabon,jabón,cloro,desinfectante,detergente,limpiador,esponja,escoba,limpieza,guante'],
  ['Licores','ron,vodka,whisky,whiskey,tequila,ginebra,gin,licor,vino,guaro,cacique'],
  ['Cervezas','cerveza,imperial,pilsen,bavaria,heineken,corona'],
  ['Gaseosas','coca,cola,fanta,sprite,pepsi,gaseosa,fresca'],
  ['Jugos','jugo,naranja,natural'],
  ['Garnish','garnish,menta,hierbabuena,decoracion,decoración,cereza'],
  ['Hielo','hielo'],
];
function guessFamily(name, cats){
  const n=(name||'').toLowerCase(); if(!n) return '';
  for(const [fam,kw] of FAMILY_KEYWORDS){ if(!cats.includes(fam)) continue; if(kw.split(',').some(k=>k&&n.includes(k))) return fam; }
  return '';   // si no se reconoce, dejar "Sin familia" (mejor que amontonar todo en la primera)
}
function viewInventario(){
  const areas=invAreasFor();
  if(areas.length<=1) invArea='todas';
  const editor=canInvEdit();
  const all=invInScope();
  const searching=!!invSearch;
  const scoped = invArea!=='todas' ? all.filter(p=>(p.area||'cocina')===invArea) : all;
  const bods=bodegasFor();
  const famList = catsVisible();
  window._invFams = famList;                            // para los onclick del menú izquierdo
  const inFam = (p,c)=>{ if(c==='__sin__') return !p.category || !famList.includes(p.category); return (p.category||'')===c; };
  if(invSel && invSel!=='__new__' && !DB.inventory.find(x=>x.id===invSel)) invSel=null;  // se borró

  // ----- lista central -----
  let list = searching ? [...all] : [...scoped];
  if(invBodega!=='todas') list=list.filter(p=>(p.bodega||'')===(invBodega==='sin'?'':invBodega));
  if(!searching && invCat!=='todas') list=list.filter(p=>inFam(p,invCat));
  if(invLowOnly) list=list.filter(lowStock);
  if(searching) list=list.filter(p=>p.name.toLowerCase().includes(invSearch.toLowerCase()));
  const ordOf = p => (p.ord==null?1e9:p.ord);
  const SORTERS={
    manual:(a,b)=>(ordOf(a)-ordOf(b))||a.name.localeCompare(b.name),
    nombre:(a,b)=>a.name.localeCompare(b.name),
    stockAsc:(a,b)=>((+a.stock||0)-(+b.stock||0))||a.name.localeCompare(b.name),
    stockDesc:(a,b)=>((+b.stock||0)-(+a.stock||0))||a.name.localeCompare(b.name),
    valor:(a,b)=>((b.stock*b.cost)-(a.stock*a.cost))||a.name.localeCompare(b.name),
    bajo:(a,b)=>(lowStock(b)-lowStock(a))||((+a.stock||0)-(+b.stock||0))
  };
  list.sort(SORTERS[invSort]||SORTERS.manual);
  window._invList = list.map(p=>p.id);                  // para "Seleccionar todo" del modo organizar
  if(invSelMode) invSel=null;                           // en modo organizar no se edita
  const mode = editor ? invMode : 'count';              // colaboradores: siempre conteo diario
  const low=scoped.filter(lowStock).length;
  const totVal=scoped.reduce((s,p)=>s+(+p.stock||0)*(+p.cost||0),0);
  const sinFam = scoped.filter(p=>!p.category || !famList.includes(p.category)).length;
  const sel = invSel==='__new__' ? '__new__' : (invSel?DB.inventory.find(x=>x.id===invSel):null);

  // =================== MENÚ IZQUIERDO: FAMILIAS ===================
  const side=`<aside class="inv-side">
    <div class="inv-side-h"><span>${svgIcon('list','icon icon-sm')} Familias</span><span class="inv-side-count">${famList.length}</span></div>
    ${areas.length>1?`<div class="seg inv-seg inv-side-seg">
      <button type="button" class="seg-b ${invArea==='todas'?'on':''}" onclick="invArea='todas';invCat='todas';render()">Ambas</button>
      <button type="button" class="seg-b ${invArea==='cocina'?'on':''}" onclick="invArea='cocina';invCat='todas';render()">${svgIcon('utensils','icon icon-sm')}</button>
      <button type="button" class="seg-b ${invArea==='bar'?'on':''}" onclick="invArea='bar';invCat='todas';render()">${svgIcon('coffee','icon icon-sm')}</button>
    </div>`:''}
    <div class="inv-fam-list">
      <button class="inv-fam-row ${invCat==='todas'?'on':''}" onclick="invCat='todas';invSearch='';render()">
        <span class="inv-fam-ico">${svgIcon('box','icon icon-sm')}</span><span class="inv-fam-lbl">Todas las familias</span><span class="inv-fam-c">${scoped.length}</span></button>
      ${famList.map((c,i)=>`<div class="inv-fam-row ${invCat===c?'on':''}" onclick="invPickFam(${i})"${editor?` ondragover="invDragOver(event)" ondragenter="this.classList.add('drop')" ondragleave="this.classList.remove('drop')" ondrop="this.classList.remove('drop');invDropOnFam(event,${i})"`:''}>
        <span class="inv-dot" style="background:${famColor(c)}"></span><span class="inv-fam-lbl">${esc(c)}</span><span class="inv-fam-c">${scoped.filter(p=>(p.category||'')===c).length}</span>${editor?`<span class="inv-fam-acts"><button class="inv-fam-act" title="Renombrar familia" onclick="event.stopPropagation();famEditModal(${i})">${svgIcon('edit','icon icon-sm')}</button><button class="inv-fam-act" title="Eliminar familia" onclick="event.stopPropagation();deleteFamily(${i})">${svgIcon('trash','icon icon-sm')}</button></span>`:''}</div>`).join('')}
      <div class="inv-fam-row ${invCat==='__sin__'?'on':''}" onclick="invCat='__sin__';invSearch='';render()"${editor?` ondragover="invDragOver(event)" ondragenter="this.classList.add('drop')" ondragleave="this.classList.remove('drop')" ondrop="this.classList.remove('drop');invDropOnFam(event,'__sin__')"`:''}>
        <span class="inv-dot" style="background:var(--border)"></span><span class="inv-fam-lbl">Sin familia</span><span class="inv-fam-c">${sinFam}</span></div>
    </div>
    ${editor?`<div class="inv-side-foot">
      <input class="input" id="newFamSide" placeholder="Nueva familia" onkeydown="if(event.key==='Enter')addFamilyInline()">
      <button class="iconbtn-sq" title="Agregar familia" onclick="addFamilyInline()">${svgIcon('plus','icon icon-sm')}</button>
    </div>`:''}</aside>`;

  // =================== CENTRO: TARJETAS ===================
  const title = searching?'Resultados':(invCat==='todas'?'Todos los productos':(invCat==='__sin__'?'Sin familia':invCat));
  const editMode = editor && mode==='edit';
  const showNew = editMode && !searching && !invSelMode;
  const grid = list.length||editor ? `<div class="inv-grid">
      ${showNew ? `<button class="inv-tile inv-tile-new" onclick="invNewInline()"><span class="inv-tile-plus">${svgIcon('plus','icon')}</span><span>Nuevo</span></button>`:''}
      ${list.map(invTile).join('')}
    </div>` : emptyState('📦','Sin productos', searching?'No hay productos que coincidan con la búsqueda.':(editor?'Agregá productos para llevar el control de la bodega.':'Todavía no hay productos.'),'','');

  const bodegaDD=`<div class="dd" id="ddBodega">
    <button type="button" class="dd-btn" onclick="ddToggle(event,'ddBodega')">${svgIcon('box','icon icon-sm')}<span>${esc(invBodega==='todas'?'Todas las bodegas':(invBodega==='sin'?'Sin bodega':bodegaName(invBodega)))}</span>${svgIcon('chevron','icon icon-sm dd-chev')}</button>
    <div class="dd-menu">
      <button class="dd-opt ${invBodega==='todas'?'on':''}" onclick="setBodegaFilter('todas')">${svgIcon('box','icon icon-sm')} Todas las bodegas <span class="dd-c">${scoped.length}</span></button>
      ${bods.map(b=>`<button class="dd-opt ${invBodega===b.id?'on':''}" onclick="setBodegaFilter('${b.id}')"><span class="inv-dot" style="background:var(--accent)"></span> ${esc(b.name)} <span class="dd-c">${scoped.filter(p=>(p.bodega||'')===b.id).length}</span></button>`).join('')}
      <button class="dd-opt ${invBodega==='sin'?'on':''}" onclick="setBodegaFilter('sin')"><span class="inv-dot" style="background:var(--border)"></span> Sin bodega <span class="dd-c">${scoped.filter(p=>!p.bodega).length}</span></button>
    </div>
  </div>`;
  const main=`<section class="inv-main">
    <div class="inv-main-h">
      <div class="inv-main-title">${esc(title)} <span class="inv-main-n">${list.length}</span></div>
      ${editor?`<div class="seg inv-mode-seg">
        <button type="button" class="seg-b ${invMode==='edit'?'on':''}" onclick="invMode='edit';invSel=null;render()">${svgIcon('edit','icon icon-sm')} Editar</button>
        <button type="button" class="seg-b ${invMode==='count'?'on':''}" onclick="invMode='count';invSel=null;invSelMode=false;render()">${svgIcon('check','icon icon-sm')} Conteo</button>
      </div>`:`<span class="inv-mode-tag">${svgIcon('check','icon icon-sm')} Conteo diario</span>`}
      ${bodegaDD}
      <div class="inv-search-wrap ${invSearch?'has-val':''}">${svgIcon('search','icon icon-sm')}<input class="input" placeholder="Buscar producto…" value="${esc(invSearch)}" oninput="invSearch=this.value;clearTimeout(window._is);window._is=setTimeout(render,250)">${invSearch?`<button class="inv-search-x" title="Limpiar" onclick="invSearch='';render()">${svgIcon('x','icon icon-sm')}</button>`:''}</div>
    </div>
    <div class="inv-filters">
      <select class="chip chip-select" title="Ordenar productos" onchange="setInvSort(this.value)">
        ${Object.entries(INV_SORT_LABEL).map(([k,l])=>`<option value="${k}" ${invSort===k?'selected':''}>${l}</option>`).join('')}
      </select>
      <button class="chip ${invLowOnly?'on':''}" onclick="invLowOnly=!invLowOnly;render()">${svgIcon('info','icon icon-sm')} Bajo mínimo${low?' ('+low+')':''}</button>
      <button class="chip" onclick="inventoryReportModal()">${svgIcon('chart','icon icon-sm')} Reporte</button>
      <button class="chip" onclick="dailyCountsModal()">${svgIcon('check','icon icon-sm')} Conteos de hoy</button>
      <button class="chip" onclick="invMovesModal()">${svgIcon('list','icon icon-sm')} Movimientos</button>
      ${editMode?`<button class="chip ${invSelMode?'on':''}" onclick="invToggleSelMode()">${svgIcon('check','icon icon-sm')} Organizar</button>
        <button class="chip" onclick="bodegaManagerModal()">${svgIcon('box','icon icon-sm')} Bodegas</button>
        <button class="chip" onclick="invoicesModal()">${svgIcon('clipboard','icon icon-sm')} Facturas</button>
        <button class="chip accent" onclick="invoiceModal()">${svgIcon('truck','icon icon-sm')} Registrar factura</button>`:''}
    </div>
    <div class="inv-stats">
      <div class="inv-stat"><span class="inv-stat-n">${scoped.length}</span><span class="inv-stat-l">productos</span></div>
      <div class="inv-stat"><span class="inv-stat-n">${money(totVal)}</span><span class="inv-stat-l">valor en bodega</span></div>
      <button class="inv-stat ${low?'alert':''} ${invLowOnly?'on':''}" onclick="invLowOnly=!invLowOnly;render()" title="Ver solo los bajo mínimo"><span class="inv-stat-n">${low}</span><span class="inv-stat-l">bajo mínimo</span></button>
      <div class="inv-stat"><span class="inv-stat-n">${famList.length}</span><span class="inv-stat-l">familias</span></div>
    </div>
    ${editor&&invSelMode?`<div class="inv-bulk">
      <span class="inv-bulk-n">${invPicks.size} seleccionado(s)</span>
      <button class="chip" onclick="invPickAll()">Marcar todos (${list.length})</button>
      ${invPicks.size?`<button class="chip" onclick="invClearPicks()">Limpiar</button>`:''}
      <div style="flex:1"></div>
      <span class="inv-bulk-lbl">Mover a familia:</span>
      <select class="select" id="bulkFam" style="max-width:200px">
        ${famList.map(c=>`<option ${invCat===c?'selected':''}>${esc(c)}</option>`).join('')}
        <option value="__sin__">Sin familia</option>
      </select>
      <button class="btn btn-primary" onclick="movePicks()" ${invPicks.size?'':'disabled'}>${svgIcon('check','icon icon-sm')} Mover</button>
      <button class="btn btn-ghost" onclick="invToggleSelMode()">Salir</button>
    </div>`:''}
    <div class="inv-scroll">${grid}</div>
  </section>`;

  // =================== DERECHA: EDITOR o CONTEO ===================
  let panel='';
  if(sel && !invSelMode){
    if(sel==='__new__') panel = invPanel(null);
    else if(editMode) panel = invPanel(sel);
    else panel = invCountPanel(sel);
  }

  return `<div class="inv-shell ${panel?'has-panel':''}">${side}${main}${panel}</div>`;
}
function invTile(p){
  const lw=lowStock(p); const col=p.color||famColor(p.category);
  const picked=invPicks.has(p.id);
  const editAll=canInvEdit();
  const dragOn = editAll && invMode==='edit' && invSort==='manual' && !invSelMode && !invSearch;
  const click = invSelMode?`invTogglePick('${p.id}')`:`invSelect('${p.id}')`;
  const pct = p.minStock>0 ? Math.max(5,Math.min(100,Math.round((+p.stock||0)/(p.minStock*2)*100))) : 100;
  return `<button class="inv-tile ${lw?'low':''} ${invSel===p.id?'sel':''} ${p.img?'has-img':''} ${invSelMode?'selmode':''} ${picked?'picked':''} ${dragOn?'drag':''}" style="--fc:${col}" onclick="${click}"${dragOn?` draggable="true" ondragstart="invDragStart(event,'${p.id}')" ondragover="invDragOver(event)" ondrop="invDropOnTile(event,'${p.id}')" ondragend="invDragEnd(event)"`:''}>
    ${invSelMode?`<span class="inv-tile-check">${picked?svgIcon('check','icon icon-sm'):''}</span>`:''}
    <span class="inv-tile-top">${dragOn?`<span class="inv-tile-grip" title="Arrastrá para mover u ordenar">${svgIcon('list','icon icon-sm')}</span>`:svgIcon('edit','icon icon-sm inv-tile-eye')}${lw?`<span class="inv-tile-warn" title="Bajo el mínimo">${svgIcon('info','icon icon-sm')}</span>`:''}</span>
    ${p.img?`<span class="inv-tile-img">${mediaTag(p.img,'image','alt=""')}</span>`:''}
    <span class="inv-tile-name">${esc(p.name)}</span>
    <span class="inv-tile-qty ${lw?'low':''}">${p.stock}<i>${esc(p.unit)}</i></span>
    <span class="inv-tile-min">${p.minStock>0?`mín ${p.minStock}`:'&nbsp;'}${p.bodega?` · ${esc(bodegaName(p.bodega))}`:''}</span>
    ${p.minStock>0?`<span class="inv-tile-bar"><i class="${lw?'low':''}" style="width:${pct}%"></i></span>`:''}
  </button>`;
}
function invPanel(p){
  const isNew=!p;
  const editable=invAreasFor().filter(canInvEditArea);
  const defArea=(p&&p.area)||(editable.includes(invArea)?invArea:editable[0])||'cocina';
  const cats=catsForArea(defArea);
  const catList=(p&&p.category&&!cats.includes(p.category))?[p.category,...cats]:cats;
  const swatches=['',...FAM_COLORS.slice(0,7)];
  return `<aside class="inv-edit">
    <div class="inv-edit-h">
      <div><div class="inv-edit-kick">${isNew?'NUEVO PRODUCTO':'EDITAR PRODUCTO'}</div><div class="inv-edit-name">${isNew?'Producto nuevo':esc(p.name)}</div></div>
      <button class="modal-close" onclick="invClosePanel()">${svgIcon('x','icon')}</button>
    </div>
    <div class="inv-edit-body">
      ${!isNew?lowStockBanner(p):''}
      <div class="ip-sec">${svgIcon('box','icon icon-sm')} Información básica</div>
      <div class="field"><label>Nombre *</label><input class="input" id="ipName" value="${p?esc(p.name):''}" placeholder="Ej: Tomate" autocomplete="off"></div>
      <div class="field"><label>Descripción</label><textarea class="input" id="ipDesc" rows="2" placeholder="Breve nota visible al personal (opcional)">${p?esc(p.desc||''):''}</textarea></div>
      <div class="row2">
        <div class="field"><label>Categoría / Familia</label><select class="select" id="ipCat">${catList.map(c=>`<option ${p&&p.category===c?'selected':''}>${esc(c)}</option>`).join('')}</select></div>
        <div class="field"><label>Unidad de medida</label><select class="select" id="ipUnit">${INV_UNITS.map(u=>`<option ${p&&p.unit===u?'selected':''}>${u}</option>`).join('')}</select></div>
      </div>
      <div class="row2">
        ${editable.length>1?`<div class="field"><label>Lado (Cocina / Bar)</label><select class="select" id="ipArea" onchange="fillCatOptions()">${editable.map(a=>`<option value="${a}" ${a===defArea?'selected':''}>${INV_AREA_LABEL[a]}</option>`).join('')}</select></div>`:`<input type="hidden" id="ipArea" value="${defArea}">`}
        <div class="field"><label>Bodega (dónde se guarda)</label><select class="select" id="ipBodega"><option value="">Sin bodega</option>${bodegasFor().map(b=>`<option value="${b.id}" ${p&&p.bodega===b.id?'selected':''}>${esc(b.name)}</option>`).join('')}</select></div>
      </div>
      <div class="field"><label>Imagen del producto</label>
        <div class="ip-img-row">
          <div class="ip-img-prev" id="ipImgPrev">${p&&p.img?`${mediaTag(p.img,'image','alt=\"\"')}<button type="button" class="ip-img-x" onclick="ipClearImg()">${svgIcon('x','icon icon-sm')}</button>`:`<div class="ip-img-empty">${svgIcon('image','icon')}</div>`}</div>
          <label class="btn btn-ghost ip-img-up">${svgIcon('image','icon icon-sm')} Subir imagen<input type="file" accept="image/*" hidden onchange="ipPickImg(this)"></label>
        </div>
        <input type="hidden" id="ipImgId" value="${p?esc(p.img||''):''}">
      </div>
      <div class="ip-sec">${svgIcon('chart','icon icon-sm')} Existencias y medidas</div>
      <div class="row2">
        <div class="field"><label>Cantidad actual</label><input class="input" id="ipStock" type="number" step="any" min="0" value="${p?p.stock:0}" oninput="ipPreview()"></div>
        <div class="field"><label>Mínimo (alerta)</label><input class="input" id="ipMin" type="number" step="any" min="0" value="${p?p.minStock:0}" oninput="ipPreview()"></div>
      </div>
      <div class="row2">
        <div class="field"><label>Costo por unidad (₡)</label><input class="input" id="ipCost" type="number" step="any" min="0" value="${p?p.cost:0}" oninput="ipPreview()"></div>
        <div class="field"><label>Proveedor</label><input class="input" id="ipSup" value="${p?esc(p.supplier||''):''}" placeholder="Opcional" autocomplete="off"></div>
      </div>
      <div class="field"><label>Sucursal</label><select class="select" id="ipSuc">${p?sucOptionsSel(p.sucursalId):sucOptionsFor()}</select></div>
      <div class="ip-prev" id="ipPrev"></div>
      <div class="field"><label>Color de la tarjeta</label>
        <div class="inv-colors" id="ipColors">${swatches.map(c=>`<button type="button" class="inv-color ${((p&&p.color)||'')===c?'on':''} ${c?'':'none'}" data-c="${c}" style="${c?`background:${c}`:''}" onclick="invPickColor('${c}')"></button>`).join('')}</div>
        <input type="hidden" id="ipColor" value="${p?esc(p.color||''):''}">
      </div>
      ${!isNew?`<div class="ip-sec">${svgIcon('truck','icon icon-sm')} Movimientos rápidos</div>
      <div class="inv-edit-actions">
        <button class="ibtn ok" onclick="invMoveModal('${p.id}','entrada')">${svgIcon('up','icon icon-sm')}<span>Entrada</span></button>
        <button class="ibtn danger" onclick="invMoveModal('${p.id}','salida')">${svgIcon('down','icon icon-sm')}<span>Salida</span></button>
        <button class="ibtn sale" onclick="invMoveModal('${p.id}','venta')">${svgIcon('tag','icon icon-sm')}<span>Venta</span></button>
        <button class="ibtn move" onclick="invTrasladoModal('${p.id}')">${svgIcon('truck','icon icon-sm')}<span>Traslado</span></button>
      </div>`:''}
    </div>
    <div class="inv-edit-foot">
      ${!isNew?`<button class="iconbtn-sq danger" title="Eliminar producto" onclick="delProduct('${p.id}')">${svgIcon('trash','icon icon-sm')}</button>`:'<span></span>'}
      <div class="inv-edit-foot-r">
        <button class="btn btn-ghost" onclick="invClosePanel()">Cancelar</button>
        <button class="btn btn-primary" onclick="saveProductPanel('${p?p.id:''}')">${svgIcon('save','icon icon-sm')} Guardar</button>
      </div>
    </div>
  </aside>`;
}
function invSelect(id){ invSel=id; ipImgData=null; render(); }
function invClosePanel(){ invSel=null; ipImgData=null; render(); }
function invNewInline(){ invSel='__new__'; ipImgData=null; render(); }
/* Modo "Organizar": seleccionar varios productos y moverlos de familia de un golpe */
function invToggleSelMode(){ invSelMode=!invSelMode; invPicks.clear(); if(invSelMode) invSel=null; render(); }
function invTogglePick(id){ if(invPicks.has(id)) invPicks.delete(id); else invPicks.add(id); render(); }
function invClearPicks(){ invPicks.clear(); render(); }
function invPickAll(){ const ids=window._invList||[]; const allIn=ids.length&&ids.every(id=>invPicks.has(id)); if(allIn) invPicks.clear(); else ids.forEach(id=>invPicks.add(id)); render(); }
function movePicks(){
  if(!invPicks.size){ toast('No marcaste productos','err'); return; }
  const v=$('#bulkFam')?$('#bulkFam').value:''; const fam = v==='__sin__'?'':clip(v,40);
  let count=0;
  invPicks.forEach(id=>{ const p=DB.inventory.find(x=>x.id===id); if(!p) return; p.category=fam;
    if(fam){ const a=p.area||'cocina'; DB.invCats=DB.invCats||{}; if(!Array.isArray(DB.invCats[a])) DB.invCats[a]=(DEFAULT_CATS[a]?[...DEFAULT_CATS[a]]:[]); if(!DB.invCats[a].includes(fam)) DB.invCats[a].push(fam); }
    count++; });
  audit('inventario',`movió ${count} producto(s) a la familia "${fam||'Sin familia'}"`);
  invPicks.clear(); invSelMode=false; toast(`${count} producto(s) movidos a ${fam||'Sin familia'}`,'ok'); render();
}
function invPickFam(i){ invCat=window._invFams[i]; invSearch=''; render(); }
function invPickColor(c){ const h=$('#ipColor'); if(h) h.value=c; document.querySelectorAll('#ipColors .inv-color').forEach(b=>b.classList.toggle('on', (b.getAttribute('data-c')||'')===c)); }
async function ipPickImg(input){
  const f=input.files&&input.files[0]; if(!f) return;
  if(f.size>8*1024*1024){ toast('La imagen es muy grande (máx. 8 MB)','err'); return; }
  const arr=await readImages([f]); ipImgData=(arr&&arr[0])||null; if(!ipImgData) return;
  const pv=$('#ipImgPrev'); if(pv) pv.innerHTML=`<img src="${safeImg(ipImgData)}" alt=""><button type="button" class="ip-img-x" onclick="ipClearImg()">${svgIcon('x','icon icon-sm')}</button>`;
}
function ipClearImg(){ ipImgData=null; const idel=$('#ipImgId'); if(idel) idel.value=''; const pv=$('#ipImgPrev'); if(pv) pv.innerHTML=`<div class="ip-img-empty">${svgIcon('image','icon')}</div>`; }
/* Editar familias (categorías) de fácil acceso desde el menú izquierdo */
function famEditModal(i){
  const name=window._invFams[i]; if(name==null) return;
  const n=(DB.inventory||[]).filter(p=>(p.category||'')===name).length;
  openModal(`<div class="modal-head"><h3>${svgIcon('edit','icon')} Editar familia</h3><button class="modal-close" onclick="closeModal()">${svgIcon('x','icon')}</button></div>
    <div class="modal-body">
      <div class="field"><label>Nombre de la familia</label><input class="input" id="famNew" value="${esc(name)}" autocomplete="off" onkeydown="if(event.key==='Enter')saveFamilyName(${i})"></div>
      <div class="page-sub">Se renombra en los <b>${n}</b> producto(s) de esta familia.</div>
    </div>
    <div class="modal-foot"><button class="btn btn-ghost danger" onclick="deleteFamily(${i})">${svgIcon('trash','icon icon-sm')} Eliminar</button><div style="flex:1"></div><button class="btn btn-primary" onclick="saveFamilyName(${i})">${svgIcon('save','icon icon-sm')} Guardar</button></div>`);
}
function saveFamilyName(i){
  const oldName=window._invFams[i]; if(oldName==null) return;
  const nv=clip(($('#famNew')?$('#famNew').value:'').trim(),40);
  if(!nv){ toast('Escribí un nombre','err'); return; }
  if(nv===oldName){ closeModal(); return; }
  Object.keys(DB.invCats||{}).forEach(a=>{ const arr=DB.invCats[a]; if(Array.isArray(arr)){ const idx=arr.indexOf(oldName); if(idx>=0){ if(arr.includes(nv)) arr.splice(idx,1); else arr[idx]=nv; } } });
  (DB.inventory||[]).forEach(p=>{ if((p.category||'')===oldName) p.category=nv; });
  if(invCat===oldName) invCat=nv;
  audit('inventario',`renombró la familia "${oldName}" a "${nv}"`);
  closeModal(); toast('Familia actualizada','ok'); render();
}
async function deleteFamily(i){
  const name=window._invFams[i]; if(name==null) return;
  const n=(DB.inventory||[]).filter(p=>(p.category||'')===name).length;
  if(!await confirmDialog(`Se elimina la familia "${name}".${n?` Los ${n} producto(s) quedarán "Sin familia".`:''}`,{title:'¿Eliminar familia?',okText:'Sí, eliminar'})) return;
  Object.keys(DB.invCats||{}).forEach(a=>{ if(Array.isArray(DB.invCats[a])) DB.invCats[a]=DB.invCats[a].filter(c=>c!==name); });
  (DB.inventory||[]).forEach(p=>{ if((p.category||'')===name) p.category=''; });
  if(invCat===name) invCat='todas';
  audit('inventario',`eliminó la familia "${name}"`);
  closeModal(); toast('Familia eliminada','ok'); render();
}
function addFamilyInline(){
  const el=$('#newFamSide'); const v=el?el.value.trim():''; if(!v){ toast('Escribí un nombre','err'); return; }
  const area=(invArea!=='todas')?invArea:(invAreasFor().filter(canInvEditArea)[0]||'cocina');
  DB.invCats=DB.invCats||{}; if(!Array.isArray(DB.invCats[area])) DB.invCats[area]=(DEFAULT_CATS[area]?[...DEFAULT_CATS[area]]:[]);
  if(DB.invCats[area].some(c=>c.toLowerCase()===v.toLowerCase())){ toast('Esa familia ya existe','err'); return; }
  DB.invCats[area].push(clip(v,40)); invCat=v; audit('inventario',`agregó la familia "${v}"`); render();
}
async function delProduct(id){
  const p=DB.inventory.find(x=>x.id===id); if(!p) return;
  if(!await confirmDialog(`Se elimina el producto "${p.name}" del inventario. No se puede deshacer.`,{title:'¿Eliminar producto?',okText:'Sí, eliminar'})) return;
  delEntity('inventory', id); if(invSel===id) invSel=null;
  audit('inventario',`eliminó el producto "${p.name}"`,p.sucursalId); toast('Producto eliminado','ok'); render();
}
async function saveProductPanel(id){
  const name=clip($('#ipName').value,80); if(!name){ toast('Ponele nombre','err'); return; }
  let img = $('#ipImgId')?$('#ipImgId').value:'';
  if(ipImgData){ try{ img=await putMedia(ipImgData); }catch(_){} }
  const data={name,area:($('#ipArea')?$('#ipArea').value:'cocina'),category:$('#ipCat').value,bodega:($('#ipBodega')?$('#ipBodega').value:''),
    unit:$('#ipUnit').value,desc:clip($('#ipDesc')?$('#ipDesc').value:'',300),color:($('#ipColor')?$('#ipColor').value:''),img:img||'',
    stock:numClamp($('#ipStock').value,0,1e7),minStock:numClamp($('#ipMin').value,0,1e7),
    cost:numClamp($('#ipCost').value,0,1e9),supplier:clip($('#ipSup').value,80),sucursalId:$('#ipSuc').value};
  if(id){ const p=DB.inventory.find(x=>x.id===id); Object.assign(p,data); audit('inventario',`editó el producto "${name}"`,p.sucursalId); }
  else { const nid=uid(); DB.inventory.push({id:nid,...data}); invSel=nid; audit('inventario',`agregó el producto "${name}"`,data.sucursalId); }
  ipImgData=null; toast('Producto guardado','ok'); render();
}
window.invSelect=invSelect; window.invClosePanel=invClosePanel; window.invNewInline=invNewInline; window.invPickFam=invPickFam;
window.invPickColor=invPickColor; window.addFamilyInline=addFamilyInline; window.delProduct=delProduct; window.saveProductPanel=saveProductPanel;
window.ipPickImg=ipPickImg; window.ipClearImg=ipClearImg; window.famEditModal=famEditModal; window.saveFamilyName=saveFamilyName; window.deleteFamily=deleteFamily;
window.invToggleSelMode=invToggleSelMode; window.invTogglePick=invTogglePick; window.invClearPicks=invClearPicks; window.invPickAll=invPickAll; window.movePicks=movePicks;
/* ---- Arrastrar producto: ordenar (soltar en otra tarjeta) o mover de familia (soltar en el menú) ---- */
function invDragStart(e,id){ invDragId=id; try{ e.dataTransfer.effectAllowed='move'; e.dataTransfer.setData('text/plain',id); }catch(_){} }
function invDragOver(e){ e.preventDefault(); try{ e.dataTransfer.dropEffect='move'; }catch(_){} }
function invDragEnd(){ invDragId=null; }
function invDropOnTile(e,targetId){ e.preventDefault(); const id=invDragId||(e.dataTransfer&&e.dataTransfer.getData('text/plain')); invDragId=null; if(!id||id===targetId) return;
  const arr=DB.inventory; const from=arr.findIndex(x=>x.id===id); if(from<0) return; const [m]=arr.splice(from,1);
  const ti=arr.findIndex(x=>x.id===targetId); arr.splice(ti<0?arr.length:ti,0,m); arr.forEach((p,i)=>p.ord=i);
  audit('inventario',`reordenó "${m.name}"`,m.sucursalId); render();
}
function invDropOnFam(e,i){ e.preventDefault(); const id=invDragId||(e.dataTransfer&&e.dataTransfer.getData('text/plain')); invDragId=null; if(!id) return;
  const fam = i==='__sin__' ? '' : (window._invFams[i]||''); const p=DB.inventory.find(x=>x.id===id); if(!p) return; if((p.category||'')===fam) return;
  p.category=fam; if(fam){ const a=p.area||'cocina'; DB.invCats=DB.invCats||{}; if(!Array.isArray(DB.invCats[a])) DB.invCats[a]=(DEFAULT_CATS[a]?[...DEFAULT_CATS[a]]:[]); if(!DB.invCats[a].includes(fam)) DB.invCats[a].push(fam); }
  audit('inventario',`movió "${p.name}" a ${fam||'Sin familia'}`,p.sucursalId); toast(`Movido a ${fam||'Sin familia'}`,'ok'); render();
}
window.invDragStart=invDragStart; window.invDragOver=invDragOver; window.invDragEnd=invDragEnd; window.invDropOnTile=invDropOnTile; window.invDropOnFam=invDropOnFam;
function lowStockBanner(p){
  if(!p||!lowStock(p)) return '';
  const sug=suggestReorder(p);
  return `<div class="inv-low-banner">${svgIcon('info','icon icon-sm')}<div class="ilb-tx"><b>Bajo el mínimo</b>${sug?` · sugerido pedir <b>${sug} ${esc(p.unit)}</b>`:''}</div><button class="btn btn-ghost" style="flex:0 0 auto;padding:6px 11px" onclick="pedirProducto('${p.id}',${sug||0})">${svgIcon('box','icon icon-sm')} Pedir</button></div>`;
}
/* ---- Conteo diario (colaboradores): entrada, salida y ajuste por conteo físico ---- */
function invCountPanel(p){
  const lw=lowStock(p); const canMore=canInvEditArea(p.area||'cocina');
  return `<aside class="inv-edit inv-count">
    <div class="inv-edit-h">
      <div><div class="inv-edit-kick">CONTEO DIARIO</div><div class="inv-edit-name">${esc(p.name)}</div></div>
      <button class="modal-close" onclick="invClosePanel()">${svgIcon('x','icon')}</button>
    </div>
    <div class="inv-edit-body">
      <div class="cnt-now ${lw?'low':''}">
        <div class="cnt-now-n">${p.stock}<span>${esc(p.unit)}</span></div>
        <div class="cnt-now-l">en sistema${lw?` · ¡bajo el mínimo (${p.minStock})!`:` · mínimo ${p.minStock}`}</div>
        <div class="cnt-now-tags">${esc(INV_AREA_LABEL[p.area||'cocina'])}${p.category?' · '+esc(p.category):''}${p.bodega?' · '+esc(bodegaName(p.bodega)):''}</div>
      </div>
      ${lowStockBanner(p)}
      <div class="ip-sec">${svgIcon('up','icon icon-sm')} Registrar movimiento</div>
      <div class="field"><label>Cantidad (${esc(p.unit)})</label><input class="input" id="cntQty" type="number" min="0" step="any" value="1"></div>
      <div class="cnt-btns">
        <button class="ibtn ok" onclick="countMove('${p.id}','entrada')">${svgIcon('up','icon icon-sm')}<span>Entrada (+)</span></button>
        <button class="ibtn danger" onclick="countMove('${p.id}','salida')">${svgIcon('down','icon icon-sm')}<span>Salida (−)</span></button>
      </div>
      <div class="ip-sec">${svgIcon('check','icon icon-sm')} Conteo físico</div>
      <div class="page-sub" style="margin:-4px 0 10px">Contá lo que hay realmente y poné el número. El sistema ajusta solo la diferencia.</div>
      <div class="field"><label>Cantidad contada (${esc(p.unit)})</label><input class="input" id="cntReal" type="number" min="0" step="any" placeholder="Ej: ${p.stock}"></div>
      <button class="btn btn-primary" style="width:100%" onclick="countSet('${p.id}')">${svgIcon('save','icon icon-sm')} Ajustar a esta cantidad</button>
      ${canMore?`<div class="ip-sec">${svgIcon('tag','icon icon-sm')} Más</div>
      <div class="cnt-btns"><button class="ibtn sale" onclick="invMoveModal('${p.id}','venta')">${svgIcon('tag','icon icon-sm')}<span>Venta</span></button><button class="ibtn move" onclick="invTrasladoModal('${p.id}')">${svgIcon('truck','icon icon-sm')}<span>Traslado</span></button></div>`:''}
    </div>
  </aside>`;
}
function doInvMove(pid,type,q,note,src){
  const p=DB.inventory.find(x=>x.id===pid); if(!p) return;
  p.stock = type==='entrada' ? +(p.stock+q).toFixed(2) : Math.max(0,+(p.stock-q).toFixed(2));
  DB.invMoves.unshift({id:uid(),productId:p.id,type,qty:q,byId:SES.userId,at:now(),note:note||'',refId:null,sucursalId:p.sucursalId,src:src||''});
  audit('inventario',`${type==='entrada'?'+':'-'}${q} ${p.unit} de "${p.name}"${note?' ('+note+')':''}`,p.sucursalId);
  if(type==='salida'&&lowStock(p)) notify(DB.users.filter(u=>u.role==='proveeduria'||u.role==='admin').map(u=>u.id), `Inventario bajo: ${p.name} (${p.stock} ${p.unit})`,'⚠️',{view:'inventario'});
  toast('Inventario actualizado','ok'); render();
}
function countMove(pid,type){ const q=+($('#cntQty')?$('#cntQty').value:0)||0; if(!(q>0)){ toast('Poné una cantidad','err'); return; } doInvMove(pid,type,q,'conteo diario','conteo'); }
function countSet(pid){ const p=DB.inventory.find(x=>x.id===pid); if(!p) return; const v=$('#cntReal')?$('#cntReal').value:''; const real=+v;
  if(v===''||isNaN(real)||real<0){ toast('Poné la cantidad contada','err'); return; }
  const diff=+(real-p.stock).toFixed(2); if(diff===0){ toast('El conteo coincide con el sistema ✓','ok'); return; }
  doInvMove(pid, diff>0?'entrada':'salida', Math.abs(diff), `ajuste por conteo (${p.stock}→${real})`, 'conteo');
}
window.invCountPanel=invCountPanel; window.countMove=countMove; window.countSet=countSet; window.doInvMove=doInvMove;
/* ---- Reporte general (tabla) + exportar CSV ---- */
function downloadText(filename, text, mime){
  try{ const blob=new Blob([text],{type:(mime||'text/plain')+';charset=utf-8'}); const url=URL.createObjectURL(blob);
    const a=document.createElement('a'); a.href=url; a.download=filename; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),1500);
  }catch(_){ toast('No se pudo descargar','err'); }
}
function csvCell(v){ const s=String(v==null?'':v); return /[",\n;]/.test(s) ? '"'+s.replace(/"/g,'""')+'"' : s; }
function inventoryReportRows(){ return invInScope().slice().sort((a,b)=> (a.category||'~').localeCompare(b.category||'~') || a.name.localeCompare(b.name)); }
function exportInventoryCSV(){
  const head=['Producto','Familia','Lado','Bodega','Cantidad','Unidad','Mínimo','Estado','Costo unit','Valor','Proveedor'];
  const lines=[head.map(csvCell).join(',')];
  inventoryReportRows().forEach(p=>lines.push([p.name,p.category||'',INV_AREA_LABEL[p.area||'cocina'],bodegaName(p.bodega),p.stock,p.unit,p.minStock,lowStock(p)?'BAJO':'OK',p.cost,+(p.stock*p.cost).toFixed(2),p.supplier||''].map(csvCell).join(',')));
  downloadText('inventario.csv', '﻿'+lines.join('\n'), 'text/csv');
  toast('Reporte CSV descargado','ok');
}
function inventoryReportModal(){
  const rows=inventoryReportRows();
  const totVal=rows.reduce((s,p)=>s+p.stock*p.cost,0); const lowN=rows.filter(lowStock).length;
  const body=rows.map(p=>{ const lw=lowStock(p); return `<tr class="${lw?'rep-low':''}">
    <td class="rep-name">${esc(p.name)}</td><td>${esc(p.category||'—')}</td><td>${esc(INV_AREA_LABEL[p.area||'cocina'])}</td><td>${esc(bodegaName(p.bodega))}</td>
    <td class="rep-num"><b>${p.stock}</b> ${esc(p.unit)}</td><td class="rep-num">${p.minStock}</td>
    <td>${lw?'<span class="pill atrasada">Bajo</span>':'<span class="pill hecha">OK</span>'}</td>
    <td class="rep-num">${money(p.cost)}</td><td class="rep-num">${money(p.stock*p.cost)}</td></tr>`; }).join('');
  openModal(`<div class="modal-head"><h3>${svgIcon('chart','icon')} Reporte de inventario</h3><button class="modal-close" onclick="closeModal()">${svgIcon('x','icon')}</button></div>
    <div class="modal-body">
      <div class="rep-kpis">
        <div class="rep-kpi"><div class="rep-kpi-n">${rows.length}</div><div class="rep-kpi-l">Productos</div></div>
        <div class="rep-kpi ${lowN?'alert':''}"><div class="rep-kpi-n">${lowN}</div><div class="rep-kpi-l">Bajo mínimo</div></div>
        <div class="rep-kpi"><div class="rep-kpi-n" style="font-size:18px">${money(totVal)}</div><div class="rep-kpi-l">Valor total</div></div>
      </div>
      <div class="rep-wrap">
        <table class="rep-table">
          <thead><tr><th>Producto</th><th>Familia</th><th>Lado</th><th>Bodega</th><th class="rep-num">Cantidad</th><th class="rep-num">Mín</th><th>Estado</th><th class="rep-num">Costo</th><th class="rep-num">Valor</th></tr></thead>
          <tbody>${body||'<tr><td colspan="9" style="text-align:center;padding:20px;color:var(--text-soft)">Sin productos</td></tr>'}</tbody>
        </table>
      </div>
    </div>
    <div class="modal-foot"><button class="btn btn-ghost" onclick="invMovesModal()">${svgIcon('list','icon icon-sm')} Ver movimientos</button><div style="flex:1"></div><button class="btn btn-primary" onclick="exportInventoryCSV()">${svgIcon('save','icon icon-sm')} Descargar CSV</button></div>`, true);
}
window.inventoryReportModal=inventoryReportModal; window.exportInventoryCSV=exportInventoryCSV;
function invMoveModal(pid,type){
  const p=DB.inventory.find(x=>x.id===pid); if(!p) return;
  const T=({entrada:{t:'Entrada de stock',v:'entró',b:'Sumar al stock',ic:'up',ph:'Ej: compra a proveedor'},
            salida:{t:'Salida de stock',v:'salió',b:'Restar del stock',ic:'down',ph:'Ej: merma / uso de cocina'},
            venta:{t:'Venta',v:'se vendió',b:'Restar (venta)',ic:'tag',ph:'Ej: venta del día'}})[type]||{t:'Movimiento',v:'cambió',b:'Aplicar',ic:'box',ph:''};
  openModal(`
    <div class="modal-head"><h3>${svgIcon(T.ic,'icon')} ${T.t}</h3><button class="modal-close" onclick="closeModal()">${svgIcon('x','icon')}</button></div>
    <div class="modal-body">
      <div class="card" style="margin:0 0 16px;display:flex;align-items:center;gap:14px;padding:14px">
        <div class="inv-stock-n">${p.stock}<span>${esc(p.unit)}</span></div>
        <div><div style="font-weight:700">${esc(p.name)}</div><div class="page-sub" style="margin:2px 0 0">${INV_AREA_LABEL[p.area||'cocina']}${p.bodega?' · '+esc(bodegaName(p.bodega)):''} · mínimo ${p.minStock} ${esc(p.unit)}</div></div>
      </div>
      <div class="field"><label>¿Cuánto ${T.v}? (${esc(p.unit)})</label><input class="input" id="imQty" type="number" min="0" step="any" value="1" oninput="imPreview('${pid}','${type}')"></div>
      <div class="sh-preview" id="imRes" style="margin-bottom:14px"></div>
      <div class="field"><label>Nota (opcional)</label><input class="input" id="imNote" placeholder="${T.ph}"></div>
    </div>
    <div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">Cancelar</button><button class="btn btn-primary" onclick="applyInvMove('${pid}','${type}')">${T.b}</button></div>`);
  imPreview(pid,type);
}
function imPreview(pid,type){
  const p=DB.inventory.find(x=>x.id===pid); if(!p) return;
  const q=+($('#imQty')?$('#imQty').value:0)||0;
  const res=type==='entrada'? p.stock+q : Math.max(0,p.stock-q);
  const low=res<=p.minStock; const el=$('#imRes');
  if(el) el.innerHTML=`<div style="font-size:13px;color:var(--text-soft)">Queda en <b style="font-size:16px;color:${low?'var(--danger)':'var(--success)'}">${+res.toFixed(2)} ${esc(p.unit)}</b>${low?' · quedaría bajo el mínimo':''}</div>`;
}
window.imPreview=imPreview;
function applyInvMove(pid,type){
  const p=DB.inventory.find(x=>x.id===pid); if(!p) return;
  const q=+$('#imQty').value; if(!(q>0)){ toast('Poné una cantidad válida','err'); return; }
  const note=$('#imNote').value.trim();
  p.stock = type==='entrada' ? +(p.stock+q).toFixed(2) : Math.max(0,+(p.stock-q).toFixed(2));
  DB.invMoves.unshift({id:uid(),productId:p.id,type,qty:q,byId:SES.userId,at:now(),note,refId:null,sucursalId:p.sucursalId});
  audit('inventario',`${type==='entrada'?'+':'-'}${q} ${p.unit} de "${p.name}"${type==='venta'?' (venta)':''}${note?' ('+note+')':''}`,p.sucursalId);
  if((type==='salida'||type==='venta')&&lowStock(p)) notify(DB.users.filter(u=>u.role==='proveeduria'||u.role==='admin').map(u=>u.id), `Inventario bajo: ${p.name} (${p.stock} ${p.unit})`,'⚠️',{view:'inventario'});
  closeModal(); toast(type==='venta'?'Venta registrada':'Inventario actualizado','ok'); render();
}
function invTrasladoModal(pid){
  const p=DB.inventory.find(x=>x.id===pid); if(!p) return;
  const bods=bodegasFor();
  if(!bods.length){ toast('Primero creá bodegas con el botón "Bodegas"','err'); return; }
  const dest=bods.filter(b=>b.id!==p.bodega);
  openModal(`<div class="modal-head"><h3>${svgIcon('truck','icon')} Trasladar de bodega</h3><button class="modal-close" onclick="closeModal()">${svgIcon('x','icon')}</button></div>
    <div class="modal-body">
      <div class="card" style="margin:0 0 16px;padding:14px"><div style="font-weight:700">${esc(p.name)}</div><div class="page-sub" style="margin:2px 0 0">Ahora en: <b>${esc(bodegaName(p.bodega))}</b> · ${p.stock} ${esc(p.unit)}</div></div>
      <div class="field"><label>Mover a la bodega</label><select class="select" id="trDest">${dest.length?dest.map(b=>`<option value="${b.id}">${esc(b.name)}</option>`).join(''):'<option value="">(no hay otra bodega)</option>'}</select></div>
      <div class="field"><label>Nota (opcional)</label><input class="input" id="trNote" placeholder="Ej: se pasó al congelador"></div>
    </div>
    <div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">Cancelar</button><button class="btn btn-primary" onclick="applyTraslado('${pid}')">Trasladar</button></div>`);
}
function applyTraslado(pid){
  const p=DB.inventory.find(x=>x.id===pid); if(!p) return;
  const dest=$('#trDest')?$('#trDest').value:''; if(!dest){ toast('Elegí una bodega de destino','err'); return; }
  const fromN=bodegaName(p.bodega), toN=bodegaName(dest), note=$('#trNote')?$('#trNote').value.trim():'';
  p.bodega=dest;
  DB.invMoves.unshift({id:uid(),productId:p.id,type:'traslado',qty:p.stock,byId:SES.userId,at:now(),note:(fromN+' → '+toN)+(note?' · '+note:''),refId:null,sucursalId:p.sucursalId});
  audit('inventario',`trasladó "${p.name}" de ${fromN} a ${toN}`,p.sucursalId);
  closeModal(); toast('Producto trasladado ✓','ok'); render();
}
window.invTrasladoModal=invTrasladoModal; window.applyTraslado=applyTraslado;
function invNewModal(){ openModal(invForm('Nuevo producto',null), true); }
function invEditModal(id){ openModal(invForm('Editar producto',DB.inventory.find(x=>x.id===id)), true); }
function invForm(title,p){
  const editable=invAreasFor().filter(canInvEditArea);
  const defArea=(p&&p.area)||(editable.includes(invArea)?invArea:editable[0])||'cocina';
  return `<div class="modal-head"><h3>${title}</h3><button class="modal-close" onclick="closeModal()">${svgIcon('x','icon')}</button></div>
  <div class="modal-body">
    <div class="ip-sec">${svgIcon('box','icon icon-sm')} Información</div>
    <div class="field"><label>Nombre del producto</label><input class="input" id="ipName" value="${p?esc(p.name):''}" placeholder="Ej: Tomate" autocomplete="off"></div>
    <div class="row2">
      <div class="field"><label>Lado (Cocina / Bar)</label><select class="select" id="ipArea" onchange="fillCatOptions()">${editable.map(a=>`<option value="${a}" ${a===defArea?'selected':''}>${INV_AREA_LABEL[a]}</option>`).join('')}</select></div>
      <div class="field"><label>Familia</label><select class="select" id="ipCat">${(()=>{const cats=catsForArea(defArea);const list=(p&&p.category&&!cats.includes(p.category))?[p.category,...cats]:cats;return list.map(c=>`<option ${p&&p.category===c?'selected':''}>${esc(c)}</option>`).join('');})()}</select></div>
    </div>
    <div class="field"><label>Bodega (dónde se guarda)</label><select class="select" id="ipBodega"><option value="">Sin bodega</option>${bodegasFor().map(b=>`<option value="${b.id}" ${p&&p.bodega===b.id?'selected':''}>${esc(b.name)}</option>`).join('')}</select></div>
    <div class="ip-sec">${svgIcon('chart','icon icon-sm')} Existencias</div>
    <div class="row3">
      <div class="field"><label>Unidad</label><select class="select" id="ipUnit">${INV_UNITS.map(u=>`<option ${p&&p.unit===u?'selected':''}>${u}</option>`).join('')}</select></div>
      <div class="field"><label>Cantidad actual</label><input class="input" id="ipStock" type="number" step="any" min="0" value="${p?p.stock:0}" oninput="ipPreview()"></div>
      <div class="field"><label>Mínimo (alerta)</label><input class="input" id="ipMin" type="number" step="any" min="0" value="${p?p.minStock:0}" oninput="ipPreview()"></div>
    </div>
    <div class="ip-sec">${svgIcon('truck','icon icon-sm')} Costo y proveedor</div>
    <div class="row2">
      <div class="field"><label>Costo por unidad (₡)</label><input class="input" id="ipCost" type="number" step="any" min="0" value="${p?p.cost:0}" oninput="ipPreview()"></div>
      <div class="field"><label>Proveedor</label><input class="input" id="ipSup" value="${p?esc(p.supplier||''):''}" placeholder="Opcional" autocomplete="off"></div>
    </div>
    <div class="ip-prev" id="ipPrev"></div>
    <div class="field"><label>Sucursal</label><select class="select" id="ipSuc">${sucOptionsFor()}</select></div>
  </div>
  <div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">Cancelar</button><button class="btn btn-primary" onclick="saveProduct('${p?p.id:''}')">${svgIcon('save','icon icon-sm')} Guardar producto</button></div>`;
}
function ipPreview(){
  const el=$('#ipPrev'); if(!el) return;
  const stock=+($('#ipStock')?$('#ipStock').value:0)||0, cost=+($('#ipCost')?$('#ipCost').value:0)||0, min=+($('#ipMin')?$('#ipMin').value:0)||0;
  const unit=$('#ipUnit')?$('#ipUnit').value:'';
  const low=stock<=min;
  el.innerHTML=`<div class="ip-prev-row"><span>Valor en bodega</span><b>${money(stock*cost)}</b></div>
    <div class="ip-prev-row"><span>Existencia</span><b>${+stock.toFixed(2)} ${esc(unit)}</b></div>
    <div class="ip-prev-row"><span>Estado</span><b style="color:${low?'var(--danger)':'var(--success)'}">${low?'Bajo el mínimo — reponer':'En buen nivel'}</b></div>`;
}
window.ipPreview=ipPreview;
function saveProduct(id){
  const name=clip($('#ipName').value,80); if(!name){ toast('Ponele nombre','err'); return; }
  const data={name,area:($('#ipArea')?$('#ipArea').value:'cocina'),category:$('#ipCat').value,bodega:($('#ipBodega')?$('#ipBodega').value:''),unit:$('#ipUnit').value,stock:numClamp($('#ipStock').value,0,1e7),
    minStock:numClamp($('#ipMin').value,0,1e7),cost:numClamp($('#ipCost').value,0,1e9),supplier:clip($('#ipSup').value,80),sucursalId:$('#ipSuc').value};
  if(id){ const p=DB.inventory.find(x=>x.id===id); Object.assign(p,data); audit('inventario',`editó el producto "${name}"`,p.sucursalId); }
  else { DB.inventory.push({id:uid(),...data}); audit('inventario',`agregó el producto "${name}"`,data.sucursalId); }
  closeModal(); toast('Producto guardado','ok'); render();
}
let mvRange='hoy', mvType='todos', mvPerson='todos';
function todayStart(){ const d=new Date(); d.setHours(0,0,0,0); return d.getTime(); }
function mvInRange(m){ const fromTs={hoy:todayStart(),'7d':todayStart()-6*864e5,'30d':todayStart()-29*864e5,todo:0}[mvRange]||0; return m.at>=fromTs && (mvPerson==='todos'||m.byId===mvPerson); }
function mvMatch(m){
  if(!mvInRange(m)) return false;
  if(mvType==='todos') return true;
  if(mvType==='conteo') return m.src==='conteo';
  return m.type===mvType;
}
function mvSetRange(r){ mvRange=r; invMovesModal(); }
function mvSetType(t){ mvType=t; invMovesModal(); }
function mvSetPerson(v){ mvPerson=v; invMovesModal(); }
function invMvType(m){ return {entrada:{l:'Entrada',c:'var(--success)',s:'+'},salida:{l:'Salida',c:'var(--danger)',s:'−'},venta:{l:'Venta',c:'#a855f7',s:'−'},traslado:{l:'Traslado',c:'var(--accent)',s:'⇄'}}[m.type]||{l:m.type,c:'var(--text-soft)',s:''}; }
function invMovesModal(){
  const inScopeMoves=DB.invMoves.filter(m=>inScope(m.sucursalId));
  const people=[...new Set(inScopeMoves.map(m=>m.byId))].map(id=>userById(id)).filter(Boolean).sort((a,b)=>a.name.localeCompare(b.name));
  if(mvPerson!=='todos' && !people.some(u=>u.id===mvPerson)) mvPerson='todos';
  const baseMoves=inScopeMoves.filter(mvInRange);                 // rango + persona (sin filtro de tipo) → para KPIs
  const cnt=t=> baseMoves.filter(m=> t==='conteo'?m.src==='conteo':m.type===t).length;
  const moves=baseMoves.filter(m=> mvType==='todos'?true:(mvType==='conteo'?m.src==='conteo':m.type===mvType)).slice(0,400);
  const rangeChip=(k,l)=>`<button class="chip sm ${mvRange===k?'on':''}" onclick="mvSetRange('${k}')">${l}</button>`;
  const typeChip=(k,l)=>`<button class="chip sm ${mvType===k?'on':''}" onclick="mvSetType('${k}')">${l}</button>`;
  const rows=moves.map(m=>{
    const p=DB.inventory.find(x=>x.id===m.productId); const u=userById(m.byId);
    const T=invMvType(m); const isTr=m.type==='traslado'; const isCount=m.src==='conteo';
    return `<div class="mv-item">
      <span class="mv-av" title="${u?esc(u.name):''}">${u?initials(u.name):'?'}</span>
      <div class="mv-main">
        <div class="mv-l1"><b class="mv-prod">${p?esc(p.name):'—'}</b> <span class="mv-pill" style="background:${T.c}1a;color:${T.c}">${T.l}${isCount?' · conteo':''}</span></div>
        <div class="mv-l2">${u?esc(u.name):'—'}${m.note?' · '+esc(m.note):''} · ${fmtDateTime(m.at)}</div>
      </div>
      <span class="mv-qty" style="color:${T.c}">${isTr?'⇄':(T.s+m.qty)}</span>
    </div>`;
  }).join('');
  openModal(`<div class="modal-head"><h3>${svgIcon('list','icon')} Movimientos${mvRange==='hoy'?' de hoy':''}</h3><button class="modal-close" onclick="closeModal()">${svgIcon('x','icon')}</button></div>
    <div class="modal-body">
      <div class="mv-filters">
        ${rangeChip('hoy','Hoy')}${rangeChip('7d','7 días')}${rangeChip('30d','30 días')}${rangeChip('todo','Todo')}
        <span class="mv-sep"></span>
        ${typeChip('todos','Todos')}${typeChip('conteo','Conteos')}${typeChip('entrada','Entradas')}${typeChip('salida','Salidas')}${typeChip('venta','Ventas')}${typeChip('traslado','Traslados')}
      </div>
      <div class="mv-person">
        <span class="mv-person-l">${svgIcon('user','icon icon-sm')} Persona:</span>
        <select class="select" onchange="mvSetPerson(this.value)">
          <option value="todos" ${mvPerson==='todos'?'selected':''}>Todo el restaurante</option>
          ${people.map(u=>`<option value="${u.id}" ${mvPerson===u.id?'selected':''}>${esc(u.name)}</option>`).join('')}
        </select>
      </div>
      <div class="mv-kpis">
        <div class="mv-kpi"><b>${cnt('entrada')}</b><span>Entradas</span></div>
        <div class="mv-kpi"><b>${cnt('salida')}</b><span>Salidas</span></div>
        <div class="mv-kpi"><b>${cnt('venta')}</b><span>Ventas</span></div>
        <div class="mv-kpi"><b>${cnt('conteo')}</b><span>Conteos</span></div>
      </div>
      ${moves.length?`<div class="mv-list">${rows}</div>`:'<div class="empty"><div class="em-ico">📜</div><div class="em-d">Sin movimientos en este período.</div></div>'}
    </div>
    <div class="modal-foot"><div style="flex:1;font-size:12px;color:var(--text-soft)">${moves.length} movimiento(s)</div><button class="btn btn-primary" onclick="exportMovesCSV()">${svgIcon('save','icon icon-sm')} Descargar CSV</button></div>`,true);
}
function exportMovesCSV(){
  const moves=DB.invMoves.filter(m=>inScope(m.sucursalId) && mvMatch(m));
  const head=['Fecha','Producto','Tipo','Origen','Cantidad','Unidad','Quién','Nota','Sucursal'];
  const lines=[head.map(csvCell).join(',')];
  moves.forEach(m=>{ const p=DB.inventory.find(x=>x.id===m.productId); const u=userById(m.byId);
    lines.push([fmtDateTime(m.at),p?p.name:'',invMvType(m).l,m.src==='conteo'?'conteo':'manual',m.qty,p?p.unit:'',u?u.name:'',m.note||'',sucName(m.sucursalId)].map(csvCell).join(',')); });
  downloadText('movimientos.csv','﻿'+lines.join('\n'),'text/csv'); toast('CSV descargado','ok');
}
function dailyCountsModal(){ mvRange='hoy'; mvType='conteo'; invMovesModal(); }
window.mvSetRange=mvSetRange; window.mvSetType=mvSetType; window.mvSetPerson=mvSetPerson; window.exportMovesCSV=exportMovesCSV; window.dailyCountsModal=dailyCountsModal;
// Cuánto conviene pedir para llevar el stock a ~2× el mínimo
function suggestReorder(p){ if(!p || !(+p.minStock>0)) return 0; const s=Math.ceil((+p.minStock*2)-(+p.stock||0)); return s>0?s:0; }
function pedirProducto(pid, qty){
  newPedidoModal();
  try{ if(typeof setNpArea==='function') setNpArea('proveeduria'); else if($('#npArea')) $('#npArea').value='proveeduria'; }catch(_){}
  const pr=DB.inventory.find(x=>x.id===pid); if(!pr) return;
  if($('#npProd')) $('#npProd').value=pid;
  if($('#npItem')) $('#npItem').value=pr.name;
  if(qty && +qty>0 && $('#npQty')) $('#npQty').value=+qty;
}
window.invMoveModal=invMoveModal; window.applyInvMove=applyInvMove; window.invNewModal=invNewModal;
window.invEditModal=invEditModal; window.saveProduct=saveProduct; window.invMovesModal=invMovesModal; window.pedirProducto=pedirProducto;
function fillCatOptions(){ const a=$('#ipArea')?$('#ipArea').value:'cocina'; const sel=$('#ipCat'); if(sel) sel.innerHTML=catsForArea(a).map(c=>`<option>${esc(c)}</option>`).join(''); }
function catManagerModal(){
  const editable=invAreasFor().filter(canInvEditArea);
  openModal(`<div class="modal-head"><h3>Categorías del inventario</h3><button class="modal-close" onclick="closeModal()">${svgIcon('x','icon')}</button></div>
    <div class="modal-body">
      <div class="page-sub" style="margin-bottom:14px">Personalizá las categorías de cada bodega. Se usan al crear productos y como filtros.</div>
      ${editable.map(a=>`<div class="field"><label>${INV_AREA_LABEL[a]}</label>
        <div class="assignee-pick" style="margin-bottom:8px">${catsForArea(a).map((c,i)=>`<span class="ap">${esc(c)}<button class="icon-btn" style="width:22px;height:22px;border:none;background:none;margin-left:2px" title="Quitar" onclick="delCat('${a}',${i})">${svgIcon('x','icon icon-sm')}</button></span>`).join('')||'<span style="color:var(--text-soft);font-size:12.5px">Sin categorías todavía.</span>'}</div>
        <div style="display:flex;gap:8px"><input class="input" id="newcat_${a}" placeholder="Nueva categoría de ${INV_AREA_LABEL[a]}" onkeydown="if(event.key==='Enter')addCat('${a}')"><button class="btn btn-ghost" style="flex:0 0 auto" onclick="addCat('${a}')">Agregar</button></div>
      </div>`).join('')}
    </div>
    <div class="modal-foot"><button class="btn btn-primary" onclick="closeModal()">Listo</button></div>`);
}
function addCat(a){ const el=$('#newcat_'+a); const v=el?el.value.trim():''; if(!v){ toast('Escribí un nombre','err'); return; } DB.invCats[a]=DB.invCats[a]||[]; if(DB.invCats[a].includes(v)){ toast('Esa categoría ya existe','err'); return; } DB.invCats[a].push(v); audit('inventario',`agregó categoría "${v}" a ${INV_AREA_LABEL[a]}`); save(); catManagerModal(); }
function delCat(a,i){ const c=(DB.invCats[a]||[])[i]; if(c===undefined) return; if(DB.inventory.some(p=>(p.area||'cocina')===a && p.category===c)){ toast('No se puede borrar: hay productos en esa categoría','err'); return; } DB.invCats[a].splice(i,1); audit('inventario',`quitó categoría "${c}" de ${INV_AREA_LABEL[a]}`); save(); catManagerModal(); }
window.fillCatOptions=fillCatOptions; window.catManagerModal=catManagerModal; window.addCat=addCat; window.delCat=delCat;
function bodegaManagerModal(){
  const bods=bodegasFor();
  const cnt=id=>(DB.inventory||[]).filter(p=>inScope(p.sucursalId)&&p.bodega===id).length;
  openModal(`<div class="modal-head"><h3>${svgIcon('box','icon')} Bodegas</h3><button class="modal-close" onclick="closeModal()">${svgIcon('x','icon')}</button></div>
    <div class="modal-body">
      <div class="page-sub" style="margin-bottom:14px">Lugares de almacenamiento (ej. <b>Congelador 1</b>, Refrigerador, Bodega seca). Cada producto se guarda en una bodega para saber qué hay en cada una.</div>
      <div class="bod-list">${bods.length?bods.map(b=>`<div class="bod-row">
        <span class="bod-name">${svgIcon('box','icon icon-sm')} ${esc(b.name)}</span>
        <span class="bod-c">${cnt(b.id)} producto(s)</span>
        <button class="inv-fam-act" title="Quitar" onclick="delBodega('${b.id}')">${svgIcon('trash','icon icon-sm')}</button>
      </div>`).join(''):'<div class="page-sub">Sin bodegas todavía.</div>'}</div>
      <div class="bod-add"><input class="input" id="newBodega" placeholder="Nueva bodega (ej. Congelador 1)" onkeydown="if(event.key==='Enter')addBodega()"><button class="btn btn-ghost" style="flex:0 0 auto" onclick="addBodega()">${svgIcon('plus','icon icon-sm')} Agregar</button></div>
      ${bods.length>=2?`<div class="ip-sec" style="margin-top:18px">${svgIcon('truck','icon icon-sm')} Pasar productos de una bodega a otra</div>
      <div class="bod-move">
        <select class="select" id="bodFrom">${bods.map(b=>`<option value="${b.id}">${esc(b.name)} (${cnt(b.id)})</option>`).join('')}</select>
        <span class="bod-arrow">${svgIcon('truck','icon icon-sm')}</span>
        <select class="select" id="bodTo"><option value="">Sin bodega</option>${bods.map(b=>`<option value="${b.id}">${esc(b.name)}</option>`).join('')}</select>
        <button class="btn btn-primary" style="flex:0 0 auto" onclick="transferBodega()">Pasar</button>
      </div>
      <div class="page-sub" style="margin-top:6px">Mueve <b>todos</b> los productos de la primera bodega a la segunda.</div>`:''}
    </div>
    <div class="modal-foot"><button class="btn btn-primary" onclick="closeModal()">Listo</button></div>`);
}
function transferBodega(){
  const from=$('#bodFrom')?$('#bodFrom').value:''; const to=$('#bodTo')?$('#bodTo').value:'';
  if(from===to){ toast('Elegí dos bodegas distintas','err'); return; }
  const prods=(DB.inventory||[]).filter(p=>inScope(p.sucursalId)&&p.bodega===from);
  if(!prods.length){ toast('Esa bodega no tiene productos','err'); return; }
  prods.forEach(p=>{ p.bodega=to; });
  audit('inventario',`pasó ${prods.length} producto(s) de "${bodegaName(from)}" a "${to?bodegaName(to):'Sin bodega'}"`);
  toast(`${prods.length} producto(s) movidos`,'ok'); bodegaManagerModal();
}
window.transferBodega=transferBodega;
/* Dropdown personalizado (filtro de bodegas) */
function ddToggle(e,id){ e.stopPropagation(); const el=document.getElementById(id); if(!el) return; const open=el.classList.contains('open'); document.querySelectorAll('.dd.open').forEach(d=>d.classList.remove('open')); if(!open) el.classList.add('open'); }
function setBodegaFilter(v){ invBodega=v; render(); }
document.addEventListener('click',()=>{ document.querySelectorAll('.dd.open').forEach(d=>d.classList.remove('open')); });
window.ddToggle=ddToggle; window.setBodegaFilter=setBodegaFilter;
function addBodega(){ const el=$('#newBodega'); const v=el?el.value.trim():''; if(!v){ toast('Escribí un nombre','err'); return; }
  const suc = (me()&&me().sucursalId!=='all') ? me().sucursalId : (visibleSuc()!=='all'?visibleSuc():((DB.sucursales[0]&&DB.sucursales[0].id)||'all'));
  DB.bodegas=DB.bodegas||[]; DB.bodegas.push({id:uid(),name:clip(v,40),sucursalId:suc,at:now(),updatedAt:now()});
  audit('inventario',`agregó la bodega "${v}"`,suc); save(); bodegaManagerModal();
}
function delBodega(id){ const b=(DB.bodegas||[]).find(x=>x&&x.id===id); if(!b) return;
  if((DB.inventory||[]).some(p=>p.bodega===id)){ toast('No se puede borrar: hay productos en esa bodega','err'); return; }
  delEntity('bodegas', id); audit('inventario',`quitó la bodega "${b.name}"`,b.sucursalId); save(); bodegaManagerModal();
}
window.bodegaManagerModal=bodegaManagerModal; window.addBodega=addBodega; window.delBodega=delBodega;

/* ---------------- Facturas (entrada de mercadería al inventario) ---------------- */
let facLines=[];
function invoiceModal(){
  const area=invAreasFor().filter(canInvEditArea);
  const defArea=area.includes(invArea)?invArea:area[0]||'cocina';
  facLines=[];
  openModal(invoiceForm(defArea), true);
}
function invoiceForm(defArea){
  const editable=invAreasFor().filter(canInvEditArea);
  const today=new Date(); today.setMinutes(today.getMinutes()-today.getTimezoneOffset());
  const date=today.toISOString().slice(0,10);
  const areaSel = editable.length>1
    ? `<div class="field"><label>Bodega</label><select class="select" id="facArea" onchange="renderFacLines()">${editable.map(a=>`<option value="${a}" ${a===defArea?'selected':''}>${INV_AREA_LABEL[a]}</option>`).join('')}</select></div>`
    : `<input type="hidden" id="facArea" value="${defArea}">`;
  return `<div class="modal-head"><h3>${svgIcon('truck','icon')} Registrar factura</h3><button class="modal-close" onclick="closeModal()">${svgIcon('x','icon')}</button></div>
  <div class="modal-body">
    <div class="fac-scan">
      <input type="file" id="facFile" accept="image/*,application/pdf" style="display:none" onchange="facPhotoChosen(this)">
      <button type="button" class="fac-scan-btn" onclick="facPickPhoto()">
        <span class="fac-scan-ico">${svgIcon('image','icon')}</span>
        <span class="fac-scan-t">Subir foto o PDF de la factura</span>
        <span class="fac-scan-s">La IA lee proveedor, productos y costos · vos revisás antes de guardar</span>
      </button>
      <div id="facScanStatus" class="fac-scan-status"></div>
    </div>
    <div class="ip-sec">${svgIcon('list','icon icon-sm')} Productos</div>
    <div id="facLines"></div>
    <div class="fac-total" id="facTotal"></div>
    <div class="ip-sec">${svgIcon('truck','icon icon-sm')} Datos de la factura</div>
    <div class="row2">
      <div class="field"><label>Proveedor</label><input class="input" id="facSup" placeholder="Lo llena la foto" autocomplete="off"></div>
      <div class="field"><label>N.º de factura</label><input class="input" id="facNum" placeholder="Opcional" autocomplete="off"></div>
    </div>
    <div class="row2">
      <div class="field"><label>Fecha</label>${dateField(date,'fac')}</div>
      <div class="field"><label>Sucursal</label><select class="select" id="facSuc">${sucOptionsFor()}</select></div>
    </div>
    ${areaSel}
    <div class="field"><label>Nota (opcional)</label><input class="input" id="facNote" placeholder="Ej: pago a 30 días" autocomplete="off"></div>
  </div>
  <div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">Cancelar</button><button class="btn btn-primary" onclick="saveInvoice()">${svgIcon('check','icon icon-sm')} Guardar y sumar al inventario</button></div>`;
}
function renderFacLines(){
  const c=$('#facLines'); if(!c) return;
  const area=$('#facArea')?$('#facArea').value:'cocina';
  const prods=invInScope().filter(p=>(p.area||'cocina')===area).sort((a,b)=>a.name.localeCompare(b.name));
  if(!facLines.length){
    c.innerHTML=`<div class="fac-empty">${svgIcon('image','icon')}
      <div class="fac-empty-t">Todavía no hay productos</div>
      <div class="fac-empty-s">Subí la foto de la factura y aparecen acá para revisar.</div>
      <button type="button" class="fac-manual" onclick="facAddLine()">${svgIcon('plus','icon icon-sm')} Agregar a mano</button></div>`;
    facUpdateTotal();
    return;
  }
  c.innerHTML=facLines.map((l,i)=>{
    const isNew=!l.productId;
    const opts=`<option value="">＋ Producto nuevo…</option>`+prods.map(p=>`<option value="${p.id}" ${l.productId===p.id?'selected':''}>${esc(p.name)} (${esc(p.unit)})</option>`).join('');
    const unit=isNew?l.unit:(DB.inventory.find(x=>x.id===l.productId)||{}).unit||l.unit;
    return `<div class="fac-line">
      <div class="fac-line-top">
        <select class="select fac-prod" onchange="facSetProduct(${i},this.value)">${opts}</select>
        <button class="icon-btn fac-del" title="Quitar" onclick="facDelLine(${i})">${svgIcon('trash','icon icon-sm')}</button>
      </div>
      ${isNew?`<div class="fac-new">
        <input class="input" placeholder="Nombre del producto" value="${esc(l.name)}" oninput="facLines[${i}].name=this.value" autocomplete="off">
        <select class="select" onchange="facLines[${i}].category=this.value">${catsForArea(area).map(c=>`<option ${l.category===c?'selected':''}>${esc(c)}</option>`).join('')}</select>
        <select class="select" onchange="facLines[${i}].unit=this.value">${INV_UNITS.map(u=>`<option ${l.unit===u?'selected':''}>${u}</option>`).join('')}</select>
      </div>`:''}
      <div class="fac-line-nums">
        <div class="fac-num"><label>Cantidad (${esc(unit)})</label><input class="input" type="number" min="0" step="any" value="${l.qty}" oninput="facLines[${i}].qty=+this.value||0;facUpdateTotal()"></div>
        <div class="fac-num"><label>Costo unitario (₡)</label><input class="input" type="number" min="0" step="any" value="${l.cost}" oninput="facLines[${i}].cost=+this.value||0;facUpdateTotal()"></div>
        <div class="fac-line-total" id="facLT${i}">${money(l.qty*l.cost)}</div>
      </div>
    </div>`;
  }).join('')+`<button type="button" class="add-break" onclick="facAddLine()">${svgIcon('plus','icon icon-sm')} Agregar otro producto</button>`;
  facUpdateTotal();
}
function facSetProduct(idx,pid){
  const l=facLines[idx]; if(!l) return; l.productId=pid;
  if(pid){ const p=DB.inventory.find(x=>x.id===pid); if(p){ l.name=p.name; l.category=p.category; l.unit=p.unit; if(!l.cost) l.cost=p.cost; } }
  renderFacLines();
}
function facAddLine(){ const area=$('#facArea')?$('#facArea').value:'cocina'; facLines.push({productId:'',name:'',category:catsForArea(area)[0]||'',unit:'unid',qty:1,cost:0}); renderFacLines(); }
function facDelLine(i){ facLines.splice(i,1); renderFacLines(); }
function facUpdateTotal(){
  let t=0; facLines.forEach((l,i)=>{ const lt=(+l.qty||0)*(+l.cost||0); t+=lt; const e=$('#facLT'+i); if(e) e.textContent=money(lt); });
  const el=$('#facTotal'); if(!el) return;
  el.innerHTML = facLines.length ? `<span>Total · ${facLines.length} ${facLines.length===1?'producto':'productos'}</span><b>${money(t)}</b>` : '';
}
function saveInvoice(){
  const supplier=clip($('#facSup').value,80);
  const number=clip($('#facNum').value,40);
  const date=$('#facDate')?$('#facDate').value:'';
  const sucursalId=$('#facSuc').value;
  const area=$('#facArea').value;
  const note=clip($('#facNote').value,500);
  const lines=facLines.filter(l=>(l.productId||(l.name||'').trim()) && (+l.qty>0));
  if(!lines.length){ toast('Agregá al menos un producto con cantidad','err'); return; }
  const invId=uid(); let total=0; const items=[];
  lines.forEach(l=>{
    const qty=numClamp(l.qty,0,1e7), cost=numClamp(l.cost,0,1e9), lt=qty*cost; total+=lt;
    let p=l.productId?DB.inventory.find(x=>x.id===l.productId):null, pid=l.productId;
    if(!p){
      p={id:uid(),name:clip(l.name||'Producto',80),area,category:l.category||catsForArea(area)[0]||'General',unit:l.unit||'unid',stock:0,minStock:0,cost,supplier,sucursalId};
      DB.inventory.push(p); pid=p.id;
    }
    p.stock=+(p.stock+qty).toFixed(2);
    if(cost>0) p.cost=cost;
    if(supplier && !p.supplier) p.supplier=supplier;
    DB.invMoves.unshift({id:uid(),productId:pid,type:'entrada',qty,byId:SES.userId,at:now(),note:'Factura'+(number?' #'+number:'')+(supplier?' · '+supplier:''),refId:invId,sucursalId:p.sucursalId});
    items.push({productId:pid,name:p.name,category:p.category,unit:p.unit,qty,cost,total:lt});
  });
  DB.invoices.unshift({id:invId,supplier,number,date,sucursalId,area,items,total,note,byId:SES.userId,at:now()});
  audit('inventario',`registró factura${number?' #'+number:''}${supplier?' de '+supplier:''} · ${items.length} productos · ${money(total)}`,sucursalId);
  closeModal(); toast(`Factura registrada · ${items.length} productos sumados`,'ok'); render();
}
function invoicesModal(){
  const list=(DB.invoices||[]).filter(f=>inScope(f.sucursalId)).slice(0,60);
  const rows=list.map(f=>{
    const d=f.date?new Date(f.date+'T00:00').toLocaleDateString('es-CR',{day:'2-digit',month:'short',year:'numeric'}):fmtDateTime(f.at);
    return `<div class="fac-card">
      <div class="fac-card-head">
        <div><div class="fac-card-sup">${f.supplier?esc(f.supplier):'Proveedor sin nombre'}${f.number?` <span class="inv-area">#${esc(f.number)}</span>`:''}</div>
        <div class="page-sub" style="margin:3px 0 0">${d} · ${f.items.length} ${f.items.length===1?'producto':'productos'} · ${esc(sucName(f.sucursalId))}</div></div>
        <div class="fac-card-total">${money(f.total)}</div>
      </div>
      <div class="fac-card-items">${f.items.map(it=>`<div><span>${esc(it.name)}</span><b>×${it.qty} ${esc(it.unit)}</b> · ${money(it.cost)}/u</div>`).join('')}</div>
      ${f.note?`<div class="page-sub" style="margin-top:8px">📝 ${esc(f.note)}</div>`:''}
    </div>`;
  }).join('');
  openModal(`<div class="modal-head"><h3>Facturas registradas</h3><button class="modal-close" onclick="closeModal()">${svgIcon('x','icon')}</button></div>
    <div class="modal-body">${list.length?rows:emptyState('🧾','Sin facturas','Registrá una factura para sumar productos al inventario de una sola vez.')}</div>`,true);
}
window.invoiceModal=invoiceModal; window.renderFacLines=renderFacLines; window.facSetProduct=facSetProduct;
window.facAddLine=facAddLine; window.facDelLine=facDelLine; window.facUpdateTotal=facUpdateTotal; window.saveInvoice=saveInvoice; window.invoicesModal=invoicesModal;
/* ---- Escaneo de factura con IA de visión (foto -> productos) ---- */
function facPickPhoto(){ const f=$('#facFile'); if(f) f.click(); }
function fileToScaledJpeg(file,maxDim){
  return new Promise((resolve,reject)=>{
    const img=new Image(); const url=URL.createObjectURL(file);
    img.onload=()=>{ URL.revokeObjectURL(url);
      let w=img.naturalWidth||img.width, h=img.naturalHeight||img.height;
      const scale=Math.min(1, maxDim/Math.max(w,h)); w=Math.round(w*scale); h=Math.round(h*scale);
      const c=document.createElement('canvas'); c.width=w; c.height=h;
      c.getContext('2d').drawImage(img,0,0,w,h);
      try{ resolve(c.toDataURL('image/jpeg',0.85).split(',')[1]); }catch(e){ reject(e); }
    };
    img.onerror=()=>{ URL.revokeObjectURL(url); reject(new Error('No se pudo abrir la imagen')); };
    img.src=url;
  });
}
function fileToBase64(file){
  return new Promise((resolve,reject)=>{
    const r=new FileReader();
    r.onload=()=>{ const s=String(r.result||''); resolve(s.includes(',')?s.split(',')[1]:s); };
    r.onerror=()=>reject(new Error('No se pudo leer el archivo'));
    r.readAsDataURL(file);
  });
}
async function facPhotoChosen(input){
  const file=input&&input.files&&input.files[0]; if(input) input.value='';
  if(!file) return;
  const st=$('#facScanStatus');
  const isPdf = file.type==='application/pdf' || /\.pdf$/i.test(file.name||'');
  if(isPdf && file.size>4.2*1024*1024){ if(st) st.innerHTML=`<span class="fac-err">El PDF es muy grande (máx ~4 MB). Probá con una foto o un PDF más liviano.</span>`; return; }
  if(st) st.innerHTML=`<span class="fac-spin"></span> Leyendo la factura… puede tardar unos segundos`;
  try{
    let payload;
    if(isPdf){ payload={ file:await fileToBase64(file), filename:file.name||'factura.pdf' }; }
    else { payload={ image:await fileToScaledJpeg(file,1600), media_type:'image/jpeg' }; }
    const r=await fetch('/api/leer-factura',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
    let out; const txt=await r.text();
    try{ out=JSON.parse(txt); }catch(_){ out=null; }
    if(!r.ok){ throw new Error((out&&out.error)|| (r.status===404?'La función aún no está publicada en Vercel':('Error '+r.status))); }
    applyFacturaAI(out);
    const n=(out&&out.items?out.items.length:0);
    if(st) st.innerHTML=`<span class="fac-ok">✓ Leí ${n} ${n===1?'producto':'productos'}. Revisalos abajo y corregí lo que haga falta antes de guardar.</span>`;
  }catch(e){
    if(st) st.innerHTML=`<span class="fac-err">No pude leer la factura: ${esc(String(e.message||e))}. Podés llenarla a mano.</span>`;
  }
}
function applyFacturaAI(out){
  if(!out) return;
  const area=$('#facArea')?$('#facArea').value:'cocina';
  if(out.proveedor && $('#facSup') && !$('#facSup').value) $('#facSup').value=out.proveedor;
  if(out.numero && $('#facNum') && !$('#facNum').value) $('#facNum').value=out.numero;
  if(out.fecha && /^\d{4}-\d{2}-\d{2}$/.test(out.fecha)) pickDate(out.fecha,'fac');
  const prods=invInScope().filter(p=>(p.area||'cocina')===area);
  const lines=(out.items||[]).filter(it=>it&&it.nombre).map(it=>{
    const name=String(it.nombre).trim();
    const lc=name.toLowerCase();
    const match=prods.find(p=>p.name.toLowerCase()===lc) || (name.length>3?prods.find(p=>p.name.toLowerCase().includes(lc)||lc.includes(p.name.toLowerCase())):null);
    let unit=String(it.unidad||'').toLowerCase().trim(); if(!INV_UNITS.includes(unit)) unit=match?match.unit:'unid';
    return {productId:match?match.id:'', name:match?match.name:name, category:match?match.category:guessFamily(name, catsForArea(area)), unit, qty:+it.cantidad||1, cost:Math.round(+it.costo_unitario||0)};
  });
  if(lines.length) facLines=lines;
  renderFacLines();
}
window.facPickPhoto=facPickPhoto; window.facPhotoChosen=facPhotoChosen;

/* =====================================================================
   VISTA: RECETAS / MENÚ  (Chef edita · Cocina consulta · descuenta inventario)
   ===================================================================== */
function makeable(r){
  if(!r.ingredients.length) return 0;
  return Math.floor(Math.min(...r.ingredients.map(i=>{const p=DB.inventory.find(x=>x.id===i.productId);return (p&&i.qty>0)?p.stock/i.qty:0;})));
}
function recipeCost(r){ return (r.ingredients||[]).reduce((s,i)=>{const p=DB.inventory.find(x=>x.id===i.productId);return s+(p?(+p.cost||0)*(+i.qty||0):0);},0); }
function recipeProfit(r){ return (+r.price||0)-recipeCost(r); }
function recipeMargin(r){ const p=+r.price||0; if(p<=0) return null; return Math.round(recipeProfit(r)/p*100); }
function recipeLowMargin(r){ const m=recipeMargin(r); return m!=null && m<20; }   // margen <20% o a pérdida
function rindeCls(n){ return n<=0?'rechazada':n<5?'atrasada':'hecha'; }
let recSearch='', recCat='todas';
function viewRecetas(){
  const all=DB.recipes.filter(r=>inScope(r.sucursalId));
  const editor=canRecipeEdit();
  let list=[...all];
  if(recCat!=='todas') list=list.filter(r=>(r.category||'General')===recCat);
  if(recSearch){ const q=recSearch.toLowerCase(); list=list.filter(r=>(r.name||'').toLowerCase().includes(q)||(r.category||'').toLowerCase().includes(q)); }
  list.sort((a,b)=>(a.category||'').localeCompare(b.category||'')||a.name.localeCompare(b.name));
  const cats=[...new Set(all.map(r=>r.category||'General'))].sort();
  const lowN=all.filter(r=>makeable(r)<5).length;
  const avgGan=all.length?Math.round(all.reduce((s,r)=>s+recipeProfit(r),0)/all.length):0;
  const guide=sectionGuide('recetas','¿Para qué sirven las Recetas?',`
    Son los <b>platos del menú</b> y los insumos que llevan. Conectan la cocina con el inventario.
    <ul style="margin:8px 0 0 18px">
      <li>El chef define el plato, su precio y sus ingredientes; el sistema calcula <b>costo y ganancia</b>.</li>
      <li>Al <b>registrar una preparación</b> se descuenta del inventario lo que se usó.</li>
      <li>El <b>"rinde"</b> muestra cuántas porciones alcanzan con el inventario actual.</li>
    </ul>`);
  let html=`<div class="page-head"><div><div class="page-title">Recetas / Menú</div><div class="page-sub">${all.length} platos${editor?'':' · solo lectura'}</div></div>
    <div class="ph-spacer"></div>${editor?`<button class="btn btn-primary" style="flex:0 0 auto" onclick="recipeNewModal()">${svgIcon('plus','icon icon-sm')} Nueva receta</button>`:''}</div>`;
  html+=guide;
  html+=`<div class="kpi-row">
    <div class="kpi"><div class="label">Platos</div><div class="value">${all.length}</div><div class="sub">en el menú</div></div>
    <div class="kpi"><div class="label">Categorías</div><div class="value">${cats.length}</div><div class="sub">tipos de plato</div></div>
    <div class="kpi ${lowN?'alert':''}"><div class="label">Bajo rinde</div><div class="value">${lowN}</div><div class="sub">revisar inventario</div></div>
    ${editor?`<div class="kpi ok"><div class="label">Ganancia prom.</div><div class="value" style="font-size:22px">${money(avgGan)}</div><div class="sub">por plato</div></div>`:`<div class="kpi"><div class="label">Precio prom.</div><div class="value" style="font-size:22px">${money(all.length?Math.round(all.reduce((s,r)=>s+(+r.price||0),0)/all.length):0)}</div><div class="sub">por plato</div></div>`}
  </div>`;
  html+=`<div class="toolbar"><input class="input search" placeholder="Buscar plato…" value="${esc(recSearch)}" oninput="recSearch=this.value;clearTimeout(window._rcs);window._rcs=setTimeout(render,250)"></div>
    <div class="chipscroll">${['todas',...cats].map(k=>`<button class="chip ${recCat===k?'on':''}" data-c="${esc(k)}" onclick="recCat=this.dataset.c;render()">${k==='todas'?'Todas':esc(k)}</button>`).join('')}</div>`;
  html+= list.length? `<div class="rec-grid">`+list.map(recipeCard).join('')+`</div>`
    : emptyState('🍳','Sin recetas', recSearch||recCat!=='todas'?'No hay platos que coincidan.':'Agregá los platos de tu menú y sus ingredientes.', editor?'+ Nueva receta':'', editor?'recipeNewModal()':'');
  return html;
}
function recipeCard(r){
  const editor=canRecipeEdit(); const n=makeable(r); const cook=hasRole('admin','chef','cocinero');
  const ings=r.ingredients.map(i=>{const p=DB.inventory.find(x=>x.id===i.productId);return p?esc(p.name):'';}).filter(Boolean).slice(0,4).join(' · ');
  return `<div class="rec-card" onclick="recetaDetail('${r.id}')">
    <div class="rec-head">
      <div class="rec-ic">${svgIcon('utensils','icon')}</div>
      <div class="rec-hmain"><div class="rec-name">${esc(r.name)}</div><div class="rec-cat">${esc(r.category||'General')}</div></div>
      <span class="pill ${rindeCls(n)}">Rinde ${n}</span>
    </div>
    <div class="rec-figs">
      <div class="rec-fig"><span class="rec-fig-l">Precio</span><span class="rec-fig-v">${money(r.price)}</span></div>
      ${editor?`<div class="rec-fig"><span class="rec-fig-l">Costo</span><span class="rec-fig-v">${money(recipeCost(r))}</span></div>
      <div class="rec-fig"><span class="rec-fig-l">Ganancia</span><span class="rec-fig-v" style="color:${recipeProfit(r)<=0?'var(--danger)':'var(--success)'}">${money(recipeProfit(r))}</span></div>`:''}
    </div>
    ${editor&&recipeLowMargin(r)?`<div class="rec-warn">${svgIcon('info','icon icon-sm')} Margen bajo (${recipeMargin(r)}%) — revisá precio o costo</div>`:''}
    <div class="rec-ings">${svgIcon('box','icon icon-sm')} ${ings||'Sin ingredientes'}${r.ingredients.length>4?' …':''}</div>
    ${cook?`<div class="rec-cardfoot" onclick="event.stopPropagation()"><button class="btn btn-primary" onclick="prepareModal('${r.id}')">${svgIcon('utensils','icon icon-sm')} Preparar</button></div>`:''}
  </div>`;
}
function recetaDetail(id){
  const r=DB.recipes.find(x=>x.id===id); if(!r) return;
  const editor=canRecipeEdit(); const cook=hasRole('admin','chef','cocinero'); const n=makeable(r);
  const cost=recipeCost(r), prof=recipeProfit(r);
  const ingRows=(r.ingredients||[]).map(i=>{const p=DB.inventory.find(x=>x.id===i.productId);
    if(!p) return `<div class="rec-ing"><div class="rec-ing-main"><div class="rec-ing-n">Producto eliminado</div></div></div>`;
    const ok=(+p.stock||0)>=(+i.qty||0);
    return `<div class="rec-ing"><div class="rec-ing-main"><div class="rec-ing-n">${esc(p.name)}</div><div class="rec-ing-s">${i.qty} ${esc(p.unit)} por porción${editor?` · ${money((+p.cost||0)*(+i.qty||0))}`:''}</div></div><span class="rec-ing-stock ${ok?'ok':'no'}">${+p.stock||0} ${esc(p.unit)}</span></div>`;
  }).join('') || '<div class="td-empty">Sin ingredientes cargados.</div>';
  openModal(`<div class="modal-head"><h3>${svgIcon('utensils','icon')} ${esc(r.name)}</h3><button class="modal-close" onclick="closeModal()">${svgIcon('x','icon')}</button></div>
    <div class="modal-body">
      <div class="td-top">
        <span class="pill ${rindeCls(n)}">Rinde ${n} porciones</span>
        <span class="td-badge">${esc(r.category||'General')}</span>
        <span class="td-badge">${money(r.price)}</span>
        ${editor?`<span class="td-badge" style="color:var(--success)">Ganancia ${money(prof)}</span>`:''}
      </div>
      ${r.desc?`<div class="td-desc">${esc(r.desc)}</div>`:''}
      <div class="ip-sec">${svgIcon('box','icon icon-sm')} Ingredientes por porción</div>
      <div class="rec-inglist">${ingRows}</div>
      ${editor?`<div class="rec-cost"><div class="rec-cost-row"><span>Costo por porción</span><b>${money(cost)}</b></div><div class="rec-cost-row"><span>Precio de venta</span><b>${money(r.price)}</b></div><div class="rec-cost-row"><span>Ganancia</span><b style="color:var(--success)">${money(prof)}</b></div></div>`:''}
      <div class="td-actions">
        ${cook?`<button class="btn btn-primary" onclick="prepareModal('${r.id}')">${svgIcon('utensils','icon icon-sm')} Preparar</button>`:''}
        ${editor?`<button class="btn btn-ghost" onclick="recipeEditModal('${r.id}')">${svgIcon('edit','icon icon-sm')} Editar</button>`:''}
        ${editor?`<button class="btn btn-danger" onclick="delRecipe('${r.id}')">${svgIcon('trash','icon icon-sm')} Eliminar</button>`:''}
      </div>
    </div>`,true);
}
window.recetaDetail=recetaDetail;
async function delRecipe(id){
  if(!canRecipeEdit()) return;
  const r=DB.recipes.find(x=>x.id===id); if(!r) return;
  if(!await confirmDialog(`Se elimina la receta "${r.name}" del menú. No se puede deshacer.`,{title:'¿Eliminar receta?',okText:'Sí, eliminar'})) return;
  tomb(id); DB.recipes=DB.recipes.filter(x=>x.id!==id);
  audit('inventario',`eliminó la receta "${r.name}"`,r.sucursalId);
  closeModal(); save(); render(); undoDelete('recipes', r, r.name);
}
window.delRecipe=delRecipe;
function prepStep(d){ const el=$('#prepQty'); if(!el)return; let v=(parseInt(el.value,10)||1)+d; v=Math.max(1,v); el.value=v; }
window.prepStep=prepStep;
function prepareModal(id){
  const r=DB.recipes.find(x=>x.id===id); if(!r) return;
  const n=makeable(r);
  openModal(`<div class="modal-head"><h3>${svgIcon('utensils','icon')} Preparar · ${esc(r.name)}</h3><button class="modal-close" onclick="closeModal()">${svgIcon('x','icon')}</button></div>
    <div class="modal-body">
      <div class="rec-prep-rinde">Con el inventario actual alcanzan <b>${n}</b> porciones.</div>
      <div class="field"><label>¿Cuántas porciones preparaste?</label>
        <div class="qty-step"><button type="button" onclick="prepStep(-1)">−</button><input id="prepQty" type="number" min="1" step="1" value="1"><button type="button" onclick="prepStep(1)">+</button></div>
      </div>
      <div class="ip-sec">${svgIcon('down','icon icon-sm')} Se descontará del inventario</div>
      <div class="rec-inglist">${r.ingredients.map(i=>{const p=DB.inventory.find(x=>x.id===i.productId);return p?`<div class="rec-ing"><div class="rec-ing-main"><div class="rec-ing-n">${esc(p.name)}</div><div class="rec-ing-s">${i.qty} ${esc(p.unit)} por porción</div></div><span class="rec-ing-stock ${(+p.stock||0)>=(+i.qty||0)?'ok':'no'}">${+p.stock||0} ${esc(p.unit)}</span></div>`:'';}).filter(Boolean).join('')||'<div class="td-empty">Sin ingredientes.</div>'}</div>
    </div>
    <div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">Cancelar</button><button class="btn btn-primary" onclick="prepareRecipe('${id}')">${svgIcon('check','icon icon-sm')} Registrar y descontar</button></div>`, true);
}
function prepareRecipe(id){
  const r=DB.recipes.find(x=>x.id===id); if(!r) return;
  const n=+$('#prepQty').value; if(!(n>0)){ toast('Cantidad inválida','err'); return; }
  for(const i of r.ingredients){ const p=DB.inventory.find(x=>x.id===i.productId); if(p && p.stock < i.qty*n){ toast(`No alcanza ${p.name} para ${n} porciones`,'err'); return; } }
  r.ingredients.forEach(i=>{
    const p=DB.inventory.find(x=>x.id===i.productId); if(!p) return;
    p.stock=Math.max(0,+(p.stock-i.qty*n).toFixed(2));
    DB.invMoves.unshift({id:uid(),productId:p.id,type:'salida',qty:+(i.qty*n).toFixed(2),byId:SES.userId,at:now(),note:`Preparación: ${r.name} ×${n}`,refId:r.id,sucursalId:p.sucursalId});
    if(lowStock(p)) notify(DB.users.filter(u=>u.role==='proveeduria'||u.role==='admin').map(u=>u.id), `Inventario bajo: ${p.name} (${p.stock} ${p.unit})`,'⚠️',{view:'inventario'});
  });
  audit('inventario',`preparó ${n}× "${r.name}" (descuento de insumos)`,r.sucursalId);
  closeModal(); toast(`Registrado: ${n}× ${r.name} ✅`,'ok'); save(); render();
}
let recIngs=[];
function recipeNewModal(){ recIngs=[]; openModal(recipeForm('Nueva receta',null), true); }
function recipeEditModal(id){ const r=DB.recipes.find(x=>x.id===id); recIngs=r?r.ingredients.map(i=>({...i})):[]; openModal(recipeForm('Editar receta',r), true); }
function recipeForm(title,r){
  const cats=[...new Set(DB.recipes.map(x=>x.category||'General'))].sort();
  return `<div class="modal-head"><h3>${svgIcon('utensils','icon')} ${title}</h3><button class="modal-close" onclick="closeModal()">${svgIcon('x','icon')}</button></div>
  <div class="modal-body">
    <div class="ip-sec">${svgIcon('utensils','icon icon-sm')} Plato</div>
    <div class="field"><label>Nombre del plato</label><input class="input" id="rcName" value="${r?esc(r.name):''}" placeholder="Ej: Casado con pollo" autocomplete="off"></div>
    <div class="row2">
      <div class="field"><label>Categoría</label><input class="input" id="rcCat" list="rcCatList" value="${r?esc(r.category||''):''}" placeholder="Ej: Platos fuertes" autocomplete="off"><datalist id="rcCatList">${cats.map(c=>`<option value="${esc(c)}"></option>`).join('')}</datalist></div>
      <div class="field"><label>Precio de venta (₡)</label><input class="input" id="rcPrice" type="number" step="any" min="0" value="${r?r.price:0}" oninput="recCostPrev()"></div>
    </div>
    <div class="ip-sec">${svgIcon('box','icon icon-sm')} Ingredientes (del inventario)</div>
    <div id="rcIngs"></div>
    <button class="add-break" onclick="addIngRow()">${svgIcon('plus','icon icon-sm')} Agregar ingrediente</button>
    <div class="rec-cost" id="rcCostPrev"></div>
    <div class="ip-sec">${svgIcon('clipboard','icon icon-sm')} Preparación (opcional)</div>
    <div class="field"><textarea class="textarea" id="rcDesc" placeholder="Pasos o notas de preparación…">${r?esc(r.desc||''):''}</textarea></div>
    <div class="field"><label>Sucursal</label><select class="select" id="rcSuc">${r?sucOptionsSel(r.sucursalId):sucOptionsFor()}</select></div>
  </div>
  <div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">Cancelar</button><button class="btn btn-primary" onclick="saveRecipe('${r?r.id:''}')">${svgIcon('check','icon icon-sm')} Guardar receta</button></div>`;
}
function ingOptions(sel){ return invInScope().map(p=>`<option value="${p.id}" ${sel===p.id?'selected':''}>${esc(p.name)} (${esc(p.unit)})</option>`).join(''); }
function renderIngRows(){
  const c=$('#rcIngs'); if(!c) return;
  c.innerHTML = recIngs.map((i,idx)=>{
    const p=DB.inventory.find(x=>x.id===i.productId);
    return `<div class="rec-ing-row">
      <select class="select rec-ing-prod" onchange="recIngs[${idx}].productId=this.value;renderIngRows()">${ingOptions(i.productId)}</select>
      <input class="input rec-ing-qty" type="number" step="any" min="0" value="${i.qty}" placeholder="cant." oninput="recIngs[${idx}].qty=+this.value||0;recCostPrev()">
      <span class="rec-ing-unit">${p?esc(p.unit):''}</span>
      <button class="icon-btn rec-ing-del" type="button" title="Quitar" onclick="recIngs.splice(${idx},1);renderIngRows()">${svgIcon('x','icon icon-sm')}</button>
    </div>`;
  }).join('') || '<div class="td-empty">Sin ingredientes. Agregá al menos uno.</div>';
  recCostPrev();
}
function recCostPrev(){
  const el=$('#rcCostPrev'); if(!el) return;
  const cost=recIngs.reduce((s,i)=>{const p=DB.inventory.find(x=>x.id===i.productId);return s+(p?(+p.cost||0)*(+i.qty||0):0);},0);
  const price=+($('#rcPrice')?$('#rcPrice').value:0)||0;
  el.innerHTML=`<div class="rec-cost-row"><span>Costo por porción</span><b>${money(cost)}</b></div><div class="rec-cost-row"><span>Precio</span><b>${money(price)}</b></div><div class="rec-cost-row"><span>Ganancia</span><b style="color:var(--success)">${money(price-cost)}</b></div>`;
}
window.recCostPrev=recCostPrev;
function addIngRow(){ const first=invInScope()[0]; recIngs.push({productId:first?first.id:'',qty:0.1}); renderIngRows(); }
function saveRecipe(id){
  const name=$('#rcName').value.trim(); if(!name){ toast('Ponele nombre al plato','err'); return; }
  const ings=recIngs.filter(i=>i.productId && i.qty>0);
  const data={name,category:$('#rcCat').value.trim()||'General',price:+$('#rcPrice').value||0,ingredients:ings,desc:($('#rcDesc')?$('#rcDesc').value.trim():''),sucursalId:$('#rcSuc').value};
  if(id){ const r=DB.recipes.find(x=>x.id===id); Object.assign(r,data); audit('inventario',`editó la receta "${name}"`,r.sucursalId); }
  else { DB.recipes.push({id:uid(),...data,byId:SES.userId,at:now()}); audit('inventario',`creó la receta "${name}"`,data.sucursalId); }
  closeModal(); toast('Receta guardada','ok'); save(); render();
}
window.prepareModal=prepareModal; window.prepareRecipe=prepareRecipe; window.recipeNewModal=recipeNewModal;
window.recipeEditModal=recipeEditModal; window.saveRecipe=saveRecipe; window.addIngRow=addIngRow; window.renderIngRows=renderIngRows;
// render ingredient rows after recipe modal opens
const _openModal=openModal;
openModal=function(html,wide){ _openModal(html,wide); if($('#rcIngs')) renderIngRows(); if($('#facLines')) renderFacLines(); if($('#ipPrev')) ipPreview(); if($('#svGanPrev')) souvGanPrev(); if($('#shBreaks')){ shPresetEdit=false; renderBreakRows(); if($('#shPresetArea')) renderPresetArea(); updateShiftPreview(); } };

/* =====================================================================
   VISTA: HORARIOS / TURNOS
   ===================================================================== */
const SHIFT_PRESETS=[
  {label:'Apertura',start:'06:00',end:'14:00',breaks:[]},
  {label:'Día',start:'08:00',end:'16:00',breaks:[{start:'12:00',end:'12:30'}]},
  {label:'Tarde',start:'14:00',end:'22:00',breaks:[]},
  {label:'Partido',start:'10:00',end:'22:00',breaks:[{start:'15:00',end:'18:00'}]},
];
let shBreaks=[];
function timeToMin(t){ if(!t) return 0; const[a,b]=t.split(':').map(Number); return a*60+(b||0); }
function fmtDur(min){ const h=Math.floor(min/60), m=min%60; return (h?h+' h':'')+(h&&m?' ':'')+(m?m+' min':(h?'':'0 min')); }
function shiftSummary(start,end,breaks){
  let s=timeToMin(start), e=timeToMin(end); if(e<s) e+=1440;
  const gross=e-s; let bmin=0;
  (breaks||[]).forEach(b=>{ if(b.start&&b.end){ let bs=timeToMin(b.start),be=timeToMin(b.end); if(be<bs)be+=1440; if(be>bs) bmin+=be-bs; } });
  return {gross,bmin,net:Math.max(0,gross-bmin),s};
}
function shiftPreviewHTML(start,end,breaks){
  const {gross,bmin,net,s}=shiftSummary(start,end,breaks);
  if(gross<=0) return `<div style="font-size:12.5px;color:var(--warn);padding:6px 0">Revisá las horas: la salida debe ser después de la entrada.</div>`;
  const segs=(breaks||[]).filter(b=>b.start&&b.end).map(b=>{
    let bs=timeToMin(b.start),be=timeToMin(b.end); if(be<bs)be+=1440;
    const left=Math.max(0,(bs-s)/gross*100), w=Math.min(100-left,(be-bs)/gross*100);
    return `<div style="position:absolute;top:0;bottom:0;left:${left}%;width:${w}%;background:var(--bg);opacity:.6;border-left:1px dashed #fff;border-right:1px dashed #fff"></div>`;
  }).join('');
  return `<div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text-soft);margin-bottom:5px"><span>${fmt12(start)}</span><span>${fmt12(end)}</span></div>
    <div style="position:relative;height:34px;border-radius:9px;background:var(--grad-accent);overflow:hidden">${segs}<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:12.5px;font-weight:700;color:#fff">${fmtDur(net)} efectivas</div></div>
    <div style="font-size:11.5px;color:var(--text-soft);margin-top:6px">${fmtDur(gross)} de turno${bmin?` · ${fmtDur(bmin)} en quiebres`:' · sin quiebres'}</div>`;
}
/* ---- Hora en formato AM/PM (selectores) ---- */
function to12(t){ let [H,M]=(t||'00:00').split(':'); H=+H; M=(M||'00'); const ap=H>=12?'PM':'AM'; let h=H%12; if(h===0)h=12; return {h,m:String(M).padStart(2,'0'),ap}; }
function from12(h,m,ap){ let H=(+h)%12; if(ap==='PM')H+=12; return String(H).padStart(2,'0')+':'+String(m).padStart(2,'0'); }
function fmt12(t){ const {h,m,ap}=to12(t); return `${h}:${m} ${ap}`; }
function timePicker(prefix,value,onchange){
  const {h,m,ap}=to12(value);
  return `<div class="tp">
    <input class="tp-num" id="${prefix}H" type="text" inputmode="numeric" maxlength="2" value="${h}" placeholder="07" autocomplete="off"
      oninput="tpClean(this);${onchange}" onfocus="this.select()" onblur="tpBlurH(this)">
    <span class="tp-colon">:</span>
    <input class="tp-num" id="${prefix}M" type="text" inputmode="numeric" maxlength="2" value="${m}" placeholder="00" autocomplete="off"
      oninput="tpClean(this);${onchange}" onfocus="this.select()" onblur="tpBlurM(this)">
    <input type="hidden" id="${prefix}AP" value="${ap}">
    <div class="tp-ampm" id="${prefix}AMPM"><button type="button" class="tp-ap ${ap==='AM'?'on':''}" onclick="setAP('${prefix}','AM');${onchange}">AM</button><button type="button" class="tp-ap ${ap==='PM'?'on':''}" onclick="setAP('${prefix}','PM');${onchange}">PM</button></div>
  </div>`;
}
function tpClean(el){ el.value=(el.value||'').replace(/[^0-9]/g,'').slice(0,2); }
function tpBlurH(el){ let h=parseInt(el.value,10); if(isNaN(h))h=12; if(h<1)h=12; if(h>12)h=12; el.value=String(h); }
function tpBlurM(el){ let m=parseInt(el.value,10); if(isNaN(m)||m<0)m=0; if(m>59)m=59; el.value=String(m).padStart(2,'0'); }
window.tpClean=tpClean; window.tpBlurH=tpBlurH; window.tpBlurM=tpBlurM;
function setAP(prefix,ap){ const inp=$('#'+prefix+'AP'); if(inp)inp.value=ap; const w=$('#'+prefix+'AMPM'); if(w)[...w.children].forEach(b=>b.classList.toggle('on',b.textContent.trim()===ap)); }
window.setAP=setAP;
function readTP(prefix){ const he=$('#'+prefix+'H'), me_=$('#'+prefix+'M'), ap=$('#'+prefix+'AP'); if(!he)return '00:00';
  let h=parseInt(he.value,10); if(isNaN(h)||h<1||h>12)h=12;
  let m=parseInt(me_.value,10); if(isNaN(m)||m<0)m=0; if(m>59)m=59;
  return from12(h,String(m).padStart(2,'0'),ap.value); }
function curTP(prefix,def){ return $('#'+prefix+'H')?readTP(prefix):def; }
function updateShiftPreview(){
  const el=$('#shPreview'); if(!el||!$('#shStartH')) return;
  const cs=curTP('shStart','10:00'), ce=curTP('shEnd','18:00');
  el.innerHTML=shiftPreviewHTML(cs,ce,shBreaks);
  document.querySelectorAll('.sh-preset').forEach(b=>b.classList.toggle('on', b.dataset.s===cs && b.dataset.e===ce));
}
window.updateShiftPreview=updateShiftPreview; window.readTP=readTP;

/* ---- Calendario personalizado ---- */
let shDate='', shCalMonth=null;
let _cal={}; // estado por instancia del calendario: prefix -> {month:Date}
function fmtDateLong(iso){ if(!iso) return '—'; const x=new Date(iso+'T00:00'); if(isNaN(x)) return '—'; return x.toLocaleDateString('es-CR',{weekday:'long',day:'2-digit',month:'long',year:'numeric'}); }
function dateField(value, prefix='sh'){
  value = value || new Date().toISOString().slice(0,10);
  if(prefix==='sh'){ shDate=value; } // compatibilidad
  const m=new Date(value+'T00:00'); m.setDate(1); _cal[prefix]={month:m};
  return `<div class="datepick" id="${prefix}DateBox">
    <input type="hidden" id="${prefix}Date" value="${value}">
    <button type="button" class="input datepick-btn" onclick="toggleCal(event,'${prefix}')">${svgIcon('calendar','icon icon-sm')}<span id="${prefix}DateLabel" style="flex:1">${fmtDateLong(value)}</span>${svgIcon('chevron','icon icon-sm')}</button>
    <div class="cal" id="${prefix}Cal" style="display:none"></div>
  </div>`;
}
function renderCal(prefix){
  prefix=prefix||'sh';
  const c=$('#'+prefix+'Cal'); if(!c) return;
  const st=_cal[prefix]; if(!st) return; const m=st.month;
  const cur = $('#'+prefix+'Date') ? $('#'+prefix+'Date').value : '';
  const y=m.getFullYear(), mo=m.getMonth();
  const startDow=(new Date(y,mo,1).getDay()+6)%7;
  const days=new Date(y,mo+1,0).getDate();
  const today=new Date().toISOString().slice(0,10);
  let cells=''; for(let i=0;i<startDow;i++) cells+='<div></div>';
  for(let d=1;d<=days;d++){ const iso=`${y}-${String(mo+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    cells+=`<button type="button" class="cal-day ${iso===cur?'sel':''} ${iso===today?'today':''}" onclick="pickDate('${iso}','${prefix}')">${d}</button>`; }
  c.innerHTML=`<div class="cal-head"><button type="button" class="icon-btn" style="width:30px;height:30px" onclick="calMove(-1,'${prefix}')">${svgIcon('back','icon icon-sm')}</button>
    <span>${m.toLocaleDateString('es-CR',{month:'long',year:'numeric'})}</span>
    <button type="button" class="icon-btn" style="width:30px;height:30px" onclick="calMove(1,'${prefix}')"><svg class="icon icon-sm" viewBox="0 0 24 24" style="transform:scaleX(-1)"><use href="#i-back"/></svg></button></div>
    <div class="cal-grid cal-dow"><div>L</div><div>M</div><div>M</div><div>J</div><div>V</div><div>S</div><div>D</div></div>
    <div class="cal-grid" style="margin-top:3px">${cells}</div>`;
}
function toggleCal(e,prefix){ if(e)e.stopPropagation(); prefix=prefix||'sh'; const c=$('#'+prefix+'Cal'); if(!c)return; const show=c.style.display==='none'; c.style.display=show?'block':'none'; if(show) renderCal(prefix); }
function calMove(d,prefix){ prefix=prefix||'sh'; if(!_cal[prefix])return; _cal[prefix].month.setMonth(_cal[prefix].month.getMonth()+d); renderCal(prefix); }
function pickDate(iso,prefix){ prefix=prefix||'sh'; const h=$('#'+prefix+'Date'); if(h)h.value=iso; if(prefix==='sh')shDate=iso; const l=$('#'+prefix+'DateLabel'); if(l)l.textContent=fmtDateLong(iso); const c=$('#'+prefix+'Cal'); if(c)c.style.display='none'; }
window.toggleCal=toggleCal; window.calMove=calMove; window.pickDate=pickDate;
const HOR_DEPTS=[
  {label:'Salón',roles:['jefe_salon','salonero','bartender']},
  {label:'Cocina',roles:['chef','cocinero']},
  {label:'Gerencia',roles:['admin','gerencia_exp','gerencia_data']},
  {label:'Administración',roles:['proveeduria','contarh']},
];
let horMode='', horDay='', attDay='', horWeekStart='', horArea='todas';
function horMondayOf(d){ const x=new Date(d); x.setHours(0,0,0,0); const dow=(x.getDay()+6)%7; x.setDate(x.getDate()-dow); return x; }
function horWeekDays(){ if(!horWeekStart) horWeekStart=isoLocal(horMondayOf(new Date())); const m=new Date(horWeekStart+'T00:00:00'); return [...Array(7)].map((_,i)=>{ const x=new Date(m); x.setDate(m.getDate()+i); return x; }); }
function horWeekNav(d){ if(!horWeekStart) horWeekStart=isoLocal(horMondayOf(new Date())); const m=new Date(horWeekStart+'T00:00:00'); m.setDate(m.getDate()+d*7); horWeekStart=isoLocal(m); render(); }
function horWeekThis(){ horWeekStart=isoLocal(horMondayOf(new Date())); render(); }
function horSetArea(a){ horArea=a; render(); }
function fmtCompact(t){ if(!t) return ''; const p=String(t).split(':'); const H=+p[0], M=+p[1]||0; const ap=H>=12?'p':'a'; let h=H%12; if(h===0)h=12; return M? h+':'+String(M).padStart(2,'0')+ap : h+ap; }
window.horWeekNav=horWeekNav; window.horWeekThis=horWeekThis; window.horSetArea=horSetArea;
function viewHorarios(){
  const manage=canShiftManage();
  const todayISO=new Date().toISOString().slice(0,10);
  if(!horDay) horDay=todayISO;
  if(!horMode) horMode = manage?'semana':'mia';
  if(!manage && !['mia','general'].includes(horMode)) horMode='mia';
  const today=new Date(); today.setHours(0,0,0,0);
  const days=[...Array(7)].map((_,d)=>{const x=new Date(today);x.setDate(today.getDate()+d);return x;});
  const guide=sectionGuide('horarios','¿Cómo funcionan los Horarios?',`
    Acá ves los <b>turnos de la semana</b>. ${manage?'Asignás un turno eligiendo a la persona, la hora y, si hace falta, los quiebres (descansos).':'Ves tu turno de cada día con sus quiebres.'}
    <ul style="margin:8px 0 0 18px">${manage?'<li>El <b>Editor semanal</b> es una grilla por persona y día, dividida por área (Salón, Cocina, Gerencia, Administración): tocá una casilla para ponerle el turno a esa persona ese día. Arriba ves a <b>quién le falta</b> horario.</li>':''}<li><b>Mi semana</b> te muestra tus 7 días de un vistazo: cuándo entrás, cuándo salís y tus descansos.</li><li>La <b>Vista general</b> muestra en una línea de tiempo de qué hora a qué hora trabaja cada quien por área.</li><li>Cada persona recibe un aviso <b>el día anterior</b> y en <b>Inicio</b> ve si hoy trabaja o está libre.</li></ul>`);
  let html=`<div class="page-head"><div><div class="page-title">Horarios</div><div class="page-sub">Próximos 7 días</div></div>
    <div class="ph-spacer"></div>${manage?`<button class="btn btn-primary" style="flex:0 0 auto" onclick="shiftNewModal()">${svgIcon('plus','icon icon-sm')} Asignar turno</button>`:''}</div>`;
  html+=guide;
  const modes=manage
    ? [['semana','Editor semanal'],['general','Vista general'],['asistencia','Asistencia'],['lista','Lista por día'],['mia','Mi semana']]
    : [['mia','Mi semana'],['general','Ver equipo']];
  html+=`<div class="hor-modes chipscroll">${modes.map(([k,l])=>`<button class="chip ${horMode===k?'on':''}" onclick="horMode='${k}';render()">${l}</button>`).join('')}</div>`;
  html+= horMode==='semana' ? horWeek(manage) : horMode==='mia' ? horMine(days) : horMode==='general' ? horTimeline(days) : horMode==='asistencia' ? horAsistencia() : horList(days,manage);
  return html;
}
function horWeek(manage){
  const days=horWeekDays();
  const tISO=todayISO();
  const people=scopedPeople(false);
  const depts=HOR_DEPTS.filter(dp=>people.some(u=>dp.roles.includes(u.role)));
  const shownDepts = horArea==='todas'?depts:depts.filter(dp=>dp.label===horArea);
  const idx={};
  DB.shifts.filter(s=>inScope(s.sucursalId)).forEach(s=>{ const k=s.userId+'|'+s.date; (idx[k]=idx[k]||[]).push(s); });
  const entries=u=>days.reduce((n,d)=>n+((idx[u.id+'|'+isoLocal(d)]||[]).length?1:0),0);
  const shownPeople = shownDepts.flatMap(dp=>people.filter(u=>dp.roles.includes(u.role)));
  const sinHorario = shownPeople.filter(u=>entries(u)===0).length;
  const wkLabel = days[0].toLocaleDateString('es-CR',{day:'numeric',month:'short'})+' al '+days[6].toLocaleDateString('es-CR',{day:'numeric',month:'short'});
  const DOW=['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'];

  let html=`<div class="hw-nav">
    <button class="icon-btn" style="width:34px;height:34px" onclick="horWeekNav(-1)" title="Semana anterior">${svgIcon('back','icon icon-sm')}</button>
    <b class="hw-nav-lbl">${esc(wkLabel)}</b>
    <button class="icon-btn" style="width:34px;height:34px" onclick="horWeekNav(1)" title="Semana siguiente"><svg class="icon icon-sm" viewBox="0 0 24 24" style="transform:scaleX(-1)"><use href="#i-back"/></svg></button>
    <button class="chip" onclick="horWeekThis()">Esta semana</button>
  </div>
  <div class="chipscroll" style="margin-bottom:10px">
    <button class="chip ${horArea==='todas'?'on':''}" onclick="horSetArea('todas')">Todas</button>
    ${depts.map(dp=>`<button class="chip ${horArea===dp.label?'on':''}" onclick="horSetArea('${dp.label}')">${esc(dp.label)}</button>`).join('')}
  </div>
  <div class="hw-summary ${sinHorario?'warn':''}">${sinHorario?`${svgIcon('info','icon icon-sm')} <b>${sinHorario}</b> ${sinHorario===1?'persona sin horario':'personas sin horario'} esta semana`:`${svgIcon('check','icon icon-sm')} Todos con horario esta semana`}</div>`;

  let grid=`<table class="hw-grid"><thead><tr><th class="hw-c0">Persona</th>${days.map(d=>{const iso=isoLocal(d);return `<th class="${iso===tISO?'hw-today':''}">${DOW[(d.getDay()+6)%7]}<span>${d.getDate()}</span></th>`;}).join('')}</tr></thead><tbody>`;
  shownDepts.forEach(dp=>{
    const dpPeople=people.filter(u=>dp.roles.includes(u.role)).sort((a,b)=>a.name.localeCompare(b.name));
    if(!dpPeople.length) return;
    grid+=`<tr class="hw-dept"><td colspan="8">${esc(dp.label)} · ${dpPeople.length}</td></tr>`;
    dpPeople.forEach(u=>{
      const none=entries(u)===0;
      grid+=`<tr><td class="hw-c0 ${none?'hw-none':''}"><div class="hw-person">${avatarHTML(u)}<div class="hw-pn"><div class="hw-pn-n">${esc((u.name||'').split(' ')[0])}</div><div class="hw-pn-r">${esc(roleInfo(u.role).short)}</div></div></div></td>`;
      days.forEach(d=>{
        const iso=isoLocal(d); const sh=(idx[u.id+'|'+iso]||[]); const today=iso===tISO;
        const off = sh.length && sh.every(s=>s.off); const work = sh.filter(s=>!s.off);
        let inner, cls;
        if(work.length){ inner=work.slice().sort((a,b)=>(a.start||'').localeCompare(b.start||'')).map(s=>`<span class="hw-t">${fmtCompact(s.start)}–${fmtCompact(s.end)}</span>`).join(''); cls='hw-work'; }
        else if(off){ inner=`<span class="hw-off">Libre</span>`; cls='hw-offc'; }
        else { inner = manage?`<span class="hw-add">+</span>`:`<span class="hw-dash">—</span>`; cls='hw-empty'; }
        grid+=`<td class="hw-cell ${cls} ${today?'hw-today':''}" ${manage?`onclick="horCellEdit('${u.id}','${iso}')"`:''}>${inner}</td>`;
      });
      grid+=`</tr>`;
    });
  });
  grid+=`</tbody></table>`;
  html+=`<div class="hw-scroll">${grid}</div>`;
  if(manage) html+=`<div class="page-sub" style="margin-top:10px">${svgIcon('info','icon icon-sm')} Tocá una casilla para poner o cambiar el turno de esa persona ese día. Las casillas con <b>+</b> son las que faltan; la franja naranja marca quién no tiene nada esta semana.</div>`;
  return html;
}
function horCellEdit(userId, date){
  const existing=DB.shifts.find(s=>s.userId===userId && s.date===date && inScope(s.sucursalId));
  shBreaks = existing?(existing.breaks||[]).map(b=>({...b})):[]; shPresetEdit=false;
  openModal(shiftForm(existing?'Editar turno':'Asignar turno', existing, {userId,date}), true);
}
window.horCellEdit=horCellEdit;
/* Reporte de marcas reales de entrada/salida (encargados). Muestra los últimos 7 días;
   por persona lista todas las sesiones del día y el total trabajado, agrupado por área. */
function horAsistencia(){
  const base=new Date(); base.setHours(12,0,0,0);   // mediodía local: evita saltos de día por zona horaria
  const past=[...Array(7)].map((_,d)=>{ const x=new Date(base); x.setDate(base.getDate()-d); return x; }); // hoy, ayer, ...
  const tISO=todayISO();
  if(!past.some(d=>isoLocal(d)===attDay)) attDay=tISO;
  const chips=past.map((d,di)=>{
    const iso=isoLocal(d);
    const n=(DB.attendance||[]).filter(a=>a&&inScope(a.sucursalId)&&a.date===iso&&attLiveSessions(a).length&&userById(a.userId)).length;
    const lbl=(di===0?'Hoy':di===1?'Ayer':d.toLocaleDateString('es-CR',{weekday:'short'}).replace('.','')+' '+d.getDate());
    return `<button class="chip ${attDay===iso?'on':''}" onclick="attDay='${iso}';render()">${lbl}${n?`<span class="chip-dot">${n}</span>`:''}</button>`;
  }).join('');
  const canDel=canAttDelete();
  let html=`<div class="toolbar" style="overflow-x:auto">${chips}</div>`;
  if(canDel) html+=`<div style="display:flex;gap:8px;flex-wrap:wrap;margin:2px 0 8px"><button class="btn btn-ghost" style="flex:0 0 auto" onclick="openEntryAdmin()">${svgIcon('clock','icon icon-sm')} Código de entrada</button></div>
    <div class="page-sub" style="margin:0 0 10px">${svgIcon('info','icon icon-sm')} Tocá la ✕ de una marca para borrarla, o 🗑️ para borrar todo el día (quitar pruebas).</div>`;
  const day=(DB.attendance||[]).filter(a=>a&&inScope(a.sucursalId)&&a.date===attDay&&attLiveSessions(a).length);
  if(!day.length) return html+emptyState('','Sin marcas ese día','Cuando alguien marque entrada o salida, su registro aparece acá.');
  let body='', totMin=0, totPpl=0;
  HOR_DEPTS.forEach(dept=>{
    const rows=day.filter(a=>{const u=userById(a.userId); return u && dept.roles.includes(u.role);})
      .sort((x,y)=>(userById(x.userId)?.name||'').localeCompare(userById(y.userId)?.name||''));
    if(!rows.length) return;
    body+=`<div class="tl-dept">${dept.label}</div>`;
    rows.forEach(a=>{
      const u=userById(a.userId); const ss=attLiveSessions(a); const open=attOpen(a); const m=attWorkedMin(a);
      totMin+=m; totPpl++;
      body+=`<div class="sched-row">${avatarHTML(u)}
        <div class="tk-main"><div class="tk-title">${u?esc(u.name):'—'} ${open?'<span class="pill proceso">en turno</span>':''}</div>
          ${attSegsHTML(ss, a.id, canDel)}</div>
        <div class="att-total">${m?fmtDur(m):'—'}</div>
        ${canDel?`<button class="icon-btn" style="width:34px;height:34px;flex:0 0 auto;align-self:center" title="Borrar todas las marcas de este día" onclick="delAttDay('${a.id}')">${svgIcon('trash','icon icon-sm')}</button>`:''}</div>`;
    });
  });
  if(!body) return html+emptyState('','Sin marcas ese día','Cuando alguien marque entrada o salida, su registro aparece acá.');
  const summary=`<div class="tl-summary"><span class="tl-sum-num">${totPpl}</span> ${totPpl===1?'persona marcó':'personas marcaron'} · ${fmtDur(totMin)} en total</div>`;
  return html+summary+`<div class="card">${body}</div>`;
}
function horMine(days){
  const todayISO=new Date().toISOString().slice(0,10);
  const myAll=DB.shifts.filter(s=>s.userId===SES.userId);
  let totNet=0, workDays=0;
  const rows=days.map((d,di)=>{
    const iso=d.toISOString().slice(0,10);
    const sh=myAll.filter(s=>s.date===iso).sort((a,b)=>(a.start||'').localeCompare(b.start||''));
    const isToday=iso===todayISO;
    const wd=d.toLocaleDateString('es-CR',{weekday:'short'}).replace('.','');
    const dayName=(di===0?'Hoy':di===1?'Mañana':d.toLocaleDateString('es-CR',{weekday:'long'}));
    const isOff=sh.length&&sh.every(s=>s.off);
    let body;
    if(!sh.length){
      body=`<div class="mw-empty">Sin turno asignado</div>`;
    } else if(isOff){
      body=`<div class="mw-shift"><span class="mw-pill off">Día libre</span></div>`;
    } else {
      if(sh.some(s=>!s.off)) workDays++;
      body=sh.filter(s=>!s.off).map(s=>{
        const {net}=shiftSummary(s.start,s.end,s.breaks); totNet+=net;
        const brk=(s.breaks||[]).map(b=>`<span class="mw-brk">${svgIcon('clock','icon icon-sm')} Descanso ${fmt12(b.start)}–${fmt12(b.end)}</span>`).join('');
        return `<div class="mw-shift">
          <div class="mw-time">${fmt12(s.start)} <span class="mw-dash">–</span> ${fmt12(s.end)}</div>
          <div class="mw-meta"><span>${svgIcon('pin','icon icon-sm')} ${esc(sucName(s.sucursalId))}</span><span>${fmtDur(net)} efectivas</span>${s.note?`<span>${esc(s.note)}</span>`:''}</div>
          ${brk?`<div class="mw-brks">${brk}</div>`:''}</div>`;
      }).join('');
    }
    return `<div class="mw-day${isToday?' today':''}${isOff?' isoff':''}">
      <div class="mw-date${isToday?' on':''}"><span class="mw-wd">${wd}</span><span class="mw-dn">${d.getDate()}</span></div>
      <div class="mw-body"><div class="mw-dayname">${dayName}</div>${body}</div></div>`;
  }).join('');
  const sum=`<div class="mw-sum">
    <div class="mw-sum-cell"><div class="mw-sum-big">${workDays}</div><div class="mw-sum-lbl">${workDays===1?'día de trabajo':'días de trabajo'}</div></div>
    <div class="mw-sum-div"></div>
    <div class="mw-sum-cell"><div class="mw-sum-big">${fmtDur(totNet)}</div><div class="mw-sum-lbl">en total esta semana</div></div></div>`;
  return sum+`<div class="myweek">${rows}</div>`;
}
function horList(days,manage){
  const all=DB.shifts.filter(s=>inScope(s.sucursalId));
  let any=false;
  let html=days.map((d,di)=>{
    const iso=d.toISOString().slice(0,10);
    const ds=all.filter(s=>s.date===iso).sort((a,b)=>(a.start||'').localeCompare(b.start||''));
    if(!ds.length) return '';
    any=true;
    const label=(di===0?'Hoy · ':di===1?'Mañana · ':'')+d.toLocaleDateString('es-CR',{weekday:'long',day:'2-digit',month:'short'});
    return `<div class="card"><div style="font-weight:700;font-size:14px;text-transform:capitalize;margin-bottom:12px">${label}</div>
      ${ds.map(s=>{const u=userById(s.userId);const mine=s.userId===SES.userId;
        const brk=s.off?'':(s.breaks||[]).map(b=>`<span class="chip" style="padding:3px 9px;font-size:11px">Quiebre ${fmt12(b.start)}–${fmt12(b.end)}</span>`).join(' ');
        const timeHtml=s.off?`<span style="color:var(--accent);font-weight:700">Día libre</span>`:`<span>${svgIcon('clock','icon icon-sm')} ${fmt12(s.start)} – ${fmt12(s.end)}</span>`;
        return `<div class="sched-row${mine?' mine':''}">${avatarHTML(u)}
          <div class="tk-main"><div class="tk-title">${u?esc(u.name):'—'} ${mine?'<span class="pill proceso">vos</span>':''}</div>
          <div class="tk-meta">${timeHtml}<span>${u?roleInfo(u.role).short:''}</span><span>${svgIcon('pin','icon icon-sm')} ${esc(sucName(s.sucursalId))}</span>${s.note?`<span>${esc(s.note)}</span>`:''}</div>
          ${brk?`<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:7px">${brk}</div>`:''}</div>
          ${manage?`<div style="display:flex;gap:6px;align-items:flex-start"><button class="icon-btn" style="width:34px;height:34px" title="Editar" onclick="shiftEditModal('${s.id}')">${svgIcon('edit','icon icon-sm')}</button><button class="icon-btn" style="width:34px;height:34px" title="Quitar" onclick="delShift('${s.id}')">${svgIcon('trash','icon icon-sm')}</button></div>`:''}</div>`;}).join('')}
    </div>`;
  }).join('');
  if(!any) html+=emptyState('','Sin turnos esta semana', manage?'Asigná el primer turno del equipo.':'Todavía no te asignaron turnos.', manage?'Asignar turno':'', manage?'shiftNewModal()':'');
  return html;
}
function tlBar(s,win){
  let st=timeToMin(s.start),en=timeToMin(s.end); if(en<st)en+=1440;
  const left=Math.max(0,(st-win.start)/win.span*100), width=Math.min(100-left,(en-st)/win.span*100), dur=en-st||1;
  const brks=(s.breaks||[]).map(b=>{let bs=timeToMin(b.start),be=timeToMin(b.end);if(be<bs)be+=1440;const bl=Math.max(0,(bs-st)/dur*100),bw=Math.min(100,(be-bs)/dur*100);return `<div class="tl-brk" style="left:${bl}%;width:${bw}%"></div>`;}).join('');
  return `<div class="tl-bar" style="left:${left}%;width:${width}%" title="${fmt12(s.start)} – ${fmt12(s.end)}">${brks}<span class="tl-lbl">${fmt12(s.start)}–${fmt12(s.end)}</span></div>`;
}
function horTimeline(days){
  const todayISO=new Date().toISOString().slice(0,10);
  let html=`<div class="toolbar" style="overflow-x:auto">${days.map((d,di)=>{const iso=d.toISOString().slice(0,10);const n=DB.shifts.filter(s=>inScope(s.sucursalId)&&s.date===iso&&!s.off).length;const lbl=(di===0?'Hoy':di===1?'Mañana':d.toLocaleDateString('es-CR',{weekday:'short'}).replace('.',''))+' '+d.getDate();return `<button class="chip ${horDay===iso?'on':''}" onclick="horDay='${iso}';render()">${lbl}${n?`<span class="chip-dot">${n}</span>`:''}</button>`;}).join('')}</div>`;
  const dayShifts=DB.shifts.filter(s=>inScope(s.sucursalId)&&s.date===horDay);
  if(!dayShifts.length) return html+emptyState('','Sin turnos ese día','Asigná turnos para ver el horario general por área.');
  const work=dayShifts.filter(s=>!s.off);
  const offCount=dayShifts.length-work.length;
  let minH=6*60, maxH=22*60;
  work.forEach(s=>{let st=timeToMin(s.start),en=timeToMin(s.end);if(en<st)en+=1440;minH=Math.min(minH,Math.floor(st/60)*60);maxH=Math.max(maxH,Math.ceil(en/60)*60);});
  const win={start:minH,span:Math.max(120,maxH-minH)};
  const hrs=[]; for(let h=minH;h<=maxH;h+=120) hrs.push(h);
  const axis=hrs.map(h=>`<span>${fmt12(String(Math.floor(h/60)%24).padStart(2,'0')+':00')}</span>`).join('');
  const stepPct=120/win.span*100;
  // línea de "ahora" (solo si estamos viendo hoy y la hora actual cae en la ventana)
  let nowLine='';
  if(horDay===todayISO){
    const nd=new Date(); const nm=nd.getHours()*60+nd.getMinutes();
    const np=(nm-win.start)/win.span*100;
    if(np>=0&&np<=100) nowLine=`<div class="tl-now" style="left:${np}%" title="Ahora · ${fmt12(String(nd.getHours()).padStart(2,'0')+':'+String(nd.getMinutes()).padStart(2,'0'))}"></div>`;
  }
  let body='';
  HOR_DEPTS.forEach(dept=>{
    const ppl=DB.users.filter(u=>u.active && dept.roles.includes(u.role) && (u.sucursalId==='all'||inScope(u.sucursalId)));
    const rows=ppl.map(u=>{
      const sh=dayShifts.filter(s=>s.userId===u.id);
      if(!sh.length) return '';
      const bars=sh.map(s=> s.off? `<div class="tl-off">Día libre</div>` : tlBar(s,win)).join('');
      return `<div class="tl-row"><div class="tl-name">${avatarHTML(u)}<span>${esc((u.name||'').split(' ')[0])}</span></div><div class="tl-track">${nowLine}${bars}</div></div>`;
    }).filter(Boolean).join('');
    if(rows) body+=`<div class="tl-dept">${dept.label}</div>${rows}`;
  });
  if(!body) return html+emptyState('','Sin turnos ese día','Asigná turnos para ver el horario general por área.');
  const summary=`<div class="tl-summary"><span class="tl-sum-num">${work.length}</span> ${work.length===1?'persona en turno':'personas en turno'}${offCount?` · ${offCount} libre${offCount>1?'s':''}`:''}</div>`;
  return html+summary+`<div class="card tl-wrap"><div class="tl" style="--tl-step:${stepPct}%"><div class="tl-axis">${axis}</div>${body}</div></div>`;
}
let shPresetEdit=false;
function getShiftPresets(){
  if(!Array.isArray(DB.shiftPresets)||!DB.shiftPresets.length)
    DB.shiftPresets=SHIFT_PRESETS.map(p=>({label:p.label,start:p.start,end:p.end,breaks:(p.breaks||[]).map(b=>({...b}))}));
  return DB.shiftPresets;
}
function renderPresetArea(){
  const c=$('#shPresetArea'); if(!c) return;
  const ps=getShiftPresets();
  if(shPresetEdit){
    c.innerHTML=`<div class="pe-head"><span>Editá los turnos rápidos</span><button type="button" class="pe-link" onclick="savePresets()">${svgIcon('check','icon icon-sm')} Listo</button></div>
      ${ps.map((p,i)=>`<div class="pe-row">
        <input class="input pe-name" id="peName${i}" value="${esc(p.label)}" maxlength="14" placeholder="Nombre">
        <div class="pe-times"><span class="pe-lbl">Entra</span>${timePicker('pe'+i+'S',p.start,'')}<span class="pe-lbl">Sale</span>${timePicker('pe'+i+'E',p.end,'')}</div>
      </div>`).join('')}`;
  } else {
    c.innerHTML=`<div class="pe-head"><span>Turnos rápidos</span><button type="button" class="pe-link" onclick="shPresetEdit=true;renderPresetArea()">${svgIcon('edit','icon icon-sm')} Editar</button></div>
      <div class="sh-presets">${ps.map((p,i)=>`<button type="button" class="sh-preset" data-s="${p.start}" data-e="${p.end}" onclick="applyShiftPreset(${i})">${esc(p.label)}<span>${fmt12(p.start)} – ${fmt12(p.end)}</span></button>`).join('')}</div>`;
    updateShiftPreview();
  }
}
function savePresets(){
  const ps=getShiftPresets();
  ps.forEach((p,i)=>{ const n=$('#peName'+i); p.label=(n&&n.value.trim())||p.label; p.start=readTP('pe'+i+'S'); p.end=readTP('pe'+i+'E'); });
  save(); shPresetEdit=false; renderPresetArea(); toast('Turnos rápidos guardados','ok');
}
function setTP(prefix,value){
  const {h,m,ap}=to12(value);
  const H=$('#'+prefix+'H'), M=$('#'+prefix+'M');
  if(H)H.value=h; if(M)M.value=m;
  setAP(prefix,ap);
}
function applyShiftPreset(i){
  const p=getShiftPresets()[i]; if(!p) return;
  setTP('shStart',p.start); setTP('shEnd',p.end);
  shBreaks=(p.breaks||[]).map(b=>({...b}));
  renderBreakRows(); updateShiftPreview();
}
window.applyShiftPreset=applyShiftPreset; window.savePresets=savePresets; window.renderPresetArea=renderPresetArea;
function shiftNewModal(){ shBreaks=[]; shPresetEdit=false; openModal(shiftForm('Asignar turno',null), true); }
function shiftEditModal(id){ const s=DB.shifts.find(x=>x.id===id); shBreaks=s?(s.breaks||[]).map(b=>({...b})):[]; shPresetEdit=false; openModal(shiftForm('Editar turno',s), true); }
function shiftForm(title,s,pre){
  const people=scopedPeople(false);
  const d=new Date(); d.setMinutes(d.getMinutes()-d.getTimezoneOffset());
  const date = s ? s.date : (pre&&pre.date) ? pre.date : d.toISOString().slice(0,10);
  const st=s&&s.start?s.start:'10:00', en=s&&s.end?s.end:'18:00';
  return `<div class="modal-head"><h3>${title}</h3><button class="modal-close" onclick="closeModal()">${svgIcon('x','icon')}</button></div>
  <div class="modal-body">
    <div class="field"><label>¿A quién?</label><select class="select" id="shUser">${people.map(u=>`<option value="${u.id}" ${((s&&s.userId===u.id)||(!s&&pre&&pre.userId===u.id))?'selected':''}>${esc(u.name)} — ${roleInfo(u.role).short}</option>`).join('')}</select></div>
    <div class="field"><label>Fecha</label>${dateField(date)}</div>
    <div class="field"><label>Horario</label>
      <div id="shPresetArea" class="sh-presetbox"></div>
      <div class="sh-block">
        <div class="sh-row"><label>Entra</label>${timePicker('shStart',st,'updateShiftPreview()')}</div>
        <div class="sh-row"><label>Sale</label>${timePicker('shEnd',en,'updateShiftPreview()')}</div>
      </div>
      <div class="sh-preview" id="shPreview" style="margin-top:12px"></div>
    </div>
    <div class="field"><label>Quiebres / descansos</label><div id="shBreaks"></div>
      <button class="add-break" onclick="addBreakRow()">${svgIcon('plus','icon icon-sm')} Agregar quiebre</button></div>
    <div class="field"><label>Sucursal</label><select class="select" id="shSuc">${DB.sucursales.map(x=>`<option value="${x.id}" ${s&&s.sucursalId===x.id?'selected':''}>${esc(x.name)}</option>`).join('')}</select></div>
    <div class="field"><label>Nota (opcional)</label><input class="input" id="shNote" value="${s?esc(s.note||''):''}" placeholder="Ej: turno de almuerzo"></div>
    <button class="btn-off" onclick="saveShiftOff('${s?s.id:''}')">${svgIcon('calendar','icon icon-sm')} Marcar este día como LIBRE</button>
  </div>
  <div class="modal-foot">${s?`<button class="iconbtn-sq danger" style="flex:0 0 auto" title="Quitar turno" onclick="closeModal();delShift('${s.id}')">${svgIcon('trash','icon icon-sm')}</button>`:''}<button class="btn btn-ghost" onclick="closeModal()">Cancelar</button><button class="btn btn-primary" onclick="saveShift('${s?s.id:''}')">Guardar turno</button></div>`;
}
function renderBreakRows(){
  const c=$('#shBreaks'); if(!c) return;
  c.innerHTML = shBreaks.map((b,idx)=>`<div class="brk-row">
    ${timePicker('brk'+idx+'S', b.start, `shBreaks[${idx}].start=readTP('brk${idx}S');updateShiftPreview()`)}
    <span style="color:var(--text-soft);font-size:13px">a</span>
    ${timePicker('brk'+idx+'E', b.end, `shBreaks[${idx}].end=readTP('brk${idx}E');updateShiftPreview()`)}
    <button class="icon-btn" style="width:38px;height:38px;flex:0 0 auto" title="Quitar quiebre" onclick="shBreaks.splice(${idx},1);renderBreakRows();updateShiftPreview()">${svgIcon('x','icon icon-sm')}</button>
  </div>`).join('') || '<div style="font-size:12.5px;color:var(--text-soft);margin-bottom:10px">Sin quiebres. El turno es corrido.</div>';
}
function addBreakRow(){ shBreaks.push({start:'14:00',end:'15:00'}); renderBreakRows(); }
function saveShift(id){
  const userId=$('#shUser').value, date=shDate;
  if(!date){ toast('Elegí una fecha','err'); return; }
  const breaks=shBreaks.filter(b=>b.start&&b.end);
  const data={userId,sucursalId:$('#shSuc').value,date,start:readTP('shStart'),end:readTP('shEnd'),note:$('#shNote').value.trim(),breaks,off:false};
  if(id){ const s=DB.shifts.find(x=>x.id===id); Object.assign(s,data); audit('horarios',`editó turno de ${userById(userId)?.name.split(' ')[0]} (${date})`,s.sucursalId); }
  else { DB.shifts.push({id:uid(),...data,byId:SES.userId,at:now()}); audit('horarios',`asignó turno a ${userById(userId)?.name.split(' ')[0]} el ${date}`,data.sucursalId); }
  const fecha=new Date(date+'T00:00').toLocaleDateString('es-CR',{weekday:'long',day:'2-digit',month:'short'});
  notify([userId],`Turno asignado: ${fecha}, ${fmt12(data.start)} – ${fmt12(data.end)}${breaks.length?' (con quiebre)':''}`,'cal',{view:'horarios'});
  closeModal(); toast('Turno guardado y avisado a '+(userById(userId)?.name.split(' ')[0]||''),'ok'); render();
}
function saveShiftOff(id){
  const userId=$('#shUser').value, date=shDate;
  if(!date){ toast('Elegí una fecha','err'); return; }
  const data={userId,sucursalId:$('#shSuc').value,date,start:'',end:'',note:($('#shNote')?$('#shNote').value.trim():''),breaks:[],off:true};
  if(id){ const s=DB.shifts.find(x=>x.id===id); Object.assign(s,data); audit('horarios',`marcó día libre de ${userById(userId)?.name.split(' ')[0]} (${date})`,s.sucursalId); }
  else { DB.shifts.push({id:uid(),...data,byId:SES.userId,at:now()}); audit('horarios',`marcó día libre a ${userById(userId)?.name.split(' ')[0]} el ${date}`,data.sucursalId); }
  const fecha=new Date(date+'T00:00').toLocaleDateString('es-CR',{weekday:'long',day:'2-digit',month:'short'});
  notify([userId],`Día libre: ${fecha}`,'cal',{view:'horarios'});
  closeModal(); toast('Día libre marcado','ok'); render();
}
window.saveShiftOff=saveShiftOff;
async function delShift(id){
  const s=DB.shifts.find(x=>x.id===id); if(!s) return;
  if(!await confirmDialog('Se quita este turno del horario.',{title:'¿Quitar turno?',okText:'Sí, quitar'})) return;
  tomb(id); DB.shifts=DB.shifts.filter(x=>x.id!==id);
  audit('horarios',`quitó un turno`,s.sucursalId); save(); render(); undoDelete('shifts', s, 'Turno');
}
function checkShiftReminders(){
  if(!me()) return;
  const t=new Date(); t.setDate(t.getDate()+1); const iso=t.toISOString().slice(0,10);
  DB._shiftNotif=DB._shiftNotif||{}; let ch=false;
  DB.shifts.filter(s=>s.userId===SES.userId && s.date===iso).forEach(s=>{
    const key=SES.userId+'|'+s.id; if(DB._shiftNotif[key]) return;
    const fecha=new Date(iso+'T00:00').toLocaleDateString('es-CR',{weekday:'long',day:'2-digit',month:'short'});
    const brk=(s.breaks||[]).map(b=>fmt12(b.start)+'–'+fmt12(b.end)).join(', ');
    const txt=s.off?`Mañana (${fecha}) tenés libre`:`Mañana (${fecha}) trabajás ${fmt12(s.start)}–${fmt12(s.end)}${brk?' · quiebre '+brk:''}`;
    DB.notifs.unshift({id:uid(),userId:SES.userId,text:txt,ico:'cal',link:{view:'horarios'},at:now(),read:false});
    DB._shiftNotif[key]=1; ch=true;
  });
  if(ch) save();
}
// Recordatorio de reservas: un resumen al día para el salón ("Hoy hay N reservas").
function checkReservReminders(){
  if(!me() || !canReservView()) return;
  const today=todayISO();
  const hoy=(DB.reservations||[]).filter(r=> r && r.resDate===today && inScope(r.sucursalId) && !['cancelada','no_llego','llego'].includes(r.status));
  if(!hoy.length) return;
  DB._resvNotif=DB._resvNotif||{}; const key=SES.userId+'|'+today;
  if(DB._resvNotif[key]) return;                  // ya avisé hoy
  const n=hoy.length;
  const next=hoy.slice().sort((a,b)=>(a.resTime||'').localeCompare(b.resTime||''))[0];
  const txt=`Hoy hay ${n} reserva${n>1?'s':''}`+(next&&next.resTime?` · próxima ${fmt12(next.resTime)}${next.clientName?' ('+next.clientName+')':''}`:'');
  DB.notifs.unshift({id:uid(),userId:SES.userId,text:txt,ico:'reserva',link:{view:'reservas'},at:now(),read:false});
  DB._resvNotif[key]=n; save();
}
/* ---- Marca real de entrada / salida (asistencia) ---- */
function fmtClock(ts){ try{ return new Date(ts).toLocaleTimeString('es-CR',{hour:'2-digit',minute:'2-digit'}); }catch(_){ return ''; } }
function todayAttendance(){ const d=todayISO(); return (DB.attendance||[]).find(a=>a&&a.userId===SES.userId&&a.date===d); }
/* Marcas del día en SESIONES: permite varias entradas/salidas en un mismo día (quiebre de turno).
   Compatibilidad: registros viejos traían in/out sueltos -> se leen como una sola sesión. */
function attSessions(a){
  if(!a) return [];
  if(Array.isArray(a.sessions)) return a.sessions;
  if(a.in) return [{in:a.in, out:a.out||null}];
  return [];
}
function attLiveSessions(a){ return attSessions(a).filter(s=>s && !s.del); }   // marcas vigentes (sin las eliminadas)
function attOpen(a){ return attLiveSessions(a).find(s=>s && s.in && !s.out); }   // sesión abierta (entró y no salió)
function attWorkedMin(a){ return attLiveSessions(a).reduce((s,x)=>s+((x.in&&x.out)?Math.max(0,Math.round((x.out-x.in)/60000)):0),0); }
function attSyncLegacy(a){ const ss=attLiveSessions(a); a.in = ss.length?ss[0].in:null; a.out = (ss.length && ss.every(s=>s.out))? ss[ss.length-1].out : null; } // resumen para vistas/reportes viejos
function attNormSessions(a){ return attSessions(a).map(s=>({id:s.id||uid(), in:s.in, out:s.out||null, del:s.del||0})); } // ids estables + copia mutable (migra in/out viejos), conserva el marcador de borrado
/* Borrar marcas de asistencia (solo Gerencia) — sirve para quitar registros de prueba.
   Se hace "borrado suave" (del=timestamp) para que la eliminación se sincronice a todos
   los equipos (la unión de sesiones nunca quita, así que necesita una marca de borrado). */
const canAttDelete = () => hasRole('admin','gerencia_exp','gerencia_data');
function delAttSession(recId, inTs){
  if(!canAttDelete()){ toast('Solo Gerencia puede borrar marcas','err'); return; }
  const a=(DB.attendance||[]).find(x=>x&&x.id===recId); if(!a) return;
  a.sessions=attNormSessions(a);
  const s=a.sessions.find(x=>x.in===inTs); if(!s) return;
  s.del=now(); attSyncLegacy(a);
  audit('horarios','eliminó una marca de asistencia',a.sucursalId); save(); render();
  undoToast('Marca de asistencia', ()=>{ const a2=(DB.attendance||[]).find(x=>x&&x.id===recId); if(!a2) return; const s2=attSessions(a2).find(x=>x.in===inTs); if(s2){ s2.del=0; attSyncLegacy(a2); save(); render(); toast('Restaurada','ok'); } });
}
async function delAttDay(recId){
  if(!canAttDelete()){ toast('Solo Gerencia puede borrar marcas','err'); return; }
  const a=(DB.attendance||[]).find(x=>x&&x.id===recId); if(!a) return;
  const u=userById(a.userId);
  if(!await confirmDialog(`Se borran TODAS las marcas de ${u?esc(u.name):'esta persona'} del ${a.date}. Sirve para quitar registros de prueba.`,{title:'¿Borrar marcas del día?',okText:'Sí, borrar'})) return;
  delEntity('attendance', recId);
  audit('horarios',`eliminó las marcas de asistencia de ${u?u.name.split(' ')[0]:'—'} (${a.date})`,a.sucursalId); save(); render();
  undoDelete('attendance', a, 'Marcas de '+(u?u.name.split(' ')[0]:''));
}
window.delAttSession=delAttSession; window.delAttDay=delAttDay;
/* ---- Código de entrada rotativo (para marcar entrada solo estando en el local) ----
   Cada sucursal tiene un secreto; el código de 6 dígitos = f(secreto, ventana de 5 min).
   Gerencia muestra el código en la entrada; la persona lo escribe para poder marcar.
   Nota honesta: la verificación es en el dispositivo, sirve como control fuerte para el
   uso normal (cambia y solo se ve en el local), no es infalible ante alguien muy técnico. */
const ENTRY_WIN=5*60*1000;
function _hash32(str){ let h=0x811c9dc5>>>0; for(let i=0;i<(str||'').length;i++){ h^=str.charCodeAt(i); h=Math.imul(h,0x01000193)>>>0; } return h>>>0; }
function entryCode(secret, win){ return String(_hash32((secret||'')+'|'+win)%1000000).padStart(6,'0'); }
function entryCodeNow(secret){ return entryCode(secret, Math.floor(Date.now()/ENTRY_WIN)); }
function entryCodeValid(secret, typed){ typed=(typed||'').trim(); if(!/^\d{6}$/.test(typed)) return false; const w=Math.floor(Date.now()/ENTRY_WIN); return [w-1,w,w+1].some(x=>entryCode(secret,x)===typed); }
function entryRequiredFor(u){ if(!u || u.sucursalId==='all') return null; const s=(DB.sucursales||[]).find(x=>x.id===u.sucursalId); return (s && s.entryOn && s.entrySecret) ? s : null; }
function markIn(){
  const m=me(); if(!m){ toast('Tu sesión no es válida — volvé a entrar','err'); return; }
  const sucReq=entryRequiredFor(m);
  if(sucReq){ openEntryCodeModal(sucReq); return; }   // pide el código del local antes de marcar
  doMarkIn();
}
function doMarkIn(){
  const m=me(); if(!m) return;
  DB.attendance=DB.attendance||[]; let a=todayAttendance();
  // id determinista por persona+día: si dos equipos marcan sin haber sincronizado, crean el MISMO id y la nube los une (no se duplica el día).
  if(!a){ a={id:'att_'+m.id+'_'+todayISO(), userId:m.id, date:todayISO(), sucursalId:m.sucursalId, sessions:[], updatedAt:now()}; DB.attendance.push(a); }
  a.sessions=attNormSessions(a);
  if(attOpen(a)){ toast('Ya tenés una entrada abierta — marcá la salida primero','ok'); return; }
  const t=now(); a.sessions.push({id:uid(),in:t,out:null}); attSyncLegacy(a);
  audit('horarios',`marcó ENTRADA ${fmtClock(t)}`); toast('Entrada marcada ✓','ok'); render();
}
function openEntryCodeModal(suc){
  openModal(`<div class="modal-head"><h3>${svgIcon('clock','icon')} Código de entrada</h3><button class="modal-close" onclick="closeModal()">${svgIcon('x','icon')}</button></div>
    <div class="modal-body">
      <p class="page-sub" style="margin-top:0">Para marcar entrada, escribí el <b>código que se muestra en la entrada de ${esc(suc.name)}</b> (cambia cada pocos minutos).</p>
      <div class="field"><label>Código (6 dígitos)</label><input class="input" id="entryCodeInp" type="tel" inputmode="numeric" maxlength="6" placeholder="••••••" autocomplete="off" style="font-size:24px;letter-spacing:8px;text-align:center" onkeydown="if(event.key==='Enter')submitEntryCode('${suc.id}')"></div>
      <div id="entryCodeErr" style="color:var(--danger);font-size:12.5px;min-height:16px"></div>
    </div>
    <div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">Cancelar</button><button class="btn btn-primary" onclick="submitEntryCode('${suc.id}')">${svgIcon('clock','icon icon-sm')} Marcar entrada</button></div>`);
  setTimeout(()=>{ const i=$('#entryCodeInp'); if(i) i.focus(); },60);
}
function submitEntryCode(sucId){
  const s=(DB.sucursales||[]).find(x=>x.id===sucId); if(!s){ closeModal(); return; }
  const v=($('#entryCodeInp')?$('#entryCodeInp').value:'').trim();
  if(!entryCodeValid(s.entrySecret, v)){ const e=$('#entryCodeErr'); if(e) e.textContent='Código incorrecto o vencido. Mirá el código actual en el local.'; return; }
  closeModal(); doMarkIn();
}
window.submitEntryCode=submitEntryCode;
/* Panel de Gerencia: activar/mostrar/regenerar el código de la sucursal */
function entryCfgSuc(){
  const meId=me()&&me().sucursalId;
  if(meId && meId!=='all') return (DB.sucursales||[]).find(s=>s.id===meId)||null;
  if(SES.sucFilter && SES.sucFilter!=='all') return (DB.sucursales||[]).find(s=>s.id===SES.sucFilter)||null;
  return (DB.sucursales||[])[0]||null;
}
let _entryTimer=null;
function openEntryAdmin(){ const s=entryCfgSuc(); if(!s){ toast('No hay sucursal para configurar','err'); return; } renderEntryAdmin(s.id); }
function renderEntryAdmin(sucId){
  const s=(DB.sucursales||[]).find(x=>x.id===sucId); if(!s) return;
  const on=!!(s.entryOn && s.entrySecret);
  const body = on
    ? `<p class="page-sub" style="margin-top:0">Dejá esta pantalla visible en la <b>entrada de ${esc(s.name)}</b>. El personal escribe este código para marcar entrada. Cambia solo cada 5 minutos.</p>
       <div class="entry-code-box"><div class="entry-code" id="entryBigCode">------</div><div class="entry-count"><div class="entry-bar" id="entryBar"></div></div><div class="entry-sub" id="entrySub">—</div></div>
       <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px">
         <button class="btn btn-ghost" style="flex:1;min-width:120px" onclick="regenEntry('${s.id}')">Regenerar código</button>
         <button class="btn btn-ghost" style="flex:1;min-width:120px" onclick="toggleEntry('${s.id}',false)">Desactivar</button>
       </div>`
    : `<p class="page-sub" style="margin-top:0">Si lo activás, el personal de <b>${esc(s.name)}</b> deberá escribir un código (que cambia cada pocos minutos y se muestra en el local) para poder <b>marcar entrada</b>. Así solo marcan estando adentro.</p>
       <button class="btn btn-primary" onclick="toggleEntry('${s.id}',true)">${svgIcon('clock','icon icon-sm')} Activar código de entrada</button>`;
  openModal(`<div class="modal-head"><h3>${svgIcon('clock','icon')} Código de entrada · ${esc(s.name)}</h3><button class="modal-close" onclick="closeEntryAdmin()">${svgIcon('x','icon')}</button></div>
    <div class="modal-body">${body}</div>`);
  if(_entryTimer){ clearInterval(_entryTimer); _entryTimer=null; }
  if(on){ tickEntry(s.id); _entryTimer=setInterval(()=>tickEntry(s.id), 1000); }
}
function tickEntry(sucId){
  const s=(DB.sucursales||[]).find(x=>x.id===sucId); const el=$('#entryBigCode');
  if(!s||!el){ if(_entryTimer){ clearInterval(_entryTimer); _entryTimer=null; } return; }   // modal cerrado: autolimpia
  el.textContent=entryCodeNow(s.entrySecret);
  const left=ENTRY_WIN-(Date.now()%ENTRY_WIN);
  const sub=$('#entrySub'); if(sub) sub.textContent='Cambia en '+Math.ceil(left/1000)+' s';
  const bar=$('#entryBar'); if(bar) bar.style.width=(left/ENTRY_WIN*100)+'%';
}
function closeEntryAdmin(){ if(_entryTimer){ clearInterval(_entryTimer); _entryTimer=null; } closeModal(); }
function toggleEntry(sucId,on){
  if(!canAttDelete()){ toast('Solo Gerencia','err'); return; }
  const s=(DB.sucursales||[]).find(x=>x.id===sucId); if(!s) return;
  s.entryOn=!!on; if(on && !s.entrySecret) s.entrySecret=uid()+'-'+uid(); s.updatedAt=now();
  audit('equipo',`${on?'activó':'desactivó'} el código de entrada de "${s.name}"`); save(); renderEntryAdmin(sucId);
}
function regenEntry(sucId){
  if(!canAttDelete()){ toast('Solo Gerencia','err'); return; }
  const s=(DB.sucursales||[]).find(x=>x.id===sucId); if(!s) return;
  s.entrySecret=uid()+'-'+uid(); s.updatedAt=now(); audit('equipo',`regeneró el código de entrada de "${s.name}"`); save();
  toast('Código regenerado','ok'); tickEntry(sucId);
}
window.openEntryAdmin=openEntryAdmin; window.toggleEntry=toggleEntry; window.regenEntry=regenEntry; window.closeEntryAdmin=closeEntryAdmin; window.doMarkIn=doMarkIn;
function markOut(){
  const a=todayAttendance();
  if(!a || !attSessions(a).length){ toast('Primero marcá tu entrada','err'); return; }
  a.sessions=attNormSessions(a);
  const open=attOpen(a);
  if(!open){ toast('No tenés una entrada abierta — marcá entrada primero','err'); return; }
  open.out=now(); attSyncLegacy(a);
  audit('horarios',`marcó SALIDA ${fmtClock(open.out)}`); toast('Salida marcada ✓','ok'); render();
}
window.markIn=markIn; window.markOut=markOut;
function attSegsHTML(ss, recId, canDel){
  return `<div class="att-segs">${ss.map(s=>`<span class="att-seg${s.out?'':' open'}">${fmtClock(s.in)} <span class="att-arrow">→</span> ${s.out?fmtClock(s.out):'en turno'}${(canDel&&recId)?`<button class="att-del" title="Borrar esta marca" onclick="delAttSession('${recId}',${s.in})">${svgIcon('x','icon icon-sm')}</button>`:''}</span>`).join('')}</div>`;
}
function attendanceCard(){
  const a=todayAttendance(); const ss=attLiveSessions(a); const open=attOpen(a);
  const inBtn=`<button class="btn btn-primary" style="flex:0 0 auto" onclick="markIn()">${svgIcon('clock','icon icon-sm')} Marcar entrada</button>`;
  const outBtn=`<button class="btn btn-primary" style="flex:0 0 auto" onclick="markOut()">${svgIcon('clock','icon icon-sm')} Marcar salida</button>`;
  let body, btn;
  if(!ss.length){ body='Todavía no marcaste tu entrada de hoy.'; btn=inBtn; }
  else {
    const tot=attWorkedMin(a);
    body=`${attSegsHTML(ss)}<div style="margin-top:6px">${tot?`Trabajado hoy: <b>${fmtDur(tot)}</b>`:''}${open?`${tot?' · ':''}<b style="color:var(--accent)">en turno ahora</b>`:''}</div>`;
    btn = open ? outBtn : inBtn;     // ya cerró una sesión -> puede volver a entrar (quiebre de turno)
  }
  return `<div class="card sched-card"><span class="av" style="background:var(--bg-soft)">${svgIcon('clock')}</span><div style="flex:1;min-width:0"><div style="font-weight:700">Mi asistencia de hoy</div><div class="page-sub" style="margin:0">${body}</div></div>${btn}</div>`;
}
function todayShiftCard(){
  const iso=new Date().toISOString().slice(0,10);
  const mine=(DB.shifts||[]).filter(s=>s&&s.userId===SES.userId && s.date===iso).sort((a,b)=>(a.start||'').localeCompare(b.start||''));
  if(mine.some(s=>s.off)) return `<div class="card sched-card free"><span class="av" style="background:var(--bg-soft)">${svgIcon('calendar')}</span><div><div style="font-weight:700">Hoy es tu día libre</div><div class="page-sub" style="margin:0">Disfrutá. No tenés turno hoy.</div></div></div>`;
  const work=mine.filter(s=>!s.off);
  if(!work.length) return `<div class="card sched-card free"><span class="av" style="background:var(--bg-soft)">${svgIcon('calendar')}</span><div><div style="font-weight:700">Hoy estás libre</div><div class="page-sub" style="margin:0">No tenés turno asignado para hoy.</div></div></div>`;
  return work.map(s=>{
    const brk=(s.breaks||[]).map(b=>`<span class="chip" style="padding:3px 9px;font-size:11px">Quiebre ${fmt12(b.start)}–${fmt12(b.end)}</span>`).join(' ');
    return `<div class="card sched-card"><span class="av" style="background:var(--grad-accent)">${svgIcon('clock')}</span>
      <div style="flex:1"><div style="font-weight:700">Hoy trabajás ${fmt12(s.start)} – ${fmt12(s.end)}</div>
      <div class="page-sub" style="margin:2px 0 0">${esc(sucName(s.sucursalId))}${s.note?' · '+esc(s.note):''}</div>
      ${brk?`<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">${brk}</div>`:''}</div></div>`;
  }).join('');
}
window.shiftNewModal=shiftNewModal; window.shiftEditModal=shiftEditModal; window.saveShift=saveShift; window.delShift=delShift;
window.addBreakRow=addBreakRow; window.renderBreakRows=renderBreakRows;

/* =====================================================================
   VISTA: CALENDARIO (personal) — agenda con vistas Día / Semana / Mes / Año.
   Cada persona agenda sus cosas (DB.calEvents) y ve también sus turnos
   (Horarios) y sus tareas con fecha de entrega. Estilo oscuro de la app.
   ===================================================================== */
let calView='mes', calCursor='', _calEdit=null, _calColor='#b83a52';
let calShow={eventos:true, turnos:true, tareas:true};
const CAL_COLORS=['#b83a52','#e07a5f','#f4b740','#e8b84b','#5aa777','#3fa7a0','#7fa9b8','#5b8def','#9b6dd6','#d46aa8','#a0826d','#8d99ae'];
const CAL_DOW=['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'];
const CAL_MON=['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
function dISO(d){ return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
function calToday(){ return dISO(new Date()); }
function calParse(iso){ const a=(iso||calToday()).split('-').map(Number); return new Date(a[0],(a[1]||1)-1,a[2]||1); }
function calAddDays(iso,n){ const d=calParse(iso); d.setDate(d.getDate()+n); return dISO(d); }
function calAddMonths(iso,n){ const d=calParse(iso); d.setMonth(d.getMonth()+n); return dISO(d); }
function calWeekStart(iso){ const d=calParse(iso); const wd=(d.getDay()+6)%7; d.setDate(d.getDate()-wd); return dISO(d); }
function calHHMM(ts){ const d=new Date(ts); return String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0'); }
function calMin(t){ if(!t) return 0; const a=t.split(':').map(Number); return a[0]*60+(a[1]||0); }
function cap1(s){ return s.charAt(0).toUpperCase()+s.slice(1); }
/* Acomodo de eventos superpuestos: a cada item (con .s y .e en minutos) le pone
   .col (columna) y .cols (cuántas columnas hay en su grupo) para verse lado a lado. */
function calPack(list){
  list.sort((a,b)=> a.s-b.s || a.e-b.e);
  let cl=[], curEnd=-1; const clusters=[];
  list.forEach(it=>{ if(cl.length && it.s>=curEnd){ clusters.push(cl); cl=[]; curEnd=-1; } cl.push(it); curEnd=Math.max(curEnd,it.e); });
  if(cl.length) clusters.push(cl);
  clusters.forEach(c=>{ const ends=[]; c.forEach(it=>{ let p=false; for(let i=0;i<ends.length;i++){ if(ends[i]<=it.s){ ends[i]=it.e; it.col=i; p=true; break; } } if(!p){ it.col=ends.length; ends.push(it.e); } }); const n=ends.length; c.forEach(it=>it.cols=n); });
  return list;
}
function calEvBy(e){ return e.byId||e.userId; }
function calEventVisible(e){
  if(calEvBy(e)===SES.userId) return true;
  if(e.audience==='all') return inScope(e.sucursalId||'all');
  if(e.audience==='sel') return (e.members||[]).includes(SES.userId);
  return false;
}
function calEventCanEdit(e){ return calEvBy(e)===SES.userId || isAdmin(); }
function calEventOccurs(e, iso){
  if(!e.date || iso<e.date) return false;
  if(!e.repeat || e.repeat==='no') return iso===e.date;
  if(e.repeatUntil && iso>e.repeatUntil) return false;
  const d0=calParse(e.date), d=calParse(iso), diff=Math.round((d-d0)/86400000);
  if(diff<0) return false;
  if(e.repeat==='diario') return true;
  if(e.repeat==='semanal' || e.repeat==='quincenal'){
    const interval=e.repeat==='quincenal'?2:1;
    const days=(e.repeatDays&&e.repeatDays.length)?e.repeatDays:[(d0.getDay()+6)%7];
    if(!days.includes((d.getDay()+6)%7)) return false;
    const weeks=Math.round((calParse(calWeekStart(iso))-calParse(calWeekStart(e.date)))/(7*86400000));
    return weeks>=0 && weeks%interval===0;
  }
  if(e.repeat==='mensual') return d.getDate()===d0.getDate();
  return iso===e.date;
}
function calDayItems(iso){
  const items=[];
  if(calShow.eventos) (DB.calEvents||[]).filter(e=>e&&calEventVisible(e)&&calEventOccurs(e,iso)).forEach(e=>{
    const rec=!!(e.repeat&&e.repeat!=='no');
    items.push({kind:'event', id:e.id, title:e.title||'(sin título)', start:e.allDay?'':e.start, end:e.allDay?'':e.end, allDay:!!e.allDay||!e.start, color:e.color||CAL_COLORS[0], shared:e.audience&&e.audience!=='me', repeat:rec, draggable:!rec&&calEventCanEdit(e)});
  });
  if(calShow.turnos) (DB.shifts||[]).filter(s=>s&&s.userId===SES.userId && s.date===iso).forEach(s=>{
    if(s.off) items.push({kind:'shift', id:s.id, title:'Día libre', allDay:true, color:'#7fa9b8'});
    else items.push({kind:'shift', id:s.id, title:'Turno', start:s.start, end:s.end, allDay:false, color:'#5aa777'});
  });
  if(calShow.tareas) (DB.tasks||[]).filter(t=>t&&(t.toIds||[]).includes(SES.userId) && t.due && dISO(new Date(t.due))===iso && t.status!=='rechazada').forEach(t=>{
    const d=new Date(t.due); const hasTime=!(d.getHours()===0&&d.getMinutes()===0); const done=t.status==='hecha';
    items.push({kind:'task', id:t.id, title:t.title||'Tarea', start:hasTime?calHHMM(t.due):'', end:'', allDay:!hasTime, color:done?'#8a8f98':'#d59b4a', done, canDone:calCanMoveTask(t), draggable:!done&&calCanMoveTask(t)});
  });
  return items.sort((a,b)=> (a.done?1:0)-(b.done?1:0) || (a.allDay?0:1)-(b.allDay?0:1) || calMin(a.start)-calMin(b.start));
}
function viewCalendario(){
  if(!calCursor) calCursor=calToday();
  const d=calParse(calCursor);
  let title;
  if(calView==='dia') title=d.getDate()+' de '+CAL_MON[d.getMonth()]+' '+d.getFullYear();
  else if(calView==='semana'){ const ws=calParse(calWeekStart(calCursor)), we=calParse(calAddDays(calWeekStart(calCursor),6)); title=ws.getDate()+(ws.getMonth()!==we.getMonth()?' '+CAL_MON[ws.getMonth()].slice(0,3):'')+' – '+we.getDate()+' '+CAL_MON[we.getMonth()].slice(0,3)+' '+we.getFullYear(); }
  else if(calView==='anio') title=''+d.getFullYear();
  else if(calView==='agenda') title='Agenda · desde '+d.getDate()+' '+CAL_MON[d.getMonth()].slice(0,3);
  else title=cap1(CAL_MON[d.getMonth()])+' '+d.getFullYear();
  const views=[['dia','Día'],['semana','Semana'],['mes','Mes'],['anio','Año'],['agenda','Agenda']];
  const guide=sectionGuide('calendario','Tu calendario',`Agendá tus cosas y vé tus <b>turnos</b> y <b>tareas</b> en un solo lugar. Tocá un día (o <b>Crear</b>) para agregar algo.`);
  let html=`<div class="page-head"><div><div class="page-title">Calendario</div><div class="page-sub">Tu agenda personal</div></div>
    <div class="ph-spacer"></div><button class="btn btn-primary" style="flex:0 0 auto" onclick="calCreate('${calCursor}')">${svgIcon('plus','icon icon-sm')} Crear</button></div>`;
  html+=guide;
  html+=`<div class="cal-toolbar">
    <button class="btn btn-ghost cal-today" onclick="calGo('hoy')">Hoy</button>
    <button class="icon-btn cal-nav" onclick="calGo('prev')" title="Anterior">${svgIcon('back','icon icon-sm')}</button>
    <button class="icon-btn cal-nav cal-next" onclick="calGo('next')" title="Siguiente">${svgIcon('back','icon icon-sm')}</button>
    <div class="cal-title">${esc(title)}</div>
    <div class="ph-spacer"></div>
    <div class="cal-views">${views.map(([k,l])=>`<button class="cal-vbtn ${calView===k?'on':''}" onclick="calView='${k}';render()">${l}</button>`).join('')}</div>
  </div>`;
  html+=`<div class="cal-filters">${[['eventos','Mis eventos','#b83a52'],['turnos','Turnos','#5aa777'],['tareas','Tareas','#d59b4a']].map(([k,l,c])=>`<button class="cal-fchip ${calShow[k]?'on':''}" onclick="calShow.${k}=!calShow.${k};render()"><span class="cal-dot" style="background:${c}"></span>${l}</button>`).join('')}</div>`;
  // Atrasados: tareas tuyas vencidas y sin terminar -> pasarlas de día rápido
  const odTasks=(DB.tasks||[]).filter(t=>t&&(t.toIds||[]).includes(SES.userId)&&t.due&&dISO(new Date(t.due))<calToday()&&t.status!=='hecha'&&t.status!=='rechazada').sort((a,b)=>a.due-b.due);
  if(odTasks.length) html+=`<div class="cal-overdue">
    <div class="cal-od-h">${svgIcon('clock','icon icon-sm')} ${odTasks.length} ${odTasks.length===1?'pendiente atrasado':'pendientes atrasados'} — pasalos de día</div>
    ${odTasks.slice(0,6).map(t=>`<div class="cal-od-row"><span class="cal-od-t" onclick="calTaskModal('${t.id}')">${esc(t.title||'Tarea')}</span><span class="cal-od-d">venció ${esc(fmtDate(t.due))}</span><div class="cal-od-act"><button class="cal-od-b" onclick="calTaskMove('${t.id}','hoy')">Hoy</button><button class="cal-od-b" onclick="calTaskMove('${t.id}','manana')">Mañana</button></div></div>`).join('')}
    ${odTasks.length>6?`<div class="cal-od-more">y ${odTasks.length-6} más…</div>`:''}</div>`;
  html+= calView==='mes'?calMonthView():calView==='semana'?calWeekView():calView==='dia'?calDayView():calView==='agenda'?calAgendaView():calYearView();
  return html;
}
function calGo(dir){
  if(dir==='hoy'){ calCursor=calToday(); render(); return; }
  const n=dir==='next'?1:-1;
  if(calView==='dia') calCursor=calAddDays(calCursor,n);
  else if(calView==='semana') calCursor=calAddDays(calCursor,7*n);
  else if(calView==='agenda') calCursor=calAddDays(calCursor,7*n);
  else if(calView==='anio') calCursor=calAddMonths(calCursor,12*n);
  else calCursor=calAddMonths(calCursor,n);
  render();
}
function calChip(it, iso){
  const done = it.kind==='task' && it.done;
  const check = (it.kind==='task' && it.canDone)
    ? `<span class="cal-check ${done?'on':''}" title="${done?'Marcar por hacer':'Marcar hecha'}" onpointerdown="event.stopPropagation()" onclick="event.stopPropagation();boardMove('${it.id}','${done?'pendiente':'hecha'}')">${done?svgIcon('check','icon icon-sm'):''}</span>`
    : '';
  const h = it.draggable ? `onpointerdown="calDragStart(event,'${it.kind}','${it.id}','${iso||''}')" onclick="event.stopPropagation()"` : `onclick="event.stopPropagation();calItemClick('${it.kind}','${it.id}')"`;
  return `<div class="cal-chip cal-chip-${it.kind}${it.draggable?' cdraggable':''}${done?' done':''}" style="--c:${it.color}" ${h}>${check}<span class="cal-chip-body">${it.repeat?'🔁 ':''}${it.shared?'👥 ':''}${it.allDay?'':`<b>${esc(fmt12(it.start))}</b> `}${esc(it.title)}</span></div>`;
}
function calMonthView(){
  const first=calParse(calCursor); first.setDate(1);
  const gridStart=calWeekStart(dISO(first)); const today=calToday(); const curMonth=first.getMonth();
  let cells='';
  for(let i=0;i<42;i++){
    const iso=calAddDays(gridStart,i); const d=calParse(iso); const items=calDayItems(iso);
    const shown=items.slice(0,3), more=items.length-shown.length;
    cells+=`<div class="cal-cell${d.getMonth()!==curMonth?' other':''}${iso===today?' today':''}" data-iso="${iso}" onclick="calOpenDay('${iso}')">
      <div class="cal-cnum">${d.getDate()}</div>
      <div class="cal-cev">${shown.map(it=>calChip(it,iso)).join('')}${more>0?`<div class="cal-more">+${more} más</div>`:''}</div>
    </div>`;
  }
  return `<div class="cal-month"><div class="cal-dow">${CAL_DOW.map(x=>`<span>${x}</span>`).join('')}</div><div class="cal-grid">${cells}</div></div>`;
}
function calTimeGrid(days){
  const startH=6,endH=23,rowH=46; const hours=[]; for(let h=startH;h<=endH;h++) hours.push(h);
  const today=calToday(); const cols='58px repeat('+days.length+',minmax(0,1fr))';
  const head=days.map(iso=>{const d=calParse(iso);return `<div class="cal-tg-dh${iso===today?' today':''}"><span>${CAL_DOW[(d.getDay()+6)%7]}</span><b>${d.getDate()}</b></div>`;}).join('');
  const adcells=days.map(iso=>`<div class="cal-tg-ad">${calDayItems(iso).filter(it=>it.allDay).map(it=>calChip(it,iso)).join('')}</div>`).join('');
  const gut=`<div class="cal-tg-gut">${hours.map(h=>`<div class="cal-tg-hr" style="height:${rowH}px"><span>${fmt12(String(h).padStart(2,'0')+':00')}</span></div>`).join('')}</div>`;
  const dayCols=days.map(iso=>{
    const list=calDayItems(iso).filter(it=>!it.allDay&&it.start).map(it=>{ let s=calMin(it.start), e=it.end?calMin(it.end):s+45; if(e<=s)e=s+45; return Object.assign({}, it, {s,e}); });
    calPack(list);
    const evs=list.map(it=>{
      const top=(it.s-startH*60)/60*rowH, h=Math.max(20,(it.e-it.s)/60*rowH);
      const cols=it.cols||1, col=it.col||0, lf=col/cols*100, wd=100/cols;
      const handler=it.draggable?`onpointerdown="calDragStart(event,'${it.kind}','${it.id}','${iso}')" onclick="event.stopPropagation()"`:`onclick="event.stopPropagation();calItemClick('${it.kind}','${it.id}')"`;
      return `<button class="cal-ev${it.draggable?' cdraggable':''}${(it.kind==='task'&&it.done)?' done':''}" style="--c:${it.color};top:${top}px;height:${h}px;left:calc(${lf}% + 2px);width:calc(${wd}% - 4px);right:auto" ${handler}>${it.repeat?'🔁 ':''}${it.shared?'👥 ':''}<b>${esc(fmt12(it.start))}</b> ${esc(it.title)}</button>`;
    }).join('');
    return `<div class="cal-tg-col" data-iso="${iso}" data-starth="${startH}" data-rowh="${rowH}" style="height:${hours.length*rowH}px" onclick="calCreateAt('${iso}',event,${rowH},${startH})">${evs}</div>`;
  }).join('');
  return `<div class="cal-timegrid">
    <div class="cal-tg-headrow" style="grid-template-columns:${cols}"><div></div>${head}</div>
    <div class="cal-tg-adrow" style="grid-template-columns:${cols}"><div class="cal-tg-adl">Todo el día</div>${adcells}</div>
    <div class="cal-tg-scroll"><div class="cal-tg-board" style="grid-template-columns:${cols}">${gut}${dayCols}</div></div>
  </div>`;
}
function calDayView(){ return calTimeGrid([calCursor]); }
function calWeekView(){ const ws=calWeekStart(calCursor); return calTimeGrid([0,1,2,3,4,5,6].map(i=>calAddDays(ws,i))); }
function calYearView(){
  const year=calParse(calCursor).getFullYear(); const today=calToday();
  let html='<div class="cal-year">';
  for(let m=0;m<12;m++){
    const gridStart=calWeekStart(dISO(new Date(year,m,1)));
    let cells='';
    for(let i=0;i<42;i++){ const iso=calAddDays(gridStart,i); const d=calParse(iso); const other=d.getMonth()!==m; const has=!other&&calDayItems(iso).length>0;
      cells+=`<span class="cal-yc${other?' o':''}${iso===today?' t':''}${has?' h':''}">${d.getDate()}</span>`; }
    html+=`<button class="cal-ymonth" onclick="calView='mes';calCursor='${dISO(new Date(year,m,1))}';render()"><div class="cal-ymn">${cap1(CAL_MON[m])}</div><div class="cal-yhdr">${['L','M','X','J','V','S','D'].map(x=>`<span>${x}</span>`).join('')}</div><div class="cal-yg">${cells}</div></button>`;
  }
  return html+'</div>';
}
function calAgendaView(){
  const today=calToday(); let html='<div class="cal-agenda">'; let any=false;
  for(let i=0;i<35;i++){
    const iso=calAddDays(calCursor,i); const items=calDayItems(iso); if(!items.length) continue; any=true;
    const d=calParse(iso);
    html+=`<div class="cal-ag-day${iso===today?' today':''}">
      <div class="cal-ag-date"><b>${d.getDate()}</b><span>${CAL_DOW[(d.getDay()+6)%7]}<br>${CAL_MON[d.getMonth()].slice(0,3)}</span></div>
      <div class="cal-ag-items">${items.map(it=>{const done=it.kind==='task'&&it.done; const check=(it.kind==='task'&&it.canDone)?`<span class="cal-check ${done?'on':''}" title="${done?'Marcar por hacer':'Marcar hecha'}" onclick="event.stopPropagation();boardMove('${it.id}','${done?'pendiente':'hecha'}')">${done?svgIcon('check','icon icon-sm'):''}</span>`:''; return `<div class="cal-ag-row ${done?'done':''}" style="--c:${it.color}">${check}<button class="cal-ag-body" onclick="calItemClick('${it.kind}','${it.id}')"><span class="cal-ag-time">${it.allDay?'Todo el día':fmt12(it.start)+(it.end?' – '+fmt12(it.end):'')}</span><span class="cal-ag-t">${it.repeat?'🔁 ':''}${it.shared?'👥 ':''}${esc(it.title)}</span></button></div>`;}).join('')}</div>
    </div>`;
  }
  if(!any) html+=emptyState('','Nada agendado','No hay eventos, turnos ni tareas en los próximos días. Tocá "Crear" para agregar algo.');
  return html+'</div>';
}
function calCreate(iso, time){ _calEdit=null; calForm({date:iso||calToday(), start:time||'', end:time?calMinToHHMM(calMin(time)+60):'', allDay:!time, title:'', color:CAL_COLORS[0], note:''}); }
function calOpenDay(iso){ calView='dia'; calCursor=iso||calToday(); render(); }   // tocar un día en Mes -> ver el día
window.calOpenDay=calOpenDay;
function calMinToHHMM(m){ m=Math.max(0,Math.min(1439,m)); return String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0'); }
function calCreateAt(iso,ev,rowH,startH){
  if(ev.target.closest('.cal-ev')) return;
  let y=0; try{ const r=ev.currentTarget.getBoundingClientRect(); y=ev.clientY-r.top; }catch(_){}
  const mins=startH*60+Math.max(0,Math.round(y/rowH*60/30)*30);
  calCreate(iso, calMinToHHMM(mins));
}
function calEditEvent(id){ const e=(DB.calEvents||[]).find(x=>x.id===id); if(!e) return; if(!calEventCanEdit(e)) return calEventView(e); _calEdit=id; calForm(e); }
function calEventView(e){
  const by=userById(calEvBy(e));
  openModal(`<div class="modal-head"><h3>${svgIcon('calendar','icon')} Evento</h3><button class="modal-close" onclick="closeModal()">${svgIcon('x','icon')}</button></div>
    <div class="modal-body">
      <div style="font-weight:700;font-size:16px;margin-bottom:5px">${esc(e.title||'')}</div>
      <div class="page-sub" style="margin:0 0 8px">${esc(fmtDate(calParse(e.date).getTime()))}${e.allDay?' · Todo el día':' · '+fmt12(e.start)+(e.end?' – '+fmt12(e.end):'')}${(e.repeat&&e.repeat!=='no')?' · se repite':''}</div>
      ${e.note?`<div style="font-size:14px;white-space:pre-wrap;color:var(--text-soft)">${esc(e.note)}</div>`:''}
      <div class="page-sub" style="margin-top:12px">Lo agendó: <b>${by?esc(by.name):'—'}</b></div>
    </div>`);
}
function calItemClick(kind,id){
  if(kind==='event') return calEditEvent(id);
  if(kind==='task') return calTaskModal(id);
  if(kind==='reserva') return reservDetail(id);
  if(kind==='shift'){ SES.view='horarios'; render(); return; }
}
function calCanMoveTask(t){ return t && (t.fromId===SES.userId || isAdmin() || (t.toIds||[]).includes(SES.userId)); }
function calSetTaskDue(t, baseDate){
  const od=new Date(t.due); if(od.getHours()||od.getMinutes()) baseDate.setHours(od.getHours(),od.getMinutes(),0,0); else baseDate.setHours(12,0,0,0);
  t.due=baseDate.getTime(); if(t.status==='atrasada') t.status='pendiente'; t.updatedAt=now();
}
function calTaskMove(taskId, when){
  const t=(DB.tasks||[]).find(x=>x&&x.id===taskId); if(!t) return;
  if(!calCanMoveTask(t)){ toast('No podés mover esta tarea','err'); return; }
  const base=new Date(); base.setHours(12,0,0,0); if(when==='manana') base.setDate(base.getDate()+1);
  calSetTaskDue(t, base);
  audit('tarea',`reprogramó "${t.title}" a ${when==='manana'?'mañana':'hoy'}`,t.sucursalId);
  toast('Tarea movida ✓','ok'); save(); render();
}
function calTaskModal(id){
  const t=(DB.tasks||[]).find(x=>x&&x.id===id); if(!t) return;
  const canMove=calCanMoveTask(t);
  openModal(`<div class="modal-head"><h3>${svgIcon('check','icon')} Tarea</h3><button class="modal-close" onclick="closeModal()">${svgIcon('x','icon')}</button></div>
    <div class="modal-body">
      <div style="font-weight:700;font-size:16px;margin-bottom:3px">${esc(t.title||'Tarea')}</div>
      <div class="page-sub" style="margin:0 0 14px">Vence: ${esc(fmtDateTime(t.due))}</div>
      ${canMove?`<div class="field"><label>Mover a otro día</label><input class="input" type="date" id="ctMove" value="${esc(dISO(new Date(t.due)))}"></div>`:'<div class="page-sub">No tenés permiso para moverla.</div>'}
    </div>
    <div class="modal-foot">${canMove?`<button class="btn ${t.status==='hecha'?'btn-ghost':'btn-primary'}" style="flex:1" onclick="closeModal();boardMove('${id}','${t.status==='hecha'?'pendiente':'hecha'}')">${svgIcon('check','icon icon-sm')} ${t.status==='hecha'?'Marcar por hacer':'Marcar hecha'}</button>`:''}<button class="btn btn-ghost" onclick="closeModal();SES.view='tareas';render();setTimeout(()=>{try{taskDetail('${id}')}catch(_){}}, 60)">Ver</button>${canMove?`<button class="btn btn-ghost" onclick="calTaskSaveMove('${id}')">Mover</button>`:''}</div>`);
}
function calTaskSaveMove(id){
  const t=(DB.tasks||[]).find(x=>x&&x.id===id); if(!t||!calCanMoveTask(t)) return;
  const v=$('#ctMove')&&$('#ctMove').value; if(!v) return;
  calSetTaskDue(t, calParse(v));
  audit('tarea',`movió "${t.title}" al ${v}`,t.sucursalId);
  closeModal(); toast('Tarea movida ✓','ok'); save(); render();
}
window.calTaskMove=calTaskMove; window.calTaskModal=calTaskModal; window.calTaskSaveMove=calTaskSaveMove;
function calForm(e){
  _calColor=e.color||CAL_COLORS[0];
  const colors=CAL_COLORS.map(c=>`<button type="button" class="cal-colsw ${_calColor===c?'on':''}" style="background:${c}" data-c="${c}" onclick="calPickColor('${c}')"></button>`).join('');
  const reps=[['no','No se repite'],['diario','Cada día'],['semanal','Cada semana'],['quincenal','Cada 2 semanas'],['mensual','Cada mes']];
  const rems=[['no','Sin aviso'],['at','A la hora'],['10','10 min antes'],['30','30 min antes'],['60','1 hora antes'],['1440','1 día antes']];
  const aud=e.audience||'me'; const canAll=canShiftManage();
  const auds=[['me','Solo yo'],['sel','Personas específicas']].concat(canAll?[['all','Todo el equipo']]:[]);
  const baseWd=(calParse(e.date||calToday()).getDay()+6)%7;
  const curDays=(e.repeatDays&&e.repeatDays.length)?e.repeatDays:[baseWd];
  const showDays=(e.repeat==='semanal'||e.repeat==='quincenal');
  const daysSel=`<div class="field" id="ceDaysW" style="${showDays?'':'display:none'}"><label>¿Qué días se repite?</label>
    <div class="cal-wdrow">${['L','M','X','J','V','S','D'].map((n,i)=>`<button type="button" class="cal-wd ${curDays.includes(i)?'on':''}" data-d="${i}" onclick="this.classList.toggle('on')">${n}</button>`).join('')}</div>
    <div class="cal-wdpresets"><button type="button" class="cal-wdpreset" onclick="calSetDays([0,1,2,3,4])">Lun a Vie</button><button type="button" class="cal-wdpreset" onclick="calSetDays([0,1,2,3,4,5,6])">Toda la semana</button></div></div>`;
  openModal(`<div class="modal-head"><h3>${svgIcon('calendar','icon')} ${_calEdit?'Editar':'Nuevo'} evento</h3><button class="modal-close" onclick="closeModal()">${svgIcon('x','icon')}</button></div>
    <div class="modal-body">
      <div class="field"><label>Título</label><input class="input" id="ceTitle" value="${esc(e.title||'')}" placeholder="Ej: Reunión con proveedor" autocomplete="off"></div>
      <div class="row2">
        <div class="field"><label>Fecha</label><input class="input" type="date" id="ceDate" value="${esc(e.date||calToday())}"></div>
        <div class="field"><label>&nbsp;</label><label class="cal-allday"><input type="checkbox" id="ceAllday" ${e.allDay?'checked':''} onchange="document.getElementById('ceTimes').style.display=this.checked?'none':'grid'"> Todo el día</label></div>
      </div>
      <div class="row2" id="ceTimes" style="${e.allDay?'display:none':'display:grid'}">
        <div class="field"><label>Desde</label><input class="input" type="time" id="ceStart" value="${esc(e.start||'09:00')}"></div>
        <div class="field"><label>Hasta</label><input class="input" type="time" id="ceEnd" value="${esc(e.end||'10:00')}"></div>
      </div>
      <div class="row2">
        <div class="field"><label>Repetir</label><select class="select" id="ceRepeat" onchange="calRepeatChange(this.value)">${reps.map(([v,l])=>`<option value="${v}" ${(e.repeat||'no')===v?'selected':''}>${l}</option>`).join('')}</select></div>
        <div class="field"><label>${svgIcon('clock','icon icon-sm')} Recordatorio</label><select class="select" id="ceRemind">${rems.map(([v,l])=>`<option value="${v}" ${(e.remind||'no')===v?'selected':''}>${l}</option>`).join('')}</select></div>
      </div>
      ${daysSel}
      <div class="field" id="ceUntilW" style="${(e.repeat&&e.repeat!=='no')?'':'display:none'}"><label>Repetir hasta (opcional)</label><input class="input" type="date" id="ceUntil" value="${esc(e.repeatUntil||'')}"></div>
      <div class="field"><label>¿Para quién?</label><select class="select" id="ceAud" onchange="document.getElementById('ceMembersW').style.display=this.value==='sel'?'':'none'">${auds.map(([v,l])=>`<option value="${v}" ${aud===v?'selected':''}>${l}</option>`).join('')}</select></div>
      <div class="field" id="ceMembersW" style="${aud==='sel'?'':'display:none'}"><label>Elegí las personas</label>${peoplePicker('ceMembers', scopedPeople(false), e.members||[])}</div>
      <div class="field"><label>Color</label><div class="cal-colors">${colors}</div></div>
      <div class="field"><label>Nota (opcional)</label><textarea class="textarea" id="ceNote" placeholder="Detalle…">${esc(e.note||'')}</textarea></div>
    </div>
    <div class="modal-foot">${_calEdit?`<button class="btn btn-danger" style="margin-right:auto" onclick="calDelEvent()">Eliminar</button>`:''}<button class="btn btn-ghost" onclick="closeModal()">Cancelar</button><button class="btn btn-primary" onclick="calSaveEvent()">Guardar</button></div>`, true);
}
function calPickColor(c){ _calColor=c; document.querySelectorAll('.cal-colsw').forEach(b=>b.classList.toggle('on', b.dataset.c===c)); }
function calRepeatChange(v){ const u=document.getElementById('ceUntilW'); if(u) u.style.display=(v==='no')?'none':''; const d=document.getElementById('ceDaysW'); if(d) d.style.display=(v==='semanal'||v==='quincenal')?'':'none'; }
function calSetDays(arr){ document.querySelectorAll('#ceDaysW .cal-wd').forEach(b=>b.classList.toggle('on', arr.includes(+b.dataset.d))); }
window.calRepeatChange=calRepeatChange; window.calSetDays=calSetDays;
function calSaveEvent(){
  const title=$('#ceTitle').value.trim(); if(!title){ toast('Ponele un título','err'); return; }
  const date=$('#ceDate').value; if(!date){ toast('Elegí una fecha','err'); return; }
  const allDay=$('#ceAllday').checked;
  let start=allDay?'':$('#ceStart').value, end=allDay?'':$('#ceEnd').value;
  if(!allDay && start && end && calMin(end)<=calMin(start)) end=calMinToHHMM(calMin(start)+60);
  const repeat=$('#ceRepeat')?$('#ceRepeat').value:'no';
  const repeatUntil=(repeat!=='no'&&$('#ceUntil'))?$('#ceUntil').value:'';
  let repeatDays=[];
  if(repeat==='semanal'||repeat==='quincenal'){ repeatDays=[...document.querySelectorAll('#ceDaysW .cal-wd.on')].map(b=>+b.dataset.d); if(!repeatDays.length) repeatDays=[(calParse(date).getDay()+6)%7]; }
  const remind=$('#ceRemind')?$('#ceRemind').value:'no';
  let audience=$('#ceAud')?$('#ceAud').value:'me', members=[];
  if(audience==='sel'){ members=pickedIds('ceMembers'); if(!members.length){ toast('Elegí al menos una persona (o cambiá "¿Para quién?")','err'); return; } }
  const note=$('#ceNote').value.trim(), color=_calColor||CAL_COLORS[0];
  const sucursalId = me()?me().sucursalId:'all';
  DB.calEvents=DB.calEvents||[];
  if(_calEdit){ const ev=DB.calEvents.find(x=>x.id===_calEdit); if(ev) Object.assign(ev,{title,date,allDay,start,end,repeat,repeatUntil,repeatDays,remind,audience,members,sucursalId,note,color,updatedAt:now()}); }
  else DB.calEvents.push({id:uid(),byId:SES.userId,title,date,allDay,start,end,repeat,repeatUntil,repeatDays,remind,audience,members,sucursalId,note,color,at:now(),updatedAt:now()});
  if(audience&&audience!=='me'){ const targets = audience==='all'? scopedPeople(true).map(u=>u.id) : members.filter(id=>id!==SES.userId); if(targets.length) notify(targets, `${me().name.split(' ')[0]} te agendó: ${title}`, 'calendar', {view:'calendario'}); }
  audit('calendario',`${_calEdit?'editó':'agregó'} un evento: ${title}`);
  closeModal(); toast('Guardado ✓','ok'); render();
}
function calDelEvent(){
  if(!_calEdit) return; const ev=(DB.calEvents||[]).find(x=>x.id===_calEdit);
  delEntity('calEvents', _calEdit); _calEdit=null;
  closeModal(); audit('calendario','eliminó un evento'); save(); render();
  if(ev) undoDelete('calEvents', ev, 'Evento');
}
/* arrastrar para mover (mes: cambia día · día/semana: cambia día y hora) */
let _calDrag=null;
function calDragStart(ev, kind, id, fromIso){
  ev.preventDefault(); ev.stopPropagation();
  _calDrag={kind,id,fromIso,moved:false,sx:ev.clientX,sy:ev.clientY};
  document.addEventListener('pointermove',calDragMove); document.addEventListener('pointerup',calDragEnd);
}
function calDragMove(e){
  if(!_calDrag) return;
  if(!_calDrag.moved){ if(Math.abs(e.clientX-_calDrag.sx)+Math.abs(e.clientY-_calDrag.sy)<6) return; _calDrag.moved=true; }
  let g=document.getElementById('calGhost'); if(!g){ g=document.createElement('div'); g.id='calGhost'; g.className='cal-ghost'; g.textContent='Soltá en otro día/hora'; document.body.appendChild(g); }
  g.style.left=(e.clientX+12)+'px'; g.style.top=(e.clientY+12)+'px';
  document.querySelectorAll('.cal-cell.cdrop,.cal-tg-col.cdrop').forEach(x=>x.classList.remove('cdrop'));
  const el=document.elementFromPoint(e.clientX,e.clientY), cell=el&&el.closest('.cal-cell,.cal-tg-col'); if(cell) cell.classList.add('cdrop');
}
function calDragEnd(e){
  document.removeEventListener('pointermove',calDragMove); document.removeEventListener('pointerup',calDragEnd);
  const g=document.getElementById('calGhost'); if(g) g.remove();
  document.querySelectorAll('.cal-cell.cdrop,.cal-tg-col.cdrop').forEach(x=>x.classList.remove('cdrop'));
  const dd=_calDrag; _calDrag=null; if(!dd) return;
  if(!dd.moved){ calItemClick(dd.kind, dd.id); return; }   // no se movió = toque normal
  const el=document.elementFromPoint(e.clientX,e.clientY); const cell=el&&el.closest('[data-iso]'); if(!cell) return;
  const iso=cell.getAttribute('data-iso'); let time=null;
  if(cell.classList.contains('cal-tg-col')){ const r=cell.getBoundingClientRect(); const sh=+cell.getAttribute('data-starth')||6; const rh=+cell.getAttribute('data-rowh')||46; const mins=sh*60+Math.max(0,Math.round((e.clientY-r.top)/rh*60/15)*15); time=calMinToHHMM(mins); }
  calMoveItem(dd.kind, dd.id, iso, time);
}
function calMoveItem(kind,id,iso,time){
  if(kind==='event'){ const ev=(DB.calEvents||[]).find(x=>x.id===id); if(!ev||!calEventCanEdit(ev)){ toast('No podés mover este evento','err'); return; }
    if(ev.date===iso && !time){ return; }
    ev.date=iso; if(time && !ev.allDay){ const dur=(ev.start&&ev.end)?calMin(ev.end)-calMin(ev.start):60; ev.start=time; ev.end=calMinToHHMM(calMin(time)+Math.max(15,dur)); }
    ev.updatedAt=now(); audit('calendario',`movió "${ev.title}"`); toast('Evento movido ✓','ok'); save(); render(); return;
  }
  if(kind==='task'){ const t=(DB.tasks||[]).find(x=>x.id===id); if(!t||!calCanMoveTask(t)) return;
    const nd=calParse(iso);
    if(time){ const a=time.split(':').map(Number); nd.setHours(a[0],a[1]||0,0,0); }
    else { const od=new Date(t.due); if(od.getHours()||od.getMinutes()) nd.setHours(od.getHours(),od.getMinutes(),0,0); else nd.setHours(12,0,0,0); }
    t.due=nd.getTime(); if(t.status==='atrasada') t.status='pendiente'; t.updatedAt=now();
    audit('tarea',`movió "${t.title}"`,t.sucursalId); toast('Tarea movida ✓','ok'); save(); render(); return;
  }
  if(kind==='reserva'){ const r=(DB.reservations||[]).find(x=>x.id===id); if(!r||!canReservEdit()){ toast('No podés mover esta reserva','err'); return; }
    if(r.resDate===iso && (!time || time===r.resTime)) return;
    r.resDate=iso; if(time) r.resTime=time; r.updatedAt=now();
    audit('reserva',`movió la reserva de ${r.clientName}`,r.sucursalId); toast('Reserva movida ✓','ok'); save(); render(); return;
  }
}
/* recordatorios de eventos -> notificación (popup + sonido), una sola vez */
function checkCalReminders(){
  if(!me() || !Array.isArray(DB.calEvents)) return;
  DB._calNotif=DB._calNotif||{}; let ch=false; const t0=Date.now();
  const days=[calToday(), calAddDays(calToday(),1)];
  DB.calEvents.forEach(e=>{
    if(!e || !calEventVisible(e) || !e.remind || e.remind==='no') return;
    const off=e.remind==='at'?0:(parseInt(e.remind)||0);
    days.forEach(iso=>{
      if(!calEventOccurs(e,iso)) return;
      const st=e.allDay?'09:00':(e.start||'09:00'); const a=st.split(':').map(Number);
      const dt=calParse(iso); dt.setHours(a[0]||0,a[1]||0,0,0);
      const remindAt=dt.getTime()-off*60000; const key=SES.userId+'|'+e.id+'|'+iso;
      if(DB._calNotif[key]) return;
      if(t0>=remindAt && t0 < dt.getTime()+3600000){
        DB.notifs.unshift({id:uid(),userId:SES.userId,text:`Recordatorio: ${e.title} (${e.allDay?'hoy':fmt12(st)})`,ico:'clock',link:{view:'calendario'},at:now(),read:false});
        DB._calNotif[key]=1; ch=true;
      }
    });
  });
  if(ch) save();
}
window.calGo=calGo; window.calCreate=calCreate; window.calCreateAt=calCreateAt; window.calItemClick=calItemClick;
window.calEditEvent=calEditEvent; window.calForm=calForm; window.calPickColor=calPickColor; window.calSaveEvent=calSaveEvent; window.calDelEvent=calDelEvent;
window.calDragStart=calDragStart;

/* =====================================================================
   VISTA: REPORTES (Gerencia / Contabilidad)
   ===================================================================== */
let repMonth='';
let repRange={mode:'mes', anchor:Date.now(), from:'', to:''};   // día | semana | mes | rango (de-a)
let repPerson='todos';
const REP_COLORS=['#5b8def','#5aa777','#d9534f','#d59b4a','#8b5cf6','#c879a9','#0ea5b7','#64748b','#e0b341','#db2777'];
function weekStartMon(d){ const s=new Date(d); s.setHours(0,0,0,0); const dow=(s.getDay()+6)%7; s.setDate(s.getDate()-dow); return s; }
function repFmtD(d){ return new Date(d).toLocaleDateString('es-CR',{day:'2-digit',month:'short'}); }
function repBounds(){
  const a=new Date(repRange.anchor||Date.now());
  if(repRange.mode==='dia'){ const s=new Date(a); s.setHours(0,0,0,0); const e=new Date(s); e.setDate(e.getDate()+1);
    return {start:s.getTime(), end:e.getTime(), label:s.toLocaleDateString('es-CR',{weekday:'long',day:'2-digit',month:'long'})}; }
  if(repRange.mode==='semana'){ const s=weekStartMon(a); const e=new Date(s); e.setDate(e.getDate()+7);
    return {start:s.getTime(), end:e.getTime(), label:'Semana · '+repFmtD(s)+' al '+repFmtD(new Date(e.getTime()-1))}; }
  if(repRange.mode==='rango' && repRange.from && repRange.to){ const s=new Date(repRange.from+'T00:00:00'); const e=new Date(repRange.to+'T00:00:00'); e.setDate(e.getDate()+1);
    if(e.getTime()<=s.getTime()) return {start:s.getTime(), end:s.getTime()+864e5, label:repFmtD(s)};
    return {start:s.getTime(), end:e.getTime(), label:repFmtD(s)+' al '+repFmtD(new Date(e.getTime()-1))}; }
  const s=new Date(a.getFullYear(),a.getMonth(),1), e=new Date(a.getFullYear(),a.getMonth()+1,1);
  return {start:s.getTime(), end:e.getTime(), label:s.toLocaleDateString('es-CR',{month:'long',year:'numeric'})};
}
function repNav(dir){ const a=new Date(repRange.anchor||Date.now());
  if(repRange.mode==='dia') a.setDate(a.getDate()+dir); else if(repRange.mode==='semana') a.setDate(a.getDate()+7*dir); else a.setMonth(a.getMonth()+dir);
  repRange.anchor=a.getTime(); render(); }
function repSetMode(m){ repRange.mode=m; if(m==='rango' && (!repRange.from||!repRange.to)){ const b=repBounds(); repRange.from=new Date(b.start).toISOString().slice(0,10); repRange.to=new Date(b.end-864e5).toISOString().slice(0,10); } render(); }
function repSetFrom(v){ repRange.from=v; repRange.mode='rango'; render(); }
function repSetTo(v){ repRange.to=v; repRange.mode='rango'; render(); }
function repSetPerson(v){ repPerson=v; render(); }
window.repNav=repNav; window.repSetMode=repSetMode; window.repSetFrom=repSetFrom; window.repSetTo=repSetTo; window.repSetPerson=repSetPerson;
function svgDonut(segs,opts){
  opts=opts||{}; const size=opts.size||148, sw=opts.stroke||22, cx=size/2, r=(size-sw)/2, c=2*Math.PI*r;
  const total=segs.reduce((s,x)=>s+(+x.value||0),0); let off=0;
  const arcs= total>0 ? segs.filter(s=>(+s.value)>0).map(s=>{ const len=(+s.value)/total*c; const el=`<circle cx="${cx}" cy="${cx}" r="${r}" fill="none" stroke="${s.color}" stroke-width="${sw}" stroke-dasharray="${len.toFixed(2)} ${(c-len).toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}" transform="rotate(-90 ${cx} ${cx})"/>`; off+=len; return el; }).join('')
    : `<circle cx="${cx}" cy="${cx}" r="${r}" fill="none" stroke="var(--bg-soft)" stroke-width="${sw}"/>`;
  return `<div class="donut-wrap" style="width:${size}px;height:${size}px"><svg class="donut" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">${arcs}</svg>${opts.center!=null?`<div class="donut-center">${opts.center}</div>`:''}</div>`;
}
function donutLegend(segs){ const total=segs.reduce((s,x)=>s+(+x.value||0),0)||1;
  return `<div class="donut-legend">${segs.map(s=>`<div class="dleg"><span class="dleg-dot" style="background:${s.color}"></span><span class="dleg-l">${esc(s.label)}</span><span class="dleg-v">${s.fmt||s.value} · ${Math.round((+s.value||0)/total*100)}%</span></div>`).join('')}</div>`;
}
function donutCard(title,icon,segs,centerHtml){
  const total=segs.reduce((s,x)=>s+(+x.value||0),0);
  return `<div class="chartcard"><div class="chart-title">${svgIcon(icon,'icon icon-sm')} ${esc(title)}</div>
    ${total>0?`<div class="donut-row">${svgDonut(segs,{center:centerHtml!=null?centerHtml:`<div class="donut-c-n">${total}</div><div class="donut-c-l">total</div>`})}${donutLegend(segs)}</div>`:'<div class="chart-empty">Sin datos en este período.</div>'}</div>`;
}
function ymOf(ts){ const d=new Date(ts); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0'); }
function monthRange(ym){ const [y,m]=ym.split('-').map(Number); return {start:new Date(y,m-1,1).getTime(), end:new Date(y,m,1).getTime(), days:new Date(y,m,0).getDate(), y, m}; }
function inMonth(ts,ym){ if(!ts) return false; const r=monthRange(ym); return ts>=r.start && ts<r.end; }
function monthLabel(ym){ const [y,m]=ym.split('-').map(Number); return new Date(y,m-1,1).toLocaleDateString('es-CR',{month:'long',year:'numeric'}); }
function repShift(d){ const [y,m]=repMonth.split('-').map(Number); const dt=new Date(y,m-1+d,1); repMonth=dt.getFullYear()+'-'+String(dt.getMonth()+1).padStart(2,'0'); render(); }
window.repShift=repShift;
function repVBars(items){
  const max=Math.max(1,...items.map(i=>+i.value||0));
  return `<div class="chart-bars">`+items.map(i=>`<div class="cbar" title="${esc(i.title!=null?String(i.title):String(i.value))}"><div class="cbar-val">${i.show!=null?esc(String(i.show)):''}</div><div class="cbar-track"><div class="cbar-fill" style="height:${Math.round((+i.value||0)/max*100)}%"></div></div><div class="cbar-lbl">${esc(String(i.lbl||''))}</div></div>`).join('')+`</div>`;
}
function reportData(start,end){
  const inR=ts=>ts!=null&&ts>=start&&ts<end;
  const dInR=ds=>{ if(!ds) return false; const t=new Date(ds+'T00:00:00').getTime(); return t>=start&&t<end; };
  const tasks=(DB.tasks||[]).filter(t=>t&&inScope(t.sucursalId));
  const peds=(DB.pedidos||[]).filter(p=>p&&inScope(p.sucursalId));
  const sales=(DB.souvSales||[]).filter(v=>v&&inScope(v.sucursalId)&&inR(v.at));
  const inv=invInScope();
  const tMonth=tasks.filter(t=>inR(t.createdAt));
  const st=s=>tMonth.filter(t=>t.status===s).length;
  const done=st('hecha'),late=st('atrasada'),rej=st('rechazada'),proc=st('proceso'),pend=st('pendiente');
  const compl=tMonth.length?Math.round(done/tMonth.length*100):0;
  const pMonth=peds.filter(p=>inR(p.createdAt));
  const pDeliv=pMonth.filter(p=>p.status==='entregado').length;
  const areas={proveeduria:0,contabilidad:0,rrhh:0}; pMonth.forEach(p=>{ if(areas[p.area]!==undefined) areas[p.area]++; });
  const ingresos=sales.reduce((s,v)=>s+(+v.price||0)*(+v.qty||0),0);
  const ganancia=sales.reduce((s,v)=>s+((+v.price||0)-(+v.cost||0))*(+v.qty||0),0);
  const unidades=sales.reduce((s,v)=>s+(+v.qty||0),0);
  const invVal=inv.reduce((s,p)=>s+p.stock*p.cost,0);
  const invLow=inv.filter(lowStock).length;
  const shifts=(DB.shifts||[]).filter(s=>s&&inScope(s.sucursalId)&&!s.off&&dInR(s.date));
  const att=(DB.attendance||[]).filter(a=>a&&inScope(a.sucursalId)&&dInR(a.date)&&attLiveSessions(a).length);
  const auditRange=(DB.audit||[]).filter(a=>a&&inScope(a.sucursalId)&&inR(a.at));
  const prod=DB.users.filter(u=>u.active).map(u=>{
    const mine=tMonth.filter(t=>(t.toIds||[]).includes(u.id));
    const h=mine.filter(t=>t.status==='hecha').length, a=mine.filter(t=>t.status==='atrasada').length, rj=mine.filter(t=>t.status==='rechazada').length;
    const pr=mine.filter(t=>t.status==='proceso').length, pe=mine.filter(t=>t.status==='pendiente').length;
    const dias=shifts.filter(s=>s.userId===u.id).length;
    const myAtt=att.filter(x=>x.userId===u.id);
    const presente=myAtt.length;
    const horas=Math.round(myAtt.reduce((s,x)=>s+attWorkedMin(x),0)/60*10)/10;
    const acts=auditRange.filter(x=>x.byId===u.id).length;
    const pct=mine.length?Math.round(h/mine.length*100):0;
    return {u,total:mine.length,h,a,rj,pr,pe,dias,presente,horas,acts,pct};
  }).filter(x=>x.total>0||x.dias>0||x.presente>0||x.acts>0).sort((a,b)=>b.pct-a.pct||b.h-a.h||b.presente-a.presente);
  const days=Math.max(1,Math.round((end-start)/864e5));
  const salesDay=[]; for(let i=0;i<days;i++){ const ds=start+i*864e5, de=ds+864e5; const v=sales.filter(s=>s.at>=ds&&s.at<de).reduce((a,b)=>a+(+b.price||0)*(+b.qty||0),0); salesDay.push({ts:ds,value:v}); }
  const catVal={}; inv.forEach(p=>{ const c=p.category||'Sin familia'; catVal[c]=(catVal[c]||0)+p.stock*p.cost; });
  return {start,end,days,tasks,tMonth,done,late,rej,proc,pend,compl,peds,pMonth,pDeliv,areas,sales,ingresos,ganancia,unidades,inv,invVal,invLow,shifts,att,auditRange,prod,salesDay,catVal};
}
function viewReportes(){
  const B=repBounds(); const d=reportData(B.start,B.end);
  const person = repPerson!=='todos' ? userById(repPerson) : null;
  let html=`<div class="page-head"><div><div class="page-title">Reportes</div><div class="page-sub">${esc(sucName(visibleSuc()))}</div></div>
    <div class="ph-spacer"></div>
    <button class="btn btn-ghost" style="flex:0 0 auto" onclick="exportReportCSV()">${svgIcon('down','icon icon-sm')} CSV</button>
    <button class="btn btn-primary" style="flex:0 0 auto" onclick="generateMonthlyReport()">${svgIcon('save','icon icon-sm')} Generar PDF</button></div>`;
  // ---- controles: período + persona ----
  html+=`<div class="rep-controls">
    <div class="seg rep-modeseg">
      ${[['dia','Día'],['semana','Semana'],['mes','Mes'],['rango','Rango']].map(([m,l])=>`<button type="button" class="seg-b ${repRange.mode===m?'on':''}" onclick="repSetMode('${m}')">${l}</button>`).join('')}
    </div>
    ${repRange.mode!=='rango'
      ? `<div class="rep-nav"><button class="icon-btn" style="width:34px;height:34px" onclick="repNav(-1)" title="Anterior">${svgIcon('back','icon icon-sm')}</button><b class="rep-lbl">${esc(cap(B.label))}</b><button class="icon-btn" style="width:34px;height:34px" onclick="repNav(1)" title="Siguiente"><svg class="icon icon-sm" viewBox="0 0 24 24" style="transform:scaleX(-1)"><use href="#i-back"/></svg></button></div>`
      : `<div class="rep-range"><label>Desde</label><input type="date" class="input" value="${repRange.from||''}" onchange="repSetFrom(this.value)"><label>Hasta</label><input type="date" class="input" value="${repRange.to||''}" onchange="repSetTo(this.value)"></div>`}
    <div class="rep-person">${svgIcon('user','icon icon-sm')}
      <select class="select" onchange="repSetPerson(this.value)">
        <option value="todos">Todo el equipo</option>
        ${DB.users.filter(u=>u.active).slice().sort((a,b)=>a.name.localeCompare(b.name)).map(u=>`<option value="${u.id}" ${repPerson===u.id?'selected':''}>${esc(u.name)}</option>`).join('')}
      </select>
    </div>
  </div>`;
  html += person ? repPersonView(person,d,B) : repTeamView(d,B);
  return html;
}
function repTeamView(d,B){
  let html=`<div class="kpi-row">
    <div class="kpi ${d.compl>=70?'good':d.compl>=40?'warn':'alert'}"><div class="label">Cumplimiento</div><div class="value">${d.compl}%</div><div class="sub">${d.done}/${d.tMonth.length} tareas hechas</div></div>
    <div class="kpi ${d.late?'alert':'good'}"><div class="label">Atrasadas</div><div class="value">${d.late}</div><div class="sub">${d.rej} rechazadas</div></div>
    <div class="kpi"><div class="label">Pedidos</div><div class="value">${d.pMonth.length}</div><div class="sub">${d.pDeliv} entregados</div></div>
    <div class="kpi ok"><div class="label">Ventas souvenirs</div><div class="value" style="font-size:20px">${money(d.ingresos)}</div><div class="sub">ganancia ${money(d.ganancia)}</div></div>
  </div>`;
  const taskSegs=[{label:'Hechas',value:d.done,color:'#5aa777'},{label:'En proceso',value:d.proc,color:'#5b8def'},{label:'Pendientes',value:d.pend,color:'#94a3b8'},{label:'Atrasadas',value:d.late,color:'#d59b4a'},{label:'Rechazadas',value:d.rej,color:'#d9534f'}];
  const areaSegs=[{label:'Proveeduría',value:d.areas.proveeduria,color:REP_COLORS[0]},{label:'Contabilidad',value:d.areas.contabilidad,color:REP_COLORS[1]},{label:'Recursos Humanos',value:d.areas.rrhh,color:REP_COLORS[4]}];
  const catE=Object.entries(d.catVal).sort((a,b)=>b[1]-a[1]); const topC=catE.slice(0,6); const otherV=catE.slice(6).reduce((s,e)=>s+e[1],0);
  const catSegs=topC.map((e,i)=>({label:e[0],value:Math.round(e[1]),color:REP_COLORS[i%REP_COLORS.length],fmt:money(e[1])})); if(otherV>0) catSegs.push({label:'Otros',value:Math.round(otherV),color:'#64748b',fmt:money(otherV)});
  html+=`<div class="chart-grid">
    ${donutCard('Estado de tareas','check',taskSegs,`<div class="donut-c-n">${d.compl}%</div><div class="donut-c-l">cumplido</div>`)}
    ${donutCard('Pedidos por área','box',areaSegs)}
  </div>`;
  html+=`<div class="chart-grid">
    ${donutCard('Valor de inventario','chart',catSegs,`<div class="donut-c-n" style="font-size:15px">${money(d.invVal)}</div><div class="donut-c-l">en bodega</div>`)}
    <div class="chartcard"><div class="chart-title">${svgIcon('trend','icon icon-sm')} Ventas de souvenirs por día</div>
      ${d.sales.length?repVBars(d.salesDay.map(x=>({lbl:repDayLbl(x.ts,d.days),value:x.value,title:repFmtD(x.ts)+': '+money(x.value)}))):'<div class="chart-empty">Sin ventas en este período.</div>'}</div>
  </div>`;
  html+=`<div class="card"><div class="rep-tbl-title">${svgIcon('users','icon icon-sm')} Cumplimiento y asistencia por persona <span style="font-weight:400;color:var(--text-soft);font-size:12px">· tocá una fila para ver el detalle</span></div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Persona</th><th>Puesto</th><th title="Días con turno planificado">Días plan.</th><th title="Días que marcó entrada">Presente</th><th title="Horas reales">Horas</th><th>Asign.</th><th>Hechas</th><th>Atras.</th><th>%</th></tr></thead><tbody>
    ${d.prod.map(x=>`<tr class="clickrow" onclick="repSetPerson('${x.u.id}')"><td><div style="display:flex;align-items:center;gap:8px">${avatarHTML(x.u)}<span style="font-weight:600">${esc(x.u.name)}</span></div></td>
      <td>${roleInfo(x.u.role).short}</td><td>${x.dias}</td><td style="font-weight:700">${x.presente}</td><td><b>${x.horas?x.horas+'h':'—'}</b></td><td>${x.total}</td><td style="color:var(--success);font-weight:700">${x.h}</td>
      <td style="color:${x.a?'var(--warn)':'inherit'};font-weight:${x.a?700:400}">${x.a}</td>
      <td><b>${x.pct}%</b></td></tr>`).join('') || '<tr><td colspan="9" style="color:var(--text-soft)">Sin actividad registrada en el período.</td></tr>'}
    </tbody></table></div></div>`;
  if(isAdmin()){
    const sucAct=DB.sucursales.map(s=>({s,n:d.auditRange.filter(a=>a.sucursalId===s.id).length}));
    const sMax=Math.max(1,...sucAct.map(y=>y.n));
    html+=`<div class="chartcard" style="margin-top:14px"><div class="chart-title">${svgIcon('pin','icon icon-sm')} Actividad por sucursal</div>${sucAct.map(x=>bar(x.s.name,x.n,sMax,'var(--accent)')).join('')}</div>`;
  }
  return html;
}
function repDayLbl(ts,days){ const dt=new Date(ts); if(days<=14) return dt.getDate(); return (dt.getDate()===1||dt.getDate()%5===0)?dt.getDate():''; }
function repPersonView(u,d,B){
  const x=d.prod.find(p=>p.u.id===u.id) || {u,total:0,h:0,a:0,rj:0,pr:0,pe:0,dias:0,presente:0,horas:0,acts:0,pct:0};
  const mineAud=d.auditRange.filter(a=>a.byId===u.id);
  const actDay=[]; for(let i=0;i<d.days;i++){ const ds=d.start+i*864e5,de=ds+864e5; actDay.push({ts:ds,value:mineAud.filter(a=>a.at>=ds&&a.at<de).length}); }
  const taskSegs=[{label:'Hechas',value:x.h,color:'#5aa777'},{label:'En proceso',value:x.pr,color:'#5b8def'},{label:'Pendientes',value:x.pe,color:'#94a3b8'},{label:'Atrasadas',value:x.a,color:'#d59b4a'},{label:'Rechazadas',value:x.rj,color:'#d9534f'}];
  const recent=mineAud.slice(0,18);
  let html=`<div class="rep-person-head">
    <button class="chip rep-back" onclick="repSetPerson('todos')">${svgIcon('back','icon icon-sm')} Todo el equipo</button>
    <div style="display:flex;align-items:center;gap:12px">${avatarHTML(u,'av-lg')}<div><div style="font-size:18px;font-weight:800">${esc(u.name)}</div><div class="page-sub">${esc(roleInfo(u.role).label)} · ${esc(cap(B.label))}</div></div></div>
  </div>`;
  html+=`<div class="kpi-row">
    <div class="kpi ${x.pct>=70?'good':x.pct>=40?'warn':'alert'}"><div class="label">Cumplimiento</div><div class="value">${x.pct}%</div><div class="sub">${x.h}/${x.total} tareas</div></div>
    <div class="kpi ${x.a?'alert':'good'}"><div class="label">Atrasadas</div><div class="value">${x.a}</div><div class="sub">${x.rj} rechazadas</div></div>
    <div class="kpi"><div class="label">Asistencia</div><div class="value">${x.presente}<span style="font-size:13px;color:var(--text-soft)">/${x.dias}</span></div><div class="sub">${x.horas?x.horas+' h trabajadas':'sin marcas'}</div></div>
    <div class="kpi"><div class="label">Acciones</div><div class="value">${x.acts}</div><div class="sub">registros en el período</div></div>
  </div>`;
  html+=`<div class="chart-grid">
    ${donutCard('Sus tareas','check',taskSegs,`<div class="donut-c-n">${x.total}</div><div class="donut-c-l">asignadas</div>`)}
    <div class="chartcard"><div class="chart-title">${svgIcon('trend','icon icon-sm')} Actividad por día</div>
      ${mineAud.length?repVBars(actDay.map(p=>({lbl:repDayLbl(p.ts,d.days),value:p.value,title:repFmtD(p.ts)+': '+p.value+' acción(es)'}))):'<div class="chart-empty">Sin actividad registrada en este período.</div>'}</div>
  </div>`;
  html+=`<div class="card"><div class="rep-tbl-title">${svgIcon('list','icon icon-sm')} Últimas acciones</div>
    ${recent.length?`<div class="log">${recent.map(a=>`<div class="log-item">${esc(a.detail||a.action||'')} <span style="opacity:.7">· ${fmtDateTime(a.at)}</span></div>`).join('')}</div>`:'<div class="chart-empty">Sin acciones registradas.</div>'}</div>`;
  return html;
}
// Exportar el reporte del mes a CSV (para contabilidad / Excel)
function exportReportCSV(){
  const B=repBounds(); const d=reportData(B.start,B.end);
  const esc=s=>{ s=String(s==null?'':s); return /[",;\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s; };
  const rows=[];
  rows.push(['Reporte', cap(B.label), sucName(visibleSuc())]);
  rows.push([]);
  rows.push(['Resumen']);
  rows.push(['Tareas del mes', d.tMonth.length]); rows.push(['Hechas', d.done]); rows.push(['Atrasadas', d.late]); rows.push(['Cumplimiento %', d.compl]);
  rows.push(['Pedidos', d.pMonth.length]); rows.push(['Entregados', d.pDeliv]);
  rows.push(['Ventas souvenirs (₡)', d.ingresos]); rows.push(['Ganancia souvenirs (₡)', d.ganancia]);
  rows.push(['Valor inventario (₡)', Math.round(d.invVal)]); rows.push(['Productos bajo mínimo', d.invLow]);
  rows.push([]);
  rows.push(['Persona','Puesto','Días plan.','Presente','Horas','Asignadas','Hechas','Atrasadas','Cumplimiento %']);
  d.prod.forEach(x=>rows.push([x.u.name, roleInfo(x.u.role).short, x.dias, x.presente, x.horas, x.total, x.h, x.a, x.pct]));
  const csv='﻿'+rows.map(r=>r.map(esc).join(';')).join('\r\n');   // BOM + ';' para Excel en español
  const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob);
  a.download='sabor-tico-reporte.csv'; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),60000);
  toast('Reporte CSV descargado','ok');
}
window.exportReportCSV=exportReportCSV;
function generateMonthlyReport(){
  const B=repBounds(); const d=reportData(B.start,B.end);
  const ml=cap(B.label); const suc=sucName(visibleSuc());
  const gen=new Date().toLocaleString('es-CR',{day:'2-digit',month:'long',year:'numeric',hour:'2-digit',minute:'2-digit'});
  const k=(l,v)=>`<div class="k"><div class="kl">${l}</div><div class="kv">${v}</div></div>`;
  const prow=d.prod.map(x=>`<tr><td>${esc(x.u.name)}</td><td>${esc(roleInfo(x.u.role).short)}</td><td>${x.dias}</td><td>${x.total}</td><td>${x.h}</td><td>${x.a}</td><td>${x.rj}</td><td><b>${x.pct}%</b></td></tr>`).join('')||'<tr><td colspan="8" style="color:#999">Sin actividad en el mes</td></tr>';
  const li=(l,v)=>`<div class="li"><span>${l}</span><b>${v}</b></div>`;
  const html=`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Reporte ${esc(ml)} — Sabor Tico</title>
  <style>
    *{box-sizing:border-box;font-family:-apple-system,"Segoe UI",Roboto,Arial,sans-serif}
    body{margin:0;background:#f0f0f0;color:#1c1c1c}
    .bar{margin:14px auto;max-width:900px;display:flex;gap:10px;justify-content:flex-end;padding:0 16px}
    .bar button{padding:10px 16px;border:none;border-radius:8px;font-weight:700;cursor:pointer;font-size:14px}
    .pbtn{background:#b83a52;color:#fff}.cbtn{background:#dcdcdc;color:#222}
    .sheet{max-width:900px;margin:0 auto 30px;background:#fff;padding:34px 40px;box-shadow:0 2px 14px rgba(0,0,0,.08)}
    .top{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #b83a52;padding-bottom:16px;margin-bottom:8px}
    .brand{font-size:24px;font-weight:800}.brand span{color:#b83a52}
    .top h1{font-size:17px;margin:8px 0 0;font-weight:700}
    .muted{color:#888;font-size:12px;line-height:1.5}
    .kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:22px 0 8px}
    .k{border:1px solid #e6e6e6;border-radius:10px;padding:13px 15px}
    .kl{font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:#999;font-weight:700}
    .kv{font-size:21px;font-weight:800;margin-top:5px}
    h2{font-size:13.5px;margin:26px 0 11px;border-left:4px solid #b83a52;padding-left:10px;text-transform:uppercase;letter-spacing:.4px;color:#444}
    table{width:100%;border-collapse:collapse;font-size:12.5px}
    th{text-align:left;background:#faf2f3;border-bottom:2px solid #ececec;padding:9px 10px;font-size:10px;text-transform:uppercase;letter-spacing:.4px;color:#777}
    td{padding:9px 10px;border-bottom:1px solid #f0f0f0}
    .twocol{display:grid;grid-template-columns:1fr 1fr;gap:26px}
    .li{display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid #f0f0f0;font-size:13px}
    .foot{margin-top:30px;color:#aaa;font-size:11px;text-align:center;border-top:1px solid #eee;padding-top:14px}
    @media print{.bar{display:none}body{background:#fff}.sheet{box-shadow:none;margin:0;padding:0;max-width:none}}
  </style></head><body>
  <div class="bar"><button class="cbtn" onclick="window.close()">Cerrar</button><button class="pbtn" onclick="window.print()">Imprimir / Guardar PDF</button></div>
  <div class="sheet">
    <div class="top"><div><div class="brand">Sabor Tico<span>.</span></div><h1>Reporte de trabajo — ${esc(ml)}</h1></div>
      <div class="muted" style="text-align:right">${esc(suc)}<br>Generado: ${esc(gen)}<br>por ${esc(me()?me().name:'')}</div></div>
    <div class="kpis">${k('Cumplimiento',d.compl+'%')}${k('Tareas hechas',d.done+' / '+d.tMonth.length)}${k('Pedidos del mes',d.pMonth.length+' ('+d.pDeliv+' entreg.)')}${k('Ganancia souvenirs',money(d.ganancia))}</div>
    <h2>Cumplimiento y asistencia por persona</h2>
    <table><thead><tr><th>Persona</th><th>Puesto</th><th>Días trab.</th><th>Asignadas</th><th>Hechas</th><th>Atrasadas</th><th>Rechazadas</th><th>%</th></tr></thead><tbody>${prow}</tbody></table>
    <div class="twocol">
      <div><h2>Tareas</h2>${li('Creadas en el mes',d.tMonth.length)}${li('Hechas',d.done)}${li('En proceso',d.proc)}${li('Pendientes',d.pend)}${li('Atrasadas',d.late)}${li('Rechazadas',d.rej)}</div>
      <div><h2>Pedidos y ventas</h2>${li('Pedidos del mes',d.pMonth.length)}${li('Proveeduría',d.areas.proveeduria)}${li('Contabilidad',d.areas.contabilidad)}${li('Recursos',d.areas.rrhh)}${li('Souvenirs vendidos',d.unidades+' · '+money(d.ingresos))}${li('Ganancia souvenirs',money(d.ganancia))}</div>
    </div>
    <h2>Inventario (estado actual)</h2>
    ${li('Valor total del inventario',money(d.invVal))}${li('Productos bajo mínimo',d.invLow)}
    <div class="foot">Sabor Tico · Reporte generado automáticamente · ${esc(gen)}</div>
  </div></body></html>`;
  const w=window.open('','_blank'); if(!w){ toast('Permití las ventanas emergentes para generar el reporte','err'); return; }
  w.document.write(html); w.document.close();
}
window.generateMonthlyReport=generateMonthlyReport;

/* =====================================================================
   VISTA: RESERVACIONES (clientes / agencias + tabla por día)
   ===================================================================== */
const RESERV_EST={pendiente:{l:'Pendiente',c:'pendiente'},confirmada:{l:'Confirmada',c:'proceso'},llego:{l:'Llegó',c:'hecha'},noshow:{l:'No llegó',c:'atrasada'},cancelada:{l:'Cancelada',c:'rechazada'}};
let resvTab='lista', resvFilter='proximas', resvEstado='todos', resvSearch='', clientSearch='', resvSuc='all';
let rvcView='mes', rvcCursor='';
const RVC_COLOR={pendiente:'#d59b4a',confirmada:'#5b8def',llego:'#5aa777',noshow:'#d9534f',cancelada:'#8d99ae'};
function reservScoped(){ return (DB.reservations||[]).filter(r=>r&&inScope(r.sucursalId)); }
// reservas ya filtradas por el acceso rápido de sucursal (Todas / Centro Comercial / Plaza)
function reservFiltered(){ return reservScoped().filter(r=> resvSuc==='all' || r.sucursalId===resvSuc); }
// ¿mostrar los accesos rápidos por sucursal? (cuando el usuario ve más de una)
function reservMultiSuc(){ return (DB.sucursales||[]).length>1 && (isAdmin() || (me()&&me().sucursalId==='all')); }
function clientById(id){ return (DB.clients||[]).find(c=>c.id===id); }
function todayISO(){ const d=new Date(); d.setMinutes(d.getMinutes()-d.getTimezoneOffset()); return d.toISOString().slice(0,10); }
function isoLocal(dt){ const d=new Date(dt); d.setMinutes(d.getMinutes()-d.getTimezoneOffset()); return d.toISOString().slice(0,10); } // fecha local (igual base que todayISO) para cualquier día
function starsHTML(score,cid){
  let s=''; for(let i=1;i<=5;i++){ s+=`<button class="star ${i<=(score||0)?'on':''}" ${cid?`onclick="event.stopPropagation();setScore('${cid}',${i})"`:'disabled'} title="${i} de 5">${svgIcon('star','icon icon-sm')}</button>`; }
  return `<span class="stars">${s}</span>`;
}
function reservTodayCard(){
  if(!canReservView()) return '';
  const today=todayISO();
  const rs=reservScoped().filter(r=>r&&r.resDate===today && r.status!=='cancelada').sort((a,b)=>(a.resTime||'').localeCompare(b.resTime||''));
  const pers=rs.reduce((s,r)=>s+(+r.people||0),0);
  if(!rs.length) return `<div class="card sched-card free"><span class="av" style="background:var(--bg-soft)">${svgIcon('reserva')}</span><div style="flex:1"><div style="font-weight:700">Sin reservas para hoy</div><div class="page-sub" style="margin:0">Cuando registres una, aparece acá.</div></div><button class="btn btn-ghost" style="flex:0 0 auto" onclick="go('reservas')">Ver</button></div>`;
  return `<div class="card sched-card"><span class="av" style="background:var(--grad-accent)">${svgIcon('reserva')}</span>
    <div style="flex:1"><div style="font-weight:700">${rs.length} reserva(s) hoy · ${pers} personas</div>
    <div class="page-sub" style="margin:2px 0 0">Próxima: ${esc(rs[0].clientName||'')} a las ${fmt12(rs[0].resTime)} (${rs[0].people}p)</div></div>
    <button class="btn btn-ghost" style="flex:0 0 auto" onclick="go('reservas')">Ver todas</button></div>`;
}
function viewReservas(){
  const editor=canReservEdit();
  const guide=sectionGuide('reservas','¿Cómo funcionan las Reservaciones?',`
    Acá se anotan las <b>reservas</b> y se lleva el registro de <b>clientes y agencias</b>.
    <ul style="margin:8px 0 0 18px">
      <li>Cada reserva guarda fecha, hora, personas, ocasión, contacto y estado.</li>
      <li>Por cada cliente sabés <b>cuántas veces vino</b> y su <b>puntaje</b>.</li>
      <li>La tabla junta todas las reservas de todos los días para acceso rápido.</li>
    </ul>`);
  let html=`<div class="page-head"><div><div class="page-title">Reservaciones</div><div class="page-sub">Reservas, clientes y agencias</div></div>
    <div class="ph-spacer"></div>${editor?`<button class="btn btn-primary" style="flex:0 0 auto" onclick="newReservModal()">${svgIcon('plus','icon icon-sm')} Nueva reservación</button>`:''}</div>`;
  html+=guide;
  const sucQuick = reservMultiSuc() ? `<span class="hm-sep"></span>`+[{id:'all',name:'Todas'},...DB.sucursales].map(s=>`<button class="chip ${resvSuc===s.id?'on':''}" onclick="resvSuc='${s.id}';render()">${s.id!=='all'?svgIcon('pin','icon icon-sm')+' ':''}${esc(s.name)}</button>`).join('') : '';
  html+=`<div class="hor-modes chipscroll"><button class="chip ${resvTab==='lista'?'on':''}" onclick="resvTab='lista';render()">Reservaciones</button><button class="chip ${resvTab==='cal'?'on':''}" onclick="resvTab='cal';render()">${svgIcon('calendar','icon icon-sm')} Calendario</button><button class="chip ${resvTab==='clientes'?'on':''}" onclick="resvTab='clientes';render()">Clientes y agencias</button>${sucQuick}</div>`;
  html+= resvTab==='clientes' ? reservClientes(editor) : resvTab==='cal' ? reservCalendar(editor) : reservLista(editor);
  return html;
}
function reservLista(editor){
  const today=todayISO();
  let list=reservFiltered();
  if(resvFilter==='hoy') list=list.filter(r=>r.resDate===today);
  else if(resvFilter==='proximas') list=list.filter(r=>r.resDate>=today);
  else if(resvFilter==='pasadas') list=list.filter(r=>r.resDate<today);
  if(resvEstado!=='todos') list=list.filter(r=>r.status===resvEstado);
  if(resvSearch){ const q=resvSearch.toLowerCase(); list=list.filter(r=>(r.clientName||'').toLowerCase().includes(q)||(r.phone||'').includes(resvSearch)); }
  list.sort((a,b)=> (a.resDate+a.resTime).localeCompare(b.resDate+b.resTime));
  const hoyN=reservFiltered().filter(r=>r.resDate===today && r.status!=='cancelada').length;
  const proxN=reservFiltered().filter(r=>r.resDate>today && (r.status==='pendiente'||r.status==='confirmada')).length;
  const persHoy=reservFiltered().filter(r=>r.resDate===today && r.status!=='cancelada').reduce((s,r)=>s+(+r.people||0),0);
  let html=`<div class="kpi-row">
    <div class="kpi"><div class="label">Hoy</div><div class="value">${hoyN}</div><div class="sub">reservas de hoy</div></div>
    <div class="kpi"><div class="label">Personas hoy</div><div class="value">${persHoy}</div><div class="sub">total esperado</div></div>
    <div class="kpi ${proxN?'warn':''}"><div class="label">Próximas</div><div class="value">${proxN}</div><div class="sub">por venir</div></div>
    <div class="kpi"><div class="label">Clientes</div><div class="value">${(DB.clients||[]).length}</div><div class="sub">en la base</div></div>
  </div>`;
  html+=`<div class="toolbar">
    <input class="input search" placeholder="Buscar cliente o teléfono…" value="${esc(resvSearch)}" oninput="resvSearch=this.value;clearTimeout(window._rs);window._rs=setTimeout(render,250)">
  </div><div class="chipscroll">
    ${[['hoy','Hoy'],['proximas','Próximas'],['pasadas','Pasadas'],['todas','Todas']].map(([k,l])=>`<button class="chip ${resvFilter===k?'on':''}" onclick="resvFilter='${k}';render()">${l}</button>`).join('')}
    <select class="select" style="max-width:180px;min-width:150px" onchange="resvEstado=this.value;render()"><option value="todos" ${resvEstado==='todos'?'selected':''}>Todos los estados</option>${Object.entries(RESERV_EST).map(([k,v])=>`<option value="${k}" ${resvEstado===k?'selected':''}>${v.l}</option>`).join('')}</select>
  </div>`;
  if(!list.length) return html+emptyState('','Sin reservaciones','Cuando registres una reserva aparece acá, ordenada por fecha y hora.', editor?'Nueva reservación':'', editor?'newReservModal()':'');
  html+=`<div class="card" style="padding:0"><div class="tbl-wrap"><table class="tbl rv-table"><thead><tr>
    <th>Fecha</th><th>Hora</th><th>Cliente</th><th>Personas</th><th>Ocasión</th><th>Teléfono</th><th>Estado</th><th></th></tr></thead><tbody>`;
  html+=list.map(r=>{const c=clientById(r.clientId); const est=RESERV_EST[r.status]||RESERV_EST.pendiente; const isToday=r.resDate===today;
    return `<tr onclick="reservDetail('${r.id}')" style="cursor:pointer">
      <td>${isToday?'<b style="color:var(--accent)">Hoy</b>':fmtResDate(r.resDate)}</td>
      <td>${fmt12(r.resTime)}</td>
      <td><div style="font-weight:600">${esc(r.clientName||'—')}</div><div style="font-size:11px;color:var(--text-soft)">${r.type==='agencia'?'Agencia':'Cliente'}${c?' · vino '+(c.visits||0)+'x':''}</div></td>
      <td><b>${r.people||'—'}</b></td>
      <td>${esc(r.occasion||'—')}</td>
      <td>${esc(r.phone||'—')}</td>
      <td><span class="pill ${est.c}">${est.l}</span></td>
      <td style="text-align:right">${svgIcon('chevron','icon icon-sm')}</td>
    </tr>`;}).join('');
  html+=`</tbody></table></div></div>`;
  return html;
}
function fmtResDate(d){ if(!d) return '—'; const x=new Date(d+'T00:00'); return x.toLocaleDateString('es-CR',{weekday:'short',day:'2-digit',month:'short'}); }
/* ---- CALENDARIO DE RESERVAS (reusa el estilo del calendario personal) ---- */
function rvcItems(iso){
  return reservFiltered().filter(r=>r&&r.resDate===iso).sort((a,b)=>(a.resTime||'').localeCompare(b.resTime||''))
    .map(r=>({id:r.id, name:r.clientName||'Reserva', people:+r.people||0, time:r.resTime||'', color:RVC_COLOR[r.status]||'#d59b4a', status:r.status}));
}
function rvcChip(it, iso){
  const edit=canReservEdit();
  const arrived=it.status==='llego'; const off=it.status==='cancelada'||it.status==='noshow';
  const drag = edit && it.status!=='cancelada';
  const check = edit ? `<span class="cal-check ${arrived?'on':''}" title="${arrived?'Quitar Llegó':'Marcar que llegó'}" onpointerdown="event.stopPropagation()" onclick="event.stopPropagation();rvcToggleLlego('${it.id}')">${arrived?svgIcon('check','icon icon-sm'):''}</span>` : '';
  const h = drag ? `onpointerdown="calDragStart(event,'reserva','${it.id}','${iso||''}')" onclick="event.stopPropagation()"` : `onclick="event.stopPropagation();reservDetail('${it.id}')"`;
  return `<div class="cal-chip cal-chip-reserva${drag?' cdraggable':''}${off?' done':''}" style="--c:${it.color}" ${h}>${check}<span class="cal-chip-body">${it.time?`<b>${esc(fmt12(it.time))}</b> `:''}${esc(it.name)}${it.people?' ('+it.people+')':''}</span></div>`;
}
function rvcToggleLlego(id){
  const r=DB.reservations.find(x=>x.id===id); if(!r) return;
  if(!canReservEdit()){ toast('No tenés permiso para cambiar reservas','err'); return; }
  const to = r.status==='llego' ? 'confirmada' : 'llego';
  if(to==='llego' && !r.counted){ const c=clientById(r.clientId); if(c) c.visits=(c.visits||0)+1; r.counted=true; }
  if(to!=='llego' && r.counted){ const c=clientById(r.clientId); if(c) c.visits=Math.max(0,(c.visits||0)-1); r.counted=false; }
  r.status=to; r.updatedAt=now();
  audit('reserva',`marcó ${to==='llego'?'que LLEGÓ':'como confirmada'} (${r.clientName})`,r.sucursalId);
  toast(to==='llego'?'Marcada: Llegó ✓':'Reserva reabierta','ok'); save(); render();
}
window.rvcToggleLlego=rvcToggleLlego;
function reservCalendar(editor){
  if(!rvcCursor) rvcCursor=calToday();
  const d=calParse(rvcCursor); let title;
  if(rvcView==='dia') title=d.getDate()+' de '+CAL_MON[d.getMonth()]+' '+d.getFullYear();
  else if(rvcView==='semana'){ const ws=calParse(calWeekStart(rvcCursor)), we=calParse(calAddDays(calWeekStart(rvcCursor),6)); title=ws.getDate()+(ws.getMonth()!==we.getMonth()?' '+CAL_MON[ws.getMonth()].slice(0,3):'')+' – '+we.getDate()+' '+CAL_MON[we.getMonth()].slice(0,3)+' '+we.getFullYear(); }
  else if(rvcView==='agenda') title='Agenda · desde '+d.getDate()+' '+CAL_MON[d.getMonth()].slice(0,3);
  else title=cap1(CAL_MON[d.getMonth()])+' '+d.getFullYear();
  const views=[['dia','Día'],['semana','Semana'],['mes','Mes'],['agenda','Agenda']];
  let html=`<div class="cal-toolbar">
    <button class="btn btn-ghost cal-today" onclick="rvcGo('hoy')">Hoy</button>
    <button class="icon-btn cal-nav" onclick="rvcGo('prev')" title="Anterior">${svgIcon('back','icon icon-sm')}</button>
    <button class="icon-btn cal-nav cal-next" onclick="rvcGo('next')" title="Siguiente">${svgIcon('back','icon icon-sm')}</button>
    <div class="cal-title">${esc(title)}</div><div class="ph-spacer"></div>
    <div class="cal-views">${views.map(([k,l])=>`<button class="cal-vbtn ${rvcView===k?'on':''}" onclick="rvcView='${k}';render()">${l}</button>`).join('')}</div>
  </div>`;
  html+=`<div class="cal-filters">${Object.entries(RESERV_EST).map(([k,v])=>`<span class="cal-fchip on" style="cursor:default"><span class="cal-dot" style="background:${RVC_COLOR[k]}"></span>${v.l}</span>`).join('')}</div>`;
  html+= rvcView==='mes'?rvcMonthView():rvcView==='semana'?rvcWeekView():rvcView==='dia'?rvcDayView():rvcAgendaView();
  return html;
}
function rvcGo(dir){
  if(dir==='hoy'){ rvcCursor=calToday(); render(); return; }
  const n=dir==='next'?1:-1;
  if(rvcView==='dia') rvcCursor=calAddDays(rvcCursor,n);
  else if(rvcView==='semana'||rvcView==='agenda') rvcCursor=calAddDays(rvcCursor,7*n);
  else rvcCursor=calAddMonths(rvcCursor,n);
  render();
}
function rvcOpenDay(iso){ rvcView='dia'; rvcCursor=iso||calToday(); render(); }
function rvcCreateAt(iso,ev,rowH,startH){
  if(ev.target.closest('.cal-ev')) return; if(!canReservEdit()) return;
  let y=0; try{ const r=ev.currentTarget.getBoundingClientRect(); y=ev.clientY-r.top; }catch(_){}
  const mins=startH*60+Math.max(0,Math.round(y/rowH*60/30)*30);
  newReservModal({date:iso, time:calMinToHHMM(mins)});
}
function rvcMonthView(){
  const first=calParse(rvcCursor); first.setDate(1);
  const gridStart=calWeekStart(dISO(first)); const today=calToday(); const curMonth=first.getMonth();
  let cells='';
  for(let i=0;i<42;i++){ const iso=calAddDays(gridStart,i); const d=calParse(iso); const items=rvcItems(iso);
    const shown=items.slice(0,3), more=items.length-shown.length;
    cells+=`<div class="cal-cell${d.getMonth()!==curMonth?' other':''}${iso===today?' today':''}" data-iso="${iso}" onclick="rvcOpenDay('${iso}')">
      <div class="cal-cnum">${d.getDate()}</div>
      <div class="cal-cev">${shown.map(it=>rvcChip(it,iso)).join('')}${more>0?`<div class="cal-more">+${more} más</div>`:''}</div></div>`;
  }
  return `<div class="cal-month"><div class="cal-dow">${CAL_DOW.map(x=>`<span>${x}</span>`).join('')}</div><div class="cal-grid">${cells}</div></div>`;
}
function rvcTimeGrid(days){
  const startH=8,endH=23,rowH=46; const hours=[]; for(let h=startH;h<=endH;h++) hours.push(h);
  const today=calToday(); const cols='58px repeat('+days.length+',minmax(0,1fr))';
  const head=days.map(iso=>{const d=calParse(iso);return `<div class="cal-tg-dh${iso===today?' today':''}"><span>${CAL_DOW[(d.getDay()+6)%7]}</span><b>${d.getDate()}</b></div>`;}).join('');
  const gut=`<div class="cal-tg-gut">${hours.map(h=>`<div class="cal-tg-hr" style="height:${rowH}px"><span>${fmt12(String(h).padStart(2,'0')+':00')}</span></div>`).join('')}</div>`;
  const dayCols=days.map(iso=>{
    const list=rvcItems(iso).filter(it=>it.time).map(it=>{ const s=calMin(it.time); return Object.assign({}, it, {s, e:s+90}); });
    calPack(list);
    const evs=list.map(it=>{
      const top=(it.s-startH*60)/60*rowH, h=Math.max(26,(it.e-it.s)/60*rowH);
      const cols=it.cols||1, col=it.col||0, lf=col/cols*100, wd=100/cols;
      const off=it.status==='cancelada'||it.status==='noshow'; const drag=canReservEdit()&&it.status!=='cancelada';
      const handler=drag?`onpointerdown="calDragStart(event,'reserva','${it.id}','${iso}')" onclick="event.stopPropagation()"`:`onclick="event.stopPropagation();reservDetail('${it.id}')"`;
      return `<button class="cal-ev${drag?' cdraggable':''}${off?' done':''}" style="--c:${it.color};top:${top}px;height:${h}px;left:calc(${lf}% + 2px);width:calc(${wd}% - 4px);right:auto" ${handler}><b>${esc(fmt12(it.time))}</b> ${esc(it.name)}${(cols<2&&it.people)?' ('+it.people+'p)':''}</button>`;
    }).join('');
    return `<div class="cal-tg-col" data-iso="${iso}" data-starth="${startH}" data-rowh="${rowH}" style="height:${hours.length*rowH}px" onclick="rvcCreateAt('${iso}',event,${rowH},${startH})">${evs}</div>`;
  }).join('');
  return `<div class="cal-timegrid">
    <div class="cal-tg-headrow" style="grid-template-columns:${cols}"><div></div>${head}</div>
    <div class="cal-tg-scroll"><div class="cal-tg-board" style="grid-template-columns:${cols}">${gut}${dayCols}</div></div>
  </div>`;
}
function rvcDayView(){ return rvcTimeGrid([rvcCursor]); }
function rvcWeekView(){ const ws=calWeekStart(rvcCursor); return rvcTimeGrid([0,1,2,3,4,5,6].map(i=>calAddDays(ws,i))); }
function rvcAgendaView(){
  const today=calToday(); let html='<div class="cal-agenda">'; let any=false;
  for(let i=0;i<35;i++){ const iso=calAddDays(rvcCursor,i); const items=rvcItems(iso); if(!items.length) continue; any=true; const d=calParse(iso);
    html+=`<div class="cal-ag-day${iso===today?' today':''}"><div class="cal-ag-date"><b>${d.getDate()}</b><span>${CAL_DOW[(d.getDay()+6)%7]}<br>${CAL_MON[d.getMonth()].slice(0,3)}</span></div>
      <div class="cal-ag-items">${items.map(it=>{const arrived=it.status==='llego'; const off=it.status==='cancelada'||it.status==='noshow'; const check=canReservEdit()?`<span class="cal-check ${arrived?'on':''}" title="${arrived?'Quitar Llegó':'Marcar que llegó'}" onclick="event.stopPropagation();rvcToggleLlego('${it.id}')">${arrived?svgIcon('check','icon icon-sm'):''}</span>`:''; return `<div class="cal-ag-row ${off?'done':''}" style="--c:${it.color}">${check}<button class="cal-ag-body" onclick="reservDetail('${it.id}')"><span class="cal-ag-time">${it.time?fmt12(it.time):'—'}</span><span class="cal-ag-t">${esc(it.name)}${it.people?' · '+it.people+'p':''}</span></button></div>`;}).join('')}</div></div>`;
  }
  if(!any) html+=emptyState('','Sin reservas','No hay reservas en los próximos días.');
  return html+'</div>';
}
window.rvcGo=rvcGo; window.rvcOpenDay=rvcOpenDay; window.rvcCreateAt=rvcCreateAt;
function reservClientes(editor){
  let cls=[...(DB.clients||[])];
  if(clientSearch){ const q=clientSearch.toLowerCase(); cls=cls.filter(c=>(c.name||'').toLowerCase().includes(q)||(c.phone||'').includes(clientSearch)); }
  cls.sort((a,b)=>(b.visits||0)-(a.visits||0)||a.name.localeCompare(b.name));
  const all=DB.clients||[];
  const totC=all.filter(c=>c.type!=='agencia').length, totA=all.filter(c=>c.type==='agencia').length, totV=all.reduce((s,c)=>s+(c.visits||0),0);
  const top=[...all].sort((a,b)=>(b.visits||0)-(a.visits||0))[0];
  let html=`<div class="kpi-row">
    <div class="kpi"><div class="label">Clientes</div><div class="value">${totC}</div><div class="sub">personas</div></div>
    <div class="kpi"><div class="label">Agencias</div><div class="value">${totA}</div><div class="sub">registradas</div></div>
    <div class="kpi"><div class="label">Visitas</div><div class="value">${totV}</div><div class="sub">acumuladas</div></div>
    <div class="kpi"><div class="label">Top cliente</div><div class="value" style="font-size:16px">${top&&(top.visits||0)>0?esc(top.name.split(' ')[0]):'—'}</div><div class="sub">${top&&(top.visits||0)>0?top.visits+' visitas':'sin datos'}</div></div>
  </div>`;
  html+=`<div class="toolbar"><input class="input search" placeholder="Buscar cliente o teléfono…" value="${esc(clientSearch)}" oninput="clientSearch=this.value;clearTimeout(window._cs);window._cs=setTimeout(render,250)"><div class="ph-spacer"></div>${editor?`<button class="btn btn-primary" style="flex:0 0 auto" onclick="newClientModal()">${svgIcon('plus','icon icon-sm')} Nuevo cliente / agencia</button>`:''}</div>`;
  if(!cls.length) return html+emptyState('','Sin clientes', clientSearch?'No hay clientes que coincidan.':'Los clientes y agencias se agregan al crear reservas, o desde acá.', editor?'Nuevo cliente / agencia':'', editor?'newClientModal()':'');
  html+=`<div class="card" style="padding:0"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>#</th><th>Nombre</th><th>Tipo</th><th>Teléfono</th><th>Veces que vino</th><th>Puntaje</th><th></th></tr></thead><tbody>`;
  html+=cls.map((c,i)=>`<tr onclick="clientDetail('${c.id}')" style="cursor:pointer">
    <td><span class="cl-rank ${i<3&&(c.visits||0)>0?'top':''}">${i+1}</span></td>
    <td style="font-weight:600">${esc(c.name)}</td>
    <td><span class="role-badge" style="background:var(--bg-soft);color:var(--text-soft)">${c.type==='agencia'?'Agencia':'Cliente'}</span></td>
    <td>${esc(c.phone||'—')}</td>
    <td><b>${c.visits||0}</b></td>
    <td>${starsHTML(c.score, editor?c.id:null)}</td>
    <td style="text-align:right">${svgIcon('chevron','icon icon-sm')}</td>
  </tr>`).join('');
  html+=`</tbody></table></div></div>`;
  return html;
}
function clientDetail(id){
  const c=clientById(id); if(!c) return;
  const editor=canReservEdit();
  const resvs=(DB.reservations||[]).filter(r=>r.clientId===id).sort((a,b)=>((b.resDate||'')+(b.resTime||'')).localeCompare((a.resDate||'')+(a.resTime||'')));
  const hist = resvs.length? resvs.map(r=>{const est=RESERV_EST[r.status]||RESERV_EST.pendiente;
      return `<div class="cl-hrow" onclick="reservDetail('${r.id}')"><div class="cl-hrow-main"><div class="cl-hd">${fmtResDate(r.resDate)} · ${fmt12(r.resTime)}</div><div class="cl-hs">${r.people} personas${r.occasion?' · '+esc(r.occasion):''}</div></div><span class="pill ${est.c}">${est.l}</span></div>`;
    }).join('') : '<div class="td-empty">Todavía no tiene reservas registradas.</div>';
  openModal(`<div class="modal-head"><h3>${svgIcon('user','icon')} ${esc(c.name)}</h3><button class="modal-close" onclick="closeModal()">${svgIcon('x','icon')}</button></div>
    <div class="modal-body">
      <div class="cl-head">
        <div class="av cl-av" style="background:var(--grad-accent)">${initials(c.name)}</div>
        <div><div class="cl-name">${esc(c.name)}</div><div class="cl-type">${c.type==='agencia'?'Agencia':'Cliente'}${c.phone?' · '+esc(c.phone):''}</div></div>
      </div>
      <div class="cl-stats">
        <div class="cl-stat"><div class="cl-stat-v">${c.visits||0}</div><div class="cl-stat-l">veces que vino</div></div>
        <div class="cl-stat"><div class="cl-stat-v">${resvs.length}</div><div class="cl-stat-l">reservas</div></div>
        <div class="cl-stat"><div class="cl-stat-stars">${starsHTML(c.score, editor?c.id:null)}</div><div class="cl-stat-l">puntaje</div></div>
      </div>
      ${c.notes?`<div class="td-desc">${esc(c.notes)}</div>`:''}
      <div class="td-sec">Historial de reservas</div>
      <div class="cl-hist">${hist}</div>
      ${editor?`<div class="td-actions"><button class="btn btn-ghost" onclick="editClientModal('${c.id}')">${svgIcon('edit','icon icon-sm')} Editar</button><button class="btn btn-danger" onclick="delClient('${c.id}')">${svgIcon('trash','icon icon-sm')} Eliminar</button></div>`:''}
    </div>`,true);
}
window.clientDetail=clientDetail;
async function delClient(id){
  if(!canReservEdit()) return;
  const c=clientById(id); if(!c) return;
  const n=(DB.reservations||[]).filter(r=>r.clientId===id).length;
  if(!await confirmDialog(`Se elimina ${c.name}.${n?` Sus ${n} reserva(s) registradas se conservan, pero quedan sin cliente vinculado.`:''}`,{title:`¿Eliminar ${c.type==='agencia'?'agencia':'cliente'}?`,okText:'Sí, eliminar'})) return;
  tomb(id); DB.clients=DB.clients.filter(x=>x.id!==id);
  audit('reserva',`eliminó ${c.type==='agencia'?'agencia':'cliente'} ${c.name}`);
  closeModal(); save(); render(); undoDelete('clients', c, c.name);
}
window.delClient=delClient;
const RV_COL={pendiente:'var(--text-soft)',confirmada:'var(--info)',llego:'var(--success)',noshow:'var(--warn)',cancelada:'var(--danger)'};
const RV_OCC=['Cumpleaños','Aniversario','Negocios','Familiar','Alergia','Silla de bebé'];
function rvTypeSeg(sel){
  return `<input type="hidden" id="rvcType" value="${sel}"><div class="prio-seg"><button type="button" class="prio-b ${sel==='cliente'?'on':''}" data-t="cliente" onclick="rvSetType('cliente')">${svgIcon('user','icon icon-sm')} Cliente</button><button type="button" class="prio-b ${sel==='agencia'?'on':''}" data-t="agencia" onclick="rvSetType('agencia')">${svgIcon('users','icon icon-sm')} Agencia</button></div>`;
}
function rvSetType(t){ const h=$('#rvcType'); if(h)h.value=t; document.querySelectorAll('.prio-b[data-t]').forEach(b=>b.classList.toggle('on',b.dataset.t===t)); }
function rvStatusSeg(sel){
  return `<input type="hidden" id="rvStatus" value="${sel}"><div class="rv-status-seg">`+Object.entries(RESERV_EST).map(([k,v])=>`<button type="button" class="rv-st-b ${sel===k?'on':''}" data-s="${k}" onclick="rvSetStatus('${k}')"><span class="dot-prio" style="background:${RV_COL[k]}"></span>${v.l}</button>`).join('')+`</div>`;
}
function rvSetStatus(s){ const h=$('#rvStatus'); if(h)h.value=s; document.querySelectorAll('.rv-st-b').forEach(b=>b.classList.toggle('on',b.dataset.s===s)); }
function rvPeopleStep(d){ const el=$('#rvPeople'); if(!el)return; let v=(parseInt(el.value,10)||1)+d; v=Math.max(1,v); el.value=v; }
function rvSetOcc(o){ const el=$('#rvOcc'); if(!el)return; const cur=el.value.trim(); el.value = cur? (cur+', '+o) : o; }
window.rvSetType=rvSetType; window.rvSetStatus=rvSetStatus; window.rvPeopleStep=rvPeopleStep; window.rvSetOcc=rvSetOcc;
function newReservModal(prefill){ openModal(reservForm('Nueva reservación',null,prefill), true); }
function reservForm(title,r,prefill){
  const d=new Date(); d.setMinutes(d.getMinutes()-d.getTimezoneOffset());
  const date=r?r.resDate:((prefill&&prefill.date)||d.toISOString().slice(0,10));
  const time0=r?r.resTime:((prefill&&prefill.time)||'19:00');
  const cls=DB.clients||[];
  return `<div class="modal-head"><h3>${svgIcon('reserva','icon')} ${title}</h3><button class="modal-close" onclick="closeModal()">${svgIcon('x','icon')}</button></div>
  <div class="modal-body">
    <div class="ip-sec">${svgIcon('user','icon icon-sm')} Cliente</div>
    <div class="field"><label>Cliente o agencia</label>
      <select class="select" id="rvClient" onchange="reservClientPick()">
        <option value="">— Nuevo cliente o agencia —</option>
        ${cls.map(c=>`<option value="${c.id}" ${r&&r.clientId===c.id?'selected':''}>${esc(c.name)} (${c.type==='agencia'?'Agencia':'Cliente'})</option>`).join('')}
      </select>
    </div>
    <div id="rvNewClient" class="${r&&r.clientId?'hidden':''}">
      <div class="field"><label>Tipo</label>${rvTypeSeg(r&&r.type==='agencia'?'agencia':'cliente')}</div>
      <div class="field"><label>Nombre</label><input class="input" id="rvcName" value="${r&&!r.clientId?esc(r.clientName||''):''}" placeholder="Nombre del cliente o agencia" autocomplete="off"></div>
    </div>
    <div class="ip-sec">${svgIcon('reserva','icon icon-sm')} Reserva</div>
    <div class="row2 rv-when">
      <div class="field"><label>Fecha</label>${dateField(date,'rv')}</div>
      <div class="field"><label>Hora</label>${timePicker('rvTime', time0, '')}</div>
    </div>
    <div class="row2 rv-pt">
      <div class="field"><label>Personas</label><div class="qty-step"><button type="button" onclick="rvPeopleStep(-1)">−</button><input id="rvPeople" type="number" min="1" value="${r?r.people:2}"><button type="button" onclick="rvPeopleStep(1)">+</button></div></div>
      <div class="field"><label>Teléfono de contacto</label><input class="input" id="rvPhone" value="${r?esc(r.phone||''):''}" placeholder="8888-8888" autocomplete="off"></div>
    </div>
    <div class="ip-sec">${svgIcon('star','icon icon-sm')} Detalles</div>
    <div class="field"><label>Ocasión / nota especial</label>
      <div class="due-presets">${RV_OCC.map(o=>`<button type="button" class="chip" onclick="rvSetOcc('${o}')">${o}</button>`).join('')}</div>
      <input class="input" id="rvOcc" value="${r?esc(r.occasion||''):''}" placeholder="Cumpleaños, alergia, silla de bebé…" autocomplete="off" style="margin-top:9px">
    </div>
    <div class="field"><label>Estado</label>${rvStatusSeg(r?r.status:'pendiente')}</div>
    <div class="field"><label>Sucursal</label><select class="select" id="rvSuc">${r?sucOptionsSel(r.sucursalId):sucOptionsFor()}</select></div>
  </div>
  <div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">Cancelar</button><button class="btn btn-primary" onclick="saveReserv('${r?r.id:''}')">${svgIcon('check','icon icon-sm')} ${r?'Guardar cambios':'Registrar reserva'}</button></div>`;
}
function reservClientPick(){
  const sel=$('#rvClient'); const box=$('#rvNewClient');
  if(!sel.value){ if(box) box.classList.remove('hidden'); return; }
  if(box) box.classList.add('hidden');
  const c=clientById(sel.value); if(c && $('#rvPhone')) $('#rvPhone').value=c.phone||'';
}
function saveReserv(id){
  let clientId=$('#rvClient').value, clientName='', type='cliente';
  if(!clientId){
    const name=$('#rvcName').value.trim(); if(!name){ toast('Poné el nombre del cliente o agencia','err'); return; }
    type=$('#rvcType').value;
    const c={id:uid(),name,type,phone:$('#rvPhone').value.trim(),visits:0,score:0,notes:'',at:now()};
    DB.clients.push(c); clientId=c.id; clientName=name;
  } else { const c=clientById(clientId); clientName=c?c.name:''; type=c?c.type:'cliente'; }
  const now2=new Date();
  const data={ clientId, clientName, type, people:+$('#rvPeople').value||1, occasion:$('#rvOcc').value.trim(),
    phone:$('#rvPhone').value.trim(), resDate:$('#rvDate').value, resTime:readTP('rvTime'), status:$('#rvStatus').value, sucursalId:$('#rvSuc').value };
  if(!data.resDate){ toast('Elegí la fecha de la reserva','err'); return; }
  if(id){ const r=DB.reservations.find(x=>x.id===id); const wasLlego=r.status==='llego'; Object.assign(r,data);
    if(data.status==='llego'&&!r.counted){ const c=clientById(r.clientId); if(c){c.visits=(c.visits||0)+1;} r.counted=true; }
    if(data.status!=='llego'&&r.counted){ const c=clientById(r.clientId); if(c){c.visits=Math.max(0,(c.visits||0)-1);} r.counted=false; }
    audit('reserva',`editó reserva de ${clientName} (${data.resDate})`,data.sucursalId);
  } else {
    const r={id:uid(),...data,regDate:now2.toISOString().slice(0,10),regTime:now2.toTimeString().slice(0,5),counted:data.status==='llego',byId:SES.userId,at:now()};
    if(r.counted){ const c=clientById(r.clientId); if(c)c.visits=(c.visits||0)+1; }
    DB.reservations.push(r);
    audit('reserva',`registró reserva de ${clientName} para ${data.resDate} ${fmt12(data.resTime)}`,data.sucursalId);
    notify(DB.users.filter(u=>['admin','gerencia_exp','jefe_salon','salonero'].includes(u.role)).map(u=>u.id), `Nueva reserva: ${clientName} · ${fmtResDate(data.resDate)} ${fmt12(data.resTime)} · ${data.people}p`, 'reserva', {view:'reservas'});
  }
  closeModal(); toast('Reserva guardada','ok'); save(); render();
}
function reservDetail(id){
  const r=DB.reservations.find(x=>x.id===id); if(!r) return;
  const c=clientById(r.clientId); const est=RESERV_EST[r.status]||RESERV_EST.pendiente; const editor=canReservEdit();
  openModal(`<div class="modal-head"><h3>${svgIcon('reserva','icon')} ${esc(r.clientName||'Reserva')}</h3><button class="modal-close" onclick="closeModal()">${svgIcon('x','icon')}</button></div>
    <div class="modal-body">
      <div class="td-top">
        <span class="pill ${est.c}">${est.l}</span>
        <span class="td-badge">${svgIcon('reserva','icon icon-sm')} ${fmtResDate(r.resDate)}</span>
        <span class="td-badge">${svgIcon('clock','icon icon-sm')} ${fmt12(r.resTime)}</span>
        <span class="td-badge">${svgIcon('users','icon icon-sm')} ${r.people} personas</span>
      </div>
      ${r.occasion?`<div class="td-desc">${svgIcon('star','icon icon-sm')} ${esc(r.occasion)}</div>`:''}
      <div class="td-meta">
        <div class="td-mrow"><span class="td-ml">Cliente</span><span class="td-mv">${esc(r.clientName||'—')} · ${r.type==='agencia'?'Agencia':'Cliente'}</span></div>
        <div class="td-mrow"><span class="td-ml">Teléfono</span><span class="td-mv">${esc(r.phone||'—')}</span></div>
        <div class="td-mrow"><span class="td-ml">Veces que vino</span><span class="td-mv">${c?(c.visits||0):'—'}</span></div>
        <div class="td-mrow"><span class="td-ml">Puntaje</span><span class="td-mv">${c?starsHTML(c.score, editor?c.id:null):'—'}</span></div>
        <div class="td-mrow"><span class="td-ml">Registrada</span><span class="td-mv">${fmtResDate(r.regDate)} ${fmt12(r.regTime)}</span></div>
        <div class="td-mrow"><span class="td-ml">Sucursal</span><span class="td-mv">${esc(sucName(r.sucursalId))}</span></div>
      </div>
      ${editor?`<div class="td-sec">Cambiar estado</div>
      <div class="rv-status-seg" style="margin-bottom:16px">${Object.entries(RESERV_EST).map(([k,v])=>`<button class="rv-st-b ${r.status===k?'on':''}" onclick="setReservStatus('${r.id}','${k}')"><span class="dot-prio" style="background:${RV_COL[k]}"></span>${v.l}</button>`).join('')}</div>
      <div class="td-actions"><button class="btn btn-ghost" onclick="editReservModal('${r.id}')">${svgIcon('edit','icon icon-sm')} Editar</button><button class="btn btn-danger" onclick="delReserv('${r.id}')">${svgIcon('trash','icon icon-sm')} Eliminar</button></div>`:''}
    </div>`,true);
}
function editReservModal(id){ const r=DB.reservations.find(x=>x.id===id); openModal(reservForm('Editar reserva',r), true); }
function setReservStatus(id,status){
  const r=DB.reservations.find(x=>x.id===id); if(!r) return;
  if(status==='llego'&&!r.counted){ const c=clientById(r.clientId); if(c)c.visits=(c.visits||0)+1; r.counted=true; }
  if(status!=='llego'&&r.counted){ const c=clientById(r.clientId); if(c)c.visits=Math.max(0,(c.visits||0)-1); r.counted=false; }
  r.status=status; audit('reserva',`cambió estado de reserva (${r.clientName}) a ${RESERV_EST[status].l}`,r.sucursalId);
  save(); reservDetail(id); render();
}
async function delReserv(id){
  const r=DB.reservations.find(x=>x.id===id); if(!r) return;
  if(!await confirmDialog('Se elimina esta reservación.',{title:'¿Eliminar reserva?',okText:'Sí, eliminar'})) return;
  if(r.counted){ const c=clientById(r.clientId); if(c)c.visits=Math.max(0,(c.visits||0)-1); }
  tomb(id); DB.reservations=DB.reservations.filter(x=>x.id!==id); audit('reserva','eliminó una reserva',r.sucursalId);
  closeModal(); render(); undoDelete('reservations', r, 'Reserva de '+(r.clientName||''), ()=>{ if(r.counted){ const c=clientById(r.clientId); if(c) c.visits=(c.visits||0)+1; } });
}
function newClientModal(){ openModal(clientForm('Nuevo cliente / agencia',null), true); }
function editClientModal(id){ openModal(clientForm('Editar cliente',clientById(id)), true); }
function clType(sel){ return `<input type="hidden" id="clType" value="${sel}"><div class="prio-seg"><button type="button" class="prio-b ${sel==='cliente'?'on':''}" data-ct="cliente" onclick="clSetType('cliente')">${svgIcon('user','icon icon-sm')} Cliente</button><button type="button" class="prio-b ${sel==='agencia'?'on':''}" data-ct="agencia" onclick="clSetType('agencia')">${svgIcon('users','icon icon-sm')} Agencia</button></div>`; }
function clSetType(t){ const h=$('#clType'); if(h)h.value=t; document.querySelectorAll('.prio-b[data-ct]').forEach(b=>b.classList.toggle('on',b.dataset.ct===t)); }
window.clSetType=clSetType;
function clientForm(title,c){
  return `<div class="modal-head"><h3>${svgIcon('user','icon')} ${title}</h3><button class="modal-close" onclick="closeModal()">${svgIcon('x','icon')}</button></div>
  <div class="modal-body">
    <div class="field"><label>Tipo</label>${clType(c&&c.type==='agencia'?'agencia':'cliente')}</div>
    <div class="row2">
      <div class="field"><label>Nombre</label><input class="input" id="clName" value="${c?esc(c.name):''}" placeholder="Nombre del cliente o agencia" autocomplete="off"></div>
      <div class="field"><label>Teléfono</label><input class="input" id="clPhone" value="${c?esc(c.phone||''):''}" placeholder="8888-8888" autocomplete="off"></div>
    </div>
    <div class="field"><label>Notas</label><textarea class="textarea" id="clNotes" placeholder="Preferencias, alergias, etc.">${c?esc(c.notes||''):''}</textarea></div>
    ${c?`<div class="field"><label>Veces que vino</label><input class="input" id="clVisits" type="number" min="0" value="${c.visits||0}"></div>`:''}
  </div>
  <div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">Cancelar</button><button class="btn btn-primary" onclick="saveClient('${c?c.id:''}')">${svgIcon('check','icon icon-sm')} Guardar</button></div>`;
}
function saveClient(id){
  const name=$('#clName').value.trim(); if(!name){ toast('Poné el nombre','err'); return; }
  const data={name,type:$('#clType').value,phone:$('#clPhone').value.trim(),notes:$('#clNotes').value.trim()};
  if(id){ const c=clientById(id); Object.assign(c,data); if($('#clVisits')) c.visits=+$('#clVisits').value||0; audit('reserva',`editó cliente ${name}`); }
  else { DB.clients.push({id:uid(),...data,visits:0,score:0,at:now()}); audit('reserva',`agregó cliente ${name}`); }
  closeModal(); toast('Cliente guardado','ok'); render();
}
function setScore(cid,n){ const c=clientById(cid); if(!c) return; c.score=(c.score===n?n-1:n); audit('reserva',`puntuó a ${c.name} (${c.score})`); save(); render(); }
window.newReservModal=newReservModal; window.reservClientPick=reservClientPick; window.saveReserv=saveReserv; window.reservDetail=reservDetail;
window.editReservModal=editReservModal; window.setReservStatus=setReservStatus; window.delReserv=delReserv;
window.newClientModal=newClientModal; window.editClientModal=editClientModal; window.saveClient=saveClient; window.setScore=setScore;

/* =====================================================================
   SOUVENIRS  (inventario + ventas + ganancia)
   - Kenneth/Gerencia: ven costo, precio y ganancia; administran productos.
   - Jefe de salón / saloneros: solo venden y ven cuántos quedan (sin dinero).
===================================================================== */
let souvTab='vender';
const MGR_ROLES=['admin','gerencia_exp','gerencia_data'];
let svPayCur='CRC', svSellId=null, svCur='CRC';
function souvScoped(){ return (DB.souvenirs||[]).filter(p=>inScope(p.sucursalId)); }
function souvById(id){ return (DB.souvenirs||[]).find(p=>p.id===id); }
const souvProfit = p => (+p.price||0)-(+p.cost||0);
const souvLow = p => (+p.stock||0) <= (+p.minStock||0);
function souvSalesScoped(){ return (DB.souvSales||[]).filter(v=>inScope(v.sucursalId)); }
function souvFx(){ const f=+DB.souvFx; return f>0?f:(DB.souvFx=550); }
function setSouvFx(v){ const f=+v; if(f>0){ DB.souvFx=f; save(); render(); } }
function usd(colones){ return '$'+((+colones||0)/souvFx()).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}); }
window.setSouvFx=setSouvFx;

function viewSouvenir(){
  if(!canSouvView()) return emptyState('gift','Sin acceso','Esta sección no está disponible para tu puesto.');
  return canSouvMoney() ? souvManagerView() : souvSellerView();
}

/* ---- Cuadrícula para vender (la usan todos) ---- */
function souvSellGrid(){
  const money_=canSouvMoney();
  const list=souvScoped().slice().sort((a,b)=>a.name.localeCompare(b.name));
  if(!list.length) return emptyState('gift','Sin productos', money_?'Agregá tu primer souvenir con su costo y precio.':'Todavía no hay souvenirs cargados.', money_?'Nuevo producto':'', money_?'souvNewModal()':'');
  return `<div class="souv-grid">`+list.map(p=>{
    const out=(+p.stock||0)<=0;
    return `<div class="souv-card ${out?'out':''}">
      <div class="souv-ic">${svgIcon('gift','icon')}</div>
      <div class="souv-name">${esc(p.name)}</div>
      <div class="souv-price"><span class="sp-amt">${usd(p.price)}</span><span class="sp-usd">${money(p.price)}</span></div>
      <div class="souv-tags">
        <span class="souv-stock ${souvLow(p)&&!out?'low':''} ${out?'zero':''}">${out?'Agotado':'Quedan '+(+p.stock||0)}</span>
        ${money_?`<span class="souv-gan">Ganás ${money(souvProfit(p))} c/u</span>`:''}
      </div>
      <button class="btn btn-primary souv-sell-btn" ${out?'disabled':''} onclick="souvSellModal('${p.id}')">${svgIcon('plus','icon icon-sm')} Vender</button>
    </div>`;
  }).join('')+`</div>`;
}

/* ---- Vista vendedores (jefe de salón / saloneros): sin costo ni ganancia ---- */
function souvSellerView(){
  let html=`<div class="page-head"><div><div class="page-title">Souvenirs</div><div class="page-sub">Tocá un producto para vender · precio en ₡ y $</div></div></div>`;
  return html+souvSellGrid();
}

/* ---- Vista Gerencia: vender, inventario, ganancia, reportes ---- */
function souvManagerView(){
  const guide=sectionGuide('souvenir','¿Cómo funcionan los Souvenirs?',`
    Acá vendés y llevás el <b>inventario, los precios y la ganancia</b> de los souvenirs, en <b>colones y dólares</b>.
    <ul style="margin:8px 0 0 18px">
      <li>Poné el <b>tipo de cambio</b> arriba a la derecha; el sistema muestra todo en ₡ y $.</li>
      <li>Vos definís <b>costo</b> y <b>precio</b>; el sistema calcula tu <b>ganancia</b>.</li>
      <li>Al vender se <b>descuenta del inventario</b>; en <b>Reportes</b> ves gráficos de ventas y ganancia.</li>
      <li>Los saloneros venden y ven el <b>precio a cobrar</b>, pero no el costo ni la ganancia.</li>
    </ul>`);
  let html=`<div class="page-head"><div><div class="page-title">Souvenirs</div><div class="page-sub">Vender · inventario · ganancia · reportes</div></div>
    <div class="ph-spacer"></div>
    <div class="souv-fx" title="Tipo de cambio del dólar">$1 = ₡<input class="souv-fx-in" type="number" min="1" step="any" value="${souvFx()}" onchange="setSouvFx(this.value)"></div>
    <button class="btn btn-primary" style="flex:0 0 auto" onclick="souvNewModal()">${svgIcon('plus','icon icon-sm')} Nuevo producto</button></div>`;
  html+=guide;
  const tabs=[['vender','Vender'],['productos','Inventario'],['ventas','Reportes']];
  html+=`<div class="hor-modes">${tabs.map(([k,l])=>`<button class="chip ${souvTab===k?'on':''}" onclick="souvTab='${k}';render()">${l}</button>`).join('')}</div>`;
  html+= souvTab==='vender'?souvSellGrid() : souvTab==='ventas'?souvVentasView() : souvProductosView();
  return html;
}

function souvProductosView(){
  const list=souvScoped().slice().sort((a,b)=>a.name.localeCompare(b.name));
  const stockTot=list.reduce((s,p)=>s+(+p.stock||0),0);
  const valCost=list.reduce((s,p)=>s+(+p.stock||0)*(+p.cost||0),0);
  const gananciaPot=list.reduce((s,p)=>s+(+p.stock||0)*souvProfit(p),0);
  const lowN=list.filter(souvLow).length;
  let html=`<div class="kpi-row">
    <div class="kpi"><div class="label">Productos</div><div class="value">${list.length}</div><div class="sub">en catálogo</div></div>
    <div class="kpi ${lowN?'warn':''}"><div class="label">Unidades</div><div class="value">${stockTot}</div><div class="sub">${lowN?lowN+' por reabastecer':'en inventario'}</div></div>
    <div class="kpi"><div class="label">Invertido</div><div class="value">${money(valCost)}</div><div class="sub">${usd(valCost)}</div></div>
    <div class="kpi ok"><div class="label">Ganancia potencial</div><div class="value">${money(gananciaPot)}</div><div class="sub">${usd(gananciaPot)}</div></div>
  </div>`;
  if(!list.length) return html+emptyState('gift','Sin productos','Agregá tu primer souvenir con su costo y precio.','Nuevo producto','souvNewModal()');
  html+=`<div class="card" style="padding:0"><div class="tbl-wrap"><table class="tbl"><thead><tr>
    <th>Producto</th><th>Quedan</th><th>Mínimo</th><th>Costo</th><th>Precio</th><th>Ganancia c/u</th><th></th></tr></thead><tbody>`;
  html+=list.map(p=>`<tr>
    <td style="font-weight:600">${esc(p.name)}${souvLow(p)?` <span class="pill atrasada" style="margin-left:4px">Bajo</span>`:''}</td>
    <td><b>${+p.stock||0}</b></td>
    <td>${+p.minStock||0}</td>
    <td>${money(p.cost)}<span class="cur-usd">${usd(p.cost)}</span></td>
    <td>${money(p.price)}<span class="cur-usd">${usd(p.price)}</span></td>
    <td style="color:var(--success);font-weight:700">${money(souvProfit(p))}<span class="cur-usd">${usd(souvProfit(p))}</span></td>
    <td style="text-align:right;white-space:nowrap">
      <button class="btn btn-ghost" style="padding:6px 9px" onclick="souvSellModal('${p.id}')">Vender</button>
      <button class="btn btn-ghost" style="padding:6px 9px" onclick="souvStockModal('${p.id}')">Existencias</button>
      <button class="btn btn-ghost" style="padding:6px 9px" onclick="souvEditModal('${p.id}')">${svgIcon('edit','icon icon-sm')}</button>
    </td></tr>`).join('');
  html+=`</tbody></table></div></div>`;
  return html;
}

/* ---- Gráficos para gerencia ---- */
function souvCharts(sales){
  const today=new Date(); today.setHours(0,0,0,0);
  const days=[...Array(7)].map((_,i)=>{ const d=new Date(today); d.setDate(today.getDate()-(6-i)); return d; });
  const dayRev=days.map(d=>{ const key=d.toDateString();
    const rev=sales.filter(v=>new Date(v.at).toDateString()===key).reduce((s,v)=>s+(+v.price||0)*(+v.qty||0),0);
    return { lbl:d.toLocaleDateString('es-CR',{weekday:'short'}).replace('.',''), value:rev }; });
  const maxRev=Math.max(1,...dayRev.map(x=>x.value));
  const bars=dayRev.map((x,i)=>`<div class="cbar" title="${money(x.value)} · ${usd(x.value)}">
    <div class="cbar-val">${x.value?Math.round(x.value/1000)+'k':''}</div>
    <div class="cbar-track"><div class="cbar-fill${i===6?' today':''}" style="height:${Math.round(x.value/maxRev*100)}%"></div></div>
    <div class="cbar-lbl">${x.lbl}</div></div>`).join('');
  const byProd={};
  sales.forEach(v=>{ const g=((+v.price||0)-(+v.cost||0))*(+v.qty||0); byProd[v.name]=(byProd[v.name]||0)+g; });
  const top=Object.keys(byProd).map(n=>({name:n,g:byProd[n]})).sort((a,b)=>b.g-a.g).slice(0,5);
  const maxG=Math.max(1,...top.map(t=>t.g));
  const rows=top.map(t=>`<div class="chart-row"><span class="cr-name">${esc(t.name)}</span><div class="cr-track"><div class="cr-fill" style="width:${Math.max(4,Math.round(t.g/maxG*100))}%"></div></div><span class="cr-val">${money(t.g)}</span></div>`).join('')||'<div class="chart-empty">Sin datos todavía</div>';
  return `<div class="chart-grid">
    <div class="chartcard"><div class="chart-title">${svgIcon('trend','icon icon-sm')} Ventas últimos 7 días</div><div class="chart-bars">${bars}</div></div>
    <div class="chartcard"><div class="chart-title">${svgIcon('chart','icon icon-sm')} Top productos por ganancia</div><div class="chart-rows">${rows}</div></div>
  </div>`;
}

function souvVentasView(){
  const list=souvSalesScoped().slice().sort((a,b)=>b.at-a.at);
  const ingresos=list.reduce((s,v)=>s+(+v.price||0)*(+v.qty||0),0);
  const costos=list.reduce((s,v)=>s+(+v.cost||0)*(+v.qty||0),0);
  const ganancia=ingresos-costos;
  const unidades=list.reduce((s,v)=>s+(+v.qty||0),0);
  let html=`<div class="kpi-row">
    <div class="kpi"><div class="label">Ventas</div><div class="value">${list.length}</div><div class="sub">${unidades} unidades</div></div>
    <div class="kpi"><div class="label">Ingresos</div><div class="value">${money(ingresos)}</div><div class="sub">${usd(ingresos)}</div></div>
    <div class="kpi"><div class="label">Costo</div><div class="value">${money(costos)}</div><div class="sub">${usd(costos)}</div></div>
    <div class="kpi ok"><div class="label">Ganancia</div><div class="value">${money(ganancia)}</div><div class="sub">${usd(ganancia)}</div></div>
  </div>`;
  html+=souvCharts(list);
  if(!list.length) return html+emptyState('gift','Sin ventas todavía','Cuando se venda un souvenir, la venta y tu ganancia aparecen acá.');
  html+=`<div class="card" style="padding:0"><div class="tbl-wrap"><table class="tbl"><thead><tr>
    <th>Fecha</th><th>Producto</th><th>Cant.</th><th>Total</th><th>Ganancia</th><th>Pago</th><th>Vendió</th><th></th></tr></thead><tbody>`;
  html+=list.map(v=>{const u=userById(v.byId); const tot=(+v.price||0)*(+v.qty||0); const gan=((+v.price||0)-(+v.cost||0))*(+v.qty||0);
    return `<tr>
      <td>${fmtDateTime(v.at)}</td>
      <td style="font-weight:600">${esc(v.name)}</td>
      <td>${+v.qty||0}</td>
      <td><b>${money(tot)}</b><span class="cur-usd">${usd(tot)}</span></td>
      <td style="color:var(--success);font-weight:700">${money(gan)}</td>
      <td>${v.payCur==='USD'?'Dólares':'Colones'}</td>
      <td>${esc(u?u.name:'—')}</td>
      <td style="text-align:right;white-space:nowrap">
        <button class="icon-btn" style="width:32px;height:32px" title="Corregir venta" onclick="souvSaleEditModal('${v.id}')">${svgIcon('edit','icon icon-sm')}</button>
        <button class="icon-btn" style="width:32px;height:32px" title="Anular venta" onclick="souvDelSale('${v.id}')">${svgIcon('trash','icon icon-sm')}</button>
      </td>
    </tr>`;}).join('');
  html+=`</tbody></table></div></div>`;
  return html;
}

/* ---- Vender (modal ancho, ₡ y $, cantidad con + / −) ---- */
function souvSellModal(id){
  const p=souvById(id); if(!p) return;
  if((+p.stock||0)<=0){ toast('No quedan unidades de este producto','err'); return; }
  svSellId=id; svPayCur='CRC';
  openModal(`<div class="modal-head"><h3>Vender</h3><button class="modal-close" onclick="closeModal()">${svgIcon('x','icon')}</button></div>
    <div class="modal-body">
      <div class="souv-sellhead"><span class="souv-ic">${svgIcon('gift','icon')}</span><div><div class="souv-sellhead-n">${esc(p.name)}</div><div class="page-sub" style="margin:2px 0 0">Quedan <b>${+p.stock||0}</b> en inventario</div></div></div>
      <div class="field"><label>¿Cuántos vendés?</label>
        <div class="qty-step"><button type="button" onclick="souvQtyStep(-1)">−</button><input id="svQty" type="number" min="1" max="${+p.stock||0}" value="1" oninput="souvSellPreview()"><button type="button" onclick="souvQtyStep(1)">+</button></div>
      </div>
      <div class="souv-paycur"><span>¿Cómo paga?</span><div class="seg"><button type="button" class="seg-b on" id="svCurCRC" onclick="souvSetCur('CRC')">Colones ₡</button><button type="button" class="seg-b" id="svCurUSD" onclick="souvSetCur('USD')">Dólares $</button></div></div>
      <div class="souv-total" id="svSellRes"></div>
    </div>
    <div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">Cancelar</button><button class="btn btn-primary" onclick="souvSell('${p.id}')">${svgIcon('check','icon icon-sm')} Confirmar venta</button></div>`, true);
  souvSellPreview();
}
function souvQtyStep(d){ const el=$('#svQty'); if(!el)return; const p=souvById(svSellId); const mx=p?(+p.stock||1):1; let q=(parseInt(el.value,10)||1)+d; q=Math.max(1,Math.min(mx,q)); el.value=q; souvSellPreview(); }
function souvSetCur(c){ svPayCur=c; const a=$('#svCurCRC'),b=$('#svCurUSD'); if(a)a.classList.toggle('on',c==='CRC'); if(b)b.classList.toggle('on',c==='USD'); souvSellPreview(); }
function souvSellPreview(){
  const p=souvById(svSellId); const el=$('#svSellRes'); if(!p||!el) return;
  let q=parseInt(($('#svQty')||{}).value,10)||1; q=Math.max(1,Math.min(+p.stock||1,q));
  const totC=(+p.price||0)*q, totU=totC/souvFx();
  const primary = svPayCur==='USD' ? ('$'+totU.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})) : money(totC);
  const secondary = svPayCur==='USD' ? money(totC) : usd(totC);
  let h=`<div class="souv-total-lbl">A cobrar</div><div class="souv-total-big">${primary}</div><div class="souv-total-sub">${secondary}</div>`;
  if(canSouvMoney()){ h+=`<div class="souv-total-gan">Ganancia ${money(souvProfit(p)*q)}</div>`; }
  el.innerHTML=h;
}
function souvSell(id){
  const p=souvById(id); if(!p) return;
  let qty=parseInt($('#svQty').value,10); if(isNaN(qty)||qty<1)qty=1;
  if(qty>(+p.stock||0)){ toast('No hay suficientes unidades','err'); return; }
  p.stock=(+p.stock||0)-qty;
  const sale={id:uid(),productId:p.id,name:p.name,qty,price:+p.price||0,cost:+p.cost||0,payCur:svPayCur,fx:souvFx(),byId:SES.userId,sucursalId:p.sucursalId,at:now()};
  DB.souvSales.push(sale);
  audit('souvenir',`vendió ${qty}× ${p.name}`,p.sucursalId);
  const ingreso=sale.price*qty, ganancia=(sale.price-sale.cost)*qty;
  const seller=me()?me().name:'';
  notify(DB.users.filter(u=>MGR_ROLES.includes(u.role)).map(u=>u.id),
    `Venta souvenir: ${qty}× ${p.name} · ${money(ingreso)} (${usd(ingreso)}) · ganancia ${money(ganancia)}${seller?' · '+seller:''}`, 'gift', {view:'souvenir'});
  if(souvLow(p)){
    notify(DB.users.filter(u=>MGR_ROLES.includes(u.role)).map(u=>u.id),
      `Inventario bajo de souvenir: ${p.name} · quedan ${p.stock}`, 'gift', {view:'souvenir'});
  }
  closeModal();
  toast(canSouvMoney()?`Venta registrada · ganancia ${money(ganancia)}`:`Vendiste ${qty} · quedan ${p.stock}`,'ok');
  save(); render();
}

/* ---- Corregir / anular ventas (solo gerencia) ---- */
function souvSaleById(id){ return (DB.souvSales||[]).find(v=>v.id===id); }
function souvSaleEditModal(id){
  if(!canSouvMoney()) return;
  const v=souvSaleById(id); if(!v) return;
  const p=souvById(v.productId);
  const maxQty=(p?(+p.stock||0):0)+(+v.qty||0);
  openModal(`<div class="modal-head"><h3>${svgIcon('edit','icon')} Corregir venta</h3><button class="modal-close" onclick="closeModal()">${svgIcon('x','icon')}</button></div>
    <div class="modal-body">
      <div class="souv-sellhead"><span class="souv-ic">${svgIcon('gift','icon')}</span><div><div class="souv-sellhead-n">${esc(v.name)}</div><div class="page-sub" style="margin:2px 0 0">${fmtDateTime(v.at)}${p?` · quedan ${+p.stock||0} en inventario`:' · producto eliminado'}</div></div></div>
      <div class="row2">
        <div class="field"><label>Cantidad vendida</label><input class="input" id="seQty" type="number" min="1" max="${maxQty}" value="${+v.qty||0}"></div>
        <div class="field"><label>Precio unitario (₡)</label><input class="input" id="sePrice" type="number" min="0" step="any" value="${+v.price||0}"></div>
      </div>
      <div class="souv-sell-note">Al corregir la cantidad se ajusta el inventario automáticamente.</div>
    </div>
    <div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">Cancelar</button><button class="btn btn-primary" onclick="souvSaleSave('${v.id}')">${svgIcon('check','icon icon-sm')} Guardar cambios</button></div>`, true);
}
function souvSaleSave(id){
  const v=souvSaleById(id); if(!v) return;
  let newQty=parseInt($('#seQty').value,10); if(isNaN(newQty)||newQty<1)newQty=1;
  const newPrice=Math.max(0,+$('#sePrice').value||0);
  const p=souvById(v.productId);
  if(p){
    const diff=newQty-(+v.qty||0); // >0 vende más → descuenta del stock
    if(diff>0 && diff>(+p.stock||0)){ toast('No hay suficiente inventario para aumentar la cantidad','err'); return; }
    p.stock=Math.max(0,(+p.stock||0)-diff);
  }
  v.qty=newQty; v.price=newPrice;
  audit('souvenir',`corrigió venta de ${v.name} → ${newQty}× a ${money(newPrice)}`,v.sucursalId);
  closeModal(); toast('Venta corregida','ok'); save(); render();
}
async function souvDelSale(id){
  if(!canSouvMoney()) return;
  const v=souvSaleById(id); if(!v) return;
  if(!await confirmDialog(`Se anula la venta de ${(+v.qty||0)}× ${v.name} y se devuelve el inventario.`,{title:'¿Anular esta venta?',okText:'Sí, anular'})) return;
  const p=souvById(v.productId);
  if(p) p.stock=(+p.stock||0)+(+v.qty||0);
  tomb(id); DB.souvSales=DB.souvSales.filter(x=>x.id!==id);
  audit('souvenir',`anuló venta de ${(+v.qty||0)}× ${v.name}`,v.sucursalId);
  save(); render(); undoDelete('souvSales', v, 'Venta '+(v.name||''), ()=>{ const pp=souvById(v.productId); if(pp) pp.stock=Math.max(0,(+pp.stock||0)-(+v.qty||0)); });
}

/* ---- Alta / edición de producto (solo gerencia) ---- */
function souvNewModal(){ if(!canSouvMoney())return; svCur='CRC'; openModal(souvForm('Nuevo souvenir',null), true); }
function souvEditModal(id){ if(!canSouvMoney())return; svCur='CRC'; openModal(souvForm('Editar souvenir',souvById(id)), true); }
function souvForm(title,p){
  const sym='₡';
  return `<div class="modal-head"><h3>${svgIcon('gift','icon')} ${title}</h3><button class="modal-close" onclick="closeModal()">${svgIcon('x','icon')}</button></div>
  <div class="modal-body">
    <div class="field"><label>Nombre del producto</label><input class="input" id="svName" value="${p?esc(p.name):''}" placeholder="Taza, camiseta, salsa…" autofocus autocomplete="off"></div>
    <div class="ip-sec">${svgIcon('gift','icon icon-sm')} Inventario</div>
    <div class="row2">
      <div class="field"><label>Cantidad en existencia</label><input class="input" id="svStock" type="number" min="0" value="${p?(+p.stock||0):0}"></div>
      <div class="field"><label>Avisarme cuando queden</label><input class="input" id="svMin" type="number" min="0" value="${p?(+p.minStock||0):5}"></div>
    </div>
    <div class="ip-sec">${svgIcon('trend','icon icon-sm')} Precios y ganancia</div>
    <div class="souv-paycur" style="margin:0 0 12px"><span>Ingresar montos en</span><div class="seg"><button type="button" class="seg-b on" id="svCurC" onclick="souvFormCur('CRC')">Colones ₡</button><button type="button" class="seg-b" id="svCurD" onclick="souvFormCur('USD')">Dólares $</button></div></div>
    <div class="row2">
      <div class="field"><label id="svCostLbl">Costo por unidad (${sym})</label><input class="input" id="svCost" type="number" min="0" step="any" value="${p?(+p.cost||0):0}" oninput="souvGanPrev()"></div>
      <div class="field"><label id="svPriceLbl">Precio de venta (${sym})</label><input class="input" id="svPrice" type="number" min="0" step="any" value="${p?(+p.price||0):0}" oninput="souvGanPrev()"></div>
    </div>
    <div class="souv-ganbox" id="svGanPrev"></div>
    <div class="field"><label>Sucursal</label><select class="select" id="svSuc">${sucOptionsFor()}</select></div>
  </div>
  <div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">Cancelar</button><button class="btn btn-primary" onclick="saveSouv('${p?p.id:''}')">${svgIcon('check','icon icon-sm')} Guardar producto</button></div>`;
}
function souvFormCur(c){
  if(c===svCur) return;
  const fx=souvFx(), cE=$('#svCost'), pE=$('#svPrice');
  const conv = v => c==='USD' ? +(((+v||0)/fx).toFixed(2)) : Math.round((+v||0)*fx);
  if(cE) cE.value=conv(cE.value);
  if(pE) pE.value=conv(pE.value);
  svCur=c;
  const a=$('#svCurC'), b=$('#svCurD'); if(a)a.classList.toggle('on',c==='CRC'); if(b)b.classList.toggle('on',c==='USD');
  const sym=c==='USD'?'$':'₡';
  if($('#svCostLbl')) $('#svCostLbl').textContent='Costo por unidad ('+sym+')';
  if($('#svPriceLbl')) $('#svPriceLbl').textContent='Precio de venta ('+sym+')';
  souvGanPrev();
}
function souvFormColones(){
  const fx=souvFx();
  let c=Math.max(0,+($('#svCost')?$('#svCost').value:0)||0), pr=Math.max(0,+($('#svPrice')?$('#svPrice').value:0)||0);
  if(svCur==='USD'){ c=Math.round(c*fx); pr=Math.round(pr*fx); }
  return {cost:c, price:pr};
}
function souvGanPrev(){
  const el=$('#svGanPrev'); if(!el) return;
  const {cost,price}=souvFormColones(); const gan=price-cost;
  el.innerHTML=`<div class="souv-ganbox-row"><span>Ganancia por unidad</span><b style="color:var(--success)">${money(gan)} <span class="cur-usd">${usd(gan)}</span></b></div>
    <div class="souv-ganbox-row"><span>Precio de venta</span><b>${money(price)} <span class="cur-usd">${usd(price)}</span></b></div>
    <div class="souv-ganbox-row"><span>Costo</span><b>${money(cost)} <span class="cur-usd">${usd(cost)}</span></b></div>`;
}
function saveSouv(id){
  const name=$('#svName').value.trim(); if(!name){ toast('Poné el nombre del producto','err'); return; }
  const {cost,price}=souvFormColones();
  const data={ name, stock:Math.max(0,+$('#svStock').value||0), minStock:Math.max(0,+$('#svMin').value||0),
    cost, price, sucursalId:$('#svSuc').value };
  if(id){ const p=souvById(id); Object.assign(p,data); audit('souvenir',`editó souvenir ${name}`,data.sucursalId); }
  else { DB.souvenirs.push({id:uid(),...data,at:now()}); audit('souvenir',`agregó souvenir ${name}`,data.sucursalId); }
  closeModal(); toast('Producto guardado','ok'); save(); render();
}
function souvStockModal(id){
  if(!canSouvMoney())return; const p=souvById(id); if(!p) return;
  openModal(`<div class="modal-head"><h3>Reabastecer · ${esc(p.name)}</h3><button class="modal-close" onclick="closeModal()">${svgIcon('x','icon')}</button></div>
    <div class="modal-body">
      <div class="souv-sell-stock">Inventario actual: <b>${+p.stock||0}</b></div>
      <div class="field"><label>Agregar unidades</label><input class="input" id="svAdd" type="number" value="0" autofocus></div>
      <div style="font-size:12px;color:var(--text-soft)">Poné un número negativo para corregir hacia abajo.</div>
    </div>
    <div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">Cancelar</button><button class="btn btn-primary" onclick="souvAddStock('${p.id}')">Guardar</button></div>`);
}
function souvAddStock(id){
  const p=souvById(id); if(!p) return;
  const add=parseInt($('#svAdd').value,10)||0;
  p.stock=Math.max(0,(+p.stock||0)+add);
  audit('souvenir',`ajustó inventario de ${p.name} (${add>=0?'+':''}${add}) → ${p.stock}`,p.sucursalId);
  closeModal(); toast('Inventario actualizado','ok'); save(); render();
}
async function delSouv(id){
  if(!canSouvMoney())return; const p=souvById(id); if(!p) return;
  if(!await confirmDialog('Se elimina este souvenir del catálogo (las ventas ya registradas se conservan).',{title:'¿Eliminar producto?',okText:'Sí, eliminar'})) return;
  tomb(id); DB.souvenirs=DB.souvenirs.filter(x=>x.id!==id); audit('souvenir',`eliminó souvenir ${p.name}`,p.sucursalId);
  closeModal(); save(); render(); undoDelete('souvenirs', p, p.name);
}
window.viewSouvenir=viewSouvenir; window.souvSellModal=souvSellModal; window.souvSell=souvSell;
window.souvNewModal=souvNewModal; window.souvEditModal=souvEditModal; window.saveSouv=saveSouv;
window.souvStockModal=souvStockModal; window.souvAddStock=souvAddStock; window.delSouv=delSouv;
window.souvQtyStep=souvQtyStep; window.souvSetCur=souvSetCur; window.souvSellPreview=souvSellPreview; window.souvGanPrev=souvGanPrev; window.souvFormCur=souvFormCur;
window.souvSaleEditModal=souvSaleEditModal; window.souvSaleSave=souvSaleSave; window.souvDelSale=souvDelSale;

/* =====================================================================
   COMPONENTES COMUNES
   ===================================================================== */
function emptyState(ico,title,desc,btnText,btnAction){
  return `<div class="empty"><div class="em-ico"><svg class="icon" viewBox="0 0 24 24" style="width:40px;height:40px;stroke-width:1.5"><use href="#i-info"/></svg></div><div class="em-t">${esc(title)}</div><div class="em-d">${esc(desc)}</div>
    ${btnText?`<button class="btn btn-primary" style="display:inline-block;width:auto;padding:10px 18px" onclick="${btnAction}">${esc(btnText)}</button>`:''}</div>`;
}
const openGuides={};
function sectionGuide(key,title,bodyHtml){
  const open=openGuides[key];
  return `<div class="section-guide ${open?'open':''}" id="sg_${key}">
    <button class="sg-toggle" onclick="toggleGuide('${key}')">💡 ${esc(title)}<span class="chev">▾</span></button>
    <div class="sg-body"><div class="sg-inner"><div>${bodyHtml}</div></div></div></div>`;
}
window.toggleGuide=k=>{ openGuides[k]=!openGuides[k]; $('#sg_'+k).classList.toggle('open'); };

/* =====================================================================
   NOTIFICACIONES (panel)
   ===================================================================== */
$('#notifBtn').addEventListener('click',e=>{
  e.stopPropagation();
  $('#userMenu').classList.remove('on');
  const p=$('#notifPanel');
  const list=myNotifs().slice(0,30);
  p.innerHTML=de(`<div class="notif-head">Notificaciones <div class="ph-spacer" style="flex:1"></div>${list.length?`<button class="btn btn-ghost" style="padding:5px 10px;font-size:12px" onclick="markAllRead()">Marcar leídas</button>`:''}</div>`+
    (!pushIsOn()?`<button class="notif-cta" onclick="$('#notifPanel').classList.remove('on');pushSetupModal()">${svgIcon('bell','icon icon-sm')} Activar avisos en este equipo</button>`:'')+
    (list.length? list.map(n=>{const iv=({tareas:'check',pedidos:'box',inventario:'chart',horarios:'calendar',chat:'message',proyectos:'clipboard',reportes:'trend'})[(n.link&&n.link.view)]||'bell';
      return `<div class="notif-item ${n.read?'':'unread'}" onclick="openNotif('${n.id}')"><span class="ni-ico">${svgIcon(iv)}</span><div><div class="ni-t">${esc(n.text)}</div><div class="ni-time">${timeAgo(n.at)}</div></div></div>`;}).join('')
      : `<div class="empty" style="padding:30px"><div class="em-ico">${svgIcon('bell','icon icon-lg')}</div><div class="em-d">Sin notificaciones</div></div>`));
  p.classList.toggle('on');
});
function markAllRead(){ myNotifs().forEach(n=>n.read=true); save(); render(); $('#notifPanel').classList.remove('on'); }
window.markAllRead=markAllRead;
function openNotif(id){
  const n=DB.notifs.find(x=>x.id===id); if(!n) return;
  n.read=true; save();
  $('#notifPanel').classList.remove('on');
  if(n.link&&n.link.view){ SES.view=n.link.view; if(n.link.chatId)SES.activeChat=n.link.chatId; }
  render();
}
window.openNotif=openNotif;

/* user menu */
$('#userBtn').addEventListener('click',e=>{
  e.stopPropagation();
  $('#notifPanel').classList.remove('on');
  const m=$('#userMenu');
  m.innerHTML=`
    <div class="um-item" style="border-bottom:1px solid var(--border)">${avatarHTML(me())}<div><div style="font-weight:700">${esc(me().name)}</div><div style="font-size:11px;color:var(--text-soft)">${roleInfo(me().role).label}</div></div></div>
    <button class="um-item" onclick="pushSetupModal()">${svgIcon('bell')} Notificaciones ${pushIsOn()?'<span style="color:var(--success);margin-left:auto">✓</span>':'<span style="color:var(--text-soft);margin-left:auto">activar</span>'}</button>
    <button class="um-item" onclick="toggleTheme()">${svgIcon('theme')} Cambiar tema</button>
    <button class="um-item" onclick="screenDiag()">${svgIcon('info')} Diagnóstico de pantalla</button>
    <button class="um-item" style="color:var(--danger)" onclick="logout()">${svgIcon('logout')} Cerrar sesión</button>
    <div style="padding:8px 15px;font-size:10.5px;color:var(--text-dim);text-align:center;border-top:1px solid var(--border-soft)">${esc(APP_VERSION)}</div>`;
  m.classList.toggle('on');
});
document.addEventListener('click',()=>{ $('#notifPanel').classList.remove('on'); $('#userMenu').classList.remove('on'); });
$('#notifPanel').addEventListener('click',e=>e.stopPropagation());
$('#userMenu').addEventListener('click',e=>e.stopPropagation());

function toggleTheme(){
  const r=document.documentElement;
  const t=r.getAttribute('data-theme')==='dark'?'light':'dark';
  r.setAttribute('data-theme',t); localStorage.setItem('saborTico_theme',t);
  $('#userMenu').classList.remove('on');
}
window.toggleTheme=toggleTheme;

// Junta todos los ids de medios referenciados en la base (para incluirlos en el respaldo)
function collectMediaIds(db){
  const ids=new Set();
  const add=ref=>{ if(typeof ref==='string' && ref && !isDataUri(ref)) ids.add(ref); };
  (db.tasks||[]).forEach(t=>(t.images||[]).forEach(add));
  (db.projects||[]).forEach(p=>{
    (p.cards||[]).forEach(c=>{ if(c.img) add(c.img); if(c.file&&c.file.mid) add(c.file.mid); });
    (p.chat||[]).forEach(m=>{ if(m.media&&m.media.mid) add(m.media.mid); });
  });
  (db.chats||[]).forEach(c=>(c.msgs||[]).forEach(m=>{ if(m.media&&m.media.mid) add(m.media.mid); }));
  return [...ids];
}
async function exportData(){
  $('#userMenu').classList.remove('on');
  toast('Preparando respaldo…','ok');
  const ids=collectMediaIds(DB); const media={};
  for(const id of ids){ try{ const d=await fetchMediaData(id); if(d) media[id]=d; }catch(_){} }  // incluir las fotos/PDF
  const payload={ app:'saborTico', v:2, exportedAt:now(), data:DB, media };
  const blob=new Blob([JSON.stringify(payload)],{type:'application/json'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob);
  a.download='sabor-tico-respaldo-'+new Date().toISOString().slice(0,10)+'.json'; a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href),60000);
  toast('Respaldo descargado 💾 (incluye fotos)','ok');
}
window.exportData=exportData;

/* =====================================================================
   RESPALDO AUTOMÁTICO DIARIO (en este dispositivo)
   Guarda una copia con fecha una vez al día (las últimas 14). Es la red de
   seguridad para "deshacer una catástrofe": restaurar el estado de un día previo.
   No reemplaza el respaldo descargable (ese sí incluye las fotos y va fuera del equipo).
   ===================================================================== */
const BAK_PREFIX='sab_bak_', BAK_IDX='saborTico_bakindex', BAK_KEEP=14;
function _bakIndex(){ try{ return JSON.parse(localStorage.getItem(BAK_IDX)||'[]'); }catch(_){ return []; } }
function autoBackup(){
  if(!DB || !Array.isArray(DB.users) || !DB.users.length) return;
  const today=todayISO();
  let idx=_bakIndex();
  if(idx.includes(today)) return;                 // ya hay copia de hoy
  let saved=false;
  try{ localStorage.setItem(BAK_PREFIX+today, JSON.stringify(DB)); saved=true; }
  catch(_){ // sin espacio: borrar las más viejas y reintentar
    while(idx.length && !saved){ const old=idx.shift(); try{ localStorage.removeItem(BAK_PREFIX+old); }catch(__){} try{ localStorage.setItem(BAK_PREFIX+today, JSON.stringify(DB)); saved=true; }catch(__){} }
  }
  if(!saved) return;
  idx.push(today);
  while(idx.length>BAK_KEEP){ const old=idx.shift(); try{ localStorage.removeItem(BAK_PREFIX+old); }catch(_){} }  // conservar últimas 14
  try{ localStorage.setItem(BAK_IDX, JSON.stringify(idx)); }catch(_){}
}
function autoBackupsModal(){
  if(!isAdmin()){ toast('Solo Gerencia','err'); return; }
  $('#userMenu').classList.remove('on');
  const idx=_bakIndex().slice().reverse();
  const rows = idx.length ? idx.map(d=>{
    let kb=0; try{ kb=Math.round(((localStorage.getItem(BAK_PREFIX+d)||'').length)/1024); }catch(_){}
    return `<div class="log-item" style="display:flex;align-items:center;gap:10px">
      <div style="flex:1"><b>${esc(d)}</b> <span style="color:var(--text-soft);font-size:12px">· ${kb} KB</span></div>
      <button class="btn btn-ghost" style="padding:6px 10px;flex:0 0 auto" onclick="restoreAutoBackup('${esc(d)}')">Restaurar</button></div>`;
  }).join('') : '<div class="empty" style="padding:24px"><div class="em-d">Aún no hay respaldos automáticos. Se crea uno cada día al abrir la app.</div></div>';
  openModal(`<div class="modal-head"><h3>Respaldos automáticos</h3><button class="modal-close" onclick="closeModal()">${svgIcon('x','icon')}</button></div>
    <div class="modal-body">
      <p class="page-sub" style="margin-top:0">Copia diaria en este dispositivo (últimas ${BAK_KEEP}). Restaurar reemplaza los datos actuales en todos los dispositivos. Para una copia con fotos y fuera del equipo, usá “Respaldar datos”.</p>
      <div class="log">${rows}</div>
    </div>`, true);
}
async function restoreAutoBackup(date){
  if(!isAdmin()) return;
  let d; try{ d=JSON.parse(localStorage.getItem(BAK_PREFIX+date)||'null'); }catch(_){ d=null; }
  if(!d || !Array.isArray(d.users) || !d.users.length){ toast('Ese respaldo no se puede leer','err'); return; }
  if(!await confirmDialog('Esto REEMPLAZA todos los datos actuales (en todos los dispositivos) por la copia del '+date+'. No se puede deshacer.',{title:'¿Restaurar copia del '+date+'?',okText:'Sí, restaurar'})) return;
  try{ localStorage.setItem(DB_KEY+'_prevbackup', JSON.stringify(DB)); }catch(_){}
  DB=d; ensureCollections(); migrate(); save(); closeModal(); toast('Respaldo del '+date+' restaurado','ok'); render();
}
window.autoBackupsModal=autoBackupsModal; window.restoreAutoBackup=restoreAutoBackup;

function errorsModal(){
  if(!isAdmin()){ toast('Solo Gerencia','err'); return; }
  $('#userMenu').classList.remove('on');
  let arr=[]; try{ arr=JSON.parse(localStorage.getItem(ERRLOG_KEY)||'[]'); }catch(_){}
  const rows = arr.length ? arr.map(e=>`<div class="log-item"><div><b style="color:var(--danger)">${esc(e.kind)}</b> <span style="color:var(--text-soft);font-size:12px">· ${fmtDateTime(e.at)}${e.view?' · '+esc(e.view):''}</span></div><div style="font-size:13px;word-break:break-word">${esc(e.msg)}</div>${e.extra?`<div style="font-size:11px;color:var(--text-soft);word-break:break-word">${esc(e.extra)}</div>`:''}</div>`).join('') : '<div class="empty" style="padding:24px"><div class="em-d">Sin errores registrados. 🎉</div></div>';
  openModal(`<div class="modal-head"><h3>Errores recientes</h3><button class="modal-close" onclick="closeModal()">${svgIcon('x','icon')}</button></div>
    <div class="modal-body">
      <p class="page-sub" style="margin-top:0">Si algo falla, queda anotado acá (en este dispositivo). Sirve para diagnosticar.</p>
      <div class="log">${rows}</div>
      ${arr.length?`<button class="btn btn-ghost" style="margin-top:12px" onclick="clearErrors()">Borrar registro</button>`:''}
    </div>`, true);
}
function clearErrors(){ try{ localStorage.removeItem(ERRLOG_KEY); }catch(_){} closeModal(); toast('Registro de errores borrado','ok'); }
window.errorsModal=errorsModal; window.clearErrors=clearErrors;
// Recargar desde la nube: descarta lo local de ESTE dispositivo y vuelve a leer todo del servidor.
// Útil para limpiar duplicados/datos de ejemplo locales. No toca la nube.
async function reloadFromCloud(){
  if(!isAdmin()) return; if($('#userMenu')) $('#userMenu').classList.remove('on');
  if(!await confirmDialog('Descarta los datos locales de ESTE dispositivo y vuelve a leer todo desde la nube (sirve para limpiar duplicados/datos de ejemplo de este equipo). No afecta los datos en la nube. Hacelo con conexión.',{title:'¿Recargar desde la nube?',okText:'Sí, recargar'})) return;
  try{ localStorage.removeItem(DB_KEY); }catch(_){}
  location.reload();
}
window.reloadFromCloud=reloadFromCloud;
// Hacer de ESTE equipo la fuente: reemplaza TODA la nube por los datos de este dispositivo (set completo, sin unir).
// Usar desde el equipo que tiene los datos correctos; los demás luego usan "Recargar desde la nube".
async function pushOverwrite(){
  if(!isAdmin()) return; if($('#userMenu')) $('#userMenu').classList.remove('on');
  if(!cloudOn || !fbdb){ toast('No hay conexión a la nube (esperá a "Sincronizado")','err'); return; }
  if(!await confirmDialog('Esto REEMPLAZA todos los datos en la nube por los de ESTE dispositivo, para TODOS los equipos. Hacelo solo desde el equipo que tiene los datos correctos.',{title:'¿Subir y sobrescribir la nube?',okText:'Sí, sobrescribir'})) return;
  try{ stampEdits(); }catch(_){}
  try{ await fbdb.ref('state').set({ data:DB, client:CLIENT_ID, at:Date.now() }); rebuildEntSnap(); toast('Nube actualizada con los datos de este equipo ✓','ok'); }
  catch(e){ toast('No se pudo subir: '+((e&&e.code)||e),'err'); }
}
window.pushOverwrite=pushOverwrite;

/* ---- Búsqueda global (tareas, pedidos, reservas, inventario, personas…) ---- */
function globalSearchModal(){
  if($('#notifPanel')) $('#notifPanel').classList.remove('on'); if($('#userMenu')) $('#userMenu').classList.remove('on');
  openModal(`<div class="modal-head"><h3>Buscar</h3><button class="modal-close" onclick="closeModal()">${svgIcon('x','icon')}</button></div>
    <div class="modal-body">
      <input class="input" id="gsInput" placeholder="Buscar tareas, pedidos, reservas, productos, personas…" autocomplete="off" oninput="renderGlobalSearch()">
      <div id="gsResults" style="margin-top:14px"><div class="page-sub">Escribí al menos 2 letras…</div></div>
    </div>`, true);
  const i=$('#gsInput'); if(i) i.focus();
}
function gsItem(ico, title, sub, onclick){
  return `<button class="gs-row" onclick="${onclick}"><span class="gs-ico">${svgIcon(ico,'icon icon-sm')}</span><span class="gs-tx"><span class="gs-t">${esc(title)}</span>${sub?`<span class="gs-s">${esc(sub)}</span>`:''}</span></button>`;
}
function renderGlobalSearch(){
  const box=$('#gsResults'); if(!box) return;
  const q=($('#gsInput')?$('#gsInput').value:'').trim().toLowerCase();
  if(q.length<2){ box.innerHTML=`<div class="page-sub">Escribí al menos 2 letras…</div>`; return; }
  const hit=s=>String(s||'').toLowerCase().includes(q);
  const cv=v=>navAllowedIds(me()).includes(v);
  let html='';
  const tasks=(DB.tasks||[]).filter(t=>t&&visibleTask(t)&&inScope(t.sucursalId)&&(hit(t.title)||hit(t.desc))).slice(0,8);
  if(tasks.length) html+=`<div class="gs-group">Tareas</div>`+tasks.map(t=>gsItem('check',t.title,statusLabel(t.status),`gsGo('tareas','taskDetail','${t.id}')`)).join('');
  const peds=(DB.pedidos||[]).filter(p=>p&&inScope(p.sucursalId)&&(hit(p.item)||hit(p.desc))).slice(0,8);
  if(peds.length) html+=`<div class="gs-group">Pedidos</div>`+peds.map(p=>gsItem('box',p.item,pedInfo(p.area).short,`gsGo('pedidos','pedidoDetail','${p.id}')`)).join('');
  if(cv('reservas')){
    const rvs=(DB.reservations||[]).filter(r=>r&&inScope(r.sucursalId)&&hit(r.clientName)).slice(0,8);
    if(rvs.length) html+=`<div class="gs-group">Reservas</div>`+rvs.map(r=>gsItem('reserva',r.clientName,fmtResDate(r.resDate)+' '+fmt12(r.resTime),`gsGo('reservas','reservDetail','${r.id}')`)).join('');
    const cls=(DB.clients||[]).filter(c=>c&&hit(c.name)).slice(0,6);
    if(cls.length) html+=`<div class="gs-group">Clientes / Agencias</div>`+cls.map(c=>gsItem('users',c.name,c.type||'',`gsGo('reservas','','')`)).join('');
  }
  if(cv('inventario')){
    const inv=(DB.inventory||[]).filter(p=>p&&inScope(p.sucursalId)&&hit(p.name)).slice(0,8);
    if(inv.length) html+=`<div class="gs-group">Inventario</div>`+inv.map(p=>gsItem('box',p.name,p.stock+' '+p.unit,`gsGo('inventario','','')`)).join('');
  }
  if(cv('recetas')){
    const recs=(DB.recipes||[]).filter(r=>r&&hit(r.name)).slice(0,6);
    if(recs.length) html+=`<div class="gs-group">Recetas</div>`+recs.map(r=>gsItem('clipboard',r.name,'',`gsGo('recetas','','')`)).join('');
  }
  if(cv('equipo')){
    const ppl=(DB.users||[]).filter(u=>u&&u.active&&inScope(u.sucursalId)&&hit(u.name)).slice(0,6);
    if(ppl.length) html+=`<div class="gs-group">Personas</div>`+ppl.map(u=>gsItem('users',u.name,roleInfo(u.role).short,`gsGo('equipo','','')`)).join('');
  }
  if(cv('souvenir')){
    const sv=(DB.souvenirs||[]).filter(p=>p&&inScope(p.sucursalId)&&hit(p.name)).slice(0,6);
    if(sv.length) html+=`<div class="gs-group">Souvenirs</div>`+sv.map(p=>gsItem('box',p.name,'',`gsGo('souvenir','','')`)).join('');
  }
  box.innerHTML = html || `<div class="empty" style="padding:24px"><div class="em-ico">${svgIcon('search','icon icon-lg')}</div><div class="em-d">Nada encontrado para "${esc(q)}"</div></div>`;
}
function gsGo(view, detailFn, id){
  closeModal();
  if(view){ SES.view=view; render(); }
  if(detailFn && id && typeof window[detailFn]==='function'){ try{ window[detailFn](id); }catch(_){} }
}
window.globalSearchModal=globalSearchModal; window.renderGlobalSearch=renderGlobalSearch; window.gsGo=gsGo;

/* =====================================================================
   SUCURSAL switch
   ===================================================================== */
function toggleSucMenu(e){
  if(e) e.stopPropagation();
  if(!isAdmin()) return;
  const sw=$('#sucSwitch'), menu=$('#sucMenu'); if(!sw||!menu) return;
  if(sw.classList.contains('open')){ sw.classList.remove('open'); return; }
  const groups=[{id:'all',name:'Todas las sucursales'},...(DB.sucursales||[])];
  menu.innerHTML=groups.map(g=>`<button type="button" class="suc-opt ${SES.sucFilter===g.id?'on':''}" onclick="pickSuc('${g.id}')"><svg class="icon icon-sm" viewBox="0 0 24 24"><use href="#i-pin"/></svg>${esc(g.name)}<svg class="icon icon-sm suc-check" viewBox="0 0 24 24"><use href="#i-check"/></svg></button>`).join('');
  sw.classList.add('open');
}
function pickSuc(id){ SES.sucFilter=id; const sw=$('#sucSwitch'); if(sw) sw.classList.remove('open'); render(); }
window.toggleSucMenu=toggleSucMenu; window.pickSuc=pickSuc;
document.addEventListener('click',e=>{ const sw=$('#sucSwitch'); if(sw && sw.classList.contains('open') && !sw.contains(e.target)) sw.classList.remove('open'); });

/* =====================================================================
   LOGIN
   ===================================================================== */
let pickedUser=null, loginSuc=null;
// "Recordarme": por defecto activo; recuerda la última preferencia del usuario
let loginRemember = localStorage.getItem('saborTico_remember')!=='0';
function renderLogin(){
  ensureCollections();
  const area=$('#loginArea'); if(!area) return;
  const sucs=DB.sucursales||[];
  // Sin conexión a la nube y sin datos: avisar claro (NO mostrar datos de ejemplo inventados)
  if(_cloudFailed && !sucs.length && !(DB.users||[]).length){
    area.innerHTML=`<div class="login-label">Sin conexión a la nube</div>
      <div class="login-hint" style="text-align:left;line-height:1.7">No se pudo conectar a la base. Suele ser porque el dominio no está autorizado en Firebase (Authentication → Settings → Authorized domains) o no está activado el inicio anónimo. Revisá tu internet y la configuración (ver docs/SEGURIDAD.md).</div>
      <button class="btn btn-primary" style="width:100%;margin-top:14px" onclick="location.reload()">Reintentar</button>`;
    return;
  }
  // Paso 1: elegir sucursal (si hay más de una)
  if(!loginSuc && sucs.length>1){
    area.innerHTML=`<div class="login-label">Elegí la sucursal</div>
      <div class="suc-pick">${sucs.map(s=>`<button class="suc-card" onclick="pickLoginSuc('${s.id}')">${svgIcon('pin')} ${esc(s.name)}</button>`).join('')}</div>
      <div class="login-hint">Cada quien entra con su nombre y su PIN personal. No compartás tu PIN.</div>`;
    return;
  }
  if(!loginSuc && sucs.length===1) loginSuc=sucs[0].id;
  // Paso 2: elegir persona (de la sucursal + globales), AGRUPADA por departamento, y PIN
  const ppl=DB.users.filter(u=>u.active && (u.sucursalId===loginSuc || u.sucursalId==='all')).sort(byDept);
  let _lastDept=null;
  const userGrid = ppl.length ? ppl.map(u=>{
    const d=deptLabel(u.role); let hdr='';
    if(d!==_lastDept){ hdr=`<div class="lg-group">${esc(d)}</div>`; _lastDept=d; }
    return hdr+`<button class="user-pick ${pickedUser===u.id?'sel':''}" data-id="${u.id}" onclick="pickUser('${u.id}')">${avatarHTML(u)}<div><div class="nm">${esc((u.name||'').split(' ')[0])}</div><div class="rl">${roleInfo(u.role).short}</div></div></button>`;
  }).join('') : '<div style="color:var(--text-soft);font-size:13px;padding:8px;grid-column:1/-1">No hay personas en esta sucursal todavía.</div>';
  area.innerHTML=`${sucs.length>1?`<button class="login-back" onclick="loginSuc=null;pickedUser=null;renderLogin()">${svgIcon('back','icon icon-sm')} Cambiar sucursal</button>`:''}
    <div class="login-label">¿Quién sos?${sucs.length>1?' · '+esc(sucName(loginSuc)):''}</div>
    <div class="user-grid">${userGrid}</div>
    <div class="login-label">Tu PIN</div>
    <div class="pin-row"><input id="pinInput" type="password" inputmode="numeric" maxlength="4" placeholder="••••"></div>
    <label class="login-remember"><input type="checkbox" id="rememberMe" ${loginRemember?'checked':''}>
      <span class="lr-txt"><span class="lr-t">Mantener sesión iniciada</span><span class="lr-d">No tener que poner el PIN cada vez. Desmarcá en equipos compartidos.</span></span></label>
    <button class="btn btn-primary" id="loginBtn" style="width:100%">Entrar</button>`;
  const lb=$('#loginBtn'); if(lb) lb.onclick=doLogin;
  const pi=$('#pinInput'); if(pi) pi.onkeydown=e=>{ if(e.key==='Enter') doLogin(); };
}
function pickLoginSuc(id){ loginSuc=id; pickedUser=null; renderLogin(); }
window.pickLoginSuc=pickLoginSuc;
function pickUser(id){
  pickedUser=id;
  document.querySelectorAll('.user-pick').forEach(b=>b.classList.toggle('sel',b.dataset.id===id));
  const pi=$('#pinInput'); if(pi) pi.focus();
}
window.pickUser=pickUser;
async function doLogin(){
  if(!pickedUser){ toast('Elegí quién sos','err'); return; }
  const u=userById(pickedUser);
  if(!u){ toast('Elegí quién sos','err'); return; }
  const lockMs=loginLockedUntil()-now();
  if(lockMs>0){ toast('Demasiados intentos. Esperá '+Math.ceil(lockMs/60000)+' min.','err'); return; }
  const pin=($('#pinInput')?$('#pinInput').value:'')||'';
  const okPin=await verifyPin(u,pin);
  if(!okPin){ registerLoginFail(); toast('PIN incorrecto','err'); return; }
  clearLoginFails();
  // Subir PIN viejo en texto a hash de forma transparente
  if(!u.pinHash && (self.crypto&&crypto.subtle)){ try{ await setUserPin(u,pin); save(); }catch(_){} }
  SES.userId=u.id; SES.sucFilter='all'; SES.view='inicio';
  const keep = $('#rememberMe') ? $('#rememberMe').checked : loginRemember;
  loginRemember = keep;
  localStorage.setItem('saborTico_remember', keep?'1':'0');
  if(keep){ localStorage.setItem('saborTico_ses',u.id); sessionStorage.removeItem('saborTico_ses'); }
  else { sessionStorage.setItem('saborTico_ses',u.id); localStorage.removeItem('saborTico_ses'); }
  unlockAudio();              // habilitar el sonido de notificaciones con este gesto
  notifBaseline();           // no avisar el historial viejo, solo lo nuevo
  $('#loginScreen').style.display='none';
  $('#app').classList.add('on');
  toast('Bienvenido, '+(u.name||'').split(' ')[0],'ok');
  render();
  maybeForcePinChange();
}
window.doLogin=doLogin;

/* Si el admin creó al usuario con PIN temporal, lo obligamos a definir el suyo al entrar */
function maybeForcePinChange(){
  const u=me(); if(!u || !u.mustChangePin) return;
  openModal(`<div class="modal-head"><h3>Definí tu PIN</h3></div>
    <div class="modal-body">
      <p class="page-sub" style="margin-top:0">Por seguridad, elegí un PIN nuevo de 4 dígitos. No lo compartás con nadie.</p>
      <div class="field"><label>Nuevo PIN (4 dígitos)</label><input class="input" id="fpcPin" type="password" inputmode="numeric" maxlength="4" placeholder="••••"></div>
      <div class="field"><label>Repetir PIN</label><input class="input" id="fpcPin2" type="password" inputmode="numeric" maxlength="4" placeholder="••••"></div>
    </div>
    <div class="modal-foot"><button class="btn btn-primary" style="width:100%" onclick="saveForcedPin()">Guardar mi PIN</button></div>`);
}
async function saveForcedPin(){
  const p=($('#fpcPin')?$('#fpcPin').value:'')||'', p2=($('#fpcPin2')?$('#fpcPin2').value:'')||'';
  if(!/^\d{4}$/.test(p)){ toast('El PIN debe ser de 4 dígitos','err'); return; }
  if(p!==p2){ toast('Los PIN no coinciden','err'); return; }
  if(p==='1234'||p==='0000'||p==='1111'){ toast('Elegí un PIN menos obvio','err'); return; }
  const u=me(); if(!u) return;
  await setUserPin(u,p); delete u.mustChangePin; save();
  closeModal(); toast('PIN actualizado','ok'); render();
}
window.saveForcedPin=saveForcedPin;

function logout(){
  SES.userId=null; sessionStorage.removeItem('saborTico_ses'); localStorage.removeItem('saborTico_ses');
  $('#app').classList.remove('on'); $('#loginScreen').style.display='flex';
  pickedUser=null; loginSuc=null; renderLogin();
}
window.logout=logout;

/* import */
const impInput=document.createElement('input'); impInput.type='file'; impInput.id='importFile'; impInput.accept='.json'; impInput.style.display='none';
document.body.appendChild(impInput);
impInput.addEventListener('change',async e=>{
  const f=e.target.files[0]; e.target.value=''; if(!f) return;          // permitir re-importar el mismo archivo
  if(!isAdmin()){ toast('Solo Gerencia puede restaurar respaldos','err'); return; }
  if(f.size>80*1024*1024){ toast('El archivo es demasiado grande','err'); return; }
  let raw; try{ raw=JSON.parse(await f.text()); }catch(_){ toast('Ese archivo no me sirve','err'); return; }
  // Formato nuevo {v:2, data, media} o respaldo viejo (la base directa con data: inline)
  const d = (raw && raw.data && Array.isArray(raw.data.users)) ? raw.data : raw;
  const media = (raw && raw.media && typeof raw.media==='object') ? raw.media : null;
  if(!d || typeof d!=='object' || !Array.isArray(d.users) || d.users.length===0){ toast('Ese respaldo no tiene el formato correcto','err'); return; }
  if(!await confirmDialog('Esto REEMPLAZA todos los datos actuales (en todos los dispositivos) por los del archivo "'+(f.name||'respaldo')+'". No se puede deshacer.',{title:'¿Restaurar respaldo?',okText:'Sí, restaurar'})) return;
  try{ localStorage.setItem(DB_KEY+'_prevbackup', JSON.stringify(DB)); }catch(_){}  // copia de seguridad por si acaso
  // Restaurar los medios (fotos/PDF) conservando sus ids originales
  if(media){
    for(const id in media){ const uri=media[id]; if(!isDataUri(uri)) continue; mediaCache[id]=uri;
      if(cloudOn && fbdb){ try{ await fbdb.ref('media/'+id).set(uri); }catch(_){ try{ localStorage.setItem(MEDIA_LS+id,uri); }catch(__){} } }
      else { try{ localStorage.setItem(MEDIA_LS+id,uri); }catch(_){} }
    }
  }
  DB=d; ensureCollections(); migrate(); save(); toast('Respaldo restaurado','ok'); render();
});

/* =====================================================================
   INIT
   ===================================================================== */
(async function init(){
  const t=localStorage.getItem('saborTico_theme');
  if(t) document.documentElement.setAttribute('data-theme',t);
  else { try{ const dark=window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches; document.documentElement.setAttribute('data-theme', dark?'dark':'light'); }catch(_){} }
  let ok=false; try{ ok=await cloudInit(); }catch(e){ console.warn('cloud init', e); }
  if(!ok) load();
  try{ await migratePins(); }catch(_){}   // pasar PIN viejos en texto a hash, una sola vez
  try{ autoBackup(); }catch(_){}          // copia diaria automática (red de seguridad)
  renderLogin();
  const ses=localStorage.getItem('saborTico_ses')||sessionStorage.getItem('saborTico_ses');
  if(ses && userById(ses)){ SES.userId=ses; notifBaseline(); $('#loginScreen').style.display='none'; $('#app').classList.add('on'); render(); maybeForcePinChange(); }
  requestAnimationFrame(()=>requestAnimationFrame(()=>document.body.classList.remove('app-loading')));
})();

/* =====================================================================
   NOTIFICACIONES PUSH (Web Push / VAPID) — avisos al celular aunque la app
   esté cerrada (tareas, mensajes). La llave privada vive en Vercel (api/push.js).
   iOS: requiere "Agregar a pantalla de inicio" (iOS 16.4+) y dar permiso.
   ===================================================================== */
const PUSH_DEV_KEY='st_push_dev', PUSH_ON_KEY='st_push_on';
const VAPID_PUBLIC='BAKaPV-0DcQFy9AqV75Zsbr4YMirfgZczA1rosU-LDqPvOfwMNgiEDOVPcRyGiXj0XtQngxvmzfoAi2sHmGlx_Y';  // pública (no secreta) — respaldo si falla el fetch
let _pushKey=null, _pushRefreshed=false, _pushGoView='';
function pushSupported(){ return ('serviceWorker' in navigator) && ('PushManager' in window) && ('Notification' in window) && location.protocol.indexOf('http')===0; }
function pushIsOn(){ try{ return pushSupported() && Notification.permission==='granted' && localStorage.getItem(PUSH_ON_KEY)==='1'; }catch(_){ return false; } }
function pushDeviceId(){ let id=''; try{ id=localStorage.getItem(PUSH_DEV_KEY)||''; }catch(_){}; if(!id){ id=uid(); try{ localStorage.setItem(PUSH_DEV_KEY,id); }catch(_){} } return id; }
function urlB64ToUint8(b64){ const pad='='.repeat((4-b64.length%4)%4); const s=(b64+pad).replace(/-/g,'+').replace(/_/g,'/'); const raw=atob(s); const out=new Uint8Array(raw.length); for(let i=0;i<raw.length;i++) out[i]=raw.charCodeAt(i); return out; }
async function pushGetKey(){ if(_pushKey) return _pushKey; try{ const r=await fetch('/api/push?action=key'); const j=await r.json(); if(j&&j.key){ _pushKey=j.key; return j.key; } }catch(_){} return VAPID_PUBLIC; }
function pushRef(){ return String(FB.databaseURL||'').replace(/\/$/,'')+'/push/'+encodeURIComponent(me().id)+'/'+encodeURIComponent(pushDeviceId())+'.json'; }
async function pushStore(sub){
  if(!me()) return false;
  const rec={ sub: sub.toJSON(), at: now(), name:(me().name||''), ua:(navigator.userAgent||'').slice(0,120) };
  // HTTPS (REST) primero: guarda la suscripción aunque el WebSocket esté bloqueado (VPN/antivirus).
  try{ const t=await cloudToken(); if(t){ const r=await fetch(pushRef()+'?auth='+t, {method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify(rec)}); if(r.ok) return true; } }catch(_){}
  // Respaldo por SDK si REST no estaba disponible
  try{ if(cloudOn&&fbdb){ await fbdb.ref('push/'+me().id+'/'+pushDeviceId()).set(rec); return true; } }catch(e){ console.warn('pushStore', e&&e.code); }
  return false;
}
function pushIsIOS(){ return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform==='MacIntel' && navigator.maxTouchPoints>1); }
function pushIsStandalone(){ try{ return window.navigator.standalone===true || (window.matchMedia && matchMedia('(display-mode: standalone)').matches); }catch(_){ return false; } }
async function pushEnable(){
  if(pushIsIOS() && !pushIsStandalone()){ toast('En iPhone: tocá Compartir → "Agregar a inicio", abrí la app desde ese ícono y ahí activá las notificaciones.','err'); return false; }
  if(!pushSupported()){ toast('Este navegador no permite notificaciones. En iPhone: agregá la app a la pantalla de inicio.','err'); return false; }
  let perm=Notification.permission;
  if(perm!=='granted'){ try{ perm=await Notification.requestPermission(); }catch(_){} }
  if(perm!=='granted'){ toast('Permiso de notificaciones denegado','err'); return false; }
  const key=await pushGetKey();
  if(!key){ toast('Las notificaciones aún no están configuradas en el servidor','err'); return false; }
  try{
    const reg=await navigator.serviceWorker.ready;
    let sub=await reg.pushManager.getSubscription();
    if(!sub) sub=await reg.pushManager.subscribe({ userVisibleOnly:true, applicationServerKey:urlB64ToUint8(key) });
    const stored = await pushStore(sub);
    if(!stored){ toast('Permiso dado, pero no se pudo guardar la suscripción. Falta publicar la rama "push" en las reglas de Firebase.','err'); return false; }
    try{ localStorage.setItem(PUSH_ON_KEY,'1'); }catch(_){}
    toast('Notificaciones activadas en este equipo ✓','ok');
    return true;
  }catch(e){ console.warn('push subscribe', e); toast('No se pudo activar. En iPhone agregá la app a la pantalla de inicio y volvé a intentar.','err'); return false; }
}
async function pushDisable(){
  try{ const reg=await navigator.serviceWorker.ready; const sub=await reg.pushManager.getSubscription(); if(sub) await sub.unsubscribe(); }catch(_){}
  if(me()){ try{ const t=await cloudToken(); if(t) await fetch(pushRef()+'?auth='+t, {method:'DELETE'}); }catch(_){}
    try{ if(cloudOn&&fbdb) await fbdb.ref('push/'+me().id+'/'+pushDeviceId()).remove(); }catch(_){} }
  try{ localStorage.setItem(PUSH_ON_KEY,'0'); }catch(_){}
  toast('Notificaciones desactivadas en este equipo','ok');
}
async function pushToggle(){ const m=$('#userMenu'); if(m) m.classList.remove('on'); if(pushIsOn()) await pushDisable(); else await pushEnable(); }
async function pushTest(){
  const m=$('#userMenu'); if(m) m.classList.remove('on');
  if(!pushIsOn()){ const ok=await pushEnable(); if(!ok) return; }
  if(!cloudOn || !window.firebase || !firebase.auth || !firebase.auth().currentUser){ toast('Necesitás conexión a la nube para probar','err'); return; }
  toast('Enviando aviso de prueba…','ok');
  try{
    const token=await firebase.auth().currentUser.getIdToken();
    const r=await fetch('/api/push',{ method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({ token, to:[me().id], title:'Sabor Tico ✓', body:'¡Las notificaciones funcionan! 🎉', url:'./', tag:'prueba' }) });
    const j=await r.json().catch(()=>({}));
    if(j&&j.ok&&j.sent>0) toast('Aviso enviado ✓ — debería llegarte en unos segundos','ok');
    else if(j&&j.ok) toast('Sin suscripción guardada. Falta publicar la rama "push" en las reglas de Firebase (después reactivá).','err');
    else toast('No se pudo enviar'+(j&&j.error?': '+j.error:' (revisá VAPID_PRIVATE_KEY en Vercel)'),'err');
  }catch(_){ toast('Error al enviar la prueba','err'); }
}
window.pushEnable=pushEnable; window.pushDisable=pushDisable; window.pushToggle=pushToggle; window.pushTest=pushTest;
/* Panel de configuración de notificaciones: estado claro + botón + guía por dispositivo. */
function pushSetupModal(){
  const m=$('#userMenu'); if(m) m.classList.remove('on');
  const on=pushIsOn();
  const iosNoInstall = pushIsIOS() && !pushIsStandalone();
  const noSup = !pushSupported();
  let cuerpo;
  if(iosNoInstall){
    cuerpo=`<div class="pn-step"><b>En iPhone, primero instalá la app:</b>
      <ol style="margin:8px 0 0 18px;line-height:1.9">
        <li>Tocá el botón <b>Compartir</b> ${svgIcon('box','icon icon-sm')} (abajo, en Safari).</li>
        <li>Elegí <b>“Agregar a inicio”</b>.</li>
        <li>Abrí la app desde ese <b>ícono nuevo</b> (no desde Safari).</li>
        <li>Volvé acá y tocá <b>Activar</b>.</li>
      </ol>
      <div class="td-empty" style="margin-top:8px">Apple solo permite avisos en apps agregadas a inicio. Una sola vez.</div></div>`;
  } else if(noSup){
    cuerpo=`<div class="td-empty">Este navegador no permite avisos. Usá Chrome/Edge en compu, o en iPhone agregá la app a la pantalla de inicio.</div>`;
  } else {
    cuerpo=`<div class="pn-status ${on?'on':''}">${on?'✅ <b>Activadas</b> en este equipo':'🔕 <b>Desactivadas</b> en este equipo'}</div>
      <div class="td-empty" style="margin:8px 0 4px">Recibís avisos de <b>tareas y mensajes</b> aunque la app esté cerrada. Se activa <b>en cada equipo/celular</b> por separado.</div>
      <div class="pn-btns">
        ${on
          ? `<button class="btn btn-primary" onclick="pushTest();closeModal()">${svgIcon('send','icon icon-sm')} Enviarme una prueba</button>
             <button class="btn btn-ghost" onclick="pushDisable().then(()=>{closeModal();})">Desactivar aquí</button>`
          : `<button class="btn btn-primary" onclick="pushEnable().then(ok=>{ if(ok){ pushTest(); } closeModal(); })">${svgIcon('bell','icon icon-sm')} Activar en este equipo</button>`}
      </div>`;
  }
  openModal(`
    <div class="modal-head"><h3>${svgIcon('bell','icon')} Notificaciones</h3><button class="modal-close" onclick="closeModal()">${svgIcon('x','icon')}</button></div>
    <div class="modal-body">${cuerpo}</div>`, false);
}
window.pushSetupModal=pushSetupModal;
// Tras login: aplicar deep-link de una notificación y re-guardar la suscripción bajo el usuario actual
async function pushRefreshOnce(){
  if(_pushRefreshed || !me()) return; _pushRefreshed=true;
  try{ if(_pushGoView){ const v=_pushGoView; _pushGoView=''; if(navAllowedIds(me()).includes(v)){ SES.view=v; setTimeout(render,0); } } }catch(_){}
  if(!pushSupported() || Notification.permission!=='granted' || localStorage.getItem(PUSH_ON_KEY)!=='1') return;
  try{ const reg=await navigator.serviceWorker.ready; const sub=await reg.pushManager.getSubscription(); if(sub) await pushStore(sub); }catch(_){}
}
// Envía el aviso real a los destinatarios (lo dispara notify desde el equipo del remitente)
async function sendPush(userIds, text, link){
  try{
    if(!cloudOn || !window.firebase || !firebase.auth || !firebase.auth().currentUser) return;
    const to=(Array.isArray(userIds)?userIds:[userIds]).filter(u=>u&&u!==SES.userId);
    if(!to.length) return;
    const token=await firebase.auth().currentUser.getIdToken();
    await fetch('/api/push',{ method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({ token, to, title:'Sabor Tico', body:String(text||'').slice(0,180), url:'./?go='+encodeURIComponent((link&&link.view)||''), tag:(link&&link.view)||'' }) });
  }catch(_){}
}
try{ _pushGoView=new URLSearchParams(location.search).get('go')||''; if(_pushGoView){ history.replaceState(null,'',location.pathname); } }catch(_){}

/* Ajuste al teclado del celular: el área realmente visible (visualViewport) define el alto de
   la app. Así el chat llena la pantalla y el cuadro de escribir queda PEGADO al teclado, sin
   huecos. Cuando el teclado se cierra, vuelve a pantalla completa. */
(function(){
  const vv = window.visualViewport; if(!vv) return;
  const root = document.documentElement;
  let raf=0;
  function editing(){ const ae=document.activeElement; return !!(ae && (/INPUT|TEXTAREA/.test(ae.tagName) || ae.isContentEditable)); }
  let baseH = 0;   // alto con teclado cerrado (para detectar cuándo está abierto)
  function apply(){ raf=0;
    root.style.setProperty('--app-h', Math.round(vv.height) + 'px');
    // offsetTop negativo = rebote elástico de iOS (rubber-band): NO seguirlo,
    // si no el contenido se mueve al revés del dedo.
    root.style.setProperty('--app-top', Math.max(0, Math.round(vv.offsetTop)) + 'px');
    // TECLADO ABIERTO: el teclado ya cubre la zona de la barrita de inicio del iPhone,
    // así que el colchón de safe-area bajo el composer/pie sobra y deja un hueco → quitarlo.
    if(!editing() && vv.height > baseH) baseH = vv.height;
    document.body.classList.toggle('kb-open', editing() && baseH > 0 && vv.height < baseH - 110);
    // iOS "revela" el campo enfocado scrolleando el documento; como la app es fija y se
    // acomoda sola, ese scroll solo crea un HUECO entre el teclado y el cuadro de escribir.
    if(editing() && (window.scrollY||window.pageYOffset)>0){ try{ window.scrollTo(0,0); }catch(_){} }
    // ANCHO: si Safari quedó con la página encogida (zoom viejo pegado en la pestaña),
    // la app se estira para cubrir TODO lo visible también a lo ancho (sin bandas negras).
    const s = vv.scale || 1;
    if(s < 0.995){
      root.style.setProperty('--app-w', Math.round(vv.width) + 'px');
      root.style.setProperty('--app-left', Math.round(vv.offsetLeft) + 'px');
    } else {
      root.style.setProperty('--app-w', '100%');
      root.style.setProperty('--app-left', '0px');
    }
  }
  function onChange(){ if(!raf) raf=requestAnimationFrame(apply); }
  vv.addEventListener('resize', onChange);
  vv.addEventListener('scroll', onChange);
  window.addEventListener('orientationchange', ()=>{ baseH=0; setTimeout(apply,300); });
  window.addEventListener('pageshow', ()=>setTimeout(apply,50));   // Safari restaurando la pestaña
  window.addEventListener('scroll', ()=>{ if(editing() && (window.scrollY||window.pageYOffset)>0){ try{ window.scrollTo(0,0); }catch(_){} } }, {passive:true});
  // el teclado de iOS anima ~300ms y luego acomoda la barra: re-aplicar varias veces
  document.addEventListener('focusin', e=>{
    setTimeout(apply,80); setTimeout(apply,260); setTimeout(apply,550);
    // en el chat: que el último mensaje quede visible sobre el teclado
    if(e.target && (e.target.id==='chatField'||e.target.id==='projMsg')){
      setTimeout(()=>{ const m=document.getElementById(e.target.id==='projMsg'?'projChatMsgs':'chatMsgs'); if(m && !m._tch) m.scrollTop=m.scrollHeight; }, 380);
    }
  });
  document.addEventListener('focusout', ()=>{ setTimeout(apply,80); setTimeout(apply,300); });
  apply();

  /* CURA del zoom pegado: Safari restaura la escala guardada de la pestaña (página encogida
     con bandas negras) aunque el meta viewport diga escala fija. Re-escribir el meta en
     runtime obliga a WebKit a RE-APLICAR la escala 1 al momento. Se intenta varias veces
     por si la restauración de Safari llega tarde. */
  const BASE_VIEWPORT='width=device-width, initial-scale=1.0, minimum-scale=1.0, maximum-scale=1.0, viewport-fit=cover';
  function snapScale(){
    try{
      if(Math.abs((vv.scale||1)-1) < 0.02) return;          // ya está bien
      const m=document.querySelector('meta[name="viewport"]'); if(!m) return;
      m.setAttribute('content', BASE_VIEWPORT+', user-scalable=no');   // contenido DISTINTO → WebKit lo re-procesa
      setTimeout(()=>{ m.setAttribute('content', BASE_VIEWPORT); setTimeout(apply,60); }, 80);
    }catch(_){}
  }
  window.addEventListener('pageshow', ()=>setTimeout(snapScale,150));
  setTimeout(snapScale, 300); setTimeout(snapScale, 1200); setTimeout(snapScale, 3000);
})();

/* Service worker: la app abre y muestra lo último cargado aunque no haya internet.
   Solo en http(s) (en Vercel); en modo local (file://) no aplica. */
/* Recarga SEGURA: nunca interrumpe a alguien escribiendo o con un pop-up abierto; espera a que
   sea seguro. Así las tabs abiertas todo el día reciben las versiones nuevas SOLAS. */
let _reloadPending=false;
function safeReload(){
  if(_reloadPending) return; _reloadPending=true;
  const tryIt=()=>{
    const modalOpen=$('#modalBg') && $('#modalBg').classList.contains('on');
    const ae=document.activeElement, typing=ae && /INPUT|TEXTAREA|SELECT/.test(ae.tagName);
    const recording=(typeof _vaRec!=='undefined' && _vaRec) || document.querySelector('.chat-rec');
    if(!modalOpen && !typing && !recording){ location.reload(); }
    else { setTimeout(tryIt, 12000); }   // reintentar hasta que sea seguro
  };
  setTimeout(tryIt, 3000);
}
/* Comprobar si hay una versión nueva desplegada y aplicarla sola (sin que nadie recargue a mano). */
let _updSeen=false;
async function checkAppUpdate(){
  if(_updSeen || document.hidden) return;
  try{
    const r=await fetch('app.js?v='+Date.now(), {cache:'no-store'});
    if(!r || !r.ok) return;
    const txt=await r.text();
    const m=txt.match(/APP_VERSION\s*=\s*'v(\d+)/);
    if(!m) return;
    const remote=+m[1]; const lm=(APP_VERSION.match(/v(\d+)/)||[])[1]; const local=+lm||0;
    if(remote>local){ _updSeen=true; try{ toast('Actualizando a la versión nueva…','ok'); }catch(_){}; safeReload(); }
  }catch(_){}
}
if('serviceWorker' in navigator && location.protocol.indexOf('http')===0){
  // Si entra a controlar una versión NUEVA del SW, recargar (seguro) para mostrar lo último
  const hadCtrl = !!navigator.serviceWorker.controller;
  let _swReloaded=false;
  navigator.serviceWorker.addEventListener('controllerchange', ()=>{ if(_swReloaded||!hadCtrl) return; _swReloaded=true; safeReload(); });
  window.addEventListener('load', ()=>{
    navigator.serviceWorker.register('sw.js').then(reg=>{
      try{ reg.update(); }catch(_){}
      // revisar cada 5 min si hay SW nuevo (trae la versión nueva a las tabs abiertas todo el día)
      setInterval(()=>{ try{ reg.update(); }catch(_){} }, 5*60000);
    }).catch(e=>console.warn('SW', e));
  });
  // Respaldo por si el SW no cambia: comparar la versión desplegada cada 6 min y aplicarla sola
  setInterval(checkAppUpdate, 6*60000);
  setTimeout(checkAppUpdate, 40000);
}
/* Sabor Tico App — fin */
