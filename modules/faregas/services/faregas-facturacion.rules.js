const calculoTributario = require('./faregas-calculo-tributario.service');
const { redondear, aCentavos, deCentavos } = calculoTributario;
const limpiarTexto = (value) => String(value ?? '').trim();

const esRucValido = (value) => {
    const ruc = limpiarTexto(value);
    if (!/^\d{11}$/.test(ruc)) return false;

    const pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
    const suma = pesos.reduce((total, peso, index) => total + Number(ruc[index]) * peso, 0);
    const diferencia = 11 - (suma % 11);
    const digitoCalculado = diferencia === 10 ? 0 : diferencia === 11 ? 1 : diferencia;
    return digitoCalculado === Number(ruc[10]);
};

const esFechaIsoValida = (value) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
    const [anio, mes, dia] = value.split('-').map(Number);
    const fecha = new Date(Date.UTC(anio, mes - 1, dia));
    return fecha.getUTCFullYear() === anio && fecha.getUTCMonth() === mes - 1 && fecha.getUTCDate() === dia;
};

const normalizarFacturacion = (data = {}) => {
    const tipoComprobante = limpiarTexto(data.tipoComprobante).toUpperCase();
    const nroDocumento = limpiarTexto(data.nroDocumento).toUpperCase();
    const tipoDocumentoExplicito = limpiarTexto(data.tipoDocumentoCliente).toUpperCase();
    const tipoDocumentoCliente = tipoDocumentoExplicito
        || (/^\d{11}$/.test(nroDocumento) ? 'RUC' : /^\d{8}$/.test(nroDocumento) ? 'DNI' : '');

    return {
        tipoComprobante,
        tipoDocumentoCliente,
        nroDocumento,
        nombreRazonSocial: limpiarTexto(data.nombreRazonSocial).toUpperCase(),
        direccion: limpiarTexto(data.direccion).toUpperCase(),
        email: limpiarTexto(data.email).toLowerCase() || null,
        telefono: limpiarTexto(data.telefono) || null,
        condicionPago: limpiarTexto(data.condicionPago || 'CONTADO').toUpperCase(),
        fechaInicioCredito: limpiarTexto(data.fechaInicioCredito) || null,
        fechaVencimiento: limpiarTexto(data.fechaVencimiento) || null,
        medioPago: limpiarTexto(data.medioPago) || null,
        facturarAlDuenoPrincipal: data.facturarAlDuenoPrincipal === true
            || data.usarTitularPrincipalFac === true,
        // Soporte estructurado para Detracción SPOT y Operaciones Gratuitas
        esDetraccion: Boolean(data.esDetraccion || data.detraccion === true || data.sujetoDetraccion === true),
        detraccionTipo: limpiarTexto(data.detraccionTipo || data.detraccion_tipo || data.codigoSpot) || null,
        detraccionPorcentaje: (data.detraccionPorcentaje !== undefined && data.detraccionPorcentaje !== null && data.detraccionPorcentaje !== '')
            ? redondear(data.detraccionPorcentaje)
            : null,
        detraccionTotal: (data.detraccionTotal !== undefined && data.detraccionTotal !== null && data.detraccionTotal !== '')
            ? redondear(data.detraccionTotal)
            : null,
        detraccionMedioPago: limpiarTexto(data.detraccionMedioPago || data.detraccion_medio_pago || '001') || '001',
        detraccionCuentaBanco: limpiarTexto(data.detraccionCuentaBanco || data.detraccion_cuenta_banco || '') || null,
        tipoOperacion: limpiarTexto(data.tipoOperacion || (Boolean(data.esDetraccion || data.detraccion) ? 'OPERACION_SUJETA_DETRACCION' : (Boolean(data.esGratuito) ? 'TRANSFERENCIA_GRATUITA' : 'VENTA_INTERNA'))),
        esGratuito: Boolean(data.esGratuito || data.es_gratuito),
        totalGratuito: redondear(data.totalGratuito || data.total_gratuito || 0),
        cuotas: Array.isArray(data.cuotas) ? data.cuotas.map((cuota, index) => ({
            numeroCuota: Number(cuota.numeroCuota || index + 1),
            fechaPago: limpiarTexto(cuota.fechaPago),
            importe: redondear(cuota.importe)
        })) : []
    };
};

