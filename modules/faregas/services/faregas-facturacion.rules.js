const limpiarTexto = (value) => String(value ?? '').trim();

const redondear = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

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

const validarCuotasContraTotal = (cuotas, total) => {
    const suma = redondear((cuotas || []).reduce((acumulado, cuota) => acumulado + Number(cuota.importe || 0), 0));
    return Math.abs(suma - redondear(total)) <= 0.009;
};

const derivarMedioPago = (pagos = []) => {
    const orden = ['EFECTIVO', 'TARJETA', 'BANCO'];
    const registrados = new Set(
        pagos
            .map(pago => limpiarTexto(pago?.tipocontado_key ?? pago?.tipo).toUpperCase())
            .filter(tipo => orden.includes(tipo))
    );
    return orden.filter(tipo => registrados.has(tipo)).join(', ') || null;
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
    derivarMedioPago,
    esFechaIsoValida,
    redondear
};
