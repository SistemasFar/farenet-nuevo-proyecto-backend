'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const descuentosService = require('../services/faregas-descuentos.service');

const { actualizarOrdenBorradorPorDescuento } = descuentosService._private;
const { validarOrdenPagoEditable } = descuentosService._private;

const crearClient = (pagos = 0) => {
    const statements = [];
    let totalDetalle = 70;
    const client = {
        statements,
        async query(sql, params = []) {
            statements.push({ sql, params });
            if (sql.includes('FROM fg_operacion_detalle') && sql.includes('ORDER BY id FOR UPDATE')) {
                return { rowCount: 1, rows: [{ id: 15 }] };
            }
            if (sql.includes('UPDATE fg_operacion_detalle')) {
                totalDetalle = Number(params[2]);
                return { rowCount: 1, rows: [] };
            }
            if (sql.includes('SELECT COALESCE(SUM(base_imponible)')) {
                const base = Math.round((totalDetalle / 1.18 + Number.EPSILON) * 100) / 100;
                return { rowCount: 1, rows: [{ base: String(base), igv: String(totalDetalle - base), total: String(totalDetalle) }] };
            }
            if (sql.includes('UPDATE fg_operacion_comercial')) return { rowCount: 1, rows: [{ id: 8 }] };
            if (sql.includes('UPDATE fg_orden_pago')) {
                return { rowCount: 1, rows: [{
                    id: 5, importe_total: params[1], baseimponible: params[2], igv: params[3],
                    importe_pagado: params[4], saldo_pendiente: params[5], estado: params[6]
                }] };
            }
            return { rowCount: 1, rows: [] };
        }
    };
    const contexto = {
        certificado: { id: 100 },
        orden: {
            id: 5, operacion_id: 8, importe_total: 70, importe_pagado: pagos,
            saldo_pendiente: 70 - pagos, estado: pagos ? 'PENDIENTE' : 'PENDIENTE'
        },
        pagosEfectivos: pagos
    };
    return { client, contexto };
};

test('actualiza la orden borrador y conserva pagos efectivos dentro del nuevo total', async () => {
    const { client, contexto } = crearClient(50);
    const orden = await actualizarOrdenBorradorPorDescuento(client, contexto, 90, 70, { username: 'prueba' });

    assert.equal(orden.importe_total, 90);
    assert.equal(orden.importe_pagado, 50);
    assert.equal(orden.saldo_pendiente, 40);
    assert.equal(orden.estado, 'PENDIENTE');
    assert.equal(client.statements.some(({ sql }) => /DELETE\s+FROM\s+fg_pago/i.test(sql)), false);
    assert.equal(client.statements.some(({ sql }) => /INSERT\s+INTO\s+fg_pago/i.test(sql)), false);
});

test('rechaza un nuevo importe menor que lo ya pagado y no modifica los pagos', async () => {
    const { client, contexto } = crearClient(70);

    await assert.rejects(
        actualizarOrdenBorradorPorDescuento(client, contexto, 60, 70, { username: 'prueba' }),
        error => error.code === 'DESCUENTO_TOTAL_MENOR_A_PAGOS'
    );
    assert.equal(client.statements.some(({ sql }) => /UPDATE\s+fg_orden_pago/i.test(sql)), false);
    assert.equal(client.statements.some(({ sql }) => /DELETE\s+FROM\s+fg_pago/i.test(sql)), false);
    assert.equal(client.statements.some(({ sql }) => /INSERT\s+INTO\s+fg_pago/i.test(sql)), false);
});

test('reemplazar un descuento reservado libera el anterior y crea una sola reserva activa nueva', async () => {
    const statements = [];
    const client = { async query(sql, params) { statements.push({ sql, params }); return { rowCount: 1, rows: [] }; } };
    await descuentosService._private.guardarReservaDescuento(client, {
        descuentoId: 22, descuentoClienteId: 202, certificado: { id: 100 },
        tarifaOriginal: 90, importeDescuento: 20, importeFinal: 70
    }, { id: 9, estado: 'RESERVADO', descuento_id: 21, descuento_cliente_id: 201 }, { id: 5 }, { username: 'prueba' });

    assert.equal(statements.filter(({ sql }) => sql.includes("SET estado = 'LIBERADO'")).length, 1);
    assert.equal(statements.filter(({ sql }) => sql.includes('INSERT INTO fg_descuentocomprobante')).length, 1);
});

test('permite actualizar órdenes internas pendientes o pagadas dentro de las reglas de pagos', () => {
    assert.doesNotThrow(() => validarOrdenPagoEditable({ estado: 'PENDIENTE' }));
    assert.doesNotThrow(() => validarOrdenPagoEditable({ estado: 'PAGADO' }));
});

test('bloquea una orden anulada para impedir cambios sobre un documento cerrado', () => {
    assert.throws(
        () => validarOrdenPagoEditable({ estado: 'ANULADO' }),
        error => error.code === 'DESCUENTO_OPERACION_NO_EDITABLE'
    );
});