const validarFacturacion = (facturacion) => {
    const errores = [];
    if (!['BOLETA', 'FACTURA'].includes(facturacion.tipoComprobante)) {
        errores.push('El tipo de comprobante debe ser BOLETA o FACTURA.');
    }
    if (!['DNI', 'RUC', 'CARNETEXTRANJERIA'].includes(facturacion.tipoDocumentoCliente)) {
        errores.push('Seleccione un tipo de documento valido para facturacion.');
    } else if (facturacion.tipoDocumentoCliente === 'DNI' && !/^\d{8}$/.test(facturacion.nroDocumento)) {
        errores.push('El DNI debe contener exactamente 8 digitos.');
    } else if (facturacion.tipoDocumentoCliente === 'RUC' && !/^\d{11}$/.test(facturacion.nroDocumento)) {
        errores.push('El RUC debe contener exactamente 11 digitos.');
    } else if (facturacion.tipoDocumentoCliente === 'CARNETEXTRANJERIA'
        && !/^[A-Z0-9]{1,20}$/.test(facturacion.nroDocumento)) {
        errores.push('El carnet de extranjeria debe contener hasta 20 caracteres alfanumericos.');
    }
    if (facturacion.tipoComprobante === 'FACTURA' && facturacion.tipoDocumentoCliente !== 'RUC') {
        errores.push('Una FACTURA requiere un RUC de 11 digitos.');
    }
    if (facturacion.tipoComprobante === 'FACTURA'
        && facturacion.tipoDocumentoCliente === 'RUC'
        && !esRucValido(facturacion.nroDocumento)) {
        errores.push('El RUC no tiene un digito verificador valido.');
    }
    if (!facturacion.nombreRazonSocial || facturacion.nombreRazonSocial.length > 100) {
        errores.push('El nombre o razon social es obligatorio y admite hasta 100 caracteres.');
    }
    if (!facturacion.direccion || facturacion.direccion.length > 100) {
        errores.push('La direccion fiscal es obligatoria y admite hasta 100 caracteres.');
    }
    if (facturacion.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(facturacion.email)) {
        errores.push('El correo electronico no tiene un formato valido.');
    }
    if (facturacion.telefono && facturacion.telefono.length > 30) {
        errores.push('El telefono admite hasta 30 caracteres.');
    }
    if (!['CONTADO', 'CREDITO'].includes(facturacion.condicionPago)) {
        errores.push('La condicion de pago debe ser CONTADO o CREDITO.');
    }
    if (facturacion.tipoComprobante === 'BOLETA' && facturacion.condicionPago === 'CREDITO') {
        errores.push('Una BOLETA solo puede emitirse con condicion de pago CONTADO.');
    }
    if (facturacion.medioPago && facturacion.medioPago.length > 250) {
        errores.push('El medio de pago admite hasta 250 caracteres.');
    }
    if (facturacion.condicionPago === 'CREDITO') {
        if (!esFechaIsoValida(facturacion.fechaInicioCredito)) {
            errores.push('Una venta al credito requiere una fecha de inicio valida.');
        }
        if (!esFechaIsoValida(facturacion.fechaVencimiento)) {
            errores.push('Una venta al credito requiere una fecha de vencimiento valida.');
        }
        if (esFechaIsoValida(facturacion.fechaInicioCredito)
            && esFechaIsoValida(facturacion.fechaVencimiento)
            && facturacion.fechaVencimiento < facturacion.fechaInicioCredito) {
            errores.push('La fecha de vencimiento no puede ser anterior a la fecha de inicio del credito.');
        }
        if (facturacion.cuotas.length === 0) errores.push('Una venta al credito requiere al menos una cuota.');
        const numeros = new Set();
        for (const cuota of facturacion.cuotas) {
            if (!Number.isInteger(cuota.numeroCuota) || cuota.numeroCuota <= 0 || numeros.has(cuota.numeroCuota)) {
                errores.push('Las cuotas deben tener numeros positivos y no repetidos.');
                break;
            }
            numeros.add(cuota.numeroCuota);
            if (!esFechaIsoValida(cuota.fechaPago)) {
                errores.push('Cada cuota requiere una fecha de pago valida.');
                break;
            }
            if (esFechaIsoValida(cuota.fechaPago)
                && esFechaIsoValida(facturacion.fechaInicioCredito)
                && cuota.fechaPago < facturacion.fechaInicioCredito) {
                errores.push('La fecha de cada cuota debe ser igual o posterior al inicio del credito.');
                break;
            }
            if (esFechaIsoValida(cuota.fechaPago)
                && esFechaIsoValida(facturacion.fechaVencimiento)
                && cuota.fechaPago > facturacion.fechaVencimiento) {
                errores.push('La fecha de cada cuota no puede superar el vencimiento general del credito.');
                break;
            }
            if (!Number.isFinite(cuota.importe) || cuota.importe <= 0) {
                errores.push('Cada cuota requiere un importe mayor a cero.');
                break;
            }
        }
    } else if (facturacion.cuotas.length > 0) {
        errores.push('Una venta al contado no debe incluir cuotas.');
    }

    if (facturacion.esDetraccion) {
        if (facturacion.tipoComprobante !== 'FACTURA') {
            errores.push('Las operaciones sujetas a detraccion SPOT solo aplican a FACTURA.');
        }
        if (!facturacion.detraccionTipo) {
            errores.push('Una operacion con detraccion requiere el codigo de bien o servicio SPOT SUNAT (Catalogo 54).');
        } else if (!calculoTributario.CATALOGO_DETRACCION_SPOT[facturacion.detraccionTipo]) {
            errores.push(`El codigo SPOT '${facturacion.detraccionTipo}' no existe o no esta vigente en el Catalogo 54 de SUNAT.`);
        }
        if (facturacion.detraccionPorcentaje !== null && (facturacion.detraccionPorcentaje <= 0 || facturacion.detraccionPorcentaje > 100)) {
            errores.push('El porcentaje de detraccion debe ser mayor a 0 y menor o igual a 100.');
        }
        if (facturacion.detraccionCuentaBanco && !calculoTributario.esCuentaBancoNacionValida(facturacion.detraccionCuentaBanco)) {
            errores.push(`La cuenta corriente '${facturacion.detraccionCuentaBanco}' no tiene un formato valido de 11 digitos del Banco de la Nacion.`);
        }
    }

    if (facturacion.esGratuito) {
        if (facturacion.condicionPago !== 'CONTADO') {
            errores.push('Una operacion a titulo gratuito solo admite condicion de pago CONTADO.');
        }
        if (facturacion.cuotas.length > 0) {
            errores.push('Una operacion a titulo gratuito no admite cuotas de credito.');
        }
    }

    return errores;
};

