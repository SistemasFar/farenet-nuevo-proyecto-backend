const pool = require('./config/database');
pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'vehiculo'`).then(r => console.log(r.rows)).catch(console.error).finally(()=>process.exit(0));
