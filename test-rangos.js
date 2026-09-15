const db = require('./config/database');
async function run() {
    try {
        const res = await db.query(`SELECT id, tipo_certificado_clave, nro_inicio, nro_maximo, nro_actual FROM fg_correlativo_certificado`);
        console.log("Rangos:", res.rows);
    } catch(e) { console.error(e); } finally { process.exit(0); }
}
run();
