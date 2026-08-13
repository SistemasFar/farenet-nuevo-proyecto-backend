const db = require('../config/database');

async function run() {
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        
        try {
            await client.query(`INSERT INTO fg_correlativo_certificado (planta_key, tipo_certificado_clave, nro_inicio, nro_actual, nro_maximo, activo) VALUES ('203', 'GNV_ANUAL', 101, 100, 200, false)`);
            console.log("Insert 1 OK");
            
            await client.query(`INSERT INTO fg_correlativo_certificado (planta_key, tipo_certificado_clave, nro_inicio, nro_actual, nro_maximo, activo) VALUES ('203', 'GNV_ANUAL', 201, 200, 300, false)`);
            console.log("Insert 2 OK");

            await client.query(`INSERT INTO fg_correlativo_certificado (planta_key, tipo_certificado_clave, nro_inicio, nro_actual, nro_maximo, activo) VALUES ('18', 'GNV_ANUAL', 101, 100, 200, false)`);
            console.log("Insert 3 OK");
        } catch(e) {
            console.error("Error en validación:", e.message);
        }
        await client.query('ROLLBACK');
    } catch(e) {
        console.error(e);
    } finally {
        client.release();
    }
    process.exit(0);
}
run();
