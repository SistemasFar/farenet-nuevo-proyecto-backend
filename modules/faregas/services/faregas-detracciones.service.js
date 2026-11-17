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
    // NubeFact usa su enumeración interna: tipo 35 corresponde al código
    // SUNAT 037 (Demás servicios gravados con IGV).
    '037': { codigo: '037', descripcion: 'Demás servicios gravados con el IGV', porcentaje: 12.00, nubefactTipo: 35 },
    '020': { codigo: '020', descripcion: 'Mantenimiento y reparación de bienes muebles', porcentaje: 12.00, nubefactTipo: 20 },
    '022': { codigo: '022', descripcion: 'Otros servicios empresariales', porcentaje: 12.00, nubefactTipo: 22 },
    '025': { codigo: '025', descripcion: 'Fabricación de bienes por encargo', porcentaje: 10.00, nubefactTipo: 25 },
};

// Códigos de bienes del Anexo 2 con tasa fija y sin colisión con el catálogo
// de servicios que este adaptador envía a NubeFact. Se excluyen los códigos
// ambiguos entre anexos hasta que el proveedor permita distinguirlos.
const CAT_SPOT_BIENES = Object.freeze({
    '002': { descripcion: 'Maíz amarillo duro', porcentaje: 4 },
    '004': { descripcion: 'Caña de azúcar', porcentaje: 10 },
    '005': { descripcion: 'Arena y piedra', porcentaje: 10 },
    '006': { descripcion: 'Residuos y subproductos', porcentaje: 15 },
    '007': { descripcion: 'Bienes gravados por renuncia a la exoneración', porcentaje: 10 },
    '009': { descripcion: 'Carnes y despojos comestibles', porcentaje: 4 },
    '011': { descripcion: 'Aceite de pescado', porcentaje: 10 },
    '012': { descripcion: 'Harina y pellets de pescado', porcentaje: 4 },
    '015': { descripcion: 'Madera', porcentaje: 4 },
    '017': { descripcion: 'Páprika y frutos capsicum o pimienta', porcentaje: 10 },
    '021': { descripcion: 'Oro y minerales metálicos exonerados', porcentaje: 1.5 },
    '023': { descripcion: 'Plomo', porcentaje: 15 }
});

const redondear = (value) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
const UMBRAL_LEGAL_SERVICIOS = 700;
const UMBRAL_COMERCIAL_POR_DEFECTO = 700;

