const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { construirPayloadNubefact } = require('../integrations/nubefact-faregas.adapter');

const redondear = (valor) => Math.round((Number(valor) + Number.EPSILON) * 100) / 100;

const construirCaso = ({
    tipoComprobante = 'FACTURA',
    tipoDocumento = 'RUC',
    nroDocumento = '20111111111',
    precioOriginal = 90,
    descuento = 20,
    detallesCustom = null,
    sujetoSpot = false,
    spotCodigo = null,
    spotTasa = 0,
    cortesia = false
} = {}) => {
    const total = cortesia ? 0 : redondear(precioOriginal - descuento);
    const baseFinal = cortesia ? 0 : redondear(total / 1.18);
    const igvFinal = cortesia ? 0 : redondear(total - baseFinal);
    const descuentoSinIgv = cortesia ? 0 : redondear(descuento / 1.18);

    const facturacion = {
        id: 56000 + Math.round(descuento * 100),
        tipo_comprobante: tipoComprobante,
        serie: tipoComprobante === 'FACTURA' ? 'FFF1' : 'BBB1',
        numero: 999001,
        tipo_documento_cliente: tipoDocumento,
        nro_documento: nroDocumento,
        nombre_razon_social: 'CLIENTE DE PRUEBA',
        direccion: 'DIRECCION DE PRUEBA',
        fecha_documento: '2026-11-18',
        condicion_pago: 'CONTADO',
        moneda_key: 'PEN',
        importe_total: total,
        base_imponible: baseFinal,
        igv: igvFinal,
        sujeto_detraccion: sujetoSpot,
        ...(sujetoSpot ? {
            detraccion_codigo: spotCodigo,
            detraccion_porcentaje: spotTasa,
            detraccion_base: total,
            detraccion_monto: Math.round((total * spotTasa) / 100),
            detraccion_neto: total - Math.round((total * spotTasa) / 100),
            detraccion_estado_deposito: 'PENDIENTE'
        } : {})
    };

    const detalles = detallesCustom || [{
        unidad_snapshot: 'ZZ',
        codigo_sku_snapshot: '0122',
        descripcion_snapshot: 'CERTIFICADO INICIAL DE GLP',
        cantidad: 1,
        valor_unitario: redondear(precioOriginal / 1.18),
        precio_unitario: precioOriginal,
        descuento: descuentoSinIgv,
        base_imponible: baseFinal,
        afectacion_igv_snapshot: cortesia ? '15' : '10',
        igv: igvFinal,
        importe_total: total
    }];

    const resumenTributario = {
        servicio: { tipoFlujo: 'CERTIFICADO' },
        descuento: { autorizaGratuidad: cortesia, modalidadComercial: cortesia ? 'CORTESIA' : 'NORMAL' },
        totales: {
            precioAntesDescuento: precioOriginal,
            descuento: cortesia ? precioOriginal : descuento,
            baseImponible: baseFinal,
            igv: igvFinal,
            total
        }
    };

    return construirPayloadNubefact({ facturacion, detalles, resumenTributario });
};

