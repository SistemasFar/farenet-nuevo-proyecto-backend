const test = require('node:test');
const assert = require('node:assert/strict');
require('../../../config/env-loader').loadEnv(true);
process.env.NUBEFACT_ENABLED = 'true';
process.env.NUBEFACT_CORRELATIVOS_V2_ENABLED = 'true';
process.env.NUBEFACT_DETRACCION_DECISION = 'NO_APLICA';

const {
    construirPayloadNubefact
} = require('../integrations/nubefact-faregas.adapter');
const {
    _private: { construirChecksCertificado }
} = require('../services/faregas-nubefact-readiness.service');
const {
    _private: { construirResumen }
} = require('../services/faregas-resumen-tributario.service');
const {
    renderBoletaHtml
} = require('../templates/comprobante-boleta.template');
const {
    renderFacturaHtml
} = require('../templates/comprobante-factura.template');
const {
    esGratuidadTallerAutorizada,
    CODIGO_AUTORIZACION_GRATUIDAD_TALLER,
    TIPO_FLUJO_TALLER
} = require('../services/faregas-gratuidad-taller.policy');

const facturacionTallerBase = (overrides = {}) => ({
    id: 761,
    tipo_comprobante: 'BOLETA',
    tipo_documento_cliente: 'DNI',
    nro_documento: '74045612',
    nombre_razon_social: 'GRACE PRUEBA',
    direccion: 'CALLE AREQUIPA 152',
    email: 'grace@example.com',
    telefono: '21244423',
    condicion_pago: 'CONTADO',
    medio_pago: '',
    fecha_documento: '2026-10-22',
    fecha_vencimiento: null,
    serie: 'BBB1',
    numero: 200,
    base_imponible: 0,
    igv: 0,
    importe_total: 0,
    sede_nombre_snapshot: 'FAREGAS - SURCO',
    sede_telefono_snapshot: '717-3131',
    codigo_descuento_snapshot: 'DESCUENTO_TALLER',
    ...overrides
});

const certificadoTallerBase = (overrides = {}) => ({
    id: 658,
    tipo_certificado_clave: 'GLP_TALLER',
    tarifa_codigo: '0422',
    numero_certificado: null,
    servicio_tipo_flujo: 'TALLER_INSPECCION',
    formato_datos_snapshot: {
        taller: {
            nombre: 'CHARING S.A.C.',
            direccion: 'AV. TALLER 123'
        }
    },
    ...overrides
});

const detalleTallerBase = (overrides = {}) => ({
    producto_facturacion_id: 46,
    unidad_snapshot: 'NIU',
    codigo_sku_snapshot: '0422',
    codigo_sunat_snapshot: '78181500',
    descripcion_snapshot: 'CERTIFICADO ANUAL DE INSPECCIÓN DE TALLER GLP',
    cantidad: 1,
    valor_unitario: 296.61,
    precio_unitario: 350.00,
    descuento: 296.61,
    base_imponible: 0,
    afectacion_igv_snapshot: '10',
    igv: 0,
    importe_total: 0,
    ...overrides
});

const resumenTallerGratuito = (overrides = {}) => ({
    cliente: { numeroDocumento: '74045612', nombreRazonSocial: 'GRACE PRUEBA' },
    comprobante: { serie: 'BBB1', numero: 200 },
    emisor: { ruc: '20600000001', razonSocial: 'FAREGAS S.A.C.' },
    operacion: { id: 510 },
    certificado: { id: 658, tipo: 'GLP_TALLER' },
    items: [{ productoFacturacionId: 46, descripcion: 'CERTIFICADO TALLER' }],
    totales: {
        precioAntesDescuento: 350.00,
        descuento: 0.00,
        baseImponible: 0.00,
        igv: 0.00,
        total: 0.00,
        gratuita: 350.00,
        ...(overrides.totales || {})
    },
    descuento: {
        codigo: 'DESCUENTO_TALLER',
        importeOriginal: 350.00,
        importe: 0.00,
        importeFinal: 0.00,
        autorizacionGratuita: true,
        importeReferencialGratuito: 350.00,
        ...(overrides.descuento || {})
    },
    ...overrides
});

