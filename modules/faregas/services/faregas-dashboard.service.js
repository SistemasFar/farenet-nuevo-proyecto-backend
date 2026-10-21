const db = require('../../../config/database');
const { esDocumentoBaseOperable } = require('./faregas-documento-tributario-policy');
const { validarRangoFechasDashboard } = require('./faregas-dashboard-fechas.service');

// Equivalente SQL de esDocumentoBaseOperable. En PRODUCCION exige aceptación
// SUNAT; en DEMO acepta la generación completa de NubeFact con identidad y
// artefacto fiscal, aunque el estado permanezca PENDIENTE_SUNAT.
const SQL_COMPROBANTE_EMITIDO_EXITOSAMENTE = `(
    (f.estado = 'ACEPTADO' AND f.aceptada_sunat IS TRUE)
    OR (
        UPPER(COALESCE(f.entorno_facturador, '')) = 'DEMO'
        AND UPPER(COALESCE(f.proveedor, '')) = 'NUBEFACT'
        AND f.estado = 'PENDIENTE_SUNAT'
        AND NULLIF(BTRIM(f.nro_comprobante), '') IS NOT NULL
        AND NULLIF(BTRIM(f.serie), '') IS NOT NULL
        AND f.numero IS NOT NULL
        AND (
            NULLIF(BTRIM(f.enlace_pdf), '') IS NOT NULL
            OR NULLIF(BTRIM(f.enlace_xml), '') IS NOT NULL
        )
    )
)`;

// Clasificación funcional configurada en Catálogo > Tipos de certificado.
// Primero respeta la categoría del servicio realmente vendido; para registros
// históricos sin detalle/tarifa conserva una regla de compatibilidad segura.
function sqlCategoriaCertificado(alias = 'c') {
    return `COALESCE(
        (
            SELECT categoria_operacion.codigo
            FROM fg_operacion_detalle detalle_categoria
            JOIN fg_servicio servicio_operacion ON servicio_operacion.id = detalle_categoria.servicio_id
            JOIN fg_categoria_servicio categoria_operacion ON categoria_operacion.id = servicio_operacion.categoria_id
            WHERE detalle_categoria.certificado_id = ${alias}.id
            ORDER BY detalle_categoria.id DESC
            LIMIT 1
        ),
        (
            SELECT categoria_tarifa.codigo
            FROM fg_tarifa tarifa_categoria
            JOIN fg_servicio servicio_tarifa ON servicio_tarifa.id = tarifa_categoria.servicio_id
            JOIN fg_categoria_servicio categoria_tarifa ON categoria_tarifa.id = servicio_tarifa.categoria_id
            WHERE tarifa_categoria.planta_key = ${alias}.planta_key
              AND tarifa_categoria.codigo = ${alias}.tarifa_codigo
            ORDER BY tarifa_categoria.id DESC
            LIMIT 1
        ),
        CASE
            WHEN ${alias}.tipo_certificado_clave LIKE 'GLP%' OR ${alias}.tipo_certificado_clave = 'TALLER_GLP' THEN 'GLP'
            WHEN ${alias}.tipo_certificado_clave LIKE 'GNV%' OR ${alias}.tipo_certificado_clave = 'TALLER_GNV' THEN 'GNV'
            WHEN ${alias}.tipo_certificado_clave = 'CONFORMIDAD' THEN 'CONFORMIDAD'
            ELSE 'COMPLEMENTARIOS'
        END
    )`;
}

function sqlCategoriaDuplicado(alias = 'd') {
    return `CASE
        WHEN UPPER(${alias}.tipo_certificado_clave) LIKE 'GLP%' THEN 'GLP'
        WHEN UPPER(${alias}.tipo_certificado_clave) LIKE 'GNV%' THEN 'GNV'
        WHEN UPPER(${alias}.tipo_certificado_clave) = 'CONFORMIDAD' THEN 'CONFORMIDAD'
        ELSE 'COMPLEMENTARIOS'
    END`;
}

function normalizarTipoDuplicado(valor) {
    const tipo = String(valor || '').trim().toUpperCase();
    if (!tipo || tipo === 'TODOS') return null;
    const permitidos = new Set(['GLP', 'GNV', 'CONFORMIDAD', 'COMPLEMENTARIOS']);
    if (!permitidos.has(tipo)) {
        const error = new Error(`Tipo de duplicado no válido: ${tipo}`);
        error.status = 400;
        error.codigo = 'TIPO_DUPLICADO_INVALIDO';
        throw error;
    }
    return tipo;
}

function resolverTipoDuplicado(tipoCertificado, tipoDuplicado) {
    const general = normalizarTipoDuplicado(tipoCertificado);
    const especifico = normalizarTipoDuplicado(tipoDuplicado);
    if (general && especifico && general !== especifico) {
        const error = new Error('El tipo general y el tipo específico de duplicado son incompatibles.');
        error.status = 400;
        error.codigo = 'FILTROS_TIPO_DUPLICADO_INCOMPATIBLES';
        throw error;
    }
    return especifico || general;
}

/**
 * Normaliza fechas respetando la zona horaria America/Lima (-05:00)
 * y genera intervalos semiabiertos: [inicioDelDia, inicioDelDiaSiguiente)
 */
