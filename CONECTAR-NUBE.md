# Conectar Sabor Tico a la nube (Firebase Realtime Database)

Esto hace que **todos vean lo mismo al instante** desde cualquier celular o computadora: tareas, pedidos, inventario, horarios, pizarra, chat y notificaciones. Usa **Firebase Realtime Database** (gratis para empezar).

Tiempo aprox: 10 minutos, una sola vez.

## Paso 1 — Crear el proyecto
1. Entrá a **https://console.firebase.google.com** (con tu cuenta de Google).
2. **Agregar proyecto** → nombre (ej: `sabor-tico`) → podés desactivar Google Analytics → **Crear proyecto**.

## Paso 2 — Crear la Realtime Database
1. Menú izquierdo → **Build → Realtime Database** → **Crear base de datos**.
2. Elegí la ubicación más cercana.
3. En reglas de seguridad elegí **"Comenzar en modo de prueba"** (luego lo ajustamos) → Habilitar.
4. Entrá a la pestaña **Reglas (Rules)** y dejá esto (para que el equipo pueda leer/escribir), y dale **Publicar**:
```json
{
  "rules": { ".read": true, ".write": true }
}
```

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
- **Seguridad:** con las reglas abiertas, cualquiera con tus datos puede leer/escribir. Para un equipo interno está bien para empezar; más adelante se puede endurecer (login real con permisos por puesto).
- **Conflictos:** si dos personas editan exactamente lo mismo en el mismo segundo, puede ganar el último cambio. Para un equipo chico funciona bien.
- **Llamadas:** quedan para una etapa siguiente (requieren un servidor de llamadas aparte). Todo lo demás ya sincroniza.
- Si dejás `config.js` vacío, la app sigue funcionando **local** (cada dispositivo con sus datos).
