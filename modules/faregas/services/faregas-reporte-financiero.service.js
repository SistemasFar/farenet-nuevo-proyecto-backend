const db = require('../../../config/database');
const { calcularIntervaloFechas } = require('./faregas-dashboard.service');

const sqlPlantas = (expression) => `${expression} = ANY($1::varchar[])`;

async function obtenerReporteFinanciero({ plantasAutorizadas, plantasFiltro, desde, hasta, username }) {
    const plantas = (plantasFiltro?.length ? plantasFiltro : plantasAutorizadas)
        .filter((planta) => plantasAutorizadas.includes(planta));
    if (!plantas.length) return { metadatos: { rango: '', plantas: [], razonSocialEmisor: '', rucEmisor: '' }, operaciones: [], lineas: [], ventasDirectas: [], comprobantes: [], ordenes: [], pagos: [], descuentos: [], ajustes: [], sedes: [] };
    const { inicioActual, finActual, desde: fechaDesde, hasta: fechaHasta } = calcularIntervaloFechas(desde, hasta);

    const [operaciones, lineas, directas, comprobantes, ordenes, pagos, descuentos, ajustes, emisor] = await Promise.all([
        db.query(`SELECT oc.id, oc.planta_key, pl.nombre AS planta_nombre, oc.fecha_creacion, oc.estado,
                         oc.base_imponible, oc.igv, oc.importe_total, oc.nombre_cliente_snapshot,
                         oc.tipo_documento_cliente_snapshot, oc.documento_cliente_snapshot, oc.usuario_creacion,
                         EXISTS (SELECT 1 FROM fg_facturacion f
                                 WHERE f.operacion_id = oc.id AND (
                                   (f.estado = 'ACEPTADO' AND f.aceptada_sunat IS TRUE)
                                   OR (UPPER(COALESCE(f.entorno_facturador, '')) = 'DEMO'
                                       AND UPPER(COALESCE(f.proveedor, '')) = 'NUBEFACT'
                                       AND f.estado = 'PENDIENTE_SUNAT'
                                       AND NULLIF(BTRIM(f.nro_comprobante), '') IS NOT NULL
                                       AND NULLIF(BTRIM(f.serie), '') IS NOT NULL AND f.numero IS NOT NULL
                                       AND (NULLIF(BTRIM(f.enlace_pdf), '') IS NOT NULL OR NULLIF(BTRIM(f.enlace_xml), '') IS NOT NULL))
                                 )) AS comprobante_operable
                  FROM fg_operacion_comercial oc LEFT JOIN fg_planta pl ON pl.key = oc.planta_key
                  WHERE ${sqlPlantas('oc.planta_key')} AND oc.fecha_creacion >= $2::timestamptz AND oc.fecha_creacion < $3::timestamptz
                  ORDER BY oc.id`, [plantas, inicioActual, finActual]),
        db.query(`SELECT od.id, od.operacion_id, od.tipo_item, od.servicio_id, od.certificado_id,
                         od.producto_facturacion_id, od.cantidad, od.codigo_sku_snapshot, od.descripcion_snapshot,
                         od.unidad_snapshot, od.valor_unitario, od.precio_unitario, od.base_imponible, od.igv,
                         od.importe_total, COALESCE(cs.nombre, cp.nombre) AS categoria,
                         COALESCE(pf.codigo_sku, od.codigo_sku_snapshot) AS codigo_producto,
                         COALESCE(pf.descripcion, s.nombre, od.descripcion_snapshot) AS producto
                  FROM fg_operacion_detalle od JOIN fg_operacion_comercial oc ON oc.id = od.operacion_id
                  LEFT JOIN fg_servicio s ON s.id = od.servicio_id
                  LEFT JOIN fg_categoria_servicio cs ON cs.id = s.categoria_id
                  LEFT JOIN fg_producto_facturacion pf ON pf.id = od.producto_facturacion_id
                  LEFT JOIN fg_categoria_servicio cp ON cp.id = pf.categoria_id
                  WHERE ${sqlPlantas('oc.planta_key')} AND oc.fecha_creacion >= $2::timestamptz AND oc.fecha_creacion < $3::timestamptz
                  ORDER BY od.operacion_id, od.orden, od.id`, [plantas, inicioActual, finActual]),
        db.query(`SELECT v.id, v.planta_key, pl.nombre AS planta_nombre, v.creado_en AS fecha_creacion, v.estado,
                         v.base_imponible, v.igv, v.importe_total, v.cliente_nombre, v.cliente_tipo_documento,
                         v.cliente_nro_documento, v.creado_por AS usuario_creacion, vd.id AS detalle_id,
                         vd.precio_unitario, vd.cantidad, vd.total AS importe_detalle, pi.codigo AS codigo_producto,
                         pi.nombre AS producto, COALESCE(cat.nombre, pi.tipo) AS categoria
                  FROM fg_venta v LEFT JOIN fg_planta pl ON pl.key = v.planta_key
                  LEFT JOIN fg_venta_detalle vd ON vd.venta_id = v.id
                  LEFT JOIN fg_producto_inventariable pi ON pi.id = vd.producto_inventariable_id
                  LEFT JOIN fg_producto_inventariable_sede pis ON pis.producto_inventariable_id = pi.id AND pis.planta_key = v.planta_key
                  LEFT JOIN fg_producto_facturacion pf ON pf.id = pis.producto_facturacion_id
                  LEFT JOIN fg_categoria_servicio cat ON cat.id = pf.categoria_id
                  WHERE ${sqlPlantas('v.planta_key')} AND v.creado_en >= $2::timestamptz AND v.creado_en < $3::timestamptz
                  ORDER BY v.id, vd.id`, [plantas, inicioActual, finActual]),
        db.query(`SELECT f.id, f.operacion_id, f.venta_id, f.tipo_comprobante, f.serie, f.numero, f.nro_comprobante,
                         f.fecha_documento, f.fecha_creacion,
                         (f.fecha_documento IS NOT NULL
                          AND f.fecha_documento >= $4::date
                          AND f.fecha_documento <= $5::date) AS en_periodo_emision,
                         f.nombre_razon_social, f.tipo_documento_cliente,
                         f.nro_documento, f.estado, f.aceptada_sunat, f.entorno_facturador, f.proveedor,
                         f.enlace_pdf, f.enlace_xml, f.base_imponible, f.igv, f.importe_total, f.ruc_emisor,
                         f.razon_social_emisor, f.medio_pago, f.codigo_descuento_snapshot,
                         COALESCE(f.planta_key, oc.planta_key, v.planta_key) AS planta_key
                  FROM fg_facturacion f LEFT JOIN fg_operacion_comercial oc ON oc.id = f.operacion_id
                  LEFT JOIN fg_venta v ON v.id = f.venta_id
                  WHERE (COALESCE(f.planta_key, oc.planta_key, v.planta_key) = ANY($1::varchar[]))
                    AND ((f.fecha_documento IS NOT NULL
                          AND f.fecha_documento >= $4::date
                          AND f.fecha_documento <= $5::date)
                      OR (oc.fecha_creacion >= $2::timestamptz AND oc.fecha_creacion < $3::timestamptz)
                      OR (v.creado_en >= $2::timestamptz AND v.creado_en < $3::timestamptz))
                    AND f.estado <> 'BORRADOR' ORDER BY f.id`, [plantas, inicioActual, finActual, fechaDesde, fechaHasta]),
        db.query(`SELECT op.id, op.operacion_id, op.venta_id, op.certificado_id, op.importe_total, op.importe_pagado, op.saldo_pendiente,
                         ((oc.fecha_creacion >= $2::timestamptz AND oc.fecha_creacion < $3::timestamptz)
                           OR (v.creado_en >= $2::timestamptz AND v.creado_en < $3::timestamptz)
                           OR (cert.fecha_creacion >= $2::timestamptz AND cert.fecha_creacion < $3::timestamptz)) AS en_periodo_venta,
                         (op.fechacreacion >= $2::timestamptz AND op.fechacreacion < $3::timestamptz) AS en_periodo_orden,
                         op.estado, op.fechacreacion, op.usuariocreacion_username
                  FROM fg_orden_pago op
                  LEFT JOIN fg_operacion_comercial oc ON oc.id = op.operacion_id
                  LEFT JOIN fg_venta v ON v.id = op.venta_id
                  LEFT JOIN fg_certificado cert ON cert.id = op.certificado_id
                  WHERE ((oc.planta_key = ANY($1::varchar[]) AND oc.fecha_creacion >= $2::timestamptz AND oc.fecha_creacion < $3::timestamptz)
                     OR (v.planta_key = ANY($1::varchar[]) AND v.creado_en >= $2::timestamptz AND v.creado_en < $3::timestamptz)
                     OR (cert.planta_key = ANY($1::varchar[]) AND cert.fecha_creacion >= $2::timestamptz AND cert.fecha_creacion < $3::timestamptz)
                     OR EXISTS (SELECT 1 FROM fg_pago pago_periodo WHERE pago_periodo.orden_pago_id = op.id
                                AND pago_periodo.fechacreacion >= $2::timestamptz AND pago_periodo.fechacreacion < $3::timestamptz
                                AND (oc.planta_key = ANY($1::varchar[]) OR v.planta_key = ANY($1::varchar[]) OR cert.planta_key = ANY($1::varchar[]))))
                  ORDER BY op.id`, [plantas, inicioActual, finActual]),
        db.query(`SELECT p.id, p.orden_pago_id, p.fechacreacion, p.importe, p.estado, p.tipocontado_key,
                         COALESCE(ef.nombre, p.entidadfinanciera_key) AS entidad_financiera,
                         COALESCE(t.nombre, p.tarjeta_key) AS tipo_tarjeta, p.nrooperacionbanco, p.nrooperaciontarjeta,
                         op.operacion_id, op.venta_id, op.certificado_id, op.usuariocreacion_username,
                         (p.fechacreacion >= $2::timestamptz AND p.fechacreacion < $3::timestamptz) AS en_periodo,
                         COALESCE(oc.planta_key, v.planta_key, cert.planta_key) AS planta_key, COALESCE(pl.nombre, cert_pl.nombre) AS planta_nombre
                  FROM fg_pago p JOIN fg_orden_pago op ON op.id = p.orden_pago_id
                  LEFT JOIN fg_operacion_comercial oc ON oc.id = op.operacion_id
                  LEFT JOIN fg_venta v ON v.id = op.venta_id
                  LEFT JOIN fg_certificado cert ON cert.id = op.certificado_id
                  LEFT JOIN tarjeta t ON t.key = p.tarjeta_key
                  LEFT JOIN entidadfinanciera ef ON ef.key = p.entidadfinanciera_key
                  LEFT JOIN fg_planta pl ON pl.key = COALESCE(oc.planta_key, v.planta_key)
                  LEFT JOIN fg_planta cert_pl ON cert_pl.key = cert.planta_key
                  WHERE COALESCE(oc.planta_key, v.planta_key, cert.planta_key) = ANY($1::varchar[])
                    AND ((p.fechacreacion >= $2::timestamptz AND p.fechacreacion < $3::timestamptz)
                      OR (oc.fecha_creacion >= $2::timestamptz AND oc.fecha_creacion < $3::timestamptz)
                      OR (cert.fecha_creacion >= $2::timestamptz AND cert.fecha_creacion < $3::timestamptz)
                      OR (v.creado_en >= $2::timestamptz AND v.creado_en < $3::timestamptz))
                  ORDER BY p.id`, [plantas, inicioActual, finActual]),
        db.query(`SELECT dc.id, dc.orden_pago_id, dc.facturacion_id, dc.certificado_id, dc.importe_original,
                         dc.importe_descuento, dc.importe_final, dc.estado, dc.fecha_aplicacion,
                         dcli.codigo, dc.descuento_id, dc.descuento_cliente_id,
                         d.tipo AS tipo_descuento, d.tipo_calculo, d.valor AS valor_descuento,
                         d.nombre AS nombre_descuento,
                         COALESCE(c.planta_key, f.planta_key, oc.planta_key, opoc.planta_key, v.planta_key) AS planta_key
                  FROM fg_descuentocomprobante dc
                  LEFT JOIN fg_descuentocliente dcli ON dcli.id = dc.descuento_cliente_id
                  LEFT JOIN fg_descuento d ON d.id = COALESCE(dc.descuento_id, dcli.descuento_id)
                  LEFT JOIN fg_facturacion f ON f.id = dc.facturacion_id
                  LEFT JOIN fg_operacion_comercial oc ON oc.id = f.operacion_id
                  LEFT JOIN fg_certificado c ON c.id = dc.certificado_id
                  LEFT JOIN fg_orden_pago op ON op.id = dc.orden_pago_id
                  LEFT JOIN fg_operacion_comercial opoc ON opoc.id = op.operacion_id
                  LEFT JOIN fg_venta v ON v.id = op.venta_id
                  WHERE COALESCE(c.planta_key, f.planta_key, oc.planta_key, opoc.planta_key, v.planta_key) = ANY($1::varchar[])
                    AND dc.fecha_aplicacion >= $2::timestamptz AND dc.fecha_aplicacion < $3::timestamptz
                  ORDER BY dc.id`, [plantas, inicioActual, finActual]),
        db.query(`SELECT 'NOTA DE CRÉDITO' AS tipo, cr.id, cr.facturacion_id, cr.serie, cr.numero,
                         cr.nro_comprobante, cr.estado, cr.fecha_creacion, cr.base_imponible, cr.igv,
                         cr.importe_total, cr.aceptada_sunat, COALESCE(cr.ruc_emisor, f.ruc_emisor) AS ruc_emisor, f.razon_social_emisor,
                         f.operacion_id, f.venta_id, cr.planta_key
                  FROM fg_credito cr JOIN fg_facturacion f ON f.id = cr.facturacion_id
                  WHERE cr.planta_key = ANY($1::varchar[]) AND cr.fecha_creacion >= $2::timestamptz
                    AND cr.fecha_creacion < $3::timestamptz AND cr.estado <> 'BORRADOR'
                  UNION ALL
                  SELECT 'ANULACIÓN' AS tipo, da.id, da.facturacion_id, NULL::varchar, NULL::bigint,
                         NULL::varchar, da.estado, da.fecha_creacion, 0::numeric, 0::numeric,
                         0::numeric, da.aceptada_sunat, f.ruc_emisor, f.razon_social_emisor,
                         f.operacion_id, f.venta_id, f.planta_key
                  FROM fg_documento_anulacion da JOIN fg_facturacion f ON f.id = da.facturacion_id
                  WHERE f.planta_key = ANY($1::varchar[]) AND da.fecha_creacion >= $2::timestamptz
                    AND da.fecha_creacion < $3::timestamptz
                  UNION ALL
                  SELECT 'NOTA DE DÉBITO' AS tipo, nd.id, nd.facturacion_id, nd.serie, nd.numero,
                         nd.nro_comprobante, nd.estado, nd.fecha_creacion, nd.base_imponible, nd.igv,
                         nd.importe_total, nd.aceptada_sunat, COALESCE(nd.ruc_emisor, f.ruc_emisor) AS ruc_emisor, f.razon_social_emisor,
                         f.operacion_id, f.venta_id, nd.planta_key
                  FROM fg_debito nd JOIN fg_facturacion f ON f.id = nd.facturacion_id
                  WHERE nd.planta_key = ANY($1::varchar[]) AND nd.fecha_creacion >= $2::timestamptz
                    AND nd.fecha_creacion < $3::timestamptz AND nd.estado <> 'BORRADOR'`, [plantas, inicioActual, finActual]),
        db.query(`SELECT key AS planta_key, nombre AS planta_nombre FROM fg_planta
                  WHERE key = ANY($1::varchar[]) ORDER BY nombre, key`, [plantas])
    ]);

    return {
        metadatos: {
            desde: fechaDesde, hasta: fechaHasta, fechaGeneracion: new Date().toISOString(),
            usuarioExportador: username || 'Usuario', plantas, razonSocialEmisor: '', rucEmisor: ''
        },
        operaciones: operaciones.rows, lineas: lineas.rows, ventasDirectas: directas.rows,
        comprobantes: comprobantes.rows, ordenes: ordenes.rows, pagos: pagos.rows,
        descuentos: descuentos.rows, ajustes: ajustes.rows, sedes: emisor.rows
    };
}

module.exports = { obtenerReporteFinanciero };
