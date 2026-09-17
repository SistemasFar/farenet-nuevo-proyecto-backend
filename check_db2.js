const { Client } = require('pg');
const client = new Client({ host: '192.168.14.19', port: 5432, user: 'postgres', password: 'farenet2026**', database: 'inspeccion' });
client.connect().then(() => {
    return client.query("SELECT id, descripcion, activo, es_para_venta, unidad, tipo_afectacion_igv, codigo_clasificacion_sunat FROM fg_producto_facturacion WHERE descripcion ILIKE '%chip%'");
}).then(res => {
    console.log('Fiscal:', res.rows);
    return client.query("SELECT id, nombre, producto_facturacion_id FROM fg_producto_inventariable WHERE nombre ILIKE '%chip%'");
}).then(res => {
    console.log('Inventariables:', res.rows);
    client.end();
}).catch(e => {
    console.error(e);
    client.end();
});
