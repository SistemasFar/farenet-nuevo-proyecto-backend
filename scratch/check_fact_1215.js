const db = require('../config/database');

async function run() {
    const f1215 = await db.query(`
        SELECT f.*, c.tarifa_codigo
        FROM fg_facturacion f
        LEFT JOIN fg_certificado c ON c.id = f.certificado_id
        WHERE f.id = 1215
    `);
    console.log('Factura 1215:', f1215.rows[0]);

    // Veamos también las operaciones 1166, 1167, 1161
    const ops = await db.query(`
        SELECT f.*
        FROM fg_facturacion f
        WHERE f.id IN (1166, 1167, 1161)
    `);
    console.log('\nOperaciones 1166, 1167, 1161:');
    ops.rows.forEach(r => console.log(JSON.stringify(r)));

    db.end();
}
run().catch(e => { console.error(e); db.end(); });

