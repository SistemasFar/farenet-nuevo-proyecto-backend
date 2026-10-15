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
        modalidadTarjeta: 'DEBITO',
        nroOperacion: 'OP-123',
        importe: 50
    }));
});

test('tarjeta física exige modalidad débito o crédito', async () => {
    const client = {
        query: async () => ({ rowCount: 1, rows: [{ nombre: 'VISA' }] })
    };

    await assert.rejects(() => pagosService._private.validarReferenciaPago(client, {
        tipo: 'tarjeta', tarjetaKey: 'visa', nroOperacion: 'OP-123', importe: 50
    }), /MODALIDAD_TARJETA_REQUERIDA/);
});

test('boleta a crédito es rechazada por la regla de negocio', () => {
    const normalizada = facturacionRules.normalizarFacturacion({
        tipoComprobante: 'BOLETA', tipoDocumentoCliente: 'DNI', nroDocumento: '74045612',
        nombreRazonSocial: 'CLIENTE', direccion: 'LIMA', condicionPago: 'CREDITO',
        fechaInicioCredito: '2026-10-14', fechaVencimiento: '2026-11-14',
        cuotas: [{ numeroCuota: 1, fechaPago: '2026-11-14', importe: 50 }]
    });
    assert.ok(facturacionRules.validarFacturacion(normalizada)
        .some((error) => error.includes('BOLETA solo puede emitirse')));
});

test('migración conserva marca y agrega modalidad nullable al pago', () => {
    const sql = fs.readFileSync(path.join(
        __dirname,
        '../database/migrations/20261015_faregas_pago_modalidad_tarjeta.sql'
    ), 'utf8');
    assert.match(sql, /ADD COLUMN IF NOT EXISTS modalidad_tarjeta/i);
    assert.match(sql, /modalidad_tarjeta IS NULL/i);
    assert.match(sql, /DEBITO.*CREDITO/i);
    assert.doesNotMatch(sql, /DROP\s+COLUMN/i);
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

test('decisión de facturar al dueño se normaliza sólo desde un booleano explícito', () => {
    assert.equal(facturacionRules.normalizarFacturacion({
        facturarAlDuenoPrincipal: true
    }).facturarAlDuenoPrincipal, true);
    assert.equal(facturacionRules.normalizarFacturacion({
        nroDocumento: '74045612', nombreRazonSocial: 'MISMO TITULAR'
    }).facturarAlDuenoPrincipal, false);
});

test('las cuotas de crédito deben permanecer dentro del período', () => {
    const base = {
        tipoComprobante: 'FACTURA', tipoDocumentoCliente: 'RUC', nroDocumento: '20600444531',
        nombreRazonSocial: 'FAREGAS S.A.C.', direccion: 'LIMA', condicionPago: 'CREDITO',
        fechaInicioCredito: '2026-10-15', fechaVencimiento: '2026-11-07'
    };
    assert.ok(facturacionRules.validarFacturacion(facturacionRules.normalizarFacturacion({
        ...base, cuotas: [{ numeroCuota: 1, fechaPago: '2026-10-14', importe: 90 }]
    })).some((error) => error.includes('posterior al inicio')));
    assert.ok(facturacionRules.validarFacturacion(facturacionRules.normalizarFacturacion({
        ...base, cuotas: [{ numeroCuota: 1, fechaPago: '2026-11-08', importe: 90 }]
    })).some((error) => error.includes('superar el vencimiento')));
});

test('migración persiste la decisión explícita del dueño sin inferir históricos', () => {
    const sql = fs.readFileSync(path.join(
        __dirname,
        '../database/migrations/20261015_faregas_facturacion_dueno_principal.sql'
    ), 'utf8');
    assert.match(sql, /ADD COLUMN IF NOT EXISTS facturar_al_dueno_principal boolean/i);
    assert.doesNotMatch(sql, /DEFAULT\s+TRUE/i);
});
