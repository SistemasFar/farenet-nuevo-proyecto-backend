const db = require('../../../config/database');

async function obtenerResumenMensualFacturacion({ plantasAutorizadas = [], plantasFiltro = [], desde, hasta }) {
    const plantas = (plantasFiltro?.length ? plantasFiltro : plantasAutorizadas)
        .filter((planta) => plantasAutorizadas.includes(planta));
    if (!plantas.length) return { cabeceras: [], metadatos: { empresasEmisoras: [], rucEmisores: [] } };
    const [result, emisores] = await Promise.all([db.query(`
        WITH documentos AS (
            SELECT 'F-' || f.id::text AS id_documento, f.tipo_comprobante,
                   f.serie, f.numero, f.fecha_documento AS fecha_emision, NULL::date AS fecha_aceptacion,
                   COALESCE(f.razon_social_emisor, e.nombre) AS empresa_emisora,
                   COALESCE(f.ruc_emisor, e.ruc) AS ruc_emisor,
                   COALESCE(f.sede_nombre_snapshot, pl.nombre) AS sede,
                   COALESCE(f.planta_key, oc.planta_key, v.planta_key) AS planta_key,
                   f.base_imponible, f.igv, f.importe_total, f.estado AS estado_tecnico,
                   f.proveedor, f.entorno_facturador, f.aceptada_sunat, f.sunat_responsecode, f.sunat_description,
                   f.respuesta_proveedor, f.codigo_unico, f.fecha_creacion, f.usuario_creacion,
                   f.fecha_documento, f.medio_pago,
                   COALESCE((SELECT fi.error FROM fg_facturacion_intento fi WHERE fi.facturacion_id = f.id ORDER BY fi.numero_intento DESC LIMIT 1), f.sunat_soap_error) AS error_detalle,
                   COALESCE(f.respuesta_proveedor->>'origen_peticion', f.respuesta_proveedor->>'origen') AS origen_peticion,
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
                   NULL::date AS fecha_emision, cr.fecha_aceptacion::date AS fecha_aceptacion,
                   COALESCE(f.razon_social_emisor, e.nombre), COALESCE(cr.ruc_emisor, f.ruc_emisor, e.ruc),
                   COALESCE(f.sede_nombre_snapshot, pl.nombre), COALESCE(f.planta_key, oc.planta_key, v.planta_key),
                   cr.base_imponible, cr.igv, cr.importe_total, cr.estado,
                   cr.proveedor, f.entorno_facturador, cr.aceptada_sunat, cr.sunat_responsecode, cr.sunat_description,
                   cr.respuesta_proveedor, cr.codigo_unico, cr.fecha_creacion, cr.usuario_creacion,
                   NULL::date AS fecha_documento, f.medio_pago,
                   cr.sunat_soap_error AS error_detalle,
                   COALESCE(cr.respuesta_proveedor->>'origen_peticion', cr.respuesta_proveedor->>'origen') AS origen_peticion,
                   'NOTA DE CRÉDITO'
            FROM fg_credito cr
            JOIN fg_facturacion f ON f.id = cr.facturacion_id
            LEFT JOIN fg_operacion_comercial oc ON oc.id = f.operacion_id
            LEFT JOIN fg_venta v ON v.id = f.venta_id
            LEFT JOIN fg_planta pl ON pl.key = COALESCE(f.planta_key, oc.planta_key, v.planta_key)
            LEFT JOIN fg_empresa e ON e.key = COALESCE(cr.empresa_key, f.empresa_key, pl.empresa_key)
            WHERE COALESCE(f.planta_key, oc.planta_key, v.planta_key) = ANY($1::varchar[])
              AND cr.fecha_aceptacion::date >= $2::date
              AND cr.fecha_aceptacion::date < ($3::date + INTERVAL '1 day')
              AND cr.estado <> 'BORRADOR'
        )
        SELECT DISTINCT ON (id_documento) * FROM documentos
        ORDER BY id_documento, fecha_emision
    `, [plantas, desde, hasta]), db.query(`
        SELECT DISTINCT e.nombre AS empresa_emisora, e.ruc AS ruc_emisor
        FROM fg_planta pl JOIN fg_empresa e ON e.key = pl.empresa_key
        WHERE pl.key = ANY($1::varchar[])
        ORDER BY e.nombre, e.ruc
    `, [plantas])]);
    return { cabeceras: result.rows, metadatos: {
        empresasEmisoras: emisores.rows.map((row) => row.empresa_emisora).filter(Boolean),
        rucEmisores: emisores.rows.map((row) => row.ruc_emisor).filter(Boolean)
    } };
}

module.exports = { obtenerResumenMensualFacturacion };