const validarFacturacionNubefact = (facturacion) => {
    const errores = [];
    if (!['DNI', 'RUC'].includes(limpiarTexto(facturacion?.tipo_documento_cliente).toUpperCase())) {
        errores.push('El tipo de documento seleccionado no tiene un mapeo fiscal habilitado para Nubefact.');
    }
    if (facturacion?.tipo_comprobante === 'FACTURA'
        && !esRucValido(facturacion?.nro_documento)) {
        errores.push('El RUC no tiene un digito verificador valido.');
    }
    if (limpiarTexto(facturacion?.nombre_razon_social).length > 100) {
        errores.push('El nombre o razon social admite hasta 100 caracteres para Nubefact.');
    }
    if (limpiarTexto(facturacion?.direccion).length > 100) {
        errores.push('La direccion fiscal admite hasta 100 caracteres para Nubefact.');
    }
    return errores;
};

const validarCuotasContraTotal = (cuotas, total, detraccion = null) => {
    const tieneDetraccion = Boolean(detraccion && (detraccion.aplica || detraccion.es_detraccion));
    const montoEsperado = tieneDetraccion
        ? redondear(detraccion.montoNetoPendiente ?? (redondear(total) - redondear(detraccion.montoDetraccion ?? detraccion.detraccion_total ?? 0)))
        : redondear(total);

    const sumaCentavos = (cuotas || []).reduce((acumulado, cuota) => acumulado + aCentavos(cuota.importe || 0), 0);
    const esperadoCentavos = aCentavos(montoEsperado);
    return Math.abs(sumaCentavos - esperadoCentavos) === 0;
};

