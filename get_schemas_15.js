const { Pool } = require('pg');
const pool = new Pool({ user: 'postgres', host: '192.168.14.19', database: 'inspeccion', password: 'farenet2026**', port: 5432 });

async function getSchemas() {
  try {
    const pagoCols = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'pago'");
    const serieCols = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'seriedocumento'");
    const conceptoCols = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'conceptoinspeccion'");
    
    console.log("PAGO COLUMNS:", pagoCols.rows.map(r => r.column_name));
    console.log("SERIEDOCUMENTO COLUMNS:", serieCols.rows.map(r => r.column_name));
    console.log("CONCEPTOINSPECCION COLUMNS:", conceptoCols.rows.map(r => r.column_name));
  } finally {
    process.exit(0);
  }
}
getSchemas();
