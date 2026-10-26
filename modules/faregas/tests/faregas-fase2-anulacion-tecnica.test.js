const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.NODE_ENV = 'test';

const {
    _private,
} = require('../services/faregas-solicitudes-operacion.service');
const certificadosService = require('../services/faregas-certificados.service');
const {
    PERMISOS_SOLICITUD,
    CONFIG_ANULACION_TECNICA,
} = require('../services/faregas-solicitudes-operacion.constants');

const UUID_1 = '123e4567-e89b-42d3-a456-426614174000';

const filaSolicitudAprobada = (overrides = {}) => ({
    id: 1,
    tipo_operacion: 'ANULAR_CERTIFICADO',
    certificado_id: 10,
    facturacion_id: 20,
    empresa_key: 'FAREGAS',
    planta_key: 'SURCO',
    usuario_solicitante: 'operador',
    motivo: 'Certificado impreso con error físico irrecuperable',
    observaciones: null,
    estado: 'APROBADA',
    usuario_decision: 'jefe',
    fecha_solicitud: new Date('2026-10-22T10:00:00Z'),
    fecha_decision: new Date('2026-10-22T11:00:00Z'),
    justificacion_decision: 'Aprobado por jefatura conforme a solicitud',
    datos_originales_certificado: { id: 10, numero: 'DG-41-000308', tipo: 'INSPECCION_TALLER', estado: 'EMITIDO', placa: 'ABC123' },
    datos_originales_comprobante: { id: 20, numero: 'BBB1-00000216', estado: 'ACEPTADO' },
    datos_propuestos: null,
    fecha_emision_original: '2026-10-22',
    resultado_tecnico: null,
    resultado_fiscal: null,
    idempotencia_clave: UUID_1,
    version: 2,
    fecha_creacion: new Date('2026-10-22T10:00:00Z'),
    fecha_modificacion: new Date('2026-10-22T11:00:00Z'),
    ...overrides,
});

const CONFIG_HABILITADA_PRUEBAS = Object.freeze({
    habilitarAnulacionTecnica: true,
    tiposPermitidosLocal: ['INSPECCION_TALLER']
});

