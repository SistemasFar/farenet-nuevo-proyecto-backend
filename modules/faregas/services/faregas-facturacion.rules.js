const limpiarTexto = (value) => String(value ?? '').trim();

const redondear = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

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
        telefono: limpiarTexto(data.telefono) || null
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
    if (!facturacion.nombreRazonSocial || facturacion.nombreRazonSocial.length > 250) {
        errores.push('El nombre o razon social es obligatorio y admite hasta 250 caracteres.');
    }
    if (!facturacion.direccion || facturacion.direccion.length > 500) {
        errores.push('La direccion fiscal es obligatoria y admite hasta 500 caracteres.');
    }
    if (facturacion.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(facturacion.email)) {
        errores.push('El correo electronico no tiene un formato valido.');
    }
    if (facturacion.telefono && facturacion.telefono.length > 30) {
        errores.push('El telefono admite hasta 30 caracteres.');
    }
    return errores;
};

module.exports = {
    normalizarFacturacion,
    validarFacturacion,
    redondear
};
