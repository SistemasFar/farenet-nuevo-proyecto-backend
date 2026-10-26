/**
 * Rectificación administrativa de certificados ya emitidos.
 *
 * La rectificación operativa se ejecuta directamente por un usuario con el
 * permiso técnico explícito. El registro administrativo se conserva como
 * antecedente COMPLETADO, sin estados pendientes ni aprobación externa. La
 * ejecución sólo regenera el certificado técnico y sus versiones: no crea
 * comprobantes, no consume correlativos, no modifica pagos y no llama a
 * NubeFact.
 */
const crypto = require('crypto');
const db = require('../../../config/database');
const certificadosService = require('./faregas-certificados.service');
const pdfVersionService = require('./faregas-rectificacion-pdf.service');
const {
    PERMISOS_SOLICITUD,
    ESTADOS_QUE_BLOQUEAN
} = require('./faregas-solicitudes-operacion.constants');
const {
    CAMPOS_VEHICULO,
    CAMPOS_TITULAR,
    CAMPOS_ESPECIFICOS,
    tipoEspecifico,
    textoONull,
    copiaProfunda,
    aplicarPropuestaABorrador,
    construirSnapshotVersion,
    calcularDiferenciasRectificacion,
    advertenciasGestionExterna,
    normalizarComponentes,
    normalizarVerificaciones
} = require('./faregas-rectificacion-datos');

const TIPO_RECTIFICACION = 'RECTIFICAR_CERTIFICADO';
const TIPOS_ANULACION = ['ANULAR_CERTIFICADO', 'ANULAR_AMBOS'];
const ESTADOS_RECTIFICABLES = new Set(['EMITIDO']);

const errorNegocio = (code, statusCode = 400, detalles) => {
    const error = new Error(code);
    error.code = code;
    error.statusCode = statusCode;
    if (detalles !== undefined) error.detalles = detalles;
    return error;
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

const normalizarUuid = (valor) => {
    const clave = String(valor || '').trim().toLowerCase();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(clave)) {
        throw errorNegocio('IDEMPOTENCIA_INVALIDA');
    }
    return clave;
};

const fechaIsoONull = (valor) => {
    if (valor === undefined || valor === null || valor === '') return null;
    const textoFecha = String(valor).trim();
    // Los snapshots PostgreSQL serializan las columnas date como timestamp
    // ISO. Se conserva el día calendario y se descarta la hora al persistir.
    const coincidencia = /^(\d{4}-\d{2}-\d{2})(?:[T ].*)?$/.exec(textoFecha);
    const soloFecha = coincidencia?.[1] || '';
    const fecha = new Date(`${soloFecha}T00:00:00.000Z`);
    if (!soloFecha || Number.isNaN(fecha.getTime()) || fecha.toISOString().slice(0, 10) !== soloFecha) {
        throw errorNegocio('FECHA_INVALIDA', 400, { valor: textoFecha });
    }
    return soloFecha;
};

const numeroONull = (valor) => {
    if (valor === undefined || valor === null || valor === '') return null;
    const numero = Number(valor);
    return Number.isFinite(numero) ? numero : null;
};

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

const tienePermiso = (permisos, permiso) => (
    permisos.has(permiso) || permisos.has(PERMISOS_SOLICITUD.ADMINISTRAR)
);

const exigirPermiso = (permisos, permiso) => {
    if (!tienePermiso(permisos, permiso)) {
        throw errorNegocio('SOLICITUD_PERMISO_DENEGADO', 403, { permiso });
    }
};

const exigirPermisoExplicito = (permisos, permiso) => {
    if (!permisos.has(permiso)) {
        throw errorNegocio('SOLICITUD_PERMISO_DENEGADO', 403, { permiso });
    }
};

const validarAccesoPlanta = async (executor, usuario, plantaKey) => {
    const acceso = await executor.query(`
        SELECT 1
        FROM fg_usuario_planta up
        JOIN fg_perfil_planta pp
          ON pp.planta_key = up.plantas_key
         AND pp.perfil_clave = $2
        JOIN fg_planta p ON p.key = up.plantas_key AND p.activo = TRUE
        WHERE up.usuario_username = $1
          AND up.plantas_key = $3
        LIMIT 1
    `, [usuario.username, usuario.perfil_id, plantaKey]);
    if (acceso.rowCount === 0) throw errorNegocio('PLANTA_NO_AUTORIZADA', 403);
};

const conTransaccion = async (trabajo) => {
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        const resultado = await trabajo(client);
        await client.query('COMMIT');
        return resultado;
    } catch (error) {
        try { await client.query('ROLLBACK'); } catch (_) { /* noop */ }
        throw error;
    } finally {
        client.release();
    }
};

const consultaCertificadoBase = (bloqueo = false) => `
    SELECT c.id, c.tipo_certificado_clave, c.numero_certificado, c.cliente_id,
           c.planta_key, c.fecha_emision, c.estado, c.observaciones,
           c.usuario_creacion, c.fecha_creacion,
           c.entidad_certificadora_nombre, c.resolucion_directoral,
           c.domicilio_fiscal, c.telefono_certificadora, c.lugar_emision,
           c.tarifa_codigo, c.formato_version_id, c.formato_datos_snapshot,
           c.fecha_anulacion, c.motivo_anulacion, c.solicitud_anulacion_id,
           p.empresa_key, p.nombre AS planta_nombre,
           e.nombre AS empresa_nombre,
           t.nombre AS tipo_nombre,
           cl.tipo_documento AS cliente_tipo_doc,
           cl.nro_documento AS cliente_nro_doc,
           cl.nombre_razon_social AS cliente_nombre
    FROM fg_certificado c
    JOIN fg_planta p ON p.key = c.planta_key
    LEFT JOIN fg_empresa e ON e.key = p.empresa_key
    LEFT JOIN fg_tipo_certificado t ON t.clave = c.tipo_certificado_clave
    LEFT JOIN fg_cliente cl ON cl.id = c.cliente_id
    WHERE c.id = $1
    ${bloqueo ? 'FOR UPDATE OF c' : ''}
`;

const obtenerComprobanteAsociado = async (executor, certificadoId) => {
    const result = await executor.query(`
        SELECT id, tipo_comprobante, serie, numero, nro_comprobante, estado,
               moneda_key, base_imponible, igv, importe_total,
               enlace_pdf, enlace_xml, enlace_cdr, fecha_aceptacion
        FROM fg_facturacion
        WHERE certificado_id = $1
        ORDER BY id DESC
        LIMIT 1
    `, [certificadoId]);
    return result.rows[0] || null;
};

const obtenerVersionActual = async (executor, certificadoId) => {
    const result = await executor.query(`
        SELECT COALESCE(MAX(numero_version), 0) AS ultima
        FROM fg_certificado_version
        WHERE certificado_id = $1
    `, [certificadoId]);
    const ultima = Number(result.rows[0]?.ultima || 0);
    return ultima > 0 ? ultima : 1;
};

const obtenerSolicitudesActivas = async (executor, certificadoId) => {
    const result = await executor.query(`
        SELECT id, tipo_operacion, estado, usuario_solicitante, fecha_solicitud
        FROM fg_solicitud_operacion
        WHERE certificado_id = $1
          AND estado = ANY($2::varchar[])
        ORDER BY id DESC
    `, [certificadoId, ESTADOS_QUE_BLOQUEAN]);
    return result.rows;
};

