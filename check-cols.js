const pool = require('./config/database');
async function getCols() {
  const client = await pool.connect();
  try {
    const res = await client.query('SELECT * FROM descuentocomprobante LIMIT 1');
    console.log("Cols descuentocomprobante:", Object.keys(res.rows[0]).join(', '));
  } finally {
    client.release();
    process.exit();
  }
}
getCols();
