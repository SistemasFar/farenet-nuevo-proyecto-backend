const pool = require('./config/database');
pool.query(`SELECT * FROM periodoreinspeccion WHERE planta_key = '201'`).then(r => console.log(r.rows)).catch(console.error).finally(()=>process.exit(0));
