const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const leer = (relativo) => fs.readFileSync(path.join(__dirname, relativo), 'utf8');

test('Fase 4C: creación usa permiso RBAC y decisión/ejecución ya no dependen del perfil', () => {
    const servicio = leer('../services/faregas-solicitudes-operacion.service.js');

    assert.doesNotMatch(servicio, /SOLICITUD_CREACION_EXCLUSIVA_OPERADOR/);
    assert.match(servicio, /exigirPermiso\(permisos, PERMISOS_SOLICITUD\.CREAR\)/);
    assert.doesNotMatch(servicio, /perfil_id !== 'SISTEMAS'/);
    assert.doesNotMatch(servicio, /DECISION_EXCLUSIVA_SISTEMAS/);
    assert.match(servicio, /row\.usuario_solicitante === alcance\.usuario\.username/);
    assert.match(servicio, /row\.usuario_solicitante === usuario\.username/);
});

test('Fase 4C: edición de perfil administra todos los permisos, incluidos los sensibles', () => {
    const usuarios = leer('../services/faregas-usuarios.service.js');
    const constantes = leer('../services/faregas-permisos-sensibles.constants.js');
    const esperados = [
        'FAREGAS_SOLICITUD_CREAR',
        'FAREGAS_SOLICITUD_VER',
        'FAREGAS_SOLICITUD_APROBAR',
        'FAREGAS_SOLICITUD_AUTOAPROBAR',
        'FAREGAS_SOLICITUD_AUTOEJECUTAR',
        'FAREGAS_SOLICITUD_RECHAZAR',
        'FAREGAS_SOLICITUD_ADMINISTRAR',
        'FAREGAS_CERTIFICADO_ANULAR_EJECUTAR',
        'FAREGAS_CERTIFICADO_RECTIFICAR_EJECUTAR',
        'FAREGAS_NOTA_CREDITO',
        'FAREGAS_ANULAR_COMPROBANTE'
    ];

    for (const permiso of esperados) {
        assert.match(constantes, new RegExp(`'${permiso}'`));
    }
    assert.match(constantes, /FAREGAS_PERMISO_ADMINISTRAR_PERFILES = 'MENU_USUARIOS'/);
    assert.doesNotMatch(constantes, /const\s+FAREGAS_PERMISOS_SENSIBLES_ADMINISTRAR/);
    assert.match(usuarios, /permisosSensiblesService\.verificarAutorizacionPerfiles/);
    assert.match(usuarios, /permisosSensiblesService\.aplicarPermisosSensibles/);
    assert.match(usuarios, /FOR UPDATE/);
    assert.match(usuarios, /clave = ANY\(\$2::varchar\[\]\)/);
    assert.match(usuarios, /NOT \(permiso_clave = ANY\(\$3::varchar\[\]\)\)/);
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

test('Fase 4C: la puerta fiscal exige el permiso sensible y conserva la separación de funciones', () => {
    const fiscal = leer('../services/faregas-autorizacion-fiscal.service.js');
    assert.doesNotMatch(fiscal, /row\.perfil_id !== 'SISTEMAS'/);
    assert.match(fiscal, /row\.usuario_solicitante === username/);
    assert.match(fiscal, /row\.tiene_permiso/);
    assert.match(fiscal, /row\.tiene_sede/);
});