const motivosBloqueoRectificacion = (cert, activas = []) => {
    const motivos = [];
    if (!cert) return ['CERTIFICADO_NO_ENCONTRADO'];
    if (!ESTADOS_RECTIFICABLES.has(String(cert.estado || '').toUpperCase())) {
        motivos.push('CERTIFICADO_NO_EMITIDO_O_NO_RECTIFICABLE');
    }
    if (cert.fecha_anulacion || String(cert.estado || '').toUpperCase() === 'ANULADO') {
        motivos.push('CERTIFICADO_ANULADO');
    }
    if (activas.some((s) => TIPOS_ANULACION.includes(s.tipo_operacion))) {
        motivos.push('ANULACION_EN_CURSO');
    }
    const rectificacionActiva = activas.find((s) => s.tipo_operacion === TIPO_RECTIFICACION);
    if (rectificacionActiva) motivos.push('RECTIFICACION_EN_CURSO');
    return [...new Set(motivos)];
};

const consultarDatosEspecificos = async (executor, certificadoId, tipo) => {
    if (tipo === 'GNV') {
        const cab = await executor.query('SELECT * FROM fg_certificado_gnv WHERE certificado_id = $1', [certificadoId]);
        const componentes = await executor.query(
            'SELECT * FROM fg_certificado_gnv_componente WHERE certificado_id = $1 ORDER BY orden',
            [certificadoId]
        );
        const verificaciones = await executor.query(
            'SELECT * FROM fg_certificado_gnv_verificacion WHERE certificado_id = $1 ORDER BY orden',
            [certificadoId]
        );
        return {
            especifico: cab.rows[0] || null,
            componentes: componentes.rows,
            verificaciones: verificaciones.rows
        };
    }
    if (tipo === 'GLP') {
        const cab = await executor.query('SELECT * FROM fg_certificado_glp WHERE certificado_id = $1', [certificadoId]);
        const componentes = await executor.query(
            'SELECT * FROM fg_certificado_glp_componente WHERE certificado_id = $1 ORDER BY orden',
            [certificadoId]
        );
        const verificaciones = await executor.query(
            'SELECT * FROM fg_certificado_glp_verificacion WHERE certificado_id = $1 ORDER BY orden',
            [certificadoId]
        );
        return {
            especifico: cab.rows[0] || null,
            componentes: componentes.rows,
            verificaciones: verificaciones.rows
        };
    }
    if (tipo === 'CONFORMIDAD') {
        const cab = await executor.query('SELECT * FROM fg_certificado_conformidad WHERE certificado_id = $1', [certificadoId]);
        return { especifico: cab.rows[0] || null, componentes: [], verificaciones: [] };
    }
    return { especifico: null, componentes: [], verificaciones: [] };
};

const cargarSnapshotTecnico = async (executor, cert, usuario, versionBase) => {
    const vehiculoRes = await executor.query(
        'SELECT * FROM fg_certificado_vehiculo WHERE certificado_id = $1',
        [cert.id]
    );
    const titularesRes = await executor.query(
        'SELECT * FROM fg_certificado_titular WHERE certificado_id = $1 ORDER BY orden, id',
        [cert.id]
    );
    const tipo = tipoEspecifico(cert.tipo_certificado_clave);
    const especificos = await consultarDatosEspecificos(executor, cert.id, tipo);
    const chipRes = await executor.query(`
        SELECT ch.id, ch.numero_chip, ch.estado, ch.producto_inventariable_id
        FROM fg_certificado_chip cc
        JOIN fg_chip ch ON ch.id = cc.chip_id
        WHERE cc.certificado_id = $1
        ORDER BY cc.fecha_asociacion DESC
        LIMIT 1
    `, [cert.id]);

    return construirSnapshotVersion({
        versionBase,
        usuario,
        borrador: {
            id: cert.id,
            numeroCertificado: cert.numero_certificado,
            numero_certificado: cert.numero_certificado,
            tipo: { clave: cert.tipo_certificado_clave, nombre: cert.tipo_nombre },
            tipoCertificado: cert.tipo_certificado_clave,
            empresaKey: cert.empresa_key,
            planta: { key: cert.planta_key, nombre: cert.planta_nombre },
            plantaKey: cert.planta_key,
            fechaEmision: cert.fecha_emision,
            fechaEmisionOriginal: cert.fecha_emision,
            estado: cert.estado,
            observaciones: cert.observaciones,
            entidadCertificadoraNombre: cert.entidad_certificadora_nombre,
            resolucionDirectoral: cert.resolucion_directoral,
            domicilioFiscal: cert.domicilio_fiscal,
            telefonoCertificadora: cert.telefono_certificadora,
            lugarEmision: cert.lugar_emision,
            tarifaCodigo: cert.tarifa_codigo,
            formatoVersionId: cert.formato_version_id,
            formatoDatosSnapshot: cert.formato_datos_snapshot || {},
            cliente: {
                id: cert.cliente_id,
                tipoDocumento: cert.cliente_tipo_doc,
                nroDocumento: cert.cliente_nro_doc,
                nombreRazonSocial: cert.cliente_nombre
            },
            chipSeleccion: chipRes.rows[0] || null,
            vehiculo: vehiculoRes.rows[0] || {},
            titulares: titularesRes.rows,
            especifico: especificos.especifico,
            componentes: especificos.componentes,
            verificaciones: especificos.verificaciones
        }
    });
};

const mapearVersion = (row) => ({
    id: Number(row.id),
    certificadoId: Number(row.certificado_id),
    solicitudId: row.solicitud_id === null ? null : Number(row.solicitud_id),
    numeroVersion: Number(row.numero_version),
    estadoVersion: row.estado_version,
    esVigente: row.es_vigente === true,
    fechaEmisionOriginal: row.fecha_emision_original,
    fechaVersion: row.fecha_version,
    fechaAplicacionOficial: row.fecha_aplicacion_oficial,
    usuarioCreacion: row.usuario_creacion,
    usuarioAprobacion: row.usuario_aprobacion,
    motivo: row.motivo,
    diferencias: row.diferencias || [],
    enlacePdfOriginal: row.enlace_pdf_original,
    enlacePdfVersion: row.enlace_pdf_version,
    metadatos: row.metadatos || null,
    snapshot: row.snapshot_datos || null
});

const mapearSolicitudRectificacion = (row) => ({
    id: Number(row.id),
    tipoOperacion: row.tipo_operacion,
    certificadoId: row.certificado_id === null ? null : Number(row.certificado_id),
    facturacionId: row.facturacion_id === null ? null : Number(row.facturacion_id),
    empresaKey: row.empresa_key,
    plantaKey: row.planta_key,
    usuarioSolicitante: row.usuario_solicitante,
    motivo: row.motivo,
    observaciones: row.observaciones,
    estado: row.estado,
    usuarioDecision: row.usuario_decision,
    fechaSolicitud: row.fecha_solicitud,
    fechaDecision: row.fecha_decision,
    justificacionDecision: row.justificacion_decision,
    datosOriginalesCertificado: row.datos_originales_certificado,
    datosPropuestos: row.datos_propuestos,
    fechaEmisionOriginal: row.fecha_emision_original,
    resultadoTecnico: row.resultado_tecnico,
    usuarioEjecucion: row.usuario_ejecucion,
    fechaEjecucion: row.fecha_ejecucion,
    autorizacionAutoejecucion: row.autorizacion_autoejecucion === true,
    version: Number(row.version || 1)
});

