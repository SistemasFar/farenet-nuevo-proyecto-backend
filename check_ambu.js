const pool = require('./config/database');

async function run() {
  const client = await pool.connect();
  try {
    const res = await client.query("SELECT * FROM conceptoinspeccion WHERE nombre ILIKE '%AMBULANCIA%'");
    console.log(res.rows);
  } catch (err) {
    console.log(err);
  } finally {
    client.release();
  }
  process.exit(0);
}
run();
