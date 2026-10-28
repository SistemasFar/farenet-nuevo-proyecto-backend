const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.NODE_ENV = 'test';

const { _private } = require('../services/faregas-solicitudes-operacion.service');

const UUID_EJECUCION = '33333333-3333-4333-8333-333333333333';

const PERMISOS_AUTOEJECUCION = [
    'FAREGAS_CERTIFICADO_ANULAR_EJECUTAR',
    'FAREGAS_SOLICITUD_VER',
    'FAREGAS_SOLICITUD_APROBAR',
    'FAREGAS_SOLICITUD_AUTOAPROBAR',
    'FAREGAS_SOLICITUD_ADMINISTRAR',
    'FAREGAS_SOLICITUD_AUTOEJECUTAR'
];

const crearMockDb = ({
    perfilUsuario = 'SISTEMAS',
    usernameUsuario = 'sistemas_user',
    permisos = PERMISOS_AUTOEJECUCION,
    plantasUsuario = ['PLANTA_SURCO'],
    solicitudOverrides = {},
    facturacionOverrides = null,
    notasExistentes = [],
    bajasExistentes = []
} = {}) => {
    const eventos = [];
    const ejecucionesNubeFact = [];

    const solicitud = {
        id: 8,
        tipo_operacion: 'ANULAR_AMBOS',
        certificado_id: 100,
        facturacion_id: facturacionOverrides !== null ? 200 : null,
        empresa_key: 'FAREGAS',
        empresa_nombre: 'Faregas SAC',
        planta_key: 'PLANTA_SURCO',
        planta_nombre: 'Sede Surco',
        usuario_solicitante: 'sistemas_user',
        motivo: 'Error en la inspección vehicular',
        observaciones: null,
        estado: 'APROBADA',
        usuario_decision: 'sistemas_user',
        fecha_solicitud: '2026-10-26T10:00:00Z',
        fecha_decision: '2026-10-26T10:30:00Z',
        justificacion_decision: 'Autoaprobación excepcional autorizada',
        datos_originales_certificado: { placa: 'ABC-123', numero: 'DG-41-000311' },
        datos_originales_comprobante: facturacionOverrides !== null ? { numero: 'BBB1-00000228' } : null,
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
        version: 2,
        numero_certificado: 'DG-41-000311',
        tipo_certificado_nombre: 'Certificado GNV Inicial',
        nro_comprobante: facturacionOverrides !== null ? 'BBB1-00000228' : null,
        placa: 'ABC-123',
        ...solicitudOverrides
    };

    const certificado = {
        id: 100,
        numero_certificado: 'DG-41-000311',
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
        id: 200,
        tipo_comprobante: 'BOLETA',
        serie: 'BBB1',
        numero: 228,
        nro_comprobante: 'BBB1-00000228',
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

        if (normal.includes('FROM fg_usuario') && normal.includes('WHERE username = $1')) {
            return res([{ username: params[0], perfil_id: perfilUsuario, estado: true }]);
        }
        if (normal.includes('FROM fg_perfil_permiso pp')) {
            return res(permisos.map((p) => ({ permiso_clave: p })));
        }
        if (normal.includes('FROM fg_usuario_planta up')) {
            return plantasUsuario.includes(solicitud.planta_key)
                ? res([{ plantas_key: solicitud.planta_key }]) : res([]);
        }
        if (normal.includes('FROM fg_solicitud_operacion s') && normal.includes('WHERE s.id = $1')) {
            return res([solicitud]);
        }
        if (normal.startsWith('SELECT * FROM fg_solicitud_operacion WHERE id = $1')) {
            return res([solicitud]);
        }
        if (normal.includes('FROM fg_certificado c') && normal.includes('WHERE c.id = $1')) {
            return res([certificado]);
        }
        if (normal.includes('FROM fg_facturacion f') && normal.includes('WHERE f.id = $1')) {
            return facturacion ? res([facturacion]) : res([]);
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
                return res([solicitud]);
            }
            if (normal.includes('SET estado = $1')) {
                solicitud.estado = params[0];
                solicitud.resultado_fiscal = JSON.parse(params[1]);
                solicitud.resultado_tecnico = JSON.parse(params[2]);
                solicitud.version = Number(solicitud.version) + 1;
                return res([solicitud]);
            }
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
        ejecucionesNubeFact,
        getSolicitud: () => solicitud,
        getFacturacion: () => facturacion
    };
};

