const pool = require('./config/database');

async function run() {
  const client = await pool.connect();
  try {
    const res = await client.query("SELECT * FROM periodoreinspeccion WHERE planta_key = '201'");
    console.log(res.rows);
  } catch (err) {
    console.log(err);
  } finally {
    client.release();
  }
  process.exit(0);
}
run();
