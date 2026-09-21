const db = require('./config/database');
async function run() {
    try {
        const id = 284;
        console.log("=== CERTIFICADO ===");
        const cert = await db.query("SELECT id, estado, paso_actual FROM fg_certificado WHERE id = $1", [id]);
        console.table(cert.rows);

        console.log("=== CONFORMIDAD ===");
        const conf = await db.query("SELECT * FROM fg_certificado_conformidad WHERE certificado_id = $1", [id]);
        console.table(conf.rows);
    } catch (e) {
        console.error(e);
    } finally {
        process.exit(0);
    }
}
run();
