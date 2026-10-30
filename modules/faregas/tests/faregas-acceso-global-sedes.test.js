const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

process.env.NODE_ENV = 'test';

const {
    PERMISO_ACCESO_GLOBAL_SEDES,
    tieneAccesoGlobal,
    obtenerPlantasAutorizadas,
    obtenerAccesoPlanta
} = require('../services/faregas-acceso-sedes.service');

const crearExecutor = ({ perfilesGlobales = [], asignaciones = {} } = {}) => ({
    query: async (sql, params = []) => {
        const texto = String(sql);
        if (texto.includes('pp.permiso_clave = $2')) {
            const global = perfilesGlobales.includes(params[0])
                && params[1] === PERMISO_ACCESO_GLOBAL_SEDES;
            return {
                rowCount: global ? 1 : 0,
                rows: global ? [{ acceso_global: true, permiso_clave: PERMISO_ACCESO_GLOBAL_SEDES }] : []
            };
        }
        if (texto.includes('FROM fg_planta p') && !texto.includes('fg_usuario_planta')) {
            const empresa = params[0];
            const todas = [
                { key: '98', nombre: 'SURCO', empresa_key: 'FAREGAS' },
                { key: '61', nombre: 'SAN MIGUEL', empresa_key: 'FAREGAS' },
                { key: 'EXT', nombre: 'OTRA EMPRESA', empresa_key: 'OTRA' }
            ];
            const rows = empresa ? todas.filter((planta) => planta.empresa_key === empresa) : todas;
            return { rowCount: rows.length, rows };
        }
        if (texto.includes('FROM fg_usuario_planta up')) {
            const [username, perfilId, empresa] = params;
            const rows = (asignaciones[username] || [])
                .filter((planta) => planta.perfilId === perfilId)
                .filter((planta) => !empresa || planta.empresa_key === empresa)
                .map(({ perfilId: _perfilId, ...planta }) => planta);
            return { rowCount: rows.length, rows };
        }
        return { rowCount: 0, rows: [] };
    }
});

test('SISTEMAS conserva acceso global sólo cuando tiene el permiso configurable', async () => {
    const executor = crearExecutor({ perfilesGlobales: ['SISTEMAS'] });
    assert.equal(await tieneAccesoGlobal(executor, 'SISTEMAS'), true);
    const plantas = await obtenerPlantasAutorizadas(executor, {
        username: 'jromani',
        perfilId: 'SISTEMAS',
        empresaKey: 'FAREGAS'
    });
    assert.deepEqual(plantas.map((planta) => planta.key), ['98', '61']);
});

test('cualquier otro perfil puede recibir acceso global mediante el mismo permiso', async () => {
    const executor = crearExecutor({ perfilesGlobales: ['CENTRAL'] });
    const acceso = await obtenerAccesoPlanta(executor, {
        username: 'central1',
        perfilId: 'CENTRAL',
        plantaKey: '61',
        empresaKey: 'FAREGAS'
    });
    assert.equal(acceso?.key, '61');
});

test('un perfil sin permiso global queda limitado a sus sedes individuales', async () => {
    const executor = crearExecutor({
        asignaciones: {
            supervisor1: [{ key: '98', nombre: 'SURCO', empresa_key: 'FAREGAS', perfilId: 'SUPERVISOR' }]
        }
    });
    const plantas = await obtenerPlantasAutorizadas(executor, {
        username: 'supervisor1',
        perfilId: 'SUPERVISOR'
    });
    assert.deepEqual(plantas.map((planta) => planta.key), ['98']);
    assert.equal(await obtenerAccesoPlanta(executor, {
        username: 'supervisor1', perfilId: 'SUPERVISOR', plantaKey: '61'
    }), null);
});

test('el filtro empresarial se conserva incluso con acceso global', async () => {
    const executor = crearExecutor({ perfilesGlobales: ['CENTRAL'] });
    assert.equal(await obtenerAccesoPlanta(executor, {
        username: 'central1',
        perfilId: 'CENTRAL',
        plantaKey: 'EXT',
        empresaKey: 'FAREGAS'
    }), null);
});

test('la migración registra el permiso y conserva SISTEMAS sin tocar asignaciones individuales', () => {
    const migracion = fs.readFileSync(path.join(
        __dirname,
        '../database/migrations_history/20261029_faregas_acceso_global_sedes.sql'
    ), 'utf8');
    const maestro = fs.readFileSync(path.join(
        __dirname,
        '../database/migrations/0001_faregas_schema.sql'
    ), 'utf8');
    assert.match(migracion, /FAREGAS_ACCESO_GLOBAL_SEDES/);
    assert.match(migracion, /WHERE p\.clave = 'SISTEMAS'/);
    assert.doesNotMatch(migracion, /INSERT INTO fg_usuario_planta|UPDATE fg_usuario_planta|DELETE FROM fg_usuario_planta/);
    assert.match(maestro, /FAREGAS_ACCESO_GLOBAL_SEDES/);
});
