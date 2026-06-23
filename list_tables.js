const { Pool } = require('pg');
const pool = new Pool({ user: 'postgres', host: '192.168.14.19', database: 'inspeccion', password: 'farenet2026**', port: 5432 });
pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public'").then(res => { 
  console.log(res.rows.map(r => r.table_name).join(', ')); 
  process.exit(0); 
});