const crearDocsMock = ({ baja = 'ACEPTADO', nota = 'ACEPTADO', syncEstado = null } = {}) => {
    const llamadas = { bajas: 0, notas: 0, consultas: 0 };
    return {
        llamadas,
        consultarFacturacion: async () => {
            llamadas.consultas += 1;
            if (syncEstado) syncEstado();
            return { estado: 'PENDIENTE_SUNAT', respuesta: {} };
        },
        generarAnulacion: async () => {
            llamadas.bajas += 1;
            if (baja === 'ERROR') {
                const error = new Error('Timeout de conexión con el proveedor');
                error.code = 'NUBEFACT_TIMEOUT';
                throw error;
            }
            return {
                id: 501,
                estado: baja,
                ticketSunat: baja === 'PENDIENTE' ? 'TICKET-BAJA-1' : null,
                respuesta: { sunat_description: 'BAJA CONTROLADA' }
            };
        },
        emitirNota: async () => {
            llamadas.notas += 1;
            if (nota === 'ERROR') {
                const error = new Error('Timeout de conexión con el proveedor');
                error.code = 'NUBEFACT_TIMEOUT';
                throw error;
            }
            return {
                id: 601,
                estado: nota,
                nroComprobante: 'FC01-00000045',
                respuesta: { sunat_description: 'NOTA CONTROLADA' }
            };
        }
    };
};

const ejecutar = (db, docs, entrada = {}) => {
    const servicio = _private.crearServicio(db, { documentosService: docs });
    return servicio.ejecutarAnulacionTotal(8, {
        confirmarAutoejecucion: true,
        justificacion: 'Solicitud propia autorizada excepcionalmente',
        ...entrada
    }, { username: db.getSolicitud().usuario_solicitante });
};

test('1. SISTEMAS con permiso de autoejecución ejecuta su propia solicitud aprobada', async () => {
    const db = crearMockDb({ facturacionOverrides: { estado: 'ACEPTADO', enPlazo: true } });
    const docs = crearDocsMock({ baja: 'ACEPTADO' });

    const resultado = await ejecutar(db, docs);

    assert.equal(docs.llamadas.bajas, 1);
    assert.equal(resultado.resultadoFiscal.estado, 'BAJA_ACEPTADA');
    assert.equal(resultado.resultadoFiscal.tipoOperacion, 'COMUNICACION_BAJA');
    assert.equal(db.getSolicitud().autorizacion_autoejecucion, true);
    assert.equal(db.getSolicitud().usuario_ejecucion, 'sistemas_user');
});

test('2. La autoejecución sin confirmación explícita es rechazada', async () => {
    const db = crearMockDb({ facturacionOverrides: { estado: 'ACEPTADO', enPlazo: true } });
    const docs = crearDocsMock();

    await assert.rejects(
        () => ejecutar(db, docs, { confirmarAutoejecucion: false }),
        (err) => {
            assert.equal(err.code, 'SOLICITUD_AUTOEJECUCION_CONFIRMACION_REQUERIDA');
            assert.equal(err.statusCode, 400);
            return true;
        }
    );
    assert.equal(docs.llamadas.bajas, 0);
});

test('3. La autoejecución sin justificación obligatoria es rechazada', async () => {
    const db = crearMockDb({ facturacionOverrides: { estado: 'ACEPTADO', enPlazo: true } });
    const docs = crearDocsMock();

    await assert.rejects(
        () => ejecutar(db, docs, { justificacion: '   ' }),
        (err) => {
            assert.equal(err.code, 'CAMPO_OBLIGATORIO');
            return true;
        }
    );
    assert.equal(docs.llamadas.bajas, 0);
});

