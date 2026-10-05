const test = require('node:test');
const assert = require('node:assert/strict');

const productosService = require('../services/faregas-productos.service');

test('normaliza el bigint del producto 273 para que el contrato HTTP use number', () => {
    const producto = productosService.mapearProducto({
        id: '273',
        codigo_sku: '0390',
        descripcion: 'CERTIFICADO DE CONFORMIDAD DE CAMBIO DE MOTOR',
        categoria_dms: 'SERVICIOS - PLANTA ATE',
        precio_unitario: '84.7500',
        precio_referencia: '100.0000',
        valor_referencial_unitario: '100.0000',
        porcentaje_isc: '42.0000',
        precio_chip: null
    });

    assert.equal(producto.id, 273);
    assert.equal(typeof producto.id, 'number');
    assert.equal(producto.precio_unitario, 84.75);
    assert.equal(producto.categoria_dms, 'SERVICIOS - PLANTA ATE');
});
