const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../../../config/database');
const { obtenerDocumentosEmitidosExtendido } = require('../services/faregas-documentos-emitidos-extendido.service');

test('documentos extendidos usa mes de emisión, sede autorizada y conjuntos separados', async () => {
    const originalQuery = db.query;
    const calls = [];
    db.query = async (sql, params) => {
        calls.push({ sql, params });
        return { rows: [] };
    };
    try {
        const data = await obtenerDocumentosEmitidosExtendido({
            plantasAutorizadas: ['ATE', 'CAMACHO'], plantasFiltro: ['ATE'],
            desde: '2026-10-01', hasta: '2026-10-31'
        });
        assert.equal(calls.length, 3);
        assert.ok(calls.every(({ params }) => params[0][0] === 'ATE'));
        assert.ok(calls.every(({ params }) => params[1] === '2026-10-01'));
        assert.ok(calls.every(({ params }) => params[2] === '2026-11-01'));
        assert.match(calls[0].sql, /f\.fecha_documento >= \$2::date AND f\.fecha_documento < \$3::date/);
        assert.match(calls[0].sql, /cr\.fecha_aceptacion >= \$2::date/);
        assert.match(calls[0].sql, /NULL::timestamp,\s*'EMISIÓN NO REGISTRADA; PERÍODO SEGÚN ACEPTACIÓN'::text, cr\.fecha_aceptacion/);
        assert.doesNotMatch(calls[0].sql, /COALESCE\(f\.fecha_documento::timestamp, f\.fecha_aceptacion, f\.fecha_creacion\)/);
        assert.match(calls[0].sql, /FROM fg_credito cr/);
        assert.match(calls[0].sql, /Afecta/);
        assert.match(calls[1].sql, /GROUP BY od\.id/);
        assert.match(calls[2].sql, /GROUP BY vd\.id/);
        assert.doesNotMatch(calls[1].sql, /SUM\(f\.importe_total\)/);
        assert.deepEqual(data, { cabeceras: [], lineas: [] });
    } finally {
        db.query = originalQuery;
    }
});

test('documentos extendidos no consulta sedes fuera de autorización', async () => {
    const result = await obtenerDocumentosEmitidosExtendido({
        plantasAutorizadas: ['ATE'], plantasFiltro: ['FUERA'], desde: '2026-10-01', hasta: '2026-10-31'
    });
    assert.deepEqual(result, { cabeceras: [], lineas: [] });
});