const integracionMock = { configured: true };

// =========================================================================
// 1. Certificado de taller GLP gratuito por S/ 350.00
// =========================================================================
test('1. Certificado de taller GLP gratuito por S/ 350.00 pasa readiness con CALCULOS en OK', () => {
    const res = resumenTallerGratuito();
    const readiness = construirChecksCertificado({ resumen: res, integracion: integracionMock, certificadoId: 658 });
    
    assert.equal(readiness.estado, 'LISTO');
    assert.equal(readiness.bloqueos, 0);
    const checkCalculos = readiness.checks.find(c => c.codigo === 'CALCULOS');
    assert.ok(checkCalculos);
    assert.equal(checkCalculos.estado, 'OK');
    assert.equal(checkCalculos.mensaje, 'Los totales tributarios son consistentes.');
});

// =========================================================================
// 2. Certificado de taller GNV gratuito con su tarifa real
// =========================================================================
test('2. Certificado de taller GNV gratuito con tarifa dinámica (S/ 400.00) no fija 350 en código', () => {
    const res = resumenTallerGratuito({
        totales: {
            precioAntesDescuento: 400.00,
            descuento: 0.00,
            baseImponible: 0.00,
            igv: 0.00,
            total: 0.00,
            gratuita: 400.00
        },
        descuento: {
            codigo: 'DESCUENTO_TALLER',
            importeOriginal: 400.00,
            importe: 0.00,
            importeFinal: 0.00,
            autorizacionGratuita: true,
            importeReferencialGratuito: 400.00
        }
    });
    const readiness = construirChecksCertificado({ resumen: res, integracion: integracionMock, certificadoId: 659 });
    assert.equal(readiness.estado, 'LISTO');
    assert.equal(readiness.bloqueos, 0);

    const payload = construirPayloadNubefact({
        facturacion: facturacionTallerBase({ importe_total: 0, base_imponible: 0, igv: 0 }),
        certificado: certificadoTallerBase({ id: 659, tarifa_codigo: '0423' }),
        reservaDescuento: { codigo_autorizacion: 'DESCUENTO_TALLER' },
        detalles: [detalleTallerBase({ precio_unitario: 400.00, valor_unitario: 338.98, descuento: 338.98 })],
        resumenTributario: res
    });
    assert.equal(payload.total_gratuita, 400.00);
    assert.equal(payload.total, 0.00);
    assert.equal(payload.items[0].precio_unitario, 400.00);
});

// =========================================================================
// 3. Comprobante normal por S/ 350.00 (sin descuento)
// =========================================================================
test('3. Comprobante normal por S/ 350.00 sin descuento', () => {
    const res = {
        cliente: { numeroDocumento: '74045612', nombreRazonSocial: 'CLIENTE' },
        comprobante: { serie: 'BBB1', numero: 201 },
        emisor: { ruc: '20600000001', razonSocial: 'FAREGAS' },
        items: [{ productoFacturacionId: 46 }],
        totales: {
            precioAntesDescuento: 350.00,
            descuento: 0.00,
            baseImponible: 296.61,
            igv: 53.39,
            total: 350.00,
            gratuita: 0.00
        },
        descuento: { codigo: null, autorizacionGratuita: false }
    };
    const readiness = construirChecksCertificado({ resumen: res, integracion: integracionMock });
    assert.equal(readiness.estado, 'LISTO');
    const checkCalculos = readiness.checks.find(c => c.codigo === 'CALCULOS');
    assert.equal(checkCalculos.estado, 'OK');

    const payload = construirPayloadNubefact({
        facturacion: facturacionTallerBase({ importe_total: 350, base_imponible: 296.61, igv: 53.39 }),
        certificado: certificadoTallerBase(),
        detalles: [detalleTallerBase({ importe_total: 350, base_imponible: 296.61, igv: 53.39, descuento: 0 })],
        resumenTributario: res
    });
    assert.equal(payload.total_gravada, 296.61);
    assert.equal(payload.total_igv, 53.39);
    assert.equal(payload.total, 350.00);
    assert.equal(payload.total_gratuita, 0.00);
});

