/* =====================================================================
   FUNCIÓN SERVERLESS (Vercel) — Leer factura con IA de visión (OpenAI)
   La llave de API vive solo aquí (variable de entorno OPENAI_API_KEY),
   nunca en el navegador. El frontend manda la foto, esto devuelve los
   productos en datos estructurados para revisarlos y sumarlos al inventario.
   Ver CONECTAR-FACTURAS.md para configurar la llave en Vercel.
   ===================================================================== */

// Modelo de visión. Para bajar el costo por factura podés cambiarlo a
// "gpt-4o-mini" (mucho más barato y suficiente para la mayoría de facturas).
const MODELO = 'gpt-4o';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Método no permitido' });
    return;
  }
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    res.status(500).json({ error: 'Falta configurar OPENAI_API_KEY en Vercel (ver CONECTAR-FACTURAS.md)' });
    return;
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const image = body.image;
    const media_type = body.media_type || 'image/jpeg';
    if (!image) {
      res.status(400).json({ error: 'No se recibió la imagen de la factura' });
      return;
    }

    // Salida estructurada (Structured Outputs). En modo strict todas las
    // propiedades deben ir en "required"; las opcionales se permiten nulas.
    const schema = {
      type: 'object',
      additionalProperties: false,
      properties: {
        proveedor: { type: ['string', 'null'], description: 'Nombre del proveedor o empresa que emite la factura' },
        numero: { type: ['string', 'null'], description: 'Número o consecutivo de la factura' },
        fecha: { type: ['string', 'null'], description: 'Fecha de la factura en formato YYYY-MM-DD si aparece' },
        items: {
          type: 'array',
          description: 'Cada línea de producto de la factura',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              nombre: { type: 'string', description: 'Nombre del producto' },
              cantidad: { type: 'number', description: 'Cantidad comprada' },
              unidad: { type: 'string', description: 'Una de: kg, lt, unid, paq, caja, docena, botella' },
              costo_unitario: { type: 'number', description: 'Costo por unidad en colones (sin impuestos si es posible)' }
            },
            required: ['nombre', 'cantidad', 'unidad', 'costo_unitario']
          }
        }
      },
      required: ['proveedor', 'numero', 'fecha', 'items']
    };

    const prompt = 'Esta es la foto de una factura de compra de un restaurante en Costa Rica. ' +
      'Extraé cada línea de producto con su nombre, cantidad, unidad y costo UNITARIO en colones. ' +
      'Si la factura muestra el total de la línea en lugar del costo unitario, dividí ese total entre la cantidad para obtener el unitario. ' +
      'Usá solo estas unidades (elegí la más parecida): kg, lt, unid, paq, caja, docena, botella. ' +
      'Ignorá impuestos, descuentos y el total general de la factura; solo necesito la lista de productos.';

    const apiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'authorization': 'Bearer ' + key
      },
      body: JSON.stringify({
        model: MODELO,
        max_tokens: 4096,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: 'data:' + media_type + ';base64,' + image } }
          ]
        }],
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'factura', strict: true, schema: schema }
        }
      })
    });

    if (!apiRes.ok) {
      const t = await apiRes.text();
      res.status(502).json({ error: 'La IA respondió con error: ' + t.slice(0, 300) });
      return;
    }

    const data = await apiRes.json();
    const msg = data.choices && data.choices[0] && data.choices[0].message;
    if (msg && msg.refusal) {
      res.status(502).json({ error: 'La IA no pudo procesar la imagen: ' + msg.refusal });
      return;
    }
    const content = msg && msg.content;
    if (!content) {
      res.status(502).json({ error: 'La IA no pudo extraer los datos de la factura' });
      return;
    }
    let out;
    try { out = JSON.parse(content); } catch (_) {
      res.status(502).json({ error: 'La IA devolvió datos en un formato inesperado' });
      return;
    }
    res.status(200).json(out);
  } catch (e) {
    res.status(500).json({ error: String((e && e.message) || e) });
  }
}
