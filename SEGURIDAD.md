# Seguridad de Sabor Tico App

Este documento resume lo que ya quedó protegido en el código y los **3 pasos manuales**
que tenés que hacer una sola vez para cerrar la app por completo.

---

## ⚠️ Lo más importante (hacelo en este orden, una vez)

La parte más delicada es **cerrar la base de datos**. Si la cerrás antes de tiempo, la app
deja de entrar. Por eso, seguí este orden exacto:

1. **Publicá la app con esta versión** (subí los archivos a GitHub → Vercel redespliega solo).
   Esta versión ya trae el “inicio de sesión anónimo”, necesario para el paso 3.
2. **Activá el inicio anónimo en Firebase:**
   Firebase Console → **Build → Authentication → Sign-in method → Anonymous → Activar**.
   *(Esto NO cambia el login con PIN; es solo para que la app pueda entrar de forma segura.)*
3. **Cerrá las reglas de la base:**
   Firebase Console → **Build → Realtime Database → pestaña Reglas (Rules)** → pegá esto → **Publicar**:
   ```json
   {
     "rules": {
       ".read": false,
       ".write": false,
       "state": {
         ".read": "auth != null",
         ".write": "auth != null && newData.hasChildren(['data','client','at'])"
       },
       "media": {
         ".read": "auth != null",
         "$id": {
           ".write": "auth != null",
           ".validate": "newData.isString() && newData.val().length < 12000000"
         }
       },
       "signals": {
         "$proj": {
           ".read": "auth != null",
           ".write": "auth != null"
         }
       }
     }
   }
   ```
   > La rama **signals** es para las **llamadas/videollamadas** de los proyectos (señalización
   > efímera entre dispositivos). Sin esta rama, las llamadas no conectan. Es obligatoria desde la
   > versión con llamadas nativas.
   > La rama **media** guarda las fotos/PDF/videos aparte (cada archivo con tope ~8 MB) para que NO inflen
   > la base ni se re-descarguen en cada cambio. Es obligatoria desde la versión que mueve los binarios a un nodo aparte.
   Apenas publiques, abrí la app y comprobá que entra y que se guardan cambios. Si algo falla,
   volvé a las reglas anteriores (mientras revisás que el paso 2 quedó bien activado).

4. **Cambiá todos los PIN** una vez cerrada la base. Como antes la base estaba abierta, los PIN
   viejos hay que considerarlos “quemados”. Entrá a **Equipo / Personas → Editar** en cada persona
   y poné un PIN nuevo. (Los nuevos PIN ya se guardan cifrados, no en texto.)

5. **Tope de gasto de OpenAI** (si usás la lectura de facturas): poné un límite mensual en
   platform.openai.com → Settings → Limits. Ver **CONECTAR-FACTURAS.md**.

Con esos pasos, la app pasa de “cualquiera en internet podía ver y borrar todo” a
“solo la app, con sesión, puede leer y escribir; los PIN van cifrados; y la web está blindada”.

---

## Lo que ya quedó protegido en el código (sin que hagas nada)

- **PIN cifrados:** ya no se guardan en texto. Se guardan con hash + sal (SHA-256). Al entrar,
  los PIN viejos se actualizan solos a cifrado. En la lista de Personas ya **no se muestra el PIN**.
- **PIN nuevo obligatorio:** cuando se crea una persona, en su primer ingreso debe definir su propio PIN.
- **Bloqueo por intentos:** tras 5 PIN incorrectos, se bloquea el ingreso 15 minutos en ese dispositivo.
- **Inicio de sesión anónimo de Firebase:** la app entra a la base autenticada (necesario para las reglas cerradas).
- **Cabeceras de seguridad web (vercel.json):** Content-Security-Policy, anti-clickjacking
  (no se puede meter la app en un iframe), HSTS, no-sniff, Referrer-Policy y Permissions-Policy.
- **Reuniones (videollamadas de proyecto, Jitsi):** las reuniones usan el servicio externo
  **meet.jit.si** (un servidor de reuniones que reparte el video, necesario para que entren ~20
  personas). Por eso la CSP permite cargar su reproductor y la Permissions-Policy habilita
  cámara/micrófono **solo** para ese dominio (y para la propia app). La sala se llama
  `SaborTico-<id-de-proyecto>` con un id aleatorio (UUID), imposible de adivinar desde afuera.
  El audio/video viaja por los servidores de Jitsi, no por tu Firebase. En tu Firebase solo queda la
  **presencia** ("quién está en la reunión") bajo `signals/<id-de-proyecto>`, datos efímeros legibles
  y escribibles solo por usuarios autenticados; se autolimpian al salir.
- **Anti-XSS:** todo lo que escriben las personas se “escapa” correctamente y las imágenes/videos
  solo se aceptan si son archivos reales (se bloquea texto malicioso disfrazado de imagen).
- **Lectura de facturas más segura:** modelo más barato, límite de tamaño de archivo, control de
  cantidad de solicitudes, llamadas solo desde la propia app, mensajes de error sin filtrar detalles,
  y se ignoran instrucciones escondidas dentro de la factura.
- **Restaurar respaldo:** ahora pide confirmación, valida el archivo, guarda una copia previa y
  solo lo puede hacer Gerencia.
- **Datos compartidos:** se ignora cualquier dato remoto vacío o corrupto (no se puede borrar todo
  desde otro dispositivo con un dato malo), hay tope de tamaño de adjuntos y aviso si crece demasiado.

---

## Lo que NO se puede garantizar 100% (límites de una app sin servidor propio)

Es honesto saberlo:

- **El login con PIN es una conveniencia, no una caja fuerte.** Como toda la lógica corre en el
  navegador, alguien con conocimientos técnicos y **acceso físico a un dispositivo ya abierto** podría
  manipular la sesión. La defensa real es: cerrar las reglas (pasos de arriba), no dejar sesiones
  abiertas en equipos compartidos (desmarcá “Mantener sesión iniciada”), y PIN que no se comparten.
- **El registro de Movimientos** deja constancia de las acciones, pero el “quién” lo informa el propio
  dispositivo; no es prueba legal infalsificable.
- **Mejora futura recomendada:** mover la verificación del PIN a una función en el servidor (como la de
  facturas) que entregue un “permiso” firmado por puesto. Eso convertiría los permisos por rol en algo
  realmente imposible de saltarse. Es el siguiente nivel cuando quieran.
