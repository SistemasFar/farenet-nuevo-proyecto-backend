const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT,
});

async function main() {
  const client = await pool.connect();
  try {
    // Productos fiscales que SI cumplen los requisitos del backend (NIU/ZZ + IGV10)
    const validos = await client.query(`
      SELECT id, codigo_sku, descripcion, unidad, tipo_afectacion_igv, activo, es_para_venta
      FROM fg_producto_facturacion
      WHERE activo = TRUE
        AND es_para_venta = TRUE
        AND COALESCE(BTRIM(codigo_sku), '') <> ''
        AND COALESCE(BTRIM(descripcion), '') <> ''
        AND UPPER(BTRIM(unidad)) IN ('NIU', 'ZZ')
        AND BTRIM(tipo_afectacion_igv) = '10'
        AND (COALESCE(BTRIM(codigo_clasificacion_sunat), '') = '' OR BTRIM(codigo_clasificacion_sunat) ~ '^\\d{8}$')
      ORDER BY codigo_sku
      LIMIT 20
    `);
    
    console.log('\n=== PRODUCTOS FISCALES VÁLIDOS PARA CHIPS ===');
    console.log(`Total: ${validos.rowCount}`);
    validos.rows.forEach(r => {
      console.log(`  ID=${r.id} | ${r.codigo_sku} | ${r.descripcion} | unidad=${r.unidad} | igv=${r.tipo_afectacion_igv}`);
    });

    // Productos que existen pero NO cumplen (para entender qué falla)
    const invalidos = await client.query(`
      SELECT id, codigo_sku, descripcion, unidad, tipo_afectacion_igv, activo, es_para_venta
      FROM fg_producto_facturacion
      WHERE activo = TRUE
        AND es_para_venta = TRUE
        AND NOT (
          COALESCE(BTRIM(codigo_sku), '') <> ''
          AND COALESCE(BTRIM(descripcion), '') <> ''
          AND UPPER(BTRIM(unidad)) IN ('NIU', 'ZZ')
          AND BTRIM(tipo_afectacion_igv) = '10'
        )
      ORDER BY codigo_sku
      LIMIT 10
    `);
    
    console.log('\n=== PRODUCTOS QUE NO CUMPLEN (activos, para venta) ===');
    console.log(`Total: ${invalidos.rowCount}`);
    invalidos.rows.forEach(r => {
      console.log(`  ID=${r.id} | ${r.codigo_sku} | ${r.descripcion} | unidad="${r.unidad}" | igv="${r.tipo_afectacion_igv}"`);
    });

    // Ver que tiene el chip vinculado
    const chip = await client.query(`
      SELECT pi.id, pi.codigo, pi.nombre, pi.producto_facturacion_id,
             pf.codigo_sku, pf.descripcion, pf.unidad, pf.tipo_afectacion_igv, pf.activo, pf.es_para_venta
      FROM fg_producto_inventariable pi
      LEFT JOIN fg_producto_facturacion pf ON pf.id = pi.producto_facturacion_id
      WHERE pi.activo = TRUE
      ORDER BY pi.codigo
    `);
    console.log('\n=== CHIPS Y SU PRODUCTO FISCAL VINCULADO ===');
    chip.rows.forEach(r => {
      console.log(`  Chip: ${r.codigo} | fiscal_id=${r.producto_facturacion_id} | ${r.codigo_sku || 'NINGUNO'} | unidad="${r.unidad || ''}" | igv="${r.tipo_afectacion_igv || ''}"`);
    });

  } finally {
    client.release();
    pool.end();
  }
}

main().catch(console.error);
