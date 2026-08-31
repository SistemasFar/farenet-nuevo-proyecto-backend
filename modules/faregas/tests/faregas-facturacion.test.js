const test = require('node:test');
const assert = require('node:assert/strict');
const {
    normalizarFacturacion,
    validarFacturacion,
    validarFacturacionNubefact,
    validarSerieNubefact,
    validarCuotasContraTotal
} = require('../services/faregas-facturacion.rules');
const {
    construirPayloadNubefact,
    limpiarRespuestaProveedor,
    crearCodigoUnico
} = require('../integrations/nubefact-faregas.adapter');

test('normaliza una factura con RUC y valida sus campos fiscales', () => {
    const data = normalizarFacturacion({
        tipoComprobante: 'factura',
        nroDocumento: '20123456789',
        nombreRazonSocial: 'Empresa de Prueba SAC',
        direccion: 'Av. Prueba 123',
        email: 'VENTAS@PRUEBA.PE'
    });
    assert.equal(data.tipoComprobante, 'FACTURA');
    assert.equal(data.tipoDocumentoCliente, 'RUC');
    assert.equal(data.email, 'ventas@prueba.pe');
    assert.deepEqual(validarFacturacion(data), []);
});

test('impide emitir factura con DNI', () => {
    const data = normalizarFacturacion({
        tipoComprobante: 'FACTURA',
        nroDocumento: '12345678',
        nombreRazonSocial: 'CLIENTE',
        direccion: 'LIMA'
    });
    assert.ok(validarFacturacion(data).some(error => error.includes('RUC')));
});

test('construye el contrato Nubefact desde importes controlados por backend', () => {
    const payload = construirPayloadNubefact({
        facturacion: {
            id: 55,
            tipo_comprobante: 'BOLETA',
            tipo_documento_cliente: 'DNI',
            nro_documento: '12345678',
            nombre_razon_social: 'CLIENTE PRUEBA',
            direccion: 'LIMA',
            email: null,
            serie: 'BE01',
            numero: 25,
            base_imponible: 127.12,
            igv: 22.88,
            importe_total: 150
        },
        certificado: { id: 99, tipo_certificado_clave: 'GLP_ANUAL' },
        vehiculo: { placa: 'ABC123' }
    });
    assert.equal(payload.tipo_de_comprobante, 2);
    assert.equal(payload.cliente_tipo_de_documento, 1);
    assert.equal(payload.serie, 'BE01');
    assert.equal(payload.numero, 25);
    assert.equal(payload.total_gravada, 127.12);
    assert.equal(payload.total_igv, 22.88);
    assert.equal(payload.total, 150);
    assert.equal(payload.items[0].total, 150);
    assert.equal(payload.codigo_unico, 'FG-55');
    assert.equal(typeof payload.total, 'number');
});

test('valida limites y formatos exigidos por Nubefact', () => {
    const data = normalizarFacturacion({
        tipoComprobante: 'BOLETA',
        nroDocumento: '12345678',
        nombreRazonSocial: 'CLIENTE',
        direccion: 'A'.repeat(101)
    });
    assert.ok(validarFacturacion(data).some(error => error.includes('100 caracteres')));
    assert.ok(validarFacturacionNubefact(data).some(error => error.includes('100 caracteres')));
    assert.equal(validarSerieNubefact('FE01', 'FACTURA'), true);
    assert.equal(validarSerieNubefact('BE01', 'BOLETA'), true);
    assert.equal(validarSerieNubefact('BE01', 'FACTURA'), false);
    assert.equal(validarSerieNubefact('F0010', 'FACTURA'), false);
    assert.equal(crearCodigoUnico(987), 'FG-987');
});

test('construye venta al credito con cuotas y multiples items', () => {
    const data = normalizarFacturacion({
        tipoComprobante: 'FACTURA', nroDocumento: '20123456789',
        nombreRazonSocial: 'CLIENTE EMPRESA', direccion: 'LIMA',
        condicionPago: 'CREDITO', fechaVencimiento: '2026-12-31',
        cuotas: [
            { numeroCuota: 1, fechaPago: '2026-11-30', importe: 50 },
            { numeroCuota: 2, fechaPago: '2026-12-31', importe: 68 }
        ]
    });
    assert.deepEqual(validarFacturacion(data), []);
    assert.equal(validarCuotasContraTotal(data.cuotas, 118), true);
    const payload = construirPayloadNubefact({
        facturacion: {
            id: 90, tipo_comprobante: 'FACTURA', tipo_documento_cliente: 'RUC',
            nro_documento: '20123456789', nombre_razon_social: 'CLIENTE EMPRESA',
            direccion: 'LIMA', serie: 'FE01', numero: 7, base_imponible: 100,
            igv: 18, importe_total: 118, condicion_pago: 'CREDITO',
            fecha_vencimiento: '2026-12-31'
        },
        certificado: { id: 12, tipo_certificado_clave: 'GLP_ANUAL' },
        vehiculo: { placa: 'ABC123' },
        detalles: [
            { orden: 1, descripcion_snapshot: 'SERVICIO A', cantidad: 1, valor_unitario: 50, precio_unitario: 59, base_imponible: 50, igv: 9, importe_total: 59, afectacion_igv_snapshot: '10' },
            { orden: 2, descripcion_snapshot: 'PRODUCTO B', cantidad: 1, valor_unitario: 50, precio_unitario: 59, base_imponible: 50, igv: 9, importe_total: 59, afectacion_igv_snapshot: '10' }
        ],
        cuotas: [
            { numero_cuota: 1, fecha_pago: '2026-11-30', importe: 50 },
            { numero_cuota: 2, fecha_pago: '2026-12-31', importe: 68 }
        ]
    });
    assert.equal(payload.items.length, 2);
    assert.equal(payload.condiciones_de_pago, 'CREDITO');
    assert.equal(payload.cancelado, false);
    assert.equal(payload.venta_al_credito.length, 2);
    assert.equal(payload.fecha_de_vencimiento, '31-12-2026');
});

test('no persiste archivos base64 devueltos por el proveedor', () => {
    const limpia = limpiarRespuestaProveedor({
        aceptada_por_sunat: true,
        pdf_zip_base64: 'contenido-pesado',
        enlace_del_pdf: 'https://example.test/documento.pdf'
    });
    assert.equal(limpia.pdf_zip_base64, undefined);
    assert.equal(limpia.aceptada_por_sunat, true);
    assert.ok(limpia.enlace_del_pdf);
});
