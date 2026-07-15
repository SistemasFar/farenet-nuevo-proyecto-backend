const { Pool } = require('pg');
const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'farenet',
  password: 'admin',
  port: 5432,
});
async function query() {
  try {
    const res = await pool.query("SELECT * FROM inspeccion WHERE nrodocumentoinspeccion = 'INS-201-000160569'");
    console.log(JSON.stringify(res.rows[0], null, 2));
    
    // Check tables related to results
    const tablesRes = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'");
    const tables = tablesRes.rows.map(r => r.table_name).filter(t => t.includes('prueba') || t.includes('resultado') || t.includes('foto') || t.includes('linea') || t.includes('defecto') || t.includes('freno') || t.includes('gas') || t.includes('luce'));
    console.log('Tables:', tables);
  } catch (err) {
    console.error(err);
  } finally {
    pool.end();
  }
}
query();
