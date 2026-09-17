const db = require('./config/database');
async function run() {
    const res = await db.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'fg_facturacion'");
    console.log(res.rows.map(r=>r.column_name).join(', '));
    process.exit(0);
}
run();
