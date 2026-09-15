const db = require('./config/database');

async function run() {
    try {
        const result = await db.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name LIKE '%correlativo%' OR table_name LIKE '%serie%' OR table_name LIKE '%certificado%'`);
        console.log(result.rows);
    } catch (e) {
        console.error(e);
    } finally {
        process.exit(0);
    }
}
run();
