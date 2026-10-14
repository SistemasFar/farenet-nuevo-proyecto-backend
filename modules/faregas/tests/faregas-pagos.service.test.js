const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const databasePath = require.resolve('../../../config/database');
require.cache[databasePath] = {
    id: databasePath,
    filename: databasePath,
    loaded: true,
    exports: {}
};

const pagosService = require('../services/faregas-pagos.service');
const facturacionRules = require('../services/faregas-facturacion.rules');

test('tarjeta nueva no requiere ni valida últimos cuatro dígitos', async () => {
    const client = {
        query: async () => ({ rowCount: 1, rows: [{ nombre: 'VISA' }] })
    };

    await assert.doesNotReject(() => pagosService._private.validarReferenciaPago(client, {
        tipo: 'tarjeta',
        tarjetaKey: 'visa',
        nroOperacion: 'OP-123',
        importe: 50
    }));
});

test('período de crédito exige ambas fechas y orden cronológico', () => {
    assert.deepEqual(pagosService._private.normalizarPeriodoCredito({ condicionPago: 'CONTADO' }), {
        condicionPago: 'CONTADO', fechaInicioCredito: null, fechaVencimientoCredito: null
    });
    assert.deepEqual(pagosService._private.normalizarPeriodoCredito({
        condicionPago: 'CREDITO',
        fechaInicioCredito: '2026-10-14',
        fechaVencimientoCredito: '2026-11-14'
    }), {
        condicionPago: 'CREDITO',
        fechaInicioCredito: '2026-10-14',
        fechaVencimientoCredito: '2026-11-14'
    });
    assert.throws(() => pagosService._private.normalizarPeriodoCredito({
        condicionPago: 'CREDITO',
        fechaInicioCredito: '2026-10-14',
        fechaVencimientoCredito: '2026-10-13'
    }), /PERIODO_CREDITO_INVALIDO/);
});

test('facturación valida el mismo período sin cambiar la lógica de cuotas', () => {
    const normalizada = facturacionRules.normalizarFacturacion({
        tipoComprobante: 'BOLETA', tipoDocumentoCliente: 'DNI', nroDocumento: '74045612',
        nombreRazonSocial: 'CLIENTE', direccion: 'LIMA', condicionPago: 'CREDITO',
        fechaInicioCredito: '2026-10-14', fechaVencimiento: '2026-10-13',
        cuotas: [{ numeroCuota: 1, fechaPago: '2026-10-20', importe: 50 }]
    });
    assert.ok(facturacionRules.validarFacturacion(normalizada)
        .some((error) => error.includes('no puede ser anterior')));
});

test('migración agrega período a la orden sin eliminar el histórico de tarjeta', () => {
    const sql = fs.readFileSync(path.join(
        __dirname,
        '../database/migrations/20261014_faregas_periodo_credito_orden.sql'
    ), 'utf8');
    assert.match(sql, /fecha_inicio_credito date/i);
    assert.match(sql, /fecha_vencimiento_credito date/i);
    assert.doesNotMatch(sql, /DROP\s+COLUMN/i);

    const service = fs.readFileSync(path.join(__dirname, '../services/faregas-pagos.service.js'), 'utf8');
    assert.match(service, /obtenerDigitosHistoricos/);
    assert.match(service, /tomarDigitosHistoricos/);
});