const construirRespuestaContexto = ({
    cert,
    snapshot,
    comprobante,
    activas,
    permisos,
    versiones
}) => {
    const bloqueos = motivosBloqueoRectificacion(cert, activas);
    const tipo = tipoEspecifico(cert?.tipo_certificado_clave);
    const rectificacionActiva = activas.find((s) => s.tipo_operacion === TIPO_RECTIFICACION) || null;
    return {
        certificado: {
            id: Number(cert.id),
            numeroCertificado: cert.numero_certificado,
            tipoCertificado: cert.tipo_certificado_clave,
            tipoNombre: cert.tipo_nombre,
            estado: cert.estado,
            fechaEmision: cert.fecha_emision,
            empresaKey: cert.empresa_key,
            empresaNombre: cert.empresa_nombre,
            plantaKey: cert.planta_key,
            plantaNombre: cert.planta_nombre,
            observaciones: cert.observaciones
        },
        comprobanteAsociado: comprobante,
        snapshotTecnico: snapshot,
        datosActuales: snapshot,
        camposRectificables: [
            ...CAMPOS_VEHICULO,
            ...CAMPOS_TITULAR,
            'titular_nombre',
            'observaciones',
            ...(tipo ? CAMPOS_ESPECIFICOS[tipo] : []),
            'componentes',
            'verificaciones',
            'datosFormato'
        ],
        permiteRectificar: bloqueos.length === 0,
        motivosBloqueo: bloqueos,
        rectificacionActiva: rectificacionActiva ? {
            id: Number(rectificacionActiva.id),
            estado: rectificacionActiva.estado,
            usuarioSolicitante: rectificacionActiva.usuario_solicitante,
            fechaSolicitud: rectificacionActiva.fecha_solicitud
        } : null,
        permisos: {
            solicitar: tienePermiso(permisos, PERMISOS_SOLICITUD.CREAR),
            aprobar: tienePermiso(permisos, PERMISOS_SOLICITUD.APROBAR),
            ejecutar: tienePermiso(permisos, PERMISOS_SOLICITUD.EJECUTAR_RECTIFICACION_CERTIFICADO),
            rectificarDirectamente: permisos.has(PERMISOS_SOLICITUD.EJECUTAR_RECTIFICACION_CERTIFICADO),
            verHistorial: tienePermiso(permisos, PERMISOS_SOLICITUD.VER)
                || tienePermiso(permisos, PERMISOS_SOLICITUD.EJECUTAR_RECTIFICACION_CERTIFICADO)
        },
        versiones: versiones.map(mapearVersion),
        gestionExterna: {
            aplicaLocalmente: true,
            nota: 'La rectificación actualiza el certificado FAREGAS y su PDF. No modifica SUNARP, MTC, la tarjeta vehicular ni registros oficiales externos. Si el campo corregido ya fue comunicado a una entidad externa, deberá tramitarse la actualización por el canal oficial correspondiente.'
        }
    };
};

const obtenerContextoRectificacion = async (certificadoId, userContext) => {
    const id = enteroPositivo(certificadoId, 'CERTIFICADO_ID_INVALIDO');
    const usuario = await obtenerUsuarioActual(db, userContext);
    const certRes = await db.query(consultaCertificadoBase(false), [id]);
    if (certRes.rowCount === 0) throw errorNegocio('CERTIFICADO_NO_ENCONTRADO', 404);
    const cert = certRes.rows[0];
    await validarAccesoPlanta(db, usuario, cert.planta_key);
    const permisos = await obtenerPermisos(db, usuario.perfil_id);
    // Un cajero con permiso de creación debe poder preparar la solicitud aunque
    // no tenga acceso al listado administrativo de solicitudes.
    if (!tienePermiso(permisos, PERMISOS_SOLICITUD.VER)
        && !tienePermiso(permisos, PERMISOS_SOLICITUD.CREAR)
        && !tienePermiso(permisos, PERMISOS_SOLICITUD.EJECUTAR_RECTIFICACION_CERTIFICADO)) {
        throw errorNegocio('SOLICITUD_PERMISO_DENEGADO', 403, { permiso: PERMISOS_SOLICITUD.VER });
    }

    const versionBase = await obtenerVersionActual(db, id);
    const snapshot = await cargarSnapshotTecnico(db, cert, usuario.username, versionBase);
    const comprobante = await obtenerComprobanteAsociado(db, id);
    const activas = await obtenerSolicitudesActivas(db, id);
    const versionesRes = await db.query(`
        SELECT *
        FROM fg_certificado_version
        WHERE certificado_id = $1
        ORDER BY numero_version ASC
    `, [id]);

    return construirRespuestaContexto({
        cert,
        snapshot,
        comprobante,
        activas,
        permisos,
        versiones: versionesRes.rows
    });
};

const obtenerHistorialRectificacion = async (certificadoId, userContext) => {
    const id = enteroPositivo(certificadoId, 'CERTIFICADO_ID_INVALIDO');
    const usuario = await obtenerUsuarioActual(db, userContext);
    const certRes = await db.query(consultaCertificadoBase(false), [id]);
    if (certRes.rowCount === 0) throw errorNegocio('CERTIFICADO_NO_ENCONTRADO', 404);
    const cert = certRes.rows[0];
    await validarAccesoPlanta(db, usuario, cert.planta_key);
    const permisos = await obtenerPermisos(db, usuario.perfil_id);
    if (!tienePermiso(permisos, PERMISOS_SOLICITUD.VER)
        && !tienePermiso(permisos, PERMISOS_SOLICITUD.EJECUTAR_RECTIFICACION_CERTIFICADO)) {
        throw errorNegocio('SOLICITUD_PERMISO_DENEGADO', 403, { permiso: PERMISOS_SOLICITUD.VER });
    }

    const [versiones, solicitudes, eventos] = await Promise.all([
        db.query(`SELECT * FROM fg_certificado_version WHERE certificado_id = $1 ORDER BY numero_version ASC`, [id]),
        db.query(`
            SELECT *
            FROM fg_solicitud_operacion
            WHERE certificado_id = $1 AND tipo_operacion = $2
            ORDER BY id DESC
        `, [id, TIPO_RECTIFICACION]),
        db.query(`
            SELECT ev.*
            FROM fg_solicitud_operacion_evento ev
            JOIN fg_solicitud_operacion s ON s.id = ev.solicitud_id
            WHERE s.certificado_id = $1 AND s.tipo_operacion = $2
            ORDER BY ev.id ASC
        `, [id, TIPO_RECTIFICACION])
    ]);

    return {
        certificadoId: id,
        versiones: versiones.rows.map(mapearVersion),
        solicitudes: solicitudes.rows.map(mapearSolicitudRectificacion),
        eventos: eventos.rows.map((row) => ({
            id: Number(row.id),
            solicitudId: Number(row.solicitud_id),
            tipoEvento: row.tipo_evento,
            estadoAnterior: row.estado_anterior,
            estadoNuevo: row.estado_posterior,
            usuario: row.usuario_responsable,
            detalle: row.comentario,
            metadatos: row.metadatos || null,
            fecha: row.fecha_evento || null
        }))
    };
};

const validarPropuestaParaTipo = (datosPropuestos, tipo) => {
    if (!datosPropuestos || typeof datosPropuestos !== 'object' || Array.isArray(datosPropuestos)
        || Object.keys(datosPropuestos).length === 0) {
        throw errorNegocio('DATOS_PROPUESTOS_REQUERIDOS');
    }
    const serializado = JSON.stringify(datosPropuestos);
    if (serializado.length > 60000) throw errorNegocio('DATOS_PROPUESTOS_DEMASIADO_GRANDES');

    const permitidos = new Set([
        ...CAMPOS_VEHICULO,
        ...CAMPOS_TITULAR,
        'titular_nombre',
        'observaciones',
        'componentes',
        'verificaciones',
        'datosFormato',
        ...(tipo ? CAMPOS_ESPECIFICOS[tipo] : [])
    ]);
    const prohibidos = /(password|contras|token|secret|credencial|correlativo|numero_certificado|fecha_emision|empresa_key|planta_key|estado|id|facturacion|comprobante|pago|precio|importe|igv|moneda|ruc_emisor)$/i;
    Object.keys(datosPropuestos).forEach((campo) => {
        if (prohibidos.test(campo)) throw errorNegocio('DATO_PROPUESTO_PROHIBIDO', 400, { campo });
        if (!permitidos.has(campo)) throw errorNegocio('CAMPO_NO_RECTIFICABLE', 400, { campo });
    });
    if (datosPropuestos.componentes !== undefined && !Array.isArray(datosPropuestos.componentes)) {
        throw errorNegocio('COMPONENTES_INVALIDOS');
    }
    if (datosPropuestos.verificaciones !== undefined && !Array.isArray(datosPropuestos.verificaciones)) {
        throw errorNegocio('VERIFICACIONES_INVALIDAS');
    }
    if (datosPropuestos.datosFormato !== undefined
        && (!datosPropuestos.datosFormato || typeof datosPropuestos.datosFormato !== 'object' || Array.isArray(datosPropuestos.datosFormato))) {
        throw errorNegocio('DATOS_FORMATO_INVALIDOS');
    }
    return datosPropuestos;
};

