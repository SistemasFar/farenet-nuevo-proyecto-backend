const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const cron = require('../services/faregas-nubefact-cron.service');

describe('Reconciliación NubeFact de ventas directas', () => {
    it('reclama facturas de operaciones además de comprobantes ligados a certificados', async () => {
        let sqlPendientes = '';
        const row = {
            facturacion_id: 1167,
            certificado_id: null,
            estado: 'PENDIENTE',
            serie: 'FFF1',
            numero: 44,
            tipo_comprobante: 'FACTURA',
            operacion_id: 7001,
            planta_key: '98'
        };
        const client = {
            query: async (sql) => {
                const statement = sql.replace(/\s+/g, ' ').trim();
                if (statement === 'BEGIN' || statement === 'COMMIT' || statement === 'ROLLBACK') return { rowCount: 0, rows: [] };
                if (statement.startsWith('UPDATE fg_facturacion f')) return { rowCount: 0, rows: [] };
                if (statement.startsWith('SELECT f.id AS facturacion_id')) {
                    sqlPendientes = statement;
                    return { rowCount: 1, rows: [row] };
                }
                if (statement.startsWith('SELECT COALESCE(MAX(numero_intento)')) return { rowCount: 1, rows: [{ numero: 2 }] };
                if (statement.startsWith('INSERT INTO fg_facturacion_intento')) return { rowCount: 1, rows: [{ id: 812 }] };
                if (statement.startsWith('UPDATE fg_facturacion SET fecha_ultimo_intento')) return { rowCount: 1, rows: [] };
                throw new Error(`SQL no previsto en la prueba: ${statement}`);
            },
            release() {}
        };
        const database = { connect: async () => client };

        const filas = await cron._private.reclamarLote({
            database,
            entorno: 'DEMO',
            batchSize: 5,
            pendingLeaseMs: 120000,
            reconciliationRetryMs: 900000,
            maxErrors: 5
        });

        assert.match(sqlPendientes, /LEFT JOIN fg_operacion_comercial oc ON oc.id = f.operacion_id/);
        assert.match(sqlPendientes, /COALESCE\(c.planta_key, oc.planta_key\) AS planta_key/);
        assert.match(sqlPendientes, /f\.tipo_comprobante IN \('FACTURA', 'BOLETA'\)/);
        assert.equal(filas.length, 1);
        assert.equal(filas[0].operacion_id, 7001);
        assert.equal(filas[0].planta_key, '98');
        assert.equal(filas[0].claim_id, 812);
    });

    it('recupera y marca FACTURADO una venta directa encontrada como aceptada', async () => {
        const sqlEjecutados = [];
        const client = {
            query: async (sql) => {
                const statement = sql.replace(/\s+/g, ' ').trim();
                sqlEjecutados.push(statement);
                if (statement === 'BEGIN' || statement === 'COMMIT' || statement === 'ROLLBACK') return { rowCount: 0, rows: [] };
                if (statement.startsWith('SELECT f.estado')) return { rowCount: 1, rows: [{ estado: 'PENDIENTE' }] };
                return { rowCount: 1, rows: [] };
            },
            release() {}
        };
        const database = { connect: async () => client };
        const resultado = await cron._private.persistirResultado({
            database,
            fila: { facturacion_id: 1167, claim_id: 812, operacion_id: 7001 },
            resultado: { status: 'ACCEPTED', data: { codigo_hash: 'HASH-DEMO', sunat_responsecode: '0' } },
            maxErrors: 5
        });

        assert.deepEqual(resultado, { actualizada: true, estado: 'ACEPTADO' });
        assert.ok(sqlEjecutados.some(sql => sql.startsWith('UPDATE fg_operacion_comercial SET estado = \'FACTURADO\'')));
        assert.ok(sqlEjecutados.some(sql => sql.includes('UPDATE fg_facturacion_intento')));
    });
});
