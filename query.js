const pool = require('./config/database');
pool.query("SELECT nroidinspeccion FROM seriedocumentobase WHERE planta_key = '201'")
  .then(r => console.log(r.rows))
  .catch(console.error)
  .finally(()=>pool.end());
