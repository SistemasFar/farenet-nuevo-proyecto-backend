require('dotenv').config();
const pool = require('./config/database');
pool.query("SELECT pg_get_functiondef(oid) FROM pg_proc WHERE proname = 'notify_inspeccion_cambio'").then(res => {
  console.log(res.rows[0]);
  process.exit(0);
}).catch(err => {
  console.error(err);
  process.exit(1);
});
