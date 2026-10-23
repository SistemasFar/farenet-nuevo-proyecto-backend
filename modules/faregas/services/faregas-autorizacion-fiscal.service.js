const db = require('../../../config/database');
const { esDocumentoBaseOperable } = require('./faregas-comprobante-operabilidad.service');

const TIPOS_POR_OPERACION = Object.freeze({
    ANULACION_COMPROBANTE: new Set(['ANULAR_AMBOS']),
    NOTA_CORRECTIVA: new Set(['ANULAR_AMBOS'])
});

const PERMISOS_POR_OPERACION = Object.freeze({
    ANULACION_COMPROBANTE: 'FAREGAS_ANULAR_COMPROBANTE',
    NOTA_CORRECTIVA: 'FAREGAS_NOTA_CREDITO'
});

const errorNegocio = (code, statusCode = 400, detalles) => {
    const error = new Error(code);
    error.code = code;
    error.statusCode = statusCode;
    if (detalles !== undefined) error.detalles = detalles;
    return error;
};

const enteroPositivo = (valor, codigo) => {
    const numero = Number(valor);
    if (!Number.isInteger(numero) || numero <= 0) throw errorNegocio(codigo);
    return numero;
};

/**
 * Puerta de integración para Fase 4B. Sólo valida autorización administrativa;
 * no ejecuta, reserva ni modifica documentos fiscales.
 */
