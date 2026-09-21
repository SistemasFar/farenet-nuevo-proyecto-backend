const db = require('./config/database');
async function run() {
    try {
        const res = await db.query("SELECT column_name, is_nullable, data_type FROM information_schema.columns WHERE table_name = 'fg_certificado_conformidad'");
        console.table(res.rows);
    } catch (e) {
        console.error(e);
    } finally {
        process.exit(0);
    }
}
run();
