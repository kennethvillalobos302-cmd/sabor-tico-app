# Activar "Subir foto de la factura" (lectura con IA)

Esto permite que en **Inventario → Registrar factura** subás una **foto o un PDF de la factura** y la app lea sola los productos (proveedor, cantidades, costos) para revisarlos y sumarlos al inventario.

Necesita una **llave de API de OpenAI** (la IA que lee la imagen). Es de pago por uso: cada factura escaneada cuesta **centavos** (unos ₡5–₡20 según el tamaño de la foto). La llave queda **guardada en secreto en Vercel**, nunca en la app, así que nadie la puede robar.

Tiempo: ~5 minutos, una sola vez.

## Paso 1 — Crear la llave de API
1. Entrá a **https://platform.openai.com** y creá una cuenta (o iniciá sesión).
2. En **Settings → Billing**, agregá un método de pago y un poco de saldo (con $5 alcanza para cientos de facturas).
3. Andá a **API keys → Create new secret key**, ponele un nombre (ej: `sabor-tico`) y **copiá la llave** (empieza con `sk-...`). Guardala, solo se muestra una vez.

## Paso 2 — Pegar la llave en Vercel
1. Entrá a **https://vercel.com** y abrí tu proyecto de Sabor Tico.
2. **Settings → Environment Variables**.
3. Agregá una variable:
   - **Name (nombre):** `OPENAI_API_KEY`
   - **Value (valor):** la llave que copiaste (`sk-...`)
   - Dejá marcados todos los entornos (Production, Preview, Development).
4. **Save**.

## Paso 3 — Volver a publicar
1. En Vercel, **Deployments → … (los tres puntos) del último → Redeploy** (o subí cualquier cambio).
2. Esto hace que la función que lee facturas quede activa.

## Listo
Abrí la app en **Inventario → Registrar factura → Subir foto de la factura**, tomá o elegí la foto, y en unos segundos verás los productos llenos para revisar. Corregí lo que haga falta y tocá **Guardar y sumar al inventario**.

## Paso 4 — Poné un tope de gasto (recomendado)
En **https://platform.openai.com → Settings → Limits**, configurá un **límite de gasto mensual** (por ej. $10). Es el freno seguro: aunque alguien intentara abusar de la lectura de facturas, nunca te puede generar un cobro mayor a ese tope. La función ya tiene además un límite de tamaño de archivo y un control de cantidad de solicitudes.

## Notas
- **La foto se procesa solo para leerla**; no se guarda en ningún lado aparte de tu factura registrada.
- Si querés **bajar el costo** por factura, en el archivo `api/leer-factura.js` podés cambiar el modelo a `gpt-4o-mini` (mucho más barato) — es suficiente para leer la mayoría de facturas.
- Si subís la foto y dice *"la función aún no está publicada"*, es que falta el Paso 3 (redeploy) o la variable del Paso 2.
- En modo **local** (abriendo el archivo sin Vercel) el escaneo no funciona; sí funciona ya publicado en Vercel.
