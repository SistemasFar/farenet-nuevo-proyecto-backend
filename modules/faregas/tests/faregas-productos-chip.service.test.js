const test = require('node:test');
const assert = require('node:assert/strict');
const service = require('../services/faregas-productos.service');
const db = require('../../../config/database');

test.after(() => db.end());

const client = (row) => ({
    async query() {
        return row ? { rowCount: 1, rows: [row] } : { rowCount: 0, rows: [] };
    }
});

test('un producto fiscal sin chip conserva producto_chip_id nulo', async () => {
    assert.equal(await service._private.validarProductoChip(client(null), false, 99), null);
});

test('un producto fiscal que requiere chip exige la relación física', async () => {
    await assert.rejects(
        service._private.validarProductoChip(client(null), true, null),
        (error) => error.message === 'CHIP_REQUERIDO'
    );
});

test('rechaza un producto físico inexistente', async () => {
    await assert.rejects(
        service._private.validarProductoChip(client(null), true, 99),
        (error) => error.message === 'CHIP_NOT_FOUND'
    );
});

test('rechaza un producto físico inactivo', async () => {
    await assert.rejects(
        service._private.validarProductoChip(client({ id: 1, activo: false, control_stock: true, tipo: 'CHIP_SERIALIZADO' }), true, 1),
        (error) => error.message === 'CHIP_INACTIVO'
    );
});

test('rechaza un producto físico sin control de stock', async () => {
    await assert.rejects(
        service._private.validarProductoChip(client({ id: 1, activo: true, control_stock: false, tipo: 'CHIP_SERIALIZADO' }), true, 1),
        (error) => error.message === 'CHIP_SIN_CONTROL_STOCK'
    );
});

test('rechaza un producto que no sea CHIP_SERIALIZADO', async () => {
    await assert.rejects(
        service._private.validarProductoChip(client({ id: 1, activo: true, control_stock: true, tipo: 'OTRO_PRODUCTO_FISICO' }), true, 1),
        (error) => error.message === 'CHIP_TIPO_INVALIDO'
    );
});

test('acepta un CHIP_SERIALIZADO activo y con control de stock', async () => {
    const id = await service._private.validarProductoChip(
        client({ id: 1, activo: true, control_stock: true, tipo: 'CHIP_SERIALIZADO' }),
        true,
        1
    );
    assert.equal(id, 1);
});

test('un producto sin chip no conserva un monto de chip', () => {
    assert.equal(service._private.validarPrecioChip(false, 50), null);
});

test('un producto con chip exige un monto adicional mayor que cero', () => {
    assert.throws(
        () => service._private.validarPrecioChip(true, 0),
        (error) => error.message === 'CHIP_PRECIO_INVALIDO'
    );
});

test('acepta el monto adicional configurado para el chip', () => {
    assert.equal(service._private.validarPrecioChip(true, '35.50'), 35.5);
});
