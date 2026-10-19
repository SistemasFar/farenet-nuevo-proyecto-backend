const db = require('../config/database');

async function check() {
  try {
    // Let's see what plantas exist
    const plantas = await db.query('SELECT key, nombre FROM fg_planta WHERE activo = true');
    console.log('=== PLANTAS ===');
    console.table(plantas.rows);

    // Let's see all services for planta '98' (Surco) or whatever active plantas exist
    for (const p of plantas.rows) {
      const q = await db.query(`
        SELECT
          c.codigo AS categoria_codigo,
          c.nombre AS categoria_nombre,
          s.id AS servicio_id,
          s.codigo AS servicio_codigo,
          s.nombre AS servicio_nombre,
          t.id AS tarifa_id,
          t.codigo AS tarifa_codigo,
          t.producto_facturacion_id,
          pf.codigo_sku,
          pf.descripcion AS producto_descripcion,
          pf.precio_referencia
        FROM fg_tarifa t
        JOIN fg_servicio s ON s.id = t.servicio_id
        JOIN fg_categoria_servicio c ON c.id = s.categoria_id
        LEFT JOIN fg_producto_facturacion pf ON pf.id = t.producto_facturacion_id
        WHERE t.planta_key = $1
          AND t.activo = TRUE
          AND s.activo = TRUE
          AND c.activo = TRUE
          AND s.tipo_flujo IN ('CERTIFICACION', 'TALLER_INSPECCION')
        ORDER BY c.orden, s.orden, s.nombre
      `, [p.key]);
      
      console.log(`\n=== SERVICIOS PLANTA ${p.key} (${p.nombre}) ===`);
      console.table(q.rows);
    }

    process.exit(0);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
}

check();
