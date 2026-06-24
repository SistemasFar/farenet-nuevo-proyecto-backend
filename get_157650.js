const { Pool } = require('pg');
const pool = new Pool({ user: 'postgres', host: '192.168.14.19', database: 'inspeccion', password: 'farenet2026**', port: 5432 });

pool.query("SELECT * FROM vehiculo WHERE nromotor = (SELECT vehiculo_nromotor FROM inspeccion WHERE nrodocumentoinspeccion = 'INS-201-000157650')").then(res => {
  console.log(res.rows);
  process.exit(0);
});
