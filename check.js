const pool = require('./config/database');
pool.query("SELECT column_name FROM information_schema.columns WHERE table_name='tipomaquina'").then(res => {
  console.log(res.rows);
  process.exit(0);
});
