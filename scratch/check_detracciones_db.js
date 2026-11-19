const db = require('../config/database');

async function run() {
    const res = await db.query(`
        SELECT id, tipo_comprobante, serie, numero, importe_total, sujeto_detraccion, detraccion_codigo, detraccion_monto, estado
        FROM fg_facturacion
        WHERE sujeto_detraccion = true
        ORDER BY id DESC LIMIT 10
    `);
    console.log('Facturas con sujeto_detraccion = true:', res.rows);
    
    const countRes = await db.query(`
        SELECT count(*) as total,
               count(*) filter (where sujeto_detraccion = true) as con_detraccion,
               count(*) filter (where sujeto_detraccion = false) as sin_detraccion,
               count(*) filter (where sujeto_detraccion is null) as nulos
        FROM fg_facturacion
    `);
    console.log('Resumen fg_facturacion:', countRes.rows);
    
    db.end();
}
run().catch(e => { console.error(e); db.end(); });

