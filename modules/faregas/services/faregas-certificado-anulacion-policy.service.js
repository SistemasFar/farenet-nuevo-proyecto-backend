const CODIGO_IMPORTE_CERO = 'CERTIFICADO_IMPORTE_CERO_NO_ANULABLE';
const CODIGO_IMPORTE_NO_DETERMINABLE = 'CERTIFICADO_IMPORTE_FINAL_NO_DETERMINABLE';
const MENSAJE_IMPORTE_CERO = 'Este certificado tiene un importe final de S/ 0.00 y no admite anulación.';
const MENSAJE_IMPORTE_NO_DETERMINABLE = 'No se pudo determinar de forma confiable el importe final del certificado. La anulación queda bloqueada hasta regularizar el importe.';
const {
    CODIGOS_HISTORICOS_ANULACION,
    SQL_CODIGOS_HISTORICOS_ANULACION,
    esMotivoAnulacionNotaCredito
} = require('./faregas-notas-credito.constants');

const MOTIVOS_NOTA_ANULACION = new Set(CODIGOS_HISTORICOS_ANULACION);

const errorNegocio = (code, statusCode = 409, detalles) => {
    const error = new Error(code);
    error.code = code;
    error.statusCode = statusCode;
    if (detalles !== undefined) error.detalles = detalles;
    return error;
};

const normalizarMonto = (valor) => {
    if (valor === null || valor === undefined || valor === '') return null;
    const numero = Number(valor);
    if (!Number.isFinite(numero)) return null;
    return Math.round(numero * 100) / 100;
};

const normalizarMoneda = (valor) => {
    const moneda = String(valor || 'sol').trim().toLowerCase();
    if (['pen', 's/', 'soles', 'sol'].includes(moneda)) return 'PEN';
    return moneda ? moneda.toUpperCase() : 'PEN';
};

const tieneValor = (row, ...claves) => claves.some((clave) => row?.[clave] !== null && row?.[clave] !== undefined);

const leerPrimerMonto = (row, ...claves) => {
    for (const clave of claves) {
        const monto = normalizarMonto(row?.[clave]);
        if (monto !== null) return monto;
    }
    return null;
};

/**
 * Resuelve el importe final de la operación usando exclusivamente datos
 * persistidos. El orden de prioridad es:
 *   1. fg_orden_pago.importe_total (total transaccional definitivo).
 *   2. fg_facturacion.importe_total (copia persistida del mismo total).
 *   3. descuento aplicado/reservado + precio del chip, o precio congelado
 *      cuando no existe descuento registrado.
 *
 * fg_certificado.importe_total no se usa porque representa el precio de lista
 * anterior a descuentos y no el importe final de la operación.
 */
