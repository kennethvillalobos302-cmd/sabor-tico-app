# Publicar la app: GitHub + Vercel

La app es estática (no necesita build). Vercel la hospeda y Firebase hace la sincronización.

## Paso 1 — Subir la carpeta a GitHub
1. Creá cuenta en **https://github.com** (si no tenés).
2. **New repository** → nombre (ej: `sabor-tico-app`) → Private o Public → Create.
3. En la página del repo: **Add file → Upload files** → arrastrá **todo el contenido** de la carpeta `SABOR TICO APP` (los archivos, no la carpeta): `index.html`, `app.js`, `config.js`, `manifest.json`, `icon.svg`, `vercel.json` (los `.md` son opcionales).
4. **Commit changes**.

> Antes de subir, asegurate de haber pegado tus datos de Firebase en `config.js` (ver CONECTAR-NUBE.md). Si lo subís vacío, igual funciona pero en modo local.

## Paso 2 — Conectar Vercel
1. Entrá a **https://vercel.com** y registrate **con tu cuenta de GitHub**.
2. **Add New… → Project** → elegí el repositorio `sabor-tico-app` → **Import**.
3. En la configuración:
   - **Framework Preset:** Other (o "No Framework").
   - **Build Command:** vacío.
   - **Output Directory:** `.` (un punto) o dejalo por defecto.
4. **Deploy**. En ~1 minuto te da el link: `https://sabor-tico-app.vercel.app`.

Ese link lo compartís con el equipo. En el celular pueden "Agregar a pantalla de inicio".

## Para meterle arreglos después
- En GitHub: **Add file → Upload files** y reemplazás los archivos cambiados (o editás un archivo y "Commit").
- Vercel detecta el cambio y **redespliega solo** en segundos. No tenés que tocar nada más.

## Notas
- El `vercel.json` ya viene listo para que Vercel sirva los archivos sin intentar compilar nada.
- `config.js` queda dentro del repo; si el repo es público, tus claves de Firebase quedan visibles. Para Firebase no es crítico (las claves del cliente son públicas por diseño y la seguridad va en las reglas de la base), pero si preferís, usá un repo **privado**.
