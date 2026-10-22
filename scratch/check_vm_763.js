const db = require('../config/database');
const { esFlujoTaller, esCodigoGratuidadTaller } = require('../modules/faregas/services/faregas-gratuidad-taller.policy');

async function check() {
    try {
        const qFact = await db.query(
            `SELECT f.*,
                    c.numero_certificado, c.estado AS certificado_estado,
                    c.formato_datos_snapshot, c.planta_key AS cert_planta, c.tarifa_codigo AS cert_tarifa,
                    s.tipo_flujo AS servicio_tipo_flujo
             FROM fg_facturacion f
             LEFT JOIN fg_certificado c ON c.id = f.certificado_id
             LEFT JOIN fg_tarifa tf ON tf.planta_key = c.planta_key AND tf.codigo = c.tarifa_codigo
             LEFT JOIN fg_servicio s ON s.id = tf.servicio_id
             WHERE f.id = 763`
        );
        const f = qFact.rows[0];
        const qIntento = await db.query(
            'SELECT solicitud FROM fg_facturacion_intento WHERE facturacion_id = 763 ORDER BY numero_intento DESC LIMIT 1'
        );
        const solicitud = qIntento.rows[0]?.solicitud;
        console.log('f.servicio_tipo_flujo:', f.servicio_tipo_flujo);
        console.log('cert_planta:', f.cert_planta);
        console.log('cert_tarifa:', f.cert_tarifa);
        console.log('solicitud type:', typeof solicitud);
        console.log('solicitud:', JSON.stringify(solicitud, null, 2));
        console.log('solicitud.total_gratuita:', solicitud?.total_gratuita);
        console.log('solicitud.total:', solicitud?.total);
        console.log('esFlujoTaller:', esFlujoTaller(f.servicio_tipo_flujo));
        console.log('codigo_descuento_snapshot:', f.codigo_descuento_snapshot);
        console.log('esCodigoGratuidadTaller:', esCodigoGratuidadTaller(f.codigo_descuento_snapshot));
    } finally {
        await db.end();
    }
}
check();
