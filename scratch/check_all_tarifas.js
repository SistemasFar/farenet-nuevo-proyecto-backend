const db = require('../config/database');

async function run() {
    const tarifas = await db.query(`
        SELECT t.id, t.codigo, t.planta_key, t.precio, t.producto_facturacion_id,
               s.nombre as servicio_nombre, s.sujeto_detraccion, s.detraccion_codigo, s.detraccion_porcentaje
        FROM fg_tarifa t
        JOIN fg_servicio s ON s.id = t.servicio_id
        WHERE t.planta_key = '98'
        ORDER BY t.precio DESC
    `);
    console.log('Todas las tarifas de planta 98:');
    tarifas.rows.forEach(r => console.log(JSON.stringify(r)));
    db.end();
}
run().catch(e => { console.error(e); db.end(); });

