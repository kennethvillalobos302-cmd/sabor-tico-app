# Conectar las NOTIFICACIONES del celular (push)

Avisos que llegan al teléfono **aunque la app esté cerrada** cuando a alguien le asignan una
**tarea** o le mandan un **mensaje**. Usa Web Push (estándar del navegador) + una función
serverless en Vercel. La llave privada vive **solo en Vercel**, nunca en el navegador.

Se configura **una sola vez**. Pasos:

## 1) Generar las llaves VAPID (una vez)
En tu compu, en la carpeta del proyecto, corré:

```
npx web-push generate-vapid-keys
```

Te da dos valores: **Public Key** y **Private Key**. Guardalos.
(Si preferís sin instalar nada: hay generadores VAPID en línea, pero lo de arriba es lo más seguro.)

## 2) Agregar variables de entorno en Vercel
Vercel → tu proyecto → **Settings → Environment Variables** → agregá estas tres (Production y Preview):

| Nombre | Valor |
|---|---|
| `VAPID_PUBLIC_KEY` | la **Public Key** del paso 1 |
| `VAPID_PRIVATE_KEY` | la **Private Key** del paso 1 (¡secreta! no la compartas) |
| `VAPID_SUBJECT` | `mailto:tu-correo@ejemplo.com` (un correo de contacto) |

> Opcional: `FIREBASE_DB_URL` solo si tu base no es `https://sabor-tico-app-default-rtdb.firebaseio.com`.

Después tocá **Redeploy** (o subí un cambio) para que tome las variables.

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
