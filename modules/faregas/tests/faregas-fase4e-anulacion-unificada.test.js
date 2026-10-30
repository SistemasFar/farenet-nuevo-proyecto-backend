const test = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';

const { _private } = require('../services/faregas-solicitudes-operacion.service');

const PERMISOS_APROBADOR = [
    'FAREGAS_SOLICITUD_VER',
    'FAREGAS_SOLICITUD_APROBAR',
    'FAREGAS_SOLICITUD_RECHAZAR',
    'FAREGAS_SOLICITUD_ADMINISTRAR',
    'FAREGAS_CERTIFICADO_ANULAR_EJECUTAR'
];

const PERMISOS_AUTOEJECUCION = [
    ...PERMISOS_APROBADOR,
    'FAREGAS_SOLICITUD_AUTOAPROBAR',
    'FAREGAS_SOLICITUD_AUTOEJECUTAR'
];

const crearMockDb = ({
    perfilUsuario = 'SISTEMAS',
    usernameUsuario = 'sistemas_user',
    permisos = PERMISOS_APROBADOR,
    plantasUsuario = ['PLANTA_SURCO'],
    solicitudOverrides = {},
    facturacionOverrides = null,
    notasExistentes = [],
    bajasExistentes = [],
    candidatosReconciliacion = [],
    fallarCierre = false
} = {}) => {
    const eventos = [];
    let cierreFallido = false;

    const solicitud = {
        id: 18,
        tipo_operacion: 'ANULAR_AMBOS',
        certificado_id: 687,
        facturacion_id: facturacionOverrides !== null ? 848 : null,
        empresa_key: 'FAREGAS',
        empresa_nombre: 'Faregas SAC',
        planta_key: 'PLANTA_SURCO',
        planta_nombre: 'Sede Surco',
        usuario_solicitante: 'mquijano',
        motivo: 'Solicitud de anulación total registrada por el operador',
        observaciones: null,
        estado: 'PENDIENTE_APROBACION',
        usuario_decision: null,
        fecha_solicitud: '2026-10-26T10:00:00Z',
        fecha_decision: null,
        justificacion_decision: null,
        datos_originales_certificado: { placa: 'ABC-123', numero: 'DG-41-000323' },
        datos_originales_comprobante: facturacionOverrides !== null ? { numero: 'BBB1-00000241' } : null,
        datos_propuestos: null,
        fecha_emision_original: '2026-10-26',
        precio_certificado: 118.00,
        importe_total: facturacionOverrides !== null
            ? (facturacionOverrides?.importe_total ?? 118.00)
            : null,
        resultado_tecnico: null,
        resultado_fiscal: null,
        idempotencia_clave: '11111111-1111-4111-8111-111111111111',
        usuario_ejecucion: null,
        fecha_ejecucion: null,
        idempotencia_ejecucion: null,
        autorizacion_autoejecucion: false,
        version: 1,
        numero_certificado: 'DG-41-000323',
        tipo_certificado_nombre: 'Certificado GNV Inicial',
        nro_comprobante: facturacionOverrides !== null ? 'BBB1-00000241' : null,
        placa: 'ABC-123',
        ...solicitudOverrides
    };

    const certificado = {
        id: 687,
        numero_certificado: 'DG-41-000323',
        tipo_certificado_clave: 'GNV_INICIAL',
        planta_key: 'PLANTA_SURCO',
        empresa_key: 'FAREGAS',
        estado: 'EMITIDO',
        fecha_emision: '2026-10-26',
        precio_certificado: 118.00,
        precio_chip: 0,
        producto_chip_id: null
    };

    const facturacion = facturacionOverrides !== null ? {
        id: 848,
        tipo_comprobante: 'BOLETA',
        serie: 'BBB1',
        numero: 241,
        nro_comprobante: 'BBB1-00000241',
        importe_total: 118.00,
        base_imponible: 100.00,
        igv: 18.00,
        estado: 'ACEPTADO',
        aceptada_sunat: true,
        planta_key: 'PLANTA_SURCO',
        empresa_key: 'FAREGAS',
        ...facturacionOverrides
    } : null;

    const res = (rows = []) => ({ rows, rowCount: rows.length });

    const query = async (sql, params = []) => {
        const normal = String(sql).replace(/\s+/g, ' ').trim();


        if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(normal)) return res();

        if (normal.includes('FAREGAS_RECONCILIAR_ANULACIONES_EXISTENTES')) {
            return res(candidatosReconciliacion);
        }

        if (normal.includes('FROM fg_usuario') && normal.includes('WHERE username = $1')) {
            return res([{ username: params[0], perfil_id: perfilUsuario, estado: true }]);
        }
        if (normal.includes('FROM fg_perfil_permiso pp') && normal.includes('pp.permiso_clave = $2')) {
            return permisos.includes(params[1])
                ? res([{ acceso_global: true, permiso_clave: params[1] }])
                : res([]);
        }
        if (normal.includes('FROM fg_perfil_permiso pp')) {
            return res(permisos.map((p) => ({ permiso_clave: p })));
        }
        if (normal.includes('SELECT DISTINCT p.key, p.nombre, p.empresa_key')
            && normal.includes('FROM fg_usuario_planta up')) {
            return plantasUsuario.includes(solicitud.planta_key)
                ? res([{
                    key: solicitud.planta_key,
                    nombre: solicitud.planta_key,
                    empresa_key: solicitud.empresa_key
                }]) : res([]);
        }
        if (normal.includes('FROM fg_usuario_planta up')) {
            return plantasUsuario.includes(solicitud.planta_key)
                ? res([{ plantas_key: solicitud.planta_key }]) : res([]);
        }
        if (normal.includes('FROM fg_solicitud_operacion s') && normal.includes('WHERE s.id = $1')) {
            return res([{ ...solicitud }]);
        }
        if (normal.startsWith('SELECT id, estado, tipo_operacion, certificado_id, usuario_solicitante,')) {
            return res([{ ...solicitud }]);
        }
        if (normal.startsWith('SELECT id, estado FROM fg_solicitud_operacion WHERE id = $1')) {
            return res([{ id: solicitud.id, estado: solicitud.estado }]);
        }
        if (normal.startsWith('SELECT * FROM fg_solicitud_operacion WHERE id = $1')) {
            return res([{ ...solicitud }]);
        }
        if (normal.includes('FROM fg_certificado c') && normal.includes('WHERE c.id = $1')) {
            return res([{ ...certificado }]);
        }
        if (normal.includes('FROM fg_facturacion f') && normal.includes('WHERE f.id = $1')) {
            return facturacion ? res([{ ...facturacion }]) : res([]);
        }
        if (normal.includes('FROM fg_facturacion_intento WHERE facturacion_id = $1')) {
            const enPlazo = facturacion?.enPlazo === true;
            return res([{ fecha_emision: '2026-10-26T10:00:00Z', vigente: enPlazo, dentro_plazo_baja: enPlazo }]);
        }
        if (normal.includes('FROM fg_documento_electronico_operacion')) {
            return res([{ id: 1, operacion: 'EMITIR', estado: 'PENDIENTE', error: null, fecha_creacion: '2026-10-26T10:00:00Z' }]);
        }
        if (normal.includes('SELECT COALESCE(SUM(importe_total), 0) AS total FROM fg_credito')) {
            return res([{ total: 0 }]);
        }
        if (normal.includes('AS existe') && normal.includes('fg_documento_anulacion')) {
            return res([{ existe: bajasExistentes.length > 0 || notasExistentes.length > 0 }]);
        }
        if (normal.includes('FROM fg_credito') && normal.includes('WHERE facturacion_id = $1')) {
            if (normal.includes("estado = 'ACEPTADO'")) {
                return res(notasExistentes.filter((row) => row.estado === 'ACEPTADO'));
            }
            if (normal.includes("estado NOT IN ('ACEPTADO', 'RECHAZADO', 'ERROR', 'ERROR_DEFINITIVO')")) {
                return res(notasExistentes.filter((row) => !['ACEPTADO', 'RECHAZADO', 'ERROR', 'ERROR_DEFINITIVO'].includes(row.estado)));
            }
            if (normal.includes("estado IN ('RECHAZADO', 'ERROR', 'ERROR_DEFINITIVO')")) {
                return res(notasExistentes.filter((row) => ['RECHAZADO', 'ERROR', 'ERROR_DEFINITIVO'].includes(row.estado)));
            }
            return res(notasExistentes);
        }
        if (normal.includes('FROM fg_documento_anulacion') && normal.includes('WHERE facturacion_id = $1')) {
            if (normal.includes("estado = 'ACEPTADO'")) {
                return res(bajasExistentes.filter((row) => row.estado === 'ACEPTADO'));
            }
            if (normal.includes("estado NOT IN ('ACEPTADO', 'RECHAZADO', 'ERROR', 'ERROR_DEFINITIVO')")) {
                return res(bajasExistentes.filter((row) => !['ACEPTADO', 'RECHAZADO', 'ERROR', 'ERROR_DEFINITIVO'].includes(row.estado)));
            }
            if (normal.includes("estado IN ('RECHAZADO', 'ERROR', 'ERROR_DEFINITIVO')")) {
                return res(bajasExistentes.filter((row) => ['RECHAZADO', 'ERROR', 'ERROR_DEFINITIVO'].includes(row.estado)));
            }
            return res(bajasExistentes);
        }
        if (normal.startsWith('UPDATE fg_solicitud_operacion')) {
            if (normal.includes("SET estado = 'EN_EJECUCION'")) {
                solicitud.estado = 'EN_EJECUCION';
                solicitud.usuario_ejecucion = params[0];
                solicitud.idempotencia_ejecucion = params[1];
                if (normal.includes('autorizacion_autoejecucion = TRUE')) solicitud.autorizacion_autoejecucion = true;
                return res([{ ...solicitud }]);
            }
            if (normal.includes("SET estado = 'ERROR'")) {
                solicitud.estado = 'ERROR';
                solicitud.version = Number(solicitud.version) + 1;
                return res([{ ...solicitud }]);
            }
            if (normal.includes('usuario_decision = $2')) {
                // UPDATE de decidir(): estado, usuario_decision, justificación, id, versión.
                if (solicitud.estado !== 'PENDIENTE_APROBACION' || Number(solicitud.version) !== Number(params[4])) {
                    return res([]);
                }
                solicitud.estado = params[0];
                solicitud.usuario_decision = params[1];
                solicitud.justificacion_decision = params[2];
                solicitud.fecha_decision = new Date();
                solicitud.version = Number(solicitud.version) + 1;
                return res([{ ...solicitud }]);
            }
            if (normal.includes('SET estado = $1')) {
                if (fallarCierre && !cierreFallido) {
                    cierreFallido = true;
                    throw new Error('Fallo simulado de consolidación');
                }
                solicitud.estado = params[0];
                solicitud.resultado_fiscal = JSON.parse(params[1]);
                solicitud.resultado_tecnico = JSON.parse(params[2]);
                solicitud.version = Number(solicitud.version) + 1;
                return res([{ ...solicitud }]);
            }
        }
        if (normal.startsWith("UPDATE fg_certificado SET estado = 'ANULADO'")) {
            if (certificado.estado !== 'EMITIDO') return res([]);
            certificado.estado = 'ANULADO';
            certificado.solicitud_anulacion_id = params[1];
            return res([{ ...certificado }]);
        }
        if (normal.startsWith('SELECT estado, solicitud_anulacion_id FROM fg_certificado')) {
            return res([{ estado: certificado.estado, solicitud_anulacion_id: certificado.solicitud_anulacion_id || null }]);
        }
        if (normal.startsWith('INSERT INTO fg_solicitud_operacion_evento')) {
            eventos.push(params);
            return res();
        }
        throw new Error(`Consulta SQL mock no manejada: ${normal}`);
    };

    const client = { query, release() {} };
    return {
        query,
        connect: async () => client,
        eventos,
        getSolicitud: () => solicitud,
        getFacturacion: () => facturacion,
        getCertificado: () => certificado
    };
};

