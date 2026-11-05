const db = require('../../../config/database');

async function obtenerRegistroVentasTributario({ plantasAutorizadas = [], plantasFiltro = [], desde, hasta }) {
    const plantas = (plantasFiltro?.length ? plantasFiltro : plantasAutorizadas)
        .filter((planta) => plantasAutorizadas.includes(planta));
    if (!plantas.length) return { documentos: [] };

    const result = await db.query(`
        SELECT d.* FROM (
            SELECT 'F-' || f.id::text AS id_documento, f.tipo_comprobante, f.serie, f.numero,
                   f.fecha_documento AS fecha_emision, NULL::date AS fecha_aceptacion, f.fecha_vencimiento,
                   NULL::date AS fecha_referencia,
                   f.nombre_razon_social AS cliente, f.tipo_documento_cliente AS tipo_documento,
                   f.nro_documento AS numero_documento, f.base_imponible, f.igv, f.importe_total,
                   f.moneda_key AS moneda, f.respuesta_proveedor AS datos_fiscales,
                   f.estado AS estado_tecnico, f.proveedor, f.entorno_facturador, f.aceptada_sunat, f.sunat_responsecode,
                   f.sunat_description, f.codigo_unico, COALESCE(f.razon_social_emisor, e.nombre) AS empresa_emisora,
                   COALESCE(f.ruc_emisor, e.ruc) AS ruc_emisor,
                   COALESCE(f.planta_key, oc.planta_key, v.planta_key) AS planta_key,
                   NULL::text AS serie_afectada, NULL::text AS numero_afectado,
                   'COMPROBANTE'::text AS clase_documento
            FROM fg_facturacion f
            LEFT JOIN fg_operacion_comercial oc ON oc.id = f.operacion_id
            LEFT JOIN fg_venta v ON v.id = f.venta_id
            LEFT JOIN fg_planta pl ON pl.key = COALESCE(f.planta_key, oc.planta_key, v.planta_key)
            LEFT JOIN fg_empresa e ON e.key = COALESCE(f.empresa_key, pl.empresa_key)
            WHERE COALESCE(f.planta_key, oc.planta_key, v.planta_key) = ANY($1::varchar[])
              AND f.fecha_documento >= $2::date AND f.fecha_documento < ($3::date + INTERVAL '1 day')
              AND f.estado <> 'BORRADOR'
            UNION ALL
            SELECT 'C-' || cr.id::text, 'NOTA DE CRÉDITO', cr.serie, cr.numero,
                   NULL::date AS fecha_emision, cr.fecha_aceptacion::date AS fecha_aceptacion, NULL::date,
                   f.fecha_documento::date AS fecha_referencia,
                   f.nombre_razon_social, f.tipo_documento_cliente, f.nro_documento,
                   cr.base_imponible, cr.igv, cr.importe_total, cr.moneda_key,
                   cr.respuesta_proveedor, cr.estado, cr.proveedor, f.entorno_facturador, cr.aceptada_sunat, cr.sunat_responsecode,
                   cr.sunat_description, cr.codigo_unico, COALESCE(f.razon_social_emisor, e.nombre),
                   COALESCE(cr.ruc_emisor, f.ruc_emisor, e.ruc),
                   COALESCE(f.planta_key, oc.planta_key, v.planta_key),
                   f.serie::text, f.numero::text, 'NOTA DE CRÉDITO'
            FROM fg_credito cr
            JOIN fg_facturacion f ON f.id = cr.facturacion_id
            LEFT JOIN fg_operacion_comercial oc ON oc.id = f.operacion_id
            LEFT JOIN fg_venta v ON v.id = f.venta_id
            LEFT JOIN fg_planta pl ON pl.key = COALESCE(f.planta_key, oc.planta_key, v.planta_key)
            LEFT JOIN fg_empresa e ON e.key = COALESCE(cr.empresa_key, f.empresa_key, pl.empresa_key)
            WHERE COALESCE(f.planta_key, oc.planta_key, v.planta_key) = ANY($1::varchar[])
              AND cr.fecha_aceptacion::date >= $2::date
              AND cr.fecha_aceptacion::date <= $3::date
              AND cr.estado <> 'BORRADOR'
        ) d
        ORDER BY d.fecha_emision, d.id_documento
    `, [plantas, desde, hasta]);
    return { documentos: result.rows };
}

module.exports = { obtenerRegistroVentasTributario };
