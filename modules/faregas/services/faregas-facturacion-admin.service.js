const db = require('../../../config/database');
const authService = require('./faregas-auth.service');

const ESTADOS = new Set(['BORRADOR', 'PENDIENTE', 'ACEPTADO', 'RECHAZADO', 'ERROR', 'ANULADO']);
const FECHA_ISO = /^\d{4}-\d{2}-\d{2}$/;

const enteroAcotado = (value, fallback, min, max) => {
    const numero = Number(value);
    return Number.isInteger(numero) ? Math.min(max, Math.max(min, numero)) : fallback;
};

const construirFiltros = (query, plantasPermitidas) => {
    const condiciones = ['f.planta_key = ANY($1::varchar[])'];
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
        agregar('f.planta_key = ?', plantaKey);
    }
    if (empresaKey) agregar('p.empresa_key = ?', empresaKey);
    if (estado) {
        if (!ESTADOS.has(estado)) throw Object.assign(new Error('ESTADO_INVALIDO'), { statusCode: 400 });
        agregar('f.estado = ?', estado);
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
    certificadoId: Number(row.certificado_id),
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
        JOIN fg_certificado c ON c.id = f.certificado_id
        JOIN fg_planta p ON p.key = f.planta_key
        JOIN fg_empresa e ON e.key = p.empresa_key
        LEFT JOIN fg_certificado_vehiculo v ON v.certificado_id = c.id
        WHERE ${filtros.where}`;

    const [listado, totalResult, catalogos] = await Promise.all([
        queryable.query(`
            SELECT f.id, f.certificado_id, f.planta_key, p.nombre AS planta_nombre,
                   p.empresa_key, e.nombre AS empresa_nombre, f.tipo_comprobante,
                   f.nro_comprobante, f.nro_documento, f.nombre_razon_social,
                   v.placa, f.importe_total, f.estado, f.aceptada_sunat,
                   f.sunat_description, f.enlace_pdf, f.enlace_xml, f.enlace_cdr,
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
        SELECT f.id, f.certificado_id, f.planta_key, p.nombre AS planta_nombre,
               p.empresa_key, e.nombre AS empresa_nombre, f.tipo_comprobante,
               f.nro_comprobante, f.nro_documento, f.nombre_razon_social,
               v.placa, f.importe_total, f.estado, f.aceptada_sunat,
               f.sunat_description, f.enlace_pdf, f.enlace_xml, f.enlace_cdr,
               f.intentos, f.fecha_ultimo_intento, f.fecha_creacion
        FROM fg_facturacion f
        JOIN fg_certificado c ON c.id = f.certificado_id
        JOIN fg_planta p ON p.key = f.planta_key
        JOIN fg_empresa e ON e.key = p.empresa_key
        LEFT JOIN fg_certificado_vehiculo v ON v.certificado_id = c.id
        WHERE f.id = $1 AND f.planta_key = ANY($2::varchar[])
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
