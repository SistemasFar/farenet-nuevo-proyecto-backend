const db = require('../../../config/database');
const nubefactService = require('../../../services/integrations/nubefact.service');
const nubefactConfigService = require('./faregas-nubefact-config.service');
const correlativosNubefactService = require('./faregas-correlativos-nubefact.service');
const integrationsConfig = require('../../../config/integrations.config');
const { validarAccesoPlanta } = require('./faregas-auth.service');
const autorizacionFiscalService = require('./faregas-autorizacion-fiscal.service');
const {
    construirPayloadNota,
    limpiarRespuestaProveedor,
    mapearEstadoProveedor,
    mapearAceptacionSunat,
    crearCodigoUnico
} = require('../integrations/nubefact-faregas.adapter');
const { esDocumentoBaseOperable } = require('./faregas-documento-tributario-policy');
const {
    resolverOperacionFiscal,
    RESULTADOS: RESULTADOS_RESOLUCION_FISCAL
} = require('./faregas-anulacion-fiscal.resolver');
const {
    validarAnulacionCertificadoPorImporte,
    esMotivoAnulacionNotaCredito
} = require('./faregas-certificado-anulacion-policy.service');
const {
    MOTIVOS_NOTA_CREDITO,
    normalizarMotivoNotaCredito,
    requiereSolicitudNotaCredito,
    esMotivoCorreccionDescripcion
} = require('./faregas-notas-credito.constants');
const {
    obtenerSnapshotFiscalOriginal,
    derivarDatosNotaCredito,
    validarFechaDocumentoOriginal
} = require('./faregas-notas-credito-fiscal.service');

const TIPOS = Object.freeze({
    CREDITO: { tabla: 'fg_credito', fk: 'credito_id', comprobante: 3, prefijo: 'FGNC' },
    DEBITO: { tabla: 'fg_debito', fk: 'debito_id', comprobante: 4, prefijo: 'FGND' }
});

const errorNegocio = (code, statusCode = 400, detalles) => {
    const error = new Error(code);
    error.code = code;
    error.statusCode = statusCode;
    if (detalles) error.detalles = detalles;
    return error;
};


const normalizarTipoNota = (value) => {
    const tipo = String(value || '').trim().toUpperCase();
    if (!TIPOS[tipo]) throw errorNegocio('TIPO_NOTA_INVALIDO');
    return tipo;
};

const validarAccesoFacturacion = async (executor, certificadoId, userContext, bloquear = false) => {
    const result = await executor.query(`
        SELECT f.*, c.planta_key, c.estado AS certificado_estado
        FROM fg_facturacion f
        JOIN fg_certificado c ON c.id = f.certificado_id
        WHERE f.certificado_id = $1${bloquear ? ' FOR UPDATE OF f' : ''}
    `, [certificadoId]);
    if (result.rowCount === 0) throw errorNegocio('FACTURACION_FALTANTE', 404);
    const row = result.rows[0];
    const acceso = await validarAccesoPlanta(userContext.username, userContext.perfil_id, row.planta_key);
    if (!acceso) throw errorNegocio('PLANTA_NO_AUTORIZADA', 403);
    return row;
};

const validarAccesoFacturacionOperacion = async (executor, operacionId, userContext, bloquear = false) => {
    const result = await executor.query(`
        SELECT f.*, oc.planta_key, oc.estado AS operacion_estado
        FROM fg_facturacion f
        JOIN fg_operacion_comercial oc ON oc.id = f.operacion_id
        WHERE f.operacion_id = $1
          AND f.certificado_id IS NULL
        ORDER BY f.id DESC
        LIMIT 1${bloquear ? ' FOR UPDATE OF f' : ''}
    `, [operacionId]);
    if (result.rowCount === 0) throw errorNegocio('FACTURACION_FALTANTE', 404);
    const row = result.rows[0];
    const acceso = await validarAccesoPlanta(userContext.username, userContext.perfil_id, row.planta_key);
    if (!acceso) throw errorNegocio('PLANTA_NO_AUTORIZADA', 403);
    return row;
};

const validarImporteAnulacionCertificado = async (executor, facturacion, operacion) => {
    if (!facturacion?.certificado_id) return;
    await validarAnulacionCertificadoPorImporte(executor, facturacion.certificado_id, { operacion });
};

const validarSinAnulacionActiva = async (executor, facturacionId) => {
    const result = await executor.query(`
        SELECT id, estado
        FROM fg_documento_anulacion
        WHERE facturacion_id = $1
          AND estado IN ('BORRADOR', 'PENDIENTE', 'ACEPTADO')
        ORDER BY id DESC
        LIMIT 1
    `, [facturacionId]);
    if (result.rowCount > 0) {
        throw errorNegocio('ANULACION_ACTIVA', 409, {
            anulacionId: Number(result.rows[0].id),
            estado: result.rows[0].estado
        });
    }
};

const validarPermisoNotaCredito = async (executor, userContext) => {
    const permiso = await executor.query(`
        SELECT 1
        FROM fg_perfil_permiso
        JOIN fg_permiso ON fg_permiso.clave = fg_perfil_permiso.permiso_clave
        WHERE fg_perfil_permiso.perfil_clave = $1
          AND fg_perfil_permiso.permiso_clave = 'FAREGAS_NOTA_CREDITO'
          AND fg_permiso.activo = TRUE
        LIMIT 1
    `, [userContext.perfil_id]);
    if (permiso.rowCount === 0) throw errorNegocio('PERMISO_DENEGADO_NOTA_CREDITO', 403);
};

const validarPermisoAnulacionComprobante = async (executor, userContext) => {
    const permiso = await executor.query(`
        SELECT 1
        FROM fg_perfil_permiso
        JOIN fg_permiso ON fg_permiso.clave = fg_perfil_permiso.permiso_clave
        WHERE fg_perfil_permiso.perfil_clave = $1
          AND fg_perfil_permiso.permiso_clave = 'FAREGAS_ANULAR_COMPROBANTE'
          AND fg_permiso.activo = TRUE
        LIMIT 1
    `, [userContext.perfil_id]);
    if (permiso.rowCount === 0) {
        throw errorNegocio('FAREGAS_ANULACION_NO_AUTORIZADA', 403);
    }
};