test('4. SISTEMAS sin el permiso FAREGAS_SOLICITUD_AUTOEJECUTAR no puede autoejecutar', async () => {
    const db = crearMockDb({
        facturacionOverrides: { estado: 'ACEPTADO', enPlazo: true },
        permisos: PERMISOS_AUTOEJECUCION.filter((p) => p !== 'FAREGAS_SOLICITUD_AUTOEJECUTAR')
    });
    const docs = crearDocsMock();

    await assert.rejects(
        () => ejecutar(db, docs),
        (err) => {
            assert.equal(err.code, 'SOLICITUD_AUTODECISION_PROHIBIDA');
            assert.equal(err.statusCode, 403);
            return true;
        }
    );
    assert.equal(docs.llamadas.bajas, 0);
});

test('4b. La autoejecución exige simultáneamente los cuatro permisos', async () => {
    for (const permiso of ['FAREGAS_SOLICITUD_APROBAR', 'FAREGAS_SOLICITUD_AUTOAPROBAR']) {
        const db = crearMockDb({
            facturacionOverrides: { estado: 'ACEPTADO', enPlazo: true },
            permisos: PERMISOS_AUTOEJECUCION.filter((p) => p !== permiso)
        });
        const docs = crearDocsMock();
        await assert.rejects(
            () => ejecutar(db, docs),
            (err) => {
                assert.equal(err.code, 'SOLICITUD_AUTODECISION_PROHIBIDA');
                assert.deepEqual(err.detalles.permisosRequeridos, [permiso]);
                return true;
            }
        );
        assert.equal(docs.llamadas.bajas, 0);
    }

    const dbSinEjecutar = crearMockDb({
        facturacionOverrides: { estado: 'ACEPTADO', enPlazo: true },
        permisos: PERMISOS_AUTOEJECUCION.filter((p) => p !== 'FAREGAS_CERTIFICADO_ANULAR_EJECUTAR')
    });
    const docsSinEjecutar = crearDocsMock();
    await assert.rejects(
        () => ejecutar(dbSinEjecutar, docsSinEjecutar),
        (err) => {
            // ADMINISTRAR no sustituye el permiso explícito en la autoejecución.
            assert.equal(err.code, 'SOLICITUD_AUTODECISION_PROHIBIDA');
            assert.deepEqual(err.detalles.permisosRequeridos, ['FAREGAS_CERTIFICADO_ANULAR_EJECUTAR']);
            return true;
        }
    );
    assert.equal(docsSinEjecutar.llamadas.bajas, 0);
});

test('5. OPERADOR con los permisos efectivos puede autoejecutar sin depender del perfil', async () => {
    const db = crearMockDb({
        perfilUsuario: 'OPERADOR',
        facturacionOverrides: { estado: 'ACEPTADO', enPlazo: true }
    });
    const docs = crearDocsMock({ baja: 'ACEPTADO' });

    const resultado = await ejecutar(db, docs);

    assert.equal(docs.llamadas.bajas, 1);
    assert.equal(resultado.resultadoFiscal.estado, 'BAJA_ACEPTADA');
    assert.equal(db.getSolicitud().autorizacion_autoejecucion, true);
    assert.equal(db.getSolicitud().usuario_ejecucion, 'sistemas_user');
});

test('6. Una solicitud no aprobada no se ejecuta', async () => {
    const db = crearMockDb({
        solicitudOverrides: { estado: 'PENDIENTE_APROBACION' },
        facturacionOverrides: { estado: 'ACEPTADO', enPlazo: true }
    });
    const docs = crearDocsMock();

    await assert.rejects(
        () => ejecutar(db, docs),
        (err) => {
            assert.equal(err.code, 'SOLICITUD_NO_APROBADA');
            return true;
        }
    );
});

test('7. Boleta PENDIENTE_SUNAT sin evidencia de plazo se sincroniza y no envía operación', async () => {
    const db = crearMockDb({ facturacionOverrides: { estado: 'PENDIENTE_SUNAT' } });
    const docs = crearDocsMock();

    const resultado = await ejecutar(db, docs);

    assert.equal(docs.llamadas.consultas, 1);
    assert.equal(docs.llamadas.bajas, 0);
    assert.equal(docs.llamadas.notas, 0);
    assert.equal(resultado.resultadoFiscal.estado, 'PENDIENTE_SUNAT');
    assert.equal(resultado.resultadoFiscal.resolucionFiscal.resultado, 'PENDIENTE_VERIFICACION');
    assert.equal(resultado.resultadoFiscal.sincronizacion.consultado, true);
    assert.equal(resultado.resultadoTecnico.estado, 'BLOQUEADO_POR_FISCAL');
    assert.equal(resultado.solicitud.estado, 'EN_EJECUCION');
});