function obtenerUmbralComercial() {
    const valor = String(process.env.FAREGAS_SPOT_UMBRAL_COMERCIAL || '').trim();
    if (!valor) return UMBRAL_COMERCIAL_POR_DEFECTO;
    const configurado = Number(valor);
    return Number.isFinite(configurado) && configurado >= 0
        ? redondear(configurado)
        : UMBRAL_COMERCIAL_POR_DEFECTO;
}

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
    const umbralComercial = obtenerUmbralComercial();
    const umbralComercialAlcanzado = esFactura && total >= umbralComercial;
    const debeEvaluarClasificacion = umbralComercialAlcanzado || total > UMBRAL_LEGAL_SERVICIOS;
    const resultado = (campos, estadoEvaluacionSpot) => ({
        ...campos,
        estadoEvaluacionSpot,
        umbralComercial,
        umbralComercialAlcanzado
    });

    // 1. Validar gratuidad
    if (esGratuito || total <= 0) {
        return resultado({
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
        }, 'EXCLUIDA_GRATUITA');
    }

    // 2. Validar tipo de comprobante (Boletas a consumidor final no están sujetas a SPOT)
    if (!esFactura) {
        return resultado({
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
        }, 'EXCLUIDA_COMPROBANTE');
    }

    const tiposItem = new Set(items.map(item =>
        String(item.tipo_item || item.tipoItem || '').toUpperCase()
    ).filter(Boolean));
    const tieneProducto = tiposItem.has('PRODUCTO');
    const tieneServicio = tiposItem.has('SERVICIO');
    if (tieneProducto && tieneServicio) {
        return resultado({
            sujeto: false, codigo: null, descripcion: null, porcentaje: 0, base: total,
            monto: 0, neto: total, estadoDeposito: 'NO_VERIFICADO',
            motivoExclusion: 'CONCEPTOS_MIXTOS_REQUIEREN_REVISION', requiereRevision: true
        }, 'MIXTA_REQUIERE_REVISION');
    }

    // Los productos físicos se clasifican desde fg_producto_facturacion. Nunca
    // se consultan como servicio ni se deduce SPOT por SKU, descripción o monto.
    const sonProductos = items.length > 0 && items.every(item =>
        String(item.tipo_item || item.tipoItem || '').toUpperCase() === 'PRODUCTO'
    );
    if (sonProductos) {
        const clasificaciones = items.map(item => item.productoSpot || item);
        const codigoExcepcionSinUmbral = clasificaciones.some(producto =>
            producto.sujeto_detraccion === true && ['006', '021'].includes(String(producto.detraccion_codigo || ''))
        );
        if (!debeEvaluarClasificacion && !codigoExcepcionSinUmbral) {
            return resultado({
                sujeto: false, codigo: null, descripcion: null, porcentaje: 0, base: total, monto: 0,
                neto: total, estadoDeposito: 'NO_APLICA', motivoExclusion: 'BAJO_UMBRAL_COMERCIAL', requiereRevision: false
            }, 'BAJO_UMBRAL_COMERCIAL');
        }
        if (clasificaciones.some(producto => producto.sujeto_detraccion == null)) {
            return resultado({ sujeto: false, codigo: null, descripcion: null, porcentaje: 0, base: total, monto: 0,
                neto: total, estadoDeposito: 'NO_VERIFICADO', motivoExclusion: 'CLASIFICACION_SPOT_NO_VERIFICADA', requiereRevision: true }, 'CLASIFICACION_PENDIENTE');
        }
        if (clasificaciones.every(producto => producto.sujeto_detraccion === false)) {
            return resultado({ sujeto: false, codigo: null, descripcion: null, porcentaje: 0, base: total, monto: 0,
                neto: total, estadoDeposito: 'NO_APLICA', motivoExclusion: 'BIEN_MUEBLE_NO_SUJETO_A_SPOT', requiereRevision: false }, 'NO_SUJETA_CONFIGURACION');
        }
        const first = clasificaciones[0];
        if (clasificaciones.some(producto => producto.sujeto_detraccion !== true
            || producto.detraccion_codigo !== first.detraccion_codigo
            || Number(producto.detraccion_porcentaje) !== Number(first.detraccion_porcentaje))) {
            return resultado({ sujeto: false, codigo: null, descripcion: null, porcentaje: 0, base: total, monto: 0,
                neto: total, estadoDeposito: 'NO_VERIFICADO', motivoExclusion: 'CLASIFICACION_SPOT_INCONSISTENTE', requiereRevision: true }, 'CLASIFICACION_INCONSISTENTE');
        }
        const definicion = CAT_SPOT_BIENES[first.detraccion_codigo];
        if (!definicion || Number(definicion.porcentaje) !== Number(first.detraccion_porcentaje)) {
            return resultado({ sujeto: false, codigo: null, descripcion: null, porcentaje: 0, base: total, monto: 0,
                neto: total, estadoDeposito: 'NO_VERIFICADO', motivoExclusion: 'CLASIFICACION_SPOT_NO_RECONOCIDA', requiereRevision: true }, 'CLASIFICACION_NO_RECONOCIDA');
        }
        // Para ciertos numerales de bienes del Anexo 2 la excepción de S/ 700
        // no aplica; los demás requieren superar ese monto.
        if (total <= 700 && !['006', '021'].includes(first.detraccion_codigo)) {
            return resultado({ sujeto: false, codigo: null, descripcion: null, porcentaje: 0, base: total, monto: 0,
                neto: total, estadoDeposito: 'NO_APLICA', motivoExclusion: 'IMPORTE_MENOR_O_IGUAL_A_700', requiereRevision: false }, 'CLASIFICADA_SIN_UMBRAL_LEGAL');
        }
        const monto = Math.round(total * definicion.porcentaje / 100);
        return resultado({ sujeto: true, codigo: first.detraccion_codigo, descripcion: definicion.descripcion,
            porcentaje: definicion.porcentaje, base: total, monto, neto: redondear(total - monto),
            estadoDeposito: 'PENDIENTE', constanciaNro: null, constanciaFecha: null,
            motivoExclusion: null, medioPagoDetraccion: '001', nubefactTipo: Number(first.detraccion_codigo), requiereRevision: false }, 'SUJETA');
    }

    // La regla comercial activa la evaluación de S/ 700 inclusive. La regla
    // legal de servicios del Anexo 3 sigue siendo estricta: el importe debe
    // ser mayor a S/ 700 para aplicar la detracción.
    if (!debeEvaluarClasificacion) {
        return resultado({
            sujeto: false, codigo: null, descripcion: null, porcentaje: 0, base: total,
            monto: 0, neto: total, estadoDeposito: 'NO_APLICA',
            motivoExclusion: 'BAJO_UMBRAL_COMERCIAL', requiereRevision: false
        }, 'BAJO_UMBRAL_COMERCIAL');
    }

    // La clasificación del servicio debe estar confirmada en el catálogo.
    // No se infiere el código fiscal por el importe ni por ser una factura.
    if (!servicio || servicio.sujeto_detraccion === null || servicio.sujeto_detraccion === undefined) {
        return resultado({
            sujeto: false, codigo: null, descripcion: null, porcentaje: 0,
            base: total, monto: 0, neto: total, estadoDeposito: 'NO_VERIFICADO',
            motivoExclusion: 'CLASIFICACION_SPOT_NO_VERIFICADA', requiereRevision: true
        }, 'CLASIFICACION_PENDIENTE');
    }

    if (servicio.sujeto_detraccion === false) {
        return resultado({
            sujeto: false, codigo: null, descripcion: null, porcentaje: 0,
            base: total, monto: 0, neto: total, estadoDeposito: 'NO_APLICA',
            motivoExclusion: 'SERVICIO_EXCLUIDO_POR_CONFIGURACION', requiereRevision: false
        }, 'NO_SUJETA_CONFIGURACION');
    }

    // 5. Determinar clasificación SPOT aplicable
    let spotCodigo = servicio.detraccion_codigo;
    let spotPorcentaje = Number(servicio.detraccion_porcentaje);

    if (servicio) {
        if (!spotCodigo || !Number.isFinite(spotPorcentaje) || spotPorcentaje <= 0) {
            return resultado({
                sujeto: false, codigo: null, descripcion: null, porcentaje: 0,
                base: total, monto: 0, neto: total, estadoDeposito: 'NO_VERIFICADO',
                motivoExclusion: 'CLASIFICACION_SPOT_INCOMPLETA', requiereRevision: true
            }, 'CLASIFICACION_INCOMPLETA');
        }
    }

    const definicion = CAT_SPOT[spotCodigo];
    if (!definicion) {
        return resultado({
            sujeto: false, codigo: null, descripcion: null, porcentaje: 0,
            base: total, monto: 0, neto: total, estadoDeposito: 'NO_VERIFICADO',
            motivoExclusion: 'CLASIFICACION_SPOT_NO_RECONOCIDA', requiereRevision: true
        }, 'CLASIFICACION_NO_RECONOCIDA');
    }
    if (Number(definicion.porcentaje) !== spotPorcentaje) {
        return resultado({
            sujeto: false, codigo: null, descripcion: null, porcentaje: 0,
            base: total, monto: 0, neto: total, estadoDeposito: 'NO_VERIFICADO',
            motivoExclusion: 'CLASIFICACION_SPOT_INCONSISTENTE', requiereRevision: true
        }, 'CLASIFICACION_INCONSISTENTE');
    }

    if (total <= UMBRAL_LEGAL_SERVICIOS) {
        return resultado({
            sujeto: false, codigo: null, descripcion: null, porcentaje: 0, base: total,
            monto: 0, neto: total, estadoDeposito: 'NO_APLICA',
            motivoExclusion: 'IMPORTE_MENOR_O_IGUAL_A_700', requiereRevision: false
        }, 'CLASIFICADA_SIN_UMBRAL_LEGAL');
    }

    // 6. Cálculo legal oficial: Base total, porcentaje y redondeo al número entero SUNAT
    const base = total;
    const porcentaje = Number(definicion.porcentaje || spotPorcentaje);
    // Redondeo legal oficial SUNAT (Art. 19 RS 183-2004/SUNAT)
    const monto = Math.round((base * porcentaje) / 100);
    const neto = redondear(base - monto);

    return resultado({
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
    }, 'SUJETA');
}

