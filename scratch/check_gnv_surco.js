const db = require('../config/database');

async function checkGnvTarifasAndProducts() {
  try {
    const q1 = await db.query(`
      SELECT t.id, t.planta_key, t.codigo, t.nombre, t.precio, t.producto_facturacion_id, t.activo,
             pf.codigo_sku, pf.descripcion, pf.precio_referencia, pf.precio_unitario
      FROM fg_tarifa t
      LEFT JOIN fg_producto_facturacion pf ON pf.id = t.producto_facturacion_id
      WHERE t.planta_key = '98'
      ORDER BY t.id
    `);
    console.log('=== ALL TARIFAS PLANTA 98 ===');
    console.table(q1.rows);

    const q2 = await db.query(`
      SELECT pf.id, pf.codigo_sku, pf.descripcion, pf.precio_referencia, pf.precio_unitario, pf.activo, pf.es_para_venta
      FROM fg_producto_facturacion pf
      WHERE pf.codigo_sku LIKE '04%' OR pf.descripcion ILIKE '%SURCO%' OR pf.descripcion ILIKE '%GNV%'
      ORDER BY pf.codigo_sku
    `);
    console.log('=== PRODUCTS MATCHING 04% OR SURCO OR GNV ===');
    console.table(q2.rows);

    process.exit(0);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
}

checkGnvTarifasAndProducts();
