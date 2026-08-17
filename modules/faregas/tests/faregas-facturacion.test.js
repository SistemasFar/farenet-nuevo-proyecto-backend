const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizarFacturacion, validarFacturacion } = require('../services/faregas-facturacion.rules');
const { construirPayloadNubefact, limpiarRespuestaProveedor } = require('../integrations/nubefact-faregas.adapter');

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
    assert.equal(payload.total_gravada, '127.12');
    assert.equal(payload.total_igv, '22.88');
    assert.equal(payload.total, '150.00');
    assert.equal(payload.items[0].total, '150.00');
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