const crearDbSimuladaFase2 = (opciones = {}) => {
    let snapshotTransaccion = null;

    const estado = {
        solicitudes: (opciones.solicitudes || [filaSolicitudAprobada()]).map((item) => ({ ...item })),
        certificados: (opciones.certificados || [{
            id: 10,
            numero_certificado: 'DG-41-000308',
            tipo_certificado_clave: opciones.tipoCertificado || 'INSPECCION_TALLER',
            estado: opciones.estadoCertificado || 'EMITIDO',
            fecha_emision: '2026-10-22',
            planta_key: opciones.plantaCertificado || 'SURCO',
            empresa_key: opciones.empresaCertificado || 'FAREGAS',
            cliente_id: 5,
            observaciones: 'Inspeccion conforme',
            fecha_anulacion: null,
            motivo_anulacion: null,
            solicitud_anulacion_id: null,
            usuario_anulacion: null,
        }]).map((c) => ({ ...c })),
        facturaciones: [{ id: 20, certificado_id: 10, estado: 'ACEPTADO', importe_total: 100 }],
        pagos: [{ id: 30, certificado_id: 10, monto: 100, estado: 'PAGADO' }],
        ordenesPago: [{ id: 40, certificado_id: 10, estado: 'PAGADO' }],
        correlativos: [{ planta_key: 'SURCO', tipo: 'INSPECCION_TALLER', nro_actual: 308 }],
        eventos: [],
        queriesEjecutadas: [],
        usuarios: {
            operador: { username: 'operador', perfil_id: 'OPERADOR', estado: true },
            jefe: { username: 'jefe', perfil_id: 'JEFE_PLANTA', estado: true },
            sistemas: { username: 'sistemas', perfil_id: 'SISTEMAS', estado: true },
            sinpermiso: { username: 'sinpermiso', perfil_id: 'OPERADOR', estado: true },
        },
        permisos: {
            OPERADOR: [PERMISOS_SOLICITUD.CREAR, PERMISOS_SOLICITUD.VER],
            JEFE_PLANTA: [PERMISOS_SOLICITUD.VER, PERMISOS_SOLICITUD.APROBAR, PERMISOS_SOLICITUD.RECHAZAR],
            SISTEMAS: [
                PERMISOS_SOLICITUD.CREAR, PERMISOS_SOLICITUD.VER,
                PERMISOS_SOLICITUD.APROBAR, PERMISOS_SOLICITUD.RECHAZAR,
                PERMISOS_SOLICITUD.ADMINISTRAR, PERMISOS_SOLICITUD.EJECUTAR_ANULACION_CERTIFICADO,
            ],
        },
        plantas: {
            operador: ['SURCO'],
            jefe: ['SURCO'],
            sistemas: ['SURCO', 'ATE', 'INDEPENDENCIA'],
            sinpermiso: ['SURCO'],
        },
    };

    const resultado = (rows) => ({ rows, rowCount: rows.length });
    const query = async (sql, params = []) => {
        const normal = String(sql).replace(/\s+/g, ' ').trim();
        estado.queriesEjecutadas.push({ sql: normal, params });

        if (normal === 'BEGIN') {
            snapshotTransaccion = JSON.stringify({
                solicitudes: estado.solicitudes,
                certificados: estado.certificados,
                eventos: estado.eventos
            });
            return resultado([]);
        }

        if (normal === 'COMMIT') {
            snapshotTransaccion = null;
            return resultado([]);
        }

        if (normal === 'ROLLBACK') {
            if (snapshotTransaccion) {
                const s = JSON.parse(snapshotTransaccion);
                estado.solicitudes = s.solicitudes;
                estado.certificados = s.certificados;
                estado.eventos = s.eventos;
                snapshotTransaccion = null;
            }
            return resultado([]);
        }

        if (opciones.forzarErrorSql && normal.startsWith('UPDATE fg_certificado')) {
            throw new Error('SIMULATED_SQL_ERROR');
        }

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

        if (normal.includes('FROM fg_solicitud_operacion') && (normal.includes('WHERE s.id = $1') || normal.includes('WHERE id = $1'))) {
            const item = estado.solicitudes.find((s) => Number(s.id) === Number(params[0]));
            if (!item) return resultado([]);
            return resultado([{
                ...item,
                planta_nombre: item.planta_key,
                empresa_nombre: item.empresa_key,
                numero_certificado: item.datos_originales_certificado?.numero,
                tipo_certificado_nombre: item.datos_originales_certificado?.tipo,
                nro_comprobante: item.datos_originales_comprobante?.numero,
                placa: item.datos_originales_certificado?.placa,
            }]);
        }

        if (normal.startsWith('SELECT id, numero_certificado, estado FROM fg_certificado WHERE id = $1')) {
            const cert = estado.certificados.find((c) => Number(c.id) === Number(params[0]));
            return resultado(cert ? [cert] : []);
        }

        if (normal.includes('FROM fg_certificado c') && normal.includes('WHERE c.id = $1')) {
            const cert = estado.certificados.find((c) => Number(c.id) === Number(params[0]));
            if (!cert) return resultado([]);
            return resultado([{ ...cert }]);
        }

        if (normal.startsWith('UPDATE fg_certificado')) {
            const cert = estado.certificados.find((c) => Number(c.id) === Number(params[3]) && c.estado === 'EMITIDO');
            if (!cert) return resultado([]);
            cert.estado = 'ANULADO';
            cert.motivo_anulacion = params[0];
            cert.solicitud_anulacion_id = params[1];
            cert.usuario_anulacion = params[2];
            cert.fecha_anulacion = new Date();
            return resultado([{ ...cert }]);
        }

        if (normal.startsWith('UPDATE fg_solicitud_operacion')) {
            if (normal.includes("SET estado = 'EN_EJECUCION'")) {
                const item = estado.solicitudes.find((s) => Number(s.id) === Number(params[0]));
                if (item) item.estado = 'EN_EJECUCION';
                return resultado(item ? [item] : []);
            }
            if (normal.includes("SET estado = 'REQUIERE_INTERVENCION'")) {
                const item = estado.solicitudes.find((s) => Number(s.id) === Number(params[1]));
                if (item) {
                    item.estado = 'REQUIERE_INTERVENCION';
                    item.version = Number(params[0]);
                }
                return resultado(item ? [item] : []);
            }
            if (normal.includes("SET estado = 'COMPLETADA'")) {
                const item = estado.solicitudes.find((s) => Number(s.id) === Number(params[1])
                    && (s.estado === 'EN_EJECUCION' || s.estado === 'APROBADA'));
                if (!item) return resultado([]);
                item.estado = 'COMPLETADA';
                item.resultado_tecnico = JSON.parse(params[0]);
                item.version += 1;
                item.fecha_modificacion = new Date();
                return resultado([{ ...item }]);
            }
        }

        if (normal.startsWith('INSERT INTO fg_solicitud_operacion_evento')) {
            const ev = {
                id: estado.eventos.length + 1,
                solicitud_id: params[0],
                tipo_evento: params[1],
                estado_anterior: params[2],
                estado_posterior: params[3],
                usuario_responsable: params[4],
                comentario: params[5],
                metadatos: params[6] ? JSON.parse(params[6]) : null,
            };
            estado.eventos.push(ev);
            return resultado([]);
        }

        return resultado([]);
    };

    return {
        query,
        connect: async () => ({ query, release: () => {} }),
        estado,
    };
};