const crearDocsMock = ({ baja = 'ACEPTADO', nota = 'ACEPTADO', consultaBaja = null, motivoBaja = null } = {}) => {
    const llamadas = { bajas: 0, notas: 0, consultas: 0, consultasBaja: 0 };
    return {
        llamadas,
        consultarFacturacion: async () => {
            llamadas.consultas += 1;
            return { estado: 'PENDIENTE_SUNAT', respuesta: {} };
        },
        generarAnulacion: async () => {
            llamadas.bajas += 1;
            if (baja === 'ERROR') {
                const error = new Error('Timeout de conexión con el proveedor');
                error.code = 'NUBEFACT_TIMEOUT';
                throw error;
            }
            return { id: 901, estado: baja, ticketSunat: baja === 'PENDIENTE' ? 'TICKET-901' : null, respuesta: {} };
        },
        consultarAnulacion: async (_certificadoId, anulacionId) => {
            llamadas.consultasBaja += 1;
            const estado = consultaBaja || 'PENDIENTE';
            return {
                id: anulacionId,
                estado,
                ticketSunat: estado === 'PENDIENTE' ? 'TICKET-901' : null,
                respuesta: motivoBaja ? { errors: motivoBaja } : {}
            };
        },
        emitirNota: async () => {
            llamadas.notas += 1;
            if (nota === 'ERROR') {
                const error = new Error('Timeout de conexión con el proveedor');
                error.code = 'NUBEFACT_TIMEOUT';
                throw error;
            }
            return { id: 902, estado: nota, nroComprobante: 'FC01-00000046', respuesta: {} };
        }
    };
};