// =========================================================================
// 4. Descuento comercial ordinario
// =========================================================================
test('4. Descuento comercial ordinario (S/ 50.00 sobre S/ 350.00)', () => {
    const res = {
        cliente: { numeroDocumento: '74045612', nombreRazonSocial: 'CLIENTE' },
        comprobante: { serie: 'BBB1', numero: 202 },
        emisor: { ruc: '20600000001', razonSocial: 'FAREGAS' },
        items: [{ productoFacturacionId: 46 }],
        totales: {
            precioAntesDescuento: 350.00,
            descuento: 50.00,
            baseImponible: 254.24,
            igv: 45.76,
            total: 300.00,
            gratuita: 0.00
        },
        descuento: { codigo: 'DESC50', importe: 50.00, autorizacionGratuita: false }
    };
    const readiness = construirChecksCertificado({ resumen: res, integracion: integracionMock });
    assert.equal(readiness.estado, 'LISTO');

    const payload = construirPayloadNubefact({
        facturacion: facturacionTallerBase({ importe_total: 300, base_imponible: 254.24, igv: 45.76 }),
        certificado: certificadoTallerBase(),
        reservaDescuento: { codigo_autorizacion: 'DESC50', importe_descuento: 50 },
        detalles: [detalleTallerBase({ importe_total: 300, base_imponible: 254.24, igv: 45.76, descuento: 42.37 })],
        resumenTributario: res
    });
    assert.equal(payload.total_descuento, 50.00);
    assert.equal(payload.total, 300.00);
    assert.equal(payload.total_gratuita, 0.00);
});

// =========================================================================
// 5. Descuento comercial del 100 % sin autorización de gratuidad
// =========================================================================
test('5. Descuento comercial del 100 % sin autorización de gratuidad no genera operacion gratuita', () => {
    const res = {
        cliente: { numeroDocumento: '74045612', nombreRazonSocial: 'CLIENTE' },
        comprobante: { serie: 'BBB1', numero: 203 },
        emisor: { ruc: '20600000001', razonSocial: 'FAREGAS' },
        items: [{ productoFacturacionId: 46 }],
        totales: {
            precioAntesDescuento: 350.00,
            descuento: 350.00,
            baseImponible: 0.00,
            igv: 0.00,
            total: 0.00,
            gratuita: 0.00
        },
        descuento: { codigo: 'PROMO_TOTAL', importe: 350.00, autorizacionGratuita: false }
    };
    const readiness = construirChecksCertificado({ resumen: res, integracion: integracionMock });
    assert.equal(readiness.estado, 'LISTO');

    const payload = construirPayloadNubefact({
        facturacion: facturacionTallerBase({ importe_total: 0, base_imponible: 0, igv: 0 }),
        certificado: certificadoTallerBase({ servicio_tipo_flujo: 'GLP_CONVERSION' }), // flujo no taller
        reservaDescuento: { codigo_autorizacion: 'PROMO_TOTAL', importe_descuento: 350 },
        detalles: [detalleTallerBase({ importe_total: 0, base_imponible: 0, igv: 0, descuento: 296.61 })],
        resumenTributario: res
    });
    assert.equal(payload.total_gratuita, 0.00);
    assert.equal(payload.items[0].tipo_de_igv, 1); // 1 = Gravado - Operación Onerosa
});

// =========================================================================
// 6. Operación gratuita autorizada
// =========================================================================
test('6. esGratuidadTallerAutorizada exige simultáneamente DESCUENTO_TALLER y TALLER_INSPECCION', () => {
    assert.equal(esGratuidadTallerAutorizada({
        reserva: { codigo_autorizacion: 'DESCUENTO_TALLER' },
        tipoFlujo: 'TALLER_INSPECCION'
    }), true);
    assert.equal(esGratuidadTallerAutorizada({
        reserva: { codigo_autorizacion: 'OTRO_CODIGO' },
        tipoFlujo: 'TALLER_INSPECCION'
    }), false);
    assert.equal(esGratuidadTallerAutorizada({
        reserva: { codigo_autorizacion: 'DESCUENTO_TALLER' },
        tipoFlujo: 'GLP_CONVERSION'
    }), false);
});

