const pool = require('./config/database');
pool.query("SELECT nrodocumentoinspeccion, ui_metadata FROM inspeccion WHERE nroplacaantigua = 'TEST01' ORDER BY fechcreacion DESC LIMIT 1")
  .then(res => console.log(JSON.stringify(res.rows[0])))
  .catch(console.error)
  .finally(() => process.exit());