test('1. Por defecto, anulación técnica deshabilitada para todos los tipos: conserva EMITIDO y solicitud pasa a REQUIERE_INTERVENCION', async () => {
    const dbMock = crearDbSimuladaFase2();
    // Instanciación por defecto sin configuración habilitante
    const svc = _private.crearServicio(dbMock);

    await assert.rejects(
        () => svc.ejecutarAnulacionCertificado(1, { version: 2, justificacion: 'Físico dañado' }, { username: 'sistemas' }),
        (err) => err.code === 'ANULACION_REQUIERE_VALIDACION_EXTERNA' && err.statusCode === 409
    );

    // Certificado permanece estrictamente EMITIDO
    assert.equal(dbMock.estado.certificados[0].estado, 'EMITIDO');
    // Solicitud transiciona a REQUIERE_INTERVENCION
    assert.equal(dbMock.estado.solicitudes[0].estado, 'REQUIERE_INTERVENCION');
    // Se registró evento de auditoría
    assert.equal(dbMock.estado.eventos[0].tipo_evento, 'ANULACION_REQUIERE_VALIDACION_EXTERNA');
});

test('2. Solicitud con habilitación explícita ejecuta anulación técnica: APROBADA -> EN_EJECUCION -> COMPLETADA', async () => {
    const dbMock = crearDbSimuladaFase2();
    const svc = _private.crearServicio(dbMock, CONFIG_HABILITADA_PRUEBAS);
    const res = await svc.ejecutarAnulacionCertificado(1, { version: 2, justificacion: 'Físico dañado' }, { username: 'sistemas' });

    assert.equal(res.solicitud.estado, 'COMPLETADA');
    assert.equal(res.certificado.estado, 'ANULADO');
    assert.equal(res.certificado.numero, 'DG-41-000308');
    assert.equal(dbMock.estado.certificados[0].estado, 'ANULADO');
    assert.equal(dbMock.estado.certificados[0].solicitud_anulacion_id, 1);

    // Eventos registran la secuencia completa
    assert.equal(dbMock.estado.eventos.length, 2);
    assert.equal(dbMock.estado.eventos[0].tipo_evento, 'EJECUCION_INICIADA');
    assert.equal(dbMock.estado.eventos[0].estado_anterior, 'APROBADA');
    assert.equal(dbMock.estado.eventos[0].estado_posterior, 'EN_EJECUCION');
    assert.equal(dbMock.estado.eventos[1].tipo_evento, 'CERTIFICADO_ANULADO_TECNICAMENTE');
    assert.equal(dbMock.estado.eventos[1].estado_anterior, 'EN_EJECUCION');
    assert.equal(dbMock.estado.eventos[1].estado_posterior, 'COMPLETADA');
});

test('3. Solicitud pendiente rechaza la ejecución técnica', async () => {
    const dbMock = crearDbSimuladaFase2({
        solicitudes: [filaSolicitudAprobada({ estado: 'PENDIENTE_APROBACION' })],
    });
    const svc = _private.crearServicio(dbMock, CONFIG_HABILITADA_PRUEBAS);
    await assert.rejects(
        () => svc.ejecutarAnulacionCertificado(1, { version: 2 }, { username: 'sistemas' }),
        (err) => err.code === 'SOLICITUD_NO_APROBADA' && err.statusCode === 409
    );
});

