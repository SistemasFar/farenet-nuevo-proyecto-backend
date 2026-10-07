const { Client } = require('pg');
const client = new Client({ connectionString: 'postgres://postgres:farenet2026**@192.168.14.19:5432/inspeccion' });

async function run() {
  await client.connect();
  const res = await client.query(`
    SELECT id, codigo_sku, descripcion 
    FROM fg_producto_facturacion 
    WHERE descripcion ILIKE '%HOJAS%' OR descripcion ILIKE '%GLP%' OR descripcion ILIKE '%CONFORMIDAD%'
  `);
  console.log(res.rows.filter(r => r.descripcion.includes('HOJAS')));
  await client.end();
}
run();
