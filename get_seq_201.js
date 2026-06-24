const { Pool } = require('pg');
const pool = new Pool({ user: 'postgres', host: '192.168.14.19', database: 'inspeccion', password: 'farenet2026**', port: 5432 });

pool.query("SELECT * FROM seriedocumentobase WHERE planta_key='201'").then(res => {
  console.log(res.rows);
  process.exit(0);
});
