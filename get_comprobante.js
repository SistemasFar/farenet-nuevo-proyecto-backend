const db = require('./config/database');
const run = async () => {
    try {
        const res = await db.query("SELECT c.id FROM inspeccion i LEFT JOIN comprobante c ON c.inspeccion_nrodocumentoinspeccion = i.nrodocumentoinspeccion WHERE i.nrodocumentoinspeccion = 'INS-201-000160234'");
        console.log("Comprobante:", res.rows);
    } catch(e) {
        console.error(e);
    } finally {
        db.end();
    }
};
run();
