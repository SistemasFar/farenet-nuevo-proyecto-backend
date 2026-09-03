const test = require('node:test');
const assert = require('node:assert/strict');
const service = require('../services/faregas-nubefact-readiness.service');
const db = require('../../../config/database');

test.after(() => db.end());

const resumen = {
    cliente: { numeroDocumento: '12345678', nombreRazonSocial: 'CLIENTE' },
    emisor: { ruc: '20600444531', razonSocial: 'EMPRESA' },
    comprobante: { serie: 'BE02' },
    items: [{ productoFacturacionId: 10 }],
    totales: { baseImponible: 67.8, igv: 12.2, total: 80 },
    errores: [],
    advertencias: []
};

test('presenta bloqueos separados sin intentar emitir', () => {
    const result = service._private.construirChecksCertificado({
        resumen: { ...resumen, items: [{ productoFacturacionId: null }] },
        integracion: { configured: false }
    });
    assert.equal(result.estado, 'BLOQUEADO');
    assert.ok(result.checks.some(item => item.codigo === 'CATALOGO_FISCAL' && item.estado === 'BLOQUEO'));
    assert.ok(result.checks.some(item => item.codigo === 'CREDENCIALES' && item.estado === 'BLOQUEO'));
});

test('no confunde una advertencia tributaria con un bloqueo', () => {
    const result = service._private.construirChecksCertificado({
        resumen: { ...resumen, advertencias: ['No se registró correo.'] },
        integracion: { configured: true }
    });
    assert.ok(result.checks.some(item => item.estado === 'ADVERTENCIA'));
});

test('no duplica el bloqueo de catálogo cuando el resumen usa otra redacción', () => {
    const result = service._private.construirChecksCertificado({
        resumen: {
            ...resumen,
            items: [{ productoFacturacionId: null }],
            errores: ['La tarifa seleccionada no tiene un producto de facturación vinculado.']
        },
        integracion: { configured: true }
    });
    assert.equal(result.checks.filter(item => item.codigo === 'CATALOGO_FISCAL').length, 1);
    assert.equal(result.checks.filter(item => /producto (fiscal|de facturación)/i.test(item.mensaje)).length, 1);
});
