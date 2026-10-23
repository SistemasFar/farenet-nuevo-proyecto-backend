const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.NODE_ENV = 'test';

const {
    _private,
} = require('../services/faregas-solicitudes-operacion.service');
const {
    TIPOS_SOLICITUD,
    ESTADOS_SOLICITUD,
    ESTADOS_QUE_BLOQUEAN,
    PERMISOS_SOLICITUD,
} = require('../services/faregas-solicitudes-operacion.constants');

const UUID_1 = '123e4567-e89b-42d3-a456-426614174000';
const UUID_2 = '123e4567-e89b-42d3-a456-426614174001';
const UUID_3 = '123e4567-e89b-42d3-a456-426614174002';

const filaSolicitud = (overrides = {}) => ({
    id: 1,
    tipo_operacion: 'ANULAR_AMBOS',
    certificado_id: 10,
    facturacion_id: 20,
    empresa_key: 'FAREGAS',
    planta_key: 'SURCO',
    usuario_solicitante: 'operador',
    motivo: 'Documento extraviado por el cliente',
    observaciones: null,
    estado: 'PENDIENTE_APROBACION',
    usuario_decision: null,
    fecha_solicitud: new Date('2026-10-22T10:00:00Z'),
    fecha_decision: null,
    justificacion_decision: null,
    datos_originales_certificado: { id: 10, numero: 'DG-41-0001', tipo: 'GLP_INICIAL', estado: 'EMITIDO', placa: 'ABC123' },
    datos_originales_comprobante: { id: 20, numero: 'BBB1-1', estado: 'ACEPTADO' },
    datos_propuestos: null,
    fecha_emision_original: '2026-10-20',
    resultado_tecnico: null,
    resultado_fiscal: null,
    idempotencia_clave: UUID_1,
    version: 1,
    fecha_creacion: new Date('2026-10-22T10:00:00Z'),
    fecha_modificacion: null,
    ...overrides,
});

