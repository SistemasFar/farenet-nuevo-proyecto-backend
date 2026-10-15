const db = require('../../../config/database');

/**
 * Normaliza fechas respetando la zona horaria America/Lima (-05:00)
 * y genera intervalos semiabiertos: [inicioDelDia, inicioDelDiaSiguiente)
 */
function calcularIntervaloFechas(desdeStr, hastaStr) {
    const regexFecha = /^\d{4}-\d{2}-\d{2}$/;
    
    // Si no vienen fechas, por defecto usamos los últimos 30 días
    const hoy = new Date();
    // Ajuste simple a hora local Perú
    const offsetLima = -5 * 60; // minutos
    const nowUtc = hoy.getTime() + (hoy.getTimezoneOffset() * 60000);
    const nowLima = new Date(nowUtc + (offsetLima * 60000));
    
    const anio = nowLima.getFullYear();
    const mes = String(nowLima.getMonth() + 1).padStart(2, '0');
    const dia = String(nowLima.getDate()).padStart(2, '0');
    const hoyStr = `${anio}-${mes}-${dia}`;
    
    const dStr = (desdeStr && regexFecha.test(desdeStr)) ? desdeStr : hoyStr;
    const hStr = (hastaStr && regexFecha.test(hastaStr)) ? hastaStr : dStr;
    
    // Intervalo actual semiabierto:
    // inicio: YYYY-MM-DD 00:00:00-05
    // fin: (hasta + 1 día) 00:00:00-05
    const inicioActual = `${dStr} 00:00:00-05`;
    
    const hastaDate = new Date(`${hStr}T00:00:00-05:00`);
    hastaDate.setDate(hastaDate.getDate() + 1);
    const hastaAnio = hastaDate.getFullYear();
    const hastaMes = String(hastaDate.getMonth() + 1).padStart(2, '0');
    const hastaDia = String(hastaDate.getDate()).padStart(2, '0');
    const finActual = `${hastaAnio}-${hastaMes}-${hastaDia} 00:00:00-05`;
    
    // Cálculo de duración en milisegundos para período anterior equivalente
    const tInicio = new Date(`${dStr}T00:00:00-05:00`).getTime();
    const tFin = hastaDate.getTime();
    const duracionMs = tFin - tInicio;
    
    const prevInicioDate = new Date(tInicio - duracionMs);
    const prevFinDate = new Date(tInicio);
    
    const fPrevInicio = formatFechaIso(prevInicioDate);
    const fPrevFin = formatFechaIso(prevFinDate);
    
    const inicioAnterior = `${fPrevInicio} 00:00:00-05`;
    const finAnterior = `${fPrevFin} 00:00:00-05`;
    
    return {
        desde: dStr,
        hasta: hStr,
        inicioActual,
        finActual,
        inicioAnterior,
        finAnterior
    };
}

