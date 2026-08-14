require('dotenv').config();
const db = require('./config/database');

async function main() {
    try {
        const res = await db.query(`
            SELECT is_nullable 
            FROM information_schema.columns 
            WHERE table_name = 'fg_certificado' AND column_name = 'cliente_id'
        `);
        console.log("NULABILIDAD DE cliente_id:", res.rows[0]);
    } catch (e) {
        console.error(e);
    } finally {
        process.exit(0);
    }
}
main();
