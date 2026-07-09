const pool = require('./config/database');

async function check() {
  const c = await pool.connect();
  const res = await c.query("SELECT * FROM vehiculo LIMIT 10");
  console.log(res.rows.map(r => ({ nromotor: r.nromotor, kilometraje: r.kilometraje })));
  c.release();
  process.exit(0);
}
check();
