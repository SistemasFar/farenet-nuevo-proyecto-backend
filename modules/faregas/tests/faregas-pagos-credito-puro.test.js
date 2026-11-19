'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { validarCreditoSinPagos } = require('../services/faregas-pagos.rules');

describe('Pago puro al crédito FAREGAS', () => {
    const credito = { condicionPago: 'CREDITO' };
    const contado = { condicionPago: 'CONTADO' };

    it('acepta crédito sin pagos y sin cobros previamente persistidos', () => {
        assert.doesNotThrow(() => validarCreditoSinPagos(credito, [], 0));
    });

    it('rechaza pagos enviados como pago inicial', () => {
        assert.throws(
            () => validarCreditoSinPagos(credito, [{ importe: 10 }], 0),
            error => error.message === 'CREDITO_NO_ADMITE_PAGOS'
        );
    });

    it('rechaza el cambio a crédito si ya hay filas de pagos y las conserva', () => {
        assert.throws(
            () => validarCreditoSinPagos(credito, [], 1),
            error => error.message === 'CREDITO_CON_PAGOS_EXISTENTES'
        );
    });

    it('no cambia las validaciones existentes de contado', () => {
        assert.doesNotThrow(() => validarCreditoSinPagos(contado, [{ importe: 90 }], 1));
        assert.doesNotThrow(() => validarCreditoSinPagos(contado, [], 0));
    });
});