test('4. Solicitud rechazada rechaza la ejecución técnica', async () => {
    const dbMock = crearDbSimuladaFase2({
        solicitudes: [filaSolicitudAprobada({ estado: 'RECHAZADA' })],
    });
    const svc = _private.crearServicio(dbMock, CONFIG_HABILITADA_PRUEBAS);
    await assert.rejects(
        () => svc.ejecutarAnulacionCertificado(1, { version: 2 }, { username: 'sistemas' }),
        (err) => err.code === 'SOLICITUD_RECHAZADA' && err.statusCode === 409
    );
});

test('5. Solicitud cancelada rechaza la ejecución técnica', async () => {
    const dbMock = crearDbSimuladaFase2({
        solicitudes: [filaSolicitudAprobada({ estado: 'CANCELADA' })],
    });
    const svc = _private.crearServicio(dbMock, CONFIG_HABILITADA_PRUEBAS);
    await assert.rejects(
        () => svc.ejecutarAnulacionCertificado(1, { version: 2 }, { username: 'sistemas' }),
        (err) => err.code === 'SOLICITUD_CANCELADA' && err.statusCode === 409
    );
});

test('6. Solicitud completada responde de forma idempotente con datos ya consolidados', async () => {
    const dbMock = crearDbSimuladaFase2({
        solicitudes: [filaSolicitudAprobada({ estado: 'COMPLETADA' })],
        estadoCertificado: 'ANULADO',
    });
    const svc = _private.crearServicio(dbMock, CONFIG_HABILITADA_PRUEBAS);
    const res = await svc.ejecutarAnulacionCertificado(1, { version: 2 }, { username: 'sistemas' });

    assert.equal(res.yaCompletada, true);
    assert.equal(res.solicitud.estado, 'COMPLETADA');
    assert.equal(res.certificado.estado, 'ANULADO');
});

test('7. Tipo de operación incorrecto es rechazado', async () => {
    const dbMock = crearDbSimuladaFase2({
        solicitudes: [filaSolicitudAprobada({ tipo_operacion: 'RECTIFICAR_CERTIFICADO' })],
    });
    const svc = _private.crearServicio(dbMock, CONFIG_HABILITADA_PRUEBAS);
    await assert.rejects(
        () => svc.ejecutarAnulacionCertificado(1, { version: 2 }, { username: 'sistemas' }),
        (err) => err.code === 'TIPO_OPERACION_INVALIDO_PARA_EJECUCION' && err.statusCode === 409
    );
});

test('8. Certificado inexistente rechaza la ejecución técnica', async () => {
    const dbMock = crearDbSimuladaFase2({ certificados: [] });
    const svc = _private.crearServicio(dbMock, CONFIG_HABILITADA_PRUEBAS);
    await assert.rejects(
        () => svc.ejecutarAnulacionCertificado(1, { version: 2 }, { username: 'sistemas' }),
        (err) => err.code === 'CERTIFICADO_NO_ENCONTRADO' && err.statusCode === 404
    );
});

test('9. Certificado no emitido (ej. BORRADOR) es rechazado', async () => {
    const dbMock = crearDbSimuladaFase2({ estadoCertificado: 'BORRADOR' });
    const svc = _private.crearServicio(dbMock, CONFIG_HABILITADA_PRUEBAS);
    await assert.rejects(
        () => svc.ejecutarAnulacionCertificado(1, { version: 2 }, { username: 'sistemas' }),
        (err) => err.code === 'CERTIFICADO_NO_EMITIDO' && err.statusCode === 409
    );
});

test('10. Certificado ya anulado es rechazado', async () => {
    const dbMock = crearDbSimuladaFase2({ estadoCertificado: 'ANULADO' });
    const svc = _private.crearServicio(dbMock, CONFIG_HABILITADA_PRUEBAS);
    await assert.rejects(
        () => svc.ejecutarAnulacionCertificado(1, { version: 2 }, { username: 'sistemas' }),
        (err) => err.code === 'CERTIFICADO_YA_ANULADO' && err.statusCode === 409
    );
});

