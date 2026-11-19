const db = require('../config/database');
const readinessService = require('../modules/faregas/services/faregas-nubefact-readiness.service');
const facturacionService = require('../modules/faregas/services/faregas-facturacion.service');
const { evaluarDetraccion } = require('../modules/faregas/services/faregas-detracciones.service');
const { construirPayloadNubefact } = require('../modules/faregas/integrations/nubefact-faregas.adapter');
const nubefactConfigService = require('../modules/faregas/services/faregas-nubefact-config.service');

async function run() {
    console.log('--- 1. CONFIGURACIÓN EMISOR DEMO RESOLVER ---');
    const configEmisor = await nubefactConfigService.resolverParaPlanta('160');
    console.log({
        empresaKey: configEmisor.empresaKey,
        rucEmisor: configEmisor.rucEmisor,
        razonSocialEmisor: configEmisor.razonSocialEmisor,
        cuentaBancoNacion: configEmisor.cuentaBancoNacion,
        environment: configEmisor.environment,
        configured: configEmisor.configured,
        detractionDecision: configEmisor.detractionDecision
    });

    console.log('\n--- 2. EVALUACIÓN SPOT FACTURA S/ 1,000 ---');
    const evaluacionSpot = evaluarDetraccion({
        tipoComprobante: 'FACTURA',
        importeTotal: 1000.00,
        servicio: {
            sujeto_detraccion: true,
            detraccion_codigo: '037',
            detraccion_porcentaje: 12.00
        }
    });
    console.log({
        sujeto: evaluacionSpot.sujeto,
        codigo: evaluacionSpot.codigo,
        porcentaje: evaluacionSpot.porcentaje,
        base: evaluacionSpot.base,
        monto: evaluacionSpot.monto,
        neto: evaluacionSpot.neto,
        nubefactTipo: evaluacionSpot.nubefactTipo,
        medioPagoDetraccion: evaluacionSpot.medioPagoDetraccion,
        requiereRevision: evaluacionSpot.requiereRevision
    });

    console.log('\n--- 3. VALIDACIÓN DE CUENTA BANCARIA DEL EMISOR ---');
    facturacionService._private.validarCuentaDetraccionEmisor(evaluacionSpot, configEmisor);
    console.log('Cuenta Banco de la Nación de CAMBRIDGE validada con éxito:', configEmisor.cuentaBancoNacion);

    console.log('\n--- 4. CONSTRUCCIÓN DEL PAYLOAD NUBEFACT S/ 1,000 CON SPOT ---');
    const facturacion = {
        id: 9999,
        tipo_comprobante: 'FACTURA',
        serie: 'FFF1',
        numero: 61,
        nro_documento: '20600444531',
        nombre_razon_social: 'I.T.V. CAMBRIDGE S.A.C.',
        direccion: 'CALLE LIMA 123',
        email: 'facturacion@cambridge.pe',
        fecha_documento: '2026-11-19',
        moneda_key: 'PEN',
        base_imponible: 847.46,
        igv: 152.54,
        importe_total: 1000.00,
        sujeto_detraccion: evaluacionSpot.sujeto,
        detraccion_codigo: evaluacionSpot.codigo,
        detraccion_descripcion: evaluacionSpot.descripcion,
        detraccion_porcentaje: evaluacionSpot.porcentaje,
        detraccion_base: evaluacionSpot.base,
        detraccion_monto: evaluacionSpot.monto,
        detraccion_neto: evaluacionSpot.neto,
        detraccion_estado_deposito: evaluacionSpot.estadoDeposito
    };

    const payload = construirPayloadNubefact({
        facturacion,
        certificado: { id: 845, placa: 'B7X-999' },
        vehiculo: { placa: 'B7X-999' },
        detalles: [{
            tipo_item: 'SERVICIO',
            descripcion: 'CERTIFICACION VEHICULAR GNV',
            unidad_de_medida: 'ZZ',
            cantidad: 1,
            valor_unitario: 847.46,
            precio_unitario: 1000.00,
            subtotal: 847.46,
            tipo_de_igv: 1,
            igv: 152.54,
            total: 1000.00,
            descuento: 0
        }]
    });

    console.log('Payload fiscal generado para NubeFact:');
    console.log(JSON.stringify({
        operacion: payload.operacion,
        tipo_de_comprobante: payload.tipo_de_comprobante,
        serie: payload.serie,
        numero: payload.numero,
        sunat_transaction: payload.sunat_transaction,
        total_gravada: payload.total_gravada,
        total_igv: payload.total_igv,
        total: payload.total,
        detraccion: payload.detraccion,
        detraccion_tipo: payload.detraccion_tipo,
        detraccion_porcentaje: payload.detraccion_porcentaje,
        detraccion_total: payload.detraccion_total,
        medio_de_pago_detraccion: payload.medio_de_pago_detraccion,
        condiciones_de_pago: payload.condiciones_de_pago
    }, null, 2));

    console.log('\n--- 5. VERIFICACIÓN DE DISPONIBILIDAD DEL CORRELATIVO SIGUIENTE EN NUBEFACT ---');
    const { validarCorrelativoDisponible } = require('../modules/faregas/services/faregas-nubefact-correlativo-guard.service');
    const nubefact = require('../services/integrations/nubefact.service');
    const disp = await validarCorrelativoDisponible(nubefact, {
        tipoComprobante: 'FACTURA',
        serie: 'FFF1',
        numero: 61,
        credentials: configEmisor.credentials
    });
    console.log('Validación de correlativo FFF1-61 en NubeFact DEMO exitosa (disponible para emitir).');

    db.end();
}
run().catch(e => { console.error('Error preflight:', e); db.end(); });
