const db = require('../config/database');

async function test() {
  try {
    // Check all services
    const resServicios = await db.query(`
      SELECT s.id, s.codigo, s.nombre, s.tipo_flujo, s.tipo_certificado_clave, s.modalidad
      FROM fg_servicio s
      ORDER BY s.id
    `);
    console.log('=== ALL FG_SERVICIO ===');
    console.table(resServicios.rows);

    // Check tariffs where s.codigo does NOT look like a 4-digit code or where pf.codigo_sku exists
    const resTarifasDiff = await db.query(`
      SELECT t.id as tarifa_id, t.planta_key, t.codigo as tarifa_codigo,
             s.id as servicio_id, s.codigo as servicio_codigo, s.nombre as servicio_nombre,
             t.producto_facturacion_id, pf.codigo_sku as producto_sku, pf.descripcion as producto_desc
      FROM fg_tarifa t
      JOIN fg_servicio s ON s.id = t.servicio_id
      LEFT JOIN fg_producto_facturacion pf ON pf.id = t.producto_facturacion_id
      WHERE t.activo = TRUE
      ORDER BY t.planta_key, s.id
    `);
    console.log('=== ALL ACTIVE TARIFFS WITH SERVICE & PRODUCT ===');
    console.table(resTarifasDiff.rows);

    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

test();
