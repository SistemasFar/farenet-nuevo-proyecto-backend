const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.NODE_ENV = 'test';

const { _private } = require('../services/faregas-solicitudes-operacion.service');

const UUID = '123e4567-e89b-42d3-a456-426614174000';

const crearDb = ({
    perfil = 'OPERADOR',
    facturacion = null,
    permisos = ['FAREGAS_SOLICITUD_CREAR', 'FAREGAS_SOLICITUD_VER']
} = {}) => {
    const eventos = [];
    const contexto = {
        certificado_id: 10,
        numero_certificado: 'DG-41-000100',
        tipo_certificado_clave: 'GLP_INICIAL',
        tipo_certificado_nombre: 'Certificado inicial GLP',
        certificado_estado: 'EMITIDO',
        fecha_emision: '2026-10-20',
        fecha_anulacion: null,
        planta_key: 'SURCO',
        planta_nombre: 'Surco',
        empresa_key: 'FAREGAS',
        empresa_nombre: 'FAREGAS',
        placa: 'ABC123',
        facturacion_id: facturacion?.id || null,
        tipo_comprobante: facturacion?.tipo || null,
        nro_comprobante: facturacion?.numero || null,
        facturacion_estado: facturacion?.estado || null,
        fecha_documento: facturacion?.fecha || null,
        importe_total: facturacion?.total || null,
        tipo_documento_cliente: facturacion?.tipoDocumento || null,
        aceptada_sunat: facturacion?.aceptadaSunat ?? null,
        proveedor: facturacion?.proveedor || null,
        entorno_facturador: facturacion?.entorno || null,
        serie: facturacion?.serie || null,
        numero: facturacion?.correlativo || null,
        enlace_pdf: facturacion?.pdf || null
    };
    const resultado = (rows = []) => ({ rows, rowCount: rows.length });
    const query = async (sql, params = []) => {
        const normal = String(sql).replace(/\s+/g, ' ').trim();
        if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(normal)) return resultado();
        if (normal.includes('FROM fg_usuario') && normal.includes('WHERE username = $1')) {
            return resultado([{ username: params[0], perfil_id: perfil, estado: true }]);
        }
        if (normal.includes('FROM fg_perfil_permiso pp')) {
            return resultado(permisos.map((permiso_clave) => ({ permiso_clave })));
        }
        if (normal.includes('FROM fg_usuario_planta up')) return resultado([{ existe: 1 }]);
        if (normal.includes('FROM fg_certificado c') && normal.includes('WHERE c.id = $1')) return resultado([contexto]);
        if (normal.includes('WHERE usuario_solicitante = $1 AND idempotencia_clave')) return resultado();
        if (normal.startsWith('SELECT id, tipo_operacion, estado FROM fg_solicitud_operacion')) return resultado();
        if (normal.startsWith('INSERT INTO fg_solicitud_operacion (')) {
            return resultado([{
                id: 99,
                tipo_operacion: params[0],
                certificado_id: params[1],
                facturacion_id: params[2],
                empresa_key: params[3],
                planta_key: params[4],
                usuario_solicitante: params[5],
                motivo: params[6],
                observaciones: params[7],
                estado: 'PENDIENTE_APROBACION',
                datos_originales_certificado: JSON.parse(params[8]),
                datos_originales_comprobante: params[9] ? JSON.parse(params[9]) : null,
                datos_propuestos: null,
                fecha_emision_original: params[11],
                idempotencia_clave: params[12],
                version: 1
            }]);
        }
        if (normal.startsWith('INSERT INTO fg_solicitud_operacion_evento')) {
            eventos.push(params);
            return resultado();
        }
        throw new Error(`Consulta no simulada: ${normal}`);
    };
    const client = { query, release() {} };
    return { query, connect: async () => client, eventos };
};

const codigo = async (fn) => {
    try { await fn(); return null; } catch (error) { return error.code; }
};

test('Paso A: OPERADOR crea únicamente ANULAR_AMBOS sin ejecutar documentos', async () => {
    const db = crearDb();
    const servicio = _private.crearServicio(db);
    const respuesta = await servicio.crearAnulacionTotal({
        certificadoId: 10,
        tipoOperacion: 'ANULAR_AMBOS',
        motivo: 'Error detectado en el documento emitido',
        idempotenciaClave: UUID
    }, { username: 'operador' });
    assert.equal(respuesta.solicitud.tipoOperacion, 'ANULAR_AMBOS');
    assert.equal(respuesta.solicitud.estado, 'PENDIENTE_APROBACION');
    assert.equal(respuesta.solicitud.facturacionId, null);
    assert.equal(db.eventos.length, 1);
});

