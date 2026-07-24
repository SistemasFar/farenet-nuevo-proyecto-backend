const { Client } = require('pg');
const client = new Client({
  user: 'postgres',
  host: '192.168.14.19',
  database: 'inspeccion',
  password: 'farenet2026**',
  port: 5432
});

client.connect().then(async () => {
  try {
    const res = await client.query(`
      SELECT co.linea_key
      FROM comprobante co
      WHERE co.inspeccion_nrodocumentoinspeccion = 'INS-201-000158445';
    `);
    console.log(JSON.stringify(res.rows, null, 2));
  } catch (err) {
    console.error(err);
  } finally {
    client.end();
  }
});
