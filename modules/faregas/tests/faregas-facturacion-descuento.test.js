const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../../../config/database');
const resumenTributarioService = require('../services/faregas-resumen-tributario.service');
const readinessService = require('../services/faregas-nubefact-readiness.service');
const nubefactAdapter = require('../integrations/nubefact-faregas.adapter');

const redondear = (valor) => Math.round((Number(valor) + Number.EPSILON) * 100) / 100;

const construirEscenario = (porcentaje, precioOriginal = 80) => {
    const importeDescuento = redondear(precioOriginal * porcentaje / 100);
    const total = redondear(precioOriginal - importeDescuento);
    const baseImponible = redondear(total / 1.18);
    const igv = redondear(total - baseImponible);
    const resumen = resumenTributarioService._private.construirResumen({
        contexto: {
            facturacion_id: 1,
            planta_key: '201',
            sede_nombre: 'INDEPENDENCIA',
            empresa_key: 'FAREGAS',
            razon_social_emisor: 'FAREGAS S.A.C.',
            ruc_emisor: '20521536463',
            entorno_facturador: 'DEMO',
            tipo_comprobante: 'BOLETA',
            tipo_documento_cliente: 'DNI',
            nro_documento: '00000000',
            nombre_razon_social: 'CLIENTE PRUEBA',
            moneda_key: 'SOL',
            base_imponible: baseImponible,
            igv,
            importe_total: total,
            condicion_pago: 'CONTADO',
            medio_pago: porcentaje === 100 ? null : 'EFECTIVO'
        },
        detalles: [{
            tipo_item: 'SERVICIO',
            cantidad: 1,
            orden: 1,
            producto_facturacion_id: 10,
            producto_activo: true,
            producto_sku: 'CERT-GLP-INICIAL',
            producto_descripcion: 'CERTIFICADO INICIAL DE GLP',
            producto_unidad: 'NIU',
            producto_afectacion_igv: '10',
            tarifa_precio: total,
            detalle_base_imponible: baseImponible,
            detalle_igv: igv,
            detalle_importe_total: total
        }],
        descuento: porcentaje > 0 ? {
            importe_original: precioOriginal,
            importe_descuento: importeDescuento,
            importe_final: total
        } : null,
        pagos: [],
        serie: { serieboleta: 'BBB1', fuente: 'FG_SERIE_COMPROBANTE' }
    });
    const payload = nubefactAdapter.construirPayloadNubefact({
        facturacion: {
            id: 1,
            tipo_comprobante: 'BOLETA',
            tipo_documento_cliente: 'DNI',
            nro_documento: '00000000',
            nombre_razon_social: 'CLIENTE PRUEBA',
            serie: 'BBB1',
            numero: 1,
            base_imponible: baseImponible,
            igv,
            importe_total: total
        },
        detalles: resumenTributarioService.construirDetallesNubefact(resumen),
        resumenTributario: resumen
    });
    const calculos = readinessService._private
        .construirChecksCertificado({ resumen, integracion: { configured: true } })
        .checks.find(item => item.codigo === 'CALCULOS');

    return { precioOriginal, importeDescuento, total, baseImponible, igv, resumen, payload, calculos };
};

for (const porcentaje of [0, 10, 50, 100]) {
    test(`precio 80 con descuento ${porcentaje}% conserva totales tributarios coherentes`, () => {
        const resultado = construirEscenario(porcentaje);
        const item = resultado.payload.items[0];
        const baseOriginal = redondear(resultado.precioOriginal / 1.18);
        const descuentoSinIgv = redondear(resultado.importeDescuento / 1.18);

        assert.equal(resultado.resumen.estado, 'LISTO', resultado.resumen.errores.join('; '));
        assert.equal(resultado.calculos.estado, 'OK');
        assert.equal(item.precio_unitario, resultado.precioOriginal);
        if (porcentaje === 100) {
            assert.equal(item.valor_unitario, resultado.precioOriginal);
            assert.equal(item.descuento, 0);
            assert.equal(item.subtotal, resultado.precioOriginal);
            assert.equal(item.tipo_de_igv, 6);
            assert.equal(item.igv, 0);
            assert.equal(item.total, resultado.precioOriginal);
            assert.equal(resultado.payload.total_descuento, 0);
            assert.equal(resultado.payload.total_gratuita, resultado.precioOriginal);
        } else {
            assert.equal(item.valor_unitario, baseOriginal);
            assert.equal(item.descuento, descuentoSinIgv);
            assert.equal(item.subtotal, resultado.baseImponible);
            assert.equal(item.tipo_de_igv, 1);
            assert.equal(item.igv, resultado.igv);
            assert.equal(item.total, resultado.total);
            assert.equal(resultado.payload.total_descuento, resultado.importeDescuento);
            assert.equal(resultado.payload.total_gratuita, 0);
        }
        assert.equal(resultado.payload.total_gravada, resultado.baseImponible);
        assert.equal(resultado.payload.total_igv, resultado.igv);
        assert.equal(resultado.payload.total, resultado.total);
    });
}

