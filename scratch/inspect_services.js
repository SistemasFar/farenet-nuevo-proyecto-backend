const db = require('../config/database');

async function inspectAllServices() {
  try {
    const res = await db.query(`
      SELECT s.id, s.codigo, s.nombre, s.tipo_certificado_clave, s.modalidad, c.codigo as cat_codigo
      FROM fg_servicio s
      JOIN fg_categoria_servicio c ON c.id = s.categoria_id
      ORDER BY c.codigo, s.id
    `);
    console.table(res.rows);

    process.exit(0);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
}

inspectAllServices();
