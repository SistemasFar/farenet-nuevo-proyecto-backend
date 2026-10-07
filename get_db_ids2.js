const { Client } = require('pg');
const client = new Client({ connectionString: 'postgres://postgres:farenet2026**@192.168.14.19:5432/inspeccion' });

async function run() {
  await client.connect();
  const res = await client.query(`
    SELECT id, codigo_sku, descripcion 
    FROM fg_producto_facturacion 
    WHERE codigo_sku IN ('130', '132')
  `);
  console.log(res.rows);
  await client.end();
}
run();
