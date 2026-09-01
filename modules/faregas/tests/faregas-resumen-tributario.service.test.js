const test = require('node:test');
const assert = require('node:assert/strict');
const resumenService = require('../services/faregas-resumen-tributario.service');

const contextoBase = {
    certificado_id: 10,
    facturacion_id: 20,
    planta_key: '201',
    sede_nombre: 'INDEPENDENCIA',
    sede_direccion: 'LIMA',
    empresa_key: 'CAMBRIDGE',
    razon_social_emisor: 'I.T.V. CAMBRIDGE S.A.C.',
    ruc_emisor: '20600444531',
    direccion_emisor: 'LIMA',
    entorno_facturador: 'DEMO',
    tipo_comprobante: 'BOLETA',
    tipo_documento_cliente: 'DNI',
    nro_documento: '12345678',
    nombre_razon_social: 'CLIENTE PRUEBA',
    direccion_cliente: 'LIMA',
    email: 'cliente@example.com',
    moneda_key: 'sol',
    base_imponible: 67.8,
    igv: 12.2,
    importe_total: 80,
    condicion_pago: 'CONTADO',
    medio_pago: 'EFECTIVO',
    numero_asignado: null
};

const detalleBase = {
    producto_facturacion_id: 25,
    producto_activo: true,
    producto_sku: 'GLP-INICIAL',
    producto_descripcion: 'CERTIFICACIÓN GLP INICIAL',
    producto_unidad: 'ZZ',
    producto_codigo_sunat: '84141607',
    producto_afectacion_igv: '10',
    tarifa_precio: 80,
    cantidad: 1,
    orden: 1
};

test('construye un resumen tributario listo sin consumir número', () => {
    const resumen = resumenService._private.construirResumen({
        contexto: contextoBase,
        detalle: detalleBase,
        descuento: null,
        pagos: [{ medio_pago: 'efectivo' }],
        serie: { serieboleta: 'BE03', seriefactura: 'FE03' }
    });

    assert.equal(resumen.estado, 'LISTO');
    assert.equal(resumen.comprobante.serie, 'BE03');
    assert.equal(resumen.comprobante.numero, null);
    assert.equal(resumen.comprobante.numeroAsignado, false);
    assert.equal(resumen.items[0].unidad, 'ZZ');
    assert.equal(resumen.items[0].codigoSunat, '84141607');
    assert.equal(resumen.totales.total, 80);
});

test('mantiene precio original y descuento separados para Nubefact', () => {
    const resumen = resumenService._private.construirResumen({
        contexto: { ...contextoBase, base_imponible: 59.32, igv: 10.68, importe_total: 70 },
        detalle: detalleBase,
        descuento: { importe_original: 80, importe_descuento: 10, importe_final: 70 },
        pagos: [],
        serie: { serieboleta: 'BE03', seriefactura: 'FE03' }
    });
    const [item] = resumenService.construirDetallesNubefact(resumen);

    assert.equal(resumen.totales.precioAntesDescuento, 80);
    assert.equal(resumen.totales.descuento, 10);
    assert.equal(resumen.totales.total, 70);
    assert.equal(item.precio_unitario, 80);
    assert.equal(item.descuento, 8.47);
    assert.equal(item.importe_total, 70);
});

test('bloquea el resumen cuando la tarifa no tiene producto fiscal vinculado', () => {
    const resumen = resumenService._private.construirResumen({
        contexto: contextoBase,
        detalle: {
            tarifa_precio: 80,
            servicio_codigo: 'GLP_INICIAL',
            servicio_nombre: 'Certificado Inicial',
            unidad_snapshot: 'ZZ',
            afectacion_igv_snapshot: '10'
        },
        descuento: null,
        pagos: [],
        serie: { serieboleta: 'BE03', seriefactura: 'FE03' }
    });

    assert.equal(resumen.estado, 'INCOMPLETO');
    assert.ok(resumen.errores.some(error => error.includes('producto de facturación')));
    assert.ok(resumen.errores.some(error => error.includes('clasificación SUNAT')));
});

test('rechaza una unidad que no sea servicio y un código SUNAT incompleto', () => {
    const resumen = resumenService._private.construirResumen({
        contexto: contextoBase,
        detalle: {
            ...detalleBase,
            producto_unidad: 'NIU',
            producto_codigo_sunat: '42'
        },
        descuento: null,
        pagos: [],
        serie: { serieboleta: 'BE03', seriefactura: 'FE03' }
    });

    assert.equal(resumen.estado, 'INCOMPLETO');
    assert.ok(resumen.errores.some(error => error.includes('debe ser ZZ')));
    assert.ok(resumen.errores.some(error => error.includes('8 dígitos')));
});
