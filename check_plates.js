const pool = require('./config/database');
pool.query("SELECT nromotor, nroplacaantigua, categoria_key FROM vehiculo WHERE nroplacaantigua IN ('VIEJ11', '333666') OR nromotor IN ('VIEJ11', '333666')").then(res => {
  console.log(res.rows);
  process.exit(0);
});
