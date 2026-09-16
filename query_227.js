require('dotenv').config();
const db = require('./config/database');

async function q() {
  const c = await db.connect();
  try {
    const res = await c.query("SELECT * FROM fg_producto_facturacion WHERE id = 227");
    console.log(res.rows[0]);
  } finally {
    c.release();
    process.exit(0);
  }
}
q();
