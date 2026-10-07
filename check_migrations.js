const db = require('./config/database');
async function run() {
  try {
    const r2 = await db.query(`SELECT * FROM pgmigrations ORDER BY id DESC LIMIT 10`);
    console.table(r2.rows);

    const r3 = await db.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'fg_producto_inventariable_sede'`);
    console.log('--- fg_producto_inventariable_sede schema ---');
    console.table(r3.rows);

    const r4 = await db.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'fg_inventario_cantidad_movimiento'`);
    console.log('--- fg_inventario_cantidad_movimiento schema ---');
    console.table(r4.rows);
  } catch (e) { console.error(e) } finally {
    process.exit(0);
  }
}
run();