test('7b. Boleta no informada PENDIENTE_SUNAT dentro de 7 días envía comunicación de baja', async () => {
    const db = crearMockDb({ facturacionOverrides: { estado: 'PENDIENTE_SUNAT', enPlazo: true } });
    const docs = crearDocsMock({ baja: 'PENDIENTE' });

    const resultado = await ejecutar(db, docs);

    assert.equal(docs.llamadas.consultas, 1);
    assert.equal(docs.llamadas.bajas, 1);
    assert.equal(docs.llamadas.notas, 0);
    assert.equal(resultado.resultadoFiscal.tipoOperacion, 'COMUNICACION_BAJA');
    assert.equal(resultado.resultadoFiscal.resolucionFiscal.resultado, 'BAJA_ELEGIBLE');
    assert.equal(resultado.resultadoFiscal.estado, 'BAJA_FISCAL_PENDIENTE');
    assert.equal(resultado.resultadoFiscal.resuelto, false);
});

test('8. PENDIENTE_SUNAT que sincroniza a ACEPTADO continúa con la baja fiscal', async () => {
    const db = crearMockDb({ facturacionOverrides: { estado: 'PENDIENTE_SUNAT', enPlazo: true } });
    const docs = crearDocsMock({
        baja: 'ACEPTADO',
        syncEstado: () => { db.getFacturacion().estado = 'ACEPTADO'; }
    });

    const resultado = await ejecutar(db, docs);

    assert.equal(docs.llamadas.consultas, 1);
    assert.equal(docs.llamadas.bajas, 1);
    assert.equal(resultado.resultadoFiscal.estado, 'BAJA_ACEPTADA');
    assert.equal(resultado.resultadoFiscal.tipoOperacion, 'COMUNICACION_BAJA');
});

test('9. Baja fiscal aceptada con técnica bloqueada exige intervención sin declarar COMPLETADA', async () => {
    const db = crearMockDb({ facturacionOverrides: { estado: 'ACEPTADO', enPlazo: true } });
    const docs = crearDocsMock({ baja: 'ACEPTADO' });

    const resultado = await ejecutar(db, docs);

    assert.equal(resultado.resultadoFiscal.resuelto, true);
    assert.equal(resultado.resultadoTecnico.estado, 'BLOQUEADO_NORMATIVA');
    assert.equal(resultado.solicitud.estado, 'REQUIERE_INTERVENCION');
    assert.equal(resultado.completada, false);
    assert.equal(db.getFacturacion().estado, 'ACEPTADO');
});

test('10. Fuera de plazo se selecciona nota de crédito total y no comunicación de baja', async () => {
    const db = crearMockDb({ facturacionOverrides: { estado: 'ACEPTADO', enPlazo: false } });
    const docs = crearDocsMock({ nota: 'ACEPTADO' });

    const resultado = await ejecutar(db, docs);

    assert.equal(docs.llamadas.notas, 1);
    assert.equal(docs.llamadas.bajas, 0);
    assert.equal(resultado.resultadoFiscal.tipoOperacion, 'NOTA_CREDITO');
    assert.equal(resultado.resultadoFiscal.estado, 'ACEPTADO');
});

test('11. Respuesta pendiente conserva la operación sin emitir un duplicado', async () => {
    const db = crearMockDb({ facturacionOverrides: { estado: 'ACEPTADO', enPlazo: true } });
    const docs = crearDocsMock({ baja: 'PENDIENTE' });

    const resultado = await ejecutar(db, docs);

    assert.equal(docs.llamadas.bajas, 1);
    assert.equal(resultado.resultadoFiscal.estado, 'BAJA_FISCAL_PENDIENTE');
    assert.equal(resultado.resultadoFiscal.resuelto, false);
    assert.equal(resultado.solicitud.estado, 'EN_EJECUCION');
});