const ejecutarUnificada = (db, docs, entrada = {}) => {
    const servicio = _private.crearServicio(db, { documentosService: docs });
    return servicio.aprobarYEjecutarAnulacionTotal(18, {
        version: db.getSolicitud().version,
        ...entrada
    }, { username: 'sistemas_user' });
};

const capturarError = async (fn) => {
    try {
        await fn();
        return null;
    } catch (error) {
        return error;
    }
};

test('1. Una solicitud pendiente se aprueba y ejecuta en una sola llamada', async () => {
    const db = crearMockDb({ facturacionOverrides: { estado: 'ACEPTADO', enPlazo: true } });
    const docs = crearDocsMock({ baja: 'ACEPTADO' });

    const resultado = await ejecutarUnificada(db, docs);

    assert.equal(resultado.aprobada, true);
    assert.equal(resultado.ejecucionIniciada, true);
    assert.equal(resultado.ejecucionFallida, false);
    assert.equal(docs.llamadas.bajas, 1);
    assert.equal(docs.llamadas.notas, 0);
    assert.equal(db.getSolicitud().estado, 'REQUIERE_INTERVENCION');
    assert.equal(db.getSolicitud().usuario_decision, 'sistemas_user');
    assert.equal(db.getSolicitud().usuario_ejecucion, 'sistemas_user');
    assert.equal(resultado.resultadoFiscal.estado, 'BAJA_ACEPTADA');
    assert.equal(resultado.resultadoFiscal.resuelto, true);
    assert.equal(resultado.resultadoFiscal.tipoOperacion, 'COMUNICACION_BAJA');
    assert.equal(resultado.resultadoTecnico.resuelto, false);
    // La anulación técnica sigue bloqueada por defecto: no se declara COMPLETADA
    // aunque NubeFact haya aceptado la baja.
    assert.equal(resultado.completada, false);
    assert.equal(resultado.requiereIntervencion, true);
});