test('Paso A: comprobante ausente o pendiente no se inventa como baja fiscal aceptada', async () => {
    const sinComprobante = _private.estadoSolicitudComprobante({ facturacion_id: null });
    assert.equal(sinComprobante.disponible, false);
    assert.equal(sinComprobante.codigo, 'SOLICITUD_COMPROBANTE_REQUERIDO');

    const pendiente = _private.estadoSolicitudComprobante({
        facturacion_id: 20,
        facturacion_estado: 'PENDIENTE',
        aceptada_sunat: false
    });
    assert.equal(pendiente.disponible, false);
    assert.equal(pendiente.codigo, 'SOLICITUD_COMPROBANTE_NO_EMITIDO');
});

test('Paso A/4C: tipos anteriores y propuestas se bloquean; la creación depende de RBAC', async () => {
    const operador = _private.crearServicio(crearDb());
    assert.equal(await codigo(() => operador.crearAnulacionTotal({
        certificadoId: 10,
        tipoOperacion: 'ANULAR_CERTIFICADO',
        motivo: 'No permitido',
        idempotenciaClave: UUID
    }, { username: 'operador' })), 'TIPO_SOLICITUD_NO_DISPONIBLE');
    assert.equal(await codigo(() => operador.crearAnulacionTotal({
        certificadoId: 10,
        tipoOperacion: 'ANULAR_AMBOS',
        motivo: 'No permitido',
        datosPropuestos: { placa: 'XYZ999' },
        idempotenciaClave: UUID
    }, { username: 'operador' })), 'DATOS_PROPUESTOS_NO_PERMITIDOS');

    const sistemas = _private.crearServicio(crearDb({ perfil: 'SISTEMAS' }));
    const creadaSistemas = await sistemas.crearAnulacionTotal({
        certificadoId: 10,
        tipoOperacion: 'ANULAR_AMBOS',
        motivo: 'Solicitud originada por Sistemas para revisión ajena',
        idempotenciaClave: UUID
    }, { username: 'sistemas' });
    assert.equal(creadaSistemas.solicitud.usuarioSolicitante, 'sistemas');

    const sinPermiso = _private.crearServicio(crearDb({ perfil: 'SUPERVISOR', permisos: ['FAREGAS_SOLICITUD_VER'] }));
    assert.equal(await codigo(() => sinPermiso.crearAnulacionTotal({
        certificadoId: 10,
        tipoOperacion: 'ANULAR_AMBOS',
        motivo: 'No debe registrarse',
        idempotenciaClave: UUID
    }, { username: 'supervisor' })), 'SOLICITUD_PERMISO_DENEGADO');
});

test('Paso A/4B: rutas parciales no se exponen y la ejecución fiscal conserva puerta administrativa', () => {
    const routes = fs.readFileSync(path.join(__dirname, '../routes/faregas-solicitudes-operacion.routes.js'), 'utf8');
    const documentos = fs.readFileSync(path.join(__dirname, '../controllers/faregas-documentos-electronicos.controller.js'), 'utf8');
    assert.doesNotMatch(routes, /router\.post\('\/:id\/ejecutar-anulacion-certificado'/);
    assert.doesNotMatch(routes, /router\.post\('\/:id\/ejecutar-rectificacion-certificado'/);
    assert.match(routes, /router\.post\('\/:id\/ejecutar-anulacion-total'/);
    assert.match(documentos, /validarSolicitudAprobada/);
});

test('Paso A: esquema maestro y migración reflejan ANULAR_AMBOS y RBAC definitivo', () => {
    const database = path.join(__dirname, '../database');
    const master = fs.readFileSync(path.join(database, 'migrations/0001_faregas_schema.sql'), 'utf8');
    const migration = fs.readFileSync(path.join(database, 'migrations_history/20261023_faregas_fase4a_anulacion_total.sql'), 'utf8');
    for (const sql of [master, migration]) {
        assert.match(sql, /tipo_operacion = 'ANULAR_AMBOS' AND certificado_id IS NOT NULL/);
    }
    assert.match(migration, /DELETE FROM public\.fg_perfil_permiso[\s\S]*perfil_clave = 'JEFE_PLANTA'/);
    assert.match(migration, /'SISTEMAS'::varchar, 'FAREGAS_SOLICITUD_APROBAR'/);
    assert.doesNotMatch(master, /fg_regularizacion_fiscal/);
});
