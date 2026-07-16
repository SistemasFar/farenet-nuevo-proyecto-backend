const db = require('./config/database');
db.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'inspeccion'").then(res => {
  console.log(res.rows);
  process.exit(0);
});