test('1b. Un importe final cero impide aprobar y ejecutar, sin llamar a NubeFact', async () => {
    const db = crearMockDb({
        facturacionOverrides: { estado: 'ACEPTADO', enPlazo: true, importe_total: 0 }
    });
    const docs = crearDocsMock({ baja: 'ACEPTADO' });

    const error = await capturarError(() => ejecutarUnificada(db, docs));

    assert.ok(error, 'debe rechazar la aprobación');
    assert.equal(error.code, 'CERTIFICADO_IMPORTE_CERO_NO_ANULABLE');
    assert.equal(error.statusCode, 409);
    assert.equal(docs.llamadas.bajas, 0);
    assert.equal(docs.llamadas.notas, 0);
    assert.equal(db.getSolicitud().estado, 'PENDIENTE_APROBACION');
    assert.equal(db.getCertificado().estado, 'EMITIDO');
});

test('1c. La sincronización de una baja ya iniciada no genera otra operación ni completa un certificado gratuito', async () => {
    const db = crearMockDb({
        solicitudOverrides: { estado: 'APROBADA' },
        facturacionOverrides: { estado: 'ACEPTADO', enPlazo: true, importe_total: 0 },
        bajasExistentes: [{ id: 700, facturacion_id: 848, estado: 'ACEPTADO', ticket_sunat: 'BAJA-HISTORICA' }]
    });
    const docs = crearDocsMock({ baja: 'ACEPTADO' });
    const servicio = _private.crearServicio(db, { documentosService: docs });

    const resultado = await servicio.ejecutarAnulacionTotal(18, { soloSincronizar: true }, {
        username: 'sistemas_user'
    });

    assert.equal(docs.llamadas.bajas, 0, 'no debe crear otra baja');
    assert.equal(docs.llamadas.notas, 0, 'no debe crear otra nota');
    assert.equal(db.getSolicitud().estado, 'REQUIERE_INTERVENCION');
    assert.equal(db.getCertificado().estado, 'EMITIDO');
    assert.equal(resultado.completada, false);
    assert.equal(resultado.resultadoTecnico.estado, 'BLOQUEADO_IMPORTE_CERO');
});

test('1d. La sincronización sin una operación fiscal previa se rechaza y no altera la solicitud', async () => {
    const db = crearMockDb({
        solicitudOverrides: { estado: 'APROBADA' },
        facturacionOverrides: { estado: 'ACEPTADO', enPlazo: true, importe_total: 0 }
    });
    const docs = crearDocsMock({ baja: 'ACEPTADO' });
    const servicio = _private.crearServicio(db, { documentosService: docs });

    const error = await capturarError(() => servicio.ejecutarAnulacionTotal(18, {
        soloSincronizar: true
    }, { username: 'sistemas_user' }));

    assert.ok(error);
    assert.equal(error.code, 'CERTIFICADO_IMPORTE_CERO_NO_ANULABLE');
    assert.equal(docs.llamadas.bajas, 0);
    assert.equal(docs.llamadas.notas, 0);
    assert.equal(db.getSolicitud().estado, 'APROBADA');
    assert.equal(db.getCertificado().estado, 'EMITIDO');
});

