const test = require('node:test');
const assert = require('node:assert/strict');
const service = require('../services/faregas-catalogo-fiscal-import.service');
const db = require('../../../config/database');

test.after(() => db.end());

const executor = {
    async query(sql) {
        if (sql.includes('FROM fg_tarifa')) return { rowCount: 1, rows: [{
            id: 50, planta_key: '201', producto_facturacion_id: null,
            servicio_codigo: 'GLP_INICIAL', servicio_nombre: 'Certificado inicial', tipo_flujo: 'CERTIFICACION'
        }] };
        return { rowCount: 1, rows: [{
            id: 22, codigo_sku: '0022', descripcion: 'CERTIFICADO INICIAL DE GLP',
            unidad: 'ZZ', codigo_clasificacion_sunat: null,
            tipo_afectacion_igv: '10', es_para_venta: true, activo: true
        }] };
    }
};

test('previsualiza una vinculación válida sin ejecutar UPDATE', async () => {
    const calls = [];
    const spy = { query: async (sql, params) => { calls.push(sql); return executor.query(sql, params); } };
    const result = await service.previsualizar([{ tarifa_id: 50, producto_sku: '0022' }], spy);
    assert.equal(result.validas, 1);
    assert.equal(result.invalidas, 0);
    assert.equal(calls.some(sql => /^\s*UPDATE/i.test(sql)), false);
});

test('rechaza tarifas repetidas antes de aplicar el archivo', async () => {
    const result = await service.previsualizar([
        { tarifa_id: 50, producto_sku: '0022' },
        { tarifa_id: 50, producto_sku: '0022' }
    ], executor);
    assert.equal(result.invalidas, 2);
    assert.ok(result.filas.every(row => row.errores.some(error => error.includes('más de una vez'))));
});

test('exige confirmación explícita para aplicar cambios', async () => {
    await assert.rejects(
        service.aplicar([{ tarifa_id: 50, producto_sku: '0022' }], { confirmar: false }),
        /IMPORTACION_CONFIRMACION_REQUERIDA/
    );
});