const validarRectificacionElegible = async (executor, cert, activas, opciones = {}) => {
    const bloqueos = motivosBloqueoRectificacion(cert, activas)
        .filter((motivo) => opciones.ignorarRectificacionActiva && motivo === 'RECTIFICACION_EN_CURSO'
            ? false
            : true);
    if (bloqueos.length > 0) {
        throw errorNegocio('CERTIFICADO_NO_DISPONIBLE_PARA_RECTIFICACION', 409, { motivos: bloqueos });
    }
};

const previsualizarRectificacion = async (certificadoId, datosPropuestos, userContext) => {
    const id = enteroPositivo(certificadoId, 'CERTIFICADO_ID_INVALIDO');
    const usuario = await obtenerUsuarioActual(db, userContext);
    const certRes = await db.query(consultaCertificadoBase(false), [id]);
    if (certRes.rowCount === 0) throw errorNegocio('CERTIFICADO_NO_ENCONTRADO', 404);
    const cert = certRes.rows[0];
    await validarAccesoPlanta(db, usuario, cert.planta_key);
    const permisos = await obtenerPermisos(db, usuario.perfil_id);
    // El solicitante necesita CREAR; el ejecutor autorizado puede previsualizar
    // durante la ejecución aunque no tenga permiso para crear solicitudes.
    if (!tienePermiso(permisos, PERMISOS_SOLICITUD.CREAR)
        && !tienePermiso(permisos, PERMISOS_SOLICITUD.EJECUTAR_RECTIFICACION_CERTIFICADO)) {
        throw errorNegocio('SOLICITUD_PERMISO_DENEGADO', 403, { permiso: PERMISOS_SOLICITUD.CREAR });
    }
    const activas = await obtenerSolicitudesActivas(db, id);
    await validarRectificacionElegible(db, cert, activas, { ignorarRectificacionActiva: true });

    const tipo = tipoEspecifico(cert.tipo_certificado_clave);
    const datos = validarPropuestaParaTipo(datosPropuestos, tipo);
    const versionBase = await obtenerVersionActual(db, id);
    const snapshot = await cargarSnapshotTecnico(db, cert, usuario.username, versionBase);
    const diferencias = calcularDiferenciasRectificacion(snapshot, datos);
    if (diferencias.length === 0) throw errorNegocio('SIN_CAMBIOS_PARA_RECTIFICAR', 400);
    const preview = await certificadosService.previsualizarRectificacion(id, datos, userContext);
    return {
        ...preview,
        diferencias,
        advertencias: advertenciasGestionExterna(diferencias),
        datosPropuestos: datos,
        fechaEmisionOriginal: cert.fecha_emision,
        numeroCertificado: cert.numero_certificado
    };
};

const crearSolicitudRectificacion = async (certificadoId, entrada, userContext, opciones = {}) => conTransaccion(async (client) => {
    const id = enteroPositivo(certificadoId, 'CERTIFICADO_ID_INVALIDO');
    const usuario = await obtenerUsuarioActual(client, userContext);
    const permisos = await obtenerPermisos(client, usuario.perfil_id);
    const rectificacionDirecta = opciones.directa === true;
    if (rectificacionDirecta) {
        exigirPermisoExplicito(permisos, PERMISOS_SOLICITUD.EJECUTAR_RECTIFICACION_CERTIFICADO);
    } else {
        exigirPermiso(permisos, PERMISOS_SOLICITUD.CREAR);
    }

    const motivo = texto(entrada?.motivo, 500, true);
    const observaciones = texto(entrada?.observaciones, 2000);
    const idempotenciaClave = normalizarUuid(entrada?.idempotenciaClave);
    const datosPropuestos = entrada?.datosPropuestos;

    // La clave es única por usuario; no debe revelar ni reutilizar solicitudes
    // creadas por terceros que casualmente usaran el mismo UUID.
    const existente = await client.query(`
        SELECT *
        FROM fg_solicitud_operacion
        WHERE idempotencia_clave = $1
          AND usuario_solicitante = $2
        LIMIT 1
    `, [idempotenciaClave, usuario.username]);
    if (existente.rowCount > 0) {
        const row = existente.rows[0];
        if (Number(row.certificado_id) !== id || row.tipo_operacion !== TIPO_RECTIFICACION) {
            throw errorNegocio('IDEMPOTENCIA_CONFLICTIVA', 409);
        }
        return { solicitud: mapearSolicitudRectificacion(row), creada: false };
    }

    const certRes = await client.query(consultaCertificadoBase(true), [id]);
    if (certRes.rowCount === 0) throw errorNegocio('CERTIFICADO_NO_ENCONTRADO', 404);
    const cert = certRes.rows[0];
    await validarAccesoPlanta(client, usuario, cert.planta_key);
    const activas = await obtenerSolicitudesActivas(client, id);
    await validarRectificacionElegible(client, cert, activas);

    const tipo = tipoEspecifico(cert.tipo_certificado_clave);
    const datos = validarPropuestaParaTipo(datosPropuestos, tipo);
    const versionBase = await obtenerVersionActual(client, id);
    const snapshot = await cargarSnapshotTecnico(client, cert, usuario.username, versionBase);
    const diferencias = calcularDiferenciasRectificacion(snapshot, datos);
    if (diferencias.length === 0) throw errorNegocio('SIN_CAMBIOS_PARA_RECTIFICAR', 400);
    const advertencias = advertenciasGestionExterna(diferencias);
    const comprobante = await obtenerComprobanteAsociado(client, id);

    let insert;
    try {
        insert = await client.query(`
            INSERT INTO fg_solicitud_operacion (
                tipo_operacion, certificado_id, facturacion_id, empresa_key, planta_key,
                usuario_solicitante, motivo, observaciones, estado,
                usuario_decision, fecha_decision, justificacion_decision,
                datos_originales_certificado, datos_originales_comprobante,
                datos_propuestos, fecha_emision_original, idempotencia_clave,
                autorizacion_autoejecucion, version
            ) VALUES (
                $1, $2, $3, $4, $5,
                $6, $7, $8, $9,
                $10, CASE WHEN $10::varchar IS NULL THEN NULL ELSE clock_timestamp() END, $11,
                $12::jsonb, $13::jsonb,
                $14::jsonb, $15, $16,
                $17, 1
            )
            ON CONFLICT (usuario_solicitante, idempotencia_clave) DO NOTHING
            RETURNING *
        `, [
            TIPO_RECTIFICACION,
            id,
            comprobante?.id || null,
            cert.empresa_key,
            cert.planta_key,
            usuario.username,
            motivo,
            observaciones,
            rectificacionDirecta ? 'APROBADA' : 'PENDIENTE_APROBACION',
            rectificacionDirecta ? usuario.username : null,
            rectificacionDirecta ? 'Rectificación directa autorizada por permiso técnico explícito.' : null,
            JSON.stringify(snapshot),
            JSON.stringify(comprobante ? copiaProfunda(comprobante) : null),
            JSON.stringify(datos),
            cert.fecha_emision,
            idempotenciaClave,
            rectificacionDirecta
        ]);
    } catch (error) {
        if (error?.code === '23505') {
            throw errorNegocio('RECTIFICACION_EN_CURSO', 409);
        }
        throw error;
    }

    if (insert.rowCount === 0) {
        const repetida = await client.query(`
            SELECT *
            FROM fg_solicitud_operacion
            WHERE usuario_solicitante = $1
              AND idempotencia_clave = $2
            LIMIT 1
        `, [usuario.username, idempotenciaClave]);
        const row = repetida.rows[0];
        if (!row || Number(row.certificado_id) !== id || row.tipo_operacion !== TIPO_RECTIFICACION) {
            throw errorNegocio('IDEMPOTENCIA_CONFLICTIVA', 409);
        }
        return { solicitud: mapearSolicitudRectificacion(row), creada: false, directa: rectificacionDirecta };
    }

    const row = insert.rows[0];
    await client.query(`
        INSERT INTO fg_solicitud_operacion_evento (
            solicitud_id, tipo_evento, estado_anterior, estado_posterior,
            usuario_responsable, comentario, metadatos
        ) VALUES ($1, $2, NULL, $3, $4, $5, $6::jsonb)
    `, [
        row.id,
        rectificacionDirecta ? 'RECTIFICACION_DIRECTA_INICIADA' : 'SOLICITUD_CREADA',
        rectificacionDirecta ? 'APROBADA' : 'PENDIENTE_APROBACION',
        usuario.username,
        rectificacionDirecta
            ? 'Rectificación directa iniciada sin cambios fiscales ni aprobación externa.'
            : 'Solicitud de rectificación técnica creada sin cambios fiscales.',
        JSON.stringify({
            tipoOperacion: TIPO_RECTIFICACION,
            flujo: rectificacionDirecta ? 'DIRECTO' : 'ADMINISTRATIVO',
            certificadoId: id,
            numeroCertificado: cert.numero_certificado,
            fechaEmisionOriginal: cert.fecha_emision,
            diferencias,
            advertencias,
            comprobanteId: comprobante?.id || null
        })
    ]);

    return {
        solicitud: mapearSolicitudRectificacion(row),
        diferencias,
        advertencias,
        creada: true,
        directa: rectificacionDirecta
    };
});

