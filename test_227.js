require('dotenv').config();
const db = require('./config/database');

async function test() {
  const c = await db.connect();
  try {
    const res = await c.query(`
                SELECT id
                FROM fg_producto_facturacion
                WHERE id = ANY($1::bigint[])
                  AND activo = TRUE
                  AND es_para_venta = TRUE
                  AND COALESCE(BTRIM(codigo_sku), '') <> ''
                  AND COALESCE(BTRIM(descripcion), '') <> ''
                  AND UPPER(BTRIM(unidad)) IN ('NIU', 'ZZ')
                  AND BTRIM(tipo_afectacion_igv) = '10'
                  AND (COALESCE(BTRIM(codigo_clasificacion_sunat), '') = '' OR BTRIM(codigo_clasificacion_sunat) ~ '^\\d{8}$')
    `, [[227]]);
    console.log(res.rows);
  } finally {
    c.release();
    process.exit(0);
  }
}
test();
