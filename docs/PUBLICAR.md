# Publicar Sabor Tico App (rápido)

La app ya está lista para subir. Es estática (no necesita servidor), así que se publica en minutos.

## Opción más rápida: Netlify Drop (sin cuenta, ~2 min)

1. En la computadora, entrá a **https://app.netlify.com/drop**
2. Arrastrá **toda la carpeta `SABOR TICO APP`** al recuadro que dice "Drag and drop your site folder here".
3. En unos segundos te da un link público tipo **`https://algo-random.netlify.app`**.
4. Ese link lo compartís con tu equipo (WhatsApp, etc.). Cada quien lo abre en su celular o compu.

> Para que el link quede **permanente** y poder actualizar la app después, creá una cuenta gratis en Netlify (botón que aparece al terminar) y reclamá el sitio. Sin cuenta, el link es temporal.

## Para actualizar (cuando le metás arreglos)

- **Con cuenta Netlify:** entrás al sitio → pestaña "Deploys" → arrastrás la carpeta de nuevo. Listo, se actualiza.
- **Otra opción:** GitHub Pages, Vercel o Cloudflare Pages (todas gratis) si preferís.

## En el celular: que parezca una app

Al abrir el link en el teléfono:
- **Android (Chrome):** menú ⋮ → "Agregar a pantalla de inicio".
- **iPhone (Safari):** botón Compartir → "Agregar a inicio".

Queda con ícono propio y se abre en pantalla completa, como una app.

## Cómo entra el equipo

- Cada persona elige su nombre y pone su PIN (en la demo todos son **1234**; cambialos en **Equipo**).
- **Importante (esta versión):** los datos se guardan **en el dispositivo de cada quien**, no se sincronizan entre celulares. Sirve para que cada uno tenga su copia y se familiarice. Cuando quieras que todos vean lo mismo en tiempo real, hay que pasar a la versión en la nube (con servidor) — el siguiente paso.

## Archivos que se publican

`index.html`, `app.js`, `manifest.json`, `icon.svg` (los `.md` son solo guías, no afectan).