const validarSolicitudAprobada = async ({
    solicitudId,
    certificadoId,
    operacion,
    userContext,
    executor = db
}) => {
    if (solicitudId === undefined || solicitudId === null || solicitudId === '') {
        throw errorNegocio('FAREGAS_SOLICITUD_FISCAL_REQUERIDA', 403);
    }
    const idSolicitud = enteroPositivo(solicitudId, 'FAREGAS_SOLICITUD_FISCAL_REQUERIDA');
    const idCertificado = enteroPositivo(certificadoId, 'CERTIFICADO_ID_INVALIDO');
    const tiposCompatibles = TIPOS_POR_OPERACION[operacion];
    const permisoRequerido = PERMISOS_POR_OPERACION[operacion];
    if (!tiposCompatibles || !permisoRequerido) throw errorNegocio('FAREGAS_OPERACION_FISCAL_INVALIDA');

    const username = String(userContext?.username || '').trim();
    if (!username) throw errorNegocio('USUARIO_NO_ENCONTRADO', 401);

    const result = await executor.query(`
        SELECT s.id, s.tipo_operacion, s.estado, s.certificado_id, s.facturacion_id,
               s.empresa_key, s.planta_key, s.usuario_solicitante, s.resultado_fiscal,
               c.estado AS certificado_estado, c.numero_certificado,
               f.estado AS facturacion_estado, f.nro_comprobante, f.aceptada_sunat,
               f.entorno_facturador, f.proveedor, f.serie, f.numero,
               f.enlace_pdf, f.enlace_xml,
               u.perfil_id, u.estado AS usuario_activo,
               EXISTS (
                   SELECT 1
                   FROM fg_perfil_permiso pp
                   JOIN fg_permiso p ON p.clave = pp.permiso_clave AND p.activo = TRUE
                   WHERE pp.perfil_clave = u.perfil_id
                     AND pp.permiso_clave = $4
               ) AS tiene_permiso,
               EXISTS (
                   SELECT 1
                   FROM fg_usuario_planta up
                   JOIN fg_perfil_planta pp
                     ON pp.planta_key = up.plantas_key
                    AND pp.perfil_clave = u.perfil_id
                   WHERE up.usuario_username = u.username
                     AND up.plantas_key = s.planta_key
               ) AS tiene_sede
        FROM fg_solicitud_operacion s
        JOIN fg_certificado c ON c.id = s.certificado_id
        JOIN fg_planta p ON p.key = s.planta_key AND p.empresa_key = s.empresa_key
        JOIN fg_facturacion f
          ON f.id = s.facturacion_id
         AND f.certificado_id = s.certificado_id
        JOIN fg_usuario u ON u.username = $3
        WHERE s.id = $1
          AND s.certificado_id = $2
        LIMIT 1
    `, [idSolicitud, idCertificado, username, permisoRequerido]);

    if (result.rowCount === 0) throw errorNegocio('FAREGAS_SOLICITUD_FISCAL_NO_ENCONTRADA', 404);
    const row = result.rows[0];
    if (!row.usuario_activo) throw errorNegocio('USUARIO_INACTIVO', 403);
    if (row.perfil_id !== 'SISTEMAS') {
        throw errorNegocio('FAREGAS_EJECUCION_FISCAL_NO_AUTORIZADA', 403, { perfilRequerido: 'SISTEMAS' });
    }
    if (!row.tiene_permiso) throw errorNegocio('FAREGAS_EJECUCION_FISCAL_NO_AUTORIZADA', 403, { permiso: permisoRequerido });
    if (!row.tiene_sede) throw errorNegocio('SOLICITUD_SEDE_NO_AUTORIZADA', 403);
    if (row.usuario_solicitante === username) throw errorNegocio('SOLICITUD_SEPARACION_FUNCIONES_REQUERIDA', 403);
    if (row.estado !== 'APROBADA' && row.estado !== 'EN_EJECUCION') {
        throw errorNegocio('SOLICITUD_NO_APROBADA', 409, { estado: row.estado });
    }
    if (!tiposCompatibles.has(row.tipo_operacion)) {
        throw errorNegocio('SOLICITUD_TIPO_INCOMPATIBLE', 409, { tipoOperacion: row.tipo_operacion });
    }
    if (row.resultado_fiscal) throw errorNegocio('SOLICITUD_FISCAL_YA_PROCESADA', 409);
    if (!row.facturacion_id || !esDocumentoBaseOperable({
        estado: row.facturacion_estado,
        aceptada_sunat: row.aceptada_sunat,
        entorno_facturador: row.entorno_facturador,
        proveedor: row.proveedor,
        nro_comprobante: row.nro_comprobante,
        serie: row.serie,
        numero: row.numero,
        enlace_pdf: row.enlace_pdf,
        enlace_xml: row.enlace_xml
    })) {
        throw errorNegocio('SOLICITUD_COMPROBANTE_NO_EMITIDO', 409, { estado: row.facturacion_estado });
    }

    const tablaConflicto = operacion === 'ANULACION_COMPROBANTE' ? 'fg_documento_anulacion' : 'fg_credito';
    const conflicto = await executor.query(`
        SELECT id, estado
        FROM ${tablaConflicto}
        WHERE facturacion_id = $1
          AND estado NOT IN ('RECHAZADO', 'ERROR', 'ERROR_DEFINITIVO')
        ORDER BY id DESC
        LIMIT 1
    `, [row.facturacion_id]);
    if (conflicto.rowCount > 0) {
        throw errorNegocio('DOCUMENTO_FISCAL_CORRECTIVO_EXISTENTE', 409, {
            documentoId: Number(conflicto.rows[0].id),
            estado: conflicto.rows[0].estado
        });
    }

    return {
        solicitudId: Number(row.id),
        certificadoId: Number(row.certificado_id),
        facturacionId: Number(row.facturacion_id),
        tipoOperacion: row.tipo_operacion,
        empresaKey: row.empresa_key,
        plantaKey: row.planta_key,
        usuarioEjecutor: username
    };
};

const bloquearEjecucionHastaFase4B = () => {
    throw errorNegocio('FAREGAS_EJECUCION_FISCAL_FASE_4B_PENDIENTE', 409);
};

const exigirSolicitudAdministrativaDisponible = () => {
    throw errorNegocio('FAREGAS_SOLICITUD_FISCAL_REQUERIDA', 403);
};

module.exports = {
    validarSolicitudAprobada,
    bloquearEjecucionHastaFase4B,
    exigirSolicitudAdministrativaDisponible,
    _private: { TIPOS_POR_OPERACION, PERMISOS_POR_OPERACION, errorNegocio, enteroPositivo }
};
