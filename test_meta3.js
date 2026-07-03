const pool = require('./config/database');
pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'inspeccion'")
  .then(res => console.log(res.rows.map(r => r.column_name).join(', ')))
  .catch(console.error)
  .finally(() => process.exit());
