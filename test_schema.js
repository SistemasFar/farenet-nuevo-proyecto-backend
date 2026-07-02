const pool = require('./config/database');
pool.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'periodoreinspeccion'").then(res => {
  console.log(res.rows);
  process.exit(0);
}).catch(console.error);
