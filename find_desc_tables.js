const pool = require('./config/database');

async function run() {
  const client = await pool.connect();
  try {
    const res = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND (table_name ILIKE '%camp%' OR table_name ILIKE '%desc%')
    `);
    console.log(res.rows);
  } catch (err) {
    console.log(err);
  } finally {
    client.release();
  }
  process.exit(0);
}
run();