const validarDatosNota = (tipo, data, facturacion, datosFiscales = null, totalNotasAceptadas = 0) => {
    let motivoCodigo = String(data.motivoCodigo || '').trim();
    let sustento = String(data.sustento || '').trim();
    let baseImponible;
    let igv;
    let importeTotal;

    if (tipo === 'CREDITO') {
        motivoCodigo = normalizarMotivoNotaCredito(motivoCodigo);
        if (!motivoCodigo || !datosFiscales) {
            throw errorNegocio('MOTIVO_NOTA_CREDITO_NO_PERMITIDO_O_INVALIDO');
        }
        validarFechaDocumentoOriginal(datosFiscales.snapshotFiscal?.fecha_de_emision);
        sustento = String(datosFiscales.sustento || '').trim();
        baseImponible = Number(datosFiscales.baseImponible);
        igv = Number(datosFiscales.igv);
        importeTotal = Number(datosFiscales.importeTotal);
    } else {
        const limite = 3;
        if (!/^\d{1,2}$/.test(motivoCodigo) || Number(motivoCodigo) < 1 || Number(motivoCodigo) > limite) {
            throw errorNegocio('MOTIVO_NOTA_INVALIDO');
        }
        baseImponible = Number(data.baseImponible);
        igv = Number(data.igv);
        importeTotal = Number(data.importeTotal);
    }

    if (!sustento || sustento.length > 250) throw errorNegocio('SUSTENTO_NOTA_INVALIDO');

    if (tipo === 'CREDITO' && esMotivoCorreccionDescripcion(motivoCodigo)) {
        if (!datosFiscales.descripcionCorregida) {
            throw errorNegocio('SUSTENTO_NOTA_INVALIDO');
        }
    }

    if (![baseImponible, igv, importeTotal].every(Number.isFinite)
        || baseImponible < 0 || igv < 0 || importeTotal <= 0
        || (tipo !== 'CREDITO' && Math.abs((baseImponible + igv) - importeTotal) > 0.02)) {
        throw errorNegocio('IMPORTES_NOTA_INVALIDOS');
    }

    if (tipo === 'CREDITO') {
        const originalTotal = Number(datosFiscales.snapshotFiscal.total);
        if (Math.abs(importeTotal - originalTotal) > 0.02) {
            throw errorNegocio('NOTA_CREDITO_DEBE_SER_TOTAL');
        }
        if (totalNotasAceptadas > 0) {
             throw errorNegocio('NOTA_CREDITO_EXCEDE_COMPROBANTE');
        }
    }

    return { motivoCodigo, sustento, baseImponible, igv, importeTotal };
};

const reservarSerieNota = async (client, facturacion, tipo, configuracionEmisor) => {
    const referencia = facturacion.tipo_comprobante === 'FACTURA' ? 'FACTURA' : 'BOLETA';
    const tipoAdmin = `NOTA_${tipo}_${referencia}`;
    if (!integrationsConfig.nubefact.correlativosV2Enabled) {
        throw errorNegocio('MOTOR_SERIES_V2_DESHABILITADO', 503, 'El motor de series legacy fue retirado. Habilite V2.');
    }
    const reserva = await correlativosNubefactService.reservarSiguiente({
        plantaKey: facturacion.planta_key,
        empresaKey: configuracionEmisor.empresaKey,
        tipoComprobante: tipoAdmin,
        environment: configuracionEmisor.environment
    }, client);
    return {
        serie: reserva.serie,
        numero: reserva.numero,
        serieComprobanteId: reserva.id
    };
};

const registrarOperacion = async (executor, {
    referencia, operacion, numeroIntento, estado, solicitud, respuesta = null,
    httpStatus = null, error = null, username, finalizar = false
}) => {
    const columnas = Object.keys(referencia);
    const columna = columnas[0];
    const valor = referencia[columna];
    const result = await executor.query(`
        INSERT INTO fg_documento_electronico_operacion
            (${columna}, operacion, numero_intento, estado, solicitud, respuesta,
             http_status, error, usuario_creacion, fecha_finalizacion)
        VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8,$9,
                CASE WHEN $10 THEN CURRENT_TIMESTAMP ELSE NULL END)
        RETURNING id
    `, [
        valor, operacion, numeroIntento, estado, JSON.stringify(solicitud || {}),
        respuesta ? JSON.stringify(respuesta) : null, httpStatus, error, username, finalizar
    ]);
    return result.rows[0].id;
};

const finalizarOperacion = async (executor, id, resultado, respuesta) => {
    const estado = mapearEstadoProveedor(resultado, 'OPERACION');
    await executor.query(`
        UPDATE fg_documento_electronico_operacion
        SET estado = $2, respuesta = $3::jsonb, http_status = $4, error = $5,
            fecha_finalizacion = CURRENT_TIMESTAMP
        WHERE id = $1
    `, [id, estado, JSON.stringify(respuesta || {}), resultado.httpStatus || null, resultado.error || resultado.reason || null]);
    return estado;
};

const respuestaNota = (row, tipo) => ({
    id: Number(row.id),
    tipo,
    facturacionId: Number(row.facturacion_id),
    motivoCodigo: row.motivo_codigo,
    sustento: row.sustento,
    serie: row.serie,
    numero: row.numero === null ? null : Number(row.numero),
    nroComprobante: row.nro_comprobante,
    baseImponible: Number(row.base_imponible),
    igv: Number(row.igv),
    importeTotal: Number(row.importe_total),
    estado: row.estado,
    aceptadaSunat: row.aceptada_sunat,
    sunatDescription: row.sunat_description,
    enlacePdf: row.enlace_pdf,
    enlaceXml: row.enlace_xml,
    enlaceCdr: row.enlace_cdr,
    intentos: Number(row.intentos || 0),
    fechaEmision: row.fecha_creacion || null,
    usuarioEmisor: row.usuario_creacion || null,
    anulacionEnPlazo: row.anulacion_en_plazo === true,
    anulacionHastaMs: row.anulacion_hasta_ms == null ? null : Number(row.anulacion_hasta_ms)
});

const recuperarResultadoIncierto = async ({ resultado, consultar, payload, credentials }) => {
    if (resultado.status !== 'ERROR' || typeof consultar !== 'function') return resultado;
    try {
        const consulta = await consultar(payload, { credentials });
        return ['ACCEPTED', 'PENDING_SUNAT', 'REJECTED'].includes(consulta.status)
            ? consulta
            : resultado;
    } catch (_error) {
        return resultado;
    }
};

const buscarNotaIdempotente = async (executor, facturacionId, motivoCodigo, sustento) => {
    const codigo = normalizarMotivoNotaCredito(motivoCodigo);
    if (!codigo) return null;
    const varianteHistorica = String(Number(codigo));
    const params = [facturacionId, codigo, varianteHistorica];
    const filtroSustento = codigo === '03'
        ? 'AND UPPER(BTRIM(sustento)) = UPPER(BTRIM($4))'
        : '';
    if (codigo === '03') params.push(String(sustento || '').trim());
    const result = await executor.query(`
        SELECT *
        FROM fg_credito
        WHERE facturacion_id = $1
          AND motivo_codigo IN ($2, $3)
          ${filtroSustento}
          AND estado <> 'ANULADO'
        ORDER BY id DESC
        LIMIT 1
        FOR UPDATE
    `, params);
    return result.rows[0] || null;
};

