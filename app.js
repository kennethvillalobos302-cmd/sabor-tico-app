/* =====================================================================
   SABOR TICO APP  —  app.js
   Plataforma de gestión integral de restaurante (local, localStorage).
   ===================================================================== */

const DB_KEY = 'saborTico_v1';
const APP_VERSION = 'v37 · chat ancho + llamar WhatsApp + llamadas nativas';  // se muestra en el menú de cuenta para confirmar la versión
/* Versión de datos: al subir este número, la app hace una limpieza única
   (deja el equipo y las sucursales, borra los datos de ejemplo) en todos los
   dispositivos la próxima vez que abran. Subir solo cuando se quiera reiniciar. */
const DATA_VERSION = 2;
let _migrateReset = false;
const FB = (window.SABOR_CLOUD && window.SABOR_CLOUD.databaseURL) ? window.SABOR_CLOUD : null;
const CLIENT_ID = Math.random().toString(36).slice(2);
let fbdb=null, cloudOn=false, _applyingRemote=false, _saveTimer=null, _cloudFailed=false;

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
    const payload={ data:DB, client:CLIENT_ID, at:Date.now() };
    // Aviso suave: si el estado compartido crece demasiado (muchos adjuntos), conviene depurar
    if(!_sizeWarned){ try{ if(JSON.stringify(payload).length > 8*1024*1024){ _sizeWarned=true; if(typeof toast==='function') toast('Los datos están muy pesados (muchos adjuntos). Conviene depurar.','err'); } }catch(_){} }
    await fbdb.ref('state').set(payload);
  }
  catch(e){ console.warn('cloud push', e); }
}
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
  const norm=arr=>(Array.isArray(arr)?arr:[]).filter(s=>s&&s.in).map(s=>({id:s.id||('s'+s.in), in:s.in, out:s.out||null}));
  const L=norm(localArr), R=norm(remoteArr); const byId={};
  R.forEach(s=>{ byId[s.id]=s; });
  L.forEach(s=>{ const e=byId[s.id];
    if(e){ if((s.out||0)>(e.out||0)){ e.out=s.out; if(flags) flags.added=true; } }   // cerrar una sesión que el otro tenía abierta
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
const RECON_COLLS=['tasks','pedidos','chats','projects','reservations','clients','shifts','recipes','souvenirs','souvSales','users','attendance','inventory','sucursales'];
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
      setTimeout(()=>{ try{ toast('Sin conexión a la nube: activá el inicio anónimo en Firebase (ver SEGURIDAD.md).','err'); }catch(_){} }, 1500);
    }
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
    fbdb.ref('state').on('value', (snap)=>{
      const v=snap.val(); if(!v || !v.data || v.client===CLIENT_ID) return;
      // Defensa: nunca dejar que un estado vacío o corrupto (sin usuarios) borre todo en cada dispositivo
      if(!Array.isArray(v.data.users) || v.data.users.length===0){ console.warn('estado remoto inválido, ignorado'); return; }
      let needRepush=false;
      _applyingRemote=true;
      try{
        needRepush = reconcile(DB, v.data);   // unir objetos nuevos + mensajes/comentarios locales (no perder nada)
        DB=v.data; migrate(true); // normalizar datos entrantes (sin la limpieza destructiva) para que nunca falten colecciones
        rebuildEntSnap();   // el estado adoptado es la nueva base (no marcar como "edición local" lo que vino remoto)
        try{ localStorage.setItem(DB_KEY, JSON.stringify(DB)); }catch(e){}
        const modalOpen=$('#modalBg').classList.contains('on');
        if(me()){ if(!modalOpen) render(); try{ checkNotifPops(); }catch(_){} } else { renderLogin(); }
      } finally { _applyingRemote=false; }
      if(needRepush) save();   // el remoto no tenía algunos de nuestros mensajes: reenviarlos para que lleguen a todos
    });
    // Indicador de conexión real: "Sincronizado" (verde) / "Sin conexión" (gris)
    fbdb.ref('.info/connected').on('value', s=>{
      const on=!!(s&&s.val()); const t=$('#cloudTag');
      if(t){ t.textContent = on?'Sincronizado':'Sin conexión'; t.classList.toggle('off', !on); }
    });
  }catch(e){ console.warn('cloud realtime', e); }
  return true;
}

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
  projects:[], chats:[], notifs:[], audit:[], clients:[], reservations:[], souvenirs:[], souvSales:[], attendance:[] }; }

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
const DB_COLLECTIONS=['tasks','pedidos','projects','chats','notifs','audit','users','sucursales','inventory','invMoves','invoices','recipes','shifts','reservations','clients','souvenirs','souvSales'];
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
  ['tasks','pedidos','projects','chats','notifs','audit','users','sucursales','inventory','invMoves','recipes','shifts','reservations','clients','souvenirs','souvSales','attendance'].forEach(k=>{ if(!Array.isArray(DB[k])){ DB[k]=[]; ch=true; } });
  const s=DB.sucursales||[]; const s1=s[0]?s[0].id:'all'; const s2=s[1]?s[1].id:s1;
  if(DB.inventory===undefined){ DB.inventory=seedInventory(s1,s2); ch=true; }
  if(DB.invMoves===undefined){ DB.invMoves=[]; ch=true; }
  if(DB.recipes===undefined){ const chef=DB.users.find(u=>u.role==='chef'); DB.recipes=seedRecipes(DB.inventory,chef?chef.id:DB.users[0].id); ch=true; }
  if(DB.shifts===undefined){ DB.shifts=seedShifts(s1,s2,DB.users); ch=true; }
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
  (DB.tasks||[]).forEach(t=>{ if(!Array.isArray(t.toIds)){ t.toIds=[]; ch=true; } if(!Array.isArray(t.log)) t.log=[]; if(!Array.isArray(t.comments)) t.comments=[]; });
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
function applyMediaToDom(id){
  const d=mediaCache[id]||''; const safe=d.indexOf('data:video')===0?safeVid(d):safeImg(d);
  let sel; try{ sel='[data-mid="'+(window.CSS&&CSS.escape?CSS.escape(id):id)+'"]'; }catch(_){ sel='[data-mid="'+id+'"]'; }
  document.querySelectorAll(sel).forEach(el=>{
    if(safe){ el.src=safe; el.classList.remove('media-loading'); } else { el.classList.remove('media-loading'); el.classList.add('media-broken'); }
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
  proyectos:{ label:'Proyectos',   ico:'clipboard' },
  chat:     { label:'Mensajes',    ico:'message' },
  reportes: { label:'Reportes',    ico:'trend' },
  reservas: { label:'Reservas',    ico:'reserva' },
  souvenir: { label:'Souvenirs',   ico:'gift' },
  equipo:   { label:'Equipo',      ico:'users' },
  auditoria:{ label:'Movimientos', ico:'shield' },
};
// Menú personalizado por puesto
const ROLE_NAV = {
  admin:       ['inicio','tareas','pedidos','reservas','souvenir','inventario','recetas','horarios','proyectos','chat','reportes','equipo','auditoria'],
  chef:        ['inicio','tareas','pedidos','reservas','inventario','recetas','horarios','proyectos','chat'],
  cocinero:    ['inicio','tareas','pedidos','inventario','recetas','horarios','proyectos','chat'],
  jefe_salon:  ['inicio','tareas','pedidos','reservas','souvenir','inventario','horarios','proyectos','chat'],
  salonero:    ['inicio','tareas','pedidos','reservas','souvenir','horarios','proyectos','chat'],
  proveeduria: ['inicio','tareas','pedidos','inventario','horarios','proyectos','chat'],
  contarh:     ['inicio','tareas','pedidos','inventario','equipo','horarios','reportes','proyectos','chat'],
  gerencia_exp:['inicio','tareas','pedidos','reservas','souvenir','horarios','equipo','proyectos','chat','reportes'],
  gerencia_data:['inicio','tareas','pedidos','reservas','souvenir','inventario','proyectos','chat','reportes'],
  bartender:   ['inicio','tareas','pedidos','reservas','inventario','recetas','horarios','proyectos','chat'],
};
const ADMIN_GROUP = ['reportes','equipo','auditoria'];
function navItems(){
  const ids = ROLE_NAV[me().role] || ['inicio','tareas','pedidos','proyectos','chat'];
  return ids.map(id=>({id,...NAV_DEF[id]}));
}
// Barra inferior del celular: lo más usado a mano. Mensajes va junto a Tareas.
function bottomNavItems(){
  const ids = ROLE_NAV[me().role] || [];
  const want = ['inicio','tareas','chat','pedidos'];          // Inicio · Tareas · Mensajes · Pedidos
  const pick = want.filter(id=>ids.includes(id));
  ids.forEach(id=>{ if(pick.length<4 && pick.indexOf(id)<0) pick.push(id); });  // completar si al puesto le falta alguno
  return pick.slice(0,4).map(id=>({id,...NAV_DEF[id]}));
}

function pendingForMe(){
  return (DB.tasks||[]).filter(t=> (t.toIds||[]).includes(SES.userId) && (t.status==='pendiente'||t.status==='proceso'||t.status==='atrasada')).length;
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
  try{ checkNotifPops(); }catch(_){}   // avisar (popup+sonido) lo nuevo, p.ej. recordatorios de turno
  const ct=$('#cloudTag'); if(ct) ct.classList.toggle('hidden',!cloudOn);
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
    recetas:viewRecetas, horarios:viewHorarios, personal:viewEquipo, proyectos:viewProyectos,
    chat:viewChat, reportes:viewReportes, reservas:viewReservas, souvenir:viewSouvenir, equipo:viewEquipo, auditoria:viewAuditoria };
  // si el puesto no tiene acceso a la vista actual, volver a inicio
  if(!(ROLE_NAV[me().role]||[]).includes(SES.view)) SES.view='inicio';
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

  // control gerencia
  if(isAdmin() || u.role==='chef' || u.role==='jefe_salon'){
    html += `<div class="page-head" style="margin:22px 0 10px"><div class="page-title" style="font-size:17px">🛡️ Control · quién no cumple</div></div>`;
    html += `<div class="card" style="padding:12px">${failRows || emptyState('✅','Todo en orden','Nadie tiene tareas atrasadas ni rechazadas. Excelente.')}</div>`;
  }
  return html;
}
function horaSaludo(){ const h=new Date().getHours(); return h<12?'Buenos días':h<19?'Buenas tardes':'Buenas noches'; }

/* =====================================================================
   VISTA: TAREAS
   ===================================================================== */
let taskFilter='todas', taskSearch='';
function viewTareas(){
  const all = (DB.tasks||[]).filter(t=> t && visibleTask(t) && (inScope(t.sucursalId) || (t.toIds||[]).includes(SES.userId) || t.fromId===SES.userId));
  refreshOverdue();
  let list=[...all];
  if(taskFilter==='mias') list=list.filter(t=>(t.toIds||[]).includes(SES.userId));
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

  const mineActive=all.filter(t=>(t.toIds||[]).includes(SES.userId)&&(t.status==='pendiente'||t.status==='proceso'||t.status==='atrasada')).length;
  const procN=all.filter(t=>t.status==='proceso').length;
  const lateN=all.filter(t=>t.status==='atrasada').length;
  const doneN=all.filter(t=>t.status==='hecha').length;

  const chips = [['todas','Todas'],['mias','Para mí'],['asignadas','Yo asigné'],['pendiente','Pendientes'],['proceso','En proceso'],['atrasada','Atrasadas'],['hecha','Hechas']]
    .map(([k,l])=>`<button class="chip ${taskFilter===k?'on':''}" onclick="setTaskFilter('${k}')">${l}</button>`).join('');

  let html = `<div class="page-head"><div><div class="page-title">Tareas</div><div class="page-sub">Asigná, seguí y controlá el trabajo</div></div>
    <div class="ph-spacer"></div><button class="btn btn-primary" style="flex:0 0 auto" onclick="newTaskModal()">${svgIcon('plus','icon icon-sm')} Nueva tarea</button></div>`;
  html += guide;
  html += `<div class="kpi-row">
    <div class="kpi" onclick="setTaskFilter('mias')" style="cursor:pointer"><div class="label">Para mí</div><div class="value">${mineActive}</div><div class="sub">pendientes</div></div>
    <div class="kpi" onclick="setTaskFilter('proceso')" style="cursor:pointer"><div class="label">En proceso</div><div class="value">${procN}</div><div class="sub">en curso</div></div>
    <div class="kpi ${lateN?'alert':''}" onclick="setTaskFilter('atrasada')" style="cursor:pointer"><div class="label">Atrasadas</div><div class="value">${lateN}</div><div class="sub">requieren atención</div></div>
    <div class="kpi ok" onclick="setTaskFilter('hecha')" style="cursor:pointer"><div class="label">Hechas</div><div class="value">${doneN}</div><div class="sub">completadas</div></div>
  </div>`;
  html += `<div class="toolbar"><input class="input search" placeholder="Buscar tarea…" value="${esc(taskSearch)}" oninput="taskSearch=this.value;clearTimeout(window._ts);window._ts=setTimeout(render,250)">${chips}</div>`;
  html += list.length ? list.map(taskRow).join('')
    : emptyState('📝','No hay tareas acá', taskSearch?'No hay tareas que coincidan con la búsqueda.':'Cuando alguien asigne una tarea, aparece en esta lista. Probá creando una.','+ Nueva tarea','newTaskModal()');
  return html;
}
function visibleTask(t){
  if(isAdmin()) return true;
  return (t.toIds||[]).includes(SES.userId) || t.fromId===SES.userId || me().role==='chef' || me().role==='jefe_salon';
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
      </div>
      ${t.desc?`<div class="tk-desc">${esc(t.desc).slice(0,110)}${t.desc.length>110?'…':''}</div>`:''}
    </div>
  </div>`;
}
function statusLabel(s){ return {pendiente:'Pendiente',proceso:'En proceso',hecha:'Hecha',rechazada:'Rechazada',atrasada:'Atrasada'}[s]||s||'—'; }
function cap(s){ s=(s==null?'':String(s)); return s? s.charAt(0).toUpperCase()+s.slice(1) : '—'; }

/* ----- Detalle de tarea ----- */
function taskDetail(id){
  const t=DB.tasks.find(x=>x.id===id); if(!t) return;
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
    return `<div class="comment">${avatarHTML(u)}<div class="cbody"><div class="cname">${u?esc(u.name):'—'}</div><div class="ctext">${esc(c.text)}</div><div class="ctime">${timeAgo(c.at)}</div></div></div>`;
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

  openModal(`
    <div class="modal-head"><h3>${esc(t.title)}</h3><button class="modal-close" onclick="closeModal()">${svgIcon('x','icon')}</button></div>
    <div class="modal-body">
      <div class="td-top">
        <span class="pill ${t.status}">${statusLabel(t.status)}</span>
        <span class="td-badge"><span class="dot-prio" style="background:${pr.color}"></span>Prioridad ${pr.label}</span>
        <span class="td-badge ${overdue?'tk-due-late':''}">${svgIcon('clock','icon icon-sm')} ${fmtDateTime(t.due)}</span>
      </div>
      ${t.desc?`<div class="td-desc">${esc(t.desc)}</div>`:''}
      ${imgs?`<div class="img-prev">${imgs}</div>`:''}
      <div class="td-meta">
        <div class="td-mrow"><span class="td-ml">Asignada por</span><span class="td-mv">${from?esc(from.name):'—'}</span></div>
        <div class="td-mrow"><span class="td-ml">Responsables</span><span class="td-mv">${assignees.map(a=>esc(a.name.split(' ')[0])).join(', ')||'—'}</span></div>
        <div class="td-mrow"><span class="td-ml">Sucursal</span><span class="td-mv">${esc(sucName(t.sucursalId))}</span></div>
        <div class="td-mrow"><span class="td-ml">Creada</span><span class="td-mv">${fmtDate(t.createdAt)}</span></div>
      </div>
      ${actions?`<div class="td-actions">${actions}</div>`:''}
      <div class="td-sec">Historial</div>
      <div class="log">${logHtml||'<div class="td-empty">Sin movimientos.</div>'}</div>
      <div class="td-sec">Respuestas y comentarios</div>
      <div class="td-comments">${comments||'<div class="td-empty">Sin respuestas todavía. Escribí la primera.</div>'}</div>
      <div class="td-composer">
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

function addTaskComment(id){
  const t=DB.tasks.find(x=>x.id===id); if(!t) return;
  const inp=$('#tcInput'); const txt=inp.value.trim(); if(!txt) return;
  t.comments.push({id:uid(),byId:SES.userId,text:txt,at:now()});
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
    <div class="ip-sec">${svgIcon('users','icon icon-sm')} ¿A quién se la asignás?</div>
    ${peoplePicker('ntPeople', people, sel)}
    <div class="ip-sec">${svgIcon('clock','icon icon-sm')} Prioridad y fecha</div>
    <div class="field"><label>Prioridad</label>${taskPrioSeg(t?t.prio:'media')}</div>
    <div class="field"><label>¿Para cuándo?</label>
      <div class="due-presets"><button type="button" class="chip" onclick="ntDuePreset('today')">Hoy</button><button type="button" class="chip" onclick="ntDuePreset('tomorrow')">Mañana</button><button type="button" class="chip" onclick="ntDuePreset('3d')">En 3 días</button><button type="button" class="chip" onclick="ntDuePreset('week')">En 1 semana</button></div>
    </div>
    <div class="row2 rv-when">
      <div class="field"><label>Fecha</label>${dateField(dp.iso,'nt')}</div>
      <div class="field"><label>Hora</label>${timePicker('ntT',dp.hhmm,'')}</div>
    </div>
    <div class="field"><label>Sucursal</label><select class="select" id="ntSuc">${t?sucOptionsSel(t.sucursalId):sucOptionsFor()}</select></div>`;
}
function newTaskModal(){
  newImgs=[];
  openModal(`
    <div class="modal-head"><h3>${svgIcon('check','icon')} Nueva tarea</h3><button class="modal-close" onclick="closeModal()">${svgIcon('x','icon')}</button></div>
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
  return { title, desc:$('#ntDesc').value.trim(), toIds, sucursalId:$('#ntSuc').value,
    prio:($('#ntPrio')?$('#ntPrio').value:'media'), due };
}
async function createTask(){
  const d=readTaskForm(); if(!d) return;
  const images = await Promise.all((newImgs||[]).map(putMedia));   // subir fotos al nodo aparte, guardar solo ids
  const t={ id:uid(), ...d, fromId:SES.userId, status:'pendiente', images, createdAt:now(), comments:[],
    log:[{at:now(),byId:SES.userId,text:'creó la tarea'}] };
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
  html+=`<div class="toolbar"><input class="input search" placeholder="Buscar pedido…" value="${esc(pedSearch)}" oninput="pedSearch=this.value;clearTimeout(window._ps);window._ps=setTimeout(render,250)">${chips}</div>`;
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
function drawPaths(p){ return (p.drawings||[]).map(s=>{ if(!s.points||s.points.length<2) return ''; const d='M'+s.points.map(q=>`${q.x} ${q.y}`).join(' L'); return `<path d="${d}" stroke="${s.color}" stroke-width="${s.width||6}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`; }).join(''); }
function boardPoint(e){ const bc=$('#boardCanvas'); const r=bc.getBoundingClientRect(); return {x:Math.round((e.clientX-r.left)/boardZoom), y:Math.round((e.clientY-r.top)/boardZoom)}; }
function drawStart(e){
  const svg=$('#boardDraw'); if(!svg) return; e.preventDefault();
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
  p.drawings=p.drawings||[]; p.drawings.push({id:uid(),color:penColor,width:penWidth,points:pts,byId:SES.userId,at:now()});
  save();
}
function eraseAt(e){
  const p=DB.projects.find(x=>x.id===activeProj); if(!p||!(p.drawings&&p.drawings.length)) return;
  const pt=boardPoint(e); let best=-1,bestD=16;
  p.drawings.forEach((s,idx)=>{ (s.points||[]).forEach(q=>{ const d=Math.hypot(q.x-pt.x,q.y-pt.y); if(d<bestD){bestD=d;best=idx;} }); });
  if(best>=0){ p.drawings.splice(best,1); save(); const svg=$('#boardDraw'); if(svg) svg.innerHTML=drawPaths(p); }
}
async function clearDrawings(projId){
  const p=DB.projects.find(x=>x.id===projId); if(!p||!(p.drawings&&p.drawings.length)){ toast('No hay trazos para borrar','ok'); return; }
  if(!await confirmDialog('Se borran todos los trazos dibujados en la pizarra (las notas e imágenes se mantienen).',{title:'¿Borrar dibujos?',okText:'Sí, borrar'})) return;
  p.drawings=[]; audit('proyecto',`borró los dibujos de "${p.name}"`,p.sucursalId); save(); render();
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
  p.cards.push({id:uid(),type:'file',text:($('#fcTitle')?$('#fcTitle').value.trim():'')||fileCardPending.filename,file,byId:SES.userId,at:now(),x:40+(i%5)*250,y:40+Math.floor(i/5)*215});
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
    const media=m.media?(m.media.type==='video'?mediaTag(m.media.mid||m.media.data,'video','controls'):m.media.type==='image'?mediaTag(m.media.mid||m.media.data,'image'):`<div class="chat-file"><span class="chat-file-ic">${svgIcon(fileIconFor(m.media.mime,m.media.filename),'icon icon-sm')}</span><div class="chat-file-tx"><div class="chat-file-n">${esc(m.media.filename||'Archivo')}</div><div class="chat-file-s">${m.media.size?fmtFileSize(m.media.size):''}</div></div><button class="chat-file-b" title="Abrir" onclick="openProjChatFile('${proj.id}','${m.id}')">${svgIcon('search','icon icon-sm')}</button><button class="chat-file-b" title="Descargar" onclick="downloadProjChatFile('${proj.id}','${m.id}')">${svgIcon('save','icon icon-sm')}</button></div>`):'';
    return `<div class="msg ${mine?'mine':''}">${(!mine)?`<div class="mname">${u?esc((u.name||'').split(' ')[0]):''}</div>`:''}${m.text?esc(m.text):''}${media}<div class="mtime">${new Date(m.at).toLocaleTimeString('es-CR',{hour:'2-digit',minute:'2-digit'})}${canDel?` <button class="msg-del" title="Eliminar" onclick="delProjMsg('${proj.id}','${m.id}')">${svgIcon('trash','icon icon-sm')}</button>`:''}</div></div>`;}).join('');
  watchProjectCall(proj.id);                              // presencia EN VIVO desde signals/peers
  const others=(_projPeers[proj.id]||[]).filter(id=>id!==SES.userId);
  const meInCall=_call&&_call.projId===proj.id;
  const callBtns = meInCall
    ? `<button class="btn btn-primary" style="flex:0 0 auto;padding:7px 11px" onclick="startCall('${proj.id}',false)" title="Volver a la llamada">${svgIcon('phone','icon icon-sm')} En llamada</button>`
    : `<button class="btn ${others.length?'btn-primary':'btn-ghost'}" style="flex:0 0 auto;padding:7px 10px" title="Llamada de voz" onclick="startCall('${proj.id}',false)">${svgIcon('phone','icon icon-sm')} ${others.length?('Unirse · '+others.length):'Llamada'}</button>
       <button class="btn btn-ghost" style="flex:0 0 auto;padding:7px 10px" title="Videollamada" onclick="startCall('${proj.id}',true)">${svgIcon('video','icon icon-sm')}</button>`;
  return `<div class="proj-side">
    <div class="proj-side-head"><span style="font-weight:700;font-size:13px">Chat del grupo</span><div class="ph-spacer"></div>
      ${callBtns}</div>
    <div class="proj-chat" id="projChatMsgs">${msgs||'<div style="margin:auto;color:var(--text-soft);font-size:13px;text-align:center;padding:24px">Escribí acá para coordinar mientras trabajan la pizarra.</div>'}</div>
    ${projPending?`<div class="chat-pending">${projPending.type==='video'?`<video src="${safeVid(projPending.data)}"></video>`:projPending.type==='image'?`<img src="${safeImg(projPending.data)}">`:`<span class="chat-file-ic">${svgIcon(fileIconFor(projPending.mime,projPending.filename),'icon icon-sm')}</span>`}<span>${projPending.type==='file'?esc(projPending.filename):(projPending.type==='video'?'Video':'Foto')+' listo'}</span><button class="btn btn-ghost" style="padding:5px 10px;margin-left:auto" onclick="projPending=null;render()">Quitar</button></div>`:''}
    <div class="chat-input">
      <input type="file" id="projFile" accept="image/*,video/*,.pdf,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv" style="display:none" onchange="projAttachPick('${proj.id}')">
      <button class="chat-attach" title="Adjuntar foto o video" onclick="document.getElementById('projFile').click()">${svgIcon('clip')}</button>
      <input id="projMsg" placeholder="Mensaje al grupo…" onkeydown="if(event.key==='Enter')sendProjMsg('${proj.id}')">
      <button class="chat-send" onclick="sendProjMsg('${proj.id}')">${svgIcon('send')}</button>
    </div>
  </div>`;
}
window.openProj=id=>{activeProj=id;render();};

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
  const {projId,cardId,el,moved}=_bdrag; el.classList.remove('dragging'); _bdrag=null;
  const p=DB.projects.find(x=>x.id===projId); const c=p&&p.cards.find(x=>x.id===cardId); if(!c) return;
  if(moved){ c.x=parseInt(el.style.left)||0; c.y=parseInt(el.style.top)||0; save(); refreshBoard(projId); }
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
  p.cards=p.cards.filter(c=>c.id!==cardId);
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
  p.cards.push({id:uid(),type,text,img,color:type==='title'?null:cardColor,byId:SES.userId,at:now(),x:40+(i%5)*250,y:40+Math.floor(i/5)*215});
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
    if(projPending.filename) m.media.filename=projPending.filename; if(projPending.mime) m.media.mime=projPending.mime; if(projPending.size!=null) m.media.size=projPending.size; }
  p.chat=p.chat||[]; p.chat.push(m);
  const prev=v?v.slice(0,40):(projPending?(projPending.type==='video'?'envió un video':projPending.type==='file'?'envió un archivo':'envió una foto'):'');
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
   LLAMADAS / VIDEOLLAMADAS DEL PROYECTO — nativas (WebRTC P2P)
   - "Llamada" = solo voz · "Videollamada" = con cámara. UI propia de la app.
   - Conexión DIRECTA entre dispositivos; la señalización (ofertas/candidatos)
     pasa por tu Firebase (nodo "signals"), no por terceros.
   - Ventana flotante que vive FUERA del render: seguís trabajando sin cortar.
   - Malla P2P (ideal 2–4 personas). Para iniciar quien tenga el id MAYOR ofrece
     (evita "glare"); los candidatos que llegan antes de la descripción se encolan.
   ===================================================================== */
