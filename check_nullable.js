const db = require('./config/database');
async function run() {
    const res = await db.query("SELECT is_nullable FROM information_schema.columns WHERE table_name = 'fg_facturacion' AND column_name = 'certificado_id'");
    console.log('Nullable:', res.rows[0].is_nullable);
    process.exit(0);
}
run();