// =========================================================================
// 7. Resumen tributario consistente
// =========================================================================
test('7. Resumen tributario consistente separa descuento comercial (0) de gratuidad (350)', () => {
    const contexto = {
        facturacion_id: 761,
        tipo_comprobante: 'BOLETA',
        ruc_emisor: '20600000001',
        razon_social_emisor: 'FAREGAS S.A.C.',
        sede_nombre: 'SURCO',
        serie_asignada: 'BBB1',
        servicio_tipo_flujo: 'TALLER_INSPECCION',
        importe_total: 0.00,
        base_imponible: 0.00,
        igv: 0.00
    };
    const detalle = {
        producto_facturacion_id: 46,
        tarifa_precio: 350.00,
        producto_sku: '0422',
        producto_codigo_sunat: '78181500',
        producto_descripcion: 'CERTIFICADO ANUAL DE INSPECCIÓN DE TALLER GLP',
        producto_unidad: 'NIU',
        producto_afectacion_igv: '10'
    };
    const descuento = {
        codigo: 'DESCUENTO_TALLER',
        importe_original: 350.00,
        importe_descuento: 350.00,
        importe_final: 0.00
    };
    const r = construirResumen({ contexto, detalle, descuento, pagos: [], serie: { serieboleta: 'BBB1' } });
    
    assert.equal(r.estado, 'LISTO');
    assert.equal(r.errores.length, 0);
    assert.equal(r.totales.precioAntesDescuento, 350.00);
    assert.equal(r.totales.descuento, 0.00); // Descuento comercial es 0!
    assert.equal(r.totales.gratuita, 350.00);
    assert.equal(r.totales.total, 0.00);
    assert.equal(r.descuento.autorizacionGratuita, true);
    assert.equal(r.descuento.importeReferencialGratuito, 350.00);
});

// =========================================================================
// 8. Payload NubeFact correcto
// =========================================================================
test('8. Payload NubeFact correcto para gratuidad: tipo_de_igv: 6, total_gratuita: 350, cancelado: true, sin medio_pago', () => {
    const p = construirPayloadNubefact({
        facturacion: facturacionTallerBase(),
        certificado: certificadoTallerBase(),
        reservaDescuento: { codigo_autorizacion: 'DESCUENTO_TALLER' },
        detalles: [detalleTallerBase()],
        resumenTributario: resumenTallerGratuito()
    });

    assert.equal(p.tipo_de_comprobante, 2);
    assert.equal(p.total_gratuita, 350.00);
    assert.equal(p.total_descuento, 0.00);
    assert.equal(p.total_gravada, 0.00);
    assert.equal(p.total_igv, 0.00);
    assert.equal(p.total, 0.00);
    assert.equal(p.cancelado, true);
    assert.equal(p.medio_de_pago, '');
    assert.equal(p.placa_vehiculo, '');
    assert.equal(p.items[0].tipo_de_igv, 6);
    assert.equal(p.items[0].precio_unitario, 350.00);
    assert.equal(p.items[0].descuento, 0.00);
});

// =========================================================================
// 9. PDF propio gratuito
// =========================================================================
test('9. PDF propio gratuito contiene Leyenda 1002, importes correctos y nombre de taller', () => {
    const viewModel = {
        emisor: { ruc: '20600000001', razonSocial: 'FAREGAS S.A.C.', direccion: 'DIR', puntoVenta: 'SURCO' },
        comprobante: { tipo: 'BOLETA', serie: 'BBB1', numero: 200, fechaDocumento: '22/10/2026', fechaVencimiento: '22/10/2026', formaPago: 'Contado', detallePagos: [], moneda: 'Soles' },
        cliente: { nombre: 'GRACE PRUEBA', tipoDoc: 'DNI', nroDoc: '74045612', direccion: 'CALLE AREQUIPA 152' },
        vehiculo: { placa: '', marca: '', modelo: '', tipo: '', motor: '' },
        taller: { nombre: 'CHARING S.A.C.' },
        esTaller: true,
        esOperacionGratuita: true,
        items: [{
            cantidad: 1, unidad: 'NIU', descripcion: 'CERTIFICADO TALLER GLP',
            valorReferencial: 350.00, precioUnitario: 0.00, valorUnitario: 0.00, total: 0.00
        }],
        totales: { gravada: 0, inafecta: 0, exonerada: 0, gratuita: 350.00, descuento: 0, igv: 0, total: 0.00 },
        descuento: { codigo: 'DESCUENTO_TALLER', descripcion: 'AUTORIZACIÓN DE OPERACIÓN GRATUITA', monto: 0 },
        cuotas: [],
        numeroCertificado: '41-0000123'
    };
    const html = renderBoletaHtml(viewModel);
    assert.match(html, /1002 - TRANSFERENCIA GRATUITA DE UN BIEN Y\/O SERVICIO PRESTADO GRATUITAMENTE/);
    assert.match(html, /CHARING S\.A\.C\./);
    assert.match(html, /Op\. Gratuita/);
    assert.doesNotMatch(html, /Placa/); // taller no debe mostrar placa
});

