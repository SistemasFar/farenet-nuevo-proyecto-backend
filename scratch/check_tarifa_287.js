const db = require('../config/database');

async function checkTarifa287() {
  try {
    const t = await db.query(`
      SELECT t.*, s.nombre as s_nombre, s.tipo_flujo, s.activo as s_activo, c.activo as c_activo, pf.activo as pf_activo, pf.es_para_venta
      FROM fg_tarifa t
      JOIN fg_servicio s ON s.id = t.servicio_id
      JOIN fg_categoria_servicio c ON c.id = s.categoria_id
      LEFT JOIN fg_producto_facturacion pf ON pf.id = t.producto_facturacion_id
      WHERE t.id = 287
    `);
    console.log(t.rows);

    process.exit(0);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
}

checkTarifa287();
