const db = require('../config/database');

async function run() {
    const cert840 = await db.query(`
        SELECT c.*, cv.placa, cv.marca, cv.modelo,
               f.id as fact_id, f.estado as fact_estado, f.importe_total as fact_total,
               o.id as orden_id, o.importe_total as orden_total, o.estado as orden_estado
        FROM fg_certificado c
        LEFT JOIN fg_certificado_vehiculo cv ON cv.certificado_id = c.id
        LEFT JOIN fg_facturacion f ON f.certificado_id = c.id
        LEFT JOIN fg_orden_pago o ON o.certificado_id = c.id
        WHERE c.id IN (840, 845)
    `);
    console.log('Certificados 840 y 845:');
    cert840.rows.forEach(r => console.log(JSON.stringify(r)));

    db.end();
}
run().catch(e => { console.error(e); db.end(); });

