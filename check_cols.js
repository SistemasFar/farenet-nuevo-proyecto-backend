const pool = require('./config/database');
pool.query("SELECT * FROM vehiculo LIMIT 1").then(res => {
  if (res.rows.length > 0) {
    console.log(Object.keys(res.rows[0]));
  }
  process.exit(0);
}).catch(err => {
  console.error(err);
  process.exit(1);
});
