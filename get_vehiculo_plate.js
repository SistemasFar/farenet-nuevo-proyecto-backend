const { Pool } = require('pg');
const pool = new Pool({ user: 'postgres', host: '192.168.14.19', database: 'inspeccion', password: 'farenet2026**', port: 5432 });
pool.query("SELECT * FROM vehiculo WHERE nromotor='CEE552' OR nroplacaantigua='CEE552'").then(res => { 
  console.log(res.rows); 
  process.exit(0); 
});