const ejecutarRectificacionDirecta = async (certificadoId, entrada, userContext) => {
    const preparacion = await crearSolicitudRectificacion(certificadoId, entrada, userContext, { directa: true });
    const ejecucion = await ejecutarRectificacionSolicitud(preparacion.solicitud.id, {
        version: preparacion.solicitud.version,
        idempotenciaEjecucion: entrada?.idempotenciaClave
    }, userContext);
    return {
        ...ejecucion,
        directa: true,
        registroCreado: preparacion.creada === true,
        diferencias: preparacion.diferencias || ejecucion.resultado?.diferencias || [],
        advertencias: preparacion.advertencias || ejecucion.resultado?.advertencias || []
    };
};

const upsertVehiculo = async (client, certificadoId, vehiculo = {}) => {
    const columnas = CAMPOS_VEHICULO;
    const valores = columnas.map((campo) => textoONull(vehiculo[campo]));
    const placeholders = valores.map((_, indice) => `$${indice + 2}`);
    const updates = columnas.map((campo, indice) => `${campo} = $${indice + 2}`);
    await client.query(`
        INSERT INTO fg_certificado_vehiculo (certificado_id, ${columnas.join(', ')})
        VALUES ($1, ${placeholders.join(', ')})
        ON CONFLICT (certificado_id) DO UPDATE SET
            ${updates.join(',\n            ')}
    `, [certificadoId, ...valores]);
};

const upsertTitulares = async (client, certificadoId, titulares = []) => {
    const lista = Array.isArray(titulares) ? titulares : [];
    for (const titular of lista) {
        const campos = ['tipo_documento', 'nro_documento', 'nombre_razon_social', 'direccion'];
        const valores = campos.map((campo) => textoONull(titular[campo]));
        if (titular.id) {
            await client.query(`
                UPDATE fg_certificado_titular
                SET tipo_documento = $2, nro_documento = $3,
                    nombre_razon_social = COALESCE($4, nombre_razon_social), direccion = $5
                WHERE id = $1 AND certificado_id = $6
            `, [Number(titular.id), ...valores, certificadoId]);
        } else {
            const orden = Number(titular.orden || 1) || 1;
            const existente = await client.query(`
                SELECT id FROM fg_certificado_titular
                WHERE certificado_id = $1 AND orden = $2
                LIMIT 1
            `, [certificadoId, orden]);
            if (existente.rowCount > 0) {
                await client.query(`
                    UPDATE fg_certificado_titular
                    SET tipo_documento = $2, nro_documento = $3,
                        nombre_razon_social = COALESCE($4, nombre_razon_social), direccion = $5
                    WHERE id = $1
                `, [existente.rows[0].id, ...valores]);
            } else {
                await client.query(`
                    INSERT INTO fg_certificado_titular (
                        certificado_id, orden, tipo_documento, nro_documento,
                        nombre_razon_social, direccion
                    ) VALUES ($1, $2, $3, $4, $5, $6)
                `, [certificadoId, orden, valores[0], valores[1], valores[2], valores[3]]);
            }
        }
    }
};

