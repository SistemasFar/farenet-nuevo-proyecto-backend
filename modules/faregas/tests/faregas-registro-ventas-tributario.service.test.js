const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../../../config/database');
const { obtenerRegistroVentasTributario } = require('../services/faregas-registro-ventas-tributario.service');

test('registro tributario limita sede y período por fecha de emisión, conservando la referencia de NC', async () => {
    const originalQuery = db.query;
    let call;
    db.query = async (sql, params) => { call = { sql, params }; return { rows: [] }; };
    try {
        await obtenerRegistroVentasTributario({ plantasAutorizadas: ['ATE', 'SUR'], plantasFiltro: ['ATE', 'FUERA'], desde: '2026-11-01', hasta: '2026-11-30' });
        assert.deepEqual(call.params, [['ATE'], '2026-11-01', '2026-11-30']);
        assert.match(call.sql, /f\.fecha_documento >= \$2::date/);
        assert.match(call.sql, /NULL::date AS fecha_emision, cr\.fecha_aceptacion::date AS fecha_aceptacion/);
        assert.match(call.sql, /f\.fecha_documento < \(\$3::date \+ INTERVAL '1 day'\)/);
        assert.match(call.sql, /f\.serie::text, f\.numero::text/);
        assert.match(call.sql, /cr\.fecha_aceptacion::date >= \$2::date/);
        assert.doesNotMatch(call.sql, /COALESCE\(cr\.fecha_aceptacion, cr\.fecha_creacion\)/);
    } finally { db.query = originalQuery; }
});

test('registro tributario no consulta sin sedes autorizadas', async () => {
    const originalQuery = db.query;
    let queried = false;
    db.query = async () => { queried = true; return { rows: [] }; };
    try {
        assert.deepEqual(await obtenerRegistroVentasTributario({ plantasAutorizadas: [], plantasFiltro: [] }), { documentos: [] });
        assert.equal(queried, false);
    } finally { db.query = originalQuery; }
});

test('registro tributario global acepta plantasFiltro null y consulta todas las sedes autorizadas', async () => {
    const originalQuery = db.query;
    let call;
    db.query = async (sql, params) => { call = { sql, params }; return { rows: [] }; };
    try {
        const result = await obtenerRegistroVentasTributario({
            plantasAutorizadas: ['98', '201'], plantasFiltro: null,
            desde: '2026-11-01', hasta: '2026-11-30'
        });
        assert.deepEqual(call.params, [['98', '201'], '2026-11-01', '2026-11-30']);
        assert.deepEqual(result, { documentos: [] });
    } finally { db.query = originalQuery; }
});
