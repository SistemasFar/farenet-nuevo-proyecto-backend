const db = require('../config/database');

async function run() {
    const cols = await db.query(`
        SELECT column_name, data_type
        FROM information_schema.columns
        WHERE table_name = 'fg_certificado'
        ORDER BY ordinal_position
    `);
    console.log('Columnas fg_certificado:', cols.rows.map(c => c.column_name).join(', '));

    const certs = await db.query(`
        SELECT c.id, c.planta_key, c.tarifa_codigo, c.estado,
               cv.placa, cv.marca, cv.modelo,
               f.id as facturacion_id, f.tipo_comprobante, f.importe_total, f.estado as fact_estado,
               o.id as orden_id, o.importe_total as orden_total, o.estado as orden_estado, o.saldo_pendiente
        FROM fg_certificado c
        LEFT JOIN fg_certificado_vehiculo cv ON cv.certificado_id = c.id
        LEFT JOIN fg_facturacion f ON f.certificado_id = c.id
        LEFT JOIN fg_orden_pago o ON o.certificado_id = c.id
        ORDER BY c.id DESC LIMIT 10
    `);
    console.log('\nÚltimos 10 certificados:');
    certs.rows.forEach(r => console.log(JSON.stringify(r)));

    db.end();
}
run().catch(e => { console.error(e); db.end(); });
