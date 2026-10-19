const db = require('../config/database');

async function checkGnvProducts() {
  try {
    const prods = await db.query(`
      SELECT id, codigo_sku, descripcion, precio_referencia, precio_unitario
      FROM fg_producto_facturacion
      WHERE descripcion ILIKE '%GNV%' OR codigo_sku ILIKE '%GNV%'
      ORDER BY codigo_sku
    `);
    console.table(prods.rows);

    process.exit(0);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
}

checkGnvProducts();
