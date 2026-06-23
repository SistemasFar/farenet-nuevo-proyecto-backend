const { Pool } = require('pg');
const pool = new Pool({ user: 'postgres', host: '192.168.14.19', database: 'inspeccion', password: 'farenet2026**', port: 5432 });
pool.query("SELECT conname, pg_get_constraintdef(c.oid) FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace WHERE contype IN ('f') AND conrelid::regclass::text IN ('inspeccion', 'comprobante', 'vehiculo');").then(res => { 
  console.log(JSON.stringify(res.rows, null, 2)); 
  process.exit(0); 
});
