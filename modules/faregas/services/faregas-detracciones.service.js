/**
 * Servicio Centralizado de Detracciones (SPOT - Sistema de Pago de Obligaciones Tributarias)
 * Sistema: FAREGAS — SUNAT / NubeFact
 * 
 * Normativa:
 * - Resolución de Superintendencia N° 183-2004/SUNAT y modificatorias.
 * - Anexo 3 SPOT (Servicios):
 *   - Código 037: "Demás servicios gravados con el IGV" (12 %) - Certificaciones GNV, GLP, Conformidad.
 *   - Código 020: "Mantenimiento y reparación de bienes muebles" (12 %) - Servicios de Taller.
 *   - Código 022: "Otros servicios empresariales" (12 %) - Peritajes e inspecciones técnicas.
 *   - Código 025: "Fabricación de bienes por encargo" (10 %) - Fabricación / montaje.
 * - Umbral: Superior a S/ 700.00 (Art. 9 R.S. 183-2004/SUNAT).
 * - Exclusiones: Boletas de Venta a consumidor final, bienes muebles puros (chips), monto <= S/ 700.00.
 * - Redondeo oficial SUNAT: Redondeo al número entero en moneda nacional (Art. 19 R.S. 183-2004/SUNAT).
 */

const CAT_SPOT = {
    '037': { codigo: '037', descripcion: 'Demás servicios gravados con el IGV', porcentaje: 12.00, nubefactTipo: 37 },
    '020': { codigo: '020', descripcion: 'Mantenimiento y reparación de bienes muebles', porcentaje: 12.00, nubefactTipo: 20 },
    '022': { codigo: '022', descripcion: 'Otros servicios empresariales', porcentaje: 12.00, nubefactTipo: 22 },
    '025': { codigo: '025', descripcion: 'Fabricación de bienes por encargo', porcentaje: 10.00, nubefactTipo: 25 },
};

const redondear = (value) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;

/**
 * Evalúa si un comprobante o cotización está sujeto al régimen de detracciones SPOT.
 */
function evaluarDetraccion({
    tipoComprobante,
    importeTotal,
    moneda = 'PEN',
    items = [],
    servicio = null,
    esGratuito = false
}) {
    const total = redondear(importeTotal);
    const tipo = String(tipoComprobante || '').toUpperCase().trim();
    const esFactura = tipo === 'FACTURA' || tipo === '1';

    // 1. Validar gratuidad
    if (esGratuito || total <= 0) {
        return {
            sujeto: false,
            codigo: null,
            descripcion: null,
            porcentaje: 0,
            base: total,
            monto: 0,
            neto: total,
            estadoDeposito: 'NO_APLICA',
            motivoExclusion: 'TRANSFERENCIA_GRATUITA',
            requiereRevision: false
        };
    }

    // 2. Validar tipo de comprobante (Boletas a consumidor final no están sujetas a SPOT)
    if (!esFactura) {
        return {
            sujeto: false,
            codigo: null,
            descripcion: null,
            porcentaje: 0,
            base: total,
            monto: 0,
            neto: total,
            estadoDeposito: 'NO_APLICA',
            motivoExclusion: 'BOLETA_VENTA_CONSUMIDOR_FINAL_NO_SUJETA',
            requiereRevision: false
        };
    }

    // 3. Validar umbral de monto (Debe superar S/ 700.00)
    if (total <= 700.00) {
        return {
            sujeto: false,
            codigo: null,
            descripcion: null,
            porcentaje: 0,
            base: total,
            monto: 0,
            neto: total,
            estadoDeposito: 'NO_APLICA',
            motivoExclusion: 'IMPORTE_MENOR_O_IGUAL_A_700',
            requiereRevision: false
        };
    }

    // 4. Validar naturaleza de los items facturados (Servicio vs Bienes muebles puros)
    const soloBienesPuros = items.length > 0 && items.every(item => {
        const sku = String(item.codigo_sku_snapshot || item.codigo_sku || item.codigo || '').toUpperCase();
        const desc = String(item.descripcion_snapshot || item.descripcion || item.producto || '').toUpperCase();
        return (sku.includes('CHIP') || desc.includes('CHIP') || item.tipo_item === 'PRODUCTO') 
            && !desc.includes('CERTIFICADO') && !desc.includes('CONVERSION') && !desc.includes('CONFORMIDAD') && !desc.includes('TALLER');
    });

    if (soloBienesPuros) {
        return {
            sujeto: false,
            codigo: null,
            descripcion: null,
            porcentaje: 0,
            base: total,
            monto: 0,
            neto: total,
            estadoDeposito: 'NO_APLICA',
            motivoExclusion: 'BIEN_MUEBLE_NO_SUJETO_A_SPOT',
            requiereRevision: false
        };
    }

    // 5. Determinar clasificación SPOT aplicable
    let spotCodigo = '037';
    let spotPorcentaje = 12.00;

    if (servicio) {
        if (servicio.sujeto_detraccion === false) {
            return {
                sujeto: false,
                codigo: null,
                descripcion: null,
                porcentaje: 0,
                base: total,
                monto: 0,
                neto: total,
                estadoDeposito: 'NO_APLICA',
                motivoExclusion: 'SERVICIO_EXCLUIDO_POR_CONFIGURACION',
                requiereRevision: false
            };
        }
        if (servicio.detraccion_codigo) {
            spotCodigo = servicio.detraccion_codigo;
        } else if (servicio.familia === 'TALLER' || servicio.tipo_flujo === 'TALLER_INSPECCION') {
            spotCodigo = '020';
        }
        if (servicio.detraccion_porcentaje) {
            spotPorcentaje = Number(servicio.detraccion_porcentaje);
        }
    } else if (items.some(i => String(i.familia || '').toUpperCase() === 'TALLER' || String(i.descripcion || '').toUpperCase().includes('TALLER'))) {
        spotCodigo = '020';
    }

    const definicion = CAT_SPOT[spotCodigo] || {
        codigo: spotCodigo,
        descripcion: 'Demás servicios gravados con el IGV',
        porcentaje: spotPorcentaje,
        nubefactTipo: parseInt(spotCodigo, 10) || 37
    };

    // 6. Cálculo legal oficial: Base total, porcentaje y redondeo al número entero SUNAT
    const base = total;
    const porcentaje = Number(definicion.porcentaje || spotPorcentaje);
    // Redondeo legal oficial SUNAT (Art. 19 RS 183-2004/SUNAT)
    const monto = Math.round((base * porcentaje) / 100);
    const neto = redondear(base - monto);

    return {
        sujeto: true,
        codigo: definicion.codigo,
        descripcion: definicion.descripcion,
        porcentaje: porcentaje,
        base: base,
        monto: monto,
        neto: neto,
        estadoDeposito: 'PENDIENTE',
        constanciaNro: null,
        constanciaFecha: null,
        motivoExclusion: null,
        medioPagoDetraccion: '001', // Depósito en cuenta Banco de la Nación
        nubefactTipo: definicion.nubefactTipo,
        requiereRevision: false
    };
}

