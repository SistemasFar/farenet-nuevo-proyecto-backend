const test = require('node:test');
const assert = require('node:assert/strict');
const notificaciones = require('../services/faregas-notificaciones.service');

test('FAREGAS — notificación informativa de cortesía', async (t) => {
    await t.test('selecciona únicamente destinatarios con el permiso configurable y evita duplicar el evento', async () => {
        const consultas = [];
        const executor = {
            async query(sql, params = []) {
                consultas.push({ sql, params });
                if (sql.includes('SELECT DISTINCT u.username')) {
                    assert.equal(params[1], 'FAREGAS_NOTIFICACION_CORTESIA_RECIBIR');
                    return { rows: [{ username: 'auditor1' }, { username: 'auditor2' }] };
                }
                if (sql.includes('INSERT INTO fg_notificacion (')) return { rows: [{ id: 77 }] };
                return { rows: [], rowCount: 1 };
            }
        };

        const id = await notificaciones.crearParaCortesiaEmitida(executor, {
            certificadoId: 501,
            numeroCertificado: 'DG-41-000501',
            plantaKey: '98',
            empresaKey: 'FAREGAS',
            sedeNombre: 'SURCO',
            username: 'operador',
            usuarioNombre: 'OPERADOR PRUEBA'
        });

        assert.equal(id, 77);
        const insercion = consultas.find((item) => item.sql.includes('INSERT INTO fg_notificacion ('));
        assert.equal(insercion.params[0], 'CORTESIA_CERTIFICADO_501_EMITIDA');
        assert.match(insercion.params[3], /OPERADOR PRUEBA aplicó una cortesía/);
        assert.equal(consultas.filter((item) => item.sql.includes('INSERT INTO fg_notificacion_destinatario')).length, 2);
    });

    await t.test('acepta un rango dentro del mismo mes calendario', () => {
        assert.deepEqual(
            notificaciones._private.rangoMesCalendario('2026-11-01', '2026-11-30'),
            { fechaDesde: '2026-11-01', fechaHasta: '2026-11-30' }
        );
    });

    await t.test('rechaza rangos que abarcan más de un mes calendario', () => {
        assert.throws(
            () => notificaciones._private.rangoMesCalendario('2026-11-15', '2026-12-14'),
            (error) => error.code === 'RANGO_MAXIMO_UN_MES_CALENDARIO'
        );
    });
});
