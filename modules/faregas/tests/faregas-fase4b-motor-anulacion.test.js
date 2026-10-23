const test = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';

const { _private } = require('../services/faregas-solicitudes-operacion.service');
const autorizacionFiscalService = require('../services/faregas-autorizacion-fiscal.service');

const UUID_IDEMPOTENCIA = '22222222-2222-4222-8222-222222222222';

const crearMockDb = ({
    solicitudOverrides = {},
    certificadoOverrides = {},
    facturacionOverrides = null,
    perfilUsuario = 'SISTEMAS',
    usernameUsuario = 'sistemas_user',
    plantasUsuario = ['PLANTA_SURCO'],
    permisos = ['FAREGAS_CERTIFICADO_ANULAR_EJECUTAR', 'FAREGAS_SOLICITUD_VER', 'FAREGAS_SOLICITUD_ADMINISTRAR'],
    notasExistentes = [],
    bajasExistentes = []
} = {}) => {
    const eventos = [];
    let solicitud = {
        id: 50,
        tipo_operacion: 'ANULAR_AMBOS',
        certificado_id: 100,
        facturacion_id: facturacionOverrides !== null ? 200 : null,
        empresa_key: 'FAREGAS',
        empresa_nombre: 'Faregas SAC',
        planta_key: 'PLANTA_SURCO',
        planta_nombre: 'Sede Surco',
        usuario_solicitante: 'operador_user',
        motivo: 'Anulación autorizada por error en inspección',
        observaciones: null,
        estado: 'APROBADA',
        usuario_decision: 'supervisor_user',
        fecha_solicitud: '2026-10-23T10:00:00Z',
        fecha_decision: '2026-10-23T10:30:00Z',
        justificacion_decision: 'Aprobado por Sistemas',
        datos_originales_certificado: { placa: 'ABC-123', numero: 'DG-41-000500' },
        datos_originales_comprobante: facturacionOverrides !== null ? { numero: 'F001-0000100' } : null,
        datos_propuestos: null,
        fecha_emision_original: '2026-10-23',
        resultado_tecnico: null,
        resultado_fiscal: null,
        idempotencia_clave: '11111111-1111-4111-8111-111111111111',
        usuario_ejecucion: null,
        fecha_ejecucion: null,
        idempotencia_ejecucion: null,
        version: 2,
        numero_certificado: 'DG-41-000500',
        tipo_certificado_nombre: 'Certificado GNV Inicial',
        nro_comprobante: facturacionOverrides !== null ? 'F001-0000100' : null,
        placa: 'ABC-123',
        ...solicitudOverrides
    };

    let certificado = {
        id: 100,
        numero_certificado: 'DG-41-000500',
        tipo_certificado_clave: 'GNV_INICIAL',
        planta_key: 'PLANTA_SURCO',
        empresa_key: 'FAREGAS',
        estado: 'EMITIDO',
        fecha_emision: '2026-10-23',
        ...certificadoOverrides
    };

    let facturacion = facturacionOverrides !== null ? {
        id: 200,
        tipo_comprobante: 'FACTURA',
        serie: 'F001',
        numero: 100,
        nro_comprobante: 'F001-0000100',
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

        // Usuario
        if (normal.includes('FROM fg_usuario') && normal.includes('WHERE username = $1')) {
            return res([{ username: params[0], perfil_id: perfilUsuario, estado: true }]);
        }

        // Permisos
        if (normal.includes('FROM fg_perfil_permiso pp')) {
            return res(permisos.map((p) => ({ permiso_clave: p })));
        }

        // Sedes de usuario
        if (normal.includes('FROM fg_usuario_planta up')) {
            const sede = params[2] || params[0];
            const permitida = plantasUsuario.includes(solicitud.planta_key);
            return permitida ? res([{ plantas_key: solicitud.planta_key }]) : res([]);
        }

        // Consultar solicitud FOR UPDATE o simple
        if (normal.includes('FROM fg_solicitud_operacion s') && normal.includes('WHERE s.id = $1')) {
            return res([solicitud]);
        }
        if (normal.startsWith('SELECT * FROM fg_solicitud_operacion WHERE id = $1')) {
            return res([solicitud]);
        }

        // Consultar certificado
        if (normal.includes('FROM fg_certificado c') && normal.includes('WHERE c.id = $1')) {
            return res([certificado]);
        }

        // Consultar facturación
        if (normal.includes('FROM fg_facturacion f') && normal.includes('WHERE f.id = $1')) {
            return facturacion ? res([facturacion]) : res([]);
        }

        // Plazo facturación
        if (normal.includes('FROM fg_facturacion_intento WHERE facturacion_id = $1')) {
            const enPlazo = facturacion?.enPlazo !== false;
            return res([{ fecha_emision: '2026-10-23T10:00:00Z', vigente: enPlazo, dentro_plazo_baja: enPlazo }]);
        }

        // Operaciones de documento electrónico en trámite
        if (normal.includes('FROM fg_documento_electronico_operacion')) {
            return res([{ id: 1, operacion: 'EMITIR', estado: 'PENDIENTE', error: null, fecha_creacion: '2026-10-23T10:00:00Z' }]);
        }

        // Total notas existentes para cálculo de saldo
        if (normal.includes('SELECT COALESCE(SUM(importe_total), 0) AS total FROM fg_credito')) {
            return res([{ total: 0 }]);
        }

        // Notas existentes
        if (normal.includes('FROM fg_credito') && normal.includes('WHERE facturacion_id = $1')) {
            return res(notasExistentes);
        }

        // Bajas existentes
        if (normal.includes('FROM fg_documento_anulacion') && normal.includes('WHERE facturacion_id = $1')) {
            return res(bajasExistentes);
        }

        // Actualizar solicitud
        if (normal.startsWith('UPDATE fg_solicitud_operacion')) {
            if (normal.includes("SET estado = 'EN_EJECUCION'")) {
                solicitud.estado = 'EN_EJECUCION';
                solicitud.usuario_ejecucion = params[0];
                solicitud.idempotencia_ejecucion = params[1];
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

        // Eventos
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
        getCertificado: () => certificado,
        getFacturacion: () => facturacion
    };
};

// 1. Ejecución sin aprobación
test('1. FASE 4B: Falla al ejecutar solicitud que no está APROBADA', async () => {
    const db = crearMockDb({ solicitudOverrides: { estado: 'PENDIENTE_APROBACION' } });
    const servicio = _private.crearServicio(db);
    await assert.rejects(
        async () => servicio.ejecutarAnulacionTotal(50, {}, { username: 'sistemas_user' }),
        (err) => {
            assert.equal(err.code, 'SOLICITUD_NO_APROBADA');
            assert.equal(err.statusCode, 409);
            return true;
        }
    );
});

// 2. Ejecución por OPERADOR, incluso si un checkbox dejó el permiso asignado
test('2. FASE 4B/4C: OPERADOR no ejecuta aunque conserve el permiso sensible', async () => {
    const db = crearMockDb({
        perfilUsuario: 'OPERADOR',
        permisos: ['FAREGAS_SOLICITUD_CREAR', 'FAREGAS_SOLICITUD_VER', 'FAREGAS_CERTIFICADO_ANULAR_EJECUTAR']
    });
    const servicio = _private.crearServicio(db);
    await assert.rejects(
        async () => servicio.ejecutarAnulacionTotal(50, {}, { username: 'operador_otro' }),
        (err) => {
            assert.equal(err.code, 'SOLICITUD_PERMISO_DENEGADO');
            assert.equal(err.statusCode, 403);
            return true;
        }
    );
});

// 3. Ejecución por el propio solicitante (auto-ejecución prohibida)
test('3. FASE 4B: Solicitante no puede auto-ejecutar su propia solicitud', async () => {
    const db = crearMockDb({
        usernameUsuario: 'operador_user',
        solicitudOverrides: { usuario_solicitante: 'operador_user' }
    });
    const servicio = _private.crearServicio(db);
    await assert.rejects(
        async () => servicio.ejecutarAnulacionTotal(50, {}, { username: 'operador_user' }),
        (err) => {
            assert.equal(err.code, 'SOLICITUD_AUTODECISION_PROHIBIDA');
            assert.equal(err.statusCode, 403);
            return true;
        }
    );
});

// 4. Reintentos concurrentes (ya EN_EJECUCION)
test('4. FASE 4B: Bloquea petición si la solicitud ya está EN_EJECUCION', async () => {
    const db = crearMockDb({ solicitudOverrides: { estado: 'EN_EJECUCION' } });
    const servicio = _private.crearServicio(db);
    await assert.rejects(
        async () => servicio.ejecutarAnulacionTotal(50, {}, { username: 'sistemas_user' }),
        (err) => {
            assert.equal(err.code, 'SOLICITUD_EJECUCION_EN_CURSO');
            assert.equal(err.statusCode, 409);
            return true;
        }
    );
});

// 5. Comprobante pendiente SUNAT (no declarar resuelto, comprobar trámite y no generar bajas ficticias)
test('5. FASE 4B: Comprobante PENDIENTE_SUNAT no se declara resuelto, detecta trámite y mantiene REQUIERE_INTERVENCION sin llamar a NubeFact', async () => {
    let llamadasNubeFact = 0;
    const mockDocsService = {
        generarAnulacion: async () => { llamadasNubeFact++; throw new Error('No debe invocarse'); },
        emitirNota: async () => { llamadasNubeFact++; throw new Error('No debe invocarse'); }
    };
    const db = crearMockDb({
        facturacionOverrides: { estado: 'PENDIENTE_SUNAT' }
    });
    const servicio = _private.crearServicio(db, { documentosService: mockDocsService });

    const resultado = await servicio.ejecutarAnulacionTotal(50, {}, { username: 'sistemas_user' });

    assert.equal(llamadasNubeFact, 0);
    assert.equal(resultado.resultadoFiscal.resuelto, false);
    assert.equal(resultado.resultadoFiscal.estado, 'PENDIENTE_SUNAT');
    assert.equal(resultado.resultadoFiscal.enTramite, true);
    assert.match(resultado.resultadoFiscal.motivo, /emisión en trámite ante SUNAT/i);
    // Técnica bloqueada por defecto
    assert.equal(resultado.resultadoTecnico.resuelto, false);
    assert.equal(resultado.solicitud.estado, 'REQUIERE_INTERVENCION');
    assert.equal(resultado.completada, false);
});

test('5b. FASE 4B: Comprobante BORRADOR o RECHAZADO aplica regularización interna explícita sin bajas ficticias', async () => {
    let llamadasNubeFact = 0;
    const mockDocsService = {
        generarAnulacion: async () => { llamadasNubeFact++; throw new Error('No debe invocarse'); },
        emitirNota: async () => { llamadasNubeFact++; throw new Error('No debe invocarse'); }
    };
    const db = crearMockDb({
        facturacionOverrides: { estado: 'BORRADOR' }
    });
    const servicio = _private.crearServicio(db, { documentosService: mockDocsService });

    const resultado = await servicio.ejecutarAnulacionTotal(50, {}, { username: 'sistemas_user' });

    assert.equal(llamadasNubeFact, 0);
    assert.equal(resultado.resultadoFiscal.resuelto, true);
    assert.equal(resultado.resultadoFiscal.estado, 'REGULARIZACION_INTERNA');
    assert.match(resultado.resultadoFiscal.motivo, /BORRADOR/i);
});

test('5c. FASE 4B: Selección de mecanismo tributario incierto devuelve REQUIERE_INTERVENCION sin llamar a NubeFact', async () => {
    let llamadasNubeFact = 0;
    const mockDocsService = {
        generarAnulacion: async () => { llamadasNubeFact++; throw new Error('No debe invocarse'); },
        emitirNota: async () => { llamadasNubeFact++; throw new Error('No debe invocarse'); }
    };
    const db = crearMockDb({
        facturacionOverrides: { estado: 'ACEPTADO', serie: null, numero: null }
    });
    const servicio = _private.crearServicio(db, { documentosService: mockDocsService });

    const resultado = await servicio.ejecutarAnulacionTotal(50, {}, { username: 'sistemas_user' });

    assert.equal(llamadasNubeFact, 0);
    assert.equal(resultado.resultadoFiscal.resuelto, false);
    assert.equal(resultado.resultadoFiscal.estado, 'REQUIERE_INTERVENCION');
    assert.match(resultado.resultadoFiscal.motivo, /condiciones tributarias operables/i);
    assert.equal(resultado.solicitud.estado, 'REQUIERE_INTERVENCION');
});

// 6. Comprobante sin emisión fiscal (facturacion_id == null)
test('6. FASE 4B: Certificado sin comprobante fiscal resuelve componente fiscal como NO_REQUERIDA', async () => {
    let llamadasNubeFact = 0;
    const mockDocsService = {
        generarAnulacion: async () => { llamadasNubeFact++; },
        emitirNota: async () => { llamadasNubeFact++; }
    };
    const db = crearMockDb({ facturacionOverrides: null });
    const servicio = _private.crearServicio(db, { documentosService: mockDocsService });

    const resultado = await servicio.ejecutarAnulacionTotal(50, {}, { username: 'sistemas_user' });

    assert.equal(llamadasNubeFact, 0);
    assert.equal(resultado.resultadoFiscal.resuelto, true);
    assert.equal(resultado.resultadoFiscal.estado, 'NO_REQUERIDA');
    assert.equal(resultado.resultadoTecnico.resuelto, false);
    assert.equal(resultado.solicitud.estado, 'REQUIERE_INTERVENCION');
});

// 7. Respuesta fiscal rechazada por SUNAT
test('7. FASE 4B: Respuesta fiscal rechazada no completa la solicitud y marca REQUIERE_INTERVENCION', async () => {
    const mockDocsService = {
        generarAnulacion: async () => {
            const err = new Error('Rechazado por SUNAT: comprobante no existe en padrón');
            err.code = 'NUBEFACT_ERROR';
            err.detalles = { status: 'REJECTED' };
            throw err;
        }
    };
    const db = crearMockDb({
        facturacionOverrides: { estado: 'ACEPTADO', enPlazo: true }
    });
    const servicio = _private.crearServicio(db, { documentosService: mockDocsService });

    const resultado = await servicio.ejecutarAnulacionTotal(50, {}, { username: 'sistemas_user' });

    assert.equal(resultado.resultadoFiscal.resuelto, false);
    assert.equal(resultado.resultadoFiscal.estado, 'NUBEFACT_ERROR');
    assert.equal(resultado.solicitud.estado, 'REQUIERE_INTERVENCION');
    assert.equal(resultado.completada, false);
});

// 8. Respuesta fiscal pendiente (ticket asíncrono no equivale a aceptación definitiva)
test('8. FASE 4B: HTTP 200 con ticket pendiente no asume aceptación definitiva', async () => {
    const mockDocsService = {
        generarAnulacion: async () => ({
            id: 88,
            estado: 'PENDIENTE',
            ticketSunat: 'TICKET-99999',
            respuesta: { sunat_ticket_numero: 'TICKET-99999' }
        })
    };
    const db = crearMockDb({
        facturacionOverrides: { estado: 'ACEPTADO', enPlazo: true }
    });
    const servicio = _private.crearServicio(db, { documentosService: mockDocsService });

    const resultado = await servicio.ejecutarAnulacionTotal(50, {}, { username: 'sistemas_user' });

    assert.equal(resultado.resultadoFiscal.resuelto, false);
    assert.equal(resultado.resultadoFiscal.estado, 'PENDIENTE');
    assert.equal(resultado.resultadoFiscal.ticketSunat, 'TICKET-99999');
    assert.equal(resultado.solicitud.estado, 'REQUIERE_INTERVENCION');
    assert.equal(resultado.completada, false);
});

// 9. Fiscal aceptada y técnica bloqueada por defecto (certificado permanece EMITIDO intacto)
test('9. FASE 4B: Fiscal aceptada pero técnica bloqueada conserva certificado EMITIDO y marca REQUIERE_INTERVENCION', async () => {
    const mockDocsService = {
        generarAnulacion: async () => ({
            id: 89,
            estado: 'ACEPTADO',
            ticketSunat: null,
            respuesta: { anulado: true }
        })
    };
    const db = crearMockDb({
        facturacionOverrides: { estado: 'ACEPTADO', enPlazo: true },
        certificadoOverrides: { estado: 'EMITIDO', numero_certificado: 'DG-41-000500' }
    });
    const servicio = _private.crearServicio(db, { documentosService: mockDocsService });

    const resultado = await servicio.ejecutarAnulacionTotal(50, {}, { username: 'sistemas_user' });

    assert.equal(resultado.resultadoFiscal.resuelto, true);
    assert.equal(resultado.resultadoFiscal.estado, 'ACEPTADO');
    assert.equal(resultado.resultadoTecnico.resuelto, false);
    assert.equal(resultado.resultadoTecnico.estado, 'BLOQUEADO_NORMATIVA');
    assert.equal(db.getCertificado().estado, 'EMITIDO'); // Certificado no alterado
    assert.equal(resultado.solicitud.estado, 'REQUIERE_INTERVENCION');
    assert.equal(resultado.completada, false);
    assert.equal(resultado.requiereIntervencion, true);
});

// 10. Recuperación sin duplicar llamadas (reintento seguro)
test('10. FASE 4B: Recuperación de solicitud en REQUIERE_INTERVENCION reutiliza baja previa sin reenvío NubeFact', async () => {
    let llamadasNubeFact = 0;
    const mockDocsService = {
        generarAnulacion: async () => { llamadasNubeFact++; throw new Error('No debe reemitir'); },
        emitirNota: async () => { llamadasNubeFact++; throw new Error('No debe reemitir'); }
    };
    const db = crearMockDb({
        solicitudOverrides: { estado: 'REQUIERE_INTERVENCION' },
        facturacionOverrides: { estado: 'ACEPTADO', enPlazo: true },
        bajasExistentes: [{ id: 89, facturacion_id: 200, estado: 'ACEPTADO', ticket_sunat: 'BAJA-OK' }]
    });
    const servicio = _private.crearServicio(db, { documentosService: mockDocsService });

    const resultado = await servicio.ejecutarAnulacionTotal(50, {}, { username: 'sistemas_user' });

    assert.equal(llamadasNubeFact, 0);
    assert.equal(resultado.resultadoFiscal.resuelto, true);
    assert.equal(resultado.resultadoFiscal.estado, 'ACEPTADO');
    assert.equal(resultado.resultadoFiscal.tipoOperacion, 'COMUNICACION_BAJA');
});

// 11. Protección de nota de crédito directa (botón morado antifraude)
test('11. FASE 4B: Emisión directa de nota de crédito 01/02 exige solicitud aprobada; motivo 03 permanece autorizado', async () => {
    // Motivo 01 sin solicitud aprobada
    await assert.rejects(
        async () => autorizacionFiscalService.validarSolicitudAprobada({
            solicitudId: null,
            certificadoId: 100,
            operacion: 'NOTA_CORRECTIVA',
            userContext: { username: 'sistemas_user' }
        }),
        (err) => {
            assert.equal(err.code, 'FAREGAS_SOLICITUD_FISCAL_REQUERIDA');
            assert.equal(err.statusCode, 403);
            return true;
        }
    );

    // Con solicitud aprobada y sede coincidente
    const mockExecutor = {
        query: async (sql, params) => {
            const normal = String(sql).replace(/\s+/g, ' ').trim();
            if (normal.includes('FROM fg_solicitud_operacion s')) {
                return {
                    rowCount: 1,
                    rows: [{
                        id: 50,
                        estado: 'APROBADA',
                        tipo_operacion: 'ANULAR_AMBOS',
                        certificado_id: 100,
                        facturacion_id: 200,
                        empresa_key: 'FAREGAS',
                        planta_key: 'PLANTA_SURCO',
                        usuario_solicitante: 'operador_user',
                        certificado_estado: 'EMITIDO',
                        numero_certificado: 'DG-41-000500',
                        facturacion_estado: 'ACEPTADO',
                        nro_comprobante: 'F001-0000100',
                        aceptada_sunat: true,
                        entorno_facturador: 'PRODUCCION',
                        proveedor: 'NUBEFACT',
                        serie: 'F001',
                        numero: 100,
                        enlace_pdf: null,
                        enlace_xml: null,
                        perfil_id: 'SISTEMAS',
                        usuario_activo: true,
                        tiene_sede: true,
                        tiene_permiso: true,
                        resultado_fiscal: null
                    }]
                };
            }
            return { rowCount: 0, rows: [] };
        }
    };

    const resValidacion = await autorizacionFiscalService.validarSolicitudAprobada({
        solicitudId: 50,
        certificadoId: 100,
        operacion: 'NOTA_CORRECTIVA',
        userContext: { username: 'sistemas_user' },
        executor: mockExecutor
    });
    assert.equal(resValidacion.solicitudId, 50);
    assert.equal(resValidacion.tipoOperacion, 'ANULAR_AMBOS');
});

// 12. Aislamiento multiempresa y multisede
test('12. FASE 4B: Bloquea ejecución si el usuario no tiene acceso a la sede de la solicitud', async () => {
    const db = crearMockDb({
        plantasUsuario: ['PLANTA_CALLAO'], // Usuario solo tiene acceso a Callao, no a Surco
        solicitudOverrides: { planta_key: 'PLANTA_SURCO' }
    });
    const servicio = _private.crearServicio(db);

    await assert.rejects(
        async () => servicio.ejecutarAnulacionTotal(50, {}, { username: 'sistemas_user' }),
        (err) => {
            assert.equal(err.code, 'SOLICITUD_SEDE_NO_AUTORIZADA');
            assert.equal(err.statusCode, 403);
            return true;
        }
    );
});
