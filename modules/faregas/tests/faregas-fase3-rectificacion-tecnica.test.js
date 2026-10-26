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
    CAMPOS_RECTIFICABLES_PERMITIDOS,
} = require('../services/faregas-solicitudes-operacion.constants');

const UUID_1 = '123e4567-e89b-42d3-a456-426614174000';
const UUID_2 = '223e4567-e89b-42d3-a456-426614174001';

const filaSolicitudRectificacion = (overrides = {}) => ({
    id: 1,
    tipo_operacion: 'RECTIFICAR_CERTIFICADO',
    certificado_id: 10,
    facturacion_id: 20,
    empresa_key: 'FAREGAS',
    planta_key: 'SURCO',
    usuario_solicitante: 'operador',
    motivo: 'Corrección de placa y modelo digitados erróneamente',
    observaciones: null,
    estado: 'APROBADA',
    usuario_decision: 'jefe',
    fecha_solicitud: new Date('2026-10-22T10:00:00Z'),
    fecha_decision: new Date('2026-10-22T11:00:00Z'),
    justificacion_decision: 'Aprobado conforme a tarjeta de propiedad adjunta',
    datos_originales_certificado: { id: 10, numero: 'DG-41-000308', tipo: 'INSPECCION_TALLER', estado: 'EMITIDO', placa: 'ABC-123' },
    datos_originales_comprobante: { id: 20, numero: 'BBB1-00000216', estado: 'ACEPTADO' },
    datos_propuestos: { placa: 'ABC-124', modelo: 'HILUX 4X4' },
    fecha_emision_original: '2026-10-22',
    resultado_tecnico: null,
    resultado_fiscal: null,
    idempotencia_clave: UUID_1,
    version: 2,
    fecha_creacion: new Date('2026-10-22T10:00:00Z'),
    fecha_modificacion: new Date('2026-10-22T11:00:00Z'),
    ...overrides,
});

