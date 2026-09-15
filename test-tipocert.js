const db = require('./config/database');
async function run() {
    try {
        const res = await db.query(`SELECT * FROM fg_tipo_certificado`);
        console.log("Tipos de certificado:", res.rows);
    } catch(e) { console.error(e); } finally { process.exit(0); }
}
run();
