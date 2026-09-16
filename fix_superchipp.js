require('dotenv').config();
const db = require('./config/database');

async function fix() {
  const c = await db.connect();
  try {
    await c.query("UPDATE fg_producto_inventariable SET tipo = 'CHIP_SERIALIZADO' WHERE codigo = 'SUPERCHIPW'");
    console.log("Updated to CHIP_SERIALIZADO");
  } finally {
    c.release();
    process.exit(0);
  }
}
fix();
