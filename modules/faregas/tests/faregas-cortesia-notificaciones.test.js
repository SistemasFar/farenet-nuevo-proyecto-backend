const test = require('node:test');
const assert = require('node:assert/strict');
const notificaciones = require('../services/faregas-notificaciones.service');

test('FAREGAS — notificación informativa de cortesía', async (t) => {
    await t.test('selecciona todos los usuarios FAREGAS activos sin filtrar perfil, sede ni permiso', async () => {
        const consultas = [];
        const executor = {
            async query(sql, params = []) {
                consultas.push({ sql, params });
                if (sql.includes('SELECT DISTINCT u.username')) {
                    assert.deepEqual(params, []);
                    assert.match(sql, /WHERE u\.estado = TRUE/);
                    assert.doesNotMatch(sql, /fg_perfil_permiso|fg_usuario_planta|permiso_clave/);
                    return { rows: [
                        { username: 'administrador' },
                        { username: 'cajero' },
                        { username: 'operador' },
                        { username: 'supervisor' },
                        { username: 'usuario_otra_sede' }
                    ] };
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
            tipoCertificado: 'GLP_ANUAL',
            totalCobrado: 0,
            username: 'operador',
            usuarioNombre: 'OPERADOR PRUEBA'
        });

        assert.equal(id, 77);
        const insercion = consultas.find((item) => item.sql.includes('INSERT INTO fg_notificacion ('));
        assert.equal(insercion.params[0], 'CORTESIA_CERTIFICADO_501_EMITIDA');
        assert.match(insercion.params[3], /OPERADOR PRUEBA emitió un certificado de cortesía/);
        assert.match(insercion.params[3], /Tipo: GLP_ANUAL/);
        assert.match(insercion.params[3], /Importe cobrado: S\/ 0\.00/);
        assert.equal(consultas.filter((item) => item.sql.includes('INSERT INTO fg_notificacion_destinatario')).length, 5);
        assert.ok(consultas.some((item) => item.sql.includes('INSERT INTO fg_notificacion_destinatario') && item.params[1] === 'operador'));
        assert.ok(consultas.every((item) => !item.sql.includes('INSERT INTO fg_notificacion_destinatario') || item.sql.includes('ON CONFLICT')));
    });

    await t.test('un reintento reutiliza el evento y no crea destinatarios duplicados', async () => {
        let insercionesEvento = 0;
        const consultas = [];
        const executor = {
            async query(sql, params = []) {
                consultas.push({ sql, params });
                if (sql.includes('SELECT DISTINCT u.username')) return { rows: [{ username: 'operador' }] };
                if (sql.includes('INSERT INTO fg_notificacion (')) {
                    insercionesEvento++;
                    return insercionesEvento === 1 ? { rows: [{ id: 88 }] } : { rows: [] };
                }
                if (sql.includes('SELECT id FROM fg_notificacion')) return { rows: [{ id: 88 }] };
                return { rows: [], rowCount: 1 };
            }
        };
        const cortesia = {
            certificadoId: 502,
            numeroCertificado: 'DG-41-000502',
            plantaKey: '98',
            empresaKey: 'FAREGAS',
            sedeNombre: 'SURCO',
            username: 'operador',
            usuarioNombre: 'OPERADOR PRUEBA'
        };
        assert.equal(await notificaciones.crearParaCortesiaEmitida(executor, cortesia), 88);
        assert.equal(await notificaciones.crearParaCortesiaEmitida(executor, cortesia), 88);
        const destinos = consultas.filter((item) => item.sql.includes('INSERT INTO fg_notificacion_destinatario'));
        assert.equal(destinos.length, 2);
        assert.ok(destinos.every((item) => item.sql.includes('ON CONFLICT (notificacion_id, usuario_id) DO NOTHING')));
    });

    await t.test('la lectura se actualiza únicamente para el usuario autenticado', async () => {
        const executor = {
            async query(sql, params) {
                assert.match(sql, /WHERE usuario_id = \$1 AND notificacion_id = \$2/);
                assert.deepEqual(params, ['cajero', 90]);
                return { rowCount: 1, rows: [{ id: 1 }] };
            }
        };
        assert.equal(await notificaciones.marcarLeida('cajero', 90, executor), true);
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
