# Conectar las Reuniones sin límite (Jitsi as a Service – JaaS)

Las reuniones de los proyectos usan **Jitsi**. El Jitsi público gratis, cuando va
**incrustado** dentro de la app, **corta la llamada a los 5 minutos**. Para quitar ese
límite (y el logo) usamos **JaaS (Jitsi as a Service)**, que es **gratis hasta ~25
usuarios activos por mes**.

Esto se hace **una sola vez**. Tiempo: ~10 minutos.

---

## Paso 1 — Crear la cuenta JaaS
1. Entrá a **https://jaas.8x8.vc** y creá una cuenta (podés usar Google).
2. Seguí el asistente hasta llegar al panel (Dashboard).

## Paso 2 — Copiar el AppID
1. En el panel, buscá tu **AppID** (empieza con `vpaas-magic-cookie-...`).
2. No hace falta pegarlo en ningún lado a mano: se deduce solo de la llave del Paso 3.

## Paso 3 — Crear el par de llaves (API Key)
1. En el panel: **API Keys** → **Add API Key** (o "Generate key pair").
2. JaaS genera un par de llaves:
   - Te muestra un **Key ID** (se ve así: `vpaas-magic-cookie-abc123/d4e5f6`). **Copialo.**
   - Te deja **descargar la clave privada** (un archivo `.pk` o `.pem`). **Descargala y abrila con el Bloc de notas** para copiar todo su contenido (incluyendo las líneas `-----BEGIN PRIVATE KEY-----` y `-----END PRIVATE KEY-----`).

> ⚠️ La **clave privada es secreta**. No la mandes por chat ni la subas al repositorio. Solo va en Vercel (Paso 4).

## Paso 4 — Pegar las llaves en Vercel (variables de entorno)
1. Entrá a **vercel.com** → tu proyecto → **Settings → Environment Variables**.
2. Agregá estas **dos** variables (Environment: *Production* y *Preview*):
   - **`JAAS_KID`** = el **Key ID** del Paso 3 (ej: `vpaas-magic-cookie-abc123/d4e5f6`).
   - **`JAAS_PRIVATE_KEY`** = **todo el contenido** del archivo de clave privada (con las líneas BEGIN/END).
3. Guardá.

## Paso 5 — Volver a desplegar
1. En Vercel → pestaña **Deployments** → en el último, **Redeploy** (o subí cualquier cambio).
2. Listo: al tocar **Reunión** en un proyecto, la videollamada abre **dentro de la app, sin el corte de 5 minutos y sin el logo de Jitsi**.

---

## Notas
- **Gratis hasta ~25 usuarios activos por mes.** Si un mes entran más de ~25 personas
  distintas a reuniones, JaaS pasa a cobrar (podés ver el consumo en su panel).
- La **clave privada** vive solo en Vercel (variable de entorno); el navegador nunca la ve.
  La app pide un “pase” temporal a `api/meet-token`, que es lo único que entra a la reunión.
- Si las variables no están puestas, la app avisa “Las reuniones aún no están configuradas”.
- Seguridad: ver **SEGURIDAD.md**.
