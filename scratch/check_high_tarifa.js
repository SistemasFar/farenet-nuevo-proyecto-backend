const db = require('../config/database');

async function run() {
    const res = await db.query(`
        SELECT t.id, t.codigo, t.planta_key, t.precio, s.nombre
        FROM fg_tarifa t
        JOIN fg_servicio s ON s.id = t.servicio_id
        WHERE t.precio >= 500
    `);
    console.log('Tarifas >= 500:', res.rows);

    const cert1000 = await db.query(`
        SELECT f.id, f.certificado_id, f.tipo_comprobante, f.importe_total
        FROM fg_facturacion f
        WHERE f.importe_total >= 500
    `);
    console.log('Facturaciones >= 500:', cert1000.rows);

    db.end();
}
run().catch(e => { console.error(e); db.end(); });

