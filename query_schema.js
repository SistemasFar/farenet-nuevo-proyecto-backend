const { Client } = require('pg');

const client = new Client({
  user: 'postgres',
  host: '192.168.14.19',
  database: 'inspeccion',
  password: 'farenet2026**',
  port: 5432,
});

client.connect();

client.query(`
  SELECT column_name, data_type, is_nullable 
  FROM information_schema.columns 
  WHERE table_name = 'comprobante' 
  ORDER BY ordinal_position
`, (err, res) => {
  if (err) {
    console.error(err);
  } else {
    console.log(JSON.stringify(res.rows, null, 2));
  }
  client.end();
});