test('2. El historial registra aprobación y ejecución', async () => {
    const db = crearMockDb({ facturacionOverrides: { estado: 'ACEPTADO', enPlazo: true } });
    const docs = crearDocsMock({ baja: 'ACEPTADO' });

    await ejecutarUnificada(db, docs);

    const tipos = db.eventos.map((params) => params[1]);
    assert.ok(tipos.includes('SOLICITUD_APROBADA'));
    assert.ok(tipos.includes('EJECUCION_INICIADA'));
    assert.ok(tipos.includes('EJECUCION_PARCIAL_REQUIERE_INTERVENCION'));
});

test('3. Un segundo clic no aprueba ni ejecuta dos veces', async () => {
    const db = crearMockDb({ facturacionOverrides: { estado: 'ACEPTADO', enPlazo: true } });
    const docs = crearDocsMock({ baja: 'ACEPTADO' });

    await ejecutarUnificada(db, docs);
    const error = await capturarError(() => ejecutarUnificada(db, docs));

    assert.ok(error);
    assert.equal(error.code, 'SOLICITUD_NO_DECIDIBLE');
    assert.equal(error.statusCode, 409);
    assert.equal(docs.llamadas.bajas, 1);
});

test('4. Una solicitud EN_EJECUCION no se vuelve a ejecutar', async () => {
    const db = crearMockDb({
        solicitudOverrides: { estado: 'EN_EJECUCION', usuario_ejecucion: 'sistemas_user' },
        facturacionOverrides: { estado: 'ACEPTADO', enPlazo: true }
    });
    const docs = crearDocsMock();

    const error = await capturarError(() => ejecutarUnificada(db, docs));

    assert.ok(error);
    assert.equal(error.code, 'SOLICITUD_EJECUCION_EN_CURSO');
    assert.equal(docs.llamadas.bajas, 0);
});

test('5. Una solicitud rechazada no puede ejecutarse', async () => {
    const db = crearMockDb({
        solicitudOverrides: { estado: 'RECHAZADA' },
        facturacionOverrides: { estado: 'ACEPTADO', enPlazo: true }
    });
    const docs = crearDocsMock();

    const error = await capturarError(() => ejecutarUnificada(db, docs));

    assert.ok(error);
    assert.equal(error.code, 'SOLICITUD_RECHAZADA');
    assert.equal(docs.llamadas.bajas, 0);
});

test('6. Una solicitud completada no puede volver a ejecutarse', async () => {
    const db = crearMockDb({
        solicitudOverrides: { estado: 'COMPLETADA' },
        facturacionOverrides: { estado: 'ACEPTADO', enPlazo: true }
    });
    const docs = crearDocsMock();

    const error = await capturarError(() => ejecutarUnificada(db, docs));

    assert.ok(error);
    assert.equal(error.code, 'SOLICITUD_NO_DECIDIBLE');
    assert.equal(docs.llamadas.bajas, 0);
});

test('7. Un usuario sin permiso de ejecución no deja la solicitud aprobada', async () => {
    const db = crearMockDb({
        facturacionOverrides: { estado: 'ACEPTADO', enPlazo: true },
        permisos: PERMISOS_APROBADOR.filter((p) => p !== 'FAREGAS_CERTIFICADO_ANULAR_EJECUTAR')
    });
    const docs = crearDocsMock();

    const error = await capturarError(() => ejecutarUnificada(db, docs));

    assert.ok(error);
    assert.equal(error.code, 'SOLICITUD_PERMISO_DENEGADO');
    assert.equal(error.statusCode, 403);
    assert.equal(db.getSolicitud().estado, 'PENDIENTE_APROBACION');
    assert.equal(db.getSolicitud().usuario_decision, null);
    assert.equal(docs.llamadas.bajas, 0);
});

test('8. Un perfil distinto de SISTEMAS con permisos efectivos puede aprobar y ejecutar', async () => {
    const db = crearMockDb({
        perfilUsuario: 'SUPERVISOR',
        facturacionOverrides: { estado: 'ACEPTADO', enPlazo: true }
    });
    const docs = crearDocsMock({ baja: 'ACEPTADO' });

    const resultado = await ejecutarUnificada(db, docs);

    assert.equal(resultado.aprobada, true);
    assert.equal(resultado.ejecucionIniciada, true);
    assert.equal(resultado.ejecucionFallida, false);
    assert.equal(docs.llamadas.bajas, 1);
    assert.equal(db.getSolicitud().usuario_decision, 'sistemas_user');
    assert.equal(db.getSolicitud().usuario_ejecucion, 'sistemas_user');
});

