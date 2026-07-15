const { Pool } = require('pg');

const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'inspeccion',
  password: 'farenet2026**',
  port: 5432,
});

async function run() {
  try {
    const res = await pool.query('SELECT column_name, data_type FROM information_schema.columns WHERE table_name = \'usuario\' OR table_name = \'persona\'');
    console.log(res.rows);
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}

run();