const upsertEspecifico = async (client, certificadoId, tipo, especifico = {}) => {
    if (tipo === 'GNV') {
        await client.query(`
            INSERT INTO fg_certificado_gnv (
                certificado_id, taller_autorizado_id, vigencia_hasta, taller_razon_social,
                taller_sede, taller_direccion, taller_codigo_autorizacion, modalidad,
                numero_chip, combustible_posterior, peso_neto_posterior, observaciones,
                taller_planta_key
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
            ON CONFLICT (certificado_id) DO UPDATE SET
                taller_autorizado_id = EXCLUDED.taller_autorizado_id,
                vigencia_hasta = EXCLUDED.vigencia_hasta,
                taller_razon_social = EXCLUDED.taller_razon_social,
                taller_sede = EXCLUDED.taller_sede,
                taller_direccion = EXCLUDED.taller_direccion,
                taller_codigo_autorizacion = EXCLUDED.taller_codigo_autorizacion,
                modalidad = EXCLUDED.modalidad,
                numero_chip = EXCLUDED.numero_chip,
                combustible_posterior = EXCLUDED.combustible_posterior,
                peso_neto_posterior = EXCLUDED.peso_neto_posterior,
                observaciones = EXCLUDED.observaciones,
                taller_planta_key = EXCLUDED.taller_planta_key
        `, [
            certificadoId,
            especifico.taller_autorizado_id ? Number(especifico.taller_autorizado_id) : null,
            fechaIsoONull(especifico.vigencia_hasta),
            textoONull(especifico.taller_razon_social),
            textoONull(especifico.taller_sede),
            textoONull(especifico.taller_direccion),
            textoONull(especifico.taller_codigo_autorizacion),
            textoONull(especifico.modalidad),
            textoONull(especifico.numero_chip),
            textoONull(especifico.combustible_posterior),
            textoONull(especifico.peso_neto_posterior),
            textoONull(especifico.observaciones),
            textoONull(especifico.taller_planta_key)
        ]);
        return;
    }
    if (tipo === 'GLP') {
        await client.query(`
            INSERT INTO fg_certificado_glp (
                certificado_id, taller_autorizado_id, expediente_tecnico, vigencia_hasta,
                taller_razon_social, taller_sede, taller_direccion,
                taller_codigo_autorizacion, modalidad, combustible_posterior,
                peso_neto_posterior, carga_util_posterior
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            ON CONFLICT (certificado_id) DO UPDATE SET
                taller_autorizado_id = EXCLUDED.taller_autorizado_id,
                expediente_tecnico = EXCLUDED.expediente_tecnico,
                vigencia_hasta = EXCLUDED.vigencia_hasta,
                taller_razon_social = EXCLUDED.taller_razon_social,
                taller_sede = EXCLUDED.taller_sede,
                taller_direccion = EXCLUDED.taller_direccion,
                taller_codigo_autorizacion = EXCLUDED.taller_codigo_autorizacion,
                modalidad = EXCLUDED.modalidad,
                combustible_posterior = EXCLUDED.combustible_posterior,
                peso_neto_posterior = EXCLUDED.peso_neto_posterior,
                carga_util_posterior = EXCLUDED.carga_util_posterior
        `, [
            certificadoId,
            especifico.taller_autorizado_id ? Number(especifico.taller_autorizado_id) : null,
            textoONull(especifico.expediente_tecnico),
            fechaIsoONull(especifico.vigencia_hasta),
            textoONull(especifico.taller_razon_social),
            textoONull(especifico.taller_sede),
            textoONull(especifico.taller_direccion),
            textoONull(especifico.taller_codigo_autorizacion),
            textoONull(especifico.modalidad),
            textoONull(especifico.combustible_posterior),
            textoONull(especifico.peso_neto_posterior),
            textoONull(especifico.carga_util_posterior)
        ]);
        return;
    }
    if (tipo === 'CONFORMIDAD') {
        await client.query(`
            INSERT INTO fg_certificado_conformidad (
                certificado_id, tipo_conformidad, tipo_tramite, caracteristica_registrable,
                motivo, descripcion, uso_original_vehiculo, marca_modificacion,
                marca_montaje, marca_fabricacion
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            ON CONFLICT (certificado_id) DO UPDATE SET
                tipo_conformidad = EXCLUDED.tipo_conformidad,
                tipo_tramite = EXCLUDED.tipo_tramite,
                caracteristica_registrable = EXCLUDED.caracteristica_registrable,
                motivo = EXCLUDED.motivo,
                descripcion = EXCLUDED.descripcion,
                uso_original_vehiculo = EXCLUDED.uso_original_vehiculo,
                marca_modificacion = EXCLUDED.marca_modificacion,
                marca_montaje = EXCLUDED.marca_montaje,
                marca_fabricacion = EXCLUDED.marca_fabricacion
        `, [
            certificadoId,
            textoONull(especifico.tipo_conformidad),
            textoONull(especifico.tipo_tramite),
            textoONull(especifico.caracteristica_registrable),
            textoONull(especifico.motivo),
            textoONull(especifico.descripcion),
            textoONull(especifico.uso_original_vehiculo),
            Boolean(especifico.marca_modificacion),
            Boolean(especifico.marca_montaje),
            Boolean(especifico.marca_fabricacion)
        ]);
    }
};

const reemplazarComponentesYVerificaciones = async (client, certificadoId, tipo, componentes, verificaciones) => {
    if (!['GNV', 'GLP'].includes(tipo)) return;
    const tablaComponente = tipo === 'GNV' ? 'fg_certificado_gnv_componente' : 'fg_certificado_glp_componente';
    const tablaVerificacion = tipo === 'GNV' ? 'fg_certificado_gnv_verificacion' : 'fg_certificado_glp_verificacion';

    if (Array.isArray(componentes)) {
        await client.query(`DELETE FROM ${tablaComponente} WHERE certificado_id = $1`, [certificadoId]);
        for (const [indice, componente] of componentes.entries()) {
            await client.query(`
                INSERT INTO ${tablaComponente} (
                    certificado_id, orden, componente, marca, modelo,
                    capacidad_litros, mes_fabricacion, anio_fabricacion, numero_serie
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            `, [
                certificadoId,
                Number(componente.orden || indice + 1) || indice + 1,
                textoONull(componente.componente) || 'COMPONENTE',
                textoONull(componente.marca),
                textoONull(componente.modelo),
                componente.capacidad_litros === undefined ? null : textoONull(componente.capacidad_litros),
                numeroONull(componente.mes_fabricacion),
                numeroONull(componente.anio_fabricacion),
                textoONull(componente.numero_serie)
            ]);
        }
    }

    if (Array.isArray(verificaciones)) {
        await client.query(`DELETE FROM ${tablaVerificacion} WHERE certificado_id = $1`, [certificadoId]);
        for (const [indice, verificacion] of verificaciones.entries()) {
            await client.query(`
                INSERT INTO ${tablaVerificacion} (
                    certificado_id, codigo, orden, descripcion, cumple, observacion
                ) VALUES ($1, $2, $3, $4, $5, $6)
            `, [
                certificadoId,
                textoONull(verificacion.codigo) || String(indice + 1).padStart(2, '0'),
                Number(verificacion.orden || indice + 1) || indice + 1,
                textoONull(verificacion.descripcion) || 'VERIFICACIÓN',
                verificacion.cumple === null || verificacion.cumple === undefined
                    ? null
                    : Boolean(verificacion.cumple),
                textoONull(verificacion.observacion)
            ]);
        }
    }
};

const aplicarSnapshotTecnico = async (client, certificadoId, snapshot, usuario) => {
    const tipo = tipoEspecifico(snapshot?.tipoCertificado);
    await client.query(`
        UPDATE fg_certificado
        SET observaciones = $2,
            formato_datos_snapshot = $3::jsonb,
            usuario_modificacion = $4,
            fecha_modificacion = CURRENT_TIMESTAMP
        WHERE id = $1
          AND estado = 'EMITIDO'
          AND fecha_anulacion IS NULL
    `, [
        certificadoId,
        textoONull(snapshot.observaciones),
        JSON.stringify(snapshot.formatoDatosSnapshot || {}),
        usuario
    ]);
    await upsertVehiculo(client, certificadoId, snapshot.vehiculo || {});
    await upsertTitulares(client, certificadoId, snapshot.titulares || []);
    await upsertEspecifico(client, certificadoId, tipo, snapshot.especifico || {});
    await reemplazarComponentesYVerificaciones(
        client,
        certificadoId,
        tipo,
        normalizarComponentes(snapshot.componentes || []),
        normalizarVerificaciones(snapshot.verificaciones || [])
    );
};

const asegurarVersionOriginal = async (client, cert, snapshot, usuario, pdfOriginal) => {
    const existente = await client.query(`
        SELECT *
        FROM fg_certificado_version
        WHERE certificado_id = $1 AND estado_version = 'ORIGINAL'
        ORDER BY numero_version ASC
        LIMIT 1
    `, [cert.id]);
    if (existente.rowCount > 0) {
        const version = existente.rows[0];
        if (!version.enlace_pdf_original && pdfOriginal?.enlace) {
            await client.query(`
                UPDATE fg_certificado_version
                SET enlace_pdf_original = $2
                WHERE id = $1
            `, [version.id, pdfOriginal.enlace]);
            version.enlace_pdf_original = pdfOriginal.enlace;
        }
        return version;
    }

    const insert = await client.query(`
        INSERT INTO fg_certificado_version (
            certificado_id, solicitud_id, numero_version, estado_version, es_vigente,
            fecha_emision_original, usuario_creacion, motivo, snapshot_datos,
            diferencias, enlace_pdf_original, metadatos
        ) VALUES (
            $1, NULL, 1, 'ORIGINAL', TRUE,
            $2, $3, $4, $5::jsonb, NULL, $6, $7::jsonb
        )
        RETURNING *
    `, [
        cert.id,
        cert.fecha_emision,
        cert.usuario_creacion || usuario,
        'Versión original conservada al iniciar la rectificación.',
        JSON.stringify(snapshot),
        pdfOriginal?.enlace || null,
        JSON.stringify({ origen: 'RECTIFICACION', usuario })
    ]);
    return insert.rows[0];
};

