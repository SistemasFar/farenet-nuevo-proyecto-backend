const db = require('./config/database');

async function run() {
    try {
        const result = await db.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'fg_correlativo_certificado'
        `);
        console.log("SCHEMA fg_correlativo_certificado:", result.rows);
    } catch (e) {
        console.error(e);
    } finally {
        process.exit(0);
    }
}
run();
