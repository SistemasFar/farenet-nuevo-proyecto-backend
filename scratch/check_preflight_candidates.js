const db = require('../config/database');

async function run() {
    const certs = await db.query(`
        SELECT c.id, c.planta_key, c.estado, c.tarifa_codigo, t.precio, s.nombre as servicio_nombre,
               f.id as facturacion_id, f.tipo_comprobante, f.importe_total, f.estado as facturacion_estado,
               f.sujeto_detraccion, f.serie, f.numero
        FROM fg_certificado c
        JOIN fg_tarifa t ON t.planta_key = c.planta_key AND t.codigo = c.tarifa_codigo
        JOIN fg_servicio s ON s.id = t.servicio_id
        LEFT JOIN fg_facturacion f ON f.certificado_id = c.id
        ORDER BY c.id DESC LIMIT 10
    `);
    console.log('Certificados recientes:');
    certs.rows.forEach(r => console.log(JSON.stringify(r)));

    // Let's also check fg_facturacion directly
    const facts = await db.query(`
        SELECT f.id, f.certificado_id, f.operacion_id, f.tipo_comprobante, f.importe_total, f.estado, f.serie, f.numero, f.sujeto_detraccion
        FROM fg_facturacion f
        ORDER BY f.id DESC LIMIT 10
    `);
    console.log('\nFacturaciones recientes:');
    facts.rows.forEach(r => console.log(JSON.stringify(r)));

    db.end();
}
run().catch(e => { console.error(e); db.end(); });