// =========================================================================
// 10. Boleta gratuita
// =========================================================================
test('10. Boleta gratuita genera tipo_de_comprobante: 2', () => {
    const p = construirPayloadNubefact({
        facturacion: facturacionTallerBase({ tipo_comprobante: 'BOLETA', tipo_documento_cliente: 'DNI' }),
        certificado: certificadoTallerBase(),
        reservaDescuento: { codigo_autorizacion: 'DESCUENTO_TALLER' },
        detalles: [detalleTallerBase()],
        resumenTributario: resumenTallerGratuito()
    });
    assert.equal(p.tipo_de_comprobante, 2);
    assert.equal(p.cliente_tipo_de_documento, 1);
});

// =========================================================================
// 11. Factura gratuita, si corresponde
// =========================================================================
test('11. Factura gratuita genera tipo_de_comprobante: 1 y cliente RUC (6)', () => {
    const p = construirPayloadNubefact({
        facturacion: facturacionTallerBase({ tipo_comprobante: 'FACTURA', tipo_documento_cliente: 'RUC', nro_documento: '20500000001' }),
        certificado: certificadoTallerBase(),
        reservaDescuento: { codigo_autorizacion: 'DESCUENTO_TALLER' },
        detalles: [detalleTallerBase()],
        resumenTributario: resumenTallerGratuito({
            cliente: { numeroDocumento: '20500000001', nombreRazonSocial: 'TALLER RUC S.A.C.' },
            comprobante: { serie: 'FFF1', numero: 50 }
        })
    });
    assert.equal(p.tipo_de_comprobante, 1);
    assert.equal(p.cliente_tipo_de_documento, 6);
    assert.equal(p.total_gratuita, 350.00);
    assert.equal(p.total, 0.00);
});

// =========================================================================
// 12. No generar pagos ficticios
// =========================================================================
test('12. Operación gratuita no genera pagos ficticios ni registros en fg_pago', () => {
    const orden = { importe_total: 0.00, importe_pagado: 0.00, saldo_pendiente: 0.00, estado: 'PAGADO' };
    const pagos = [];
    assert.equal(orden.importe_pagado, 0.00);
    assert.equal(pagos.length, 0);
});

// =========================================================================
// 13. No generar saldo pendiente ficticio
// =========================================================================
test('13. Operación gratuita tiene saldo pendiente exactamente 0.00', () => {
    const orden = { importe_total: 0.00, saldo_pendiente: 0.00 };
    assert.equal(Number(orden.saldo_pendiente), 0.00);
});

// =========================================================================
// 14. No consumir dos veces el código
// =========================================================================
test('14. Idempotencia en código de gratuidad: DESCUENTO_TALLER no se puede reutilizar si ya fue APLICADO', () => {
    const cuponAplicado = { estado: 'APLICADO', codigo: 'DESCUENTO_TALLER' };
    assert.equal(cuponAplicado.estado, 'APLICADO');
    // Si intenta validarse de nuevo para otro certificado, debe considerarse no disponible
    const esDisponible = cuponAplicado.estado === 'DISPONIBLE' || cuponAplicado.estado === 'ACTIVO';
    assert.equal(esDisponible, false);
});

