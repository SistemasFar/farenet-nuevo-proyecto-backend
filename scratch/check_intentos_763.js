const db = require('../config/database');

async function check() {
    try {
        const q = await db.query(
            `SELECT id, numero_intento, operacion, tipo_evento, estado, solicitud->>'operacion' as op_solicitud
             FROM fg_facturacion_intento
             WHERE facturacion_id = 763
             ORDER BY numero_intento ASC`
        );
        console.log('Intentos para 763:', q.rows);
    } finally {
        await db.end();
    }
}
check();
