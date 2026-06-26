const pool = require('./config/database');

async function run() {
  const result = await pool.query(`
    SELECT resultado, tipodesaprobado FROM inspeccion LIMIT 5
  `);
  console.log(result.rows);
  process.exit(0);
}
run();
