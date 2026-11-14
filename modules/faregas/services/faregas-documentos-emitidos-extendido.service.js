const db = require('../../../config/database');

async function obtenerDocumentosEmitidosExtendido({ plantasAutorizadas, plantasFiltro, desde, hasta }) {
    const plantas = (plantasFiltro?.length ? plantasFiltro : plantasAutorizadas)
        .filter((planta) => plantasAutorizadas.includes(planta));
    if (!plantas.length) return { cabeceras: [], lineas: [] };
    const inicio = desde;
    const [year, month, day] = hasta.split('-').map(Number);
    const finDate = new Date(Date.UTC(year, month - 1, day + 1));
    const fin = `${finDate.getUTCFullYear()}-${String(finDate.getUTCMonth() + 1).padStart(2, '0')}-${String(finDate.getUTCDate()).padStart(2, '0')}`;

    const { tieneColumna } = require('./faregas-columna-compat.service');
    const soportaFechaHora = await tieneColumna('fg_certificado', 'fecha_hora_emision');
    const columnaHoraCert = soportaFechaHora ? 'cert.fecha_hora_emision' : 'NULL::timestamptz';
    const lateralHoraCert = soportaFechaHora ? 'cert.fecha_hora_emision,' : '';

    const soportaFechaHoraComp = await tieneColumna('fg_facturacion', 'fecha_hora_emision');
    const columnaHoraCompFact = soportaFechaHoraComp ? 'f.fecha_hora_emision' : 'NULL::timestamptz';
    const filtroFechaFact = soportaFechaHoraComp
        ? "COALESCE(f.fecha_documento, (f.fecha_hora_emision AT TIME ZONE 'America/Lima')::date, f.fecha_creacion::date)"
        : "COALESCE(f.fecha_documento, f.fecha_creacion::date)";

    const soportaDetraccionFact = await tieneColumna('fg_facturacion', 'sujeto_detraccion');
    const soportaDetraccionCredito = await tieneColumna('fg_credito', 'sujeto_detraccion');
    const soportaSpotServicio = await tieneColumna('fg_servicio', 'sujeto_spot');
    const soportaSpotProducto = await tieneColumna('fg_producto_facturacion', 'sujeto_spot');

    const columnasDetraccionFact = soportaDetraccionFact
        ? `f.sujeto_detraccion, f.detraccion_codigo, f.detraccion_descripcion,
           f.detraccion_porcentaje, f.detraccion_base, f.detraccion_monto,
           f.detraccion_neto, f.detraccion_estado_deposito, f.detraccion_constancia_nro,
           f.detraccion_constancia_fecha, f.detraccion_motivo_exclusion,`
        : `false AS sujeto_detraccion, NULL::varchar AS detraccion_codigo, NULL::varchar AS detraccion_descripcion,
           NULL::numeric AS detraccion_porcentaje, NULL::numeric AS detraccion_base, NULL::numeric AS detraccion_monto,
           NULL::numeric AS detraccion_neto, 'NO_APLICA'::varchar AS detraccion_estado_deposito, NULL::varchar AS detraccion_constancia_nro,
           NULL::date AS detraccion_constancia_fecha, NULL::varchar AS detraccion_motivo_exclusion,`;

    const columnasDetraccionCredito = soportaDetraccionCredito
        ? `cr.sujeto_detraccion, cr.detraccion_codigo, cr.detraccion_descripcion,
           cr.detraccion_porcentaje, cr.detraccion_base, cr.detraccion_monto,
           cr.detraccion_neto, cr.detraccion_estado_deposito, cr.detraccion_constancia_nro,
           cr.detraccion_constancia_fecha, cr.detraccion_motivo_exclusion,`
        : `false AS sujeto_detraccion, NULL::varchar AS detraccion_codigo, NULL::varchar AS detraccion_descripcion,
           NULL::numeric AS detraccion_porcentaje, NULL::numeric AS detraccion_base, NULL::numeric AS detraccion_monto,
           NULL::numeric AS detraccion_neto, 'NO_APLICA'::varchar AS detraccion_estado_deposito, NULL::varchar AS detraccion_constancia_nro,
           NULL::date AS detraccion_constancia_fecha, NULL::varchar AS detraccion_motivo_exclusion,`;

    const columnaSpotServicio = soportaSpotServicio
        ? `COALESCE(s.sujeto_spot, pf.sujeto_spot, false) AS sujeto_spot, COALESCE(s.codigo_spot, pf.codigo_spot) AS codigo_spot,`
        : `false AS sujeto_spot, NULL::varchar AS codigo_spot,`;
    const groupBySpotServicio = soportaSpotServicio
        ? `, s.sujeto_spot, pf.sujeto_spot, s.codigo_spot, pf.codigo_spot`
        : ``;

    const columnaSpotProducto = soportaSpotProducto
        ? `COALESCE(pf.sujeto_spot, false) AS sujeto_spot, pf.codigo_spot AS codigo_spot,`
        : `false AS sujeto_spot, NULL::varchar AS codigo_spot,`;

    const [cabeceras, lineasOperacion, lineasVenta] = await Promise.all([
        db.query(`
            WITH documentos AS (
                SELECT 'F-' || f.id::text AS id_documento, f.id AS facturacion_id,
                       f.operacion_id, f.venta_id, f.certificado_id, COALESCE(f.planta_key, oc.planta_key, v.planta_key) AS planta_key,
                       COALESCE(f.sede_nombre_snapshot, pl.nombre) AS sede,
                       COALESCE(f.razon_social_emisor, e.nombre) AS empresa_emisora,
                       COALESCE(f.ruc_emisor, e.ruc) AS ruc_emisor,
                       f.tipo_comprobante, f.serie, f.numero, f.fecha_documento::timestamp AS fecha_emision,
                       'FECHA_DOCUMENTO'::text AS fecha_emision_fuente, f.fecha_aceptacion::timestamp AS fecha_aceptacion,
                       ${columnaHoraCompFact} AS fecha_hora_emision_comprobante,
                        f.fecha_documento, f.fecha_vencimiento, NULL::date AS fecha_referencia, f.codigo_unico, f.usuario_creacion AS usuario_emisor,
                       f.entorno_facturador, f.medio_pago AS medio_pago_registrado, f.condicion_pago,
                       f.nombre_razon_social AS cliente, f.tipo_documento_cliente AS tipo_documento,
                        f.nro_documento AS numero_documento, f.moneda_key AS moneda,
                       f.base_imponible, f.igv, f.importe_total, f.estado,
                        f.proveedor, f.aceptada_sunat, f.sunat_responsecode, f.sunat_description, f.sunat_soap_error,
                       
                       f.respuesta_proveedor AS campos_dinamicos,
                       ''::text AS referencia_afectada
                FROM fg_facturacion f
                LEFT JOIN fg_operacion_comercial oc ON oc.id = f.operacion_id
                LEFT JOIN fg_venta v ON v.id = f.venta_id
                LEFT JOIN fg_planta pl ON pl.key = COALESCE(f.planta_key, oc.planta_key, v.planta_key)
                LEFT JOIN fg_empresa e ON e.key = COALESCE(f.empresa_key, pl.empresa_key)
                WHERE COALESCE(f.planta_key, oc.planta_key, v.planta_key) = ANY($1::varchar[])
                  AND ${filtroFechaFact} >= $2::date AND ${filtroFechaFact} < $3::date
                  AND f.estado <> 'BORRADOR'
                UNION ALL
                SELECT 'C-' || cr.id::text, f.id, f.operacion_id, f.venta_id, f.certificado_id,
                       COALESCE(f.planta_key, oc.planta_key, v.planta_key),
                       COALESCE(f.sede_nombre_snapshot, pl.nombre),
                       COALESCE(f.razon_social_emisor, e.nombre), COALESCE(cr.ruc_emisor, f.ruc_emisor, e.ruc),
                       'NOTA DE CRÉDITO', cr.serie, cr.numero, NULL::timestamp,
                       'EMISIÓN NO REGISTRADA; PERÍODO SEGÚN ACEPTACIÓN'::text, cr.fecha_aceptacion,
                       cr.fecha_aceptacion::timestamp AS fecha_hora_emision_comprobante,
                       NULL::date, NULL::date, f.fecha_documento::date, cr.codigo_unico, cr.usuario_creacion,
                       f.entorno_facturador, f.medio_pago, f.condicion_pago,
                        f.nombre_razon_social, f.tipo_documento_cliente, f.nro_documento, cr.moneda_key,
                       cr.base_imponible, cr.igv, cr.importe_total, cr.estado, cr.proveedor,
                       cr.aceptada_sunat, cr.sunat_responsecode, cr.sunat_description, cr.sunat_soap_error,
                       
                       cr.respuesta_proveedor,
                       CONCAT('Afecta ', COALESCE(f.serie, ''), '-', COALESCE(f.numero::text, ''), ' (Facturación ', f.id, ')')
                FROM fg_credito cr
                JOIN fg_facturacion f ON f.id = cr.facturacion_id
                LEFT JOIN fg_operacion_comercial oc ON oc.id = f.operacion_id
                LEFT JOIN fg_venta v ON v.id = f.venta_id
                LEFT JOIN fg_planta pl ON pl.key = COALESCE(f.planta_key, oc.planta_key, v.planta_key)
                LEFT JOIN fg_empresa e ON e.key = COALESCE(cr.empresa_key, f.empresa_key, pl.empresa_key)
                WHERE COALESCE(f.planta_key, oc.planta_key, v.planta_key) = ANY($1::varchar[])
                  AND cr.fecha_aceptacion >= $2::date
                  AND cr.fecha_aceptacion < $3::date
                  AND cr.estado <> 'BORRADOR'
            )
                SELECT d.*,
                    COALESCE(descuento.importe_descuento, 0) AS descuento,
                    descuento.tipo_descuento,
                    comercial.medios_pago,
                    comercial.tipo_pago,
                    comercial.forma_pago,
                    comercial.monto_pagado,
                    comercial.referencia_pago,
                    cuotas.cuotas_count,
                    cuotas.max_cuota,
                   COALESCE(comercial.tipos_producto, comercial.tipo_certificado_directo) AS tipos_producto,
                   COALESCE(comercial.certificados, comercial.certificado_directo) AS certificados,
                   COALESCE(comercial.placas, comercial.placa_directa) AS placas,
                   comercial.marcas_vehiculo AS marca_vehiculo,
                   comercial.modelos_vehiculo AS modelo_vehiculo,
                   comercial.motores_vehiculo AS motor_vehiculo,
                   comercial.categorias_vehiculo AS tipo_vehiculo,
                   notas.notas_credito,
                   notas_debito.notas_debito,
                    anulacion.codigo_unico AS documento_anulacion,
                    anulacion.fecha_creacion AS fecha_anulacion_solicitud,
                    anulacion.fecha_aceptacion AS fecha_anulacion_confirmacion,
                    anulacion.estado AS estado_solicitud_anulacion,
                    anulacion.aceptada_sunat AS aceptada_anulacion_sunat,
                    anulacion.ticket_sunat AS ticket_anulacion,
                    anulacion.motivo AS motivo_anulacion,
                   -- FUSIÓN: hora real de emisión del certificado (HH:mm:ss America/Lima).
                   -- fg_certificado.fecha_emision es DATE sin hora → SIN REGISTRO histórico.
                   -- Se expone fecha_emision_certificado (DATE) y hora cuando exista timestamp;
                   -- NUNCA fecha_modificacion/creacion/pago/comprobante como sustituto.
                   cert.fecha_emision AS fecha_emision_certificado,
                   cert.fecha_emision::text AS fecha_emision_certificado_texto,
                   ${columnaHoraCert} AS hora_emision_certificado,
                   ${columnaHoraCert} AS fecha_hora_emision,
                   d.fecha_hora_emision_comprobante,
                   d.fecha_hora_emision_comprobante AS hora_emision_comprobante,
                   cert.numero_chip AS numero_chip_certificado,
                   cert.placa AS placa_certificado,
                   cortesia.es_cortesia,
                   cons.sede AS sede_consolidado,
                   cons.cliente AS cliente_consolidado,
                   cons.tipo_operacion AS tipo_operacion_consolidado,
                   cons.cortesia_descuento AS cortesia_descuento_consolidado,
                   cons.importe_pagado AS importe_pagado_consolidado,
                   cons.saldo_pendiente AS saldo_pendiente_consolidado,
                   cons.estado_certificado AS estado_certificado_consolidado,
                   cons.estado_comprobante AS estado_comprobante_consolidado
            FROM documentos d
            LEFT JOIN LATERAL (
                SELECT CASE WHEN d.tipo_comprobante = 'NOTA DE CRÉDITO' THEN 0 ELSE SUM(dc.importe_descuento) END AS importe_descuento,
                       STRING_AGG(DISTINCT fdsc.tipo, ', ' ORDER BY fdsc.tipo) AS tipo_descuento
                FROM fg_descuentocomprobante dc
                LEFT JOIN fg_descuento fdsc ON fdsc.id = dc.descuento_id
                WHERE dc.facturacion_id = d.facturacion_id AND dc.estado = 'APLICADO'
            ) descuento ON TRUE
            LEFT JOIN LATERAL (
                SELECT COUNT(fc.id)::int AS cuotas_count,
                       MAX(fc.numero_cuota)::int AS max_cuota
                FROM fg_facturacion_cuota fc
                WHERE fc.facturacion_id = d.facturacion_id
            ) cuotas ON TRUE
            LEFT JOIN LATERAL (
                SELECT (
                    d.tipo_comprobante <> 'NOTA DE CRÉDITO' AND (
                        (d.importe_total = 0 AND (
                            EXISTS (
                                SELECT 1 FROM fg_descuentocomprobante dc_cort
                                LEFT JOIN fg_descuento fd_cort ON fd_cort.id = dc_cort.descuento_id
                                LEFT JOIN fg_descuentocliente fdc_cort ON fdc_cort.id = dc_cort.descuento_cliente_id
                                WHERE (dc_cort.facturacion_id = d.facturacion_id OR (d.certificado_id IS NOT NULL AND dc_cort.certificado_id = d.certificado_id))
                                  AND (
                                      UPPER(BTRIM(COALESCE(fd_cort.codigo, ''))) IN ('CORTESIA_FAREGAS', 'DESCUENTO_TALLER')
                                      OR UPPER(BTRIM(COALESCE(fdc_cort.codigo, ''))) IN ('CORTESIA_FAREGAS', 'DESCUENTO_TALLER')
                                  )
                            )
                            OR d.campos_dinamicos::text LIKE '%1002%'
                            OR d.campos_dinamicos::text ILIKE '%TRANSFERENCIA GRATUITA%'
                            OR d.campos_dinamicos::text ILIKE '%CORTESIA%'
                        ))
                    )
                ) AS es_cortesia
            ) cortesia ON TRUE
            LEFT JOIN LATERAL (
                SELECT (SELECT STRING_AGG(DISTINCT COALESCE(t.nombre, ef.nombre, p.tipocontado_key), ', ' ORDER BY COALESCE(t.nombre, ef.nombre, p.tipocontado_key))
                        FROM fg_pago p
                        JOIN fg_orden_pago op_pago ON op_pago.id = p.orden_pago_id
                        LEFT JOIN tarjeta t ON t.key = p.tarjeta_key
                        LEFT JOIN entidadfinanciera ef ON ef.key = p.entidadfinanciera_key
                        WHERE ((d.operacion_id IS NOT NULL AND op_pago.operacion_id = d.operacion_id)
                           OR (d.venta_id IS NOT NULL AND op_pago.venta_id = d.venta_id)
                           OR (d.certificado_id IS NOT NULL AND op_pago.certificado_id = d.certificado_id))
                          AND p.estado = 'CAN') AS medios_pago,
                        CASE
                            WHEN cortesia.es_cortesia THEN 'CORTESÍA'
                            WHEN UPPER(COALESCE(d.condicion_pago, '')) = 'CREDITO' THEN 'CRÉDITO'
                            ELSE (SELECT COALESCE(STRING_AGG(tipo, ' + ' ORDER BY tipo), 'SIN IDENTIFICAR')
                                  FROM (SELECT DISTINCT
                                         CASE WHEN UPPER(COALESCE(p.tipocontado_key, '')) LIKE '%EFECTIVO%' THEN 'EFECTIVO'
                                              WHEN UPPER(COALESCE(p.tipocontado_key, '')) LIKE '%BANCO%' OR UPPER(COALESCE(p.tipocontado_key, '')) LIKE '%TRANSFER%' OR COALESCE(ef.nombre, '') <> '' THEN 'BANCO'
                                              WHEN UPPER(COALESCE(p.tipocontado_key, '')) LIKE '%TARJETA%' OR COALESCE(t.nombre, '') <> '' THEN 'TARJETA'
                                              ELSE 'SIN IDENTIFICAR' END AS tipo
                                  FROM fg_pago p
                                  JOIN fg_orden_pago op_pago ON op_pago.id = p.orden_pago_id
                                  LEFT JOIN tarjeta t ON t.key = p.tarjeta_key
                                  LEFT JOIN entidadfinanciera ef ON ef.key = p.entidadfinanciera_key
                                  WHERE ((d.operacion_id IS NOT NULL AND op_pago.operacion_id = d.operacion_id)
                                     OR (d.venta_id IS NOT NULL AND op_pago.venta_id = d.venta_id)
                                     OR (d.certificado_id IS NOT NULL AND op_pago.certificado_id = d.certificado_id))
                                    AND p.estado = 'CAN') q)
                        END AS tipo_pago,
                        CASE
                            WHEN cortesia.es_cortesia THEN 'CORTESÍA'
                            WHEN UPPER(COALESCE(d.condicion_pago, '')) = 'CREDITO' THEN
                                CASE
                                    WHEN COALESCE(cuotas.cuotas_count, 0) > 1 THEN cuotas.cuotas_count || ' CUOTAS'
                                    WHEN COALESCE(cuotas.cuotas_count, 0) = 1 THEN '1 CUOTA'
                                    ELSE '1 CUOTA'
                                end
                            ELSE (SELECT COALESCE(STRING_AGG(forma, ' + ' ORDER BY forma), 'SIN IDENTIFICAR')
                                  FROM (SELECT DISTINCT
                                         CASE WHEN UPPER(COALESCE(p.tipocontado_key, '')) LIKE '%EFECTIVO%' THEN 'EFECTIVO'
                                              WHEN COALESCE(t.nombre, '') <> '' THEN UPPER(t.nombre)
                                              WHEN UPPER(COALESCE(p.modalidad_tarjeta, '')) <> '' THEN UPPER(p.modalidad_tarjeta)
                                              WHEN UPPER(COALESCE(p.tarjeta_key, '')) <> '' AND UPPER(COALESCE(p.tarjeta_key, '')) !~ '^[0-9]+$' THEN UPPER(p.tarjeta_key)
                                              WHEN UPPER(COALESCE(p.tipocontado_key, '')) LIKE '%BANCO%' OR COALESCE(ef.nombre, '') <> '' THEN COALESCE(UPPER(ef.nombre), 'BANCO')
                                              ELSE 'SIN IDENTIFICAR' END AS forma
                                  FROM fg_pago p
                                  JOIN fg_orden_pago op_pago ON op_pago.id = p.orden_pago_id
                                  LEFT JOIN tarjeta t ON t.key = p.tarjeta_key
                                  LEFT JOIN entidadfinanciera ef ON ef.key = p.entidadfinanciera_key
                                  WHERE ((d.operacion_id IS NOT NULL AND op_pago.operacion_id = d.operacion_id)
                                     OR (d.venta_id IS NOT NULL AND op_pago.venta_id = d.venta_id)
                                     OR (d.certificado_id IS NOT NULL AND op_pago.certificado_id = d.certificado_id))
                                    AND p.estado = 'CAN') q)
                        END AS forma_pago,
                       CASE
                           WHEN cortesia.es_cortesia THEN 0::numeric
                           ELSE (SELECT SUM(p.importe)
                                 FROM fg_pago p JOIN fg_orden_pago op_pago ON op_pago.id = p.orden_pago_id
                                 WHERE ((d.operacion_id IS NOT NULL AND op_pago.operacion_id = d.operacion_id)
                                    OR (d.venta_id IS NOT NULL AND op_pago.venta_id = d.venta_id)
                                    OR (d.certificado_id IS NOT NULL AND op_pago.certificado_id = d.certificado_id))
                                   AND p.estado = 'CAN')
                       END AS monto_pagado,
                       CASE
                           WHEN cortesia.es_cortesia THEN 'S/ 0.00'
                           ELSE (SELECT STRING_AGG('S/ ' || TO_CHAR(p.importe, 'FM999999990.00'), ' + ' ORDER BY p.id)
                                 FROM fg_pago p JOIN fg_orden_pago op_pago ON op_pago.id = p.orden_pago_id
                                 WHERE ((d.operacion_id IS NOT NULL AND op_pago.operacion_id = d.operacion_id)
                                    OR (d.venta_id IS NOT NULL AND op_pago.venta_id = d.venta_id)
                                    OR (d.certificado_id IS NOT NULL AND op_pago.certificado_id = d.certificado_id))
                                   AND p.estado = 'CAN')
                       END AS desglose_pagos,
                       (SELECT STRING_AGG(DISTINCT COALESCE(p.nrooperacionbanco, p.nrooperaciontarjeta), ', ' ORDER BY COALESCE(p.nrooperacionbanco, p.nrooperaciontarjeta))
                        FROM fg_pago p JOIN fg_orden_pago op_pago ON op_pago.id = p.orden_pago_id
                        WHERE ((d.operacion_id IS NOT NULL AND op_pago.operacion_id = d.operacion_id)
                           OR (d.venta_id IS NOT NULL AND op_pago.venta_id = d.venta_id)
                           OR (d.certificado_id IS NOT NULL AND op_pago.certificado_id = d.certificado_id))
                          AND p.estado = 'CAN') AS referencia_pago,
                       (SELECT STRING_AGG(DISTINCT clase.nombre, ', ' ORDER BY clase.nombre)
                        FROM (
                            SELECT
                                CASE
                                    WHEN dup.id IS NOT NULL OR dup.numero_certificado_snapshot IS NOT NULL THEN 'COMPLEMENTARIO DUPLICADO'
                                    WHEN od.tipo_item = 'PRODUCTO' OR (od.certificado_id IS NULL AND od.servicio_id IS NULL) OR UPPER(COALESCE(cs.nombre, cp.nombre, pf.tipo_producto, '')) LIKE '%COMPLEMENTAR%' THEN 'COMPLEMENTARIO VENTA DE PRODUCTO'
                                    ELSE COALESCE(cs.nombre, cp.nombre, pf.tipo_producto)
                                END AS nombre,
                    
                            FROM fg_operacion_detalle od
                            LEFT JOIN fg_certificado_duplicado dup ON dup.operacion_id = od.operacion_id
                            LEFT JOIN fg_servicio s ON s.id = od.servicio_id
                            LEFT JOIN fg_categoria_servicio cs ON cs.id = s.categoria_id
                            LEFT JOIN fg_producto_facturacion pf ON pf.id = od.producto_facturacion_id
                            LEFT JOIN fg_categoria_servicio cp ON cp.id = pf.categoria_id
                            WHERE (d.operacion_id IS NOT NULL AND od.operacion_id = d.operacion_id)
                               OR (d.certificado_id IS NOT NULL AND od.certificado_id = d.certificado_id)
                            UNION
                            SELECT 'COMPLEMENTARIO VENTA DE PRODUCTO' AS nombre,
                   
                            FROM fg_venta_detalle vd
                            WHERE vd.venta_id = d.venta_id
                        ) clase WHERE clase.nombre IS NOT NULL) AS tipos_producto,
                       (SELECT STRING_AGG(DISTINCT COALESCE(c.numero_certificado, dup.numero_certificado_snapshot), ', ' ORDER BY COALESCE(c.numero_certificado, dup.numero_certificado_snapshot))
                        FROM fg_operacion_detalle od
                        LEFT JOIN fg_certificado c ON c.id = od.certificado_id
                        LEFT JOIN fg_certificado_duplicado dup ON dup.operacion_id = od.operacion_id
                        WHERE ((d.operacion_id IS NOT NULL AND od.operacion_id = d.operacion_id)
                            OR (d.certificado_id IS NOT NULL AND od.certificado_id = d.certificado_id))
                          AND COALESCE(c.numero_certificado, dup.numero_certificado_snapshot) IS NOT NULL) AS certificados,
                       (SELECT STRING_AGG(DISTINCT COALESCE(cv.placa, dup.placa), ', ' ORDER BY COALESCE(cv.placa, dup.placa))
                        FROM fg_operacion_detalle od
                        LEFT JOIN fg_certificado_vehiculo cv ON cv.certificado_id = od.certificado_id
                        LEFT JOIN fg_certificado_duplicado dup ON dup.operacion_id = od.operacion_id
                        WHERE ((d.operacion_id IS NOT NULL AND od.operacion_id = d.operacion_id)
                            OR (d.certificado_id IS NOT NULL AND od.certificado_id = d.certificado_id))
                          AND COALESCE(cv.placa, dup.placa) IS NOT NULL) AS placas,
                       (SELECT STRING_AGG(DISTINCT c.numero_certificado, ', ' ORDER BY c.numero_certificado)
                        FROM fg_certificado c WHERE d.certificado_id = c.id) AS certificado_directo,
                       (SELECT STRING_AGG(DISTINCT cv.placa, ', ' ORDER BY cv.placa)
                        FROM fg_certificado_vehiculo cv WHERE d.certificado_id = cv.certificado_id) AS placa_directa,
                        (SELECT STRING_AGG(DISTINCT tc.nombre, ', ' ORDER BY tc.nombre)
                        FROM fg_certificado c
                        JOIN fg_tipo_certificado tc ON tc.clave = c.tipo_certificado_clave
                         WHERE d.certificado_id = c.id) AS tipo_certificado_directo,
                       (SELECT STRING_AGG(DISTINCT cv.marca, ', ' ORDER BY cv.marca)
                        FROM fg_certificado_vehiculo cv
                        WHERE cv.certificado_id = d.certificado_id OR cv.certificado_id IN (
                            SELECT od.certificado_id FROM fg_operacion_detalle od
                            WHERE ((d.operacion_id IS NOT NULL AND od.operacion_id = d.operacion_id)
                                OR (d.certificado_id IS NOT NULL AND od.certificado_id = d.certificado_id))
                        )) AS marcas_vehiculo,
                       (SELECT STRING_AGG(DISTINCT cv.modelo, ', ' ORDER BY cv.modelo)
                        FROM fg_certificado_vehiculo cv
                        WHERE cv.certificado_id = d.certificado_id OR cv.certificado_id IN (
                            SELECT od.certificado_id FROM fg_operacion_detalle od
                            WHERE ((d.operacion_id IS NOT NULL AND od.operacion_id = d.operacion_id)
                                OR (d.certificado_id IS NOT NULL AND od.certificado_id = d.certificado_id))
                        )) AS modelos_vehiculo,
                       (SELECT STRING_AGG(DISTINCT cv.numero_motor, ', ' ORDER BY cv.numero_motor)
                        FROM fg_certificado_vehiculo cv
                        WHERE cv.certificado_id = d.certificado_id OR cv.certificado_id IN (
                            SELECT od.certificado_id FROM fg_operacion_detalle od
                            WHERE ((d.operacion_id IS NOT NULL AND od.operacion_id = d.operacion_id)
                                OR (d.certificado_id IS NOT NULL AND od.certificado_id = d.certificado_id))
                        )) AS motores_vehiculo,
                       (SELECT STRING_AGG(DISTINCT cv.categoria, ', ' ORDER BY cv.categoria)
                        FROM fg_certificado_vehiculo cv
                        WHERE cv.certificado_id = d.certificado_id OR cv.certificado_id IN (
                            SELECT od.certificado_id FROM fg_operacion_detalle od
                            WHERE ((d.operacion_id IS NOT NULL AND od.operacion_id = d.operacion_id)
                                OR (d.certificado_id IS NOT NULL AND od.certificado_id = d.certificado_id))
                        )) AS categorias_vehiculo
                
            ) comercial ON TRUE
            LEFT JOIN LATERAL (
                SELECT STRING_AGG(DISTINCT CONCAT_WS('-', nc.serie, nc.numero::text), ', ' ORDER BY CONCAT_WS('-', nc.serie, nc.numero::text)) AS notas_credito,
                       COUNT(DISTINCT nc.id)::int AS cantidad_notas_credito
                FROM fg_credito nc
                WHERE nc.facturacion_id = d.facturacion_id AND d.tipo_comprobante <> 'NOTA DE CRÉDITO'
                  AND nc.estado <> 'BORRADOR'
            ) notas ON TRUE
            LEFT JOIN LATERAL (
                SELECT STRING_AGG(DISTINCT CONCAT_WS('-', nd.serie, nd.numero::text), ', ' ORDER BY CONCAT_WS('-', nd.serie, nd.numero::text)) AS notas_debito,
                       COUNT(DISTINCT nd.id)::int AS cantidad_notas_debito
                FROM fg_debito nd
                WHERE nd.facturacion_id = d.facturacion_id AND d.tipo_comprobante <> 'NOTA DE DÉBITO'
                  AND nd.estado <> 'BORRADOR'
            ) notas_debito ON TRUE
            LEFT JOIN LATERAL (
                SELECT da.codigo_unico, da.fecha_creacion, da.fecha_aceptacion,
                       da.estado, da.aceptada_sunat, da.ticket_sunat, da.motivo
                FROM fg_documento_anulacion da
                WHERE da.facturacion_id = d.facturacion_id
                ORDER BY da.id DESC LIMIT 1
            ) anulacion ON TRUE
            LEFT JOIN LATERAL (
                SELECT cert.fecha_emision,
                       ${lateralHoraCert}
                       (SELECT gnv.numero_chip FROM fg_certificado_gnv gnv WHERE gnv.certificado_id = cert.id) AS numero_chip,
                       (SELECT cv.placa FROM fg_certificado_vehiculo cv WHERE cv.certificado_id = cert.id) AS placa
                FROM fg_certificado cert
                WHERE cert.id = d.certificado_id
                LIMIT 1
            ) cert ON TRUE
            LEFT JOIN LATERAL (
                SELECT NULL::text AS numero_chip, NULL::text AS placa
            ) cert_pl ON TRUE
            LEFT JOIN LATERAL (
                SELECT NULL::text AS sede, NULL::text AS cliente, NULL::text AS tipo_operacion,
                       NULL::text AS cortesia_descuento, 0::numeric AS importe_pagado,
                       0::numeric AS saldo_pendiente, NULL::text AS estado_certificado,
                       NULL::text AS estado_comprobante
            ) cons ON TRUE
            ORDER BY d.fecha_emision, d.id_documento
        `, [plantas, inicio, fin]),
        db.query(`
            SELECT od.id AS id_detalle, oc.id AS operacion_id,
                   STRING_AGG(DISTINCT CONCAT_WS('-', f.serie, f.numero::text), ', ' ORDER BY CONCAT_WS('-', f.serie, f.numero::text)) AS documentos_asociados,
                   STRING_AGG(DISTINCT 'F-' || f.id::text, ', ' ORDER BY 'F-' || f.id::text) AS documentos_ids,
                   oc.planta_key, pl.nombre AS sede,
                   CASE
                       WHEN dup.id IS NOT NULL OR dup.numero_certificado_snapshot IS NOT NULL THEN 'COMPLEMENTARIO DUPLICADO'
                       WHEN od.tipo_item = 'PRODUCTO' OR (od.certificado_id IS NULL AND od.servicio_id IS NULL) OR UPPER(COALESCE(cs.nombre, cp.nombre, pf.tipo_producto, '')) LIKE '%COMPLEMENTAR%' THEN 'COMPLEMENTARIO VENTA DE PRODUCTO'
                       ELSE COALESCE(cs.nombre, cp.nombre, pf.tipo_producto)
                   END AS tipo_producto,
                   COALESCE(pf.codigo_sku, od.codigo_sku_snapshot) AS codigo_producto,
                   COALESCE(pf.descripcion, s.nombre, od.descripcion_snapshot) AS producto,
                   CASE
                       WHEN dup.id IS NOT NULL OR dup.numero_certificado_snapshot IS NOT NULL THEN 'ZZ'
                       WHEN od.servicio_id IS NOT NULL OR od.certificado_id IS NOT NULL THEN 'ZZ'
                       WHEN UPPER(COALESCE(cs.nombre, cp.nombre, pf.tipo_producto, '')) LIKE '%CERTIFIC%'
                         OR UPPER(COALESCE(cs.nombre, cp.nombre, pf.tipo_producto, '')) LIKE '%DUPLIC%'
                         OR UPPER(COALESCE(cs.nombre, cp.nombre, pf.tipo_producto, '')) LIKE '%INSPECC%'
                         OR UPPER(COALESCE(cs.nombre, cp.nombre, pf.tipo_producto, '')) LIKE '%TALLER%' THEN 'ZZ'
                       WHEN UPPER(COALESCE(pf.descripcion, s.nombre, od.descripcion_snapshot, '')) LIKE '%CHIP%' THEN 'NIU'
                       ELSE COALESCE(pf.unidad, od.unidad_snapshot, 'NIU')
                   END AS unidad, od.cantidad, od.precio_unitario,
                   pf.valor_referencial_unitario, od.afectacion_igv_snapshot AS codigo_afectacion_igv,
                   od.base_imponible, od.igv, od.importe_total,
                   COALESCE(c.numero_certificado, dup.numero_certificado_snapshot) AS certificado,
                   COALESCE(cv.placa, dup.placa) AS placa
            FROM fg_operacion_detalle od
            JOIN fg_operacion_comercial oc ON oc.id = od.operacion_id
            JOIN fg_facturacion f ON f.operacion_id = oc.id
            LEFT JOIN fg_planta pl ON pl.key = oc.planta_key
            LEFT JOIN fg_servicio s ON s.id = od.servicio_id
            LEFT JOIN fg_categoria_servicio cs ON cs.id = s.categoria_id
            LEFT JOIN fg_producto_facturacion pf ON pf.id = od.producto_facturacion_id
            LEFT JOIN fg_categoria_servicio cp ON cp.id = pf.categoria_id
            LEFT JOIN fg_certificado c ON c.id = od.certificado_id
            LEFT JOIN fg_certificado_vehiculo cv ON cv.certificado_id = c.id
            LEFT JOIN fg_certificado_duplicado dup ON dup.operacion_id = oc.id
            WHERE oc.planta_key = ANY($1::varchar[])
              AND ${filtroFechaFact} >= $2::date AND ${filtroFechaFact} < $3::date
              AND f.estado <> 'BORRADOR'
            GROUP BY od.id, oc.id, oc.planta_key, pl.nombre, cs.nombre, cp.nombre, pf.tipo_producto,
                     dup.id, dup.numero_certificado_snapshot, od.tipo_item, od.certificado_id, od.servicio_id,
                     pf.codigo_sku, od.codigo_sku_snapshot, pf.descripcion, s.nombre, od.descripcion_snapshot,
                     pf.unidad, od.unidad_snapshot, od.cantidad, od.precio_unitario, pf.valor_referencial_unitario,
                     od.afectacion_igv_snapshot, od.base_imponible, od.igv,
                     od.importe_total, c.numero_certificado, dup.numero_certificado_snapshot, cv.placa, dup.placa
            ORDER BY oc.id, od.orden, od.id
        `, [plantas, inicio, fin]),
        db.query(`
            SELECT vd.id AS id_detalle, v.id AS venta_id,
                   STRING_AGG(DISTINCT CONCAT_WS('-', f.serie, f.numero::text), ', ' ORDER BY CONCAT_WS('-', f.serie, f.numero::text)) AS documentos_asociados,
                   STRING_AGG(DISTINCT 'F-' || f.id::text, ', ' ORDER BY 'F-' || f.id::text) AS documentos_ids,
                   v.planta_key, pl.nombre AS sede, 'COMPLEMENTARIO VENTA DE PRODUCTO'::varchar AS tipo_producto,
                   pi.codigo AS codigo_producto, pi.nombre AS producto, COALESCE(pf.unidad, 'NIU') AS unidad,
                   vd.cantidad, vd.precio_unitario, pf.valor_referencial_unitario,
                   pf.tipo_afectacion_igv AS codigo_afectacion_igv, NULL::numeric AS base_imponible,
                   NULL::numeric AS igv, vd.total AS importe_total, NULL::text AS certificado, NULL::text AS placa
            FROM fg_venta_detalle vd
            JOIN fg_venta v ON v.id = vd.venta_id
            JOIN fg_facturacion f ON f.venta_id = v.id
            LEFT JOIN fg_planta pl ON pl.key = v.planta_key
            LEFT JOIN fg_producto_inventariable pi ON pi.id = vd.producto_inventariable_id
            LEFT JOIN fg_producto_inventariable_sede pis ON pis.producto_inventariable_id = pi.id AND pis.planta_key = v.planta_key
            LEFT JOIN fg_producto_facturacion pf ON pf.id = pis.producto_facturacion_id
            LEFT JOIN fg_categoria_servicio cat ON cat.id = pf.categoria_id
            WHERE v.planta_key = ANY($1::varchar[])
              AND ${filtroFechaFact} >= $2::date AND ${filtroFechaFact} < $3::date
              AND f.estado <> 'BORRADOR'
            GROUP BY vd.id, v.id, v.planta_key, pl.nombre, cat.nombre, pf.tipo_producto, pi.tipo,
                     pi.codigo, pi.nombre, pf.unidad, vd.cantidad, vd.precio_unitario, pf.valor_referencial_unitario,
                     pf.tipo_afectacion_igv, vd.total
            ORDER BY v.id, vd.id
        `, [plantas, inicio, fin])
    ]);

    return { cabeceras: cabeceras.rows, lineas: [...lineasOperacion.rows, ...lineasVenta.rows] };
}

module.exports = { obtenerDocumentosEmitidosExtendido };
