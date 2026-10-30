const crypto = require('crypto');
const db = require('../../../config/database');
const certificadosService = require('./faregas-certificados.service');
const defaultDocumentosService = require('./faregas-documentos-electronicos.service');
const defaultNubefactConfigService = require('./faregas-nubefact-config.service');
const { esDocumentoBaseOperable } = require('./faregas-comprobante-operabilidad.service');
const {
    MENSAJE_IMPORTE_CERO,
    SQL_CAMPOS_IMPORTE_FINAL_CONTEXTO,
    SQL_JOINS_IMPORTE_FINAL_CONTEXTO,
    evaluarImporteFinalCertificado,
    exigirAnulacionPermitidaPorImporte,
    tieneOperacionFiscalIniciada
} = require('./faregas-certificado-anulacion-policy.service');
const {
    resolverOperacionFiscal,
    RESULTADOS: RESULTADOS_RESOLUCION_FISCAL,
    OPERACIONES: OPERACIONES_RESOLUCION_FISCAL
} = require('./faregas-anulacion-fiscal.resolver');
const {
    SQL_CODIGOS_HISTORICOS_ANULACION,
    normalizarMotivoNotaCredito,
    requiereSolicitudNotaCredito
} = require('./faregas-notas-credito.constants');
const {
    TIPOS_SOLICITUD,
    ESTADOS_SOLICITUD,
    ESTADOS_QUE_BLOQUEAN,
    PERMISOS_SOLICITUD,
    TIPOS_CERTIFICADO,
    TIPOS_COMPROBANTE,
    TIPOS_AMBOS,
    TIPOS_RECTIFICACION,
    CAMPOS_RECTIFICABLES_BASE,
    CAMPOS_RECTIFICABLES_ESPECIFICOS,
    CAMPOS_RECTIFICABLES_PERMITIDOS,
    CAMPOS_RECTIFICABLES_COMPROBANTE,
    CAMPOS_RECTIFICABLES_COMPROBANTE_PERMITIDOS,
    TRANSICIONES_ADMINISTRATIVAS,
    CONFIG_ANULACION_TECNICA
} = require('./faregas-solicitudes-operacion.constants');
const notificacionesService = require('./faregas-notificaciones.service');
const accesoSedesService = require('./faregas-acceso-sedes.service');
const notasCreditoWorker = require('./faregas-notas-credito-worker.service');

const errorNegocio = (code, statusCode = 400, detalles) => {
    const error = new Error(code);
    error.code = code;
    error.statusCode = statusCode;
    if (detalles !== undefined) error.detalles = detalles;
    return error;
};

const esVerdadero = (valor) => valor === true || String(valor || '').trim().toLowerCase() === 'true';

const etiquetaEstadoNotaCreditoBackend = (estado) => {
  switch (String(estado || '').trim().toUpperCase()) {
    case 'PENDIENTE': return 'PENDIENTE';
    case 'PENDIENTE_SUNAT': return 'PENDIENTE_SUNAT';
    case 'ACEPTADA': return 'ACEPTADA';
    case 'RECHAZADA': return 'RECHAZADA';
    case 'ERROR': return 'ERROR';
    case 'INCERTA': return 'INCERTA';
    default: return String(estado || 'DESCONOCIDO');
  }
};

const evaluarActivacionEjecucionAutomatica = ({ solicitud, estadoProveedor, configuracion = {} }) => {
    if (solicitud?.usuarioSolicitante === solicitud?.usuarioDecision) {
        return {
            habilitada: false,
            codigo: 'EJECUTOR_DISTINTO_REQUERIDO',
            motivo: 'La solicitud fue autoaprobada y debe ser ejecutada por otro usuario autorizado.'
        };
    }
    if (!esVerdadero(configuracion.enabled)) {
        return {
            habilitada: false,
            codigo: 'EJECUCION_AUTOMATICA_DESHABILITADA',
            motivo: 'La ejecución fiscal automática todavía no está habilitada en este ambiente.'
        };
    }
    if (estadoProveedor?.provider !== 'NUBEFACT' || !estadoProveedor?.enabled || !estadoProveedor?.configured) {
        return {
            habilitada: false,
            codigo: 'NUBEFACT_NO_HABILITADO',
            motivo: 'NubeFact no está habilitado o configurado completamente para la sede de la solicitud.'
        };
    }

    const entorno = String(estadoProveedor.environment || '').trim().toUpperCase();
    if (entorno === 'DEMO') return { habilitada: true, entorno };

    if (!['PRODUCCION', 'PRODUCTION'].includes(entorno)) {
        return {
            habilitada: false,
            codigo: 'NUBEFACT_ENTORNO_NO_AUTORIZADO',
            motivo: `El entorno fiscal '${entorno || 'NO_CONFIGURADO'}' no está autorizado para ejecución automática.`
        };
    }

    const produccionSegura = esVerdadero(configuracion.productionAuthorized)
        && estadoProveedor.productionConfirmed === true
        && estadoProveedor.enviarSunat === true
        && estadoProveedor.correlativosV2Enabled === true
        && estadoProveedor.cronReconciliationEnabled === true
        && estadoProveedor.notasCronReconciliationEnabled === true;
    if (!produccionSegura) {
        return {
            habilitada: false,
            codigo: 'NUBEFACT_PRODUCCION_NO_AUTORIZADA',
            motivo: 'La ejecución automática en producción no cuenta con autorización expresa y reconciliación completa.'
        };
    }
    return { habilitada: true, entorno: 'PRODUCCION' };
};

const texto = (valor, maximo, obligatorio = false) => {
    const limpio = valor === undefined || valor === null ? '' : String(valor).trim();
    if (obligatorio && !limpio) throw errorNegocio('CAMPO_OBLIGATORIO');
    if (limpio.length > maximo) throw errorNegocio('TEXTO_DEMASIADO_LARGO');
    return limpio || null;
};

const enteroPositivo = (valor, codigo = 'IDENTIFICADOR_INVALIDO') => {
    const numero = Number(valor);
    if (!Number.isInteger(numero) || numero <= 0) throw errorNegocio(codigo);
    return numero;
};

const normalizarTipo = (valor) => {
    const tipo = String(valor || '').trim().toUpperCase();
    if (!TIPOS_SOLICITUD.includes(tipo)) throw errorNegocio('TIPO_SOLICITUD_INVALIDO');
    return tipo;
};

const normalizarUuid = (valor) => {
    const clave = String(valor || '').trim().toLowerCase();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(clave)) {
        throw errorNegocio('IDEMPOTENCIA_INVALIDA');
    }
    return clave;
};

const CLAVES_PROPUESTAS_PROHIBIDAS = /(password|contras|token|secret|credencial|correlativo|numero_certificado|fecha_emision|enlace_pdf|enlace_xml|enlace_cdr|empresa_key|planta_key|estado|id)$/i;

const CATEGORIAS_PERMITIDAS = new Set(['vehiculo', 'titular', 'taller', 'especifico', 'certificado', 'comprobante', 'datos']);

const camposRectificablesCertificado = (tipoCertificado) => {
    const clave = String(tipoCertificado || '').toUpperCase();
    let especificos = [];
    if (clave.includes('GNV')) especificos = CAMPOS_RECTIFICABLES_ESPECIFICOS.GNV;
    else if (clave.includes('GLP')) especificos = CAMPOS_RECTIFICABLES_ESPECIFICOS.GLP;
    else if (clave.includes('CONFORMIDAD')) especificos = CAMPOS_RECTIFICABLES_ESPECIFICOS.CONFORMIDAD;
    return [...new Set([...CAMPOS_RECTIFICABLES_BASE, ...especificos])];
};

const camposPermitidosParaTipo = (tipo, camposCertificado = CAMPOS_RECTIFICABLES_PERMITIDOS) => {
    if (tipo === 'RECTIFICAR_CERTIFICADO') return new Set(camposCertificado);
    if (tipo === 'RECTIFICAR_COMPROBANTE') return CAMPOS_RECTIFICABLES_COMPROBANTE_PERMITIDOS;
    if (tipo === 'RECTIFICAR_AMBOS') {
        return new Set([...camposCertificado, ...CAMPOS_RECTIFICABLES_COMPROBANTE_PERMITIDOS]);
    }
    return new Set();
};

const validarDatosPropuestos = (tipo, valor, camposCertificado = CAMPOS_RECTIFICABLES_PERMITIDOS) => {
    if (tipo === 'EMITIR_NOTA_CREDITO') {
        if (!valor || typeof valor !== 'object' || Array.isArray(valor)) {
            throw errorNegocio('DATOS_PROPUESTOS_REQUERIDOS');
        }
        const claves = Object.keys(valor);
        const clavesPermitidas = ['motivoCodigo', 'itemIndice', 'descripcionCorregida', 'descripcionOriginal', 'codigoProducto'];
        if (claves.some((clave) => !clavesPermitidas.includes(clave))) {
            throw errorNegocio('DATO_PROPUESTO_PROHIBIDO', 400, { campo: claves.find((clave) => !clavesPermitidas.includes(clave)) });
        }
        const motivoCodigo = normalizarMotivoNotaCredito(valor.motivoCodigo);
        if (!motivoCodigo || !requiereSolicitudNotaCredito(motivoCodigo)) {
            throw errorNegocio('MOTIVO_NOTA_CREDITO_AUTORIZACION_INVALIDO', 400);
        }
        // Para motivo 03, validar que itemIndice y descripcionCorregida estén presentes
        if (motivoCodigo === '03') {
            const itemIndice = valor.itemIndice;
            if (itemIndice === undefined || itemIndice === null || isNaN(Number(itemIndice))) {
                throw errorNegocio('ITEM_INDICE_REQUERIDO', 400, {
                    message: 'El índice de la línea a corregir es obligatorio para el motivo 03.'
                });
            }
            const descripcionCorregida = String(valor.descripcionCorregida || '').trim();
            if (!descripcionCorregida || descripcionCorregida.length < 5) {
                throw errorNegocio('DESCRIPCION_CORREGIDA_REQUERIDA', 400, {
                    message: 'La descripción corregida debe tener al menos 5 caracteres.'
                });
            }
            return {
                motivoCodigo,
                itemIndice: Number(itemIndice),
                descripcionCorregida
            };
        }
        return { motivoCodigo };
    }
    if (!TIPOS_RECTIFICACION.has(tipo)) return null;
    if (!valor || typeof valor !== 'object' || Array.isArray(valor) || Object.keys(valor).length === 0) {
        throw errorNegocio('DATOS_PROPUESTOS_REQUERIDOS');
    }
    const serializado = JSON.stringify(valor);
    if (serializado.length > 10000) throw errorNegocio('DATOS_PROPUESTOS_DEMASIADO_GRANDES');

    let conteoCamposValidos = 0;
    const camposPermitidos = camposPermitidosParaTipo(tipo, camposCertificado);

    const revisar = (objeto, esNivelRaiz = false) => {
        Object.entries(objeto).forEach(([clave, contenido]) => {
            if (CLAVES_PROPUESTAS_PROHIBIDAS.test(clave)) {
                throw errorNegocio('DATO_PROPUESTO_PROHIBIDO', 400, { campo: clave });
            }
            if (contenido && typeof contenido === 'object' && !Array.isArray(contenido)) {
                if (esNivelRaiz && CATEGORIAS_PERMITIDAS.has(clave)) {
                    revisar(contenido, false);
                } else {
                    revisar(contenido, false);
                }
            } else {
                if (!camposPermitidos.has(clave)) {
                    throw errorNegocio('CAMPO_NO_RECTIFICABLE', 400, { campo: clave });
                }
                conteoCamposValidos += 1;
            }
        });
    };
    revisar(valor, true);
    if (conteoCamposValidos === 0) {
        throw errorNegocio('DATOS_PROPUESTOS_REQUERIDOS');
    }
    return valor;
};

const aplanarPropuestas = (datosPropuestos) => {
    const plano = {};
    if (!datosPropuestos || typeof datosPropuestos !== 'object') return plano;
    Object.entries(datosPropuestos).forEach(([k, v]) => {
        if (v && typeof v === 'object' && !Array.isArray(v)) {
            Object.assign(plano, aplanarPropuestas(v));
        } else {
            plano[k] = v;
        }
    });
    return plano;
};

const obtenerValorDeSnapshot = (snapshot, campo) => {
    if (!snapshot) return null;
    if (snapshot.vehiculo && campo in snapshot.vehiculo) return snapshot.vehiculo[campo];
    if (campo === 'observaciones') return snapshot.observaciones;
    if (snapshot.especifico && campo in snapshot.especifico) return snapshot.especifico[campo];
    if (campo === 'titular_nombre' || campo === 'nombre_razon_social') {
        return snapshot.titulares?.[0]?.nombre_razon_social || null;
    }
    if (snapshot.titulares?.[0] && campo in snapshot.titulares[0]) {
        return snapshot.titulares[0][campo];
    }
    return null;
};

const calcularDiferencias = (snapshot, datosPropuestos) => {
    const plano = aplanarPropuestas(datosPropuestos);
    const diferencias = [];
    Object.entries(plano).forEach(([campo, valorNuevo]) => {
        const valorOriginal = obtenerValorDeSnapshot(snapshot, campo);
        const normOrig = valorOriginal === null || valorOriginal === undefined ? '' : String(valorOriginal).trim();
        const normNuevo = valorNuevo === null || valorNuevo === undefined ? '' : String(valorNuevo).trim();
        if (normOrig !== normNuevo) {
            diferencias.push({
                campo,
                valorOriginal: valorOriginal ?? null,
                valorPropuesto: valorNuevo ?? null
            });
        }
    });
    return diferencias;
};

const requiereComprobante = (tipo) => TIPOS_COMPROBANTE.has(tipo) || TIPOS_AMBOS.has(tipo);
const afectaCertificado = (tipo) => TIPOS_CERTIFICADO.has(tipo) || TIPOS_AMBOS.has(tipo);

const consultaContextoCertificado = (bloquear = false) => `
    SELECT
        c.id AS certificado_id,
        c.numero_certificado,
        c.tipo_certificado_clave,
        tc.nombre AS tipo_certificado_nombre,
        c.estado AS certificado_estado,
        c.fecha_emision,
        c.fecha_anulacion,
        c.planta_key,
        p.nombre AS planta_nombre,
        p.empresa_key,
        e.nombre AS empresa_nombre,
        v.placa,
        f.id AS facturacion_id,
        f.tipo_comprobante,
        f.nro_comprobante,
        f.estado AS facturacion_estado,
        f.fecha_documento,
        f.importe_total,
        f.tipo_documento_cliente,
        f.nro_documento,
        f.nombre_razon_social,
        f.direccion AS direccion_cliente,
        f.moneda_key,
        f.serie,
        f.numero,
        f.proveedor,
        f.aceptada_sunat,
        f.sunat_description,
        f.sunat_responsecode,
        f.entorno_facturador,
        f.enlace_pdf,
        f.enlace_xml,
        ${SQL_CAMPOS_IMPORTE_FINAL_CONTEXTO},
        emision_fiscal.fecha_emision_fiscal,
        (clock_timestamp() >= emision_fiscal.fecha_emision_fiscal
         AND clock_timestamp() < emision_fiscal.fecha_emision_fiscal + INTERVAL '24 hours')
            AS anulacion_directa_en_plazo,
         fd.descripcion_servicio,
         EXISTS (SELECT 1 FROM fg_credito cr WHERE cr.facturacion_id = f.id) AS tiene_nota_credito
     FROM fg_certificado c
    JOIN fg_planta p ON p.key = c.planta_key
    JOIN fg_empresa e ON e.key = p.empresa_key
    LEFT JOIN fg_tipo_certificado tc ON tc.clave = c.tipo_certificado_clave
    LEFT JOIN LATERAL (
        SELECT fact.*
        FROM fg_facturacion fact
        WHERE fact.certificado_id = c.id
        ORDER BY fact.id DESC
        LIMIT 1
    ) f ON TRUE
    ${SQL_JOINS_IMPORTE_FINAL_CONTEXTO}
    LEFT JOIN LATERAL (
        SELECT MIN(COALESCE(fi.fecha_finalizacion, fi.fecha_creacion) AT TIME ZONE 'America/Lima')
            AS fecha_emision_fiscal
        FROM fg_facturacion_intento fi
        WHERE fi.facturacion_id = f.id
          AND fi.estado IN ('ACEPTADO', 'PENDIENTE_SUNAT')
    ) emision_fiscal ON TRUE
    LEFT JOIN LATERAL (
        SELECT string_agg(od.descripcion_snapshot, ' | ' ORDER BY od.orden) AS descripcion_servicio
        FROM fg_operacion_detalle od
        WHERE od.operacion_id = f.operacion_id
          AND od.certificado_id = c.id
    ) fd ON f.id IS NOT NULL
    LEFT JOIN fg_certificado_vehiculo v ON v.certificado_id = c.id
    WHERE c.id = $1
    ${bloquear ? 'FOR UPDATE OF c' : ''}
`;

const obtenerUsuarioActual = async (executor, userContext) => {
    const username = texto(userContext?.username, 255, true);
    const result = await executor.query(`
        SELECT username, perfil_id, estado
        FROM fg_usuario
        WHERE username = $1
        LIMIT 1
    `, [username]);
    if (result.rowCount === 0) throw errorNegocio('USUARIO_NO_ENCONTRADO', 401);
    if (!result.rows[0].estado) throw errorNegocio('USUARIO_INACTIVO', 403);
    return result.rows[0];
};

const obtenerPermisos = async (executor, perfilId) => {
    const result = await executor.query(`
        SELECT pp.permiso_clave
        FROM fg_perfil_permiso pp
        JOIN fg_permiso p ON p.clave = pp.permiso_clave AND p.activo = TRUE
        WHERE pp.perfil_clave = $1
          AND pp.permiso_clave = ANY($2::varchar[])
    `, [perfilId, Object.values(PERMISOS_SOLICITUD)]);
    return new Set(result.rows.map((row) => row.permiso_clave));
};

const exigirPermiso = (permisos, requerido) => {
    const requeridos = Array.isArray(requerido) ? requerido : [requerido];
    if (!requeridos.some((permiso) => permisos.has(permiso))
        && !permisos.has(PERMISOS_SOLICITUD.ADMINISTRAR)) {
        throw errorNegocio('SOLICITUD_PERMISO_DENEGADO', 403, { permiso: requeridos.join(' | ') });
    }
};

const validarAccesoPlanta = async (executor, usuario, plantaKey, empresaKey = null) => {
    const acceso = await accesoSedesService.obtenerAccesoPlanta(executor, {
        username: usuario.username,
        perfilId: usuario.perfil_id,
        plantaKey,
        empresaKey
    });
    if (acceso) return;
    if (empresaKey) {
        const accesoOtraEmpresa = await accesoSedesService.obtenerAccesoPlanta(executor, {
            username: usuario.username,
            perfilId: usuario.perfil_id,
            plantaKey
        });
        if (accesoOtraEmpresa) throw errorNegocio('SOLICITUD_EMPRESA_NO_AUTORIZADA', 403);
    }
    throw errorNegocio('SOLICITUD_SEDE_NO_AUTORIZADA', 403);
};