const crearDbSimulada = (opciones = {}) => {
    const estado = {
        solicitudes: (opciones.solicitudes || []).map((item) => ({ ...item })),
        eventos: [],
        secuencia: Math.max(0, ...(opciones.solicitudes || []).map((item) => Number(item.id))) + 1,
        usuarios: {
            operador: { username: 'operador', perfil_id: 'OPERADOR', estado: true },
            jefe: { username: 'jefe', perfil_id: 'JEFE_PLANTA', estado: true },
            sistemas: { username: 'sistemas', perfil_id: 'SISTEMAS', estado: true },
            sinpermiso: { username: 'sinpermiso', perfil_id: 'SUPERVISOR', estado: true },
            otro: { username: 'otro', perfil_id: 'OPERADOR', estado: true },
        },
        permisos: {
            OPERADOR: [PERMISOS_SOLICITUD.CREAR, PERMISOS_SOLICITUD.VER],
            JEFE_PLANTA: [PERMISOS_SOLICITUD.VER, PERMISOS_SOLICITUD.APROBAR, PERMISOS_SOLICITUD.RECHAZAR],
            SISTEMAS: [PERMISOS_SOLICITUD.VER, PERMISOS_SOLICITUD.APROBAR, PERMISOS_SOLICITUD.RECHAZAR, PERMISOS_SOLICITUD.ADMINISTRAR],
            SUPERVISOR: [],
        },
        plantas: {
            operador: opciones.plantasOperador || ['SURCO'],
            jefe: opciones.plantasJefe || ['SURCO'],
            sistemas: opciones.plantasSistemas || ['SURCO'],
            sinpermiso: ['SURCO'],
            otro: opciones.plantasOtro || ['SURQUILLO'],
        },
        contexto: opciones.contexto === undefined ? {
            certificado_id: 10,
            numero_certificado: 'DG-41-0001',
            tipo_certificado_clave: 'GLP_INICIAL',
            tipo_certificado_nombre: 'Certificado inicial GLP',
            certificado_estado: 'EMITIDO',
            fecha_emision: '2026-10-20',
            planta_key: 'SURCO',
            planta_nombre: 'Surco',
            empresa_key: 'FAREGAS',
            empresa_nombre: 'FAREGAS S.A.C.',
            placa: 'ABC123',
            facturacion_id: 20,
            tipo_comprobante: 'BOLETA',
            nro_comprobante: 'BBB1-1',
            facturacion_estado: 'ACEPTADO',
            aceptada_sunat: true,
            fecha_documento: '2026-10-20',
            importe_total: '90.00',
            tipo_documento_cliente: 'DNI',
        } : opciones.contexto,
    };

    const resultado = (rows) => ({ rows, rowCount: rows.length });
    const query = async (sql, params = []) => {
        const normal = String(sql).replace(/\s+/g, ' ').trim();
        if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(normal)) return resultado([]);
        if (normal.includes('FROM fg_usuario') && normal.includes('WHERE username = $1')) {
            const usuario = estado.usuarios[params[0]];
            return resultado(usuario ? [usuario] : []);
        }
        if (normal.includes('FROM fg_perfil_permiso pp')) {
            return resultado((estado.permisos[params[0]] || []).map((permiso_clave) => ({ permiso_clave })));
        }
        if (normal.includes('FROM fg_usuario_planta up')) {
            const username = params[0];
            const plantas = estado.plantas[username] || [];
            if (params.length >= 3) return resultado(plantas.includes(params[2]) ? [{ '?column?': 1 }] : []);
            return resultado(plantas.map((plantas_key) => ({ plantas_key })));
        }
        if (normal.includes('FROM fg_certificado c') && normal.includes('WHERE c.id = $1')) {
            if (!estado.contexto || Number(params[0]) !== Number(estado.contexto.certificado_id)) return resultado([]);
            return resultado([{ ...estado.contexto }]);
        }
        if (normal.includes('WHERE usuario_solicitante = $1 AND idempotencia_clave')) {
            return resultado(estado.solicitudes.filter((item) => item.usuario_solicitante === params[0] && item.idempotencia_clave === params[1]).slice(0, 1));
        }
        if (normal.startsWith('SELECT id, tipo_operacion, estado FROM fg_solicitud_operacion')) {
            const bloqueadores = params[0];
            return resultado(estado.solicitudes.filter((item) => bloqueadores.includes(item.estado)
                && (Number(item.certificado_id) === Number(params[1]) || (params[2] !== null && Number(item.facturacion_id) === Number(params[2])))).slice(0, 1));
        }
        if (normal.startsWith('INSERT INTO fg_solicitud_operacion (')) {
            const nueva = filaSolicitud({
                id: estado.secuencia++, tipo_operacion: params[0], certificado_id: params[1], facturacion_id: params[2],
                empresa_key: params[3], planta_key: params[4], usuario_solicitante: params[5], motivo: params[6],
                observaciones: params[7], datos_originales_certificado: JSON.parse(params[8]),
                datos_originales_comprobante: params[9] ? JSON.parse(params[9]) : null,
                datos_propuestos: params[10] ? JSON.parse(params[10]) : null,
                fecha_emision_original: params[11], idempotencia_clave: params[12],
            });
            estado.solicitudes.push(nueva);
            return resultado([{ ...nueva }]);
        }
        if (normal.startsWith('INSERT INTO fg_solicitud_operacion_evento')) {
            const evento = {
                id: estado.eventos.length + 1, solicitud_id: params[0], tipo_evento: params[1],
                estado_anterior: params[2], estado_posterior: params[3], usuario_responsable: params[4],
                fecha_evento: new Date(), comentario: params[5], metadatos: params[6] ? JSON.parse(params[6]) : null,
            };
            estado.eventos.push(evento);
            return resultado([]);
        }
        if (normal.includes('FROM fg_solicitud_operacion s') && normal.includes('WHERE s.id = $1')) {
            return resultado(estado.solicitudes.filter((item) => Number(item.id) === Number(params[0])).map((item) => ({
                ...item, planta_nombre: item.planta_key, empresa_nombre: item.empresa_key,
                numero_certificado: item.datos_originales_certificado?.numero,
                tipo_certificado_nombre: item.datos_originales_certificado?.tipo,
                nro_comprobante: item.datos_originales_comprobante?.numero,
                placa: item.datos_originales_certificado?.placa,
            })));
        }
        if (normal.startsWith('UPDATE fg_solicitud_operacion')) {
            const cancelacion = normal.includes("SET estado = 'CANCELADA'");
            const id = cancelacion ? params[2] : params[3];
            const version = cancelacion ? params[3] : params[4];
            const item = estado.solicitudes.find((solicitud) => Number(solicitud.id) === Number(id)
                && solicitud.estado === 'PENDIENTE_APROBACION' && Number(solicitud.version) === Number(version));
            if (!item) return resultado([]);
            item.estado = cancelacion ? 'CANCELADA' : params[0];
            item.usuario_decision = cancelacion ? params[0] : params[1];
            item.justificacion_decision = cancelacion ? params[1] : params[2];
            item.fecha_decision = new Date(); item.version += 1; item.fecha_modificacion = new Date();
            return resultado([{ ...item }]);
        }
        if (normal.includes('FROM fg_solicitud_operacion_evento')) {
            return resultado(estado.eventos.filter((item) => Number(item.solicitud_id) === Number(params[0])));
        }
        if (normal.startsWith('SELECT COUNT(*)::int AS total FROM fg_solicitud_operacion')) {
            return resultado([{ total: estado.solicitudes.length }]);
        }
        if (normal.includes('FROM fg_solicitud_operacion s') && normal.includes('ORDER BY s.fecha_solicitud')) {
            return resultado(estado.solicitudes.map((item) => ({ ...item })));
        }
        throw new Error(`Consulta no simulada: ${normal}`);
    };
    const client = { query, release() {} };
    return { query, connect: async () => client, estado };
};

