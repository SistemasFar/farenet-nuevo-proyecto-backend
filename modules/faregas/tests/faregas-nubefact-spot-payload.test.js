const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { construirPayloadNubefact } = require('../integrations/nubefact-faregas.adapter');

// Fixture técnica independiente: configuración SPOT explícita para probar el
// mapeo del payload; no representa ni clasifica la factura ITV de referencia.
const facturaPruebaSpot = {
    id: 987654,
    tipo_comprobante: 'FACTURA',
    serie: 'FFF1',
    numero: 987654,
    tipo_documento_cliente: 'RUC',
    nro_documento: '20111111111',
    nombre_razon_social: 'CLIENTE DE PRUEBA',
    direccion: 'DIRECCION DE PRUEBA',
    fecha_documento: '2026-11-16',
    condicion_pago: 'CREDITO',
    importe_total: 1170,
    base_imponible: 991.53,
    igv: 178.47,
    sujeto_detraccion: true,
    detraccion_codigo: '037',
    detraccion_descripcion: 'Demás servicios gravados con el IGV',
    detraccion_porcentaje: 12,
    detraccion_base: 1170,
    detraccion_monto: 140,
    detraccion_neto: 1030,
    detraccion_estado_deposito: 'PENDIENTE'
};

describe('Payload NubeFact SPOT — simulación aislada', () => {
    it('conserva total fiscal, descuento, detracción redondeada y cuotas de una factura a crédito', () => {
        const payload = construirPayloadNubefact({
            facturacion: facturaPruebaSpot,
            reservaDescuento: { importe_original: 2340, importe_descuento: 1170, importe_final: 1170 },
            cuotas: [{ numero_cuota: 1, fecha_pago: '2026-12-12', importe: 1030 }]
        });

        assert.equal(payload.total, 1170);
        assert.equal(payload.total_descuento, 1170);
        assert.equal(payload.total_gravada, 991.53);
        assert.equal(payload.total_igv, 178.47);
        assert.equal(payload.sunat_transaction, 30);
        assert.equal(payload.detraccion, true);
        assert.equal(payload.detraccion_tipo, 35);
        assert.equal(payload.detraccion_porcentaje, 12);
        assert.equal(payload.detraccion_total, 140);
        assert.equal(payload.condiciones_de_pago, 'CREDITO');
        assert.equal(payload.venta_al_credito[0].importe, 1030);
    });

    it('bloquea la emisión si falta el código en una clasificación SPOT persistida', () => {
        assert.throws(
            () => construirPayloadNubefact({ facturacion: { ...facturaPruebaSpot, detraccion_codigo: null } }),
            (error) => error.code === 'CLASIFICACION_SPOT_NO_VERIFICADA'
        );
    });

    it('bloquea tasa y monto que no coinciden con el código y la regla de redondeo', () => {
        for (const invalid of [
            { detraccion_porcentaje: 10 },
            { detraccion_monto: 140.4, detraccion_neto: 1029.6 }
        ]) {
            assert.throws(
                () => construirPayloadNubefact({ facturacion: { ...facturaPruebaSpot, ...invalid } }),
                (error) => error.code === 'CLASIFICACION_SPOT_NO_VERIFICADA'
            );
        }
    });

    it('no envía código ni tasa cuando el comprobante está marcado expresamente como no sujeto', () => {
        const payload = construirPayloadNubefact({
            facturacion: { ...facturaPruebaSpot, sujeto_detraccion: false, detraccion_codigo: null,
                detraccion_porcentaje: null, detraccion_base: 1170, detraccion_monto: 0, detraccion_neto: 1170 }
        });
        assert.equal(payload.total, 1170);
        assert.equal(payload.sunat_transaction, 1);
        assert.equal(payload.detraccion, false);
        assert.equal('detraccion_tipo' in payload, false);
        assert.equal('detraccion_porcentaje' in payload, false);
        assert.equal('detraccion_total' in payload, false);
    });
});