const resolverAccionReintentoNota = (estado) => {
    const normalizado = String(estado || '').trim().toUpperCase();
    if (normalizado === 'RECHAZADO') return 'EMITIR';
    if (normalizado === 'PENDIENTE' || normalizado === 'ERROR') return 'CONSULTAR';
    throw errorNegocio('NOTA_NO_REINTENTABLE', 409, { estado: normalizado });
};

const reservarNota = async (certificadoId, tipoEntrada, data, userContext, notaId = null) => {
    const tipo = normalizarTipoNota(tipoEntrada);
    const meta = TIPOS[tipo];
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        if (tipo === 'CREDITO') await validarPermisoNotaCredito(client, userContext);
        const facturacion = await validarAccesoFacturacion(client, certificadoId, userContext, true);
        if (!esDocumentoBaseOperable(facturacion)) throw errorNegocio('COMPROBANTE_NO_ACEPTADO', 409);
        await validarSinAnulacionActiva(client, facturacion.id);
        let nota;
        let datosFiscales = null;
        let snapshotFiscal = null;
        let autorizacion = null;

        if (notaId) {
            const existente = await client.query(`SELECT * FROM ${meta.tabla} WHERE id = $1 AND facturacion_id = $2 FOR UPDATE`, [notaId, facturacion.id]);
            if (existente.rowCount === 0) throw errorNegocio('NOTA_NO_ENCONTRADA', 404);
            nota = existente.rows[0];
            if (resolverAccionReintentoNota(nota.estado) !== 'EMITIR') {
                throw errorNegocio('NOTA_RESULTADO_INCIERTO_CONSULTAR', 409, { estado: nota.estado });
            }
        } else {
            if (tipo === 'CREDITO') {
                const motivoCodigo = normalizarMotivoNotaCredito(data.motivoCodigo || data.motivo_codigo);
                if (!motivoCodigo) throw errorNegocio('MOTIVO_NOTA_CREDITO_NO_PERMITIDO_O_INVALIDO');
                if (requiereSolicitudNotaCredito(motivoCodigo)) {
                    autorizacion = await autorizacionFiscalService.validarSolicitudAprobada({
                        solicitudId: data.solicitudId,
                        certificadoId,
                        operacion: 'NOTA_CORRECTIVA',
                        userContext,
                        executor: client,
                        permitirDocumentoExistente: true,
                        permitirResultadoExistente: true
                    });
                    if (Number(autorizacion.facturacionId) !== Number(facturacion.id)) {
                        throw errorNegocio('SOLICITUD_FACTURACION_NO_CORRESPONDE', 409);
                    }
                }
                const sustentoFiscal = autorizacion?.motivo || data.sustento;
                if (!esMotivoCorreccionDescripcion(motivoCodigo)) {
                    const idempotente = await buscarNotaIdempotente(
                        client,
                        facturacion.id,
                        motivoCodigo,
                        sustentoFiscal
                    );
                    if (idempotente) {
                        await client.query('COMMIT');
                        return {
                            tipo,
                            meta,
                            nota: idempotente,
                            facturacion,
                            yaExistente: true
                        };
                    }
                }
                snapshotFiscal = await obtenerSnapshotFiscalOriginal(client, facturacion);
                datosFiscales = derivarDatosNotaCredito({
                    snapshot: snapshotFiscal,
                    motivoCodigo,
                    sustento: sustentoFiscal,
                    itemIndice: data.itemIndice,
                    descripcionCorregida: data.descripcionCorregida || data.descripcion
                });
                if (esMotivoCorreccionDescripcion(motivoCodigo)) {
                    const idempotente = await buscarNotaIdempotente(
                        client,
                        facturacion.id,
                        motivoCodigo,
                        datosFiscales.sustento
                    );
                    if (idempotente) {
                        await client.query('COMMIT');
                        return {
                            tipo,
                            meta,
                            nota: idempotente,
                            facturacion,
                            yaExistente: true
                        };
                    }
                }
                if (autorizacion?.resultadoFiscal) {
                    throw errorNegocio('SOLICITUD_FISCAL_YA_PROCESADA', 409);
                }
            }
            const sumQuery = await client.query(`
                SELECT COALESCE(SUM(importe_total), 0) AS total
                FROM ${meta.tabla}
                WHERE facturacion_id = $1 AND estado NOT IN ('RECHAZADO', 'ANULADO')
                AND motivo_codigo NOT IN ('3', '03')
            `, [facturacion.id]);
            const totalNotasAceptadas = Number(sumQuery.rows[0].total);
            const normalizada = validarDatosNota(tipo, data, facturacion, datosFiscales, totalNotasAceptadas);
            if (tipo === 'CREDITO' && esMotivoAnulacionNotaCredito(normalizada.motivoCodigo)) {
                await validarImporteAnulacionCertificado(client, facturacion, 'NOTA_CREDITO_ANULACION');
            }
            const configuracion = await nubefactConfigService.resolverParaPlanta(facturacion.planta_key, client);
            const reserva = await reservarSerieNota(client, facturacion, tipo, configuracion);
            const insert = await client.query(`
                INSERT INTO ${meta.tabla} (
                    planta_key, facturacion_id, serie_comprobante_id, motivo_codigo,
                    sustento, serie, numero, nro_comprobante, moneda_key,
                    base_imponible, igv, importe_total, estado, proveedor,
                    empresa_key, ruc_emisor, usuario_creacion
                ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'PENDIENTE','NUBEFACT',$13,$14,$15)
                RETURNING *
            `, [
                facturacion.planta_key, facturacion.id, reserva.serieComprobanteId,
                normalizada.motivoCodigo, normalizada.sustento, reserva.serie, reserva.numero,
                `${reserva.serie}-${String(reserva.numero).padStart(8, '0')}`,
                facturacion.moneda_key, normalizada.baseImponible, normalizada.igv,
                normalizada.importeTotal, configuracion.empresaKey,
                configuracion.rucEmisor, userContext.username
            ]);
            nota = insert.rows[0];
            const codigoUnico = crearCodigoUnico(nota.id, meta.prefijo);
            const update = await client.query(`UPDATE ${meta.tabla} SET codigo_unico = $2 WHERE id = $1 RETURNING *`, [nota.id, codigoUnico]);
            nota = update.rows[0];
            const intento = Number(nota.intentos || 0) + 1;
            const payload = construirPayloadNota({
                nota,
                facturacion,
                tipoNota: tipo,
                snapshotFiscal,
                datosFiscales
            });
            const operacionId = await registrarOperacion(client, {
                referencia: { [meta.fk]: nota.id }, operacion: 'EMITIR', numeroIntento: intento,
                estado: 'PENDIENTE', solicitud: payload, username: userContext.username
            });
            await client.query(`UPDATE ${meta.tabla} SET estado = 'PENDIENTE', intentos = $2,
                fecha_ultimo_intento = CURRENT_TIMESTAMP, usuario_modificacion = $3,
                fecha_modificacion = CURRENT_TIMESTAMP WHERE id = $1`, [nota.id, intento, userContext.username]);
            await client.query('COMMIT');
            return {
                tipo,
                meta,
                nota,
                facturacion,
                payload,
                intento,
                operacionId,
                credentials: configuracion.credentials
            };
        }

        if (tipo === 'CREDITO' && esMotivoAnulacionNotaCredito(nota.motivo_codigo)) {
            await validarImporteAnulacionCertificado(client, facturacion, 'NOTA_CREDITO_ANULACION');
        }
        const configuracion = await nubefactConfigService.resolverParaPlanta(facturacion.planta_key, client);
        const intento = Number(nota.intentos || 0) + 1;
        const intentoAnterior = await client.query(`
            SELECT solicitud
            FROM fg_documento_electronico_operacion
            WHERE ${meta.fk} = $1 AND operacion = 'EMITIR'
            ORDER BY id DESC
            LIMIT 1
        `, [nota.id]);
        const payload = intentoAnterior.rows[0]?.solicitud;
        if (!payload || typeof payload !== 'object') throw errorNegocio('PAYLOAD_NOTA_NO_RECUPERABLE', 409);
        const operacionId = await registrarOperacion(client, {
            referencia: { [meta.fk]: nota.id }, operacion: 'EMITIR', numeroIntento: intento,
            estado: 'PENDIENTE', solicitud: payload, username: userContext.username
        });
        await client.query(`UPDATE ${meta.tabla} SET estado = 'PENDIENTE', intentos = $2,
            fecha_ultimo_intento = CURRENT_TIMESTAMP, usuario_modificacion = $3,
            fecha_modificacion = CURRENT_TIMESTAMP WHERE id = $1`, [nota.id, intento, userContext.username]);
        await client.query('COMMIT');
        return { tipo, meta, nota, facturacion, payload, intento, operacionId, credentials: configuracion.credentials };
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};

