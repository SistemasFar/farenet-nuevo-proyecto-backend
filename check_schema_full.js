const db = require('./config/database');
async function run() {
    try {
        const res = await db.query(`
            SELECT column_name, data_type, is_nullable, column_default 
            FROM information_schema.columns 
            WHERE table_name = 'fg_certificado_conformidad'
            ORDER BY ordinal_position;
        `);
        console.table(res.rows);
    } catch (e) {
        console.error(e);
    } finally {
        process.exit(0);
    }
}
run();