const ejecutarRectificacionSolicitud = async (solicitudId, entrada, userContext) => {
    const archivosGenerados = [];
    try {
        return await conTransaccion(async (client) => {
            const id = enteroPositivo(solicitudId, 'SOLICITUD_ID_INVALIDO');
            const usuario = await obtenerUsuarioActual(client, userContext);
            const permisos = await obtenerPermisos(client, usuario.perfil_id);
            exigirPermiso(permisos, PERMISOS_SOLICITUD.EJECUTAR_RECTIFICACION_CERTIFICADO);

            const solicitudRes = await client.query(`
                SELECT s.*
                FROM fg_solicitud_operacion s
                WHERE s.id = $1
                FOR UPDATE OF s
            `, [id]);
            if (solicitudRes.rowCount === 0) throw errorNegocio('SOLICITUD_NO_ENCONTRADA', 404);
            const solicitud = solicitudRes.rows[0];
            if (solicitud.tipo_operacion !== TIPO_RECTIFICACION) {
                throw errorNegocio('SOLICITUD_TIPO_NO_RECTIFICACION', 409);
            }
            await validarAccesoPlanta(client, usuario, solicitud.planta_key);

            if (solicitud.estado === 'COMPLETADA') {
                return {
                    solicitud: mapearSolicitudRectificacion(solicitud),
                    yaCompletada: true,
                    ...(solicitud.resultado_tecnico || {})
                };
            }
            if (solicitud.estado !== 'APROBADA') {
                throw errorNegocio('SOLICITUD_NO_APROBADA', 409, { estado: solicitud.estado });
            }
            const versionEsperada = entrada?.version === undefined ? null : Number(entrada.version);
            if (versionEsperada !== null && versionEsperada !== Number(solicitud.version)) {
                throw errorNegocio('SOLICITUD_VERSION_DESACTUALIZADA', 409, {
                    versionActual: Number(solicitud.version),
                    versionEnviada: versionEsperada
                });
            }

            const certRes = await client.query(consultaCertificadoBase(true), [Number(solicitud.certificado_id)]);
            if (certRes.rowCount === 0) throw errorNegocio('CERTIFICADO_NO_ENCONTRADO', 404);
            const cert = certRes.rows[0];
            const activas = await obtenerSolicitudesActivas(client, cert.id);
            await validarRectificacionElegible(client, cert, activas, { ignorarRectificacionActiva: true });

            const versionBaseActual = await obtenerVersionActual(client, cert.id);
            const snapshotSolicitud = solicitud.datos_originales_certificado || {};
            const versionBaseSolicitud = Number(snapshotSolicitud.versionBase || 1);
            if (versionBaseActual !== versionBaseSolicitud) {
                throw errorNegocio('CERTIFICADO_MODIFICADO_DESDE_SOLICITUD', 409, {
                    versionActual: versionBaseActual,
                    versionSolicitud: versionBaseSolicitud
                });
            }
            if (snapshotSolicitud.numeroCertificado !== cert.numero_certificado
                || String(snapshotSolicitud.fechaEmisionOriginal || '') !== String(cert.fecha_emision || '')) {
                throw errorNegocio('CERTIFICADO_MODIFICADO_DESDE_SOLICITUD', 409);
            }

            const snapshotActual = await cargarSnapshotTecnico(client, cert, usuario.username, versionBaseActual);
            const datosPropuestos = validarPropuestaParaTipo(
                solicitud.datos_propuestos,
                tipoEspecifico(cert.tipo_certificado_clave)
            );
            const diferencias = calcularDiferenciasRectificacion(snapshotActual, datosPropuestos);
            if (diferencias.length === 0) throw errorNegocio('SIN_CAMBIOS_PARA_RECTIFICAR', 409);
            const advertencias = advertenciasGestionExterna(diferencias);

            // La versión original y su PDF son inmutables. Si ya existen no se
            // vuelven a generar, evitando archivos huérfanos en rectificaciones
            // consecutivas.
            const originalExistente = await client.query(`
                SELECT *
                FROM fg_certificado_version
                WHERE certificado_id = $1 AND estado_version = 'ORIGINAL'
                ORDER BY numero_version ASC
                LIMIT 1
            `, [cert.id]);
            const tienePdfOriginal = originalExistente.rowCount > 0
                && Boolean(originalExistente.rows[0].enlace_pdf_original);

            const previewRectificado = await certificadosService.previsualizarRectificacion(
                cert.id,
                datosPropuestos,
                userContext
            );
            const numeroVersion = versionBaseActual + 1;
            let pdfOriginal = null;
            if (!tienePdfOriginal) {
                const previewOriginal = await certificadosService.obtenerPrevisualizacion(cert.id, userContext);
                pdfOriginal = await pdfVersionService.generarPdfVersionPersistente({
                    html: previewOriginal.html,
                    certificadoId: cert.id,
                    numeroCertificado: cert.numero_certificado,
                    numeroVersion: `v${versionBaseActual}`,
                    tipo: 'ORIGINAL'
                });
                archivosGenerados.push(pdfOriginal);
            }
            const pdfRectificado = await pdfVersionService.generarPdfVersionPersistente({
                html: previewRectificado.html,
                certificadoId: cert.id,
                numeroCertificado: cert.numero_certificado,
                numeroVersion: `v${numeroVersion}`,
                tipo: 'RECTIFICADA'
            });
            archivosGenerados.push(pdfRectificado);

            const fusion = aplicarPropuestaABorrador({
                ...snapshotActual,
                tipo: { clave: cert.tipo_certificado_clave },
                especifico: snapshotActual.especifico,
                especificoBase: snapshotActual.especifico,
                formatoDatosSnapshot: snapshotActual.formatoDatosSnapshot,
                vehiculo: snapshotActual.vehiculo,
                titulares: snapshotActual.titulares,
                componentes: snapshotActual.componentes,
                verificaciones: snapshotActual.verificaciones
            }, datosPropuestos);
            const snapshotFinal = {
                ...snapshotActual,
                vehiculo: copiaProfunda(fusion.borrador.vehiculo || {}),
                titulares: copiaProfunda(fusion.borrador.titulares || []),
                observaciones: fusion.borrador.observaciones,
                formatoDatosSnapshot: copiaProfunda(fusion.borrador.formatoDatosSnapshot || {}),
                especifico: fusion.borrador.especifico ? copiaProfunda(fusion.borrador.especifico) : null,
                componentes: normalizarComponentes(fusion.borrador.componentes || snapshotActual.componentes || []),
                verificaciones: normalizarVerificaciones(fusion.borrador.verificaciones || snapshotActual.verificaciones || []),
                versionBase: numeroVersion,
                fechaSnapshot: new Date().toISOString(),
                usuarioRectificacion: usuario.username
            };

            const versionOriginal = await asegurarVersionOriginal(
                client,
                cert,
                snapshotActual,
                usuario.username,
                pdfOriginal
            );

            await client.query(`
                UPDATE fg_certificado_version
                SET es_vigente = FALSE,
                    estado_version = 'SUSTITUIDA'
                WHERE certificado_id = $1
                  AND es_vigente = TRUE
            `, [cert.id]);

            const versionInsert = await client.query(`
                INSERT INTO fg_certificado_version (
                    certificado_id, solicitud_id, numero_version, estado_version, es_vigente,
                    fecha_emision_original, fecha_aplicacion_oficial, usuario_creacion,
                    usuario_aprobacion, motivo, snapshot_datos, diferencias,
                    enlace_pdf_original, enlace_pdf_version, metadatos
                ) VALUES (
                    $1, $2, $3, 'VIGENTE', TRUE,
                    $4, clock_timestamp(), $5,
                    $6, $7, $8::jsonb, $9::jsonb,
                    $10, $11, $12::jsonb
                )
                RETURNING *
            `, [
                cert.id,
                solicitud.id,
                numeroVersion,
                cert.fecha_emision,
                solicitud.usuario_solicitante,
                solicitud.usuario_decision,
                solicitud.motivo,
                JSON.stringify(snapshotFinal),
                JSON.stringify(diferencias),
                versionOriginal.enlace_pdf_original || pdfOriginal.enlace,
                pdfRectificado.enlace,
                JSON.stringify({
                    origen: 'RECTIFICACION',
                    versionBase: versionBaseActual,
                    numeroCertificado: cert.numero_certificado,
                    fechaEmisionOriginal: cert.fecha_emision,
                    fechaRectificacion: new Date().toISOString(),
                    usuarioEjecucion: usuario.username,
                    usuarioSolicitante: solicitud.usuario_solicitante,
                    usuarioAprobacion: solicitud.usuario_decision,
                    advertenciasGestionExterna: advertencias,
                    comprobanteAsociadoId: solicitud.facturacion_id,
                    pdfOriginal: versionOriginal.enlace_pdf_original || pdfOriginal.enlace,
                    pdfRectificado: pdfRectificado.enlace
                })
            ])
            ;

            await aplicarSnapshotTecnico(client, cert.id, snapshotFinal, usuario.username);

            const resultadoTecnico = {
                diferencias,
                advertencias,
                fechaAplicacionOficial: new Date().toISOString(),
                version: numeroVersion,
                numeroCertificado: cert.numero_certificado,
                fechaEmisionOriginal: cert.fecha_emision,
                enlacePdfOriginal: versionOriginal.enlace_pdf_original || pdfOriginal.enlace,
                enlacePdfVersion: pdfRectificado.enlace,
                gestionExternaRequerida: advertencias.length > 0,
                facturacionId: solicitud.facturacion_id,
                sinCambiosFiscales: true
            };
            const solicitudActualizada = await client.query(`
                UPDATE fg_solicitud_operacion
                SET estado = 'COMPLETADA',
                    usuario_ejecucion = $2,
                    fecha_ejecucion = clock_timestamp(),
                    idempotencia_ejecucion = $3,
                    resultado_tecnico = $4::jsonb,
                    fecha_modificacion = CURRENT_TIMESTAMP,
                    version = version + 1
                WHERE id = $1
                RETURNING *
            `, [
                solicitud.id,
                usuario.username,
                normalizarUuid(entrada?.idempotenciaEjecucion || crypto.randomUUID()),
                JSON.stringify(resultadoTecnico)
            ]);
            await client.query(`
                INSERT INTO fg_solicitud_operacion_evento (
                    solicitud_id, tipo_evento, estado_anterior, estado_posterior,
                    usuario_responsable, comentario, metadatos
                ) VALUES ($1, 'RECTIFICACION_EJECUTADA', 'APROBADA', 'COMPLETADA', $2, $3, $4::jsonb)
            `, [
                solicitud.id,
                usuario.username,
                'Rectificación técnica aplicada y PDF corregido generado.',
                JSON.stringify(resultadoTecnico)
            ]);

            archivosGenerados.length = 0;
            return {
                solicitud: mapearSolicitudRectificacion(solicitudActualizada.rows[0]),
                version: mapearVersion(versionInsert.rows[0]),
                resultado: resultadoTecnico,
                yaCompletada: false
            };
        });
    } catch (error) {
        archivosGenerados.forEach((archivo) => archivo?.limpiar?.());
        throw error;
    }
};