const entradaValida = (overrides = {}) => ({
    certificadoId: 10,
    tipoOperacion: 'ANULAR_AMBOS',
    motivo: 'Documento extraviado por el cliente',
    idempotenciaClave: UUID_1,
    ...overrides,
});
const usuario = (username, perfil_id) => ({ username, perfil_id, planta_key: 'SURCO' });
const capturarCodigo = async (promesa) => {
    try { await promesa; return null; } catch (error) { return error.code; }
};

test('1. crea una solicitud válida sin ejecutar documentos', async () => {
    const db = crearDbSimulada(); const servicio = _private.crearServicio(db);
    const respuesta = await servicio.crear(entradaValida(), usuario('operador', 'OPERADOR'));
    assert.equal(respuesta.creada, true); assert.equal(respuesta.solicitud.estado, 'PENDIENTE_APROBACION');
    assert.equal(db.estado.eventos[0].tipo_evento, 'SOLICITUD_CREADA');
});

test('2. rechaza una solicitud sin motivo', async () => {
    const servicio = _private.crearServicio(crearDbSimulada());
    assert.equal(await capturarCodigo(servicio.crear(entradaValida({ motivo: ' ' }), usuario('operador', 'OPERADOR'))), 'CAMPO_OBLIGATORIO');
});

test('3. rechaza certificado inexistente', async () => {
    const servicio = _private.crearServicio(crearDbSimulada({ contexto: null }));
    assert.equal(await capturarCodigo(servicio.crear(entradaValida(), usuario('operador', 'OPERADOR'))), 'CERTIFICADO_NO_ENCONTRADO');
});

test('4. rechaza certificado de otra sede', async () => {
    const servicio = _private.crearServicio(crearDbSimulada({ plantasOperador: ['SURQUILLO'] }));
    assert.equal(await capturarCodigo(servicio.crear(entradaValida(), usuario('operador', 'OPERADOR'))), 'SOLICITUD_SEDE_NO_AUTORIZADA');
});

