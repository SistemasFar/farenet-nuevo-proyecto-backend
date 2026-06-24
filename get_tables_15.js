const { Pool } = require('pg');
const pool = new Pool({ user: 'postgres', host: '192.168.14.19', database: 'inspeccion', password: 'farenet2026**', port: 5432 });
pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND (table_name LIKE '%tarifa%' OR table_name LIKE '%precio%' OR table_name LIKE '%pago%' OR table_name LIKE '%correlativo%' OR table_name LIKE '%serie%')").then(res => { 
  console.log(res.rows); 
  process.exit(0); 
});
