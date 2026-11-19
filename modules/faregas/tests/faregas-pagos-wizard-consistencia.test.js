'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const pagosService = require('../services/faregas-pagos.service');
const facturacionService = require('../services/faregas-facturacion.service');

const { _private } = pagosService;

const pagoEfectivo = (importe) => ({ tipo: 'efectivo', importe });
const pagoTarjeta = (importe, cambios = {}) => ({
    tipo: 'tarjeta',
    importe,
    tarjetaKey: 'VISA',
    modalidadTarjeta: 'DEBITO',
    nroOperacion: 'OP-77',
    ...cambios
});

test('actualizar condición de facturación usa parámetro booleano tipado y evita reutilizar $2 como texto', () => {
    const valores = _private.construirParametrosCondicionFacturacion(50, {
        condicionPago: 'CREDITO',
        fechaVencimientoCredito: '2026-12-18'
    }, 'operador');

    assert.deepEqual(valores, [50, 'CREDITO', true, '2026-12-18', 'operador']);
    assert.match(_private.ACTUALIZAR_FACTURACION_PAGO_SQL, /medio_pago\s*=\s*CASE WHEN \$3::boolean THEN NULL/);
    assert.equal(/\$2\s*=\s*'CREDITO'/.test(_private.ACTUALIZAR_FACTURACION_PAGO_SQL), false);
});

test('reintentar un pago ya confirmado conserva la fila y no inserta ni borra pagos', async () => {
    const statements = [];
    const client = {
        async query(sql) {
            statements.push(sql);
            if (sql.includes('FROM fg_pago WHERE orden_pago_id')) {
                return { rowCount: 1, rows: [{
                    id: 10, importe: 70, estado: 'CAN', tipocontado_key: 'efectivo',
                    tarjeta_key: null, modalidad_tarjeta: null,
                    nrooperacionbanco: null, nrooperaciontarjeta: null,
                    cuentacorriente_key: null, entidadfinanciera_key: null, fechdeposito: null
                }] };
            }
            return { rowCount: 1, rows: [] };
        }
    };

    await _private.insertarPagosNuevosSinAlterarExistentes(client, 7, [pagoEfectivo(70)], new Map());
    assert.equal(statements.filter(sql => sql.includes('INSERT INTO fg_pago')).length, 0);
    assert.equal(statements.some(sql => /DELETE\s+FROM\s+fg_pago/i.test(sql)), false);
});

test('agregar otro medio conserva el pago previo e inserta sólo la fila nueva', async () => {
    const statements = [];
    const client = {
        async query(sql) {
            statements.push(sql);
            if (sql.includes('FROM fg_pago WHERE orden_pago_id')) {
                return { rowCount: 1, rows: [{
                    id: 11, importe: 70, estado: 'CAN', tipocontado_key: 'efectivo',
                    tarjeta_key: null, modalidad_tarjeta: null,
                    nrooperacionbanco: null, nrooperaciontarjeta: null,
                    cuentacorriente_key: null, entidadfinanciera_key: null, fechdeposito: null
                }] };
            }
            return { rowCount: 1, rows: [] };
        }
    };

    await _private.insertarPagosNuevosSinAlterarExistentes(
        client, 7, [pagoEfectivo(70), pagoTarjeta(20)], new Map()
    );
    const inserts = statements.filter(sql => sql.includes('INSERT INTO fg_pago'));
    assert.equal(inserts.length, 1);
    assert.equal(statements.some(sql => /DELETE\s+FROM\s+fg_pago/i.test(sql)), false);
});

test('intentar cambiar o retirar un pago efectivo guardado se rechaza sin tocar sus filas', async () => {
    const statements = [];
    const client = {
        async query(sql) {
            statements.push(sql);
            if (sql.includes('FROM fg_pago WHERE orden_pago_id')) {
                return { rowCount: 1, rows: [{
                    id: 12, importe: 70, estado: 'CAN', tipocontado_key: 'efectivo',
                    tarjeta_key: null, modalidad_tarjeta: null,
                    nrooperacionbanco: null, nrooperaciontarjeta: null,
                    cuentacorriente_key: null, entidadfinanciera_key: null, fechdeposito: null
                }] };
            }
            return { rowCount: 1, rows: [] };
        }
    };

    await assert.rejects(
        _private.insertarPagosNuevosSinAlterarExistentes(client, 7, [pagoEfectivo(60)], new Map()),
        error => error.message === 'PAGOS_EXISTENTES_NO_MODIFICABLES'
    );
    assert.equal(statements.some(sql => sql.includes('INSERT INTO fg_pago')), false);
    assert.equal(statements.some(sql => /DELETE\s+FROM\s+fg_pago/i.test(sql)), false);
});

test('el backend rechaza descuento reservado al guardar o emitir una factura a CRÉDITO', async () => {
    const consultas = [];
    const queryable = {
        async query(sql, params) {
            consultas.push({ sql, params });
            return { rowCount: 1, rows: [{ '?column?': 1 }] };
        }
    };
    await assert.rejects(
        facturacionService._private.validarCreditoSinDescuentoActivo(queryable, 88),
        error => error.code === 'CREDITO_NO_ADMITE_DESCUENTOS'
    );
    assert.equal(consultas.length, 1);
    assert.match(consultas[0].sql, /estado IN \('RESERVADO', 'APLICADO'\)/);
    assert.deepEqual(consultas[0].params, [88]);
});