const evaluarImporteFinalCertificado = (row = {}) => {
    const importeOrden = leerPrimerMonto(
        row,
        'orden_importe_total',
        'ordenImporteTotal',
        'importe_orden',
        'orden_pago_importe_total'
    );
    const importeFacturacion = leerPrimerMonto(
        row,
        'facturacion_importe_total',
        'facturacionImporteTotal',
        'importe_facturacion'
    ) ?? (tieneValor(row, 'facturacion_id', 'facturacionId') ? normalizarMonto(row.importe_total) : null);

    const moneda = normalizarMoneda(
        row.orden_moneda
        || row.ordenMoneda
        || row.facturacion_moneda
        || row.facturacionMoneda
        || row.moneda_key
    );

    if (importeOrden !== null && importeFacturacion !== null
        && Math.abs(importeOrden - importeFacturacion) > 0.009) {
        return {
            determinable: false,
            motivoNoDeterminable: 'IMPORTE_ORDEN_PAGO_INCONSISTENTE_CON_FACTURACION',
            importeOrden,
            importeFacturacion,
            moneda
        };
    }

    if (importeOrden !== null) {
        return {
            determinable: true,
            importeFinal: importeOrden,
            moneda,
            fuente: 'ORDEN_PAGO',
            esCero: importeOrden === 0
        };
    }

    if (importeFacturacion !== null) {
        return {
            determinable: true,
            importeFinal: importeFacturacion,
            moneda,
            fuente: 'FACTURACION',
            esCero: importeFacturacion === 0
        };
    }

    const descuentoFinal = leerPrimerMonto(
        row,
        'descuento_importe_final',
        'descuentoImporteFinal',
        'importe_final_descuento'
    );
    const precioCertificado = leerPrimerMonto(
        row,
        'precio_certificado',
        'precioCertificado'
    );
    const precioChip = leerPrimerMonto(row, 'precio_chip', 'precioChip') || 0;
    const requiereChip = Boolean(row.producto_chip_id || row.productoChipId);

    if (descuentoFinal !== null) {
        const importeFinal = normalizarMonto(descuentoFinal + (requiereChip ? precioChip : 0));
        return {
            determinable: true,
            importeFinal,
            moneda,
            fuente: 'DESCUENTO_APLICADO',
            esCero: importeFinal === 0
        };
    }

    if (precioCertificado !== null) {
        const importeFinal = normalizarMonto(precioCertificado + (requiereChip ? precioChip : 0));
        return {
            determinable: true,
            importeFinal,
            moneda,
            fuente: 'PRECIO_CERTIFICADO_SIN_DESCUENTO',
            esCero: importeFinal === 0
        };
    }

    return {
        determinable: false,
        motivoNoDeterminable: 'SIN_ORDEN_PAGO_FACTURACION_O_PRECIO',
        moneda
    };
};

const logNoDeterminable = (logger, evaluacion, contexto = {}) => {
    const salida = logger && typeof logger.error === 'function' ? logger : null;
    if (!salida) return;
    salida.error('[FAREGAS ANULACION] Importe final no determinable; se bloquea la anulación.', {
        ...contexto,
        motivo: evaluacion.motivoNoDeterminable,
        importeOrden: evaluacion.importeOrden ?? null,
        importeFacturacion: evaluacion.importeFacturacion ?? null
    });
};

const exigirAnulacionPermitidaPorImporte = (evaluacion, opciones = {}) => {
    const contexto = {
        certificadoId: opciones.certificadoId ?? null,
        operacion: opciones.operacion || 'ANULACION_CERTIFICADO'
    };

    if (!evaluacion || evaluacion.determinable !== true) {
        logNoDeterminable(opciones.logger || console, evaluacion || {}, contexto);
        throw errorNegocio(CODIGO_IMPORTE_NO_DETERMINABLE, 409, {
            ...contexto,
            motivo: evaluacion?.motivoNoDeterminable || 'IMPORTE_FINAL_NO_DETERMINABLE',
            importeOrden: evaluacion?.importeOrden ?? null,
            importeFacturacion: evaluacion?.importeFacturacion ?? null,
            mensaje: MENSAJE_IMPORTE_NO_DETERMINABLE
        });
    }

    if (evaluacion.esCero === true) {
        throw errorNegocio(CODIGO_IMPORTE_CERO, 409, {
            ...contexto,
            importeFinal: 0,
            moneda: evaluacion.moneda || 'PEN',
            fuente: evaluacion.fuente || null,
            mensaje: MENSAJE_IMPORTE_CERO
        });
    }

    return evaluacion;
};

// Fragmentos reutilizables para que el motor de solicitudes sólo lea datos
// comerciales persistidos, sin incorporar escrituras ni dependencias de pagos.
const SQL_CAMPOS_IMPORTE_FINAL_CONTEXTO = `
        c.precio_certificado,
        c.precio_chip,
        c.producto_chip_id,
        op.importe_total AS orden_importe_total,
        op.moneda_key AS orden_moneda,
        descuento.importe_final AS descuento_importe_final`;