test('un total cero sin descuento continúa siendo inválido', () => {
    const resultado = construirEscenario(0, 0);
    assert.equal(resultado.resumen.estado, 'INCOMPLETO');
    assert.match(resultado.resumen.errores.join('\n'), /El total de la operación no es válido/);
    assert.equal(resultado.calculos.estado, 'BLOQUEO');
});

test('certificado y chip sin descuento conservan sus dos líneas y totales', () => {
    const resumen = resumenTributarioService._private.construirResumen({
        contexto: {
            facturacion_id: 2,
            planta_key: '201',
            sede_nombre: 'INDEPENDENCIA',
            empresa_key: 'FAREGAS',
            razon_social_emisor: 'FAREGAS S.A.C.',
            ruc_emisor: '20521536463',
            entorno_facturador: 'DEMO',
            tipo_comprobante: 'BOLETA',
            tipo_documento_cliente: 'DNI',
            nro_documento: '00000000',
            nombre_razon_social: 'CLIENTE PRUEBA',
            moneda_key: 'SOL',
            base_imponible: 313.56,
            igv: 56.44,
            importe_total: 370,
            condicion_pago: 'CONTADO',
            medio_pago: 'EFECTIVO'
        },
        detalles: [
            {
                tipo_item: 'SERVICIO', cantidad: 1, orden: 1,
                producto_facturacion_id: 10, producto_activo: true,
                producto_sku: 'CERT', producto_descripcion: 'CERTIFICADO',
                producto_unidad: 'NIU', producto_afectacion_igv: '10',
                tarifa_precio: 190, detalle_base_imponible: 161.02,
                detalle_igv: 28.98, detalle_importe_total: 190
            },
            {
                tipo_item: 'PRODUCTO', cantidad: 1, orden: 2,
                producto_facturacion_id: 20, producto_activo: true,
                producto_sku: 'CHIP', producto_descripcion: 'CHIP Y PORTA CHIP',
                producto_unidad: 'NIU', producto_afectacion_igv: '10',
                tarifa_precio: 180, detalle_base_imponible: 152.54,
                detalle_igv: 27.46, detalle_importe_total: 180
            }
        ],
        descuento: null,
        pagos: [],
        serie: { serieboleta: 'BBB1' }
    });

    assert.equal(resumen.estado, 'LISTO', resumen.errores.join('; '));
    assert.equal(resumen.items.length, 2);
    assert.deepEqual(resumen.items.map(item => item.total), [190, 180]);
    assert.equal(resumen.totales.descuento, 0);
    assert.equal(resumen.totales.baseImponible, 313.56);
    assert.equal(resumen.totales.igv, 56.44);
    assert.equal(resumen.totales.total, 370);

    const payload = nubefactAdapter.construirPayloadNubefact({
        facturacion: {
            id: 2,
            tipo_comprobante: 'BOLETA',
            tipo_documento_cliente: 'DNI',
            nro_documento: '00000000',
            nombre_razon_social: 'CLIENTE PRUEBA',
            serie: 'BBB1',
            numero: 2,
            base_imponible: 313.56,
            igv: 56.44,
            importe_total: 370
        },
        detalles: resumenTributarioService.construirDetallesNubefact(resumen),
        resumenTributario: resumen
    });
    assert.equal(payload.total_descuento, 0);
    assert.equal(payload.total_gratuita, 0);
    assert.deepEqual(payload.items.map(item => item.tipo_de_igv), [1, 1]);
    assert.deepEqual(payload.items.map(item => item.total), [190, 180]);
});

test.after(() => db.end());