const esResultadoInciertoProveedor = (resultado) => (
    resultado?.status === 'ERROR'
    && ['TIMEOUT', 'NETWORK_ERROR', 'PROVIDER_HTTP_ERROR', 'UNEXPECTED_PROVIDER_RESPONSE']
        .includes(String(resultado.reason || '').trim().toUpperCase())
);

const completarNota = async (reserva, resultado, userContext, opciones = {}) => {
    const respuesta = limpiarRespuestaProveedor(resultado.data) || {};
    const estadoProveedor = mapearEstadoProveedor(resultado, 'DOCUMENTO_RELACIONADO');
    const estado = esResultadoInciertoProveedor(resultado) ? 'PENDIENTE' : estadoProveedor;
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        await client.query(`
            UPDATE ${reserva.meta.tabla} SET estado = $2, aceptada_sunat = COALESCE($3, aceptada_sunat),
                sunat_description = $4, sunat_responsecode = $5, sunat_soap_error = $6,
                enlace_pdf = COALESCE($7, enlace_pdf),
                enlace_xml = COALESCE($8, enlace_xml),
                enlace_cdr = COALESCE($9, enlace_cdr),
                respuesta_proveedor = $10::jsonb,
                fecha_aceptacion = CASE WHEN $3 THEN CURRENT_TIMESTAMP ELSE fecha_aceptacion END,
                usuario_modificacion = $11, fecha_modificacion = CURRENT_TIMESTAMP
            WHERE id = $1
        `, [
            reserva.nota.id, estado, mapearAceptacionSunat(resultado),
            respuesta.sunat_description || respuesta.errors || resultado.reason || null,
            respuesta.sunat_responsecode || null, respuesta.sunat_soap_error || resultado.error || null,
            respuesta.enlace_del_pdf || respuesta.enlace || null,
            respuesta.enlace_del_xml || null, respuesta.enlace_del_cdr || null,
            JSON.stringify(respuesta), userContext.username
        ]);
        await finalizarOperacion(client, reserva.operacionId, resultado, respuesta);
        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
    const final = await db.query(`SELECT * FROM ${reserva.meta.tabla} WHERE id = $1`, [reserva.nota.id]);
    const nota = respuestaNota(final.rows[0], reserva.tipo);
    if (estado === 'PENDIENTE') return nota;
    if (estado !== 'ACEPTADO' && opciones.lanzarError !== false) {
        throw errorNegocio('NUBEFACT_NOTA_NO_ACEPTADA', resultado.status === 'REJECTED' ? 422 : 502, { nota });
    }
    return nota;
};

exports.emitirNota = async (certificadoId, tipo, data, userContext, dependencies = {}) => {
    const reserva = await reservarNota(certificadoId, tipo, data, userContext);
    if (reserva.yaExistente) {
        return { ...respuestaNota(reserva.nota, reserva.tipo), idempotente: true };
    }
    const proveedor = dependencies.nubefactService || nubefactService;
    let resultado = await proveedor.emitirComprobante(reserva.payload, { credentials: reserva.credentials });
    resultado = await recuperarResultadoIncierto({
        resultado,
        consultar: proveedor.consultarComprobante?.bind(proveedor),
        payload: {
            tipoDeComprobante: reserva.meta.comprobante,
            serie: reserva.nota.serie,
            numero: reserva.nota.numero
        },
        credentials: reserva.credentials
    });
    return completarNota(reserva, resultado, userContext);
};

exports.reintentarNota = async (certificadoId, tipo, notaId, userContext, data = {}, dependencies = {}) => {
    const tipoNormalizado = normalizarTipoNota(tipo);
    const meta = TIPOS[tipoNormalizado];
    if (tipoNormalizado === 'CREDITO') await validarPermisoNotaCredito(db, userContext);
    const facturacion = await validarAccesoFacturacion(db, certificadoId, userContext);
    const actual = await db.query(`SELECT * FROM ${meta.tabla} WHERE id=$1 AND facturacion_id=$2`, [notaId, facturacion.id]);
    if (actual.rowCount === 0) throw errorNegocio('NOTA_NO_ENCONTRADA', 404);
    const accion = resolverAccionReintentoNota(actual.rows[0].estado);
    if (accion === 'CONSULTAR') {
        return exports.consultarNota(certificadoId, tipoNormalizado, notaId, userContext, dependencies);
    }
    if (tipoNormalizado === 'CREDITO' && requiereSolicitudNotaCredito(actual.rows[0].motivo_codigo)) {
        const autorizacion = await autorizacionFiscalService.validarSolicitudAprobada({
            solicitudId: data.solicitudId,
            certificadoId,
            operacion: 'NOTA_CORRECTIVA',
            userContext,
            permitirDocumentoExistente: true,
            permitirResultadoExistente: true
        });
        if (Number(autorizacion.facturacionId) !== Number(facturacion.id)) {
            throw errorNegocio('SOLICITUD_FACTURACION_NO_CORRESPONDE', 409);
        }
    }

    const reserva = await reservarNota(certificadoId, tipoNormalizado, {}, userContext, notaId);
    const proveedor = dependencies.nubefactService || nubefactService;
    let resultado = await proveedor.emitirComprobante(reserva.payload, { credentials: reserva.credentials });
    resultado = await recuperarResultadoIncierto({
        resultado,
        consultar: proveedor.consultarComprobante?.bind(proveedor),
        payload: {
            tipoDeComprobante: reserva.meta.comprobante,
            serie: reserva.nota.serie,
            numero: reserva.nota.numero
        },
        credentials: reserva.credentials
    });
    return completarNota(reserva, resultado, userContext);
};

