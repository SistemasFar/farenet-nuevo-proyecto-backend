const db = require('../config/database');

async function checkProduct() {
  try {
    const p = await db.query('SELECT * FROM fg_producto_facturacion WHERE id = 2233');
    console.log('Product 2233:', p.rows);

    const allGnvAnual = await db.query(`
      SELECT t.id, t.planta_key, t.codigo, t.servicio_id, s.codigo as s_codigo, s.nombre as s_nombre,
             t.producto_facturacion_id, pf.codigo_sku, pf.descripcion, pf.precio_referencia, pf.precio_unitario, pf.activo, pf.es_para_venta
      FROM fg_tarifa t
      JOIN fg_servicio s ON s.id = t.servicio_id
      LEFT JOIN fg_producto_facturacion pf ON pf.id = t.producto_facturacion_id
      WHERE s.codigo = 'GNV_ANUAL' OR s.nombre ILIKE '%anual%gnv%' OR pf.descripcion ILIKE '%anual%gnv%'
    `);
    console.table(allGnvAnual.rows);

    process.exit(0);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
}

checkProduct();
