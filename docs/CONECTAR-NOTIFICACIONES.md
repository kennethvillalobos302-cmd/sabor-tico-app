# Conectar las NOTIFICACIONES del celular (push)

Avisos que llegan al teléfono **aunque la app esté cerrada** cuando a alguien le asignan una
**tarea** o le mandan un **mensaje**. Usa Web Push (estándar del navegador) + una función
serverless en Vercel. La llave privada vive **solo en Vercel**, nunca en el navegador.

Se configura **una sola vez**. La llave **pública** ya viene incrustada en el código (no es
secreta), así que **solo te queda pegar la llave privada** y agregar una rama de reglas.

## 1) Las llaves ya están generadas ✓
Están en el archivo local **`.vapid.local.txt`** (en la carpeta del proyecto, NO se sube a git).
Ábrelo y copiá el valor de la línea `VAPID_PRIVATE_KEY=...` (es la que necesitás en el paso 2).
> Si querés generar unas nuevas: `npx web-push generate-vapid-keys` (y reemplazá también la
> pública incrustada en `api/push.js` y `app.js`). Normalmente NO hace falta.

## 2) Agregar UNA variable en Vercel (la privada)
Vercel → tu proyecto → **Settings → Environment Variables** → agregá **solo esta** (Production y Preview):

| Nombre | Valor |
|---|---|
| `VAPID_PRIVATE_KEY` | el valor de `VAPID_PRIVATE_KEY=` del archivo `.vapid.local.txt` (¡secreta!) |

> La pública (`VAPID_PUBLIC_KEY`) y el correo (`VAPID_SUBJECT`) ya vienen por defecto en el código,
> no hace falta ponerlas. Si algún día querés cambiarlas, podés agregarlas como variables y mandan ellas.

Después tocá **Redeploy** (o esperá el deploy del último push) para que tome la variable.

## 3) Agregar la rama `push` a las reglas de Firebase
Firebase Console → **Realtime Database → Reglas** → agregá la rama `"push"` (ver
**SEGURIDAD.md** / **CONECTAR-NUBE.md** con el bloque completo) → **Publicar**:

```json
"push": {
  "$uid": {
    ".read": "auth != null",
    ".write": "auth != null"
  }
}
```

## 4) Activar en cada teléfono (cada persona, una vez)
- Abrí la app y tocá tu **avatar** (arriba a la derecha) → **Activar notificaciones**, o el
  botón **"Activar avisos en este celular"** dentro de la campana 🔔. Aceptá el permiso.
- **iPhone (muy importante):** las notificaciones web solo funcionan si la app está
  **agregada a la pantalla de inicio**. En Safari: botón **Compartir** → **Agregar a inicio**.
  Abrí la app desde ese ícono y ahí activá las notificaciones (necesita iOS 16.4 o más).
- **Android (Chrome):** funciona directo desde el navegador o instalada.

## Cómo probar
Pedile a otra persona (o usá otro teléfono con otro usuario) que te **asigne una tarea** o te
**mande un mensaje**. Con la app cerrada, te debe llegar el aviso. Al tocarlo, abre la app en
la sección correspondiente.

## Notas
- Cada persona activa las notificaciones en **su** teléfono. Se puede activar en varios equipos.
- Si alguien desinstala/limpia el navegador, su suscripción muere sola (el sistema la borra).
- No se envían avisos a uno mismo por sus propias acciones.
