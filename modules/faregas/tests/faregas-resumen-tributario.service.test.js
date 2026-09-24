const test = require('node:test');
const assert = require('node:assert/strict');
const resumenService = require('../services/faregas-resumen-tributario.service');
const db = require('../../../config/database');

test.after(() => db.end());

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

test('desglosa certificado y chip y aplica el descuento solamente al certificado', () => {
    const resumen = resumenService._private.construirResumen({
        contexto: { ...contextoBase, base_imponible: 110.17, igv: 19.83, importe_total: 130 },
        detalles: [
            {
                ...detalleBase,
                tipo_item: 'SERVICIO',
                detalle_base_imponible: 84.75,
                detalle_igv: 15.25,
                detalle_importe_total: 100,
                precio_unitario: 100
            },
            {
                producto_facturacion_id: 26,
                producto_activo: true,
                producto_sku: 'CHIP',
                producto_descripcion: 'CHIP Y PORTA CHIP',
                producto_unidad: 'NIU',
                producto_codigo_sunat: null,
                producto_afectacion_igv: '10',
                tipo_item: 'PRODUCTO',
                tarifa_precio: 30,
                cantidad: 1,
                orden: 2,
                detalle_base_imponible: 25.42,
                detalle_igv: 4.58,
                detalle_importe_total: 30,
                precio_unitario: 30
            }
        ],
        descuento: { importe_original: 122, importe_descuento: 22, importe_final: 100 },
        pagos: [],
        serie: { serieboleta: 'BE03', seriefactura: 'FE03' }
    });
    const items = resumenService.construirDetallesNubefact(resumen);

    assert.equal(resumen.estado, 'LISTO');
    assert.equal(resumen.items.length, 2);
    assert.equal(resumen.totales.precioAntesDescuento, 152);
    assert.equal(resumen.totales.descuento, 22);
    assert.equal(resumen.totales.total, 130);
    assert.equal(items[0].importe_total, 100);
    assert.equal(items[1].descuento, 0);
    assert.equal(items[1].importe_total, 30);
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
    assert.ok(resumen.advertencias.some(advertencia => advertencia.includes('opcional')));
});

test('permite emitir sin código SUNAT y lo reporta como advertencia', () => {
    const resumen = resumenService._private.construirResumen({
        contexto: contextoBase,
        detalle: { ...detalleBase, producto_codigo_sunat: null },
        descuento: null,
        pagos: [{ medio_pago: 'efectivo' }],
        serie: { serieboleta: 'BE03', seriefactura: 'FE03' }
    });

    assert.equal(resumen.estado, 'LISTO');
    assert.equal(resumen.items[0].codigoSunat, null);
    assert.ok(resumen.advertencias.some(advertencia => advertencia.includes('opcional')));
});

test('conserva NIU en el resumen y en el detalle Nubefact sin transformarlo', () => {
    const resumen = resumenService._private.construirResumen({
        contexto: contextoBase,
        detalle: {
            ...detalleBase,
            producto_sku: '0221',
            producto_descripcion: 'CERTIFICACION ANUAL DE GLP',
            producto_unidad: 'NIU',
            producto_codigo_sunat: null,
            tarifa_precio: 60
        },
        descuento: null,
        pagos: [],
        serie: { serieboleta: 'BE15', seriefactura: 'FE15' }
    });
    const [item] = resumenService.construirDetallesNubefact(resumen);

    assert.equal(resumen.estado, 'LISTO');
    assert.equal(resumen.items[0].unidad, 'NIU');
    assert.equal(item.unidad_snapshot, 'NIU');
});

test('mapea snapshots de fg_operacion_detalle al contrato de items Nubefact', async () => {
    const queryable = {
        async query(sql) {
            if (sql.includes('fg_operacion_comercial')) {
                return { rowCount: 1, rows: [{ id: 50, moneda_key: 'sol', base_imponible: '8.47', igv: '1.53', importe_total: '10.00' }] };
            }
            return {
                rowCount: 1,
                rows: [{
                    producto_facturacion_id: 25,
                    cantidad: '1',
                    precio_unitario: '10.00',
                    valor_unitario: '8.47',
                    base_imponible: '8.47',
                    igv: '1.53',
                    importe_total: '10.00',
                    codigo_sunat_snapshot: '12345678',
                    codigo_sku_snapshot: 'SKU-REAL',
                    descripcion_snapshot: 'PRODUCTO REAL',
                    unidad_snapshot: 'NIU',
                    afectacion_igv_snapshot: '10'
                }]
            };
        }
    };
    const resumen = await resumenService.obtenerResumenTributarioPorOperacion(50, queryable);
    const [item] = resumenService.construirDetallesNubefact(resumen);

    assert.equal(item.producto_facturacion_id, 25);
    assert.equal(item.codigo_sku_snapshot, 'SKU-REAL');
    assert.equal(item.codigo_sunat_snapshot, '12345678');
    assert.equal(item.unidad_snapshot, 'NIU');
    assert.equal(item.afectacion_igv_snapshot, '10');
    assert.equal(item.importe_total, 10);
});

test('rechaza una unidad no admitida y un código SUNAT incompleto', () => {
    const resumen = resumenService._private.construirResumen({
        contexto: contextoBase,
        detalle: {
            ...detalleBase,
            producto_unidad: 'INVALIDA',
            producto_codigo_sunat: '42'
        },
        descuento: null,
        pagos: [],
        serie: { serieboleta: 'BE03', seriefactura: 'FE03' }
    });

    assert.equal(resumen.estado, 'INCOMPLETO');
    assert.ok(resumen.errores.some(error => error.includes('NIU o ZZ')));
    assert.ok(resumen.errores.some(error => error.includes('8 dígitos')));
});
