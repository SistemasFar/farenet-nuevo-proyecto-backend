const db = require('./config/database');

async function check() {
    try {
        const res3 = await db.query("SELECT conname, pg_get_constraintdef(c.oid) FROM pg_constraint c JOIN pg_class t ON c.conrelid = t.oid WHERE t.relname = 'fg_certificado'");
        console.log('Constraints fg_certificado:', res3.rows.filter(r => r.pg_get_constraintdef.includes('estado')));

        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}
check();
