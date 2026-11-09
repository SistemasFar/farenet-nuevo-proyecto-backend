const test = require('node:test');
const assert = require('node:assert/strict');

test('el backend aplica sede/rango y devuelve relaciones comerciales para el consolidado', async () => {
    const databasePath = require.resolve('../../../config/database');
    const servicePath = require.resolve('../services/faregas-reporte-financiero.service');
    const calls = [];
    require.cache[databasePath] = { id: databasePath, filename: databasePath, loaded: true, exports: {
        query: async (sql, params) => { calls.push({ sql, params }); return { rows: [], rowCount: 0 }; }
    } };
    delete require.cache[servicePath];
    const service = require(servicePath);
    const result = await service.obtenerReporteFinanciero({
        plantasAutorizadas: ['98'], plantasFiltro: ['98'],
        desde: '2026-10-08', hasta: '2026-11-06', username: 'tester'
    });
    assert.equal(calls.length, 9);
    calls.forEach((call) => assert.deepEqual(call.params[0], ['98']));
    assert.match(calls[0].sql, /oc\.fecha_creacion >= \$2::timestamptz/);
    assert.match(calls[1].sql, /fg_operacion_detalle_chip/);
    assert.match(calls[1].sql, /cert\.numero_certificado/);
    assert.match(calls[1].sql, /fg_certificado_duplicado/);
    assert.match(calls[1].sql, /duplicado_tipo_nombre/);
    assert.match(calls[3].sql, /baja_aceptada/);
    assert.match(calls[3].sql, /nota_anulacion_total_aceptada/);
    assert.match(calls[3].sql, /nota_credito_parcial_total/);
    assert.deepEqual(result.metadatos.plantas, ['98']);
    assert.equal(result.metadatos.desde, '2026-10-08');
    assert.equal(result.metadatos.hasta, '2026-11-06');
});
