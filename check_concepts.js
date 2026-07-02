const pool = require('./config/database');
pool.query(`SELECT key, nombre FROM conceptoinspeccion WHERE key IN ('2', '44')`).then(r => console.log(r.rows)).catch(console.error).finally(()=>process.exit(0));