test('5. permite al operador autorizado solicitar en su sede', async () => {
    const servicio = _private.crearServicio(crearDbSimulada());
    assert.equal((await servicio.crear(entradaValida(), usuario('operador', 'OPERADOR'))).solicitud.usuarioSolicitante, 'operador');
});

test('6. aprobación sin permiso responde fail-closed', async () => {
    const servicio = _private.crearServicio(crearDbSimulada({ solicitudes: [filaSolicitud()] }));
    assert.equal(await capturarCodigo(servicio.aprobar(1, { version: 1 }, usuario('sinpermiso', 'SUPERVISOR'))), 'SOLICITUD_PERMISO_DENEGADO');
});

test('7. rechazo sin permiso responde fail-closed', async () => {
    const servicio = _private.crearServicio(crearDbSimulada({ solicitudes: [filaSolicitud()] }));
    assert.equal(await capturarCodigo(servicio.rechazar(1, { version: 1, justificacion: 'No corresponde' }, usuario('sinpermiso', 'SUPERVISOR'))), 'SOLICITUD_PERMISO_DENEGADO');
});

test('7b. JEFE_PLANTA no puede decidir incluso si conserva un permiso de sesión obsoleto', async () => {
    const servicio = _private.crearServicio(crearDbSimulada({ solicitudes: [filaSolicitud()] }));
    assert.equal(
        await capturarCodigo(servicio.aprobar(1, { version: 1 }, usuario('jefe', 'JEFE_PLANTA'))),
        'SOLICITUD_DECISION_EXCLUSIVA_SISTEMAS'
    );
});

test('8. nadie puede aprobar su propia solicitud', async () => {
    const db = crearDbSimulada({ solicitudes: [filaSolicitud({ usuario_solicitante: 'sistemas' })] });
    const servicio = _private.crearServicio(db);
    assert.equal(await capturarCodigo(servicio.aprobar(1, { version: 1 }, usuario('sistemas', 'SISTEMAS'))), 'SOLICITUD_AUTODECISION_PROHIBIDA');
});

test('9. otro usuario autorizado aprueba sin ejecutar la operación', async () => {
    const db = crearDbSimulada({ solicitudes: [filaSolicitud()] }); const servicio = _private.crearServicio(db);
    const aprobada = await servicio.aprobar(1, { version: 1, justificacion: 'Conforme' }, usuario('sistemas', 'SISTEMAS'));
    assert.equal(aprobada.estado, 'APROBADA'); assert.equal(aprobada.resultadoTecnico, null); assert.equal(aprobada.resultadoFiscal, null);
});

test('10. una solicitud aprobada no se puede aprobar nuevamente', async () => {
    const servicio = _private.crearServicio(crearDbSimulada({ solicitudes: [filaSolicitud({ estado: 'APROBADA', version: 2 })] }));
    assert.equal(await capturarCodigo(servicio.aprobar(1, { version: 2 }, usuario('sistemas', 'SISTEMAS'))), 'SOLICITUD_NO_DECIDIBLE');
});

test('11. una solicitud rechazada no se puede decidir nuevamente', async () => {
    const servicio = _private.crearServicio(crearDbSimulada({ solicitudes: [filaSolicitud({ estado: 'RECHAZADA', version: 2 })] }));
    assert.equal(await capturarCodigo(servicio.aprobar(1, { version: 2 }, usuario('sistemas', 'SISTEMAS'))), 'SOLICITUD_NO_DECIDIBLE');
});

test('12. una doble aprobación conserva una sola decisión', async () => {
    const db = crearDbSimulada({ solicitudes: [filaSolicitud()] }); const servicio = _private.crearServicio(db);
    await servicio.aprobar(1, { version: 1 }, usuario('sistemas', 'SISTEMAS'));
    assert.equal(await capturarCodigo(servicio.aprobar(1, { version: 1 }, usuario('sistemas', 'SISTEMAS'))), 'SOLICITUD_NO_DECIDIBLE');
    assert.equal(db.estado.eventos.filter((evento) => evento.tipo_evento === 'SOLICITUD_APROBADA').length, 1);
});

