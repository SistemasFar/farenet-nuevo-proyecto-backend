const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const db = require('../../../config/database');
const dashboard = require('../services/faregas-dashboard.service');

test.after(async () => {
    await db.end();
});

test('filtro de duplicados acepta categorías del dashboard y normaliza TODOS', () => {
    const { normalizarTipoDuplicado } = dashboard._private;

    assert.equal(normalizarTipoDuplicado(), null);
    assert.equal(normalizarTipoDuplicado('TODOS'), null);
    assert.equal(normalizarTipoDuplicado(' glp '), 'GLP');
    assert.equal(normalizarTipoDuplicado('gnv'), 'GNV');
    assert.equal(normalizarTipoDuplicado('conformidad'), 'CONFORMIDAD');
    assert.equal(normalizarTipoDuplicado('complementarios'), 'COMPLEMENTARIOS');
    assert.throws(
        () => normalizarTipoDuplicado('NO_EXISTE'),
        error => error.codigo === 'TIPO_DUPLICADO_INVALIDO' && error.status === 400
    );
});

test('tipo general y tipo específico se combinan sólo cuando son compatibles', () => {
    const { resolverTipoDuplicado } = dashboard._private;

    assert.equal(resolverTipoDuplicado('GLP', undefined), 'GLP');
    assert.equal(resolverTipoDuplicado(undefined, 'GNV'), 'GNV');
    assert.equal(resolverTipoDuplicado('GLP', 'GLP'), 'GLP');
    assert.throws(
        () => resolverTipoDuplicado('GLP', 'GNV'),
        error => error.codigo === 'FILTROS_TIPO_DUPLICADO_INCOMPATIBLES' && error.status === 400
    );
});

test('el dashboard separa venta, cobros y saldo de duplicados para evitar multiplicaciones', () => {
    const servicePath = path.join(__dirname, '../services/faregas-dashboard.service.js');
    const source = fs.readFileSync(servicePath, 'utf8');

    assert.match(source, /ventas AS \([\s\S]*SUM\(oc\.importe_total\)[\s\S]*cobros AS \(/);
    assert.match(source, /cobros AS \([\s\S]*SUM\(p\.importe\)[\s\S]*saldos AS \(/);
    assert.doesNotMatch(source, /SUM\s*\(\s*DISTINCT\s+(?:oc\.importe_total|p\.importe)/i);
});

test('productos del dashboard requieren una clave real de producto', () => {
    const servicePath = path.join(__dirname, '../services/faregas-dashboard.service.js');
    const source = fs.readFileSync(servicePath, 'utf8');

    assert.match(source, /od\.tipo_item = 'PRODUCTO'\s+AND od\.producto_facturacion_id IS NOT NULL/);
});
