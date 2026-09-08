const test = require('node:test');
const assert = require('node:assert/strict');
const service = require('../services/faregas-catalogo-fiscal-import.service');
const db = require('../../../config/database');

test.after(() => db.end());

const crearExecutor = ({ productoActualId = null, categoriaDms = null, productoActivo = true } = {}) => ({
    async query(sql) {
        if (sql.includes('FROM fg_planta WHERE')) return { rows: [{ key: '201', nombre: 'INDEPENDENCIA', activo: true }] };
        if (sql.includes('FROM fg_servicio')) return { rows: [{
            id: 3, codigo: 'GLP_INICIAL', nombre: 'Certificado inicial',
            tipo_flujo: 'CERTIFICACION', activo: true
        }] };
        if (sql.includes('FROM fg_tarifa')) return { rows: [{
            id: 50, planta_key: '201', producto_facturacion_id: productoActualId,
            servicio_codigo: 'GLP_INICIAL', servicio_nombre: 'Certificado inicial',
            tipo_flujo: 'CERTIFICACION', planta_nombre: 'INDEPENDENCIA'
        }] };
        if (sql.includes('FROM fg_producto_facturacion')) return { rows: [{
            id: 22, codigo_sku: '0022', descripcion: 'CERTIFICADO INICIAL DE GLP',
            categoria_dms: categoriaDms, unidad: 'NIU', codigo_clasificacion_sunat: null,
            tipo_afectacion_igv: '10', es_para_venta: true, activo: productoActivo
        }] };
        if (sql.includes('FROM fg_producto_sede')) return { rows: [] };
        throw new Error(`Consulta no esperada: ${sql}`);
    }
});

test('dry-run conserva la unidad NIU demostrada por DMS', async () => {
    const result = await service.previsualizar([filaValida], crearExecutor());
    assert.equal(result.invalidas, 0);
    assert.equal(result.filas[0].producto.unidad, 'NIU');
});

const filaValida = {
    planta_key: '201', servicio_codigo: 'GLP_INICIAL', codigo_sku: '0022', tarifa_id: 50
};

test('previsualiza por planta, servicio y SKU sin ejecutar UPDATE', async () => {
    const calls = [];
    const executor = crearExecutor();
    const spy = { query: async (sql, params) => { calls.push(sql); return executor.query(sql, params); } };
    const result = await service.previsualizar([filaValida], spy);
    assert.equal(result.validas, 1);
    assert.equal(result.cambios, 1);
    assert.equal(result.invalidas, 0);
    assert.equal(calls.some(sql => /^\s*UPDATE/i.test(sql)), false);
});

test('rechaza combinaciones planta y servicio repetidas antes de aplicar', async () => {
    const result = await service.previsualizar([filaValida, { ...filaValida, tarifa_id: null }], crearExecutor());
    assert.equal(result.invalidas, 2);
    assert.ok(result.filas.every(row => row.errores.some(error => error.includes('más de una vez'))));
});

test('rechaza un SKU con sede DMS distinta a la sede solicitada', async () => {
    const result = await service.previsualizar([filaValida], crearExecutor({
        categoriaDms: 'SERVICIOS - PLANTA SANTA ANITA'
    }));
    assert.equal(result.invalidas, 1);
    assert.match(result.filas[0].errores.join(' '), /SANTA ANITA.*INDEPENDENCIA/);
});

test('reconoce una reaplicación idéntica como operación sin cambios', async () => {
    const result = await service.previsualizar([filaValida], crearExecutor({ productoActualId: 22 }));
    assert.equal(result.validas, 1);
    assert.equal(result.cambios, 0);
    assert.equal(result.sinCambios, 1);
    assert.equal(result.filas[0].estado, 'SIN_CAMBIOS');
});

test('exige confirmación explícita para aplicar cambios', async () => {
    await assert.rejects(
        service.aplicar([filaValida], { confirmar: false }),
        /IMPORTACION_CONFIRMACION_REQUERIDA/
    );
});
