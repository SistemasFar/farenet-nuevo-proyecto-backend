const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { construirPayloadNubefact } = require('../integrations/nubefact-faregas.adapter');

const redondear = (valor) => Math.round((Number(valor) + Number.EPSILON) * 100) / 100;

const construirCaso = (descuento) => {
    const precioOriginal = 90;
    const total = redondear(precioOriginal - descuento);
    const baseFinal = redondear(total / 1.18);
    const igvFinal = redondear(total - baseFinal);
    const descuentoSinIgv = redondear(descuento / 1.18);

    const facturacion = {
        id: 56000 + Math.round(descuento * 100),
        tipo_comprobante: 'FACTURA',
        serie: 'FFF1',
        numero: 999001,
        tipo_documento_cliente: 'RUC',
        nro_documento: '20111111111',
        nombre_razon_social: 'CLIENTE DE PRUEBA',
        direccion: 'DIRECCION DE PRUEBA',
        fecha_documento: '2026-11-18',
        condicion_pago: 'CONTADO',
        moneda_key: 'PEN',
        importe_total: total,
        base_imponible: baseFinal,
        igv: igvFinal,
        sujeto_detraccion: false
    };
    const detalles = [{
        unidad_snapshot: 'ZZ',
        codigo_sku_snapshot: '0122',
        descripcion_snapshot: 'CERTIFICADO INICIAL DE GLP',
        cantidad: 1,
        valor_unitario: redondear(precioOriginal / 1.18),
        precio_unitario: precioOriginal,
        descuento: descuentoSinIgv,
        base_imponible: baseFinal,
        afectacion_igv_snapshot: '10',
        igv: igvFinal,
        importe_total: total
    }];
    const resumenTributario = {
        servicio: { tipoFlujo: 'CERTIFICADO' },
        descuento: { autorizacionGratuita: false },
        totales: {
            precioAntesDescuento: precioOriginal,
            descuento,
            baseImponible: baseFinal,
            igv: igvFinal,
            total
        }
    };

    return construirPayloadNubefact({ facturacion, detalles, resumenTributario });
};

describe('Payload NubeFact — descuento comercial global', () => {
    it('conserva una venta de S/ 90.00 sin descuento', () => {
        const payload = construirCaso(0);

        assert.equal(payload.descuento_global, 0);
        assert.equal(payload.total_descuento, 0);
        assert.equal(payload.total_gravada, 76.27);
        assert.equal(payload.total_igv, 13.73);
        assert.equal(payload.total, 90);
        assert.equal(payload.items[0].descuento, 0);
        assert.equal(payload.items[0].total, 90);
        assert.equal(payload.observaciones.includes('DESCUENTO COMERCIAL APLICADO'), false);
    });

    it('representa S/ 20.00 como descuento global sin duplicarlo en el ítem', () => {
        const payload = construirCaso(20);

        assert.equal(payload.descuento_global, 16.95);
        assert.equal(payload.total_descuento, 16.95);
        assert.equal(payload.total_gravada, 59.32);
        assert.equal(payload.total_igv, 10.68);
        assert.equal(payload.total, 70);
        assert.equal(payload.items[0].descuento, 0);
        assert.equal(payload.items[0].subtotal, 76.27);
        assert.equal(payload.items[0].igv, 13.73);
        assert.equal(payload.items[0].total, 90);
        assert.equal(JSON.stringify(payload).includes('20.001'), false);
        assert.match(payload.observaciones, /DESCUENTO COMERCIAL APLICADO: S\/ 20\.00 \(INCLUYE IGV\)/);
    });

    it('mantiene totales fiscales para un descuento comercial de S/ 20.50', () => {
        const payload = construirCaso(20.5);

        assert.equal(payload.descuento_global, 17.37);
        assert.equal(payload.total_descuento, 17.37);
        assert.equal(payload.total_gravada, 58.9);
        assert.equal(payload.total_igv, 10.6);
        assert.equal(payload.total, 69.5);
        assert.equal(payload.items[0].descuento, 0);
        assert.equal(payload.items[0].total, 90);
        assert.match(payload.observaciones, /DESCUENTO COMERCIAL APLICADO: S\/ 20\.50 \(INCLUYE IGV\)/);
    });
});