test('12. Respuesta rechazada no se declara resuelta y expone BAJA_RECHAZADA', async () => {
    const db = crearMockDb({ facturacionOverrides: { estado: 'ACEPTADO', enPlazo: true } });
    const docs = crearDocsMock({ baja: 'RECHAZADO' });

    const resultado = await ejecutar(db, docs);

    assert.equal(resultado.resultadoFiscal.estado, 'BAJA_RECHAZADA');
    assert.equal(resultado.resultadoFiscal.resuelto, false);
    assert.equal(resultado.solicitud.estado, 'ERROR');
});

test('13. Error de conexión se registra sin inventar una anulación', async () => {
    const db = crearMockDb({ facturacionOverrides: { estado: 'ACEPTADO', enPlazo: true } });
    const docs = crearDocsMock({ baja: 'ERROR' });

    const resultado = await ejecutar(db, docs);

    assert.equal(resultado.resultadoFiscal.estado, 'NUBEFACT_TIMEOUT');
    assert.equal(resultado.resultadoFiscal.resuelto, false);
    assert.equal(resultado.resultadoFiscal.error, 'Timeout de conexión con el proveedor');
    assert.equal(resultado.solicitud.estado, 'ERROR');
});

test('14. Timeout previo con operación en trámite no se reenvía (recuperación idempotente)', async () => {
    const db = crearMockDb({
        solicitudOverrides: { estado: 'REQUIERE_INTERVENCION' },
        facturacionOverrides: { estado: 'ACEPTADO', enPlazo: true },
        bajasExistentes: [{ id: 501, facturacion_id: 200, estado: 'PENDIENTE', ticket_sunat: 'TICKET-BAJA-1' }]
    });
    const docs = crearDocsMock();

    const resultado = await ejecutar(db, docs);

    assert.equal(docs.llamadas.bajas, 0);
    assert.equal(resultado.resultadoFiscal.estado, 'BAJA_FISCAL_PENDIENTE');
    assert.equal(resultado.resultadoFiscal.resuelto, false);
});

test('15. Doble clic: una solicitud EN_EJECUCION no se ejecuta dos veces', async () => {
    const db = crearMockDb({
        solicitudOverrides: { estado: 'EN_EJECUCION', usuario_ejecucion: 'sistemas_user' },
        facturacionOverrides: { estado: 'ACEPTADO', enPlazo: true }
    });
    const docs = crearDocsMock();

    await assert.rejects(
        () => ejecutar(db, docs),
        (err) => {
            assert.equal(err.code, 'SOLICITUD_EJECUCION_EN_CURSO');
            return true;
        }
    );
    assert.equal(docs.llamadas.bajas, 0);
});

test('16. Aislamiento multisede: sin acceso a la sede no se ejecuta', async () => {
    const db = crearMockDb({
        plantasUsuario: ['PLANTA_CALLAO'],
        facturacionOverrides: { estado: 'ACEPTADO', enPlazo: true }
    });
    const docs = crearDocsMock();

    await assert.rejects(
        () => ejecutar(db, docs),
        (err) => {
            assert.equal(err.code, 'SOLICITUD_SEDE_NO_AUTORIZADA');
            return true;
        }
    );
    assert.equal(docs.llamadas.bajas, 0);
});

test('17. Historial: la autoejecución autorizada deja evento inmutable con evidencia', async () => {
    const db = crearMockDb({ facturacionOverrides: { estado: 'ACEPTADO', enPlazo: true } });
    const docs = crearDocsMock({ baja: 'ACEPTADO' });

    await ejecutar(db, docs);

    const eventos = db.eventos.map((params) => ({
        tipo: params[1],
        metadatos: params[6] ? JSON.parse(params[6]) : null
    }));
    const inicio = eventos.find((evento) => evento.tipo === 'AUTOEJECUCION_EXCEPCIONAL_AUTORIZADA');
    assert.ok(inicio);
    assert.equal(inicio.metadatos.autoejecucionAutorizada, true);
    assert.equal(inicio.metadatos.justificacionAutoejecucion, 'Solicitud propia autorizada excepcionalmente');
    assert.ok(eventos.some((evento) => evento.tipo === 'EJECUCION_PARCIAL_REQUIERE_INTERVENCION'));
});

