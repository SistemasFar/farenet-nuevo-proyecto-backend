const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../../../config/database');
const { obtenerResumenMensualFacturacion } = require('../services/faregas-resumen-mensual-facturacion.service');

test('resumen mensual limita sedes autorizadas y filtra por fecha de emisión', async () => {
        const originalQuery = db.query;
        const calls = [];
        db.query = async (sql, params) => {
            calls.push({ sql, params });
            return { rows: sql.includes('FROM fg_planta pl JOIN fg_empresa') ? [{ empresa_emisora: 'FAREGAS', ruc_emisor: '20123456789' }] : [{ id_documento: 'F-1' }] };
        };
        try {
        const result = await obtenerResumenMensualFacturacion({
            plantasAutorizadas: ['ATE', 'SUR'], plantasFiltro: ['ATE', 'NO_AUTORIZADA'],
            desde: '2026-10-01', hasta: '2026-10-31'
        });
        assert.equal(result.cabeceras.length, 1);
        assert.equal(calls.length, 2);
        const { sql, params } = calls[0];
        assert.deepEqual(params, [['ATE'], '2026-10-01', '2026-10-31']);
        assert.match(sql, /f\.fecha_documento >= \$2::date/);
        assert.match(sql, /NULL::date AS fecha_emision, cr\.fecha_aceptacion::date AS fecha_aceptacion/);
        assert.match(sql, /UNION ALL/);
        assert.match(sql, /DISTINCT ON \(id_documento\)/);
        assert.match(sql, /aceptada_sunat/);
        assert.deepEqual(result.metadatos.empresasEmisoras, ['FAREGAS']);
        } finally { db.query = originalQuery; }
});

test('resumen mensual no consulta cuando el usuario no tiene sedes autorizadas', async () => {
        const originalQuery = db.query;
        let queried = false;
        db.query = async () => { queried = true; return { rows: [] }; };
        try {
        const result = await obtenerResumenMensualFacturacion({ plantasAutorizadas: [], plantasFiltro: [], desde: '2026-10-01', hasta: '2026-10-31' });
        assert.deepEqual(result, { cabeceras: [], metadatos: { empresasEmisoras: [], rucEmisores: [] } });
        assert.equal(queried, false);
        } finally { db.query = originalQuery; }
});

test('resumen mensual global acepta plantasFiltro null y consulta todas las sedes autorizadas', async () => {
        const originalQuery = db.query;
        const calls = [];
        db.query = async (sql, params) => {
            calls.push({ sql, params });
            return { rows: [] };
        };
        try {
            const result = await obtenerResumenMensualFacturacion({
                plantasAutorizadas: ['98', '201'], plantasFiltro: null,
                desde: '2026-11-01', hasta: '2026-11-30'
            });
            assert.equal(calls.length, 2);
            assert.ok(calls.every(({ params }) => params[0].join(',') === '98,201'));
            assert.deepEqual(result.cabeceras, []);
        } finally { db.query = originalQuery; }
});
