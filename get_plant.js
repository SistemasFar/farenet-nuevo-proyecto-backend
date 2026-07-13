const db = require('./config/database');
const run = async () => {
    try {
        const res = await db.query("SELECT l.planta_key FROM inspeccion i JOIN comprobante c ON c.inspeccion_nrodocumentoinspeccion = i.nrodocumentoinspeccion JOIN linea l ON l.key = c.linea_key WHERE i.nrodocumentoinspeccion = 'INS-201-000160234'");
        console.log("Planta:", res.rows);
    } catch(e) {
        console.error(e);
    } finally {
        db.end();
    }
};
run();