test('18. Migración: permiso dedicado sin asignación automática y constraint con excepción', () => {
    const migrationsDir = path.join(__dirname, '..', 'database', 'migrations');
    const historyDir = path.join(__dirname, '..', 'database', 'migrations_history');
    const schema = fs.readFileSync(path.join(migrationsDir, '0001_faregas_schema.sql'), 'utf8');
    const migration = fs.readFileSync(path.join(historyDir, '20261026_faregas_solicitud_autoejecucion.sql'), 'utf8');

    assert.match(schema, /'FAREGAS_SOLICITUD_AUTOEJECUTAR'/);
    const bloquePerfilesSolicitud = (schema.split("('SISTEMAS'::varchar, 'FAREGAS_SOLICITUD_AUTOAPROBAR'::varchar)")[1] || '')
        .split('ON CONFLICT (perfil_clave')[0];
    assert.doesNotMatch(bloquePerfilesSolicitud, /FAREGAS_SOLICITUD_AUTOEJECUTAR/);
    assert.match(schema, /autorizacion_autoejecucion boolean NOT NULL DEFAULT FALSE/);
    assert.match(schema, /CONSTRAINT ck_fg_solicitud_no_autoejecucion CHECK/);
    assert.match(schema, /autorizacion_autoejecucion = TRUE/);

    assert.match(migration, /ADD COLUMN IF NOT EXISTS autorizacion_autoejecucion/);
    assert.match(migration, /DROP CONSTRAINT IF EXISTS ck_fg_solicitud_no_autoejecucion/);
    assert.match(migration, /ADD CONSTRAINT ck_fg_solicitud_no_autoejecucion/);
    assert.match(migration, /'FAREGAS_SOLICITUD_AUTOEJECUTAR'/);
    assert.doesNotMatch(migration, /INSERT INTO public\.fg_perfil_permiso/);
    assert.doesNotMatch(migration, /DELETE\s+FROM|DROP\s+TABLE|TRUNCATE/i);
});

test('19. Boleta: la anulación usa generar_anulacion con tipo_de_comprobante 2 y sin llamada real', async () => {
    const nubefact = require('../../../services/integrations/nubefact.service');
    let enviado = null;
    const httpClient = {
        post: async (_url, payload) => {
            enviado = payload;
            return {
                status: 200,
                data: {
                    serie: 'BBB1',
                    numero: 231,
                    enlace: 'https://demo.invalid/cpe/BBB1-231',
                    anulado: false
                }
            };
        }
    };

    const resultado = await nubefact.generarAnulacion(
        {
            tipoDeComprobante: 2,
            serie: 'BBB1',
            numero: 231,
            motivo: 'Anulación total de boleta',
            codigoUnico: 'FGA823'
        },
        {
            ignoreEnabled: true,
            credentials: { apiUrl: 'https://demo.invalid/api', token: 'prueba' },
            httpClient
        }
    );

    assert.equal(enviado.operacion, 'generar_anulacion');
    assert.equal(enviado.tipo_de_comprobante, 2);
    assert.equal(enviado.serie, 'BBB1');
    assert.equal(enviado.numero, 231);
    assert.equal(enviado.codigo_unico, 'FGA823');
    assert.equal(resultado.status, 'PENDING_SUNAT');
});

test('20. consultar_anulacion con anulado=true se reconoce como aceptación definitiva', () => {
    const nubefact = require('../../../services/integrations/nubefact.service');
    const resultado = nubefact._private.normalizarRespuesta({
        status: 200,
        data: {
            serie: 'BBB1',
            numero: 231,
            anulado: true,
            sunat_description: 'Comprobante anulado'
        }
    });
    assert.equal(resultado.status, 'ACCEPTED');
    assert.equal(resultado.reason, 'ACCEPTED_BY_PROVIDER');
});