const descargarPdfVersionRectificacion = async (certificadoId, versionId, userContext) => {
    const cid = enteroPositivo(certificadoId, 'CERTIFICADO_ID_INVALIDO');
    const vid = enteroPositivo(versionId, 'VERSION_ID_INVALIDO');
    const usuario = await obtenerUsuarioActual(db, userContext);
    const certRes = await db.query(consultaCertificadoBase(false), [cid]);
    if (certRes.rowCount === 0) throw errorNegocio('CERTIFICADO_NO_ENCONTRADO', 404);
    await validarAccesoPlanta(db, usuario, certRes.rows[0].planta_key);
    const permisos = await obtenerPermisos(db, usuario.perfil_id);
    if (!tienePermiso(permisos, PERMISOS_SOLICITUD.VER)
        && !tienePermiso(permisos, PERMISOS_SOLICITUD.EJECUTAR_RECTIFICACION_CERTIFICADO)) {
        throw errorNegocio('SOLICITUD_PERMISO_DENEGADO', 403, { permiso: PERMISOS_SOLICITUD.VER });
    }

    const versionRes = await db.query(`
        SELECT *
        FROM fg_certificado_version
        WHERE id = $1 AND certificado_id = $2
        LIMIT 1
    `, [vid, cid]);
    if (versionRes.rowCount === 0) throw errorNegocio('VERSION_CERTIFICADO_NO_ENCONTRADA', 404);
    const version = versionRes.rows[0];
    const enlace = version.enlace_pdf_version || version.enlace_pdf_original;
    const pdfPath = pdfVersionService.resolverRutaAlmacenada(enlace);
    if (!pdfVersionService.existePdf(pdfPath)) {
        throw errorNegocio('PDF_VERSION_NO_DISPONIBLE', 404);
    }
    return {
        pdfPath,
        filename: `CERTIFICADO-${certRes.rows[0].numero_certificado || cid}-v${version.numero_version}.pdf`,
        version: mapearVersion(version)
    };
};

const listarSolicitudesPendientesRectificacion = async (userContext, filtros = {}) => {
    const usuario = await obtenerUsuarioActual(db, userContext);
    const permisos = await obtenerPermisos(db, usuario.perfil_id);
    if (!tienePermiso(permisos, PERMISOS_SOLICITUD.VER)
        && !tienePermiso(permisos, PERMISOS_SOLICITUD.EJECUTAR_RECTIFICACION_CERTIFICADO)) {
        throw errorNegocio('SOLICITUD_PERMISO_DENEGADO', 403, { permiso: PERMISOS_SOLICITUD.VER });
    }
    const estados = filtros.estado ? [String(filtros.estado).toUpperCase()] : ['PENDIENTE_APROBACION', 'APROBADA'];
    const result = await db.query(`
        SELECT s.*, c.numero_certificado, c.fecha_emision
        FROM fg_solicitud_operacion s
        JOIN fg_certificado c ON c.id = s.certificado_id
        JOIN fg_usuario_planta up
          ON up.plantas_key = s.planta_key
         AND up.usuario_username = $1
        JOIN fg_perfil_planta pp
          ON pp.planta_key = s.planta_key
         AND pp.perfil_clave = $2
        WHERE s.tipo_operacion = $3
          AND s.estado = ANY($4::varchar[])
        ORDER BY s.fecha_solicitud DESC
        LIMIT 100
    `, [usuario.username, usuario.perfil_id, TIPO_RECTIFICACION, estados]);
    return result.rows.map((row) => ({
        ...mapearSolicitudRectificacion(row),
        numeroCertificado: row.numero_certificado,
        fechaEmision: row.fecha_emision
    }));
};

module.exports = {
    TIPO_RECTIFICACION,
    obtenerContextoRectificacion,
    obtenerHistorialRectificacion,
    previsualizarRectificacion,
    crearSolicitudRectificacion,
    ejecutarRectificacionDirecta,
    ejecutarRectificacionSolicitud,
    descargarPdfVersionRectificacion,
    listarSolicitudesPendientesRectificacion,
    _private: {
        errorNegocio,
        texto,
        enteroPositivo,
        normalizarUuid,
        exigirPermisoExplicito,
        motivosBloqueoRectificacion,
        cargarSnapshotTecnico,
        validarPropuestaParaTipo,
        aplicarSnapshotTecnico,
        asegurarVersionOriginal,
        obtenerVersionActual
    }
};