const validarVentanaAnulacionDirecta = (row, tipo) => {
    if (tipo !== 'ANULAR_AMBOS' || !row.facturacion_id) return;
    if (!row.fecha_emision_fiscal) {
        throw errorNegocio('SOLICITUD_FECHA_EMISION_FISCAL_NO_DISPONIBLE', 409);
    }
    if (row.anulacion_directa_en_plazo !== true) {
        throw errorNegocio('SOLICITUD_ANULACION_PLAZO_VENCIDO', 409, {
            fechaEmisionFiscal: row.fecha_emision_fiscal,
            plazoHoras: 24
        });
    }
};

const snapshotCertificado = (row) => ({
    id: Number(row.certificado_id),
    numero: row.numero_certificado || null,
    tipo: row.tipo_certificado_clave,
    estado: row.certificado_estado,
    fechaEmision: row.fecha_emision || null,
    fechaAnulacion: row.fecha_anulacion || null,
    placa: row.placa || null
});

const snapshotComprobante = (row) => row.facturacion_id ? ({
    id: Number(row.facturacion_id),
    tipo: row.tipo_comprobante,
    numero: row.nro_comprobante || null,
    estado: row.facturacion_estado,
    fechaEmision: row.fecha_documento || null,
    importeTotal: row.importe_total === null ? null : Number(row.importe_total),
    moneda: row.moneda_key || null,
    tipoDocumentoCliente: row.tipo_documento_cliente || null,
    numeroDocumentoCliente: row.nro_documento || null,
    nombreRazonSocial: row.nombre_razon_social || null,
    direccionCliente: row.direccion_cliente || null,
    descripcionServicio: row.descripcion_servicio || null,
    serie: row.serie || null,
    correlativo: row.numero === null ? null : Number(row.numero),
    proveedor: row.proveedor || null,
    entorno: row.entorno_facturador || null,
    aceptadaSunat: row.aceptada_sunat,
    sunatCodigo: row.sunat_responsecode || null,
    sunatDescripcion: row.sunat_description || null,
    tieneNotaCredito: row.tiene_nota_credito === true
}) : null;

const datosFiscalesActuales = (row) => row.facturacion_id ? ({
    facturacion_tipo_documento: row.tipo_documento_cliente || '',
    facturacion_nro_documento: row.nro_documento || '',
    facturacion_nombre_razon_social: row.nombre_razon_social || '',
    facturacion_direccion: row.direccion_cliente || '',
    facturacion_descripcion_servicio: row.descripcion_servicio || ''
}) : null;

