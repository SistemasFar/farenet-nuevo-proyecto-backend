const db = require('../config/database');

async function analyzeAllActiveTarifas() {
  try {
    const q = await db.query(`
      SELECT
        p.key AS planta_key,
        p.nombre AS planta_nombre,
        c.codigo AS cat_codigo,
        s.id AS serv_id,
        s.codigo AS serv_codigo,
        s.nombre AS serv_nombre,
        t.id AS tarifa_id,
        t.codigo AS tarifa_codigo,
        t.producto_facturacion_id,
        pf.codigo_sku,
        pf.descripcion AS pf_desc,
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
      ORDER BY p.key, c.codigo, s.nombre
    `);

    console.log(`Found ${q.rows.length} active service tariffs in fg_tarifa`);
    
    // Group by serv_codigo / pf.codigo_sku patterns
    const summary = [];
    for (const r of q.rows) {
      summary.push({
        sede: `${r.planta_key} (${r.planta_nombre})`,
        cat: r.cat_codigo,
        servicio: r.serv_nombre,
        s_codigo: r.serv_codigo,
        t_codigo: r.tarifa_codigo,
        pf_id: r.producto_facturacion_id,
        pf_sku: r.codigo_sku
      });
    }
    console.table(summary);

    process.exit(0);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
}

analyzeAllActiveTarifas();