const resolverNombreMedioPago = (pago) => {
    if (!pago) return null;

    if (typeof pago === 'string') {
        const raw = limpiarTexto(pago).toUpperCase();
        if (!raw) return null;
        if (raw === 'YAPE') return 'YAPE';
        if (raw === 'PLIN') return 'PLIN';
        if (raw.includes('VISA')) return 'TARJETA VISA';
        if (raw.includes('MASTER')) return 'TARJETA MASTERCARD';
        if (raw === 'CUPONIDAD') return 'CUPONIDAD';
        if (raw === 'PAGO WEB' || raw === 'PAGO_WEB') return 'PAGO WEB';
        if (raw === 'EFECTIVO') return 'EFECTIVO';
        if (raw.includes('TRANSFER')) return 'TRANSFERENCIA BANCARIA';
        if (raw.includes('DEPOSI')) return 'DEPÓSITO BANCARIO';
        if (raw === 'BANCO') return 'TRANSFERENCIA BANCARIA';
        if (raw.includes('DEBIT')) return 'TARJETA DÉBITO';
        if (raw.includes('CREDIT')) return 'TARJETA CRÉDITO';
        if (raw === 'TARJETA') return 'TARJETA';
        return raw;
    }

    const tarjetaNombre = limpiarTexto(pago.tarjeta_nombre || pago.tarjetaNombre || pago.nombre).toUpperCase();
    const tarjetaKey = limpiarTexto(pago.tarjeta_key || pago.tarjetaKey);
    const tipoContado = limpiarTexto(pago.tipocontado_key || pago.tipoContadoKey || pago.tipo).toLowerCase();
    const modalidad = limpiarTexto(pago.modalidad_tarjeta || pago.modalidadTarjeta || pago.tipo_tarjeta || pago.tipoTarjeta).toUpperCase();
    const subtipo = limpiarTexto(pago.subtipo || pago.tipo_banco || pago.tipoBanco).toUpperCase();

    // 1. Selector de marca o medio de tarjeta (YAPE, PLIN, VISA, MASTERCARD, etc.)
    if (tarjetaNombre.includes('YAPE') || tarjetaKey === '7') return 'YAPE';
    if (tarjetaNombre.includes('PLIN') || tarjetaKey === '8') return 'PLIN';
    if (tarjetaNombre.includes('VISA') || tarjetaKey === '3') return 'TARJETA VISA';
    if (tarjetaNombre.includes('MASTERCARD') || tarjetaKey === '4') return 'TARJETA MASTERCARD';
    if (tarjetaNombre.includes('CUPONIDAD') || tarjetaKey === '5') return 'CUPONIDAD';
    if (tarjetaNombre.includes('PAGO WEB') || tarjetaNombre.includes('PAGO_WEB') || tarjetaKey === '6') return 'PAGO WEB';
    if (tarjetaNombre) return `TARJETA ${tarjetaNombre}`;

    // 2. Tipo de contado (efectivo, banco, tarjeta sin marca específica)
    if (tipoContado === 'efectivo') return 'EFECTIVO';
    if (tipoContado === 'banco') {
        if (subtipo === 'DEPOSITO' || pago.fechdeposito) return 'DEPÓSITO BANCARIO';
        return 'TRANSFERENCIA BANCARIA';
    }
    if (tipoContado === 'tarjeta') {
        if (modalidad === 'DEBITO' || modalidad.includes('DEBIT')) return 'TARJETA DÉBITO';
        if (modalidad === 'CREDITO' || modalidad.includes('CREDIT')) return 'TARJETA CRÉDITO';
        return 'TARJETA';
    }

    // 3. Fallback a campos medio_pago o medio
    const fallback = limpiarTexto(pago.medio_pago || pago.medio);
    if (fallback) {
        return resolverNombreMedioPago(fallback);
    }

    return null;
};

const agruparDesglosePagos = (pagos = []) => {
    if (!Array.isArray(pagos) || pagos.length === 0) return [];

    const mapa = new Map();
    for (const pago of pagos) {
        const medio = resolverNombreMedioPago(pago);
        if (!medio) continue;
        const importe = Number(pago?.importe || pago?.monto || 0);
        if (mapa.has(medio)) {
            const existente = mapa.get(medio);
            existente.importe = redondear(existente.importe + importe);
            existente.cantidad += 1;
        } else {
            mapa.set(medio, {
                medio,
                importe: redondear(importe),
                cantidad: 1
            });
        }
    }
    return Array.from(mapa.values());
};

const derivarMedioPago = (pagos = []) => {
    if (!Array.isArray(pagos) || pagos.length === 0) return null;

    const desglose = agruparDesglosePagos(pagos);
    if (desglose.length === 0) return null;

    if (desglose.length === 1) {
        return desglose[0].medio;
    }

    // Pagos mixtos (más de 1 medio distinto)
    const tieneImportes = desglose.some(d => d.importe > 0);
    if (tieneImportes) {
        const detalle = desglose
            .map(d => `${d.medio} S/ ${Number(d.importe).toFixed(2)}`)
            .join(', ');
        return `MIXTO: ${detalle}`;
    }

    return `MIXTO: ${desglose.map(d => d.medio).join(', ')}`;
};

const validarSerieNubefact = (serie, tipoComprobante) => {
    const normalizada = limpiarTexto(serie).toUpperCase();
    const prefijoEsperado = tipoComprobante === 'FACTURA' ? 'F' : tipoComprobante === 'BOLETA' ? 'B' : '';
    if (!/^[A-Z0-9]{4}$/.test(normalizada) || !prefijoEsperado || !normalizada.startsWith(prefijoEsperado)) {
        return false;
    }
    return true;
};

module.exports = {
    esRucValido,
    normalizarFacturacion,
    validarFacturacion,
    validarFacturacionNubefact,
    validarSerieNubefact,
    validarCuotasContraTotal,
    resolverNombreMedioPago,
    agruparDesglosePagos,
    derivarMedioPago,
    esFechaIsoValida,
    redondear,
    calculoTributario
};