const estadoSolicitudComprobante = (row) => {
    if (!row.facturacion_id) {
        return { disponible: false, codigo: 'SOLICITUD_COMPROBANTE_REQUERIDO', motivo: 'No existe un comprobante asociado al certificado.' };
    }
    if (!esDocumentoBaseOperable({
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
        return {
            disponible: false,
            codigo: 'SOLICITUD_COMPROBANTE_NO_EMITIDO',
            motivo: 'El comprobante todavía no fue aceptado por SUNAT ni generado completamente por el proveedor en el ambiente de prueba.'
        };
    }
    return { disponible: true, codigo: null, motivo: null };
};

const validarContextoParaTipo = (row, tipo, opciones = {}) => {
    if (String(row.certificado_estado || '').toUpperCase() !== 'EMITIDO' || !row.numero_certificado) {
        throw errorNegocio('SOLICITUD_CERTIFICADO_NO_EMITIDO', 409);
    }
    if (requiereComprobante(tipo) && opciones.permitirComprobanteNoEmitido !== true) {
        const disponibilidad = estadoSolicitudComprobante(row);
        if (!disponibilidad.disponible) {
            throw errorNegocio(disponibilidad.codigo, 409, { motivo: disponibilidad.motivo });
        }
    }
    // Bloquear rectificación cuando el comprobante ya tiene una nota de crédito
    if (TIPOS_RECTIFICACION.has(tipo) && row.tiene_nota_credito === true) {
        throw errorNegocio('RECTIFICACION_BLOQUEADA_POR_NOTA_CREDITO', 409, {
            motivo: 'No se puede rectificar este certificado porque su comprobante ya tiene una nota de crédito emitida.'
        });
    }
};

const mapearSolicitud = (row) => {
    const importeFinal = evaluarImporteFinalCertificado(row);
    return {
    id: Number(row.id),
    tipoOperacion: row.tipo_operacion,
    certificadoId: row.certificado_id === null ? null : Number(row.certificado_id),
    facturacionId: row.facturacion_id === null ? null : Number(row.facturacion_id),
    empresaKey: row.empresa_key,
    empresaNombre: row.empresa_nombre || null,
    plantaKey: row.planta_key,
    plantaNombre: row.planta_nombre || null,
    usuarioSolicitante: row.usuario_solicitante,
    motivo: row.motivo,
    observaciones: row.observaciones,
    estado: row.estado,
    usuarioDecision: row.usuario_decision,
    fechaSolicitud: row.fecha_solicitud,
    fechaDecision: row.fecha_decision,
    justificacionDecision: row.justificacion_decision,
    datosOriginalesCertificado: row.datos_originales_certificado,
    datosOriginalesComprobante: row.datos_originales_comprobante,
    datosPropuestos: row.datos_propuestos,
    fechaEmisionOriginal: row.fecha_emision_original,
    resultadoTecnico: row.resultado_tecnico,
    resultadoFiscal: row.resultado_fiscal,
    usuarioEjecucion: row.usuario_ejecucion || null,
    fechaEjecucion: row.fecha_ejecucion || null,
    idempotenciaEjecucion: row.idempotencia_ejecucion || null,
    autorizacionAutoejecucion: row.autorizacion_autoejecucion === true,
    version: Number(row.version),
    fechaCreacion: row.fecha_creacion,
    fechaModificacion: row.fecha_modificacion,
    numeroCertificado: row.numero_certificado || row.datos_originales_certificado?.numero || null,
    tipoCertificado: row.tipo_certificado_nombre || row.datos_originales_certificado?.tipo || null,
    nroComprobante: row.nro_comprobante || row.datos_originales_comprobante?.numero || null,
    placa: row.placa || row.datos_originales_certificado?.placa || null,
    importeFinal: importeFinal.determinable ? importeFinal.importeFinal : null,
    monedaImporteFinal: importeFinal.moneda || null,
    anulacionImporteCero: importeFinal.determinable === true && importeFinal.esCero === true,
    anulacionImporteNoDeterminable: importeFinal.determinable !== true
    };
};

const SELECT_SOLICITUD = `
    SELECT s.*, p.nombre AS planta_nombre, e.nombre AS empresa_nombre,
           c.numero_certificado, tc.nombre AS tipo_certificado_nombre,
           f.nro_comprobante, f.importe_total AS facturacion_importe_total,
           f.moneda_key AS facturacion_moneda,
           ${SQL_CAMPOS_IMPORTE_FINAL_CONTEXTO},
           v.placa
    FROM fg_solicitud_operacion s
    JOIN fg_planta p ON p.key = s.planta_key
    JOIN fg_empresa e ON e.key = s.empresa_key
    LEFT JOIN fg_certificado c ON c.id = s.certificado_id
    LEFT JOIN fg_tipo_certificado tc ON tc.clave = c.tipo_certificado_clave
    LEFT JOIN fg_facturacion f ON f.id = s.facturacion_id
    ${SQL_JOINS_IMPORTE_FINAL_CONTEXTO}
    LEFT JOIN fg_certificado_vehiculo v ON v.certificado_id = c.id
`;

const registrarEvento = async (executor, {
    solicitudId, tipoEvento, estadoAnterior = null, estadoPosterior,
    username, comentario = null, metadatos = null
}) => {
    await executor.query(`
        INSERT INTO fg_solicitud_operacion_evento (
            solicitud_id, tipo_evento, estado_anterior, estado_posterior,
            usuario_responsable, comentario, metadatos
        ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
    `, [
        solicitudId, tipoEvento, estadoAnterior, estadoPosterior, username,
        comentario, metadatos ? JSON.stringify(metadatos) : null
    ]);
};

const crearServicio = (database = db, config = {}) => {
    const workerNotasCredito = config.notasCreditoWorker || notasCreditoWorker;
    const conTransaccion = async (operacion) => {
        const client = await database.connect();
        try {
            await client.query('BEGIN');
            const resultado = await operacion(client);
            await client.query('COMMIT');
            return resultado;
        } catch (error) {
            if (!error?.transaccionYaComprometida) {
                try { await client.query('ROLLBACK'); } catch (_) {}
            }
            throw error;
        } finally {
            client.release();
        }
    };

    const contextoCertificado = async (certificadoId, userContext) => {
        const id = enteroPositivo(certificadoId, 'CERTIFICADO_ID_INVALIDO');
        const usuario = await obtenerUsuarioActual(database, userContext);
        const permisos = await obtenerPermisos(database, usuario.perfil_id);
        if (!permisos.has(PERMISOS_SOLICITUD.CREAR) && !permisos.has(PERMISOS_SOLICITUD.VER)
            && !permisos.has(PERMISOS_SOLICITUD.ADMINISTRAR)) {
            throw errorNegocio('SOLICITUD_PERMISO_DENEGADO', 403);
        }
        const result = await database.query(consultaContextoCertificado(false), [id]);
        if (result.rowCount === 0) throw errorNegocio('CERTIFICADO_NO_ENCONTRADO', 404);
        const row = result.rows[0];
        await validarAccesoPlanta(database, usuario, row.planta_key, row.empresa_key);
        let datosTecnicosActuales = null;
        try {
            datosTecnicosActuales = await certificadosService.obtenerSnapshotCompletoCertificado({ client: database, certificadoId: id });
        } catch (_) {}
        const disponibilidadComprobante = estadoSolicitudComprobante(row);
        const camposTecnicos = camposRectificablesCertificado(row.tipo_certificado_clave);
        const tiposDisponibles = ['ANULAR_AMBOS', 'EMITIR_NOTA_CREDITO', 'RECTIFICAR_CERTIFICADO'];
        const importeFinal = evaluarImporteFinalCertificado(row);
        const bloqueoImporte = importeFinal.determinable !== true || importeFinal.esCero === true;

        return {
            certificado: {
                ...snapshotCertificado(row),
                importeFinal: importeFinal.determinable ? importeFinal.importeFinal : null,
                monedaImporteFinal: importeFinal.moneda || null,
                anulacionImporteCero: importeFinal.determinable === true && importeFinal.esCero === true,
                anulacionImporteNoDeterminable: importeFinal.determinable !== true
            },
            puedeSolicitarAnulacionTotal: !bloqueoImporte,
            motivoBloqueoAnulacion: bloqueoImporte
                ? (importeFinal.esCero === true ? MENSAJE_IMPORTE_CERO : 'No se pudo determinar el importe final del certificado; la anulación está bloqueada.')
                : null,
            comprobante: snapshotComprobante(row),
            empresa: { key: row.empresa_key, nombre: row.empresa_nombre },
            planta: { key: row.planta_key, nombre: row.planta_nombre },
            tiposDisponibles,
            camposRectificables: camposTecnicos,
            camposRectificablesPorTipo: {
                RECTIFICAR_CERTIFICADO: camposTecnicos,
                RECTIFICAR_COMPROBANTE: disponibilidadComprobante.disponible ? [...CAMPOS_RECTIFICABLES_COMPROBANTE] : [],
                RECTIFICAR_AMBOS: disponibilidadComprobante.disponible
                    ? [...new Set([...camposTecnicos, ...CAMPOS_RECTIFICABLES_COMPROBANTE])]
                    : []
            },
            datosTecnicosActuales,
            datosFiscalesActuales: datosFiscalesActuales(row),
            comprobanteRestriccion: disponibilidadComprobante
        };
    };

    const crear = async (entrada, userContext, opciones = {}) => conTransaccion(async (client) => {
        const usuario = await obtenerUsuarioActual(client, userContext);
        const permisos = await obtenerPermisos(client, usuario.perfil_id);
        exigirPermiso(permisos, PERMISOS_SOLICITUD.CREAR);

        const certificadoId = enteroPositivo(entrada?.certificadoId, 'CERTIFICADO_ID_INVALIDO');
        const tipo = normalizarTipo(entrada?.tipoOperacion);
        const motivo = texto(entrada?.motivo, 500, true);
        const observaciones = texto(entrada?.observaciones, 2000);
        const idempotenciaClave = normalizarUuid(entrada?.idempotenciaClave);

        const contextoResult = await client.query(consultaContextoCertificado(true), [certificadoId]);
        if (contextoResult.rowCount === 0) throw errorNegocio('CERTIFICADO_NO_ENCONTRADO', 404);
        const contexto = contextoResult.rows[0];
        await validarAccesoPlanta(client, usuario, contexto.planta_key, contexto.empresa_key);
        validarContextoParaTipo(contexto, tipo, {
            permitirComprobanteNoEmitido: opciones.flujoAnulacionTotal === true
        });

        // Exclusión mutua fiscal: verificar operaciones incompatibles para el mismo comprobante.
        if (contexto.facturacion_id) {
            if (tipo === 'EMITIR_NOTA_CREDITO') {
                // No permitir nota de crédito si hay una baja fiscal en trámite o aceptada
                const bajaActiva = await client.query(`
                    SELECT id FROM fg_documento_anulacion
                    WHERE facturacion_id = $1
                      AND estado IN ('BORRADOR', 'PENDIENTE', 'ACEPTADO')
                    LIMIT 1
                `, [contexto.facturacion_id]);
                if (bajaActiva.rowCount > 0) {
                    throw errorNegocio('OPERACION_FISCAL_INCOMPATIBLE', 409, {
                        motivo: 'No se puede solicitar una nota de crédito porque el comprobante ya tiene una baja fiscal en trámite o aceptada.'
                    });
                }
                // No permitir nota de crédito si hay una nota pendiente o aceptada
                const notaActiva = await client.query(`
                    SELECT id FROM fg_credito
                    WHERE facturacion_id = $1
                      AND estado IN ('PENDIENTE', 'PENDIENTE_SUNAT', 'ACEPTADA', 'ERROR')
                    LIMIT 1
                `, [contexto.facturacion_id]);
                if (notaActiva.rowCount > 0) {
                    throw errorNegocio('NOTA_CREDITO_YA_EXISTE', 409, {
                        motivo: 'Ya existe una nota de crédito pendiente o aceptada para este comprobante.'
                    });
                }
            }
            if (tipo === 'ANULAR_AMBOS') {
                // No permitir anulación si hay una nota de crédito en trámite o aceptada
                const notaActiva = await client.query(`
                    SELECT id FROM fg_credito
                    WHERE facturacion_id = $1
                      AND estado IN ('PENDIENTE', 'PENDIENTE_SUNAT', 'ACEPTADA', 'ERROR')
                    LIMIT 1
                `, [contexto.facturacion_id]);
                if (notaActiva.rowCount > 0) {
                    throw errorNegocio('OPERACION_FISCAL_INCOMPATIBLE', 409, {
                        motivo: 'No se puede solicitar una anulación porque el comprobante ya tiene una nota de crédito en trámite o aceptada.'
                    });
                }
            }
        }
        const datosPropuestos = validarDatosPropuestos(
            tipo,
            entrada?.datosPropuestos,
            camposRectificablesCertificado(contexto.tipo_certificado_clave)
        );

        const existenteIdempotente = await client.query(`
            SELECT * FROM fg_solicitud_operacion
            WHERE usuario_solicitante = $1 AND idempotencia_clave = $2::uuid
            LIMIT 1
        `, [usuario.username, idempotenciaClave]);
        if (existenteIdempotente.rowCount > 0) {
            const existente = existenteIdempotente.rows[0];
            if (Number(existente.certificado_id) !== certificadoId || existente.tipo_operacion !== tipo) {
                throw errorNegocio('IDEMPOTENCIA_REUTILIZADA', 409);
            }
            return { solicitud: mapearSolicitud(existente), creada: false };
        }

        // Regla transversal: un certificado cuyo importe final de operación es
        // S/ 0.00 no admite ninguna solicitud que lo anule. Se evalúa antes de
        // crear la solicitud para que ni la UI ni una llamada directa a la API
        // puedan dejar un trámite pendiente que después sea irreversible.
        if (afectaCertificado(tipo) && !String(tipo).startsWith('RECTIFICAR')) {
            exigirAnulacionPermitidaPorImporte(
                evaluarImporteFinalCertificado(contexto),
                { certificadoId, operacion: tipo }
            );
        }

        const facturacionId = requiereComprobante(tipo) && contexto.facturacion_id
            ? Number(contexto.facturacion_id)
            : null;
        const activa = await client.query(`
            SELECT id, tipo_operacion, estado
            FROM fg_solicitud_operacion
            WHERE estado = ANY($1::varchar[])
              AND (certificado_id = $2 OR ($3::bigint IS NOT NULL AND facturacion_id = $3))
            ORDER BY id DESC
            LIMIT 1
        `, [ESTADOS_QUE_BLOQUEAN, certificadoId, facturacionId]);
        if (activa.rowCount > 0) {
            throw errorNegocio('SOLICITUD_INCOMPATIBLE_ACTIVA', 409, {
                solicitudId: Number(activa.rows[0].id),
                estado: activa.rows[0].estado
            });
        }

        // Regla transversal: si ya existe una nota de crédito para este comprobante
        // con estado PENDIENTE, ACEPTADA, RECHAZADA, ERROR o INCERTA, no se permite
        // crear una nueva solicitud fiscal incompatible (anulación o nueva nota).
        const estadoNota = String(contexto.estadoNotaCredito || '').trim().toUpperCase();
        if (contexto.notaCreditoId && (
            estadoNota === 'PENDIENTE' || estadoNota === 'PENDIENTE_SUNAT'
            || estadoNota === 'ACEPTADA' || estadoNota === 'RECHAZADA'
            || estadoNota === 'ERROR' || estadoNota === 'INCERTA'
        )) {
            throw errorNegocio('NOTA_CREDITO_YA_EXISTE', 409, {
                notaCreditoId: Number(contexto.notaCreditoId),
                estado: estadoNota,
                mensaje: `Ya existe una nota de crédito (${etiquetaEstadoNotaCreditoBackend(estadoNota)}) para este comprobante. No se puede crear una operación fiscal incompatible.`
            });
        }
        validarVentanaAnulacionDirecta(contexto, tipo);

        let insertada;
        try {
            insertada = await client.query(`
                INSERT INTO fg_solicitud_operacion (
                    tipo_operacion, certificado_id, facturacion_id, empresa_key, planta_key,
                    usuario_solicitante, motivo, observaciones, estado,
                    datos_originales_certificado, datos_originales_comprobante, datos_propuestos,
                    fecha_emision_original, idempotencia_clave
                ) VALUES (
                    $1, $2, $3, $4, $5, $6, $7, $8, 'PENDIENTE_APROBACION',
                    $9::jsonb, $10::jsonb, $11::jsonb, $12, $13::uuid
                ) RETURNING *
            `, [
                tipo, certificadoId, facturacionId, contexto.empresa_key, contexto.planta_key,
                usuario.username, motivo, observaciones,
                JSON.stringify(snapshotCertificado(contexto)),
                contexto.facturacion_id ? JSON.stringify(snapshotComprobante(contexto)) : null,
                datosPropuestos ? JSON.stringify(datosPropuestos) : null,
                contexto.fecha_emision || null,
                idempotenciaClave
            ]);
        } catch (error) {
            if (error.code === '23505') throw errorNegocio('SOLICITUD_INCOMPATIBLE_ACTIVA', 409);
            throw error;
        }
        const solicitud = insertada.rows[0];
        await registrarEvento(client, {
            solicitudId: solicitud.id,
            tipoEvento: 'SOLICITUD_CREADA',
            estadoPosterior: 'PENDIENTE_APROBACION',
            username: usuario.username,
            comentario: motivo,
            metadatos: { tipoOperacion: tipo, version: 1 }
        });
        // Notificar a usuarios autorizados para aprobar/rechazar en la planta de la solicitud.
        try {
            if (tipo === 'EMITIR_NOTA_CREDITO') {
                await notificacionesService.crearParaAutorizacionNotaCredito(client, solicitud, {
                    eventoClave: 'SOLICITUD_CREADA',
                    tipo: 'SOLICITUD_PENDIENTE_APROBACION',
                    titulo: 'Nueva solicitud de autorización de nota de crédito',
                    mensaje: `Solicitado por: ${solicitud.usuario_solicitante} | Operación: Emitir nota de crédito | Certificado: ${solicitud.numero_certificado || 'N/A'} | Comprobante: ${solicitud.nro_comprobante || 'N/A'} | Sede: ${solicitud.planta_key} | Solicitud: #${solicitud.id}`
                });
            } else {
                await notificacionesService.crearParaSolicitud(client, solicitud, {
                    eventoClave: 'SOLICITUD_CREADA',
                    tipo: 'SOLICITUD_PENDIENTE_APROBACION',
                    titulo: 'Nueva solicitud pendiente de aprobación',
                    mensaje: `Solicitado por: ${solicitud.usuario_solicitante} | Operación: ${tipo} | Certificado: ${solicitud.numero_certificado || 'N/A'} | Comprobante: ${solicitud.nro_comprobante || 'N/A'} | Sede: ${solicitud.planta_key} | Solicitud: #${solicitud.id}`
                });
            }
        } catch (_notificacionError) {
            // No fallar la creación de la solicitud por un error en notificaciones.
        }
        return { solicitud: mapearSolicitud(solicitud), creada: true };
    });

    const construirAlcance = async (executor, userContext, permisoRequerido = PERMISOS_SOLICITUD.VER) => {
        const usuario = await obtenerUsuarioActual(executor, userContext);
        const permisos = await obtenerPermisos(executor, usuario.perfil_id);
        exigirPermiso(permisos, permisoRequerido);
        const plantasDb = await accesoSedesService.obtenerPlantasAutorizadas(executor, {
            username: usuario.username,
            perfilId: usuario.perfil_id
        });
        const plantasSet = new Set(plantasDb.map((row) => row.key));
        return {
            usuario,
            permisos,
            plantas: Array.from(plantasSet),
            puedeRevisar: permisos.has(PERMISOS_SOLICITUD.APROBAR)
                || permisos.has(PERMISOS_SOLICITUD.RECHAZAR)
                || permisos.has(PERMISOS_SOLICITUD.ADMINISTRAR)
        };
    };

    const listar = async (filtros = {}, userContext) => {
        const alcance = await construirAlcance(database, userContext);
        if (alcance.plantas.length === 0) return { data: [], total: 0, page: 1, pageSize: 10, totalPages: 1 };
        const params = [alcance.plantas];
        const condiciones = ['s.planta_key = ANY($1::varchar[])'];
        const agregar = (sql, valor) => { params.push(valor); condiciones.push(sql.replace('?', `$${params.length}`)); };
        if (filtros.estado) {
            const estado = String(filtros.estado).toUpperCase();
            if (!ESTADOS_SOLICITUD.includes(estado)) throw errorNegocio('ESTADO_SOLICITUD_INVALIDO');
            agregar('s.estado = ?', estado);
        }
        if (filtros.tipoOperacion) agregar('s.tipo_operacion = ?', normalizarTipo(filtros.tipoOperacion));
        if (filtros.plantaKey) {
            if (!alcance.plantas.includes(filtros.plantaKey)) throw errorNegocio('SOLICITUD_SEDE_NO_AUTORIZADA', 403);
            agregar('s.planta_key = ?', filtros.plantaKey);
        }
        if (filtros.usuarioSolicitante && alcance.puedeRevisar) agregar('s.usuario_solicitante ILIKE ?', `%${String(filtros.usuarioSolicitante).trim()}%`);
        if (filtros.fechaDesde) agregar('s.fecha_solicitud >= ?::date', filtros.fechaDesde);
        if (filtros.fechaHasta) agregar(`s.fecha_solicitud < ?::date + INTERVAL '1 day'`, filtros.fechaHasta);
        const page = Math.max(1, Number(filtros.page) || 1);
        const pageSize = Math.min(50, Math.max(1, Number(filtros.pageSize) || 10));
        const where = condiciones.join(' AND ');
        const totalResult = await database.query(`SELECT COUNT(*)::int AS total FROM fg_solicitud_operacion s WHERE ${where}`, params);
        params.push(pageSize, (page - 1) * pageSize);
        const result = await database.query(`
            ${SELECT_SOLICITUD}
            WHERE ${where}
            ORDER BY s.fecha_solicitud DESC, s.id DESC
            LIMIT $${params.length - 1} OFFSET $${params.length}
        `, params);
        const total = Number(totalResult.rows[0]?.total || 0);
        return { data: result.rows.map(mapearSolicitud), total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
    };

    const obtener = async (id, userContext, executor = database, bloquear = false, permiso = PERMISOS_SOLICITUD.VER) => {
        const solicitudId = enteroPositivo(id, 'SOLICITUD_ID_INVALIDO');
        const alcance = await construirAlcance(executor, userContext, permiso);
        const result = await executor.query(`${SELECT_SOLICITUD} WHERE s.id = $1 ${bloquear ? 'FOR UPDATE OF s' : ''}`, [solicitudId]);
        if (result.rowCount === 0) throw errorNegocio('SOLICITUD_NO_ENCONTRADA', 404);
        const row = result.rows[0];
        if (!alcance.plantas.includes(row.planta_key)) throw errorNegocio('SOLICITUD_SEDE_NO_AUTORIZADA', 403);
        await validarAccesoPlanta(executor, alcance.usuario, row.planta_key, row.empresa_key);
        if (!alcance.puedeRevisar && row.usuario_solicitante !== alcance.usuario.username) {
            throw errorNegocio('SOLICITUD_PERMISO_DENEGADO', 403);
        }
        return { row, alcance, solicitud: mapearSolicitud(row) };
    };

    const obtenerDetalle = async (id, userContext) => {
        const { row, alcance, solicitud } = await obtener(
            id,
            userContext,
            database,
            false,
            [
                PERMISOS_SOLICITUD.VER,
                PERMISOS_SOLICITUD.APROBAR,
                PERMISOS_SOLICITUD.RECHAZAR
            ]
        );
        const permisos = alcance.permisos;
        const esPropia = row.usuario_solicitante === alcance.usuario.username;
        const esRectificacion = row.tipo_operacion === 'RECTIFICAR_CERTIFICADO';
        const esAutorizacionNota = row.tipo_operacion === 'EMITIR_NOTA_CREDITO';
        const importeFinalSolicitud = evaluarImporteFinalCertificado(row);
        const bloqueoImporte = row.tipo_operacion === 'ANULAR_AMBOS' && (
            importeFinalSolicitud.determinable !== true || importeFinalSolicitud.esCero === true
        );
        const mensajeBloqueoImporte = importeFinalSolicitud.determinable !== true
            ? 'No se pudo determinar el importe final del certificado; la anulación está bloqueada hasta regularizar el importe.'
            : MENSAJE_IMPORTE_CERO;
        const permisosAutoejecucion = [
            PERMISOS_SOLICITUD.APROBAR,
            PERMISOS_SOLICITUD.AUTOAPROBAR,
            PERMISOS_SOLICITUD.EJECUTAR_ANULACION_CERTIFICADO,
            PERMISOS_SOLICITUD.AUTOEJECUTAR
        ];
        const permisosFaltantes = esPropia && row.tipo_operacion === 'ANULAR_AMBOS'
            ? permisosAutoejecucion.filter((permiso) => !permisos.has(permiso))
            : [];
        const permisoEjecucion = esRectificacion
            ? PERMISOS_SOLICITUD.EJECUTAR_RECTIFICACION_CERTIFICADO
            : PERMISOS_SOLICITUD.EJECUTAR_ANULACION_CERTIFICADO;
        const tienePermisoEjecucion = permisos.has(permisoEjecucion)
            || permisos.has(PERMISOS_SOLICITUD.ADMINISTRAR);
        // La rectificación se ejecuta exclusivamente con la solicitud aprobada.
        // La anulación fiscal conserva sus estados de recuperación.
        const estadoEjecutable = esRectificacion
            ? row.estado === 'APROBADA'
            : ['APROBADA', 'REQUIERE_INTERVENCION', 'ERROR'].includes(row.estado);
        let puedeEjecutar = !esAutorizacionNota && estadoEjecutable && tienePermisoEjecucion
            && (esRectificacion || !esPropia || permisosFaltantes.length === 0)
            && !bloqueoImporte;

        let motivoBloqueo = null;
        if (esAutorizacionNota) motivoBloqueo = row.estado === 'APROBADA'
            ? 'Autorización aprobada. La emisión automática se procesa mediante la cola fiscal persistente.'
            : 'Esta solicitud sólo autoriza la emisión; no ejecuta una anulación técnica.';
        else if (bloqueoImporte && ['APROBADA', 'REQUIERE_INTERVENCION', 'ERROR'].includes(row.estado)) motivoBloqueo = mensajeBloqueoImporte;
        else if (!tienePermisoEjecucion) motivoBloqueo = `Falta el permiso ${permisoEjecucion}.`;
        else if (!esRectificacion && esPropia && permisosFaltantes.length > 0) motivoBloqueo = `La autoejecución exige los permisos: ${permisosFaltantes.join(', ')}.`;
        else if (row.estado === 'PENDIENTE_APROBACION') motivoBloqueo = 'La solicitud aún no está aprobada.';
        else if (['RECHAZADA', 'CANCELADA'].includes(row.estado)) motivoBloqueo = `La solicitud está ${row.estado}.`;
        else if (row.estado === 'EN_EJECUCION') motivoBloqueo = 'La solicitud está en ejecución.';
        else if (row.estado === 'COMPLETADA') motivoBloqueo = 'La solicitud ya fue completada.';
        else if (esRectificacion && row.estado !== 'APROBADA') motivoBloqueo = 'La rectificación sólo puede ejecutarse cuando la solicitud está aprobada.';
        else if (!esRectificacion && row.tipo_operacion !== 'ANULAR_AMBOS') motivoBloqueo = 'El tipo de operación no admite ejecución fiscal.';

        let estadoFiscalActual = null;
        let resolucionFiscal = null;
        if (row.facturacion_id) {
            const fiscal = await database.query(`
                SELECT f.id, f.serie, f.numero, f.nro_comprobante, f.tipo_comprobante, f.estado,
                       f.aceptada_sunat, f.sunat_description, f.sunat_responsecode,
                       f.fecha_documento, f.fecha_creacion, f.fecha_aceptacion,
                       f.enlace_pdf, f.enlace_cdr, f.entorno_facturador, f.proveedor,
                       f.importe_total, f.respuesta_proveedor
                FROM fg_facturacion f WHERE f.id = $1
            `, [row.facturacion_id]);
            if (fiscal.rowCount > 0) {
                const f = fiscal.rows[0];
                const [anulaciones, notas] = await Promise.all([
                    database.query(`
                        SELECT id, estado, aceptada_sunat, ticket_sunat, fecha_creacion
                        FROM fg_documento_anulacion
                        WHERE facturacion_id = $1 ORDER BY id DESC LIMIT 5
                    `, [f.id]),
                    database.query(`
                        SELECT id, estado, nro_comprobante, motivo_codigo, importe_total, fecha_creacion
                        FROM fg_credito
                        WHERE facturacion_id = $1 ORDER BY id DESC LIMIT 5
                    `, [f.id])
                ]);
                const anulacionesPrevias = anulaciones.rows.map((item) => ({
                    id: Number(item.id),
                    tipo: 'BAJA',
                    estado: item.estado,
                    aceptadaSunat: item.aceptada_sunat,
                    ticketSunat: item.ticket_sunat,
                    fechaCreacion: item.fecha_creacion
                }));
                const notasCredito = notas.rows.map((item) => ({
                    id: Number(item.id),
                    tipo: 'NOTA_CREDITO',
                    estado: item.estado,
                    nroComprobante: item.nro_comprobante,
                    motivoCodigo: item.motivo_codigo,
                    importeTotal: item.importe_total === null ? null : Number(item.importe_total),
                    fechaCreacion: item.fecha_creacion
                }));
                const totalNotasPrevias = notasCredito
                    .filter((item) => item.estado === 'ACEPTADO')
                    .reduce((total, item) => total + Number(item.importeTotal || 0), 0);

                resolucionFiscal = resolverOperacionFiscal({
                    documento: {
                        ...f,
                        tipoComprobante: f.tipo_comprobante,
                        estado: f.estado,
                        aceptadaSunat: f.aceptada_sunat,
                        fechaEmision: f.fecha_documento || f.fecha_creacion,
                        fechaAceptacion: f.fecha_aceptacion,
                        enlaceCdr: f.enlace_cdr,
                        importeTotal: Number(f.importe_total),
                        entorno: f.entorno_facturador,
                        proveedor: f.proveedor
                    },
                    estadoProveedor: f.estado,
                    operacionesPrevias: [...anulacionesPrevias, ...notasCredito],
                    totalNotasPrevias
                });

                estadoFiscalActual = {
                    facturacionId: Number(f.id),
                    comprobante: f.nro_comprobante,
                    tipoComprobante: f.tipo_comprobante,
                    estado: f.estado,
                    aceptadaSunat: f.aceptada_sunat,
                    sunatDescripcion: f.sunat_description,
                    fechaEmision: f.fecha_documento || f.fecha_creacion,
                    fechaAceptacion: f.fecha_aceptacion,
                    enlacePdf: f.enlace_pdf,
                    enlaceCdr: f.enlace_cdr,
                    entorno: f.entorno_facturador,
                    pendienteSunat: f.estado === 'PENDIENTE_SUNAT',
                    anulaciones: anulacionesPrevias,
                    notasCredito
                };

                const bloqueoFiscal = [
                    RESULTADOS_RESOLUCION_FISCAL.NO_ELEGIBLE,
                    RESULTADOS_RESOLUCION_FISCAL.YA_ANULADO
                ].includes(resolucionFiscal.resultado);
                // La rectificación técnica no modifica el comprobante. Un
                // estado fiscal desfavorable no debe impedir corregir el
                // certificado ni debe sugerir una operación tributaria.
                if (bloqueoFiscal && row.tipo_operacion === 'ANULAR_AMBOS') {
                    puedeEjecutar = false;
                    if (!motivoBloqueo) motivoBloqueo = resolucionFiscal.motivo;
                }
            }
        }

        // Elegibilidad administrativa calculada con las mismas reglas que aplica
        // decidir()/aprobarYEjecutarAnulacionTotal(). La UI no debe inferir
        // permisos por su cuenta ni ofrecer una acción que el backend rechazará.
        const esAutoaprobacion = esPropia;
        const autoaprobacionNotaPermitida = !esAutorizacionNota
            || !esAutoaprobacion
            || permisos.has(PERMISOS_SOLICITUD.AUTOEJECUTAR);
        const puedeAprobarSolicitud = row.estado === 'PENDIENTE_APROBACION'
            && ['ANULAR_AMBOS', 'EMITIR_NOTA_CREDITO', 'RECTIFICAR_CERTIFICADO'].includes(row.tipo_operacion)
            && permisos.has(PERMISOS_SOLICITUD.APROBAR)
            && (!esAutoaprobacion || permisos.has(PERMISOS_SOLICITUD.AUTOAPROBAR))
            && autoaprobacionNotaPermitida
            && !bloqueoImporte;
        const puedeAprobarYEjecutar = puedeAprobarSolicitud
            && !esAutorizacionNota
            && !esRectificacion
            && permisos.has(PERMISOS_SOLICITUD.EJECUTAR_ANULACION_CERTIFICADO)
            && (!esAutoaprobacion || permisos.has(PERMISOS_SOLICITUD.AUTOEJECUTAR))
            && !bloqueoImporte;

        let motivoBloqueoAprobacion = null;
        if (!puedeAprobarSolicitud) {
            if (bloqueoImporte && row.estado === 'PENDIENTE_APROBACION') {
                motivoBloqueoAprobacion = mensajeBloqueoImporte;
            } else if (row.estado !== 'PENDIENTE_APROBACION') {
                motivoBloqueoAprobacion = `La solicitud está en estado ${row.estado}; no admite aprobación.`;
            } else if (!['ANULAR_AMBOS', 'EMITIR_NOTA_CREDITO', 'RECTIFICAR_CERTIFICADO'].includes(row.tipo_operacion)) {
                motivoBloqueoAprobacion = 'El tipo de solicitud se conserva únicamente como historial.';
            } else if (!permisos.has(PERMISOS_SOLICITUD.APROBAR)) {
                motivoBloqueoAprobacion = `Falta el permiso ${PERMISOS_SOLICITUD.APROBAR}.`;
            } else if (!permisos.has(PERMISOS_SOLICITUD.AUTOAPROBAR)) {
                motivoBloqueoAprobacion = `La autoaprobación exige el permiso ${PERMISOS_SOLICITUD.AUTOAPROBAR}.`;
            } else if (esAutorizacionNota && esAutoaprobacion
                && !permisos.has(PERMISOS_SOLICITUD.AUTOEJECUTAR)) {
                motivoBloqueoAprobacion = `Emitir con una autorización propia exige el permiso ${PERMISOS_SOLICITUD.AUTOEJECUTAR}.`;
            }
        } else if (!esAutorizacionNota && !esRectificacion && !puedeAprobarYEjecutar) {
            motivoBloqueoAprobacion = !permisos.has(PERMISOS_SOLICITUD.EJECUTAR_ANULACION_CERTIFICADO)
                ? `Falta el permiso ${PERMISOS_SOLICITUD.EJECUTAR_ANULACION_CERTIFICADO} para ejecutar la anulación total.`
                : `La autoejecución exige el permiso ${PERMISOS_SOLICITUD.AUTOEJECUTAR}.`;
        }

        return {
            ...solicitud,
            importeFinal: importeFinalSolicitud.determinable ? importeFinalSolicitud.importeFinal : null,
            monedaImporteFinal: importeFinalSolicitud.moneda || null,
            anulacionImporteCero: importeFinalSolicitud.determinable === true && importeFinalSolicitud.esCero === true,
            anulacionImporteNoDeterminable: importeFinalSolicitud.determinable !== true,
            autorizacionAutoejecucion: row.autorizacion_autoejecucion === true,
            detalle: {
                estadoAdministrativo: row.estado,
                bloqueoImporte: bloqueoImporte ? {
                    codigo: importeFinalSolicitud.determinable !== true
                        ? 'CERTIFICADO_IMPORTE_FINAL_NO_DETERMINABLE'
                        : 'CERTIFICADO_IMPORTE_CERO_NO_ANULABLE',
                    motivo: mensajeBloqueoImporte,
                    importeFinal: importeFinalSolicitud.determinable ? importeFinalSolicitud.importeFinal : null
                } : null,
                estadoFiscalActual,
                resolucionFiscal,
                estadoTecnico: row.resultado_tecnico || null,
                puedeAprobar: puedeAprobarSolicitud,
                puedeAprobarYEjecutar,
                esAutoaprobacion,
                motivoBloqueoAprobacion,
                ejecucion: {
                    puedeEjecutar,
                    esAutoejecucion: esPropia,
                    permisosFaltantes,
                    autoejecucionAutorizada: row.autorizacion_autoejecucion === true,
                    motivoBloqueo,
                    requiereSincronizacionFiscal: !esRectificacion && (
                        estadoFiscalActual?.pendienteSunat === true
                        || resolucionFiscal?.resultado === RESULTADOS_RESOLUCION_FISCAL.PENDIENTE_VERIFICACION
                    )
                }
            }
        };
    };

    const crearAnulacionTotal = async (entrada, userContext) => {
        const tipo = String(entrada?.tipoOperacion || '').trim().toUpperCase();
        if (tipo !== 'ANULAR_AMBOS') throw errorNegocio('TIPO_SOLICITUD_NO_DISPONIBLE', 400);
        if (entrada?.datosPropuestos !== undefined && entrada?.datosPropuestos !== null) {
            throw errorNegocio('DATOS_PROPUESTOS_NO_PERMITIDOS', 400);
        }
        return crear({ ...entrada, tipoOperacion: 'ANULAR_AMBOS', datosPropuestos: undefined }, userContext, {
            flujoAnulacionTotal: true
        });
    };

    const crearAutorizacionNotaCredito = async (entrada, userContext) => {
        const tipo = String(entrada?.tipoOperacion || '').trim().toUpperCase();
        if (tipo !== 'EMITIR_NOTA_CREDITO') throw errorNegocio('TIPO_SOLICITUD_NO_DISPONIBLE', 400);
        const motivoCodigo = normalizarMotivoNotaCredito(entrada?.datosPropuestos?.motivoCodigo);
        if (!motivoCodigo || !requiereSolicitudNotaCredito(motivoCodigo)) {
            throw errorNegocio('MOTIVO_NOTA_CREDITO_AUTORIZACION_INVALIDO', 400);
        }

        // Para motivo 03, exigir itemIndice y descripcionCorregida
        let datosPropuestos = { motivoCodigo };
        if (motivoCodigo === '03') {
            const itemIndice = entrada?.datosPropuestos?.itemIndice;
            const descripcionCorregida = String(entrada?.datosPropuestos?.descripcionCorregida || '').trim();
            if (itemIndice === undefined || itemIndice === null || isNaN(Number(itemIndice))) {
                throw errorNegocio('ITEM_INDICE_REQUERIDO', 400, {
                    message: 'El índice de la línea a corregir es obligatorio para el motivo 03.'
                });
            }
            if (!descripcionCorregida || descripcionCorregida.length < 5) {
                throw errorNegocio('DESCRIPCION_CORREGIDA_REQUERIDA', 400, {
                    message: 'La descripción corregida debe tener al menos 5 caracteres.'
                });
            }
            datosPropuestos = {
                motivoCodigo,
                itemIndice: Number(itemIndice),
                descripcionCorregida
            };
        }

        return crear({
            ...entrada,
            tipoOperacion: 'EMITIR_NOTA_CREDITO',
            datosPropuestos
        }, userContext);
    };

    const decidir = async (id, accion, entrada, userContext) => {
        let plantaKeyEmitir = null;
        let empresaKeyEmitir = null;
        let trabajoNotaCreado = false;
        const resultado = await conTransaccion(async (client) => {
        const transicion = TRANSICIONES_ADMINISTRATIVAS[accion];
        if (!transicion || accion === 'CANCELAR') throw errorNegocio('TRANSICION_SOLICITUD_INVALIDA');
        const { row, alcance } = await obtener(id, userContext, client, true, PERMISOS_SOLICITUD.VER);
        plantaKeyEmitir = row.planta_key;
        empresaKeyEmitir = row.empresa_key;
        if (!['ANULAR_AMBOS', 'EMITIR_NOTA_CREDITO', 'RECTIFICAR_CERTIFICADO'].includes(row.tipo_operacion)) {
            throw errorNegocio('SOLICITUD_TIPO_HISTORICO_SOLO_LECTURA', 409);
        }
        const permisoEspecifico = accion === 'APROBAR'
            ? (row.tipo_operacion === 'EMITIR_NOTA_CREDITO'
                ? PERMISOS_SOLICITUD.NOTA_CREDITO_APROBAR
                : PERMISOS_SOLICITUD.APROBAR)
            : (row.tipo_operacion === 'EMITIR_NOTA_CREDITO'
                ? PERMISOS_SOLICITUD.NOTA_CREDITO_APROBAR
                : PERMISOS_SOLICITUD.RECHAZAR);
        exigirPermiso(alcance.permisos, permisoEspecifico);
        if (row.estado !== transicion.desde) throw errorNegocio('SOLICITUD_NO_DECIDIBLE', 409, { estado: row.estado });
        const esAutoaprobacion = accion === 'APROBAR'
            && row.usuario_solicitante === alcance.usuario.username;
        const esAutoaprobacionNota = esAutoaprobacion
            && row.tipo_operacion === 'EMITIR_NOTA_CREDITO';
        if (row.usuario_solicitante === alcance.usuario.username && !esAutoaprobacion) {
            throw errorNegocio('SOLICITUD_AUTODECISION_PROHIBIDA', 403);
        }
        if (esAutoaprobacion) {
            if (esAutoaprobacionNota) {
                if (!alcance.permisos.has(PERMISOS_SOLICITUD.NOTA_CREDITO_APROBAR)
                    || !alcance.permisos.has(PERMISOS_SOLICITUD.NOTA_CREDITO_AUTOAPROBAR)) {
                    throw errorNegocio('SOLICITUD_AUTOAPROBACION_NO_AUTORIZADA', 403);
                }
                if (entrada?.confirmarAutoaprobacion !== true) {
                    throw errorNegocio('SOLICITUD_AUTOAPROBACION_CONFIRMACION_REQUERIDA', 400);
                }
            } else {
                if (!alcance.permisos.has(PERMISOS_SOLICITUD.APROBAR)
                    || !alcance.permisos.has(PERMISOS_SOLICITUD.AUTOAPROBAR)) {
                    throw errorNegocio('SOLICITUD_AUTOAPROBACION_NO_AUTORIZADA', 403);
                }
                if (entrada?.confirmarAutoaprobacion !== true) {
                    throw errorNegocio('SOLICITUD_AUTOAPROBACION_CONFIRMACION_REQUERIDA', 400);
                }
            }
        }
        const justificacion = texto(
            entrada?.justificacion,
            1000,
            accion === 'RECHAZAR' || esAutoaprobacion
        );
        const version = enteroPositivo(entrada?.version, 'VERSION_SOLICITUD_INVALIDA');
        if (version !== Number(row.version)) throw errorNegocio('SOLICITUD_VERSION_DESACTUALIZADA', 409);
        if (accion === 'APROBAR' && row.tipo_operacion === 'ANULAR_AMBOS') {
            exigirAnulacionPermitidaPorImporte(
                evaluarImporteFinalCertificado(row),
                { certificadoId: row.certificado_id, operacion: 'APROBAR_ANULACION_TOTAL' }
            );
        }
        const actualizada = await client.query(`
            UPDATE fg_solicitud_operacion
            SET estado = $1, usuario_decision = $2, fecha_decision = CURRENT_TIMESTAMP,
                justificacion_decision = $3, version = version + 1,
                autorizacion_autoejecucion = CASE WHEN $6 THEN TRUE ELSE autorizacion_autoejecucion END,
                fecha_modificacion = CURRENT_TIMESTAMP
            WHERE id = $4 AND estado = 'PENDIENTE_APROBACION' AND version = $5
            RETURNING *
        `, [transicion.hacia, alcance.usuario.username, justificacion, row.id, version, esAutoaprobacionNota]);
        if (actualizada.rowCount === 0) throw errorNegocio('SOLICITUD_DECISION_CONCURRENTE', 409);
        await registrarEvento(client, {
            solicitudId: row.id,
            tipoEvento: accion === 'APROBAR' ? 'SOLICITUD_APROBADA' : 'SOLICITUD_RECHAZADA',
            estadoAnterior: row.estado,
            estadoPosterior: transicion.hacia,
            username: alcance.usuario.username,
            comentario: justificacion,
            metadatos: {
                versionAnterior: version,
                pendienteEjecucion: accion === 'APROBAR',
                autoaprobacion: esAutoaprobacion,
                autoejecucionNotaAutorizada: esAutoaprobacionNota
            }
        });

        if (accion === 'APROBAR' && row.tipo_operacion === 'EMITIR_NOTA_CREDITO') {
            try {
                const trabajo = await workerNotasCredito.encolarAprobacion(
                    client,
                    actualizada.rows[0],
                    alcance.usuario.username
                );
                trabajoNotaCreado = trabajo?.creada === true;
            } catch (encoladoError) {
                // No fallar la aprobación por un error en la cola fiscal.
                // El trabajo puede crearse posteriormente mediante el worker de recuperación.
                console.error('[FAREGAS] Error al encolar trabajo fiscal:', encoladoError?.message || encoladoError);
            }
        }

        // Notificar al usuario solicitante de la decisión (aprobación o rechazo).
        try {
            const tipoEvento = accion === 'APROBAR' ? 'SOLICITUD_APROBADA' : 'SOLICITUD_RECHAZADA';
            await notificacionesService.crearParaSolicitante(client, row, tipoEvento,
                accion === 'APROBAR' ? 'Solicitud aprobada' : 'Solicitud rechazada',
                accion === 'APROBAR'
                    ? `Solicitado por: ${row.usuario_solicitante} | Autorizado por: ${alcance.usuario.username} | Operación: ${row.tipo_operacion} | Certificado: ${row.numero_certificado || 'N/A'} | Solicitud: #${row.id} | Fecha de aprobación: ${new Date().toISOString()}`
                    : `Solicitado por: ${row.usuario_solicitante} | Rechazado por: ${alcance.usuario.username} | Operación: ${row.tipo_operacion} | Certificado: ${row.numero_certificado || 'N/A'} | Solicitud: #${row.id} | Fecha de rechazo: ${new Date().toISOString()}${justificacion ? ` | Motivo: ${justificacion}` : ''}`,
                alcance.usuario.username);
        } catch (_notificacionError) {
            // No fallar la decisión por un error en notificaciones.
        }

        return mapearSolicitud(actualizada.rows[0]);
        });
        if (plantaKeyEmitir) {
            notificacionesService.emitirNotificacionActualizada(plantaKeyEmitir, empresaKeyEmitir);
        }
        if (trabajoNotaCreado) workerNotasCredito.despertar();
        return resultado;
    };

    const cancelar = async (id, entrada, userContext) => conTransaccion(async (client) => {
        const { row, alcance } = await obtener(id, userContext, client, true);
        if (!['ANULAR_AMBOS', 'EMITIR_NOTA_CREDITO', 'RECTIFICAR_CERTIFICADO'].includes(row.tipo_operacion)) {
            throw errorNegocio('SOLICITUD_TIPO_HISTORICO_SOLO_LECTURA', 409);
        }
        if (row.estado !== 'PENDIENTE_APROBACION') throw errorNegocio('SOLICITUD_NO_CANCELABLE', 409, { estado: row.estado });
        const esPropia = row.usuario_solicitante === alcance.usuario.username;
        if (!esPropia && !alcance.permisos.has(PERMISOS_SOLICITUD.ADMINISTRAR)) {
            throw errorNegocio('SOLICITUD_PERMISO_DENEGADO', 403);
        }
        const version = enteroPositivo(entrada?.version, 'VERSION_SOLICITUD_INVALIDA');
        if (version !== Number(row.version)) throw errorNegocio('SOLICITUD_VERSION_DESACTUALIZADA', 409);
        const comentario = texto(entrada?.comentario, 1000, true);
        const actualizada = await client.query(`
            UPDATE fg_solicitud_operacion
            SET estado = 'CANCELADA', usuario_decision = $1, fecha_decision = CURRENT_TIMESTAMP,
                justificacion_decision = $2, version = version + 1,
                fecha_modificacion = CURRENT_TIMESTAMP
            WHERE id = $3 AND estado = 'PENDIENTE_APROBACION' AND version = $4
            RETURNING *
        `, [alcance.usuario.username, comentario, row.id, version]);
        if (actualizada.rowCount === 0) throw errorNegocio('SOLICITUD_DECISION_CONCURRENTE', 409);
        await registrarEvento(client, {
            solicitudId: row.id,
            tipoEvento: 'SOLICITUD_CANCELADA',
            estadoAnterior: row.estado,
            estadoPosterior: 'CANCELADA',
            username: alcance.usuario.username,
            comentario,
            metadatos: { versionAnterior: version }
        });
        return mapearSolicitud(actualizada.rows[0]);
    });

    const historial = async (id, userContext) => {
        const { row } = await obtener(
            id,
            userContext,
            database,
            false,
            [
                PERMISOS_SOLICITUD.VER,
                PERMISOS_SOLICITUD.APROBAR,
                PERMISOS_SOLICITUD.RECHAZAR
            ]
        );
        const result = await database.query(`
            SELECT id, solicitud_id, tipo_evento, estado_anterior, estado_posterior,
                   usuario_responsable, fecha_evento, comentario, metadatos
            FROM fg_solicitud_operacion_evento
            WHERE solicitud_id = $1
            ORDER BY fecha_evento ASC, id ASC
        `, [row.id]);
        return result.rows.map((evento) => ({
            id: Number(evento.id), solicitudId: Number(evento.solicitud_id),
            tipoEvento: evento.tipo_evento, estadoAnterior: evento.estado_anterior,
            estadoPosterior: evento.estado_posterior, usuarioResponsable: evento.usuario_responsable,
            fechaEvento: evento.fecha_evento, comentario: evento.comentario, metadatos: evento.metadatos
        }));
    };

    const esTipoPermitidoParaAnulacionLocal = (tipoCertificado) => {
        // Deshabilitado por defecto para todos los tipos sin presunciones.
        // Solo se activa mediante configuración explícita o variable de entorno de habilitación real comprobada.
        if (config?.habilitarAnulacionTecnica === true) {
            if (config?.permitirTodosLosTiposLocal === true) return true;
            if (Array.isArray(config?.tiposPermitidosLocal) && config.tiposPermitidosLocal.includes(tipoCertificado)) {
                return true;
            }
        }
        if (process.env.FAREGAS_HABILITAR_ANULACION_TECNICA === 'true') {
            if (process.env.FAREGAS_PERMITIR_ANULACION_LOCAL_TODOS === 'true') return true;
            const tiposEnv = process.env.FAREGAS_TIPOS_ANULACION_LOCAL
                ? process.env.FAREGAS_TIPOS_ANULACION_LOCAL.split(',').map((s) => s.trim())
                : [];
            if (tiposEnv.includes(tipoCertificado)) return true;
        }
        return false;
    };

    const ejecutarAnulacionCertificado = async (id, entrada, userContext) => conTransaccion(async (client) => {
        const solicitudId = enteroPositivo(id, 'SOLICITUD_ID_INVALIDO');
        const usuario = await obtenerUsuarioActual(client, userContext);
        const permisos = await obtenerPermisos(client, usuario.perfil_id);
        if (!permisos.has(PERMISOS_SOLICITUD.EJECUTAR_ANULACION_CERTIFICADO)
            && !permisos.has(PERMISOS_SOLICITUD.ADMINISTRAR)) {
            throw errorNegocio('SOLICITUD_PERMISO_DENEGADO', 403, { permiso: PERMISOS_SOLICITUD.EJECUTAR_ANULACION_CERTIFICADO });
        }

        // Bloqueo de fila sobre la solicitud
        const solResult = await client.query(`${SELECT_SOLICITUD} WHERE s.id = $1 FOR UPDATE OF s`, [solicitudId]);
        if (solResult.rowCount === 0) throw errorNegocio('SOLICITUD_NO_ENCONTRADA', 404);
        const row = solResult.rows[0];

        // Validación de sede del ejecutor
        await validarAccesoPlanta(client, usuario, row.planta_key, row.empresa_key);

        // Separación de funciones: el solicitante no puede ser el ejecutor
        if (row.usuario_solicitante === usuario.username) {
            throw errorNegocio('SOLICITUD_AUTODECISION_PROHIBIDA', 403);
        }

        // Tipo de operación permitido
        if (row.tipo_operacion !== 'ANULAR_CERTIFICADO') {
            throw errorNegocio('TIPO_OPERACION_INVALIDO_PARA_EJECUCION', 409, { tipo: row.tipo_operacion });
        }

        // Idempotencia: si ya está COMPLETADA, retornar el resultado consolidado
        if (row.estado === 'COMPLETADA') {
            const certActual = await client.query('SELECT id, numero_certificado, estado FROM fg_certificado WHERE id = $1', [row.certificado_id]);
            return {
                solicitud: mapearSolicitud(row),
                certificado: {
                    id: Number(row.certificado_id),
                    numero: certActual.rows[0]?.numero_certificado || null,
                    estado: certActual.rows[0]?.estado || 'ANULADO'
                },
                yaCompletada: true
            };
        }

        if (row.estado === 'PENDIENTE_APROBACION') throw errorNegocio('SOLICITUD_NO_APROBADA', 409);
        if (row.estado === 'RECHAZADA') throw errorNegocio('SOLICITUD_RECHAZADA', 409);
        if (row.estado === 'CANCELADA') throw errorNegocio('SOLICITUD_CANCELADA', 409);
        if (row.estado !== 'APROBADA' && row.estado !== 'REQUIERE_INTERVENCION') {
            throw errorNegocio('SOLICITUD_ESTADO_INVALIDO', 409, { estado: row.estado });
        }

        // Versión esperada (concurrencia optimista)
        const versionEsperada = enteroPositivo(entrada?.version, 'VERSION_SOLICITUD_INVALIDA');
        if (versionEsperada !== Number(row.version)) {
            throw errorNegocio('SOLICITUD_VERSION_DESACTUALIZADA', 409);
        }

        // Bloqueo y verificación del certificado
        const certResult = await client.query(`
            SELECT c.*, p.empresa_key
            FROM fg_certificado c
            JOIN fg_planta p ON p.key = c.planta_key
            WHERE c.id = $1
            FOR UPDATE OF c
        `, [row.certificado_id]);
        if (certResult.rowCount === 0) throw errorNegocio('CERTIFICADO_NO_ENCONTRADO', 404);
        const cert = certResult.rows[0];

        // Sede y empresa autorizadas
        if (cert.planta_key !== row.planta_key) throw errorNegocio('SOLICITUD_SEDE_NO_AUTORIZADA', 403);
        if (cert.empresa_key !== row.empresa_key) throw errorNegocio('SOLICITUD_EMPRESA_NO_AUTORIZADA', 403);

        // Estado técnico del certificado
        if (cert.estado === 'ANULADO') throw errorNegocio('CERTIFICADO_YA_ANULADO', 409);
        if (cert.estado !== 'EMITIDO') throw errorNegocio('CERTIFICADO_NO_EMITIDO', 409, { estadoActual: cert.estado });
        if (!cert.numero_certificado) throw errorNegocio('CERTIFICADO_SIN_NUMERO_DG', 409);

        exigirAnulacionPermitidaPorImporte(
            evaluarImporteFinalCertificado({
                ...row,
                precio_certificado: row.precio_certificado ?? cert.precio_certificado,
                precio_chip: row.precio_chip ?? cert.precio_chip,
                producto_chip_id: row.producto_chip_id ?? cert.producto_chip_id
            }),
            { certificadoId: cert.id, operacion: 'ANULACION_TECNICA' }
        );

        // Verificación de integración / procedimiento externo
        if (!esTipoPermitidoParaAnulacionLocal(cert.tipo_certificado_clave)) {
            // El certificado permanece con estado = 'EMITIDO' intacto.
            // La solicitud NO se marca como COMPLETADA.
            // Pasa a REQUIERE_INTERVENCION (o se conserva si ya estaba allí),
            // permitiendo que el procedimiento pueda continuarse posteriormente cuando se autorice.
            const versionSiguiente = Number(row.version) + (row.estado !== 'REQUIERE_INTERVENCION' ? 1 : 0);
            await client.query(`
                UPDATE fg_solicitud_operacion
                SET estado = 'REQUIERE_INTERVENCION',
                    version = $1,
                    fecha_modificacion = CURRENT_TIMESTAMP
                WHERE id = $2
            `, [versionSiguiente, row.id]);

            await registrarEvento(client, {
                solicitudId: row.id,
                tipoEvento: 'ANULACION_REQUIERE_VALIDACION_EXTERNA',
                estadoAnterior: row.estado,
                estadoPosterior: 'REQUIERE_INTERVENCION',
                username: usuario.username,
                comentario: 'Ejecución técnica no habilitada por defecto: el tipo de certificado no cuenta con regla explícita ni integración externa verificada.',
                metadatos: {
                    tipoCertificado: cert.tipo_certificado_clave,
                    numeroCertificado: cert.numero_certificado,
                    estadoCertificado: cert.estado
                }
            });

            await client.query('COMMIT');

            const err = errorNegocio('ANULACION_REQUIERE_VALIDACION_EXTERNA', 409, {
                tipoCertificado: cert.tipo_certificado_clave,
                numeroCertificado: cert.numero_certificado,
                estadoCertificado: cert.estado
            });
            err.transaccionYaComprometida = true;
            throw err;
        }

        // 1. Transición controlada a EN_EJECUCION
        await client.query(`
            UPDATE fg_solicitud_operacion
            SET estado = 'EN_EJECUCION',
                fecha_modificacion = CURRENT_TIMESTAMP
            WHERE id = $1
        `, [row.id]);

        await registrarEvento(client, {
            solicitudId: row.id,
            tipoEvento: 'EJECUCION_INICIADA',
            estadoAnterior: row.estado,
            estadoPosterior: 'EN_EJECUCION',
            username: usuario.username,
            comentario: 'Inicio de ejecución técnica de anulación.',
            metadatos: { versionEsperada }
        });

        // 2. Modificación técnica sobre el certificado emitido
        const justificacion = texto(entrada?.justificacion, 1000) || row.motivo;
        const fechaAnulacionIso = new Date().toISOString();

        await certificadosService.anularCertificadoEmitido({
            client,
            certificadoId: cert.id,
            justificacion,
            solicitudId: row.id,
            usuario: usuario.username
        });

        const resultadoTecnico = {
            certificadoId: Number(cert.id),
            numeroCertificado: cert.numero_certificado,
            tipoCertificado: cert.tipo_certificado_clave,
            estadoAnterior: cert.estado,
            estadoPosterior: 'ANULADO',
            fechaAnulacion: fechaAnulacionIso,
            usuarioEjecutor: usuario.username,
            justificacion
        };

        // 3. Transición final a COMPLETADA
        const actualizada = await client.query(`
            UPDATE fg_solicitud_operacion
            SET estado = 'COMPLETADA',
                resultado_tecnico = $1::jsonb,
                version = version + 1,
                fecha_modificacion = CURRENT_TIMESTAMP
            WHERE id = $2 AND estado = 'EN_EJECUCION'
            RETURNING *
        `, [JSON.stringify(resultadoTecnico), row.id]);

        if (actualizada.rowCount === 0) {
            throw errorNegocio('SOLICITUD_DECISION_CONCURRENTE', 409);
        }

        await registrarEvento(client, {
            solicitudId: row.id,
            tipoEvento: 'CERTIFICADO_ANULADO_TECNICAMENTE',
            estadoAnterior: 'EN_EJECUCION',
            estadoPosterior: 'COMPLETADA',
            username: usuario.username,
            comentario: justificacion,
            metadatos: resultadoTecnico
        });

        return {
            solicitud: mapearSolicitud(actualizada.rows[0]),
            certificado: {
                id: Number(cert.id),
                numero: cert.numero_certificado,
                estado: 'ANULADO'
            },
            yaCompletada: false
        };
    });

    const esAplicacionOficialRectificacionHabilitada = () => {
        if (config?.habilitarAplicacionOficial === true) return true;
        if (process.env.FAREGAS_HABILITAR_RECTIFICACION_OFICIAL === 'true') return true;
        return false;
    };

    const ejecutarRectificacionCertificado = async (id, entrada, userContext) => conTransaccion(async (client) => {
        const solicitudId = enteroPositivo(id, 'SOLICITUD_ID_INVALIDO');
        const usuario = await obtenerUsuarioActual(client, userContext);
        const permisos = await obtenerPermisos(client, usuario.perfil_id);
        if (!permisos.has(PERMISOS_SOLICITUD.EJECUTAR_RECTIFICACION_CERTIFICADO)
            && !permisos.has(PERMISOS_SOLICITUD.ADMINISTRAR)) {
            throw errorNegocio('SOLICITUD_PERMISO_DENEGADO', 403, { permiso: PERMISOS_SOLICITUD.EJECUTAR_RECTIFICACION_CERTIFICADO });
        }

        // Bloqueo de fila sobre la solicitud
        const solResult = await client.query(`${SELECT_SOLICITUD} WHERE s.id = $1 FOR UPDATE OF s`, [solicitudId]);
        if (solResult.rowCount === 0) throw errorNegocio('SOLICITUD_NO_ENCONTRADA', 404);
        const row = solResult.rows[0];

        // Validación de sede del ejecutor
        await validarAccesoPlanta(client, usuario, row.planta_key, row.empresa_key);

        // Separación de funciones
        if (row.usuario_solicitante === usuario.username) {
            throw errorNegocio('SOLICITUD_AUTODECISION_PROHIBIDA', 403);
        }

        if (row.tipo_operacion !== 'RECTIFICAR_CERTIFICADO') {
            throw errorNegocio('TIPO_OPERACION_INVALIDO_PARA_EJECUCION', 409, { tipo: row.tipo_operacion });
        }

        // Idempotencia
        if (row.estado === 'COMPLETADA') {
            const certActual = await client.query('SELECT id, numero_certificado, estado, fecha_emision FROM fg_certificado WHERE id = $1', [row.certificado_id]);
            const verActual = await client.query(
                `SELECT * FROM fg_certificado_version WHERE solicitud_id = $1 ORDER BY numero_version DESC LIMIT 1`,
                [row.id]
            );
            return {
                solicitud: mapearSolicitud(row),
                certificado: {
                    id: Number(row.certificado_id),
                    numero: certActual.rows[0]?.numero_certificado || null,
                    estado: certActual.rows[0]?.estado || 'EMITIDO',
                    fechaEmision: certActual.rows[0]?.fecha_emision || null
                },
                version: verActual.rows[0] || null,
                yaCompletada: true,
                oficialAplicado: true
            };
        }

        if (row.estado === 'PENDIENTE_APROBACION') throw errorNegocio('SOLICITUD_NO_APROBADA', 409);
        if (row.estado === 'RECHAZADA') throw errorNegocio('SOLICITUD_RECHAZADA', 409);
        if (row.estado === 'CANCELADA') throw errorNegocio('SOLICITUD_CANCELADA', 409);
        if (row.estado !== 'APROBADA' && row.estado !== 'REQUIERE_INTERVENCION') {
            throw errorNegocio('SOLICITUD_ESTADO_INVALIDO', 409, { estado: row.estado });
        }

        const versionEsperada = enteroPositivo(entrada?.version, 'VERSION_SOLICITUD_INVALIDA');
        if (versionEsperada !== Number(row.version)) {
            throw errorNegocio('SOLICITUD_VERSION_DESACTUALIZADA', 409);
        }

        // Bloqueo y verificación del certificado
        const certResult = await client.query(`
            SELECT c.*, p.empresa_key
            FROM fg_certificado c
            JOIN fg_planta p ON p.key = c.planta_key
            WHERE c.id = $1
            FOR UPDATE OF c
        `, [row.certificado_id]);
        if (certResult.rowCount === 0) throw errorNegocio('CERTIFICADO_NO_ENCONTRADO', 404);
        const cert = certResult.rows[0];

        if (cert.planta_key !== row.planta_key) throw errorNegocio('SOLICITUD_SEDE_NO_AUTORIZADA', 403);
        if (cert.empresa_key !== row.empresa_key) throw errorNegocio('SOLICITUD_EMPRESA_NO_AUTORIZADA', 403);
        if (cert.estado !== 'EMITIDO') throw errorNegocio('CERTIFICADO_NO_EMITIDO', 409, { estadoActual: cert.estado });
        if (!cert.numero_certificado) throw errorNegocio('CERTIFICADO_SIN_NUMERO_DG', 409);

        // Snapshot actual completo
        const snapshotActual = await certificadosService.obtenerSnapshotCompletoCertificado({ client, certificadoId: cert.id });

        // Detección de drift con respecto al momento de creación
        const origSolicitud = row.datos_originales_certificado;
        if (origSolicitud && origSolicitud.placa && snapshotActual.vehiculo?.placa) {
            if (origSolicitud.placa !== snapshotActual.vehiculo.placa) {
                throw errorNegocio('DOCUMENTO_ORIGINAL_MODIFICADO', 409, {
                    mensaje: 'El documento original cambió después de creada la solicitud. Se requiere nueva revisión.'
                });
            }
        }

        // Calcular diferencias reales
        const diferencias = calcularDiferencias(snapshotActual, row.datos_propuestos);
        if (diferencias.length === 0) {
            throw errorNegocio('PROPUESTA_SIN_DIFERENCIAS', 400, {
                mensaje: 'Los datos propuestos no presentan diferencias con el certificado original.'
            });
        }

        // Nivel 1 — Transición a EN_EJECUCION
        await client.query(`
            UPDATE fg_solicitud_operacion
            SET estado = 'EN_EJECUCION',
                fecha_modificacion = CURRENT_TIMESTAMP
            WHERE id = $1
        `, [row.id]);

        await registrarEvento(client, {
            solicitudId: row.id,
            tipoEvento: 'EJECUCION_RECTIFICACION_INICIADA',
            estadoAnterior: row.estado,
            estadoPosterior: 'EN_EJECUCION',
            username: usuario.username,
            comentario: 'Inicio de preparación de rectificación técnica.',
            metadatos: { versionEsperada, totalDiferencias: diferencias.length }
        });

        const motivo = texto(entrada?.justificacion, 1000) || row.motivo;

        // Crear versión PREPARADA en fg_certificado_version
        const versionCreada = await certificadosService.prepararVersionRectificada({
            client,
            certificadoId: cert.id,
            solicitudId: row.id,
            usuario: usuario.username,
            aprobador: row.usuario_decision,
            motivo,
            datosPropuestos: row.datos_propuestos,
            diferencias,
            metadatos: {
                tipoCertificado: cert.tipo_certificado_clave,
                numeroCertificado: cert.numero_certificado,
                versionSolicitud: versionEsperada
            }
        });

        const esOficialHabilitada = esAplicacionOficialRectificacionHabilitada();

        if (!esOficialHabilitada) {
            // Nivel 2 deshabilitado por defecto: versión queda PREPARADA, certificado permanece intacto.
            // Solicitud pasa a REQUIERE_INTERVENCION informando detención controlada.
            const resultadoTecnico = {
                nivel: 'PREPARACION_INTERNA',
                versionId: Number(versionCreada.id),
                numeroVersion: versionCreada.numero_version,
                estadoVersion: 'PREPARADA',
                fechaVersion: versionCreada.fecha_version,
                fechaEmisionOriginal: cert.fecha_emision,
                diferencias,
                oficialAplicado: false,
                mensaje: 'Versión técnica preparada internamente. Aplicación oficial en vivo deshabilitada por defecto hasta autorización normativa.'
            };

            const versionSiguiente = Number(row.version) + (row.estado !== 'REQUIERE_INTERVENCION' ? 1 : 0);
            const actReq = await client.query(`
                UPDATE fg_solicitud_operacion
                SET estado = 'REQUIERE_INTERVENCION',
                    resultado_tecnico = $1::jsonb,
                    version = $2,
                    fecha_modificacion = CURRENT_TIMESTAMP
                WHERE id = $3
                RETURNING *
            `, [JSON.stringify(resultadoTecnico), versionSiguiente, row.id]);

            await registrarEvento(client, {
                solicitudId: row.id,
                tipoEvento: 'VERSION_RECTIFICACION_PREPARADA',
                estadoAnterior: 'EN_EJECUCION',
                estadoPosterior: 'REQUIERE_INTERVENCION',
                username: usuario.username,
                comentario: 'Versión de rectificación preparada internamente. Aplicación oficial pendiente de confirmación normativa.',
                metadatos: resultadoTecnico
            });

            return {
                solicitud: mapearSolicitud(actReq.rows[0]),
                certificado: {
                    id: Number(cert.id),
                    numero: cert.numero_certificado,
                    estado: cert.estado,
                    fechaEmision: cert.fecha_emision
                },
                version: versionCreada,
                oficialAplicado: false,
                requiereIntervencion: true,
                yaCompletada: false
            };
        }

        // Nivel 2 autorizado: promover versión a VIGENTE y actualizar campos técnicos
        const versionOficial = await certificadosService.aplicarVersionRectificadaOficial({
            client,
            certificadoId: cert.id,
            versionId: versionCreada.id,
            usuario: usuario.username
        });

        const resultadoTecnicoOficial = {
            nivel: 'APLICACION_OFICIAL',
            versionId: Number(versionOficial.id),
            numeroVersion: versionOficial.numero_version,
            estadoVersion: 'VIGENTE',
            fechaVersion: versionOficial.fecha_version,
            fechaAplicacionOficial: versionOficial.fecha_aplicacion_oficial,
            fechaEmisionOriginal: cert.fecha_emision,
            diferencias,
            oficialAplicado: true
        };

        const actComp = await client.query(`
            UPDATE fg_solicitud_operacion
            SET estado = 'COMPLETADA',
                resultado_tecnico = $1::jsonb,
                version = version + 1,
                fecha_modificacion = CURRENT_TIMESTAMP
            WHERE id = $2 AND estado = 'EN_EJECUCION'
            RETURNING *
        `, [JSON.stringify(resultadoTecnicoOficial), row.id]);

        await registrarEvento(client, {
            solicitudId: row.id,
            tipoEvento: 'CERTIFICADO_RECTIFICADO_OFICIALMENTE',
            estadoAnterior: 'EN_EJECUCION',
            estadoPosterior: 'COMPLETADA',
            username: usuario.username,
            comentario: motivo,
            metadatos: resultadoTecnicoOficial
        });

        return {
            solicitud: mapearSolicitud(actComp.rows[0]),
            certificado: {
                id: Number(cert.id),
                numero: cert.numero_certificado,
                estado: cert.estado,
                fechaEmision: cert.fecha_emision
            },
            version: versionOficial,
            oficialAplicado: true,
            yaCompletada: false
        };
    });

    /**
     * Consulta la evidencia de plazo disponible en los intentos de emisión y
     * delega la decisión tributaria al resolvedor central. La consulta usa el
     * reloj de PostgreSQL y no renueva el plazo con reintentos.
     */
    const resolverFiscalFacturacion = async (documento, opciones = {}) => {
        let plazoBaja = null;
        if (documento?.id) {
            try {
                const plazo = await database.query(`
                    SELECT MIN(fecha_creacion) AS fecha_emision,
                           MAX(CASE WHEN estado = 'ACEPTADO'
                               THEN COALESCE(fecha_finalizacion, fecha_creacion) END) AS fecha_aceptacion,
                           clock_timestamp() >= COALESCE(
                               MAX(CASE WHEN estado = 'ACEPTADO'
                                   THEN COALESCE(fecha_finalizacion, fecha_creacion) END),
                               MIN(fecha_creacion))
                           AND clock_timestamp() < COALESCE(
                               MAX(CASE WHEN estado = 'ACEPTADO'
                                   THEN COALESCE(fecha_finalizacion, fecha_creacion) END),
                               MIN(fecha_creacion)) + INTERVAL '7 days' AS dentro_plazo_baja
                    FROM fg_facturacion_intento
                    WHERE facturacion_id = $1
                `, [documento.id]);
                const fila = plazo.rows?.[0];
                if (documento.fecha_aceptacion) {
                    // La fecha de aceptación persistida es la evidencia más
                    // fuerte del CDR; el resolvedor calcula el vencimiento.
                    plazoBaja = {
                        fechaBase: documento.fecha_aceptacion,
                        fuente: 'CDR'
                    };
                } else if (fila?.fecha_emision) {
                    plazoBaja = {
                        dentro: fila.dentro_plazo_baja === true,
                        fechaBase: fila.fecha_aceptacion || fila.fecha_emision,
                        fuente: fila.fecha_aceptacion ? 'CDR' : 'EMISION'
                    };
                }
            } catch (_) {
                // Sin evidencia de intentos se resuelve con las fechas del
                // documento; el resolvedor devolverá verificación si no basta.
            }
        }
        return resolverOperacionFiscal({
            documento,
            estadoProveedor: documento?.estado,
            fechaEmision: documento?.fecha_documento || documento?.fecha_creacion,
            fechaAceptacion: documento?.fecha_aceptacion,
            plazoBaja,
            ...opciones
        });
    };

    const motivoProveedorBaja = (baja) => {
        const respuesta = baja?.respuesta || baja?.respuesta_proveedor || {};
        return respuesta.sunat_description
            || respuesta.errors
            || respuesta.error
            || baja?.sunat_description
            || baja?.error
            || null;
    };

    const mapearResultadoBaja = (baja, resolucion) => {
        const estadoProveedor = String(baja?.estado || 'PENDIENTE').trim().toUpperCase();
        const motivoProveedor = motivoProveedorBaja(baja);
        const base = {
            tipoOperacion: 'COMUNICACION_BAJA',
            anulacionId: baja?.id ? Number(baja.id) : null,
            ticketSunat: baja?.ticketSunat || baja?.ticket_sunat || null,
            respuesta: baja?.respuesta || baja?.respuesta_proveedor || null,
            resolucionFiscal: resolucion
        };
        if (estadoProveedor === 'ACEPTADO') {
            return {
                ...base,
                resuelto: true,
                estado: 'BAJA_ACEPTADA',
                motivo: motivoProveedor || 'Baja aceptada por SUNAT.'
            };
        }
        if (['RECHAZADO', 'ERROR', 'ERROR_DEFINITIVO'].includes(estadoProveedor)) {
            return {
                ...base,
                resuelto: false,
                estado: 'BAJA_RECHAZADA',
                estadoProveedor,
                motivo: motivoProveedor || 'La baja fue rechazada por el proveedor fiscal.'
            };
        }
        return {
            ...base,
            resuelto: false,
            enTramite: true,
            estado: 'BAJA_FISCAL_PENDIENTE',
            estadoProveedor,
            motivo: 'Baja fiscal enviada y pendiente de confirmación de NubeFact/SUNAT.'
        };
    };

    const ejecutarResolucionFiscal = async ({ resolucion, factInfo, certInfo, solPrevia, userContext, anulacionExistente }) => {
        const docsService = config?.documentosService || defaultDocumentosService;
        const ctxEjecutor = { ...userContext, solicitudId: solPrevia.id };
        try {
            if (resolucion.operacion === OPERACIONES_RESOLUCION_FISCAL.COMUNICACION_BAJA) {
                let resBaja = anulacionExistente || null;
                const estadoExistente = String(resBaja?.estado || '').trim().toUpperCase();
                if (resBaja && !['ACEPTADO', 'RECHAZADO', 'ERROR', 'ERROR_DEFINITIVO'].includes(estadoExistente)
                    && typeof docsService.consultarAnulacion === 'function') {
                    resBaja = await docsService.consultarAnulacion(
                        certInfo.id,
                        Number(resBaja.id),
                        ctxEjecutor,
                        config?.dependencies || {}
                    );
                } else if (!resBaja) {
                    resBaja = await docsService.generarAnulacion(
                        certInfo.id,
                        { tipoDocumento: 'FACTURACION', motivo: solPrevia.motivo, solicitudId: solPrevia.id },
                        ctxEjecutor,
                        config?.dependencies || {}
                    );
                }
                return mapearResultadoBaja(resBaja, resolucion);
            }

            if (resolucion.operacion === OPERACIONES_RESOLUCION_FISCAL.NOTA_CREDITO) {
                const resNota = await docsService.emitirNota(
                    certInfo.id,
                    'CREDITO',
                    {
                        motivoCodigo: '01',
                        sustento: solPrevia.motivo,
                        solicitudId: solPrevia.id
                    },
                    ctxEjecutor,
                    config?.dependencies || {}
                );
                const aceptada = resNota.estado === 'ACEPTADO';
                return {
                    resuelto: aceptada,
                    estado: resNota.estado || 'PENDIENTE',
                    tipoOperacion: 'NOTA_CREDITO',
                    notaId: resNota.id,
                    nroComprobante: resNota.nroComprobante,
                    respuesta: resNota,
                    motivo: aceptada ? 'Nota de crédito total aceptada por SUNAT.' : 'Nota de crédito enviada; pendiente de CDR/aceptación en SUNAT.',
                    resolucionFiscal: resolucion
                };
            }

            return {
                resuelto: false,
                estado: 'REQUIERE_INTERVENCION',
                motivo: resolucion.motivo,
                resolucionFiscal: resolucion
            };
        } catch (errFiscal) {
            if (anulacionExistente) {
                const estadoExistente = String(anulacionExistente.estado || '').toUpperCase();
                if (!['ACEPTADO', 'RECHAZADO', 'ERROR', 'ERROR_DEFINITIVO'].includes(estadoExistente)) {
                    return {
                        ...mapearResultadoBaja(anulacionExistente, resolucion),
                        sincronizacion: {
                            consultado: false,
                            codigo: errFiscal.code || 'ERROR_CONSULTA_BAJA',
                            mensaje: errFiscal.message || String(errFiscal)
                        }
                    };
                }
            }
            return {
                resuelto: false,
                estado: errFiscal.code || 'ERROR_OPERACION_FISCAL',
                error: errFiscal.message || String(errFiscal),
                detalles: errFiscal.detalles || null,
                resolucionFiscal: resolucion
            };
        }
    };

    const ejecutarAnulacionTotalCore = async (id, entrada, userContext) => {
        const solicitudId = enteroPositivo(id, 'SOLICITUD_ID_INVALIDO');
        const usuario = await obtenerUsuarioActual(database, userContext);
        const permisos = await obtenerPermisos(database, usuario.perfil_id);
        exigirPermiso(permisos, PERMISOS_SOLICITUD.EJECUTAR_ANULACION_CERTIFICADO);

        // PASO 1: Transacción corta de verificación, bloqueo y transición a EN_EJECUCION
        let solPrevia;
        let certInfo;
        let factInfo = null;
        let idempotenciaEjecucion;
        const esSincronizacion = entrada?.soloSincronizar === true;
        let anulacionImporteCero = false;

        const client1 = await database.connect();
        try {
            await client1.query('BEGIN');
            const solResult = await client1.query(`${SELECT_SOLICITUD} WHERE s.id = $1 FOR UPDATE OF s`, [solicitudId]);
            if (solResult.rowCount === 0) throw errorNegocio('SOLICITUD_NO_ENCONTRADA', 404);
            const row = solResult.rows[0];

            // Validación de sede del ejecutor
            await validarAccesoPlanta(client1, usuario, row.planta_key, row.empresa_key);

            // Separación de funciones: la ejecución ordinaria exige un ejecutor
            // distinto del solicitante. La única excepción es la autoejecución
            // autorizada expresamente, que exige el permiso dedicado, confirmación
            // explícita y justificación obligatoria, y queda auditada.
            const esAutoejecucion = row.usuario_solicitante === usuario.username;
            let autorizacionAutoejecucion = false;
            let justificacionAutoejecucion = null;
            if (esAutoejecucion) {
                const permisosExcepcion = [
                    PERMISOS_SOLICITUD.APROBAR,
                    PERMISOS_SOLICITUD.AUTOAPROBAR,
                    PERMISOS_SOLICITUD.EJECUTAR_ANULACION_CERTIFICADO,
                    PERMISOS_SOLICITUD.AUTOEJECUTAR
                ];
                const faltantes = permisosExcepcion.filter((permiso) => !permisos.has(permiso));
                if (faltantes.length > 0) {
                    throw errorNegocio('SOLICITUD_AUTODECISION_PROHIBIDA', 403, { permisosRequeridos: faltantes });
                }
                const autorizacionPrevia = row.autorizacion_autoejecucion === true;
                if (entrada?.confirmarAutoejecucion !== true && !autorizacionPrevia) {
                    throw errorNegocio('SOLICITUD_AUTOEJECUCION_CONFIRMACION_REQUERIDA', 400);
                }
                justificacionAutoejecucion = autorizacionPrevia
                    ? (entrada?.justificacion ? texto(entrada.justificacion, 1000, false) : null)
                    : texto(entrada?.justificacion, 1000, true);
                autorizacionAutoejecucion = true;
            }

            // Tipo de operación permitido: exclusivamente ANULAR_AMBOS
            if (row.tipo_operacion !== 'ANULAR_AMBOS') {
                throw errorNegocio('TIPO_OPERACION_INVALIDO_PARA_EJECUCION', 409, { tipo: row.tipo_operacion });
            }

            // Idempotencia: si ya está COMPLETADA, retornar el resultado consolidado
            if (row.estado === 'COMPLETADA') {
                await client1.query('COMMIT');
                return {
                    solicitud: mapearSolicitud(row),
                    resultadoFiscal: row.resultado_fiscal,
                    resultadoTecnico: row.resultado_tecnico,
                    completada: true,
                    yaCompletada: true
                };
            }

            if (row.estado === 'PENDIENTE_APROBACION') throw errorNegocio('SOLICITUD_NO_APROBADA', 409);
            if (row.estado === 'RECHAZADA') throw errorNegocio('SOLICITUD_RECHAZADA', 409);
            if (row.estado === 'CANCELADA') throw errorNegocio('SOLICITUD_CANCELADA', 409);
            if (row.estado === 'EN_EJECUCION' && !esSincronizacion) {
                throw errorNegocio('SOLICITUD_EJECUCION_EN_CURSO', 409);
            }
            if (!['APROBADA', 'EN_EJECUCION', 'REQUIERE_INTERVENCION', 'ERROR'].includes(row.estado)) {
                throw errorNegocio('SOLICITUD_ESTADO_INVALIDO', 409, { estado: row.estado });
            }

            // Versión optimista si se especifica
            if (entrada?.version !== undefined && entrada?.version !== null) {
                const versionEsperada = enteroPositivo(entrada.version, 'VERSION_SOLICITUD_INVALIDA');
                if (versionEsperada !== Number(row.version)) {
                    throw errorNegocio('SOLICITUD_VERSION_DESACTUALIZADA', 409);
                }
            }

            // Bloqueo y verificación del certificado
            const certResult = await client1.query(`
                SELECT c.*, p.empresa_key
                FROM fg_certificado c
                JOIN fg_planta p ON p.key = c.planta_key
                WHERE c.id = $1
                FOR UPDATE OF c
            `, [row.certificado_id]);
            if (certResult.rowCount === 0) throw errorNegocio('CERTIFICADO_NO_ENCONTRADO', 404);
            const cert = certResult.rows[0];

            if (cert.planta_key !== row.planta_key) throw errorNegocio('SOLICITUD_SEDE_NO_AUTORIZADA', 403);
            if (cert.empresa_key !== row.empresa_key) throw errorNegocio('SOLICITUD_EMPRESA_NO_AUTORIZADA', 403);
            if (cert.estado !== 'EMITIDO' && cert.estado !== 'ANULADO') {
                throw errorNegocio('CERTIFICADO_NO_EMITIDO', 409, { estadoActual: cert.estado });
            }
            if (!cert.numero_certificado) throw errorNegocio('CERTIFICADO_SIN_NUMERO_DG', 409);

            // Facturación si existe
            if (row.facturacion_id) {
                const factResult = await client1.query(`
                    SELECT f.*, p.empresa_key
                    FROM fg_facturacion f
                    JOIN fg_planta p ON p.key = f.planta_key
                    WHERE f.id = $1
                    FOR UPDATE OF f
                `, [row.facturacion_id]);
                if (factResult.rowCount > 0) {
                    factInfo = factResult.rows[0];
                    if (factInfo.planta_key !== row.planta_key) throw errorNegocio('SOLICITUD_SEDE_NO_AUTORIZADA', 403);
                    if (factInfo.empresa_key !== row.empresa_key) throw errorNegocio('SOLICITUD_EMPRESA_NO_AUTORIZADA', 403);
                }
            }

            // Regla transversal de importe final. La sincronización de una
            // operación fiscal ya iniciada sigue permitida para conservar el
            // historial, pero nunca puede generar una baja/nota nueva ni
            // completar la anulación de un certificado gratuito.
            const evaluacionImporte = evaluarImporteFinalCertificado({
                ...row,
                precio_certificado: row.precio_certificado ?? cert.precio_certificado,
                precio_chip: row.precio_chip ?? cert.precio_chip,
                producto_chip_id: row.producto_chip_id ?? cert.producto_chip_id,
                facturacion_importe_total: factInfo?.importe_total ?? row.facturacion_importe_total,
                facturacion_moneda: factInfo?.moneda_key ?? row.facturacion_moneda
            });
            if (evaluacionImporte.determinable !== true) {
                exigirAnulacionPermitidaPorImporte(evaluacionImporte, {
                    certificadoId: cert.id,
                    operacion: 'EJECUTAR_ANULACION_TOTAL'
                });
            } else if (evaluacionImporte.esCero === true) {
                if (!esSincronizacion) {
                    exigirAnulacionPermitidaPorImporte(evaluacionImporte, {
                        certificadoId: cert.id,
                        operacion: 'EJECUTAR_ANULACION_TOTAL'
                    });
                }
                const existeOperacionFiscal = await tieneOperacionFiscalIniciada(client1, {
                    facturacionId: factInfo?.id || row.facturacion_id
                });
                if (!existeOperacionFiscal) {
                    exigirAnulacionPermitidaPorImporte(evaluacionImporte, {
                        certificadoId: cert.id,
                        operacion: 'SINCRONIZAR_ANULACION_TOTAL'
                    });
                }
                anulacionImporteCero = true;
            }

            idempotenciaEjecucion = entrada?.idempotenciaClave
                ? normalizarUuid(entrada.idempotenciaClave)
                : (row.idempotencia_ejecucion || crypto.randomUUID());

            // Marcar EN_EJECUCION en transacción corta. La evidencia de la
            // excepción sólo se escribe cuando la autoejecución fue autorizada.
            const evidenciaAutoejecucion = autorizacionAutoejecucion
                ? ', autorizacion_autoejecucion = TRUE'
                : '';
            await client1.query(`
                UPDATE fg_solicitud_operacion
                SET estado = 'EN_EJECUCION',
                    usuario_ejecucion = $1,
                    fecha_ejecucion = COALESCE(fecha_ejecucion, CURRENT_TIMESTAMP),
                    idempotencia_ejecucion = $2
                    ${evidenciaAutoejecucion},
                    fecha_modificacion = CURRENT_TIMESTAMP
                WHERE id = $3
            `, [usuario.username, idempotenciaEjecucion, row.id]);

            await registrarEvento(client1, {
                solicitudId: row.id,
                tipoEvento: esSincronizacion
                    ? 'SINCRONIZACION_FISCAL_INICIADA'
                    : autorizacionAutoejecucion
                    ? 'AUTOEJECUCION_EXCEPCIONAL_AUTORIZADA'
                    : 'EJECUCION_INICIADA',
                estadoAnterior: row.estado,
                estadoPosterior: 'EN_EJECUCION',
                username: usuario.username,
                comentario: esSincronizacion
                    ? 'Consulta idempotente del estado de la operación fiscal existente.'
                    : autorizacionAutoejecucion
                    ? 'Autoejecución excepcional autorizada por el propio solicitante con permiso dedicado.'
                    : 'Inicio de ejecución de anulación total autorizada.',
                metadatos: {
                    idempotenciaEjecucion,
                    certificadoId: cert.id,
                    facturacionId: factInfo?.id || null,
                    origenEjecucion: [
                        'AUTOMATICA_POST_APROBACION',
                        'RECONCILIACION_AUTOMATICA'
                    ].includes(entrada?.origenEjecucion)
                        ? entrada.origenEjecucion
                        : 'MANUAL',
                    identidadProceso: entrada?.identidadProceso || null,
                    usuarioAprobador: row.usuario_decision || null,
                    usuarioEjecutor: usuario.username,
                    autoejecucionAutorizada: autorizacionAutoejecucion,
                    justificacionAutoejecucion,
                    anulacionImporteCero
                }
            });

            await client1.query('COMMIT');
            solPrevia = row;
            certInfo = cert;
        } catch (error) {
            await client1.query('ROLLBACK');
            throw error;
        } finally {
            client1.release();
        }

        // PASO 2: Evaluación y ejecución fiscal (SIN transacciones PostgreSQL abiertas)
        let resultadoFiscal = null;
        let sincronizacionFiscal = null;

        // Antes de decidir el mecanismo tributario, si el comprobante aún no tiene
        // resultado fiscal definitivo se consulta al proveedor para recuperar el
        // estado real. La consulta es idempotente y no degrada estados ya
        // confirmados; si el proveedor no responde se conserva PENDIENTE_SUNAT.
        if (factInfo && factInfo.estado === 'PENDIENTE_SUNAT') {
            const docsServiceSync = config?.documentosService || defaultDocumentosService;
            if (typeof docsServiceSync.consultarFacturacion === 'function') {
                try {
                    const consulta = await docsServiceSync.consultarFacturacion(
                        certInfo.id,
                        { ...userContext, solicitudId: solPrevia.id },
                        config?.dependencies || {}
                    );
                    sincronizacionFiscal = {
                        consultado: true,
                        estadoProveedor: consulta?.estado || null
                    };
                } catch (errorSync) {
                    sincronizacionFiscal = {
                        consultado: false,
                        codigo: errorSync?.code || 'ERROR_CONSULTA_FISCAL',
                        mensaje: errorSync?.message || String(errorSync)
                    };
                }
                const refresco = await database.query(`
                    SELECT f.*, p.empresa_key
                    FROM fg_facturacion f
                    JOIN fg_planta p ON p.key = f.planta_key
                    WHERE f.id = $1
                `, [factInfo.id]);
                if (refresco.rowCount > 0) factInfo = refresco.rows[0];
            }
        }

        if (!factInfo) {
            // Caso A: Certificado sin comprobante fiscal asociado
            resultadoFiscal = {
                resuelto: true,
                estado: 'NO_REQUERIDA',
                motivo: 'Certificado sin comprobante fiscal asociado emitido; no requiere operación fiscal externa.'
            };
        } else if (factInfo.estado === 'ANULADO') {
            // Caso B: Comprobante previamente anulado
            resultadoFiscal = {
                resuelto: true,
                estado: 'ACEPTADO',
                motivo: 'Comprobante fiscal previamente anulado en SUNAT/proveedor fiscal.',
                comprobante: factInfo.nro_comprobante
            };
        } else if (factInfo.estado === 'PENDIENTE_SUNAT') {
            // Caso C: Comprobante con emisión electrónica en trámite ante SUNAT.
            // El resolvedor decide si la falta de CDR es un bloqueo definitivo
            // (factura/nota) o si la boleta aún puede comunicarse de baja dentro
            // del plazo legal, incluso si el proveedor la mantiene pendiente.
            const opTramite = await database.query(`
                SELECT id, operacion, estado, error, fecha_creacion
                FROM fg_documento_electronico_operacion
                WHERE facturacion_id = $1 AND operacion = 'EMITIR'
                ORDER BY id DESC LIMIT 1
            `, [factInfo.id]);

            const operacionEnTramite = opTramite.rowCount > 0;
            const bajaPrevia = await database.query(`
                SELECT id, estado, ticket_sunat, sunat_description,
                       respuesta_proveedor, fecha_creacion, fecha_modificacion
                FROM fg_documento_anulacion
                WHERE facturacion_id = $1
                ORDER BY id DESC
                LIMIT 1
            `, [factInfo.id]);
            const anulacionExistente = bajaPrevia.rows[0] || null;
            const resolucion = await resolverFiscalFacturacion(factInfo);

            if ([
                RESULTADOS_RESOLUCION_FISCAL.BAJA_ELEGIBLE,
                RESULTADOS_RESOLUCION_FISCAL.NOTA_CREDITO_ELEGIBLE
            ].includes(resolucion.resultado)) {
                resultadoFiscal = await ejecutarResolucionFiscal({
                    resolucion,
                    factInfo,
                    certInfo,
                    solPrevia,
                    userContext,
                    anulacionExistente
                });
            } else if (resolucion.resultado === RESULTADOS_RESOLUCION_FISCAL.YA_ANULADO) {
                resultadoFiscal = {
                    resuelto: true,
                    estado: 'ACEPTADO',
                    motivo: resolucion.motivo,
                    comprobante: factInfo.nro_comprobante,
                    resolucionFiscal: resolucion
                };
            } else if (resolucion.resultado === RESULTADOS_RESOLUCION_FISCAL.NO_ELEGIBLE) {
                resultadoFiscal = {
                    resuelto: false,
                    estado: 'REQUIERE_INTERVENCION',
                    motivo: resolucion.motivo,
                    comprobante: factInfo.nro_comprobante,
                    resolucionFiscal: resolucion
                };
            } else {
                // PENDIENTE_VERIFICACION: no se inventa una baja ni una nota.
                resultadoFiscal = {
                    resuelto: false,
                    estado: 'PENDIENTE_SUNAT',
                    enTramite: operacionEnTramite,
                    motivo: 'Comprobante electrónico con emisión en trámite ante SUNAT; la regularización fiscal no se declara completada hasta conocer el resultado definitivo de SUNAT. No se generan bajas ni notas ficticias.',
                    motivoResolucionFiscal: resolucion.motivo,
                    comprobante: factInfo.nro_comprobante,
                    ultimaOperacion: opTramite.rows[0] || null,
                    resolucionFiscal: resolucion
                };
            }
        } else if (factInfo.estado === 'BORRADOR') {
            // Caso D: Comprobante borrador sin emisión ante SUNAT
            resultadoFiscal = {
                resuelto: true,
                estado: 'REGULARIZACION_INTERNA',
                motivo: 'Comprobante en estado BORRADOR (sin emisión electrónica ante SUNAT); regularización interna sin baja ni nota ficticia.',
                comprobante: factInfo.nro_comprobante
            };
        } else if (factInfo.estado === 'RECHAZADO') {
            // Caso E: Comprobante rechazado definitivamente por SUNAT
            resultadoFiscal = {
                resuelto: true,
                estado: 'REGULARIZACION_INTERNA',
                motivo: 'Comprobante rechazado definitivamente por SUNAT; no tiene validez tributaria ni admite baja o nota de crédito.',
                comprobante: factInfo.nro_comprobante
            };
        } else if (factInfo.estado === 'ACEPTADO') {
            // Caso F: Comprobante formalmente aceptado en SUNAT
            // 1. Recuperación idempotente: verificar si ya existe nota de crédito 01/02 aceptada o baja aceptada previa
            const notasAceptadas = await database.query(`
                SELECT * FROM fg_credito
                WHERE facturacion_id = $1 AND motivo_codigo IN (${SQL_CODIGOS_HISTORICOS_ANULACION}) AND estado = 'ACEPTADO'
            `, [factInfo.id]);
            const bajasAceptadas = await database.query(`
                SELECT * FROM fg_documento_anulacion
                WHERE facturacion_id = $1 AND estado = 'ACEPTADO'
            `, [factInfo.id]);

            if (notasAceptadas.rowCount > 0) {
                resultadoFiscal = {
                    resuelto: true,
                    estado: 'ACEPTADO',
                    tipoOperacion: 'NOTA_CREDITO',
                    motivo: 'Nota de crédito total previamente aceptada en SUNAT.',
                    notaId: Number(notasAceptadas.rows[0].id),
                    nroComprobante: notasAceptadas.rows[0].nro_comprobante
                };
            } else if (bajasAceptadas.rowCount > 0) {
                resultadoFiscal = {
                    resuelto: true,
                    estado: 'ACEPTADO',
                    tipoOperacion: 'COMUNICACION_BAJA',
                    motivo: 'Comunicación de baja previamente aceptada en SUNAT.',
                    anulacionId: Number(bajasAceptadas.rows[0].id),
                    ticketSunat: bajasAceptadas.rows[0].ticket_sunat
                };
            } else {
                // 2. Recuperación idempotente: cualquier estado no terminal conserva la
                // operación original y debe reconciliarse antes de volver a enviar.
                const notasPendientes = await database.query(`
                    SELECT * FROM fg_credito
                    WHERE facturacion_id = $1
                      AND motivo_codigo IN (${SQL_CODIGOS_HISTORICOS_ANULACION})
                      AND estado NOT IN ('ACEPTADO', 'RECHAZADO', 'ERROR', 'ERROR_DEFINITIVO')
                    ORDER BY id DESC
                `, [factInfo.id]);
                const bajasPendientes = await database.query(`
                    SELECT * FROM fg_documento_anulacion
                    WHERE facturacion_id = $1
                      AND estado NOT IN ('ACEPTADO', 'RECHAZADO', 'ERROR', 'ERROR_DEFINITIVO')
                    ORDER BY id DESC
                `, [factInfo.id]);

                const notasFallidas = await database.query(`
                    SELECT * FROM fg_credito
                    WHERE facturacion_id = $1
                      AND motivo_codigo IN (${SQL_CODIGOS_HISTORICOS_ANULACION})
                      AND estado IN ('RECHAZADO', 'ERROR', 'ERROR_DEFINITIVO')
                    ORDER BY id DESC
                `, [factInfo.id]);
                const bajasFallidas = await database.query(`
                    SELECT * FROM fg_documento_anulacion
                    WHERE facturacion_id = $1
                      AND estado IN ('RECHAZADO', 'ERROR', 'ERROR_DEFINITIVO')
                    ORDER BY id DESC
                `, [factInfo.id]);

                if (bajasPendientes.rowCount > 0 && notasPendientes.rowCount === 0) {
                    resultadoFiscal = await ejecutarResolucionFiscal({
                        resolucion: {
                            resultado: RESULTADOS_RESOLUCION_FISCAL.BAJA_ELEGIBLE,
                            operacion: OPERACIONES_RESOLUCION_FISCAL.COMUNICACION_BAJA,
                            motivo: 'Reconciliación de la comunicación de baja existente.'
                        },
                        factInfo,
                        certInfo,
                        solPrevia,
                        userContext,
                        anulacionExistente: bajasPendientes.rows[0]
                    });
                } else if (notasPendientes.rowCount > 0) {
                    resultadoFiscal = {
                        resuelto: false,
                        estado: 'EN_TRAMITE',
                        motivo: 'Existe una operación fiscal correctiva previa en trámite ante SUNAT; se mantiene en espera sin generar operaciones concurrentes.',
                        comprobante: factInfo.nro_comprobante,
                        notaId: notasPendientes.rows[0]?.id || null,
                        anulacionId: bajasPendientes.rows[0]?.id || null
                    };
                } else if (bajasFallidas.rowCount > 0 && notasFallidas.rowCount === 0) {
                    resultadoFiscal = mapearResultadoBaja(
                        bajasFallidas.rows[0],
                        {
                            resultado: RESULTADOS_RESOLUCION_FISCAL.NO_ELEGIBLE,
                            operacion: OPERACIONES_RESOLUCION_FISCAL.COMUNICACION_BAJA,
                            motivo: 'La comunicación de baja existente terminó con rechazo o error.'
                        }
                    );
                } else if (notasFallidas.rowCount > 0) {
                    resultadoFiscal = {
                        resuelto: false,
                        estado: 'ERROR_OPERACION_FISCAL_PREVIA',
                        motivo: 'Existe una operación fiscal correctiva previa fallida o rechazada. Debe consultarse o reintentarse el mismo registro; no se generó otra nota de crédito ni otra baja.',
                        comprobante: factInfo.nro_comprobante,
                        notaId: notasFallidas.rows[0]?.id || null,
                        anulacionId: bajasFallidas.rows[0]?.id || null,
                        estadoOperacion: notasFallidas.rows[0]?.estado || bajasFallidas.rows[0]?.estado || null
                    };
                } else {
                    // 3. Resolvedor fiscal central: tipo, estado del proveedor,
                    // CDR/resumen, plazo legal y operaciones previas. La ventana
                    // operativa de solicitud sigue siendo de 24 h; el resolvedor
                    // sólo decide el mecanismo fiscal y no bloquea todo pendiente.
                    const notasPreviasQuery = await database.query(`
                        SELECT COALESCE(SUM(importe_total), 0) AS total
                        FROM fg_credito
                        WHERE facturacion_id = $1 AND estado NOT IN ('RECHAZADO', 'ERROR', 'ERROR_DEFINITIVO')
                          AND motivo_codigo NOT IN ('3', '03')
                    `, [factInfo.id]);
                    const totalNotasPrevias = Number(notasPreviasQuery.rows[0]?.total || 0);
                    const resolucion = await resolverFiscalFacturacion(factInfo, { totalNotasPrevias });

                    if (resolucion.resultado === RESULTADOS_RESOLUCION_FISCAL.YA_ANULADO) {
                        resultadoFiscal = {
                            resuelto: true,
                            estado: 'ACEPTADO',
                            tipoOperacion: resolucion.operacion,
                            motivo: resolucion.motivo,
                            comprobante: factInfo.nro_comprobante,
                            resolucionFiscal: resolucion
                        };
                    } else if ([
                        RESULTADOS_RESOLUCION_FISCAL.BAJA_ELEGIBLE,
                        RESULTADOS_RESOLUCION_FISCAL.NOTA_CREDITO_ELEGIBLE
                    ].includes(resolucion.resultado)) {
                        resultadoFiscal = await ejecutarResolucionFiscal({
                            resolucion,
                            factInfo,
                            certInfo,
                            solPrevia,
                            userContext
                        });
                    } else {
                        resultadoFiscal = {
                            resuelto: false,
                            estado: 'REQUIERE_INTERVENCION',
                            motivo: resolucion.motivo,
                            comprobante: factInfo.nro_comprobante,
                            tipoComprobante: factInfo.tipo_comprobante || null,
                            resolucionFiscal: resolucion
                        };
                    }
                }
            }
        } else {
            // Cualquier otro estado fiscal no tipificado
            resultadoFiscal = {
                resuelto: false,
                estado: 'REQUIERE_INTERVENCION',
                motivo: `Estado fiscal '${factInfo.estado}' no admite determinación tributaria automática. Requiere intervención de Sistemas.`,
                comprobante: factInfo.nro_comprobante
            };
        }

        // PASO 3: Evaluación técnica del certificado
        if (resultadoFiscal && sincronizacionFiscal) {
            resultadoFiscal = { ...resultadoFiscal, sincronizacion: sincronizacionFiscal };
        }
        let resultadoTecnico = null;
        const habilitadoTecnico = esTipoPermitidoParaAnulacionLocal(certInfo.tipo_certificado_clave);

        if (anulacionImporteCero) {
            resultadoTecnico = {
                resuelto: false,
                estado: 'BLOQUEADO_IMPORTE_CERO',
                motivo: MENSAJE_IMPORTE_CERO,
                importeFinal: 0,
                tipoCertificado: certInfo.tipo_certificado_clave,
                numeroCertificado: certInfo.numero_certificado,
                estadoCertificado: certInfo.estado
            };
        } else if (resultadoFiscal?.resuelto !== true) {
            // Una espera fiscal normal no es una intervención técnica. El
            // certificado permanece EMITIDO hasta la confirmación de la baja.
            resultadoTecnico = {
                resuelto: false,
                estado: 'BLOQUEADO_POR_FISCAL',
                motivo: 'La anulación técnica queda en espera hasta que la baja fiscal tenga un resultado definitivo.',
                tipoCertificado: certInfo.tipo_certificado_clave,
                numeroCertificado: certInfo.numero_certificado,
                estadoCertificado: certInfo.estado,
                estadoFiscal: resultadoFiscal?.estado || null
            };
        } else if (!habilitadoTecnico) {
            // Protección técnica: el certificado emitido permanece en EMITIDO intacto.
            // Se conserva el correlativo DG, fecha original, pagos, trazabilidad y PDF.
            resultadoTecnico = {
                resuelto: false,
                estado: 'BLOQUEADO_NORMATIVA',
                motivo: 'Anulación técnica de certificado bloqueada por defecto hasta contar con procedimiento externo oficial verificado.',
                tipoCertificado: certInfo.tipo_certificado_clave,
                numeroCertificado: certInfo.numero_certificado,
                estadoCertificado: certInfo.estado
            };
        } else {
            // Procedimiento oficial validado
            await certificadosService.anularCertificadoEmitido({
                client: database,
                certificadoId: certInfo.id,
                justificacion: solPrevia.motivo,
                solicitudId: solPrevia.id,
                usuario: usuario.username
            });
            resultadoTecnico = {
                resuelto: true,
                estado: 'ANULADO',
                tipoCertificado: certInfo.tipo_certificado_clave,
                numeroCertificado: certInfo.numero_certificado,
                fechaAnulacion: new Date().toISOString()
            };
        }

        // PASO 4: Transacción corta de cierre y consolidación
        let solFinal;
        const client2 = await database.connect();
        try {
            await client2.query('BEGIN');
            const solResult2 = await client2.query(`SELECT * FROM fg_solicitud_operacion WHERE id = $1 FOR UPDATE`, [solPrevia.id]);
            const rowActual = solResult2.rows[0];

            const ambosResueltos = (resultadoFiscal?.resuelto === true) && (resultadoTecnico?.resuelto === true);
            const estadoFiscalNormalizado = String(resultadoFiscal?.estado || '').toUpperCase();
            const fiscalPendiente = resultadoFiscal?.enTramite === true || [
                'PENDIENTE',
                'PENDIENTE_SUNAT',
                'EN_TRAMITE',
                'BAJA_FISCAL_PENDIENTE'
            ].includes(estadoFiscalNormalizado);
            const fiscalRechazadoOError = [
                'RECHAZADO',
                'BAJA_RECHAZADA',
                'ERROR',
                'ERROR_DEFINITIVO',
                'ERROR_OPERACION_FISCAL',
                'ERROR_OPERACION_FISCAL_PREVIA'
            ].includes(estadoFiscalNormalizado)
                || estadoFiscalNormalizado.startsWith('ERROR_')
                || Boolean(resultadoFiscal?.error);
            const nuevoEstado = ambosResueltos
                ? 'COMPLETADA'
                : fiscalPendiente
                    ? 'EN_EJECUCION'
                    : fiscalRechazadoOError
                        ? 'ERROR'
                        : 'REQUIERE_INTERVENCION';

            const actResult = await client2.query(`
                UPDATE fg_solicitud_operacion
                SET estado = $1,
                    resultado_fiscal = $2::jsonb,
                    resultado_tecnico = $3::jsonb,
                    version = version + 1,
                    fecha_modificacion = CURRENT_TIMESTAMP
                WHERE id = $4
                RETURNING *
            `, [nuevoEstado, JSON.stringify(resultadoFiscal), JSON.stringify(resultadoTecnico), rowActual.id]);

            solFinal = actResult.rows[0];

            const tipoEvento = ambosResueltos
                ? 'ANULACION_TOTAL_COMPLETADA'
                : fiscalPendiente
                    ? 'BAJA_FISCAL_PENDIENTE_CONFIRMACION'
                    : fiscalRechazadoOError
                        ? 'BAJA_FISCAL_RECHAZADA_O_ERROR'
                        : 'EJECUCION_PARCIAL_REQUIERE_INTERVENCION';

            await registrarEvento(client2, {
                solicitudId: rowActual.id,
                tipoEvento,
                estadoAnterior: 'EN_EJECUCION',
                estadoPosterior: nuevoEstado,
                username: usuario.username,
                comentario: ambosResueltos
                    ? 'Anulación total completada satisfactoriamente.'
                    : fiscalPendiente
                        ? 'Baja fiscal pendiente de confirmación. No requiere intervención manual mientras NubeFact/SUNAT procesa la operación.'
                        : fiscalRechazadoOError
                            ? `Baja fiscal rechazada o con error: ${resultadoFiscal?.motivo || resultadoFiscal?.estado}.`
                            : `Se requiere una acción técnica manual: ${resultadoTecnico?.motivo || resultadoTecnico?.estado}.`,
                metadatos: {
                    resultadoFiscal,
                    resultadoTecnico,
                    ambosResueltos
                }
            });

            await client2.query('COMMIT');
        } catch (error) {
            await client2.query('ROLLBACK');
            throw error;
        } finally {
            client2.release();
        }

        return {
            solicitud: mapearSolicitud(solFinal),
            resultadoFiscal,
            resultadoTecnico,
            completada: solFinal.estado === 'COMPLETADA',
            requiereIntervencion: solFinal.estado === 'REQUIERE_INTERVENCION',
            yaCompletada: false
        };
    };

    /**
     * Retoma únicamente anulaciones fiscales que ya cuentan con un registro en
     * fg_documento_anulacion. No crea ni reenvía bajas: consulta el mismo
     * registro y, si el proveedor lo confirmó, deja que el motor idempotente
     * complete la anulación técnica y cierre la solicitud.
     */
    const reconciliarAnulacionesPendientes = async (opciones = {}) => {
        const limiteSolicitado = Number(opciones.limite || opciones.limit || 25);
        const limite = Number.isInteger(limiteSolicitado) && limiteSolicitado > 0
            ? Math.min(limiteSolicitado, 100)
            : 25;
        const logger = opciones.logger || console;
        const permitirTodos = config?.permitirTodosLosTiposLocal === true;
        const tiposPermitidos = Array.isArray(config?.tiposPermitidosLocal)
            ? config.tiposPermitidosLocal.filter(Boolean)
            : [];

        if (config?.habilitarAnulacionTecnica !== true
            || (!permitirTodos && tiposPermitidos.length === 0)) {
            return { candidatos: 0, procesados: 0, completados: 0, pendientes: 0, rechazados: 0, errores: 0, omitidos: 0 };
        }

        const filtroTipo = permitirTodos
            ? ''
            : 'AND c.tipo_certificado_clave = ANY($2::text[])';
        const parametros = permitirTodos ? [limite] : [limite, tiposPermitidos];
        const candidatos = await database.query(`
            /* FAREGAS_RECONCILIAR_ANULACIONES_EXISTENTES */
            SELECT s.id,
                   s.estado,
                   s.version,
                   s.usuario_solicitante,
                   s.autorizacion_autoejecucion,
                   COALESCE(s.usuario_ejecucion, s.usuario_decision) AS usuario_reconciliacion,
                   c.tipo_certificado_clave,
                   baja.id AS anulacion_id,
                   baja.estado AS estado_anulacion
            FROM fg_solicitud_operacion s
            JOIN fg_certificado c ON c.id = s.certificado_id
            JOIN LATERAL (
                SELECT a.id, a.estado
                FROM fg_documento_anulacion a
                WHERE a.facturacion_id = s.facturacion_id
                ORDER BY a.id DESC
                LIMIT 1
            ) baja ON TRUE
            WHERE s.tipo_operacion = 'ANULAR_AMBOS'
              AND s.estado IN ('EN_EJECUCION', 'REQUIERE_INTERVENCION')
              AND COALESCE(s.usuario_ejecucion, s.usuario_decision) IS NOT NULL
              AND (
                    s.usuario_solicitante <> COALESCE(s.usuario_ejecucion, s.usuario_decision)
                    OR s.autorizacion_autoejecucion = TRUE
                  )
              ${filtroTipo}
            ORDER BY s.fecha_modificacion ASC, s.id ASC
            LIMIT $1
        `, parametros);

        const resumen = {
            candidatos: candidatos.rowCount,
            procesados: 0,
            completados: 0,
            pendientes: 0,
            rechazados: 0,
            errores: 0,
            omitidos: 0
        };

        for (const fila of candidatos.rows) {
            if (!esTipoPermitidoParaAnulacionLocal(fila.tipo_certificado_clave)) {
                resumen.omitidos += 1;
                continue;
            }
            try {
                const resultado = await ejecutarAnulacionTotalCore(
                    fila.id,
                    {
                        soloSincronizar: true,
                        origenEjecucion: 'RECONCILIACION_AUTOMATICA',
                        identidadProceso: 'faregas:reconciliacion-anulaciones-existentes'
                    },
                    { username: fila.usuario_reconciliacion }
                );
                resumen.procesados += 1;
                const estadoSolicitud = String(resultado?.solicitud?.estado || '').toUpperCase();
                const estadoFiscal = String(resultado?.resultadoFiscal?.estado || '').toUpperCase();
                if (estadoSolicitud === 'COMPLETADA') resumen.completados += 1;
                else if (estadoSolicitud === 'EN_EJECUCION') resumen.pendientes += 1;
                else if (estadoSolicitud === 'ERROR' || estadoFiscal.includes('RECHAZ')) resumen.rechazados += 1;
                else resumen.omitidos += 1;
            } catch (error) {
                resumen.errores += 1;
                logger.error(
                    `[FAREGAS ANULACIONES] No se pudo reconciliar la solicitud ${fila.id}:`,
                    error?.code || error?.message || String(error)
                );
            }
        }

        return resumen;
    };

    const registrarEsperaEjecucion = async (solicitud, userContext, evaluacion) => conTransaccion(async (client) => {
        await registrarEvento(client, {
            solicitudId: solicitud.id,
            tipoEvento: 'EJECUCION_AUTOMATICA_PENDIENTE',
            estadoAnterior: solicitud.estado,
            estadoPosterior: solicitud.estado,
            username: userContext?.username || solicitud.usuarioDecision || null,
            comentario: evaluacion.motivo,
            metadatos: {
                codigo: evaluacion.codigo,
                identidadProceso: 'faregas:anulacion-total-post-aprobacion',
                requiereEjecutorDistinto: evaluacion.codigo === 'EJECUTOR_DISTINTO_REQUERIDO'
            }
        });
        return evaluacion;
    });

    /**
     * Marca un fallo controlado de ejecución conservando la trazabilidad.
     * Si el proceso alcanzó EN_EJECUCION, lo deja en ERROR para que pueda
     * reintentarse sin duplicar operaciones fiscales. Si aún estaba en
     * APROBADA (el fallo ocurrió antes de iniciar el motor) conserva el estado.
     */
    const marcarErrorEjecucion = async (solicitudId, userContext, error, opciones = {}) => conTransaccion(async (client) => {
        const actual = await client.query(`
            SELECT id, estado
            FROM fg_solicitud_operacion
            WHERE id = $1
            FOR UPDATE
        `, [solicitudId]);
        if (actual.rowCount === 0) return null;

        const estadoAnterior = actual.rows[0].estado;
        let estadoPosterior = estadoAnterior;
        if (estadoAnterior === 'EN_EJECUCION') {
            const resultado = {
                resuelto: false,
                estado: error?.code || opciones.codigoErrorDefecto || 'ERROR_EJECUCION_AUTOMATICA',
                motivo: error?.message || 'Fallo controlado durante la ejecución.'
            };
            await client.query(`
                UPDATE fg_solicitud_operacion
                SET estado = 'ERROR',
                    resultado_fiscal = COALESCE(resultado_fiscal, $1::jsonb),
                    version = version + 1,
                    fecha_modificacion = CURRENT_TIMESTAMP
                WHERE id = $2 AND estado = 'EN_EJECUCION'
            `, [JSON.stringify(resultado), solicitudId]);
            estadoPosterior = 'ERROR';
        }

        await registrarEvento(client, {
            solicitudId,
            tipoEvento: opciones.tipoEvento || 'EJECUCION_AUTOMATICA_ERROR',
            estadoAnterior,
            estadoPosterior,
            username: userContext?.username || null,
            comentario: opciones.comentario
                || 'La ejecución no pudo concluir y quedó registrada para recuperación segura.',
            metadatos: {
                codigo: error?.code || opciones.codigoErrorDefecto || 'ERROR_EJECUCION_AUTOMATICA',
                mensaje: error?.message || String(error),
                identidadProceso: opciones.identidadProceso || 'faregas:anulacion-total-post-aprobacion'
            }
        });
        return estadoPosterior;
    });

    const marcarErrorEjecucionAutomatica = (solicitudId, userContext, error) => marcarErrorEjecucion(
        solicitudId,
        userContext,
        error,
        { identidadProceso: 'faregas:anulacion-total-post-aprobacion' }
    );

    const aprobarYCoordinarEjecucion = async (id, entrada, userContext) => {
        const solicitud = await decidir(id, 'APROBAR', entrada, userContext);
        // La ejecución automática fiscal sólo corresponde a la anulación total.
        // Las rectificaciones de certificado se ejecutan por su servicio técnico
        // dedicado y nunca deben llamar al motor de comprobantes.
        if (solicitud.tipoOperacion !== 'ANULAR_AMBOS') {
            return {
                solicitud,
                ejecucionAutomatica: {
                    iniciada: false,
                    habilitada: false,
                    codigo: 'EJECUCION_AUTOMATICA_NO_APLICA',
                    motivo: 'Esta solicitud no admite ejecución fiscal automática. Debe ejecutarse desde el flujo autorizado correspondiente.'
                }
            };
        }
        const configuracion = config.ejecucionAutomatica || {
            enabled: process.env.FAREGAS_ANULACION_AUTOMATICA_ENABLED,
            productionAuthorized: process.env.FAREGAS_ANULACION_AUTOMATICA_PRODUCCION_AUTORIZADA
        };

        let estadoProveedor = null;
        if (solicitud.usuarioSolicitante !== solicitud.usuarioDecision && esVerdadero(configuracion.enabled)) {
            try {
                const nubefactConfigService = config.nubefactConfigService || defaultNubefactConfigService;
                estadoProveedor = await nubefactConfigService.obtenerEstadoParaPlanta(solicitud.plantaKey, database);
            } catch (error) {
                const evaluacion = {
                    habilitada: false,
                    codigo: error?.code || 'NUBEFACT_CONFIGURACION_NO_VERIFICABLE',
                    motivo: 'No se pudo verificar de forma segura la configuración fiscal de la sede.'
                };
                await registrarEsperaEjecucion(solicitud, userContext, evaluacion);
                return { solicitud, ejecucionAutomatica: { iniciada: false, ...evaluacion } };
            }
        }

        const evaluacion = evaluarActivacionEjecucionAutomatica({
            solicitud,
            estadoProveedor,
            configuracion
        });
        if (!evaluacion.habilitada) {
            await registrarEsperaEjecucion(solicitud, userContext, evaluacion);
            return { solicitud, ejecucionAutomatica: { iniciada: false, ...evaluacion } };
        }

        try {
            const resultado = await ejecutarAnulacionTotalCore(solicitud.id, {
                origenEjecucion: 'AUTOMATICA_POST_APROBACION',
                identidadProceso: 'faregas:anulacion-total-post-aprobacion'
            }, userContext);
            return {
                solicitud: resultado.solicitud,
                ejecucionAutomatica: {
                    iniciada: true,
                    entorno: evaluacion.entorno,
                    completada: resultado.completada,
                    requiereIntervencion: resultado.requiereIntervencion,
                    resultadoFiscal: resultado.resultadoFiscal,
                    resultadoTecnico: resultado.resultadoTecnico
                }
            };
        } catch (error) {
            const estado = await marcarErrorEjecucionAutomatica(solicitud.id, userContext, error);
            return {
                solicitud: { ...solicitud, estado: estado || solicitud.estado },
                ejecucionAutomatica: {
                    iniciada: true,
                    completada: false,
                    requiereIntervencion: true,
                    codigo: error?.code || 'ERROR_EJECUCION_AUTOMATICA',
                    motivo: 'La aprobación se conservó, pero la ejecución automática falló de forma controlada.'
                }
            };
        }
    };

    const ejecutarAnulacionTotal = (id, entrada, userContext) => ejecutarAnulacionTotalCore(id, entrada, userContext);

    /**
     * Operación unificada: aprueba la solicitud y ejecuta la anulación total en una
     * sola acción iniciada explícitamente por el usuario.
     *
     * Diferencia clave respecto a aprobarYCoordinarEjecucion:
     *   - No está sujeta a la bandera FAREGAS_ANULACION_AUTOMATICA_ENABLED.
     *   - Es una acción intencional del operador, no una ejecución automática silenciosa.
     *   - Registra dos eventos distintos: la aprobación (decidir) y el inicio/fallo
     *     de la ejecución (motor de anulación total).
     *   - Valida los permisos de ejecución ANTES de aprobar: un usuario que no puede
     *     ejecutar no deja la solicitud aprobada a medias.
     *   - Si la ejecución falla después de aprobar, la aprobación queda persistida y
     *     auditada; el fallo se registra y la solicitud queda recuperable.
     */
    const aprobarYEjecutarAnulacionTotal = async (id, entrada, userContext) => {
        // Validación previa (sin escribir): tipo, estado, permisos y concurrencia.
        // decidir() volverá a validarlos de forma atómica con la fila bloqueada.
        const { row, alcance } = await obtener(id, userContext, database, false, PERMISOS_SOLICITUD.APROBAR);
        const usuario = alcance.usuario;
        const permisos = alcance.permisos;

        if (entrada?.tipoOperacion && String(entrada.tipoOperacion).trim().toUpperCase() !== 'ANULAR_AMBOS') {
            throw errorNegocio('TIPO_OPERACION_INVALIDO_PARA_EJECUCION', 409, { tipo: entrada.tipoOperacion });
        }
        if (row.tipo_operacion !== 'ANULAR_AMBOS') {
            throw errorNegocio('TIPO_OPERACION_INVALIDO_PARA_EJECUCION', 409, { tipo: row.tipo_operacion });
        }
        if (row.estado === 'RECHAZADA') throw errorNegocio('SOLICITUD_RECHAZADA', 409);
        if (row.estado === 'CANCELADA') throw errorNegocio('SOLICITUD_CANCELADA', 409);
        if (row.estado === 'EN_EJECUCION') throw errorNegocio('SOLICITUD_EJECUCION_EN_CURSO', 409);
        if (row.estado !== 'PENDIENTE_APROBACION') {
            throw errorNegocio('SOLICITUD_NO_DECIDIBLE', 409, { estado: row.estado });
        }

        const esAutoaprobacion = row.usuario_solicitante === usuario.username;
        if (esAutoaprobacion) {
            if (!permisos.has(PERMISOS_SOLICITUD.APROBAR) || !permisos.has(PERMISOS_SOLICITUD.AUTOAPROBAR)) {
                throw errorNegocio('SOLICITUD_AUTOAPROBACION_NO_AUTORIZADA', 403);
            }
            if (entrada?.confirmarAutoaprobacion !== true) {
                throw errorNegocio('SOLICITUD_AUTOAPROBACION_CONFIRMACION_REQUERIDA', 400);
            }
            // La autoejecución exige simultáneamente los cuatro permisos y
            // confirmación explícita; se valida antes de aprobar para no dejar
            // una autoaprobación sin posibilidad real de ejecutarse.
            const permisosExcepcion = [
                PERMISOS_SOLICITUD.APROBAR,
                PERMISOS_SOLICITUD.AUTOAPROBAR,
                PERMISOS_SOLICITUD.EJECUTAR_ANULACION_CERTIFICADO,
                PERMISOS_SOLICITUD.AUTOEJECUTAR
            ];
            const faltantes = permisosExcepcion.filter((permiso) => !permisos.has(permiso));
            if (faltantes.length > 0) {
                throw errorNegocio('SOLICITUD_AUTODECISION_PROHIBIDA', 403, { permisosRequeridos: faltantes });
            }
            if (entrada?.confirmarAutoejecucion !== true) {
                throw errorNegocio('SOLICITUD_AUTOEJECUCION_CONFIRMACION_REQUERIDA', 400);
            }
            texto(entrada?.justificacion, 1000, true);
        } else if (!permisos.has(PERMISOS_SOLICITUD.EJECUTAR_ANULACION_CERTIFICADO)) {
            throw errorNegocio('SOLICITUD_PERMISO_DENEGADO', 403, {
                permiso: PERMISOS_SOLICITUD.EJECUTAR_ANULACION_CERTIFICADO
            });
        }

        // Concurrencia optimista: la versión enviada por el operador debe coincidir
        // con la leída antes de registrar la aprobación.
        const version = enteroPositivo(entrada?.version, 'VERSION_SOLICITUD_INVALIDA');
        if (version !== Number(row.version)) throw errorNegocio('SOLICITUD_VERSION_DESACTUALIZADA', 409);

        // FASE 1: Registrar la aprobación en una transacción corta y atómica.
        // decidir() valida nuevamente permisos, separación de funciones y estado,
        // y realiza el UPDATE + INSERT del evento SOLICITUD_APROBADA.
        const solicitudAprobada = await decidir(id, 'APROBAR', entrada, userContext);

        // FASE 2: Ejecutar la anulación total fuera de transacciones PostgreSQL.
        // El motor fiscal ya distancia la reserva, la llamada a NubeFact y el
        // cierre; aquí sólo se orquesta para que el operador no tenga un segundo paso.
        try {
            const resultadoEjecucion = await ejecutarAnulacionTotalCore(
                solicitudAprobada.id,
                {
                    version: solicitudAprobada.version,
                    justificacion: entrada?.justificacion,
                    idempotenciaClave: entrada?.idempotenciaClave,
                    origenEjecucion: 'MANUAL_UNIFICADO',
                    identidadProceso: 'faregas:aprobar-y-ejecutar-anulacion-total',
                    ...(esAutoaprobacion ? { confirmarAutoejecucion: true } : {})
                },
                userContext
            );
            return {
                solicitud: resultadoEjecucion.solicitud,
                aprobada: true,
                ejecucionIniciada: true,
                ejecucionFallida: false,
                completada: resultadoEjecucion.completada,
                requiereIntervencion: resultadoEjecucion.requiereIntervencion,
                resultadoFiscal: resultadoEjecucion.resultadoFiscal,
                resultadoTecnico: resultadoEjecucion.resultadoTecnico,
                yaCompletada: resultadoEjecucion.yaCompletada || false
            };
        } catch (errorEjecucion) {
            // La aprobación ya está persistida. Se registra el fallo, se libera
            // cualquier EN_EJECUCION colgado y se devuelve el estado real para que
            // el operador pueda reintentar sin duplicar la operación fiscal.
            let estadoFinal = null;
            try {
                estadoFinal = await marcarErrorEjecucion(solicitudAprobada.id, userContext, errorEjecucion, {
                    tipoEvento: 'EJECUCION_UNIFICADA_ERROR',
                    identidadProceso: 'faregas:aprobar-y-ejecutar-anulacion-total',
                    codigoErrorDefecto: 'ERROR_EJECUCION_UNIFICADA',
                    comentario: 'La aprobación se registró, pero la ejecución unificada no pudo concluir. Queda disponible la recuperación controlada.'
                });
            } catch (_) {
                // El fallo del registro de auditoría no debe ocultar el resultado
                // original ni provocar un segundo intento fiscal automático.
            }

            let solicitudFinal = estadoFinal
                ? { ...solicitudAprobada, estado: estadoFinal }
                : solicitudAprobada;
            try {
                const fresco = await obtener(solicitudAprobada.id, userContext, database, false, PERMISOS_SOLICITUD.APROBAR);
                solicitudFinal = fresco.solicitud;
            } catch (_) { /* se conserva el estado conocido */ }

            return {
                solicitud: solicitudFinal,
                aprobada: true,
                ejecucionIniciada: false,
                ejecucionFallida: true,
                codigoError: errorEjecucion?.code || 'ERROR_EJECUCION_UNIFICADA',
                mensajeError: errorEjecucion?.message || String(errorEjecucion)
            };
        }
    };

    return {
        contextoCertificado,
        crear,
        crearAnulacionTotal,
        crearAutorizacionNotaCredito,
        listar,
        obtener: async (id, userContext) => (await obtener(id, userContext)).solicitud,
        obtenerDetalle,
        aprobar: (id, entrada, userContext) => decidir(id, 'APROBAR', entrada, userContext),
        aprobarYCoordinarEjecucion,
        aprobarYEjecutarAnulacionTotal,
        rechazar: (id, entrada, userContext) => decidir(id, 'RECHAZAR', entrada, userContext),
        cancelar,
        historial,
        ejecutarAnulacionCertificado,
        ejecutarRectificacionCertificado,
        ejecutarAnulacionTotal,
        reconciliarAnulacionesPendientes
    };
};

const servicio = crearServicio(db, {
    habilitarAnulacionTecnica: CONFIG_ANULACION_TECNICA.habilitadoPorDefecto,
    tiposPermitidosLocal: [...CONFIG_ANULACION_TECNICA.tiposPermitidosLocal]
});

module.exports = {
    ...servicio,
    _private: {
        crearServicio,
        errorNegocio,
        normalizarTipo,
        normalizarUuid,
        validarDatosPropuestos,
        validarContextoParaTipo,
        requiereComprobante,
        afectaCertificado,
        snapshotCertificado,
        snapshotComprobante,
        mapearSolicitud,
        consultaContextoCertificado,
        registrarEvento,
        aplanarPropuestas,
        calcularDiferencias,
        camposPermitidosParaTipo,
        camposRectificablesCertificado,
        estadoSolicitudComprobante,
        datosFiscalesActuales,
        evaluarActivacionEjecucionAutomatica,
        crypto
    }
};
