'use strict';

const normalizarClave = (valor) => String(valor ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase();

const normalizarEtiqueta = (valor) => normalizarClave(valor).replace(/[^A-Z0-9]/g, '');

const esDescuentoEspecialCortesia = (descuento = {}) => {
    const id = Number(descuento.descuento_id ?? descuento.descuentoId ?? descuento.id);
    const codigo = normalizarClave(descuento.codigo);
    const nombre = normalizarClave(descuento.nombre ?? descuento.descuento_nombre);
    return id === 17
        || ['CORTESIA_FAREGAS', 'DESCUENTO_TALLER', 'D_CONVENIO_A88137BB742F4157'].includes(codigo)
        || ['DESCUENTO CERTIFICADO TALLER', 'CORTESIA FAREGAS'].includes(nombre);
};

const esDescuentoLegadoFarenet = (descuento = {}) => {
    const empresa = normalizarEtiqueta(descuento.empresa_aliada_nombre ?? descuento.empresaAliada);
    return empresa === 'FARENET' || empresa === 'FARENETSAC';
};

const resolverReglaPorConcepto = (reglas, servicio) => {
    const servicioId = Number(servicio?.servicio_id ?? servicio?.servicioId ?? servicio?.id);
    const exactas = reglas.filter((regla) => Number(regla.servicio_id ?? regla.servicioId) === servicioId);
    if (exactas.length === 1) return { regla: exactas[0], ambiguo: false };
    if (exactas.length > 1) return { regla: null, ambiguo: true, candidatas: exactas };

    const claveActual = claveServicioCanonica(servicio);
    if (!claveActual || claveActual.startsWith('SERVICIO_ID::')) return { regla: null, ambiguo: false };
    const equivalentes = reglas.filter((regla) => claveServicioCanonica(regla) === claveActual);
    if (equivalentes.length === 1) return { regla: equivalentes[0], ambiguo: false };
    return { regla: null, ambiguo: equivalentes.length > 1, candidatas: equivalentes };
};

/**
 * Canonical identity for a Faregas certificate concept.
 *
 * The certificate type, modality, service flow, family and root format describe
 * the operational document. Commercial tariff and fiscal product SKUs are
 * deliberately excluded. If this identity is incomplete, only the globally
 * unique fg_servicio id is safe to use as a fallback.
 */
const claveServicioCanonica = (servicio = {}) => {
    const id = Number(servicio.servicio_id ?? servicio.servicioId ?? servicio.id);
    const tipo = normalizarClave(servicio.tipo_certificado_clave ?? servicio.tipoCertificadoClave);
    const modalidad = normalizarClave(servicio.modalidad);
    const flujo = normalizarClave(servicio.tipo_flujo ?? servicio.tipoFlujo);
    const familia = normalizarClave(servicio.familia);
    const formato = normalizarClave(servicio.formato_codigo_canonico ?? servicio.formatoCodigoCanonico);

    if (tipo && flujo && familia && formato) {
        return `CONCEPTO::${[tipo, modalidad || 'SIN_MODALIDAD', flujo, familia, formato].join('::')}`;
    }
    return Number.isInteger(id) && id > 0 ? `SERVICIO_ID::${id}` : null;
};

const tieneMaximoDosDecimales = (valor) => {
    if (valor === null || valor === undefined || valor === '') return true;
    if (typeof valor === 'string') {
        return /^-?(?:\d+(?:\.\d{0,2})?|\.\d{1,2})$/.test(valor.trim());
    }
    const numero = Number(valor);
    return Number.isFinite(numero)
        && /^-?(?:\d+(?:\.\d{0,2})?|\.\d{1,2})$/.test(String(numero));
};

const centavos = (valor) => {
    const texto = String(valor ?? '').trim();
    if (!tieneMaximoDosDecimales(texto)) throw new Error('IMPORTE_DECIMALES_INVALIDOS');
    const [entero = '0', decimal = ''] = texto.split('.');
    const signo = entero.startsWith('-') ? -1n : 1n;
    const magnitud = entero.replace(/^[+-]/, '') || '0';
    return signo * (BigInt(magnitud) * 100n + BigInt(decimal.padEnd(2, '0') || '0'));
};
const soles = (valorCentavos) => Number(valorCentavos) / 100;

const normalizarValorRegla = (valor) => {
    if (valor === null || valor === undefined || valor === '') return null;
    if (!tieneMaximoDosDecimales(valor)) return null;
    if (typeof valor === 'string') return valor.trim();
    return (Math.round(Number(valor) * 100) / 100).toFixed(2);
};

/** Validates a commercial rule using the current customer-facing sale price. */
const evaluarReglaPrecio = (tipoCalculo, valor, precioVenta) => {
    if (!tieneMaximoDosDecimales(precioVenta) || !tieneMaximoDosDecimales(valor)) {
        return { valido: false, motivo: 'Use como máximo dos decimales para importes y porcentajes; el valor no se redondeará.' };
    }
    const precioCentavos = centavos(precioVenta);
    const valorNumero = Number(valor);
    if (!Number.isFinite(Number(precioVenta)) || precioCentavos <= 0n
        || !Number.isFinite(valorNumero) || valorNumero <= 0) {
        return { valido: false, motivo: 'El precio vigente o el descuento no es válido.' };
    }

    let descuentoCentavos;
    if (tipoCalculo === 'FLAT') {
        const precioFinalCentavos = centavos(valorNumero);
        descuentoCentavos = precioCentavos - precioFinalCentavos;
        if (precioFinalCentavos <= 0n || descuentoCentavos <= 0n) {
            return { valido: false, motivo: 'El precio final debe ser positivo y menor que el precio de venta.' };
        }
    } else if (tipoCalculo === 'MONTO') {
        descuentoCentavos = centavos(valorNumero);
        if (descuentoCentavos >= precioCentavos) {
            return { valido: false, motivo: 'El descuento debe ser menor que el precio de venta.' };
        }
    } else if (tipoCalculo === 'PORCENTAJE') {
        if (valorNumero >= 100) {
            return { valido: false, motivo: 'Un descuento comercial ordinario debe ser menor al 100 %.' };
        }
        const porcentajeCentavos = centavos(valor);
        descuentoCentavos = (precioCentavos * porcentajeCentavos + 5000n) / 10000n;
    } else {
        return { valido: false, motivo: 'El tipo de cálculo del descuento no es válido.' };
    }

    const finalCentavos = precioCentavos - descuentoCentavos;
    if (descuentoCentavos <= 0n || finalCentavos <= 0n) {
        return { valido: false, motivo: 'El descuento dejaría el importe final en cero o negativo.' };
    }
    return {
        valido: true,
        precioVenta: soles(precioCentavos),
        importeDescuento: soles(descuentoCentavos),
        importeFinal: soles(finalCentavos)
    };
};

module.exports = Object.freeze({
    claveServicioCanonica,
    esDescuentoEspecialCortesia,
    esDescuentoLegadoFarenet,
    resolverReglaPorConcepto,
    evaluarReglaPrecio,
    tieneMaximoDosDecimales,
    normalizarValorRegla
});
