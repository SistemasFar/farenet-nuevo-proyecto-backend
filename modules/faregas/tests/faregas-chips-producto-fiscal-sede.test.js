const test = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';

const reglas = require('../services/faregas-chips-fiscal.rules');
const ventaCanonica = require('../services/faregas-venta-directa-canonica.service');

const fiscalValido = (cambios = {}) => ({
    producto_facturacion_id: 2337,
    codigo_sku: 'CHIP + PORTA CHIP - SURQUILLO',
    descripcion: 'CHIP + PORTA CHIP',
    unidad: 'NIU',
    tipo_afectacion_igv: '10',
    codigo_clasificacion_sunat: null,
    fiscal_activo: true,
    es_para_venta: true,
    precio_unitario: 152.54,
    precio_referencia: 180,
    ...cambios
});

test('P. venta fiscal, no P. unitario ni precio legacy, define el total comercial', () => {
    assert.equal(reglas.obtenerPrecioVentaFiscal({ precio_unitario: 152.54, precio_referencia: 180 }), 180);
    assert.equal(reglas.validarProductoFiscalChip(fiscalValido({ precio_legacy: 175 })), 180);
});

test('la venta exige mapping por sede y un producto fiscal vigente', () => {
    assert.throws(
        () => reglas.validarProductoFiscalChip(fiscalValido({ producto_facturacion_id: null })),
        { message: 'CHIP_PRODUCTO_FISCAL_NO_CONFIGURADO' }
    );
    assert.throws(
        () => reglas.validarProductoFiscalChip(fiscalValido({ fiscal_activo: false })),
        { message: 'PRODUCTO_FISCAL_CHIP_INVALIDO' }
    );
    assert.throws(
        () => reglas.validarProductoFiscalChip(fiscalValido({ es_para_venta: false })),
        { message: 'PRODUCTO_FISCAL_CHIP_INVALIDO' }
    );
    assert.throws(
        () => reglas.validarProductoFiscalChip(fiscalValido({ precio_referencia: null })),
        { message: 'PRECIO_VENTA_FISCAL_CHIP_INVALIDO' }
    );
});

test('sólo COLINA, SURCO y SURQUILLO son sedes operativas de chips', () => {
    assert.equal(reglas.validarSedeOperativaChips('13'), '13');
    assert.equal(reglas.validarSedeOperativaChips('98'), '98');
    assert.equal(reglas.validarSedeOperativaChips('160'), '160');
    assert.throws(() => reglas.validarSedeOperativaChips('201'), { message: 'SEDE_CHIP_NO_HABILITADA' });
});

test('la configuración canónica usa únicamente la FK por sede y precio_referencia', async () => {
    let consulta = '';
    const client = {
        query: async (sql) => {
            consulta = sql;
            return {
                rowCount: 1,
                rows: [{
                    ...fiscalValido(),
                    id: 1,
                    codigo: 'CHIP',
                    nombre: 'Chip y porta chip',
                    activo: true,
                    sede_activa: true,
                    stock_permitido: true,
                    venta_habilitada: true,
                    precio_legacy: 175
                }]
            };
        }
    };

    const config = await ventaCanonica._private.obtenerConfiguracionProducto(client, '160', 1);
    assert.equal(config.producto_facturacion_id, 2337);
    assert.equal(config.precio, 180);
    assert.match(consulta, /pf\.id = pis\.producto_facturacion_id/);
    assert.doesNotMatch(consulta, /COALESCE\(pis\.producto_facturacion_id/);
});

test('el snapshot conserva producto y total aunque después cambie el catálogo', () => {
    const config = { ...fiscalValido(), precio: 180 };
    const snapshot = ventaCanonica._private.construirDetalleChip(
        { id: 7, numero_chip: 'CHIP12345' },
        config
    );
    config.precio = 190;
    config.producto_facturacion_id = 9999;

    assert.equal(snapshot.productoFacturacionId, 2337);
    assert.equal(snapshot.precioUnitario, 180);
    assert.equal(snapshot.importeTotal, 180);
    assert.equal(snapshot.baseImponible, 152.54);
    assert.equal(snapshot.igv, 27.46);
});

test('la sede de venta determina el producto fiscal después de una transferencia', () => {
    const chip = { id: 9, numero_chip: 'CHIP-TRANSFERIDO' };
    const colina = ventaCanonica._private.construirDetalleChip(chip, {
        ...fiscalValido({ producto_facturacion_id: 2335, codigo_sku: 'CHIP + PORTA CHIP - COLINA' }),
        precio: 180
    });
    const surquillo = ventaCanonica._private.construirDetalleChip(chip, {
        ...fiscalValido({ producto_facturacion_id: 2337, codigo_sku: 'CHIP + PORTA CHIP - SURQUILLO' }),
        precio: 180
    });
    assert.equal(colina.productoFacturacionId, 2335);
    assert.equal(surquillo.productoFacturacionId, 2337);
});