test('9. La autoejecución exige confirmaciones y justificación antes de aprobar', async () => {
    const db = crearMockDb({
        solicitudOverrides: { usuario_solicitante: 'sistemas_user' },
        permisos: PERMISOS_AUTOEJECUCION,
        facturacionOverrides: { estado: 'ACEPTADO', enPlazo: true }
    });
    const docs = crearDocsMock();

    const sinConfirmacion = await capturarError(() => ejecutarUnificada(db, docs, { version: 1 }));
    assert.equal(sinConfirmacion.code, 'SOLICITUD_AUTOAPROBACION_CONFIRMACION_REQUERIDA');
    assert.equal(db.getSolicitud().estado, 'PENDIENTE_APROBACION');

    const sinJustificacion = await capturarError(() => ejecutarUnificada(db, docs, {
        version: 1,
        confirmarAutoaprobacion: true,
        confirmarAutoejecucion: true,
        justificacion: '   '
    }));
    assert.equal(sinJustificacion.code, 'CAMPO_OBLIGATORIO');
    assert.equal(db.getSolicitud().estado, 'PENDIENTE_APROBACION');
    assert.equal(docs.llamadas.bajas, 0);
});

test('10. La versión desactualizada se rechaza sin aprobar', async () => {
    const db = crearMockDb({ facturacionOverrides: { estado: 'ACEPTADO', enPlazo: true } });
    const docs = crearDocsMock();

    const error = await capturarError(() => ejecutarUnificada(db, docs, { version: 99 }));

    assert.ok(error);
    assert.equal(error.code, 'SOLICITUD_VERSION_DESACTUALIZADA');
    assert.equal(db.getSolicitud().estado, 'PENDIENTE_APROBACION');
    assert.equal(docs.llamadas.bajas, 0);
});

test('11. NubeFact pendiente deja un estado pendiente coherente sin duplicar', async () => {
    const db = crearMockDb({ facturacionOverrides: { estado: 'ACEPTADO', enPlazo: true } });
    const docs = crearDocsMock({ baja: 'PENDIENTE' });

    const resultado = await ejecutarUnificada(db, docs);

    assert.equal(docs.llamadas.bajas, 1);
    assert.equal(resultado.resultadoFiscal.estado, 'BAJA_FISCAL_PENDIENTE');
    assert.equal(resultado.resultadoFiscal.resuelto, false);
    assert.equal(resultado.completada, false);
    assert.equal(resultado.solicitud.estado, 'EN_EJECUCION');
});

test('12. NubeFact rechazado no marca la anulación como exitosa', async () => {
    const db = crearMockDb({ facturacionOverrides: { estado: 'ACEPTADO', enPlazo: true } });
    const docs = crearDocsMock({ baja: 'RECHAZADO' });

    const resultado = await ejecutarUnificada(db, docs);

    assert.equal(docs.llamadas.bajas, 1);
    assert.equal(resultado.resultadoFiscal.estado, 'BAJA_RECHAZADA');
    assert.equal(resultado.resultadoFiscal.resuelto, false);
    assert.equal(resultado.completada, false);
    assert.equal(resultado.solicitud.estado, 'ERROR');
});

test('12b. Sincronizar una baja pendiente reutiliza el registro y no envía otra baja', async () => {
    const db = crearMockDb({
        solicitudOverrides: { estado: 'EN_EJECUCION' },
        facturacionOverrides: { estado: 'PENDIENTE_SUNAT', enPlazo: true },
        bajasExistentes: [{
            id: 901,
            facturacion_id: 848,
            estado: 'PENDIENTE',
            ticket_sunat: 'TICKET-901',
            respuesta_proveedor: {}
        }]
    });
    const docs = crearDocsMock({ consultaBaja: 'PENDIENTE' });
    const servicio = _private.crearServicio(db, { documentosService: docs });

    const resultado = await servicio.ejecutarAnulacionTotal(
        18,
        { version: db.getSolicitud().version, soloSincronizar: true },
        { username: 'sistemas_user' }
    );

    assert.equal(docs.llamadas.bajas, 0);
    assert.equal(docs.llamadas.consultasBaja, 1);
    assert.equal(resultado.resultadoFiscal.estado, 'BAJA_FISCAL_PENDIENTE');
    assert.equal(resultado.solicitud.estado, 'EN_EJECUCION');
    assert.equal(resultado.requiereIntervencion, false);
});

