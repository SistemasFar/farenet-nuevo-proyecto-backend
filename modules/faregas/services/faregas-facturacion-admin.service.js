const db = require('../../../config/database');
const authService = require('./faregas-auth.service');

const ESTADOS = new Set([
    'BORRADOR', 'PENDIENTE', 'PENDIENTE_SUNAT', 'ACEPTADO', 'RECHAZADO', 'ERROR', 'ANULADO',
    'PENDIENTE_ANULACION', 'ANULACION_RECHAZADA'
]);
const FECHA_ISO = /^\d{4}-\d{2}-\d{2}$/;

const enteroAcotado = (value, fallback, min, max) => {
    const numero = Number(value);
    return Number.isInteger(numero) ? Math.min(max, Math.max(min, numero)) : fallback;
};

const construirFiltros = (query, plantasPermitidas) => {
    const condiciones = ['COALESCE(f.planta_key, oc.planta_key) = ANY($1::varchar[])'];
    const valores = [plantasPermitidas];
    const agregar = (condicion, valor) => {
        valores.push(valor);
        condiciones.push(condicion.replaceAll('?', `$${valores.length}`));
    };

    const texto = String(query.texto || '').trim();
    const plantaKey = String(query.plantaKey || '').trim();
    const empresaKey = String(query.empresaKey || '').trim();
    const estado = String(query.estado || '').trim().toUpperCase();
    const fechaDesde = String(query.fechaDesde || '').trim();
    const fechaHasta = String(query.fechaHasta || '').trim();

    if (texto) agregar(`(
        f.nro_comprobante ILIKE '%' || ? || '%'
        OR f.nro_documento ILIKE '%' || ? || '%'
        OR f.nombre_razon_social ILIKE '%' || ? || '%'
        OR COALESCE(v.placa, '') ILIKE '%' || ? || '%'
        OR f.certificado_id::text = ?
    )`, texto);
    if (plantaKey) {
        if (!plantasPermitidas.includes(plantaKey)) {
            const error = new Error('PLANTA_NO_AUTORIZADA');
            error.statusCode = 403;
            throw error;
        }
        agregar('COALESCE(f.planta_key, oc.planta_key) = ?', plantaKey);
    }
    if (empresaKey) agregar('p.empresa_key = ?', empresaKey);
    if (estado) {
        if (!ESTADOS.has(estado)) throw Object.assign(new Error('ESTADO_INVALIDO'), { statusCode: 400 });
        if (estado === 'PENDIENTE_ANULACION') {
            condiciones.push("anulacion.estado IN ('BORRADOR', 'PENDIENTE')");
        } else if (estado === 'ANULACION_RECHAZADA') {
            condiciones.push("anulacion.estado IN ('RECHAZADO', 'ERROR')");
        } else if (estado === 'ANULADO') {
            condiciones.push("(f.estado = 'ANULADO' OR anulacion.estado = 'ACEPTADO')");
        } else {
            agregar('f.estado = ?', estado);
        }
    }
    if (fechaDesde) {
        if (!FECHA_ISO.test(fechaDesde)) throw Object.assign(new Error('FECHA_INVALIDA'), { statusCode: 400 });
        agregar('f.fecha_creacion >= ?::date', fechaDesde);
    }
    if (fechaHasta) {
        if (!FECHA_ISO.test(fechaHasta)) throw Object.assign(new Error('FECHA_INVALIDA'), { statusCode: 400 });
        agregar("f.fecha_creacion < (?::date + INTERVAL '1 day')", fechaHasta);
    }

    return { where: condiciones.join(' AND '), valores };
};

