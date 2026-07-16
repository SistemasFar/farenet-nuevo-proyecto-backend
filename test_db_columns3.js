const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT,
});

async function run() {
  try {
    const res = await pool.query('SELECT inspeccion_nrodocumentoinspeccion FROM resultado_maquina LIMIT 5');
    console.log(res.rows);
  } catch (error) {
    console.error(error);
  } finally {
    pool.end();
  }
}

run();
