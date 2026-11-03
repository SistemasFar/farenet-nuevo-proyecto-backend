const { Pool } = require('pg');
const pool = new Pool({ user: 'postgres', host: '192.168.14.19', password: 'farenet2026**', database: 'inspeccion', port: 5432 });

pool.query("SELECT * FROM fg_tarifa WHERE planta_key = '98' AND codigo = '0422'", (err, res) => {
  if (err) console.error(err);
  else console.log(JSON.stringify(res.rows, null, 2));
  pool.end();
});