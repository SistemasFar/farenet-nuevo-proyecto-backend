const { Pool } = require('pg');
const pool = new Pool({ user: 'postgres', host: '192.168.14.19', database: 'inspeccion', password: 'farenet2026**', port: 5432 });

async function getSchemas() {
  try {
    const sdb = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'seriedocumentobase'");
    const sdb2 = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'seriedocumento_base'");
    console.log("SERIEDOCUMENTOBASE COLUMNS:", sdb.rows.map(r => r.column_name));
    console.log("SERIEDOCUMENTO_BASE COLUMNS:", sdb2.rows.map(r => r.column_name));
    
    // Sample data
    const sample = await pool.query("SELECT * FROM seriedocumento LIMIT 3");
    console.log("SERIEDOCUMENTO SAMPLE:", sample.rows);
  } finally {
    process.exit(0);
  }
}
getSchemas();