describe('Payload NubeFact — Restauración de Descuento por Ítem (Estilo FFF1-56)', () => {

    it('1. Factura con descuento de S/ 20: restaura descuento en ítem sin descuento global', () => {
        const payload = construirCaso({
            tipoComprobante: 'FACTURA',
            precioOriginal: 90,
            descuento: 20
        });

        // Verificación de Ítem (FFF1-56)
        assert.equal(payload.items.length, 1);
        const item = payload.items[0];
        assert.equal(item.precio_unitario, 90);
        assert.equal(item.valor_unitario, 76.27);
        assert.equal(item.descuento, 16.95);
        assert.equal(item.subtotal, 59.32);
        assert.equal(item.igv, 10.68);
        assert.equal(item.total, 70);

        // Verificación de Totales y Cabecera
        assert.equal(payload.descuento_global, undefined, 'No debe enviar descuento_global');
        assert.equal(payload.total_descuento, 20, 'total_descuento comercial es 20');
        assert.equal(payload.total_gravada, 59.32);
        assert.equal(payload.total_igv, 10.68);
        assert.equal(payload.total, 70);
    });

    it('2. Boleta con descuento de S/ 20: aplica exactamente igual en boletas electrónicas', () => {
        const payload = construirCaso({
            tipoComprobante: 'BOLETA',
            tipoDocumento: 'DNI',
            nroDocumento: '44556677',
            precioOriginal: 90,
            descuento: 20
        });

        assert.equal(payload.tipo_de_comprobante, 2);
        assert.equal(payload.serie, 'BBB1');
        assert.equal(payload.items[0].precio_unitario, 90);
        assert.equal(payload.items[0].descuento, 16.95);
        assert.equal(payload.items[0].total, 70);
        assert.equal(payload.descuento_global, undefined);
        assert.equal(payload.total_descuento, 20);
        assert.equal(payload.total, 70);
    });

    it('3. Descuento comercial de S/ 15: ítem refleja descuento fiscal y total S/ 75', () => {
        const payload = construirCaso({
            precioOriginal: 90,
            descuento: 15
        });

        const item = payload.items[0];
        assert.equal(item.precio_unitario, 90);
        assert.equal(item.descuento, 12.71); // 15 / 1.18 = 12.71
        assert.equal(item.subtotal, 63.56);
        assert.equal(item.igv, 11.44);
        assert.equal(item.total, 75);

        assert.equal(payload.descuento_global, undefined);
        assert.equal(payload.total_descuento, 15);
        assert.equal(payload.total_gravada, 63.56);
        assert.equal(payload.total_igv, 11.44);
        assert.equal(payload.total, 75);
    });

    it('4. Descuento comercial de S/ 30: ítem refleja descuento fiscal y total S/ 60', () => {
        const payload = construirCaso({
            precioOriginal: 90,
            descuento: 30
        });

        const item = payload.items[0];
        assert.equal(item.precio_unitario, 90);
        assert.equal(item.descuento, 25.42); // 30 / 1.18 = 25.42
        assert.equal(item.subtotal, 50.85);
        assert.equal(item.igv, 9.15);
        assert.equal(item.total, 60);

        assert.equal(payload.descuento_global, undefined);
        assert.equal(payload.total_descuento, 30);
        assert.equal(payload.total_gravada, 50.85);
        assert.equal(payload.total_igv, 9.15);
        assert.equal(payload.total, 60);
    });

    it('5. Comprobante sin descuento: conserva importes completos de S/ 90', () => {
        const payload = construirCaso({
            precioOriginal: 90,
            descuento: 0
        });

        const item = payload.items[0];
        assert.equal(item.precio_unitario, 90);
        assert.equal(item.descuento, 0);
        assert.equal(item.subtotal, 76.27);
        assert.equal(item.igv, 13.73);
        assert.equal(item.total, 90);

        assert.equal(payload.descuento_global, undefined);
        assert.equal(payload.total_descuento, 0);
        assert.equal(payload.total_gravada, 76.27);
        assert.equal(payload.total_igv, 13.73);
        assert.equal(payload.total, 90);
    });

    it('6. Cortesías: mantiene transferencia gratuita formal con tipo_de_igv 6 y total 0', () => {
        const payload = construirCaso({
            precioOriginal: 90,
            descuento: 90,
            cortesia: true
        });

        const item = payload.items[0];
        assert.equal(item.tipo_de_igv, 6, 'Tipo de IGV 6 (Gratuita)');
        assert.equal(item.descuento, 0, 'En gratuidad el descuento en línea es 0');
        assert.equal(item.valor_unitario, 90);
        assert.equal(item.precio_unitario, 90);
        assert.equal(item.subtotal, 90);
        assert.equal(item.igv, 0);
        assert.equal(item.total, 90);

        assert.equal(payload.total_gratuita, 90);
        assert.equal(payload.total_gravada, 0);
        assert.equal(payload.total_igv, 0);
        assert.equal(payload.total, 0);
        assert.equal(payload.total_descuento, 0);
    });

    it('7. Operaciones con detracciones SPOT: conserva SPOT 037 (12%) con descuento', () => {
        const totalConDescuento = 880; // S/ 1000 original - S/ 120 descuento
        const payload = construirCaso({
            precioOriginal: 1000,
            descuento: 120,
            sujetoSpot: true,
            spotCodigo: '037',
            spotTasa: 12
        });

        assert.equal(payload.detraccion, true);
        assert.equal(payload.sunat_transaction, 30); // 30 = Operación sujeta a detracción
        assert.equal(payload.detraccion_tipo, 35); // Catálogo 54 SUNAT para 037 Demás servicios
        assert.equal(payload.detraccion_porcentaje, 12);
        assert.equal(payload.detraccion_total, 106); // Math.round(880 * 0.12) = 105.6 -> 106
        assert.equal(payload.total, 880);
        assert.equal(payload.total_descuento, 120);
        assert.equal(payload.descuento_global, undefined);
    });

    it('8. Facturas con varios productos: aplica descuento solo al ítem correspondiente sin duplicar', () => {
        const detallesVarios = [
            {
                unidad_snapshot: 'ZZ',
                codigo_sku_snapshot: '0122',
                descripcion_snapshot: 'CERTIFICADO INICIAL GLP',
                cantidad: 1,
                valor_unitario: 76.27,
                precio_unitario: 90,
                descuento: 16.95, // S/ 20 descuento comercial
                base_imponible: 59.32,
                afectacion_igv_snapshot: '10',
                igv: 10.68,
                importe_total: 70
            },
            {
                unidad_snapshot: 'NIU',
                codigo_sku_snapshot: '0999',
                descripcion_snapshot: 'CHIP ADICIONAL',
                cantidad: 1,
                valor_unitario: 42.37,
                precio_unitario: 50,
                descuento: 0, // Sin descuento
                base_imponible: 42.37,
                afectacion_igv_snapshot: '10',
                igv: 7.63,
                importe_total: 50
            }
        ];

        const payload = construirCaso({
            precioOriginal: 140,
            descuento: 20,
            detallesCustom: detallesVarios
        });

        assert.equal(payload.items.length, 2);
        // Ítem 1 con descuento
        assert.equal(payload.items[0].precio_unitario, 90);
        assert.equal(payload.items[0].descuento, 16.95);
        assert.equal(payload.items[0].total, 70);

        // Ítem 2 sin descuento
        assert.equal(payload.items[1].precio_unitario, 50);
        assert.equal(payload.items[1].descuento, 0);
        assert.equal(payload.items[1].total, 50);

        // Totales consolidados sin duplicidad
        assert.equal(payload.descuento_global, undefined);
        assert.equal(payload.total_descuento, 20);
        assert.equal(payload.total, 120); // S/ 70 + S/ 50 = S/ 120
    });
});