test('12c. Sincronizar una baja rechazada conserva el registro y muestra el motivo exacto', async () => {
    const db = crearMockDb({
        solicitudOverrides: { estado: 'EN_EJECUCION' },
        facturacionOverrides: { estado: 'PENDIENTE_SUNAT', enPlazo: true },
        bajasExistentes: [{ id: 901, facturacion_id: 848, estado: 'PENDIENTE', respuesta_proveedor: {} }]
    });
    const docs = crearDocsMock({ consultaBaja: 'RECHAZADO', motivoBaja: 'Documento no existe' });
    const servicio = _private.crearServicio(db, { documentosService: docs });

    const resultado = await servicio.ejecutarAnulacionTotal(
        18,
        { version: db.getSolicitud().version, soloSincronizar: true },
        { username: 'sistemas_user' }
    );

    assert.equal(docs.llamadas.bajas, 0);
    assert.equal(resultado.resultadoFiscal.estado, 'BAJA_RECHAZADA');
    assert.equal(resultado.resultadoFiscal.motivo, 'Documento no existe');
    assert.equal(resultado.solicitud.estado, 'ERROR');
});

test('12d. Baja aceptada posteriormente completa la anulación técnica segura', async () => {
    const db = crearMockDb({
        solicitudOverrides: { estado: 'EN_EJECUCION' },
        facturacionOverrides: { estado: 'PENDIENTE_SUNAT', enPlazo: true },
        bajasExistentes: [{ id: 901, facturacion_id: 848, estado: 'PENDIENTE', respuesta_proveedor: {} }]
    });
    const docs = crearDocsMock({ consultaBaja: 'ACEPTADO' });
    const servicio = _private.crearServicio(db, {
        documentosService: docs,
        habilitarAnulacionTecnica: true,
        tiposPermitidosLocal: ['GNV_INICIAL']
    });

    const resultado = await servicio.ejecutarAnulacionTotal(
        18,
        { version: db.getSolicitud().version, soloSincronizar: true },
        { username: 'sistemas_user' }
    );

    assert.equal(docs.llamadas.bajas, 0);
    assert.equal(resultado.resultadoFiscal.estado, 'BAJA_ACEPTADA');
    assert.equal(resultado.resultadoTecnico.estado, 'ANULADO');
    assert.equal(resultado.solicitud.estado, 'COMPLETADA');
    assert.equal(db.getCertificado().estado, 'ANULADO');
});

test('12e. El reconciliador automático completa la misma baja sin reenviarla', async () => {
    const db = crearMockDb({
        solicitudOverrides: {
            estado: 'EN_EJECUCION',
            usuario_ejecucion: 'sistemas_user'
        },
        facturacionOverrides: { estado: 'PENDIENTE_SUNAT', enPlazo: true },
        bajasExistentes: [{ id: 901, facturacion_id: 848, estado: 'PENDIENTE', respuesta_proveedor: {} }],
        candidatosReconciliacion: [{
            id: 18,
            estado: 'EN_EJECUCION',
            version: 1,
            usuario_solicitante: 'mquijano',
            autorizacion_autoejecucion: false,
            usuario_reconciliacion: 'sistemas_user',
            tipo_certificado_clave: 'GNV_INICIAL',
            anulacion_id: 901,
            estado_anulacion: 'PENDIENTE'
        }]
    });
    const docs = crearDocsMock({ consultaBaja: 'ACEPTADO' });
    const servicio = _private.crearServicio(db, {
        documentosService: docs,
        habilitarAnulacionTecnica: true,
        tiposPermitidosLocal: ['GNV_INICIAL']
    });

    const resumen = await servicio.reconciliarAnulacionesPendientes({ limite: 10 });

    assert.equal(resumen.candidatos, 1);
    assert.equal(resumen.procesados, 1);
    assert.equal(resumen.completados, 1);
    assert.equal(resumen.errores, 0);
    assert.equal(docs.llamadas.bajas, 0);
    assert.equal(docs.llamadas.consultasBaja, 1);
    assert.equal(db.getSolicitud().estado, 'COMPLETADA');
    assert.equal(db.getCertificado().estado, 'ANULADO');
});

test('13. Un reintento con operación fiscal previa no envía otro documento', async () => {
    const db = crearMockDb({
        solicitudOverrides: { estado: 'REQUIERE_INTERVENCION' },
        facturacionOverrides: { estado: 'ACEPTADO', enPlazo: true },
        bajasExistentes: [{ id: 901, facturacion_id: 848, estado: 'PENDIENTE', ticket_sunat: 'TICKET-901' }]
    });
    const docs = crearDocsMock();

    const resultado = await capturarError(() => ejecutarUnificada(db, docs));

    // La solicitud ya no está pendiente de aprobación: la acción unificada no
    // reabre la aprobación y no debe disparar una segunda operación fiscal.
    assert.ok(resultado);
    assert.equal(resultado.code, 'SOLICITUD_NO_DECIDIBLE');
    assert.equal(docs.llamadas.bajas, 0);
});