function formatFechaIso(dateObj) {
    const y = dateObj.getFullYear();
    const m = String(dateObj.getMonth() + 1).padStart(2, '0');
    const d = String(dateObj.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function calcularVariacion(actual, anterior) {
    const valActual = Number(actual || 0);
    const valAnterior = Number(anterior || 0);
    const diferencia = valActual - valAnterior;
    
    if (valAnterior === 0) {
        if (valActual === 0) return { delta: 0, porcentaje: 0 };
        return { delta: diferencia, porcentaje: 100 };
    }
    const pct = ((diferencia / Math.abs(valAnterior)) * 100);
    return {
        delta: Number(diferencia.toFixed(2)),
        porcentaje: Number(pct.toFixed(1))
    };
}

/**
 * Resumen consolidado para tarjetas KPI, comparativa de período y series de tiempo
 */
async function obtenerResumenDashboard({ plantasAutorizadas, plantasFiltro, desde, hasta, tipoCertificado }) {
    if (!plantasAutorizadas || plantasAutorizadas.length === 0) {
        return respuestaVaciaResumen();
    }
    
    const plantas = (plantasFiltro && plantasFiltro.length > 0)
        ? plantasFiltro.filter(p => plantasAutorizadas.includes(p))
        : plantasAutorizadas;
        
    if (plantas.length === 0) {
        return respuestaVaciaResumen();
    }
    
    const { inicioActual, finActual, inicioAnterior, finAnterior, desde: dVal, hasta: hVal } = calcularIntervaloFechas(desde, hasta);

    // 1. Métricas período actual
    const [
        kpisActual,
        kpisAnterior,
        serieDiaria,
        distribucionCertificados,
        distribucionPagos,
        alertasInconsistencias
    ] = await Promise.all([
        consultarKpisPeriodo(plantas, inicioActual, finActual, tipoCertificado),
        consultarKpisPeriodo(plantas, inicioAnterior, finAnterior, tipoCertificado),
        consultarSerieDiaria(plantas, inicioActual, finActual),
        consultarDistribucionCertificados(plantas, inicioActual, finActual),
        consultarDistribucionPagos(plantas, inicioActual, finActual),
        consultarAlertas(plantas, inicioActual, finActual)
    ]);

    return {
        rango: {
            desde: dVal,
            hasta: hVal,
            inicioActual,
            finActual,
            inicioAnterior,
            finAnterior
        },
        plantasConsultadas: plantas,
        kpis: {
            ventaOperativaGenerada: {
                actual: kpisActual.ventaOperativaGenerada,
                anterior: kpisAnterior.ventaOperativaGenerada,
                ...calcularVariacion(kpisActual.ventaOperativaGenerada, kpisAnterior.ventaOperativaGenerada),
                tooltip: 'Suma de operaciones comerciales en estado PENDIENTE_PAGO, PAGADO y FACTURADO.'
            },
            ventaPagada: {
                actual: kpisActual.ventaPagada,
                anterior: kpisAnterior.ventaPagada,
                ...calcularVariacion(kpisActual.ventaPagada, kpisAnterior.ventaPagada),
                tooltip: 'Suma de operaciones comerciales en estado PAGADO y FACTURADO.'
            },
            ventaBruta: {
                actual: kpisActual.ventaBruta,
                anterior: kpisAnterior.ventaBruta,
                ...calcularVariacion(kpisActual.ventaBruta, kpisAnterior.ventaBruta),
                tooltip: 'Importe final de operaciones más el monto de descuentos APLICADOS vinculados.'
            },
            ventaNeta: {
                actual: kpisActual.ventaNeta,
                anterior: kpisAnterior.ventaNeta,
                ...calcularVariacion(kpisActual.ventaNeta, kpisAnterior.ventaNeta),
                tooltip: 'Venta de operaciones menos notas de crédito aceptadas más notas de débito aceptadas.'
            },
            totalCobrado: {
                actual: kpisActual.totalCobrado,
                anterior: kpisAnterior.totalCobrado,
                ...calcularVariacion(kpisActual.totalCobrado, kpisAnterior.totalCobrado),
                tooltip: 'Suma de pagos registrados en fg_pago con estado CAN (cancelado/efectivo).'
            },
            saldoPendiente: {
                actual: kpisActual.saldoPendiente,
                anterior: kpisAnterior.saldoPendiente,
                ...calcularVariacion(kpisActual.saldoPendiente, kpisAnterior.saldoPendiente),
                tooltip: 'Saldo pendiente por cobrar en órdenes vigentes no anuladas.'
            },
            cantidadOperaciones: {
                actual: kpisActual.cantidadOperaciones,
                anterior: kpisAnterior.cantidadOperaciones,
                ...calcularVariacion(kpisActual.cantidadOperaciones, kpisAnterior.cantidadOperaciones),
                tooltip: 'Número total de operaciones comerciales válidas en el período.'
            },
            ticketPromedio: {
                actual: kpisActual.ticketPromedio,
                anterior: kpisAnterior.ticketPromedio,
                ...calcularVariacion(kpisActual.ticketPromedio, kpisAnterior.ticketPromedio),
                tooltip: 'Venta operativa dividida entre la cantidad de operaciones.'
            },
            certificadosEmitidos: {
                actual: kpisActual.certificadosEmitidos,
                anterior: kpisAnterior.certificadosEmitidos,
                ...calcularVariacion(kpisActual.certificadosEmitidos, kpisAnterior.certificadosEmitidos),
                tooltip: 'Certificados oficiales en estado EMITIDO.'
            },
            certificadosPendientes: {
                actual: kpisActual.certificadosPendientes,
                anterior: kpisAnterior.certificadosPendientes,
                ...calcularVariacion(kpisActual.certificadosPendientes, kpisAnterior.certificadosPendientes),
                tooltip: 'Certificados en estado BORRADOR pendientes de completar o emitir.'
            },
            productosVendidos: {
                actual: kpisActual.unidadesProductosVendidos,
                anterior: kpisAnterior.unidadesProductosVendidos,
                ...calcularVariacion(kpisActual.unidadesProductosVendidos, kpisAnterior.unidadesProductosVendidos),
                tooltip: 'Unidades vendidas de productos inventariables y chips.'
            },
            montoDescontado: {
                actual: kpisActual.descuentosAplicados,
                anterior: kpisAnterior.descuentosAplicados,
                ...calcularVariacion(kpisActual.descuentosAplicados, kpisAnterior.descuentosAplicados),
                tooltip: 'Suma de descuentos realmente APLICADOS vinculados a las operaciones.'
            },
            facturasAceptadas: {
                actual: kpisActual.facturasAceptadas,
                anterior: kpisAnterior.facturasAceptadas,
                ...calcularVariacion(kpisActual.facturasAceptadas, kpisAnterior.facturasAceptadas),
                tooltip: 'Facturas electrónicas aceptadas por SUNAT.'
            },
            boletasAceptadas: {
                actual: kpisActual.boletasAceptadas,
                anterior: kpisAnterior.boletasAceptadas,
                ...calcularVariacion(kpisActual.boletasAceptadas, kpisAnterior.boletasAceptadas),
                tooltip: 'Boletas electrónicas aceptadas por SUNAT.'
            },
            comprobantesRechazadosOError: {
                actual: kpisActual.comprobantesRechazadosOError,
                anterior: kpisAnterior.comprobantesRechazadosOError,
                ...calcularVariacion(kpisActual.comprobantesRechazadosOError, kpisAnterior.comprobantesRechazadosOError),
                tooltip: 'Comprobantes fiscales con respuesta de rechazo o error técnico.'
            }
        },
        serieDiaria,
        distribucionCertificados,
        distribucionPagos,
        alertas: alertasInconsistencias
    };
}

async function consultarKpisPeriodo(plantas, inicio, fin, tipoCertificado) {
    // Consulta usando CTE independientes para garantizar que ninguna tabla multiplique a otra
    const query = `
        WITH ops AS (
            SELECT 
                oc.id,
                oc.planta_key,
                oc.estado,
                COALESCE(oc.importe_total, 0) AS importe_total,
                oc.fecha_creacion,
                f.id AS facturacion_id,
                f.estado AS facturacion_estado,
                f.tipo_comprobante AS facturacion_tipo
            FROM fg_operacion_comercial oc
            LEFT JOIN fg_facturacion f ON f.operacion_id = oc.id
            WHERE oc.planta_key = ANY($1::varchar[])
              AND oc.fecha_creacion >= $2::timestamptz AND oc.fecha_creacion < $3::timestamptz
              AND oc.estado NOT IN ('BORRADOR', 'ANULADO')
        ),
        ops_totales AS (
            SELECT 
                COUNT(id) AS cantidad_operaciones,
                COALESCE(SUM(importe_total), 0) AS venta_operativa_generada,
                COALESCE(SUM(CASE WHEN estado IN ('PAGADO', 'FACTURADO') THEN importe_total ELSE 0 END), 0) AS venta_pagada,
                COALESCE(SUM(CASE WHEN facturacion_id IS NOT NULL THEN importe_total ELSE 0 END), 0) AS venta_facturada
            FROM ops
        ),
        descuentos_ops AS (
            SELECT 
                COALESCE(SUM(dc.importe_descuento), 0) AS total_descuentos
            FROM fg_descuentocomprobante dc
            WHERE dc.estado = 'APLICADO'
              AND (
                  (dc.facturacion_id IS NOT NULL AND dc.facturacion_id IN (SELECT facturacion_id FROM ops WHERE facturacion_id IS NOT NULL))
                  OR (dc.certificado_id IS NOT NULL AND dc.certificado_id IN (
                      SELECT od.certificado_id FROM fg_operacion_detalle od JOIN ops ON ops.id = od.operacion_id WHERE od.certificado_id IS NOT NULL
                  ))
                  OR (dc.orden_pago_id IS NOT NULL AND dc.orden_pago_id IN (
                      SELECT op.id FROM fg_orden_pago op JOIN ops ON ops.id = op.operacion_id
                  ))
              )
        ),
        notas_fiscales AS (
            SELECT 
                COALESCE(SUM(CASE WHEN nc.estado = 'ACEPTADO' THEN nc.importe_total ELSE 0 END), 0) AS total_nc,
                COALESCE(SUM(CASE WHEN nd.estado = 'ACEPTADO' THEN nd.importe_total ELSE 0 END), 0) AS total_nd
            FROM fg_facturacion f
            LEFT JOIN fg_credito nc ON nc.facturacion_id = f.id
            LEFT JOIN fg_debito nd ON nd.facturacion_id = f.id
            WHERE (
                f.planta_key = ANY($1::varchar[])
                OR EXISTS (SELECT 1 FROM fg_operacion_comercial oc WHERE oc.id = f.operacion_id AND oc.planta_key = ANY($1::varchar[]))
            )
            AND f.fecha_creacion >= $2::timestamptz AND f.fecha_creacion < $3::timestamptz
        ),
        pagos_reales AS (
            SELECT 
                COALESCE(SUM(p.importe), 0) AS total_cobrado
            FROM fg_pago p
            JOIN fg_orden_pago op ON op.id = p.orden_pago_id
            WHERE (
                EXISTS (SELECT 1 FROM fg_operacion_comercial oc WHERE oc.id = op.operacion_id AND oc.planta_key = ANY($1::varchar[]))
                OR EXISTS (SELECT 1 FROM fg_certificado c WHERE c.id = op.certificado_id AND c.planta_key = ANY($1::varchar[]))
            )
            AND p.estado = 'CAN'
            AND p.fechacreacion >= $2::timestamptz AND p.fechacreacion < $3::timestamptz
        ),
        saldos AS (
            SELECT 
                COALESCE(SUM(op.saldo_pendiente), 0) AS saldo_pendiente
            FROM fg_orden_pago op
            WHERE (
                EXISTS (SELECT 1 FROM fg_operacion_comercial oc WHERE oc.id = op.operacion_id AND oc.planta_key = ANY($1::varchar[]))
                OR EXISTS (SELECT 1 FROM fg_certificado c WHERE c.id = op.certificado_id AND c.planta_key = ANY($1::varchar[]))
            )
            AND op.estado <> 'ANULADO'
            AND op.saldo_pendiente > 0
            AND op.fechacreacion >= $2::timestamptz AND op.fechacreacion < $3::timestamptz
        ),
        certs AS (
            SELECT 
                COUNT(c.id) AS total_certs,
                COUNT(CASE WHEN c.estado = 'EMITIDO' THEN 1 END) AS emitidos,
                COUNT(CASE WHEN c.estado = 'BORRADOR' THEN 1 END) AS pendientes,
                COUNT(CASE WHEN c.estado = 'ANULADO' THEN 1 END) AS anulados
            FROM fg_certificado c
            WHERE c.planta_key = ANY($1::varchar[])
              AND c.fecha_creacion >= $2::timestamptz AND c.fecha_creacion < $3::timestamptz
              AND ($4::varchar IS NULL OR c.tipo_certificado_clave = $4::varchar)
        ),
        productos AS (
            SELECT 
                COALESCE(SUM(od.cantidad), 0) AS unidades_vendidas
            FROM fg_operacion_detalle od
            JOIN fg_operacion_comercial oc ON oc.id = od.operacion_id
            WHERE oc.planta_key = ANY($1::varchar[])
              AND oc.fecha_creacion >= $2::timestamptz AND oc.fecha_creacion < $3::timestamptz
              AND oc.estado NOT IN ('BORRADOR', 'ANULADO')
              AND od.tipo_item = 'PRODUCTO'
        ),
        facturacion_totales AS (
            SELECT 
                COUNT(CASE WHEN f.tipo_comprobante = 'FACTURA' AND f.estado = 'ACEPTADO' THEN 1 END) AS facturas_aceptadas,
                COUNT(CASE WHEN f.tipo_comprobante = 'BOLETA' AND f.estado = 'ACEPTADO' THEN 1 END) AS boletas_aceptadas,
                COUNT(CASE WHEN f.estado IN ('RECHAZADO', 'ERROR') THEN 1 END) AS errores_comprobantes
            FROM fg_facturacion f
            WHERE (
                f.planta_key = ANY($1::varchar[])
                OR EXISTS (SELECT 1 FROM fg_operacion_comercial oc WHERE oc.id = f.operacion_id AND oc.planta_key = ANY($1::varchar[]))
            )
            AND f.fecha_creacion >= $2::timestamptz AND f.fecha_creacion < $3::timestamptz
            AND f.estado <> 'BORRADOR'
        )
        SELECT 
            ot.cantidad_operaciones,
            ot.venta_operativa_generada,
            ot.venta_pagada,
            ot.venta_facturada,
            d.total_descuentos,
            nf.total_nc,
            nf.total_nd,
            pr.total_cobrado,
            s.saldo_pendiente,
            c.total_certs,
            c.emitidos AS certs_emitidos,
            c.pendientes AS certs_pendientes,
            c.anulados AS certs_anulados,
            p.unidades_vendidas,
            ft.facturas_aceptadas,
            ft.boletas_aceptadas,
            ft.errores_comprobantes
        FROM ops_totales ot
        CROSS JOIN descuentos_ops d
        CROSS JOIN notas_fiscales nf
        CROSS JOIN pagos_reales pr
        CROSS JOIN saldos s
        CROSS JOIN certs c
        CROSS JOIN productos p
        CROSS JOIN facturacion_totales ft
    `;

    const res = await db.query(query, [plantas, inicio, fin, tipoCertificado || null]);
    const row = res.rows[0] || {};

    const ventaOperativa = Number(row.venta_operativa_generada || 0);
    const totalDescuentos = Number(row.total_descuentos || 0);
    const totalNc = Number(row.total_nc || 0);
    const totalNd = Number(row.total_nd || 0);
    const cantOps = Number(row.cantidad_operaciones || 0);

    const ventaBruta = Number((ventaOperativa + totalDescuentos).toFixed(2));
    const ventaNeta = Number((ventaOperativa - totalNc + totalNd).toFixed(2));
    const ticketPromedio = cantOps > 0 ? Number((ventaOperativa / cantOps).toFixed(2)) : 0;

    return {
        ventaOperativaGenerada: ventaOperativa,
        ventaPagada: Number(row.venta_pagada || 0),
        ventaFacturada: Number(row.venta_facturada || 0),
        ventaBruta,
        ventaNeta,
        descuentosAplicados: totalDescuentos,
        totalCobrado: Number(row.total_cobrado || 0),
        saldoPendiente: Number(row.saldo_pendiente || 0),
        cantidadOperaciones: cantOps,
        ticketPromedio,
        certificadosEmitidos: Number(row.certs_emitidos || 0),
        certificadosPendientes: Number(row.certs_pendientes || 0),
        certificadosAnulados: Number(row.certs_anulados || 0),
        unidadesProductosVendidos: Number(row.unidades_vendidas || 0),
        facturasAceptadas: Number(row.facturas_aceptadas || 0),
        boletasAceptadas: Number(row.boletas_aceptadas || 0),
        comprobantesRechazadosOError: Number(row.errores_comprobantes || 0)
    };
}

async function consultarSerieDiaria(plantas, inicio, fin) {
    const query = `
        SELECT 
            TO_CHAR(oc.fecha_creacion AT TIME ZONE 'America/Lima', 'YYYY-MM-DD') AS fecha,
            COALESCE(SUM(oc.importe_total), 0) AS venta,
            COUNT(oc.id) AS operaciones
        FROM fg_operacion_comercial oc
        WHERE oc.planta_key = ANY($1::varchar[])
          AND oc.fecha_creacion >= $2::timestamptz AND oc.fecha_creacion < $3::timestamptz
          AND oc.estado NOT IN ('BORRADOR', 'ANULADO')
        GROUP BY TO_CHAR(oc.fecha_creacion AT TIME ZONE 'America/Lima', 'YYYY-MM-DD')
        ORDER BY fecha ASC
    `;
    const res = await db.query(query, [plantas, inicio, fin]);
    return res.rows.map(r => ({
        fecha: r.fecha,
        venta: Number(r.venta),
        operaciones: Number(r.operaciones)
    }));
}

async function consultarDistribucionCertificados(plantas, inicio, fin) {
    const query = `
        SELECT 
            c.tipo_certificado_clave AS tipo,
            COUNT(c.id) AS cantidad,
            COUNT(CASE WHEN c.estado = 'EMITIDO' THEN 1 END) AS emitidos,
            COUNT(CASE WHEN c.estado = 'BORRADOR' THEN 1 END) AS pendientes,
            COALESCE(SUM(c.importe_total), 0) AS total_soles
        FROM fg_certificado c
        WHERE c.planta_key = ANY($1::varchar[])
          AND c.fecha_creacion >= $2::timestamptz AND c.fecha_creacion < $3::timestamptz
        GROUP BY c.tipo_certificado_clave
        ORDER BY cantidad DESC
    `;
    const res = await db.query(query, [plantas, inicio, fin]);
    return res.rows.map(r => ({
        tipo: r.tipo || 'OTROS',
        cantidad: Number(r.cantidad),
        emitidos: Number(r.emitidos),
        pendientes: Number(r.pendientes),
        totalSoles: Number(r.total_soles)
    }));
}

async function consultarDistribucionPagos(plantas, inicio, fin) {
    const query = `
        SELECT 
            p.tipocontado_key AS medio,
            COALESCE(SUM(p.importe), 0) AS total,
            COUNT(p.id) AS cantidad
        FROM fg_pago p
        JOIN fg_orden_pago op ON op.id = p.orden_pago_id
        WHERE (
            EXISTS (SELECT 1 FROM fg_operacion_comercial oc WHERE oc.id = op.operacion_id AND oc.planta_key = ANY($1::varchar[]))
            OR EXISTS (SELECT 1 FROM fg_certificado c WHERE c.id = op.certificado_id AND c.planta_key = ANY($1::varchar[]))
        )
        AND p.estado = 'CAN'
        AND p.fechacreacion >= $2::timestamptz AND p.fechacreacion < $3::timestamptz
        GROUP BY p.tipocontado_key
        ORDER BY total DESC
    `;
    const res = await db.query(query, [plantas, inicio, fin]);
    const totalCobrado = res.rows.reduce((acc, r) => acc + Number(r.total), 0);
    return res.rows.map(r => {
        const tot = Number(r.total);
        return {
            medio: r.medio ? String(r.medio).toUpperCase() : 'NO DEFINIDO',
            total: tot,
            cantidad: Number(r.cantidad),
            porcentaje: totalCobrado > 0 ? Number(((tot / totalCobrado) * 100).toFixed(1)) : 0
        };
    });
}

async function consultarAlertas(plantas, inicio, fin) {
    const query = `
        SELECT 
            op.id AS orden_id,
            op.operacion_id,
            COALESCE(c.planta_key, oc.planta_key) AS planta_key,
            op.estado,
            op.saldo_pendiente,
            op.importe_total,
            op.importe_pagado
        FROM fg_orden_pago op
        LEFT JOIN fg_certificado c ON c.id = op.certificado_id
        LEFT JOIN fg_operacion_comercial oc ON oc.id = op.operacion_id
        WHERE (
            (oc.planta_key IS NOT NULL AND oc.planta_key = ANY($1::varchar[]))
            OR (c.planta_key IS NOT NULL AND c.planta_key = ANY($1::varchar[]))
        )
        AND op.estado = 'PAGADO'
        AND op.saldo_pendiente > 0.01
        AND op.fechacreacion >= $2::timestamptz AND op.fechacreacion < $3::timestamptz
        LIMIT 10
    `;
    const res = await db.query(query, [plantas, inicio, fin]);
    return res.rows.map(r => ({
        tipo: 'ORDEN_PAGADA_CON_SALDO',
        mensaje: `La orden #${r.orden_id} tiene estado PAGADO pero conserva saldo pendiente de S/ ${Number(r.saldo_pendiente).toFixed(2)}`,
        ordenId: r.orden_id,
        plantaKey: r.planta_key,
        saldo: Number(r.saldo_pendiente)
    }));
}

/**
 * Detalle comparativo y ranking de sedes autorizadas
 */
async function obtenerDetalleSedes({ plantasAutorizadas, desde, hasta }) {
    if (!plantasAutorizadas || plantasAutorizadas.length === 0) return [];
    
    const { inicioActual, finActual } = calcularIntervaloFechas(desde, hasta);

    const query = `
        SELECT 
            p.key AS planta_key,
            p.nombre AS planta_nombre,
            COALESCE(ops.cantidad_operaciones, 0) AS cantidad_operaciones,
            COALESCE(ops.venta_operativa, 0) AS venta_operativa,
            COALESCE(certs.emitidos, 0) AS certificados_emitidos,
            COALESCE(certs.pendientes, 0) AS certificados_pendientes,
            COALESCE(cobrado.total_cobrado, 0) AS total_cobrado,
            COALESCE(saldos.saldo_pendiente, 0) AS saldo_pendiente
        FROM fg_planta p
        LEFT JOIN (
            SELECT 
                oc.planta_key,
                COUNT(oc.id) AS cantidad_operaciones,
                SUM(oc.importe_total) AS venta_operativa
            FROM fg_operacion_comercial oc
            WHERE oc.fecha_creacion >= $2::timestamptz AND oc.fecha_creacion < $3::timestamptz
              AND oc.estado NOT IN ('BORRADOR', 'ANULADO')
            GROUP BY oc.planta_key
        ) ops ON ops.planta_key = p.key
        LEFT JOIN (
            SELECT 
                c.planta_key,
                COUNT(CASE WHEN c.estado = 'EMITIDO' THEN 1 END) AS emitidos,
                COUNT(CASE WHEN c.estado = 'BORRADOR' THEN 1 END) AS pendientes
            FROM fg_certificado c
            WHERE c.fecha_creacion >= $2::timestamptz AND c.fecha_creacion < $3::timestamptz
            GROUP BY c.planta_key
        ) certs ON certs.planta_key = p.key
        LEFT JOIN (
            SELECT 
                COALESCE(c.planta_key, oc.planta_key) AS planta_key,
                SUM(pg.importe) AS total_cobrado
            FROM fg_pago pg
            JOIN fg_orden_pago op ON op.id = pg.orden_pago_id
            LEFT JOIN fg_certificado c ON c.id = op.certificado_id
            LEFT JOIN fg_operacion_comercial oc ON oc.id = op.operacion_id
            WHERE pg.estado = 'CAN'
              AND pg.fechacreacion >= $2::timestamptz AND pg.fechacreacion < $3::timestamptz
            GROUP BY COALESCE(c.planta_key, oc.planta_key)
        ) cobrado ON cobrado.planta_key = p.key
        LEFT JOIN (
            SELECT 
                COALESCE(c.planta_key, oc.planta_key) AS planta_key,
                SUM(op.saldo_pendiente) AS saldo_pendiente
            FROM fg_orden_pago op
            LEFT JOIN fg_certificado c ON c.id = op.certificado_id
            LEFT JOIN fg_operacion_comercial oc ON oc.id = op.operacion_id
            WHERE op.estado <> 'ANULADO' AND op.saldo_pendiente > 0
              AND op.fechacreacion >= $2::timestamptz AND op.fechacreacion < $3::timestamptz
            GROUP BY COALESCE(c.planta_key, oc.planta_key)
        ) saldos ON saldos.planta_key = p.key
        WHERE p.key = ANY($1::varchar[])
        ORDER BY venta_operativa DESC, cantidad_operaciones DESC
    `;

    const res = await db.query(query, [plantasAutorizadas, inicioActual, finActual]);
    return res.rows.map(r => {
        const ops = Number(r.cantidad_operaciones);
        const venta = Number(r.venta_operativa);
        return {
            plantaKey: r.planta_key,
            plantaNombre: r.planta_nombre,
            cantidadOperaciones: ops,
            ventaOperativa: venta,
            certificadosEmitidos: Number(r.certificados_emitidos),
            certificadosPendientes: Number(r.certificados_pendientes),
            totalCobrado: Number(r.total_cobrado),
            saldoPendiente: Number(r.saldo_pendiente),
            ticketPromedio: ops > 0 ? Number((venta / ops).toFixed(2)) : 0
        };
    });
}

/**
 * Detalle paginado de certificados
 */
async function obtenerDetalleCertificados({ plantasAutorizadas, plantasFiltro, desde, hasta, pagina = 1, limite = 20, estado, tipoCertificado, usuario }) {
    const plantas = (plantasFiltro && plantasFiltro.length > 0)
        ? plantasFiltro.filter(p => plantasAutorizadas.includes(p))
        : plantasAutorizadas;
    if (plantas.length === 0) return { items: [], total: 0, pagina: 1, limite };

    const { inicioActual, finActual } = calcularIntervaloFechas(desde, hasta);
    const offset = (Math.max(Number(pagina), 1) - 1) * Number(limite);

    const params = [plantas, inicioActual, finActual];
    let whereExtra = '';

    if (estado) {
        params.push(estado);
        whereExtra += ` AND c.estado = $${params.length}`;
    }
    if (tipoCertificado) {
        params.push(tipoCertificado);
        whereExtra += ` AND c.tipo_certificado_clave = $${params.length}`;
    }
    if (usuario) {
        params.push(usuario);
        whereExtra += ` AND c.usuario_creacion = $${params.length}`;
    }

    const countQuery = `
        SELECT COUNT(c.id) AS total
        FROM fg_certificado c
        WHERE c.planta_key = ANY($1::varchar[])
          AND c.fecha_creacion >= $2::timestamptz AND c.fecha_creacion < $3::timestamptz
          ${whereExtra}
    `;
    const countRes = await db.query(countQuery, params);
    const total = Number(countRes.rows[0]?.total || 0);

    const listQuery = `
        SELECT 
            c.id,
            c.numero_certificado,
            c.tipo_certificado_clave,
            c.estado,
            c.planta_key,
            p.nombre AS planta_nombre,
            c.usuario_creacion,
            c.fecha_creacion,
            c.fecha_emision,
            c.importe_total,
            v.placa,
            v.marca,
            v.modelo
        FROM fg_certificado c
        LEFT JOIN fg_planta p ON p.key = c.planta_key
        LEFT JOIN fg_certificado_vehiculo v ON v.certificado_id = c.id
        WHERE c.planta_key = ANY($1::varchar[])
          AND c.fecha_creacion >= $2::timestamptz AND c.fecha_creacion < $3::timestamptz
          ${whereExtra}
        ORDER BY c.id DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `;

    const listRes = await db.query(listQuery, [...params, limite, offset]);

    return {
        items: listRes.rows.map(r => ({
            id: r.id,
            numeroCertificado: r.numero_certificado,
            tipoCertificado: r.tipo_certificado_clave,
            estado: r.estado,
            plantaKey: r.planta_key,
            plantaNombre: r.planta_nombre || r.planta_key,
            usuarioCreacion: r.usuario_creacion,
            fechaCreacion: r.fecha_creacion,
            fechaEmision: r.fecha_emision,
            importeTotal: Number(r.importe_total || 0),
            placa: r.placa,
            marca: r.marca,
            modelo: r.modelo
        })),
        total,
        pagina: Number(pagina),
        limite: Number(limite)
    };
}

/**
 * Detalle de ventas de productos inventariables y chips
 */
async function obtenerDetalleProductos({ plantasAutorizadas, plantasFiltro, desde, hasta, pagina = 1, limite = 20 }) {
    const plantas = (plantasFiltro && plantasFiltro.length > 0)
        ? plantasFiltro.filter(p => plantasAutorizadas.includes(p))
        : plantasAutorizadas;
    if (plantas.length === 0) return { items: [], total: 0, pagina: 1, limite };

    const { inicioActual, finActual } = calcularIntervaloFechas(desde, hasta);
    const offset = (Math.max(Number(pagina), 1) - 1) * Number(limite);

    const query = `
        SELECT 
            COALESCE(od.codigo_sku_snapshot, 'SIN-SKU') AS sku,
            COALESCE(od.descripcion_snapshot, 'PRODUCTO') AS descripcion,
            COALESCE(od.unidad_snapshot, 'NIU') AS unidad,
            SUM(od.cantidad) AS total_unidades,
            SUM(od.importe_total) AS total_soles,
            COUNT(DISTINCT oc.id) AS total_operaciones,
            ROUND(SUM(od.importe_total) / NULLIF(SUM(od.cantidad), 0), 2) AS precio_promedio
        FROM fg_operacion_detalle od
        JOIN fg_operacion_comercial oc ON oc.id = od.operacion_id
        WHERE oc.planta_key = ANY($1::varchar[])
          AND oc.fecha_creacion >= $2::timestamptz AND oc.fecha_creacion < $3::timestamptz
          AND oc.estado NOT IN ('BORRADOR', 'ANULADO')
          AND od.tipo_item = 'PRODUCTO'
        GROUP BY od.codigo_sku_snapshot, od.descripcion_snapshot, od.unidad_snapshot
        ORDER BY total_soles DESC, total_unidades DESC
    `;

    const allRes = await db.query(query, [plantas, inicioActual, finActual]);
    const total = allRes.rows.length;
    const paginados = allRes.rows.slice(offset, offset + Number(limite));

    return {
        items: paginados.map(r => ({
            sku: r.sku,
            descripcion: r.descripcion,
            unidad: r.unidad,
            unidadesVendidas: Number(r.total_unidades),
            totalSoles: Number(r.total_soles),
            operaciones: Number(r.total_operaciones),
            precioPromedio: Number(r.precio_promedio)
        })),
        total,
        pagina: Number(pagina),
        limite: Number(limite)
    };
}

/**
 * Detalle fiscal de comprobantes
 */
async function obtenerDetalleComprobantes({ plantasAutorizadas, plantasFiltro, desde, hasta, pagina = 1, limite = 20, tipoComprobante, estado }) {
    const plantas = (plantasFiltro && plantasFiltro.length > 0)
        ? plantasFiltro.filter(p => plantasAutorizadas.includes(p))
        : plantasAutorizadas;
    if (plantas.length === 0) return { items: [], total: 0, pagina: 1, limite };

    const { inicioActual, finActual } = calcularIntervaloFechas(desde, hasta);
    const offset = (Math.max(Number(pagina), 1) - 1) * Number(limite);

    const params = [plantas, inicioActual, finActual];
    let whereExtra = '';

    if (tipoComprobante) {
        params.push(tipoComprobante);
        whereExtra += ` AND f.tipo_comprobante = $${params.length}`;
    }
    if (estado) {
        params.push(estado);
        whereExtra += ` AND f.estado = $${params.length}`;
    }

    const countQuery = `
        SELECT COUNT(f.id) AS total
        FROM fg_facturacion f
        WHERE (
            f.planta_key = ANY($1::varchar[])
            OR EXISTS (SELECT 1 FROM fg_operacion_comercial oc WHERE oc.id = f.operacion_id AND oc.planta_key = ANY($1::varchar[]))
        )
        AND f.fecha_creacion >= $2::timestamptz AND f.fecha_creacion < $3::timestamptz
        AND f.estado <> 'BORRADOR'
        ${whereExtra}
    `;
    const countRes = await db.query(countQuery, params);
    const total = Number(countRes.rows[0]?.total || 0);

    const listQuery = `
        SELECT 
            f.id,
            f.tipo_comprobante,
            f.serie,
            f.numero,
            f.nro_comprobante,
            f.nro_documento,
            f.nombre_razon_social,
            f.condicion_pago,
            f.medio_pago,
            f.estado,
            f.base_imponible,
            f.igv,
            f.importe_total,
            f.fecha_documento,
            f.fecha_creacion,
            COALESCE(f.planta_key, oc.planta_key) AS planta_key,
            p.nombre AS planta_nombre
        FROM fg_facturacion f
        LEFT JOIN fg_operacion_comercial oc ON oc.id = f.operacion_id
        LEFT JOIN fg_planta p ON p.key = COALESCE(f.planta_key, oc.planta_key)
        WHERE (
            f.planta_key = ANY($1::varchar[])
            OR EXISTS (SELECT 1 FROM fg_operacion_comercial oc2 WHERE oc2.id = f.operacion_id AND oc2.planta_key = ANY($1::varchar[]))
        )
        AND f.fecha_creacion >= $2::timestamptz AND f.fecha_creacion < $3::timestamptz
        AND f.estado <> 'BORRADOR'
        ${whereExtra}
        ORDER BY f.id DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `;

    const listRes = await db.query(listQuery, [...params, limite, offset]);

    return {
        items: listRes.rows.map(r => ({
            id: r.id,
            tipoComprobante: r.tipo_comprobante,
            serie: r.serie,
            numero: r.numero,
            nroComprobante: r.nro_comprobante,
            documentoCliente: r.nro_documento,
            cliente: r.nombre_razon_social,
            condicionPago: r.condicion_pago,
            medioPago: r.medio_pago,
            estado: r.estado,
            baseImponible: Number(r.base_imponible || 0),
            igv: Number(r.igv || 0),
            importeTotal: Number(r.importe_total || 0),
            fechaDocumento: r.fecha_documento,
            fechaCreacion: r.fecha_creacion,
            plantaKey: r.planta_key,
            plantaNombre: r.planta_nombre || r.planta_key
        })),
        total,
        pagina: Number(pagina),
        limite: Number(limite)
    };
}

/**
 * Detalle de cobros y pagos
 */
async function obtenerDetallePagos({ plantasAutorizadas, plantasFiltro, desde, hasta, pagina = 1, limite = 20, medioPago }) {
    const plantas = (plantasFiltro && plantasFiltro.length > 0)
        ? plantasFiltro.filter(p => plantasAutorizadas.includes(p))
        : plantasAutorizadas;
    if (plantas.length === 0) return { items: [], total: 0, pagina: 1, limite };

    const { inicioActual, finActual } = calcularIntervaloFechas(desde, hasta);
    const offset = (Math.max(Number(pagina), 1) - 1) * Number(limite);

    const params = [plantas, inicioActual, finActual];
    let whereExtra = '';

    if (medioPago) {
        params.push(medioPago.toLowerCase());
        whereExtra += ` AND LOWER(p.tipocontado_key) = $${params.length}`;
    }

    const countQuery = `
        SELECT COUNT(p.id) AS total
        FROM fg_pago p
        JOIN fg_orden_pago op ON op.id = p.orden_pago_id
        LEFT JOIN fg_certificado c ON c.id = op.certificado_id
        LEFT JOIN fg_operacion_comercial oc ON oc.id = op.operacion_id
        WHERE (
            (oc.planta_key IS NOT NULL AND oc.planta_key = ANY($1::varchar[]))
            OR (c.planta_key IS NOT NULL AND c.planta_key = ANY($1::varchar[]))
        )
        AND p.estado = 'CAN'
        AND p.fechacreacion >= $2::timestamptz AND p.fechacreacion < $3::timestamptz
        ${whereExtra}
    `;
    const countRes = await db.query(countQuery, params);
    const total = Number(countRes.rows[0]?.total || 0);

    const listQuery = `
        SELECT 
            p.id,
            p.orden_pago_id,
            p.importe,
            p.tipocontado_key,
            p.tarjeta_key,
            p.entidadfinanciera_key,
            p.nrooperacionbanco AS nro_operacion,
            p.fechacreacion,
            p.estado,
            op.usuariocreacion_username AS registrado_por,
            COALESCE(c.planta_key, oc.planta_key) AS planta_key,
            pl.nombre AS planta_nombre
        FROM fg_pago p
        JOIN fg_orden_pago op ON op.id = p.orden_pago_id
        LEFT JOIN fg_certificado c ON c.id = op.certificado_id
        LEFT JOIN fg_operacion_comercial oc ON oc.id = op.operacion_id
        LEFT JOIN fg_planta pl ON pl.key = COALESCE(c.planta_key, oc.planta_key)
        WHERE (
            (oc.planta_key IS NOT NULL AND oc.planta_key = ANY($1::varchar[]))
            OR (c.planta_key IS NOT NULL AND c.planta_key = ANY($1::varchar[]))
        )
        AND p.estado = 'CAN'
        AND p.fechacreacion >= $2::timestamptz AND p.fechacreacion < $3::timestamptz
        ${whereExtra}
        ORDER BY p.id DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `;

    const listRes = await db.query(listQuery, [...params, limite, offset]);

    return {
        items: listRes.rows.map(r => ({
            id: r.id,
            ordenPagoId: r.orden_pago_id,
            importe: Number(r.importe),
            medioPago: r.tipocontado_key ? String(r.tipocontado_key).toUpperCase() : 'EFECTIVO',
            tarjetaTipo: r.tarjeta_key,
            banco: r.entidadfinanciera_key,
            nroOperacion: r.nro_operacion,
            fechaCreacion: r.fechacreacion,
            estado: r.estado,
            registradoPor: r.registrado_por || 'Sistema',
            plantaKey: r.planta_key,
            plantaNombre: r.planta_nombre || r.planta_key
        })),
        total,
        pagina: Number(pagina),
        limite: Number(limite)
    };
}

/**
 * Detalle de descuentos y cupones
 */
async function obtenerDetalleDescuentos({ plantasAutorizadas, plantasFiltro, desde, hasta, pagina = 1, limite = 20 }) {
    const plantas = (plantasFiltro && plantasFiltro.length > 0)
        ? plantasFiltro.filter(p => plantasAutorizadas.includes(p))
        : plantasAutorizadas;
    if (plantas.length === 0) return { items: [], total: 0, pagina: 1, limite };

    const { inicioActual, finActual } = calcularIntervaloFechas(desde, hasta);
    const offset = (Math.max(Number(pagina), 1) - 1) * Number(limite);

    const countQuery = `
        SELECT COUNT(dc.id) AS total
        FROM fg_descuentocomprobante dc
        LEFT JOIN fg_descuentocliente dcli ON dcli.id = dc.descuento_cliente_id
        LEFT JOIN fg_certificado c ON c.id = dc.certificado_id
        LEFT JOIN fg_facturacion f ON f.id = dc.facturacion_id
        WHERE (
            (c.planta_key IS NOT NULL AND c.planta_key = ANY($1::varchar[]))
            OR (f.planta_key IS NOT NULL AND f.planta_key = ANY($1::varchar[]))
            OR (dcli.planta_key IS NOT NULL AND dcli.planta_key = ANY($1::varchar[]))
        )
        AND dc.fecha_aplicacion >= $2::timestamptz AND dc.fecha_aplicacion < $3::timestamptz
    `;
    const countRes = await db.query(countQuery, [plantas, inicioActual, finActual]);
    const total = Number(countRes.rows[0]?.total || 0);

    const listQuery = `
        SELECT 
            dc.id,
            dcli.descuento_id,
            COALESCE(dcli.codigo, f.codigo_descuento_snapshot) AS codigo_cupon,
            dc.importe_original,
            dc.importe_descuento,
            dc.importe_final,
            dc.estado,
            dc.fecha_aplicacion,
            dc.certificado_id,
            dc.orden_pago_id,
            dc.facturacion_id,
            d.nombre AS campana_nombre,
            d.tipo AS campana_tipo,
            COALESCE(c.planta_key, f.planta_key, dcli.planta_key) AS planta_key,
            pl.nombre AS planta_nombre
        FROM fg_descuentocomprobante dc
        LEFT JOIN fg_descuentocliente dcli ON dcli.id = dc.descuento_cliente_id
        LEFT JOIN fg_descuento d ON d.id = dcli.descuento_id
        LEFT JOIN fg_certificado c ON c.id = dc.certificado_id
        LEFT JOIN fg_facturacion f ON f.id = dc.facturacion_id
        LEFT JOIN fg_planta pl ON pl.key = COALESCE(c.planta_key, f.planta_key, dcli.planta_key)
        WHERE (
            (c.planta_key IS NOT NULL AND c.planta_key = ANY($1::varchar[]))
            OR (f.planta_key IS NOT NULL AND f.planta_key = ANY($1::varchar[]))
            OR (dcli.planta_key IS NOT NULL AND dcli.planta_key = ANY($1::varchar[]))
        )
        AND dc.fecha_aplicacion >= $2::timestamptz AND dc.fecha_aplicacion < $3::timestamptz
        ORDER BY dc.id DESC
        LIMIT $4 OFFSET $5
    `;

    const listRes = await db.query(listQuery, [plantas, inicioActual, finActual, limite, offset]);

    return {
        items: listRes.rows.map(r => ({
            id: r.id,
            cupon: r.codigo_cupon,
            campana: r.campana_nombre || 'CAMPAÑA FAREGAS',
            tipo: r.campana_tipo,
            importeOriginal: Number(r.importe_original),
            importeDescuento: Number(r.importe_descuento),
            importeFinal: Number(r.importe_final),
            estado: r.estado,
            fechaAplicacion: r.fecha_aplicacion,
            certificadoId: r.certificado_id,
            ordenPagoId: r.orden_pago_id,
            facturacionId: r.facturacion_id,
            plantaKey: r.planta_key,
            plantaNombre: r.planta_nombre || r.planta_key
        })),
        total,
        pagina: Number(pagina),
        limite: Number(limite)
    };
}

/**
 * Detalle de rendimiento por usuario / cajero
 */
async function obtenerDetalleUsuarios({ plantasAutorizadas, plantasFiltro, desde, hasta }) {
    const plantas = (plantasFiltro && plantasFiltro.length > 0)
        ? plantasFiltro.filter(p => plantasAutorizadas.includes(p))
        : plantasAutorizadas;
    if (plantas.length === 0) return [];

    const { inicioActual, finActual } = calcularIntervaloFechas(desde, hasta);

    const query = `
        SELECT 
            oc.usuario_creacion AS username,
            COALESCE(TRIM(CONCAT(p.nombres, ' ', p.apellidos)), p.nombrerazonsocial, oc.usuario_creacion) AS nombre,
            COUNT(DISTINCT oc.id) AS total_operaciones,
            COALESCE(SUM(DISTINCT oc.importe_total), 0) AS total_vendido,
            COUNT(DISTINCT od.certificado_id) FILTER (WHERE od.tipo_item = 'SERVICIO' AND od.certificado_id IS NOT NULL) AS certificados_generados,
            COALESCE(SUM(od.cantidad) FILTER (WHERE od.tipo_item = 'PRODUCTO'), 0) AS productos_vendidos,
            MAX(oc.fecha_creacion) AS ultima_operacion
        FROM fg_operacion_comercial oc
        LEFT JOIN fg_operacion_detalle od ON od.operacion_id = oc.id
        LEFT JOIN fg_usuario u ON u.username = oc.usuario_creacion
        LEFT JOIN persona p ON p.nrodocumentoidentidad = u.persona_nrodocumentoidentidad
        WHERE oc.planta_key = ANY($1::varchar[])
          AND oc.fecha_creacion >= $2::timestamptz AND oc.fecha_creacion < $3::timestamptz
          AND oc.estado NOT IN ('BORRADOR', 'ANULADO')
        GROUP BY oc.usuario_creacion, p.nombres, p.apellidos, p.nombrerazonsocial
        ORDER BY total_vendido DESC, total_operaciones DESC
    `;

    const res = await db.query(query, [plantas, inicioActual, finActual]);
    return res.rows.map(r => {
        const ops = Number(r.total_operaciones);
        const venta = Number(r.total_vendido);
        return {
            username: r.username,
            nombre: r.nombre,
            totalOperaciones: ops,
            totalVendido: venta,
            certificadosGenerados: Number(r.certificados_generados),
            productosVendidos: Number(r.productos_vendidos),
            ticketPromedio: ops > 0 ? Number((venta / ops).toFixed(2)) : 0,
            ultimaOperacion: r.ultima_operacion
        };
    });
}

/**
 * Consulta de datos completa estructurada para exportación Excel
 * Limita el conjunto a 5,000 registros por hoja para no saturar memoria
 */
async function obtenerDatosExportacion({ plantasAutorizadas, plantasFiltro, desde, hasta, username }) {
    const plantas = (plantasFiltro && plantasFiltro.length > 0)
        ? plantasFiltro.filter(p => plantasAutorizadas.includes(p))
        : plantasAutorizadas;
    if (plantas.length === 0) return null;

    const resumen = await obtenerResumenDashboard({ plantasAutorizadas, plantasFiltro, desde, hasta });
    const sedes = await obtenerDetalleSedes({ plantasAutorizadas: plantas, desde, hasta });
    const certs = await obtenerDetalleCertificados({ plantasAutorizadas: plantas, desde, hasta, pagina: 1, limite: 5000 });
    const prods = await obtenerDetalleProductos({ plantasAutorizadas: plantas, desde, hasta, pagina: 1, limite: 5000 });
    const comprobantes = await obtenerDetalleComprobantes({ plantasAutorizadas: plantas, desde, hasta, pagina: 1, limite: 5000 });
    const pagos = await obtenerDetallePagos({ plantasAutorizadas: plantas, desde, hasta, pagina: 1, limite: 5000 });
    const descuentos = await obtenerDetalleDescuentos({ plantasAutorizadas: plantas, desde, hasta, pagina: 1, limite: 5000 });
    const usuarios = await obtenerDetalleUsuarios({ plantasAutorizadas: plantas, desde, hasta });

    return {
        metadatos: {
            rango: `${resumen.rango.desde} a ${resumen.rango.hasta}`,
            fechaGeneracion: new Date().toISOString(),
            usuarioExportador: username || 'Usuario',
            sedesIncluidas: plantas.join(', ')
        },
        hojas: {
            resumen,
            sedes,
            certificados: certs.items,
            ventasProductos: prods.items,
            comprobantes: comprobantes.items,
            pagos: pagos.items,
            descuentos: descuentos.items,
            usuarios
        }
    };
}

function respuestaVaciaResumen() {
    return {
        rango: { desde: '', hasta: '' },
        plantasConsultadas: [],
        kpis: {
            ventaOperativaGenerada: { actual: 0, anterior: 0, delta: 0, porcentaje: 0, tooltip: '' },
            ventaPagada: { actual: 0, anterior: 0, delta: 0, porcentaje: 0, tooltip: '' },
            ventaBruta: { actual: 0, anterior: 0, delta: 0, porcentaje: 0, tooltip: '' },
            ventaNeta: { actual: 0, anterior: 0, delta: 0, porcentaje: 0, tooltip: '' },
            totalCobrado: { actual: 0, anterior: 0, delta: 0, porcentaje: 0, tooltip: '' },
            saldoPendiente: { actual: 0, anterior: 0, delta: 0, porcentaje: 0, tooltip: '' },
            cantidadOperaciones: { actual: 0, anterior: 0, delta: 0, porcentaje: 0, tooltip: '' },
            ticketPromedio: { actual: 0, anterior: 0, delta: 0, porcentaje: 0, tooltip: '' },
            certificadosEmitidos: { actual: 0, anterior: 0, delta: 0, porcentaje: 0, tooltip: '' },
            certificadosPendientes: { actual: 0, anterior: 0, delta: 0, porcentaje: 0, tooltip: '' },
            productosVendidos: { actual: 0, anterior: 0, delta: 0, porcentaje: 0, tooltip: '' },
            montoDescontado: { actual: 0, anterior: 0, delta: 0, porcentaje: 0, tooltip: '' },
            facturasAceptadas: { actual: 0, anterior: 0, delta: 0, porcentaje: 0, tooltip: '' },
            boletasAceptadas: { actual: 0, anterior: 0, delta: 0, porcentaje: 0, tooltip: '' },
            comprobantesRechazadosOError: { actual: 0, anterior: 0, delta: 0, porcentaje: 0, tooltip: '' }
        },
        serieDiaria: [],
        distribucionCertificados: [],
        distribucionPagos: [],
        alertas: []
    };
}

module.exports = {
    calcularIntervaloFechas,
    calcularVariacion,
    obtenerResumenDashboard,
    obtenerDetalleSedes,
    obtenerDetalleCertificados,
    obtenerDetalleProductos,
    obtenerDetalleComprobantes,
    obtenerDetallePagos,
    obtenerDetalleDescuentos,
    obtenerDetalleUsuarios,
    obtenerDatosExportacion
};
