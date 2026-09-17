const db = require('./config/database');
async function run() {
    const res = await db.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'fg_orden_pago'`);
    console.log("fg_orden_pago cols:", res.rows);
    process.exit();
}
run();
