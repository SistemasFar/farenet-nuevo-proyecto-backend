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
    const resT = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_name ILIKE '%poliza%' OR table_name ILIKE '%aseguradora%' OR table_name ILIKE '%soat%'");
    console.log('--- TABLAS SIMILARES ---');
    console.table(resT.rows);

    const resV = await pool.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'vehiculo' AND (column_name ILIKE '%soat%' OR column_name ILIKE '%fech%')");
    console.log('--- COLUMNAS vehiculo ---');
    console.table(resV.rows);

    const resI = await pool.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'inspeccion' AND column_name ILIKE '%fech%'");
    console.log('--- COLUMNAS inspeccion ---');
    console.table(resI.rows);
  } catch (e) {
    console.error(e);
  } finally {
    pool.end();
  }
}
run();
