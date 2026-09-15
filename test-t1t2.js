const db = require('./config/database');
async function run() {
    try {
        const resServicios = await db.query(`SELECT COUNT(*) FROM fg_servicio WHERE tipo_certificado_clave IN ('TALLER_GNV', 'TALLER_GLP')`);
        const resRangos = await db.query(`SELECT COUNT(*) FROM fg_correlativo_certificado WHERE tipo_certificado_clave IN ('TALLER_GNV', 'TALLER_GLP')`);
        console.log({
            servicios: resServicios.rows[0].count,
            rangos: resRangos.rows[0].count
        });
    } catch(e) { console.error(e); } finally { process.exit(0); }
}
run();
