const db = require('../config/database');

async function run() {
    const fact844 = await db.query(`
        SELECT f.*
        FROM fg_facturacion f
        WHERE f.certificado_id IN (844, 846)
    `);
    console.log('Facturaciones 844 y 846:');
    fact844.rows.forEach(r => console.log(JSON.stringify(r)));

    db.end();
}
run().catch(e => { console.error(e); db.end(); });
