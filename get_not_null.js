const { Pool } = require('pg');
const pool = new Pool({ user: 'postgres', host: '192.168.14.19', database: 'inspeccion', password: 'farenet2026**', port: 5432 });
pool.query("SELECT column_name, column_default FROM information_schema.columns WHERE table_name = 'vehiculo' AND is_nullable = 'NO'").then(res => { 
  console.log(res.rows); 
  process.exit(0); 
});
