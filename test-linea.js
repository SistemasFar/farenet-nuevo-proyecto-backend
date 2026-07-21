const db = require('./config/database');
async function run() {
    const q = `SELECT c.linea_key FROM inspeccion i LEFT JOIN comprobante c ON i.comprobante_id = c.id WHERE i.nrodocumentoinspeccion = 'INS-201-000157904'`;
    const res = await db.query(q);
    console.log(res.rows[0]);
    process.exit(0);
}
run();