test('14. Un fallo tras iniciar la ejecución conserva la aprobación y deja recuperación', async () => {
    const db = crearMockDb({ fallarCierre: true });
    const docs = crearDocsMock();

    const resultado = await ejecutarUnificada(db, docs);

    assert.equal(resultado.aprobada, true);
    assert.equal(resultado.ejecucionFallida, true);
    assert.equal(resultado.codigoError, 'ERROR_EJECUCION_UNIFICADA');
    assert.equal(db.getSolicitud().usuario_decision, 'sistemas_user');
    assert.equal(db.getSolicitud().estado, 'ERROR');
    const tipos = db.eventos.map((params) => params[1]);
    assert.ok(tipos.includes('SOLICITUD_APROBADA'));
    assert.ok(tipos.includes('EJECUCION_UNIFICADA_ERROR'));
});

test('16. Un fallo de red del proveedor conserva trazabilidad y no declara éxito', async () => {
    const db = crearMockDb({ facturacionOverrides: { estado: 'ACEPTADO', enPlazo: true } });
    const docs = crearDocsMock({ baja: 'ERROR' });

    const resultado = await ejecutarUnificada(db, docs);

    assert.equal(docs.llamadas.bajas, 1);
    assert.equal(resultado.aprobada, true);
    assert.equal(resultado.completada, false);
    assert.equal(resultado.resultadoFiscal.estado, 'NUBEFACT_TIMEOUT');
    assert.equal(resultado.resultadoFiscal.resuelto, false);
    assert.equal(resultado.solicitud.estado, 'ERROR');
    assert.equal(db.getSolicitud().usuario_decision, 'sistemas_user');
    assert.equal(db.getSolicitud().usuario_ejecucion, 'sistemas_user');
});

test('17. La autoaprobación y autoejecución autorizada se registran en una sola acción', async () => {
    const db = crearMockDb({
        solicitudOverrides: { usuario_solicitante: 'sistemas_user' },
        permisos: PERMISOS_AUTOEJECUCION,
        facturacionOverrides: { estado: 'ACEPTADO', enPlazo: true }
    });
    const docs = crearDocsMock({ baja: 'ACEPTADO' });

    const resultado = await ejecutarUnificada(db, docs, {
        confirmarAutoaprobacion: true,
        confirmarAutoejecucion: true,
        justificacion: 'Excepción autorizada por la gerencia para corregir el comprobante'
    });

    assert.equal(resultado.aprobada, true);
    assert.equal(resultado.ejecucionIniciada, true);
    assert.equal(docs.llamadas.bajas, 1);
    assert.equal(db.getSolicitud().autorizacion_autoejecucion, true);
    assert.equal(db.getSolicitud().usuario_decision, 'sistemas_user');
    assert.equal(db.getSolicitud().usuario_ejecucion, 'sistemas_user');
    assert.match(String(db.getSolicitud().justificacion_decision), /Excepción autorizada/);
});

test('15. El detalle expone la elegibilidad de aprobación sin confiar en React', async () => {
    const db = crearMockDb({ facturacionOverrides: { estado: 'ACEPTADO', enPlazo: true } });
    const servicio = _private.crearServicio(db, { documentosService: crearDocsMock() });

    const detalle = await servicio.obtenerDetalle(18, { username: 'sistemas_user' });

    assert.equal(detalle.detalle.puedeAprobar, true);
    assert.equal(detalle.detalle.puedeAprobarYEjecutar, true);
    assert.equal(detalle.detalle.esAutoaprobacion, false);

    const dbSinEjecutar = crearMockDb({
        facturacionOverrides: { estado: 'ACEPTADO', enPlazo: true },
        permisos: PERMISOS_APROBADOR.filter((p) => p !== 'FAREGAS_CERTIFICADO_ANULAR_EJECUTAR')
    });
    const servicioSinEjecutar = _private.crearServicio(dbSinEjecutar, { documentosService: crearDocsMock() });
    const detalleSinEjecutar = await servicioSinEjecutar.obtenerDetalle(18, { username: 'sistemas_user' });
    assert.equal(detalleSinEjecutar.detalle.puedeAprobar, true);
    assert.equal(detalleSinEjecutar.detalle.puedeAprobarYEjecutar, false);
    assert.match(detalleSinEjecutar.detalle.motivoBloqueoAprobacion, /ANULAR_EJECUTAR/);
});