test('13. doble clic con la misma idempotencia devuelve la solicitud existente', async () => {
    const db = crearDbSimulada(); const servicio = _private.crearServicio(db);
    const primera = await servicio.crear(entradaValida(), usuario('operador', 'OPERADOR'));
    const segunda = await servicio.crear(entradaValida(), usuario('operador', 'OPERADOR'));
    assert.equal(primera.solicitud.id, segunda.solicitud.id); assert.equal(segunda.creada, false); assert.equal(db.estado.solicitudes.length, 1);
});

test('14. consulta el historial inmutable de la solicitud', async () => {
    const db = crearDbSimulada(); const servicio = _private.crearServicio(db);
    const creada = await servicio.crear(entradaValida(), usuario('operador', 'OPERADOR'));
    const eventos = await servicio.historial(creada.solicitud.id, usuario('operador', 'OPERADOR'));
    assert.equal(eventos.length, 1); assert.equal(eventos[0].estadoPosterior, 'PENDIENTE_APROBACION');
});

test('15. empresa y sede se resuelven desde el certificado, no desde React', async () => {
    const db = crearDbSimulada(); const servicio = _private.crearServicio(db);
    const creada = await servicio.crear(entradaValida({ empresaKey: 'OTRA', plantaKey: 'OTRA' }), usuario('operador', 'OPERADOR'));
    assert.equal(creada.solicitud.empresaKey, 'FAREGAS'); assert.equal(creada.solicitud.plantaKey, 'SURCO');
});

test('16. un revisor no puede cruzar sedes', async () => {
    const servicio = _private.crearServicio(crearDbSimulada({ solicitudes: [filaSolicitud()], plantasSistemas: ['SURQUILLO'] }));
    assert.equal(await capturarCodigo(servicio.aprobar(1, { version: 1 }, usuario('sistemas', 'SISTEMAS'))), 'SOLICITUD_SEDE_NO_AUTORIZADA');
});

test('17. el solicitante puede cancelar mientras está pendiente', async () => {
    const servicio = _private.crearServicio(crearDbSimulada({ solicitudes: [filaSolicitud()] }));
    assert.equal((await servicio.cancelar(1, { version: 1, comentario: 'Ya no se requiere' }, usuario('operador', 'OPERADOR'))).estado, 'CANCELADA');
});

test('18. no se puede cancelar después de aprobada', async () => {
    const servicio = _private.crearServicio(crearDbSimulada({ solicitudes: [filaSolicitud({ estado: 'APROBADA', version: 2 })] }));
    assert.equal(await capturarCodigo(servicio.cancelar(1, { version: 2, comentario: 'Cancelar' }, usuario('operador', 'OPERADOR'))), 'SOLICITUD_NO_CANCELABLE');
});

test('19. toda decisión registra estado anterior, posterior y responsable', async () => {
    const db = crearDbSimulada({ solicitudes: [filaSolicitud()] }); const servicio = _private.crearServicio(db);
    await servicio.rechazar(1, { version: 1, justificacion: 'Falta sustento' }, usuario('sistemas', 'SISTEMAS'));
    assert.equal(db.estado.eventos[0].estado_anterior, 'PENDIENTE_APROBACION');
    assert.equal(db.estado.eventos[0].estado_posterior, 'RECHAZADA');
    assert.equal(db.estado.eventos[0].usuario_responsable, 'sistemas');
});

const serviceSource = fs.readFileSync(path.join(__dirname, '../services/faregas-solicitudes-operacion.service.js'), 'utf8');
const migrationSource = fs.readFileSync(path.join(__dirname, '../database/migrations_history/20261022_faregas_fase1_solicitudes_administrativas.sql'), 'utf8');
const masterSource = fs.readFileSync(path.join(__dirname, '../database/migrations/0001_faregas_schema.sql'), 'utf8');

