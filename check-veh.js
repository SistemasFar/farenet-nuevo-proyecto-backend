const pool = require('./config/database');
async function check() {
  const client = await pool.connect();
  try {
    const res = await client.query("SELECT nroplacaantigua FROM vehiculo WHERE nroplacaantigua IN ('DUP-123', 'LOC-123', 'REI-123', 'DSC-123')");
    console.log("Vehiculos inyectados:", res.rows.map(r => r.nroplacaantigua));
  } finally {
    client.release();
    process.exit();
  }
}
check();
