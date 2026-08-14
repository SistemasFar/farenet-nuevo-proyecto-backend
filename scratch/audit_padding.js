const pool = require('../config/database');
async function audit() {
    try {
        const q = await pool.query("SELECT c.numero_certificado, t.clave, t.codigo, c.fecha_emision FROM fg_certificado c JOIN fg_tipo_certificado t ON c.tipo_certificado_clave = t.clave WHERE c.numero_certificado IS NOT NULL LIMIT 20");
        console.log(q.rows);
    } catch(e) {
        console.error(e);
    } finally {
        process.exit();
    }
}
audit();
