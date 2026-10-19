const db = require('../config/database');

async function checkAllTarifas() {
  try {
    const q = await db.query(`
      SELECT
        p.key AS planta_key,
        p.nombre AS planta_nombre,
        c.codigo AS categoria_codigo,
        s.id AS servicio_id,
        s.codigo AS servicio_codigo,
        s.nombre AS servicio_nombre,
        t.id AS tarifa_id,
        t.codigo AS tarifa_codigo,
        t.producto_facturacion_id,
        pf.codigo_sku AS producto_sku,
        pf.descripcion AS producto_descripcion,
        pf.precio_referencia,
        pf.precio_unitario
      FROM fg_tarifa t
      JOIN fg_servicio s ON s.id = t.servicio_id
      JOIN fg_categoria_servicio c ON c.id = s.categoria_id
      JOIN fg_planta p ON p.key = t.planta_key
      LEFT JOIN fg_producto_facturacion pf ON pf.id = t.producto_facturacion_id
      WHERE t.activo = TRUE
        AND s.activo = TRUE
        AND c.activo = TRUE
        AND s.tipo_flujo IN ('CERTIFICACION', 'TALLER_INSPECCION')
      ORDER BY p.key, c.orden, s.orden, s.nombre
    `);

    console.log(`Total active service tariffs: ${q.rows.length}`);
    for (const row of q.rows) {
      console.log(
        `Planta: ${row.planta_key.padEnd(5)} | ` +
        `Cat: ${row.categoria_codigo.padEnd(12)} | ` +
        `ServID: ${String(row.servicio_id).padEnd(4)} | ` +
        `s.codigo: ${(row.servicio_codigo || 'NULL').padEnd(20)} | ` +
        `t.codigo: ${(row.tarifa_codigo || 'NULL').padEnd(20)} | ` +
        `pf.sku: ${(row.producto_sku || 'NULL').padEnd(15)} | ` +
        `s.nombre: ${row.servicio_nombre}`
      );
    }

    process.exit(0);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
}

checkAllTarifas();
