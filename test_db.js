const { Pool } = require('pg');
const pool = new Pool({
  user: 'postgres',
  host: '192.168.14.19',
  database: 'inspeccion',
  password: 'farenet2026**',
  port: 5432
});

async function run() {
  try {
    const res = await pool.query("SELECT * FROM tipocertificado LIMIT 5");
    console.log(res.rows);
  } finally {
    pool.end();
  }
}
run();
