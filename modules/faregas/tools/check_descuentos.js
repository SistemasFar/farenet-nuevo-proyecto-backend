const db = require('../../../config/database');

async function main() {
  const d = await db.query("SELECT * FROM fg_descuento");
  console.log('fg_descuento:', d.rows);

  const dc = await db.query("SELECT * FROM fg_descuentocliente");
  console.log('fg_descuentocliente:', dc.rows);

  await db.end();
}

main().catch(console.error);
