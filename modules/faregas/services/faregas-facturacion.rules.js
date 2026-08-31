const limpiarTexto = (value) => String(value ?? '').trim();

const redondear = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

const esFechaIsoValida = (value) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
    const [anio, mes, dia] = value.split('-').map(Number);
    const fecha = new Date(Date.UTC(anio, mes - 1, dia));
    return fecha.getUTCFullYear() === anio && fecha.getUTCMonth() === mes - 1 && fecha.getUTCDate() === dia;
};

const normalizarFacturacion = (data = {}) => {
    const tipoComprobante = limpiarTexto(data.tipoComprobante).toUpperCase();
    const nroDocumento = limpiarTexto(data.nroDocumento).replace(/\D/g, '');
    const tipoDocumentoCliente = nroDocumento.length === 11 ? 'RUC' : nroDocumento.length === 8 ? 'DNI' : '';

    return {
        tipoComprobante,
        tipoDocumentoCliente,
        nroDocumento,
        nombreRazonSocial: limpiarTexto(data.nombreRazonSocial).toUpperCase(),
        direccion: limpiarTexto(data.direccion).toUpperCase(),
        email: limpiarTexto(data.email).toLowerCase() || null,
        telefono: limpiarTexto(data.telefono) || null,
        condicionPago: limpiarTexto(data.condicionPago || 'CONTADO').toUpperCase(),
        fechaVencimiento: limpiarTexto(data.fechaVencimiento) || null,
        medioPago: limpiarTexto(data.medioPago) || null,
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
    if (!facturacion.tipoDocumentoCliente) {
        errores.push('El documento debe contener 8 digitos (DNI) u 11 digitos (RUC).');
    }
    if (facturacion.tipoComprobante === 'FACTURA' && facturacion.tipoDocumentoCliente !== 'RUC') {
        errores.push('Una FACTURA requiere un RUC de 11 digitos.');
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
    if (facturacion.medioPago && facturacion.medioPago.length > 250) {
        errores.push('El medio de pago admite hasta 250 caracteres.');
    }
    if (facturacion.condicionPago === 'CREDITO') {
        if (!esFechaIsoValida(facturacion.fechaVencimiento)) {
            errores.push('Una venta al credito requiere una fecha de vencimiento valida.');
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
    normalizarFacturacion,
    validarFacturacion,
    validarFacturacionNubefact,
    validarSerieNubefact,
    validarCuotasContraTotal,
    derivarMedioPago,
    esFechaIsoValida,
    redondear
};