const prepararConsultaNota = async (certificadoId, tipoEntrada, notaId, userContext) => {
    const tipo = normalizarTipoNota(tipoEntrada);
    const meta = TIPOS[tipo];
    if (tipo === 'CREDITO') await validarPermisoNotaCredito(db, userContext);
    const facturacion = await validarAccesoFacturacion(db, certificadoId, userContext);
    const result = await db.query(`
        SELECT * FROM ${meta.tabla}
        WHERE id = $1 AND facturacion_id = $2
    `, [notaId, facturacion.id]);
    if (result.rowCount === 0) throw errorNegocio('NOTA_NO_ENCONTRADA', 404);
    const nota = result.rows[0];
    if (!nota.serie || nota.numero == null) throw errorNegocio('NOTA_SIN_NUMERO', 409);
    const configuracion = await nubefactConfigService.resolverParaPlanta(facturacion.planta_key);
    const payload = {
        tipoDeComprobante: meta.comprobante,
        serie: nota.serie,
        numero: nota.numero
    };
    const operacionId = await registrarOperacion(db, {
        referencia: { [meta.fk]: nota.id },
        operacion: 'CONSULTAR',
        numeroIntento: Math.max(1, Number(nota.intentos || 0)),
        estado: 'PENDIENTE',
        solicitud: payload,
        username: userContext.username
    });
    return {
        tipo,
        meta,
        nota,
        facturacion,
        payload,
        operacionId,
        credentials: configuracion.credentials
    };
};

exports.consultarNota = async (certificadoId, tipo, notaId, userContext, dependencies = {}) => {
    const reserva = await prepararConsultaNota(certificadoId, tipo, notaId, userContext);
    const proveedor = dependencies.nubefactService || nubefactService;
    const resultado = await proveedor.consultarComprobante(reserva.payload, {
        credentials: reserva.credentials
    });
    return completarNota(reserva, resultado, userContext, { lanzarError: false });
};

// Entrada exclusiva del reconciliador. Nunca emite: sólo consulta una nota ya
// numerada y conserva PENDIENTE cuando el proveedor sigue sin dar certeza.
exports.reconciliarNotaPendiente = async (notaId, dependencies = {}) => {
    const result = await db.query(`
        SELECT n.*, f.planta_key AS facturacion_planta_key
        FROM fg_credito n
        JOIN fg_facturacion f ON f.id = n.facturacion_id
        WHERE n.id = $1
    `, [notaId]);
    if (result.rowCount === 0) throw errorNegocio('NOTA_NO_ENCONTRADA', 404);
    const nota = result.rows[0];
    if (nota.estado !== 'PENDIENTE') return respuestaNota(nota, 'CREDITO');
    if (!nota.serie || nota.numero == null) throw errorNegocio('NOTA_SIN_NUMERO', 409);

    const plantaKey = nota.facturacion_planta_key || nota.planta_key;
    const configuracion = await nubefactConfigService.resolverParaPlanta(plantaKey);
    const payload = { tipoDeComprobante: 3, serie: nota.serie, numero: nota.numero };
    const username = nota.usuario_modificacion || nota.usuario_creacion;
    const operacionId = await registrarOperacion(db, {
        referencia: { credito_id: nota.id },
        operacion: 'CONSULTAR',
        numeroIntento: Math.max(1, Number(nota.intentos || 0)),
        estado: 'PENDIENTE',
        solicitud: payload,
        username
    });
    const proveedor = dependencies.nubefactService || nubefactService;
    const resultado = await proveedor.consultarComprobante(payload, {
        credentials: configuracion.credentials
    });
    return completarNota({
        tipo: 'CREDITO',
        meta: TIPOS.CREDITO,
        nota,
        payload,
        operacionId
    }, resultado, { username }, { lanzarError: false });
};

exports.listarDocumentos = async (certificadoId, userContext) => {
    const facturacion = await validarAccesoFacturacion(db, certificadoId, userContext);
    const [creditos, debitos, anulaciones] = await Promise.all([
        db.query(`SELECT *, (clock_timestamp() >= fecha_creacion
            AND clock_timestamp() < fecha_creacion + INTERVAL '24 hours') AS anulacion_en_plazo,
            (EXTRACT(EPOCH FROM (fecha_creacion + INTERVAL '24 hours')::timestamptz) * 1000) AS anulacion_hasta_ms
            FROM fg_credito WHERE facturacion_id = $1 ORDER BY id DESC`, [facturacion.id]),
        db.query(`SELECT *, (clock_timestamp() >= fecha_creacion
            AND clock_timestamp() < fecha_creacion + INTERVAL '24 hours') AS anulacion_en_plazo,
            (EXTRACT(EPOCH FROM (fecha_creacion + INTERVAL '24 hours')::timestamptz) * 1000) AS anulacion_hasta_ms
            FROM fg_debito WHERE facturacion_id = $1 ORDER BY id DESC`, [facturacion.id]),
        db.query(`SELECT * FROM fg_documento_anulacion
            WHERE facturacion_id = $1
               OR credito_id IN (SELECT id FROM fg_credito WHERE facturacion_id = $1)
               OR debito_id IN (SELECT id FROM fg_debito WHERE facturacion_id = $1)
            ORDER BY id DESC`, [facturacion.id])
    ]);
    return {
        notas: [
            ...creditos.rows.map(row => respuestaNota(row, 'CREDITO')),
            ...debitos.rows.map(row => respuestaNota(row, 'DEBITO'))
        ].sort((a, b) => b.id - a.id),
        anulaciones: anulaciones.rows.map(row => ({
            id: Number(row.id), motivo: row.motivo, estado: row.estado,
            tipoDocumento: row.facturacion_id ? 'FACTURACION' : row.credito_id ? 'CREDITO' : 'DEBITO',
            documentoId: Number(row.facturacion_id || row.credito_id || row.debito_id),
            ticketSunat: row.ticket_sunat, aceptadaSunat: row.aceptada_sunat,
            sunatDescription: row.sunat_description,
            enlacePdf: row.enlace_pdf, enlaceXml: row.enlace_xml, enlaceCdr: row.enlace_cdr
        }))
    };
};

