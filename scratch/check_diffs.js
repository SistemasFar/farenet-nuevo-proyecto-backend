const db = require('../config/database');

async function checkCodes() {
  try {
    const q = await db.query(`
      SELECT
        p.key AS planta_key,
        p.nombre AS planta_nombre,
        c.codigo AS cat_codigo,
        s.id AS serv_id,
        s.codigo AS s_codigo,
        s.nombre AS s_nombre,
        t.id AS tarifa_id,
        t.codigo AS t_codigo,
        t.producto_facturacion_id,
        pf.codigo_sku,
        pf.descripcion AS pf_desc
      FROM fg_tarifa t
      JOIN fg_servicio s ON s.id = t.servicio_id
      JOIN fg_categoria_servicio c ON c.id = s.categoria_id
      JOIN fg_planta p ON p.key = t.planta_key
      LEFT JOIN fg_producto_facturacion pf ON pf.id = t.producto_facturacion_id
      WHERE t.activo = TRUE
        AND s.activo = TRUE
        AND c.activo = TRUE
        AND s.tipo_flujo IN ('CERTIFICACION', 'TALLER_INSPECCION')
      ORDER BY p.key, c.codigo, s.nombre
    `);

    console.log('--- CASES WHERE s_codigo != pf.codigo_sku ---');
    const diffs = q.rows.filter(r => r.s_codigo !== r.codigo_sku);
    console.table(diffs.map(d => ({
      planta: `${d.planta_key} (${d.planta_nombre})`,
      serv_id: d.serv_id,
      servicio: d.s_nombre,
      s_codigo: d.s_codigo,
      t_codigo: d.t_codigo,
      pf_sku: d.codigo_sku,
      pf_desc: d.pf_desc
    })));

    console.log('\n--- CASES WHERE pf.codigo_sku IS NULL ---');
    const nullSkus = q.rows.filter(r => !r.codigo_sku);
    console.table(nullSkus.map(d => ({
      planta: `${d.planta_key} (${d.planta_nombre})`,
      serv_id: d.serv_id,
      servicio: d.s_nombre,
      s_codigo: d.s_codigo,
      t_codigo: d.t_codigo,
      pf_id: d.producto_facturacion_id
    })));

    process.exit(0);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
}

checkCodes();