const mapDocumento = (row) => ({
    id: Number(row.id),
    certificadoId: row.certificado_id == null ? null : Number(row.certificado_id),
    operacionId: row.operacion_id == null ? null : Number(row.operacion_id),
    origen: row.certificado_id != null
        ? 'CERTIFICADO'
        : row.es_venta_chip ? 'VENTA_CHIP' : 'OPERACION',
    plantaKey: row.planta_key,
    plantaNombre: row.planta_nombre,
    empresaKey: row.empresa_key,
    empresaNombre: row.empresa_nombre,
    tipoComprobante: row.tipo_comprobante,
    nroComprobante: row.nro_comprobante,
    nroDocumento: row.nro_documento,
    cliente: row.nombre_razon_social,
    placa: row.placa,
    importeTotal: Number(row.importe_total),
    estado: row.estado,
    aceptadaSunat: row.aceptada_sunat,
    mensajeSunat: row.sunat_description,
    enlacePdf: row.enlace_pdf,
    enlaceXml: row.enlace_xml,
    enlaceCdr: row.enlace_cdr,
    entornoFacturador: row.entorno_facturador,
    anulacionId: row.anulacion_id == null ? null : Number(row.anulacion_id),
    estadoAnulacion: row.estado_anulacion,
    motivoAnulacion: row.motivo_anulacion,
    descripcionAnulacion: row.descripcion_anulacion,
    aceptadaAnulacionSunat: row.aceptada_anulacion_sunat,
    ticketAnulacionSunat: row.ticket_anulacion_sunat,
    fechaSolicitudAnulacion: row.fecha_solicitud_anulacion,
    intentos: Number(row.intentos || 0),
    fechaUltimoIntento: row.fecha_ultimo_intento,
    fechaCreacion: row.fecha_creacion
});

exports.listar = async (query, userContext, dependencies = {}) => {
    const queryable = dependencies.db || db;
    const obtenerPlantas = dependencies.getPlantasPorUsuario || authService.getPlantasPorUsuario;
    const plantas = await obtenerPlantas(userContext.username, userContext.perfil_id);
    const plantasPermitidas = plantas.map(planta => String(planta.key));
    if (plantasPermitidas.length === 0) return { documentos: [], total: 0, pagina: 1, limite: 50, plantas: [], empresas: [] };

    const pagina = enteroAcotado(query.pagina, 1, 1, 100000);
    const limite = enteroAcotado(query.limite, 50, 1, 100);
    const filtros = construirFiltros(query, plantasPermitidas);
    const offset = (pagina - 1) * limite;
    const from = `
        FROM fg_facturacion f
        LEFT JOIN fg_certificado c ON c.id = f.certificado_id
        LEFT JOIN fg_operacion_comercial oc
          ON oc.id = f.operacion_id
         AND f.certificado_id IS NULL
        JOIN fg_planta p ON p.key = COALESCE(f.planta_key, oc.planta_key)
        JOIN fg_empresa e ON e.key = p.empresa_key
        LEFT JOIN fg_certificado_vehiculo v ON v.certificado_id = c.id
        LEFT JOIN LATERAL (
            SELECT a.id, a.estado, a.motivo, a.sunat_description,
                   a.aceptada_sunat, a.ticket_sunat, a.fecha_creacion
            FROM fg_documento_anulacion a
            WHERE a.facturacion_id = f.id
            ORDER BY a.id DESC
            LIMIT 1
        ) anulacion ON TRUE
        WHERE ${filtros.where}`;

    const [listado, totalResult, catalogos] = await Promise.all([
        queryable.query(`
            SELECT f.id, f.certificado_id, f.operacion_id, f.planta_key, p.nombre AS planta_nombre,
                   p.empresa_key, e.nombre AS empresa_nombre,
                   EXISTS (
                       SELECT 1
                       FROM fg_operacion_detalle od
                       JOIN fg_operacion_detalle_chip odc
                         ON odc.operacion_detalle_id = od.id
                       WHERE od.operacion_id = f.operacion_id
                   ) AS es_venta_chip,
                   f.tipo_comprobante,
                   f.nro_comprobante, f.nro_documento, f.nombre_razon_social,
                   v.placa, f.importe_total, f.estado, f.aceptada_sunat,
                   f.sunat_description, f.enlace_pdf, f.enlace_xml, f.enlace_cdr,
                   f.entorno_facturador,
                   anulacion.id AS anulacion_id, anulacion.estado AS estado_anulacion,
                   anulacion.motivo AS motivo_anulacion,
                   anulacion.sunat_description AS descripcion_anulacion,
                   anulacion.aceptada_sunat AS aceptada_anulacion_sunat,
                   anulacion.ticket_sunat AS ticket_anulacion_sunat,
                   anulacion.fecha_creacion AS fecha_solicitud_anulacion,
                   f.intentos, f.fecha_ultimo_intento, f.fecha_creacion
            ${from}
            ORDER BY f.fecha_creacion DESC, f.id DESC
            LIMIT $${filtros.valores.length + 1} OFFSET $${filtros.valores.length + 2}
        `, [...filtros.valores, limite, offset]),
        queryable.query(`SELECT COUNT(*)::int AS total ${from}`, filtros.valores),
        queryable.query(`
            SELECT p.key AS planta_key, p.nombre AS planta_nombre,
                   e.key AS empresa_key, e.nombre AS empresa_nombre
            FROM fg_planta p
            JOIN fg_empresa e ON e.key = p.empresa_key
            WHERE p.key = ANY($1::varchar[])
            ORDER BY e.nombre, p.nombre
        `, [plantasPermitidas])
    ]);

    const empresas = [...new Map(catalogos.rows.map(row => [row.empresa_key, {
        key: row.empresa_key,
        nombre: row.empresa_nombre
    }])).values()];
    return {
        documentos: listado.rows.map(mapDocumento),
        total: Number(totalResult.rows[0]?.total || 0),
        pagina,
        limite,
        plantas: catalogos.rows.map(row => ({ key: row.planta_key, nombre: row.planta_nombre, empresaKey: row.empresa_key })),
        empresas
    };
};

