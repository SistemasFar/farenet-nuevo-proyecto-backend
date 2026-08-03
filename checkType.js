const pool = require('./config/database');
pool.query("SELECT pg_typeof(importetotal) FROM comprobante LIMIT 1")
  .then(r => console.log(r.rows))
  .catch(console.error)
  .finally(()=>pool.end());
