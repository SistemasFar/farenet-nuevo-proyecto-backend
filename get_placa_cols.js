const { Pool } = require('pg');
const pool = new Pool({ user: 'postgres', host: '192.168.14.19', database: 'inspeccion', password: 'farenet2026**', port: 5432 });
pool.query("SELECT table_name, column_name FROM information_schema.columns WHERE column_name LIKE '%placa%'").then(res => { 
  console.log(res.rows); 
  process.exit(0); 
});