exports.obtenerDetalle = async (facturacionId, userContext, dependencies = {}) => {
    const queryable = dependencies.db || db;
    const obtenerPlantas = dependencies.getPlantasPorUsuario || authService.getPlantasPorUsuario;
    const plantas = await obtenerPlantas(userContext.username, userContext.perfil_id);
    const plantasPermitidas = plantas.map(planta => String(planta.key));
    const documento = await queryable.query(`
        SELECT f.id, f.certificado_id, f.operacion_id, f.planta_key, p.nombre AS planta_nombre,
               p.empresa_key, e.nombre AS empresa_nombre,
               EXISTS (
                   SELECT 1
                   FROM fg_operacion_detalle od
                   JOIN fg_operacion_detalle_chip odc
                     ON odc.operacion_detalle_id = od.id
                   WHERE od.operacion_id = f.operacion_id
               ) AS es_venta_chip,
               f.tipo_comprobante,
               f.nro_comprobante, f.nro_documento, f.nombre_razon_social,
               v.placa, f.importe_total, f.estado, f.aceptada_sunat,
               f.sunat_description, f.enlace_pdf, f.enlace_xml, f.enlace_cdr,
               f.entorno_facturador,
               anulacion.id AS anulacion_id, anulacion.estado AS estado_anulacion,
               anulacion.motivo AS motivo_anulacion,
               anulacion.sunat_description AS descripcion_anulacion,
               anulacion.aceptada_sunat AS aceptada_anulacion_sunat,
               anulacion.ticket_sunat AS ticket_anulacion_sunat,
               anulacion.fecha_creacion AS fecha_solicitud_anulacion,
               f.intentos, f.fecha_ultimo_intento, f.fecha_creacion
        FROM fg_facturacion f
        LEFT JOIN fg_certificado c ON c.id = f.certificado_id
        LEFT JOIN fg_operacion_comercial oc
          ON oc.id = f.operacion_id
         AND f.certificado_id IS NULL
        JOIN fg_planta p ON p.key = COALESCE(f.planta_key, oc.planta_key)
        JOIN fg_empresa e ON e.key = p.empresa_key
        LEFT JOIN fg_certificado_vehiculo v ON v.certificado_id = c.id
        LEFT JOIN LATERAL (
            SELECT a.id, a.estado, a.motivo, a.sunat_description,
                   a.aceptada_sunat, a.ticket_sunat, a.fecha_creacion
            FROM fg_documento_anulacion a
            WHERE a.facturacion_id = f.id
            ORDER BY a.id DESC
            LIMIT 1
        ) anulacion ON TRUE
        WHERE f.id = $1 AND COALESCE(f.planta_key, oc.planta_key) = ANY($2::varchar[])
    `, [facturacionId, plantasPermitidas]);
    if (documento.rowCount === 0) throw Object.assign(new Error('FACTURACION_NOT_FOUND'), { statusCode: 404 });

    const [intentos, operaciones] = await Promise.all([
        queryable.query(`
            SELECT numero_intento, estado, http_status, error, fecha_creacion, fecha_finalizacion
            FROM fg_facturacion_intento WHERE facturacion_id = $1
            ORDER BY numero_intento DESC
        `, [facturacionId]),
        queryable.query(`
            SELECT operacion, numero_intento, estado, http_status, error,
                   usuario_creacion, fecha_creacion, fecha_finalizacion
            FROM fg_documento_electronico_operacion WHERE facturacion_id = $1
            ORDER BY fecha_creacion DESC
        `, [facturacionId])
    ]);
    return { documento: mapDocumento(documento.rows[0]), intentos: intentos.rows, operaciones: operaciones.rows };
};

exports._construirFiltros = construirFiltros;
