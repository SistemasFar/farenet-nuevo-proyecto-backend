const db = require('./config/database');
async function run() {
    try {
        console.log("=== ANTES ===");
        let res = await db.query(`SELECT column_name, is_nullable FROM information_schema.columns WHERE table_name = 'fg_certificado_conformidad' AND column_name = 'tipo_conformidad';`);
        console.table(res.rows);

        console.log("=== EJECUTANDO ALTER TABLE ===");
        const sql = `ALTER TABLE fg_certificado_conformidad ALTER COLUMN tipo_conformidad DROP NOT NULL;`;
        console.log(sql);
        await db.query(sql);

        console.log("=== DESPUÉS ===");
        res = await db.query(`SELECT column_name, is_nullable FROM information_schema.columns WHERE table_name = 'fg_certificado_conformidad' AND column_name = 'tipo_conformidad';`);
        console.table(res.rows);
    } catch (e) {
        console.error(e);
    } finally {
        process.exit(0);
    }
}
run();