/**
 * Enriquece el payload enviado a la API de NubeFact con los campos oficiales de detracción SPOT.
 */
function aplicarDetraccionPayloadNubefact(payload, evaluacion) {
    if (!payload || typeof payload !== 'object') return payload;

    if (evaluacion && evaluacion.sujeto === true) {
        const porcentaje = Number(evaluacion.porcentaje);
        const monto = Number(evaluacion.monto);
        const tipo = Number(evaluacion.nubefactTipo || parseInt(evaluacion.codigo, 10));
        if (!Number.isFinite(porcentaje) || porcentaje <= 0 || !Number.isFinite(monto) || monto < 0 || !Number.isFinite(tipo)) {
            throw new Error('CLASIFICACION_SPOT_INCOMPLETA');
        }
        payload.detraccion = true;
        payload.detraccion_tipo = tipo;
        payload.detraccion_porcentaje = porcentaje;
        payload.detraccion_total = monto;
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

    if (!facturaOriginal.detraccion_codigo || !Number.isFinite(Number(facturaOriginal.detraccion_porcentaje)) || Number(facturaOriginal.detraccion_porcentaje) <= 0) {
        throw new Error('CLASIFICACION_SPOT_INCOMPLETA');
    }

    const base = redondear(importeNotaCredito);
    const porcentaje = Number(facturaOriginal.detraccion_porcentaje);
    const monto = Math.round((base * porcentaje) / 100);
    const neto = redondear(base - monto);

    return {
        sujeto: true,
        codigo: facturaOriginal.detraccion_codigo,
        porcentaje: porcentaje,
        base: base,
        monto: monto,
        neto: neto,
        motivoExclusion: null
    };
}

module.exports = {
    CAT_SPOT,
    CAT_SPOT_BIENES,
    obtenerUmbralComercial,
    evaluarDetraccion,
    aplicarDetraccionPayloadNubefact,
    evaluarNotaCreditoDetraccion
};

