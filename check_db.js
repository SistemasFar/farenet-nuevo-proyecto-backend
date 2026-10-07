const db = require('./config/database');
async function run() {
  try {
    const r = await db.query(`SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_name IN ('fg_producto_inventariable', 'fg_producto_inventariable_sede', 'fg_chip', 'fg_chip_movimiento', 'fg_inventario_movimiento', 'fg_inventario_stock') ORDER BY table_name, ordinal_position`);
    console.table(r.rows);
    
    const r2 = await db.query(`SELECT id, codigo, nombre, tipo, activo FROM fg_producto_inventariable`);
    console.log('--- fg_producto_inventariable data ---');
    console.table(r2.rows);

    const r3 = await db.query(`SELECT id, codigo_sku, descripcion, precio_unitario, precio_referencia, activo FROM fg_producto_facturacion WHERE codigo_sku IN ('130', '132')`);
    console.log('--- fg_producto_facturacion data ---');
    console.table(r3.rows);

    const r4 = await db.query(`SELECT * FROM fg_producto_inventariable_sede`);
    console.log('--- fg_producto_inventariable_sede data ---');
    console.table(r4.rows);

    const r5 = await db.query(`SELECT * FROM pg_catalog.pg_tables WHERE schemaname != 'pg_catalog' AND schemaname != 'information_schema' AND tablename LIKE '%inventario%'`);
    console.log('--- tablas con inventario ---');
    console.table(r5.rows);

    const r6 = await db.query(`SELECT * FROM migrations WHERE name LIKE '%inventario%' OR name LIKE '%chip%' ORDER BY id DESC LIMIT 5`);
    console.log('--- migraciones aplicadas ---');
    console.table(r6.rows);
  } catch (err) {
    console.error(err);
  } finally {
    process.exit(0);
  }
}
run();