const tipoDocumentoCliente = (codigo) => ({
    0: 'SIN DOCUMENTO',
    1: 'DNI',
    4: 'CARNÉ DE EXTRANJERÍA',
    6: 'RUC',
    7: 'PASAPORTE'
})[Number(codigo)] || `TIPO ${codigo}`;

exports.obtenerContextoNotaCredito = async (certificadoId, userContext) => {
    await validarPermisoNotaCredito(db, userContext);
    const facturacion = await validarAccesoFacturacion(db, certificadoId, userContext);
    if (!esDocumentoBaseOperable(facturacion)) throw errorNegocio('COMPROBANTE_NO_ACEPTADO', 409);
    const snapshot = await obtenerSnapshotFiscalOriginal(db, facturacion);
    const solicitudes = await db.query(`
        SELECT id, tipo_operacion, estado, motivo, observaciones,
               usuario_solicitante, usuario_decision, fecha_solicitud, fecha_decision
        FROM fg_solicitud_operacion
        WHERE certificado_id = $1
          AND facturacion_id = $2
          AND tipo_operacion = 'ANULAR_AMBOS'
          AND estado IN ('APROBADA', 'EN_EJECUCION')
          AND resultado_fiscal IS NULL
        ORDER BY fecha_decision DESC NULLS LAST, id DESC
    `, [certificadoId, facturacion.id]);

    return {
        motivos: Object.values(MOTIVOS_NOTA_CREDITO).map((motivo) => ({ ...motivo })),
        comprobante: {
            id: Number(facturacion.id),
            tipo: Number(snapshot.tipo_de_comprobante) === 1 ? 'FACTURA' : 'BOLETA',
            serie: snapshot.serie,
            numero: Number(snapshot.numero),
            nroComprobante: `${snapshot.serie}-${String(snapshot.numero).padStart(8, '0')}`,
            fechaEmision: snapshot.fecha_de_emision,
            cliente: {
                tipoDocumentoCodigo: Number(snapshot.cliente_tipo_de_documento),
                tipoDocumento: tipoDocumentoCliente(snapshot.cliente_tipo_de_documento),
                numeroDocumento: snapshot.cliente_numero_de_documento,
                nombreRazonSocial: snapshot.cliente_denominacion,
                direccion: snapshot.cliente_direccion || ''
            },
            monedaCodigo: Number(snapshot.moneda),
            moneda: ({ 1: 'PEN', 2: 'USD' })[Number(snapshot.moneda)] || String(snapshot.moneda),
            totales: {
                descuento: Number(snapshot.total_descuento || 0),
                gravada: Number(snapshot.total_gravada || 0),
                inafecta: Number(snapshot.total_inafecta || 0),
                exonerada: Number(snapshot.total_exonerada || 0),
                igv: Number(snapshot.total_igv || 0),
                gratuita: Number(snapshot.total_gratuita || 0),
                otrosCargos: Number(snapshot.total_otros_cargos || 0),
                total: Number(snapshot.total)
            },
            enlaces: {
                pdf: facturacion.enlace_pdf || null,
                xml: facturacion.enlace_xml || null,
                cdr: facturacion.enlace_cdr || null
            }
        },
        items: snapshot.items.map((item, indice) => ({
            indice,
            codigo: item.codigo || '',
            descripcion: item.descripcion,
            unidad: item.unidad_de_medida,
            cantidad: Number(item.cantidad),
            valorUnitario: Number(item.valor_unitario),
            precioUnitario: Number(item.precio_unitario),
            descuento: Number(item.descuento || 0),
            subtotal: Number(item.subtotal),
            tipoIgv: Number(item.tipo_de_igv),
            igv: Number(item.igv),
            total: Number(item.total)
        })),
        autorizaciones: solicitudes.rows.map((row) => ({
            id: Number(row.id),
            tipoOperacion: row.tipo_operacion,
            estado: row.estado,
            motivo: row.motivo,
            observaciones: row.observaciones,
            usuarioSolicitante: row.usuario_solicitante,
            usuarioDecision: row.usuario_decision,
            fechaSolicitud: row.fecha_solicitud,
            fechaDecision: row.fecha_decision,
            ejecutablePorUsuario: row.usuario_solicitante !== userContext.username
        }))
    };
};

exports.consultarFacturacion = async (certificadoId, userContext, dependencies = {}) => {
    const facturacion = await validarAccesoFacturacion(db, certificadoId, userContext);
    if (!facturacion.serie || facturacion.numero === null) throw errorNegocio('COMPROBANTE_SIN_NUMERO', 409);
    const configuracion = await nubefactConfigService.resolverParaPlanta(facturacion.planta_key);
    const payload = {
        tipoDeComprobante: facturacion.tipo_comprobante === 'FACTURA' ? 1 : 2,
        serie: facturacion.serie,
        numero: facturacion.numero
    };
    const operacionId = await registrarOperacion(db, {
        referencia: { facturacion_id: facturacion.id }, operacion: 'CONSULTAR',
        numeroIntento: Number(facturacion.intentos || 0) + 1, estado: 'PENDIENTE',
        solicitud: payload, username: userContext.username
    });
    const proveedor = dependencies.nubefactService || nubefactService;
    const resultado = await proveedor.consultarComprobante(payload, { credentials: configuracion.credentials });
    const respuesta = limpiarRespuestaProveedor(resultado.data) || {};
    const estadoProveedor = mapearEstadoProveedor(resultado, 'FACTURACION');
    const anuladaPorProveedor = respuesta.anulado === true || respuesta.anulado === 'true';
    const estadoPersistido = estadoProveedor === 'ERROR'
        ? facturacion.estado
        : (anuladaPorProveedor ? 'ANULADO' : estadoProveedor);
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        await finalizarOperacion(client, operacionId, resultado, respuesta);
        const actualizada = await client.query(`UPDATE fg_facturacion SET estado=$2,
            aceptada_sunat=CASE WHEN $2 IN ('ACEPTADO','ANULADO') THEN TRUE WHEN $2='RECHAZADO' THEN FALSE ELSE aceptada_sunat END,
            sunat_description=$3, sunat_responsecode=$4, sunat_soap_error=$5,
            enlace_pdf=COALESCE($6,enlace_pdf), enlace_xml=COALESCE($7,enlace_xml),
            enlace_cdr=COALESCE($8,enlace_cdr), respuesta_proveedor=$9::jsonb,
            fecha_aceptacion=CASE WHEN $2 IN ('ACEPTADO','ANULADO') THEN COALESCE(fecha_aceptacion,CURRENT_TIMESTAMP) ELSE fecha_aceptacion END,
            usuario_modificacion=$10, fecha_modificacion=CURRENT_TIMESTAMP
            WHERE id=$1 AND (estado IN ('PENDIENTE','PENDIENTE_SUNAT','ERROR') OR $2='ANULADO')
            RETURNING id`, [
            facturacion.id, estadoPersistido,
            respuesta.sunat_description || respuesta.errors || resultado.reason || null,
            respuesta.sunat_responsecode || null,
            respuesta.sunat_soap_error || resultado.error || null,
            respuesta.enlace_del_pdf || respuesta.enlace_pdf || respuesta.enlace || null,
            respuesta.enlace_del_xml || respuesta.enlace_xml || null,
            respuesta.enlace_del_cdr || respuesta.enlace_cdr || null,
            JSON.stringify(respuesta), userContext.username
        ]);
        if (actualizada.rowCount > 0 && estadoPersistido === 'ACEPTADO' && facturacion.operacion_id) {
            await client.query(`UPDATE fg_operacion_comercial
                SET estado='FACTURADO', usuario_modificacion=$2,
                    fecha_modificacion=CURRENT_TIMESTAMP
                WHERE id=$1`, [facturacion.operacion_id, userContext.username]);
        }
        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
    return { estado: resultado.status, respuesta };
};

