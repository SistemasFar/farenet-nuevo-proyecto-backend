const db = require('../../../config/database');
const nubefactService = require('../../../services/integrations/nubefact.service');
const nubefactConfigService = require('./faregas-nubefact-config.service');
const correlativosNubefactService = require('./faregas-correlativos-nubefact.service');
const integrationsConfig = require('../../../config/integrations.config');
const { validarAccesoPlanta } = require('./faregas-auth.service');
const {
    construirPayloadNota,
    limpiarRespuestaProveedor,
    mapearEstadoProveedor,
    mapearAceptacionSunat,
    crearCodigoUnico
} = require('../integrations/nubefact-faregas.adapter');

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


const esEmisionIncierta = async (client, referenciaColumna, referenciaId) => {
    const result = await client.query(`
        SELECT error, http_status FROM fg_documento_electronico_operacion
        WHERE ${referenciaColumna} = $1 AND operacion = 'EMITIR'
        ORDER BY id DESC LIMIT 1
    `, [referenciaId]);
    if (result.rowCount === 0) return false;
    const { error, http_status } = result.rows[0];
    if (http_status && http_status >= 400 && http_status < 500 && http_status !== 408) return false;
    if (error && (error.includes('timeout') || error.includes('ECONNRESET') || error.includes('EPIPE'))) return true;
    return true; // Ante la duda, asume incierto.
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


const validarPlazoNotaCredito = (motivoCodigo, fechaEmisionComprobante) => {
    if (motivoCodigo === '2' || motivoCodigo === '02' || motivoCodigo === '3' || motivoCodigo === '03') {
        const fechaComprobante = new Date(fechaEmisionComprobante);
        const hoy = new Date();
        
        let diasHabiles = 0;
        let iterDate = new Date(fechaComprobante.getTime());
        // Reset times to compare dates
        iterDate.setHours(0,0,0,0);
        const limitDate = new Date(hoy.getTime());
        limitDate.setHours(0,0,0,0);
        
        while (iterDate < limitDate) {
            iterDate.setDate(iterDate.getDate() + 1);
            const day = iterDate.getDay();
            if (day !== 0 && day !== 6) { // Lunes a Viernes
                diasHabiles++;
            }
        }
        
        // 15 días hábiles
        if (diasHabiles > 15) {
            throw errorNegocio('PLAZO_EXCEDIDO_NOTA_CREDITO', 409);
        }
    }
};

const validarDatosNota = (tipo, data, facturacion, totalNotasAceptadas = 0) => {
    const motivoCodigo = String(data.motivoCodigo || '').trim();
    let sustento = String(data.sustento || '').trim();
    const baseImponible = Number(data.baseImponible);
    const igv = Number(data.igv);
    const importeTotal = Number(data.importeTotal);

    if (tipo === 'CREDITO') {
        validarPlazoNotaCredito(motivoCodigo, facturacion.fecha_emision);
        
        if (!['1', '2', '3', '01', '02', '03'].includes(motivoCodigo)) {
            throw errorNegocio('MOTIVO_NOTA_CREDITO_NO_PERMITIDO_O_INVALIDO');
        }
    } else {
        const limite = 3;
        if (!/^\d{1,2}$/.test(motivoCodigo) || Number(motivoCodigo) < 1 || Number(motivoCodigo) > limite) {
            throw errorNegocio('MOTIVO_NOTA_INVALIDO');
        }
    }

    if (!sustento || sustento.length > 250) throw errorNegocio('SUSTENTO_NOTA_INVALIDO');

    if (tipo === 'CREDITO' && (motivoCodigo === '3' || motivoCodigo === '03')) {
        // For motive 3, we require the user to provide a specific description correction.
        if (sustento === 'CORRECCIÓN DE DESCRIPCIÓN' || sustento.length < 5) {
            throw errorNegocio('SUSTENTO_NOTA_INVALIDO');
        }
    }

    if (![baseImponible, igv, importeTotal].every(Number.isFinite)
        || baseImponible < 0 || igv < 0 || importeTotal <= 0
        || Math.abs((baseImponible + igv) - importeTotal) > 0.02) {
        throw errorNegocio('IMPORTES_NOTA_INVALIDOS');
    }

    if (tipo === 'CREDITO') {
        const originalTotal = Number(facturacion.importe_total);
        if (Math.abs(importeTotal - originalTotal) > 0.02) {
            throw errorNegocio('NOTA_CREDITO_DEBE_SER_TOTAL');
        }
        if (totalNotasAceptadas > 0) {
             throw errorNegocio('NOTA_CREDITO_EXCEDE_COMPROBANTE');
        }
    }

    return { motivoCodigo, sustento, baseImponible, igv, importeTotal };
};

const reservarSerieNota = async (client, facturacion, tipo) => {
    const referencia = facturacion.tipo_comprobante === 'FACTURA' ? 'FACTURA' : 'BOLETA';
    const tipoAdmin = `NOTA_${tipo}_${referencia}`;
    if (!integrationsConfig.nubefact.correlativosV2Enabled) {
        throw errorNegocio('MOTOR_SERIES_V2_DESHABILITADO', 503, 'El motor de series legacy fue retirado. Habilite V2.');
    }
    const reserva = await correlativosNubefactService.reservarSiguiente({
        plantaKey: facturacion.planta_key,
        tipoComprobante: tipoAdmin,
        environment: facturacion.entorno_facturador || integrationsConfig.nubefact.environment
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
    intentos: Number(row.intentos || 0)
});

const recuperarResultadoIncierto = async ({ resultado, consultar, payload, credentials }) => {
    if (resultado.status !== 'ERROR' || typeof consultar !== 'function') return resultado;
    const consulta = await consultar(payload, { credentials });
    return ['ACCEPTED', 'PENDING_SUNAT', 'REJECTED'].includes(consulta.status)
        ? consulta
        : resultado;
};

const reservarNota = async (certificadoId, tipoEntrada, data, userContext, notaId = null) => {
    const tipo = normalizarTipoNota(tipoEntrada);
    if (tipo === 'CREDITO' && (!userContext.permisos || !userContext.permisos.includes('FAREGAS_NOTA_CREDITO'))) {
        throw errorNegocio('PERMISO_DENEGADO_NOTA_CREDITO', 403);
    }
    const meta = TIPOS[tipo];
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        const facturacion = await validarAccesoFacturacion(client, certificadoId, userContext, true);
        if (facturacion.estado !== 'ACEPTADO') throw errorNegocio('COMPROBANTE_NO_ACEPTADO', 409);
        const configuracion = await nubefactConfigService.resolverParaPlanta(facturacion.planta_key, client);
        let nota;

        if (notaId) {
            const existente = await client.query(`SELECT * FROM ${meta.tabla} WHERE id = $1 AND facturacion_id = $2 FOR UPDATE`, [notaId, facturacion.id]);
            if (existente.rowCount === 0) throw errorNegocio('NOTA_NO_ENCONTRADA', 404);
            nota = existente.rows[0];
            if (!['ERROR', 'RECHAZADO'].includes(nota.estado)) throw errorNegocio('NOTA_NO_REINTENTABLE', 409);
        } else {
            const sumQuery = await client.query(`
                SELECT COALESCE(SUM(importe_total), 0) AS total
                FROM ${meta.tabla}
                WHERE facturacion_id = $1 AND estado NOT IN ('RECHAZADO', 'ERROR', 'ERROR_DEFINITIVO')
                AND motivo_codigo NOT IN ('3', '03')
            `, [facturacion.id]);
            const totalNotasAceptadas = Number(sumQuery.rows[0].total);
            const normalizada = validarDatosNota(tipo, data, facturacion, totalNotasAceptadas);
            const reserva = await reservarSerieNota(client, facturacion, tipo);
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
        }

        const intento = Number(nota.intentos || 0) + 1;
        const payload = construirPayloadNota({ nota, facturacion, tipoNota: tipo });
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

const completarNota = async (reserva, resultado, userContext) => {
    const respuesta = limpiarRespuestaProveedor(resultado.data) || {};
    const estado = mapearEstadoProveedor(resultado, 'DOCUMENTO_RELACIONADO');
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        await client.query(`
            UPDATE ${reserva.meta.tabla} SET estado = $2, aceptada_sunat = $3,
                sunat_description = $4, sunat_responsecode = $5, sunat_soap_error = $6,
                enlace_pdf = $7, enlace_xml = $8, enlace_cdr = $9,
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
    if (estado !== 'ACEPTADO') throw errorNegocio('NUBEFACT_NOTA_NO_ACEPTADA', resultado.status === 'REJECTED' ? 422 : 502, { nota });
    return nota;
};

exports.emitirNota = async (certificadoId, tipo, data, userContext, dependencies = {}) => {
    const reserva = await reservarNota(certificadoId, tipo, data, userContext);
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

exports.reintentarNota = async (certificadoId, tipo, notaId, userContext, dependencies = {}) => {
    const reserva = await reservarNota(certificadoId, tipo, {}, userContext, notaId);
    const proveedor = dependencies.nubefactService || nubefactService;
    
    // Idempotencia: Verificar si el intento previo fue ambiguo
    const esIncierta = await esEmisionIncierta(db, reserva.meta.fk, notaId);
    if (esIncierta) {
        const consulta = await proveedor.consultarComprobante({
            tipoDeComprobante: reserva.meta.comprobante,
            serie: reserva.nota.serie,
            numero: reserva.nota.numero
        }, { credentials: reserva.credentials });
        if (['ACCEPTED', 'PENDING_SUNAT', 'REJECTED'].includes(consulta.status)) {
            return completarNota(reserva, consulta, userContext);
        }
    }

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

exports.listarDocumentos = async (certificadoId, userContext) => {
    const facturacion = await validarAccesoFacturacion(db, certificadoId, userContext);
    const [creditos, debitos, anulaciones] = await Promise.all([
        db.query('SELECT * FROM fg_credito WHERE facturacion_id = $1 ORDER BY id DESC', [facturacion.id]),
        db.query('SELECT * FROM fg_debito WHERE facturacion_id = $1 ORDER BY id DESC', [facturacion.id]),
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
    const estadoPersistido = estadoProveedor === 'ERROR' ? facturacion.estado : estadoProveedor;
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        await finalizarOperacion(client, operacionId, resultado, respuesta);
        const actualizada = await client.query(`UPDATE fg_facturacion SET estado=$2,
            aceptada_sunat=CASE WHEN $2='ACEPTADO' THEN TRUE WHEN $2='RECHAZADO' THEN FALSE ELSE aceptada_sunat END,
            sunat_description=$3, sunat_responsecode=$4, sunat_soap_error=$5,
            enlace_pdf=COALESCE($6,enlace_pdf), enlace_xml=COALESCE($7,enlace_xml),
            enlace_cdr=COALESCE($8,enlace_cdr), respuesta_proveedor=$9::jsonb,
            fecha_aceptacion=CASE WHEN $2='ACEPTADO' THEN COALESCE(fecha_aceptacion,CURRENT_TIMESTAMP) ELSE fecha_aceptacion END,
            usuario_modificacion=$10, fecha_modificacion=CURRENT_TIMESTAMP
            WHERE id=$1 AND estado IN ('PENDIENTE','PENDIENTE_SUNAT','ERROR')
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

exports.generarAnulacion = async (certificadoId, data, userContext, dependencies = {}) => {
    const motivo = String(data.motivo || '').trim();
    if (!motivo || motivo.length > 100) throw errorNegocio('MOTIVO_ANULACION_INVALIDO');
    const client = await db.connect();
    let reserva;
    try {
        await client.query('BEGIN');
        const facturacion = await validarAccesoFacturacion(client, certificadoId, userContext, true);
        const objetivo = await obtenerObjetivoAnulacion(client, facturacion, data.tipoDocumento, data.documentoId);
        if (objetivo.row.estado !== 'ACEPTADO') throw errorNegocio('DOCUMENTO_NO_ANULABLE', 409);
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

exports.consultarAnulacion = async (certificadoId, anulacionId, userContext, dependencies = {}) => {
    const facturacion = await validarAccesoFacturacion(db, certificadoId, userContext);
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

exports._private = { validarPlazoNotaCredito,
    validarDatosNota,
    reservarSerieNota,
    registrarOperacion,
    finalizarOperacion,
    recuperarResultadoIncierto,
    normalizarTipoNota,
    errorNegocio
};