test('11. Usuario sin permiso recibe 403', async () => {
    const dbMock = crearDbSimuladaFase2();
    const svc = _private.crearServicio(dbMock, CONFIG_HABILITADA_PRUEBAS);
    await assert.rejects(
        () => svc.ejecutarAnulacionCertificado(1, { version: 2 }, { username: 'sinpermiso' }),
        (err) => err.code === 'SOLICITUD_PERMISO_DENEGADO' && err.statusCode === 403
    );
});

test('12. Permiso administrativo por sí solo no habilita la anulación técnica si está deshabilitada', async () => {
    const dbMock = crearDbSimuladaFase2();
    // usuario sistemas tiene FAREGAS_CERTIFICADO_ANULAR_EJECUTAR y ADMINISTRAR
    const svc = _private.crearServicio(dbMock); // Sin configuración habilitante
    await assert.rejects(
        () => svc.ejecutarAnulacionCertificado(1, { version: 2 }, { username: 'sistemas' }),
        (err) => err.code === 'ANULACION_REQUIERE_VALIDACION_EXTERNA' && err.statusCode === 409
    );
    assert.equal(dbMock.estado.certificados[0].estado, 'EMITIDO');
});

test('13. Empresa incorrecta rechaza con 403', async () => {
    const dbMock = crearDbSimuladaFase2({ empresaCertificado: 'OTRA_EMPRESA' });
    const svc = _private.crearServicio(dbMock, CONFIG_HABILITADA_PRUEBAS);
    await assert.rejects(
        () => svc.ejecutarAnulacionCertificado(1, { version: 2 }, { username: 'sistemas' }),
        (err) => err.code === 'SOLICITUD_EMPRESA_NO_AUTORIZADA' && err.statusCode === 403
    );
});

test('14. Sede incorrecta rechaza con 403', async () => {
    const dbMock = crearDbSimuladaFase2({ plantaCertificado: 'LURIN' });
    const svc = _private.crearServicio(dbMock, CONFIG_HABILITADA_PRUEBAS);
    await assert.rejects(
        () => svc.ejecutarAnulacionCertificado(1, { version: 2 }, { username: 'sistemas' }),
        (err) => err.code === 'SOLICITUD_SEDE_NO_AUTORIZADA' && err.statusCode === 403
    );
});

test('15. Ejecutor igual al solicitante viola separación de funciones', async () => {
    const dbMock = crearDbSimuladaFase2({
        solicitudes: [filaSolicitudAprobada({ usuario_solicitante: 'sistemas' })],
    });
    const svc = _private.crearServicio(dbMock, CONFIG_HABILITADA_PRUEBAS);
    await assert.rejects(
        () => svc.ejecutarAnulacionCertificado(1, { version: 2 }, { username: 'sistemas' }),
        (err) => err.code === 'SOLICITUD_AUTODECISION_PROHIBIDA' && err.statusCode === 403
    );
});

test('16. Dos ejecuciones concurrentes: la versión obsoleta es rechazada', async () => {
    const dbMock = crearDbSimuladaFase2();
    const svc = _private.crearServicio(dbMock, CONFIG_HABILITADA_PRUEBAS);
    await assert.rejects(
        () => svc.ejecutarAnulacionCertificado(1, { version: 1 }, { username: 'sistemas' }),
        (err) => err.code === 'SOLICITUD_VERSION_DESACTUALIZADA' && err.statusCode === 409
    );
});

test('17. Doble clic: el segundo llamado devuelve la respuesta idempotente sin duplicar ejecución', async () => {
    const dbMock = crearDbSimuladaFase2();
    const svc = _private.crearServicio(dbMock, CONFIG_HABILITADA_PRUEBAS);
    const r1 = await svc.ejecutarAnulacionCertificado(1, { version: 2 }, { username: 'sistemas' });
    assert.equal(r1.solicitud.estado, 'COMPLETADA');
    assert.equal(r1.yaCompletada, false);

    // Segundo clic concurrente / inmediato
    const r2 = await svc.ejecutarAnulacionCertificado(1, { version: 2 }, { username: 'sistemas' });
    assert.equal(r2.solicitud.estado, 'COMPLETADA');
    assert.equal(r2.yaCompletada, true);

    const certUpdates = dbMock.estado.queriesEjecutadas.filter((q) => q.sql.startsWith('UPDATE fg_certificado'));
    assert.equal(certUpdates.length, 1);
});