const obtenerObjetivoAnulacion = async (client, facturacion, tipoDocumento, documentoId) => {
    const tipo = String(tipoDocumento || 'FACTURACION').trim().toUpperCase();
    if (tipo === 'FACTURACION') return {
        tipo, tabla: 'fg_facturacion', fk: 'facturacion_id', row: facturacion,
        tipoComprobante: facturacion.tipo_comprobante === 'FACTURA' ? 1 : 2,
        prefijo: 'F'
    };
    const notaTipo = tipo === 'CREDITO' ? 'CREDITO' : tipo === 'DEBITO' ? 'DEBITO' : null;
    if (!notaTipo) throw errorNegocio('TIPO_DOCUMENTO_ANULACION_INVALIDO');
    const meta = TIPOS[notaTipo];
    const result = await client.query(`SELECT * FROM ${meta.tabla} WHERE id=$1 AND facturacion_id=$2 FOR UPDATE`, [documentoId, facturacion.id]);
    if (result.rowCount === 0) throw errorNegocio('NOTA_NO_ENCONTRADA', 404);
    return { tipo: notaTipo, tabla: meta.tabla, fk: meta.fk, row: result.rows[0], tipoComprobante: meta.comprobante, prefijo: notaTipo === 'CREDITO' ? 'C' : 'D' };
};

// La primera solicitud de emisión fija el inicio del plazo operativo de 24 h
// definido por FAREGAS. Un reintento no lo renueva. Este plazo es distinto del
// plazo fiscal de 7 días que evalúa el resolvedor para elegir baja o nota.
const validarPlazoAnulacion = async (client, objetivo) => {
    const result = objetivo.tipo === 'FACTURACION'
        ? await client.query(`
            SELECT MIN(fecha_creacion) AS fecha_emision,
                   clock_timestamp() >= MIN(fecha_creacion)
                   AND clock_timestamp() < MIN(fecha_creacion) + INTERVAL '24 hours' AS vigente
            FROM fg_facturacion_intento WHERE facturacion_id = $1
        `, [objetivo.row.id])
        : await client.query(`
            SELECT fecha_creacion AS fecha_emision,
                   clock_timestamp() >= fecha_creacion
                   AND clock_timestamp() < fecha_creacion + INTERVAL '24 hours' AS vigente
            FROM ${objetivo.tabla} WHERE id = $1
        `, [objetivo.row.id]);
    if (!result.rows[0]?.vigente) throw errorNegocio('PLAZO_ANULACION_VENCIDO', 409);
};

const generarAnulacionConAcceso = async (referenciaId, data, userContext, dependencies, validarAcceso) => {
    const client = await db.connect();
    let reserva;
    try {
        await client.query('BEGIN');
        // La autorización se valida dentro de la misma transacción y antes de
        // consultar el comprobante. De este modo ninguna ruta (certificados o
        // ventas de chips) puede iniciar una baja confiando sólo en React.
        await validarPermisoAnulacionComprobante(client, userContext);
        const motivo = String(data.motivo || '').trim();
        if (!motivo || motivo.length > 100) throw errorNegocio('MOTIVO_ANULACION_INVALIDO');
        const facturacion = await validarAcceso(client, referenciaId, userContext, true);
        await validarImporteAnulacionCertificado(client, facturacion, 'GENERAR_ANULACION_FISCAL');
        await validarSinAnulacionActiva(client, facturacion.id);
        const objetivo = await obtenerObjetivoAnulacion(client, facturacion, data.tipoDocumento, data.documentoId);
        // La ventana operativa FAREGAS sigue siendo de 24 h. La elegibilidad
        // fiscal de la baja (7 días calendario) la decide el resolvedor.
        await validarPlazoAnulacion(client, objetivo);
        const tipoComprobante = objetivo.tipo === 'FACTURACION' ? facturacion.tipo_comprobante : objetivo.tipo;
        const resolucion = resolverOperacionFiscal({
            documento: {
                ...objetivo.row,
                tipoComprobante,
                estado: objetivo.row.estado,
                aceptadaSunat: objetivo.row.aceptada_sunat,
                fechaEmision: objetivo.row.fecha_documento || objetivo.row.fecha_creacion || facturacion.fecha_documento,
                fechaAceptacion: objetivo.row.fecha_aceptacion,
                enlaceCdr: objetivo.row.enlace_cdr,
                importeTotal: objetivo.row.importe_total,
                entorno: facturacion.entorno_facturador,
                proveedor: facturacion.proveedor
            },
            estadoProveedor: objetivo.row.estado,
            operacionesPrevias: [],
            totalNotasPrevias: 0
        });
        if (resolucion.resultado === RESULTADOS_RESOLUCION_FISCAL.YA_ANULADO) {
            throw errorNegocio('DOCUMENTO_YA_ANULADO', 409, { resolucion });
        }
        if (resolucion.resultado !== RESULTADOS_RESOLUCION_FISCAL.BAJA_ELEGIBLE) {
            throw errorNegocio('DOCUMENTO_NO_ANULABLE', 409, { resolucion });
        }
        const configuracion = await nubefactConfigService.resolverParaPlanta(facturacion.planta_key, client);
        const codigoUnico = crearCodigoUnico(objetivo.row.id, `FGA${objetivo.prefijo}`);
        const insert = await client.query(`
            INSERT INTO fg_documento_anulacion
                (${objetivo.fk}, motivo, codigo_unico, estado, intentos,
                 fecha_ultimo_intento, usuario_creacion)
            VALUES ($1,$2,$3,'PENDIENTE',1,CURRENT_TIMESTAMP,$4) RETURNING *
        `, [objetivo.row.id, motivo, codigoUnico, userContext.username]);
        const anulacion = insert.rows[0];
        const payload = {
            tipoDeComprobante: objetivo.tipoComprobante,
            serie: objetivo.row.serie,
            numero: objetivo.row.numero,
            motivo,
            codigoUnico
        };
        const operacionId = await registrarOperacion(client, {
            referencia: { anulacion_id: anulacion.id }, operacion: 'ANULAR', numeroIntento: 1,
            estado: 'PENDIENTE', solicitud: payload, username: userContext.username
        });
        await client.query('COMMIT');
        reserva = { facturacion, objetivo, anulacion, payload, operacionId, credentials: configuracion.credentials };
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }

    const proveedor = dependencies.nubefactService || nubefactService;
    let resultado = await proveedor.generarAnulacion(reserva.payload, { credentials: reserva.credentials });
    resultado = await recuperarResultadoIncierto({
        resultado,
        consultar: proveedor.consultarAnulacion?.bind(proveedor),
        payload: {
            tipoDeComprobante: reserva.objetivo.tipoComprobante,
            serie: reserva.objetivo.row.serie,
            numero: reserva.objetivo.row.numero
        },
        credentials: reserva.credentials
    });
    return completarAnulacion(reserva, resultado, userContext);
};

