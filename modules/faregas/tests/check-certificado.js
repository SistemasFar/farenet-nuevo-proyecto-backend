const db = require('../../../config/database');
async function run() {
  const client = await db.connect();
  try {
    const res = await client.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'fg_certificado'");
    console.log(res.rows);
  } finally {
    client.release();
    process.exit();
  }
}
run();