/**
 * Enriquece el payload enviado a la API de NubeFact con los campos oficiales de detracción SPOT.
 */
function aplicarDetraccionPayloadNubefact(payload, evaluacion) {
    if (!payload || typeof payload !== 'object') return payload;

    if (evaluacion && evaluacion.sujeto === true) {
        payload.detraccion = true;
        payload.detraccion_tipo = evaluacion.nubefactTipo || parseInt(evaluacion.codigo, 10) || 37;
        payload.detraccion_porcentaje = Number(evaluacion.porcentaje || 12);
        payload.detraccion_total = Number(evaluacion.monto || 0);
        payload.medio_de_pago_detraccion = '001';
    } else {
        payload.detraccion = false;
        delete payload.detraccion_tipo;
        delete payload.detraccion_porcentaje;
        delete payload.detraccion_total;
        delete payload.medio_de_pago_detraccion;
    }

    return payload;
}

/**
 * Evalúa el ajuste de detracción en una Nota de Crédito vinculada a una Factura sujeta a SPOT.
 */
function evaluarNotaCreditoDetraccion(facturaOriginal, importeNotaCredito) {
    if (!facturaOriginal || !facturaOriginal.sujeto_detraccion) {
        return {
            sujeto: false,
            codigo: null,
            porcentaje: 0,
            monto: 0,
            neto: redondear(importeNotaCredito),
            motivoExclusion: 'COMPROBANTE_ORIGINAL_NO_SUJETO'
        };
    }

    const base = redondear(importeNotaCredito);
    const porcentaje = Number(facturaOriginal.detraccion_porcentaje || 12.00);
    const monto = Math.round((base * porcentaje) / 100);
    const neto = redondear(base - monto);

    return {
        sujeto: true,
        codigo: facturaOriginal.detraccion_codigo || '037',
        porcentaje: porcentaje,
        base: base,
        monto: monto,
        neto: neto,
        motivoExclusion: null
    };
}

module.exports = {
    CAT_SPOT,
    evaluarDetraccion,
    aplicarDetraccionPayloadNubefact,
    evaluarNotaCreditoDetraccion
};

