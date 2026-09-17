const { Client } = require('pg');
require('dotenv').config();
const client = new Client({ connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/farenet' });
client.connect().then(() => {
    return client.query("SELECT id, descripcion, activo, es_para_venta, unidad, tipo_afectacion_igv, codigo_clasificacion_sunat FROM fg_producto_facturacion WHERE descripcion ILIKE '%chip%'");
}).then(res => {
    console.log(res.rows);
    return client.query("SELECT id, nombre, producto_facturacion_id FROM fg_producto_inventariable WHERE nombre ILIKE '%chip%'");
}).then(res => {
    console.log('Productos inventariables:');
    console.log(res.rows);
    client.end();
}).catch(e => {
    console.error(e);
    client.end();
});