const crearDbSimuladaFase3 = (opciones = {}) => {
    let snapshotTransaccion = null;

    const estado = {
        solicitudes: (opciones.solicitudes || [filaSolicitudRectificacion()]).map((item) => ({ ...item })),
        certificados: (opciones.certificados || [{
            id: 10,
            numero_certificado: 'DG-41-000308',
            tipo_certificado_clave: opciones.tipoCertificado || 'INSPECCION_TALLER',
            estado: opciones.estadoCertificado || 'EMITIDO',
            fecha_emision: '2026-10-22',
            planta_key: opciones.plantaCertificado || 'SURCO',
            empresa_key: opciones.empresaCertificado || 'FAREGAS',
            cliente_id: 5,
            observaciones: 'Inspeccion inicial conforme',
        }]).map((c) => ({ ...c })),
        vehiculos: (opciones.vehiculos || [{
            certificado_id: 10,
            placa: opciones.placaActual || 'ABC-123',
            categoria: 'M1',
            clase: 'CAMIONETA',
            marca: 'TOYOTA',
            modelo: 'HILUX',
            vin: '8AJBA3CD9E1234567',
            numero_motor: '2GD1234567',
            color: 'BLANCO',
            combustible: 'DIESEL',
            carroceria: 'PICK UP'
        }]).map((v) => ({ ...v })),
        titulares: (opciones.titulares || [{
            id: 1,
            certificado_id: 10,
            orden: 1,
            tipo_documento: 'DNI',
            nro_documento: '12345678',
            nombre_razon_social: 'JUAN PEREZ',
            direccion: 'AV. PRINCIPAL 123'
        }]).map((t) => ({ ...t })),
        especificos: [],
        versiones: (opciones.versiones || []).map((v) => ({ ...v })),
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
                PERMISOS_SOLICITUD.EJECUTAR_RECTIFICACION_CERTIFICADO
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
                vehiculos: estado.vehiculos,
                versiones: estado.versiones,
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
                estado.vehiculos = s.vehiculos;
                estado.versiones = s.versiones;
                estado.eventos = s.eventos;
                snapshotTransaccion = null;
            }
            return resultado([]);
        }

        if (opciones.forzarErrorSql && normal.startsWith('INSERT INTO fg_certificado_version')) {
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

        if (normal.startsWith('SELECT id, numero_certificado, estado, fecha_emision FROM fg_certificado WHERE id = $1')) {
            const cert = estado.certificados.find((c) => Number(c.id) === Number(params[0]));
            return resultado(cert ? [cert] : []);
        }

        if (normal.includes('FROM fg_certificado c') && normal.includes('WHERE c.id = $1')) {
            const cert = estado.certificados.find((c) => Number(c.id) === Number(params[0]));
            if (!cert) return resultado([]);
            return resultado([{ ...cert }]);
        }

        if (normal.includes('FROM fg_certificado_vehiculo WHERE certificado_id = $1')) {
            const veh = estado.vehiculos.find((v) => Number(v.certificado_id) === Number(params[0]));
            return resultado(veh ? [veh] : []);
        }

        if (normal.includes('FROM fg_certificado_titular WHERE certificado_id = $1')) {
            const tits = estado.titulares.filter((t) => Number(t.certificado_id) === Number(params[0]));
            return resultado(tits);
        }

        if (normal.includes('FROM fg_certificado_version') && normal.includes('numero_version = 1')) {
            const v1 = estado.versiones.find((v) => Number(v.certificado_id) === Number(params[0]) && v.numero_version === 1);
            return resultado(v1 ? [v1] : []);
        }

        if (normal.includes('MAX(numero_version)')) {
            const certVers = estado.versiones.filter((v) => Number(v.certificado_id) === Number(params[0]));
            const max = certVers.length > 0 ? Math.max(...certVers.map((v) => v.numero_version)) : 1;
            return resultado([{ max_version: max }]);
        }

        if (normal.includes('FROM fg_certificado_version WHERE id = $1')) {
            const ver = estado.versiones.find((v) => Number(v.id) === Number(params[0]));
            return resultado(ver ? [ver] : []);
        }

        if (normal.includes('FROM fg_certificado_version WHERE solicitud_id = $1')) {
            const vers = estado.versiones.filter((v) => Number(v.solicitud_id) === Number(params[0]));
            return resultado(vers.slice(-1));
        }

        if (normal.startsWith('INSERT INTO fg_certificado_version')) {
            const esOriginal = normal.includes("'ORIGINAL'");
            const nueva = esOriginal ? {
                id: estado.versiones.length + 1,
                certificado_id: params[0],
                solicitud_id: null,
                numero_version: 1,
                estado_version: 'ORIGINAL',
                es_vigente: true,
                fecha_emision_original: params[1],
                usuario_creacion: params[2],
                usuario_aprobacion: null,
                motivo: 'Versión original de emisión del certificado.',
                snapshot_datos: typeof params[3] === 'string' ? JSON.parse(params[3]) : params[3],
                diferencias: [],
                enlace_pdf_original: null,
                enlace_pdf_version: null,
                metadatos: { origen: 'EMISION_ORIGINAL' },
                fecha_version: new Date()
            } : {
                id: estado.versiones.length + 1,
                certificado_id: params[0],
                solicitud_id: params[1],
                numero_version: params[2],
                estado_version: 'PREPARADA',
                es_vigente: false,
                fecha_emision_original: params[3],
                usuario_creacion: params[4],
                usuario_aprobacion: params[5],
                motivo: params[6],
                snapshot_datos: typeof params[7] === 'string' ? JSON.parse(params[7]) : params[7],
                diferencias: params[8] ? (typeof params[8] === 'string' ? JSON.parse(params[8]) : params[8]) : [],
                enlace_pdf_original: null,
                enlace_pdf_version: 'BORRADOR DE RECTIFICACIÓN — NO VÁLIDO COMO CERTIFICADO OFICIAL',
                metadatos: params[9] ? (typeof params[9] === 'string' ? JSON.parse(params[9]) : params[9]) : null,
                fecha_version: new Date()
            };
            estado.versiones.push(nueva);
            return resultado([nueva]);
        }

        if (normal.startsWith('UPDATE fg_certificado_version')) {
            if (normal.includes('es_vigente = FALSE')) {
                estado.versiones.forEach((v) => {
                    if (Number(v.certificado_id) === Number(params[0])) v.es_vigente = false;
                });
            }
            if (normal.includes("estado_version = 'VIGENTE'")) {
                const target = estado.versiones.find((v) => Number(v.id) === Number(params[0]));
                if (target) {
                    target.es_vigente = true;
                    target.estado_version = 'VIGENTE';
                    target.fecha_aplicacion_oficial = new Date();
                }
            }
            return resultado([]);
        }

        if (normal.startsWith('UPDATE fg_certificado_vehiculo')) {
            const veh = estado.vehiculos.find((v) => Number(v.certificado_id) === Number(params[9]));
            if (veh) {
                if (params[0]) veh.placa = params[0];
                if (params[1]) veh.marca = params[1];
                if (params[2]) veh.modelo = params[2];
            }
            return resultado(veh ? [veh] : []);
        }

        if (normal.startsWith('UPDATE fg_solicitud_operacion')) {
            if (normal.includes("SET estado = 'EN_EJECUCION'")) {
                const item = estado.solicitudes.find((s) => Number(s.id) === Number(params[0]));
                if (item) item.estado = 'EN_EJECUCION';
                return resultado(item ? [item] : []);
            }
            if (normal.includes("SET estado = 'REQUIERE_INTERVENCION'")) {
                const item = estado.solicitudes.find((s) => Number(s.id) === Number(params[2]));
                if (item) {
                    item.estado = 'REQUIERE_INTERVENCION';
                    item.resultado_tecnico = JSON.parse(params[0]);
                    item.version = Number(params[1]);
                }
                return resultado(item ? [item] : []);
            }
            if (normal.includes("SET estado = 'COMPLETADA'")) {
                const item = estado.solicitudes.find((s) => Number(s.id) === Number(params[1]));
                if (!item) return resultado([]);
                item.estado = 'COMPLETADA';
                item.resultado_tecnico = JSON.parse(params[0]);
                item.version += 1;
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

test('1. Crear solicitud de rectificación con datos válidos', () => {
    const propuestos = { placa: 'ABC-124', modelo: 'HILUX 4X4' };
    const res = _private.validarDatosPropuestos('RECTIFICAR_CERTIFICADO', propuestos);
    assert.deepEqual(res, propuestos);
});

test('2. Rechazar propuesta vacía', () => {
    assert.throws(
        () => _private.validarDatosPropuestos('RECTIFICAR_CERTIFICADO', {}),
        (err) => err.code === 'DATOS_PROPUESTOS_REQUERIDOS'
    );
});

test('3. Rechazar campos no permitidos / protegidos', () => {
    // Campo prohibido crítico
    assert.throws(
        () => _private.validarDatosPropuestos('RECTIFICAR_CERTIFICADO', { numero_certificado: 'DG-99-999999' }),
        (err) => err.code === 'DATO_PROPUESTO_PROHIBIDO'
    );
    // Campo no rectificable
    assert.throws(
        () => _private.validarDatosPropuestos('RECTIFICAR_CERTIFICADO', { tarifa_codigo: 'T-100' }),
        (err) => err.code === 'CAMPO_NO_RECTIFICABLE'
    );
});

test('4. Comprobar campos permitidos según tipo', () => {
    assert.equal(CAMPOS_RECTIFICABLES_PERMITIDOS.has('placa'), true);
    assert.equal(CAMPOS_RECTIFICABLES_PERMITIDOS.has('marca'), true);
    assert.equal(CAMPOS_RECTIFICABLES_PERMITIDOS.has('modelo'), true);
    assert.equal(CAMPOS_RECTIFICABLES_PERMITIDOS.has('vin'), true);
    assert.equal(CAMPOS_RECTIFICABLES_PERMITIDOS.has('numero_motor'), true);
    assert.equal(CAMPOS_RECTIFICABLES_PERMITIDOS.has('observaciones'), true);
    assert.equal(CAMPOS_RECTIFICABLES_PERMITIDOS.has('numero_chip'), true);
    assert.equal(CAMPOS_RECTIFICABLES_PERMITIDOS.has('precio_certificado'), false);
    assert.equal(CAMPOS_RECTIFICABLES_PERMITIDOS.has('numero_certificado'), false);
});

test('5. Validar cálculo y persistencia de diferencias', () => {
    const snap = {
        vehiculo: { placa: 'ABC-123', modelo: 'HILUX' },
        observaciones: 'Original'
    };
    const propuestos = { placa: 'ABC-124', observaciones: 'Corregida' };
    const diffs = _private.calcularDiferencias(snap, propuestos);

    assert.equal(diffs.length, 2);
    assert.deepEqual(diffs[0], { campo: 'placa', valorOriginal: 'ABC-123', valorPropuesto: 'ABC-124' });
    assert.deepEqual(diffs[1], { campo: 'observaciones', valorOriginal: 'Original', valorPropuesto: 'Corregida' });
});

test('6. Propuesta sin diferencias reales es rechazada', async () => {
    const dbMock = crearDbSimuladaFase3({
        solicitudes: [filaSolicitudRectificacion({
            datos_propuestos: { placa: 'ABC-123' } // Misma placa actual
        })],
        placaActual: 'ABC-123'
    });
    const svc = _private.crearServicio(dbMock);
    await assert.rejects(
        () => svc.ejecutarRectificacionCertificado(1, { version: 2 }, { username: 'sistemas' }),
        (err) => err.code === 'PROPUESTA_SIN_DIFERENCIAS' && err.statusCode === 400
    );
});

test('7. Conservar snapshot original íntegro al crear versión 1', async () => {
    const dbMock = crearDbSimuladaFase3();
    const client = await dbMock.connect();
    const v1 = await certificadosService.asegurarVersionOriginal({
        client,
        certificadoId: 10,
        usuario: 'jefe'
    });

    assert.equal(v1.numero_version, 1);
    assert.equal(v1.estado_version, 'ORIGINAL');
    assert.equal(v1.es_vigente, true);
    assert.equal(v1.snapshot_datos.numeroCertificado, 'DG-41-000308');
    assert.equal(v1.snapshot_datos.vehiculo.placa, 'ABC-123');
});

test('8. Preparar versión rectificada con permiso crea versión PREPARADA (Nivel 1)', async () => {
    const dbMock = crearDbSimuladaFase3();
    const svc = _private.crearServicio(dbMock);

    const res = await svc.ejecutarRectificacionCertificado(1, { version: 2 }, { username: 'sistemas' });

    assert.equal(res.version.numero_version, 2);
    assert.equal(res.version.estado_version, 'PREPARADA');
    assert.equal(res.oficialAplicado, false);
    assert.equal(res.solicitud.estado, 'REQUIERE_INTERVENCION');
    // Certificado permanece EMITIDO y sus datos no se modificaron en vivo
    assert.equal(dbMock.estado.certificados[0].estado, 'EMITIDO');
    assert.equal(dbMock.estado.vehiculos[0].placa, 'ABC-123');
});

test('9. Bloquear autoaprobación / autoejecución (solicitante ≠ ejecutor)', async () => {
    const dbMock = crearDbSimuladaFase3({
        solicitudes: [filaSolicitudRectificacion({ usuario_solicitante: 'sistemas' })]
    });
    const svc = _private.crearServicio(dbMock);
    await assert.rejects(
        () => svc.ejecutarRectificacionCertificado(1, { version: 2 }, { username: 'sistemas' }),
        (err) => err.code === 'SOLICITUD_AUTODECISION_PROHIBIDA' && err.statusCode === 403
    );
});

test('10. Rechazar preparación sin permiso FAREGAS_CERTIFICADO_RECTIFICAR_EJECUTAR', async () => {
    const dbMock = crearDbSimuladaFase3();
    const svc = _private.crearServicio(dbMock);
    await assert.rejects(
        () => svc.ejecutarRectificacionCertificado(1, { version: 2 }, { username: 'sinpermiso' }),
        (err) => err.code === 'SOLICITUD_PERMISO_DENEGADO' && err.statusCode === 403
    );
});

test('11. Restringir preparación por empresa ajena', async () => {
    const dbMock = crearDbSimuladaFase3({ empresaCertificado: 'OTRA_EMPRESA' });
    const svc = _private.crearServicio(dbMock);
    await assert.rejects(
        () => svc.ejecutarRectificacionCertificado(1, { version: 2 }, { username: 'sistemas' }),
        (err) => err.code === 'SOLICITUD_EMPRESA_NO_AUTORIZADA' && err.statusCode === 403
    );
});

test('12. Restringir preparación por sede ajena', async () => {
    const dbMock = crearDbSimuladaFase3({ plantaCertificado: 'LURIN' });
    const svc = _private.crearServicio(dbMock);
    await assert.rejects(
        () => svc.ejecutarRectificacionCertificado(1, { version: 2 }, { username: 'sistemas' }),
        (err) => err.code === 'SOLICITUD_SEDE_NO_AUTORIZADA' && err.statusCode === 403
    );
});

test('13. Detectar drift del documento original respecto a la solicitud creada', async () => {
    const dbMock = crearDbSimuladaFase3({
        // La solicitud se basó en placa 'ABC-123', pero el vehículo actual tiene 'XYZ-777'
        placaActual: 'XYZ-777'
    });
    const svc = _private.crearServicio(dbMock);
    await assert.rejects(
        () => svc.ejecutarRectificacionCertificado(1, { version: 2 }, { username: 'sistemas' }),
        (err) => err.code === 'DOCUMENTO_ORIGINAL_MODIFICADO' && err.statusCode === 409
    );
});

test('14. Concurrencia optimista: versión de solicitud obsoleta es rechazada', async () => {
    const dbMock = crearDbSimuladaFase3();
    const svc = _private.crearServicio(dbMock);
    await assert.rejects(
        () => svc.ejecutarRectificacionCertificado(1, { version: 1 }, { username: 'sistemas' }),
        (err) => err.code === 'SOLICITUD_VERSION_DESACTUALIZADA' && err.statusCode === 409
    );
});

test('15. Idempotencia en ejecución completada', async () => {
    const dbMock = crearDbSimuladaFase3({
        solicitudes: [filaSolicitudRectificacion({ estado: 'COMPLETADA' })],
        versiones: [{
            id: 2,
            certificado_id: 10,
            solicitud_id: 1,
            numero_version: 2,
            estado_version: 'VIGENTE',
            es_vigente: true
        }]
    });
    const svc = _private.crearServicio(dbMock);
    const res = await svc.ejecutarRectificacionCertificado(1, { version: 2 }, { username: 'sistemas' });
    assert.equal(res.yaCompletada, true);
    assert.equal(res.solicitud.estado, 'COMPLETADA');
    assert.equal(res.version.numero_version, 2);
});

test('16. Versiones consecutivas incrementales (1 -> 2 -> 3)', async () => {
    const dbMock = crearDbSimuladaFase3({
        versiones: [
            { id: 1, certificado_id: 10, numero_version: 1, estado_version: 'ORIGINAL', es_vigente: true },
            { id: 2, certificado_id: 10, numero_version: 2, estado_version: 'PREPARADA', es_vigente: false }
        ]
    });
    const client = await dbMock.connect();
    const v3 = await certificadosService.prepararVersionRectificada({
        client,
        certificadoId: 10,
        solicitudId: 1,
        usuario: 'sistemas',
        aprobador: 'jefe',
        motivo: 'Segunda corrección',
        datosPropuestos: { color: 'AZUL' },
        diferencias: [{ campo: 'color', valorOriginal: 'BLANCO', valorPropuesto: 'AZUL' }]
    });

    assert.equal(v3.numero_version, 3);
    assert.equal(v3.estado_version, 'PREPARADA');
});

test('17. Conservar número DG permanentemente idéntico', async () => {
    const dbMock = crearDbSimuladaFase3();
    const svc = _private.crearServicio(dbMock);
    await svc.ejecutarRectificacionCertificado(1, { version: 2 }, { username: 'sistemas' });
    assert.equal(dbMock.estado.certificados[0].numero_certificado, 'DG-41-000308');
});

test('18. Conservar fecha original de emisión intacta (fecha_emision no se modifica)', async () => {
    const dbMock = crearDbSimuladaFase3();
    const svc = _private.crearServicio(dbMock);
    await svc.ejecutarRectificacionCertificado(1, { version: 2 }, { username: 'sistemas' });
    assert.equal(dbMock.estado.certificados[0].fecha_emision, '2026-10-22');
});

test('19. Conservar enlace y datos del PDF original', async () => {
    const dbMock = crearDbSimuladaFase3();
    const svc = _private.crearServicio(dbMock);
    const res = await svc.ejecutarRectificacionCertificado(1, { version: 2 }, { username: 'sistemas' });
    assert.equal(res.solicitud.datosOriginalesCertificado.numero, 'DG-41-000308');
    assert.equal(res.version.enlace_pdf_version.includes('BORRADOR'), true);
});

test('20. No modificar comprobante (fg_facturacion)', async () => {
    const dbMock = crearDbSimuladaFase3();
    const svc = _private.crearServicio(dbMock);
    await svc.ejecutarRectificacionCertificado(1, { version: 2 }, { username: 'sistemas' });
    const updatesFac = dbMock.estado.queriesEjecutadas.filter((q) => q.sql.includes('UPDATE fg_facturacion'));
    assert.equal(updatesFac.length, 0);
    assert.equal(dbMock.estado.facturaciones[0].estado, 'ACEPTADO');
});

test('21. No modificar pagos ni ordenes de pago', async () => {
    const dbMock = crearDbSimuladaFase3();
    const svc = _private.crearServicio(dbMock);
    await svc.ejecutarRectificacionCertificado(1, { version: 2 }, { username: 'sistemas' });
    const updatesPago = dbMock.estado.queriesEjecutadas.filter((q) => q.sql.includes('UPDATE fg_pago') || q.sql.includes('UPDATE fg_orden_pago'));
    assert.equal(updatesPago.length, 0);
    assert.equal(dbMock.estado.pagos[0].estado, 'PAGADO');
});

test('22. No modificar correlativos DG (fg_correlativo_certificado)', async () => {
    const dbMock = crearDbSimuladaFase3();
    const svc = _private.crearServicio(dbMock);
    await svc.ejecutarRectificacionCertificado(1, { version: 2 }, { username: 'sistemas' });
    const updatesCorrelativo = dbMock.estado.queriesEjecutadas.filter((q) => q.sql.includes('fg_correlativo_certificado'));
    assert.equal(updatesCorrelativo.length, 0);
    assert.equal(dbMock.estado.correlativos[0].nro_actual, 308);
});

test('23. No llamar a NubeFact en rectificación técnica', () => {
    const backendRoot = path.resolve(__dirname, '..');
    const codigoSvc = fs.readFileSync(path.join(backendRoot, 'services', 'faregas-solicitudes-operacion.service.js'), 'utf8');
    // El servicio también contiene la anulación fiscal, que sí integra NubeFact.
    // La garantía debe evaluarse sobre el flujo técnico de rectificación.
    const inicio = codigoSvc.indexOf('const ejecutarRectificacionCertificado');
    const fin = codigoSvc.indexOf('\n    const ', inicio + 10);
    const bloqueRectificacion = codigoSvc.slice(inicio, fin > inicio ? fin : undefined);
    assert.ok(bloqueRectificacion.length > 0, 'No se encontró el flujo de rectificación');
    assert.doesNotMatch(bloqueRectificacion, /nubefact/i, 'La rectificación técnica no debe llamar a NubeFact');
});

test('24. Historial de auditoría completo registra eventos de preparación', async () => {
    const dbMock = crearDbSimuladaFase3();
    const svc = _private.crearServicio(dbMock);
    await svc.ejecutarRectificacionCertificado(1, { version: 2, justificacion: 'Sustento peritaje' }, { username: 'sistemas' });

    assert.equal(dbMock.estado.eventos.length, 2);
    assert.equal(dbMock.estado.eventos[0].tipo_evento, 'EJECUCION_RECTIFICACION_INICIADA');
    assert.equal(dbMock.estado.eventos[1].tipo_evento, 'VERSION_RECTIFICACION_PREPARADA');
    assert.equal(dbMock.estado.eventos[1].estado_posterior, 'REQUIERE_INTERVENCION');
    assert.equal(dbMock.estado.eventos[1].usuario_responsable, 'sistemas');
});

test('25. Rollback ante error SQL sin dejar estados corruptos', async () => {
    const dbMock = crearDbSimuladaFase3({ forzarErrorSql: true });
    const svc = _private.crearServicio(dbMock);
    await assert.rejects(
        () => svc.ejecutarRectificacionCertificado(1, { version: 2 }, { username: 'sistemas' }),
        (err) => err.message === 'SIMULATED_SQL_ERROR'
    );
    assert.equal(dbMock.estado.solicitudes[0].estado, 'APROBADA');
    assert.equal(dbMock.estado.vehiculos[0].placa, 'ABC-123');
});

test('26. Nivel 2: Aplicación oficial autorizada promueve versión a VIGENTE y actualiza datos sin tocar fecha_emision', async () => {
    const dbMock = crearDbSimuladaFase3();
    // Instanciación del servicio con autorización explícita de aplicación oficial
    const svc = _private.crearServicio(dbMock, { habilitarAplicacionOficial: true });
    const res = await svc.ejecutarRectificacionCertificado(1, { version: 2, justificacion: 'Aplicación confirmada' }, { username: 'sistemas' });

    assert.equal(res.solicitud.estado, 'COMPLETADA');
    assert.equal(res.version.estado_version, 'VIGENTE');
    assert.equal(res.oficialAplicado, true);
    assert.equal(dbMock.estado.vehiculos[0].placa, 'ABC-124');
    assert.equal(dbMock.estado.certificados[0].fecha_emision, '2026-10-22');
    assert.equal(dbMock.estado.certificados[0].numero_certificado, 'DG-41-000308');
});

test('27. Solicitud rechazada no puede preparar rectificación', async () => {
    const dbMock = crearDbSimuladaFase3({
        solicitudes: [filaSolicitudRectificacion({ estado: 'RECHAZADA' })]
    });
    const svc = _private.crearServicio(dbMock);
    await assert.rejects(
        () => svc.ejecutarRectificacionCertificado(1, { version: 2 }, { username: 'sistemas' }),
        (err) => err.code === 'SOLICITUD_RECHAZADA' && err.statusCode === 409
    );
});

test('28. Solicitud cancelada no puede preparar rectificación', async () => {
    const dbMock = crearDbSimuladaFase3({
        solicitudes: [filaSolicitudRectificacion({ estado: 'CANCELADA' })]
    });
    const svc = _private.crearServicio(dbMock);
    await assert.rejects(
        () => svc.ejecutarRectificacionCertificado(1, { version: 2 }, { username: 'sistemas' }),
        (err) => err.code === 'SOLICITUD_CANCELADA' && err.statusCode === 409
    );
});

test('29. Solicitud pendiente no puede ejecutarse directamente', async () => {
    const dbMock = crearDbSimuladaFase3({
        solicitudes: [filaSolicitudRectificacion({ estado: 'PENDIENTE_APROBACION' })]
    });
    const svc = _private.crearServicio(dbMock);
    await assert.rejects(
        () => svc.ejecutarRectificacionCertificado(1, { version: 2 }, { username: 'sistemas' }),
        (err) => err.code === 'SOLICITUD_NO_APROBADA' && err.statusCode === 409
    );
});

test('30. Regresión: la anulación técnica de Fase 2 continúa operando', async () => {
    const dbMock = crearDbSimuladaFase3({
        solicitudes: [filaSolicitudRectificacion({ tipo_operacion: 'ANULAR_CERTIFICADO' })]
    });
    const svc = _private.crearServicio(dbMock, { habilitarAnulacionTecnica: true, tiposPermitidosLocal: ['INSPECCION_TALLER'] });
    const res = await svc.ejecutarAnulacionCertificado(1, { version: 2 }, { username: 'sistemas' });
    assert.equal(res.solicitud.estado, 'COMPLETADA');
    assert.equal(res.certificado.estado, 'ANULADO');
});
