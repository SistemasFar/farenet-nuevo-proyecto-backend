require('dotenv').config();
const db = require('./config/database');

async function fix() {
  const c = await db.connect();
  try {
    await c.query("UPDATE fg_producto_facturacion SET codigo_clasificacion_sunat = NULL WHERE codigo_clasificacion_sunat = '42'");
    console.log("Fixed sunat codes");
  } finally {
    c.release();
    process.exit(0);
  }
}
fix();
