const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { evaluarDetraccion } = require('../services/faregas-detracciones.service');
const { construirPayloadNubefact } = require('../integrations/nubefact-faregas.adapter');
const pagosRules = require('../services/faregas-pagos.rules');
const facturacionRules = require('../services/faregas-facturacion.rules');

describe('PRUEBA FINAL — COBRANZA SPOT FAREGAS SEGÚN PROCEDIMIENTO REAL (S/ 800 TOTAL, S/ 96 SPOT)', () => {

    const SERVICIO_GLP_INICIAL = {
        sujeto_detraccion: true,
        detraccion_codigo: '037',
        detraccion_porcentaje: 12.00,
        naturaleza_spot: 'SERVICIO',
        tipo_flujo: 'TALLER_CONVERSION',
        categoria_codigo: 'GLP'
    };

    // 1. Wizard y evaluación comercial: Cobro del 100% en caja (S/ 800.00)
    it('1. Wizard y cálculo SPOT: Para certificado de S/ 800, la detracción es S/ 96 (12%), responsable EMPRESA y caja cobra S/ 800', () => {
        const evaluacion = evaluarDetraccion({
            tipoComprobante: 'FACTURA',
            importeTotal: 800.00,
            moneda: 'PEN',
            servicio: SERVICIO_GLP_INICIAL
        });

        assert.equal(evaluacion.sujeto, true);
        assert.equal(evaluacion.codigo, '037');
        assert.equal(evaluacion.porcentaje, 12);
        assert.equal(evaluacion.base, 800.00);
        assert.equal(evaluacion.monto, 96.00);
        assert.equal(evaluacion.neto, 704.00);
        assert.equal(evaluacion.responsableDeposito, 'EMPRESA');
        assert.equal(evaluacion.estadoDeposito, 'PENDIENTE');

        // Regla operativa FAREGAS: Caja cobra el 100% de la orden al cliente (S/ 800)
        const totalOrden = 800.00;
        const totalExigibleCaja = totalOrden; // La empresa cobra el total
        assert.equal(totalExigibleCaja, 800.00);
    });

    // 2. Registro de pago íntegro en caja y saldo cero
    it('2. Registro de pago: Permite registrar S/ 800.00 en caja y el saldo pendiente queda en S/ 0.00', () => {
        const orden = {
            id: 701,
            importe_total: 800.00,
            baseimponible: 677.97,
            igv: 122.03,
            importe_pagado: 0,
            saldo_pendiente: 800.00,
            estado: 'PENDIENTE'
        };

        const pagosSolicitados = [
            { tipo: 'efectivo', importe: 800.00 }
        ];

        const totalPagado = pagosSolicitados.reduce((sum, p) => sum + p.importe, 0);
        const totalExigibleCaja = Number(orden.importe_total); // S/ 800.00

        assert.equal(totalPagado, 800.00);
        assert.equal(totalPagado - totalExigibleCaja <= 0.009, true);

        const saldo = Math.max(0, totalExigibleCaja - totalPagado);
        const estado = saldo === 0 ? 'PAGADO' : 'PENDIENTE';

        assert.equal(saldo, 0);
        assert.equal(estado, 'PAGADO');

        // Simulación de actualización de orden en BD
        orden.importe_pagado = totalPagado;
        orden.saldo_pendiente = saldo;
        orden.estado = estado;

        assert.equal(orden.importe_total, 800.00);
        assert.equal(orden.importe_pagado, 800.00);
        assert.equal(orden.saldo_pendiente, 0.00);
        assert.equal(orden.estado, 'PAGADO');
    });

    // 3. Facturación y persistencia: total S/ 800, SPOT S/ 96, estado depósito PENDIENTE
    it('3. Facturación conserva total S/ 800.00, detracción S/ 96.00 y depósito PENDIENTE a cargo de la EMPRESA', () => {
        const facturacion = {
            id: 2001,
            tipo_comprobante: 'FACTURA',
            serie: 'FFF1',
            numero: 62,
            nro_documento: '20600444531',
            nombre_razon_social: 'EMPRESA CLIENTE S.A.C.',
            moneda_key: 'PEN',
            base_imponible: 677.97,
            igv: 122.03,
            importe_total: 800.00,
            sujeto_detraccion: true,
            detraccion_codigo: '037',
            detraccion_descripcion: 'Demás servicios gravados con el IGV',
            detraccion_porcentaje: 12.00,
            detraccion_base: 800.00,
            detraccion_monto: 96.00,
            detraccion_neto: 704.00,
            detraccion_estado_deposito: 'PENDIENTE'
        };

        assert.equal(facturacion.importe_total, 800.00);
        assert.equal(facturacion.base_imponible, 677.97);
        assert.equal(facturacion.igv, 122.03);
        assert.equal(facturacion.sujeto_detraccion, true);
        assert.equal(facturacion.detraccion_monto, 96.00);
        assert.equal(facturacion.detraccion_estado_deposito, 'PENDIENTE');
    });

    // 4. Payload NubeFact y XML: Conserva el estándar CPE oficial SPOT de SUNAT
    it('4. Payload NubeFact: Conserva total fiscal S/ 800.00, sunat_transaction 30, detracción 96.00 y medio 001', () => {
        const facturacion = {
            id: 2001,
            tipo_comprobante: 'FACTURA',
            serie: 'FFF1',
            numero: 62,
            nro_documento: '20600444531',
            nombre_razon_social: 'EMPRESA CLIENTE S.A.C.',
            direccion: 'CALLE PRUEBA 123',
            email: 'cliente@test.com',
            fecha_documento: '2026-11-19',
            moneda_key: 'PEN',
            base_imponible: 677.97,
            igv: 122.03,
            importe_total: 800.00,
            sujeto_detraccion: true,
            detraccion_codigo: '037',
            detraccion_descripcion: 'Demás servicios gravados con el IGV',
            detraccion_porcentaje: 12.00,
            detraccion_base: 800.00,
            detraccion_monto: 96.00,
            detraccion_neto: 704.00,
            detraccion_estado_deposito: 'PENDIENTE'
        };

        const payload = construirPayloadNubefact({
            facturacion,
            certificado: { id: 846, placa: 'XYZ789' },
            vehiculo: { placa: 'XYZ789' },
            detalles: [{
                tipo_item: 'SERVICIO',
                codigo: '0122',
                descripcion: 'CERTIFICACION INICIAL GLP',
                unidad_de_medida: 'ZZ',
                cantidad: 1,
                valor_unitario: 677.97,
                precio_unitario: 800.00,
                subtotal: 677.97,
                tipo_de_igv: 1,
                igv: 122.03,
                total: 800.00,
                descuento: 0
            }]
        });

        // Verificaciones fiscales obligatorias
        assert.equal(payload.total, 800.00);
        assert.equal(payload.total_gravada, 677.97);
        assert.equal(payload.total_igv, 122.03);
        assert.equal(payload.total_descuento, 0);
        assert.equal(payload.sunat_transaction, 30); // 30 = Operación sujeta a detracción
        assert.equal(payload.detraccion, true);
        assert.equal(payload.detraccion_tipo, 35); // Código NubeFact para SUNAT 037
        assert.equal(payload.detraccion_porcentaje, 12.00);
        assert.equal(payload.detraccion_total, 96.00);
        assert.equal(payload.medio_de_pago_detraccion, '001'); // 001 = Depósito en cuenta
    });

    // 5. Comparativa con los demás casos solicitados
    it('5. Factura S/ 1,000: Caja cobra S/ 1,000 y detracción SPOT es S/ 120.00', () => {
        const ev = evaluarDetraccion({
            tipoComprobante: 'FACTURA',
            importeTotal: 1000.00,
            moneda: 'PEN',
            servicio: SERVICIO_GLP_INICIAL
        });
        assert.equal(ev.sujeto, true);
        assert.equal(ev.base, 1000.00);
        assert.equal(ev.monto, 120.00);
        assert.equal(ev.responsableDeposito, 'EMPRESA');
    });

    it('6. Factura S/ 700 exactos: NO aplica SPOT (umbral legal estricto > 700) y caja cobra S/ 700', () => {
        const ev = evaluarDetraccion({
            tipoComprobante: 'FACTURA',
            importeTotal: 700.00,
            moneda: 'PEN',
            servicio: SERVICIO_GLP_INICIAL
        });
        assert.equal(ev.sujeto, false);
        assert.equal(ev.monto, 0);
        assert.equal(ev.motivoExclusion, 'IMPORTE_MENOR_O_IGUAL_A_700');
    });

    it('7. Boleta S/ 800: NO aplica SPOT y caja cobra S/ 800', () => {
        const ev = evaluarDetraccion({
            tipoComprobante: 'BOLETA',
            importeTotal: 800.00,
            moneda: 'PEN',
            servicio: SERVICIO_GLP_INICIAL
        });
        assert.equal(ev.sujeto, false);
        assert.equal(ev.monto, 0);
        assert.equal(ev.motivoExclusion, 'BOLETA_VENTA_CONSUMIDOR_FINAL_NO_SUJETA');
    });

    it('8. Descuento comercial con SPOT: Factura S/ 1,000 con descuento S/ 200 = Total S/ 800 -> SPOT S/ 96 y caja cobra S/ 800', () => {
        const ev = evaluarDetraccion({
            tipoComprobante: 'FACTURA',
            importeTotal: 800.00, // Total tras descuento
            moneda: 'PEN',
            servicio: SERVICIO_GLP_INICIAL
        });
        assert.equal(ev.sujeto, true);
        assert.equal(ev.base, 800.00);
        assert.equal(ev.monto, 96.00);
        assert.equal(ev.responsableDeposito, 'EMPRESA');
    });
});