exports.generarAnulacion = async (certificadoId, data, userContext, dependencies = {}) =>
    generarAnulacionConAcceso(certificadoId, data, userContext, dependencies, validarAccesoFacturacion);

exports.generarAnulacionOperacion = async (operacionId, data, userContext, dependencies = {}) =>
    generarAnulacionConAcceso(operacionId, data, userContext, dependencies, validarAccesoFacturacionOperacion);

const completarAnulacion = async (reserva, resultado, userContext) => {
    const respuesta = limpiarRespuestaProveedor(resultado.data) || {};
    const estado = mapearEstadoProveedor(resultado, 'DOCUMENTO_RELACIONADO');
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        await client.query(`UPDATE fg_documento_anulacion SET estado=$2,
            ticket_sunat=$3, aceptada_sunat=$4, sunat_description=$5,
            sunat_responsecode=$6, sunat_soap_error=$7, enlace_pdf=$8,
            enlace_xml=$9, enlace_cdr=$10, respuesta_proveedor=$11::jsonb,
            fecha_aceptacion=CASE WHEN $4 THEN CURRENT_TIMESTAMP ELSE fecha_aceptacion END,
            usuario_modificacion=$12, fecha_modificacion=CURRENT_TIMESTAMP WHERE id=$1`, [
            reserva.anulacion.id, estado, respuesta.sunat_ticket_numero || null,
            mapearAceptacionSunat(resultado), respuesta.sunat_description || respuesta.errors || resultado.reason || null,
            respuesta.sunat_responsecode || null, respuesta.sunat_soap_error || resultado.error || null,
            respuesta.enlace_del_pdf || respuesta.enlace || null, respuesta.enlace_del_xml || null,
            respuesta.enlace_del_cdr || null, JSON.stringify(respuesta), userContext.username
        ]);
        await finalizarOperacion(client, reserva.operacionId, resultado, respuesta);
        if (estado === 'ACEPTADO') {
            await client.query(`UPDATE ${reserva.objetivo.tabla} SET estado='ANULADO',
                usuario_modificacion=$2, fecha_modificacion=CURRENT_TIMESTAMP WHERE id=$1`, [reserva.objetivo.row.id, userContext.username]);
        }
        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
    return { id: Number(reserva.anulacion.id), estado, ticketSunat: respuesta.sunat_ticket_numero || null, respuesta };
};

const consultarAnulacionConAcceso = async (referenciaId, anulacionId, userContext, dependencies, validarAcceso) => {
    const facturacion = await validarAcceso(db, referenciaId, userContext);
    const result = await db.query(`SELECT * FROM fg_documento_anulacion
        WHERE id=$1 AND (facturacion_id=$2 OR credito_id IN (SELECT id FROM fg_credito WHERE facturacion_id=$2)
          OR debito_id IN (SELECT id FROM fg_debito WHERE facturacion_id=$2))`, [anulacionId, facturacion.id]);
    if (result.rowCount === 0) throw errorNegocio('ANULACION_NO_ENCONTRADA', 404);
    const anulacion = result.rows[0];
    const objetivo = anulacion.facturacion_id
        ? await obtenerObjetivoAnulacion(db, facturacion, 'FACTURACION')
        : anulacion.credito_id
            ? await obtenerObjetivoAnulacion(db, facturacion, 'CREDITO', anulacion.credito_id)
            : await obtenerObjetivoAnulacion(db, facturacion, 'DEBITO', anulacion.debito_id);
    const configuracion = await nubefactConfigService.resolverParaPlanta(facturacion.planta_key);
    const payload = { tipoDeComprobante: objetivo.tipoComprobante, serie: objetivo.row.serie, numero: objetivo.row.numero };
    const operacionId = await registrarOperacion(db, {
        referencia: { anulacion_id: anulacion.id }, operacion: 'CONSULTAR_ANULACION',
        numeroIntento: Number(anulacion.intentos || 0) + 1, estado: 'PENDIENTE',
        solicitud: payload, username: userContext.username
    });
    const proveedor = dependencies.nubefactService || nubefactService;
    const resultado = await proveedor.consultarAnulacion(payload, { credentials: configuracion.credentials });
    return completarAnulacion({ facturacion, objetivo, anulacion, payload, operacionId }, resultado, userContext);
};

exports.consultarAnulacion = async (certificadoId, anulacionId, userContext, dependencies = {}) =>
    consultarAnulacionConAcceso(certificadoId, anulacionId, userContext, dependencies, validarAccesoFacturacion);

exports.consultarAnulacionOperacion = async (operacionId, anulacionId, userContext, dependencies = {}) =>
    consultarAnulacionConAcceso(operacionId, anulacionId, userContext, dependencies, validarAccesoFacturacionOperacion);

exports._private = {
    validarDatosNota,
    validarPermisoNotaCredito,
    validarPermisoAnulacionComprobante,
    reservarSerieNota,
    registrarOperacion,
    finalizarOperacion,
    recuperarResultadoIncierto,
    buscarNotaIdempotente,
    resolverAccionReintentoNota,
    esResultadoInciertoProveedor,
    completarNota,
    validarSinAnulacionActiva,
    validarPlazoAnulacion,
    normalizarTipoNota,
    errorNegocio
};
