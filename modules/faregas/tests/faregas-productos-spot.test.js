process.env.NODE_ENV = 'test';
process.env.DB_USER = 'isolated-test';
process.env.DB_HOST = '127.0.0.1';
process.env.DB_NAME = 'faregas_spot_test';
process.env.DB_PASSWORD = 'isolated-test';
process.env.DB_PORT = '55439';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { _private } = require('../controllers/faregas-productos.controller');

const productoBase = {
    codigo_sku: 'SPOT-UNIT-1', descripcion: 'Producto de prueba', categoria_id: 1,
    unidad: 'NIU', tipo_afectacion_igv: '10',
    sujeto_detraccion: true, detraccion_codigo: '007', detraccion_porcentaje: 10
};

describe('CRUD de productos — clasificación SPOT', () => {
    it('normaliza y persiste una clasificación explícita sin inferirla por defecto', () => {
        assert.deepEqual(_private.normalizar(productoBase, { crear: true }), {
            codigo_sku: 'SPOT-UNIT-1', descripcion: 'Producto de prueba', tipo_producto: null,
            categoria_dms: null, categoria_id: 1, cuenta_por_cobrar: null, codigo_barras: null,
            unidad: 'NIU', precio_unitario: null, precio_referencia: null, valor_referencial_unitario: null,
            codigo_clasificacion_sunat: null, tipo_afectacion_igv: '10', codigo_afectacion_isc: null,
            porcentaje_isc: null, disponible_pos: false, es_para_venta: true, es_para_compra: false,
            tiene_icbper: false, imagen_url: null, activo: true, requiere_chip: false,
            producto_chip_id: null, precio_chip: null, sujeto_detraccion: true,
            detraccion_codigo: '007', detraccion_porcentaje: 10, spot_configurado: true
        });
    });

    it('mantiene productos nuevos sin clasificar y permite marcar explícitamente no sujeto', () => {
        assert.equal(_private.normalizar({ ...productoBase, sujeto_detraccion: null, detraccion_codigo: null, detraccion_porcentaje: null }).sujeto_detraccion, null);
        assert.deepEqual(
            (({ sujeto_detraccion, detraccion_codigo, detraccion_porcentaje }) => ({ sujeto_detraccion, detraccion_codigo, detraccion_porcentaje }))(
                _private.normalizar({ ...productoBase, sujeto_detraccion: false, detraccion_codigo: null, detraccion_porcentaje: null })
            ),
            { sujeto_detraccion: false, detraccion_codigo: null, detraccion_porcentaje: null }
        );
    });

    it('rechaza una clasificación SPOT incompleta o con tasa distinta a la oficial', () => {
        assert.throws(() => _private.normalizar({ ...productoBase, detraccion_codigo: null }), /incompleta/i);
        assert.throws(() => _private.normalizar({ ...productoBase, detraccion_porcentaje: 12 }), /debe ser 10%/i);
        assert.throws(() => _private.normalizar({ ...productoBase, detraccion_codigo: '999' }), /código válido/i);
    });

    it('no permite conservar código o tasa si el producto está pendiente o no sujeto', () => {
        assert.throws(() => _private.normalizar({ ...productoBase, sujeto_detraccion: false }), /no sujeto/i);
    });

    it('una edición de cliente antiguo que omite SPOT no debe borrar la clasificación existente', () => {
        const { sujeto_detraccion, detraccion_codigo, detraccion_porcentaje, ...sinSpot } = productoBase;
        const producto = _private.normalizar(sinSpot);
        assert.equal(producto.spot_configurado, false);
    });
});
