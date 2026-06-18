const { Pool } = require('pg');
const pool = new Pool({user: 'postgres', host: '192.168.14.19', database: 'inspeccion', password: 'farenet2026**', port: 5432});

async function run() {
  try {
    const res = await pool.query(`SELECT DISTINCT categoriaextra FROM vehiculo WHERE categoriaextra IS NOT NULL`);
    console.log("Valores en categoriaextra:", res.rows.map(r => r.categoriaextra).join(', '));
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}
run();
