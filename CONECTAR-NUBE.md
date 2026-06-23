# Conectar Sabor Tico a la nube (Firebase Realtime Database)

Esto hace que **todos vean lo mismo al instante** desde cualquier celular o computadora: tareas, pedidos, inventario, horarios, pizarra, chat y notificaciones. Usa **Firebase Realtime Database** (gratis para empezar).

Tiempo aprox: 10 minutos, una sola vez.

## Paso 1 — Crear el proyecto
1. Entrá a **https://console.firebase.google.com** (con tu cuenta de Google).
2. **Agregar proyecto** → nombre (ej: `sabor-tico`) → podés desactivar Google Analytics → **Crear proyecto**.

## Paso 2 — Crear la Realtime Database
1. Menú izquierdo → **Build → Realtime Database** → **Crear base de datos**.
2. Elegí la ubicación más cercana.
3. En reglas de seguridad elegí **"Comenzar en modo de prueba"** → Habilitar (lo vamos a asegurar enseguida).
4. **Activá el inicio de sesión anónimo:** menú **Build → Authentication → Sign-in method → Anonymous → Activar**. Esto NO cambia el login con PIN; sirve para que la app pueda entrar de forma segura a la base.
5. Recién cuando ya publicaste la app con la versión que trae el inicio anónimo, entrá a la pestaña **Reglas (Rules)** de Realtime Database, pegá esto y dale **Publicar**:
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
> La rama **signals** guarda la **presencia de las reuniones** de proyecto (quién está en la reunión,
> para mostrar "Unirse · N"). Las reuniones usan Jitsi (meet.jit.si) para el video; sin esta rama la
> reunión igual funciona, solo no se ve el conteo de participantes desde afuera.
> **Orden importante (para no quedar bloqueado):** primero publicá la app con el código nuevo, después activá *Anonymous* (paso 4) y por último publicá estas reglas (paso 5). Si publicás las reglas antes, la app no podrá entrar hasta que actives *Anonymous*. Ver **SEGURIDAD.md**.

## Paso 3 — Registrar la app web y copiar la configuración
1. Arriba a la izquierda → **⚙ Configuración del proyecto**.
2. Bajá a **"Tus apps"** → tocá el ícono web **`</>`** → registrá la app (un nombre cualquiera) → **Registrar app**.
3. Te muestra un bloque `firebaseConfig` con varios datos. **Copialos.**
   - Importante: debe incluir **`databaseURL`** (algo como `https://sabor-tico-default-rtdb.firebaseio.com`). Si no aparece, es porque la Realtime Database del Paso 2 no quedó creada; creala y volvé a copiar.

## Paso 4 — Pegar la configuración en config.js
Abrí **`config.js`** y completá con tus datos:
```js
window.SABOR_CLOUD = {
  apiKey: "....",
  authDomain: "sabor-tico.firebaseapp.com",
  databaseURL: "https://sabor-tico-default-rtdb.firebaseio.com",
  projectId: "sabor-tico",
  storageBucket: "....",
  messagingSenderId: "....",
  appId: "...."
};
```
Guardá.

## Paso 5 — Publicar
Subí los cambios a Vercel (ver **DESPLEGAR-VERCEL.md**). Cuando la abras vas a ver arriba el indicador verde **"Sincronizado"**. A partir de ahí, lo que haga una persona aparece en los demás en segundos.

## Importante
- **Seguridad:** seguí los pasos 4 y 5 de arriba (inicio anónimo + reglas cerradas). Con las reglas cerradas, solo la app puede leer/escribir; nadie de afuera puede ver ni borrar los datos. Ver **SEGURIDAD.md** para el detalle y el orden correcto.
- **Conflictos:** si dos personas editan exactamente lo mismo en el mismo segundo, puede ganar el último cambio. Para un equipo chico funciona bien.
- **Llamadas:** quedan para una etapa siguiente (requieren un servidor de llamadas aparte). Todo lo demás ya sincroniza.
- Si dejás `config.js` vacío, la app sigue funcionando **local** (cada dispositivo con sus datos).