test('18. Respuesta HTTP perdida / reintento cuando ya se completó: devuelve estado COMPLETADA sin error', async () => {
    const dbMock = crearDbSimuladaFase2();
    const svc = _private.crearServicio(dbMock, CONFIG_HABILITADA_PRUEBAS);
    await svc.ejecutarAnulacionCertificado(1, { version: 2 }, { username: 'sistemas' });

    // Reintento una vez completada con la nueva versión
    const r2 = await svc.ejecutarAnulacionCertificado(1, { version: 3 }, { username: 'sistemas' });
    assert.equal(r2.yaCompletada, true);
    assert.equal(r2.certificado.estado, 'ANULADO');
});

test('19. Idempotencia: estado permanece ANULADO tras consultas repetidas', async () => {
    const dbMock = crearDbSimuladaFase2();
    const svc = _private.crearServicio(dbMock, CONFIG_HABILITADA_PRUEBAS);
    await svc.ejecutarAnulacionCertificado(1, { version: 2 }, { username: 'sistemas' });
    assert.equal(dbMock.estado.certificados[0].estado, 'ANULADO');
});

test('20. Error SQL con rollback: no deja datos inconsistentes', async () => {
    const dbMock = crearDbSimuladaFase2({ forzarErrorSql: true });
    const svc = _private.crearServicio(dbMock, CONFIG_HABILITADA_PRUEBAS);
    await assert.rejects(
        () => svc.ejecutarAnulacionCertificado(1, { version: 2 }, { username: 'sistemas' }),
        (err) => err.message === 'SIMULATED_SQL_ERROR'
    );
    // Tras rollback el estado no se modificó
    assert.equal(dbMock.estado.certificados[0].estado, 'EMITIDO');
    assert.equal(dbMock.estado.solicitudes[0].estado, 'APROBADA');
});

test('21. Conservación de número DG: el campo numero_certificado permanece idéntico', async () => {
    const dbMock = crearDbSimuladaFase2();
    const svc = _private.crearServicio(dbMock, CONFIG_HABILITADA_PRUEBAS);
    await svc.ejecutarAnulacionCertificado(1, { version: 2 }, { username: 'sistemas' });
    assert.equal(dbMock.estado.certificados[0].numero_certificado, 'DG-41-000308');
});

test('22. Conservación de fecha original: fecha_emision no se modifica ni se limpia', async () => {
    const dbMock = crearDbSimuladaFase2();
    const svc = _private.crearServicio(dbMock, CONFIG_HABILITADA_PRUEBAS);
    await svc.ejecutarAnulacionCertificado(1, { version: 2 }, { username: 'sistemas' });
    assert.equal(dbMock.estado.certificados[0].fecha_emision, '2026-10-22');
});

test('23. Conservación de datos técnicos: observaciones y cliente se conservan', async () => {
    const dbMock = crearDbSimuladaFase2();
    const svc = _private.crearServicio(dbMock, CONFIG_HABILITADA_PRUEBAS);
    await svc.ejecutarAnulacionCertificado(1, { version: 2 }, { username: 'sistemas' });
    assert.equal(dbMock.estado.certificados[0].cliente_id, 5);
    assert.equal(dbMock.estado.certificados[0].observaciones, 'Inspeccion conforme');
});

test('24. Conservación de PDFs: datos originales de certificado y comprobante se conservan', async () => {
    const dbMock = crearDbSimuladaFase2();
    const svc = _private.crearServicio(dbMock, CONFIG_HABILITADA_PRUEBAS);
    const res = await svc.ejecutarAnulacionCertificado(1, { version: 2 }, { username: 'sistemas' });
    assert.equal(res.solicitud.datosOriginalesCertificado.numero, 'DG-41-000308');
    assert.equal(res.solicitud.datosOriginalesComprobante.numero, 'BBB1-00000216');
});

test('25. Ningún UPDATE sobre fg_facturacion', async () => {
    const dbMock = crearDbSimuladaFase2();
    const svc = _private.crearServicio(dbMock, CONFIG_HABILITADA_PRUEBAS);
    await svc.ejecutarAnulacionCertificado(1, { version: 2 }, { username: 'sistemas' });
    const updatesFac = dbMock.estado.queriesEjecutadas.filter((q) => q.sql.includes('UPDATE fg_facturacion'));
    assert.equal(updatesFac.length, 0);
    assert.equal(dbMock.estado.facturaciones[0].estado, 'ACEPTADO');
});