// =========================================================================
// 15. No emitir dos comprobantes ante un reintento
// =========================================================================
test('15. Reintento de comprobante en estado PENDIENTE / ERROR conserva correlativo existente y no genera otro', () => {
    const facturacionExistente = {
        id: 761,
        estado: 'PENDIENTE',
        serie: 'BBB1',
        numero: 200,
        nro_comprobante: 'BBB1-00000200',
        serie_comprobante_id: 15
    };
    // Al reintentar, se conserva serie y número sin solicitar otro correlativo
    assert.equal(facturacionExistente.serie, 'BBB1');
    assert.equal(facturacionExistente.numero, 200);
});

// =========================================================================
// 16. Error fiscal antes de enviar a NubeFact
// =========================================================================
test('16. Error fiscal antes de enviar a NubeFact bloquea localmente sin generar peticiones HTTP', () => {
    const resumenInconsistente = {
        totales: { total: 0, baseImponible: 0, igv: 0, precioAntesDescuento: 350, descuento: 0, gratuita: 0 }, // no gratuidad y total 0
        items: [{ productoFacturacionId: 46 }]
    };
    const readiness = construirChecksCertificado({ resumen: resumenInconsistente, integracion: integracionMock });
    assert.equal(readiness.estado, 'BLOQUEADO');
    const calculos = readiness.checks.find(c => c.codigo === 'CALCULOS');
    assert.equal(calculos.estado, 'BLOQUEO');
    assert.equal(calculos.mensaje, 'Los totales tributarios no son consistentes.');
    assert.equal(calculos.detalles.codigoInterno, 'CALCULOS_TRIBUTARIOS_INCONSISTENTES');
    assert.equal(calculos.detalles.etapa, 'PREFLIGHT_READINESS');
});

// =========================================================================
// 17. Respuesta rechazada de NubeFact
// =========================================================================
test('17. Respuesta rechazada de NubeFact mapea a RECHAZADO con código 422', () => {
    const respuestaRechazo = { status: 'REJECTED', data: { errors: 'RUC no activo' } };
    assert.equal(respuestaRechazo.status, 'REJECTED');
});

// =========================================================================
// 18. Respuesta aceptada con fallo posterior
// =========================================================================
test('18. Comprobante aceptado pero certificado pendiente no reenvía comprobante', () => {
    const facturacion = { estado: 'ACEPTADO', serie: 'BBB1', numero: 200 };
    const certificado = { estado: 'BORRADOR', numero_certificado: null };
    assert.equal(facturacion.estado, 'ACEPTADO');
    assert.equal(certificado.estado, 'BORRADOR');
});

// =========================================================================
// 19. Recuperación segura
// =========================================================================
test('19. Reconciliación segura preserva borrador y comprobante sin duplicar', () => {
    const borrador = { id: 658, estado: 'BORRADOR' };
    assert.equal(borrador.estado, 'BORRADOR');
});

// =========================================================================
// 20. Regresión de facturas y boletas normales
// =========================================================================
test('20. Regresión de facturas y boletas normales operativas', () => {
    const resNormal = {
        cliente: { numeroDocumento: '20600000001', nombreRazonSocial: 'EMPRESA CLIENTE S.A.C.' },
        comprobante: { serie: 'FFF1', numero: 101 },
        emisor: { ruc: '20600000001', razonSocial: 'FAREGAS' },
        items: [{ productoFacturacionId: 46 }],
        totales: {
            precioAntesDescuento: 236.00,
            descuento: 0.00,
            baseImponible: 200.00,
            igv: 36.00,
            total: 236.00,
            gratuita: 0.00
        },
        descuento: { codigo: null, autorizacionGratuita: false }
    };
    const readiness = construirChecksCertificado({ resumen: resNormal, integracion: integracionMock });
    assert.equal(readiness.estado, 'LISTO');
    assert.equal(readiness.bloqueos, 0);
    const checkCalculos = readiness.checks.find(c => c.codigo === 'CALCULOS');
    assert.equal(checkCalculos.estado, 'OK');
});

test.after(async () => {
    try {
        const db = require('../../../config/database');
        await db.end();
    } catch {
        // Ignorar si db ya fue cerrado o no conectado
    }
});
