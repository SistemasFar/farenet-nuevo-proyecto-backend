const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../../../config/database');
const auditoria = require('../services/faregas-auditoria.service');

test.after(() => db.end());

test('registra una operación con contexto de certificado y datos no sensibles', async () => {
    const queryOriginal = db.query;
    const consultas = [];
    db.query = async (sql, params) => {
        consultas.push({ sql, params });
        if (/FROM fg_certificado c/i.test(sql)) {
            return {
                rows: [{
                    id: '15', numero_certificado: null, planta_key: '201',
                    tipo_certificado_clave: 'GLP_ANUAL', paso_actual: 'PAGO', placa: 'ABC123'
                }]
            };
        }
        return { rowCount: 1, rows: [] };
    };

    try {
        await auditoria.registrarEventoCertificado({
            certificado_id: 15,
            username: 'operador',
            evento: 'PAGOS_GUARDADOS',
            categoria: 'PAGO',
            mensaje: 'Pagos guardados',
            datos: { cantidadPagos: 2, importePagado: 80 }
        });
        assert.equal(consultas.length, 2);
        assert.match(consultas[1].sql, /INSERT INTO fg_auditoria_acceso/i);
        assert.equal(consultas[1].params[8], 'PAGO');
        assert.equal(consultas[1].params[11], 15);
        assert.equal(consultas[1].params[13], 'ABC123');
        assert.deepEqual(JSON.parse(consultas[1].params[16]), { cantidadPagos: 2, importePagado: 80 });
    } finally {
        db.query = queryOriginal;
    }
});

test('combina filtros operativos usando parámetros SQL', async () => {
    const queryOriginal = db.query;
    let consulta;
    db.query = async (sql, params) => {
        consulta = { sql, params };
        return { rows: [] };
    };

    try {
        await auditoria.listarAccesos({
            username: 'gibarra', categoria: 'CERTIFICADO', placa: 'ABC',
            buscar: '166', exitoso: 'true', fechaInicio: '2026-08-01', fechaFin: '2026-08-27',
            modulo: 'INICIO'
        });
        assert.match(consulta.sql, /username ILIKE/);
        assert.match(consulta.sql, /categoria =/);
        assert.match(consulta.sql, /placa ILIKE/);
        assert.match(consulta.sql, /numero_certificado/);
        assert.match(consulta.sql, /categoria = ANY/);
        assert.match(consulta.sql, /ORDER BY a\.fecha_evento DESC LIMIT 500/);
        assert.ok(consulta.params.includes('CERTIFICADO'));
        assert.ok(consulta.params.includes('%ABC%'));
        assert.ok(consulta.params.some((valor) => Array.isArray(valor) && valor.includes('FACTURACION')));
    } finally {
        db.query = queryOriginal;
    }
});