const RTC_CFG={iceServers:[{urls:'stun:stun.l.google.com:19302'},{urls:'stun:stun1.l.google.com:19302'}]};
let _call=null;  // {projId,video,localStream,peers:{pid:{pc,stream,name,queue,op}},myId,base,muted,camOff,refs,listeners}
let _callStarting=false;            // evita doble inicio mientras se pide cámara/micrófono
let _projPeers={}, _ppWatchRef=null, _ppWatchId=null;   // presencia EN VIVO de la llamada (de signals/peers, se autolimpia)
function watchProjectCall(projId){
  if(_ppWatchId===projId) return;
  unwatchProjectCall();
  if(!cloudOn||!fbdb||!projId) return;
  _ppWatchId=projId; _ppWatchRef=fbdb.ref('signals/'+projId+'/peers');
  _ppWatchRef.on('value', s=>{ const v=s.val()||{}; const ids=Object.keys(v); const prev=(_projPeers[projId]||[]).join(','); _projPeers[projId]=ids; if(ids.join(',')!==prev && SES.userId && SES.view==='proyectos') render(); });
}
function unwatchProjectCall(){ if(_ppWatchRef){ try{ _ppWatchRef.off(); }catch(e){} } _ppWatchRef=null; _ppWatchId=null; }
function ensureCallDock(){
  let d=document.getElementById('callDock'); if(d) return d;
  d=document.createElement('div'); d.id='callDock'; d.className='call-dock hidden';
  d.innerHTML=`<div class="cd-head" id="cdHead" onpointerdown="cdDragStart(event)">
      <span class="cd-title">${svgIcon('video','icon icon-sm')} <span id="cdName"></span></span>
      <div class="ph-spacer"></div>
      <button class="cd-btn" onclick="callDockToggleMin()" title="Minimizar / agrandar">${svgIcon('chevron','icon icon-sm')}</button>
      <button class="cd-btn danger" onclick="callHangup()" title="Salir de la llamada">${svgIcon('x','icon icon-sm')}</button>
    </div>
    <div class="cd-body" id="cdBody"><div class="rtc-grid" id="rtcGrid"></div><div class="rtc-bar" id="rtcBar"></div></div>`;
  document.body.appendChild(d);
  return d;
}
function rtcTile(uid,name,me_){
  const ini=esc((name||'?').trim().slice(0,1).toUpperCase()||'?');
  return `<div class="rtc-tile${me_?' me':''}" id="tile-${uid}">
    <video id="vid-${uid}" autoplay playsinline ${me_?'muted':''}></video>
    <div class="rtc-av" id="av-${uid}"><div class="rtc-av-c">${ini}</div></div>
    <span class="rtc-name">${esc(name||'')}${me_?' (vos)':''}</span>
  </div>`;
}
function rtcShowVideo(uid,on){ const v=document.getElementById('vid-'+uid), a=document.getElementById('av-'+uid); if(v)v.style.display=on?'block':'none'; if(a)a.style.display=on?'none':'flex'; }
function renderCallBar(){
  const bar=document.getElementById('rtcBar'); if(!bar||!_call) return;
  const micOn=!_call.muted, camOn=_call.video&&!_call.camOff;
  bar.innerHTML=`<button class="rtc-cbtn ${micOn?'':'off'}" onclick="callToggleMic()">${svgIcon(micOn?'mic':'mic-off','icon')}<span>${micOn?'Silenciar':'Activar'}</span></button>
    ${_call.video?`<button class="rtc-cbtn ${camOn?'':'off'}" onclick="callToggleCam()">${svgIcon('video','icon')}<span>${camOn?'Apagar cám.':'Prender cám.'}</span></button>`:''}
    <button class="rtc-cbtn end" onclick="callHangup()">${svgIcon('phone','icon')}<span>Colgar</span></button>`;
}
async function startCall(projId, video){
  const m=me(); if(!m) return;
  if(!cloudOn || !fbdb){ toast('Necesitás conexión a la nube para llamar','err'); return; }
  if(_call){ if(_call.projId===projId){ const d=ensureCallDock(); d.classList.remove('hidden','min'); return; } toast('Ya estás en otra llamada — salí de esa primero','err'); return; }
  if(_callStarting) return;            // doble clic mientras pide cámara: ignorar el segundo
  const p=DB.projects.find(x=>x.id===projId); if(!p) return;
  _callStarting=true;
  let stream;
  try{ stream=await navigator.mediaDevices.getUserMedia({audio:true, video: video?{width:{ideal:640},height:{ideal:480}}:false}); }
  catch(e){ _callStarting=false; toast(video?'No se pudo usar la cámara o el micrófono':'No se pudo usar el micrófono','err'); return; }
  if(_call){ _callStarting=false; try{ stream.getTracks().forEach(t=>t.stop()); }catch(_){} return; }   // entró a otra llamada mientras pedía permisos
  const myId=SES.userId;
  _call={projId, video:!!video, localStream:stream, peers:{}, myId, base:fbdb.ref('signals/'+projId), muted:false, camOff:false, refs:null, listeners:null};
  _callStarting=false;
  // ventana + tile propio
  const dock=ensureCallDock(); dock.classList.remove('hidden','min');
  $('#cdName').textContent=(video?'Videollamada · ':'Llamada · ')+p.name;
  $('#rtcGrid').innerHTML=rtcTile('local', (m.name||'Vos').split(' ')[0], true);
  const lv=document.getElementById('vid-local'); if(lv) lv.srcObject=stream;
  rtcShowVideo('local', !!video);
  renderCallBar();
  // aviso a los demás (la presencia "en llamada" se ve EN VIVO desde signals/peers, que se autolimpia)
  audit('proyecto',`entró a la ${video?'videollamada':'llamada'} de "${p.name}"`,p.sucursalId);   // audit() persiste/sincroniza
  notify(p.memberIds.filter(i=>i!==myId), `${m.name.split(' ')[0]} inició una ${video?'videollamada':'llamada'} en "${p.name}"`,'video',{view:'proyectos'});
  // señalización por Firebase
  const base=_call.base, myPeerRef=base.child('peers').child(myId), inbox=base.child('msg').child(myId);
  try{ await myPeerRef.set({name:m.name||'', video:!!video, at:firebase.database.ServerValue.TIMESTAMP}); }
  catch(e){ console.warn('signals denied',e); toast('Falta activar las llamadas en Firebase (reglas "signals"). Ver CONECTAR-NUBE.md','err'); endCall(true); return; }
  try{ myPeerRef.onDisconnect().remove(); inbox.onDisconnect().remove(); }catch(e){}
  _call.refs={myPeerRef, inbox};
  let existing={};
  try{ const snap=await base.child('peers').get(); existing=snap.val()||{}; }catch(e){}
  if(!_call){ return; }                          // por si colgó mientras esperaba
  Object.keys(existing).forEach(pid=>{ if(pid!==myId){ ensurePeer(pid, existing[pid]&&existing[pid].name); if(myId>pid) makeOffer(pid); } });
  const onAdd=base.child('peers').on('child_added', s=>{ if(!_call) return; const pid=s.key; if(pid===myId||_call.peers[pid]) return; const v=s.val()||{}; ensurePeer(pid, v.name); if(myId>pid) makeOffer(pid); });
  const onRem=base.child('peers').on('child_removed', s=>{ if(_call) closePeer(s.key); });
  const onMsg=inbox.on('child_added', async s=>{ if(!_call) return; const msg=s.val(); try{ await s.ref.remove(); }catch(e){} if(_call&&msg) enqueueSignal(msg); });
  _call.listeners={onAdd,onRem,onMsg};
  if(SES.userId) render();
}
function ensurePeer(pid, name){
  if(!_call) return null;
  if(_call.peers[pid]) return _call.peers[pid];
  const pc=new RTCPeerConnection(RTC_CFG);
  const peer={pc, name:name||(userById(pid)&&userById(pid).name)||'', stream:null, queue:[]};
  _call.peers[pid]=peer;
  try{ _call.localStream.getTracks().forEach(t=>pc.addTrack(t,_call.localStream)); }catch(e){}
  pc.onicecandidate=e=>{ if(e.candidate) sendSignal(pid,'candidate',e.candidate.toJSON()); };
  pc.ontrack=e=>{ peer.stream=e.streams[0]; if(e.track&&e.track.kind==='video'){ e.track.onmute=()=>rtcShowVideo(pid,false); e.track.onunmute=()=>rtcShowVideo(pid,true); } addRemoteTile(pid,peer); };
  pc.onconnectionstatechange=()=>{ if(['failed','closed'].includes(pc.connectionState)) closePeer(pid); };
  return peer;
}
async function makeOffer(pid){
  const peer=_call&&_call.peers[pid]; if(!peer) return;
  try{ const off=await peer.pc.createOffer(); if(!_call||_call.peers[pid]!==peer) return; await peer.pc.setLocalDescription(off); sendSignal(pid,'offer',{type:off.type,sdp:off.sdp}); }catch(e){ console.warn('offer',e); }
}
function sendSignal(toId, kind, data){ if(!_call) return; try{ _call.base.child('msg').child(toId).push({from:_call.myId, kind, data}); }catch(e){} }
function enqueueSignal(msg){   // procesa los mensajes de un peer EN ORDEN (uno termina antes del siguiente): evita perder candidatos ICE
  if(!_call||!msg||!msg.from||msg.from===_call.myId) return;
  const peer=ensurePeer(msg.from); if(!peer) return;
  peer.op=(peer.op||Promise.resolve()).then(()=>handleSignal(msg)).catch(e=>console.warn('sig',e));
}
async function handleSignal(msg){
  if(!_call) return;
  const pid=msg.from, peer=_call.peers[pid]; if(!peer) return;
  const alive=()=> _call && _call.peers[pid]===peer && peer.pc.signalingState!=='closed';
  try{
    if(msg.kind==='offer'){
      if(peer.pc.signalingState!=='stable' && peer.pc.signalingState!=='have-remote-offer') return;   // no pisar una negociación en curso
      await peer.pc.setRemoteDescription(new RTCSessionDescription(msg.data)); if(!alive()) return;
      await flushCands(peer); if(!alive()) return;
      const ans=await peer.pc.createAnswer(); if(!alive()) return;
      await peer.pc.setLocalDescription(ans); if(!alive()) return;
      sendSignal(pid,'answer',{type:ans.type,sdp:ans.sdp});
    } else if(msg.kind==='answer'){
      if(peer.pc.signalingState!=='have-local-offer') return;     // answer fuera de orden: ignorar
      await peer.pc.setRemoteDescription(new RTCSessionDescription(msg.data)); if(!alive()) return;
      await flushCands(peer);
    } else if(msg.kind==='candidate'){
      if(peer.pc.remoteDescription && peer.pc.remoteDescription.type){ try{ await peer.pc.addIceCandidate(new RTCIceCandidate(msg.data)); }catch(e){} }
      else (peer.queue=peer.queue||[]).push(msg.data);
    }
  }catch(e){ console.warn('signal',msg.kind,e); }
}
async function flushCands(peer){ while(peer.queue && peer.queue.length){ const c=peer.queue.shift(); try{ await peer.pc.addIceCandidate(new RTCIceCandidate(c)); }catch(e){} } }   // drena en bucle: no pierde los que llegan durante el await
function addRemoteTile(pid,peer){
  const grid=document.getElementById('rtcGrid'); if(!grid) return;
  if(!document.getElementById('tile-'+pid)) grid.insertAdjacentHTML('beforeend', rtcTile(pid,(peer.name||'…').split(' ')[0],false));
  const v=document.getElementById('vid-'+pid); if(v && v.srcObject!==peer.stream) v.srcObject=peer.stream;
  const hasVid=peer.stream && peer.stream.getVideoTracks().some(t=>t.readyState==='live' && !t.muted);
  rtcShowVideo(pid, !!hasVid);
}
function closePeer(pid){
  const peer=_call&&_call.peers[pid]; if(!peer) return;
  try{ peer.pc.ontrack=peer.pc.onicecandidate=peer.pc.onconnectionstatechange=null; peer.pc.close(); }catch(e){}
  delete _call.peers[pid];
  const t=document.getElementById('tile-'+pid); if(t) t.remove();
}
function callToggleMic(){ if(!_call) return; const tr=_call.localStream.getAudioTracks()[0]; if(!tr) return; tr.enabled=!tr.enabled; _call.muted=!tr.enabled; renderCallBar(); }
function callToggleCam(){ if(!_call||!_call.video) return; const tr=_call.localStream.getVideoTracks()[0]; if(!tr) return; tr.enabled=!tr.enabled; _call.camOff=!tr.enabled; rtcShowVideo('local', tr.enabled); renderCallBar(); }
function openCall(projId){ startCall(projId, false); }   // compatibilidad (voz)
function endCall(silent){
  if(!_call) return;
  const projId=_call.projId, myId=_call.myId, base=_call.base;
  try{ Object.keys(_call.peers).forEach(pid=>closePeer(pid)); }catch(e){}
  try{ _call.localStream.getTracks().forEach(t=>t.stop()); }catch(e){}
  try{ base.child('peers').off(); base.child('msg').child(myId).off(); }catch(e){}
  try{ if(_call.refs){ _call.refs.myPeerRef.onDisconnect().cancel(); _call.refs.inbox.onDisconnect().cancel(); } }catch(e){}
  try{ base.child('peers').child(myId).remove(); base.child('msg').child(myId).remove(); }catch(e){}
  _call=null;
  const d=document.getElementById('callDock'); if(d){ d.classList.add('hidden'); d.classList.remove('min'); d.style.left=d.style.top=d.style.right=d.style.bottom=''; const g=document.getElementById('rtcGrid'); if(g)g.innerHTML=''; const bar=document.getElementById('rtcBar'); if(bar)bar.innerHTML=''; }
  const p=projId&&DB.projects.find(x=>x.id===projId);
  if(p&&!silent) audit('proyecto',`salió de la llamada de "${p.name}"`,p.sucursalId);   // audit() persiste/sincroniza
  if(SES.userId) render();
}
window.addEventListener('pagehide', ()=>{ if(_call) endCall(true); });   // cerrar la cámara si se cierra la pestaña
function callHangup(){ endCall(false); }
function leaveCall(projId){ callHangup(); }   // compatibilidad
function callDockToggleMin(){ const d=document.getElementById('callDock'); if(d) d.classList.toggle('min'); }
let _cdDrag=null;
function cdDragStart(e){
  if(e.target.closest('.cd-btn')) return;
  const d=document.getElementById('callDock'); if(!d||d.classList.contains('min')) return;
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
window.callToggleMic=callToggleMic; window.callToggleCam=callToggleCam;
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
         + (last.text || (last.media?(last.media.type==='video'?'Video':'Foto'):'')))
      : 'Sin mensajes';
    const lastT = last ? new Date(last.at).toLocaleTimeString('es-CR',{hour:'2-digit',minute:'2-digit'}) : '';
    return `<div class="chat-li ${sel===c.id?'sel':''}" onclick="openChat('${c.id}')">
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
      const media = m.media ? (m.media.type==='video' ? mediaTag(m.media.mid||m.media.data,'video','controls') : mediaTag(m.media.mid||m.media.data,'image')) : '';
      let sep='';
      const dk=dayKey(m.at);
      if(dk!==_lastDay){ sep=`<div class="chat-day"><span>${esc(dayLabel(m.at))}</span></div>`; _lastDay=dk; _prevBy=null; }
      const grouped = _prevBy===m.byId; _prevBy=m.byId;
      const showName = !mine && cur.type==='group' && !grouped;
      const time = new Date(m.at).toLocaleTimeString('es-CR',{hour:'2-digit',minute:'2-digit'});
      const onlyMedia = media && !m.text;
      return sep + `<div class="msg ${mine?'mine':''} ${grouped?'grouped':''} ${onlyMedia?'media-only':''}">${showName?`<div class="mname">${u?esc((u.name||'').split(' ')[0]):''}</div>`:''}${m.text?`<span class="mtext">${esc(m.text)}</span>`:''}${media}<div class="mtime">${time}${mine?svgIcon('check','icon icon-sm'):''}<button class="msg-del" title="Eliminar" onclick="delMsgMenu('${cur.id}','${m.id}')">${svgIcon('trash','icon icon-sm')}</button></div></div>`;
    }).join('');
    paneHtml=`<div class="chat-pane" id="chatPane">
      <div class="chat-head">
        <button class="icon-btn mobile-only" style="width:32px;height:32px" onclick="backChatList()">←</button>
        <div class="chat-head-main" ${cur.type==='group'?`onclick="groupInfoModal('${cur.id}')" style="cursor:pointer"`:''}>
          ${cur.type==='group'?`<div class="av" style="background:var(--grad-accent)">${esc((cur.name||'#')[0])}</div>`:avatarHTML(userById(curMem.find(i=>i!==SES.userId)))}
          <div><div style="font-weight:700">${esc(headName)}</div><div style="font-size:11px;color:var(--text-soft)">${cur.type==='group'?curMem.length+' miembros · tocá para ver info':'Chat directo'}</div></div>
        </div>
        <div class="ph-spacer"></div>
        ${adminPeek?`<span class="admin-eye">👁️ Gerencia</span>`:''}
        ${cur.type!=='group'?`<button class="icon-btn" style="width:36px;height:36px" title="Llamar por WhatsApp" onclick="waCall('${curMem.find(i=>i!==SES.userId)}')">${svgIcon('phone','icon icon-sm')}</button>`:''}
        ${cur.type==='group'?`<button class="icon-btn" style="width:36px;height:36px" title="Info del grupo" onclick="groupInfoModal('${cur.id}')">${svgIcon('info','icon icon-sm')}</button>`:''}
      </div>
      <div class="chat-msgs" id="chatMsgs">${msgsHtml||'<div style="margin:auto;color:var(--text-soft);font-size:13px">Escribí el primer mensaje 👋</div>'}</div>
      ${curMem.includes(SES.userId)?`
        ${chatPending?`<div class="chat-pending">${chatPending.type==='video'?`<video src="${safeVid(chatPending.data)}"></video>`:`<img src="${safeImg(chatPending.data)}">`}<span>${chatPending.type==='video'?'Video':'Foto'} listo para enviar</span><button class="btn btn-ghost" style="padding:5px 10px;margin-left:auto" onclick="chatPending=null;render()">Quitar</button></div>`:''}
        <div class="chat-input">
          <input type="file" id="chatFile" accept="image/*,video/*" style="display:none" onchange="chatAttachPick('${cur.id}')">
          <button class="chat-attach" title="Adjuntar foto o video" onclick="document.getElementById('chatFile').click()">${svgIcon('clip')}</button>
          <input id="chatField" placeholder="Escribí un mensaje…" onkeydown="if(event.key==='Enter')sendMsg('${cur.id}')">
          <button class="chat-send" onclick="sendMsg('${cur.id}')">${svgIcon('send')}</button>
        </div>`
        :`<div class="chat-input" style="justify-content:center;color:var(--text-soft);font-size:12px">Solo lectura — no sos miembro de este chat</div>`}
    </div>`;
  } else {
    paneHtml=`<div class="chat-pane"><div class="empty" style="margin:auto"><div class="em-ico">💬</div><div class="em-t">Elegí un chat</div></div></div>`;
  }

  html+=`<div class="chat-wrap"><div class="chat-list" id="chatList">${listHtml}</div>${paneHtml}</div>`;
  return html;
}
function afterChatRender(){
  const m=$('#chatMsgs'); if(m) m.scrollTop=m.scrollHeight;
  const cur=DB.chats.find(c=>c.id===SES.activeChat);
  if(cur) markSeen(cur);
  // celular: con chat abierto = pantalla completa (estilo WhatsApp); sin chat = lista
  if(window.innerWidth<=780){
    const list=$('#chatList'), pane=$('#chatPane');
    if(SES.activeChat && cur){ if(list)list.classList.add('hide-mobile'); if(pane)pane.classList.remove('hide-mobile'); document.body.classList.add('chat-open'); }
    else { if(list)list.classList.remove('hide-mobile'); if(pane)pane.classList.add('hide-mobile'); document.body.classList.remove('chat-open'); }
  } else { document.body.classList.remove('chat-open'); }
}
window.openChat=id=>{ SES.activeChat=id; render(); };
window.backChatList=()=>{ SES.activeChat=null; document.body.classList.remove('chat-open'); render(); };

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
  if(chatPending){ const mid=await putMedia(chatPending.data); m.media={type:chatPending.type,mid}; }
  c.msgs.push(m);
  const preview = txt? txt.slice(0,40) : (chatPending? (chatPending.type==='video'?'envió un video':'envió una foto') : '');
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
      <div class="field"><label>Puesto</label><select class="select" id="uRole">${ROLE_KEYS.map(r=>`<option value="${r}" ${u&&u.role===r?'selected':''}>${ROLES[r].label}</option>`).join('')}</select></div>
      <div class="field"><label>PIN (4 dígitos)</label><input class="input" id="uPin" type="password" inputmode="numeric" maxlength="4" value="" placeholder="${u?'Dejar en blanco = no cambiar':'4 dígitos'}"></div>
    </div>
    <div class="row2">
      <div class="field"><label>Sucursal</label><select class="select" id="uSuc"><option value="all" ${u&&u.sucursalId==='all'?'selected':''}>Todas (global)</option>${DB.sucursales.map(s=>`<option value="${s.id}" ${u&&u.sucursalId===s.id?'selected':''}>${esc(s.name)}</option>`).join('')}</select></div>
      <div class="field"><label>Teléfono</label><input class="input" id="uPhone" value="${u?esc(u.phone||''):''}" placeholder="Ej: 8888-8888"></div>
    </div>
    ${u?`<div class="field"><label>Estado</label><select class="select" id="uActive"><option value="1" ${u.active?'selected':''}>Activo</option><option value="0" ${!u.active?'selected':''}>Inactivo</option></select></div>`:''}
  </div>
  <div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">Cancelar</button><button class="btn btn-primary" onclick="saveUser('${u?u.id:''}')">Guardar</button></div>`;
}
async function saveUser(id){
  const name=$('#uName').value.trim(); if(!name){ toast('Ponele nombre','err'); return; }
  const role=$('#uRole').value, sucursalId=$('#uSuc').value, phone=($('#uPhone')?$('#uPhone').value.trim():'');
  const pinRaw=($('#uPin')?$('#uPin').value.trim():'');
  if(id){
    const u=userById(id); if(!u) return;
    u.name=name; u.role=role; u.sucursalId=sucursalId; u.phone=phone; u.active=$('#uActive').value==='1'; u.updatedAt=now();
    if(pinRaw){ if(!/^\d{4}$/.test(pinRaw)){ toast('El PIN debe ser de 4 dígitos','err'); return; } await setUserPin(u,pinRaw); u.mustChangePin=false; }
    audit('equipo',`editó al usuario ${name}`);
  } else {
    if(!/^\d{4}$/.test(pinRaw)){ toast('Poné un PIN de 4 dígitos para el nuevo usuario','err'); return; }
    const u={id:uid(),name,role,sucursalId,phone,active:true,mustChangePin:true,at:now(),updatedAt:now()};
    await setUserPin(u,pinRaw);
    DB.users.push(u);
    audit('equipo',`agregó al usuario ${name} (${roleInfo(role).short})`);
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
let invCat='todas', invLowOnly=false, invSearch='', invArea='todas';
function viewInventario(){
  const areas=invAreasFor();
  if(areas.length<=1) invArea='todas';
  const all=invInScope();
  const scoped = invArea!=='todas' ? all.filter(p=>(p.area||'cocina')===invArea) : all;
  let list=[...scoped];
  if(invCat!=='todas') list=list.filter(p=>p.category===invCat);
  if(invLowOnly) list=list.filter(lowStock);
  if(invSearch) list=list.filter(p=>p.name.toLowerCase().includes(invSearch.toLowerCase()));
  list.sort((a,b)=>(lowStock(b)-lowStock(a))||a.name.localeCompare(b.name));
  const value=scoped.reduce((s,p)=>s+p.stock*p.cost,0);
  const low=scoped.filter(lowStock).length;
  const editor=canInvEdit();
  const areaName = areas.length>1 ? (invArea==='todas'?'Cocina y Bar':INV_AREA_LABEL[invArea]) : (areas[0]?INV_AREA_LABEL[areas[0]]:'');

  const guide=sectionGuide('inventario','¿Cómo funciona el inventario?',`
    Es la <b>bodega del restaurante</b>. Cada producto tiene su stock, su mínimo y su costo.
    <ul style="margin:8px 0 0 18px">
      <li>Proveeduría registra <b>entradas</b> (compras) y <b>salidas</b> (uso, merma).</li>
      <li>Cuando se entrega un <b>pedido ligado a un producto</b>, el inventario se descuenta solo.</li>
      <li>Si algo baja del mínimo, sale una <b>alerta</b> de inventario bajo.</li>
    </ul>
    <div class="tip"><b>Tip:</b> ligá los pedidos a un producto para no tener que descontar a mano.</div>`);

  let html=`<div class="page-head"><div><div class="page-title">Inventario · ${areaName}</div><div class="page-sub">${scoped.length} productos · valor ${money(value)}${editor?'':' · solo lectura'}</div></div>
    <div class="ph-spacer"></div>
    ${editor?`<button class="btn btn-ghost" style="flex:0 0 auto" onclick="invoicesModal()">${svgIcon('clipboard','icon icon-sm')} Facturas</button><button class="btn btn-ghost" style="flex:0 0 auto" onclick="invMovesModal()">${svgIcon('list','icon icon-sm')} Movimientos</button><button class="btn btn-ghost" style="flex:0 0 auto" onclick="invNewModal()">${svgIcon('plus','icon icon-sm')} Producto</button><button class="btn btn-primary" style="flex:0 0 auto" onclick="invoiceModal()">${svgIcon('truck','icon icon-sm')} Registrar factura</button>`:''}</div>`;
  html+=guide;
  html+=`<div class="kpi-row">
    <div class="kpi"><div class="label">Productos</div><div class="value">${scoped.length}</div><div class="sub">en ${sucName(visibleSuc())}</div></div>
    <div class="kpi ${low?'alert':'good'}"><div class="label">Bajo mínimo</div><div class="value">${low}</div><div class="sub">requieren compra</div></div>
    <div class="kpi"><div class="label">Valor total</div><div class="value" style="font-size:22px">${money(value)}</div><div class="sub">cantidad × costo</div></div>
    <div class="kpi"><div class="label">Categorías</div><div class="value">${new Set(scoped.map(p=>p.category)).size}</div><div class="sub">tipos de insumo</div></div>
  </div>`;
  html+=`<div class="toolbar">
    <input class="input search" placeholder="Buscar producto…" value="${esc(invSearch)}" oninput="invSearch=this.value;clearTimeout(window._is);window._is=setTimeout(render,250)">
    ${areas.length>1?`<button class="chip ${invArea==='todas'?'on':''}" onclick="invArea='todas';invCat='todas';render()">Cocina y Bar</button>`+areas.map(a=>`<button class="chip ${invArea===a?'on':''}" onclick="invArea='${a}';invCat='todas';render()">${INV_AREA_LABEL[a]}</button>`).join(''):''}
  </div>
  <div class="toolbar">
    <select class="select" style="max-width:240px" onchange="invCat=this.value;render()">
      <option value="todas" ${invCat==='todas'?'selected':''}>Todas las categorías</option>
      ${catsVisible().map(c=>`<option value="${esc(c)}" ${invCat===c?'selected':''}>${esc(c)}</option>`).join('')}
    </select>
    <button class="chip ${invLowOnly?'on':''}" onclick="invLowOnly=!invLowOnly;render()">Solo inventario bajo</button>
    ${editor?`<button class="chip" onclick="catManagerModal()">${svgIcon('edit','icon icon-sm')} Categorías</button>`:''}
  </div>`;
  html+= list.length? list.map(invRow).join('')
    : emptyState('📦','Sin productos','Agregá productos para llevar el control de la bodega.', editor?'+ Producto':'', editor?'invNewModal()':'');
  return html;
}
function invRow(p){
  const editor=canInvEditArea(p.area||'cocina'); const lw=lowStock(p);
  const sug=lw?suggestReorder(p):0;
  const pct=p.minStock>0 ? Math.max(4,Math.min(100,Math.round(p.stock/(p.minStock*1.5)*100))) : 100;
  return `<div class="inv-card ${lw?'low':''}">
    <div class="inv-stock">
      <div class="inv-stock-n">${p.stock}<span>${esc(p.unit)}</span></div>
      <div class="inv-bar"><div style="width:${pct}%"></div></div>
      <div class="inv-min">mín ${p.minStock}</div>
    </div>
    <div class="inv-info">
      <div class="inv-name">${esc(p.name)} <span class="inv-area">${INV_AREA_LABEL[p.area||'cocina']}</span>${lw?' <span class="pill atrasada">Reponer</span>':''}</div>
      <div class="inv-meta">${esc(p.category)} · ${money(p.cost)}/${esc(p.unit)}${p.supplier?' · '+esc(p.supplier):''} · ${esc(sucName(p.sucursalId))}${lw&&sug?` · <b style="color:var(--warn)">Sugerido pedir ${sug} ${esc(p.unit)}</b>`:''}</div>
    </div>
    <div class="inv-actions">
      ${editor?`<button class="ibtn ok" title="Entrada — sumar stock" onclick="invMoveModal('${p.id}','entrada')">${svgIcon('up','icon icon-sm')}<span>Entrada</span></button>
        <button class="ibtn danger" title="Salida — restar stock" onclick="invMoveModal('${p.id}','salida')">${svgIcon('down','icon icon-sm')}<span>Salida</span></button>
        <button class="ibtn" title="Editar producto" onclick="invEditModal('${p.id}')">${svgIcon('edit','icon icon-sm')}</button>${lw?`<button class="ibtn" title="Pedir reposición a proveeduría" onclick="pedirProducto('${p.id}',${sug||0})">${svgIcon('box','icon icon-sm')}<span>Pedir</span></button>`:''}`
       :`<button class="ibtn" title="Pedir a proveeduría" onclick="pedirProducto('${p.id}',${sug||0})">${svgIcon('box','icon icon-sm')}<span>Pedir${lw&&sug?' '+sug:''}</span></button>`}
    </div>
  </div>`;
}
function invMoveModal(pid,type){
  const p=DB.inventory.find(x=>x.id===pid); if(!p) return;
  const ent=type==='entrada';
  openModal(`
    <div class="modal-head"><h3>${svgIcon(ent?'up':'down','icon')} ${ent?'Entrada de stock':'Salida de stock'}</h3><button class="modal-close" onclick="closeModal()">${svgIcon('x','icon')}</button></div>
    <div class="modal-body">
      <div class="card" style="margin:0 0 16px;display:flex;align-items:center;gap:14px;padding:14px">
        <div class="inv-stock-n">${p.stock}<span>${esc(p.unit)}</span></div>
        <div><div style="font-weight:700">${esc(p.name)}</div><div class="page-sub" style="margin:2px 0 0">${INV_AREA_LABEL[p.area||'cocina']} · mínimo ${p.minStock} ${esc(p.unit)}</div></div>
      </div>
      <div class="field"><label>¿Cuánto ${ent?'entró':'salió'}? (${esc(p.unit)})</label><input class="input" id="imQty" type="number" min="0" step="any" value="1" oninput="imPreview('${pid}','${type}')"></div>
      <div class="sh-preview" id="imRes" style="margin-bottom:14px"></div>
      <div class="field"><label>Nota (opcional)</label><input class="input" id="imNote" placeholder="${ent?'Ej: compra a proveedor':'Ej: merma / uso de cocina'}"></div>
    </div>
    <div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">Cancelar</button><button class="btn btn-primary" onclick="applyInvMove('${pid}','${type}')">${ent?'Sumar al stock':'Restar del stock'}</button></div>`);
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
  audit('inventario',`${type==='entrada'?'+':'-'}${q} ${p.unit} de "${p.name}"${note?' ('+note+')':''}`,p.sucursalId);
  if(type==='salida'&&lowStock(p)) notify(DB.users.filter(u=>u.role==='proveeduria'||u.role==='admin').map(u=>u.id), `Inventario bajo: ${p.name} (${p.stock} ${p.unit})`,'⚠️',{view:'inventario'});
  closeModal(); toast('Inventario actualizado','ok'); render();
}
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
      <div class="field"><label>Bodega / área</label><select class="select" id="ipArea" onchange="fillCatOptions()">${editable.map(a=>`<option value="${a}" ${a===defArea?'selected':''}>${INV_AREA_LABEL[a]}</option>`).join('')}</select></div>
      <div class="field"><label>Categoría</label><select class="select" id="ipCat">${(()=>{const cats=catsForArea(defArea);const list=(p&&p.category&&!cats.includes(p.category))?[p.category,...cats]:cats;return list.map(c=>`<option ${p&&p.category===c?'selected':''}>${esc(c)}</option>`).join('');})()}</select></div>
    </div>
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
  const data={name,area:($('#ipArea')?$('#ipArea').value:'cocina'),category:$('#ipCat').value,unit:$('#ipUnit').value,stock:numClamp($('#ipStock').value,0,1e7),
    minStock:numClamp($('#ipMin').value,0,1e7),cost:numClamp($('#ipCost').value,0,1e9),supplier:clip($('#ipSup').value,80),sucursalId:$('#ipSuc').value};
  if(id){ const p=DB.inventory.find(x=>x.id===id); Object.assign(p,data); audit('inventario',`editó el producto "${name}"`,p.sucursalId); }
  else { DB.inventory.push({id:uid(),...data}); audit('inventario',`agregó el producto "${name}"`,data.sucursalId); }
  closeModal(); toast('Producto guardado','ok'); render();
}
function invMovesModal(){
  const moves=DB.invMoves.filter(m=>inScope(m.sucursalId)).slice(0,80);
  const rows=moves.map(m=>{
    const p=DB.inventory.find(x=>x.id===m.productId); const u=userById(m.byId);
    const sign=m.type==='entrada'?'+':'−'; const col=m.type==='entrada'?'var(--success)':'var(--danger)';
    return `<div class="log-item"><b style="color:${col}">${sign}${m.qty}</b> ${p?esc(p.name):'—'} · ${esc(m.type)} · ${u?esc((u.name||'').split(' ')[0]):''}${m.note?' · '+esc(m.note):''} <span style="opacity:.7">· ${fmtDateTime(m.at)}</span></div>`;
  }).join('');
  openModal(`<div class="modal-head"><h3>Movimientos de inventario</h3><button class="modal-close" onclick="closeModal()">×</button></div>
    <div class="modal-body">${moves.length?`<div class="log">${rows}</div>`:'<div class="empty"><div class="em-ico">📜</div><div class="em-d">Sin movimientos todavía.</div></div>'}</div>`,true);
}
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
    return {productId:match?match.id:'', name:match?match.name:name, category:match?match.category:(catsForArea(area)[0]||''), unit, qty:+it.cantidad||1, cost:Math.round(+it.costo_unitario||0)};
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
  html+=`<div class="toolbar"><input class="input search" placeholder="Buscar plato…" value="${esc(recSearch)}" oninput="recSearch=this.value;clearTimeout(window._rcs);window._rcs=setTimeout(render,250)">
    ${['todas',...cats].map(k=>`<button class="chip ${recCat===k?'on':''}" data-c="${esc(k)}" onclick="recCat=this.dataset.c;render()">${k==='todas'?'Todas':esc(k)}</button>`).join('')}</div>`;
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
let horMode='mia', horDay='', attDay='';
function viewHorarios(){
  const manage=canShiftManage();
  const todayISO=new Date().toISOString().slice(0,10);
  if(!horDay) horDay=todayISO;
  if(!manage && !['mia','general'].includes(horMode)) horMode='mia';
  const today=new Date(); today.setHours(0,0,0,0);
  const days=[...Array(7)].map((_,d)=>{const x=new Date(today);x.setDate(today.getDate()+d);return x;});
  const guide=sectionGuide('horarios','¿Cómo funcionan los Horarios?',`
    Acá ves los <b>turnos de la semana</b>. ${manage?'Asignás un turno eligiendo a la persona, la hora y, si hace falta, los quiebres (descansos).':'Ves tu turno de cada día con sus quiebres.'}
    <ul style="margin:8px 0 0 18px"><li><b>Mi semana</b> te muestra tus 7 días de un vistazo: cuándo entrás, cuándo salís y tus descansos.</li><li>La <b>Vista general</b> muestra en una línea de tiempo de qué hora a qué hora trabaja cada quien por área.</li><li>Cada persona recibe un aviso <b>el día anterior</b> y en <b>Inicio</b> ve si hoy trabaja o está libre.</li></ul>`);
  let html=`<div class="page-head"><div><div class="page-title">Horarios</div><div class="page-sub">Próximos 7 días</div></div>
    <div class="ph-spacer"></div>${manage?`<button class="btn btn-primary" style="flex:0 0 auto" onclick="shiftNewModal()">${svgIcon('plus','icon icon-sm')} Asignar turno</button>`:''}</div>`;
  html+=guide;
  const modes=manage
    ? [['mia','Mi semana'],['general','Vista general'],['asistencia','Asistencia'],['lista','Lista por día']]
    : [['mia','Mi semana'],['general','Ver equipo']];
  html+=`<div class="hor-modes">${modes.map(([k,l])=>`<button class="chip ${horMode===k?'on':''}" onclick="horMode='${k}';render()">${l}</button>`).join('')}</div>`;
  html+= horMode==='mia' ? horMine(days) : horMode==='general' ? horTimeline(days) : horMode==='asistencia' ? horAsistencia() : horList(days,manage);
  return html;
}
/* Reporte de marcas reales de entrada/salida (encargados). Muestra los últimos 7 días;
   por persona lista todas las sesiones del día y el total trabajado, agrupado por área. */
function horAsistencia(){
  const base=new Date(); base.setHours(12,0,0,0);   // mediodía local: evita saltos de día por zona horaria
  const past=[...Array(7)].map((_,d)=>{ const x=new Date(base); x.setDate(base.getDate()-d); return x; }); // hoy, ayer, ...
  const tISO=todayISO();
  if(!past.some(d=>isoLocal(d)===attDay)) attDay=tISO;
  const chips=past.map((d,di)=>{
    const iso=isoLocal(d);
    const n=(DB.attendance||[]).filter(a=>a&&inScope(a.sucursalId)&&a.date===iso&&attSessions(a).length&&userById(a.userId)).length;
    const lbl=(di===0?'Hoy':di===1?'Ayer':d.toLocaleDateString('es-CR',{weekday:'short'}).replace('.','')+' '+d.getDate());
    return `<button class="chip ${attDay===iso?'on':''}" onclick="attDay='${iso}';render()">${lbl}${n?`<span class="chip-dot">${n}</span>`:''}</button>`;
  }).join('');
  let html=`<div class="toolbar" style="overflow-x:auto">${chips}</div>`;
  const day=(DB.attendance||[]).filter(a=>a&&inScope(a.sucursalId)&&a.date===attDay&&attSessions(a).length);
  if(!day.length) return html+emptyState('','Sin marcas ese día','Cuando alguien marque entrada o salida, su registro aparece acá.');
  let body='', totMin=0, totPpl=0;
  HOR_DEPTS.forEach(dept=>{
    const rows=day.filter(a=>{const u=userById(a.userId); return u && dept.roles.includes(u.role);})
      .sort((x,y)=>(userById(x.userId)?.name||'').localeCompare(userById(y.userId)?.name||''));
    if(!rows.length) return;
    body+=`<div class="tl-dept">${dept.label}</div>`;
    rows.forEach(a=>{
      const u=userById(a.userId); const ss=attSessions(a); const open=attOpen(a); const m=attWorkedMin(a);
      totMin+=m; totPpl++;
      body+=`<div class="sched-row">${avatarHTML(u)}
        <div class="tk-main"><div class="tk-title">${u?esc(u.name):'—'} ${open?'<span class="pill proceso">en turno</span>':''}</div>
          ${attSegsHTML(ss)}</div>
        <div class="att-total">${m?fmtDur(m):'—'}</div></div>`;
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
function shiftForm(title,s){
  const people=scopedPeople(false);
  const d=new Date(); d.setMinutes(d.getMinutes()-d.getTimezoneOffset());
  const date=s?s.date:d.toISOString().slice(0,10);
  const st=s&&s.start?s.start:'10:00', en=s&&s.end?s.end:'18:00';
  return `<div class="modal-head"><h3>${title}</h3><button class="modal-close" onclick="closeModal()">${svgIcon('x','icon')}</button></div>
  <div class="modal-body">
    <div class="field"><label>¿A quién?</label><select class="select" id="shUser">${people.map(u=>`<option value="${u.id}" ${s&&s.userId===u.id?'selected':''}>${esc(u.name)} — ${roleInfo(u.role).short}</option>`).join('')}</select></div>
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
  <div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">Cancelar</button><button class="btn btn-primary" onclick="saveShift('${s?s.id:''}')">Guardar turno</button></div>`;
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
function attOpen(a){ return attSessions(a).find(s=>s && s.in && !s.out); }   // sesión abierta (entró y no salió)
function attWorkedMin(a){ return attSessions(a).reduce((s,x)=>s+((x.in&&x.out)?Math.max(0,Math.round((x.out-x.in)/60000)):0),0); }
function attSyncLegacy(a){ const ss=attSessions(a); a.in = ss.length?ss[0].in:null; a.out = (ss.length && ss.every(s=>s.out))? ss[ss.length-1].out : null; } // resumen para vistas/reportes viejos
function attNormSessions(a){ return attSessions(a).map(s=>({id:s.id||uid(), in:s.in, out:s.out||null})); } // ids estables + copia mutable (migra in/out viejos)
function markIn(){
  const m=me(); if(!m){ toast('Tu sesión no es válida — volvé a entrar','err'); return; }
  DB.attendance=DB.attendance||[]; let a=todayAttendance();
  // id determinista por persona+día: si dos equipos marcan sin haber sincronizado, crean el MISMO id y la nube los une (no se duplica el día).
  if(!a){ a={id:'att_'+m.id+'_'+todayISO(), userId:m.id, date:todayISO(), sucursalId:m.sucursalId, sessions:[], updatedAt:now()}; DB.attendance.push(a); }
  a.sessions=attNormSessions(a);
  if(attOpen(a)){ toast('Ya tenés una entrada abierta — marcá la salida primero','ok'); return; }
  const t=now(); a.sessions.push({id:uid(),in:t,out:null}); attSyncLegacy(a);
  audit('horarios',`marcó ENTRADA ${fmtClock(t)}`); toast('Entrada marcada ✓','ok'); render();
}
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
function attSegsHTML(ss){
  return `<div class="att-segs">${ss.map(s=>`<span class="att-seg${s.out?'':' open'}">${fmtClock(s.in)} <span class="att-arrow">→</span> ${s.out?fmtClock(s.out):'en turno'}</span>`).join('')}</div>`;
}
function attendanceCard(){
  const a=todayAttendance(); const ss=attSessions(a); const open=attOpen(a);
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
   VISTA: REPORTES (Gerencia / Contabilidad)
   ===================================================================== */
let repMonth='';
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
function reportData(ym){
  const tasks=(DB.tasks||[]).filter(t=>t&&inScope(t.sucursalId));
  const peds=(DB.pedidos||[]).filter(p=>p&&inScope(p.sucursalId));
  const sales=(DB.souvSales||[]).filter(v=>v&&inScope(v.sucursalId)&&inMonth(v.at,ym));
  const inv=invInScope();
  const tMonth=tasks.filter(t=>inMonth(t.createdAt,ym));
  const st=s=>tMonth.filter(t=>t.status===s).length;
  const done=st('hecha'),late=st('atrasada'),rej=st('rechazada'),proc=st('proceso'),pend=st('pendiente');
  const compl=tMonth.length?Math.round(done/tMonth.length*100):0;
  const pMonth=peds.filter(p=>inMonth(p.createdAt,ym));
  const pDeliv=pMonth.filter(p=>p.status==='entregado').length;
  const areas={proveeduria:0,contabilidad:0,rrhh:0}; pMonth.forEach(p=>{ if(areas[p.area]!==undefined) areas[p.area]++; });
  const ingresos=sales.reduce((s,v)=>s+(+v.price||0)*(+v.qty||0),0);
  const ganancia=sales.reduce((s,v)=>s+((+v.price||0)-(+v.cost||0))*(+v.qty||0),0);
  const unidades=sales.reduce((s,v)=>s+(+v.qty||0),0);
  const invVal=inv.reduce((s,p)=>s+p.stock*p.cost,0);
  const invLow=inv.filter(lowStock).length;
  const shifts=(DB.shifts||[]).filter(s=>s&&inScope(s.sucursalId)&&!s.off&&(s.date||'').startsWith(ym));
  const att=(DB.attendance||[]).filter(a=>a&&inScope(a.sucursalId)&&(a.date||'').startsWith(ym)&&attSessions(a).length);
  const prod=DB.users.filter(u=>u.active).map(u=>{
    const mine=tMonth.filter(t=>(t.toIds||[]).includes(u.id));
    const h=mine.filter(t=>t.status==='hecha').length, a=mine.filter(t=>t.status==='atrasada').length, rj=mine.filter(t=>t.status==='rechazada').length;
    const dias=shifts.filter(s=>s.userId===u.id).length;
    const myAtt=att.filter(x=>x.userId===u.id);
    const presente=myAtt.length;                                              // días con marca real de entrada
    const horas=Math.round(myAtt.reduce((s,x)=>s+attWorkedMin(x),0)/60*10)/10;  // horas reales trabajadas (suma todas las sesiones del día)
    const pct=mine.length?Math.round(h/mine.length*100):0;
    return {u,total:mine.length,h,a,rj,dias,presente,horas,pct};
  }).filter(x=>x.total>0||x.dias>0||x.presente>0).sort((a,b)=>b.pct-a.pct||b.h-a.h||b.presente-a.presente);
  const r=monthRange(ym);
  const salesDay=[]; for(let dd=1;dd<=r.days;dd++){ const v=sales.filter(s=>new Date(s.at).getDate()===dd).reduce((a,b)=>a+(+b.price||0)*(+b.qty||0),0); salesDay.push({day:dd,value:v}); }
  const catVal={}; inv.forEach(p=>{ catVal[p.category]=(catVal[p.category]||0)+p.stock*p.cost; });
  return {ym,tasks,tMonth,done,late,rej,proc,pend,compl,peds,pMonth,pDeliv,areas,sales,ingresos,ganancia,unidades,inv,invVal,invLow,shifts,prod,salesDay,catVal};
}
function viewReportes(){
  if(!repMonth) repMonth=ymOf(Date.now());
  const ym=repMonth; const d=reportData(ym);
  const guide=sectionGuide('reportes','Reportes de Gerencia',`
    Resumen del restaurante <b>mes a mes</b> para tomar decisiones: cumplimiento por puesto, asistencia, pedidos, ventas e inventario.
    <ul style="margin:8px 0 0 18px"><li>Cambiá de mes con las flechas; todo se recalcula.</li><li>Tocá <b>Generar reporte</b> para una versión imprimible / PDF.</li></ul>
    <div class="tip"><b>Importante:</b> el cumplimiento sale del historial real de tareas, no se puede inflar.</div>`);
  let html=`<div class="page-head"><div><div class="page-title">Reportes</div><div class="page-sub">${esc(sucName(visibleSuc()))}</div></div>
    <div class="ph-spacer"></div>
    <div class="rep-month"><button class="icon-btn" style="width:32px;height:32px" onclick="repShift(-1)" title="Mes anterior">${svgIcon('back','icon icon-sm')}</button><b>${esc(cap(monthLabel(ym)))}</b><button class="icon-btn" style="width:32px;height:32px" onclick="repShift(1)" title="Mes siguiente"><svg class="icon icon-sm" viewBox="0 0 24 24" style="transform:scaleX(-1)"><use href="#i-back"/></svg></button></div>
    <button class="btn btn-ghost" style="flex:0 0 auto" onclick="exportReportCSV()">${svgIcon('down','icon icon-sm')} Exportar CSV</button>
    <button class="btn btn-primary" style="flex:0 0 auto" onclick="generateMonthlyReport()">${svgIcon('save','icon icon-sm')} Generar reporte</button></div>`;
  html+=guide;
  html+=`<div class="kpi-row">
    <div class="kpi ${d.compl>=70?'good':d.compl>=40?'warn':'alert'}"><div class="label">Cumplimiento</div><div class="value">${d.compl}%</div><div class="sub">${d.done}/${d.tMonth.length} tareas hechas</div></div>
    <div class="kpi ${d.late?'alert':'good'}"><div class="label">Atrasadas</div><div class="value">${d.late}</div><div class="sub">${d.rej} rechazadas</div></div>
    <div class="kpi"><div class="label">Pedidos del mes</div><div class="value">${d.pMonth.length}</div><div class="sub">${d.pDeliv} entregados</div></div>
    <div class="kpi ok"><div class="label">Ventas souvenirs</div><div class="value" style="font-size:20px">${money(d.ingresos)}</div><div class="sub">ganancia ${money(d.ganancia)}</div></div>
  </div>`;
  const stMax=Math.max(1,d.done,d.proc,d.pend,d.late,d.rej);
  const aMax=Math.max(1,...Object.values(d.areas));
  const catE=Object.entries(d.catVal).sort((a,b)=>b[1]-a[1]); const cMax=Math.max(1,...catE.map(e=>e[1]),1);
  html+=`<div class="chart-grid">
    <div class="chartcard"><div class="chart-title">${svgIcon('check','icon icon-sm')} Estado de tareas del mes</div>
      ${bar('Hechas',d.done,stMax,'var(--success)')}${bar('En proceso',d.proc,stMax,'var(--info)')}${bar('Pendientes',d.pend,stMax,'var(--text-soft)')}${bar('Atrasadas',d.late,stMax,'var(--warn)')}${bar('Rechazadas',d.rej,stMax,'var(--danger)')}</div>
    <div class="chartcard"><div class="chart-title">${svgIcon('box','icon icon-sm')} Pedidos por área</div>
      ${bar('Proveeduría',d.areas.proveeduria,aMax,'var(--success)')}${bar('Contabilidad',d.areas.contabilidad,aMax,'var(--info)')}${bar('Recursos Humanos',d.areas.rrhh,aMax,'var(--accent)')}</div>
  </div>`;
  html+=`<div class="chart-grid">
    <div class="chartcard"><div class="chart-title">${svgIcon('chart','icon icon-sm')} Valor de inventario por categoría</div>
      ${catE.length?catE.map(([c,v])=>bar(c,Math.round(v),cMax,'var(--accent-2)')).join(''):'<div class="chart-empty">Sin inventario cargado.</div>'}</div>
    <div class="chartcard"><div class="chart-title">${svgIcon('trend','icon icon-sm')} Ventas de souvenirs por día</div>
      ${d.sales.length?repVBars(d.salesDay.map(x=>({lbl:(x.day%5===0||x.day===1)?x.day:'',value:x.value,title:`Día ${x.day}: ${money(x.value)}`}))):'<div class="chart-empty">Sin ventas de souvenirs este mes.</div>'}</div>
  </div>`;
  html+=`<div class="card"><div class="rep-tbl-title">${svgIcon('users','icon icon-sm')} Cumplimiento y asistencia por persona</div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Persona</th><th>Puesto</th><th title="Días con turno planificado">Días plan.</th><th title="Días que marcó entrada">Presente</th><th title="Horas reales (entrada→salida)">Horas</th><th>Asign.</th><th>Hechas</th><th>Atras.</th><th>%</th></tr></thead><tbody>
    ${d.prod.map(x=>`<tr><td><div style="display:flex;align-items:center;gap:8px">${avatarHTML(x.u)}<span style="font-weight:600">${esc(x.u.name)}</span></div></td>
      <td>${roleInfo(x.u.role).short}</td><td>${x.dias}</td><td style="font-weight:700">${x.presente}</td><td><b>${x.horas?x.horas+'h':'—'}</b></td><td>${x.total}</td><td style="color:var(--success);font-weight:700">${x.h}</td>
      <td style="color:${x.a?'var(--warn)':'inherit'};font-weight:${x.a?700:400}">${x.a}</td>
      <td><b>${x.pct}%</b></td></tr>`).join('') || '<tr><td colspan="9" style="color:var(--text-soft)">Sin actividad registrada en el mes.</td></tr>'}
    </tbody></table></div></div>`;
  if(isAdmin()){
    const sucAct=DB.sucursales.map(s=>({s,n:(DB.audit||[]).filter(a=>a.sucursalId===s.id&&inMonth(a.at,ym)).length}));
    const sMax=Math.max(1,...sucAct.map(y=>y.n));
    html+=`<div class="chartcard"><div class="chart-title">${svgIcon('pin','icon icon-sm')} Actividad por sucursal (mes)</div>${sucAct.map(x=>bar(x.s.name,x.n,sMax,'var(--accent)')).join('')}</div>`;
  }
  return html;
}
// Exportar el reporte del mes a CSV (para contabilidad / Excel)
function exportReportCSV(){
  const ym=repMonth||ymOf(Date.now()); const d=reportData(ym);
  const esc=s=>{ s=String(s==null?'':s); return /[",;\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s; };
  const rows=[];
  rows.push(['Reporte', cap(monthLabel(ym)), sucName(visibleSuc())]);
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
  a.download='sabor-tico-reporte-'+ym+'.csv'; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),60000);
  toast('Reporte CSV descargado','ok');
}
window.exportReportCSV=exportReportCSV;
function generateMonthlyReport(){
  const ym=repMonth||ymOf(Date.now()); const d=reportData(ym);
  const ml=cap(monthLabel(ym)); const suc=sucName(visibleSuc());
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
let resvTab='lista', resvFilter='proximas', resvEstado='todos', resvSearch='', clientSearch='';
function reservScoped(){ return (DB.reservations||[]).filter(r=>r&&inScope(r.sucursalId)); }
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
  html+=`<div class="hor-modes"><button class="chip ${resvTab==='lista'?'on':''}" onclick="resvTab='lista';render()">Reservaciones</button><button class="chip ${resvTab==='clientes'?'on':''}" onclick="resvTab='clientes';render()">Clientes y agencias</button></div>`;
  html+= resvTab==='clientes' ? reservClientes(editor) : reservLista(editor);
  return html;
}
function reservLista(editor){
  const today=todayISO();
  let list=reservScoped();
  if(resvFilter==='hoy') list=list.filter(r=>r.resDate===today);
  else if(resvFilter==='proximas') list=list.filter(r=>r.resDate>=today);
  else if(resvFilter==='pasadas') list=list.filter(r=>r.resDate<today);
  if(resvEstado!=='todos') list=list.filter(r=>r.status===resvEstado);
  if(resvSearch){ const q=resvSearch.toLowerCase(); list=list.filter(r=>(r.clientName||'').toLowerCase().includes(q)||(r.phone||'').includes(resvSearch)); }
  list.sort((a,b)=> (a.resDate+a.resTime).localeCompare(b.resDate+b.resTime));
  const hoyN=reservScoped().filter(r=>r.resDate===today && r.status!=='cancelada').length;
  const proxN=reservScoped().filter(r=>r.resDate>today && (r.status==='pendiente'||r.status==='confirmada')).length;
  const persHoy=reservScoped().filter(r=>r.resDate===today && r.status!=='cancelada').reduce((s,r)=>s+(+r.people||0),0);
  let html=`<div class="kpi-row">
    <div class="kpi"><div class="label">Hoy</div><div class="value">${hoyN}</div><div class="sub">reservas de hoy</div></div>
    <div class="kpi"><div class="label">Personas hoy</div><div class="value">${persHoy}</div><div class="sub">total esperado</div></div>
    <div class="kpi ${proxN?'warn':''}"><div class="label">Próximas</div><div class="value">${proxN}</div><div class="sub">por venir</div></div>
    <div class="kpi"><div class="label">Clientes</div><div class="value">${(DB.clients||[]).length}</div><div class="sub">en la base</div></div>
  </div>`;
  html+=`<div class="toolbar">
    <input class="input search" placeholder="Buscar cliente o teléfono…" value="${esc(resvSearch)}" oninput="resvSearch=this.value;clearTimeout(window._rs);window._rs=setTimeout(render,250)">
    ${[['hoy','Hoy'],['proximas','Próximas'],['pasadas','Pasadas'],['todas','Todas']].map(([k,l])=>`<button class="chip ${resvFilter===k?'on':''}" onclick="resvFilter='${k}';render()">${l}</button>`).join('')}
    <select class="select" style="max-width:170px" onchange="resvEstado=this.value;render()"><option value="todos" ${resvEstado==='todos'?'selected':''}>Todos los estados</option>${Object.entries(RESERV_EST).map(([k,v])=>`<option value="${k}" ${resvEstado===k?'selected':''}>${v.l}</option>`).join('')}</select>
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
function newReservModal(){ openModal(reservForm('Nueva reservación',null), true); }
function reservForm(title,r){
  const d=new Date(); d.setMinutes(d.getMinutes()-d.getTimezoneOffset());
  const date=r?r.resDate:d.toISOString().slice(0,10);
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
      <div class="field"><label>Hora</label>${timePicker('rvTime', r?r.resTime:'19:00', '')}</div>
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
      <div class="souv-price">${money(p.price)} <span class="cur-usd">${usd(p.price)}</span></div>
      <div class="souv-stock ${souvLow(p)&&!out?'low':''} ${out?'zero':''}">${out?'Agotado':'Quedan '+(+p.stock||0)}</div>
      ${money_?`<div class="souv-gan">Ganás ${money(souvProfit(p))} c/u</div>`:''}
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
    <button class="um-item" onclick="toggleTheme()">${svgIcon('theme')} Cambiar tema</button>
    <button class="um-item" onclick="exportData()">${svgIcon('save')} Respaldar datos</button>
    <button class="um-item" onclick="document.getElementById('importFile').click()">${svgIcon('down')} Restaurar respaldo</button>
    ${isAdmin()?`<button class="um-item" onclick="autoBackupsModal()">${svgIcon('clipboard')} Respaldos automáticos</button>`:''}
    ${isAdmin()?`<button class="um-item" onclick="errorsModal()">${svgIcon('info')} Errores recientes</button>`:''}
    ${isAdmin()?`<button class="um-item" onclick="reloadFromCloud()">${svgIcon('down')} Recargar desde la nube</button>`:''}
    ${isAdmin()?`<button class="um-item" onclick="pushOverwrite()">${svgIcon('up')} Subir este equipo a la nube</button>`:''}
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
  const cv=v=>(ROLE_NAV[me().role]||[]).includes(v);
  let html='';
  const tasks=(DB.tasks||[]).filter(t=>t&&inScope(t.sucursalId)&&(hit(t.title)||hit(t.desc))).slice(0,8);
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
      <div class="login-hint" style="text-align:left;line-height:1.7">No se pudo conectar a la base. Suele ser porque el dominio no está autorizado en Firebase (Authentication → Settings → Authorized domains) o no está activado el inicio anónimo. Revisá tu internet y la configuración (ver SEGURIDAD.md).</div>
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

/* Service worker: la app abre y muestra lo último cargado aunque no haya internet.
   Solo en http(s) (en Vercel); en modo local (file://) no aplica. */
if('serviceWorker' in navigator && location.protocol.indexOf('http')===0){
  // Si entra a controlar una versión NUEVA del SW, recargar una vez para mostrar lo último
  const hadCtrl = !!navigator.serviceWorker.controller;
  let _swReloaded=false;
  navigator.serviceWorker.addEventListener('controllerchange', ()=>{ if(_swReloaded||!hadCtrl) return; _swReloaded=true; location.reload(); });
  window.addEventListener('load', ()=>{
    navigator.serviceWorker.register('sw.js').then(reg=>{ try{ reg.update(); }catch(_){} }).catch(e=>console.warn('SW', e));
  });
}
/* Sabor Tico App — fin */