function calcularIntervaloFechas(desdeStr, hastaStr) {
    if (desdeStr || hastaStr) {
        const dVal = desdeStr || hastaStr;
        const hVal = hastaStr || desdeStr;
        const checkFechas = validarRangoFechasDashboard(dVal, hVal);
        if (!checkFechas.valido) {
            const error = new Error(checkFechas.mensaje);
            error.status = 400;
            error.codigo = checkFechas.codigo;
            error.fechaMaximaPermitida = checkFechas.fechaMaximaPermitida;
            throw error;
        }
    }
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
async function obtenerResumenDashboard({ plantasAutorizadas, plantasFiltro, desde, hasta, tipoCertificado, tipoDuplicado, productoId }) {
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
    const tipoDuplicadoAplicado = resolverTipoDuplicado(tipoCertificado, tipoDuplicado);

    // 1. Métricas período actual
    const [
        kpisActual,
        kpisAnterior,
        kpisCertificadosActual,
        kpisCertificadosAnterior,
        serieDiaria,
        serieCertificados,
        distribucionCertificados,
        distribucionProductos,
        distribucionPagos,
        alertasInconsistencias,
        kpisProdActual,
        kpisProdAnterior,
        kpisDuplicadosActual,
        kpisDuplicadosAnterior,
        serieDuplicados,
        distribucionDuplicados
    ] = await Promise.all([
        consultarKpisPeriodo(plantas, inicioActual, finActual, tipoCertificado),
        consultarKpisPeriodo(plantas, inicioAnterior, finAnterior, tipoCertificado),
        consultarKpisCertificadosPeriodo(plantas, inicioActual, finActual, tipoCertificado),
        consultarKpisCertificadosPeriodo(plantas, inicioAnterior, finAnterior, tipoCertificado),
        consultarSerieDiaria(plantas, inicioActual, finActual, productoId),
        consultarSerieCertificados(plantas, inicioActual, finActual, tipoCertificado),
        consultarDistribucionCertificados(plantas, inicioActual, finActual),
        consultarDistribucionProductos(plantas, inicioActual, finActual),
        consultarDistribucionPagos(plantas, inicioActual, finActual),
        consultarAlertas(plantas, inicioActual, finActual),
        productoId ? consultarKpisProductoPeriodo(plantas, inicioActual, finActual, productoId) : Promise.resolve(null),
        productoId ? consultarKpisProductoPeriodo(plantas, inicioAnterior, finAnterior, productoId) : Promise.resolve(null),
        consultarKpisDuplicadosPeriodo(plantas, inicioActual, finActual, tipoDuplicadoAplicado),
        consultarKpisDuplicadosPeriodo(plantas, inicioAnterior, finAnterior, tipoDuplicadoAplicado),
        consultarSerieDuplicados(plantas, inicioActual, finActual, tipoDuplicadoAplicado),
        consultarDistribucionDuplicados(plantas, inicioActual, finActual, tipoDuplicadoAplicado)
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
                tooltip: 'Suma de operaciones que emitieron satisfactoriamente un comprobante: aceptado por SUNAT en producción o generado completamente por NubeFact en DEMO.'
            },
            ventaPagada: {
                actual: kpisActual.ventaPagada,
                anterior: kpisAnterior.ventaPagada,
                ...calcularVariacion(kpisActual.ventaPagada, kpisAnterior.ventaPagada),
                tooltip: 'Suma de operaciones comerciales en estado PAGADO y FACTURADO.'
            },
            ventaBruta: {
                actual: productoId && kpisProdActual ? kpisProdActual.ventaBruta : kpisActual.ventaBruta,
                anterior: productoId && kpisProdAnterior ? kpisProdAnterior.ventaBruta : kpisAnterior.ventaBruta,
                ...calcularVariacion(
                    productoId && kpisProdActual ? kpisProdActual.ventaBruta : kpisActual.ventaBruta,
                    productoId && kpisProdAnterior ? kpisProdAnterior.ventaBruta : kpisAnterior.ventaBruta
                ),
                tooltip: productoId
                    ? 'Venta bruta atribuible exclusivamente al producto seleccionado (venta operativa + descuentos proporcionales).'
                    : 'Importe final de operaciones más el monto de descuentos APLICADOS vinculados.'
            },
            ventaNeta: {
                actual: productoId && kpisProdActual ? kpisProdActual.ventaNeta : kpisActual.ventaNeta,
                anterior: productoId && kpisProdAnterior ? kpisProdAnterior.ventaNeta : kpisAnterior.ventaNeta,
                ...calcularVariacion(
                    productoId && kpisProdActual ? kpisProdActual.ventaNeta : kpisActual.ventaNeta,
                    productoId && kpisProdAnterior ? kpisProdAnterior.ventaNeta : kpisAnterior.ventaNeta
                ),
                tooltip: productoId
                    ? 'Venta neta atribuible exclusivamente al producto seleccionado (venta operativa − notas de crédito + notas de débito proporcionales).'
                    : 'Venta de operaciones menos notas de crédito aceptadas más notas de débito aceptadas.'
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
                actual: productoId && kpisProdActual ? kpisProdActual.ticketPromedio : kpisActual.ticketPromedio,
                anterior: productoId && kpisProdAnterior ? kpisProdAnterior.ticketPromedio : kpisAnterior.ticketPromedio,
                ...calcularVariacion(
                    productoId && kpisProdActual ? kpisProdActual.ticketPromedio : kpisActual.ticketPromedio,
                    productoId && kpisProdAnterior ? kpisProdAnterior.ticketPromedio : kpisAnterior.ticketPromedio
                ),
                tooltip: productoId
                    ? 'Venta operativa del producto dividida entre las operaciones que lo incluyeron.'
                    : 'Venta operativa dividida entre la cantidad de operaciones.'
            },
            ventaOperativaCertificados: {
                actual: kpisCertificadosActual.ventaOperativa,
                anterior: kpisCertificadosAnterior.ventaOperativa,
                ...calcularVariacion(kpisCertificadosActual.ventaOperativa, kpisCertificadosAnterior.ventaOperativa),
                tooltip: 'Suma exclusiva de las líneas de servicio vinculadas a certificados dentro de operaciones con comprobante emitido correctamente.'
            },
            ventaBrutaCertificados: {
                actual: kpisCertificadosActual.ventaBruta,
                anterior: kpisCertificadosAnterior.ventaBruta,
                ...calcularVariacion(kpisCertificadosActual.ventaBruta, kpisCertificadosAnterior.ventaBruta),
                tooltip: 'Venta operativa de certificados más descuentos aplicados directamente a esos certificados.'
            },
            ventaNetaCertificados: {
                actual: kpisCertificadosActual.ventaNeta,
                anterior: kpisCertificadosAnterior.ventaNeta,
                ...calcularVariacion(kpisCertificadosActual.ventaNeta, kpisCertificadosAnterior.ventaNeta),
                tooltip: 'Venta operativa de certificados menos notas de crédito más notas de débito aceptadas. En comprobantes mixtos, las notas se prorratean según el valor de las líneas de certificado.'
            },
            ticketPromedioCertificados: {
                actual: kpisCertificadosActual.ticketPromedio,
                anterior: kpisCertificadosAnterior.ticketPromedio,
                ...calcularVariacion(kpisCertificadosActual.ticketPromedio, kpisCertificadosAnterior.ticketPromedio),
                tooltip: 'Venta operativa de certificados dividida entre los certificados incluidos en comprobantes emitidos correctamente.'
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
            certificadosAnulados: {
                actual: kpisActual.certificadosAnulados,
                anterior: kpisAnterior.certificadosAnulados,
                ...calcularVariacion(kpisActual.certificadosAnulados, kpisAnterior.certificadosAnulados),
                tooltip: 'Certificados registrados en estado ANULADO durante el período.'
            },
            duplicadosEmitidos: {
                actual: kpisDuplicadosActual.duplicadosEmitidos,
                anterior: kpisDuplicadosAnterior.duplicadosEmitidos,
                ...calcularVariacion(kpisDuplicadosActual.duplicadosEmitidos, kpisDuplicadosAnterior.duplicadosEmitidos),
                tooltip: 'Duplicados en estado DISPONIBLE con comprobante operable, contados por su fecha real de disponibilidad. No incrementan los certificados originales emitidos.'
            },
            ventaDuplicados: {
                actual: kpisDuplicadosActual.venta,
                anterior: kpisDuplicadosAnterior.venta,
                ...calcularVariacion(kpisDuplicadosActual.venta, kpisDuplicadosAnterior.venta),
                tooltip: 'Importe almacenado en las operaciones comerciales de duplicado que tienen un comprobante emitido correctamente. Ya forma parte de la venta operativa global.'
            },
            totalCobradoDuplicados: {
                actual: kpisDuplicadosActual.totalCobrado,
                anterior: kpisDuplicadosAnterior.totalCobrado,
                ...calcularVariacion(kpisDuplicadosActual.totalCobrado, kpisDuplicadosAnterior.totalCobrado),
                tooltip: 'Suma de pagos CAN asociados a operaciones de duplicado. Los pagos mixtos se suman, pero no multiplican la cantidad de duplicados.'
            },
            saldoPendienteDuplicados: {
                actual: kpisDuplicadosActual.saldoPendiente,
                anterior: kpisDuplicadosAnterior.saldoPendiente,
                ...calcularVariacion(kpisDuplicadosActual.saldoPendiente, kpisDuplicadosAnterior.saldoPendiente),
                tooltip: 'Saldo almacenado en órdenes de pago no anuladas correspondientes a operaciones de duplicado.'
            },
            ticketPromedioDuplicados: {
                actual: kpisDuplicadosActual.ticketPromedio,
                anterior: kpisDuplicadosAnterior.ticketPromedio,
                ...calcularVariacion(kpisDuplicadosActual.ticketPromedio, kpisDuplicadosAnterior.ticketPromedio),
                tooltip: 'Venta de duplicados dividida entre las operaciones de duplicado incluidas en esa venta.'
            },
            productosVendidos: {
                actual: productoId && kpisProdActual ? kpisProdActual.unidadesVendidas : kpisActual.unidadesProductosVendidos,
                anterior: productoId && kpisProdAnterior ? kpisProdAnterior.unidadesVendidas : kpisAnterior.unidadesProductosVendidos,
                ...calcularVariacion(
                    productoId && kpisProdActual ? kpisProdActual.unidadesVendidas : kpisActual.unidadesProductosVendidos,
                    productoId && kpisProdAnterior ? kpisProdAnterior.unidadesVendidas : kpisAnterior.unidadesProductosVendidos
                ),
                tooltip: productoId
                    ? 'Unidades vendidas del producto seleccionado en el período.'
                    : 'Unidades vendidas de productos inventariables y chips.'
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
                tooltip: 'Facturas emitidas satisfactoriamente: aceptadas por SUNAT en producción o generadas completamente por NubeFact en DEMO.'
            },
            boletasAceptadas: {
                actual: kpisActual.boletasAceptadas,
                anterior: kpisAnterior.boletasAceptadas,
                ...calcularVariacion(kpisActual.boletasAceptadas, kpisAnterior.boletasAceptadas),
                tooltip: 'Boletas emitidas satisfactoriamente: aceptadas por SUNAT en producción o generadas completamente por NubeFact en DEMO.'
            },
            comprobantesRechazadosOError: {
                actual: kpisActual.comprobantesRechazadosOError,
                anterior: kpisAnterior.comprobantesRechazadosOError,
                ...calcularVariacion(kpisActual.comprobantesRechazadosOError, kpisAnterior.comprobantesRechazadosOError),
                tooltip: 'Comprobantes fiscales con respuesta de rechazo o error técnico.'
            }
        },
        serieDiaria,
        serieCertificados,
        serieDuplicados,
        distribucionCertificados,
        distribucionDuplicados,
        distribucionProductos,
        distribucionPagos,
        alertas: alertasInconsistencias
    };
}

/**
 * Métricas financieras atribuibles únicamente a certificados.
 *
 * La operación puede contener productos y certificados a la vez. Por eso no se
 * usa oc.importe_total: se suman las líneas de servicio que tienen
 * certificado_id. Los descuentos ya poseen certificado_id obligatorio. Las
 * notas fiscales pertenecen al comprobante completo; cuando es mixto se les
 * atribuye la misma proporción que representan las líneas de certificado.
 */
async function consultarKpisCertificadosPeriodo(plantas, inicio, fin, tipoCertificado) {
    const query = `
        WITH ops AS (
            SELECT
                oc.id,
                COALESCE(oc.importe_total, 0) AS importe_total,
                f.id AS facturacion_id
            FROM fg_operacion_comercial oc
            JOIN LATERAL (
                SELECT f.id, f.estado, f.aceptada_sunat, f.entorno_facturador,
                       f.proveedor, f.nro_comprobante, f.serie, f.numero,
                       f.enlace_pdf, f.enlace_xml
                FROM fg_facturacion f
                WHERE f.operacion_id = oc.id
                  AND ${SQL_COMPROBANTE_EMITIDO_EXITOSAMENTE}
                ORDER BY CASE WHEN f.estado = 'ACEPTADO' THEN 0 ELSE 1 END, f.id DESC
                LIMIT 1
            ) f ON TRUE
            WHERE oc.planta_key = ANY($1::varchar[])
              AND oc.fecha_creacion >= $2::timestamptz
              AND oc.fecha_creacion < $3::timestamptz
        ),
        lineas_certificado AS (
            SELECT
                od.operacion_id,
                ops.facturacion_id,
                ops.importe_total AS importe_operacion,
                COALESCE(SUM(od.importe_total), 0) AS venta_operativa,
                COUNT(DISTINCT od.certificado_id) AS cantidad_certificados
            FROM fg_operacion_detalle od
            JOIN ops ON ops.id = od.operacion_id
            JOIN fg_certificado c ON c.id = od.certificado_id
            WHERE od.tipo_item = 'SERVICIO'
              AND ($4::varchar IS NULL OR ${sqlCategoriaCertificado('c')} = $4::varchar)
            GROUP BY od.operacion_id, ops.facturacion_id, ops.importe_total
        ),
        totales AS (
            SELECT
                COALESCE(SUM(venta_operativa), 0) AS venta_operativa,
                COALESCE(SUM(cantidad_certificados), 0) AS cantidad_certificados
            FROM lineas_certificado
        ),
        certificados_incluidos AS (
            SELECT DISTINCT od.certificado_id
            FROM fg_operacion_detalle od
            JOIN lineas_certificado lc ON lc.operacion_id = od.operacion_id
            JOIN fg_certificado c ON c.id = od.certificado_id
            WHERE od.tipo_item = 'SERVICIO'
              AND ($4::varchar IS NULL OR ${sqlCategoriaCertificado('c')} = $4::varchar)
        ),
        descuentos AS (
            SELECT COALESCE(SUM(dc.importe_descuento), 0) AS total_descuentos
            FROM fg_descuentocomprobante dc
            WHERE dc.estado = 'APLICADO'
              AND dc.certificado_id IN (SELECT certificado_id FROM certificados_incluidos)
        ),
        notas_credito AS (
            SELECT COALESCE(SUM(
                nc.importe_total * CASE
                    WHEN lc.importe_operacion > 0 THEN lc.venta_operativa / lc.importe_operacion
                    ELSE 0
                END
            ), 0) AS total_nc
            FROM lineas_certificado lc
            JOIN fg_credito nc ON nc.facturacion_id = lc.facturacion_id
            WHERE nc.estado = 'ACEPTADO'
        ),
        notas_debito AS (
            SELECT COALESCE(SUM(
                nd.importe_total * CASE
                    WHEN lc.importe_operacion > 0 THEN lc.venta_operativa / lc.importe_operacion
                    ELSE 0
                END
            ), 0) AS total_nd
            FROM lineas_certificado lc
            JOIN fg_debito nd ON nd.facturacion_id = lc.facturacion_id
            WHERE nd.estado = 'ACEPTADO'
        )
        SELECT
            t.venta_operativa,
            t.cantidad_certificados,
            d.total_descuentos,
            nc.total_nc,
            nd.total_nd
        FROM totales t
        CROSS JOIN descuentos d
        CROSS JOIN notas_credito nc
        CROSS JOIN notas_debito nd
    `;

    const result = await db.query(query, [plantas, inicio, fin, tipoCertificado || null]);
    const row = result.rows[0] || {};
    const ventaOperativa = Number(row.venta_operativa || 0);
    const descuentos = Number(row.total_descuentos || 0);
    const notasCredito = Number(row.total_nc || 0);
    const notasDebito = Number(row.total_nd || 0);
    const cantidadCertificados = Number(row.cantidad_certificados || 0);

    return {
        ventaOperativa: Number(ventaOperativa.toFixed(2)),
        ventaBruta: Number((ventaOperativa + descuentos).toFixed(2)),
        ventaNeta: Number((ventaOperativa - notasCredito + notasDebito).toFixed(2)),
        ticketPromedio: cantidadCertificados > 0
            ? Number((ventaOperativa / cantidadCertificados).toFixed(2))
            : 0
    };
}

/**
 * Métricas financieras atribuibles únicamente a un producto facturación específico.
 *
 * Para operaciones mixtas (que contienen certificados u otros productos), se calcula
 * la venta de la línea del producto sin duplicar el total de la operación comercial.
 * Los descuentos y notas fiscales asociados a la facturación de la operación se prorratean
 * según la proporción que representa el producto dentro del importe de la operación.
 */
async function consultarKpisProductoPeriodo(plantas, inicio, fin, productoId) {
    if (!productoId) {
        return {
            ventaOperativa: 0,
            ventaBruta: 0,
            ventaNeta: 0,
            unidadesVendidas: 0,
            ticketPromedio: 0
        };
    }

    const query = `
        WITH ops AS (
            SELECT
                oc.id,
                COALESCE(oc.importe_total, 0) AS importe_total,
                f.id AS facturacion_id
            FROM fg_operacion_comercial oc
            JOIN LATERAL (
                SELECT f.id, f.estado, f.aceptada_sunat, f.entorno_facturador,
                       f.proveedor, f.nro_comprobante, f.serie, f.numero,
                       f.enlace_pdf, f.enlace_xml
                FROM fg_facturacion f
                WHERE f.operacion_id = oc.id
                  AND ${SQL_COMPROBANTE_EMITIDO_EXITOSAMENTE}
                ORDER BY CASE WHEN f.estado = 'ACEPTADO' THEN 0 ELSE 1 END, f.id DESC
                LIMIT 1
            ) f ON TRUE
            WHERE oc.planta_key = ANY($1::varchar[])
              AND oc.fecha_creacion >= $2::timestamptz
              AND oc.fecha_creacion < $3::timestamptz
        ),
        lineas_producto AS (
            SELECT
                od.operacion_id,
                ops.facturacion_id,
                ops.importe_total AS importe_operacion,
                COALESCE(SUM(od.importe_total), 0) AS venta_operativa,
                COALESCE(SUM(od.cantidad), 0) AS unidades_vendidas
            FROM fg_operacion_detalle od
            JOIN ops ON ops.id = od.operacion_id
            WHERE od.tipo_item = 'PRODUCTO'
              AND od.producto_facturacion_id = $4::bigint
            GROUP BY od.operacion_id, ops.facturacion_id, ops.importe_total
        ),
        totales AS (
            SELECT
                COALESCE(SUM(venta_operativa), 0) AS venta_operativa,
                COALESCE(SUM(unidades_vendidas), 0) AS unidades_vendidas,
                COUNT(DISTINCT operacion_id) AS cantidad_operaciones
            FROM lineas_producto
        ),
        descuentos AS (
            SELECT COALESCE(SUM(
                dc.importe_descuento * CASE
                    WHEN lp.importe_operacion > 0 THEN lp.venta_operativa / lp.importe_operacion
                    ELSE 0
                END
            ), 0) AS total_descuentos
            FROM lineas_producto lp
            JOIN fg_descuentocomprobante dc ON dc.facturacion_id = lp.facturacion_id
            WHERE dc.estado = 'APLICADO'
        ),
        notas_credito AS (
            SELECT COALESCE(SUM(
                nc.importe_total * CASE
                    WHEN lp.importe_operacion > 0 THEN lp.venta_operativa / lp.importe_operacion
                    ELSE 0
                END
            ), 0) AS total_nc
            FROM lineas_producto lp
            JOIN fg_credito nc ON nc.facturacion_id = lp.facturacion_id
            WHERE nc.estado = 'ACEPTADO'
        ),
        notas_debito AS (
            SELECT COALESCE(SUM(
                nd.importe_total * CASE
                    WHEN lp.importe_operacion > 0 THEN lp.venta_operativa / lp.importe_operacion
                    ELSE 0
                END
            ), 0) AS total_nd
            FROM lineas_producto lp
            JOIN fg_debito nd ON nd.facturacion_id = lp.facturacion_id
            WHERE nd.estado = 'ACEPTADO'
        )
        SELECT
            t.venta_operativa,
            t.unidades_vendidas,
            t.cantidad_operaciones,
            d.total_descuentos,
            nc.total_nc,
            nd.total_nd
        FROM totales t
        CROSS JOIN descuentos d
        CROSS JOIN notas_credito nc
        CROSS JOIN notas_debito nd
    `;

    const result = await db.query(query, [plantas, inicio, fin, productoId]);
    const row = result.rows[0] || {};
    const ventaOperativa = Number(row.venta_operativa || 0);
    const descuentos = Number(row.total_descuentos || 0);
    const notasCredito = Number(row.total_nc || 0);
    const notasDebito = Number(row.total_nd || 0);
    const unidadesVendidas = Number(row.unidades_vendidas || 0);
    const cantidadOperaciones = Number(row.cantidad_operaciones || 0);

    return {
        ventaOperativa: Number(ventaOperativa.toFixed(2)),
        ventaBruta: Number((ventaOperativa + descuentos).toFixed(2)),
        ventaNeta: Number((ventaOperativa - notasCredito + notasDebito).toFixed(2)),
        unidadesVendidas,
        ticketPromedio: cantidadOperaciones > 0
            ? Number((ventaOperativa / cantidadOperaciones).toFixed(2))
            : 0
    };
}

/**
 * Desglose financiero de duplicados. Cada agregado conserva la misma fecha de
 * negocio que su KPI global: operación para venta, pago para cobrado y orden
 * para saldo. La cantidad emitida usa fecha_disponible, que es la emisión real
 * del duplicado.
 */
async function consultarKpisDuplicadosPeriodo(plantas, inicio, fin, tipoDuplicado) {
    const query = `
        WITH duplicados_base AS (
            SELECT d.id, d.operacion_id, d.estado, d.fecha_disponible
            FROM fg_certificado_duplicado d
            WHERE d.planta_key = ANY($1::varchar[])
              AND ($4::varchar IS NULL OR ${sqlCategoriaDuplicado('d')} = $4::varchar)
        ),
        emitidos AS (
            SELECT COUNT(db.id) AS cantidad
            FROM duplicados_base db
            JOIN fg_facturacion f ON f.operacion_id = db.operacion_id
            WHERE db.estado = 'DISPONIBLE'
              AND ${SQL_COMPROBANTE_EMITIDO_EXITOSAMENTE}
              AND db.fecha_disponible >= $2::timestamptz
              AND db.fecha_disponible < $3::timestamptz
        ),
        ventas AS (
            SELECT COALESCE(SUM(oc.importe_total), 0) AS total,
                   COUNT(db.id) AS cantidad
            FROM duplicados_base db
            JOIN fg_operacion_comercial oc ON oc.id = db.operacion_id
            JOIN fg_facturacion f ON f.operacion_id = oc.id
            WHERE db.estado = 'DISPONIBLE'
              AND ${SQL_COMPROBANTE_EMITIDO_EXITOSAMENTE}
              AND oc.fecha_creacion >= $2::timestamptz
              AND oc.fecha_creacion < $3::timestamptz
        ),
        cobros AS (
            SELECT COALESCE(SUM(p.importe), 0) AS total
            FROM duplicados_base db
            JOIN fg_orden_pago op ON op.operacion_id = db.operacion_id
            JOIN fg_pago p ON p.orden_pago_id = op.id
            WHERE p.estado = 'CAN'
              AND p.fechacreacion >= $2::timestamptz
              AND p.fechacreacion < $3::timestamptz
        ),
        saldos AS (
            SELECT COALESCE(SUM(op.saldo_pendiente), 0) AS total
            FROM duplicados_base db
            JOIN fg_orden_pago op ON op.operacion_id = db.operacion_id
            WHERE op.estado <> 'ANULADO'
              AND op.saldo_pendiente > 0
              AND op.fechacreacion >= $2::timestamptz
              AND op.fechacreacion < $3::timestamptz
        )
        SELECT e.cantidad AS duplicados_emitidos,
               v.total AS venta,
               v.cantidad AS cantidad_venta,
               c.total AS total_cobrado,
               s.total AS saldo_pendiente
        FROM emitidos e
        CROSS JOIN ventas v
        CROSS JOIN cobros c
        CROSS JOIN saldos s
    `;
    const result = await db.query(query, [plantas, inicio, fin, tipoDuplicado || null]);
    const row = result.rows[0] || {};
    const venta = Number(row.venta || 0);
    const cantidadVenta = Number(row.cantidad_venta || 0);
    return {
        duplicadosEmitidos: Number(row.duplicados_emitidos || 0),
        venta: Number(venta.toFixed(2)),
        totalCobrado: Number(Number(row.total_cobrado || 0).toFixed(2)),
        saldoPendiente: Number(Number(row.saldo_pendiente || 0).toFixed(2)),
        ticketPromedio: cantidadVenta > 0 ? Number((venta / cantidadVenta).toFixed(2)) : 0
    };
}

async function consultarSerieDuplicados(plantas, inicio, fin, tipoDuplicado) {
    const query = `
        SELECT TO_CHAR(d.fecha_disponible AT TIME ZONE 'America/Lima', 'YYYY-MM-DD') AS fecha,
               COUNT(d.id) AS emitidos
        FROM fg_certificado_duplicado d
        JOIN fg_facturacion f ON f.operacion_id = d.operacion_id
        WHERE d.planta_key = ANY($1::varchar[])
          AND d.estado = 'DISPONIBLE'
          AND ${SQL_COMPROBANTE_EMITIDO_EXITOSAMENTE}
          AND d.fecha_disponible >= $2::timestamptz
          AND d.fecha_disponible < $3::timestamptz
          AND ($4::varchar IS NULL OR ${sqlCategoriaDuplicado('d')} = $4::varchar)
        GROUP BY TO_CHAR(d.fecha_disponible AT TIME ZONE 'America/Lima', 'YYYY-MM-DD')
        ORDER BY fecha ASC
    `;
    const result = await db.query(query, [plantas, inicio, fin, tipoDuplicado || null]);
    return result.rows.map((row) => ({
        fecha: row.fecha,
        emitidos: Number(row.emitidos || 0)
    }));
}

async function consultarDistribucionDuplicados(plantas, inicio, fin, tipoDuplicado) {
    const query = `
        WITH categorias(tipo, orden) AS (
            VALUES ('GLP'::varchar, 1), ('GNV'::varchar, 2),
                   ('CONFORMIDAD'::varchar, 3), ('COMPLEMENTARIOS'::varchar, 4)
        ),
        emitidos AS (
            SELECT ${sqlCategoriaDuplicado('d')} AS tipo,
                   COUNT(d.id) AS cantidad
            FROM fg_certificado_duplicado d
            JOIN fg_facturacion f ON f.operacion_id = d.operacion_id
            WHERE d.planta_key = ANY($1::varchar[])
              AND d.estado = 'DISPONIBLE'
              AND ${SQL_COMPROBANTE_EMITIDO_EXITOSAMENTE}
              AND d.fecha_disponible >= $2::timestamptz
              AND d.fecha_disponible < $3::timestamptz
              AND ($4::varchar IS NULL OR ${sqlCategoriaDuplicado('d')} = $4::varchar)
            GROUP BY ${sqlCategoriaDuplicado('d')}
        )
        SELECT c.tipo, COALESCE(e.cantidad, 0) AS cantidad
        FROM categorias c
        LEFT JOIN emitidos e ON e.tipo = c.tipo
        WHERE $4::varchar IS NULL OR c.tipo = $4::varchar
        ORDER BY c.orden
    `;
    const result = await db.query(query, [plantas, inicio, fin, tipoDuplicado || null]);
    const total = result.rows.reduce((sum, row) => sum + Number(row.cantidad || 0), 0);
    return result.rows.map((row) => {
        const cantidad = Number(row.cantidad || 0);
        return {
            tipo: row.tipo,
            cantidad,
            porcentaje: total > 0 ? Number(((cantidad / total) * 100).toFixed(1)) : 0
        };
    });
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
            JOIN LATERAL (
                SELECT f.id, f.estado, f.tipo_comprobante
                FROM fg_facturacion f
                WHERE f.operacion_id = oc.id
                  AND ${SQL_COMPROBANTE_EMITIDO_EXITOSAMENTE}
                ORDER BY CASE WHEN f.estado = 'ACEPTADO' THEN 0 ELSE 1 END, f.id DESC
                LIMIT 1
            ) f ON TRUE
            WHERE oc.planta_key = ANY($1::varchar[])
              AND oc.fecha_creacion >= $2::timestamptz AND oc.fecha_creacion < $3::timestamptz
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
              AND ($4::varchar IS NULL OR ${sqlCategoriaCertificado('c')} = $4::varchar)
        ),
        productos AS (
            SELECT 
                COALESCE(SUM(od.cantidad), 0) AS unidades_vendidas
            FROM fg_operacion_detalle od
            JOIN fg_operacion_comercial oc ON oc.id = od.operacion_id
            WHERE oc.planta_key = ANY($1::varchar[])
              AND oc.fecha_creacion >= $2::timestamptz AND oc.fecha_creacion < $3::timestamptz
              AND EXISTS (
                  SELECT 1
                  FROM fg_facturacion f
                  WHERE f.operacion_id = oc.id
                    AND ${SQL_COMPROBANTE_EMITIDO_EXITOSAMENTE}
              )
              AND od.tipo_item = 'PRODUCTO'
              AND od.producto_facturacion_id IS NOT NULL
        ),
        facturacion_totales AS (
            SELECT 
                COUNT(CASE WHEN f.tipo_comprobante = 'FACTURA' AND ${SQL_COMPROBANTE_EMITIDO_EXITOSAMENTE} THEN 1 END) AS facturas_aceptadas,
                COUNT(CASE WHEN f.tipo_comprobante = 'BOLETA' AND ${SQL_COMPROBANTE_EMITIDO_EXITOSAMENTE} THEN 1 END) AS boletas_aceptadas,
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

async function consultarSerieDiaria(plantas, inicio, fin, productoId) {
    if (productoId) {
        const query = `
            SELECT 
                TO_CHAR(oc.fecha_creacion AT TIME ZONE 'America/Lima', 'YYYY-MM-DD') AS fecha,
                COALESCE(SUM(od.importe_total), 0) AS venta,
                COUNT(DISTINCT oc.id) AS operaciones
            FROM fg_operacion_comercial oc
            JOIN fg_operacion_detalle od ON od.operacion_id = oc.id AND od.tipo_item = 'PRODUCTO' AND od.producto_facturacion_id = $4::bigint
            WHERE oc.planta_key = ANY($1::varchar[])
              AND oc.fecha_creacion >= $2::timestamptz AND oc.fecha_creacion < $3::timestamptz
              AND EXISTS (
                  SELECT 1
                  FROM fg_facturacion f
                  WHERE f.operacion_id = oc.id
                    AND ${SQL_COMPROBANTE_EMITIDO_EXITOSAMENTE}
              )
            GROUP BY TO_CHAR(oc.fecha_creacion AT TIME ZONE 'America/Lima', 'YYYY-MM-DD')
            ORDER BY fecha ASC
        `;
        const res = await db.query(query, [plantas, inicio, fin, productoId]);
        return res.rows.map(r => ({
            fecha: r.fecha,
            venta: Number(r.venta),
            operaciones: Number(r.operaciones)
        }));
    }

    const query = `
        SELECT 
            TO_CHAR(oc.fecha_creacion AT TIME ZONE 'America/Lima', 'YYYY-MM-DD') AS fecha,
            COALESCE(SUM(oc.importe_total), 0) AS venta,
            COUNT(oc.id) AS operaciones
        FROM fg_operacion_comercial oc
        WHERE oc.planta_key = ANY($1::varchar[])
          AND oc.fecha_creacion >= $2::timestamptz AND oc.fecha_creacion < $3::timestamptz
          AND EXISTS (
              SELECT 1
              FROM fg_facturacion f
              WHERE f.operacion_id = oc.id
                AND ${SQL_COMPROBANTE_EMITIDO_EXITOSAMENTE}
          )
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

async function consultarSerieCertificados(plantas, inicio, fin, tipoCertificado) {
    const query = `
        SELECT
            TO_CHAR(c.fecha_creacion AT TIME ZONE 'America/Lima', 'YYYY-MM-DD') AS fecha,
            COUNT(c.id) AS total,
            COUNT(CASE WHEN c.estado = 'EMITIDO' THEN 1 END) AS emitidos,
            COUNT(CASE WHEN c.estado = 'BORRADOR' THEN 1 END) AS borradores,
            COUNT(CASE WHEN c.estado = 'ANULADO' THEN 1 END) AS anulados
        FROM fg_certificado c
        WHERE c.planta_key = ANY($1::varchar[])
          AND c.fecha_creacion >= $2::timestamptz AND c.fecha_creacion < $3::timestamptz
          AND ($4::varchar IS NULL OR ${sqlCategoriaCertificado('c')} = $4::varchar)
        GROUP BY TO_CHAR(c.fecha_creacion AT TIME ZONE 'America/Lima', 'YYYY-MM-DD')
        ORDER BY fecha ASC
    `;
    const res = await db.query(query, [plantas, inicio, fin, tipoCertificado || null]);
    return res.rows.map((r) => ({
        fecha: r.fecha,
        total: Number(r.total || 0),
        emitidos: Number(r.emitidos || 0),
        borradores: Number(r.borradores || 0),
        anulados: Number(r.anulados || 0)
    }));
}

async function consultarDistribucionCertificados(plantas, inicio, fin) {
    const query = `
        WITH certificados_clasificados AS (
            SELECT
                c.id,
                c.estado,
                c.importe_total,
                ${sqlCategoriaCertificado('c')} AS categoria
            FROM fg_certificado c
            WHERE c.planta_key = ANY($1::varchar[])
              AND c.fecha_creacion >= $2::timestamptz AND c.fecha_creacion < $3::timestamptz
        )
        SELECT
            categoria.codigo AS tipo,
            COUNT(c.id) AS cantidad,
            COUNT(CASE WHEN c.estado = 'EMITIDO' THEN 1 END) AS emitidos,
            COUNT(CASE WHEN c.estado = 'BORRADOR' THEN 1 END) AS pendientes,
            COUNT(CASE WHEN c.estado = 'ANULADO' THEN 1 END) AS anulados,
            COALESCE(SUM(c.importe_total), 0) AS total_soles
        FROM fg_categoria_servicio categoria
        LEFT JOIN certificados_clasificados c ON c.categoria = categoria.codigo
        WHERE categoria.activo IS TRUE
        GROUP BY categoria.codigo, categoria.orden
        ORDER BY categoria.orden, categoria.codigo
    `;
    const res = await db.query(query, [plantas, inicio, fin]);
    const totalCertificados = res.rows.reduce((total, row) => total + Number(row.cantidad || 0), 0);
    return res.rows.map(r => {
        const cantidad = Number(r.cantidad || 0);
        return {
            tipo: r.tipo || 'OTROS',
            cantidad,
            emitidos: Number(r.emitidos),
            pendientes: Number(r.pendientes),
            anulados: Number(r.anulados),
            porcentaje: totalCertificados > 0
                ? Number(((cantidad / totalCertificados) * 100).toFixed(1))
                : 0,
            totalSoles: Number(r.total_soles)
        };
    });
}

async function consultarDistribucionProductos(plantas, inicio, fin) {
    const query = `
        SELECT 
            od.producto_facturacion_id AS id,
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
          AND EXISTS (
              SELECT 1
              FROM fg_facturacion f
              WHERE f.operacion_id = oc.id
                AND ${SQL_COMPROBANTE_EMITIDO_EXITOSAMENTE}
          )
          AND od.tipo_item = 'PRODUCTO'
          AND od.producto_facturacion_id IS NOT NULL
        GROUP BY od.producto_facturacion_id, od.codigo_sku_snapshot, od.descripcion_snapshot, od.unidad_snapshot
        ORDER BY total_soles DESC, total_unidades DESC
    `;
    const res = await db.query(query, [plantas, inicio, fin]);
    return res.rows.map(r => ({
        id: Number(r.id),
        sku: r.sku,
        descripcion: r.descripcion,
        unidad: r.unidad,
        unidadesVendidas: Number(r.total_unidades || 0),
        totalSoles: Number(r.total_soles || 0),
        operaciones: Number(r.total_operaciones || 0),
        precioPromedio: Number(r.precio_promedio || 0)
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
async function obtenerDetalleSedes({ plantasAutorizadas, desde, hasta, tipoCertificado, tipoDuplicado, productoId }) {
    if (!plantasAutorizadas || plantasAutorizadas.length === 0) return [];
    
    const { inicioActual, finActual } = calcularIntervaloFechas(desde, hasta);
    const tipoDuplicadoAplicado = resolverTipoDuplicado(tipoCertificado, tipoDuplicado);

    const query = `
        SELECT 
            p.key AS planta_key,
            p.nombre AS planta_nombre,
            COALESCE(ops.cantidad_operaciones, 0) AS cantidad_operaciones,
            COALESCE(ops.venta_operativa, 0) AS venta_operativa,
            COALESCE(certs.emitidos, 0) AS certificados_emitidos,
            COALESCE(certs.pendientes, 0) AS certificados_pendientes,
            COALESCE(cobrado.total_cobrado, 0) AS total_cobrado,
            COALESCE(saldos.saldo_pendiente, 0) AS saldo_pendiente,
            COALESCE(duplicados_emitidos.cantidad, 0) AS duplicados_emitidos,
            COALESCE(ventas_duplicados.cantidad, 0) AS cantidad_venta_duplicados,
            COALESCE(ventas_duplicados.total, 0) AS venta_duplicados,
            COALESCE(cobros_duplicados.total, 0) AS cobrado_duplicados,
            COALESCE(saldos_duplicados.total, 0) AS saldo_duplicados
        FROM fg_planta p
        LEFT JOIN (
            SELECT 
                oc.planta_key,
                COUNT(oc.id) AS cantidad_operaciones,
                SUM(CASE
                    WHEN $5::bigint IS NOT NULL THEN COALESCE((
                        SELECT SUM(od.importe_total)
                        FROM fg_operacion_detalle od
                        WHERE od.operacion_id = oc.id
                          AND od.tipo_item = 'PRODUCTO'
                          AND od.producto_facturacion_id = $5::bigint
                    ), 0)
                    WHEN $4::varchar IS NOT NULL THEN COALESCE((
                        SELECT SUM(od.importe_total)
                        FROM fg_operacion_detalle od
                        JOIN fg_certificado certificado_linea ON certificado_linea.id = od.certificado_id
                        WHERE od.operacion_id = oc.id
                          AND od.tipo_item = 'SERVICIO'
                          AND ${sqlCategoriaCertificado('certificado_linea')} = $4::varchar
                    ), 0)
                    ELSE oc.importe_total
                END) AS venta_operativa
            FROM fg_operacion_comercial oc
            WHERE oc.fecha_creacion >= $2::timestamptz AND oc.fecha_creacion < $3::timestamptz
              AND EXISTS (
                  SELECT 1
                  FROM fg_facturacion f
                  WHERE f.operacion_id = oc.id
                    AND ${SQL_COMPROBANTE_EMITIDO_EXITOSAMENTE}
              )
              AND (
                  ($5::bigint IS NULL AND $4::varchar IS NULL)
                  OR ($5::bigint IS NOT NULL AND EXISTS (
                      SELECT 1
                      FROM fg_operacion_detalle od
                      WHERE od.operacion_id = oc.id
                        AND od.tipo_item = 'PRODUCTO'
                        AND od.producto_facturacion_id = $5::bigint
                  ))
                  OR ($4::varchar IS NOT NULL AND EXISTS (
                      SELECT 1
                      FROM fg_operacion_detalle od
                      JOIN fg_certificado certificado_operacion ON certificado_operacion.id = od.certificado_id
                      WHERE od.operacion_id = oc.id
                        AND ${sqlCategoriaCertificado('certificado_operacion')} = $4::varchar
                  ))
              )
            GROUP BY oc.planta_key
        ) ops ON ops.planta_key = p.key
        LEFT JOIN (
            SELECT 
                c.planta_key,
                COUNT(CASE WHEN c.estado = 'EMITIDO' THEN 1 END) AS emitidos,
                COUNT(CASE WHEN c.estado = 'BORRADOR' THEN 1 END) AS pendientes
            FROM fg_certificado c
            WHERE c.fecha_creacion >= $2::timestamptz AND c.fecha_creacion < $3::timestamptz
              AND $5::bigint IS NULL
              AND ($4::varchar IS NULL OR ${sqlCategoriaCertificado('c')} = $4::varchar)
            GROUP BY c.planta_key
        ) certs ON certs.planta_key = p.key
        LEFT JOIN (
            SELECT 
                COALESCE(c.planta_key, oc.planta_key) AS planta_key,
                SUM(pg.importe * CASE
                    WHEN $5::bigint IS NOT NULL AND COALESCE(oc.importe_total, 0) > 0 THEN
                        COALESCE((
                            SELECT SUM(od.importe_total)
                            FROM fg_operacion_detalle od
                            WHERE od.operacion_id = oc.id
                              AND od.tipo_item = 'PRODUCTO'
                              AND od.producto_facturacion_id = $5::bigint
                        ), 0) / oc.importe_total
                    ELSE 1
                END) AS total_cobrado
            FROM fg_pago pg
            JOIN fg_orden_pago op ON op.id = pg.orden_pago_id
            LEFT JOIN fg_certificado c ON c.id = op.certificado_id
            LEFT JOIN fg_operacion_comercial oc ON oc.id = op.operacion_id
            WHERE pg.estado = 'CAN'
              AND pg.fechacreacion >= $2::timestamptz AND pg.fechacreacion < $3::timestamptz
              AND (
                  ($5::bigint IS NULL AND $4::varchar IS NULL)
                  OR ($5::bigint IS NOT NULL AND EXISTS (
                      SELECT 1
                      FROM fg_operacion_detalle od_pago
                      WHERE od_pago.operacion_id = oc.id
                        AND od_pago.tipo_item = 'PRODUCTO'
                        AND od_pago.producto_facturacion_id = $5::bigint
                  ))
                  OR ($4::varchar IS NOT NULL AND (
                      ${sqlCategoriaCertificado('c')} = $4::varchar
                      OR EXISTS (
                          SELECT 1
                          FROM fg_operacion_detalle od_pago
                          JOIN fg_certificado certificado_pago ON certificado_pago.id = od_pago.certificado_id
                          WHERE od_pago.operacion_id = oc.id
                            AND ${sqlCategoriaCertificado('certificado_pago')} = $4::varchar
                      )
                  ))
              )
            GROUP BY COALESCE(c.planta_key, oc.planta_key)
        ) cobrado ON cobrado.planta_key = p.key
        LEFT JOIN (
            SELECT 
                COALESCE(c.planta_key, oc.planta_key) AS planta_key,
                SUM(op.saldo_pendiente * CASE
                    WHEN $5::bigint IS NOT NULL AND COALESCE(oc.importe_total, 0) > 0 THEN
                        COALESCE((
                            SELECT SUM(od.importe_total)
                            FROM fg_operacion_detalle od
                            WHERE od.operacion_id = oc.id
                              AND od.tipo_item = 'PRODUCTO'
                              AND od.producto_facturacion_id = $5::bigint
                        ), 0) / oc.importe_total
                    ELSE 1
                END) AS saldo_pendiente
            FROM fg_orden_pago op
            LEFT JOIN fg_certificado c ON c.id = op.certificado_id
            LEFT JOIN fg_operacion_comercial oc ON oc.id = op.operacion_id
            WHERE op.estado <> 'ANULADO' AND op.saldo_pendiente > 0
              AND op.fechacreacion >= $2::timestamptz AND op.fechacreacion < $3::timestamptz
              AND (
                  ($5::bigint IS NULL AND $4::varchar IS NULL)
                  OR ($5::bigint IS NOT NULL AND EXISTS (
                      SELECT 1
                      FROM fg_operacion_detalle od_saldo
                      WHERE od_saldo.operacion_id = oc.id
                        AND od_saldo.tipo_item = 'PRODUCTO'
                        AND od_saldo.producto_facturacion_id = $5::bigint
                  ))
                  OR ($4::varchar IS NOT NULL AND (
                      ${sqlCategoriaCertificado('c')} = $4::varchar
                      OR EXISTS (
                          SELECT 1
                          FROM fg_operacion_detalle od_saldo
                          JOIN fg_certificado certificado_saldo ON certificado_saldo.id = od_saldo.certificado_id
                          WHERE od_saldo.operacion_id = oc.id
                            AND ${sqlCategoriaCertificado('certificado_saldo')} = $4::varchar
                      )
                  ))
              )
            GROUP BY COALESCE(c.planta_key, oc.planta_key)
        ) saldos ON saldos.planta_key = p.key
        LEFT JOIN (
            SELECT d.planta_key, COUNT(d.id) AS cantidad
            FROM fg_certificado_duplicado d
            JOIN fg_facturacion f ON f.operacion_id = d.operacion_id
            WHERE d.estado = 'DISPONIBLE'
              AND ${SQL_COMPROBANTE_EMITIDO_EXITOSAMENTE}
              AND d.fecha_disponible >= $2::timestamptz
              AND d.fecha_disponible < $3::timestamptz
              AND ($6::varchar IS NULL OR ${sqlCategoriaDuplicado('d')} = $6::varchar)
            GROUP BY d.planta_key
        ) duplicados_emitidos ON duplicados_emitidos.planta_key = p.key
        LEFT JOIN (
            SELECT d.planta_key,
                   COUNT(d.id) AS cantidad,
                   COALESCE(SUM(oc.importe_total), 0) AS total
            FROM fg_certificado_duplicado d
            JOIN fg_operacion_comercial oc ON oc.id = d.operacion_id
            JOIN fg_facturacion f ON f.operacion_id = d.operacion_id
            WHERE d.estado = 'DISPONIBLE'
              AND ${SQL_COMPROBANTE_EMITIDO_EXITOSAMENTE}
              AND oc.fecha_creacion >= $2::timestamptz
              AND oc.fecha_creacion < $3::timestamptz
              AND ($6::varchar IS NULL OR ${sqlCategoriaDuplicado('d')} = $6::varchar)
            GROUP BY d.planta_key
        ) ventas_duplicados ON ventas_duplicados.planta_key = p.key
        LEFT JOIN (
            SELECT d.planta_key, COALESCE(SUM(pg.importe), 0) AS total
            FROM fg_certificado_duplicado d
            JOIN fg_orden_pago op ON op.operacion_id = d.operacion_id
            JOIN fg_pago pg ON pg.orden_pago_id = op.id
            WHERE pg.estado = 'CAN'
              AND pg.fechacreacion >= $2::timestamptz
              AND pg.fechacreacion < $3::timestamptz
              AND ($6::varchar IS NULL OR ${sqlCategoriaDuplicado('d')} = $6::varchar)
            GROUP BY d.planta_key
        ) cobros_duplicados ON cobros_duplicados.planta_key = p.key
        LEFT JOIN (
            SELECT d.planta_key, COALESCE(SUM(op.saldo_pendiente), 0) AS total
            FROM fg_certificado_duplicado d
            JOIN fg_orden_pago op ON op.operacion_id = d.operacion_id
            WHERE op.estado <> 'ANULADO'
              AND op.saldo_pendiente > 0
              AND op.fechacreacion >= $2::timestamptz
              AND op.fechacreacion < $3::timestamptz
              AND ($6::varchar IS NULL OR ${sqlCategoriaDuplicado('d')} = $6::varchar)
            GROUP BY d.planta_key
        ) saldos_duplicados ON saldos_duplicados.planta_key = p.key
        WHERE p.key = ANY($1::varchar[])
        ORDER BY venta_operativa DESC, cantidad_operaciones DESC
    `;

    const res = await db.query(query, [
        plantasAutorizadas,
        inicioActual,
        finActual,
        tipoCertificado || null,
        productoId || null,
        tipoDuplicadoAplicado
    ]);
    return res.rows.map(r => {
        const ops = Number(r.cantidad_operaciones);
        const venta = Number(r.venta_operativa);
        const cantidadVentaDuplicados = Number(r.cantidad_venta_duplicados);
        const ventaDuplicados = Number(r.venta_duplicados);
        return {
            plantaKey: r.planta_key,
            plantaNombre: r.planta_nombre,
            cantidadOperaciones: ops,
            ventaOperativa: venta,
            certificadosEmitidos: Number(r.certificados_emitidos),
            certificadosPendientes: Number(r.certificados_pendientes),
            totalCobrado: Number(r.total_cobrado),
            saldoPendiente: Number(r.saldo_pendiente),
            ticketPromedio: ops > 0 ? Number((venta / ops).toFixed(2)) : 0,
            duplicadosEmitidos: Number(r.duplicados_emitidos),
            ventaDuplicados,
            totalCobradoDuplicados: Number(r.cobrado_duplicados),
            saldoPendienteDuplicados: Number(r.saldo_duplicados),
            ticketPromedioDuplicados: cantidadVentaDuplicados > 0
                ? Number((ventaDuplicados / cantidadVentaDuplicados).toFixed(2))
                : 0
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
        whereExtra += ` AND ${sqlCategoriaCertificado('c')} = $${params.length}`;
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
 * Detalle paginado de duplicados emitidos. El ordinal se calcula por
 * certificado original sin alterar su número, fecha ni contenido técnico.
 */
async function obtenerDetalleDuplicados({
    plantasAutorizadas,
    plantasFiltro,
    desde,
    hasta,
    pagina = 1,
    limite = 20,
    tipoCertificado,
    tipoDuplicado
}) {
    const plantas = (plantasFiltro && plantasFiltro.length > 0)
        ? plantasFiltro.filter(p => plantasAutorizadas.includes(p))
        : plantasAutorizadas;
    const paginaAplicada = Math.max(Number.parseInt(pagina, 10) || 1, 1);
    const limiteAplicado = Math.min(Math.max(Number.parseInt(limite, 10) || 20, 1), 100);
    if (!plantas || plantas.length === 0) {
        return { items: [], total: 0, pagina: paginaAplicada, limite: limiteAplicado };
    }

    const { inicioActual, finActual } = calcularIntervaloFechas(desde, hasta);
    const tipoDuplicadoAplicado = resolverTipoDuplicado(tipoCertificado, tipoDuplicado);
    const offset = (paginaAplicada - 1) * limiteAplicado;

    const query = `
        WITH duplicados_con_ordinal AS (
            SELECT d.*,
                   ROW_NUMBER() OVER (
                       PARTITION BY d.certificado_original_id
                       ORDER BY d.fecha_disponible ASC, d.id ASC
                   ) AS numero_duplicado
            FROM fg_certificado_duplicado d
            WHERE d.estado = 'DISPONIBLE'
              AND d.planta_key = ANY($1::varchar[])
        ),
        detalle AS (
            SELECT d.id,
                   d.certificado_original_id,
                   d.operacion_id,
                   COALESCE(d.facturacion_id, f.id) AS facturacion_id,
                   d.planta_key,
                   p.nombre AS planta_nombre,
                   d.placa,
                   d.tipo_certificado_clave,
                   d.modalidad,
                   d.numero_certificado_snapshot,
                   d.tipo_nombre_snapshot,
                   d.fecha_emision_snapshot,
                   d.fecha_disponible,
                   d.estado,
                   d.solicitado_por,
                   d.numero_duplicado,
                   ${sqlCategoriaDuplicado('d')} AS tipo_dashboard,
                   oc.importe_total,
                   f.tipo_comprobante,
                   f.nro_comprobante,
                   f.estado AS facturacion_estado,
                   f.fecha_documento
            FROM duplicados_con_ordinal d
            JOIN fg_operacion_comercial oc ON oc.id = d.operacion_id
            JOIN fg_facturacion f ON f.operacion_id = d.operacion_id
            LEFT JOIN fg_planta p ON p.key = d.planta_key
            WHERE d.planta_key = ANY($1::varchar[])
              AND ${SQL_COMPROBANTE_EMITIDO_EXITOSAMENTE}
              AND d.fecha_disponible >= $2::timestamptz
              AND d.fecha_disponible < $3::timestamptz
              AND ($4::varchar IS NULL OR ${sqlCategoriaDuplicado('d')} = $4::varchar)
        )
        SELECT detalle.*, COUNT(*) OVER() AS total_registros
        FROM detalle
        ORDER BY fecha_disponible DESC, id DESC
        LIMIT $5 OFFSET $6
    `;

    const result = await db.query(query, [
        plantas,
        inicioActual,
        finActual,
        tipoDuplicadoAplicado,
        limiteAplicado,
        offset
    ]);
    const total = Number(result.rows[0]?.total_registros || 0);

    return {
        items: result.rows.map(row => ({
            id: Number(row.id),
            certificadoOriginalId: Number(row.certificado_original_id),
            operacionId: Number(row.operacion_id),
            facturacionId: Number(row.facturacion_id),
            plantaKey: row.planta_key,
            plantaNombre: row.planta_nombre || row.planta_key,
            placa: row.placa,
            tipoCertificadoClave: row.tipo_certificado_clave,
            tipoCertificado: row.tipo_dashboard,
            tipoNombre: row.tipo_nombre_snapshot,
            modalidad: row.modalidad,
            numeroCertificadoOriginal: row.numero_certificado_snapshot,
            fechaCertificadoOriginal: row.fecha_emision_snapshot,
            fechaEmisionDuplicado: row.fecha_disponible,
            numeroDuplicado: Number(row.numero_duplicado),
            importe: Number(row.importe_total || 0),
            tipoComprobante: row.tipo_comprobante,
            numeroComprobante: row.nro_comprobante,
            fechaComprobante: row.fecha_documento,
            estado: row.estado,
            estadoFacturacion: row.facturacion_estado,
            solicitadoPor: row.solicitado_por
        })),
        total,
        pagina: paginaAplicada,
        limite: limiteAplicado
    };
}

/**
 * Detalle de ventas de productos inventariables y chips
 */
async function obtenerDetalleProductos({ plantasAutorizadas, plantasFiltro, desde, hasta, pagina = 1, limite = 20, productoId }) {
    const plantas = (plantasFiltro && plantasFiltro.length > 0)
        ? plantasFiltro.filter(p => plantasAutorizadas.includes(p))
        : plantasAutorizadas;
    if (plantas.length === 0) return { items: [], total: 0, pagina: 1, limite };

    const { inicioActual, finActual } = calcularIntervaloFechas(desde, hasta);
    const offset = (Math.max(Number(pagina), 1) - 1) * Number(limite);

    const params = [plantas, inicioActual, finActual];
    let whereProducto = '';
    if (productoId) {
        params.push(productoId);
        whereProducto = ` AND od.producto_facturacion_id = $${params.length}::bigint`;
    }

    const query = `
        SELECT 
            od.producto_facturacion_id AS id,
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
          AND EXISTS (
              SELECT 1
              FROM fg_facturacion f
              WHERE f.operacion_id = oc.id
                AND ${SQL_COMPROBANTE_EMITIDO_EXITOSAMENTE}
          )
          AND od.tipo_item = 'PRODUCTO'
          AND od.producto_facturacion_id IS NOT NULL
          ${whereProducto}
        GROUP BY od.producto_facturacion_id, od.codigo_sku_snapshot, od.descripcion_snapshot, od.unidad_snapshot
        ORDER BY total_soles DESC, total_unidades DESC
    `;

    const allRes = await db.query(query, params);
    const total = allRes.rows.length;
    const paginados = allRes.rows.slice(offset, offset + Number(limite));

    return {
        items: paginados.map(r => ({
            id: Number(r.id),
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
            COALESCE(cuotas.cantidad, 0) AS cuotas_cantidad,
            COALESCE(cuotas.importe_programado, 0) AS cuotas_importe_programado,
            cuotas.proximo_vencimiento,
            COALESCE(f.planta_key, oc.planta_key) AS planta_key,
            p.nombre AS planta_nombre
        FROM fg_facturacion f
        LEFT JOIN fg_operacion_comercial oc ON oc.id = f.operacion_id
        LEFT JOIN fg_planta p ON p.key = COALESCE(f.planta_key, oc.planta_key)
        LEFT JOIN LATERAL (
            SELECT
                COUNT(*) AS cantidad,
                SUM(fc.importe) AS importe_programado,
                MIN(fc.fecha_pago) FILTER (WHERE fc.estado = 'PENDIENTE') AS proximo_vencimiento
            FROM fg_facturacion_cuota fc
            WHERE fc.facturacion_id = f.id
        ) cuotas ON TRUE
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
            cuotasCantidad: Number(r.cuotas_cantidad || 0),
            cuotasImporteProgramado: Number(r.cuotas_importe_programado || 0),
            proximoVencimiento: r.proximo_vencimiento,
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
async function obtenerDetalleUsuarios({ plantasAutorizadas, plantasFiltro, desde, hasta, productoId }) {
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
            COALESCE(SUM(
                CASE 
                    WHEN $4::bigint IS NOT NULL THEN od.importe_total
                    ELSE oc.importe_total
                END
            ), 0) AS total_vendido,
            CASE 
                WHEN $4::bigint IS NOT NULL THEN 0
                ELSE COUNT(DISTINCT od.certificado_id) FILTER (WHERE od.tipo_item = 'SERVICIO' AND od.certificado_id IS NOT NULL)
            END AS certificados_generados,
            COALESCE(SUM(od.cantidad) FILTER (
                WHERE od.tipo_item = 'PRODUCTO'
                  AND od.producto_facturacion_id IS NOT NULL
                  AND ($4::bigint IS NULL OR od.producto_facturacion_id = $4::bigint)
            ), 0) AS productos_vendidos,
            MAX(oc.fecha_creacion) AS ultima_operacion
        FROM fg_operacion_comercial oc
        ${productoId ? `JOIN fg_operacion_detalle od ON od.operacion_id = oc.id AND od.tipo_item = 'PRODUCTO' AND od.producto_facturacion_id = $4::bigint` : `LEFT JOIN fg_operacion_detalle od ON od.operacion_id = oc.id`}
        LEFT JOIN fg_usuario u ON u.username = oc.usuario_creacion
        LEFT JOIN persona p ON p.nrodocumentoidentidad = u.persona_nrodocumentoidentidad
        WHERE oc.planta_key = ANY($1::varchar[])
          AND oc.fecha_creacion >= $2::timestamptz AND oc.fecha_creacion < $3::timestamptz
          AND EXISTS (
              SELECT 1
              FROM fg_facturacion f
              WHERE f.operacion_id = oc.id
                AND ${SQL_COMPROBANTE_EMITIDO_EXITOSAMENTE}
          )
        GROUP BY oc.usuario_creacion, p.nombres, p.apellidos, p.nombrerazonsocial
        ORDER BY total_vendido DESC, total_operaciones DESC
    `;

    const res = await db.query(query, [plantas, inicioActual, finActual, productoId || null]);
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
async function obtenerDatosExportacion({ plantasAutorizadas, plantasFiltro, desde, hasta, tipoCertificado, tipoDuplicado, username }) {
    const plantas = (plantasFiltro && plantasFiltro.length > 0)
        ? plantasFiltro.filter(p => plantasAutorizadas.includes(p))
        : plantasAutorizadas;
    if (plantas.length === 0) return null;

    const resumen = await obtenerResumenDashboard({ plantasAutorizadas, plantasFiltro, desde, hasta, tipoCertificado, tipoDuplicado });
    const sedes = await obtenerDetalleSedes({ plantasAutorizadas: plantas, desde, hasta, tipoCertificado, tipoDuplicado });
    const certs = await obtenerDetalleCertificados({ plantasAutorizadas: plantas, desde, hasta, pagina: 1, limite: 5000, tipoCertificado });
    const duplicados = await obtenerDetalleDuplicados({ plantasAutorizadas: plantas, desde, hasta, pagina: 1, limite: 5000, tipoCertificado, tipoDuplicado });
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
            duplicados: duplicados.items,
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
            ventaOperativaCertificados: { actual: 0, anterior: 0, delta: 0, porcentaje: 0, tooltip: '' },
            ventaBrutaCertificados: { actual: 0, anterior: 0, delta: 0, porcentaje: 0, tooltip: '' },
            ventaNetaCertificados: { actual: 0, anterior: 0, delta: 0, porcentaje: 0, tooltip: '' },
            ticketPromedioCertificados: { actual: 0, anterior: 0, delta: 0, porcentaje: 0, tooltip: '' },
            certificadosEmitidos: { actual: 0, anterior: 0, delta: 0, porcentaje: 0, tooltip: '' },
            certificadosPendientes: { actual: 0, anterior: 0, delta: 0, porcentaje: 0, tooltip: '' },
            certificadosAnulados: { actual: 0, anterior: 0, delta: 0, porcentaje: 0, tooltip: '' },
            productosVendidos: { actual: 0, anterior: 0, delta: 0, porcentaje: 0, tooltip: '' },
            montoDescontado: { actual: 0, anterior: 0, delta: 0, porcentaje: 0, tooltip: '' },
            facturasAceptadas: { actual: 0, anterior: 0, delta: 0, porcentaje: 0, tooltip: '' },
            boletasAceptadas: { actual: 0, anterior: 0, delta: 0, porcentaje: 0, tooltip: '' },
            comprobantesRechazadosOError: { actual: 0, anterior: 0, delta: 0, porcentaje: 0, tooltip: '' },
            duplicadosEmitidos: { actual: 0, anterior: 0, delta: 0, porcentaje: 0, tooltip: '' },
            ventaDuplicados: { actual: 0, anterior: 0, delta: 0, porcentaje: 0, tooltip: '' },
            totalCobradoDuplicados: { actual: 0, anterior: 0, delta: 0, porcentaje: 0, tooltip: '' },
            saldoPendienteDuplicados: { actual: 0, anterior: 0, delta: 0, porcentaje: 0, tooltip: '' },
            ticketPromedioDuplicados: { actual: 0, anterior: 0, delta: 0, porcentaje: 0, tooltip: '' }
        },
        serieDiaria: [],
        serieCertificados: [],
        serieDuplicados: [],
        distribucionCertificados: [],
        distribucionDuplicados: [],
        distribucionProductos: [],
        distribucionPagos: [],
        alertas: []
    };
}

module.exports = {
    calcularIntervaloFechas,
    calcularVariacion,
    esComprobanteEmitidoExitosamente: esDocumentoBaseOperable,
    obtenerResumenDashboard,
    obtenerDetalleSedes,
    obtenerDetalleCertificados,
    obtenerDetalleDuplicados,
    obtenerDetalleProductos,
    obtenerDetalleComprobantes,
    obtenerDetallePagos,
    obtenerDetalleDescuentos,
    obtenerDetalleUsuarios,
    obtenerDatosExportacion,
    _private: {
        normalizarTipoDuplicado,
        resolverTipoDuplicado,
        sqlCategoriaDuplicado
    }
};
