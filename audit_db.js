const db = require('./config/database');

async function check() {
    try {
        const res1 = await db.query("SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_name IN ('fg_vehiculo', 'fg_certificado_vehiculo') AND column_name = 'categoria'");
        console.log('Columns:', res1.rows);
        
        const res2 = await db.query("SELECT unnest(enum_range(NULL::estado_certificado)) AS estado");
        console.log('Estados permitidos en enum:', res2.rows.map(r => r.estado));
        
        // Also check if ANULADO is inside pg_constraint if it's not an enum
        const res3 = await db.query("SELECT conname, pg_get_constraintdef(c.oid) FROM pg_constraint c JOIN pg_class t ON c.conrelid = t.oid WHERE t.relname = 'fg_certificado'");
        console.log('Constraints fg_certificado:', res3.rows.filter(r => r.pg_get_constraintdef.includes('estado')));

        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}
check();