test('20. el módulo no modifica fg_certificado', () => assert.doesNotMatch(serviceSource, /UPDATE\s+fg_certificado|DELETE\s+FROM\s+fg_certificado/i));
test('21. el módulo no modifica fg_facturacion', () => assert.doesNotMatch(serviceSource, /UPDATE\s+fg_facturacion|INSERT\s+INTO\s+fg_facturacion|DELETE\s+FROM\s+fg_facturacion/i));
test('22. el módulo no modifica pagos', () => assert.doesNotMatch(serviceSource, /fg_pago|fg_orden_pago/i));
test('23. el módulo no consume correlativos DG', () => assert.doesNotMatch(serviceSource, /fg_correlativo|numero_certificado\s*=/i));
test('24. el módulo no importa ni llama a NubeFact', () => assert.doesNotMatch(serviceSource, /nubefact|integrations\/nubefact/i));

test('25. conserva la regresión de seguridad de Fase 0', () => {
    const fase0 = fs.readFileSync(path.join(__dirname, '../database/migrations_history/20261022_faregas_fase0_seguridad_documentos.sql'), 'utf8');
    assert.match(fase0, /FAREGAS_ANULAR_COMPROBANTE/); assert.match(fase0, /FAREGAS_NOTA_CREDITO/);
});

test('26. una solicitud activa o aprobada bloquea otra incompatible', async () => {
    const servicio = _private.crearServicio(crearDbSimulada({ solicitudes: [filaSolicitud({ estado: 'APROBADA' })] }));
    assert.equal(await capturarCodigo(servicio.crear(entradaValida({ idempotenciaClave: UUID_2 }), usuario('operador', 'OPERADOR'))), 'SOLICITUD_INCOMPATIBLE_ACTIVA');
});

test('27. solicitudes rechazadas y canceladas no bloquean una nueva', async () => {
    for (const estado of ['RECHAZADA', 'CANCELADA', 'COMPLETADA', 'ERROR']) {
        const servicio = _private.crearServicio(crearDbSimulada({ solicitudes: [filaSolicitud({ estado })] }));
        const creada = await servicio.crear(entradaValida({ idempotenciaClave: estado === 'RECHAZADA' ? UUID_2 : UUID_3 }), usuario('operador', 'OPERADOR'));
        assert.equal(creada.creada, true);
    }
});

test('28. una rectificación exige datos propuestos y rechaza campos protegidos', () => {
    assert.throws(() => _private.validarDatosPropuestos('RECTIFICAR_CERTIFICADO', null), { code: 'DATOS_PROPUESTOS_REQUERIDOS' });
    assert.throws(() => _private.validarDatosPropuestos('RECTIFICAR_CERTIFICADO', { fecha_emision: '2026-01-01' }), { code: 'DATO_PROPUESTO_PROHIBIDO' });
    assert.deepEqual(_private.validarDatosPropuestos('RECTIFICAR_CERTIFICADO', { descripcion: 'Corregir color' }), { descripcion: 'Corregir color' });
});

test('29. esquema maestro y migración incremental contienen tablas, estados e índices activos', () => {
    for (const contenido of [migrationSource, masterSource]) {
        assert.match(contenido, /fg_solicitud_operacion/);
        assert.match(contenido, /fg_solicitud_operacion_evento/);
        assert.match(contenido, /PENDIENTE_APROBACION/);
        assert.match(contenido, /REQUIERE_INTERVENCION/);
        assert.match(contenido, /uq_fg_solicitud_activa_certificado/);
    }
});

test('30. catálogos centralizados contienen seis tipos, ocho estados y bloqueo administrativo', () => {
    assert.equal(TIPOS_SOLICITUD.length, 6); assert.equal(ESTADOS_SOLICITUD.length, 8);
    assert.deepEqual(ESTADOS_QUE_BLOQUEAN, ['PENDIENTE_APROBACION', 'APROBADA', 'EN_EJECUCION', 'REQUIERE_INTERVENCION']);
});