const SQL_JOINS_IMPORTE_FINAL_CONTEXTO = `
    LEFT JOIN LATERAL (
        SELECT orden.importe_total, orden.moneda_key
        FROM fg_orden_pago orden
        WHERE orden.certificado_id = c.id
        ORDER BY orden.id DESC
        LIMIT 1
    ) op ON TRUE
    LEFT JOIN LATERAL (
        SELECT dc.importe_final
        FROM fg_descuentocomprobante dc
        WHERE dc.certificado_id = c.id
          AND dc.estado IN ('RESERVADO', 'APLICADO')
        ORDER BY dc.id DESC
        LIMIT 1
    ) descuento ON TRUE`;

const SQL_IMPORTE_FINAL = `
    SELECT c.id AS certificado_id,
           c.precio_certificado,
           c.precio_chip,
           c.producto_chip_id,
           op.importe_total AS orden_importe_total,
           op.moneda_key AS orden_moneda,
           f.id AS facturacion_id,
           f.importe_total AS facturacion_importe_total,
           f.moneda_key AS facturacion_moneda,
           d.id AS descuento_id,
           d.importe_final AS descuento_importe_final
    FROM fg_certificado c
    LEFT JOIN LATERAL (
        SELECT orden.importe_total, orden.moneda_key
        FROM fg_orden_pago orden
        WHERE orden.certificado_id = c.id
        ORDER BY orden.id DESC
        LIMIT 1
    ) op ON TRUE
    LEFT JOIN LATERAL (
        SELECT fact.id, fact.importe_total, fact.moneda_key
        FROM fg_facturacion fact
        WHERE fact.certificado_id = c.id
        ORDER BY fact.id DESC
        LIMIT 1
    ) f ON TRUE
    LEFT JOIN LATERAL (
        SELECT descuento.id, descuento.importe_final
        FROM fg_descuentocomprobante descuento
        WHERE descuento.certificado_id = c.id
          AND descuento.estado IN ('RESERVADO', 'APLICADO')
        ORDER BY descuento.id DESC
        LIMIT 1
    ) d ON TRUE
    WHERE c.id = $1
`;

const consultarImporteFinalCertificado = async (executor, certificadoId) => {
    const result = await executor.query(SQL_IMPORTE_FINAL, [certificadoId]);
    if (result.rowCount === 0) throw errorNegocio('CERTIFICADO_NO_ENCONTRADO', 404);
    return evaluarImporteFinalCertificado(result.rows[0]);
};

const validarAnulacionCertificadoPorImporte = async (executor, certificadoId, opciones = {}) => {
    const evaluacion = await consultarImporteFinalCertificado(executor, certificadoId);
    return exigirAnulacionPermitidaPorImporte(evaluacion, { ...opciones, certificadoId });
};

const tieneOperacionFiscalIniciada = async (executor, { facturacionId } = {}) => {
    if (!facturacionId) return false;
    const result = await executor.query(`
        SELECT (
            EXISTS (
                SELECT 1 FROM fg_documento_anulacion
                WHERE facturacion_id = $1
            )
            OR EXISTS (
                SELECT 1 FROM fg_credito
                WHERE facturacion_id = $1
                  AND motivo_codigo IN (${SQL_CODIGOS_HISTORICOS_ANULACION})
            )
        ) AS existe
    `, [facturacionId]);
    return result.rows[0]?.existe === true;
};

module.exports = {
    CODIGO_IMPORTE_CERO,
    CODIGO_IMPORTE_NO_DETERMINABLE,
    MENSAJE_IMPORTE_CERO,
    MENSAJE_IMPORTE_NO_DETERMINABLE,
    MOTIVOS_NOTA_ANULACION,
    SQL_CAMPOS_IMPORTE_FINAL_CONTEXTO,
    SQL_JOINS_IMPORTE_FINAL_CONTEXTO,
    evaluarImporteFinalCertificado,
    exigirAnulacionPermitidaPorImporte,
    consultarImporteFinalCertificado,
    validarAnulacionCertificadoPorImporte,
    tieneOperacionFiscalIniciada,
    esMotivoAnulacionNotaCredito
};