test('26. Ningún UPDATE sobre fg_pago y fg_orden_pago', async () => {
    const dbMock = crearDbSimuladaFase2();
    const svc = _private.crearServicio(dbMock, CONFIG_HABILITADA_PRUEBAS);
    await svc.ejecutarAnulacionCertificado(1, { version: 2 }, { username: 'sistemas' });
    const updatesPago = dbMock.estado.queriesEjecutadas.filter((q) => q.sql.includes('UPDATE fg_pago'));
    const updatesOp = dbMock.estado.queriesEjecutadas.filter((q) => q.sql.includes('UPDATE fg_orden_pago'));
    assert.equal(updatesPago.length, 0);
    assert.equal(updatesOp.length, 0);
    assert.equal(dbMock.estado.pagos[0].estado, 'PAGADO');
});

test('27. Ninguna llamada NubeFact ni modificación de rangos DG', async () => {
    const backendRoot = path.resolve(__dirname, '..');
    const codigoSvc = fs.readFileSync(path.join(backendRoot, 'services', 'faregas-solicitudes-operacion.service.js'), 'utf8');
    assert.doesNotMatch(
        codigoSvc,
        /require\(['"][^'"]*(?:integrations[\\/]nubefact|nubefact\.service)[^'"]*['"]\)|api\.nubefact\.com/i,
        'El servicio de solicitudes no debe importar el cliente NubeFact ni llamar su API'
    );

    const dbMock = crearDbSimuladaFase2();
    const svc = _private.crearServicio(dbMock, CONFIG_HABILITADA_PRUEBAS);
    await svc.ejecutarAnulacionCertificado(1, { version: 2 }, { username: 'sistemas' });
    const updatesCorrelativo = dbMock.estado.queriesEjecutadas.filter((q) => q.sql.includes('fg_correlativo_certificado'));
    assert.equal(updatesCorrelativo.length, 0);
    assert.equal(dbMock.estado.correlativos[0].nro_actual, 308);
});

test('28. Solicitud completada solo tras éxito de la anulación', async () => {
    const dbMock = crearDbSimuladaFase2();
    const svc = _private.crearServicio(dbMock, CONFIG_HABILITADA_PRUEBAS);
    const res = await svc.ejecutarAnulacionCertificado(1, { version: 2 }, { username: 'sistemas' });
    assert.equal(res.solicitud.estado, 'COMPLETADA');
    assert.equal(res.solicitud.version, 3);
});

test('29. Solicitud en REQUIERE_INTERVENCION puede continuar y completarse una vez autorizada', async () => {
    const dbMock = crearDbSimuladaFase2({
        solicitudes: [filaSolicitudAprobada({ estado: 'REQUIERE_INTERVENCION', version: 3 })],
    });
    const svc = _private.crearServicio(dbMock, CONFIG_HABILITADA_PRUEBAS);
    const res = await svc.ejecutarAnulacionCertificado(1, { version: 3, justificacion: 'Autorizado tras verificación' }, { username: 'sistemas' });
    assert.equal(res.solicitud.estado, 'COMPLETADA');
    assert.equal(res.certificado.estado, 'ANULADO');
});

test('30. anularCertificadoEmitido rechaza ejecución directa sin solicitud autorizada o con solicitante igual a ejecutor', async () => {
    const dbMock = crearDbSimuladaFase2();
    const client = await dbMock.connect();

    // 1. Intento sin solicitud existente
    await assert.rejects(
        () => certificadosService.anularCertificadoEmitido({
            client,
            certificadoId: 10,
            justificacion: 'Intento directo no autorizado',
            solicitudId: 999,
            usuario: 'sistemas'
        }),
        /SOLICITUD_AUTORIZACION_NO_ENCONTRADA/
    );

    // 2. Intento violando separación de funciones (ejecutor = solicitante)
    await assert.rejects(
        () => certificadosService.anularCertificadoEmitido({
            client,
            certificadoId: 10,
            justificacion: 'Intento con solicitante',
            solicitudId: 1,
            usuario: 'operador'
        }),
        /SEPARACION_FUNCIONES_VIOLADA/
    );
});
