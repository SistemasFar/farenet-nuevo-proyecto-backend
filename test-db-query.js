const db = require('./config/database');
async function run() {
    const res1 = await db.query("SELECT COUNT(*) FROM fg_servicio WHERE tipo_certificado_clave IN ('TALLER_GLP', 'TALLER_GNV');");
    console.log('fg_servicio:', res1.rows[0].count);
    const res2 = await db.query("SELECT COUNT(*) FROM fg_correlativo_certificado WHERE tipo_certificado_clave IN ('TALLER_GLP', 'TALLER_GNV');");
    console.log('fg_correlativo_certificado:', res2.rows[0].count);
    process.exit(0);
}
run();
