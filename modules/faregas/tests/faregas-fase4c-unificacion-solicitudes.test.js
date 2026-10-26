const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const leer = (relativo) => fs.readFileSync(path.join(__dirname, relativo), 'utf8');

test('Fase 4C: creación usa permiso RBAC y decisión/ejecución mantienen perfil SISTEMAS', () => {
    const servicio = leer('../services/faregas-solicitudes-operacion.service.js');

    assert.doesNotMatch(servicio, /SOLICITUD_CREACION_EXCLUSIVA_OPERADOR/);
    assert.match(servicio, /exigirPermiso\(permisos, PERMISOS_SOLICITUD\.CREAR\)/);
    assert.match(servicio, /alcance\.usuario\.perfil_id !== 'SISTEMAS'/);
    assert.match(servicio, /usuario\.perfil_id !== 'SISTEMAS'[\s\S]*PERMISOS_SOLICITUD\.EJECUTAR_ANULACION_CERTIFICADO/);
    assert.match(servicio, /row\.usuario_solicitante === alcance\.usuario\.username/);
    assert.match(servicio, /row\.usuario_solicitante === usuario\.username/);
});

test('Fase 4C: edición de perfil administra los permisos bajo Inicio sin duplicarlos', () => {
    const usuarios = leer('../services/faregas-usuarios.service.js');
    const esperados = [
        'FAREGAS_SOLICITUD_CREAR',
        'FAREGAS_SOLICITUD_VER',
        'FAREGAS_SOLICITUD_APROBAR',
        'FAREGAS_SOLICITUD_AUTOAPROBAR',
        'FAREGAS_SOLICITUD_RECHAZAR',
        'FAREGAS_SOLICITUD_ADMINISTRAR',
        'FAREGAS_CERTIFICADO_ANULAR_EJECUTAR',
        'FAREGAS_NOTA_CREDITO',
        'FAREGAS_ANULAR_COMPROBANTE'
    ];

    for (const permiso of esperados) assert.match(usuarios, new RegExp(`'${permiso}'`));
    assert.match(usuarios, /clave = ANY\(\$1::varchar\[\]\)/);
    assert.match(usuarios, /ON CONFLICT DO NOTHING/);
});

test('Fase 4C: esquema maestro y migración incremental restauran CREAR a SISTEMAS', () => {
    const master = leer('../database/migrations/0001_faregas_schema.sql');
    const migration = leer('../database/migrations_history/20261023_faregas_fase4c_solicitudes_inicio.sql');

    assert.match(master, /\('SISTEMAS'::varchar, 'FAREGAS_SOLICITUD_CREAR'::varchar\)/);
    assert.match(migration, /permiso\.clave = 'FAREGAS_SOLICITUD_CREAR'/);
    assert.match(migration, /perfil\.clave = 'SISTEMAS'/);
    assert.match(migration, /ON CONFLICT \(perfil_clave, permiso_clave\) DO NOTHING/);
    assert.doesNotMatch(migration, /DROP\s+TABLE|TRUNCATE|DELETE\s+FROM\s+public\.fg_(certificado|facturacion|pago|orden_pago)/i);
});

test('Fase 4C: la puerta fiscal exige SISTEMAS además del permiso sensible', () => {
    const fiscal = leer('../services/faregas-autorizacion-fiscal.service.js');
    assert.match(fiscal, /row\.perfil_id !== 'SISTEMAS'/);
    assert.match(fiscal, /row\.usuario_solicitante === username/);
    assert.match(fiscal, /row\.tiene_permiso/);
});
