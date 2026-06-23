const { Pool } = require('pg');
const pool = new Pool({ user: 'postgres', host: '192.168.14.19', database: 'inspeccion', password: 'farenet2026**', port: 5432 });
pool.query("SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='inspeccion'").then(res => { 
  console.log(JSON.stringify(res.rows, null, 2)); 
  process.exit(0); 
});
