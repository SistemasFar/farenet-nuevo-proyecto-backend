require('dotenv').config();
const db = require('./config/database');

async function q() {
  const c = await db.connect();
  try {
    const res = await c.query("SELECT * FROM fg_producto_inventariable_sede WHERE producto_inventariable_id = 3");
    console.log(res.rows);
  } finally {
    c.release();
    process.exit(0);
  }
}
q();
