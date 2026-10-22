require('../config/env-loader').loadEnv(true);
const db = require('../config/database');

async function q() {
    try {
        const r = await db.query("SELECT * FROM fg_facturacion WHERE serie = $1 AND numero = $2", ["BBB1", 214]);
        console.log("FACTURACION 214:", JSON.stringify(r.rows[0], null, 2));
        if (r.rows[0]) {
            const cert = await db.query("SELECT * FROM fg_certificado WHERE id = $1", [r.rows[0].certificado_id]);
            console.log("CERTIFICADO 214:", JSON.stringify(cert.rows[0], null, 2));
            const qIntento = await db.query("SELECT id, estado, solicitud, respuesta FROM fg_facturacion_intento WHERE facturacion_id = $1", [r.rows[0].id]);
            console.log("INTENTOS 214:", JSON.stringify(qIntento.rows, null, 2));
        }
    } catch (e) {
        console.error(e);
    } finally {
        await db.end();
    }
}
q();
