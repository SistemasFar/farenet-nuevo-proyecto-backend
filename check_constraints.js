const db = require('./config/database');
async function run() {
    const res = await db.query("SELECT tc.constraint_name, kcu.column_name FROM information_schema.table_constraints tc JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name WHERE tc.table_name = 'fg_facturacion' AND tc.constraint_type = 'UNIQUE'");
    console.log(res.rows);
    process.exit(0);
}
run();
